# Nâng cấp controller: đồng bộ mọi nhánh TechX → XBrain

Mục tiêu: mỗi lượt reconcile đưa các branch head hiện có ở B sang cùng tên,
cùng commit SHA ở A. Giữ các nhánh riêng của A và luồng contribution hiện tại.
Đây là nâng cấp controller; không đổi sang cơ chế gửi PR thủ công ở A.

Production hiện dùng `XBrainVN` và `TechX-Corp`. Một số hướng dẫn/template ban
đầu trong repo này còn dùng tên ví dụ `TechX`; giữ registry, tên controller,
App slug và runner đúng với installation đang vận hành.

## 1. Hành vi sau nâng cấp

| Tình huống | Controller xử lý |
|---|---|
| Nhánh có ở B, chưa có ở A | Tạo cùng tên tại A, giữ nguyên SHA |
| Nhánh B tiến thêm commit | Fast-forward nhánh A tới SHA B |
| Nhánh cùng tên lệch lịch sử | Atomic push: lưu SHA A cũ vào `recovery/b-sync-<hash-tên-nhánh>-<sha-cũ>`, rồi cập nhật A theo B |
| Nhánh chỉ có ở A | Giữ nguyên, không đẩy sang B |
| Nhánh đã đồng bộ nhưng bị xóa ở B | Giữ lại ở A; không prune nhánh remote A |
| Nhánh A là head của PR đang mở, SHA khác B | `deferred-open-pr`: giữ contribution; reconcile lại sau khi PR đóng |
| A thay đổi trong lúc đang sync | Lease từ chối ghi đè; báo lỗi để chạy lại |
| B thay đổi sau fetch và trước kiểm tra | Không ghi snapshot cũ; báo lỗi để chạy lại |
| Recovery bị chiếm hoặc tên nhánh xung đột (`foo` / `foo/bar`) | Không xóa/ghi đè để cưỡng ép; báo lỗi nhánh đó |
| Một nhánh lỗi | Vẫn xử lý các nhánh khác và PR; cuối lượt báo FAIL |

`main` tiếp tục dùng logic reconcile/recovery đã có. Các nhánh khác, gồm `dev`,
`release/*` và `incoming/a-pr-*`, được liệt kê từ B, không lấy tên ref do event
gửi vào làm lệnh ghi. Không đồng bộ tags, không dùng `git push --mirror`.

Ngoại lệ PR mở được hiển thị trong Actions summary và JSON report; run thành
công không có nghĩa nhánh `deferred-open-pr` đã trùng B. Hai repo không có
transaction chung: B có thể tiến thêm sau lần kiểm tra; lượt sau sẽ reconcile
snapshot mới. Không cam kết đồng bộ tức thời.

Luồng A → B vẫn chỉ là contribution PR hiện tại: tạo/cập nhật
`incoming/a-pr-N`, mirror review/comment, B quyết định merge/đóng và bot cập nhật
trạng thái ở A. Không bổ sung mirror tất cả nhánh theo chiều A → B.

## 2. Những file controller cần cập nhật

