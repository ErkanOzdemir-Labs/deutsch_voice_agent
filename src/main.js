// ============================================
// DeutschVoice Agent — Entry Point
// ============================================

import { App } from './app.js';

// Initialize application when DOM is ready
let app;

document.addEventListener('DOMContentLoaded', () => {
  app = new App();

  // Expose for debugging (dev only)
  if (import.meta.env.DEV) {
    window.__app = app;
  }
});

// Cleanup on unload
window.addEventListener('beforeunload', () => {
  if (app) app.destroy();
});

// Register service worker for PWA
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Service worker registration is optional
    });
  });
}
