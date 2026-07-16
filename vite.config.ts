import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Build ra MỘT file dist/index.html duy nhất: toàn bộ JS, CSS, font và
// pdf.js worker được nhúng thẳng vào HTML nên mở bằng file:// vẫn chạy,
// hoàn toàn không cần mạng.
export default defineConfig({
  base: './',
  plugins: [react(), viteSingleFile()],
  // Worker phải ở dạng classic (iife): Chromium không cho phép module worker
  // tạo từ blob URL khi trang chạy qua file://
  worker: { format: 'iife' },
  build: {
    target: 'esnext',
    assetsInlineLimit: 100_000_000,
  },
});
