import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { BehaviorSubject } from 'rxjs';

import { Groups } from './groups';
import { GroupsService } from '../../../core/groups/groups';
import { ActiveGroup } from '../../../core/active-group/active-group';
import { GroupDetailState } from '../../../core/group-detail-state/group-detail-state';
import { GroupFormState } from '../../../core/group-form-state/group-form-state';

const group1 = { id: 'group1', name: 'Apartamento', members: ['u1', 'u2'], createdBy: 'u1', createdAt: {} as never };
const group2 = { id: 'group2', name: 'Viaje', members: ['u1'], createdBy: 'u1', createdAt: {} as never };

describe('Groups', () => {
  let component: Groups;
  let fixture: ComponentFixture<Groups>;
  let groups$: BehaviorSubject<(typeof group1)[]>;

  beforeEach(async () => {
    groups$ = new BehaviorSubject<(typeof group1)[]>([]);

    await TestBed.configureTestingModule({
      imports: [Groups],
      providers: [provideNoopAnimations(), { provide: GroupsService, useValue: { groups$ } }],
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

  it('only shows the active-group selector when there is more than one group', () => {
    groups$.next([group1]);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('select')).toBeNull();

    groups$.next([group1, group2]);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('select')).toBeTruthy();
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
});
