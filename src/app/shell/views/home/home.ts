import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';

import { Card } from '../../../shared/card/card';
import { AnimatedNumber } from '../../../shared/animated-number/animated-number';
import { ProgressRing } from '../../../shared/progress-ring/progress-ring';
import { Accounts } from '../../../core/accounts/accounts';

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

  // Presupuesto: todavía no existe (llega en Fase 6) — placeholder de ejemplo.
  readonly budgetUsedPercent = 62;
}
