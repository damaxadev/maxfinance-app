import { Injectable, inject } from '@angular/core';
import { FirebaseMessaging, Importance } from '@capacitor-firebase/messaging';
import { Firestore, arrayUnion, doc, updateDoc } from '@angular/fire/firestore';

import { Auth } from '../auth/auth';

export type NotificationsEnableResult = 'granted' | 'denied' | 'denied-permanently';

export interface ForegroundNotification {
  title: string;
  body: string;
}

// Recuerda si ya se pidió el permiso al menos una vez en este dispositivo.
// El plugin no expone un estado nativo de "no volver a preguntar" — Android
// simplemente vuelve a devolver 'denied' sin mostrar el diálogo de nuevo.
// Esta bandera es la forma de distinguir "primera negativa" (mostrar el
// diálogo) de "ya dijo que no antes" (mandarlo a Ajustes del sistema).
const ASKED_KEY = 'mfx-notifications-asked';

// Ids fijos — los mismos que usan processRecurringPayments/
// generateMonthlyInsights (functions/src/index.ts) al construir el mensaje.
// Tienen que existir ANTES de que llegue el primer push en background/
// cerrado, o Android no tiene dónde clasificarlo y cae a un canal genérico
// (o, en versiones viejas, ni siquiera se muestra). Por eso se crean al
// arranque de la app (ver app.ts), no al pedir el permiso — crear un canal
// no pide permiso ni le muestra nada al usuario todavía.
export const RECURRING_PAYMENTS_CHANNEL_ID = 'recurring-payments';
export const MONTHLY_INSIGHT_CHANNEL_ID = 'monthly-insight';

@Injectable({
  providedIn: 'root',
})
export class Notifications {
  private readonly firestore = inject(Firestore);
  private readonly auth = inject(Auth);

  // Crea ambos canales si no existen todavía (createChannel es idempotente:
  // si el id ya existe, actualiza sus metadatos en vez de duplicarlo). No
  // pide permiso ni muestra nada — seguro de llamar siempre, incluso antes
  // de que el usuario decida algo sobre notificaciones. Cada canal se
  // intenta por separado (best-effort): que uno falle no debe impedir que
  // se cree el otro. En web ambos son no-op (el plugin no lo soporta ahí),
  // por eso el try/catch.
  async ensureNotificationChannel(): Promise<void> {
    await Promise.all([
      this.createChannelSafely({
        id: RECURRING_PAYMENTS_CHANNEL_ID,
        name: 'Pagos recurrentes',
        description: 'Avisos cuando MaxFinance procesa uno de tus pagos recurrentes.',
        importance: Importance.Default,
      }),
      this.createChannelSafely({
        id: MONTHLY_INSIGHT_CHANNEL_ID,
        name: 'Resumen mensual',
        description: 'Aviso cuando tu resumen mensual generado por IA está listo.',
        importance: Importance.Default,
      }),
    ]);
  }

  private async createChannelSafely(channel: {
    id: string;
    name: string;
    description: string;
    importance: Importance;
  }): Promise<void> {
    try {
      await FirebaseMessaging.createChannel(channel);
    } catch (error) {
      console.error('No pudimos crear un canal de notificaciones', error);
    }
  }

  // Caso foreground: con la app abierta, Android nunca toca la bandeja del
  // sistema para un mensaje "notification" — FCM solo lo entrega acá, y si
  // nadie lo muestra, se pierde en silencio. onMessage() es responsabilidad
  // de quien registra el listener (ver app.ts, que lo conecta a un banner
  // visible dentro del sistema de diseño) — este servicio no conoce nada de
  // UI, solo reenvía título/cuerpo.
  listenForForegroundMessages(onMessage: (notification: ForegroundNotification) => void): void {
    void FirebaseMessaging.addListener('notificationReceived', (event) => {
      onMessage({
        title: event.notification.title ?? 'MaxFinance',
        body: event.notification.body ?? '',
      });
    });
  }

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
