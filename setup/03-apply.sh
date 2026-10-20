#!/usr/bin/env bash
# Run this stage from any working directory; --dir identifies the shared setup state.
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)/lib.sh"

apply_setup() {
  json_ok '.manual.workflowsReviewed==true' "$CONFIG" 'Review B workflows before bootstrap; set manual.workflowsReviewed=true'
  command -v node >/dev/null || die 'Node.js 24 is required to test the controller'
  node --test "$TEMPLATES"/controller/tests/*.test.mjs > "$WORK/controller-tests.log" 2>&1 ||
    die "Controller tests failed; run node --test templates/controller/tests/*.test.mjs"
  log 'Checking every repository, SSH connection and App installation...'
  preflight; check_ssh; check_apps
  local source target repo kind prefix results='[]'
  while IFS=$'\t' read -r source target; do audit_source "$source" "$target"; done \
    < <(jq -r '.pairs[]|[.source,.target]|@tsv' <<<"$CONFIG")
  deploy_controller
  read_variable "$CONTROLLER" BRIDGE_ENABLED
  [[ $VALUE_EXISTS == true ]] || set_variable "$CONTROLLER" BRIDGE_ENABLED false
  for kind in source target; do
    prefix=SOURCE; [[ $kind == source ]] || prefix=BRIDGE
    set_variable "$CONTROLLER" "${prefix}_APP_CLIENT_ID" "$(cfg ".apps.$kind.clientId")"
    set_secret "$CONTROLLER" "${prefix}_APP_PRIVATE_KEY" "${KEY_PATH[$kind]}"
  done
  while IFS=$'\t' read -r source target; do
    log "Configuring $source -> $target"
    for repo in "$source" "$target"; do
      set_variable "$repo" CONTROLLER_DISPATCH_APP_CLIENT_ID "$(cfg '.apps.dispatch.clientId')"
      set_secret "$repo" CONTROLLER_DISPATCH_APP_PRIVATE_KEY "${KEY_PATH[dispatch]}"
    done
    bootstrap "$source" "$target"; install_notifier "$source" "$target"
    results=$(jq --argjson item "$NOTIFIER_RESULT" '.+[$item]' <<<"$results")
  done < <(jq -r '.pairs[]|[.source,.target]|@tsv' <<<"$CONFIG")
  REPORT=$(jq -n --arg sha "$CONTROLLER_SHA" --argjson notifiers "$results" \
    '{status:"merge-setup-prs-and-review-protection",controllerSha:$sha,notifiers:$notifiers}')
}


if [[ ${BASH_SOURCE[0]} == "$0" ]]; then run_stage apply "$@"; fi
