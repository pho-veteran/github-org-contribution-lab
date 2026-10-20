#!/usr/bin/env bash
# Run this stage from any working directory; --dir identifies the shared setup state.
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)/lib.sh"

verify() {
  preflight; check_credentials
  read_variable "$CONTROLLER" BRIDGE_ENABLED; [[ $VALUE == true ]] || die 'Bridge is not enabled'
  read_file "$CONTROLLER" bridge.config.json
  same_json "$(jq '{controllerRepo,pairs}' <<<"$FILE_CONTENT")" \
    "$(jq '{controllerRepo:.controller,pairs}' <<<"$CONFIG")" || die 'Controller registry differs'
  local id source target a b na nb pairs='[]' ready status
  while IFS=$'\t' read -r id source target; do
    read_main "$source"; a=$MAIN; read_main "$target"; b=$MAIN
    na=false; nb=false
    read_file "$source" "$NOTIFIER_PATH"
    [[ $FILE_EXISTS != true || $FILE_CONTENT != "$(render_notifier "$source" "$target")" ]] || na=true
    read_file "$target" "$NOTIFIER_PATH"
    [[ $FILE_EXISTS != true || $FILE_CONTENT != "$(render_notifier "$source" "$target")" ]] || nb=true
    pairs=$(jq --arg id "$id" --arg source "$source" --arg target "$target" --arg a "$a" --arg b "$b" \
      --argjson na "$na" --argjson nb "$nb" \
      '.+[{id:$id,source:$source,target:$target,sourceMain:$a,targetMain:$b,notifierA:$na,notifierB:$nb,synced:($a!="" and $a==$b)}]' <<<"$pairs")
  done < <(jq -r '.pairs[]|[.id,.source,.target]|@tsv' <<<"$CONFIG")
  reconcile_status
  ready=$(jq --argjson pairs "$pairs" --argjson run "$RUN" \
    '($pairs|all(.synced and .notifierA and .notifierB)) and $run.allPairsSucceeded and
      $run.conclusion=="success" and .manual.workflowsReviewed==true and .manual.protectionsReviewed==true' <<<"$CONFIG")
  status=not-ready; [[ $ready != true ]] || status=configuration-and-main-sync-verified
  REPORT=$(jq -n --arg status "$status" --argjson pairs "$pairs" --argjson run "$RUN" \
    --argjson attestation "$(jq '.manual.protectionsReviewed==true' <<<"$CONFIG")" \
    '{status:$status,pairs:$pairs,run:$run,manualProtectionAttestation:$attestation,
      limits:"Secret values and effective protection are not proven. Test a PR lifecycle and denied writes before handover."}')
  [[ $ready == true ]] || RESULT_CODE=2
}


if [[ ${BASH_SOURCE[0]} == "$0" ]]; then run_stage verify "$@"; fi
