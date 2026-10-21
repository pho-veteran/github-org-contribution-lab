# Team AI: contribute qua XBrain, giảm chờ sync và quota CI

**Luồng:** làm việc trên feature branch tại XBrain → mở PR → bot chuyển sang TechX → TechX review/merge → bot đồng bộ code và trạng thái về XBrain. `main/dev` tại XBrain chỉ do bot sync cập nhật.

## Quy ước commit và push

- Mỗi PR giải quyết một mục tiêu, ưu tiên **1–3 commit có ý nghĩa**, cố gắng không quá **5 commit**. Nếu cần nhiều hơn, giải thích trong PR và thống nhất với reviewer; đây là quy ước team, chưa có CI chặn số commit.
- TechX cần dùng **Create a merge commit** để giữ SHA, author và committer gốc. Vì vậy nên làm sạch lịch sử trước khi gửi review; không trông chờ squash/rebase lúc merge tại TechX.
- **Giảm số lần push sau khi mở PR** mới trực tiếp giảm event sync. Ví dụ, 5 commit đẩy cùng một lần thường tạo ít lượt notify hơn 5 lần push riêng. Commit nhiều lần ở local không tự tiêu tốn GitHub Actions.
- Gom sửa lỗi và feedback thành một lượt, chạy test local rồi mới push. Tránh push liên tục các commit `fix`, `fix again`, `WIP`, commit rỗng hoặc đổi format ngoài phạm vi PR.
- Không gộp các tính năng không liên quan thành một PR lớn chỉ để giảm lượt CI.

## Cách làm mỗi PR

1. Lấy code mới nhất từ XBrain và tạo branch riêng, ví dụ `feat/AI-123-search-ranking`. Chọn base đã được SRE xác nhận cho repo; mẫu controller hiện dùng `main`, việc có nhánh `dev` không tự có nghĩa bridge nhận PR vào `dev`.
2. Code, test/lint và tự xem diff ở local. Kiểm tra `git config user.name` / `git config user.email` đúng tài khoản công việc. Có thể gom/reword commit **trước khi mở PR và trước khi bot chuyển commit sang TechX**.
3. Khi sẵn sàng, push và mở PR với mục tiêu, cách test, ảnh/log cần thiết và rủi ro. Điền mô tả đủ ngay từ đầu để giảm các lần sửa qua lại.
4. Sau khi bot đã chuyển PR, **chỉ thêm commit mới**. Không amend, rebase hoặc force-push để ép lịch sử về dưới 5 commit: đổi SHA có thể làm bridge báo divergence/identity và chặn cập nhật. Nếu thật sự cần viết lại lịch sử, nhờ SRE xử lý trước.
5. Nhận review: gom các góp ý, sửa/test một lượt rồi push. Reviewer nên dùng một lượt **Submit review** với các góp ý tập hợp; không gửi comment riêng cho từng thao tác nhỏ. Mỗi comment/review vẫn có thể tạo event sync, nên chỉ gửi thông tin cần thiết.
6. Theo dõi comment trạng thái/link PR TechX do bot gửi. Chờ TechX review và merge; không merge PR tại XBrain. Sau khi bot báo accepted, kiểm tra code đã về base rồi cập nhật local.

**Draft không phải nút tắt CI:** notifier vẫn nhận event của draft PR. Controller mẫu hoãn chuyển code khi draft, nhưng CI vẫn chạy; chỉ mở draft khi thực sự cần trao đổi sớm.

## Khi sync chậm

Thời gian thường gặp theo vận hành của team khoảng **2–10 phút**, có thể lâu hơn khi runner/hàng đợi bận. Đây không phải thời gian bảo đảm. Controller xử lý tuần tự **theo từng cặp repo**: các PR trong cùng repo chia sẻ lượt reconcile; các repo khác có thể chạy song song tùy runner/quota. Không nhất thiết mỗi event có một run hoàn tất riêng.

- Notifier Success chỉ có nghĩa đã gửi yêu cầu; cần xem controller và comment bot để biết kết quả.
- Không tạo thêm commit, comment “sync chưa?”, đóng/mở lại PR hoặc bấm rerun chỉ để thúc sync: có thể phát sinh thêm lượt CI.
- Nếu quá khoảng chờ thông thường hoặc có lỗi, gửi SRE **link PR + SHA mới nhất + link run lỗi/đang chờ** qua kênh hỗ trợ, thay vì thử trigger liên tục.
- Team AI tập trung code sản phẩm; thay đổi `.github/workflows/`, CI, Terraform hoặc controller chuyển cho SRE. Contribution sửa workflow đang bị bridge chặn.

## Khuyến nghị PR template

SRE/maintainer thêm **`.github/pull_request_template.md` tại repo TechX**, review/merge rồi đồng bộ về default branch của XBrain. Làm cho cả 7 repo; không duy trì một bản riêng chỉ ở A vì có thể bị sync ghi đè. Template chỉ nhắc quy trình, không tự enforce giới hạn commit.

Controller mẫu tạo body PR TechX riêng và dẫn link PR XBrain, chưa tự sao toàn bộ mô tả/template từ A sang B. Reviewer TechX đọc mô tả chi tiết qua link PR nguồn.

Nội dung gợi ý:

```markdown
## Mục tiêu
- Vấn đề / ticket:
- Thay đổi chính:

## Kiểm tra
- Lệnh test/lint đã chạy và kết quả:
- Ảnh/log hoặc cách kiểm tra thủ công, nếu cần:

## Rủi ro
- Ảnh hưởng / tương thích / cách hoàn tác:

## Trước khi yêu cầu review
- [ ] PR chỉ có một mục tiêu; đã tự review diff và test local.
- [ ] Đã kiểm tra author/email và không đưa secrets vào diff.
- [ ] Ưu tiên 1–3 commit, cố gắng không quá 5; giải thích nếu cần nhiều hơn.
- [ ] Đã gom thay đổi để giảm số lần push; không rewrite commit đã sync sang TechX.
- [ ] Thay đổi workflow/CI/Terraform đã chuyển cho SRE nếu có.

> TechX: dùng Create a merge commit để giữ commit identity; không squash/rebase.
> XBrain: chờ bot cập nhật base và trạng thái; không tự merge PR.
```

Tài liệu cho SRE: [cập nhật notifier/controller](all-branch-reconciliation.md).
