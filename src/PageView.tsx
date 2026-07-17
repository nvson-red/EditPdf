import { memo, useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist';
import { pdfjs } from './pdf';
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
  /** Ghi mốc lịch sử trước một chuỗi thay đổi liên tục (kéo, gõ chữ...). */
  onSnapshot: () => void;
  /** Đang ở chế độ hút màu — chạm vào trang sẽ lấy màu tại điểm chạm. */
  picking: boolean;
  onPickColor: (color: string) => void;
  onStartEyedrop: (id: string) => void;
}

interface DraftRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

// Khoá cuộn trang trong lúc kéo: touch-action bị Safari/iOS tôn trọng không
// triệt để, nên chặn thẳng touchmove ở mức document (non-passive) khi một
// thao tác kéo đang diễn ra. Đếm số lượt khoá để các thao tác lồng nhau an toàn.
let scrollLockCount = 0;
const preventTouchScroll = (e: TouchEvent) => e.preventDefault();
function lockPageScroll() {
  if (++scrollLockCount === 1) {
    document.addEventListener('touchmove', preventTouchScroll, { passive: false });
  }
}
function unlockPageScroll() {
  if (scrollLockCount > 0 && --scrollLockCount === 0) {
    document.removeEventListener('touchmove', preventTouchScroll);
  }
}

