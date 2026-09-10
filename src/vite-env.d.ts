/// <reference types="vite/client" />

// pdf.js ships no types for its worker bundle.
declare module 'pdfjs-dist/build/pdf.worker.min.mjs' {
  export const WorkerMessageHandler: unknown;
}

// ExcelJS's browser bundle (the package's main entry needs Node built-ins).
declare module 'exceljs/dist/exceljs.min.js' {
  import * as ExcelJS from 'exceljs';
  const exceljs: typeof ExcelJS;
  export default exceljs;
}
