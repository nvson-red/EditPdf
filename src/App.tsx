import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { pdfjs } from './pdf';
import { PageView } from './PageView';
import { exportPdf, downloadBytes } from './export';
import type { EditorElement, Tool } from './types';

// ---- Lịch sử chỉnh sửa (undo/redo) ----
// 'add'/'delete' tự ghi mốc lịch sử; 'patch' thì không (dùng cho chuỗi thay
// đổi liên tục như kéo chuột) — trước mỗi chuỗi như vậy component phát
// 'snapshot' một lần, nên cả cú kéo chỉ là MỘT bước undo.
interface HistState {
  elements: EditorElement[];
  past: EditorElement[][];
  future: EditorElement[][];
}

type HistAction =
  | { type: 'reset' }
  | { type: 'snapshot' }
  | { type: 'add'; el: EditorElement }
  | { type: 'delete'; id: string }
  | { type: 'patch'; id: string; patch: Partial<EditorElement> }
  | { type: 'undo' }
  | { type: 'redo' };

const MAX_HISTORY = 100;

function histReducer(s: HistState, a: HistAction): HistState {
  const pushed = () => [...s.past.slice(-(MAX_HISTORY - 1)), s.elements];
  switch (a.type) {
    case 'reset':
      return { elements: [], past: [], future: [] };
    case 'snapshot':
      return { ...s, past: pushed(), future: [] };
    case 'add':
      return { elements: [...s.elements, a.el], past: pushed(), future: [] };
    case 'delete':
      return {
        elements: s.elements.filter((el) => el.id !== a.id),
        past: pushed(),
        future: [],
      };
    case 'patch':
      return {
        ...s,
        elements: s.elements.map((el) =>
          el.id === a.id ? ({ ...el, ...a.patch } as EditorElement) : el,
        ),
      };
    case 'undo': {
      const prev = s.past[s.past.length - 1];
      if (!prev) return s;
      return {
        elements: prev,
        past: s.past.slice(0, -1),
        future: [...s.future, s.elements],
      };
    }
    case 'redo': {
      const next = s.future[s.future.length - 1];
      if (!next) return s;
      return {
        elements: next,
        past: [...s.past, s.elements],
        future: s.future.slice(0, -1),
      };
    }
  }
}

export default function App() {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [fileName, setFileName] = useState('');
  const [hist, dispatch] = useReducer(histReducer, {
    elements: [],
    past: [],
    future: [],
  });
  const elements = hist.elements;
  const [tool, setTool] = useState<Tool>('select');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [scale, setScale] = useState(1.25);
  // id phần tử đang chờ hút màu từ trang (null = không ở chế độ hút màu)
  const [eyedropperId, setEyedropperId] = useState<string | null>(null);
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
      dispatch({ type: 'reset' });
      setSelectedId(null);
      setTool('select');
    } catch (err) {
      alert(`Không đọc được file PDF: ${err instanceof Error ? err.message : err}`);
    } finally {
      setBusy(false);
    }
  }, []);

  async function handleExport() {
    if (!originalBytes.current || !doc) return;
    setBusy(true);
    try {
      const out = await exportPdf(originalBytes.current, elements, doc);
      const base = fileName.replace(/\.pdf$/i, '');
      downloadBytes(out, `${base}-da-sua.pdf`);
    } catch (err) {
      alert(`Xuất PDF thất bại: ${err instanceof Error ? err.message : err}`);
    } finally {
      setBusy(false);
    }
  }

  const undo = useCallback(() => {
    dispatch({ type: 'undo' });
    setSelectedId(null);
  }, []);
  const redo = useCallback(() => {
    dispatch({ type: 'redo' });
    setSelectedId(null);
  }, []);

  // Phím tắt: Delete xoá phần tử đang chọn; Esc thoát hút màu;
  // Ctrl/Cmd+Z hoàn tác, Ctrl+Y / Ctrl+Shift+Z làm lại
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setEyedropperId(null);
        return;
      }
      const active = document.activeElement as HTMLElement | null;
      const typing =
        active && (active.isContentEditable || active.tagName === 'INPUT');
      const mod = e.ctrlKey || e.metaKey;
      if (mod && !typing && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && !typing && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault();
        redo();
        return;
      }
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      if (typing) return;
      if (selectedId) {
        dispatch({ type: 'delete', id: selectedId });
        setSelectedId(null);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId, undo, redo]);

  const addElement = useCallback(
    (el: EditorElement) => dispatch({ type: 'add', el }),
    [],
  );
  const updateElement = useCallback(
    (id: string, patch: Partial<EditorElement>) =>
      dispatch({ type: 'patch', id, patch }),
    [],
  );
  const deleteElement = useCallback((id: string) => {
    dispatch({ type: 'delete', id });
    setSelectedId((cur) => (cur === id ? null : cur));
  }, []);
  const snapshot = useCallback(() => dispatch({ type: 'snapshot' }), []);
  const toolDone = useCallback(() => setTool('select'), []);

  // Áp màu hút được từ trang cho phần tử đang chờ
  const applyPickedColor = useCallback(
    (color: string) => {
      const el = elements.find((it) => it.id === eyedropperId);
      if (el) {
        dispatch({ type: 'snapshot' });
        dispatch({
          type: 'patch',
          id: el.id,
          patch:
            el.type === 'text' ? { color } : { fill: color, fillLocked: true },
        });
      }
      setEyedropperId(null);
    },
    [elements, eyedropperId],
  );

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
            <button
              title="Hoàn tác (Ctrl+Z)"
              onClick={undo}
              disabled={hist.past.length === 0}
            >
              ↩ Hoàn tác
            </button>
            <button
              title="Làm lại (Ctrl+Shift+Z)"
              onClick={redo}
              disabled={hist.future.length === 0}
            >
              ↪ Làm lại
            </button>
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

      {eyedropperId && (
        <div className="pick-hint">
          💧 Chạm vào một điểm trên trang để lấy màu tại đó (Esc để huỷ)
        </div>
      )}

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
              onSnapshot={snapshot}
              picking={eyedropperId !== null}
              onPickColor={applyPickedColor}
              onStartEyedrop={setEyedropperId}
            />
          ))}
      </main>
    </div>
  );
}
