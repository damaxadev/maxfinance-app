import { Component, computed, inject, input } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { switchMap } from 'rxjs';

import { Auth } from '../../../core/auth/auth';
import { calculateGroupBalance, type GroupDebtEdge } from '../../../core/group-balance/group-balance';
import type { GroupMemberProfile } from '../../../core/groups/groups';
import { MovementsService } from '../../../core/movements/movements';
import { SettlementFormState } from '../../../core/settlement-form-state/settlement-form-state';
import { SettlementsService } from '../../../core/settlements/settlements';
import { AnimatedNumber } from '../../../shared/animated-number/animated-number';
import { Avatar } from '../../../shared/avatar/avatar';

const UNKNOWN_MEMBER: GroupMemberProfile = { uid: '', displayName: 'Alguien', email: '', photoURL: '' };

@Component({
  selector: 'mfx-group-balance',
  imports: [AnimatedNumber, Avatar],
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
    { initialValue: [] }
  );
  private readonly settlements = toSignal(
    toObservable(this.groupId).pipe(switchMap((id) => this.settlementsService.settlements$(id))),
    { initialValue: [] }
  );

  readonly edges = computed(() => calculateGroupBalance(this.movements(), this.settlements()));

  private readonly currentUid = computed(() => this.auth.currentUser?.uid ?? null);

  memberProfile(uid: string): GroupMemberProfile {
    return this.members().find((member) => member.uid === uid) ?? { ...UNKNOWN_MEMBER, uid };
  }

  canSettle(edge: GroupDebtEdge): boolean {
    const uid = this.currentUid();
    return uid !== null && (uid === edge.fromUid || uid === edge.toUid || this.auth.isAdmin);
  }

  markAsSettled(edge: GroupDebtEdge): void {
    this.settlementFormState.open({
      groupId: this.groupId(),
      fromUid: edge.fromUid,
      toUid: edge.toUid,
      amount: edge.amount,
      fromName: this.memberProfile(edge.fromUid).displayName || 'Alguien',
      toName: this.memberProfile(edge.toUid).displayName || 'alguien',
    });
  }
}
