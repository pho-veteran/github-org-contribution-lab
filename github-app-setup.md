# Setup GitHub App để A đóng góp vào B

## 1. Phạm vi và cơ chế

A và B là hai repo private ở hai organization. Developer làm việc tại A; maintainer B quyết định review và merge. B/main là source of truth. Bot đồng bộ lịch sử đã được B chấp nhận về A/main; developer chỉ clone/pull repo A.

Cơ chế gồm:

- **GitHub App:** danh tính và quyền truy cập.
- **Script controller:** logic chuyển commit, ghép cặp PR, đồng bộ trao đổi và xử lý trạng thái.
- **GitHub Actions:** chạy script trên runner, tạo token và ghi log.

Cài App không tự tạo chức năng bridge. Phải có bộ mã controller và workflow tương ứng. Mỗi lượt chạy lấy installation token bằng private key trong Actions secrets; token được truyền qua biến môi trường và action thu hồi ở cuối job. Không dùng token cố định cho developer. [Xác thực GitHub App trong Actions](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/making-authenticated-api-requests-with-a-github-app-in-a-github-actions-workflow).

```text
Developer → feature branch và PR tại A
Controller → chuyển commit sang branch và mở PR tại B
B review ↔ A sửa code và trao đổi
Maintainer B merge → B/main thay đổi
Notifier tại B → dispatch controller
Controller → fast-forward A/main từ B/main → hoàn tất PR A
Developer → pull A/main
```

Ngoài hai repo code A và B, triển khai thêm **một repo controller private do B quản lý**. Repo này giữ code điều phối và key của hai App vận chuyển code. Developer A không cần quyền vào B hoặc controller.

## 2. Chuẩn bị

Ghi lại các giá trị trước khi cấu hình:

| Ký hiệu | Giá trị cần điền |
|---|---|
| `A_OWNER/A_REPO` | Organization và tên repo A |
| `B_OWNER/B_REPO` | Organization và tên repo B |
| `B_OWNER/CONTROLLER_REPO` | Repo controller do B quản lý |
| `APP_A_BOT` | Login bot của App A, gồm hậu tố `[bot]` |
| `APP_B_BOT` | Login bot của App B, gồm hậu tố `[bot]` |
| Nhánh chính | `main` tại cả ba repo |

Các tên trên là placeholder, cần thay bằng giá trị thật trong cấu hình và code.

Yêu cầu:

1. Admin hai organization phối hợp tạo/cài App; maintainer B được quản lý controller.
2. Actions được bật tại B và controller; chính sách org cho phép các action sử dụng trong workflow.
3. A/main và B/main ban đầu có cùng lịch sử Git, ưu tiên cùng SHA. Khởi tạo A từ lịch sử B bằng tài khoản được phép đọc B và ghi A; không tạo hai initial commit độc lập.
4. Nếu hai repo đã có lịch sử khác nhau, maintainer xử lý và xác nhận baseline trước khi bật đồng bộ. Controller không tự force-push hoặc giải quyết conflict.
5. B bật **Create a merge commit**; không dùng squash/rebase merge cho luồng giữ SHA commit gốc.
6. Nhận bộ mã controller đã được kiểm tra, gồm workflow, các module và tests ở mục 5. Không triển khai chỉ từ tên file hoặc cài App rồi chờ bot hoạt động.

Author/email trong Git có thể tự khai báo. Giữ metadata không chứng minh danh tính người tạo commit; nếu cần xác thực, yêu cầu ký commit và kiểm tra signer.

## 3. Tạo và cài ba GitHub App

B mở **Organization settings → Developer settings → GitHub Apps → New GitHub App**. Chọn tên riêng cho từng App, homepage của tổ chức, tắt webhook cho cơ chế Actions này. Không cần callback, user authorization hoặc device flow.

| Thiết lập | App A: đồng bộ A | App B: chuyển contribution | App dispatch |
|---|---|---|---|
| Nơi cho phép cài | Any account nếu A thuộc org khác | Only on this account của B | Only on this account của B |
| Installation | Chỉ repo A | Chỉ repo B | Chỉ repo controller |
| Contents | Read and write | Read and write | No access |
| Pull requests | Read and write | Read and write | No access |
| Workflows | Read and write | No access | No access |
| Actions | No access | No access | Read and write |
| Metadata | Read-only | Read-only | Read-only |
| Quyền khác và organization permissions | No access | No access | No access |

App A cần Workflows write để đồng bộ các thay đổi workflow đã được B chấp nhận. App B không có quyền này; controller chặn contribution sửa `.github/workflows/`. Maintainer B xử lý riêng các thay đổi workflow.

Với mỗi App:

