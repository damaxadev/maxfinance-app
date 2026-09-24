import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { switchMap } from 'rxjs';
import type { Timestamp } from 'firebase/firestore';

import { Accounts } from '../../../core/accounts/accounts';
import { Auth } from '../../../core/auth/auth';
import { Categories } from '../../../core/categories/categories';
import { GroupActivityFullState } from '../../../core/group-activity-full-state/group-activity-full-state';
import type { GroupMemberProfile } from '../../../core/groups/groups';
import { MovementsService, type SharedMovementWithId } from '../../../core/movements/movements';
import { SettlementsService, type SettlementWithId } from '../../../core/settlements/settlements';
import { AnimatedNumber } from '../../../shared/animated-number/animated-number';
import { Avatar } from '../../../shared/avatar/avatar';

const UNKNOWN_MEMBER: GroupMemberProfile = { uid: '', displayName: 'Alguien', email: '', photoURL: '' };
const RECENT_LIMIT = 10;

type ActivityEntry =
  | { kind: 'movement'; id: string; date: Timestamp; movement: SharedMovementWithId }
  | { kind: 'settlement'; id: string; date: Timestamp; settlement: SettlementWithId };

@Component({
  selector: 'mfx-group-activity',
  imports: [AnimatedNumber, Avatar],
  templateUrl: './group-activity.html',
  styleUrl: './group-activity.scss',
})
export class GroupActivity {
  private readonly movementsService = inject(MovementsService);
  private readonly settlementsService = inject(SettlementsService);
  private readonly accountsService = inject(Accounts);
  private readonly categoriesService = inject(Categories);
  private readonly auth = inject(Auth);
  private readonly groupActivityFullState = inject(GroupActivityFullState);

  readonly groupId = input.required<string>();
  readonly members = input.required<GroupMemberProfile[]>();
  // null == sin límite (usado por la vista "ver todos"); un número muestra
  // solo los primeros N y activa el conteo total para el link "Ver todos".
  readonly limit = input<number | null>(RECENT_LIMIT);

  private readonly currentUid = computed(() => this.auth.currentUser?.uid ?? null);
  readonly accounts = toSignal(this.accountsService.accounts$, { initialValue: [] });
  private readonly categories = toSignal(this.categoriesService.categories$, { initialValue: [] });
  private readonly categoriesById = computed(() => new Map(this.categories().map((c) => [c.id, c])));

  private readonly movements = toSignal(
    toObservable(this.groupId).pipe(switchMap((id) => this.movementsService.groupMovements$(id))),
    { initialValue: [] as SharedMovementWithId[] }
  );
  private readonly settlements = toSignal(
    toObservable(this.groupId).pipe(switchMap((id) => this.settlementsService.settlements$(id))),
    { initialValue: [] as SettlementWithId[] }
  );

  readonly entries = computed<ActivityEntry[]>(() => {
    const all: ActivityEntry[] = [
      ...this.movements().map((m) => ({ kind: 'movement' as const, id: m.id, date: m.date, movement: m })),
      ...this.settlements().map((s) => ({ kind: 'settlement' as const, id: s.id, date: s.date, settlement: s })),
    ].sort((a, b) => b.date.toMillis() - a.date.toMillis());
    const max = this.limit();
    return max === null ? all : all.slice(0, max);
  });

  readonly totalCount = signal<number | null>(null);
  readonly hasMore = computed(() => {
    const max = this.limit();
    const total = this.totalCount();
    return max !== null && total !== null && total > max;
  });

  readonly linkedSettlementIds = signal<ReadonlySet<string>>(new Set());
  readonly linkingSettlementId = signal<string | null>(null);
  readonly linkAccountId = signal('');
  readonly linking = signal(false);
  readonly linkError = signal<string | null>(null);

  constructor() {
    // El conteo total no es reactivo (getCountFromServer no es un listener en
    // vivo) — se recalcula solo cuando cambia el grupo, es suficiente para
    // decidir si mostrar "Ver todos".
    effect(() => {
      const groupId = this.groupId();
      if (this.limit() === null) {
        return;
      }
      this.loadTotalCount(groupId);
    });

    effect(() => {
      const settlements = this.settlements();
      const uid = this.currentUid();
      if (!uid || settlements.length === 0) {
        this.linkedSettlementIds.set(new Set());
        return;
      }
      this.settlementsService
        .findLinkedMovementSettlementIds(
          settlements.map((s) => s.id),
          uid
        )
        .then((ids) => this.linkedSettlementIds.set(ids))
        .catch((error) => console.error('Error al verificar movimientos vinculados', error));
    });
  }

  memberProfile(uid: string): GroupMemberProfile {
    return this.members().find((member) => member.uid === uid) ?? { ...UNKNOWN_MEMBER, uid };
  }

  categoryLabel(categoryId: string): string {
    const category = this.categoriesById().get(categoryId);
    return category ? `${category.icon} ${category.name}` : '❓ Categoría eliminada';
  }

  formatDate(date: Timestamp): string {
    return date.toDate().toLocaleDateString('es-CO', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  }

  // "Registrar como gasto" si el usuario actual pagó (fromUid), "...ingreso"
  // si lo recibió (toUid) — null si no es parte de este settlement, y en ese
  // caso no hay botón que mostrar en absoluto.
  linkLabel(settlement: SettlementWithId): string | null {
    const uid = this.currentUid();
    if (!uid) {
      return null;
    }
    if (uid === settlement.fromUid) {
      return 'Registrar como gasto';
    }
    if (uid === settlement.toUid) {
      return 'Registrar como ingreso';
    }
    return null;
  }

  alreadyLinked(settlement: SettlementWithId): boolean {
    return this.linkedSettlementIds().has(settlement.id);
  }

  startLinking(settlementId: string): void {
    this.linkingSettlementId.set(settlementId);
    this.linkAccountId.set('');
    this.linkError.set(null);
  }

  cancelLinking(): void {
    this.linkingSettlementId.set(null);
  }

  async confirmLinking(settlement: SettlementWithId): Promise<void> {
    const accountId = this.linkAccountId();
    if (!accountId) {
      this.linkError.set('Selecciona una cuenta.');
      return;
    }

    this.linking.set(true);
    this.linkError.set(null);

    try {
      await this.settlementsService.linkPersonalMovement(settlement, accountId);
      this.linkedSettlementIds.set(new Set([...this.linkedSettlementIds(), settlement.id]));
      this.linkingSettlementId.set(null);
    } catch (error) {
      console.error('Error al registrar el movimiento vinculado', error);
      this.linkError.set('No pudimos registrar el movimiento. Intenta de nuevo.');
    } finally {
      this.linking.set(false);
    }
  }

  openFullHistory(): void {
    this.groupActivityFullState.open(this.groupId());
  }

  private async loadTotalCount(groupId: string): Promise<void> {
    try {
      const [movementsCount, settlementsCount] = await Promise.all([
        this.movementsService.countGroupMovements(groupId),
        this.settlementsService.countGroupSettlements(groupId),
      ]);
      this.totalCount.set(movementsCount + settlementsCount);
    } catch (error) {
      console.error('Error al contar la actividad del grupo', error);
    }
  }
}
