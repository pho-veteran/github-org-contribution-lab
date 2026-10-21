# Team AI: contribute qua XBrain, giảm chờ sync và quota CI

**Luồng:** làm việc trên feature branch tại XBrain → mở PR → bot chuyển sang TechX → TechX review/merge → bot đồng bộ code và trạng thái về XBrain. `main/dev` tại XBrain chỉ do bot sync cập nhật.

## Quy ước commit và push

- Mỗi PR giải quyết một mục tiêu, ưu tiên **1–3 commit có ý nghĩa**, cố gắng không quá **5 commit**. Nếu cần nhiều hơn, giải thích trong PR và thống nhất với reviewer; đây là quy ước team, chưa có CI chặn số commit.
- TechX cần dùng **Create a merge commit** để giữ SHA, author và committer gốc. Vì vậy nên làm sạch lịch sử trước khi gửi review; không trông chờ squash/rebase lúc merge tại TechX.
- **Giảm số lần push sau khi mở PR** mới trực tiếp giảm event sync. Ví dụ, 5 commit đẩy cùng một lần thường tạo ít lượt notify hơn 5 lần push riêng. Commit nhiều lần ở local không tự tiêu tốn GitHub Actions.
- Gom sửa lỗi và feedback thành một lượt, chạy test local rồi mới push. Tránh push liên tục các commit `fix`, `fix again`, `WIP`, commit rỗng hoặc đổi format ngoài phạm vi PR.
- Không gộp các tính năng không liên quan thành một PR lớn chỉ để giảm lượt CI.

## Cách làm mỗi PR

1. Lấy code mới nhất từ XBrain và tạo branch riêng, ví dụ `feat/AI-123-search-ranking`. Chọn đúng base branch theo quy ước của repo.
2. Code, test/lint và tự xem diff ở local. Kiểm tra `git config user.name` / `git config user.email` đúng tài khoản công việc. Có thể gom/reword commit **trước khi mở PR và trước khi bot chuyển commit sang TechX**.
3. Khi sẵn sàng, push và mở PR với mục tiêu, cách test, ảnh/log cần thiết và rủi ro. Điền mô tả đủ ngay từ đầu để giảm các lần sửa qua lại.
4. Sau khi bot đã chuyển PR, **chỉ thêm commit mới**. Không amend, rebase hoặc force-push để ép lịch sử về dưới 5 commit: đổi SHA có thể làm bridge báo divergence/identity và chặn cập nhật.
5. Nhận review: gom các góp ý, sửa/test một lượt rồi push. Reviewer nên dùng một lượt **Submit review** với các góp ý tập hợp; không gửi comment riêng cho từng thao tác nhỏ. Mỗi comment/review vẫn có thể tạo event sync, nên chỉ gửi thông tin cần thiết.
6. Theo dõi comment trạng thái/link PR TechX do bot gửi. Chờ TechX review và merge; không merge PR tại XBrain. Sau khi bot báo accepted, kiểm tra code đã về base rồi cập nhật local.

**Draft vẫn có thể kích hoạt CI.** Chỉ mở draft khi thực sự cần trao đổi sớm; tiếp tục gom thay đổi trước mỗi lần push.

## Khi sync chậm

Thời gian thường gặp theo vận hành của team khoảng **2–10 phút**, có thể lâu hơn khi runner/hàng đợi bận. Đây không phải thời gian bảo đảm. Controller xử lý tuần tự **theo từng cặp repo**: các PR trong cùng repo chia sẻ lượt reconcile; các repo khác có thể chạy song song tùy runner/quota. Không nhất thiết mỗi event có một run hoàn tất riêng.

- Notifier Success chỉ có nghĩa đã gửi yêu cầu; cần xem controller và comment bot để biết kết quả.
- Không tạo thêm commit, comment “sync chưa?”, đóng/mở lại PR hoặc bấm rerun chỉ để thúc sync: có thể phát sinh thêm lượt CI.
- Nếu quá khoảng chờ thông thường hoặc có lỗi, gửi **link PR + SHA mới nhất + link run lỗi/đang chờ** qua kênh hỗ trợ để dễ kiểm tra, thay vì thử trigger liên tục.

Nên setup PR template theo yêu cầu đặc thù của team AI, làm rõ những nội dung và bằng chứng cần cung cấp trong PR body.
