import { Injectable, signal } from '@angular/core';

export interface NotificationBanner {
  title: string;
  body: string;
}

const AUTO_DISMISS_MS = 5000;

/**
 * Estado compartido del banner de "notificación en foreground" — se
 * renderiza a nivel de App (fuera del router, visible en cualquier
 * pantalla), no solo dentro del Shell. Ver app.ts: conecta
 * Notifications.listenForForegroundMessages() a show().
 */
@Injectable({
  providedIn: 'root',
})
export class NotificationBannerState {
  private readonly _banner = signal<NotificationBanner | null>(null);
  readonly banner = this._banner.asReadonly();

  show(banner: NotificationBanner): void {
    this._banner.set(banner);
    setTimeout(() => {
      // Solo se autodescarta si sigue siendo ESTE banner — evita que un
      // timeout viejo borre uno nuevo que llegó mientras tanto.
      if (this._banner() === banner) {
        this._banner.set(null);
      }
    }, AUTO_DISMISS_MS);
  }

  dismiss(): void {
    this._banner.set(null);
  }
}
