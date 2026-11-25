import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App.tsx';
import './index.css';

declare global {
  interface Window {
    gm_authFailure?: () => void;
  }
}

// Tier 1 Demo-Key Quota Defense for Google Maps Platform
function notifyGmpQuotaExceeded() {
  window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
}

window.gm_authFailure = () => {
  notifyGmpQuotaExceeded();
};

const originalConsoleError = console.error.bind(console);
console.error = (...args: unknown[]) => {
  originalConsoleError(...args);
  try {
    const joined = args
      .map((a) => (typeof a === 'string' ? a : a instanceof Error ? a.message : ''))
      .join(' ');
    if (/OverQuotaMapError|QuotaExceededError|RESOURCE_EXHAUSTED/i.test(joined)) {
      notifyGmpQuotaExceeded();
    }
  } catch {
    // Ignore logging inspection errors
  }
};

// Purge legacy 14-day CacheFirst reference cache so updated 30-species catalog loads immediately
if ('caches' in window) {
  void window.caches.delete('fishcast-reference-cache').catch(() => undefined);
}

if ('serviceWorker' in navigator) {
  registerSW({ immediate: true });
}

createRoot(document.getElementById('root')!).render(<App />);
