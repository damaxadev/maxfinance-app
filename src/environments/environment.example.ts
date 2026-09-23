// Plantilla — copia este archivo a environment.ts y environment.prod.ts
// (ambos ignorados por git) y completa con los valores reales del proyecto
// Firebase (Consola de Firebase > Configuración del proyecto > Tus apps).
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
};
