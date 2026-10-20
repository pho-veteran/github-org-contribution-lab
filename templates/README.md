# Bộ template A/B

| Thành phần | Cài ở đâu | Nội dung |
|---|---|---|
| [setup script](setup/setup.mjs) | Máy admin có SSH và hai tài khoản `gh` | Nhận link B, bootstrap vào A rỗng đã có, cấu hình controller/secrets và mở PR notifier; theo [hướng dẫn script](../github-app-quick-setup.md) |
| [controller](controller) | Repo controller do B quản lý | Scripts, tests và workflow điều phối |
| [notifier dùng chung A/B](notifier/.github/workflows/notify-controller.yml) | Cài tại B trước, bot đồng bộ B/main sang A/main | PR/review/Conversation events ở A và B; push main chỉ ở B |

A **có workflow** nhưng không cần một bản YAML riêng. Thư mục `notifier` chứa workflow dùng chung cho cả hai bên. Cấu hình secret/variable dispatch riêng ở cả A và B theo [setup](../github-app-setup.md).

Nhiều cặp repo dùng chung ba App, một controller và một workflow. Thêm mapping vào [bridge.config.json](controller/bridge.config.json), cấp repo cho installation tương ứng và cài notifier cho cặp mới. Không copy script controller theo từng repo. Workflow chọn đúng cặp từ event; schedule/Run workflow không có metadata chạy tất cả cặp.

Các workflow ứng dụng khác cũng đi từ B sang A. Trước bootstrap, guard workflow deploy/CD chỉ dành cho B bằng `github.repository == 'B_OWNER/B_REPO'`; job build/test contribution không được đưa secret hoặc token ghi vào code do A cung cấp.
