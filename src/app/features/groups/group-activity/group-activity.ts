import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { switchMap } from 'rxjs';
import type { Timestamp } from 'firebase/firestore';

import { Accounts } from '../../../core/accounts/accounts';
import { Auth } from '../../../core/auth/auth';
import { Categories } from '../../../core/categories/categories';
import { GroupActivityFullState } from '../../../core/group-activity-full-state/group-activity-full-state';
import { GroupDetailState } from '../../../core/group-detail-state/group-detail-state';
import { GroupsService, type GroupMemberProfile } from '../../../core/groups/groups';
import { MovementsService, type SharedMovementWithId } from '../../../core/movements/movements';
import { SettlementFormState } from '../../../core/settlement-form-state/settlement-form-state';
import { SettlementsService, type SettlementWithId } from '../../../core/settlements/settlements';
import { SharedExpenseFormState } from '../../../core/shared-expense-form-state/shared-expense-form-state';
import type { Installment } from '../../../models/movement.model';
import { AnimatedNumber } from '../../../shared/animated-number/animated-number';
import { Avatar } from '../../../shared/avatar/avatar';
import { InstallmentRow } from '../../../shared/installment-row/installment-row';

const UNKNOWN_MEMBER: GroupMemberProfile = { uid: '', displayName: 'Alguien', email: '', photoURL: '' };
const RECENT_LIMIT = 10;
// En el feed de Actividad reciente (no en el modal de detalle, que siempre
// muestra el plan completo) se limita a esto para no alargar la fila —
// ver visibleInstallments().
const MAX_VISIBLE_INSTALLMENTS = 3;

type ActivityEntry =
  | { kind: 'movement'; id: string; date: Timestamp; movement: SharedMovementWithId }
  | { kind: 'settlement'; id: string; date: Timestamp; settlement: SettlementWithId };

@Component({
  selector: 'mfx-group-activity',
  imports: [AnimatedNumber, Avatar, InstallmentRow],
  templateUrl: './group-activity.html',
  styleUrl: './group-activity.scss',
})
export class GroupActivity {
  private readonly movementsService = inject(MovementsService);
  private readonly settlementsService = inject(SettlementsService);
  private readonly accountsService = inject(Accounts);
  private readonly categoriesService = inject(Categories);
  private readonly groupsService = inject(GroupsService);
  private readonly auth = inject(Auth);
  private readonly groupActivityFullState = inject(GroupActivityFullState);
  private readonly groupDetailState = inject(GroupDetailState);
  private readonly sharedExpenseFormState = inject(SharedExpenseFormState);
  private readonly settlementFormState = inject(SettlementFormState);

  // Uno o varios grupos a la vez — GroupDetail pasa un solo id (sin
  // etiqueta de grupo, ya se sabe cuál es); Inicio pasa todos los grupos
  // del usuario para su feed combinado ("Gastos compartidos recientes"),
  // que sí necesita la etiqueta para distinguir de dónde viene cada entrada.
  readonly groupIds = input.required<string[]>();
  readonly members = input.required<GroupMemberProfile[]>();
  // null == sin límite (usado por la vista "ver todos"); un número muestra
  // solo los primeros N y activa el conteo total para el link "Ver todos".
  readonly limit = input<number | null>(RECENT_LIMIT);
  // false (default, uso dentro de GroupDetail): tocar una fila abre el
  // gasto para editarlo — tiene sentido, ya estás viendo el detalle de ESE
  // grupo. true (Inicio, ver home.html): tocar una fila abre el detalle del
  // grupo al que pertenece en vez de editar directo — acá el feed mezcla
  // varios grupos a la vez, así que "ver el grupo" es el destino útil, no
  // "editar un gasto sin contexto". Nunca los dos a la vez: ver
  // openMovementOrGroupDetail().
  readonly linkToGroupDetail = input(false);

  readonly showGroupTag = computed(() => this.groupIds().length > 1);

  private readonly currentUid = computed(() => this.auth.currentUser?.uid ?? null);
  readonly accounts = toSignal(this.accountsService.accounts$, { initialValue: [] });
  private readonly categories = toSignal(this.categoriesService.categories$, { initialValue: [] });
  private readonly categoriesById = computed(() => new Map(this.categories().map((c) => [c.id, c])));
  private readonly groups = toSignal(this.groupsService.groups$, { initialValue: [] });
  private readonly groupsById = computed(() => new Map(this.groups().map((g) => [g.id, g])));

