import * as pdfjs from 'pdfjs-dist';
// Worker được nhúng inline vào bundle nên chạy được cả từ file://
import PdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?worker&inline';

pdfjs.GlobalWorkerOptions.workerPort = new PdfjsWorker();

export { pdfjs };
