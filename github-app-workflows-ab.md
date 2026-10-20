# Setup CI dispatch tại A và reconcile khi B/main thay đổi

**A = `XBrainVN`. B = `TechX`, là source of truth.** Controller private: `TechX/xora-contribution-controller`.

## 1. Trạng thái cần đạt

| Nơi | Workflow chạy | Vai trò |
|---|---|---|
| 7 repo A | Chỉ notifier `notify-controller.yml`; CI ứng dụng cũ đã disable tại A | PR mới, commit vào PR, comment/review gọi controller |
| 7 repo B | Giữ pipeline hiện có; thêm `notify-controller.yml` | Review/comment gọi controller; merge hoặc push B/main gọi reconcile |
| Controller | `controller.yml` | Chuyển contribution A → B, đồng bộ feedback, đưa đúng B/main về A/main và xử lý đóng PR A |

**“A chỉ có CI mới” nghĩa là chỉ chạy CI dispatch.** Các file pipeline B vẫn có trong Git history của A vì A/main phải giống B/main. Tắt pipeline cũ bằng trạng thái workflow tại repo A, không xóa/sửa riêng file tại A/main.

Nếu đã disable từng workflow cũ tại A thì giữ nguyên. **Không disable GitHub Actions toàn repo A**, vì notifier cũng cần Actions.

## 2. Điều kiện trước khi thêm workflow

| Kiểm tra | Yêu cầu |
|---|---|
| Controller | Đã push code, registry có 7 cặp XBrainVN → TechX; workflow trỏ đúng controller; job policy Success |
| Controller credentials | 2 secrets + 3 variables theo [bảng credentials](github-app-secrets-variables.md); giữ `BRIDGE_ENABLED=false` trong giai đoạn cấu hình |
| Credentials A/B | Mỗi repo có `CONTROLLER_DISPATCH_APP_CLIENT_ID` và `CONTROLLER_DISPATCH_APP_PRIVATE_KEY` của cùng App Dispatch |
| App installation | Sync chọn 7 repo A; Transport chọn 7 repo B; Dispatch chỉ chọn controller |
| Main A/B | B/main có code; A/main đã bootstrap từ B/main. Controller không tự tạo main cho A rỗng |
| Quyền main | Developer không ghi/merge A/main; App Sync được reconcile A/main. App Transport không ghi/merge B/main hoặc bypass protection |

Không phát sinh thêm secret hoặc variable cho workflow mới.

## 3. Giữ pipeline B chạy ở B, không chạy ở A

### Trạng thái workflow tại A

Tại **từng repo XBrainVN → Actions → chọn workflow ứng dụng cũ → menu `…` → Disable workflow**. Các workflow đã tắt thì không cần làm lại. Không tắt notifier mới.

Có thể kiểm tra bằng CLI của admin A:

```bash
gh workflow list --all --repo XBrainVN/xora-platform
```

Để tắt một workflow còn active, dùng ID hoặc tên file thực tế từ danh sách:

```bash
gh workflow disable build.yml --repo XBrainVN/xora-platform
```

