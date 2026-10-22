# Triển khai bridge: chỉ nhận PR vào dev, bao gồm thay đổi workflow

Luồng: **XBrain PR vào dev → notifier → controller → TechX PR vào dev → bot trả link về XBrain**. PR vào main hoặc nhánh khác không dispatch, kể cả khi có comment/review. Push ở TechX vẫn notify để mirror tất cả nhánh về XBrain; giữ các nhánh riêng ở XBrain.

## Phạm vi và code mẫu public

Tài liệu này chứa trực tiếp YAML, thay đổi controller và cấu hình quyền cần triển khai; không cần tải file đính kèm. Áp dụng cho controller hiện tại **đã có content preservation và all-branch reconciliation**. Giữ nguyên phần bảo toàn PR body/review đang chạy.

Code mẫu public để đối chiếu vị trí sửa:

- [Controller xử lý PR — scripts/pr-bridge.mjs](https://github.com/pho-veteran/xora-contribution-controller/blob/ad8330c43909277144e5368b1ee48ed21ff3bb9c/scripts/pr-bridge.mjs).
- [Policy — scripts/pr-bridge-policy.mjs](https://github.com/pho-veteran/xora-contribution-controller/blob/ad8330c43909277144e5368b1ee48ed21ff3bb9c/scripts/pr-bridge-policy.mjs).
- [Workflow controller — .github/workflows/controller.yml](https://github.com/pho-veteran/xora-contribution-controller/blob/ad8330c43909277144e5368b1ee48ed21ff3bb9c/.github/workflows/controller.yml).
- [Mirror các nhánh B → A — scripts/branch-sync.mjs](https://github.com/pho-veteran/xora-contribution-controller/blob/ad8330c43909277144e5368b1ee48ed21ff3bb9c/scripts/branch-sync.mjs).

Các link được ghim theo revision để đối chiếu ổn định. **Bản public được liên kết vẫn dùng PR base main và còn chặn thay đổi workflow**; áp dụng phần sửa bên dưới vào controller hiện tại, không chép đè bản public cũ lên phần content preservation đã triển khai.

## 1. Notifier trên repo sản phẩm

Dùng **toàn bộ YAML ngay dưới đây**, thay tất cả `REPO_NAME` bằng tên repo tương ứng. Mẫu gốc để đối chiếu: [notifier trên GitHub public](https://github.com/pho-veteran/github-org-contribution-lab/blob/87e2472e9c153b537be78f1994bb1a55eedb1e50/templates/notifier/.github/workflows/notify-controller.yml). Cập nhật `.github/workflows/notify-controller.yml` trên **main và dev** phía TechX rồi để bot sync về XBrain.

Bản trên **default branch main bắt buộc phải có**: GitHub lấy workflow `pull_request_target` từ default branch dù PR target dev. [Tài liệu thay đổi của GitHub](https://github.blog/changelog/2025-11-07-actions-pull_request_target-and-environment-branch-protections-changes/).

Các điểm cần giữ:

- `pull_request_target.branches: [dev]` và guard `github.event.pull_request.base.ref == 'dev'`.
- Event comment không chứa base branch: bước `scope` đọc PR qua API, chỉ cho qua nếu base hiện tại là dev và head cùng repo. Áp dụng kiểm tra này cho cả event PR/review.
- Token repo dùng `permissions: { pull-requests: read }` để đọc PR. Cả bước tạo App token và dispatch chỉ chạy khi `steps.scope.outputs.allowed == 'true'`.
- Giữ event edited/deleted để preserve nội dung; giữ push mọi nhánh **chỉ ở TechX**. Controller luôn được dispatch trên ref main.
- Cập nhật feature branch cũ từ dev mới nếu còn mang notifier cũ: event review có thể sử dụng workflow theo revision PR.

Trên mỗi repo sản phẩm chạy notifier, giữ/cấu hình variable `CONTROLLER_DISPATCH_APP_CLIENT_ID` và secret `CONTROLLER_DISPATCH_APP_PRIVATE_KEY` (có thể cấp từ org cho đúng repo). App này cần installation có **Actions: Read and write** trên `TechX-Corp/xora-contribution-controller`. Nếu controller thực tế có owner/tên khác, thay đồng nhất owner, repositories, URL dispatch và tên controller trong YAML.

Comment trên PR ngoài dev vẫn có thể tạo run kiểm tra scope thành công, nhưng bước tạo App token và dispatch phải skipped.

<details>
<summary>Workflow đầy đủ — thay REPO_NAME trước khi dùng</summary>

```yaml
name: Notify contribution bridge
on:
  push:
    branches: ['**']
  pull_request_target:
    branches: [dev]
    types: [opened, synchronize, reopened, closed, ready_for_review, edited]
  issue_comment:
    types: [created, edited, deleted]
  pull_request_review:
    types: [submitted, edited, dismissed]
  pull_request_review_comment:
    types: [created, edited, deleted]

permissions:
  pull-requests: read

concurrency:
  group: notify-${{ github.event_name }}-${{ github.event.pull_request.number || github.event.issue.number || github.ref }}
  cancel-in-progress: false

jobs:
  notify:
    if: >-
      (github.repository == 'XBrainVN/REPO_NAME' || github.repository == 'TechX-Corp/REPO_NAME') &&
      (
        (github.event_name == 'push' && github.repository == 'TechX-Corp/REPO_NAME' && startsWith(github.ref, 'refs/heads/')) ||
        (github.event.sender.type == 'User' &&
          (
            (github.event_name == 'issue_comment' && github.event.issue.pull_request) ||
            ((github.event_name == 'pull_request_target' || github.event_name == 'pull_request_review' || github.event_name == 'pull_request_review_comment') &&
              github.event.pull_request.base.ref == 'dev' && github.event.pull_request.head.repo.full_name == github.repository)
          )
        )
      )
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - name: Allow only dev PR events or TechX branch pushes
        id: scope
        env:
          GH_TOKEN: ${{ github.token }}
          SOURCE_REPO: ${{ github.repository }}
          SOURCE_EVENT: ${{ github.event_name }}
          SOURCE_PR: ${{ github.event.pull_request.number || github.event.issue.number || '' }}
        run: |
          node --input-type=module <<'NODE'
          import { appendFileSync } from 'node:fs';
          const { GH_TOKEN, SOURCE_REPO: repo, SOURCE_EVENT: event, SOURCE_PR: number } = process.env;
          let allowed = false;
          if (event === 'push') {
            allowed = repo === 'TechX-Corp/REPO_NAME';
          } else {
            if (!/^[1-9][0-9]*$/.test(number)) throw new Error('Invalid PR number');
            const response = await fetch(`https://api.github.com/repos/${repo}/pulls/${number}`, {
              headers: { Authorization: `Bearer ${GH_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
              signal: AbortSignal.timeout(30000),
            });
            if (!response.ok) throw new Error(`Cannot check current PR target: HTTP ${response.status}`);
            const pr = await response.json();
            allowed = pr.base.ref === 'dev' && pr.head.repo?.full_name === repo;
          }
          appendFileSync(process.env.GITHUB_OUTPUT, `allowed=${allowed}\n`);
          if (!allowed) console.log('No dispatch: PR must target dev and have a head in this repository.');
          NODE
      # No checkout, PR code, dependencies, or interpolated comment text in this job.
      - name: Token scoped only to controller Actions
        if: steps.scope.outputs.allowed == 'true'
        uses: actions/create-github-app-token@64ab729a6294000f5aa4a4bc0b73d1f32bc45510
        id: dispatch
        with:
          client-id: ${{ vars.CONTROLLER_DISPATCH_APP_CLIENT_ID }}
          private-key: ${{ secrets.CONTROLLER_DISPATCH_APP_PRIVATE_KEY }}
          owner: TechX-Corp
          repositories: xora-contribution-controller
          permission-actions: write
      - name: Dispatch trusted controller main
        if: steps.scope.outputs.allowed == 'true'
        env:
          DISPATCH_TOKEN: ${{ steps.dispatch.outputs.token }}
          SOURCE_REPO: ${{ github.repository }}
          SOURCE_SHA: ${{ github.sha }}
          SOURCE_RUN_ID: ${{ github.run_id }}
          SOURCE_EVENT: ${{ github.event_name }}
          SOURCE_PR: ${{ github.event.pull_request.number || github.event.issue.number || '' }}
        run: |
          node --input-type=module <<'NODE'
          import { appendFileSync } from 'node:fs';
          const { SOURCE_REPO: repo, SOURCE_SHA: sha, SOURCE_RUN_ID: runId, SOURCE_EVENT: event, SOURCE_PR: pr } = process.env;
          if (!['XBrainVN/REPO_NAME', 'TechX-Corp/REPO_NAME'].includes(repo)
            || !/^[a-f0-9]{40}$/.test(sha) || !/^[1-9][0-9]*$/.test(runId)
            || !['push','pull_request_target','issue_comment','pull_request_review','pull_request_review_comment'].includes(event)
            || (event === 'push' ? repo !== 'TechX-Corp/REPO_NAME' || Boolean(pr) : !/^[1-9][0-9]*$/.test(pr))) throw new Error('Invalid source event');
          const response = await fetch('https://api.github.com/repos/TechX-Corp/xora-contribution-controller/actions/workflows/controller.yml/dispatches', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${process.env.DISPATCH_TOKEN}`,
              Accept: 'application/vnd.github+json',
              'Content-Type': 'application/json',
              'X-GitHub-Api-Version': '2022-11-28',
            },
            body: JSON.stringify({ ref: 'main', inputs: {
              source_repo: repo, source_sha: sha, source_run_id: runId, source_event: event, source_pr: pr,
            } }),
            signal: AbortSignal.timeout(30000),
          });
          if (!response.ok) throw new Error(`Controller dispatch failed: HTTP ${response.status}`);
          appendFileSync(process.env.GITHUB_STEP_SUMMARY, `# Contribution event dispatched\n\nSource: ${repo} / ${event}${pr ? ` / PR #${pr}` : ''}\n\nEvent SHA: \`${sha}\`\n\nController: TechX-Corp/xora-contribution-controller / controller.yml / main\n\nSource run: https://github.com/${repo}/actions/runs/${runId}\n\nDispatch accepted: HTTP ${response.status}. Inspect the controller run for the reconciliation result.\n`);
          NODE
```

</details>

## 2. Controller chỉ xử lý PR dev

Sửa hai file `scripts/pr-bridge.mjs` và `scripts/pr-bridge-policy.mjs` trên controller/main theo diff đầy đủ dưới đây. Dòng `-` là code cũ, dòng `+` là code thay thế; không cần file patch riêng. Diff dựa trên controller đã có content preservation (hàm `syncPairContent`), đúng phạm vi cập nhật hiện tại.

Nếu controller đã có toàn bộ logic dev-only, chỉ cần mục 3 và 4. Với controller chưa có dev-only, áp dụng diff này và mục 4; diff đã bao gồm việc bỏ guard ở mục 3.

Các thay đổi phải đi cùng nhau: lọc PR dev; kiểm tra lại target/head trước khi push; tạo PR B vào dev; kiểm tra accepted history bằng B/dev; chỉ đóng PR A sau khi B/dev đã mirror về A/dev. Thiếu dev phải báo lỗi, không fallback sang main. Giữ nguyên luồng mirror main và các nhánh B → A; không thay toàn bộ chuỗi `main` trong repo thành `dev`.

<details>
<summary>Diff đầy đủ cho logic PR dev và bỏ guard workflow</summary>

```diff
diff --git a/scripts/pr-bridge-policy.mjs b/scripts/pr-bridge-policy.mjs
index cea0441..bc35a13 100644
--- a/scripts/pr-bridge-policy.mjs
+++ b/scripts/pr-bridge-policy.mjs
@@ -34,8 +34,8 @@ export function notificationMetadata({ source, target, repo, sha, runId, event,
 
 export function pairDecision({ merged, closed, sourceClosed, headIncluded, mergeResultIncluded, sourceHead, mergedHead, sourceIncludedInBHead }) {
   if (merged) {
-    if (!mergeResultIncluded) return 'merge-result-not-in-main';
-    // Identity requires the original commits in main, not just equivalent changes.
+    if (!mergeResultIncluded) return 'merge-result-not-in-dev';
+    // Identity requires the original commits in dev, not just equivalent changes.
     const exactRevision = /^[a-f0-9]{40}$/.test(sourceHead ?? '') && sourceHead === mergedHead;
     if (headIncluded) return 'accepted';
     return exactRevision || sourceIncludedInBHead ? 'identity-not-preserved' : 'new-commits-pending';
@@ -49,7 +49,7 @@ export function assertMutation({ repo, source, target, path, method, body }) {
   if (![source, target].includes(repo)) throw new Error('Repository outside bridge scope');
   if (method === 'GET') return;
   const createPR = repo === target && method === 'POST' && path === '/pulls'
-    && body.base === 'main' && /^incoming\/a-pr-[1-9][0-9]*$/.test(body.head);
+    && body.base === 'dev' && /^incoming\/a-pr-[1-9][0-9]*$/.test(body.head);
   const editPR = repo === source && method === 'PATCH' && /^\/pulls\/[1-9][0-9]*$/.test(path)
     && Object.keys(body).length === 1 && body.state === 'closed';
   const comment = ((method === 'POST' && /^\/issues\/[1-9][0-9]*\/comments$/.test(path))
diff --git a/scripts/pr-bridge.mjs b/scripts/pr-bridge.mjs
index 7def8fe..4cdd5bc 100644
--- a/scripts/pr-bridge.mjs
+++ b/scripts/pr-bridge.mjs
@@ -137,7 +137,7 @@ async function run() {
     if (n && !prs.has(n)) prs.set(n, await api(source, `/pulls/${n}`));
   }
   for (const initial of prs.values()) {
-    if (initial.base.ref !== 'main' || initial.head.repo?.full_name !== source) continue;
+    if (initial.base.ref !== 'dev' || initial.head.repo?.full_name !== source) continue;
     let a = initial, b;
     try {
     const marker = `<!-- b-authoritative-bridge:${source}#${initial.number} -->`;
@@ -151,25 +151,31 @@ async function run() {
     b = matches[0];
     if (!b && initial.state !== 'open') continue;
     a = await api(source, `/pulls/${initial.number}`);
+    if (a.base.ref !== 'dev' || a.head.repo?.full_name !== source) {
+      report.pairs.push({ a: a.number, state: 'skipped-non-dev' }); continue;
+    }
+    git(['fetch', '--no-tags', bUrl, '+refs/heads/dev:refs/remotes/bridge/b-dev'], targetToken);
+    const bDevSha = requireSha(git(['rev-parse', 'refs/remotes/bridge/b-dev']).text);
+    if ((await api(target, '/git/ref/heads/dev')).object.sha !== bDevSha) throw new Error('B/dev changed during fetch; retry');
     if (a.draft && !b) continue;
     if (b) b = await api(target, `/pulls/${b.number}`);
-    if (b && (b.base.ref !== 'main' || b.head.ref !== `incoming/a-pr-${a.number}` || b.head.repo?.full_name !== target)) throw new Error('PR pair refs no longer match bridge policy');
+    if (b && (b.base.ref !== 'dev' || b.head.ref !== `incoming/a-pr-${a.number}` || b.head.repo?.full_name !== target)) throw new Error('PR pair refs no longer match bridge policy');
     let reviews = b ? await syncPairContent(a, b) : [];
     const aHead = requireSha(a.head.sha);
     git(['fetch', '--no-tags', aUrl, `refs/pull/${a.number}/head`], sourceToken);
     const fetched = git(['rev-parse', 'FETCH_HEAD']).text;
     if (fetched !== aHead) { report.pairs.push({ a: a.number, state: 'source-changed-retry' }); continue; }
-    const included = ancestor(aHead, bSha);
+    const included = ancestor(aHead, bDevSha);
     if (b) {
       git(['fetch', '--no-tags', bUrl, `refs/pull/${b.number}/head`], targetToken);
       if (git(['rev-parse', 'FETCH_HEAD']).text !== b.head.sha) {
         report.pairs.push({ a: a.number, b: b.number, state: 'target-changed-retry' }); continue;
       }
       const sourceIncludedInBHead = ancestor(aHead, b.head.sha);
-      // If a merge happened after our B/main snapshot, defer closure until the next run.
+      // If a merge happened after our B/dev snapshot, defer closure until the next run.
       const mergeResultIncluded = Boolean(b.merged_at) && shaPattern.test(b.merge_commit_sha ?? '')
         && git(['cat-file', '-e', `${b.merge_commit_sha}^{commit}`], null, [0, 1, 128]).status === 0
-        && ancestor(b.merge_commit_sha, bSha);
+        && ancestor(b.merge_commit_sha, bDevSha);
       const decision = pairDecision({
         merged: Boolean(b.merged_at), closed: b.state === 'closed', sourceClosed: a.state === 'closed',
         headIncluded: included, mergeResultIncluded, sourceHead: aHead, mergedHead: b.head.sha, sourceIncludedInBHead,
@@ -180,52 +186,60 @@ async function run() {
         if (decision === 'source-closed') {
           await statusComment(b.number, `A PR #${a.number} is closed${a.merged_at ? ' (merged at A outside the contribution flow)' : ''}. B still decides whether this contribution is accepted or rejected. This bot will not close or reopen this B PR. Reopen A if further contribution is needed.`, target, a.number);
         }
+        if (decision === 'accepted') {
+          // Acceptance is based on dev, never main; copy accepted B/dev before closing A.
+          const branches = await syncBranches({ source, target, sourceToken, targetToken, git, api, list, ancestor });
+          if (branches.some(row => row.branch === 'dev' && ['error', 'deferred-open-pr'].includes(row.state))
+            || (await api(target, '/git/ref/heads/dev')).object.sha !== bDevSha
+            || (await api(source, '/git/ref/heads/dev')).object.sha !== bDevSha) {
+            throw new Error('Accepted B/dev is not synchronized to A/dev; retry before closing source PR');
+          }
+        }
         const message = decision === 'accepted'
-          ? `Accepted in [B PR #${b.number}](${b.html_url}).\n\nB merge result: \`${b.merge_commit_sha}\`, verified in B/main and synchronized to A/main.\n\nOriginal source head \`${aHead}\` is included in accepted history; original commit identities are preserved.\n\nNo independent merge was performed at A.`
+          ? `Accepted in [B PR #${b.number}](${b.html_url}).\n\nB merge result: \`${b.merge_commit_sha}\`, verified in B/dev and synchronized to A/dev.\n\nOriginal source head \`${aHead}\` is included in accepted history; original commit identities are preserved.\n\nNo independent merge was performed at A.`
           : decision === 'identity-not-preserved'
-            ? `Identity constraint not satisfied for [B PR #${b.number}](${b.html_url}): original source head \`${aHead}\` is missing from B/main. Use Create a merge commit; squash/rebase are unsupported. A/main still follows B/main, but this contribution is not marked accepted and no open A PR is closed by this decision. Maintainer must inspect the rewritten history.`
+            ? `Identity constraint not satisfied for [B PR #${b.number}](${b.html_url}): original source head \`${aHead}\` is missing from B/dev. Use Create a merge commit; squash/rebase are unsupported. A/dev still follows B/dev, but this contribution is not marked accepted and no open A PR is closed by this decision. Maintainer must inspect the rewritten history.`
           : decision === 'new-commits-pending'
-            ? `B merged [PR #${b.number}](${b.html_url}), but current A head \`${aHead}\` contains unaccepted commits. Main is synchronized only to accepted B history. Submit the remaining changes in a new PR from current main; this PR is not marked complete.`
-            : decision === 'merge-result-not-in-main'
-              ? `B merged [PR #${b.number}](${b.html_url}), but its merge result \`${b.merge_commit_sha}\` is not in the B/main snapshot \`${bSha}\` synchronized by this run. This PR is not marked complete; retry against current B/main or inspect a history rewrite.`
+            ? `B merged [PR #${b.number}](${b.html_url}), but current A head \`${aHead}\` contains unaccepted commits. Dev is synchronized only to accepted B history. Submit the remaining changes in a new PR from current dev; this PR is not marked complete.`
+            : decision === 'merge-result-not-in-dev'
+              ? `B merged [PR #${b.number}](${b.html_url}), but its merge result \`${b.merge_commit_sha}\` is not in the B/dev snapshot \`${bDevSha}\` synchronized by this run. This PR is not marked complete; retry against current B/dev or inspect a history rewrite.`
             : decision === 'source-closed'
               ? `A PR is closed; [B PR #${b.number}](${b.html_url}) remains under B's control. No merge or closure is performed at B. Reopen A if further contribution is needed.`
-              : `Bridge status: **${decision}**. [B PR #${b.number}](${b.html_url}). No unaccepted code is added to either main; this pair will not be recreated automatically.`;
+              : `Bridge status: **${decision}**. [B PR #${b.number}](${b.html_url}). No unaccepted code is added to either dev; this pair will not be recreated automatically.`;
         await statusComment(a.number, message);
         // Refresh immediately before closing, so a newer source head is not silently discarded.
         a = await api(source, `/pulls/${a.number}`);
-        if (a.state === 'open' && a.head.sha === aHead && ['accepted', 'rejected'].includes(decision)) {
+        if (a.base.ref === 'dev' && a.head.repo?.full_name === source && a.state === 'open' && a.head.sha === aHead && ['accepted', 'rejected'].includes(decision)) {
           await api(source, `/pulls/${a.number}`, { method: 'PATCH', body: { state: 'closed' } });
         }
         continue;
       }
       if (!sourceIncludedInBHead && !ancestor(b.head.sha, aHead)) {
-        await statusComment(a.number, `Blocked: incoming branch on [B PR #${b.number}](${b.html_url}) diverged from A head \`${aHead}\`. B changes are preserved; no force-push is performed. Coordinate with B or open a new A PR from current A/main. Other PRs continue processing.`);
+        await statusComment(a.number, `Blocked: incoming branch on [B PR #${b.number}](${b.html_url}) diverged from A head \`${aHead}\`. B changes are preserved; no force-push is performed. Coordinate with B or open a new A PR from current A/dev. Other PRs continue processing.`);
         report.pairs.push({ a: a.number, b: b.number, state: 'incoming-diverged', sourceHead: aHead }); continue;
       }
     }
     if (a.state !== 'open' || a.draft) continue;
-    if (included) { await statusComment(a.number, `Source head \`${aHead}\` is already in B/main. No new destination PR is needed.`); continue; }
-    const baseSha = git(['merge-base', aHead, bSha]).text;
-    if (git(['diff', '--name-only', baseSha, aHead, '--', '.github/workflows/']).text) {
-      await statusComment(a.number, 'Blocked: contribution changes workflow files. Maintainer B must handle workflow changes separately; no branch update was sent.');
-      report.pairs.push({ a: a.number, b: b?.number, state: 'blocked-workflow-change', sourceHead: aHead });
-      continue;
+    if (included) { await statusComment(a.number, `Source head \`${aHead}\` is already in B/dev. No new destination PR is needed.`); continue; }
+    // Transfer the original revision, including workflow files. Never execute PR code here.
+    const latest = await api(source, `/pulls/${a.number}`);
+    if (latest.base.ref !== 'dev' || latest.head.repo?.full_name !== source || latest.head.sha !== aHead || latest.state !== 'open' || latest.draft) {
+      report.pairs.push({ a: a.number, state: 'source-changed-retry' }); continue;
     }
     const branch = `incoming/a-pr-${a.number}`;
     if (!b || !ancestor(aHead, b.head.sha)) {
       assertPush({ repo: target, source, target, ref: `refs/heads/${branch}` });
       git(['push', bUrl, `${aHead}:refs/heads/${branch}`], targetToken);
     }
-    let body = `${marker}\nContribution from [A PR #${a.number}](${a.html_url}).\n\nInitial source head: \`${aHead}\`. See the source PR status and current branch commits for subsequent updates.\n\n### Merge instruction: preserve contributor identity\n\nPlease select **Create a merge commit** for this contribution. Do not squash or rebase this PR: original commit SHAs, authors and committers must be preserved. This is an instruction to the maintainer, not a restriction enforced by repository settings or branch protection.\n\nB is the source of truth. The controller synchronizes A/main to B/main and closes the accepted source PR only when its original head and B merge result are in main. If original commits are missing, the controller reports the identity issue; it cannot undo a merge or restore identity merely by synchronizing main.`;
+    let body = `${marker}\nContribution from [A PR #${a.number}](${a.html_url}).\n\nInitial source head: \`${aHead}\`. See the source PR status and current branch commits for subsequent updates.\n\n### Merge instruction: preserve contributor identity\n\nPlease select **Create a merge commit** for this contribution. Do not squash or rebase this PR: original commit SHAs, authors and committers must be preserved. This is an instruction to the maintainer, not a restriction enforced by repository settings or branch protection.\n\nB is the source of truth. The controller synchronizes A/dev to B/dev and closes the accepted source PR only when its original head and B merge result are in dev. If original commits are missing, the controller reports the identity issue; it cannot undo a merge or restore identity merely by synchronizing dev.`;
     const sourceBody = `\n\n### Original XBrain/A PR description at creation\n\n${textBlock(a.body ?? '')}`;
     if (body.length + sourceBody.length < 60000) body += sourceBody;
     body += '\n\nCurrent descriptions, reviews and inline replies from both sides are preserved in bridge-content comments below. Those comments track edits; this original PR body is not overwritten by the bridge.';
     if (!b) {
-      b = await api(target, '/pulls', { method: 'POST', body: { title: `A PR #${a.number}: ${a.title}`, head: branch, base: 'main', body } });
+      b = await api(target, '/pulls', { method: 'POST', body: { title: `A PR #${a.number}: ${a.title}`, head: branch, base: 'dev', body } });
       reviews = await syncPairContent(a, b);
     }
-    await statusComment(a.number, `Waiting for B approval: [PR #${b.number}](${b.html_url}).\n\nTransferred source head: \`${aHead}\`.\n\nGit mergeability: \`${b.mergeable_state ?? 'pending'}\` (conflict status, not approval). Reviews: ${reviewSummary(reviews)}.\n\nRead the mirrored B review comments below for the requested corrections. Review decisions refer to their recorded commit; B must review newer revisions.\n\nA/main remains at accepted B history \`${bSha}\`. Continue changes on this feature branch; do not merge this PR at A.`);
+    await statusComment(a.number, `Waiting for B approval: [PR #${b.number}](${b.html_url}).\n\nTransferred source head: \`${aHead}\`.\n\nGit mergeability: \`${b.mergeable_state ?? 'pending'}\` (conflict status, not approval). Reviews: ${reviewSummary(reviews)}.\n\nRead the mirrored B review comments below for the requested corrections. Review decisions refer to their recorded commit; B must review newer revisions.\n\nAuthoritative B/dev history is \`${bDevSha}\`. Continue changes on this feature branch; do not merge this PR at A.`);
     report.pairs.push({ a: a.number, b: b.number, state: 'pending', sourceHead: aHead, url: b.html_url });
     } catch (error) {
       report.pairs.push({ a: initial.number, b: b?.number, state: 'error', error: error.message });
```

</details>

Giữ nguyên `syncPairContent`, các module bảo toàn nội dung và registry/credentials của các cặp repo. Các test dùng PR base main trước đây phải chuyển fixture sang dev; đổi kỳ vọng `merge-result-not-in-main` thành `merge-result-not-in-dev`. Giữ test âm cho PR vào main/nhánh khác và trường hợp PR đổi target giữa lượt chạy.

Kiểm tra cú pháp và chạy bộ test trong repo controller sau khi sửa:

```bash
node --check scripts/pr-bridge.mjs
node --check scripts/pr-bridge-policy.mjs
node --test tests/*.test.mjs
```

## 3. Bỏ rule chặn thay đổi workflow

Nếu controller đã dùng dev-only nhưng còn báo `Blocked: contribution changes workflow files`, trong `scripts/pr-bridge.mjs` xóa toàn bộ đoạn sau (kể cả biến `baseSha` nếu chỉ dùng cho guard này). Với bản cũ, biến so sánh có thể tên `bSha` thay vì `bDevSha`; bỏ cùng guard này:

```diff
-    const baseSha = git(['merge-base', aHead, bDevSha]).text;
-    if (git(['diff', '--name-only', baseSha, aHead, '--', '.github/workflows/']).text) {
-      await statusComment(a.number, 'Blocked: contribution changes workflow files. Maintainer B must handle workflow changes separately; no branch update was sent.');
-      report.pairs.push({ a: a.number, b: b?.number, state: 'blocked-workflow-change', sourceHead: aHead });
-      continue;
-    }
+    // Transfer the original revision, including workflow files. Never execute PR code here.
```

Chuyển **nguyên SHA gốc**, gồm `.github/workflows/`, sang nhánh `incoming/a-pr-N`. Không bỏ file workflow, không tạo commit đã lọc, không tự merge PR. Controller tiếp tục chỉ chạy code của controller/main; workflow được chuyển có thể kích hoạt Actions ở repo sản phẩm theo trigger/policy của repo đó.

Đổi test `workflow-changing contribution stays blocked` thành test cho phép chuyển cùng SHA, tạo PR base dev và không checkout/chạy code PR trong controller.

## 4. Cấp quyền cho App ghi repo B và token của nó

**Bỏ guard code chưa đủ:** GitHub App cần quyền Workflows để tạo/cập nhật `.github/workflows/`. [GitHub: Choosing permissions for a GitHub App](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app).

1. Xác định **App ghi repo B** từ `BRIDGE_APP_CLIENT_ID` / `BRIDGE_APP_PRIVATE_KEY` trong controller. Đây không phải App `CONTROLLER_DISPATCH_APP_*` chỉ dùng để gọi Actions.
2. Tại tài khoản/org sở hữu App: **Settings → Developer settings → GitHub Apps → chọn App → Permissions & events → Repository permissions**. Giữ Contents và Pull requests ở Read and write; thêm **Workflows: Read and write**, rồi lưu.
3. Tại org TechX đã cài App: **Settings → GitHub Apps / Installed GitHub Apps → Configure → Review request / Accept new permissions**. Quyền đăng ký App và quyền installation đều phải được cập nhật. Giữ danh sách repo được cài hiện tại, không mở rộng sang repo khác.
4. Trong `.github/workflows/controller.yml`, tại bước tạo **token B (`id: target`)**, thêm `permission-workflows: write`:

```yaml
- name: Token scoped only to repo B including workflow transport
  uses: actions/create-github-app-token@64ab729a6294000f5aa4a4bc0b73d1f32bc45510
  id: target
  with:
    client-id: ${{ vars.BRIDGE_APP_CLIENT_ID }}
    private-key: ${{ secrets.BRIDGE_APP_PRIVATE_KEY }}
    owner: ${{ matrix.targetOwner }}
    repositories: ${{ matrix.targetRepo }}
    permission-contents: write
    permission-pull-requests: write
    permission-workflows: write
```

Giữ token chỉ scoped tới đúng một repo B của lượt reconcile. Không thay private key, không cần cấp Administration, không thêm `workflows: write` vào khối `permissions:` của GITHUB_TOKEN. Bước tạo token A đã có quyền Workflows để mirror từ B thì giữ nguyên. App dispatch chỉ cần quyền Actions write trên controller.

**Cấp quyền App và chấp nhận installation trước khi deploy YAML yêu cầu quyền mới**; nếu không, bước tạo token B sẽ thất bại.

## 5. Thứ tự triển khai và trigger lại

1. Cập nhật quyền App/installation theo mục 4.
2. Cập nhật code controller theo mục 2–3 và token B theo mục 4, chạy tests rồi merge vào controller/main.
3. Bảo đảm dev tồn tại ở cả hai phía; cập nhật notifier trên TechX/main và dev rồi để bot sync về XBrain. Với feature branch cũ, cập nhật workflow từ dev mới trước khi xác nhận các event review đã dùng policy mới.
4. Áp dụng cho 7 cặp: `xora-evaluation-framework`, `xora-eval-framework-fe`, `xora-learning-loop`, `xora-platform`, `xora-platform-fe`, `xora-resolve-be`, `xora-resolve-agent`. Nếu repo chưa có dev thì tạo từ revision team chọn. Giữ protection main/dev chỉ cho bot sync cập nhật.
5. Với PR dev đang mở hoặc đã bị guard workflow chặn, đăng **một comment thường** để notifier chạy lại:

> Please reconcile this dev PR to TechX, preserving its current head revision, workflow files and description.

`issue_comment.created` đọc target dev → dispatch controller mới → chuyển nguyên head → tạo/cập nhật PR TechX vào dev → bot cập nhật comment trạng thái với link PR. Không cần commit rỗng, đóng/mở PR hoặc re-run run push đang skipped.

Khi kiểm tra triển khai: bước tạo token B và dispatch/reconcile phải thành công; PR TechX phải target dev, có cùng head SHA và chứa các file workflow của PR nguồn. Nếu vẫn báo thiếu quyền, kiểm tra cả App registration, installation và input `permission-workflows` của đúng token B.
