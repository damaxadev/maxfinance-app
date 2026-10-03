import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { BehaviorSubject } from 'rxjs';
import { vi } from 'vitest';

import { Groups } from './groups';
import { GoalEntriesService } from '../../../core/goal-entries/goal-entries';
import { GoalEntryFormState } from '../../../core/goal-entry-form-state/goal-entry-form-state';
import { GoalFormState } from '../../../core/goal-form-state/goal-form-state';
import { GroupsService } from '../../../core/groups/groups';
import { ActiveGroup } from '../../../core/active-group/active-group';
import { GroupDetailState } from '../../../core/group-detail-state/group-detail-state';
import { GroupFormState } from '../../../core/group-form-state/group-form-state';
import { SharedExpenseFormState } from '../../../core/shared-expense-form-state/shared-expense-form-state';
import { of } from 'rxjs';

const group1 = { id: 'group1', name: 'Apartamento', members: ['u1', 'u2'], createdBy: 'u1', createdAt: {} as never };
const group2 = { id: 'group2', name: 'Viaje', members: ['u1'], createdBy: 'u1', createdAt: {} as never };
const personalGroup = {
  id: 'group-personal',
  name: 'Ahorros',
  members: ['u1'],
  createdBy: 'u1',
  createdAt: {} as never,
  type: 'personal' as const,
};
const goal1 = {
  id: 'goal1',
  name: 'Vacaciones',
  members: ['u1'],
  createdBy: 'u1',
  createdAt: {} as never,
  type: 'savings' as const,
  targetAmount: 1000,
};

const fourMembers = [
  { uid: 'u1', displayName: 'Diego', email: '', photoURL: '' },
  { uid: 'u2', displayName: 'Ana', email: '', photoURL: '' },
  { uid: 'u3', displayName: 'Beto', email: '', photoURL: '' },
  { uid: 'u4', displayName: 'Cami', email: '', photoURL: '' },
];

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await Promise.resolve();
  }
}