`build.yml` chỉ là ví dụ; chọn đúng workflow của repo. Đây là trạng thái tại A, không làm disable pipeline tương ứng ở B. [GitHub CLI: disable workflow](https://cli.github.com/manual/gh_workflow_disable).

### Guard cho các file pipeline B được sao sang A

Để cả workflow mới sau này cũng không chạy job ứng dụng tại A, maintainer B đặt điều kiện repo tại **mỗi job** của pipeline chỉ dành cho B. Không thay các steps/build/test/deploy hay trigger vốn có.

Ví dụ tại `TechX/xora-platform`, job chưa có `if`:

```yaml
jobs:
  build:
    if: github.repository == 'TechX/xora-platform'
    runs-on: ubuntu-latest
    steps:
      # Giữ nguyên các steps hiện có.
```

Nếu job đã có điều kiện, **ghép thêm**, không thay mất điều kiện cũ. Ví dụ:

```yaml
# Trước
if: ${{ always() && needs.build.result == 'success' }}

# Sau
if: ${{ github.repository == 'TechX/xora-platform' && (always() && needs.build.result == 'success') }}
```

Áp dụng cả job gọi reusable workflow và các job deploy/cleanup chạy với `always()`. Thay tên repo theo từng cặp. Không thêm guard chỉ-B này vào notifier, vì notifier phải chạy tại cả A/B.

Tại B, điều kiện repo là đúng nên pipeline vẫn giữ hành vi trước đó. Tại A, job sẽ bị skip; workflow có thể vẫn hiện lượt chạy Skipped nếu chưa bị disable. Muốn A không có lượt chạy pipeline cũ thì tiếp tục giữ chúng disabled. [GitHub: điều kiện chạy job](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-jobs-with-conditions).

Mỗi khi B thêm/đổi tên workflow, review guard trước khi merge và kiểm tra danh sách workflow tại A sau reconcile. Việc tắt các workflow cũ không tự bảo đảm mọi workflow mới đều bị tắt.

## 4. Thêm notifier vào từng repo B

Dùng **một file chung cho cả A/B**: [templates/notifier/.github/workflows/notify-controller.yml](templates/notifier/.github/workflows/notify-controller.yml). File được commit vào B, controller đồng bộ cùng file về A. Không tạo workflow reconcile thứ hai trùng chức năng.

| Placeholder trong mẫu | Giá trị |
|---|---|
| `A_OWNER` | `XBrainVN` |
| `B_OWNER` | `TechX` |
| `A_REPO`, `B_REPO` | Cùng tên repo của cặp đang cài |
| `CONTROLLER_REPO` | `xora-contribution-controller` |

Ví dụ cài cho `xora-platform`, chạy bằng Bash với credential của maintainer B:

```bash
# Nếu đã clone repo docs thì dùng thư mục đó.
git clone https://github.com/pho-veteran/github-org-contribution-lab.git bridge-docs
git clone git@github.com:TechX/xora-platform.git xora-platform

cd xora-platform
git switch -c setup/notify-controller
mkdir -p .github/workflows

sed \
  -e 's/A_OWNER/XBrainVN/g' \
  -e 's/B_OWNER/TechX/g' \
  -e 's/A_REPO/xora-platform/g' \
  -e 's/B_REPO/xora-platform/g' \
  -e 's/CONTROLLER_REPO/xora-contribution-controller/g' \
  ../bridge-docs/templates/notifier/.github/workflows/notify-controller.yml \
  > .github/workflows/notify-controller.yml

git add .github/workflows/notify-controller.yml
git diff --cached -- .github/workflows/notify-controller.yml
git commit -m "Notify contribution controller on repository events"
git push -u origin setup/notify-controller
gh pr create --repo TechX/xora-platform --base main \
  --title "Configure contribution notifier" \
  --body "Add A/B event dispatch and reconciliation trigger for B/main changes."
```

Nếu file notifier đã tồn tại, mở và đối chiếu trước; không ghi đè cấu hình đang dùng. Dùng SSH alias B thay `github.com` nếu cần. Review nội dung file và diff trên PR trước khi merge.

Lặp lại cho đủ 7 cặp; mỗi repo có file notifier đã thay đúng tên:

| A | B |
|---|---|
| `XBrainVN/xora-evaluation-framework` | `TechX/xora-evaluation-framework` |
| `XBrainVN/xora-eval-framework-fe` | `TechX/xora-eval-framework-fe` |
| `XBrainVN/xora-learning-loop` | `TechX/xora-learning-loop` |
| `XBrainVN/xora-platform` | `TechX/xora-platform` |
| `XBrainVN/xora-platform-fe` | `TechX/xora-platform-fe` |
| `XBrainVN/xora-resolve-be` | `TechX/xora-resolve-be` |
| `XBrainVN/xora-resolve-agent` | `TechX/xora-resolve-agent` |

Maintainer B review và merge PR notifier. Pipeline B vẫn chạy theo trigger vốn có; notifier chạy độc lập.

### Event thực tế của notifier

| Event | Tại A | Tại B |
|---|---|---|
| PR mở, thêm commit, reopen, close, ready for review, edit | Dispatch khi PR cùng repo, base main và sự kiện từ người dùng | Tương tự |
| Conversation comment tạo/sửa | Dispatch cho comment PR từ người dùng | Tương tự |
| Review / inline review comment | Dispatch khi thỏa điều kiện PR và sender | Tương tự |
| Push main, gồm merge PR vào main | Không dispatch job; tránh vòng lặp khi bot sync A | Dispatch reconcile ngay theo event |

Notifier không checkout hay chạy code PR. Giữ nguyên allowlist repo, lọc sender/event, token scope chỉ controller và `permissions: {}` của mẫu.

**B merge → push B/main → notifier → workflow_dispatch controller → reconcile đúng cặp.** Controller đọc B/main hiện tại, không chờ lịch polling. “Ngay” là workflow được kích hoạt bởi sự kiện; vẫn có thời gian xếp hàng Actions.

Reconcile **không chờ pipeline build/deploy hiện có ở B hoàn tất**. Nếu B cần CI đạt trước khi chấp nhận code thì dùng required checks trước merge. Không biến notifier thành job phụ thuộc deploy.

Nếu automation push B/main bằng `GITHUB_TOKEN`, push đó không kích hoạt workflow push tiếp theo. Automation này cần dùng App token được cấp quyền phù hợp hoặc dispatch controller riêng. [GitHub: quy tắc kích hoạt workflow](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow).

## 5. Đưa notifier về A và bật vận hành

Sau khi notifier tại **mọi B** đã merge, A/main đã có lịch sử bootstrap, credentials/installations/guards đã đủ:

1. Tại controller, đổi variable `BRIDGE_ENABLED` thành `true`.
2. **Actions → Contribution bridge controller → Run workflow → main**, để trống inputs.
3. Kiểm tra đủ 7 job reconcile thành công và A/main trùng B/main. Đây là lần chạy khởi tạo để đưa notifier về A, không phải cách kích hoạt cho mỗi merge sau này.
4. Tại mỗi A, mở **Actions** và kiểm tra **Notify contribution bridge** đang enabled; nếu trước đó đã disable nhầm file này thì bật lại:

```bash
gh workflow enable notify-controller.yml --repo XBrainVN/xora-platform
gh workflow list --all --repo XBrainVN/xora-platform
```

Chỉ bật notifier, không bật lại pipeline ứng dụng cũ. Không commit workflow riêng tại A/main; không tạo một lịch sử cấu hình khác B/main.

## 6. Nghiệm thu

| Thao tác | Kết quả cần thấy |
|---|---|
| Mở PR tại A, push thêm commit | Notifier A chạy; controller mở/cập nhật đúng một PR B |
| B request changes có nội dung; A sửa và comment | Feedback/commit được chuyển đúng chiều; conversation comment đồng bộ |
| B merge bằng **Create a merge commit** | Pipeline hiện có tại B chạy như trước; notifier B gọi controller mà không cần Run workflow thủ công |
| Controller xử lý B merge | A/main đúng SHA B/main, commit gốc giữ identity; PR A đóng khi contribution được accepted |
| Kiểm tra Actions tại A | Notifier hoạt động; pipeline ứng dụng cũ disabled, các job B-only không chạy tại A |
| Chạy lại hoặc thử cặp thứ hai | Không tạo trùng PR/comment, không dispatch sang cặp khác |

Kiểm tra cả **notifier run và controller run**. HTTP dispatch thành công chỉ là controller đã nhận yêu cầu; đọc job `Reconcile <id>` và summary để xác nhận kết quả.

Tài liệu này hướng dẫn cấu hình; không xác nhận các workflow private đã được thay đổi hoặc chạy thử. [Bảng secrets/variables](github-app-secrets-variables.md) · [Guide controller](github-app-setup.md).
