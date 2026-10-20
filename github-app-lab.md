# Lab contribute vào private repo: GitHub App và SSH deploy key

## 1. Vấn đề và giải pháp tổng thể

Team ở org A cần gửi code vào private repo của org B, giữ tác giả commit mà không thêm từng developer làm member/collaborator tại B. Với gói trả phí, các tài khoản được cấp quyền trực tiếp có thể làm tăng số seat.

| Thành phần | Môi trường lab |
|---|---|
| Repo A | `Vihnnnn/bot-bridge-lab` — private |
| Developer A | `vinh-xbrainn` |
| Repo B | `TF4-Phase3-TechX/bot-bridge-lab` — private |
| Maintainer B | `pho-veteran` |
| Repo controller | `TF4-Phase3-TechX/bot-bridge-controller` — private, do B quản lý |

Các ràng buộc:

- Không thêm developer A vào B. Commit gốc giữ SHA, author và committer; email liên kết với tài khoản GitHub của developer.
- B là source of truth và quyết định merge. Với cách 1, A/main là bản đồng bộ từ B/main; member A chỉ làm feature branch, mở PR, rồi pull kết quả từ repo A.
- Hai org dùng GitHub Free. Lab kiểm chứng luồng trên private repo, không đo hóa đơn Team. Branch protection cho private repo chưa được enforce; cấu hình cần bổ sung được ghi tại mục 2.4.
- Link repo/PR/Actions private cần tài khoản có quyền truy cập. Các ảnh trong tài liệu public là ảnh của lượt lab đã được công bố.

**Cách 1 — Hai repo, GitHub Apps và Actions**

```text
Member A clone/pull A/main → tạo feature branch → mở PR A, không merge
→ Controller đọc PR A, App B push branch đóng góp và mở PR B
→ Maintainer B review/test và merge vào B/main
→ App A fast-forward A/main về đúng SHA của B/main
→ GitHub ghi nhận PR A đã merge vì commit đã nằm trong A/main
→ Member A pull từ repo A
```

B chưa merge thì đóng góp vẫn nằm trên branch. B từ chối thì đóng góp không vào main. Bot không gọi API merge tại B và không tạo merge commit độc lập tại A. B dùng **Create a merge commit** để giữ nguyên commit gốc.

Luồng mới đã chạy thật ngày **20/10/2026**: PR A **#2** → PR B **#13** → B merge → App A đồng bộ → local pull từ A. Controller và key nằm trong repo riêng của B; member A không cần credential hoặc remote B.

App B cần `Contents: write` để chuyển commit sang branch của repo B độc lập. GitHub không có permission đủ cho luồng này mà chỉ cho mở PR, tuyệt đối không cho merge. Để cưỡng chế “B quyết định”, phải kết hợp quyền App với bảo vệ B/main ở mục 2.4.

