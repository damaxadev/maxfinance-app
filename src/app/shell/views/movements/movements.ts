import { Component, computed, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { switchMap } from 'rxjs';
import type { Timestamp } from 'firebase/firestore';

import { Card } from '../../../shared/card/card';
import { AnimatedNumber } from '../../../shared/animated-number/animated-number';
import { Accounts, type AccountWithId } from '../../../core/accounts/accounts';
import { Categories } from '../../../core/categories/categories';
import { GroupsService } from '../../../core/groups/groups';
import {
  MovementsService,
  type PersonalMovementWithId,
  type SharedMovementWithId,
} from '../../../core/movements/movements';
import { MovementFormState } from '../../../core/movement-form-state/movement-form-state';
import { AccountFormState } from '../../../core/account-form-state/account-form-state';
import type { AccountType } from '../../../models/account.model';
import { isSharedGroup } from '../../../models/group.model';
import type { MovementType } from '../../../models/movement.model';

const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  efectivo: 'Efectivo',
  banco: 'Banco',
  tarjeta: 'Tarjeta',
};

// Item unificado para la lista: un movimiento personal o un gasto
// compartido que el usuario registró (ver MovementsService.sharedMovementsForGroups$).
// Aplana los campos comunes para que el template no tenga que discriminar
// entre las dos formas de origen en cada binding.
export interface MovementListItem {
  kind: 'personal' | 'shared';
  id: string;
  categoryId: string;
  amount: number;
  type: MovementType;
  date: Timestamp;
  accountId: string | null;
  groupName: string | null;
  // Un grupo personal solo muestra su nombre como etiqueta, sin la palabra
  // "Compartido" — ver DATABASE.md, "Grupos personales".
  groupIsShared: boolean;
  personal: PersonalMovementWithId | null;
}

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
  private readonly groupsService = inject(GroupsService);
  private readonly accountFormState = inject(AccountFormState);
  readonly movementFormState = inject(MovementFormState);

  readonly accounts = toSignal(this.accountsService.accounts$, { initialValue: [] });
  readonly categories = toSignal(this.categoriesService.categories$, { initialValue: [] });
  readonly movements = toSignal(this.movementsService.personalMovements$, { initialValue: [] });

  private readonly groups = toSignal(this.groupsService.groups$, { initialValue: [] });
  private readonly groupsById = computed(() => new Map(this.groups().map((g) => [g.id, g])));
  private readonly groupIds = computed(() => this.groups().map((g) => g.id));

  // Gastos compartidos que el usuario registró, uno por cada grupo al que
  // pertenece — ver el comentario en MovementsService.sharedMovementsForGroups$
  // sobre por qué es un query por grupo y no where('groupId','!=',null).
  readonly sharedMovements = toSignal(
    toObservable(this.groupIds).pipe(switchMap((groupIds) => this.movementsService.sharedMovementsForGroups$(groupIds))),
    { initialValue: [] as SharedMovementWithId[] }
  );

  readonly filterAccountId = signal('');
  readonly filterCategoryId = signal('');
  readonly filterFrom = signal('');
  readonly filterTo = signal('');

  private readonly accountsById = computed(() => new Map(this.accounts().map((a) => [a.id, a])));
  private readonly categoriesById = computed(() => new Map(this.categories().map((c) => [c.id, c])));

  // Combina movimientos personales + gastos compartidos en una sola lista
  // ordenada por fecha — el balance de cuenta suma ambos, así que la lista
  // visible tiene que mostrar ambos también (ver DATABASE.md).
  readonly combinedMovements = computed<MovementListItem[]>(() => {
    const personal: MovementListItem[] = this.movements().map((m) => ({
      kind: 'personal',
      id: m.id,
      categoryId: m.categoryId,
      amount: m.amount,
      type: m.type,
      date: m.date,
      accountId: m.accountId,
      groupName: null,
      groupIsShared: false,
      personal: m,
    }));
    const shared: MovementListItem[] = this.sharedMovements().map((m) => ({
      kind: 'shared',
      id: m.id,
      categoryId: m.categoryId,
      amount: m.amount,
      type: m.type,
      date: m.date,
      accountId: m.accountId ?? null,
      groupName: this.groupsById().get(m.groupId)?.name ?? 'Grupo',
      groupIsShared: isSharedGroup(this.groupsById().get(m.groupId)),
      personal: null,
    }));
    return [...personal, ...shared].sort((a, b) => b.date.toMillis() - a.date.toMillis());
  });

  readonly filteredMovements = computed(() => {
    const accountId = this.filterAccountId();
    const categoryId = this.filterCategoryId();
    const from = this.filterFrom();
    const to = this.filterTo();

    return this.combinedMovements().filter((movement) => {
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

  formatDate(date: Timestamp): string {
    return date.toDate().toLocaleDateString('es-CO', { day: 'numeric', month: 'short' });
  }

  openCreateAccount(): void {
    this.accountFormState.openCreate();
  }

  openEditAccount(account: AccountWithId): void {
    this.accountFormState.openEdit(account);
  }

  editMovement(item: MovementListItem): void {
    if (item.personal) {
      this.movementFormState.openEdit(item.personal);
    }
  }
}
