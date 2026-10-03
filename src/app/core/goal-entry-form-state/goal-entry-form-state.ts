import { Injectable, signal } from '@angular/core';

export interface GoalEntryContext {
  groupId: string;
  groupName: string;
}

/**
 * Estado compartido del modal de "registrar aporte/retiro" de una meta de
 * ahorro — se renderiza a nivel de Shell, mismo motivo que
 * SettlementFormState/GroupFormState. Solo guarda groupId/groupName (lo
 * mínimo para el título del modal y para que GoalEntryForm pueda leer en
 * vivo el plan/ledger de la meta) — no el objeto Group completo, para que
 * el formulario siempre lea la versión más reciente desde GroupsService.
 */
@Injectable({
  providedIn: 'root',
})
export class GoalEntryFormState {
  private readonly _context = signal<GoalEntryContext | null>(null);
  readonly context = this._context.asReadonly();

  open(context: GoalEntryContext): void {
    this._context.set(context);
  }

  close(): void {
    this._context.set(null);
  }
}
