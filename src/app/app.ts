import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';

import { NotificationBannerState } from './core/notification-banner-state/notification-banner-state';
import { Notifications } from './core/notifications/notifications';
import { Toast } from './shared/toast/toast';

@Component({
  selector: 'mfx-root',
  imports: [RouterOutlet, Toast],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  private readonly notifications = inject(Notifications);
  readonly notificationBannerState = inject(NotificationBannerState);

  constructor() {
    // Ambos son seguros de llamar siempre, sin importar si el usuario ya
    // decidió algo sobre el permiso: crear el canal no lo pide, y el
    // listener de foreground simplemente no recibe nada hasta que sí haya
    // un token registrado en algún dispositivo.
    void this.notifications.ensureNotificationChannel();
    this.notifications.listenForForegroundMessages((notification) => this.notificationBannerState.show(notification));
  }
}
