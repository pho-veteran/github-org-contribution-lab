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

Bản notifier mọi nhánh đi kèm một sửa lỗi từ lab: sau khi Git push tạo nhánh A,
REST có thể chưa thấy ref và trả `404`. `branch-sync.mjs` nay xác minh đúng SHA/ref
bằng `git ls-remote` với token A. Không retry ghi và không bỏ kiểm tra race;
test bao phủ REST chưa thấy ref và A đổi SHA ngay sau push.

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

**Controller workflow không cần đổi; notifier A/B cần cập nhật để bắt mọi
nhánh B. Không tạo App hoặc cấp quyền mới.** Controller đã checkout source controller, chạy `tests/*.test.mjs` trước khi
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

**Đường chính là CI:** B push → `notify-controller.yml` → dispatch trusted
`controller.yml@main` → reconcile cặp repo tương ứng, gồm mọi B branch head.
Không chờ schedule, không thêm nút `workflow_dispatch` ở repo A. Schedule
6 giờ giữ vai trò dự phòng; thời gian hoàn tất phụ thuộc hàng đợi Actions.

Cài [notifier mới](templates/notifier/.github/workflows/notify-controller.yml):

- `on.push.branches: ['**']` bắt mọi nhánh, kể cả `release/team/v1`; không bắt tags.
- Job push chỉ cho đúng repository B và ref `refs/heads/`; push ở A bị skip,
  kể cả push do bot sync. Luồng PR/review/comment hiện tại giữ nguyên.
- Concurrency push theo `github.ref`, tránh các nhánh khác nhau dùng chung
  một nhóm pending. Controller vẫn tuần tự theo cặp repo và đọc trạng thái
  hiện tại, không cam kết xử lý riêng từng revision trung gian.
- Token Dispatch vẫn chỉ có Actions write trên controller; notifier không
  checkout hoặc chạy code sản phẩm. Payload vẫn gửi SHA/run ID để truy vết.

**Rollout trên các nhánh:** maintainer B review/merge notifier vào main,
sau đó đưa cùng file đã render đúng mapping vào mọi nhánh B đang hoạt động.
Nhánh mới tạo từ baseline đã cập nhật sẽ kế thừa notifier. GitHub đọc workflow
tại ref được push, nên chỉ sửa main không nâng cấp các nhánh cũ có workflow
cũ hoặc thiếu file. Với nhánh `incoming/*` đang chứa contribution, không tự
chèn commit làm thay đổi PR; cập nhật baseline và để contribution rebase theo
quy trình, hoặc chấp nhận nhánh đó dùng fallback tới khi được nâng cấp.
Workflow thuần CI không thể bảo đảm notify một nhánh cố tình bỏ file workflow.

Push bằng `GITHUB_TOKEN` không tạo lượt push workflow tiếp theo. Automation B
cần dùng App installation token phù hợp hoặc gọi controller rõ ràng. Bot
bridge hiện dùng App; push `incoming/*` có notifier mới có thể gọi thêm một
lượt reconcile, lượt sau không ghi B khi không có thay đổi nên không tạo vòng
lặp. Không thay quyền App để vượt protection B.

