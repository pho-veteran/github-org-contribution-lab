# Proposal contribute giữa hai private repo bằng GitHub Apps và Actions

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
- B là source of truth và quyết định merge. A/main là bản đồng bộ từ B/main; member A chỉ làm feature branch, mở PR, rồi pull kết quả từ repo A.
- Hai org dùng GitHub Free. Lab kiểm chứng luồng trên private repo, không đo hóa đơn Team. Branch protection cho private repo chưa được enforce; cấu hình cần bổ sung được ghi tại mục 2.4.
- Link repo/PR/Actions private cần tài khoản có quyền truy cập. Các ảnh trong tài liệu public là ảnh của lượt lab đã được công bố.

**Giải pháp — Hai repo đóng góp và một controller riêng**

```text
Member A clone/pull A/main → tạo feature branch → mở PR A, không merge
→ Controller đọc PR A, App B push branch đóng góp và mở PR B
→ Maintainer B review/test và merge vào B/main
→ Sự kiện push tại B/main chạy notifier, App dispatch gọi controller
→ App A fast-forward A/main về đúng SHA của B/main
→ GitHub ghi nhận PR A đã merge vì commit đã nằm trong A/main
→ Member A pull từ repo A
```

B chưa merge thì đóng góp vẫn nằm trên branch. B từ chối thì đóng góp không vào main. Bot không gọi API merge tại B và không tạo merge commit độc lập tại A. B dùng **Create a merge commit** để giữ nguyên commit gốc.

Luồng hợp nhất đã chạy thật ngày **20/10/2026**, dùng cùng cặp PR **A #6 / B #18**: mở PR → thêm commit → Request changes → sửa và trao đổi comment hai chiều → approve → B merge → Actions reconcile A/main → PR A hoàn tất. Controller và key vận chuyển code nằm trong repo riêng do B quản lý; key dispatch chỉ nằm tại repo B; developer A chỉ dùng repo A.

App B cần `Contents: write` để chuyển commit sang branch của repo B độc lập. GitHub không có permission đủ cho luồng này mà chỉ cho mở PR, tuyệt đối không cho merge. Để cưỡng chế “B quyết định”, phải kết hợp quyền App với bảo vệ B/main ở mục 2.4.

