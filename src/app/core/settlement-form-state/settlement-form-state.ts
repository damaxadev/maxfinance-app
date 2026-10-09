import { Injectable, signal } from '@angular/core';

// Cómo prellenar el modal de abono al abrirlo — ver AbonoForm. El abono
// siempre va de fromUid a toUid (una DIRECCIÓN, nunca una pareja neta —
// ver DATABASE.md, "Balance de grupo y abonos": las deudas nunca se
// cruzan), sin importar desde cuál de las 3 entradas se abrió ni quién lo
// registre (createdBy, resuelto por AbonoForm contra el uid de quien está
// logueado).
export type AbonoPreselect =
  // "Marcar como saldada" en una línea: el modal calcula el total de ESA
  // dirección él mismo (no se pasa un monto — siempre a partir de datos
  // vivos, nunca de lo que mostraba la línea en el momento de abrir) y lo
  // reparte automático a las deudas más antiguas.
  | { mode: 'auto-total' }
  // "Abonar" en una línea: modal vacío, nada seleccionado.
  | { mode: 'empty' }
  // "Marcar como pagada" en una cuota puntual: esa cuota preseleccionada
  // por su remaining completo (no por installment.amount — puede ya
  // estar parcialmente pagada).
  | { mode: 'installment'; movementId: string; installmentIndex: number };

export interface SettlementContext {
  groupId: string;
  fromUid: string;
  toUid: string;
  fromName: string;
  toName: string;
  preselect: AbonoPreselect;
}

/**
 * Estado compartido del modal de abono — mismo motivo que los demás
 * *FormState de esta app (Shell-level, fuera del <swiper-slide>). Guarda
 * el contexto completo de la pareja (no solo un id) porque el balance del
 * grupo es calculado, no un documento que se pueda re-consultar por id.
 */
@Injectable({
  providedIn: 'root',
})
export class SettlementFormState {
  private readonly _context = signal<SettlementContext | null>(null);
  readonly context = this._context.asReadonly();

  open(context: SettlementContext): void {
    this._context.set(context);
  }

  close(): void {
    this._context.set(null);
  }
}
