# Bộ template A/B

| Thành phần | Cài ở đâu | Nội dung |
|---|---|---|
| [controller](controller) | Repo controller do B quản lý | Scripts, tests và workflow điều phối |
| [notifier dùng chung A/B](notifier/.github/workflows/notify-controller.yml) | Cài tại B trước, bot đồng bộ B/main sang A/main | Manual PR + SHA ở A; review/comment/push ở B |

A **có workflow** nhưng không cần một bản YAML riêng. Thư mục `notifier` chứa workflow dùng chung cho cả hai bên. Cấu hình secret/variable dispatch riêng ở cả A và B theo [setup](../github-app-setup.md).

Nhiều cặp repo dùng chung ba App, một controller và một workflow. Thêm mapping vào [bridge.config.json](controller/bridge.config.json), cấp repo cho installation tương ứng và cài notifier cho cặp mới. Không copy script controller theo từng repo. Workflow chọn đúng cặp từ event; schedule/Run workflow controller không có metadata chỉ reconcile tất cả cặp, không gửi code mới. Run workflow notifier ở A nhận PR number và head SHA. Thay cả `CONTRIBUTION_BRANCH` (main hoặc dev); notifier vẫn phải nằm trên default branch A.

Các workflow ứng dụng khác cũng đi từ B sang A. Trước bootstrap, guard mọi job pipeline ứng dụng chỉ dành cho B bằng `github.repository == 'B_OWNER/B_REPO'`; job build/test contribution không được đưa secret hoặc token ghi vào code do A cung cấp.
