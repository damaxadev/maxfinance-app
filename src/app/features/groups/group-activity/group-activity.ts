import { Component, computed, inject, input, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { switchMap } from 'rxjs';
import type { Timestamp } from 'firebase/firestore';

import { AbonoDetailState } from '../../../core/abono-detail-state/abono-detail-state';
import { Auth } from '../../../core/auth/auth';
import { Categories } from '../../../core/categories/categories';
import { type Debt, debtsByMovement } from '../../../core/debts/debts';
import { GroupDetailState } from '../../../core/group-detail-state/group-detail-state';
import { GroupsService, type GroupMemberProfile } from '../../../core/groups/groups';
import { MovementsService, type SharedMovementWithId } from '../../../core/movements/movements';
import { SettlementFormState } from '../../../core/settlement-form-state/settlement-form-state';
import { SettlementsService, type SettlementWithId } from '../../../core/settlements/settlements';
import { SharedExpenseFormState } from '../../../core/shared-expense-form-state/shared-expense-form-state';
import type { Installment } from '../../../models/movement.model';
import { AnimatedNumber } from '../../../shared/animated-number/animated-number';
import { Avatar } from '../../../shared/avatar/avatar';
import { MfxCurrencyPipe } from '../../../shared/currency/currency.pipe';
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

// El ORDEN del historial es por createdAt (cuándo se registró de verdad),
// no por `date` (la fecha que el usuario elige y que sigue siendo lo que
// se MUESTRA) — ver DATABASE.md, "Balance de grupo y abonos". `createdAt
// === null` es un serverTimestamp() todavía sin resolver en el snapshot
// local (recién creado) — se trata como "ahora" para que no salte al
// fondo. `createdAt === undefined` es un doc de antes de este campo — cae
// a su `date`.
function orderMillis(entry: { date: Timestamp; createdAt?: Timestamp | null }): number {
  if (entry.createdAt === null) {
    return Date.now();
  }
  if (entry.createdAt === undefined) {
    return entry.date.toMillis();
  }
  return entry.createdAt.toMillis();
}

function entryDoc(entry: ActivityEntry): { date: Timestamp; createdAt?: Timestamp | null } {
  return entry.kind === 'movement' ? entry.movement : entry.settlement;
}

@Component({
  selector: 'mfx-group-activity',
  imports: [AnimatedNumber, Avatar, InstallmentRow, MfxCurrencyPipe],
  templateUrl: './group-activity.html',
  styleUrl: './group-activity.scss',
})
export class GroupActivity {
  private readonly movementsService = inject(MovementsService);
  private readonly settlementsService = inject(SettlementsService);
  private readonly categoriesService = inject(Categories);
  private readonly groupsService = inject(GroupsService);
  private readonly auth = inject(Auth);
  private readonly groupDetailState = inject(GroupDetailState);
  private readonly sharedExpenseFormState = inject(SharedExpenseFormState);
  private readonly settlementFormState = inject(SettlementFormState);
  private readonly abonoDetailState = inject(AbonoDetailState);

  // Uno o varios grupos a la vez — GroupDetail pasa un solo id (sin
  // etiqueta de grupo, ya se sabe cuál es); Inicio pasa todos los grupos
  // del usuario para su feed combinado ("Gastos compartidos recientes"),
  // que sí necesita la etiqueta para distinguir de dónde viene cada entrada.
  readonly groupIds = input.required<string[]>();
  readonly members = input.required<GroupMemberProfile[]>();
  // null == sin límite (GroupDetail: el historial completo, de una, sin
  // paginar); un número muestra solo los primeros N (Inicio, "Gastos
  // compartidos recientes" — un resumen, nunca el historial completo).
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

  // Deudas derivadas por gasto — fuente de verdad de TODAS las marcas de
  // estado de esta vista (gastos, cuotas, resumen por persona). Nunca lee
  // installments[].status ni splits[].settled directo — ver DATABASE.md,
  // "Balance de grupo y abonos".
  private readonly debtsByMovementId = computed(() => debtsByMovement(this.movements(), this.settlements()));

  debtsFor(movementId: string): Debt[] {
    return this.debtsByMovementId().get(movementId) ?? [];
  }

  readonly entries = computed<ActivityEntry[]>(() => {
    const all: ActivityEntry[] = [
      ...this.movements().map((m) => ({ kind: 'movement' as const, id: m.id, date: m.date, movement: m })),
      ...this.settlements().map((s) => ({ kind: 'settlement' as const, id: s.id, date: s.date, settlement: s })),
    ].sort((a, b) => orderMillis(entryDoc(b)) - orderMillis(entryDoc(a)));
    const max = this.limit();
    return max === null ? all : all.slice(0, max);
  });

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
    // Prioriza por el balance real (computeDebts), no por installment.status
    // — una cuota ya cubierta por un abono que no pasó por "Marcar como
    // pagada" (p. ej. "Saldada") no debe seguir contando como la próxima
    // pendiente a mostrar.
    const debts = this.debtsFor(movement.id);
    const firstPendingIndex = all.findIndex(
      (entry) => (debts.find((debt) => debt.installmentIndex === entry.index)?.status ?? 'pendiente') !== 'pagada'
    );
    const start = firstPendingIndex === -1 ? 0 : firstPendingIndex;
    return all.slice(start, start + MAX_VISIBLE_INSTALLMENTS);
  }

  remainingInstallmentsCount(movement: SharedMovementWithId): number {
    return (movement.installments?.length ?? 0) - this.visibleInstallments(movement).length;
  }

  installmentsTotal(movement: SharedMovementWithId): number {
    return movement.installments?.length ?? 0;
  }

  // Calculado desde el balance real (computeDebts), NUNCA desde
  // installments[].status — ver DATABASE.md, "Balance de grupo y abonos".
  paidInstallmentsCount(movement: SharedMovementWithId): number {
    return this.debtsFor(movement.id).filter((debt) => debt.status === 'pagada').length;
  }

  // La deuda real de ESTA cuota puntual — se la pasa a <mfx-installment-row>
  // como [debt] para que calcule su estado real (pendiente/parcial/pagada)
  // en vez de leer installment.status.
  debtForInstallment(movement: SharedMovementWithId, index: number): Debt | null {
    return this.debtsFor(movement.id).find((debt) => debt.installmentIndex === index) ?? null;
  }

  // --- Marcas para un gasto SIN cuotas (ver DATABASE.md) ---

  // 2 personas (un solo deudor además de quien pagó): la deuda única de
  // ese gasto, para una marca simple en línea ("Parcial · resta $X").
  singleDebt(movement: SharedMovementWithId): Debt | null {
    if (movement.installments?.length) {
      return null;
    }
    const debts = this.debtsFor(movement.id);
    return debts.length === 1 ? debts[0] : null;
  }

  // 3+ personas (más de un deudor, sin cuotas): la marca de la lista es un
  // resumen; al expandir (mismo toggle que las cuotas, nunca coexisten en
  // el mismo gasto) se ve el estado de cada persona.
  isMultiDebtor(movement: SharedMovementWithId): boolean {
    return !movement.installments?.length && this.debtsFor(movement.id).length > 1;
  }

  allDebtorsPaid(movement: SharedMovementWithId): boolean {
    const debts = this.debtsFor(movement.id);
    return debts.length > 0 && debts.every((debt) => debt.status === 'pagada');
  }

  anyDebtorPartial(movement: SharedMovementWithId): boolean {
    return this.debtsFor(movement.id).some((debt) => debt.status === 'parcial');
  }

  paidDebtorsCount(movement: SharedMovementWithId): number {
    return this.debtsFor(movement.id).filter((debt) => debt.status === 'pagada').length;
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

  // Solo los dos de la pareja ven el botón — ni el admin (ver DATABASE.md,
  // "Balance de grupo y abonos": el modal de abono es de la pareja, no un
  // superpoder de administración).
  canPayInstallment(movement: SharedMovementWithId): boolean {
    const uid = this.currentUid();
    if (!uid) {
      return false;
    }
    return uid === movement.paidBy || uid === this.debtorUid(movement);
  }

  // Abre el modal de abono con esa cuota preseleccionada por su remaining
  // completo (no por installment.amount — puede ya estar parcialmente
  // pagada) — ver AbonoForm.
  payInstallment(movement: SharedMovementWithId, _installment: Installment, index: number): void {
    const debtorUid = this.debtorUid(movement);
    if (!debtorUid) {
      return;
    }
    this.settlementFormState.open({
      groupId: movement.groupId,
      fromUid: debtorUid,
      toUid: movement.paidBy,
      fromName: this.memberProfile(debtorUid).displayName || 'Alguien',
      toName: this.memberProfile(movement.paidBy).displayName || 'alguien',
      preselect: { mode: 'installment', movementId: movement.id, installmentIndex: index },
    });
  }

  // --- Fila de abono (ver DATABASE.md, "Balance de grupo y abonos") ---

  // Legacy: de antes de que existiera `allocations` — no sabe a qué
  // deuda(s) aplica, se auto-asigna a las más antiguas al leer (ver
  // computeDebts). Nada que desplegar para este caso: solo la etiqueta.
  isLegacySettlement(settlement: SettlementWithId): boolean {
    return !settlement.allocations?.length;
  }

  isVoidedSettlement(settlement: SettlementWithId): boolean {
    return settlement.status === 'voided';
  }

  // Quien lo registró (createdBy) puede ser cualquiera de los dos — si no
  // fue quien pagó (fromUid), se aclara.
  registeredByOther(settlement: SettlementWithId): boolean {
    return !!settlement.createdBy && settlement.createdBy !== settlement.fromUid;
  }

  registeredByName(settlement: SettlementWithId): string {
    return this.memberProfile(settlement.createdBy ?? '').displayName || 'alguien';
  }

  // Tocar una fila de abono abre su detalle completo (ver AbonoDetail) —
  // ahí vive el desglose de allocations, el adjunto, anular, editar nota y
  // "Registrar como gasto/ingreso". Esta fila solo muestra un resumen.
  openSettlementDetail(settlement: SettlementWithId): void {
    this.abonoDetailState.open(settlement);
  }

  hasAttachment(settlement: SettlementWithId): boolean {
    return !!settlement.attachmentPath;
  }
}
