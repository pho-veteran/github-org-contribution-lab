# Secrets và variables cho Xora contribution bridge

**A = `XBrainVN`; B = `TechX`, là source of truth.** Controller vận hành là repo private **`TechX/xora-contribution-controller`**. Repo public `pho-veteran/xora-contribution-controller` chỉ chứa source bàn giao; không đặt credentials vận hành tại đó.

## 1. Cách lấy giá trị

Người quản lý App mở **org tạo App → Settings → Developer settings → GitHub Apps → chọn App**.

| Giá trị | Lấy ở đâu | Nội dung dùng để điền |
|---|---|---|
| Client ID của **Xora Contribution Sync** | Trang cấu hình App Sync → **Client ID** | Copy đúng Client ID; không dùng App ID hoặc Client secret |
| Private key của **Xora Contribution Sync** | App Sync → **Private keys / Key pairs → Generate a private key / New key** | Mở file `.pem` đã tải, copy toàn bộ nội dung gồm dòng `BEGIN` và `END` |
| Client ID của **Xora Contribution Transport** | Trang cấu hình App Transport → **Client ID** | Copy đúng Client ID |
| Private key của **Xora Contribution Transport** | App Transport → **Private keys / Key pairs → Generate a private key / New key** | Toàn bộ nội dung file `.pem` của App Transport |
| Client ID của **Xora Contribution Dispatch** | Trang cấu hình App Dispatch → **Client ID** | Copy đúng Client ID |
| Private key của **Xora Contribution Dispatch** | App Dispatch → **Private keys / Key pairs → Generate a private key / New key** | Toàn bộ nội dung file `.pem` của App Dispatch |
| Trạng thái bridge | Tự điền | `false` khi setup; `true` khi đủ điều kiện kích hoạt |

Nếu đã có PEM hợp lệ thì dùng lại, không cần tạo key mới. Private key **khác Client secret**; luồng này không cần tạo Client secret. Không điền đường dẫn file PEM, không thêm dấu nháy quanh giá trị, giữ nguyên xuống dòng của PEM.

## 2. Cách thêm trên GitHub

Tại **từng repo** cần cấu hình: **Settings → Secrets and variables → Actions**.

| Loại | Thao tác | Ô cần điền |
|---|---|---|
| Secret | Tab **Secrets → New repository secret** | **Name** và **Secret** theo bảng bên dưới |
| Variable | Tab **Variables → New repository variable** | **Name** và **Value** theo bảng bên dưới |

Dùng **repository secrets/variables**, không chọn Environment secrets: workflow hiện tại không khai báo environment. Nếu tên đã có, cập nhật đúng mục đó.

## 3. Controller — 2 secrets và 3 variables

Chỉ đặt bảng này tại **`TechX/xora-contribution-controller`**.

| Loại | Name — copy nguyên tên | Secret / Value cần điền | Lấy từ |
|---|---|---|---|
| Secret | `SOURCE_APP_PRIVATE_KEY` | Toàn bộ nội dung PEM App Sync | **Xora Contribution Sync** → Private keys / Key pairs |
| Secret | `BRIDGE_APP_PRIVATE_KEY` | Toàn bộ nội dung PEM App Transport | **Xora Contribution Transport** → Private keys / Key pairs |
| Variable | `SOURCE_APP_CLIENT_ID` | Client ID App Sync | **Xora Contribution Sync** → Client ID |
| Variable | `BRIDGE_APP_CLIENT_ID` | Client ID App Transport | **Xora Contribution Transport** → Client ID |
| Variable | `BRIDGE_ENABLED` | `false` | Tự điền; chỉ đổi thành `true` sau khi hoàn tất bootstrap, installation, notifier và kiểm tra quyền |

Không đặt private key Dispatch tại controller; controller dùng key Sync/Transport để tạo token thao tác trên repo A/B.

## 4. Mỗi repo A/B — 1 secret và 1 variable

Lặp lại **đúng hai mục sau tại cả 14 repo** trong mục 5. Tất cả dùng **cùng Client ID và PEM của App Dispatch**; không tạo 14 App hay 14 private key.

| Loại | Name — copy nguyên tên | Secret / Value cần điền | Lấy từ |
|---|---|---|---|
| Secret | `CONTROLLER_DISPATCH_APP_PRIVATE_KEY` | Toàn bộ nội dung PEM App Dispatch | **Xora Contribution Dispatch** → Private keys / Key pairs |
| Variable | `CONTROLLER_DISPATCH_APP_CLIENT_ID` | Client ID App Dispatch | **Xora Contribution Dispatch** → Client ID |

Không đặt `SOURCE_APP_PRIVATE_KEY`, `BRIDGE_APP_PRIVATE_KEY` hoặc `BRIDGE_ENABLED` tại các repo A/B. Key Sync/Transport chỉ ở controller.

## 5. Danh sách repo cần điền

Trong bảng này, **PEM Dispatch** và **Client ID Dispatch** là hai giá trị lấy ở mục 1.

