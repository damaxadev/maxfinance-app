import { Injectable, signal } from '@angular/core';

export interface SettlementContext {
  groupId: string;
  fromUid: string;
  toUid: string;
  amount: number;
  fromName: string;
  toName: string;
}

/**
 * Estado compartido del modal de "marcar deuda como saldada" — mismo
 * motivo que los demás *FormState de esta app (Shell-level, fuera del
 * <swiper-slide>). Guarda el contexto completo del edge de deuda (no solo
 * un id) porque el balance del grupo es calculado, no un documento que se
 * pueda re-consultar por id.
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
