# VideoStarOTA — Dylib iOS + Web Admin cập nhật trực tiếp trên Vercel

Bộ mã nguồn hoàn chỉnh cho phép bạn gắn **1 file `.dylib` duy nhất** vào IPA Video Star (chạy được trên cả máy chưa Jailbreak lẫn máy đã Jailbreak), sau đó đăng nhập vào **Web Admin trên Vercel** để sửa code hoặc upload tệp trực tiếp và đẩy cập nhật OTA ngay lập tức tới người dùng.

## Cấu trúc thư mục

- `vercel-server/`: Mã nguồn Web Server + Trang Admin đăng nhập + API cập nhật OTA (đẩy nguyên thư mục này lên Vercel).
- `ios-dylib/`: Mã nguồn Objective-C `VideoStarOTA.m`, `Makefile` (Theos) và `build.sh` (macOS clang).

## Bước 1: Đưa `vercel-server` lên Vercel và bật lưu trữ tệp (Vercel Blob)

1. Tạo một repository GitHub mới và đẩy toàn bộ nội dung thư mục `vercel-server/` lên (hoặc cài Vercel CLI rồi chạy `vercel` bên trong `vercel-server/`).
2. Vào **Vercel Dashboard → Chọn Project → Storage → Create Database → Blob** để bật **Vercel Blob** (miễn phí). Vercel sẽ tự gắn biến `BLOB_READ_WRITE_TOKEN` cho dự án để mọi tệp bạn upload trên web được lưu vĩnh viễn.
3. Vào **Settings → Environment Variables**, thêm 3 biến sau rồi bấm **Redeploy**:
   - `ADMIN_USERNAME`: tên đăng nhập trang quản trị (mặc định khi chạy thử: `admin`)
   - `ADMIN_PASSWORD`: mật khẩu đăng nhập mạnh của bạn (mặc định khi chạy thử: `VideoStar@2026`)
   - `SESSION_SECRET`: chuỗi ký tự ngẫu nhiên dài ít nhất 32 ký tự để ký cookie phiên đăng nhập.

## Bước 2: Đăng nhập & Upload file trực tiếp trên Web Vercel

1. Mở đường dẫn Vercel của bạn (ví dụ `https://ten-du-an.vercel.app/`).
2. Đăng nhập bằng `ADMIN_USERNAME` và `ADMIN_PASSWORD` vừa đặt.
3. Trên giao diện Admin, bạn có thể:
   - **Sửa code trực tiếp** trong trình soạn thảo cho `payload.js` (logic chức năng), `config.json` (cấu hình & tên class theo bản Video Star) và `panel.html` (giao diện menu người dùng), rồi bấm **Xuất bản OTA ngay tới người dùng**.
   - **Upload file trực tiếp** từ máy tính (kéo-thả hoặc chọn tệp): chọn thay thế `payload.js` / `config.json` / `panel.html` để xuất bản ngay, hoặc chọn lưu vào mục **Assets** (preset JSON, ảnh QR, file phụ...) để lấy link `/api/bundle?file=assets/...`.
   - Bật **Kill Switch** để tạm ngưng chạy code từ xa nếu gặp lỗi, gửi **Thông báo** lên app người dùng, hoặc bấm **Khôi phục (Rollback)** về phiên bản cũ chỉ với 1 lần nhấn.

## Bước 3: Biên dịch và gắn `VideoStarOTA.dylib` vào IPA Video Star

1. Mở `ios-dylib/VideoStarOTA.m` và sửa dòng đầu tiên:
   ```objc
   #define VST_SERVER_BASE_URL @"https://ten-du-an.vercel.app"
   ```
2. Biên dịch ra `VideoStarOTA.dylib`:
   - Trên macOS: `cd ios-dylib && chmod +x build.sh && ./build.sh`
   - Bằng Theos: `cd ios-dylib && make package`
3. Gắn `VideoStarOTA.dylib` vào IPA Video Star (bằng ESign, Sideloadly, Azule, hoặc Cyan) và cài lên máy. Từ lần sau, bạn chỉ cần cập nhật trên Web Admin Vercel — không cần build hay cài lại IPA nữa.
