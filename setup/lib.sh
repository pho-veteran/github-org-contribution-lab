#!/usr/bin/env bash
# Bash 4+, gh, jq, curl, OpenSSL, Git and OpenSSH. Node 24 tests the controller.
# No eval/source of setup.json. No private key/token in Git, reports or process arguments.

DEFAULT_B_REPOS=(
  https://github.com/TechX-Corp/xora-evaluation-framework
  https://github.com/TechX-Corp/xora-eval-framework-fe
  https://github.com/TechX-Corp/xora-learning-loop
  https://github.com/TechX-Corp/xora-platform
  https://github.com/TechX-Corp/xora-platform-fe
  https://github.com/TechX-Corp/xora-resolve-be
  https://github.com/TechX-Corp/xora-resolve-agent
)
SETUP_HOME=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
TEMPLATES="$SETUP_HOME/../templates"
NOTIFIER_PATH=.github/workflows/notify-controller.yml
SETUP_BRANCH=setup/contribution-bridge

# Native jq.exe must emit LF for Bash read/command substitutions on Git Bash.
case ${OSTYPE:-} in msys*|cygwin*) jq() { command jq -b "$@"; };; esac

die() { printf 'Setup stopped: %s\n' "$*" >&2; exit 1; }
log() { printf '%s\n' "$*"; }
cfg() { jq -er "$1" <<<"$CONFIG"; }
json_ok() { jq -e "$1" >/dev/null <<<"$2" || die "$3"; }
normalize() { sed 's/\r$//'; }
b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }
uri() { jq -rn --arg v "$1" '$v|@uri'; }

validate_config() {
  jq -e '
    def login: type=="string" and test("^[A-Za-z0-9][A-Za-z0-9-]*$");
    def repo: type=="string" and test("^[A-Za-z0-9][A-Za-z0-9-]*/[A-Za-z0-9_.-]+$")
      and (split("/")[1]!="." and split("/")[1]!="..");
    . as $c |
    .version==1 and ([.orgA,.orgB,.accountA,.accountB]|all(login)) and
    ((.orgA|ascii_downcase)!=(.orgB|ascii_downcase)) and
    ([.sshHosts.source,.sshHosts.target]|all(type=="string" and test("^[A-Za-z0-9][A-Za-z0-9_.-]*$"))) and
    (.controller|repo) and (.controller|split("/")[0])==.orgB and
    (.pairs|type=="array" and length>0 and length<=256) and
    (.pairs|all(
      (.id|type=="string" and test("^[a-z0-9][a-z0-9-]{0,62}$")) and
      (.source|repo) and (.target|repo) and
      (.source|split("/")[0])==$c.orgA and (.target|split("/")[0])==$c.orgB and
      (.source|split("/")[1])==(.target|split("/")[1])
    )) and
    ([.pairs[].id]|length==(unique|length)) and
    ([$c.controller, ($c.pairs[]|.source,.target)]|map(ascii_downcase)|length==(unique|length))
  ' >/dev/null <<<"$CONFIG" || die 'Invalid setup.json: check owners, SSH aliases, names, unique ids/repositories and controller'
}


