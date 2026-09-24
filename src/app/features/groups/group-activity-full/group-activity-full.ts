import { Component, effect, inject, input, signal } from '@angular/core';

import { GroupsService, type GroupMemberProfile } from '../../../core/groups/groups';
import { GroupActivity } from '../group-activity/group-activity';

@Component({
  selector: 'mfx-group-activity-full',
  imports: [GroupActivity],
  templateUrl: './group-activity-full.html',
})
export class GroupActivityFull {
  private readonly groupsService = inject(GroupsService);

  readonly groupId = input.required<string>();

  readonly members = signal<GroupMemberProfile[]>([]);
  readonly membersLoading = signal(false);
  readonly membersError = signal<string | null>(null);

  constructor() {
    effect(() => {
      const id = this.groupId();
      this.membersLoading.set(true);
      this.membersError.set(null);
      this.groupsService
        .getMemberProfiles(id)
        .then((profiles) => this.members.set(profiles))
        .catch((error) => {
          console.error('Error al cargar los miembros del grupo', error);
          this.membersError.set('No pudimos cargar los datos de los miembros.');
        })
        .finally(() => this.membersLoading.set(false));
    });
  }
}
