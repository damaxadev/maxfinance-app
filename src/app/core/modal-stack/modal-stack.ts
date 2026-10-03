import { Injectable } from '@angular/core';

/**
 * Pila de "qué mfx-modal está abierto, en qué orden" — la llena/vacía el
 * propio componente Modal (push al construirse, pop al destruirse), nunca
 * los *FormState individuales: así cualquier modal, incluido uno anidado
 * dentro de otro (ver GroupDetail, menú "⋮"), queda cubierto sin que cada
 * state service tenga que saber nada de esto.
 *
 * El botón atrás de Android (ver App, listenForBackButton) la usa para
 * cerrar solo el modal más reciente en vez de navegar el Router o salir de
 * la app — ver DATABASE.md / Fase 10, "Botón atrás de Android".
 */
@Injectable({
  providedIn: 'root',
})
export class ModalStack {
  private readonly stack: (() => void)[] = [];

  push(onBack: () => void): void {
    this.stack.push(onBack);
  }

  // Por referencia, no por índice — el modal que se destruye puede no ser
  // el último empujado si varios se abren/cierran fuera de orden (no debería
  // pasar en la práctica, pero es más seguro que asumirlo).
  pop(onBack: () => void): void {
    const index = this.stack.lastIndexOf(onBack);
    if (index !== -1) {
      this.stack.splice(index, 1);
    }
  }

  get hasOpen(): boolean {
    return this.stack.length > 0;
  }

  // Cierra el modal más reciente (lo saca de la pila y dispara su propio
  // cierre, que a su vez dispara el (closed) de siempre — mismo camino que
  // tocar el backdrop o la ✕). Devuelve false si no había nada abierto, para
  // que el caller (el listener del botón atrás) sepa si debe dejar que
  // Capacitor haga su comportamiento por defecto (goBack()/salir de la app).
  closeTop(): boolean {
    const onBack = this.stack.pop();
    if (!onBack) {
      return false;
    }
    onBack();
    return true;
  }
}
