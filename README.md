# EditPdf — Chỉnh sửa PDF chạy hoàn toàn offline

Tool web chỉnh sửa PDF đơn giản, chạy **100% trên máy bạn, không cần mạng**:
file PDF không bao giờ rời khỏi máy, không upload lên server nào cả.

## Tính năng

- 📂 **Mở PDF** — bấm nút hoặc kéo thả file vào cửa sổ
- 𝐓 **Thêm chữ** — bấm vào vị trí bất kỳ trên trang để thêm ô chữ
  (hỗ trợ đầy đủ tiếng Việt, đổi cỡ chữ, màu chữ, kéo di chuyển)
- ⬜ **Xoá nội dung** — kéo khung trắng che lên phần nội dung cần xoá
- 🖍 **Đánh dấu** — tô sáng vùng nội dung bằng màu vàng
- 🖱 **Chọn / di chuyển / thay đổi kích thước / xoá** phần tử đã thêm
  (phím `Delete` xoá phần tử đang chọn)
- 💾 **Tải PDF đã sửa** — xuất ra file PDF mới, giữ nguyên file gốc

## Cách dùng (không cần cài gì)

Mở file **`dist/index.html`** bằng trình duyệt (Chrome/Edge/Firefox) là xong —
toàn bộ ứng dụng, thư viện và font đã được đóng gói vào đúng một file HTML,
mở bằng `file://` không cần server, không cần internet.

## Phát triển

```bash
npm install        # chỉ cần mạng một lần lúc cài
npm run dev        # chạy dev server
npm run build      # build ra dist/index.html (một file duy nhất)
```

## Công nghệ

- [React](https://react.dev) + [Vite](https://vite.dev) + TypeScript
- [pdf.js](https://mozilla.github.io/pdf.js/) — hiển thị trang PDF
- [pdf-lib](https://pdf-lib.js.org) + fontkit — ghi chỉnh sửa vào file PDF
- Font DejaVu Sans nhúng sẵn để chữ tiếng Việt hiển thị đúng trong PDF xuất ra
- `vite-plugin-singlefile` — đóng gói tất cả thành một file HTML duy nhất

## Ghi chú kỹ thuật

- PDF không phải định dạng văn bản sửa trực tiếp được; giống Smallpdf, tool
  này chỉnh sửa theo kiểu phủ lớp: thêm chữ mới, che nội dung cũ bằng khung
  trắng rồi viết đè lên khi cần thay thế.
- Worker của pdf.js được đóng gói dạng classic (iife) vì Chromium không cho
  phép module worker tạo từ blob khi trang chạy qua `file://`.
- Font chuẩn PDF (Helvetica, Times...) được thay bằng font hệ thống khi hiển
  thị (`useSystemFonts`) để không phải tải dữ liệu font từ mạng.
