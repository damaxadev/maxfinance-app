import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';

import { Card } from '../../../shared/card/card';
import { AnimatedNumber } from '../../../shared/animated-number/animated-number';
import { ProgressRing } from '../../../shared/progress-ring/progress-ring';
import { Accounts } from '../../../core/accounts/accounts';

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

@Component({
  selector: 'mfx-home',
  imports: [Card, AnimatedNumber, ProgressRing],
  templateUrl: './home.html',
  styleUrl: './home.scss',
})
export class Home {
  private readonly accountsService = inject(Accounts);

  readonly accounts = toSignal(this.accountsService.accounts$, { initialValue: [] });
  readonly totalBalance = computed(() => this.accounts().reduce((sum, account) => sum + account.balance, 0));

  // Encabezado de fecha del mes activo — solo informativo por ahora. Fase 6
  // (Presupuesto) lo conectará al cálculo real de gasto filtrado por rango.
  private readonly today = new Date();

  readonly monthLabel = capitalize(
    new Intl.DateTimeFormat('es-CO', { month: 'long', year: 'numeric' }).format(this.today)
  );

  readonly monthRangeLabel = (() => {
    const lastDay = new Date(this.today.getFullYear(), this.today.getMonth() + 1, 0).getDate();
    const monthName = new Intl.DateTimeFormat('es-CO', { month: 'long' }).format(this.today);
    return `1 – ${lastDay} de ${monthName}`;
  })();

  // Presupuesto: todavía no existe (llega en Fase 6) — placeholder de ejemplo.
  readonly budgetUsedPercent = 62;
}
