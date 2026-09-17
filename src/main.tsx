import './lib/no-storage'; // first: turns the browser's storage off before anything else runs
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import interLatin from '@fontsource-variable/inter/files/inter-latin-wght-normal.woff2?url';
import './styles.css';
import { App } from './ui/App';

// Only the Latin subset of Inter is embedded: it covers every tax form and keeps the single file small.
const face = new FontFace('Inter Variable', `url(${interLatin}) format('woff2')`, { weight: '100 900', style: 'normal' });
face.load().then(f => document.fonts.add(f)).catch(() => { /* system font fallback */ });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
