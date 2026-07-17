import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { EditorElement, RectElement } from './types';
// Font DejaVu Sans hỗ trợ đầy đủ tiếng Việt, được nhúng vào bundle
import fontUrl from './assets/DejaVuSans.ttf?url';

// Khi build, font được inline thành data URL — giải mã trực tiếp thay vì
// fetch để không phụ thuộc CSP connect-src của trang host.
async function loadFontBytes(): Promise<ArrayBuffer> {
  if (fontUrl.startsWith('data:')) {
    const bin = atob(fontUrl.slice(fontUrl.indexOf(',') + 1));
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr.buffer;
  }
  return (await fetch(fontUrl)).arrayBuffer();
}

function hexToRgb(hex: string) {
  const n = parseInt(hex.replace('#', ''), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

/**
 * Xoá thật: render trang thành ảnh với các ô xoá đã tô đè, dùng ảnh này
 * THAY THẾ toàn bộ nội dung trang. Chữ nằm dưới ô xoá bị loại bỏ hẳn khỏi
 * file — không thể bôi chọn hay copy ra được nữa.
 */
async function rasterizePageWithWhiteouts(
  pdfjsDoc: PDFDocumentProxy,
  pageIndex: number,
  whiteouts: RectElement[],
): Promise<{ png: ArrayBuffer; w: number; h: number }> {
  const page = await pdfjsDoc.getPage(pageIndex + 1);
  const base = page.getViewport({ scale: 1 });
  // ~200dpi cho trang A4, giới hạn để không phình bộ nhớ với trang khổ lớn
  const S = Math.min(4, Math.max(2, 1800 / base.width));
  const viewport = page.getViewport({ scale: S });
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  for (const el of whiteouts) {
    ctx.fillStyle = el.fill ?? '#ffffff';
    ctx.fillRect(el.x * S, el.y * S, el.w * S, el.h * S);
  }
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('toBlob failed'))),
      'image/png',
    ),
  );
  return { png: await blob.arrayBuffer(), w: base.width, h: base.height };
}

export async function exportPdf(
  originalBytes: ArrayBuffer,
  elements: EditorElement[],
  pdfjsDoc: PDFDocumentProxy,
): Promise<Uint8Array> {
  const src = await PDFDocument.load(originalBytes);
  const out = await PDFDocument.create();
  out.registerFontkit(fontkit);

  // Dựng lại tài liệu: trang có ô xoá → thay bằng ảnh đã nướng phẳng;
  // trang còn lại → copy nguyên vẹn (giữ chữ gốc chọn/copy được).
  const pageCount = src.getPageCount();
  for (let i = 0; i < pageCount; i++) {
    const whiteouts = elements.filter(
      (el): el is RectElement => el.page === i && el.type === 'whiteout',
    );
    if (whiteouts.length > 0) {
      const { png, w, h } = await rasterizePageWithWhiteouts(pdfjsDoc, i, whiteouts);
      const img = await out.embedPng(png);
      const p = out.addPage([w, h]);
      p.drawImage(img, { x: 0, y: 0, width: w, height: h });
    } else {
      const [copied] = await out.copyPages(src, [i]);
      out.addPage(copied);
    }
  }

  let embeddedFont = null;
  if (elements.some((el) => el.type === 'text' && el.text.trim() !== '')) {
    embeddedFont = await out.embedFont(await loadFontBytes(), { subset: true });
  }

  const pages = out.getPages();

  for (const el of elements) {
    const page = pages[el.page];
    if (!page) continue;
    const pageH = page.getHeight();

    if (el.type === 'highlight') {
      page.drawRectangle({
        x: el.x,
        y: pageH - el.y - el.h,
        width: el.w,
        height: el.h,
        color: hexToRgb(el.fill ?? '#ffeb3b'),
        opacity: 0.45,
      });
    } else if (el.type === 'text' && embeddedFont && el.text.trim() !== '') {
      const lineHeight = el.size * 1.25;
      // drawText nhận y là baseline của dòng đầu; phần tử HTML neo theo
      // mép trên nên dịch xuống xấp xỉ chiều cao ascent của font.
      page.drawText(el.text, {
        x: el.x,
        y: pageH - el.y - el.size,
        size: el.size,
        font: embeddedFont,
        color: hexToRgb(el.color),
        lineHeight,
      });
    }
    // whiteout đã được nướng thẳng vào ảnh trang ở bước trên
  }

  return out.save();
}

export function downloadBytes(bytes: Uint8Array, fileName: string) {
  const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