Tham chiếu GitHub: [workflow tại ref của event](https://docs.github.com/en/actions/concepts/workflows-and-actions/workflows),
[filter branches](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax),
[GITHUB_TOKEN và trigger](https://docs.github.com/en/actions/concepts/security/github_token).

Kiểm tra notifier tại repo tài liệu: `node --test setup/notifier.test.mjs`.
Test guard B/User/Bot, chặn push A/tags/repo lạ, giữ PR/comment và concurrency
riêng cho các nhánh. Dùng `actionlint` để kiểm YAML/expression.

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

### 5.1. Nghiệm thu engine trước khi mở rộng notifier

Đã kiểm chứng live trên hai cặp repo private `Vihnnnn` ↔ `TF4-Phase3-TechX`.
Engine lab ở commit `24b1b0e82bae37a7eefd8587f92672c40f961dad`; các file
engine/test giống controller mẫu và template đi kèm tài liệu này.
[Policy CI](https://github.com/TF4-Phase3-TechX/bot-bridge-controller/actions/runs/39457018024)
pass **60 tests**. Ở lần nghiệm thu engine này, notifier và quyền App giữ nguyên.

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
- Snapshot main ở cuối lần nghiệm thu engine: cặp thứ nhất
  `7b755763a73fe3301dd465f346e1369f23775b8e`; cặp thứ hai:
  `36b55705df2e6a0ac419eef53e8f47458e8f91c9`.
- Các PR có sẵn trước test vẫn mở, head SHA không đổi. Chỉ hai PR test được merge.

Đây là chứng minh trên lab; chưa triển khai controller mới vào `TechX-Corp`.
Kết quả không chứng minh PR IaC #59 đã apply hoặc protection production đã được
nghiệm thu. Link lab private cần quyền truy cập tương ứng.

### 5.2. Nghiệm thu CI notify mọi nhánh B

Ngày 20/10/2026: cập nhật notifier ở main của cả hai repo B lab, tạo nhánh
`notify-all-1792514247359/release/nested` từ baseline mới rồi push hai revision.
Không mở PR cho các nhánh này, không bấm Run workflow và không gọi API
dispatch trong script test. CI notifier thực hiện dispatch; không dùng schedule
để chứng minh kết quả.

| Cặp lab | CI push revision tiếp theo | Controller nhận đúng event/run/SHA | SHA cuối giống nhau ở A/B |
|---|---|---|---|
| `bot-bridge-lab` | [39459836657](https://github.com/TF4-Phase3-TechX/bot-bridge-lab/actions/runs/39459836657) | [39459855470](https://github.com/TF4-Phase3-TechX/bot-bridge-controller/actions/runs/39459855470) | `56e37c6cdb5879509f69b9842173e28f795dcfcc` |
| `bot-bridge-multi-lab` | [39459839669](https://github.com/TF4-Phase3-TechX/bot-bridge-multi-lab/actions/runs/39459839669) | [39459856339](https://github.com/TF4-Phase3-TechX/bot-bridge-controller/actions/runs/39459856339) | `9f0cb2a809f74f812c5aa369c900b5eaebdc7aa1` |

Các notifier/controller ở bảng trên đều Success. Controller report có
`trigger.event=push`, `trigger.run` trỏ về đúng CI nguồn và `trigger.sha` đúng
revision ở bảng. `workflow_dispatch` là cơ chế CI notifier gọi controller,
không phải người dùng bấm gửi code.

Trong test đầu, [run 39459105374](https://github.com/TF4-Phase3-TechX/bot-bridge-controller/actions/runs/39459105374)
báo lỗi REST `404` khi kiểm tra nhánh A vừa được Git push tạo thành công.
Sửa xác minh bằng Git đã triển khai ở lab commit
`13a113c660c9f88e9d7711858f33d6ca747161d4`; sau đó tạo thêm nhánh
`notify-all-1792514247359/new/after-fix` để kiểm lại đường tạo nhánh:

- Cặp 1: [controller 39459769468](https://github.com/TF4-Phase3-TechX/bot-bridge-controller/actions/runs/39459769468)
  Success; A/B cùng SHA `40a44e5f96e8c7a26884fa25c513ef9c561ced50`.
- Cặp 2: [controller 39459800422](https://github.com/TF4-Phase3-TechX/bot-bridge-controller/actions/runs/39459800422)
  Success; A/B cùng SHA `26f122eff12fef96b47aacb10e12f3fd91a6d59f`.

Push trực tiếp vào nhánh riêng `notify-all-1792514247359/a-private` tại A:
[cặp 1 skipped](https://github.com/Vihnnnn/bot-bridge-lab/actions/runs/39459775984),
[cặp 2 skipped](https://github.com/Vihnnnn/bot-bridge-multi-lab/actions/runs/39459782442).
Hai nhánh giữ nguyên SHA và không xuất hiện tại B. Các PR có sẵn trước test
vẫn mở, head SHA không đổi. Không sửa workflow build/deploy của sản phẩm.

Một số run pending bị event mới thay thế theo concurrency của controller;
run đang chạy không bị hủy. Controller đọc trạng thái B hiện tại nên một
lượt có thể đồng bộ cả các revision đến trong lúc đang chạy. Không dùng run
cancelled làm bằng chứng thành công.

Validation: **62 controller tests**, **9 notifier tests**, `actionlint` và đối
chiếu SHA qua GitHub API. [Policy CI lab](https://github.com/TF4-Phase3-TechX/bot-bridge-controller/actions/runs/39459707585)
và [CI controller mẫu](https://github.com/pho-veteran/xora-contribution-controller/actions/runs/39460130802)
đều Success. Controller mẫu đã có sửa lỗi ở
[`ad8330c`](https://github.com/pho-veteran/xora-contribution-controller/commit/ad8330c43909277144e5368b1ee48ed21ff3bb9c).
Chưa triển khai notifier/controller vào XBrainVN/TechX-Corp production.
