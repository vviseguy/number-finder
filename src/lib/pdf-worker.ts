// Entry point for pdf.js's worker, bundled by Vite as a CLASSIC inline worker (see vite.config.ts,
// worker.format 'iife'). pdf.js's worker starts itself when it loads inside a Web Worker; importing it is
// all this file does. Referencing the export keeps the import from being treated as unused.
import './no-storage'; // first: turns the browser's storage off in this worker
import { WorkerMessageHandler } from 'pdfjs-dist/build/pdf.worker.min.mjs';

const scope = self as unknown as { pdfjsWorker?: unknown };
scope.pdfjsWorker ??= { WorkerMessageHandler };
