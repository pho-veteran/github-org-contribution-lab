# Setup nhiều repo bằng script

## 1. Đầu vào và kết quả

**B có code gốc. A đã có các repo private cùng tên, chưa có code.** Máy setup đã có SSH truy cập hai org. Script nhận danh sách link B, suy ra A theo tên repo và triển khai một bridge dùng chung **3 App + 1 controller**.

| Script tự làm | Phần admin làm thủ công |
|---|---|
| Kiểm tra repo A/B, quyền admin, main, Actions và SSH | Đăng nhập `gh` cho hai tài khoản; xác nhận SSH/SSO nếu cần |
| Tạo riêng repo controller private nếu chưa có | Tạo/cài ba App, chọn repo, tải PEM |
| Bootstrap lịch sử B/main vào A/main rỗng | Review workflow B trước khi sao sang A |
| Sinh registry, triển khai controller và đặt secrets/variables | Review/merge PR notifier tại từng B |
| Mở PR notifier tại từng B, tái sử dụng khi chạy lại | Thiết lập/kiểm tra branch protection và CI ứng dụng |
| Kích hoạt reconcile; kiểm tra Actions, notifier và SHA hai main | Nghiệm thu một vòng PR contribution và quyền bị từ chối |

Script **không tạo repo A**, không tự merge PR B, không ghi đè A/main đã lệch và không tự thay controller/notifier khác cấu hình mong đợi. SSH dùng cho Git; `gh` dùng cho API, secrets và PR. SSH key không thay thế API credential.

[Script](setup/setup.mjs) nằm trong thư mục `setup/` ở root repo, dùng Node.js built-ins, không cần `npm install`. Giữ cả `setup/` và `templates/` khi tải source; script đọc bộ mẫu controller/notifier từ `templates/`. [Thiết kế và quyền chi tiết](github-app-setup.md).

## 2. Chuẩn bị một lần

Máy setup cần **Node.js 24, Git, OpenSSH và GitHub CLI**. Hai tài khoản `gh` cần quyền admin trên các repo tương ứng; tài khoản B cần quyền tạo repo controller. Với OAuth token của `gh`, cấp scope `repo`, `read:org`, `workflow`; hoàn tất SSO theo chính sách org.

```powershell
gh auth login --hostname github.com --git-protocol ssh --scopes repo,read:org,workflow
```

Đăng nhập cả hai tài khoản, kiểm tra bằng `gh auth status`. Script chọn tài khoản bằng `--account-a` / `--account-b`, không đổi tài khoản active toàn máy.

Hai SSH Host alias phải dùng đúng key có quyền đọc/ghi repo của mỗi bên, ví dụ trong `~/.ssh/config` đã có:

```sshconfig
Host github-a
    HostName github.com
    User git
    IdentityFile ~/.ssh/key-for-a
    IdentitiesOnly yes

Host github-b
    HostName github.com
    User git
    IdentityFile ~/.ssh/key-for-b
    IdentitiesOnly yes
```

Dùng alias thực tế của máy, không cần tạo lại key. Nếu cùng một SSH identity truy cập cả hai org, có thể dùng `github.com` cho cả hai. Key có passphrase phải được nạp vào SSH agent. Kiểm tra kết nối và xác nhận host GitHub từ trước; script dùng `BatchMode=yes`, `StrictHostKeyChecking=yes`, không tự chấp nhận host mới.

## 3. Nhập link B và kiểm tra repo

Trong thư mục repo docs, tạo `repos-b.txt`, mỗi dòng một URL:

```text
https://github.com/B_OWNER/project-1
https://github.com/B_OWNER/project-2
https://github.com/B_OWNER/project-3
https://github.com/B_OWNER/project-4
https://github.com/B_OWNER/project-5
https://github.com/B_OWNER/project-6
https://github.com/B_OWNER/project-7
```

Thay tên thật, đúng chữ hoa/thường GitHub trả về. Các repo B phải private, không phải fork, cùng org và có default branch `main`. A tương ứng phải private, độc lập và rỗng. Khi chạy lại, A có main cùng lịch sử/đi sau B vẫn được chấp nhận.

