# Gửi contribution từ A sang B bằng workflow_dispatch

A = **XBrainVN**, B = **TechX-Corp**. AI chỉ làm product trên feature branch/PR tại A. SRE quản lý notifier/controller, App và protection. B quyết định review/merge.

## 1. Developer gửi code

1. Push feature branch, mở PR ready tại A; chưa có code nào tự chuyển sang B.
2. Copy **head commit SHA đủ 40 ký tự** của PR.
3. A → **Actions → Notify contribution bridge → Run workflow**; chọn default branch **main**, nhập `pr_number` và `head_sha`.
4. Xem cả notifier lẫn controller run; status comment tại PR A dẫn tới PR B và SHA đã gửi.
5. Sửa thêm bao nhiêu commit cũng được. B giữ revision cũ cho đến khi bạn Run workflow lần nữa với SHA mới.

Người có Write đều được gửi; không cần team AI Manager. Không merge PR tại A. Nếu PR đã đổi head khi controller xử lý, run thất bại; chọn SHA hiện tại và gửi lại. Không dùng Re-run jobs của run cũ.

```bash
# Ví dụ: gửi đúng revision hiện tại của PR 123, không đọc lại SHA trong controller để gửi thay.
sha=$(gh pr view 123 --repo XBrainVN/xora-platform --json headRefOid --jq .headRefOid)
gh workflow run notify-controller.yml --repo XBrainVN/xora-platform --ref main \
  -f pr_number=123 -f head_sha="$sha"
```

## 2. Trigger nào làm gì?

| Trigger | Hành vi |
|---|---|
| A mở PR, push commit, comment/review | Không tự chuyển code; job notifier bỏ qua |
| A Run workflow với PR + SHA | Xác minh run/actor/PR, chỉ gửi đúng revision của đúng PR |
| B review/comment/merge/push | Đồng bộ phản hồi và lịch sử đã chấp nhận; không gửi commit A mới |
| Controller schedule hoặc Run workflow trống | Reconcile mọi cặp, không tạo/cập nhật PR B bằng code chưa gửi |

B dùng **Create a merge commit** để giữ SHA/author/committer. Nếu A có thêm commit chưa được B nhận, controller không đóng PR A như đã hoàn tất. Nếu B đã đóng/merge PR cũ, phần còn lại cần PR A mới từ base hiện tại.

## 3. SRE triển khai notifier/controller

- Controller private: `TechX-Corp/xora-contribution-controller`. Repo public bàn giao: [xora-contribution-controller](https://github.com/pho-veteran/xora-contribution-controller).
- Nâng App Sync lên **Actions: read**, giữ Contents/Pull requests/Workflows write; admin A chấp nhận quyền installation mới. Không tạo thêm App/key. [Bảng credentials](github-app-secrets-variables.md).
- Giữ bridge tắt trong migration, deploy controller trước notifier. Không chạy lại bootstrap trên repo đang hoạt động.
- Thêm [notifier template](templates/notifier/.github/workflows/notify-controller.yml) tại B, review/merge rồi sync về A. Thay `A_OWNER`, `A_REPO`, `B_OWNER`, `B_REPO`, `CONTROLLER_REPO`, `CONTRIBUTION_BRANCH`.
- **Notifier phải có trên default branch A**. Với `xora-resolve-be`, contribution/sync dùng `dev` nhưng Run workflow dùng `main`: SRE phải đưa entrypoint lên main qua thay đổi được B quản lý. Không đổi default branch để né điều kiện này.
- Giữ Actions enabled. Chỉ notifier enabled tại A; workflow ứng dụng cũ disable, không xóa YAML. Mọi job pipeline chỉ dành cho B phải có repository guard trước khi sync. Disable không hủy run đang chạy và không phải allowlist cưỡng chế đối với workflow mới.
- Bảo vệ main/dev tại A chỉ cho Sync App cập nhật; rule chống xóa không bypass. Controller default branch chỉ SRE được sửa. Transport App không được push/merge protected base tại B.

Renderer trong repo docs:

```bash
node scripts/render-notifier.mjs /path/to/controller/bridge.config.json PAIR_ID > notify-controller.yml
```

Controller xác minh GitHub run record (repo/workflow/default branch, event, run-name PR/SHA, actor có Write, thành công, lần chạy đầu, tuổi tối đa một giờ). Key Dispatch chỉ đánh thức controller; tự khai báo actor/SHA không đủ quyền gửi. Default branch phải được bảo vệ vì đây là nguồn workflow được tin cậy. [GitHub manual workflow](https://docs.github.com/actions/managing-workflow-runs/manually-running-a-workflow) · [Workflow run API](https://docs.github.com/en/rest/actions/workflow-runs).

## 4. Mapping hiện tại

| Repo | A | B | Contribution/sync base |
|---|---|---|
| xora-evaluation-framework | [XBrainVN/xora-evaluation-framework](https://github.com/XBrainVN/xora-evaluation-framework) | [TechX-Corp/xora-evaluation-framework](https://github.com/TechX-Corp/xora-evaluation-framework) | main |
| xora-eval-framework-fe | [XBrainVN/xora-eval-framework-fe](https://github.com/XBrainVN/xora-eval-framework-fe) | [TechX-Corp/xora-eval-framework-fe](https://github.com/TechX-Corp/xora-eval-framework-fe) | main |
| xora-learning-loop | [XBrainVN/xora-learning-loop](https://github.com/XBrainVN/xora-learning-loop) | [TechX-Corp/xora-learning-loop](https://github.com/TechX-Corp/xora-learning-loop) | main |
| xora-platform | [XBrainVN/xora-platform](https://github.com/XBrainVN/xora-platform) | [TechX-Corp/xora-platform](https://github.com/TechX-Corp/xora-platform) | main |
| xora-platform-fe | [XBrainVN/xora-platform-fe](https://github.com/XBrainVN/xora-platform-fe) | [TechX-Corp/xora-platform-fe](https://github.com/TechX-Corp/xora-platform-fe) | main |
| xora-resolve-be | [XBrainVN/xora-resolve-be](https://github.com/XBrainVN/xora-resolve-be) | [TechX-Corp/xora-resolve-be](https://github.com/TechX-Corp/xora-resolve-be) | dev |
| xora-resolve-agent | [XBrainVN/xora-resolve-agent](https://github.com/XBrainVN/xora-resolve-agent) | [TechX-Corp/xora-resolve-agent](https://github.com/TechX-Corp/xora-resolve-agent) | main |

## 5. Nghiệm thu

Tạo PR A chưa gửi → B không có PR. Gửi SHA 1 → B đúng SHA 1. Push SHA 2 tại A → chạy reconcile/schedule/B event → B vẫn SHA 1. Gửi SHA 2 → B cập nhật đúng SHA 2. Gửi SHA cũ hoặc giả run-id/ref/actor → bị từ chối. B review/merge → A nhận phản hồi, base đồng bộ và PR đóng khi toàn bộ revision được chấp nhận. CI mẫu chỉ chạy tại B; tại A notifier vẫn hoạt động.

Lab private trên GitHub Free không có rulesets; không dùng kết quả lab để tuyên bố branch protection production đã được nghiệm thu. Deployment production và PR IaC #58 là bước riêng.