  private readonly movements = toSignal(
    toObservable(this.groupIds).pipe(switchMap((ids) => this.movementsService.allSharedMovementsForGroups$(ids))),
    { initialValue: [] as SharedMovementWithId[] }
  );
  private readonly settlements = toSignal(
    toObservable(this.groupIds).pipe(switchMap((ids) => this.settlementsService.settlementsForGroups$(ids))),
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
    // "Ver todos" abre el historial de UN grupo (GroupActivityFullState es
    // groupId-scoped) — no tiene un destino sensible cuando esta lista
    // combina varios grupos a la vez, así que se oculta en ese caso.
    return max !== null && total !== null && total > max && this.groupIds().length === 1;
  });

  readonly linkedSettlementIds = signal<ReadonlySet<string>>(new Set());
  readonly linkingSettlementId = signal<string | null>(null);
  readonly linkAccountId = signal('');
  readonly linking = signal(false);
  readonly linkError = signal<string | null>(null);

  constructor() {
    // El conteo total no es reactivo (getCountFromServer no es un listener en
    // vivo) — se recalcula solo cuando cambian los grupos, es suficiente para
    // decidir si mostrar "Ver todos".
    effect(() => {
      const groupIds = this.groupIds();
      if (this.limit() === null) {
        return;
      }
      this.loadTotalCount(groupIds);
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

  groupName(groupId: string): string {
    return this.groupsById().get(groupId)?.name ?? 'Grupo';
  }

  // Prefiere la categoría denormalizada guardada en el movimiento (ver
  // DATABASE.md, "Categoría denormalizada en gastos compartidos") — un join
  // en vivo contra `categories` falla para categorías personalizadas de
  // otros miembros, que esta vista sí necesita mostrar (a diferencia de
  // Movimientos/Inicio, acá se listan gastos de todo el grupo, no solo los
  // que el usuario actual registró). Cae al join en vivo solo para gastos
  // creados antes de este cambio (categoryName ausente, no null).
  categoryLabel(movement: SharedMovementWithId): string {
    if (movement.categoryId === null) {
      return '🗂️ Sin categoría';
    }
    if (movement.categoryName !== undefined) {
      return `${movement.categoryIcon ?? '❓'} ${movement.categoryName ?? 'Categoría eliminada'}`;
    }
    const category = this.categoriesById().get(movement.categoryId);
    return category ? `${category.icon} ${category.name}` : '❓ Categoría eliminada';
  }

  // Toda fila de gasto es tappable para cualquier miembro — el modal
  // decide si abre editable, de solo lectura, o bloqueado (ver
  // SharedExpenseForm.readOnly()/isLocked()), nunca "no pasa nada al tocar".
  openMovement(movement: SharedMovementWithId): void {
    this.sharedExpenseFormState.openEdit(movement);
  }

  // Punto de entrada real del tap de fila (ver la plantilla) — linkToGroupDetail()
  // decide si el destino es editar el gasto directo (GroupDetail, ya estás
  // en ese grupo) o abrir el detalle del grupo al que pertenece (Inicio,
  // mezcla varios grupos — "ver el grupo" es más útil que editar a ciegas).
  openMovementOrGroupDetail(movement: SharedMovementWithId): void {
    if (this.linkToGroupDetail()) {
      this.groupDetailState.open(movement.groupId);
      return;
    }
    this.openMovement(movement);
  }

  formatDate(date: Timestamp): string {
    return date.toDate().toLocaleDateString('es-CO', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  }

  // El deudor es el único split distinto de paidBy — válido porque las
  // cuotas solo existen en grupos de 2 miembros (ver DATABASE.md, "Pagos a
  // cuotas"): nunca hay más de un posible deudor que resolver.
  private debtorUid(movement: SharedMovementWithId): string | undefined {
    return movement.splits.find((split) => split.uid !== movement.paidBy)?.uid;
  }

  // Expandido por defecto (ver DATABASE.md / "Pagos a cuotas") — el único
  // control que colapsa/expande es el resumen "X de Y cuotas pagadas"
  // (installmentsToggle en la plantilla), que detiene su propia propagación
  // igual que el botón "Marcar como pagada" de InstallmentRow. Tocar
  // cualquier otra parte de la fila —incluido el texto "+N cuotas más"—
  // sigue abriendo el modal igual que el resto. Prioriza la próxima cuota
  // pendiente y las más cercanas, no siempre las primeras N.
  visibleInstallments(movement: SharedMovementWithId): { installment: Installment; index: number }[] {
    const all = (movement.installments ?? []).map((installment, index) => ({ installment, index }));
    if (all.length <= MAX_VISIBLE_INSTALLMENTS) {
      return all;
    }
    const firstPendingIndex = all.findIndex((entry) => entry.installment.status === 'pending');
    const start = firstPendingIndex === -1 ? 0 : firstPendingIndex;
    return all.slice(start, start + MAX_VISIBLE_INSTALLMENTS);
  }

  remainingInstallmentsCount(movement: SharedMovementWithId): number {
    return (movement.installments?.length ?? 0) - this.visibleInstallments(movement).length;
  }

  installmentsTotal(movement: SharedMovementWithId): number {
    return movement.installments?.length ?? 0;
  }

  paidInstallmentsCount(movement: SharedMovementWithId): number {
    return movement.installments?.filter((installment) => installment.status === 'paid').length ?? 0;
  }

  // false (default, GroupDetail sin cambios): cuotas expandidas de entrada,
  // como siempre. true (Inicio): arrancan colapsadas — "X de Y cuotas
  // pagadas ⌄" nada más, se despliega al tocar. El mismo Set de abajo sirve
  // para los dos casos: lo único que cambia es qué significa "estar en el
  // set" (ver isInstallmentsExpanded()), nunca hace falta pre-poblarlo.
  readonly collapsedByDefault = input(false);

  // Colapsado/expandido por movimiento (no global) — un Set de ids en vez
  // de un único "expandido actual", para que varios gastos con cuotas en el
  // mismo feed puedan colapsarse/expandirse de forma independiente.
  private readonly toggledInstallmentIds = signal<ReadonlySet<string>>(new Set());

  isInstallmentsExpanded(movementId: string): boolean {
    const toggled = this.toggledInstallmentIds().has(movementId);
    return this.collapsedByDefault() ? toggled : !toggled;
  }

  toggleInstallments(movementId: string): void {
    const next = new Set(this.toggledInstallmentIds());
    if (next.has(movementId)) {
      next.delete(movementId);
    } else {
      next.add(movementId);
    }
    this.toggledInstallmentIds.set(next);
  }

  // Cualquiera de las dos partes de la deuda (o el admin) puede marcar una
  // cuota como pagada — mismo criterio que GroupBalance.canSettle() para
  // saldar la deuda completa.
  canPayInstallment(movement: SharedMovementWithId): boolean {
    const uid = this.currentUid();
    if (!uid) {
      return false;
    }
    return uid === movement.paidBy || uid === this.debtorUid(movement) || !!this.auth.isAdmin;
  }

  payInstallment(movement: SharedMovementWithId, installment: Installment, index: number): void {
    const debtorUid = this.debtorUid(movement);
    if (!debtorUid) {
      return;
    }
    this.settlementFormState.open({
      groupId: movement.groupId,
      fromUid: debtorUid,
      toUid: movement.paidBy,
      amount: installment.amount,
      fromName: this.memberProfile(debtorUid).displayName || 'Alguien',
      toName: this.memberProfile(movement.paidBy).displayName || 'alguien',
      installmentRef: {
        movementId: movement.id,
        installmentIndex: index,
        totalInstallments: movement.installments?.length ?? 0,
      },
    });
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
    const [onlyGroupId] = this.groupIds();
    if (this.groupIds().length !== 1 || !onlyGroupId) {
      return;
    }
    this.groupActivityFullState.open(onlyGroupId);
  }

  private async loadTotalCount(groupIds: string[]): Promise<void> {
    try {
      const counts = await Promise.all(
        groupIds.flatMap((groupId) => [
          this.movementsService.countGroupMovements(groupId),
          this.settlementsService.countGroupSettlements(groupId),
        ])
      );
      this.totalCount.set(counts.reduce((sum, count) => sum + count, 0));
    } catch (error) {
      console.error('Error al contar la actividad del grupo', error);
    }
  }
}