export const PageView = memo(function PageView(props: PageViewProps) {
  const { doc, pageNumber, scale, tool } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
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

  useEffect(() => {
    const container = textLayerRef.current;
    if (!page || !container) return;
    const viewport = page.getViewport({ scale });
    container.style.width = `${viewport.width}px`;
    container.style.height = `${viewport.height}px`;
    container.innerHTML = '';
    let layer: InstanceType<typeof pdfjs.TextLayer> | null = null;
    page.getTextContent().then((textContent) => {
      if (!container.isConnected) return;
      layer = new pdfjs.TextLayer({
        textContentSource: textContent,
        container,
        viewport,
      });
      layer.render();
    });
    return () => { layer?.cancel(); };
  }, [page, scale]);

  // Lấy màu nền quanh một hình chữ nhật (đơn vị PDF) bằng cách đọc dải
  // pixel viền ngoài của nó trên canvas và lấy trung vị từng kênh màu —
  // trung vị bỏ qua được chữ/đường kẻ lọt vào dải mẫu.
  function sampleBackground(x: number, y: number, w: number, h: number): string | null {
    const canvas = canvasRef.current;
    if (!canvas || !page || canvas.width === 0) return null;
    const base = page.getViewport({ scale: 1 });
    const f = canvas.width / base.width; // pixel canvas trên mỗi đơn vị PDF
    const ctx = canvas.getContext('2d')!;
    const m = Math.max(3, Math.round(3 * f)); // bề dày dải mẫu
    const x0 = Math.round(x * f);
    const y0 = Math.round(y * f);
    const x1 = Math.round((x + w) * f);
    const y1 = Math.round((y + h) * f);
    const strips: [number, number, number, number][] = [
      [x0 - m, y0 - m, x1 - x0 + 2 * m, m], // trên
      [x0 - m, y1, x1 - x0 + 2 * m, m], // dưới
      [x0 - m, y0, m, y1 - y0], // trái
      [x1, y0, m, y1 - y0], // phải
    ];
    const rs: number[] = [];
    const gs: number[] = [];
    const bs: number[] = [];
    for (let [sx, sy, sw, sh] of strips) {
      if (sx < 0) { sw += sx; sx = 0; }
      if (sy < 0) { sh += sy; sy = 0; }
      sw = Math.min(sw, canvas.width - sx);
      sh = Math.min(sh, canvas.height - sy);
      if (sw <= 0 || sh <= 0) continue;
      const data = ctx.getImageData(sx, sy, sw, sh).data;
      for (let i = 0; i < data.length; i += 4) {
        rs.push(data[i]);
        gs.push(data[i + 1]);
        bs.push(data[i + 2]);
      }
    }
    if (rs.length === 0) return null;
    const median = (arr: number[]) => {
      arr.sort((a, b) => a - b);
      return arr[arr.length >> 1];
    };
    const hex = (v: number) => v.toString(16).padStart(2, '0');
    return `#${hex(median(rs))}${hex(median(gs))}${hex(median(bs))}`;
  }

  // Đọc màu một điểm trên trang (toạ độ đơn vị PDF)
  function samplePixel(x: number, y: number): string | null {
    const canvas = canvasRef.current;
    if (!canvas || !page || canvas.width === 0) return null;
    const base = page.getViewport({ scale: 1 });
    const f = canvas.width / base.width;
    const px = Math.min(canvas.width - 1, Math.max(0, Math.round(x * f)));
    const py = Math.min(canvas.height - 1, Math.max(0, Math.round(y * f)));
    const d = canvas.getContext('2d')!.getImageData(px, py, 1, 1).data;
    const hex = (v: number) => v.toString(16).padStart(2, '0');
    return `#${hex(d[0])}${hex(d[1])}${hex(d[2])}`;
  }

  // Toạ độ chuột -> đơn vị PDF (scale 1)
  function toPdfCoords(e: { clientX: number; clientY: number }) {
    const rect = overlayRef.current!.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / scale,
      y: (e.clientY - rect.top) / scale,
    };
  }

  function handleOverlayPointerDown(e: React.PointerEvent) {
    if (props.picking) {
      // Ở chế độ hút màu, mọi phần tử con đã tắt pointer-events nên
      // sự kiện luôn tới overlay — lấy màu tại điểm chạm rồi thoát.
      const { x, y } = toPdfCoords(e);
      const color = samplePixel(x, y);
      if (color) props.onPickColor(color);
      return;
    }
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
      lockPageScroll();
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
    unlockPageScroll();
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
      if (tool === 'whiteout') {
        el.fill = sampleBackground(x, y, w, h) ?? '#ffffff';
      }
      props.onAddElement(el);
      props.onSelect(el.id);
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
          ref={textLayerRef}
          className="text-layer"
          onPointerDown={() => {
            if (tool === 'select') props.onSelect(null);
          }}
        />
        <div
          ref={overlayRef}
          className={`overlay${props.picking ? ' picking' : ''}`}
          style={{
            cursor: props.picking ? 'crosshair' : cursor,
            touchAction:
              tool === 'select' && !props.picking
                ? 'pan-x pan-y pinch-zoom'
                : 'none',
            pointerEvents:
              tool === 'select' && !props.picking ? 'none' : undefined,
          }}
          onPointerDown={handleOverlayPointerDown}
          onPointerMove={handleOverlayPointerMove}
          onPointerUp={handleOverlayPointerUp}
          onPointerCancel={handleOverlayPointerUp}
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
                onStartEyedrop={props.onStartEyedrop}
                onSnapshot={props.onSnapshot}
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
                onStartEyedrop={props.onStartEyedrop}
                onSnapshot={props.onSnapshot}
                onSettled={(r) => {
                  if (r.type !== 'whiteout' || r.fillLocked) return;
                  const fill = sampleBackground(r.x, r.y, r.w, r.h);
                  if (fill) props.onUpdateElement(r.id, { fill });
                }}
              />
            ),
          )}
          {draft && (
            <div
              className="rect-el"
              style={{
                left: Math.min(draft.x0, draft.x1) * scale,
                top: Math.min(draft.y0, draft.y1) * scale,
                width: Math.abs(draft.x1 - draft.x0) * scale,
                height: Math.abs(draft.y1 - draft.y0) * scale,
                background:
                  tool === 'whiteout'
                    ? 'rgba(255, 255, 255, 0.85)'
                    : 'rgba(255, 235, 59, 0.45)',
                outline: '1px dashed #1a73e8',
                pointerEvents: 'none',
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
  onStartEyedrop: (id: string) => void;
  onSnapshot: () => void;
}

function hexToRgba(hex: string, alpha: number): string {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** Kéo-thả chung: trả về handler pointerdown bắt đầu di chuyển phần tử. */
function useDrag(
  toPdfCoords: ElProps<EditorElement>['toPdfCoords'],
  onMove: (dx: number, dy: number) => void,
  onDone: () => void,
  onStart?: () => void,
) {
  const start = useRef<{ x: number; y: number } | null>(null);
  const end = () => {
    if (!start.current) return;
    start.current = null;
    unlockPageScroll();
    onDone();
  };
  return {
    onPointerDown(e: React.PointerEvent) {
      e.stopPropagation();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      start.current = toPdfCoords(e);
      lockPageScroll();
      onStart?.();
    },
    onPointerMove(e: React.PointerEvent) {
      if (!start.current) return;
      const p = toPdfCoords(e);
      onMove(p.x - start.current.x, p.y - start.current.y);
      start.current = p;
    },
    onPointerUp: end,
    onPointerCancel: end,
  };
}

function RectBox({
  el,
  scale,
  selected,
  toPdfCoords,
  onUpdate,
  onDelete,
  onSelect,
  onStartEyedrop,
  onSnapshot,
  onSettled,
}: ElProps<RectElement> & { onSettled: (el: RectElement) => void }) {
  const move = useDrag(
    toPdfCoords,
    (dx, dy) => onUpdate(el.id, { x: el.x + dx, y: el.y + dy }),
    () => onSettled(el),
    onSnapshot,
  );
  const resize = useDrag(
    toPdfCoords,
    (dx, dy) =>
      onUpdate(el.id, { w: Math.max(4, el.w + dx), h: Math.max(4, el.h + dy) }),
    () => onSettled(el),
    onSnapshot,
  );

  return (
    <div
      className={`rect-el ${el.type} ${selected ? 'selected' : ''}`}
      style={{
        left: el.x * scale,
        top: el.y * scale,
        width: el.w * scale,
        height: el.h * scale,
        background:
          el.type === 'whiteout'
            ? (el.fill ?? '#ffffff')
            : hexToRgba(el.fill ?? '#ffeb3b', 0.45),
      }}
      {...move}
      onPointerDown={(e) => {
        onSelect(el.id);
        move.onPointerDown(e);
      }}
    >
      {selected && (
        <>
          <div className="text-toolbar" onPointerDown={(e) => e.stopPropagation()}>
            <input
              type="color"
              title="Chọn màu"
              value={el.fill ?? (el.type === 'whiteout' ? '#ffffff' : '#ffeb3b')}
              onFocus={onSnapshot}
              onChange={(e) =>
                onUpdate(el.id, { fill: e.target.value, fillLocked: true })
              }
            />
            <button title="Lấy màu từ một điểm trên trang" onClick={() => onStartEyedrop(el.id)}>
              💧
            </button>
            <button title="Xoá phần tử" onClick={() => onDelete(el.id)}>
              ✕
            </button>
          </div>
          <div className="resize-handle" {...resize} />
        </>
      )}
    </div>
  );
}

function TextBox({ el, scale, selected, toPdfCoords, onUpdate, onDelete, onSelect, onStartEyedrop, onSnapshot }: ElProps<TextElement>) {
  const editRef = useRef<HTMLDivElement>(null);

  // contentEditable không được điều khiển bởi React để giữ vị trí con trỏ;
  // chỉ gán nội dung một lần khi mount.
  useEffect(() => {
    if (editRef.current) {
      editRef.current.innerText = el.text;
      if (el.text === '') {
        // Focus ngay để không nuốt ký tự đầu khi gõ liền tay; kèm một nhịp
        // focus lại ở frame sau phòng trình duyệt cướp focus về body trong
        // chuỗi sự kiện pointerup/click còn dang dở.
        const t = editRef.current;
        t.focus();
        requestAnimationFrame(() => t.focus());
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Undo/redo đổi text từ bên ngoài — đồng bộ lại DOM (trừ khi đang gõ)
  useEffect(() => {
    const t = editRef.current;
    if (t && document.activeElement !== t && t.innerText !== el.text) {
      t.innerText = el.text;
    }
  }, [el.text]);

  const move = useDrag(
    toPdfCoords,
    (dx, dy) => onUpdate(el.id, { x: el.x + dx, y: el.y + dy }),
    () => {},
    onSnapshot,
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
            onClick={() => {
              onSnapshot();
              onUpdate(el.id, { size: Math.max(6, el.size - 2) });
            }}
          >
            A−
          </button>
          <button
            title="Tăng cỡ chữ"
            onClick={() => {
              onSnapshot();
              onUpdate(el.id, { size: Math.min(96, el.size + 2) });
            }}
          >
            A+
          </button>
          <input
            type="color"
            title="Màu chữ"
            value={el.color}
            onFocus={onSnapshot}
            onChange={(e) => onUpdate(el.id, { color: e.target.value })}
          />
          <button title="Lấy màu chữ từ một điểm trên trang" onClick={() => onStartEyedrop(el.id)}>
            💧
          </button>
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
        onFocus={() => {
          // Ghi mốc trước phiên sửa chữ — cả phiên gõ là một bước undo.
          // Ô vừa tạo còn trống thì bỏ qua (mốc đã ghi lúc thêm phần tử).
          if (el.text !== '') onSnapshot();
        }}
        onInput={(e) =>
          onUpdate(el.id, { text: (e.target as HTMLElement).innerText })
        }
        onKeyDown={(e) => e.stopPropagation()}
      />
    </div>
  );
}
