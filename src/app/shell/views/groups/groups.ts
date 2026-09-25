import { Component, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';

import { Card } from '../../../shared/card/card';
import { Avatar } from '../../../shared/avatar/avatar';
import { ActiveGroup } from '../../../core/active-group/active-group';
import { GroupsService, type GroupMemberProfile, type GroupWithId } from '../../../core/groups/groups';
import { GroupDetailState } from '../../../core/group-detail-state/group-detail-state';
import { GroupFormState } from '../../../core/group-form-state/group-form-state';
import { SharedExpenseFormState } from '../../../core/shared-expense-form-state/shared-expense-form-state';

const MAX_STACKED_AVATARS = 3;

@Component({
  selector: 'mfx-groups',
  imports: [Card, Avatar],
  templateUrl: './groups.html',
  styleUrl: './groups.scss',
})
export class Groups {
  private readonly groupsService = inject(GroupsService);
  private readonly groupDetailState = inject(GroupDetailState);
  private readonly sharedExpenseFormState = inject(SharedExpenseFormState);
  readonly groupFormState = inject(GroupFormState);
  readonly activeGroup = inject(ActiveGroup);

  readonly groups = toSignal(this.groupsService.groups$, { initialValue: [] });
  readonly maxStackedAvatars = MAX_STACKED_AVATARS;

  // Perfiles de miembros por grupo, para las píldoras y los avatares
  // apilados de cada tarjeta — se cargan una vez por grupo (no cambian con
  // frecuencia), nunca se vuelven a pedir si ya están en el mapa.
  private readonly memberProfilesByGroup = signal<Map<string, GroupMemberProfile[]>>(new Map());

  constructor() {
    // Mantiene el grupo activo apuntando a uno real: lo defaultea al primero
    // cuando no hay selección (o cuando la selección actual ya no existe,
    // p. ej. porque el usuario salió de ese grupo).
    effect(() => {
      const list = this.groups();
      const current = this.activeGroup.groupId();
      const stillValid = current !== null && list.some((group) => group.id === current);

      if (list.length > 0 && !stillValid) {
        this.activeGroup.select(list[0].id);
      } else if (list.length === 0 && current !== null) {
        this.activeGroup.select(null);
      }
    });

    effect(() => {
      for (const group of this.groups()) {
        if (this.memberProfilesByGroup().has(group.id)) {
          continue;
        }
        this.groupsService
          .getMemberProfiles(group.id)
          .then((profiles) => {
            const next = new Map(this.memberProfilesByGroup());
            next.set(group.id, profiles);
            this.memberProfilesByGroup.set(next);
          })
          .catch((error) => console.error('Error al cargar los miembros del grupo', error));
      }
    });
  }

  groupMembers(groupId: string): GroupMemberProfile[] {
    return this.memberProfilesByGroup().get(groupId) ?? [];
  }

  openDetail(group: GroupWithId): void {
    this.groupDetailState.open(group.id);
  }

  // Siempre el formulario estándar de gasto compartido, sin importar el
  // type del grupo (ver GroupDetail.addExpense() para el mismo criterio).
  addExpense(group: GroupWithId, event: Event): void {
    event.stopPropagation();
    this.sharedExpenseFormState.openCreate(group.id);
  }
}
