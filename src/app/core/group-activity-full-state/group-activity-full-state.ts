import { Injectable, signal } from '@angular/core';

// Estado compartido del modal "ver toda la actividad del grupo" — mismo
// patrón que GroupDetailState (solo el id, el resto se vuelve a consultar).
@Injectable({
  providedIn: 'root',
})
export class GroupActivityFullState {
  private readonly _groupId = signal<string | null>(null);
  readonly groupId = this._groupId.asReadonly();

  open(groupId: string): void {
    this._groupId.set(groupId);
  }

  close(): void {
    this._groupId.set(null);
  }
}
