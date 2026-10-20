#!/usr/bin/env bash
# Run this stage from any working directory; --dir identifies the shared setup state.
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)/lib.sh"

activate() {
  json_ok '.manual.workflowsReviewed==true and .manual.protectionsReviewed==true' "$CONFIG" 'Complete manual workflow/protection review first'
  preflight; check_apps; check_credentials
  read_file "$CONTROLLER" bridge.config.json
  same_json "$FILE_CONTENT" "$(registry_json)" || die 'Controller registry differs'
  local source target sha since
  while IFS=$'\t' read -r source target; do
    read_file "$target" "$NOTIFIER_PATH"
    [[ $FILE_EXISTS == true && $FILE_CONTENT == "$(render_notifier "$source" "$target")" ]] || die "Merge setup PR first: $target"
  done < <(jq -r '.pairs[]|[.source,.target]|@tsv' <<<"$CONFIG")
  read_main "$CONTROLLER"; sha=$MAIN
  request "$CONTROLLER" "/actions/workflows/controller.yml/runs?event=push&head_sha=$sha&per_page=100"
  jq -e --arg sha "$sha" '[.workflow_runs[]|select(.head_sha==$sha and .head_branch=="main")][0].conclusion=="success"' \
    >/dev/null <<<"$RESPONSE" || die 'Wait for controller policy to succeed, then rerun activate'
  since=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  set_variable "$CONTROLLER" BRIDGE_ENABLED true
  request "$CONTROLLER" /actions/workflows/controller.yml/dispatches POST '{"ref":"main"}'
  REPORT=$(jq -n --arg sha "$sha" --arg date "$since" --arg url "https://github.com/$CONTROLLER/actions/workflows/controller.yml" \
    '{status:"dispatched-not-yet-verified",controllerSha:$sha,dispatchedAt:$date,actions:$url}')
}


if [[ ${BASH_SOURCE[0]} == "$0" ]]; then run_stage activate "$@"; fi
