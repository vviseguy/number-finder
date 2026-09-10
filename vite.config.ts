/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// The built page may not talk to the network at all: tax files stay on the computer, and anyone can
// verify that by reading this one line in the HTML. Blob workers (pdf.js, the search engine) and
// data: fonts are the only non-inline resources. Dev builds skip it so Vite's live reload works.
const OFFLINE_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' blob:",
  'worker-src blob:',
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'font-src data:',
  'connect-src blob: data:',
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

function offlineOnly(): Plugin {
  return {
    name: 'offline-only-csp',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler: html => html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${OFFLINE_CSP}" />`),
    },
  };
}

// The production build is ONE self-contained HTML file: scripts, styles, fonts, and workers inlined.
export default defineConfig({
  plugins: [react(), viteSingleFile(), offlineOnly()],
  build: {
    target: 'es2022',
    assetsInlineLimit: 100_000_000,
    chunkSizeWarningLimit: 20_000,
  },
  worker: { format: 'es' },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
