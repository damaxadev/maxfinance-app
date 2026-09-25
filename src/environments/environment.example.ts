// Plantilla — copia este archivo a environment.ts y environment.prod.ts
// (ambos ignorados por git) y completa con los valores reales del proyecto
// Firebase (Consola de Firebase > Configuración del proyecto > Tus apps).
// Refleja "version" en package.json — actualízalo ahí en cada release.
export const APP_VERSION = '1.0.0';

export const environment = {
  production: false,
  firebase: {
    apiKey: 'YOUR_API_KEY',
    authDomain: 'YOUR_PROJECT_ID.firebaseapp.com',
    projectId: 'YOUR_PROJECT_ID',
    storageBucket: 'YOUR_PROJECT_ID.appspot.com',
    messagingSenderId: 'YOUR_MESSAGING_SENDER_ID',
    appId: 'YOUR_APP_ID',
  },
  // URL del Worker de Cloudflare (maxfinance-worker), sin slash al final —
  // ver worker/README y worker/wrangler.toml. Se obtiene con `wrangler deploy`.
  workerUrl: 'https://YOUR_WORKER.YOUR_SUBDOMAIN.workers.dev',
};
