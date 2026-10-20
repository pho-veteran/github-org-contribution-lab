#!/usr/bin/env bash
# Offline integration tests: fake GitHub API + real local bare Git repositories.
set -euo pipefail
HERE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
for stage in 01-init 02-prepare 03-apply 04-activate 05-verify; do source "$HERE/$stage.sh"; done
ROOT=$(mktemp -d "${TMPDIR:-/tmp}/bridge-shell-test.XXXXXX")
ROOT=$(cd -- "$ROOT" && pwd -P)
trap 'case ${ROOT##*/} in bridge-shell-test.*) [[ ! -L $ROOT ]] && rm -rf -- "$ROOT";; esac' EXIT
PASS=0
pass() { PASS=$((PASS+1)); printf 'PASS %02d: %s\n' "$PASS" "$1"; }
equal() { [[ $1 == "$2" ]] || { printf 'Expected %s; got %s\n' "$2" "$1" >&2; exit 1; }; }
fails() { if ( "$@" ) > "$ROOT/expected-failure.log" 2>&1; then cat "$ROOT/expected-failure.log" >&2; printf 'Expected failure: %s\n' "$*" >&2; exit 1; fi; }
args=(--org-a OrgA --account-a admin-a --account-b admin-b --ssh-a github-a --ssh-b github-b)

bash "$HERE/01-init.sh" "${args[@]}" --dir "$ROOT/default" >/dev/null
CONFIG=$(cat "$ROOT/default/setup.json")
equal "$(jq '.pairs|length' <<<"$CONFIG")" 7
equal "$(cfg .orgB)" TechX-Corp
equal "$(cfg .controller)" TechX-Corp/contribution-controller
equal "$(jq -r '.pairs[0].target' <<<"$CONFIG")" TechX-Corp/xora-evaluation-framework
equal "$(jq -r '.pairs[-1].target' <<<"$CONFIG")" TechX-Corp/xora-resolve-agent
pass 'init uses the seven hardcoded repositories without network access'
fails bash "$HERE/01-init.sh" "${args[@]}" --dir "$ROOT/default"
pass 'init never overwrites existing setup state'
printf 'https://github.com/OrgB/project-1\nhttps://github.com/OrgB/project-2\n' > "$ROOT/input.txt"
bash "$HERE/01-init.sh" "${args[@]}" --repos "$ROOT/input.txt" --dir "$ROOT/state" >/dev/null
CONFIG=$(cat "$ROOT/state/setup.json")
equal "$(jq '.pairs|length' <<<"$CONFIG")" 2
pass 'custom input replaces the complete default list'
for bad in 'https://github.com/OrgB/..' 'https://evil.com/OrgB/x' 'https://github.com/OrgB/x?token=x'; do
  printf '%s\n' "$bad" > "$ROOT/bad.txt"
  fails bash "$HERE/01-init.sh" "${args[@]}" --repos "$ROOT/bad.txt" --dir "$ROOT/invalid"
done
printf 'https://github.com/OrgB/x\nhttps://github.com/OrgB/X\n' > "$ROOT/bad.txt"
fails bash "$HERE/01-init.sh" "${args[@]}" --repos "$ROOT/bad.txt" --dir "$ROOT/invalid"
pass 'invalid URLs, traversal and duplicate repository names are rejected'
good=$CONFIG; CONFIG=$(jq '.sshHosts.source="-oProxyCommand=bad"' <<<"$CONFIG")
fails validate_config; CONFIG=$good
pass 'SSH aliases cannot inject arguments'
RESPONSE='{"permissions":{"contents":"write","pull_requests":"write","metadata":"read"}}'
check_permissions target
RESPONSE='{"permissions":{"contents":"write","pull_requests":"write","actions":"write"}}'
fails check_permissions target
RESPONSE='{"permissions":{"contents":"read","pull_requests":"write"}}'
fails check_permissions target
pass 'App permissions reject missing and unrelated capabilities'

# Exercise the real HTTP parser without a network request.
curl() { cat >/dev/null; printf '{"message":"Not Found"}\n404'; }
api fake-token GET /missing '' 404
equal "$STATUS" 404; equal "$(jq -r .message <<<"$RESPONSE")" 'Not Found'
fails api fake-token GET /missing
unset -f curl
pass 'HTTP errors are parsed; only explicitly allowed statuses are accepted'

