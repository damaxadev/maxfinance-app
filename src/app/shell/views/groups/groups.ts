import { Component, computed, effect, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { combineLatest, map, of, switchMap } from 'rxjs';

import { Card } from '../../../shared/card/card';
import { Avatar } from '../../../shared/avatar/avatar';
import { MfxCurrencyPipe } from '../../../shared/currency/currency.pipe';
import { ProgressRing } from '../../../shared/progress-ring/progress-ring';
import { ActiveGroup } from '../../../core/active-group/active-group';
import { GoalEntriesService } from '../../../core/goal-entries/goal-entries';
import { GoalEntryFormState } from '../../../core/goal-entry-form-state/goal-entry-form-state';
import { GoalFormState } from '../../../core/goal-form-state/goal-form-state';
import { computeGoalPercentage, computeGoalSavedAmount, computeOpenEndedPercentage } from '../../../core/goal-progress/goal-progress';
import { GroupsService, type GroupMemberProfile, type GroupWithId } from '../../../core/groups/groups';
import { GroupDetailState } from '../../../core/group-detail-state/group-detail-state';
import { GroupFormState } from '../../../core/group-form-state/group-form-state';
import { SharedExpenseFormState } from '../../../core/shared-expense-form-state/shared-expense-form-state';
import { isSavingsGoal } from '../../../models/group.model';

const MAX_STACKED_AVATARS = 3;

@Component({
  selector: 'mfx-groups',
  imports: [Card, Avatar, ProgressRing, MfxCurrencyPipe],
  templateUrl: './groups.html',
  styleUrl: './groups.scss',
})
export class Groups {
  private readonly groupsService = inject(GroupsService);
  private readonly goalEntriesService = inject(GoalEntriesService);
  private readonly groupDetailState = inject(GroupDetailState);
  private readonly sharedExpenseFormState = inject(SharedExpenseFormState);
  private readonly goalEntryFormState = inject(GoalEntryFormState);
  readonly groupFormState = inject(GroupFormState);
  readonly goalFormState = inject(GoalFormState);
  readonly activeGroup = inject(ActiveGroup);

  private readonly allGroups = toSignal(this.groupsService.groups$, { initialValue: [] });
  // "Tus grupos" y "Metas" son secciones separadas (ver DATABASE.md) — una
  // meta de ahorro nunca participa del selector de grupo activo ("+
  // Agregar gasto compartido" rápido) ni de la lista de "Tus grupos".
  readonly groups = computed(() => this.allGroups().filter((g) => !isSavingsGoal(g)));
  readonly goals = computed(() => this.allGroups().filter(isSavingsGoal));
  readonly maxStackedAvatars = MAX_STACKED_AVATARS;

  // Ahorrado por meta — un listener de goalEntries por cada una (switchMap
  // reconstruye todos los listeners si la lista de metas cambia; ninguna
  // meta tiene tantas entradas como para que esto sea un problema de
  // rendimiento). computeGoalSavedAmount/computeGoalPercentage son las
  // mismas funciones puras que usa GoalEntryForm para el antes/después de
  // los hitos de confetti (ver goal-progress.ts).
  private readonly savedAmountByGoal = toSignal(
    toObservable(this.goals).pipe(
      switchMap((goals) =>
        goals.length === 0
          ? of(new Map<string, number>())
          : combineLatest(
              goals.map((goal) =>
                this.goalEntriesService.entries$(goal.id).pipe(map((entries) => [goal.id, computeGoalSavedAmount(entries)] as const))
              )
            ).pipe(map((pairs) => new Map(pairs)))
      )
    ),
    { initialValue: new Map<string, number>() }
  );

  // Modo 'target': % del monto objetivo. Modo 'open-ended': % hacia el
  // PRÓXIMO múltiplo del monto de celebración (ver GroupDetail, mismo
  // criterio) — acá solo se necesita el número para el anillo mini de la
  // tarjeta, no el detalle de cuánto falta.
  goalProgressPercent(goal: GroupWithId): number {
    const saved = this.savedAmountByGoal().get(goal.id) ?? 0;
    if (goal.goalMode === 'open-ended') {
      return Math.min(100, computeOpenEndedPercentage(saved, goal.celebrationAmount ?? 0).percentage);
    }
    return Math.min(100, computeGoalPercentage(saved, goal.targetAmount ?? 0));
  }

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
      for (const group of this.allGroups()) {
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

  // Acceso rápido a "Registrar aporte/retiro" desde la tarjeta de la meta,
  // mismo criterio que addExpense() (stopPropagation para no abrir también
  // el detalle, que vive en el mismo tap del resto de la tarjeta).
  addGoalEntry(goal: GroupWithId, event: Event): void {
    event.stopPropagation();
    this.goalEntryFormState.open({ groupId: goal.id, groupName: goal.name });
  }
}