1. Ghi **Client ID**, phân biệt với App ID.
2. Tạo private key trong trang quản lý App; lưu file PEM ngoài Git.
3. Chọn **Install App → organization đích → Only select repositories**, chọn đúng một repo theo bảng.
4. Admin A phê duyệt installation của App A tại A. Hai App còn lại được cài tại org B.
5. Nếu đổi permission, hoàn tất chấp nhận quyền mới ở installation trước khi chạy.

App B phải có Contents write để đẩy commit sang branch của repo B độc lập. Permission này không giới hạn theo nhánh. Không có cấu hình App “chỉ tạo PR nhưng tuyệt đối không thể ghi main/merge” đáp ứng luồng này; cần branch protection ở mục 7.

## 4. Đặt secrets và variables

Tại **Settings → Secrets and variables → Actions** của từng repo:

| Repo | Loại | Tên | Nội dung |
|---|---|---|---|
| Controller | Variable | `SOURCE_APP_CLIENT_ID` | Client ID của App A |
| Controller | Secret | `SOURCE_APP_PRIVATE_KEY` | Toàn bộ PEM App A, gồm BEGIN/END |
| Controller | Variable | `BRIDGE_APP_CLIENT_ID` | Client ID của App B |
| Controller | Secret | `BRIDGE_APP_PRIVATE_KEY` | Toàn bộ PEM App B |
| Controller | Variable | `BRIDGE_ENABLED` | `false` khi chuẩn bị; đổi thành `true` sau kiểm tra |
| B | Variable | `CONTROLLER_DISPATCH_APP_CLIENT_ID` | Client ID App dispatch |
| B | Secret | `CONTROLLER_DISPATCH_APP_PRIVATE_KEY` | Toàn bộ PEM App dispatch |
| A | — | — | Không đặt credential của bridge |

Key vận chuyển code chỉ nằm tại controller. Key dispatch tại B chỉ cấp Actions write trên controller. Quyền Actions write áp dụng toàn repo controller, không bị GitHub giới hạn vào một workflow; người được sửa workflow B nằm trong phạm vi tin cậy.

## 5. Triển khai controller

Đặt bộ mã bàn giao vào repo controller theo cấu trúc:

```text
.github/workflows/controller.yml
scripts/pr-bridge.mjs
scripts/pr-bridge-policy.mjs
scripts/pr-bridge-reviews.mjs
scripts/pr-bridge-comments.mjs
tests/*.test.mjs
```

| File | Chức năng |
|---|---|
| `pr-bridge.mjs` | Đọc trạng thái, chuyển Git objects/refs, gọi API PR/comment và đồng bộ main |
| `pr-bridge-policy.mjs` | Giới hạn mutation/ref; quyết định pending, accepted, rejected |
| `pr-bridge-reviews.mjs` | Đưa review đã submit và nội dung findings của B về A |
| `pr-bridge-comments.mjs` | Sao chép comment hai chiều, ghi nguồn và chống lặp |
| `controller.yml` | Chạy kiểm tra và cấp token cho job reconcile |

Trong bản controller dùng các hằng cấu hình, đặt:

```javascript
const source = 'A_OWNER/A_REPO';
const target = 'B_OWNER/B_REPO';
const bot = 'APP_B_BOT';
const sourceBot = 'APP_A_BOT';
const controllerRepo = 'B_OWNER/CONTROLLER_REPO';
```

Đổi đồng bộ repo allowlist, tên bot, owner/repositories trong workflow và fixture test. Không chỉ sửa các dòng trên nếu các file khác vẫn chứa giá trị của môi trường trước.

Workflow controller cần:

1. Trigger `workflow_dispatch` và `schedule`. Có thể dùng `7,22,37,52 * * * *` để chạy định kỳ; lịch Actions có thể bị trễ.
2. Inputs tùy chọn `source_repo`, `source_sha`, `source_run_id` để truy vết notifier; không dùng SHA từ input làm nguồn quyết định thay cho B/main thực tế.
3. Job kiểm tra chạy trước reconcile. Chạy kiểm tra khi code controller thay đổi qua push/PR, nhưng không cấp key và không reconcile từ các event đó.
4. Job reconcile chỉ chạy khi `BRIDGE_ENABLED == 'true'`, repo đúng controller, ref `refs/heads/main`, event là schedule hoặc workflow_dispatch.
5. Checkout main tin cậy của controller với `persist-credentials: false`; `GITHUB_TOKEN` chỉ Contents read. Serialize các lượt reconcile, không hủy lượt đang chạy.
6. Dùng `actions/create-github-app-token`, pin action bằng commit SHA đã kiểm tra. Token App A chỉ repo A với Contents/Pull requests/Workflows write; token App B chỉ repo B với Contents/Pull requests write.
7. Truyền token App A qua `SOURCE_TOKEN`, App B qua `BRIDGE_APP_TOKEN`, rồi chạy `node scripts/pr-bridge.mjs`.
8. Nếu có inputs notifier, truyền thành `TRIGGER_SOURCE_REPO`, `TRIGGER_SOURCE_SHA`, `TRIGGER_SOURCE_RUN_ID`; script xác thực đủ bộ giá trị.

