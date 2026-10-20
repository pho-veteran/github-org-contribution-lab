# Bộ template A/B

| Thành phần | Cài ở đâu | Nội dung |
|---|---|---|
| [controller](controller) | Repo controller do B quản lý | Scripts, tests và workflow điều phối |
| [notifier dùng chung A/B](B/.github/workflows/notify-controller.yml) | Cài tại B trước, bot đồng bộ B/main sang A/main | PR/review/Conversation events ở A và B; push main chỉ ở B |

A **có workflow** nhưng không cần một bản YAML riêng. Thư mục `B` chỉ nơi cài file notifier ban đầu. Cấu hình secret/variable dispatch riêng ở cả A và B theo [setup](../github-app-setup.md).

Các workflow ứng dụng khác cũng đi từ B sang A. Trước bootstrap, guard workflow deploy/CD chỉ dành cho B bằng `github.repository == 'B_OWNER/B_REPO'`; job build/test contribution không được đưa secret hoặc token ghi vào code do A cung cấp.
