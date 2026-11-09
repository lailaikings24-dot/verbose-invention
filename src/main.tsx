import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { initInstallCapture } from './lib/platform';
import './index.css';

const container = document.getElementById('root');
if (!container) throw new Error('Root element missing');

createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// Must run before React so the browser's install event is not missed.
initInstallCapture();

// Offline app shell. Production only — a dev service worker serves stale modules.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  });
}
