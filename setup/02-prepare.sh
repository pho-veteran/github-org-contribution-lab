#!/usr/bin/env bash
# Run this stage from any working directory; --dir identifies the shared setup state.
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)/lib.sh"

prepare() {
  preflight false
  if [[ $CONTROLLER_EXISTS == false ]]; then
    api "$TOKEN_B" POST "/orgs/$ORG_B/repos" "$(jq -n --arg name "${CONTROLLER#*/}" \
      '{name:$name,private:true,auto_init:false,description:"Contribution bridge controller"}')"
    assert_repo "$CONTROLLER"; log "Created private controller: $CONTROLLER"
  fi
  REPORT=$(jq '{status:"manual-app-installation-required",controller:.controller,pairs:.pairs}' <<<"$CONFIG")
}


if [[ ${BASH_SOURCE[0]} == "$0" ]]; then run_stage prepare "$@"; fi
