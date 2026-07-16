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
  /** Màu tô của ô xoá, lấy mẫu từ nền xung quanh để hoà vào trang. */
  fill?: string;
}

export type EditorElement = TextElement | RectElement;

export function newId(): string {
  return Math.random().toString(36).slice(2, 10);
}