DIR="$ROOT/state"; REPOS="$ROOT/repos"; STATE="$ROOT/api"
mkdir "$REPOS" "$STATE"
ORG_A=OrgA; ORG_B=OrgB; CONTROLLER=OrgB/contribution-controller; SSH_A=github-a; SSH_B=github-b
TOKEN_A=fake-account-a; TOKEN_B=fake-account-b
export GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null
export GIT_AUTHOR_NAME='Original Developer' GIT_AUTHOR_EMAIL=developer@example.invalid
export GIT_COMMITTER_NAME="$GIT_AUTHOR_NAME" GIT_COMMITTER_EMAIL="$GIT_AUTHOR_EMAIL"
declare -A APP=() KEY_PATH=() JWT=()
CONFIG=$(jq '.manual={workflowsReviewed:true,protectionsReviewed:true} |
  .apps.source={clientId:"client-source",privateKeyPath:"source.pem"} |
  .apps.target={clientId:"client-target",privateKeyPath:"target.pem"} |
  .apps.dispatch={clientId:"client-dispatch",privateKeyPath:"dispatch.pem"}' <<<"$CONFIG")
for repo in "$CONTROLLER" OrgA/project-1 OrgA/project-2 OrgB/project-1 OrgB/project-2; do
  mkdir -p "$REPOS/$repo.git" "$STATE/$repo/secrets"
  git -C "$REPOS/$repo.git" init --bare --template= . >/dev/null 2>&1
  printf '{}\n' > "$STATE/$repo/variables.json"
  printf '[]\n' > "$STATE/$repo/pulls.json"
done
for repo in OrgB/project-1 OrgB/project-2; do
  tree=$(printf '' | git -C "$REPOS/$repo.git" mktree)
  sha=$(git -C "$REPOS/$repo.git" commit-tree "$tree" -m "Existing history $repo")
  git -C "$REPOS/$repo.git" update-ref refs/heads/main "$sha"
done
main_ref() { git -C "$REPOS/$1.git" for-each-ref --format='%(objectname)' refs/heads/main; }
remote() { printf '%s/%s.git' "$REPOS" "$1"; }
bridge_git() {
  git -C "$GIT_DIR_WORK" -c "core.hooksPath=$WORK/no-hooks" -c credential.helper= \
    -c protocol.file.allow=always "$@" 2>/dev/null || die "Fixture Git $1 failed"
}
begin_work() { WORK=$(mktemp -d "$DIR/.work.XXXXXX"); mkdir "$WORK/no-hooks"; RESULT_CODE=0; }
check_apps() {
  APP[source]='{"id":1,"slug":"sync"}'; APP[target]='{"id":2,"slug":"transport"}'; APP[dispatch]='{"id":3,"slug":"dispatch"}'
  local kind
  for kind in source target dispatch; do KEY_PATH[$kind]="$ROOT/$kind.pem"; printf 'fixture key\n' > "${KEY_PATH[$kind]}"; done
}
set_secret() {
  local repo=$1 name=$2 key=$3
  [[ -f $key ]] || die 'Missing fixture key'
  # Assert the separation of transport credentials and dispatch credentials.
  if [[ $repo == "$CONTROLLER" ]]; then [[ $name != CONTROLLER_DISPATCH_APP_PRIVATE_KEY ]] || die 'Wrong secret scope'
  else [[ $name == CONTROLLER_DISPATCH_APP_PRIVATE_KEY ]] || die 'Transport key leaked into a code repo'; fi
  printf 'present\n' > "$STATE/$repo/secrets/$name"
}
POLICY=success; JOB_RESULT=success
api() {
  local token=$1 method=$2 path=$3 body=${4-} allowed=${5-}
  local rest repo suffix key vars sha content file id new_pulls
  STATUS=200; RESPONSE=null
  [[ $path == /repos/* ]] || die "Unexpected fixture API path $path"
  rest=${path#/repos/}; repo=${rest%%/*}; rest=${rest#*/}
  repo="$repo/${rest%%/*}"; suffix=${path#"/repos/$repo"}
  file="$REPOS/$repo.git"
  if [[ ! -d $file ]]; then STATUS=404
  elif [[ -z $suffix && $method == GET ]]; then
    RESPONSE=$(jq -cn --arg n "$repo" '{full_name:$n,private:true,fork:false,archived:false,default_branch:"main",permissions:{admin:true}}')
  elif [[ -z $suffix && $method == PATCH ]]; then :
  elif [[ $suffix == /git/ref/heads/* ]]; then
    sha=$(git -C "$file" for-each-ref --format='%(objectname)' "refs/heads/${suffix#/git/ref/heads/}")
    if [[ -n $sha ]]; then RESPONSE=$(jq -cn --arg sha "$sha" '{object:{sha:$sha}}'); else STATUS=404; fi
  elif [[ $suffix == /branches\?* ]]; then
    RESPONSE=$(git -C "$file" for-each-ref --format='%(refname)' refs/heads | jq -Rsc 'split("\n")|map(select(length>0))')
  elif [[ $suffix == /actions/permissions ]]; then RESPONSE='{"enabled":true}'
  elif [[ $suffix == /contents/* ]]; then
    content=${suffix#/contents/}; content=${content%\?ref=main}
    if git -C "$file" cat-file -e "main:$content" 2>/dev/null; then
      content=$(git -C "$file" show "main:$content" | openssl base64 -A)
      RESPONSE=$(jq -cn --arg content "$content" '{type:"file",encoding:"base64",content:$content}')
    else STATUS=404; fi
  elif [[ $suffix == /actions/variables* ]]; then
    vars="$STATE/$repo/variables.json"; key=${suffix#/actions/variables/}
    if [[ $method == GET ]]; then
      if jq -e --arg key "$key" 'has($key)' "$vars" >/dev/null; then RESPONSE=$(jq --arg k "$key" '{value:.[$k]}' "$vars")
      else STATUS=404; fi
    else jq --argjson b "$body" '.+{($b.name):$b.value}' "$vars" > "$vars.tmp"; mv "$vars.tmp" "$vars"; fi
  elif [[ $suffix == /actions/secrets/* ]]; then
    [[ -f $STATE/$repo/secrets/${suffix#/actions/secrets/} ]] || STATUS=404
  elif [[ $suffix == /pulls\?* ]]; then RESPONSE=$(cat "$STATE/$repo/pulls.json")
  elif [[ $suffix == /pulls && $method == POST ]]; then
    id=$(jq 'length+1' "$STATE/$repo/pulls.json")
    RESPONSE=$(jq --arg url "https://github.com/$repo/pull/$id" --argjson id "$id" '.+{id:$id,state:"open",html_url:$url}' <<<"$body")
    jq --argjson p "$RESPONSE" '.+[$p]' "$STATE/$repo/pulls.json" > "$STATE/$repo/pulls.tmp"
    mv "$STATE/$repo/pulls.tmp" "$STATE/$repo/pulls.json"
  elif [[ $suffix == /actions/workflows/controller.yml/dispatches ]]; then
    date -u +%Y-%m-%dT%H:%M:%SZ > "$STATE/dispatched"; STATUS=204
  elif [[ $suffix == /actions/workflows/controller.yml/runs\?* ]]; then
    sha=$(main_ref "$repo")
    if [[ $suffix == *event=push* ]]; then
      RESPONSE=$(jq -cn --arg sha "$sha" --arg result "$POLICY" '{workflow_runs:[{head_sha:$sha,head_branch:"main",conclusion:$result}]}')
    elif [[ -f $STATE/dispatched ]]; then
      RESPONSE=$(jq -cn --arg sha "$sha" --arg date "$(cat "$STATE/dispatched")" \
        '{workflow_runs:[{id:1,head_sha:$sha,head_branch:"main",created_at:$date,status:"completed",conclusion:"success",html_url:"https://github.com/OrgB/controller/actions/runs/1"}]}')
    else RESPONSE='{"workflow_runs":[]}'; fi
  elif [[ $suffix == /actions/runs/1/jobs\?* ]]; then
    RESPONSE=$(jq --arg result "$JOB_RESULT" '{jobs:[.pairs[]|{name:("Reconcile "+.id),conclusion:$result}]}' <<<"$CONFIG")
  else die "Unhandled fixture API: $method $suffix"; fi
  [[ $STATUS == 2?? || " $allowed " == *" $STATUS "* ]] || die "Fixture API: $method $path HTTP $STATUS"
}

begin_work; prepare
equal "$(jq -r .status <<<"$REPORT")" manual-app-installation-required
pass 'prepare accepts existing empty A and only checks the shared controller'
mv "$REPOS/OrgA/project-2.git" "$REPOS/OrgA/missing.git"
fails prepare
mv "$REPOS/OrgA/missing.git" "$REPOS/OrgA/project-2.git"
pass 'missing A is rejected, never created'
before=$(main_ref OrgB/project-1)
begin_work; apply_setup
equal "$(main_ref OrgA/project-1)" "$before"
equal "$(main_ref OrgB/project-1)" "$before"
equal "$(jq 'length' "$STATE/OrgB/project-1/pulls.json")" 1
equal "$(jq 'length' "$STATE/OrgB/project-2/pulls.json")" 1
equal "$(git -C "$REPOS/OrgA/project-1.git" cat-file -p "$before")" \
  "$(git -C "$REPOS/OrgB/project-1.git" cat-file -p "$before")"
pass 'apply preserves original history/identity, shares controller, separates keys and does not change B/main'
begin_work; apply_setup
equal "$(jq 'length' "$STATE/OrgB/project-1/pulls.json")" 1
pass 'repeated apply reuses setup PRs and identical controller'
fails activate
pass 'activate refuses unmerged notifier setup PRs'

# Simulate maintainer B merging each setup PR, using real Git merge commits.
for repo in OrgB/project-1 OrgB/project-2; do
  tree=$(git -C "$REPOS/$repo.git" rev-parse "$SETUP_BRANCH^{tree}")
  sha=$(git -C "$REPOS/$repo.git" commit-tree "$tree" -p main -p "$SETUP_BRANCH" -m 'Maintainer accepted notifier')
  git -C "$REPOS/$repo.git" update-ref refs/heads/main "$sha"
done
POLICY=failure; fails activate; POLICY=success
equal "$(jq -r .BRIDGE_ENABLED "$STATE/$CONTROLLER/variables.json")" false
pass 'policy failure does not enable the bridge'
good=$CONFIG; CONFIG=$(jq '.manual.protectionsReviewed=false' <<<"$CONFIG"); fails activate; CONFIG=$good
pass 'manual protection gate is unchanged'
activate
equal "$(jq -r .status <<<"$REPORT")" dispatched-not-yet-verified
printf '%s\n' "$REPORT" > "$DIR/activate-report.json"
begin_work; verify
equal "$(jq -r .status <<<"$REPORT")" not-ready
equal "$RESULT_CODE" 2
pass 'dispatch is not mistaken for completed reconciliation'
for name in project-1 project-2; do
  git -C "$REPOS/OrgA/$name.git" fetch "$REPOS/OrgB/$name.git" refs/heads/main:refs/heads/main >/dev/null 2>&1
done
JOB_RESULT=skipped; begin_work; verify
equal "$(jq -r .status <<<"$REPORT")" not-ready
JOB_RESULT=success; begin_work; verify
equal "$(jq -r .status <<<"$REPORT")" configuration-and-main-sync-verified
equal "$RESULT_CODE" 0
pass 'verify requires matching mains, notifier on both sides and every matrix job successful'

# Concurrency and divergence: first-create lease cannot replace a new A ref.
git -C "$REPOS/OrgA/project-2.git" update-ref -d refs/heads/main
require_empty() {
  local tree new
  tree=$(printf '' | git -C "$REPOS/OrgA/project-2.git" mktree) || die 'Fixture tree failed'
  new=$(git -C "$REPOS/OrgA/project-2.git" commit-tree "$tree" -m 'Concurrent A commit') || die 'Fixture commit failed'
  git -C "$REPOS/OrgA/project-2.git" update-ref refs/heads/main "$new" || die 'Fixture ref failed'
  printf '%s\n' "$new" > "$ROOT/concurrent"
}
begin_work; fails bootstrap OrgA/project-2 OrgB/project-2
equal "$(main_ref OrgA/project-2)" "$(cat "$ROOT/concurrent")"
pass 'first bootstrap lease never replaces a concurrently created main'
begin_work; fails audit_source OrgA/project-2 OrgB/project-2
pass 'divergent A history stops setup instead of being overwritten'

printf '\n%s shell integration checks passed. GitHub API was mocked; Git operations were real and local.\n' "$PASS"