Nguồn dùng lại: [controller mẫu](https://github.com/pho-veteran/xora-contribution-controller)
hoặc [template trong repo này](templates/controller).

| File | Thay đổi |
|---|---|
| `scripts/branch-sync.mjs` | File mới: lấy toàn bộ B heads, giữ A-only, backup/lease, defer PR mở và báo trạng thái từng nhánh |
| `scripts/pr-bridge.mjs` | Import helper; sync main và xử lý contribution PR trước, rồi quét B heads để lấy cả incoming mới trong cùng lượt; tổng hợp lỗi và Actions summary |
| `tests/branch-sync.test.mjs` | Test Git thật trên local: tạo nhánh, fast-forward, divergence, recovery, race, xóa B, PR mở và idempotency |
| `tests/pr-bridge-orchestration.test.mjs` | Cập nhật fixture; kiểm lỗi sync nhánh không làm mất luồng contribution |

Không thay `bridge.config.json`, secrets, App identity hoặc runner bằng giá trị
lab. Nếu controller production đã tùy biến base branch (ví dụ `dev` của
`xora-resolve-be`), áp diff vào bản đang dùng và giữ mapping đó; không chép đè
toàn bộ engine mẫu vốn dùng `main` cho contribution. Module sync nhánh mới xử lý
`dev` như các nhánh B khác; nó không tự đổi base PR.

Trong controller trusted, chạy:

```bash
node --check scripts/branch-sync.mjs
node --check scripts/pr-bridge.mjs
node --test tests/*.test.mjs
```

Đưa code/test qua review vào `main` của controller private. Không checkout hoặc
chạy code sản phẩm từ các nhánh được đồng bộ trong job giữ App token.

## 3. Workflow và App cần setup lại gì?

**Với workflow hiện tại của bộ mẫu: không cần sửa YAML, tạo App hoặc cấp quyền
mới.** Workflow đã checkout source controller, chạy `tests/*.test.mjs` trước khi
tạo token, và gọi `node scripts/pr-bridge.mjs`; file helper mới được lấy theo
cùng controller revision.

Giữ các điều kiện:

- Token App A chỉ bao phủ đúng một repo A mỗi job, có Contents/Pull requests/
  Workflows write như hiện tại. App A cần được phép ghi những nhánh cần đồng bộ
  và tạo `recovery/*`; protection không được vô tình chặn recovery.
- Token App B chỉ bao phủ đúng repo B của cặp; không thêm quyền ghi workflow
  hoặc quyền bypass B/main. Mirror nhánh mới chỉ dùng quyền đọc B; quyền ghi B
  hiện tại vẫn phục vụ contribution PR.
- `BRIDGE_ENABLED=true`, concurrency theo từng cặp repo và checkout trusted
  main của controller được giữ nguyên. Không dùng token rộng toàn installation.
- Khi sao nhánh có workflow từ B về A, workflow cũ vẫn có thể hiện diện ở A.
  Giữ chính sách chỉ chạy notifier tại A: disable workflow ứng dụng tại A hoặc
  giữ guard theo repository đã review. Không dùng `actions.enabled=false`.

**Trigger vẫn giữ nguyên:** notifier push hiện chỉ theo dõi main (hoặc nhánh
được cấu hình hiện tại). Push riêng lên nhánh B khác không tự gọi controller.
Các nhánh đó được reconcile ở lần chạy tiếp theo do PR/review/comment,
push nhánh được theo dõi, schedule 6 giờ hoặc Run workflow tại controller.
Việc này không thêm `workflow_dispatch` ở repo A.

Nếu sau này cần phản hồi ngay mọi push B, đó là thay đổi notifier riêng: mở
`on.push.branches` và bỏ điều kiện chỉ nhận ref main trong job B, nhưng vẫn giữ
guard đúng repository B và validation payload. Workflow phải tồn tại/đúng
trigger trên nhánh được push; chỉ sửa file trên main không đảm bảo mọi nhánh
cũ phát event. Schedule vẫn là fallback. Thay đổi tùy chọn này chưa được áp
dụng trong bản nâng cấp đang mô tả.

## 4. Protection và triển khai

[PR IaC XBrain #59](https://github.com/XBrainVN/github-repositories-iac/pull/59)
đề xuất chỉ App sync cập nhật main của 7 repo, thêm dev cho xora-resolve-be;
xóa các nhánh đó bị chặn kể cả bot. PR đó không bảo vệ tất cả feature branches,
không thay workflow và không tự triển khai thay đổi controller này.

1. Kiểm diff và tests trong controller private, giữ các cấu hình production.
2. Sau khi source đã được review và lên main, chạy controller với inputs trống
   để quét mọi cặp hoặc dùng event hợp lệ để chọn đúng cặp.
3. Xem kết quả từng job, phần **B-to-A branches**, và SHA nhánh thực tế ở A/B.
4. Với `deferred-open-pr`, hoàn tất/đóng PR theo quy trình rồi chạy lại.
5. Với `error`, kiểm protection, lease hoặc ref-prefix conflict; không force
   overwrite hay xóa recovery để làm run xanh.
6. Xác nhận một PR A vẫn tạo/cập nhật đúng PR B, feedback về A và B merge giữ
   nguyên commit identities trước khi kết luận rollout đạt.

Revert source controller dừng logic sync nhánh mới ở các lượt tiếp theo, nhưng
không tự đảo các refs đã đồng bộ. Nếu cần khôi phục, owner đối chiếu report,
SHA hiện tại và recovery rồi phục hồi bằng lease sau review.

## 5. Kiểm chứng

Tests local dùng Git thật cho ref/lease/recovery và API giả lập cho orchestration.
Chúng không thay thế kiểm chứng GitHub Apps và workflow trên lab.

Đã kiểm chứng live trên hai cặp repo private `Vihnnnn` ↔ `TF4-Phase3-TechX`.
Engine lab ở commit `24b1b0e82bae37a7eefd8587f92672c40f961dad`; các file
engine/test giống controller mẫu và template đi kèm tài liệu này.
[Policy CI](https://github.com/TF4-Phase3-TechX/bot-bridge-controller/actions/runs/39457018024)
pass **60 tests**. Workflow/notifier và quyền App giữ nguyên.

| Cặp lab | Contribution test | Run sau sửa và sau merge |
|---|---|---|
| `bot-bridge-lab` | [A #19](https://github.com/Vihnnnn/bot-bridge-lab/pull/19) → [B #33](https://github.com/TF4-Phase3-TechX/bot-bridge-lab/pull/33) | [Cập nhật và mirror incoming cùng lượt](https://github.com/TF4-Phase3-TechX/bot-bridge-controller/actions/runs/39457131146), [B merge → A sync](https://github.com/TF4-Phase3-TechX/bot-bridge-controller/actions/runs/39457622580) |
| `bot-bridge-multi-lab` | [A #4](https://github.com/Vihnnnn/bot-bridge-multi-lab/pull/4) → [B #3](https://github.com/TF4-Phase3-TechX/bot-bridge-multi-lab/pull/3) | [Cập nhật và mirror incoming cùng lượt](https://github.com/TF4-Phase3-TechX/bot-bridge-controller/actions/runs/39457190170), [B merge → A sync](https://github.com/TF4-Phase3-TechX/bot-bridge-controller/actions/runs/39457635786) |

Đối chiếu GitHub API sau khi hoàn tất:

- Cả **34 branch heads ở B của cặp thứ nhất** và **7 branch heads ở B của cặp
  thứ hai** có cùng tên/SHA ở A, gồm cả `incoming` và nhánh trùng tên với PR test
  sau khi PR đã đóng.
- Nhánh riêng A giữ nguyên SHA, không xuất hiện ở B. Xóa một nhánh fixture ở B
  không xóa bản đã đồng bộ ở A.
- Cập nhật fast-forward, B rewrite và A/B divergence đều đúng kết quả; mỗi cặp
  có recovery giữ SHA trước replacement. Khi PR test còn mở, head A không bị
  nhánh B cùng tên ghi đè.
- Contribution được cập nhật qua ba revision; comment B được mirror về A;
  B merge giữ commit gốc, A/main trùng B/main và PR A đóng với thông báo Accepted.
- Main cuối cặp thứ nhất:
  `7b755763a73fe3301dd465f346e1369f23775b8e`; cặp thứ hai:
  `36b55705df2e6a0ac419eef53e8f47458e8f91c9`.
- Các PR có sẵn trước test vẫn mở, head SHA không đổi. Chỉ hai PR test được merge.

Đây là chứng minh trên lab; chưa triển khai controller mới vào `TechX-Corp`.
Kết quả không chứng minh PR IaC #59 đã apply hoặc protection production đã được
nghiệm thu. Link lab private cần quyền truy cập tương ứng.
