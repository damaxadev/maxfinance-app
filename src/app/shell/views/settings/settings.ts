import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { Card } from '../../../shared/card/card';
import { Checkbox } from '../../../shared/checkbox/checkbox';
import { Categories, type CategoryWithId } from '../../../core/categories/categories';
import { CategoryFormState } from '../../../core/category-form-state/category-form-state';
import { Notifications } from '../../../core/notifications/notifications';

@Component({
  selector: 'mfx-settings',
  imports: [Card, RouterLink, Checkbox, ReactiveFormsModule],
  templateUrl: './settings.html',
  styleUrl: './settings.scss',
})
export class Settings {
  private readonly categoriesService = inject(Categories);
  private readonly categoryFormState = inject(CategoryFormState);
  private readonly notificationsService = inject(Notifications);

  private readonly categories = toSignal(this.categoriesService.categories$, { initialValue: [] });
  readonly customCategories = computed(() => this.categories().filter((c) => c.uid !== null));

  // No se pide el permiso al arrancar la app — solo al marcar este toggle.
  // Una vez concedido queda deshabilitado (no hay forma de "revocar" un
  // permiso del sistema desde dentro de la app; eso solo se hace desde
  // Ajustes del sistema).
  readonly notificationsControl = new FormControl(false, { nonNullable: true });
  readonly notificationsMessage = signal<string | null>(null);

  constructor() {
    this.notificationsService
      .checkStatus()
      .then((status) => {
        if (status === 'granted') {
          this.notificationsControl.setValue(true, { emitEvent: false });
          this.notificationsControl.disable({ emitEvent: false });
        }
      })
      .catch((error) => console.error('Error al consultar el estado de notificaciones', error));

    this.notificationsControl.valueChanges.subscribe((checked) => {
      if (checked) {
        void this.enableNotifications();
      }
    });
  }

  openCreateCategory(): void {
    this.categoryFormState.openCreate();
  }

  openEditCategory(category: CategoryWithId): void {
    this.categoryFormState.openEdit(category);
  }

  private async enableNotifications(): Promise<void> {
    this.notificationsMessage.set(null);
    try {
      const result = await this.notificationsService.enable();
      if (result === 'granted') {
        this.notificationsControl.disable({ emitEvent: false });
        return;
      }
      this.notificationsControl.setValue(false, { emitEvent: false });
      this.notificationsMessage.set(
        result === 'denied-permanently'
          ? 'Debes habilitar las notificaciones manualmente desde los ajustes del sistema.'
          : 'No concediste el permiso — puedes intentarlo de nuevo cuando quieras.'
      );
    } catch (error) {
      console.error('Error al activar notificaciones', error);
      this.notificationsControl.setValue(false, { emitEvent: false });
      this.notificationsMessage.set('No pudimos activar las notificaciones. Intenta de nuevo.');
    }
  }
}
