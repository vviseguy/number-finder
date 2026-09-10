/// <reference types="vite/client" />

// ExcelJS's browser bundle (the package's main entry needs Node built-ins).
declare module 'exceljs/dist/exceljs.min.js' {
  import * as ExcelJS from 'exceljs';
  const exceljs: typeof ExcelJS;
  export default exceljs;
}