GitHub App không tiêu thụ user seat. Actions của luồng mới chạy tại repo controller ở **org B**; chi phí phụ thuộc hạn mức và sử dụng của org này. Chi phí gói hỗ trợ branch protection là khoản riêng. [GitHub App và seat](https://docs.github.com/en/apps/creating-github-apps/about-creating-github-apps/deciding-when-to-build-a-github-app).

**Cách 2 — Một repo B, SSH deploy key**

```text
B cài deploy key có Allow write access
→ Developer clone B bằng SSH key → tạo branch → commit → push
→ Maintainer B mở PR, review và merge
→ Developer pull B/main bằng cùng SSH key
```

Deploy key không hết hạn theo giờ, chỉ cấp quyền Git cho repo được cài và không gọi API để mở PR. Người giữ key write có thể push main nếu chưa có bảo vệ nhánh. [Tài liệu deploy key](https://docs.github.com/en/authentication/connecting-to-github-with-ssh/managing-deploy-keys).

Cả hai cách giữ metadata tác giả, nhưng author/email tự cấu hình được nên chưa chứng minh danh tính người tạo commit. Nếu cần chống giả mạo, phải yêu cầu ký commit và xác minh signer. Lab chưa cấu hình ký commit. Credential App/SSH cũng không cấp cho tài khoản cá nhân A quyền mở giao diện private repo B.

## 2. Setup lab GitHub App

### 2.1. Tạo hai App và giới hạn quyền

Trong session `pho-veteran`, mở **TF4-Phase3-TechX → Settings → Developer settings → GitHub Apps → New GitHub App**. Tạo hai App do B quản lý:

| Thiết lập | App B — chuyển đóng góp | App A — đồng bộ kết quả |
|---|---|---|
| Tên | `TechX Vihnnnn Bridge Lab` | `TechX A Sync Lab` |
| Homepage | `https://github.com/TF4-Phase3-TechX` | `https://github.com/TF4-Phase3-TechX` |
| Nơi được phép cài | Only on this account | Any account, để cài vào org A |
| Contents | Read and write | Read and write |
| Pull requests | Read and write | Read and write |
| Metadata | Read-only | Read-only |
| Workflows | No access | Read and write |
| Webhook Active | Bỏ chọn | Bỏ chọn |
| Callback / user authorization / device flow | Không cấu hình | Không cấu hình |

App B đọc B/main, push branch đóng góp, mở/cập nhật PR. `Contents: read` không đủ để đưa commit vào repo B. Không cấp Administration, Actions write, Checks write, Commit statuses write hoặc quyền organization. [API tạo Git ref](https://docs.github.com/en/rest/git/refs#create-a-reference), [API merge PR](https://docs.github.com/en/rest/pulls/pulls#merge-a-pull-request).

App A đọc PR A, cập nhật comment/trạng thái và fast-forward A/main. Quyền Workflows write của App A cho phép đồng bộ cả thay đổi workflow đã được B chấp nhận. App B đã bỏ quyền này; contribution từ A thay đổi `.github/workflows/` bị controller chặn và cần maintainer B xử lý riêng.

### 2.2. Tạo key và cài đúng repo

1. Với mỗi App, mở **Credentials → Key pairs → New key**. Lưu file `.pem` ngoài repo; không commit key.
2. App B: **Install App → TF4-Phase3-TechX → Only select repositories → bot-bridge-lab → Install**.
3. App A: trong session `vinh-xbrainn`, mở [trang cài App A](https://github.com/apps/techx-a-sync-lab/installations/new), chọn **Vihnnnn → Only select repositories → bot-bridge-lab → Install**. Hoàn tất Confirm access nếu GitHub yêu cầu.
4. Khi đổi permission, kiểm tra installation đã nhận đúng quyền trước khi chạy controller.

| Thông tin đã kiểm tra | App B | App A |
|---|---|---|
| App ID | `5376504` | `5389681` |
| Client ID | `Iv23li2GwmLXhSNHA2Yh` | `Iv23liiZuDkx4OtpwZcz` |
| Installation ID | `172913981` | `173234412` |
| Repo được cài | `TF4-Phase3-TechX/bot-bridge-lab` | `Vihnnnn/bot-bridge-lab` |

“Any account” chỉ cho phép chủ org khác cài App A; không tự cấp quyền cho App vào mọi org. Controller vẫn kiểm tra đúng installation, org và repo đã định trước.

### 2.3. Chạy Actions trong controller riêng

Tạo private repo **`TF4-Phase3-TechX/bot-bridge-controller`**, chỉ maintainer B được quản lý. Tại repo này, mở **Settings → Secrets and variables → Actions**:

| Loại | Tên | Giá trị |
|---|---|---|
| Variable | `BRIDGE_APP_CLIENT_ID` | `Iv23li2GwmLXhSNHA2Yh` |
| Secret | `BRIDGE_APP_PRIVATE_KEY` | PEM của App B, gồm dòng BEGIN/END |
| Variable | `SOURCE_APP_CLIENT_ID` | `Iv23liiZuDkx4OtpwZcz` |
| Secret | `SOURCE_APP_PRIVATE_KEY` | PEM của App A, gồm dòng BEGIN/END |
| Variable | `BRIDGE_ENABLED` | `true` sau khi cài App và kiểm tra cấu hình |

Các file đã triển khai trong controller:

- [`.github/workflows/controller.yml`](https://github.com/TF4-Phase3-TechX/bot-bridge-controller/blob/main/.github/workflows/controller.yml): workflow **Isolated bridge - B decides**.
- [`scripts/pr-bridge.mjs`](https://github.com/TF4-Phase3-TechX/bot-bridge-controller/blob/main/scripts/pr-bridge.mjs): đọc PR, vận chuyển commit và đồng bộ main.
- [`scripts/pr-bridge-policy.mjs`](https://github.com/TF4-Phase3-TechX/bot-bridge-controller/blob/main/scripts/pr-bridge-policy.mjs): giới hạn API mutation, ref push và xử lý trạng thái.
- [`tests`](https://github.com/TF4-Phase3-TechX/bot-bridge-controller/tree/main/tests): 7 test cho trạng thái và giới hạn thao tác.

Controller chạy lịch ở phút **7, 22, 37, 52 mỗi giờ** hoặc được maintainer B bấm **Actions → Isolated bridge - B decides → Run workflow → main**. Cả chuyển PR sang B lẫn đồng bộ về A đều qua polling; mở PR tại A không kích hoạt ngay controller. Actions có thể bị trễ lịch.

Job `policy` kiểm tra code trước; job `reconcile` chỉ chạy trên main của đúng repo controller, khi bật `BRIDGE_ENABLED` và sự kiện là schedule/dispatch. Các lượt reconcile chạy tuần tự. `GITHUB_TOKEN` chỉ có Contents read để checkout controller; hai App tạo installation token giới hạn đúng một repo trong mỗi lượt chạy. Không lưu PAT cá nhân vào Actions.

Job có key chỉ checkout main của controller do B quản lý. PR A được đọc như dữ liệu và Git objects, không checkout/chạy code, hook hoặc dependency từ contribution. CI chạy riêng không nhận key bridge; các action được pin bằng commit SHA.

Lab đã tắt workflow cũ `bridge-to-b.yml` tại cả A và B, gỡ secret/variable bridge cũ tại A. API xác nhận **repo A có 0 Actions secrets**. Member A không có quyền đọc repo controller. Các file controller cũ có thể còn trong lịch sử repo lab, nhưng luồng đang chạy dùng repo controller riêng ở trên.

### 2.4. Guard đã triển khai và bảo vệ nhánh cần bổ sung

**Đã triển khai và kiểm tra**

| Kiểm tra | Kết quả |
|---|---|
| Token từng App chỉ thấy một repo private đã chọn | Pass |
| App A đọc repo B; App B đọc repo A | Cả hai nhận HTTP 404 |
| Tài khoản `vinh-xbrainn` đọc B và controller | Cả hai nhận HTTP 404 |
| Xin token App B với Workflows write | GitHub từ chối HTTP 422 |
| Repo A không chứa Actions secret | 0 secret |
| Controller không cho gọi merge endpoint, ghi ref ngoài phạm vi hoặc push B/main | 7 test policy/boundary pass; đây là guard trong code |

Controller chỉ push `incoming/a-pr-<số PR A>` tại B và `main` tại A; không force-push. Nó kiểm tra source SHA, base main, repo và tác giả App của PR ghép cặp trước khi cập nhật. Nội dung PR không được dùng làm lệnh shell. Khi A/main không còn là ancestor của B/main, controller dừng để maintainer reconcile.

**B/main: chỉ maintainer B được đưa code vào**

Hai org Free chưa enforce branch protection cho private repo. Vì App B có Contents write, credential này vẫn có thể ghi main/merge nếu được dùng ngoài controller. Muốn cưỡng chế bằng GitHub, cần gói hỗ trợ như Team/Enterprise; muốn cưỡng chế cả A và B thì cần hỗ trợ ở cả hai org. [Phạm vi branch protection](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches).

Tại B → **Settings → Branches → Add classic branch protection rule**, pattern `main`:

| Thiết lập đề xuất | Giá trị |
|---|---|
| Restrict who can push to matching branches | Chỉ maintainer/team B; không thêm App bridge |
| Require a pull request before merging | Bật |
| Require approvals | Ít nhất 1 review của B |
| Dismiss stale approvals when new commits are pushed | Bật |
| Restrict who can dismiss reviews | Chỉ maintainer B |
| Require status checks | CI bắt buộc của dự án, nguồn check tin cậy |
| Do not allow bypassing the above settings | Bật; không cấp bypass cho App bridge |
| Allow force pushes / Allow deletions | Tắt |

Chỉ yêu cầu review/CI chưa chặn bot merge sau khi checks pass. Danh sách được cập nhật main phải loại App B; hạn chế push cũng áp dụng khi merge PR. [Cấu hình protection](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/managing-a-branch-protection-rule), [giới hạn người push](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches#restrict-who-can-push-to-matching-branches).

Dùng **Create a merge commit**; tắt squash/rebase merge và không yêu cầu linear history để giữ SHA gốc. Đề xuất tắt auto-merge, không dùng merge queue trong luồng này. Nếu có release branch hoặc tag cần bảo vệ, bổ sung rule cho các ref đó; rule main không bảo vệ mọi ref.

**A/main: chỉ App A đồng bộ từ B**

App A đã được cài riêng. Đề xuất ruleset `Restrict updates` cho main, chỉ App A được bypass rule này. Tạo ruleset riêng chặn force-push/xóa và không cấp bypass. Không cần mở thêm PR đồng bộ tại A vì B đã quyết định. Member A không được push/merge main; không cho toàn bộ `github-actions[bot]` quyền bypass. [Quy tắc ruleset](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets).

**Controller và phạm vi tin cậy**

- Giữ hai key trong controller do B quản lý; bảo vệ main của controller và review thay đổi workflow/script. Người có quyền sửa controller/secret hoặc chính sách org thuộc phạm vi quản trị tin cậy. Không đặt lại key B ở repo A. [Bảo vệ GitHub Actions](https://docs.github.com/en/actions/reference/security/secure-use).
- Token App không giới hạn theo branch; guard trong script không thay thế branch protection. Nếu key từng bị lộ, phải thu hồi/đổi key; việc xóa secret tại A không thu hồi các bản key đã sao chép.
- B phải chấp nhận chia sẻ code và lịch sử reachable từ B/main với thành viên repo A. B private chặn truy cập trực tiếp, nhưng A vẫn đọc được bản sao đã đồng bộ. Controller chuyển trạng thái review cần thiết, không sao chép toàn bộ comment hoặc log nội bộ B.
- Nếu cần xác thực tác giả, bổ sung ký commit và kiểm tra signer; giữ tên/email không chống giả mạo.

Sau khi bật policy trên gói hỗ trợ, cần test thực tế: App B mở PR được nhưng không push/merge/force-push/xóa main; member A không push/merge main; maintainer B vẫn merge được và App A đồng bộ được. Test thêm stale approval, conflict, main lệch, token bị thu hồi và retry. **Các kiểm tra từ chối do branch protection này chưa chạy trong lab Free.**

### 2.5. Chuẩn bị máy cho cách 2

Máy lab dùng **PowerShell, Git và Windows OpenSSH**. Cách 2 không dùng App token; private key SSH được lưu ngoài repo. Các lệnh ở mục 4 chạy trực tiếp trong terminal. Cấu hình SSH được lưu riêng trong bản clone để các lần pull/push tiếp theo không cần cấp token mới.

Lab chưa bật branch protection. Deploy key có quyền write có thể push cả `main`; luồng dưới đây dùng branch và PR theo quy trình thao tác, chưa được cưỡng chế bằng chính sách server.

## 3. Triển khai cách 1 — PR tại A → B merge → Bot đồng bộ A → Pull

### 3.1. Clone A và tạo contribution

Đầu lượt test 20/10/2026, A/main và B/main cùng ở `490353ed51034262eff39a57d5fa82958f44e14a`. Developer dùng tài khoản `vinh-xbrainn` có quyền repo A. Các lệnh PowerShell tương ứng:

```powershell
git clone https://github.com/Vihnnnn/bot-bridge-lab.git
Set-Location bot-bridge-lab
git switch main
git pull --ff-only origin main
git switch -c feature/isolated-controller-20261020
git config user.name 'vinh-xbrainn'
git config user.email '335428864+vinh-xbrainn@users.noreply.github.com'

@(
  'A proposes code. B decides whether to merge. The isolated controller syncs accepted B history to A.'
  'Members of A pull only from repository A.'
) | Set-Content -LiteralPath case1-isolated-controller-20261020.txt -Encoding ASCII

git add case1-isolated-controller-20261020.txt
git commit -m 'Propose code through isolated B-authoritative controller'
git push -u origin feature/isolated-controller-20261020
```

Lượt lab tạo commit **`4576c841c95bc0b5b2e167fce4f648dc8956ea5d`**, author và committer đều là `vinh-xbrainn`. Khi tái hiện, dùng branch/file mới và email của chính developer; commit SHA mới sẽ khác.

### 3.2. Mở PR A, giữ chưa merge

Tại repo A, chọn **Pull requests → New pull request**, base `main`, compare branch vừa push. Title của lượt test: `Isolated controller: B decides, A pulls from A`.

[PR A #2](https://github.com/Vihnnnn/bot-bridge-lab/pull/2) được mở bởi `vinh-xbrainn`. Member A không merge PR này. Chờ lịch controller, hoặc maintainer B chạy workflow thủ công trong repo controller.

[Run chuyển PR 39357238773](https://github.com/TF4-Phase3-TechX/bot-bridge-controller/actions/runs/39357238773) thành công: App B mở [PR B #13](https://github.com/TF4-Phase3-TechX/bot-bridge-lab/pull/13) từ branch `incoming/a-pr-2`, head đúng `4576c84`. App A cập nhật comment ở A với trạng thái chờ B.

![PR A số 2 đang mở, App A báo chờ B duyệt PR số 13](proposal-images/case1-isolated-a-pr.png)

Ở bước này, API xác nhận hai main vẫn ở `490353e`; contribution chưa vào main của bên nào.

### 3.3. B review và merge PR

Maintainer B kiểm tra PR #13: một file mới, hai dòng thêm, head `4576c84` và tác giả commit gốc. [CI B 39357275418](https://github.com/TF4-Phase3-TechX/bot-bridge-lab/actions/runs/39357275418) pass. Đây là policy CI của lab; dự án thật cần thêm build/test của dự án.

Trong lượt test, `pho-veteran` gửi review **Approved** rồi merge bằng API với expected head SHA và phương thức `merge`. Khi thao tác bằng UI, chọn **Create a merge commit → Confirm merge**. App B chỉ tạo PR; quyết định merge dùng tài khoản maintainer B.

PR #13 được merge lúc **09:09:52 ngày 20/10/2026, giờ Việt Nam**, tạo commit **`7d2050b7ee5cba79c118ed0acbb1461300012490`**.

![PR B số 13 do App B mở, được pho-veteran review và merge](proposal-images/case1-isolated-b-merged.png)

### 3.4. App A đồng bộ kết quả B

Sau B merge, maintainer chạy **bot-bridge-controller → Actions → Isolated bridge - B decides → Run workflow → main**. Trong vận hành có thể chờ lịch polling thay cho thao tác này.

[Run đồng bộ 39357421342](https://github.com/TF4-Phase3-TechX/bot-bridge-controller/actions/runs/39357421342) hoàn tất **Success**. Job policy pass 7 test; reconcile dùng App A fast-forward A/main đến merge commit của B, không tạo một lần merge riêng tại A.

![Actions thành công, A/main sau đồng bộ trùng SHA B/main](proposal-images/case1-isolated-controller.png)

Kết quả kiểm tra lại bằng GitHub API:

| Thành phần | Kết quả |
|---|---|
| B/main | `7d2050b7ee5cba79c118ed0acbb1461300012490` |
| A/main | `7d2050b7ee5cba79c118ed0acbb1461300012490` |
| PR B #13 | Merged bởi `pho-veteran` |
| PR A #2 | Merged, actor `techx-a-sync-lab[bot]`, cùng merge SHA của B |
| Commit đóng góp | `4576c841c95bc0b5b2e167fce4f648dc8956ea5d` giữ nguyên tại cả A và B |
| Author / committer của commit đóng góp | `vinh-xbrainn`, email liên kết đúng tài khoản GitHub |

Summary Actions cũng liệt kê cặp PR cũ khi quét repository; evidence của lượt mới là hàng **A #2 / B #13**.

### 3.5. Member A pull từ repo A

Trong bản clone A, sau khi bot báo đã đồng bộ và working tree sạch:

```powershell
git remote -v
git switch main
git pull --ff-only origin main
git log -2 --format='%h | %an | %s'
Get-Content -LiteralPath case1-isolated-controller-20261020.txt
```

Đã chạy thật bằng credential của `vinh-xbrainn`. Bản clone chỉ có origin `https://github.com/Vihnnnn/bot-bridge-lab.git`, không có remote B. Pull nhận đúng file, HEAD bằng `7d2050b`, working tree sạch:

```text
7d2050b | Nguyen Thanh Vinh | Merge pull request #13 from TF4-Phase3-TechX/incoming/a-pr-2
4576c84 | vinh-xbrainn | Propose code through isolated B-authoritative controller
```

Để làm thay đổi tiếp theo, tạo feature branch mới từ main đã cập nhật. Nếu local main có commit riêng làm `--ff-only` thất bại, giữ công việc ở feature branch và reconcile; không push đè A/main.

### 3.6. Khi cần sửa hoặc có sai lệch

| Tình huống | Hành vi controller / thao tác cần làm |
|---|---|
| B chưa merge hoặc yêu cầu sửa | A tiếp tục commit trên feature branch; lượt polling cập nhật cùng PR B |
| B/main có code mới | Bot đồng bộ về A; developer merge main mới vào feature branch, xử lý conflict ở A |
| B đóng PR không merge | Đóng PR A với trạng thái rejected, không tự mở lại cặp PR |
| A đóng PR trước khi B merge | Đóng PR tương ứng tại B, coi là rút contribution |
| A có commit mới sau head mà B đã merge | Đồng bộ phần đã được B chấp nhận; phần mới cần PR mới từ main đã đồng bộ |
| B merge xong nhưng ghi A lỗi | Run báo lỗi; lần sau đọc lại refs và tiếp tục |
| A/main có lịch sử riêng chưa vào B | Dừng để maintainer reconcile, không force-push |
| Contribution A đổi `.github/workflows/` | Chặn chuyển contribution; maintainer B xử lý riêng |
| B đã chấp nhận thay đổi workflow vào main | App A có Workflows write để đồng bộ về A |

Branch B do bot quản lý. Developer thêm commit tại A, không rebase/force-push lịch sử đã chuyển. Lượt mới đã test thật luồng tạo PR → review/CI/merge tại B → đồng bộ A → local pull. Các nhánh lỗi và trạng thái khác có kiểm tra trong code/test; chưa chạy end-to-end từng tình huống trên hai repo thật.


## 4. Triển khai cách 2 — SSH clone B → Commit → PR → Merge → Pull

### 4.1. Tạo SSH key và cài vào repo B

Trên máy developer, mở PowerShell. Bước tạo key chỉ làm một lần; key dưới đây đã tồn tại trong máy lab, không ghi đè khi chạy lại:

```powershell
New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\.ssh" | Out-Null
$keyPath = "$env:USERPROFILE\.ssh\techx-bot-bridge-lab-deploy-ed25519"
ssh-keygen -t ed25519 -f $keyPath -C 'techx-bot-bridge-lab-deploy'
```

Trong lab, nhấn Enter hai lần ở câu hỏi passphrase để dùng key không có passphrase. Private key ở `C:\Users\T14s Gen 2\.ssh\techx-bot-bridge-lab-deploy-ed25519`, không đưa vào repository. File `.pub` là public key để cài ở B:

```powershell
Get-Content -LiteralPath "$keyPath.pub"
```

Thực hiện:

1. Mở **TF4-Phase3-TechX → Settings → Security and quality → Deploy keys**, chọn **Enabled → Save**. Chính sách này đã được bật cho toàn org theo xác nhận của chủ org; nó cho phép admin các repo tạo/sử dụng deploy key.
2. Mở **bot-bridge-lab → Settings → Deploy keys → Add deploy key**.
3. Title: `Case 2 SSH deploy key lab`. Dán nội dung file `.pub`, chọn **Allow write access**, rồi thêm key.

Key của lượt lab chỉ được cài vào `TF4-Phase3-TechX/bot-bridge-lab`. Fingerprint: `SHA256:NP7QJDS8osbtQQV/KWkK9Rdc4kKL5E5e2H68K2SZBL8`.

Key dùng được lâu dài cho đến khi bị xóa/thu hồi hoặc org tắt deploy keys. Người giữ private key có quyền Git tương ứng trên repo này; key không phân biệt từng người sử dụng.

### 4.2. Clone repo B và cấu hình SSH một lần

Lấy public host keys của GitHub qua HTTPS và lưu riêng để SSH kiểm tra máy chủ:

```powershell
$githubMeta = Invoke-RestMethod -Uri 'https://api.github.com/meta'
$githubMeta.ssh_keys | ForEach-Object { 'github.com ' + $_ } |
  Set-Content -LiteralPath "$env:USERPROFILE\.ssh\techx-lab-known-hosts" -Encoding ASCII
```

Đặt SSH command dùng đúng key của lab, rồi clone. Đường dẫn `~/.ssh/...` tránh lỗi dấu cách trong tên thư mục người dùng:

```powershell
$sshLabCommand = 'C:/Windows/System32/OpenSSH/ssh.exe -F NUL -i ~/.ssh/techx-bot-bridge-lab-deploy-ed25519 -o UserKnownHostsFile=~/.ssh/techx-lab-known-hosts -o IdentitiesOnly=yes -o IdentityAgent=none -o BatchMode=yes -o StrictHostKeyChecking=yes'
$env:GIT_SSH_COMMAND = $sshLabCommand

Set-Location 'C:\Users\T14s Gen 2\Desktop\workspace\org-contribute'
git clone git@github.com:TF4-Phase3-TechX/bot-bridge-lab.git .lab-work/ssh-case2
Set-Location .lab-work/ssh-case2

git config --local core.sshCommand $sshLabCommand
Remove-Item Env:GIT_SSH_COMMAND

git config user.name 'vinh-xbrainn'
git config user.email '335428864+vinh-xbrainn@users.noreply.github.com'
```

Tên/email xác định author và committer; dùng email đã liên kết với tài khoản GitHub của developer. Cấu hình `core.sshCommand` chỉ áp dụng cho bản clone này. Sau bước này, có thể mở terminal mới trong thư mục repo và dùng `git pull`, `git push` mà không cấp token.

Bản clone `.lab-work/ssh-case2` đã tồn tại sau lượt lab. Khi dùng tiếp, chỉ chuyển vào thư mục đó; không chạy lại `git clone`.

### 4.3. Tạo branch, file, commit và push

```powershell
git switch -c contribute/ssh-case2-20261019

Set-Content -LiteralPath 'case2-ssh-deploy-key-20261019.txt' `
  -Value 'Case 2: clone, push and pull with an SSH deploy key; PR opened by the B maintainer.' `
  -Encoding ASCII

git add case2-ssh-deploy-key-20261019.txt
git commit -m 'Add SSH deploy key contribution walkthrough'
git push -u origin contribute/ssh-case2-20261019
```

Lượt chạy ngày 19/10/2026 tạo commit `d62ab6e8f3e0f021e55bf60ab7249e4cc628cb0a`, author và committer đều là `vinh-xbrainn`. GitHub liên kết commit với tài khoản này. Push đã thành công bằng deploy key. Khi tái hiện lượt mới, dùng tên branch và tên file mới.

### 4.4. Người quản lý B mở và merge PR

SSH deploy key không tự mở PR. Trong session Edge của `pho-veteran`, mở repo B, chọn **Pull requests → New pull request**:

- Base: `main`.
- Compare: `contribute/ssh-case2-20261019`.
- Title: `Case 2: contribute with an SSH deploy key`.

Chọn **Create pull request**. Trong **Files changed**, kiểm tra file `case2-ssh-deploy-key-20261019.txt`; trong **Commits**, kiểm tra commit `d62ab6e` của `vinh-xbrainn`. Chọn **Create a merge commit → Confirm merge** để giữ SHA commit gốc.

Lượt này tạo [PR #9](https://github.com/TF4-Phase3-TechX/bot-bridge-lab/pull/9). Người mở và merge PR là `pho-veteran`; tác giả commit đóng góp là `vinh-xbrainn`. PR đã merge, tạo merge commit `e97d0cb0e26c025ce18386caf6a20c5ec9323f24`.

![PR số 9 của luồng SSH deploy key đã merge](proposal-images/case2-ssh-pr.png)

### 4.5. Pull về local

Trong thư mục `.lab-work/ssh-case2`, chạy:

```powershell
git switch main
git pull --ff-only origin main
git log -2 --format='%h | %an | %s'
Get-Content -LiteralPath case2-ssh-deploy-key-20261019.txt
```

Pull bằng cùng SSH key đã thành công. Local `main` nhận file mới và có lịch sử:

```text
e97d0cb | Nguyen Thanh Vinh | Merge pull request #9 from TF4-Phase3-TechX/contribute/ssh-case2-20261019
d62ab6e | vinh-xbrainn | Add SSH deploy key contribution walkthrough
```

Commit gốc vẫn giữ SHA, author và committer; working tree sau pull không có thay đổi chưa commit.
