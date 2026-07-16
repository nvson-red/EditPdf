import { useCallback, useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { pdfjs } from './pdf';
import { PageView } from './PageView';
import { exportPdf, downloadBytes } from './export';
import type { EditorElement, Tool } from './types';

export default function App() {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [fileName, setFileName] = useState('');
  const [elements, setElements] = useState<EditorElement[]>([]);
  const [tool, setTool] = useState<Tool>('select');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [scale, setScale] = useState(1.25);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const originalBytes = useRef<ArrayBuffer | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const openFile = useCallback(async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      alert('Vui lòng chọn file PDF.');
      return;
    }
    setBusy(true);
    try {
      const bytes = await file.arrayBuffer();
      // pdf.js chiếm quyền sở hữu buffer truyền vào nên phải đưa bản sao,
      // giữ bản gốc lại cho bước xuất file.
      originalBytes.current = bytes;
      // useSystemFonts: thay font chuẩn (Helvetica...) bằng font hệ thống
      // thay vì tải dữ liệu font từ ngoài — bắt buộc để chạy offline/file://
      const loaded = await pdfjs.getDocument({
        data: bytes.slice(0),
        useSystemFonts: true,
      }).promise;
      setDoc((prev) => {
        prev?.destroy();
        return loaded;
      });
      setFileName(file.name);
      setElements([]);
      setSelectedId(null);
      setTool('select');
    } catch (err) {
      alert(`Không đọc được file PDF: ${err instanceof Error ? err.message : err}`);
    } finally {
      setBusy(false);
    }
  }, []);

  async function handleExport() {
    if (!originalBytes.current) return;
    setBusy(true);
    try {
      const out = await exportPdf(originalBytes.current, elements);
      const base = fileName.replace(/\.pdf$/i, '');
      downloadBytes(out, `${base}-da-sua.pdf`);
    } catch (err) {
      alert(`Xuất PDF thất bại: ${err instanceof Error ? err.message : err}`);
    } finally {
      setBusy(false);
    }
  }

  // Phím Delete xoá phần tử đang chọn (trừ khi đang gõ chữ)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const active = document.activeElement as HTMLElement | null;
      if (active && (active.isContentEditable || active.tagName === 'INPUT')) return;
      if (selectedId) {
        setElements((els) => els.filter((el) => el.id !== selectedId));
        setSelectedId(null);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId]);

  const addElement = useCallback(
    (el: EditorElement) => setElements((els) => [...els, el]),
    [],
  );
  const updateElement = useCallback(
    (id: string, patch: Partial<EditorElement>) =>
      setElements((els) =>
        els.map((el) => (el.id === id ? ({ ...el, ...patch } as EditorElement) : el)),
      ),
    [],
  );
  const deleteElement = useCallback((id: string) => {
    setElements((els) => els.filter((el) => el.id !== id));
    setSelectedId((cur) => (cur === id ? null : cur));
  }, []);
  const toolDone = useCallback(() => setTool('select'), []);

  const toolButtons: { key: Tool; label: string; hint: string }[] = [
    { key: 'select', label: '🖱 Chọn', hint: 'Chọn / di chuyển phần tử' },
    { key: 'text', label: '𝐓 Thêm chữ', hint: 'Bấm vào trang để thêm ô chữ' },
    { key: 'whiteout', label: '⬜ Xoá nội dung', hint: 'Kéo khung trắng che nội dung cần xoá' },
    { key: 'highlight', label: '🖍 Đánh dấu', hint: 'Kéo để tô sáng vùng nội dung' },
  ];

  return (
    <div
      className={`app ${dragOver ? 'drag-over' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const f = e.dataTransfer.files[0];
        if (f) openFile(f);
      }}
    >
      <header className="toolbar">
        <span className="brand">📄 EditPdf</span>
        <button onClick={() => fileInputRef.current?.click()} disabled={busy}>
          📂 Mở PDF
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf,.pdf"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) openFile(f);
            e.target.value = '';
          }}
        />
        {doc && (
          <>
            <span className="divider" />
            {toolButtons.map((b) => (
              <button
                key={b.key}
                className={tool === b.key ? 'active' : ''}
                title={b.hint}
                onClick={() => setTool(b.key)}
              >
                {b.label}
              </button>
            ))}
            <span className="divider" />
            <button onClick={() => setScale((s) => Math.max(0.5, +(s - 0.25).toFixed(2)))}>
              −
            </button>
            <span className="zoom">{Math.round(scale * 100)}%</span>
            <button onClick={() => setScale((s) => Math.min(3, +(s + 0.25).toFixed(2)))}>
              +
            </button>
            <span className="spacer" />
            <span className="file-name" title={fileName}>
              {fileName}
            </span>
            <button className="primary" onClick={handleExport} disabled={busy}>
              💾 Tải PDF đã sửa
            </button>
          </>
        )}
      </header>

      <main className="pages">
        {!doc && (
          <div className="empty">
            <div className="empty-card" onClick={() => fileInputRef.current?.click()}>
              <div className="empty-icon">📄</div>
              <h2>Kéo thả file PDF vào đây</h2>
              <p>hoặc bấm để chọn file — mọi xử lý diễn ra ngay trên máy bạn, không cần mạng</p>
            </div>
          </div>
        )}
        {doc &&
          Array.from({ length: doc.numPages }, (_, i) => (
            <PageView
              key={i + 1}
              doc={doc}
              pageNumber={i + 1}
              scale={scale}
              tool={tool}
              elements={elements.filter((el) => el.page === i)}
              selectedId={selectedId}
              onAddElement={addElement}
              onUpdateElement={updateElement}
              onDeleteElement={deleteElement}
              onSelect={setSelectedId}
              onToolDone={toolDone}
            />
          ))}
      </main>
    </div>
  );
}
