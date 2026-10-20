#!/usr/bin/env bash
# Run this stage from any working directory; --dir identifies the shared setup state.
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)/lib.sh"

init_config() {
  local line org name target id digest pairs='[]' org_b='' normalized
  local -a inputs=()
  if [[ -n ${OPT[--repos]-} ]]; then
    [[ -f ${OPT[--repos]} ]] || die 'Input file not found'
    mapfile -t inputs < "${OPT[--repos]}"
  else inputs=("${DEFAULT_B_REPOS[@]}"); fi
  for line in "${inputs[@]}"; do
    line=$(printf '%s' "$line" | sed 's/\r$//;s/^[[:space:]]*//;s/[[:space:]]*$//')
    [[ -z $line || $line == \#* ]] && continue
    [[ $line =~ ^https://github\.com/([A-Za-z0-9][A-Za-z0-9-]*)/([A-Za-z0-9_.-]+)/?$ ]] || die "Invalid repository URL: $line"
    org=${BASH_REMATCH[1]}; name=${BASH_REMATCH[2]%.git}
    [[ -n $name && $name != . && $name != .. ]] || die 'Invalid repository name'
    [[ -z $org_b || $org_b == "$org" ]] || die 'All B repositories must belong to one organization, with canonical spelling'
    org_b=$org; target="$org/$name"
    normalized=$(printf '%s' "${name,,}" | sed 's/[^a-z0-9-]/-/g')
    digest=$(printf '%s' "${target,,}" | openssl dgst -sha256 -r); digest=${digest%% *}
    id="repo-${normalized:0:40}-${digest:0:8}"
    pairs=$(jq -c --arg id "$id" --arg a "${OPT[--org-a]}/$name" --arg b "$target" \
      '.+[{id:$id,source:$a,target:$b}]' <<<"$pairs")
  done
  CONFIG=$(jq -n --arg a "${OPT[--org-a]}" --arg b "$org_b" \
    --arg aa "${OPT[--account-a]}" --arg ab "${OPT[--account-b]}" \
    --arg sa "${OPT[--ssh-a]}" --arg sb "${OPT[--ssh-b]}" \
    --arg ctrl "$org_b/${OPT[--controller]:-contribution-controller}" --argjson pairs "$pairs" \
    '{version:1,orgA:$a,orgB:$b,accountA:$aa,accountB:$ab,controller:$ctrl,
      sshHosts:{source:$sa,target:$sb},pairs:$pairs,
      apps:{source:{clientId:"",privateKeyPath:""},target:{clientId:"",privateKeyPath:""},dispatch:{clientId:"",privateKeyPath:""}},
      manual:{workflowsReviewed:false,protectionsReviewed:false}}')
  validate_config
  [[ ! -e $DIR || ( -d $DIR && -z $(ls -A -- "$DIR") ) ]] || die '--dir must be new or empty; existing setup.json is never overwritten'
  mkdir -p -- "$DIR"
  printf '*\n' > "$DIR/.gitignore"
  printf '%s\n' "$CONFIG" > "$DIR/setup.json"
  log "Created $DIR/setup.json; $(jq '.pairs|length' <<<"$CONFIG") pairs. Run prepare."
}


if [[ ${BASH_SOURCE[0]} == "$0" ]]; then run_stage init "$@"; fi
