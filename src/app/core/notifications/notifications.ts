import { Injectable, inject } from '@angular/core';
import { FirebaseMessaging } from '@capacitor-firebase/messaging';
import { Firestore, arrayUnion, doc, updateDoc } from '@angular/fire/firestore';

import { Auth } from '../auth/auth';

export type NotificationsEnableResult = 'granted' | 'denied' | 'denied-permanently';

// Recuerda si ya se pidió el permiso al menos una vez en este dispositivo.
// El plugin no expone un estado nativo de "no volver a preguntar" — Android
// simplemente vuelve a devolver 'denied' sin mostrar el diálogo de nuevo.
// Esta bandera es la forma de distinguir "primera negativa" (mostrar el
// diálogo) de "ya dijo que no antes" (mandarlo a Ajustes del sistema).
const ASKED_KEY = 'mfx-notifications-asked';

@Injectable({
  providedIn: 'root',
})
export class Notifications {
  private readonly firestore = inject(Firestore);
  private readonly auth = inject(Auth);

  async checkStatus(): Promise<NotificationsEnableResult | 'prompt'> {
    const { receive } = await FirebaseMessaging.checkPermissions();
    if (receive === 'granted') {
      return 'granted';
    }
    if (receive === 'denied') {
      return this.hasAskedBefore() ? 'denied-permanently' : 'denied';
    }
    return 'prompt';
  }

  // Nunca se llama al arranque de la app — solo desde una acción explícita
  // del usuario (activar un pago recurrente, o el toggle de Ajustes). Si ya
  // está concedido, solo (re)registra el token; si no, pide el permiso.
  async enable(): Promise<NotificationsEnableResult> {
    const { isSupported } = await FirebaseMessaging.isSupported();
    if (!isSupported) {
      return 'denied';
    }

    const current = await FirebaseMessaging.checkPermissions();
    if (current.receive === 'denied' && this.hasAskedBefore()) {
      return 'denied-permanently';
    }

    let receive = current.receive;
    if (receive !== 'granted') {
      localStorage.setItem(ASKED_KEY, 'true');
      const result = await FirebaseMessaging.requestPermissions();
      receive = result.receive;
    }

    if (receive !== 'granted') {
      return 'denied';
    }

    await this.registerToken();
    return 'granted';
  }

  private hasAskedBefore(): boolean {
    try {
      return localStorage.getItem(ASKED_KEY) === 'true';
    } catch {
      // localStorage puede no estar disponible (modo privado, etc.) — sin
      // el historial, se trata como "primera vez" y se vuelve a preguntar.
      return false;
    }
  }

  // El token puede no obtenerse en algunos contextos (web sin VAPID key ni
  // service worker configurado, por ejemplo) — se registra "mejor esfuerzo":
  // el permiso queda concedido igual, la app sigue funcionando normal, solo
  // sin poder enviar notificaciones a ese dispositivo específico.
  private async registerToken(): Promise<void> {
    const uid = this.auth.currentUser?.uid;
    if (!uid) {
      return;
    }
    try {
      const { token } = await FirebaseMessaging.getToken();
      await updateDoc(doc(this.firestore, 'users', uid), { fcmTokens: arrayUnion(token) });
    } catch (error) {
      console.error('No pudimos registrar el token de notificaciones en este dispositivo', error);
    }
  }
}