Các guard của script phải còn hoạt động:

- Kiểm tra mỗi installation token chỉ thấy đúng một repo private đã cấu hình.
- Chỉ ghi branch `incoming/a-pr-<number>` ở B và `main` ở A; không force-push, không gọi merge endpoint ở B.
- Kiểm tra repo, base, head SHA và bot tạo PR trước khi cập nhật cặp PR. Không ghép cặp chỉ vì một comment có marker giống bot.
- Đồng bộ A/main chỉ khi có thể fast-forward từ lịch sử hiện tại sang B/main thực tế.
- Không checkout/chạy contribution, Git hooks hoặc dependencies của contribution trong job có key.
- Sao chép nội dung trao đổi như dữ liệu; giữ nguồn/tác giả, không thực thi comment như lệnh và không sao chép bot qua lại.

Trong clone controller, chạy:

```sh
node --check scripts/pr-bridge.mjs
node --test tests/*.test.mjs
```

Commit code đã cấu hình vào main, kiểm tra job policy thành công rồi bật `BRIDGE_ENABLED=true`. Maintainer B chạy **Actions → workflow controller → Run workflow → main** lần đầu, kiểm tra đúng repo/token scope và SHA hai main.

## 6. Setup workflow tại B và cách dùng A

Tại B, triển khai `.github/workflows/notify-controller.yml` sau khi controller đã nhận được dispatch. Phần trigger và điều kiện job:

```yaml
on:
  push:
    branches: [main]

permissions: {}

jobs:
  notify:
    if: github.repository == 'B_OWNER/B_REPO' && github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    # Các bước tạo token và dispatch được mô tả bên dưới.
```

Đây là phần cấu hình cần áp dụng vào workflow notifier của bộ mã bàn giao, không phải workflow hoàn chỉnh.

Notifier không checkout code. Các bước còn lại:

1. Tạo token App dispatch từ variable/secret ở B, giới hạn owner `B_OWNER`, repositories `CONTROLLER_REPO`, `permission-actions: write`.
2. Gọi `POST /repos/B_OWNER/CONTROLLER_REPO/actions/workflows/controller.yml/dispatches` bằng token đó.
3. Body có dạng sau; thay SHA/run ID bằng dữ liệu event thực tế:

```json
{
  "ref": "main",
  "inputs": {
    "source_repo": "B_OWNER/B_REPO",
    "source_sha": "<github.sha>",
    "source_run_id": "<github.run_id>"
  }
}
```

4. Cố định repo đích, tên workflow và ref trong code; không nhận endpoint từ PR/comment.
5. Kiểm tra HTTP thành công, ghi source SHA/run vào summary. Dispatch được nhận không đồng nghĩa reconcile đã thành công; kiểm tra run tại controller.

Push B/main, gồm merge PR, sẽ kích hoạt chuỗi này mà không phải chờ lịch. Thời gian hoàn tất phụ thuộc hàng đợi Actions. Push do `GITHUB_TOKEN` tạo không kích hoạt các workflow push tiếp theo; automation ghi B/main cần App token phù hợp hoặc gọi dispatch riêng. [Quy tắc trigger workflow](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow).

Tại A không cần workflow chứa credential để gửi contribution. Controller đọc PR A theo lịch. Workflow notifier được đồng bộ từ B sang A sẽ bị skip nhờ điều kiện đúng repo B.

Developer dùng tài khoản của mình tại A:

```sh
git clone https://github.com/A_OWNER/A_REPO.git
cd A_REPO
git switch main
git pull --ff-only origin main
git switch -c feature/change
# Sửa file.
git add path/to/file
git commit -m "Describe the change"
git push -u origin feature/change
gh pr create --repo A_OWNER/A_REPO --base main --head feature/change
```

Sau review, developer sửa và push tiếp trên cùng branch; viết comment nêu findings đã xử lý tại PR A. Không merge PR A. Sau khi B merge và bot đồng bộ:

```sh
git switch main
git pull --ff-only origin main
git log -5 --oneline
```

## 7. Bảo vệ nhánh và quyền

Private repo thuộc organization cần gói hỗ trợ branch protection, như Team/Enterprise, để cưỡng chế các quy tắc dưới đây. Guard trong script không thay thế giới hạn phía GitHub. [Phạm vi hỗ trợ và thiết lập protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches).

