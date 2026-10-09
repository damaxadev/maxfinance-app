import { Component, computed, inject, input, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { switchMap } from 'rxjs';

import { Auth } from '../../../core/auth/auth';
import { type Debt, computeDebts, groupDebtsByMovement } from '../../../core/debts/debts';
import { calculateGroupBalance, type GroupDebtEdge } from '../../../core/group-balance/group-balance';
import type { GroupMemberProfile } from '../../../core/groups/groups';
import { MovementsService, type SharedMovementWithId } from '../../../core/movements/movements';
import { sharedMovementLabel } from '../../../core/movements/movement-label';
import { SettlementFormState } from '../../../core/settlement-form-state/settlement-form-state';
import { SettlementsService } from '../../../core/settlements/settlements';
import { AnimatedNumber } from '../../../shared/animated-number/animated-number';
import { Avatar } from '../../../shared/avatar/avatar';
import { MfxCurrencyPipe } from '../../../shared/currency/currency.pipe';

const UNKNOWN_MEMBER: GroupMemberProfile = { uid: '', displayName: 'Alguien', email: '', photoURL: '' };

@Component({
  selector: 'mfx-group-balance',
  imports: [AnimatedNumber, Avatar, MfxCurrencyPipe],
  templateUrl: './group-balance.html',
  styleUrl: './group-balance.scss',
})
export class GroupBalance {
  private readonly movementsService = inject(MovementsService);
  private readonly settlementsService = inject(SettlementsService);
  private readonly auth = inject(Auth);
  private readonly settlementFormState = inject(SettlementFormState);

  readonly groupId = input.required<string>();
  readonly members = input.required<GroupMemberProfile[]>();

  private readonly movements = toSignal(
    toObservable(this.groupId).pipe(switchMap((id) => this.movementsService.groupMovements$(id))),
    { initialValue: [] as SharedMovementWithId[] }
  );
  private readonly settlements = toSignal(
    toObservable(this.groupId).pipe(switchMap((id) => this.settlementsService.settlements$(id))),
    { initialValue: [] }
  );
  private readonly movementsById = computed(() => new Map(this.movements().map((m) => [m.id, m])));

  private readonly currentUid = computed(() => this.auth.currentUser?.uid ?? null);

  // Una línea por DIRECCIÓN, nunca una por pareja neta — ver DATABASE.md,
  // "Balance de grupo y abonos": las deudas no se cruzan. Orden estable,
  // con las líneas donde participa quien mira primero.
  readonly edges = computed(() => {
    const uid = this.currentUid();
    const all = calculateGroupBalance(this.movements(), this.settlements());
    return [...all].sort((a, b) => {
      const aInvolved = uid !== null && (a.fromUid === uid || a.toUid === uid);
      const bInvolved = uid !== null && (b.fromUid === uid || b.toUid === uid);
      return aInvolved === bInvolved ? 0 : aInvolved ? -1 : 1;
    });
  });

  private readonly debts = computed(() => computeDebts(this.movements(), this.settlements()));

  memberProfile(uid: string): GroupMemberProfile {
    return this.members().find((member) => member.uid === uid) ?? { ...UNKNOWN_MEMBER, uid };
  }

  // Solo los dos de la pareja — ni el admin (ver DATABASE.md, "Balance de
  // grupo y abonos": el modal de abono es de la pareja, no un superpoder
  // de administración).
  canSettle(edge: GroupDebtEdge): boolean {
    const uid = this.currentUid();
    return uid !== null && (uid === edge.fromUid || uid === edge.toUid);
  }

  // "Marcar como saldada": el modal calcula el total de ESA dirección él
  // mismo a partir de datos vivos (nunca del `edge.amount` de este render,
  // que puede quedar viejo si algo cambia mientras el modal está abierto)
  // y lo reparte automático a las deudas más antiguas — ver AbonoForm.
  markAsSettled(edge: GroupDebtEdge): void {
    this.settlementFormState.open({
      groupId: this.groupId(),
      fromUid: edge.fromUid,
      toUid: edge.toUid,
      fromName: this.memberProfile(edge.fromUid).displayName || 'Alguien',
      toName: this.memberProfile(edge.toUid).displayName || 'alguien',
      preselect: { mode: 'auto-total' },
    });
  }

  // "Abonar": mismo modal, vacío — nada preseleccionado.
  abonar(edge: GroupDebtEdge): void {
    this.settlementFormState.open({
      groupId: this.groupId(),
      fromUid: edge.fromUid,
      toUid: edge.toUid,
      fromName: this.memberProfile(edge.fromUid).displayName || 'Alguien',
      toName: this.memberProfile(edge.toUid).displayName || 'alguien',
      preselect: { mode: 'empty' },
    });
  }

  // --- desglose expandible de una línea (gastos/cuotas de esa dirección) ---

  private readonly expandedEdgeKey = signal<string | null>(null);

  private edgeKey(edge: GroupDebtEdge): string {
    return `${edge.fromUid}|${edge.toUid}`;
  }

  isExpanded(edge: GroupDebtEdge): boolean {
    return this.expandedEdgeKey() === this.edgeKey(edge);
  }

  toggleExpanded(edge: GroupDebtEdge): void {
    this.expandedEdgeKey.set(this.isExpanded(edge) ? null : this.edgeKey(edge));
  }

  breakdownFor(edge: GroupDebtEdge): { movementId: string; debts: Debt[] }[] {
    const pending = this.debts().filter(
      (debt) => debt.debtorUid === edge.fromUid && debt.creditorUid === edge.toUid && debt.remaining > 0
    );
    return groupDebtsByMovement(pending);
  }

  movementLabel(movementId: string): string {
    const movement = this.movementsById().get(movementId);
    return movement ? sharedMovementLabel(movement) : 'Gasto eliminado';
  }
}
