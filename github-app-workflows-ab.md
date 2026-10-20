# Setup workflow A/B

Nâng cấp controller để đồng bộ mọi nhánh B → A:
[file cần đổi, workflow giữ nguyên và cách nghiệm thu](all-branch-reconciliation.md).
Push riêng lên nhánh ngoài main vẫn chờ lượt reconcile tiếp theo nếu giữ notifier dưới đây.

**A: XBrainVN. B: TechX — source of truth. Controller: `TechX/xora-contribution-controller`.**

## 1. Giữ pipeline chạy tại B, không chạy tại A

| Repo | Pipeline build/test/deploy hiện có | Workflow mới |
|---|---|---|
| B — `TechX/<repo>` | Giữ nguyên, tiếp tục chạy | Thêm `notify-controller.yml` để gọi controller khi review/comment hoặc B/main thay đổi |
| A — `XBrainVN/<repo>` | Disable từng workflow tại A | Chỉ bật `notify-controller.yml` để gọi controller khi PR/commit/comment thay đổi |

Tại A: **Actions → chọn pipeline cũ → `…` → Disable workflow**. Nếu đã tắt rồi thì không cần làm lại. **Giữ Actions của repo được bật.**

Không xóa file pipeline khỏi A/main. Bot đồng bộ nguyên B/main về A/main nên file vẫn có ở A; trạng thái **Disable workflow tại A** quyết định pipeline đó không chạy. Tắt tại A không ảnh hưởng pipeline B. Nếu B thêm/đổi tên workflow, kiểm tra và disable workflow ứng dụng mới tại A.

## 2. Setup bên A

Làm tại từng repo `XBrainVN/<repo>`:

1. Repo A phải có `main` đã bootstrap từ B/main.
2. Giữ các pipeline ứng dụng cũ disabled như mục 1.
3. Workflow mới ở A là **`.github/workflows/notify-controller.yml`**, dùng đúng code ở mục 4. **Không commit riêng tại A**: thêm file tại B, rồi controller đưa file về A ở mục 5.
4. Sau khi file có tại A, vào **Actions → Notify contribution bridge** và kiểm tra workflow enabled. Nếu từng disable file này thì chọn **Enable workflow**.

Kết quả: developer mở PR hoặc push thêm commit vào PR tại A → notifier A gọi controller → controller mở/cập nhật PR tại B.

## 3. Setup bên B

Làm tại từng repo `TechX/<repo>`:

1. Giữ nguyên các pipeline build/test/deploy đang dùng.
2. Tạo branch, thêm file **`.github/workflows/notify-controller.yml`** bằng code ở mục 4.
3. Mở PR để maintainer B review và merge.

Kết quả: merge PR hoặc push lên B/main → notifier B gọi controller → controller đồng bộ B/main về A/main. Pipeline B vẫn chạy theo trigger cũ; notifier là workflow riêng, không cần thêm job vào pipeline đang có.

## 4. Code workflow dùng ở cả hai bên

Thay **mọi `REPO_NAME`** trong YAML bằng tên repo của cặp đang setup, ví dụ `xora-platform`. `XBrainVN`, `TechX` và tên controller đã điền sẵn.

| Vị trí | Cách đưa file vào |
|---|---|
| `TechX/REPO_NAME/.github/workflows/notify-controller.yml` | Thêm code dưới đây bằng PR tại B |
| `XBrainVN/REPO_NAME/.github/workflows/notify-controller.yml` | Controller đồng bộ cùng file từ B/main về A/main |

```yaml
name: Notify contribution bridge
on:
  push:
    branches: [main]
  pull_request_target:
    branches: [main]
    types: [opened, synchronize, reopened, closed, ready_for_review, edited]
  issue_comment:
    types: [created, edited]
  pull_request_review:
    types: [submitted, edited, dismissed]
  pull_request_review_comment:
    types: [created, edited]

permissions: {}

concurrency:
  group: notify-${{ github.event_name }}-${{ github.event.pull_request.number || github.event.issue.number || 'main' }}
  cancel-in-progress: false

jobs:
  notify:
    if: >-
      (github.repository == 'XBrainVN/REPO_NAME' || github.repository == 'TechX/REPO_NAME') &&
      (
        (github.event_name == 'push' && github.repository == 'TechX/REPO_NAME' && github.ref == 'refs/heads/main') ||
        (github.event.sender.type == 'User' &&
          (
            (github.event_name == 'issue_comment' && github.event.issue.pull_request) ||
            ((github.event_name == 'pull_request_target' || github.event_name == 'pull_request_review' || github.event_name == 'pull_request_review_comment') &&
              github.event.pull_request.base.ref == 'main' && github.event.pull_request.head.repo.full_name == github.repository)
          )
        )
      )
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      # No checkout, PR code, dependencies, or interpolated comment text in this job.
      - name: Token scoped only to controller Actions
        uses: actions/create-github-app-token@64ab729a6294000f5aa4a4bc0b73d1f32bc45510
        id: dispatch
        with:
          client-id: ${{ vars.CONTROLLER_DISPATCH_APP_CLIENT_ID }}
          private-key: ${{ secrets.CONTROLLER_DISPATCH_APP_PRIVATE_KEY }}
          owner: TechX
          repositories: xora-contribution-controller
          permission-actions: write
      - name: Dispatch trusted controller main
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
          if (!['XBrainVN/REPO_NAME', 'TechX/REPO_NAME'].includes(repo)
            || !/^[a-f0-9]{40}$/.test(sha) || !/^[1-9][0-9]*$/.test(runId)
            || !['push','pull_request_target','issue_comment','pull_request_review','pull_request_review_comment'].includes(event)
            || (event === 'push' ? repo !== 'TechX/REPO_NAME' || Boolean(pr) : !/^[1-9][0-9]*$/.test(pr))) throw new Error('Invalid source event');
          const response = await fetch('https://api.github.com/repos/TechX/xora-contribution-controller/actions/workflows/controller.yml/dispatches', {
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
          appendFileSync(process.env.GITHUB_STEP_SUMMARY, `# Contribution event dispatched\n\nSource: ${repo} / ${event}${pr ? ` / PR #${pr}` : ''}\n\nEvent SHA: \`${sha}\`\n\nController: TechX/xora-contribution-controller / controller.yml / main\n\nSource run: https://github.com/${repo}/actions/runs/${runId}\n\nDispatch accepted: HTTP ${response.status}. Inspect the controller run for the reconciliation result.\n`);
          NODE
