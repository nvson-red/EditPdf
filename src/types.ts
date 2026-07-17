// Toạ độ và kích thước của mọi phần tử được lưu theo đơn vị PDF point
// (viewport scale = 1, gốc ở góc trên-trái của trang) để không phụ thuộc
// vào mức zoom đang hiển thị.

export type Tool = 'select' | 'text' | 'whiteout' | 'highlight';

export interface TextElement {
  type: 'text';
  id: string;
  page: number;
  x: number;
  y: number;
  text: string;
  size: number;
  color: string;
}

export interface RectElement {
  type: 'whiteout' | 'highlight';
  id: string;
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Màu tô: ô xoá tự lấy mẫu từ nền xung quanh; đánh dấu mặc định vàng. */
  fill?: string;
  /** true khi user tự chọn màu — không tự lấy mẫu lại khi di chuyển nữa. */
  fillLocked?: boolean;
}

export type EditorElement = TextElement | RectElement;

export function newId(): string {
  return Math.random().toString(36).slice(2, 10);
}
