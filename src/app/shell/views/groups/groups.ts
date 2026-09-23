import { Component, effect, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';

import { Card } from '../../../shared/card/card';
import { ActiveGroup } from '../../../core/active-group/active-group';
import { GroupsService, type GroupWithId } from '../../../core/groups/groups';
import { GroupDetailState } from '../../../core/group-detail-state/group-detail-state';
import { GroupFormState } from '../../../core/group-form-state/group-form-state';

@Component({
  selector: 'mfx-groups',
  imports: [Card],
  templateUrl: './groups.html',
  styleUrl: './groups.scss',
})
export class Groups {
  private readonly groupsService = inject(GroupsService);
  private readonly groupDetailState = inject(GroupDetailState);
  readonly groupFormState = inject(GroupFormState);
  readonly activeGroup = inject(ActiveGroup);

  readonly groups = toSignal(this.groupsService.groups$, { initialValue: [] });

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
  }

  openDetail(group: GroupWithId): void {
    this.groupDetailState.open(group.id);
  }
}
