import { Injectable, signal } from '@angular/core';

/**
 * Estado compartido del modal de "detalle de grupo" (miembros + invitar) —
 * se renderiza a nivel de Shell, mismo motivo que GroupFormState. Guarda
 * solo el id, no el objeto Group completo: así el detalle siempre lee la
 * versión más reciente desde GroupsService.groups$ (reactivo a cambios de
 * members en vivo, sin quedarse con una copia vieja del snapshot).
 */
@Injectable({
  providedIn: 'root',
})
export class GroupDetailState {
  private readonly _groupId = signal<string | null>(null);
  readonly groupId = this._groupId.asReadonly();

  open(groupId: string): void {
    this._groupId.set(groupId);
  }

  close(): void {
    this._groupId.set(null);
  }
}