```

File trên xử lý cả hai phía:

| Sự kiện | A | B |
|---|---|---|
| Người dùng mở/cập nhật PR cùng repo, base main | Gọi controller | Gọi controller |
| Người dùng comment/review PR | Gọi controller | Gọi controller |
| Push/merge vào main | Job notify không chạy, tránh vòng lặp sync | Gọi controller để reconcile |

Notifier không checkout hay chạy code PR. Giữ nguyên các điều kiện lọc repo/event và phạm vi token của YAML.

### Bảng tham chiếu repo A/B

Mỗi dòng là một cặp. Dùng giá trị cột `REPO_NAME` để thay mọi `REPO_NAME` trong YAML phía trên. **B là source of truth; main đồng bộ B → A.**

| `REPO_NAME` | Repo A — contribute | Repo B — review/merge, source of truth |
|---|---|---|
| `xora-evaluation-framework` | [XBrainVN/xora-evaluation-framework](https://github.com/XBrainVN/xora-evaluation-framework) | [TechX/xora-evaluation-framework](https://github.com/TechX/xora-evaluation-framework) |
| `xora-eval-framework-fe` | [XBrainVN/xora-eval-framework-fe](https://github.com/XBrainVN/xora-eval-framework-fe) | [TechX/xora-eval-framework-fe](https://github.com/TechX/xora-eval-framework-fe) |
| `xora-learning-loop` | [XBrainVN/xora-learning-loop](https://github.com/XBrainVN/xora-learning-loop) | [TechX/xora-learning-loop](https://github.com/TechX/xora-learning-loop) |
| `xora-platform` | [XBrainVN/xora-platform](https://github.com/XBrainVN/xora-platform) | [TechX/xora-platform](https://github.com/TechX/xora-platform) |
| `xora-platform-fe` | [XBrainVN/xora-platform-fe](https://github.com/XBrainVN/xora-platform-fe) | [TechX/xora-platform-fe](https://github.com/TechX/xora-platform-fe) |
| `xora-resolve-be` | [XBrainVN/xora-resolve-be](https://github.com/XBrainVN/xora-resolve-be) | [TechX/xora-resolve-be](https://github.com/TechX/xora-resolve-be) |
| `xora-resolve-agent` | [XBrainVN/xora-resolve-agent](https://github.com/XBrainVN/xora-resolve-agent) | [TechX/xora-resolve-agent](https://github.com/TechX/xora-resolve-agent) |

Cả 7 cặp gọi chung controller [TechX/xora-contribution-controller](https://github.com/TechX/xora-contribution-controller).

## 5. Chạy lần đầu và kiểm tra

Khi controller đã được cấu hình và bật, cả 7 PR thêm notifier tại B đã merge và A đã bootstrap:

1. **Actions → Contribution bridge controller → Run workflow → main**, để trống inputs.
2. Chờ đủ 7 job reconcile thành công. Kiểm tra A/main trùng B/main và A đã nhận file notifier.
3. Kiểm tra tại A: notifier enabled, các pipeline ứng dụng vẫn disabled.
4. Thử mở PR A → thêm commit → B nhận PR/commit → B **Create a merge commit** → notifier B tự chạy → A/main cập nhật → PR A đóng.

Sau lần khởi tạo, **không cần bấm Run workflow mỗi khi B merge**. Push B/main tự kích hoạt notifier; thời điểm chạy phụ thuộc hàng đợi Actions.

Reconcile không chờ build/deploy tại B hoàn tất. Nếu yêu cầu CI thành công trước khi nhận code thì đặt required checks trước merge. Nếu automation push B/main bằng `GITHUB_TOKEN`, cần dispatch riêng hoặc dùng App token phù hợp vì push đó không kích hoạt workflow tiếp theo.

Kiểm tra **cả notifier và controller run**: notifier Success chỉ chứng minh yêu cầu dispatch được gửi, chưa chứng minh main đã đồng bộ.

[GitHub: disable workflow](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/disable-and-enable-workflows) · [GitHub: trigger workflow](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow).
