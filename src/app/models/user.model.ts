import type { Timestamp } from 'firebase/firestore';

import type { Uid } from './shared.model';

export interface User {
  uid: Uid;
  displayName: string;
  email: string;
  photoURL: string;
  createdAt: Timestamp;
  // Tokens de Cloud Messaging de cada dispositivo/navegador donde el usuario
  // inició sesión — arreglo (no un solo valor) para no perder notificaciones
  // al usar más de un dispositivo. Ver Notifications, Fase 6.
  fcmTokens?: string[];
}
