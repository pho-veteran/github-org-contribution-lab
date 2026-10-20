# Cập nhật workflow: TechX push mọi nhánh → XBrain reconcile

A = `XBrainVN`, B = `TechX-Corp`.

- [Controller mẫu mới](https://github.com/pho-veteran/xora-contribution-controller) — bản đã test: [`ad8330c`](https://github.com/pho-veteran/xora-contribution-controller/tree/ad8330c43909277144e5368b1ee48ed21ff3bb9c).
- [File notifier mới](templates/notifier/.github/workflows/notify-controller.yml).

## Thay đổi so với setting cũ

| Trước | Sau |
|---|---|
| CI notifier chỉ bắt push `main` ở B | B push mọi nhánh có notifier mới → CI tự gọi controller |
| Controller chỉ reconcile `main` | Reconcile mọi nhánh B → cùng tên/SHA ở A |
| Concurrency notifier push dùng chung `main` | Tách theo `github.ref` |

Luồng contribution A → B giữ nguyên. Nhánh riêng A được giữ lại; nhánh A đang có PR mở được hoãn ghi đè. Không mirror ngược toàn bộ A → B, không đồng bộ tags hoặc xóa nhánh A khi B xóa nhánh. Schedule 6 giờ chỉ là dự phòng.

## 1. Cập nhật code controller

Áp thay đổi từ controller mẫu vào controller private:

- Thêm/cập nhật `scripts/branch-sync.mjs`.
- Cập nhật `scripts/pr-bridge.mjs`.
- Cập nhật `tests/branch-sync.test.mjs` và `tests/pr-bridge-orchestration.test.mjs`.

Bản mới đã sửa lỗi REST trả `404` sau khi tạo nhánh: xác minh ref bằng Git. Giữ cấu hình repo, Apps, secrets, runner và base PR đang dùng; nếu production tùy biến base `dev`, áp diff thay vì chép đè cấu hình mẫu. `.github/workflows/controller.yml` không cần đổi nếu đang dùng workflow mẫu hiện tại.

Chạy `node --test tests/*.test.mjs`, review rồi đưa code lên `main` của controller.

## 2. Cập nhật notifier tại B

File cần sửa: `.github/workflows/notify-controller.yml`. Dùng [bản đầy đủ](templates/notifier/.github/workflows/notify-controller.yml), thay `A_OWNER/A_REPO`, `B_OWNER/B_REPO` và `CONTROLLER_REPO` bằng đúng mapping hiện tại.

Ba chỗ thay đổi trong YAML:

```diff
 on:
   push:
-    branches: [main]
+    branches: ['**']
```

```diff
-  group: notify-${{ github.event_name }}-${{ github.event.pull_request.number || github.event.issue.number || 'main' }}
+  group: notify-${{ github.event_name }}-${{ github.event.pull_request.number || github.event.issue.number || github.ref }}
```

Trong điều kiện push của job `notify`, giữ guard đúng repo B và đổi kiểm tra ref:

```diff
-        (github.event_name == 'push' && github.repository == 'B_OWNER/B_REPO' && github.ref == 'refs/heads/main') ||
+        (github.event_name == 'push' && github.repository == 'B_OWNER/B_REPO' && startsWith(github.ref, 'refs/heads/')) ||
```

Giữ nguyên các trigger PR/review/comment, token Dispatch và endpoint controller. Push ở A bị skip; không thêm nút gửi code thủ công ở A.

## 3. Áp dụng và kiểm tra

1. Đưa notifier mới vào `main` **và các nhánh B đang hoạt động**. Push đọc workflow tại chính nhánh đó; chỉ sửa `main` chưa đủ cho nhánh cũ. Với nhánh contribution đang mở PR, cập nhật baseline theo quy trình, tránh tự chèn commit vào nhánh `incoming/*`.
2. Controller đồng bộ cùng workflow về A. Giữ Actions bật, notifier enabled và các workflow ứng dụng tại A disabled như setting cũ. Không cần App hoặc secrets mới.
3. Push một commit lên nhánh B ngoài `main`, không mở PR và không bấm Run workflow. Kiểm tra notifier Success → controller Success → SHA nhánh tương ứng ở A trùng B. Nếu có `deferred-open-pr`, nhánh được giữ để bảo vệ contribution.

Automation B push bằng `GITHUB_TOKEN` không tự kích hoạt workflow tiếp theo; dùng App token phù hợp hoặc gọi controller rõ ràng.

Đã test trên hai cặp lab: [run cặp 1](https://github.com/TF4-Phase3-TechX/bot-bridge-controller/actions/runs/39459855470), [run cặp 2](https://github.com/TF4-Phase3-TechX/bot-bridge-controller/actions/runs/39459856339). **Chưa triển khai production.**