# Bearer headers are passed through stdin, including App JWTs. No token in argv.
api() {
  local token=$1 method=$2 path=$3 body=${4-} allowed=${5-} raw rc=0
  local -a args=(--silent --show-error --globoff --max-time 30 --request "$method" --header @- \
    --header 'Accept: application/vnd.github+json' --header 'X-GitHub-Api-Version: 2022-11-28' \
    --header 'Content-Type: application/json' --write-out $'\n%{http_code}' "https://api.github.com$path")
  # Request bodies here contain only repo/config metadata, never credentials.
  [[ -z $body ]] || args+=(--data-binary "$body")
  raw=$(printf 'Authorization: Bearer %s\n' "$token" | curl "${args[@]}" 2>/dev/null) || rc=$?
  raw=$(printf '%s' "$raw" | normalize)
  STATUS=${raw##*$'\n'}
  [[ $rc == 0 && $STATUS =~ ^[1-5][0-9]{2}$ ]] || die "$method $path: HTTP/network failure (exit $rc)"
  RESPONSE=${raw%$'\n'*}
  [[ -n $RESPONSE ]] || RESPONSE=null
  if [[ $STATUS != 2?? && " $allowed " != *" $STATUS "* ]]; then die "$method $path: HTTP $STATUS"; fi
  jq -e . >/dev/null <<<"$RESPONSE" || [[ $RESPONSE == null ]] || die "Non-JSON response: $path"
}
request() {
  local repo=$1 path=${2-} method=${3:-GET} body=${4-} allowed=${5-} token
  token=$TOKEN_B; [[ ${repo%%/*} == "$ORG_A" ]] && token=$TOKEN_A
  api "$token" "$method" "/repos/$repo$path" "$body" "$allowed"
}
login_accounts() {
  local side account org token
  for side in A B; do
    account=$(cfg ".account$side"); org=$(cfg ".org$side")
    token=$(gh auth token --hostname github.com --user "$account" 2>/dev/null) || die "Log gh into $account"
    api "$token" GET /user
    [[ $(jq -r '.login|ascii_downcase' <<<"$RESPONSE") == "${account,,}" ]] || die "Wrong gh account: $side"
    api "$token" GET "/orgs/$org"
    json_ok '(.type=="Organization")' "$RESPONSE" "Not an organization: $org"
    [[ $(jq -r .login <<<"$RESPONSE") == "$org" ]] || die "Use canonical organization spelling: $(jq -r .login <<<"$RESPONSE")"
    if [[ $side == A ]]; then TOKEN_A=$token; else TOKEN_B=$token; fi
  done
}
read_main() {
  request "$1" /git/ref/heads/main GET '' '404 409'
  MAIN=''; [[ $STATUS != 200 ]] || MAIN=$(jq -er .object.sha <<<"$RESPONSE")
}
require_empty() {
  request "$1" '/branches?per_page=1' GET '' 409
  [[ $STATUS == 409 || $(jq length <<<"$RESPONSE") == 0 ]] || die "Repository has branches but no main: $1"
}
assert_repo() {
  local repo=$1
  jq -e --arg name "$repo" '.full_name==$name and .private and (.fork|not) and
    (.archived|not) and .permissions.admin' >/dev/null <<<"$RESPONSE" ||
    die "Need admin permission and a private, standalone, unarchived repo: $repo"
}
preflight() {
  local require_controller=${1:-true} repo data role
  CONTROLLER_EXISTS=false
  while IFS=$'\t' read -r role repo; do
    request "$repo" '' GET '' 404
    if [[ $STATUS == 404 ]]; then
      [[ $repo == "$CONTROLLER" && $require_controller == false ]] || die "Missing existing repository: $repo"
      continue
    fi
    assert_repo "$repo"; data=$RESPONSE
    [[ $repo != "$CONTROLLER" ]] || CONTROLLER_EXISTS=true
    read_main "$repo"
    if [[ -n $MAIN ]]; then
      [[ $(jq -r .default_branch <<<"$data") == main ]] || die "Default branch must be main: $repo"
    elif [[ $role == B ]]; then die "B/main must already exist: $repo"
    else require_empty "$repo"; fi
    request "$repo" /actions/permissions
    json_ok '.enabled==true' "$RESPONSE" "Actions disabled: $repo"
  done < <(jq -r '(.pairs[]|["B",.target]), ["controller",.controller], (.pairs[]|["A",.source])|@tsv' <<<"$CONFIG")
}
read_file() {
  request "$1" "/contents/$2?ref=main" GET '' 404
  FILE_EXISTS=false; FILE_CONTENT=''
  if [[ $STATUS == 200 ]]; then
    json_ok '.type=="file" and .encoding=="base64"' "$RESPONSE" "Expected a text file: $1/$2"
    FILE_CONTENT=$(jq -r .content <<<"$RESPONSE" | tr -d '\n' | openssl base64 -d -A | normalize)
    FILE_EXISTS=true
  fi
}
read_variable() {
  request "$1" "/actions/variables/$2" GET '' 404
  VALUE=''; VALUE_EXISTS=false
  if [[ $STATUS == 200 ]]; then VALUE=$(jq -r .value <<<"$RESPONSE"); VALUE_EXISTS=true; fi
}
set_variable() {
  local repo=$1 name=$2 value=$3
  read_variable "$repo" "$name"
  [[ $VALUE_EXISTS != true || $VALUE != "$value" ]] || return 0
  local body method=POST suffix=''
  body=$(jq -n --arg name "$name" --arg value "$value" '{name:$name,value:$value}')
  if [[ $VALUE_EXISTS == true ]]; then method=PATCH; suffix="/$name"; fi
  request "$repo" "/actions/variables$suffix" "$method" "$body"
}
set_secret() {
  local repo=$1 name=$2 key=$3 token=$TOKEN_B
  [[ ${repo%%/*} != "$ORG_A" ]] || token=$TOKEN_A
  GH_TOKEN="$token" gh secret set "$name" --repo "$repo" --app actions < "$key" >/dev/null 2>&1 ||
    die "Could not set secret $name at $repo"
}
required_permissions() {
  case $1 in
    source) printf '{"contents":"write","pull_requests":"write","workflows":"write","actions":"read"}' ;;
    target) printf '{"contents":"write","pull_requests":"write"}' ;;
    dispatch) printf '{"actions":"write"}' ;;
  esac
}
check_permissions() {
  jq -e --argjson required "$(required_permissions "$1")" '
    .permissions as $actual |
    ($required|to_entries|all(. as $e | $actual[$e.key]==$e.value)) and
    ($actual|keys|all(. as $k | $k=="metadata" or ($required|has($k))))
  ' >/dev/null <<<"$RESPONSE" || die "Missing or excessive permissions: $1"
}
load_app() {
  local kind=$1 client path now header payload unsigned signature
  client=$(cfg ".apps.$kind.clientId"); path=$(cfg ".apps.$kind.privateKeyPath")
  [[ -n $client && -n $path ]] || die "Fill apps.$kind Client ID and PEM path in setup.json"
  # Git Bash accepts C:/ paths; relative paths are resolved against --dir.
  if command -v cygpath >/dev/null 2>&1; then path=$(cygpath -u -- "$path"); fi
  [[ $path == /* ]] || path="$DIR/$path"
  [[ -r $path ]] || die "Cannot read PEM for $kind"
  KEY_PATH[$kind]=$path
  now=$(date +%s)
  header=$(printf '{"alg":"RS256","typ":"JWT"}' | b64url)
  payload=$(jq -cn --arg iss "$client" --argjson iat "$((now-60))" --argjson exp "$((now+540))" \
    '{iat:$iat,exp:$exp,iss:$iss}' | b64url)
  unsigned="$header.$payload"
  signature=$(printf '%s' "$unsigned" | openssl dgst -sha256 -sign "$path" 2>/dev/null | b64url) ||
    die "Invalid PEM for $kind"
  JWT[$kind]="$unsigned.$signature"
  api "${JWT[$kind]}" GET /app
  [[ $(jq -r .client_id <<<"$RESPONSE") == "$client" ]] || die "App Client ID/key mismatch: $kind"
  check_permissions "$kind"
  APP[$kind]=$(jq -c '{id,slug}' <<<"$RESPONSE")
}
check_installation() {
  local kind=$1 repo=$2 id body visible
  api "${JWT[$kind]}" GET "/repos/$repo/installation"
  jq -e --arg owner "${repo%%/*}" '.account.login==$owner and .repository_selection=="selected" and
    (.suspended_at==null)' >/dev/null <<<"$RESPONSE" || die "Review selected installation: $repo"
  check_permissions "$kind"; id=$(jq -er .id <<<"$RESPONSE")
  if [[ $kind == dispatch ]]; then body='{"permissions":{"metadata":"read"}}'
  else body=$(jq -cn --arg name "${repo#*/}" --argjson p "$(required_permissions "$kind")" '{repositories:[$name],permissions:$p}'); fi
  api "${JWT[$kind]}" POST "/app/installations/$id/access_tokens" "$body"
  PENDING_TOKEN=$(jq -er .token <<<"$RESPONSE")
  api "$PENDING_TOKEN" GET '/installation/repositories?per_page=100'
  visible=$RESPONSE
  api "$PENDING_TOKEN" DELETE /installation/token
  PENDING_TOKEN=''
  jq -e --arg repo "$repo" '.total_count==1 and (.repositories|length)==1 and .repositories[0].full_name==$repo' \
    >/dev/null <<<"$visible" || die "Installation/token scope must be exactly $repo"
}
check_apps() {
  local kind source target ids
  for kind in source target dispatch; do load_app "$kind"; done
  ids=$(printf '%s\n' "${APP[source]}" "${APP[target]}" "${APP[dispatch]}" | jq -s '[.[].id]|unique|length')
  [[ $ids == 3 ]] || die 'Use three distinct Apps'
  while IFS=$'\t' read -r source target; do
    check_installation source "$source"; check_installation target "$target"
  done < <(jq -r '.pairs[]|[.source,.target]|@tsv' <<<"$CONFIG")
  check_installation dispatch "$CONTROLLER"
}
registry_json() {
  jq --arg sb "$(jq -r .slug <<<"${APP[source]}")[bot]" --arg tb "$(jq -r .slug <<<"${APP[target]}")[bot]" \
    '{controllerRepo:.controller,bot:$tb,sourceBot:$sb,pairs:.pairs}' <<<"$CONFIG"
}
render_notifier() {
  local source=$1 target=$2
  # Repository/owner names were validated before substitution (no sed metacharacters).
  sed -e "s/A_OWNER/${source%%/*}/g" -e "s/A_REPO/${source#*/}/g" \
    -e "s/B_OWNER/${target%%/*}/g" -e "s/B_REPO/${target#*/}/g" \
    -e "s/CONTRIBUTION_BRANCH/main/g" -e "s/CONTROLLER_REPO/${CONTROLLER#*/}/g" "$TEMPLATES/notifier/$NOTIFIER_PATH" | normalize
}
remote() {
  local host=$SSH_B; [[ ${1%%/*} != "$ORG_A" ]] || host=$SSH_A
  printf 'git@%s:%s.git' "$host" "$1"
}
bridge_git() {
  git -C "$GIT_DIR_WORK" -c "core.hooksPath=$WORK/no-hooks" -c credential.helper= \
    -c protocol.file.allow=never "$@" 2>/dev/null || die "Git $1 failed; check SSH/protection/history"
}
new_git() {
  GIT_DIR_WORK=$(mktemp -d "$WORK/git.XXXXXX")
  bridge_git init --bare --template= . >/dev/null
}
check_ssh() {
  local repo
  new_git
  while read -r repo; do bridge_git ls-remote "$(remote "$repo")" >/dev/null; done \
    < <(jq -r '.controller, (.pairs[]|.source,.target)' <<<"$CONFIG")
}
audit_source() {
  local source=$1 target=$2
  read_main "$source"; [[ -n $MAIN ]] || return 0
  new_git
  bridge_git fetch --no-tags "$(remote "$source")" refs/heads/main:refs/heads/source
  bridge_git fetch --no-tags "$(remote "$target")" refs/heads/main:refs/heads/target
  bridge_git merge-base --is-ancestor source target
}
bootstrap() {
  local source=$1 target=$2 sha
  read_main "$source"; [[ -z $MAIN ]] || return 0
  require_empty "$source"; new_git
  bridge_git fetch --no-tags "$(remote "$target")" refs/heads/main:refs/heads/base
  sha=$(bridge_git rev-parse base)
  bridge_git push --force-with-lease=refs/heads/main: "$(remote "$source")" refs/heads/base:refs/heads/main
  read_main "$source"; [[ $MAIN == "$sha" ]] || die "Bootstrap SHA mismatch: $source"
  request "$source" '' PATCH '{"default_branch":"main"}'
}
deploy_controller() {
  local existing tree blob path sha
  read_main "$CONTROLLER"; existing=$MAIN
  new_git
  if [[ -n $existing ]]; then bridge_git fetch --no-tags "$(remote "$CONTROLLER")" refs/heads/main:refs/heads/base
  else require_empty "$CONTROLLER"; fi
  bridge_git read-tree --empty
  mkdir "$WORK/controller-files"
  cp -R "$TEMPLATES/controller/." "$WORK/controller-files/"
  registry_json > "$WORK/controller-files/bridge.config.json"
  sed "s|B_OWNER/CONTROLLER_REPO|$CONTROLLER|g" "$TEMPLATES/controller/.github/workflows/controller.yml" |
    normalize > "$WORK/controller-files/.github/workflows/controller.yml"
  [[ -z $(find "$WORK/controller-files" -type l -print) ]] || die 'Symlinks are not allowed in controller templates'
  while IFS= read -r -d '' path; do
    blob=$(normalize < "$path" | bridge_git hash-object -w --stdin)
    bridge_git update-index --add --cacheinfo "100644,$blob,${path#"$WORK/controller-files/"}"
  done < <(find "$WORK/controller-files" -type f -print0)
  tree=$(bridge_git write-tree)
  if [[ -n $existing ]]; then
    [[ $(bridge_git rev-parse 'base^{tree}') == "$tree" ]] || die 'Existing controller differs; review/deploy changes manually. No overwrite'
    CONTROLLER_SHA=$(bridge_git rev-parse base)
  else
    sha=$(bridge_git commit-tree "$tree" -m 'Configure multi-repository contribution bridge')
    bridge_git push --force-with-lease=refs/heads/main: "$(remote "$CONTROLLER")" "$sha:refs/heads/main"
    request "$CONTROLLER" '' PATCH '{"default_branch":"main"}'
    CONTROLLER_SHA=$sha
  fi
}
install_notifier() {
  local source=$1 target=$2 expected old base blob tree sha pulls url
  expected=$(render_notifier "$source" "$target")
  read_file "$target" "$NOTIFIER_PATH"
  if [[ $FILE_EXISTS == true && $FILE_CONTENT == "$expected" ]]; then
    NOTIFIER_RESULT=$(jq -cn --arg repo "$target" '{repo:$repo,status:"installed"}'); return
  fi
  [[ $FILE_EXISTS == false ]] || die "Existing notifier differs: $target. No overwrite"
  new_git
  bridge_git fetch --no-tags "$(remote "$target")" refs/heads/main:refs/heads/base
  if [[ -n $(bridge_git ls-tree -r --name-only base -- "$NOTIFIER_PATH") ]]; then
    [[ $(bridge_git show "base:$NOTIFIER_PATH" | normalize) == "$expected" ]] || die "Notifier changed during setup: $target"
    NOTIFIER_RESULT=$(jq -cn --arg repo "$target" '{repo:$repo,status:"installed"}'); return
  fi
  request "$target" "/git/ref/heads/$SETUP_BRANCH" GET '' 404
  if [[ $STATUS == 200 ]]; then
    bridge_git fetch --no-tags "$(remote "$target")" "refs/heads/$SETUP_BRANCH:refs/heads/notifier"
    [[ $(bridge_git show "notifier:$NOTIFIER_PATH" | normalize) == "$expected" ]] || die "Different notifier in $SETUP_BRANCH"
    base=$(bridge_git merge-base base notifier)
    [[ $(bridge_git diff --name-only "$base" notifier) == "$NOTIFIER_PATH" ]] || die 'Setup branch has unrelated changes'
  else
    bridge_git read-tree base
    blob=$(printf '%s\n' "$expected" | bridge_git hash-object -w --stdin)
    bridge_git update-index --add --cacheinfo "100644,$blob,$NOTIFIER_PATH"
    tree=$(bridge_git write-tree); sha=$(bridge_git commit-tree "$tree" -p base -m 'Configure contribution bridge notifier')
    bridge_git push "--force-with-lease=refs/heads/$SETUP_BRANCH:" "$(remote "$target")" "$sha:refs/heads/$SETUP_BRANCH"
  fi
  request "$target" "/pulls?state=all&head=$(uri "$ORG_B:$SETUP_BRANCH")&base=main&per_page=100"
  pulls=$RESPONSE; url=$(jq -r '[.[]|select(.state=="open")][0].html_url // empty' <<<"$pulls")
  if [[ -z $url ]]; then
    [[ $(jq length <<<"$pulls") == 0 ]] || die "Setup PR was closed at $target; maintainer must reopen/reconcile it"
    request "$target" /pulls POST "$(jq -n --arg head "$SETUP_BRANCH" --arg body \
      "Configure $source -> $target using $CONTROLLER. Only $NOTIFIER_PATH changes. Review permissions and repository guards, then merge as maintainer B. Setup does not merge automatically; no credentials are committed." \
      '{title:"[Setup] Configure contribution bridge notifier",head:$head,base:"main",body:$body}')"
    url=$(jq -er .html_url <<<"$RESPONSE")
  fi
  NOTIFIER_RESULT=$(jq -cn --arg repo "$target" --arg url "$url" '{repo:$repo,status:"review-required",url:$url}')
}
check_credentials() {
  local kind prefix repo source target client
  for kind in source target; do
    prefix=SOURCE; [[ $kind == source ]] || prefix=BRIDGE
    read_variable "$CONTROLLER" "${prefix}_APP_CLIENT_ID"
    [[ $VALUE == "$(cfg ".apps.$kind.clientId")" && -n $VALUE ]] || die "Wrong controller Client ID: $kind"
    request "$CONTROLLER" "/actions/secrets/${prefix}_APP_PRIVATE_KEY"
  done
  client=$(cfg '.apps.dispatch.clientId')
  while read -r repo; do
    read_variable "$repo" CONTROLLER_DISPATCH_APP_CLIENT_ID
    [[ -n $client && $VALUE == "$client" ]] || die "Wrong Dispatch Client ID: $repo"
    request "$repo" /actions/secrets/CONTROLLER_DISPATCH_APP_PRIVATE_KEY
  done < <(jq -r '.pairs[]|.source,.target' <<<"$CONFIG")
}
same_json() { [[ $(jq -Sc . <<<"$1") == "$(jq -Sc . <<<"$2")" ]]; }
reconcile_status() {
  RUN='{"status":"no-local-activation-report","allPairsSucceeded":false}'
  [[ -f $DIR/activate-report.json ]] || return 0
  local since runs row run_id jobs page batch
  # Accept both the previous Node ISO milliseconds and the Bash seconds format.
  since=$(jq -er '.dispatchedAt|sub("\\.[0-9]+Z$";"Z")|fromdateiso8601' "$DIR/activate-report.json")
  read_main "$CONTROLLER"
  request "$CONTROLLER" "/actions/workflows/controller.yml/runs?event=workflow_dispatch&head_sha=$MAIN&per_page=100"
  runs=$(jq -c --arg sha "$MAIN" --argjson since "$since" \
    '.workflow_runs[]|select(.head_sha==$sha and .head_branch=="main" and ((.created_at|fromdateiso8601)>=$since))' <<<"$RESPONSE")
  RUN='{"status":"waiting-for-all-pairs-run","allPairsSucceeded":false}'
  while read -r row; do
    [[ -n $row ]] || continue
    run_id=$(jq -r .id <<<"$row"); jobs='[]'; page=1
    while :; do
      request "$CONTROLLER" "/actions/runs/$run_id/jobs?per_page=100&page=$page"
      batch=$(jq -c .jobs <<<"$RESPONSE"); jobs=$(jq --argjson b "$batch" '.+$b' <<<"$jobs")
      [[ $(jq length <<<"$batch") == 100 ]] || break
      page=$((page+1))
    done
    if jq -e --argjson jobs "$jobs" '.pairs|all(. as $p | $jobs|any(.name==("Reconcile "+$p.id)))' >/dev/null <<<"$CONFIG"; then
      RUN=$(jq --argjson jobs "$jobs" --argjson pairs "$(jq .pairs <<<"$CONFIG")" \
        '{url:.html_url,conclusion,status,allPairsSucceeded:($pairs|all(. as $p|$jobs|any(.name==("Reconcile "+$p.id) and .conclusion=="success")))}' <<<"$row")
      return
    fi
  done <<<"$runs"
}
cleanup() {
  local code=$?
  trap - EXIT INT TERM
  if [[ -n ${PENDING_TOKEN:-} ]]; then
    GH_TOKEN="$PENDING_TOKEN" gh api --hostname github.com --method DELETE installation/token >/dev/null 2>&1 ||
      { printf 'Warning: could not revoke preflight token; it will expire.\n' >&2; code=1; }
  fi
  if [[ -n ${WORK:-} && ${WORK%/*} == "$DIR" && ${WORK##*/} == .work.* && ! -L $WORK ]]; then rm -rf -- "$WORK"; fi
  [[ ${LOCK_OWNED:-false} != true ]] || rm -f -- "$DIR/setup.lock"
  exit "$code"
}
usage() {
  cat <<'HELP'
Usage:
  bash setup/01-init.sh --org-a ORG_A --account-a ADMIN_A --account-b ADMIN_B --ssh-a SSH_A --ssh-b SSH_B --dir .bridge-setup [--repos repos-b.txt] [--controller contribution-controller]
  bash setup/02-prepare.sh --dir .bridge-setup
  bash setup/03-apply.sh --dir .bridge-setup
  bash setup/04-activate.sh --dir .bridge-setup
  bash setup/05-verify.sh --dir .bridge-setup
Defaults: seven TechX-Corp B repositories; A already exists with the same names.
init is local; prepare creates only controller; apply bootstraps/configures and opens PRs.
activate dispatches; verify requires a successful reconciliation, not just a dispatch.
Existing setup.json remains compatible. Git uses SSH; API/secrets use the two gh accounts.
HELP
}
run_stage() {
  set +x
  set -euo pipefail
  umask 077
  [[ ${BASH_VERSINFO[0]} -ge 4 ]] || die 'Use Bash 4+ (Git Bash, Linux, or a recent Bash on macOS)'
  MODE=$1; shift
  [[ $# -gt 0 && $1 != --help ]] || { usage; return; }
  case $MODE in init|prepare|apply|activate|verify) ;; *) die "Unknown command: $MODE";; esac
  declare -gA OPT=() APP=() JWT=() KEY_PATH=()
  local key command_name
  while [[ $# -gt 0 ]]; do
    [[ $# -ge 2 && $1 == --* && $2 != --* ]] || die 'Options need values'
    key=$1; [[ ! -v OPT[$key] ]] || die "Duplicate option: $key"
    case $key in --dir) ;; --repos|--org-a|--account-a|--account-b|--controller|--ssh-a|--ssh-b)
      [[ $MODE == init ]] || die "$key is only used with init";; *) die "Unknown option: $key";; esac
    OPT[$key]=$2; shift 2
  done
  [[ -n ${OPT[--dir]-} ]] || die '--dir is required'
  DIR=${OPT[--dir]}
  for command_name in jq openssl; do command -v "$command_name" >/dev/null || die "Install $command_name"; done
  if [[ $MODE == init ]]; then
    for key in --org-a --account-a --account-b --ssh-a --ssh-b; do [[ -n ${OPT[$key]-} ]] || die "$key is required"; done
    init_config; return
  fi
  [[ -f $DIR/setup.json ]] || die 'Run init first'
  DIR=$(cd -- "$DIR" && pwd -P)
  CONFIG=$(cat "$DIR/setup.json"); validate_config
  ORG_A=$(cfg .orgA); ORG_B=$(cfg .orgB); CONTROLLER=$(cfg .controller)
  SSH_A=$(cfg .sshHosts.source); SSH_B=$(cfg .sshHosts.target)
  for command_name in git gh ssh curl; do command -v "$command_name" >/dev/null || die "Install $command_name"; done
  # Ignore ambient account overrides and Git hooks/config; explicitly select credentials.
  unset GH_TOKEN GITHUB_TOKEN GH_ENTERPRISE_TOKEN GITHUB_ENTERPRISE_TOKEN GH_DEBUG
  while read -r key; do unset "$key"; done < <(compgen -v GIT_ || true)
  export GH_HOST=github.com GH_PROMPT_DISABLED=1 GIT_TERMINAL_PROMPT=0 GCM_INTERACTIVE=Never
  export GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null
  export GIT_SSH_COMMAND='ssh -o BatchMode=yes -o StrictHostKeyChecking=yes'
  export GIT_AUTHOR_NAME='Contribution bridge setup' GIT_AUTHOR_EMAIL=bridge-setup@users.noreply.github.com
  export GIT_COMMITTER_NAME="$GIT_AUTHOR_NAME" GIT_COMMITTER_EMAIL="$GIT_AUTHOR_EMAIL"
  LOCK_OWNED=false; WORK=''; PENDING_TOKEN=''; RESULT_CODE=0
  (set -o noclobber; printf '{"pid":%s,"command":"%s"}\n' "$$" "$MODE" > "$DIR/setup.lock") 2>/dev/null ||
    die 'setup.lock exists; confirm no setup is running before removing a stale lock'
  LOCK_OWNED=true
  trap cleanup EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  WORK=$(mktemp -d "$DIR/.work.XXXXXX"); mkdir "$WORK/no-hooks"
  login_accounts
  case $MODE in prepare) prepare;; apply) apply_setup;; activate) activate;; verify) verify;; esac
  printf '%s\n' "$REPORT" | jq . > "$DIR/$MODE-report.json"
  cat "$DIR/$MODE-report.json"
  exit "$RESULT_CODE"
}
