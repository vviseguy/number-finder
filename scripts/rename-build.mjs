// Vite writes dist/index.html; ship it under a name people recognize.
import { renameSync, statSync } from 'node:fs';

renameSync('dist/index.html', 'dist/numberfinder.html');
const kb = Math.round(statSync('dist/numberfinder.html').size / 1024);
console.log(`dist/numberfinder.html (${kb.toLocaleString('en-US')} KB, self-contained)`);
