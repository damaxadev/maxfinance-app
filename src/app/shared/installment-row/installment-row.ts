import { Component, computed, input, output } from '@angular/core';

import type { Debt } from '../../core/debts/debts';
import type { Installment } from '../../models/movement.model';
import { AnimatedNumber } from '../animated-number/animated-number';
import { MfxCurrencyPipe } from '../currency/currency.pipe';

export type InstallmentRowSize = 'cozy' | 'compact';

@Component({
  selector: 'mfx-installment-row',
  imports: [AnimatedNumber, MfxCurrencyPipe],
  templateUrl: './installment-row.html',
  styleUrl: './installment-row.scss',
})
export class InstallmentRow {
  readonly installment = input.required<Installment>();
  // 0-based — se muestra como index() + 1 ("Cuota 1", "Cuota 2"...).
  readonly index = input.required<number>();
  // false en la vista de solo lectura de SharedExpenseForm (gasto bloqueado
  // o de otro miembro) — esa acción vive solo en GroupActivity, nunca se
  // muestra el botón ahí sea cual sea el estado de la cuota.
  readonly interactive = input(true);
  // 'cozy' (default): vista de detalle en SharedExpenseForm — título y
  // fecha en líneas propias, nada compite por espacio. 'compact': resumen
  // embebido en GroupActivity — título+fecha en una sola línea, más chico,
  // para que una fila de actividad no crezca demasiado.
  readonly size = input<InstallmentRowSize>('cozy');
  // Estado REAL de esta cuota, calculado desde los abonos — ver
  // DATABASE.md, "Balance de grupo y abonos" (core/debts/debts.ts,
  // computeDebts/debtsByMovement). Ausente (null, default): cae al
  // criterio viejo, installment().status — lo sigue usando
  // SharedExpenseForm, que no tiene a mano el balance completo del grupo
  // para calcularlo. Cualquier consumidor que SÍ lo tenga (GroupActivity)
  // debe pasarlo siempre: installments[].status ya no es la fuente de
  // verdad del balance, solo queda para la UI de cuotas y el recordatorio
  // (hasPendingInstallments) — puede estar desactualizado un instante tras
  // un abono que no vino de payInstallment (ver syncInstallmentStatus).
  readonly debt = input<Debt | null>(null);
  readonly pay = output<void>();

  readonly status = computed(() => this.debt()?.status ?? (this.installment().status === 'paid' ? 'pagada' : 'pendiente'));
  readonly isPaid = computed(() => this.status() === 'pagada');
  readonly isPartial = computed(() => this.status() === 'parcial');

  // Solo el día, sin hora — "2 de nov", no "2 de nov, 10:03 p.m." (la fecha
  // de una cuota es un plazo, no un instante registrado).
  formattedDate(): string {
    const date = this.installment().dueDate.toDate();
    const month = date.toLocaleDateString('es-CO', { month: 'short' }).replace('.', '');
    return `${date.getDate()} de ${month}`;
  }
}
