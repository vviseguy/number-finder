// pdf.js set up for a page that must work offline from a single HTML file:
// its worker is bundled inline as a classic worker (see pdf-worker.ts), and nothing is fetched.

import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import PdfWorker from './pdf-worker.ts?worker&inline';

let configured = false;

export function getPdfjs(): typeof pdfjs {
  if (!configured) {
    pdfjs.GlobalWorkerOptions.workerPort = new PdfWorker();
    configured = true;
  }
  return pdfjs;
}

type LoadingTask = ReturnType<typeof pdfjs.getDocument>;
const tasks = new Map<string, LoadingTask>();

/** Load (once) a PDF for previews. pdf.js takes ownership of the bytes it gets, so it gets a copy. */
export function loadPdf(fileId: string, data: ArrayBuffer): Promise<PDFDocumentProxy> {
  let task = tasks.get(fileId);
  if (!task) {
    task = getPdfjs().getDocument({ data: new Uint8Array(data.slice(0)), useSystemFonts: true });
    tasks.set(fileId, task);
  }
  return task.promise;
}

export function forgetPdf(fileId: string): void {
  const task = tasks.get(fileId);
  tasks.delete(fileId);
  task?.destroy().catch(() => { /* already gone */ });
}
