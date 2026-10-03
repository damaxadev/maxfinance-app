import { Component, computed, input, output } from '@angular/core';

import type { Installment } from '../../models/movement.model';
import { AnimatedNumber } from '../animated-number/animated-number';

export type InstallmentRowSize = 'cozy' | 'compact';

@Component({
  selector: 'mfx-installment-row',
  imports: [AnimatedNumber],
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
  readonly pay = output<void>();

  readonly isPaid = computed(() => this.installment().status === 'paid');

  // Solo el día, sin hora — "2 de nov", no "2 de nov, 10:03 p.m." (la fecha
  // de una cuota es un plazo, no un instante registrado).
  formattedDate(): string {
    const date = this.installment().dueDate.toDate();
    const month = date.toLocaleDateString('es-CO', { month: 'short' }).replace('.', '');
    return `${date.getDate()} de ${month}`;
  }
}
