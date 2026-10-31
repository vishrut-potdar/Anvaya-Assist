import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Suppress benign Vite HMR WebSocket connection errors in cloud iframe environments
if (typeof window !== 'undefined') {
  window.addEventListener('unhandledrejection', (event) => {
    const msg = String(event?.reason?.message || '');
    const stack = String(event?.reason?.stack || '');
    if (
      msg.includes('WebSocket') ||
      msg.includes('Failed to construct') ||
      stack.includes('@vite/client') ||
      stack.includes('createWebSocketModuleRunnerTransport')
    ) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  });

  window.addEventListener('error', (event) => {
    const msg = String(event?.message || '');
    const filename = String(event?.filename || '');
    if (
      msg.includes('WebSocket') ||
      filename.includes('@vite/client') ||
      filename.includes('vite')
    ) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  });
}

createRoot(document.getElementById('root')!).render(<App />);
