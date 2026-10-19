# Lab contribute vào private repo: GitHub App và SSH deploy key

## 1. Vấn đề và giải pháp tổng thể

Team ở org A cần gửi code vào repo của org B. Nếu cấp quyền trực tiếp cho từng người ở B, các tài khoản đó có thể được tính vào số seat của gói trả phí. Yêu cầu là giữ được tác giả commit mà không thêm từng developer vào B.

| Thành phần | Môi trường lab |
|---|---|
| Org A | `Vihnnnn` |
| Developer A | `vinh-xbrainn` |
| Repo A | `Vihnnnn/bot-bridge-lab` |
| Org B | `TF4-Phase3-TechX` |
| Người quản lý B | `pho-veteran` |
| Repo B | `TF4-Phase3-TechX/bot-bridge-lab` |

Các ràng buộc:

- Cả hai repo đều private; developer A không được thêm vào member hoặc collaborator của B.
- Commit tại B giữ nguyên SHA, author và committer của commit gốc; email tác giả liên kết với tài khoản GitHub của developer.
- B là source of truth: `B/main` chứa code đã được chấp nhận. A gửi thay đổi qua PR; chỉ B quyết định merge. Với cách 1, `A/main` là bản đồng bộ của `B/main`, developer không tự merge hoặc push vào `A/main`.
- Hai org trong lab dùng GitHub Free. Lab mô phỏng quyền truy cập private repo, không đo hóa đơn GitHub Team. Các link repo, PR và Actions yêu cầu quyền truy cập lab; ảnh kết quả được nhúng trực tiếp trong tài liệu này.

Cách 1 dùng **GitHub App + Actions** để chuyển PR từ A sang B và đồng bộ kết quả đã được B chấp nhận về A. Cách 2 dùng **SSH deploy key** của riêng repo B để clone/pull/push; người quản lý B mở PR trên GitHub. Cả hai cách giữ tác giả commit và không thêm tài khoản developer vào B. Credential này không cấp quyền mở giao diện private repo B bằng tài khoản cá nhân của developer.

