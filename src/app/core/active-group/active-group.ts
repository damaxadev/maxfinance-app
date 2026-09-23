import { Injectable, signal } from '@angular/core';

/**
 * Grupo activo elegido por el usuario cuando pertenece a varios — lo usa
 * el selector en la vista de Grupos, y en Fase 5 será el default del
 * formulario de gasto compartido.
 */
@Injectable({
  providedIn: 'root',
})
export class ActiveGroup {
  private readonly _groupId = signal<string | null>(null);
  readonly groupId = this._groupId.asReadonly();

  select(groupId: string | null): void {
    this._groupId.set(groupId);
  }
}