GitHub App không tiêu thụ user seat. Actions notifier và controller chạy tại **org B**; chi phí phụ thuộc hạn mức và sử dụng của org này. Chi phí gói hỗ trợ branch protection là khoản riêng. [GitHub App và seat](https://docs.github.com/en/apps/creating-github-apps/about-creating-github-apps/deciding-when-to-build-a-github-app).

Giải pháp giữ metadata tác giả, nhưng author/email tự cấu hình được nên chưa chứng minh danh tính người tạo commit. Nếu cần chống giả mạo, phải yêu cầu ký commit và xác minh signer; lab chưa cấu hình ký commit. App token không cấp cho tài khoản cá nhân A quyền mở giao diện private repo B.

Một cặp PR được giữ xuyên suốt các lần sửa. Code đi A → B; review của B đi về A; comment hội thoại đồng bộ A ↔ B. Chỉ lịch sử đã được B merge mới được đưa vào A/main.

## 2. Setup lab GitHub App

### 2.0. Cơ chế thực thi và phạm vi bàn giao

GitHub App cung cấp **danh tính và quyền**, script quy định **hành vi**, còn GitHub Actions **chạy script** trên runner. Cài App vào repo chưa tạo ra chức năng bridge; phải triển khai cả code controller và các workflow.

| Thành phần | Trách nhiệm |
|---|---|
| App B | Cấp token để script đọc B, đẩy branch contribution và thao tác PR B |
| App A | Cấp token để script đọc PR A, đồng bộ A/main và cập nhật PR/comment A |
| App dispatch | Cấp token chỉ có Actions write tại controller để notifier B gọi workflow |
| Script trong controller | Ghép cặp PR; chuyển commit; sao chép review/comment; xử lý accepted/rejected; kiểm tra và fast-forward A/main |
| GitHub Actions | Khởi chạy script, cấp token trong job và ghi kết quả/log |

Mỗi lượt chạy, Actions dùng private key trong secrets để tạo installation token giới hạn repo và quyền. Script nhận token qua biến môi trường để gọi GitHub API và Git; action tạo token thu hồi token ở bước kết thúc job. Không cấp token hoặc private key này cho developer A. Không cần máy chủ bot chạy liên tục. [Cách dùng GitHub App trong Actions](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/making-authenticated-api-requests-with-a-github-app-in-a-github-actions-workflow).

| Sự kiện | Cơ chế hiện tại |
|---|---|
| B/main có commit mới, gồm merge PR | Notifier tại B tự dispatch controller; thời gian thực thi phụ thuộc hàng đợi Actions |
| A mở PR, thêm commit hoặc comment; B review/comment/đóng PR không merge | Controller đọc tại lượt polling tiếp theo hoặc khi maintainer B dispatch |
| Developer A chạy `git pull` | Chỉ tải trạng thái đã đồng bộ tại A; không kích hoạt controller |

Hướng dẫn triển khai trung lập nằm trong [Setup GitHub App cho A và B](github-app-setup.md). A và B là hai repo code; **controller là repo private thứ ba**, do B quản lý. Không chuyển key vận chuyển code vào A hoặc job chạy contribution để giảm số repo.

Bộ mã cần bàn giao là workflow controller, bốn module `pr-bridge*.mjs` và thư mục tests được liệt kê ở mục 2.3; notifier nằm tại B. Bản controller dùng cho evidence hiện tại là commit `4f4127610c0b6049d2284e5705e5e8a95fc76aaf`. Các liên kết source ở mục 2.3 là private: người tiếp nhận cần được B cấp quyền vào controller hoặc nhận bản source đã kiểm tra qua kênh bàn giao. File setup là hướng dẫn cấu hình, không thay thế bộ mã này. Không bàn giao private key qua repo docs public.

### 2.1. Tạo hai App vận chuyển code và giới hạn quyền

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
- [`scripts/pr-bridge-reviews.mjs`](https://github.com/TF4-Phase3-TechX/bot-bridge-controller/blob/main/scripts/pr-bridge-reviews.mjs): sao chép review đã submit và comment theo dòng của B về A.
- [`scripts/pr-bridge-comments.mjs`](https://github.com/TF4-Phase3-TechX/bot-bridge-controller/blob/main/scripts/pr-bridge-comments.mjs): sao chép comment hội thoại hai chiều, giữ nguồn và chống vòng lặp.
- [`tests`](https://github.com/TF4-Phase3-TechX/bot-bridge-controller/tree/main/tests): 16 test gồm 7 policy/boundary, 5 review và 4 đồng bộ hội thoại.

Khi **B/main có push mới**, gồm merge PR và commit trực tiếp, workflow tại B tự dispatch controller. Không cần maintainer bấm Run workflow hoặc đợi lịch để đồng bộ B/main về A/main. GitHub nhận sự kiện ngay; thời điểm job bắt đầu và hoàn tất vẫn phụ thuộc hàng đợi Actions.

Lịch **7, 22, 37, 52 mỗi giờ** được giữ để đọc PR/comment/review và phục hồi nếu notifier lỗi. Mở PR, push feature hoặc viết comment tại A vẫn chờ lịch này, hoặc maintainer B bấm **Actions → Isolated bridge - B decides → Run workflow → main**. Không coi các sự kiện đó là realtime trong lab.

Job `policy` kiểm tra code trước; job `reconcile` chỉ chạy trên main của đúng repo controller, khi bật `BRIDGE_ENABLED` và sự kiện là schedule/dispatch. Các lượt reconcile chạy tuần tự. `GITHUB_TOKEN` chỉ có Contents read để checkout controller; hai App tạo installation token giới hạn đúng một repo trong mỗi lượt chạy. Không lưu PAT cá nhân vào Actions.

Job có key chỉ checkout main của controller do B quản lý. PR A được đọc như dữ liệu và Git objects, không checkout/chạy code, hook hoặc dependency từ contribution. CI chạy riêng không nhận key bridge; các action được pin bằng commit SHA.

Lab đã tắt workflow cũ `bridge-to-b.yml` tại cả A và B, gỡ secret/variable bridge cũ tại A. API xác nhận **repo A có 0 Actions secrets**. Member A không có quyền đọc repo controller. Các file controller cũ có thể còn trong lịch sử repo lab, nhưng luồng đang chạy dùng repo controller riêng ở trên.

**App thứ ba chỉ dùng để kích hoạt controller**

1. B tạo `TechX Controller Dispatch Lab`: chỉ `Actions: read and write`, `Metadata: read`; các quyền khác No access, webhook tắt, chỉ cho cài tại org B.
2. Cài App với **Only select repositories → bot-bridge-controller**. Không cài App dispatch tại repo code A hoặc B.
3. Tại **repo B → Settings → Secrets and variables → Actions**, lưu variable `CONTROLLER_DISPATCH_APP_CLIENT_ID` = `Iv23li4rfDPJcho8vRzt`, secret `CONTROLLER_DISPATCH_APP_PRIVATE_KEY` = PEM của App dispatch. Key hai App vận chuyển code vẫn chỉ ở controller.
4. Deploy controller có inputs `source_repo`, `source_sha`, `source_run_id` trước; sau đó B thêm [`.github/workflows/notify-controller.yml`](https://github.com/TF4-Phase3-TechX/bot-bridge-lab/blob/main/.github/workflows/notify-controller.yml) vào main.

App dispatch đã cài: App ID `5390691`, installation `173256492`; API xác nhận chỉ thấy `TF4-Phase3-TechX/bot-bridge-controller`.

```text
B/main push
→ B: Notify controller on B main update
→ Token App dispatch, chỉ repo controller / Actions write
→ POST controller.yml/dispatches, ref=main
→ Controller: policy → reconcile
→ Đọc B/main thực tế → fast-forward A/main → cập nhật PR A
```

Notifier không checkout/chạy code contribution; `GITHUB_TOKEN` có `permissions: {}`. Repo đích, workflow và ref được cố định trong YAML. SHA và run ID chỉ để truy vết; controller không dùng SHA do người gọi gửi để thay thế B/main thực tế. Bản workflow được đồng bộ sang A nhưng job có điều kiện đúng repo B và `refs/heads/main`, nên bị skip ở A và không tạo vòng lặp.

`Actions: write` áp dụng toàn repo controller, **không phải quyền chỉ chạy một workflow**. Bảo vệ key dispatch và quyền sửa workflow B; không checkout code PR hoặc dùng `pull_request_target` với key này. Người sửa được workflow B có thể sử dụng credential dispatch. Controller vẫn phải kiểm tra repo/ref và giữ nguyên các guard ở mục 2.4.

Push do `GITHUB_TOKEN` tạo thường không kích hoạt workflow tiếp theo. Automation ghi B/main phải dùng GitHub App token phù hợp hoặc gọi dispatch rõ ràng; lab kiểm tra push và merge bằng tài khoản maintainer. Nếu push có chỉ thị skip CI hoặc Actions bị tắt thì notifier cũng không đảm bảo chạy; lịch controller là phương án phục hồi. [Quy tắc kích hoạt bằng token](https://docs.github.com/en/actions/concepts/security/github_token).

**Kiểm tra khi cài notifier:** commit trực tiếp `5c1db8e` tại B/main tự tạo [notifier run 39366960115](https://github.com/TF4-Phase3-TechX/bot-bridge-lab/actions/runs/39366960115), rồi [controller run 39366971430](https://github.com/TF4-Phase3-TechX/bot-bridge-controller/actions/runs/39366971430) sau 8 giây. Cả hai Success; A/main được fast-forward về đúng SHA của B. Phần 3 kiểm tra tiếp trường hợp merge PR.

![Kiểm tra push trực tiếp: App dispatch tự chạy controller và đồng bộ A/main](proposal-images/auto-02-direct-push.png)

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
- B phải chấp nhận chia sẻ code và lịch sử reachable từ B/main với thành viên repo A. B private chặn truy cập trực tiếp, nhưng A vẫn đọc được bản sao đã đồng bộ. Controller sao chép review đã submit và comment theo dòng của B về A, cùng comment hội thoại hai chiều của người có quyền write trở lên tại repo nguồn. B phải chấp nhận chia sẻ những nội dung này trên PR contribution; không dùng các PR đó để trao đổi nội dung chỉ dành nội bộ B. Log CI không được sao chép.
- Nếu cần xác thực tác giả, bổ sung ký commit và kiểm tra signer; giữ tên/email không chống giả mạo.

**Guard cho review và comment**

- Chỉ sao chép hội thoại của tài khoản người dùng được API xác nhận có quyền write/admin tại repo nguồn. Không dựa riêng vào `author_association`, vì App có thể thấy thành viên org là `CONTRIBUTOR`. API kiểm tra quyền dùng Metadata read hiện có. [API repository permission](https://docs.github.com/en/rest/collaborators/collaborators#get-repository-permissions-for-a-user). Bỏ qua comment do bot tạo để tránh vòng lặp A → B → A. Dùng ID comment nguồn để cập nhật bản sao; chỉ sửa comment do đúng App của đích đăng.
- Bản sao ghi người viết gốc, link nguồn và thời gian; nội dung được đặt trong khối văn bản để không kích hoạt ảnh, mention hoặc lệnh Markdown. Comment không có quyền approve hay merge. Quyết định review lấy từ API review của B, quyết định nhận code lấy từ B/main.
- Chỉnh sửa comment nguồn được cập nhật ở lượt sau; xóa comment nguồn chưa xóa bản sao. Không đồng bộ emoji reaction, trạng thái Resolve conversation, file đính kèm hoặc log CI. Reply trong review được chuyển theo review tương ứng; hội thoại từ A nên viết tại tab Conversation.
- Nội dung vượt giới hạn một comment làm run báo lỗi để maintainer tách nội dung, không âm thầm cắt bớt findings. Review giữ SHA và diff gốc; vị trí cũ được đánh dấu `outdated`. Approval của bản cũ không được diễn giải là approval của head mới.
- Nếu B từ chối và đóng PR không merge, bot đóng PR A với trạng thái rejected; không tự mở lại cặp đó. Nếu A có commit mới sau lúc B merge, controller không đánh dấu những commit chưa được B nhận là hoàn tất; cần PR mới cho phần còn lại.
- Nếu B nhận hotfix trong khi A còn làm feature, bot vẫn đồng bộ B/main về A/main. Developer pull A/main rồi merge main vào feature, tự xử lý conflict và push lại qua cùng PR. Bot không tự giải quyết conflict và không force-push để che sai lệch.

Sau khi bật policy trên gói hỗ trợ, cần test thực tế: App B mở PR được nhưng không push/merge/force-push/xóa main; member A không push/merge main; maintainer B vẫn merge được và App A đồng bộ được. Test thêm stale approval, conflict, main lệch, token bị thu hồi và retry. **Các kiểm tra từ chối do branch protection này chưa chạy trong lab Free.**

### 2.5. Kích hoạt reconcile thủ công

**Hiện tại — maintainer B kích hoạt**

Maintainer B vào **bot-bridge-controller → Actions → Isolated bridge - B decides → Run workflow → main**, hoặc chạy CLI bằng tài khoản có quyền tại controller:

```powershell
gh workflow run controller.yml --repo TF4-Phase3-TechX/bot-bridge-controller --ref main
```

Member A chưa tự chạy được lệnh này: họ không có quyền vào repo controller. GitHub yêu cầu quyền write để người dùng chạy workflow thủ công. `git pull` của developer chỉ tải A/main về local, không kích hoạt bot cập nhật A/main từ B. [Chạy workflow thủ công](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow).

**Đề xuất — developer yêu cầu từ PR A**

```text
Developer comment /bridge sync trên PR A
→ Webhook của App A gửi sự kiện đến endpoint do B quản lý
→ Endpoint xác minh sự kiện và quyền người yêu cầu
→ Credential riêng của endpoint dispatch controller.yml trên main
→ Controller đối chiếu trạng thái thật tại B, đồng bộ theo guard hiện có
→ App A cập nhật kết quả vào PR A
→ Developer pull origin main
```

Endpoint chỉ chấp nhận đúng lệnh, repo/installation đã cấu hình và người được phép yêu cầu sync. Xác minh chữ ký `X-Hub-Signature-256`, kiểm tra lại comment/người gửi qua API, chống xử lý trùng delivery và giới hạn tần suất. Repo controller, tên workflow và ref `main` được cố định phía server; comment không được chọn repo, ref hoặc lệnh thực thi. [Xác minh webhook](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries).

Dùng credential riêng chỉ cài tại controller với Actions write để dispatch; giữ credential ở endpoint do B quản lý, không đặt ở A và không mở rộng quyền App B vận chuyển code. Actions write là quyền cấp repo, không tự giới hạn vào một workflow; endpoint phải cưỡng chế danh sách thao tác được phép. Developer chỉ có quyền yêu cầu chạy lại, không có quyền merge, force-sync hay bỏ qua trạng thái review. [API workflow dispatch](https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event).

Đây là phần mở rộng **chưa triển khai**: cần endpoint chạy được từ Internet và cấu hình webhook App A; credential cho endpoint phải được cấp riêng. App dispatch ở mục 2.3 hiện chỉ phục vụ workflow B/main, chưa có endpoint nhận lệnh từ A. Lệnh `/bridge sync` hiện chưa có tác dụng trong lab. Nếu chỉ bổ sung đọc lệnh qua lịch polling thì không cần endpoint, nhưng vẫn phải đợi lịch; đó không phải kích hoạt ngay. Thời gian chạy sau dispatch cũng phụ thuộc hàng đợi GitHub Actions.

## 3. Triển khai — Một luồng từ contribution đến B merge và A reconcile

Lượt test ngày **20/10/2026** dùng duy nhất [PR A #6](https://github.com/Vihnnnn/bot-bridge-lab/pull/6) và [PR B #18](https://github.com/TF4-Phase3-TechX/bot-bridge-lab/pull/18). Mỗi ảnh dưới đây thuộc cặp PR này hoặc Actions xử lý cặp PR này.

Ảnh diff sửa và comment “đã xử lý” được chụp lại sau khi luồng hoàn tất để thấy đủ nội dung; badge Merged trên các ảnh đó là trạng thái lúc chụp. Commit, review và comment trong timeline ghi lại đúng thứ tự các bước.

```text
A mở PR → bot mở PR B
→ A thêm commit → bot cập nhật cùng PR B
→ B Request changes → bot đưa đầy đủ findings về A
→ A sửa diff + comment đã xử lý → bot chuyển code và comment sang B
→ B approve + phản hồi → bot đưa approval và comment về A
→ Maintainer B merge → B/main push kích hoạt notifier
→ App dispatch tự gọi Actions controller → reconcile A/main từ B/main
→ PR A hoàn tất → developer pull từ repo A
```

Tất cả lệnh developer dưới đây chỉ truy cập A. Các mốc chuyển PR, commit, review và comment trong lượt test dùng maintainer dispatch để quan sát ngay thay vì chờ lịch. Riêng sau B merge, notifier tự dispatch controller từ sự kiện push; không có thao tác Run workflow của maintainer. Không đặt credential controller ở A.

### Bước 1 — Developer tạo branch, commit và mở PR A

Đầu lượt test, A/main và B/main cùng ở `5c1db8e9700b777821cd4a8208f05d109a30b76b`. Developer dùng tài khoản `vinh-xbrainn`:

```powershell
git clone https://github.com/Vihnnnn/bot-bridge-lab.git
Set-Location bot-bridge-lab
git switch main
git pull --ff-only origin main
git switch -c feature/automatic-review-flow-20261020

@(
  'Decision owner: TODO.'
  'Main sync: TODO.'
) | Set-Content -LiteralPath automatic-review-flow.txt -Encoding ASCII

git add automatic-review-flow.txt
git commit -m 'Propose review workflow responsibilities'
git push -u origin feature/automatic-review-flow-20261020
```

Git author/email phải là thông tin của developer. Lượt lab dùng email đã liên kết với `vinh-xbrainn`; không dùng tên bot thay cho tác giả. Khi tái hiện, dùng branch/file mới; SHA sẽ khác.

Tại A chọn **Pull requests → New pull request**, base `main`, compare branch vừa push. Mở PR, không merge tại A. Commit đầu của lượt test là **`dd4552b`**.

![PR A số 6 do developer mở, có một commit và đang Open](proposal-images/flow-01-a-open.png)

### Bước 2 — Bot mở PR tương ứng tại B

Controller đọc PR A, chuyển nguyên commit sang branch `incoming/a-pr-6` và mở **PR B #18**. App A báo trạng thái chờ B tại PR A. [Run chuyển PR đầu tiên](https://github.com/TF4-Phase3-TechX/bot-bridge-controller/actions/runs/39367026771) đã thành công.

![App B mở PR số 18 từ contribution A số 6, giữ head và author gốc](proposal-images/flow-02-b-open.png)

Hai main vẫn ở baseline. Mở PR và push feature branch chưa đưa contribution vào main.

### Bước 3 — A thêm commit, bot cập nhật cùng PR B

Developer tiếp tục ngay trên branch đang mở:

```powershell
Add-Content -LiteralPath automatic-review-flow.txt -Value 'Review communication: mirrored comments between paired PRs.' -Encoding ASCII
git add automatic-review-flow.txt
git commit -m 'Add review communication detail while PR is open'
git push origin feature/automatic-review-flow-20261020
```

Commit thứ hai là **`f09883b`**:

![Danh sách hai commit trên branch A khi PR vẫn đang mở](proposal-images/flow-03-a-new-commit.png)

[Run cập nhật commit](https://github.com/TF4-Phase3-TechX/bot-bridge-controller/actions/runs/39367127332) đẩy head mới sang **cùng PR B #18**. Không mở thêm PR và không force-push.

![PR B số 18 có hai commit của developer, gồm commit mới f09883b](proposal-images/flow-04-b-updated.png)

### Bước 4 — B Request changes với hai findings cụ thể

Maintainer B kiểm tra diff tại head `f09883b` rồi chọn **Review changes → Request changes**:

1. Dòng 1: xác định maintainer B là người quyết định merge.
2. Dòng 2: mô tả bot fast-forward A/main từ B/main đã được chấp nhận; developer chỉ pull A.

Review yêu cầu developer sửa cả hai TODO và gửi SHA bản sửa trong comment PR. `pho-veteran` đã gửi review tổng thể cùng hai comment theo dòng.

![B gửi Request changes với nội dung tổng thể và hai findings theo dòng](proposal-images/flow-05-b-request-changes.png)

### Bước 5 — A đọc đầy đủ review ngay tại PR A

Controller chuyển review đã submit về A. App A đăng comment gồm trạng thái, reviewer, SHA đã review, toàn bộ nội dung tổng thể, file, dòng và đoạn diff của từng finding.

![PR A nhận đầy đủ yêu cầu sửa của B, gồm cả hai findings và vị trí trong diff](proposal-images/flow-06-a-findings.png)

Developer không cần mở private repo B để hiểu việc phải làm. Đây là bản sao do App A đăng, không phải GitHub review trực tiếp của `pho-veteran` tại A. `Git mergeability: clean` chỉ nói không conflict; không đồng nghĩa được approve.

### Bước 6 — A sửa diff và comment “đã xử lý findings”

Developer sửa cùng branch:

```powershell
@(
  'Decision owner: B maintainer.'
  'Main sync: the bot fast-forwards A/main from accepted B/main; developers pull only A.'
  'Review communication: mirrored comments between paired PRs.'
) | Set-Content -LiteralPath automatic-review-flow.txt -Encoding ASCII

git diff
git add automatic-review-flow.txt
git commit -m 'Address both B review findings and clarify main synchronization'
git push origin feature/automatic-review-flow-20261020
git rev-parse HEAD
```

Commit sửa của lượt test là **`2c03f875b7e453ae88753a9d2c2f14bf9efa0ac3`**:

![Diff mới tại A thay hai TODO bằng nội dung đáp ứng findings của B](proposal-images/flow-07-a-fixed-diff.png)

Trong **Conversation** của PR A, developer gửi comment ghi rõ findings đã xử lý, nội dung từng sửa đổi và SHA bản sửa; không chỉ viết “done”.

![Developer A comment đã xử lý finding 1 và 2, nêu SHA và nội dung sửa](proposal-images/flow-08-a-addressed.png)

Controller đưa commit mới và comment này sang PR B #18. Comment tại B ghi rõ người viết gốc là `vinh-xbrainn`, kèm liên kết comment nguồn. App đăng bản sao bằng identity của App, không giả danh developer.

![PR B nhận comment đã xử lý findings từ A cùng SHA bản sửa](proposal-images/flow-09-b-addressed.png)

### Bước 7 — B approve bản sửa, comment và approval được đưa về A

B kiểm tra diff mới, comment của A và CI trên đúng head. `pho-veteran` gửi **Approve**, đồng thời comment xác nhận hai findings đã xử lý và B sẽ thực hiện merge.

![B approve đúng bản sửa và gửi phản hồi xác nhận findings đã xử lý](proposal-images/flow-10-b-approved.png)

Lượt controller tiếp theo đưa cả **review APPROVED** và **comment phản hồi của B** về A. PR A vẫn chưa được developer merge; approval chỉ là quyết định review, chưa thay đổi main.

![A nhận review APPROVED trên đúng commit sửa trong khi PR còn mở](proposal-images/flow-11-a-approval-reply.png)

![Comment phản hồi của maintainer B được sao chép đầy đủ về PR A](proposal-images/flow-11b-a-b-reply.png)

Comment hội thoại được sao chép **A ↔ B**; review đã submit và comment theo dòng của B được sao chép **B → A**. Bản sao ghi tác giả gốc và ngữ cảnh, nhưng không cấp quyền cho người A tại B. Comment “approve”, “merge” hoặc `/bridge sync` không phải lệnh điều khiển bot.

### Bước 8 — Maintainer B merge

Sau khi xác nhận đúng bản sửa, maintainer B chọn **Create a merge commit → Confirm merge**. Trong lab, thao tác dùng API với tài khoản `pho-veteran`, phương thức `merge` và expected head SHA. Bot không gọi merge endpoint.

![PR B số 18 được maintainer B merge sau Request changes và Approved](proposal-images/flow-12-b-merged.png)

Merge commit là **`40d3fb87978565ff8f9a2fd563887e7d8bdfcf3e`**. B/main là lịch sử đã được chấp nhận. Sự kiện push của merge này tự kích hoạt workflow notifier tại B; notifier gọi controller để cập nhật A/main.

### Bước 9 — B/main push tự kích hoạt Actions reconcile

Merge PR B #18 tạo sự kiện `push` tại B/main. [Workflow notifier tại B — run 39367442048](https://github.com/TF4-Phase3-TechX/bot-bridge-lab/actions/runs/39367442048) tự chạy và dùng App dispatch gọi `controller.yml` trên main. Không bấm Run workflow sau merge.

![B merge tạo push event và notifier tự gửi dispatch thành công](proposal-images/flow-12b-b-notify.png)

Workflow tại repo controller đọc ref B/main thực tế và kiểm tra A/main có thể fast-forward. App A đẩy đúng merge SHA của B vào A/main; không tạo merge commit độc lập tại A.

[Run 39367452216](https://github.com/TF4-Phase3-TechX/bot-bridge-controller/actions/runs/39367452216) hoàn tất **Success**; job policy pass 16 test và job reconcile báo cặp A #6 / B #18 là `accepted`.

![Actions thành công: A/main sau reconcile trùng B/main và cặp PR được accepted](proposal-images/flow-13-reconcile.png)

GitHub hiển thị “Manually triggered” cho event `workflow_dispatch`, kể cả khi API được bot gọi. Trong run này, actor là **`techx-controller-dispatch-lab[bot]`**; summary liên kết trực tiếp tới push workflow tại B và ghi SHA nguồn. Đây là chuỗi tự động, không phải maintainer dispatch.

Thời gian API ghi nhận ngày 20/10/2026, múi giờ Việt Nam:

| Mốc | Thời gian |
|---|---|
| B notifier được tạo bởi push sau merge | 11:02:26 |
| Controller được App dispatch tạo | 11:02:33 |
| Job reconcile hoàn tất Success | 11:03:22 |

Controller được tạo **7 giây** sau notifier; toàn chuỗi tới lúc reconcile hoàn tất là **56 giây** trong lượt test. Đây là số đo thực tế, không phải cam kết độ trễ. Không chờ lịch polling; thời gian chạy còn phụ thuộc hàng đợi Actions.

CI trên PR B kiểm tra contribution; notifier báo main thay đổi; controller đồng bộ kết quả. Khi notifier được chép sang A, job tại A bị skip theo điều kiện repo, không dispatch ngược lại. API xác nhận A vẫn có **0 Actions secrets**.

### Bước 10 — PR A hoàn tất, developer pull từ A

Khi commit của feature đã nằm trong A/main, GitHub ghi nhận PR A là **Merged** (`state: closed`, `merged: true`). Comment của bot xác nhận B đã chấp nhận và SHA đã đồng bộ. Developer A không bấm merge PR A.

![PR A số 6 hoàn tất sau reconcile, bot báo accepted và cùng merge SHA của B](proposal-images/flow-14-a-completed.png)

Developer nhận code:

```powershell
git switch main
git pull --ff-only origin main
git log -4 --format='%h | %an | %s'
Get-Content -LiteralPath automatic-review-flow.txt
git remote -v
```

Đã chạy pull thật bằng tài khoản `vinh-xbrainn`: local HEAD, A/main và B/main đều bằng **`40d3fb87978565ff8f9a2fd563887e7d8bdfcf3e`**, working tree sạch. Kết quả log:

```text
40d3fb8 | Nguyen Thanh Vinh | Merge pull request #18 from TF4-Phase3-TechX/incoming/a-pr-6
2c03f87 | vinh-xbrainn | Address both B review findings and clarify main synchronization
f09883b | vinh-xbrainn | Add review communication detail while PR is open
dd4552b | vinh-xbrainn | Propose review workflow responsibilities
```

![File trên A/main chứa nội dung cuối đã được B chấp nhận](proposal-images/flow-15-a-main.png)

Các commit đóng góp gốc giữ nguyên SHA và author `vinh-xbrainn`; commit merge thuộc maintainer B. Bản clone chỉ có origin A. Lịch sử review và comment vẫn còn ở hai PR để tra cứu sau khi đóng.

### Edge case — B đóng PR mà không merge

Lượt test ngày 20/10/2026 dùng cặp [A #7](https://github.com/Vihnnnn/bot-bridge-lab/pull/7) / [B #19](https://github.com/TF4-Phase3-TechX/bot-bridge-lab/pull/19). Commit `fc2e1e5` thêm một đề xuất bỏ bước chấp thuận của maintainer B, để kiểm tra B từ chối contribution.

**1. A mở PR; controller tạo PR tương ứng tại B.** A vẫn ở trạng thái chờ quyết định của B, chưa cập nhật main.

![PR A số 7 đang mở và được ghép với PR B số 19](proposal-images/reject-01-a-open.png)

**2. Maintainer B ghi lý do rồi đóng PR không merge.** [Comment của B](https://github.com/TF4-Phase3-TechX/bot-bridge-lab/pull/19#issuecomment-6283311161) giải thích đề xuất vi phạm yêu cầu B giữ quyền quyết định, yêu cầu A không merge và dùng PR mới nếu có phương án khác. GitHub hiển thị **Closed with unmerged commits**.

![B đóng PR số 19, giữ nguyên commit chưa merge và nêu lý do từ chối](proposal-images/reject-02-b-closed.png)

**3. Controller đưa lý do về A và đóng PR A.** [Bản sao comment tại A](https://github.com/Vihnnnn/bot-bridge-lab/pull/7#issuecomment-6283316652) chứa đầy đủ nội dung, tác giả và link nguồn. Bot cập nhật trạng thái `rejected`, rồi đóng PR A; cả hai PR có `state: closed`, `merged: false`. Close không tự sinh lời giải thích, nên maintainer cần viết comment lý do.

![A nhận đầy đủ lý do từ B, trạng thái rejected và sự kiện bot đóng PR](proposal-images/reject-03-a-closed.png)

**4. Kiểm tra main và chạy lại controller.** [Run xử lý 39369155193](https://github.com/TF4-Phase3-TechX/bot-bridge-controller/actions/runs/39369155193) Success, summary ghi A #7 / B #19 là `rejected`. A/main và B/main trước/sau đều là `40d3fb87978565ff8f9a2fd563887e7d8bdfcf3e`.

![Controller xử lý rejected thành công, A/main và B/main không đổi](proposal-images/reject-04-controller.png)

[Run tiếp theo 39369234420](https://github.com/TF4-Phase3-TechX/bot-bridge-controller/actions/runs/39369234420) cũng Success. API xác nhận chỉ có một PR B ghép với A #7, vẫn đóng; chỉ có một bản sao comment lý do. Commit bị từ chối không nằm trong lịch sử hai main; file `rejected-contribution.txt` không tồn tại trên main ở cả hai repo. Developer đã pull A/main, local vẫn cùng SHA và không có file này.

Trong lượt test này, maintainer B dispatch controller để kiểm tra close và chạy lại. **Đóng PR không merge không tạo push B/main**, nên không gọi notifier của bước 9. Cơ chế hiện tại xử lý close qua polling hoặc maintainer dispatch; không phải trigger tự động ngay tại thời điểm close. Request changes giữ PR mở để sửa tiếp; rejected kết thúc cặp PR và không tự tạo lại. Muốn gửi đề xuất khác, A tạo branch và PR mới từ A/main đã cập nhật.
