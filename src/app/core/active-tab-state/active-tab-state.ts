import { Injectable, signal } from '@angular/core';

/**
 * Puente para pedir un cambio de tab desde una vista que no tiene acceso
 * directo al swiper de Shell (p. ej. los encabezados de sección de Inicio,
 * "ver todos" que llevan a Movimientos/Recurrentes/Grupos). Shell escucha
 * requestedIndex() y llama a su propio swiper.slideTo(), luego consume().
 */
@Injectable({
  providedIn: 'root',
})
export class ActiveTabState {
  private readonly _requestedIndex = signal<number | null>(null);
  readonly requestedIndex = this._requestedIndex.asReadonly();

  requestTab(index: number): void {
    this._requestedIndex.set(index);
  }

  consume(): void {
    this._requestedIndex.set(null);
  }
}