| Repo | Secret cần thêm | Variable cần thêm |
|---|---|---|
| `XBrainVN/xora-evaluation-framework` | `CONTROLLER_DISPATCH_APP_PRIVATE_KEY` = PEM Dispatch | `CONTROLLER_DISPATCH_APP_CLIENT_ID` = Client ID Dispatch |
| `XBrainVN/xora-eval-framework-fe` | `CONTROLLER_DISPATCH_APP_PRIVATE_KEY` = PEM Dispatch | `CONTROLLER_DISPATCH_APP_CLIENT_ID` = Client ID Dispatch |
| `XBrainVN/xora-learning-loop` | `CONTROLLER_DISPATCH_APP_PRIVATE_KEY` = PEM Dispatch | `CONTROLLER_DISPATCH_APP_CLIENT_ID` = Client ID Dispatch |
| `XBrainVN/xora-platform` | `CONTROLLER_DISPATCH_APP_PRIVATE_KEY` = PEM Dispatch | `CONTROLLER_DISPATCH_APP_CLIENT_ID` = Client ID Dispatch |
| `XBrainVN/xora-platform-fe` | `CONTROLLER_DISPATCH_APP_PRIVATE_KEY` = PEM Dispatch | `CONTROLLER_DISPATCH_APP_CLIENT_ID` = Client ID Dispatch |
| `XBrainVN/xora-resolve-be` | `CONTROLLER_DISPATCH_APP_PRIVATE_KEY` = PEM Dispatch | `CONTROLLER_DISPATCH_APP_CLIENT_ID` = Client ID Dispatch |
| `XBrainVN/xora-resolve-agent` | `CONTROLLER_DISPATCH_APP_PRIVATE_KEY` = PEM Dispatch | `CONTROLLER_DISPATCH_APP_CLIENT_ID` = Client ID Dispatch |
| `TechX/xora-evaluation-framework` | `CONTROLLER_DISPATCH_APP_PRIVATE_KEY` = PEM Dispatch | `CONTROLLER_DISPATCH_APP_CLIENT_ID` = Client ID Dispatch |
| `TechX/xora-eval-framework-fe` | `CONTROLLER_DISPATCH_APP_PRIVATE_KEY` = PEM Dispatch | `CONTROLLER_DISPATCH_APP_CLIENT_ID` = Client ID Dispatch |
| `TechX/xora-learning-loop` | `CONTROLLER_DISPATCH_APP_PRIVATE_KEY` = PEM Dispatch | `CONTROLLER_DISPATCH_APP_CLIENT_ID` = Client ID Dispatch |
| `TechX/xora-platform` | `CONTROLLER_DISPATCH_APP_PRIVATE_KEY` = PEM Dispatch | `CONTROLLER_DISPATCH_APP_CLIENT_ID` = Client ID Dispatch |
| `TechX/xora-platform-fe` | `CONTROLLER_DISPATCH_APP_PRIVATE_KEY` = PEM Dispatch | `CONTROLLER_DISPATCH_APP_CLIENT_ID` = Client ID Dispatch |
| `TechX/xora-resolve-be` | `CONTROLLER_DISPATCH_APP_PRIVATE_KEY` = PEM Dispatch | `CONTROLLER_DISPATCH_APP_CLIENT_ID` = Client ID Dispatch |
| `TechX/xora-resolve-agent` | `CONTROLLER_DISPATCH_APP_PRIVATE_KEY` = PEM Dispatch | `CONTROLLER_DISPATCH_APP_CLIENT_ID` = Client ID Dispatch |

Controller cấu hình riêng theo mục 3. Tổng cộng **15 repo**, **16 repository secrets** và **17 repository variables**.

## 6. Installation và kiểm tra sau khi điền

Đặt secret không tự cài App. Cần đủ các installation sau:

| App | Cài vào đâu | Key được lưu ở đâu |
|---|---|---|
| Xora Contribution Sync | Chọn 7 repo `XBrainVN` | Controller |
| Xora Contribution Transport | Chọn 7 repo `TechX` | Controller |
| Xora Contribution Dispatch | Chỉ `TechX/xora-contribution-controller` | 14 repo A/B |

App Sync tạo tại TechX phải cho phép **Any account** để owner XBrainVN cài. Không cần một tài khoản có quyền ở cả hai org; mỗi bên đặt secrets/variables tại repo mình quản lý. Người quản lý App bàn giao PEM Dispatch cho admin XBrain qua kênh secrets, không commit PEM vào repo docs/code.

| Kiểm tra | Kết quả cần thấy |
|---|---|
| Controller → Secrets / Variables | Đủ 2 secrets + 3 variables đúng tên, `BRIDGE_ENABLED=false` lúc setup |
| Từng repo A/B → Secrets / Variables | Đủ 1 secret + 1 variable Dispatch đúng tên |
| Client ID và PEM | Cùng thuộc đúng App, không lẫn Sync/Transport/Dispatch |
| Actions controller → policy | Success; job này kiểm tra code, **chưa chứng minh secrets hợp lệ** |
| Khi đã bootstrap và cấu hình đủ, bật bridge rồi Run workflow | Đủ 7 job reconcile thành công; A/main bằng B/main |
| Sự kiện PR tại A hoặc push main tại B | Notifier gọi controller, controller xử lý đúng cặp; không chỉ kiểm tra notifier Success |

GitHub không cho đọc lại giá trị secret sau khi lưu. Nếu nhập nhầm, cập nhật lại bằng PEM đúng. Không cần tự tạo hoặc lưu installation token dài hạn; workflow tự tạo token bằng Client ID + PEM và thu hồi khi kết thúc.

[Cấu hình và nghiệm thu đầy đủ](github-app-setup.md) · [Source controller đã điền mapping XBrainVN → TechX](https://github.com/pho-veteran/xora-contribution-controller).
