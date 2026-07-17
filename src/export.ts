import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { EditorElement } from './types';
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

export async function exportPdf(
  originalBytes: ArrayBuffer,
  elements: EditorElement[],
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(originalBytes);
  doc.registerFontkit(fontkit);

  let embeddedFont = null;
  if (elements.some((el) => el.type === 'text' && el.text.trim() !== '')) {
    embeddedFont = await doc.embedFont(await loadFontBytes(), { subset: true });
  }

  const pages = doc.getPages();

  for (const el of elements) {
    const page = pages[el.page];
    if (!page) continue;
    const pageH = page.getHeight();

    if (el.type === 'whiteout' || el.type === 'highlight') {
      page.drawRectangle({
        x: el.x,
        y: pageH - el.y - el.h,
        width: el.w,
        height: el.h,
        color: hexToRgb(el.fill ?? (el.type === 'whiteout' ? '#ffffff' : '#ffeb3b')),
        opacity: el.type === 'whiteout' ? 1 : 0.45,
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
  }

  return doc.save();
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