describe('Groups', () => {
  let component: Groups;
  let fixture: ComponentFixture<Groups>;
  let groups$: BehaviorSubject<(typeof group1 | typeof goal1)[]>;
  let getMemberProfiles: ReturnType<typeof vi.fn>;
  let entries$: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    groups$ = new BehaviorSubject<(typeof group1 | typeof goal1)[]>([]);
    getMemberProfiles = vi.fn().mockResolvedValue(fourMembers);
    entries$ = vi.fn().mockReturnValue(of([]));

    await TestBed.configureTestingModule({
      imports: [Groups],
      providers: [
        provideNoopAnimations(),
        { provide: GroupsService, useValue: { groups$, getMemberProfiles } },
        { provide: GoalEntriesService, useValue: { entries$ } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(Groups);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('shows the empty state with no groups', () => {
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Todavía no perteneces a ningún grupo');
  });

  it('defaults the active group to the first one once groups load', () => {
    groups$.next([group1, group2]);
    fixture.detectChanges();

    expect(component.activeGroup.groupId()).toBe('group1');
  });

  it('does not override an already-valid active group selection', () => {
    groups$.next([group1, group2]);
    fixture.detectChanges();

    component.activeGroup.select('group2');
    groups$.next([group1, group2]); // misma lista, no debe resetear a group1
    fixture.detectChanges();

    expect(component.activeGroup.groupId()).toBe('group2');
  });

  it('falls back to the first group if the active selection no longer exists (e.g. left it)', () => {
    groups$.next([group1, group2]);
    fixture.detectChanges();
    component.activeGroup.select('group2');

    groups$.next([group1]); // group2 ya no está
    fixture.detectChanges();

    expect(component.activeGroup.groupId()).toBe('group1');
  });

  it('clears the active group when the user has none left', () => {
    groups$.next([group1]);
    fixture.detectChanges();

    groups$.next([]);
    fixture.detectChanges();

    expect(component.activeGroup.groupId()).toBeNull();
  });

  it('only shows the pill selector when there is more than one group', () => {
    groups$.next([group1]);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.mfx-groups__pill')).toBeNull();

    groups$.next([group1, group2]);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.mfx-groups__pill')).toBeTruthy();
  });

  it('tapping a pill changes the active group', () => {
    groups$.next([group1, group2]);
    fixture.detectChanges();

    const pills = Array.from<HTMLButtonElement>(fixture.nativeElement.querySelectorAll('.mfx-groups__pill'));
    const secondPill = pills.find((p) => p.textContent?.includes('Viaje'));
    secondPill!.click();
    fixture.detectChanges();

    expect(component.activeGroup.groupId()).toBe('group2');
  });

  it('marks the active pill with the "--active" class', () => {
    groups$.next([group1, group2]);
    fixture.detectChanges();

    const pills = Array.from<HTMLButtonElement>(fixture.nativeElement.querySelectorAll('.mfx-groups__pill'));
    const activePill = pills.find((p) => p.classList.contains('mfx-groups__pill--active'));
    expect(activePill?.textContent).toContain('Apartamento');
  });

  it('opens the group detail modal state when a group card is tapped', () => {
    const groupDetailState = TestBed.inject(GroupDetailState);
    groups$.next([group1]);
    fixture.detectChanges();

    component.openDetail(group1);

    expect(groupDetailState.groupId()).toBe('group1');
  });

  it('opens the create-group modal state via the FAB-style "+ Grupo" button', () => {
    const groupFormState = TestBed.inject(GroupFormState);

    component.groupFormState.openCreate();

    expect(groupFormState.open()).toBe(true);
  });

  it('loads member profiles per group and shows a stacked avatar per member (max 3 + "+N")', async () => {
    groups$.next([group1]);
    fixture.detectChanges();
    await flushMicrotasks();
    fixture.detectChanges();

    expect(getMemberProfiles).toHaveBeenCalledWith('group1');
    expect(component.groupMembers('group1')).toEqual(fourMembers);
    expect(fixture.nativeElement.querySelectorAll('.mfx-groups__avatars mfx-avatar').length).toBe(3);
    expect(fixture.nativeElement.querySelector('.mfx-groups__avatar-more').textContent).toContain('+1');
  });

  it('does not re-fetch member profiles for a group already cached', async () => {
    groups$.next([group1]);
    fixture.detectChanges();
    await flushMicrotasks();

    groups$.next([group1]); // misma lista otra vez
    fixture.detectChanges();
    await flushMicrotasks();

    expect(getMemberProfiles).toHaveBeenCalledTimes(1);
  });

  it('addExpense() opens the shared-expense form fixed to that group, without opening its detail', () => {
    const sharedExpenseFormState = TestBed.inject(SharedExpenseFormState);
    groups$.next([group1]);
    fixture.detectChanges();
    const event = new Event('click');
    const stopPropagation = vi.spyOn(event, 'stopPropagation');

    component.addExpense(group1, event);

    expect(sharedExpenseFormState.request()).toEqual({ mode: 'create', groupId: 'group1' });
    expect(stopPropagation).toHaveBeenCalled();
  });

  // Fase 9 (corrección posterior): siempre el formulario estándar de gasto
  // compartido, sin importar el type del grupo.
  it('addExpense() on a personal group opens the standard shared-expense form too', () => {
    const sharedExpenseFormState = TestBed.inject(SharedExpenseFormState);
    groups$.next([personalGroup]);
    fixture.detectChanges();
    const event = new Event('click');

    component.addExpense(personalGroup, event);

    expect(sharedExpenseFormState.request()).toEqual({ mode: 'create', groupId: 'group-personal' });
  });

  describe('Metas (type: "savings")', () => {
    it('keeps goals out of "Tus grupos" and out of the active-group pill selector', () => {
      groups$.next([group1, goal1]);
      fixture.detectChanges();

      expect(component.groups().map((g) => g.id)).toEqual(['group1']);
      expect(component.goals().map((g) => g.id)).toEqual(['goal1']);
      expect(component.activeGroup.groupId()).toBe('group1');
    });

    it('shows the goals empty state separately from the groups empty state', () => {
      groups$.next([group1]);
      fixture.detectChanges();

      expect(fixture.nativeElement.textContent).not.toContain('Todavía no perteneces a ningún grupo');
      expect(fixture.nativeElement.textContent).toContain('Todavía no tienes ninguna meta de ahorro');
    });

    it('opens the create-goal modal state via the "+ Meta" button', () => {
      const goalFormState = TestBed.inject(GoalFormState);

      component.goalFormState.openCreate();

      expect(goalFormState.open()).toBe(true);
    });

    it('opens the group detail modal state when a goal card is tapped (same state as a regular group)', () => {
      const groupDetailState = TestBed.inject(GroupDetailState);
      groups$.next([goal1]);
      fixture.detectChanges();

      component.openDetail(goal1);

      expect(groupDetailState.groupId()).toBe('goal1');
    });

    it('addGoalEntry() opens the goal-entry form state for that goal, without opening its detail', () => {
      const goalEntryFormState = TestBed.inject(GoalEntryFormState);
      groups$.next([goal1]);
      fixture.detectChanges();
      const event = new Event('click');
      const stopPropagation = vi.spyOn(event, 'stopPropagation');

      component.addGoalEntry(goal1, event);

      expect(goalEntryFormState.context()).toEqual({ groupId: 'goal1', groupName: 'Vacaciones' });
      expect(stopPropagation).toHaveBeenCalled();
    });

    it('goalProgressPercent() reads the live ledger via GoalEntriesService and computes the percentage of target', async () => {
      entries$.mockReturnValue(of([{ type: 'contribution', amount: 250 }]));
      groups$.next([goal1]); // target 1000 -> 25%
      fixture.detectChanges();
      await flushMicrotasks();
      fixture.detectChanges();

      expect(entries$).toHaveBeenCalledWith('goal1');
      expect(component.goalProgressPercent(goal1)).toBe(25);
    });

    it('goalProgressPercent() clamps at 100 even if contributions surpass the target', async () => {
      entries$.mockReturnValue(of([{ type: 'contribution', amount: 5000 }]));
      groups$.next([goal1]);
      fixture.detectChanges();
      await flushMicrotasks();
      fixture.detectChanges();

      expect(component.goalProgressPercent(goal1)).toBe(100);
    });

    it('goalProgressPercent() for an "open-ended" goal is the % toward the next celebrationAmount multiple, not of a total', async () => {
      const openEndedGoal = { ...goal1, goalMode: 'open-ended' as const, targetAmount: undefined, celebrationAmount: 1000000 };
      entries$.mockReturnValue(of([{ type: 'contribution', amount: 650000 }]));
      groups$.next([openEndedGoal]);
      fixture.detectChanges();
      await flushMicrotasks();
      fixture.detectChanges();

      expect(component.goalProgressPercent(openEndedGoal)).toBe(65);
    });

    it('shows "Celebra cada $X" instead of "Meta: $X" for an "open-ended" goal card', async () => {
      const openEndedGoal = { ...goal1, goalMode: 'open-ended' as const, targetAmount: undefined, celebrationAmount: 1000000 };
      groups$.next([openEndedGoal]);
      fixture.detectChanges();
      await flushMicrotasks();
      fixture.detectChanges();

      const text = fixture.nativeElement.textContent;
      expect(text).toContain('Celebra cada');
      expect(text).not.toContain('Meta:');
    });
  });
});
