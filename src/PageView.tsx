import { memo, useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist';
import type { EditorElement, RectElement, TextElement, Tool } from './types';
import { newId } from './types';

interface PageViewProps {
  doc: PDFDocumentProxy;
  pageNumber: number; // 1-based
  scale: number;
  tool: Tool;
  elements: EditorElement[];
  selectedId: string | null;
  onAddElement: (el: EditorElement) => void;
  onUpdateElement: (id: string, patch: Partial<EditorElement>) => void;
  onDeleteElement: (id: string) => void;
  onSelect: (id: string | null) => void;
  onToolDone: () => void;
}

interface DraftRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export const PageView = memo(function PageView(props: PageViewProps) {
  const { doc, pageNumber, scale, tool } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState<PDFPageProxy | null>(null);
  const [draft, setDraft] = useState<DraftRect | null>(null);

  useEffect(() => {
    let cancelled = false;
    doc.getPage(pageNumber).then((p) => {
      if (!cancelled) setPage(p);
    });
    return () => {
      cancelled = true;
    };
  }, [doc, pageNumber]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!page || !canvas) return;
    const viewport = page.getViewport({ scale });
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(viewport.width * dpr);
    canvas.height = Math.floor(viewport.height * dpr);
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;
    const task: RenderTask = page.render({
      canvasContext: canvas.getContext('2d')!,
      viewport,
      transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
    });
    task.promise.catch((err: unknown) => {
      if (err instanceof Error && err.name === 'RenderingCancelledException') return;
      console.error(`Lỗi vẽ trang ${pageNumber}:`, err);
    });
    return () => task.cancel();
  }, [page, scale, pageNumber]);

  // Toạ độ chuột -> đơn vị PDF (scale 1)
  function toPdfCoords(e: { clientX: number; clientY: number }) {
    const rect = overlayRef.current!.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / scale,
      y: (e.clientY - rect.top) / scale,
    };
  }

  function handleOverlayPointerDown(e: React.PointerEvent) {
    if (e.target !== overlayRef.current) return;
    const { x, y } = toPdfCoords(e);

    if (tool === 'text') {
      // Chặn hành vi mặc định của mousedown để trình duyệt không kéo focus
      // về body, làm mất focus của ô chữ vừa tạo.
      e.preventDefault();
      const el: TextElement = {
        type: 'text',
        id: newId(),
        page: pageNumber - 1,
        x,
        y,
        text: '',
        size: 14,
        color: '#111111',
      };
      props.onAddElement(el);
      props.onSelect(el.id);
      props.onToolDone();
      return;
    }

    if (tool === 'whiteout' || tool === 'highlight') {
      overlayRef.current!.setPointerCapture(e.pointerId);
      setDraft({ x0: x, y0: y, x1: x, y1: y });
      return;
    }

    props.onSelect(null);
  }

  function handleOverlayPointerMove(e: React.PointerEvent) {
    if (!draft) return;
    const { x, y } = toPdfCoords(e);
    setDraft({ ...draft, x1: x, y1: y });
  }

  function handleOverlayPointerUp() {
    if (!draft) return;
    const x = Math.min(draft.x0, draft.x1);
    const y = Math.min(draft.y0, draft.y1);
    const w = Math.abs(draft.x1 - draft.x0);
    const h = Math.abs(draft.y1 - draft.y0);
    setDraft(null);
    if (w > 3 && h > 3 && (tool === 'whiteout' || tool === 'highlight')) {
      const el: RectElement = {
        type: tool,
        id: newId(),
        page: pageNumber - 1,
        x,
        y,
        w,
        h,
      };
      props.onAddElement(el);
      props.onSelect(el.id);
      props.onToolDone();
    }
  }

  const base = page?.getViewport({ scale: 1 });
  const cursor =
    tool === 'text' ? 'text' : tool === 'select' ? 'default' : 'crosshair';

  return (
    <div className="page-shell">
      <div
        className="page"
        style={{
          width: (base?.width ?? 0) * scale,
          height: (base?.height ?? 0) * scale,
        }}
      >
        <canvas ref={canvasRef} />
        <div
          ref={overlayRef}
          className="overlay"
          style={{ cursor }}
          onPointerDown={handleOverlayPointerDown}
          onPointerMove={handleOverlayPointerMove}
          onPointerUp={handleOverlayPointerUp}
        >
          {props.elements.map((el) =>
            el.type === 'text' ? (
              <TextBox
                key={el.id}
                el={el}
                scale={scale}
                selected={props.selectedId === el.id}
                toPdfCoords={toPdfCoords}
                onUpdate={props.onUpdateElement}
                onDelete={props.onDeleteElement}
                onSelect={props.onSelect}
              />
            ) : (
              <RectBox
                key={el.id}
                el={el}
                scale={scale}
                selected={props.selectedId === el.id}
                toPdfCoords={toPdfCoords}
                onUpdate={props.onUpdateElement}
                onDelete={props.onDeleteElement}
                onSelect={props.onSelect}
              />
            ),
          )}
          {draft && (
            <div
              className={`rect-el ${tool}`}
              style={{
                left: Math.min(draft.x0, draft.x1) * scale,
                top: Math.min(draft.y0, draft.y1) * scale,
                width: Math.abs(draft.x1 - draft.x0) * scale,
                height: Math.abs(draft.y1 - draft.y0) * scale,
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
});

interface ElProps<T> {
  el: T;
  scale: number;
  selected: boolean;
  toPdfCoords: (e: { clientX: number; clientY: number }) => { x: number; y: number };
  onUpdate: (id: string, patch: Partial<EditorElement>) => void;
  onDelete: (id: string) => void;
  onSelect: (id: string | null) => void;
}

/** Kéo-thả chung: trả về handler pointerdown bắt đầu di chuyển phần tử. */
function useDrag(
  toPdfCoords: ElProps<EditorElement>['toPdfCoords'],
  onMove: (dx: number, dy: number) => void,
  onDone: () => void,
) {
  const start = useRef<{ x: number; y: number } | null>(null);
  return {
    onPointerDown(e: React.PointerEvent) {
      e.stopPropagation();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      start.current = toPdfCoords(e);
    },
    onPointerMove(e: React.PointerEvent) {
      if (!start.current) return;
      const p = toPdfCoords(e);
      onMove(p.x - start.current.x, p.y - start.current.y);
      start.current = p;
    },
    onPointerUp() {
      start.current = null;
      onDone();
    },
  };
}

function RectBox({ el, scale, selected, toPdfCoords, onUpdate, onDelete, onSelect }: ElProps<RectElement>) {
  const move = useDrag(
    toPdfCoords,
    (dx, dy) => onUpdate(el.id, { x: el.x + dx, y: el.y + dy }),
    () => {},
  );
  const resize = useDrag(
    toPdfCoords,
    (dx, dy) =>
      onUpdate(el.id, { w: Math.max(4, el.w + dx), h: Math.max(4, el.h + dy) }),
    () => {},
  );

  return (
    <div
      className={`rect-el ${el.type} ${selected ? 'selected' : ''}`}
      style={{
        left: el.x * scale,
        top: el.y * scale,
        width: el.w * scale,
        height: el.h * scale,
      }}
      {...move}
      onPointerDown={(e) => {
        onSelect(el.id);
        move.onPointerDown(e);
      }}
    >
      {selected && (
        <>
          <button
            className="el-delete"
            title="Xoá phần tử"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onDelete(el.id);
            }}
          >
            ✕
          </button>
          <div className="resize-handle" {...resize} />
        </>
      )}
    </div>
  );
}

function TextBox({ el, scale, selected, toPdfCoords, onUpdate, onDelete, onSelect }: ElProps<TextElement>) {
  const editRef = useRef<HTMLDivElement>(null);

  // contentEditable không được điều khiển bởi React để giữ vị trí con trỏ;
  // chỉ gán nội dung một lần khi mount.
  useEffect(() => {
    if (editRef.current) {
      editRef.current.innerText = el.text;
      if (el.text === '') {
        // Đợi hết chuỗi sự kiện pointerdown/up/click rồi mới focus,
        // tránh bị trình duyệt cướp lại focus ngay sau đó.
        const t = editRef.current;
        requestAnimationFrame(() => t.focus());
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const move = useDrag(
    toPdfCoords,
    (dx, dy) => onUpdate(el.id, { x: el.x + dx, y: el.y + dy }),
    () => {},
  );

  return (
    <div
      className={`text-el ${selected ? 'selected' : ''}`}
      style={{ left: el.x * scale, top: el.y * scale }}
      onPointerDown={() => onSelect(el.id)}
    >
      {selected && (
        <div className="text-toolbar" onPointerDown={(e) => e.stopPropagation()}>
          <span className="drag-grip" title="Kéo để di chuyển" {...move}>
            ✥
          </span>
          <button
            title="Giảm cỡ chữ"
            onClick={() => onUpdate(el.id, { size: Math.max(6, el.size - 2) })}
          >
            A−
          </button>
          <button
            title="Tăng cỡ chữ"
            onClick={() => onUpdate(el.id, { size: Math.min(96, el.size + 2) })}
          >
            A+
          </button>
          <input
            type="color"
            title="Màu chữ"
            value={el.color}
            onChange={(e) => onUpdate(el.id, { color: e.target.value })}
          />
          <button title="Xoá phần tử" onClick={() => onDelete(el.id)}>
            ✕
          </button>
        </div>
      )}
      <div
        ref={editRef}
        className="text-edit"
        contentEditable
        spellCheck={false}
        style={{
          fontSize: el.size * scale,
          color: el.color,
          lineHeight: 1.25,
        }}
        onInput={(e) =>
          onUpdate(el.id, { text: (e.target as HTMLElement).innerText })
        }
        onKeyDown={(e) => e.stopPropagation()}
      />
    </div>
  );
}