GitHub App không tiêu thụ user seat. Chi phí chạy Actions phụ thuộc hạn mức và mức sử dụng của org A. [Tài liệu GitHub về App và seat](https://docs.github.com/en/apps/creating-github-apps/about-creating-github-apps/deciding-when-to-build-a-github-app).

**Cách 1 — A gửi PR, B duyệt, bot đồng bộ kết quả về A**

```text
Developer tạo feature branch từ A/main đã đồng bộ với B/main
→ Mở PR vào A/main, giữ PR chưa merge
→ Bot chuyển nguyên commit sang branch tại B và mở PR tương ứng
→ B review; developer sửa tiếp tại A nếu cần
→ B merge PR vào B/main
→ Bot fast-forward A/main đến đúng kết quả đã được B chấp nhận
→ Bot xác nhận hoàn tất PR tại A
```

B chưa merge thì thay đổi vẫn nằm trên feature branch của A và branch PR của B. Khi B từ chối PR, code đó không được đưa vào main của bên nào. Mỗi tính năng dùng một branch riêng để B có thể duyệt độc lập.

Đây là luồng đề xuất thay thế cách 1. Lab trước đã kiểm chứng chuyển nguyên commit và mở PR bằng App; luồng PR A → PR B → đồng bộ về A chưa được triển khai/test end-to-end. Ảnh của luồng cũ không dùng làm bằng chứng cho luồng mới.

**Cách 2 — Clone trực tiếp repo B bằng SSH deploy key**

```text
B cài public key vào Deploy keys của repo, bật Allow write access
→ Developer clone repo B bằng SSH private key trên máy
→ Tạo branch, sửa file và commit với tên/email của developer
→ Push branch bằng SSH deploy key
→ Người quản lý B mở và merge PR trên GitHub
→ Local pull main bằng cùng SSH key
```

Cách 2 chỉ cần repo B trên GitHub; bản clone nằm trên máy developer. Deploy key không hết hạn theo giờ và không tạo user seat. Key chỉ dùng cho Git qua SSH, không gọi API để mở PR. [Tài liệu GitHub về deploy key](https://docs.github.com/en/authentication/connecting-to-github-with-ssh/managing-deploy-keys).

Author/email là metadata Git có thể tự cấu hình, nên việc hiển thị tài khoản trên commit chưa chứng minh người đó thực sự tạo commit. SSH deploy key xác thực quyền truy cập repo, không xác thực danh tính từng developer. Lab giữ metadata và dùng merge commit để giữ SHA; không cấu hình ký commit.

## 2. Setup lab GitHub App

### 2.1. Tạo App tại org B

Dùng session Edge đăng nhập `pho-veteran`, mở **TF4-Phase3-TechX → Settings → Developer settings → GitHub Apps → New GitHub App**.

| Trường | Giá trị |
|---|---|
| GitHub App name | `TechX Vihnnnn Bridge Lab` |
| Homepage URL | `https://github.com/TF4-Phase3-TechX` |
| Callback / user authorization / device flow | Không cấu hình |
| Webhook → Active | Bỏ chọn |
| Where can this GitHub App be installed? | `Only on this account` |

Trong **Repository permissions**, chọn:

| Permission | Quyền |
|---|---|
| Contents | Read and write |
| Pull requests | Read and write |
| Metadata | Read-only |
| Workflows | Read and write |

Workflows cần cho cách 1 vì lịch sử được chuyển có file trong `.github/workflows/`. Không cần cấp thêm quyền organization hoặc account. Bấm **Create GitHub App**.

### 2.2. Tạo key và cài App

1. Trong trang App, mở **Credentials → Key pairs → New key**, tải file `.pem` và lưu ngoài repo.
2. Chọn **Install App → TF4-Phase3-TechX → Only select repositories**.
3. Chọn duy nhất `bot-bridge-lab`, rồi **Install**.
4. Nếu đổi permission sau khi cài, chấp nhận quyền mới trong installation tại B.

Thông tin App đang dùng:

| Thông tin | Giá trị |
|---|---|
| App ID | `5376504` |
| Client ID | `Iv23li2GwmLXhSNHA2Yh` |
| Installation ID | `172913981` |
| Key trên máy lab | `C:\Users\T14s Gen 2\Desktop\techx-vihnnnn-bridge-lab.2026-10-18.private-key.pem` |

App đã được tạo và cài trong lab. Có thể xem tại [trang cấu hình App](https://github.com/organizations/TF4-Phase3-TechX/settings/apps/techx-vihnnnn-bridge-lab). Khi dựng môi trường khác, dùng tên App riêng và thay các ID/key tương ứng.

### 2.3. Cấu hình bổ sung cho cách 1

App tại mục 2.1–2.2 hiện chỉ được cài ở B. Để ghi về A bằng danh nghĩa bot và giữ App hiện tại ở chế độ private, đề xuất tạo thêm một GitHub App private tại org A, chỉ cài vào `Vihnnnn/bot-bridge-lab`. App A dùng Contents và Pull requests read/write, Metadata read; thêm Workflows write khi đồng bộ lịch sử có thay đổi workflow. Đây là cấu hình đề xuất, chưa tạo App A trong lab.

| Credential | Vai trò |
|---|---|
| App B hiện có | Đọc B/main, push branch đóng góp, mở/cập nhật PR tại B; không tự quyết định merge B |
| App A đề xuất | Đọc PR tại A, cập nhật A/main từ B, phản hồi trạng thái và hoàn tất PR tại A |

Workflow điều phối chạy tại A. Trong **Settings → Secrets and variables → Actions**, giữ `BRIDGE_APP_CLIENT_ID` và `BRIDGE_APP_PRIVATE_KEY` của App B; bổ sung variable `SOURCE_APP_CLIENT_ID` và secret `SOURCE_APP_PRIVATE_KEY` cho App A. Mỗi lần chạy cấp token riêng, giới hạn đúng repo của từng org.

Workflow mới theo dõi PR đang mở tại A, chuyển thay đổi sang B, đọc kết quả PR B và đồng bộ B/main về A. Có thể dùng lịch chạy định kỳ cùng `workflow_dispatch` để thực hiện toàn bộ vòng xử lý trong một nơi; việc cập nhật có độ trễ theo lịch chạy. App không cần bật webhook cho phương án này.

Hai file hiện có [bridge-to-b.yml](https://github.com/Vihnnnn/bot-bridge-lab/blob/main/.github/workflows/bridge-to-b.yml) và [bridge-actions.mjs](https://github.com/Vihnnnn/bot-bridge-lab/blob/main/scripts/bridge-actions.mjs) đang xử lý push vào A/main. Khi triển khai luồng mới, thay trigger và logic này bằng xử lý theo từng PR; tắt luồng cũ để tránh tạo thêm PR khi bot đồng bộ B/main về A.

Workflow/script điều phối phải lấy từ phiên bản đã được B chấp nhận, chỉ chạy tại repo A. Code từ branch PR chỉ được vận chuyển bằng Git, không được chạy trong job có private key/token. Build và test chạy ở job riêng không có credential bridge. Các file workflow dùng chung cần được duyệt vào B trước khi đồng bộ về A.

Thiết lập quy trình nhánh:

- A/main: chỉ bot đồng bộ kết quả từ B; developer tạo feature branch và PR.
- B/main: maintainer B review/test rồi dùng **Create a merge commit**, giữ SHA và metadata của commit gốc.
- B có hotfix hoặc PR nội bộ: sau khi được chấp nhận vào B/main, bot cũng đồng bộ về A.

Muốn cưỡng chế quyền ghi A/main bằng branch protection trên private repo của org cần gói GitHub Team/Enterprise. Với hai org Free trong lab, đây là quy ước thao tác; bot chỉ phát hiện sai lệch, không thể thay thế cơ chế chặn push/merge trên server. Không coi việc tiết kiệm seat ở B là bảo đảm tổng chi phí bằng 0 nếu cần nâng gói cho A. [Phạm vi hỗ trợ protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches).

### 2.4. Chuẩn bị máy cho cách 2

Máy lab dùng **PowerShell, Git và Windows OpenSSH**. Cách 2 không dùng App token; private key SSH được lưu ngoài repo. Các lệnh ở mục 4 chạy trực tiếp trong terminal. Cấu hình SSH được lưu riêng trong bản clone để các lần pull/push tiếp theo không cần cấp token mới.

Lab chưa bật branch protection. Deploy key có quyền write có thể push cả `main`; luồng dưới đây dùng branch và PR theo quy trình thao tác, chưa được cưỡng chế bằng chính sách server.

## 3. Cách 1 đề xuất — PR tại A → B duyệt → Đồng bộ main về A

### 3.1. Chuẩn bị cùng một main

Trước khi bật luồng mới, hai repo cần có cùng commit main đã được B chấp nhận. Với lab hiện tại, B có thêm commit của cách 2 nên cần kiểm tra và đồng bộ B/main về A trước khi tạo feature branch mới.

Bot chỉ tự fast-forward khi A/main là tổ tiên của B/main. Nếu A/main có commit riêng, dừng đồng bộ để maintainer quyết định: phần code cần giữ phải được đưa qua PR tại B và được B chấp nhận trước. Không force-push đè A hoặc tự đưa commit chưa duyệt từ A vào B.

### 3.2. Developer mở PR tại A

Developer lấy A/main mới nhất, tạo branch `feature/example`, thêm file hoặc sửa code rồi mở PR vào A/main. PR này là nơi gửi đóng góp và nhận trạng thái từ B; developer không bấm merge tại A.

Các tính năng độc lập bắt đầu từ main đã đồng bộ, không xếp nối trên branch của một tính năng chưa được B duyệt.

### 3.3. Bot mở và cập nhật PR tương ứng tại B

Bot chuyển nguyên commit của PR A sang branch `incoming/a-pr-<number>` ở B, rồi mở PR vào B/main. Mỗi PR A có đúng một cặp PR B đang xử lý; bot lưu liên kết hai chiều và SHA nguồn đã chuyển trong nội dung PR.

Developer push thêm commit vào branch A thì bot cập nhật cùng branch/PR tại B. B phải review và chạy test trên phiên bản SHA mới. Branch tại B do bot quản lý; các sửa đổi cho đóng góp được thực hiện tại A để tránh hai đầu cùng sửa một branch.

Bot phản hồi trạng thái và yêu cầu sửa từ B về PR A, vì developer A không có quyền đọc giao diện private repo B. Phạm vi phản hồi gồm kết quả review, trao đổi liên quan và trạng thái CI; không sao chép secret hoặc toàn bộ log nội bộ của B.

### 3.4. B review và quyết định merge

Maintainer B kiểm tra diff, author và kết quả CI rồi dùng **Create a merge commit**. B không squash/rebase nếu cần giữ nguyên SHA commit gốc.

| Tình huống tại B | Xử lý |
|---|---|
| Chưa review hoặc yêu cầu sửa | Giữ PR A chưa merge; developer tiếp tục sửa branch A |
| B/main có thay đổi mới | Bot đồng bộ main về A; developer merge A/main mới vào feature branch, sửa conflict và push để B review lại |
| Test thất bại hoặc conflict chưa xử lý | Chưa merge B; bot phản hồi trạng thái về A |
| Đóng PR không merge | Bot ghi nhận B từ chối và đóng PR A kèm lý do/liên kết; không tự mở lại cặp PR đó |
| Merge PR | Chuyển sang bước đồng bộ kết quả về A |

PR mới sau một lần từ chối là một yêu cầu duyệt mới. Developer tạo branch từ main đã được B chấp nhận và chỉ đưa vào các thay đổi muốn đề xuất lại.

### 3.5. Bot đồng bộ kết quả từ B về A

Sau khi B merge, bot fetch B/main và cập nhật A/main bằng fast-forward đến commit đã đọc từ B. Bot đưa về cả merge commit của B; không gọi một lần merge độc lập trên PR A.

Bot kiểm tra A/main đã chứa commit B vừa chấp nhận và toàn bộ head SHA của PR A trước khi báo hoàn tất. Nếu GitHub đã tự ghi nhận PR A merged thì giữ trạng thái đó; nếu PR còn mở dù toàn bộ commit đã có trong main, bot đóng PR với liên kết đến kết quả merge tại B. Đóng PR không được mô tả là một lần merge độc lập tại A.

Nếu developer push thêm commit vào PR A trong lúc B merge phiên bản cũ, bot chỉ đồng bộ phần B đã nhận và không đánh dấu toàn bộ PR A hoàn tất. Phần mới cần được tách sang một PR mới dựa trên main đã đồng bộ để B duyệt tiếp.

Các thay đổi được chấp nhận trực tiếp tại B, gồm hotfix và PR nội bộ, cũng đi qua chiều B/main → A/main. Vì đồng bộ bất đồng bộ, hai main có thể khác nhau tạm thời; khi xử lý xong và B không có thay đổi mới, hai đầu trỏ tới cùng SHA.

### 3.6. Khi đồng bộ gặp lỗi

Một workflow điều phối xử lý tuần tự cho cặp repo và đọc lại SHA trước khi cập nhật. Các lần chạy lặp lại dùng cặp PR và SHA đã lưu để không tạo PR hoặc thông báo trùng.

Nếu B merge thành công nhưng cập nhật A lỗi, bot đánh dấu **B đã merge, A đang chờ đồng bộ** và thử lại. Nếu A/main có commit ngoài quy trình, bot dừng và báo maintainer; không tự hợp nhất thay đổi đó vào B. PR A chỉ hoàn tất sau khi phần code tương ứng thực sự có trong A/main.

Lượt test tiếp theo cần đi đủ một luồng: tạo PR A → thấy PR B → sửa thêm tại A → B nhận đúng SHA mới → B merge → A/main nhận cùng merge commit → PR A hoàn tất. Luồng này chưa có ảnh kiểm chứng end-to-end trong bản proposal hiện tại.

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