```powershell
node setup/setup.mjs init --repos repos-b.txt --org-a A_OWNER --account-a ADMIN_A --account-b ADMIN_B --ssh-a github-a --ssh-b github-b --dir .bridge-setup
node setup/setup.mjs prepare --dir .bridge-setup
```

`init` chỉ ghi local; mặc định controller là `B_OWNER/contribution-controller`, đổi bằng `--controller TEN_REPO` khi init. Thư mục `--dir` phải mới hoặc rỗng. Script sinh `setup.json` gồm mapping và SSH aliases; `.gitignore` tại đó chặn commit dữ liệu setup.

`prepare` kiểm tra toàn bộ A/B trước khi tạo controller. Repo A thiếu sẽ báo lỗi, không tự tạo. Script không mở quyền Actions nếu org đang chặn; admin phải bật theo chính sách hiện có.

## 4. Cài App và điền cấu hình

Tạo ba App theo [bảng permissions](github-app-setup.md#2-chuẩn-bị-và-tạo-ba-app--làm-một-lần), tắt webhook:

| App | Installation — Only select repositories | Repository permissions |
|---|---|---|
| App A / Sync | Chọn các repo A | Contents, Pull requests, Workflows: write |
| App B / Transport | Chọn các repo B | Contents, Pull requests: write |
| App Dispatch | Chỉ controller | Actions: write |

Metadata read-only; các quyền khác để No access. App A phải cho phép cài ở org A. Có thể tái sử dụng ba App có đúng permissions; thêm repo vào installation, giữ các repo đã chọn. Script kiểm tra đủ quyền và token từng repo trước khi cấu hình.

Trong `.bridge-setup/setup.json`, điền Client ID và đường dẫn PEM:

```json
"apps": {
  "source": { "clientId": "APP_A_CLIENT_ID", "privateKeyPath": "C:/Keys/app-a.pem" },
  "target": { "clientId": "APP_B_CLIENT_ID", "privateKeyPath": "C:/Keys/app-b.pem" },
  "dispatch": { "clientId": "DISPATCH_CLIENT_ID", "privateKeyPath": "C:/Keys/dispatch.pem" }
}
```

Đây là phần cần sửa trong JSON đã sinh, không phải thay toàn bộ file. Không dán nội dung PEM. Path tương đối được tính từ thư mục `--dir`.

Review workflow sẵn có tại B: deploy/CD chỉ chạy ở B, build/test contribution không nhận secrets hoặc token ghi. Sau đó đặt `manual.workflowsReviewed` thành `true`. **Chưa bật protection A/main chặn tài khoản bootstrap trước lần push đầu**; cấu hình quyền vận hành ở bước 6.

## 5. Chạy cấu hình tự động

```powershell
node setup/setup.mjs apply --dir .bridge-setup
```

Script lần lượt:

1. Chạy tests controller; kiểm tra API/SSH, App và installation cho mọi cặp.
2. Kiểm tra A/main hiện có là tổ tiên B/main; nếu lệch thì dừng trước khi triển khai.
3. Đưa một bộ controller với registry đã sinh lên controller/main; bridge ban đầu tắt.
4. Đặt key App A/B tại controller; chỉ đặt key Dispatch ở từng A/B. PEM truyền qua stdin cho `gh secret set`, không đưa vào command arguments hoặc Git.
5. Fetch Git objects từ B qua SSH rồi push main vào A rỗng, giữ SHA/author/committer. Không checkout/chạy code B. Ref main chỉ được tạo khi vẫn chưa tồn tại.
6. Tạo branch `setup/contribution-bridge` và PR notifier ở từng B. B/main chưa bị thay đổi.

Kết quả và link PR nằm trong `.bridge-setup/apply-report.json`. Nếu lỗi giữa chừng, sửa nguyên nhân rồi chạy lại cùng lệnh: repo/ref đã có được đối chiếu, PR mở được tái sử dụng. Không có rollback tự động cho các bước đã hoàn tất.

**Phạm vi SSH này chỉ là setup trên máy admin.** Controller Actions vẫn dùng installation token của App; không đưa SSH private key của admin lên GitHub.

## 6. Duyệt và kích hoạt

Maintainer B review/merge các PR notifier. B/main lúc này đi trước A; notifier có thể gửi dispatch nhưng controller vẫn tắt trong lần setup mới.

Thiết lập và thử [protection/CI](github-app-setup.md#5-quyền-và-guard-trước-khi-sử-dụng):

- A/main: chỉ App A cập nhật, hỗ trợ direct/force push cho reconcile; developer không push/merge.
- B/main: maintainer B quyết định, App B không có quyền bypass để push/merge main.
- Controller: chỉ B quản lý code, workflow và key.

Script không tự cấu hình protection vì còn phụ thuộc gói GitHub, teams, required checks và rulesets của tổ chức. `manual.protectionsReviewed=true` là **admin xác nhận đã kiểm tra**, không phải bằng chứng API tự xác minh. Không đánh dấu true chỉ để vượt bước trên repo chưa được bảo vệ.

Sau khi review xong, đặt `manual.protectionsReviewed` thành `true`, rồi chạy:

```powershell
node setup/setup.mjs activate --dir .bridge-setup
```

Script kiểm tra notifier đã merge tại tất cả B, credentials, registry và policy controller đã Success, rồi bật `BRIDGE_ENABLED=true` và dispatch một lượt cho tất cả cặp. **`dispatched-not-yet-verified` chưa phải hoàn tất.**

Chờ Actions rồi kiểm tra:

```powershell
node setup/setup.mjs verify --dir .bridge-setup
```

Chỉ trả `configuration-and-main-sync-verified` khi mọi cặp có A/main = B/main, notifier đúng ở cả hai bên và một lượt reconcile tất cả cặp sau activate đã Success. Exit code `2` nghĩa là chưa sẵn sàng; đọc report, chờ/xử lý lỗi rồi chạy verify lại. Secrets được kiểm tra tên/Client ID và kết quả Actions; GitHub không cho đọc ngược giá trị secret.

Cuối cùng mở một PR contribution thật tại A → thêm commit → B Request changes → A sửa/comment → B approve và **Create a merge commit**. Kiểm tra PR A đóng, main trùng và commit gốc giữ identity. Thử thêm một cặp để xác nhận định tuyến. B vẫn là source of truth; không ép phương thức merge bằng repo settings.

## 7. Chạy lại và giới hạn

| Trạng thái | Xử lý |
|---|---|
| A thiếu hoặc tên khác B | Tạo/sửa repo đúng trước; script không tạo A |
| SSH lỗi | Kiểm tra alias, agent, host key, SSO và quyền key trên repo/controller |
| App chưa được cài/chấp thuận quyền | Admin sửa installation rồi chạy apply lại |
| A/main có commit riêng | Backup và xử lý thủ công; setup không reset history |
| Controller/notifier có nội dung khác bộ sinh | Review/deploy thay đổi thủ công; script không overwrite cấu hình khác |
| Setup PR bị close không merge | Maintainer reopen hoặc xử lý branch/PR rõ ràng; script không tự mở lại |
| Policy/Actions đang chờ | Chạy activate/verify lại sau; không coi dispatch Success là reconcile Success |
| `setup.lock` còn sau khi process bị ngắt | Xác nhận không còn setup đang chạy rồi xóa riêng file lock |

Script hỗ trợ bootstrap Git history trên `main`; Git LFS/submodule cần chuẩn bị riêng. Không xóa repo/ref, không cấu hình merge-only, không sửa CI ứng dụng. Nâng cấp controller hoặc thêm cặp vào controller đang tùy biến cần review registry/workflow; đây là script triển khai ban đầu có thể tiếp tục sau lỗi, không phải công cụ tự ghi đè mọi cấu hình đang vận hành.

Kiểm tra script:

```powershell
node --test setup/setup.test.mjs
node --test templates/controller/tests/*.test.mjs
```

Tests setup dùng API giả lập cho nhiều cặp và Git thật tại local cho bootstrap, notifier, chạy lại và chống ghi đè. Chúng không thay thế nghiệm thu permissions/SSH/Actions thực tế trong môi trường nhận bàn giao.
