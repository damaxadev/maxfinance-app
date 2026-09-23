import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';

import { Card } from '../../../shared/card/card';
import { AnimatedNumber } from '../../../shared/animated-number/animated-number';
import { Accounts, type AccountWithId } from '../../../core/accounts/accounts';
import { Categories } from '../../../core/categories/categories';
import { MovementsService, type PersonalMovementWithId } from '../../../core/movements/movements';
import { MovementFormState } from '../../../core/movement-form-state/movement-form-state';
import { AccountFormState } from '../../../core/account-form-state/account-form-state';
import type { AccountType } from '../../../models/account.model';

const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  efectivo: 'Efectivo',
  banco: 'Banco',
  tarjeta: 'Tarjeta',
};

@Component({
  selector: 'mfx-movements',
  imports: [Card, AnimatedNumber],
  templateUrl: './movements.html',
  styleUrl: './movements.scss',
})
export class Movements {
  private readonly accountsService = inject(Accounts);
  private readonly categoriesService = inject(Categories);
  private readonly movementsService = inject(MovementsService);
  private readonly accountFormState = inject(AccountFormState);
  readonly movementFormState = inject(MovementFormState);

  readonly accounts = toSignal(this.accountsService.accounts$, { initialValue: [] });
  readonly categories = toSignal(this.categoriesService.categories$, { initialValue: [] });
  readonly movements = toSignal(this.movementsService.personalMovements$, { initialValue: [] });

  readonly filterAccountId = signal('');
  readonly filterCategoryId = signal('');
  readonly filterFrom = signal('');
  readonly filterTo = signal('');

  private readonly accountsById = computed(() => new Map(this.accounts().map((a) => [a.id, a])));
  private readonly categoriesById = computed(() => new Map(this.categories().map((c) => [c.id, c])));

  readonly filteredMovements = computed(() => {
    const accountId = this.filterAccountId();
    const categoryId = this.filterCategoryId();
    const from = this.filterFrom();
    const to = this.filterTo();

    return this.movements().filter((movement) => {
      if (accountId && movement.accountId !== accountId) return false;
      if (categoryId && movement.categoryId !== categoryId) return false;
      if (from && movement.date.toDate() < new Date(`${from}T00:00:00`)) return false;
      if (to && movement.date.toDate() > new Date(`${to}T23:59:59`)) return false;
      return true;
    });
  });

  accountTypeLabel(type: AccountType): string {
    return ACCOUNT_TYPE_LABELS[type];
  }

  accountName(accountId: string): string {
    return this.accountsById().get(accountId)?.name ?? 'Cuenta eliminada';
  }

  categoryIcon(categoryId: string): string {
    return this.categoriesById().get(categoryId)?.icon ?? '❓';
  }

  categoryName(categoryId: string): string {
    return this.categoriesById().get(categoryId)?.name ?? 'Categoría eliminada';
  }

  openCreateAccount(): void {
    this.accountFormState.openCreate();
  }

  openEditAccount(account: AccountWithId): void {
    this.accountFormState.openEdit(account);
  }

  editMovement(movement: PersonalMovementWithId): void {
    this.movementFormState.openEdit(movement);
  }
}