| Vị trí | Cấu hình |
|---|---|
| B/main | Require PR và review B; dismiss stale approvals; CI bắt buộc từ nguồn tin cậy |
| B/main | Restrict who can push: chỉ team/maintainer B; không thêm App B hoặc cấp bypass cho App B |
| B/main | Áp dụng hạn chế bypass; tắt force-push và deletion |
| A/main | Restrict who can push: chỉ App A; developer không được push hoặc merge vào main |
| A/main | Cho phép App A cập nhật trực tiếp bằng fast-forward; không áp yêu cầu PR/linear history chặn lịch sử merge nhận từ B |
| Controller/main | Chỉ B quản lý; review thay đổi script/workflow; không cho developer A sửa hoặc chạy code tùy ý tại đây |

Nếu dùng ruleset thay cho classic protection, kiểm tra phạm vi từng rule và quyền bypass của App A. Không cấp bypass rộng cho App B. CI contribution phải chạy tách khỏi job có key vận chuyển code; bảo vệ quyền sửa workflow/secret tại B và controller.

## 8. Trigger và kết quả cần kiểm tra

| Thao tác | Khi controller xử lý | Kết quả mong đợi |
|---|---|---|
| A mở PR hoặc thêm commit | Polling hoặc B dispatch | Một PR B tương ứng, head giữ SHA đóng góp; chưa đổi main |
| B Request changes | Polling hoặc B dispatch | A thấy nội dung review/findings và nguồn; PR vẫn mở |
| A/B comment | Polling hoặc B dispatch | Bản sao có tác giả/nguồn, không lặp vô hạn |
| B approve | Polling hoặc B dispatch | A thấy bản sao review; chưa đồng bộ code vào main |
| B merge bằng merge commit | Push B/main tự dispatch | A/main bằng B/main; PR A hoàn tất khi head đã được nhận |
| B đóng PR không merge | Polling hoặc B dispatch | Cặp PR bị rejected, A đóng không merge; contribution không vào main |
| B/main có commit khác | Push B/main tự dispatch | A nhận lịch sử mới nếu fast-forward được |
| A/main lệch khỏi lịch sử B | Lượt reconcile | Dừng và báo lỗi; không force-push |
| Chạy lại sau khi xử lý | Lượt reconcile | Không tạo thêm PR hoặc lặp comment đã sao chép |

Maintainer B nên ghi lý do khi đóng PR: sự kiện close tự nó không chứa nội dung giải thích. Controller sao chép comment lý do về A. Cặp bị rejected không tự mở lại; đề xuất mới dùng branch và PR mới từ A/main đã cập nhật.

Developer A chạy `git pull` hoặc comment `/bridge sync` không kích hoạt reconcile trong cơ chế này. Khi cần xử lý ngay PR/review/comment, maintainer B dùng Run workflow tại controller. Muốn A tự yêu cầu sync cần bổ sung một kênh yêu cầu có xác thực/quyền giới hạn; không đưa key vào A.

Khi nghiệm thu, thực hiện lần lượt mở PR → thêm commit → Request changes có nội dung → sửa/comment → approve → merge, rồi kiểm tra:

- SHA main tại A và B trùng nhau; SHA commit đóng góp không bị viết lại.
- Reviewer/maintainer B là người quyết định merge; bot không merge tại B.
- Notifier và reconcile đều Success, không chỉ riêng dispatch được chấp nhận.
- Tài khoản developer A không đọc được B/controller; A không có secret của bridge.
- Token mỗi App giới hạn đúng installation/repo; App B không có Workflows write.
- Quyền ghi/merge A/main và B/main bị chặn đúng theo protection bằng cả kiểm tra cấu hình và thử thao tác dự kiến bị từ chối.
- Thử đóng một PR khác không merge và chạy lại controller để kiểm tra trạng thái terminal, reason và chống tạo trùng.

## 9. Vận hành và bàn giao

Bàn giao source controller, notifier, tests, commit/version được triển khai, bảng repo/App/installation, tên secrets và người quản lý từng App. Bàn giao key qua kênh secrets được quản lý; không đưa PEM hoặc token vào tài liệu.

| Tình huống | Thao tác |
|---|---|
| Cần tạm dừng reconcile | Đặt `BRIDGE_ENABLED=false` và xử lý các run đang chạy; biến này không tự hủy job đã bắt đầu |
| Notifier thành công nhưng A chưa cập nhật | Kiểm tra controller run, job bị skip, token scope, protection và khả năng fast-forward |
| PR/comment chưa xuất hiện | Kiểm tra lịch/run controller hoặc B dispatch; không chờ notifier của main |
| Xoay key | Tạo key mới, cập nhật đúng secret, chạy kiểm tra rồi thu hồi key cũ |
| Key lộ | Thu hồi ngay key/installation bị ảnh hưởng, dừng job liên quan và kiểm tra log/audit |
| Main diverge | Tạm dừng, xác định commit ngoài luồng và để maintainer xử lý; không tự reset/force-push |

Theo dõi Actions minutes, run thất bại và thời gian đồng bộ. Lịch polling là cơ chế đọc sự kiện PR và phục hồi; không phải cam kết xử lý đúng một thời điểm.
