import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { App as CapacitorApp } from '@capacitor/app';

import { GroupDetailState } from './core/group-detail-state/group-detail-state';
import { ModalStack } from './core/modal-stack/modal-stack';
import { NotificationBannerState } from './core/notification-banner-state/notification-banner-state';
import { Notifications } from './core/notifications/notifications';
import { ThemeService } from './core/theme/theme';
import { Toast } from './shared/toast/toast';

@Component({
  selector: 'mfx-root',
  imports: [RouterOutlet, Toast],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  private readonly notifications = inject(Notifications);
  private readonly groupDetailState = inject(GroupDetailState);
  private readonly modalStack = inject(ModalStack);
  readonly notificationBannerState = inject(NotificationBannerState);
  // Se inyecta acá (no se usa desde el template) para que su constructor
  // corra apenas arranca la app — aplica el tema (sistema o guardado) lo
  // antes posible, antes de que el usuario llegue a Ajustes o Login.
  private readonly themeService = inject(ThemeService);

  constructor() {
    // Los tres son seguros de llamar siempre, sin importar si el usuario ya
    // decidió algo sobre el permiso: crear el canal no lo pide, y ambos
    // listeners simplemente no reciben nada hasta que sí haya un token
    // registrado en algún dispositivo.
    void this.notifications.ensureNotificationChannel();
    this.notifications.listenForForegroundMessages((notification) => this.notificationBannerState.show(notification));
    // Tocar una notificación con deep link (te agregaron a un grupo, te
    // asignaron un gasto) abre directo el detalle de ese grupo — funciona
    // incluso si la app estaba completamente cerrada, ver
    // Notifications.listenForNotificationTaps(). GroupDetailState.open()
    // solo guarda el id en un signal; Shell lo lee y muestra el modal en
    // cuanto se monta, sin importar si eso pasa antes o después de este
    // tap (mismo motivo que ActiveTabState).
    this.notifications.listenForNotificationTaps((groupId) => this.groupDetailState.open(groupId));

    // Sin esto, el botón atrás de Android (comportamiento nativo por
    // defecto de Capacitor) navega el Router hacia atrás o cierra la app
    // directo, sin importar si hay un mfx-modal abierto encima — se lleva
    // el modal de un portazo en vez de cerrar solo ese. Acá se reimplementa
    // el default (ver docs de @capacitor/app) pero primero se le da la
    // oportunidad al modal más reciente (ModalStack, que cualquier
    // mfx-modal llena/vacía solo, incluido uno anidado dentro de otro — ver
    // GroupDetail, menú "⋮") de cerrarse él solo.
    void CapacitorApp.addListener('backButton', ({ canGoBack }) => {
      if (this.modalStack.closeTop()) {
        return;
      }
      if (canGoBack) {
        window.history.back();
      } else {
        void CapacitorApp.exitApp();
      }
    });
  }
}
