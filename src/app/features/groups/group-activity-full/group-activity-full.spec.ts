import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { Accounts } from '../../../core/accounts/accounts';
import { Auth } from '../../../core/auth/auth';
import { Categories } from '../../../core/categories/categories';
import { GroupsService } from '../../../core/groups/groups';
import { MovementsService } from '../../../core/movements/movements';
import { SettlementsService } from '../../../core/settlements/settlements';
import { GroupActivityFull } from './group-activity-full';

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await Promise.resolve();
  }
}

const fakeMembers = [{ uid: 'u1', displayName: 'Diego', email: '', photoURL: '' }];

function configure(getMemberProfiles: ReturnType<typeof vi.fn>) {
  return TestBed.configureTestingModule({
    imports: [GroupActivityFull],
    providers: [
      { provide: GroupsService, useValue: { getMemberProfiles } },
      { provide: Auth, useValue: { currentUser: { uid: 'u1' } } },
      { provide: Accounts, useValue: { accounts$: of([]) } },
      { provide: Categories, useValue: { categories$: of([]) } },
      { provide: MovementsService, useValue: { groupMovements$: () => of([]), countGroupMovements: vi.fn().mockResolvedValue(0) } },
      {
        provide: SettlementsService,
        useValue: {
          settlements$: () => of([]),
          findLinkedMovementSettlementIds: vi.fn().mockResolvedValue(new Set()),
          countGroupSettlements: vi.fn().mockResolvedValue(0),
        },
      },
    ],
  }).compileComponents();
}

describe('GroupActivityFull', () => {
  let component: GroupActivityFull;
  let fixture: ComponentFixture<GroupActivityFull>;
  let getMemberProfiles: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    getMemberProfiles = vi.fn().mockResolvedValue(fakeMembers);
    await configure(getMemberProfiles);

    fixture = TestBed.createComponent(GroupActivityFull);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('groupId', 'group1');
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('loads the members of the group', async () => {
    await flushMicrotasks();
    fixture.detectChanges();

    expect(getMemberProfiles).toHaveBeenCalledWith('group1');
    expect(component.members()).toEqual(fakeMembers);
    expect(fixture.nativeElement.querySelector('mfx-group-activity')).toBeTruthy();
  });
});

describe('GroupActivityFull when loading members fails', () => {
  let fixture: ComponentFixture<GroupActivityFull>;

  beforeEach(async () => {
    await configure(vi.fn().mockRejectedValue(new Error('boom')));

    fixture = TestBed.createComponent(GroupActivityFull);
    fixture.componentRef.setInput('groupId', 'group1');
    fixture.detectChanges();
    await flushMicrotasks();
    fixture.detectChanges();
  });

  it('shows an inline error instead of the activity feed', () => {
    expect(fixture.nativeElement.textContent).toContain('No pudimos cargar los datos de los miembros.');
    expect(fixture.nativeElement.querySelector('mfx-group-activity')).toBeFalsy();
  });
});
