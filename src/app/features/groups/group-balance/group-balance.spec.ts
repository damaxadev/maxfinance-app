import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { Auth } from '../../../core/auth/auth';
import { MovementsService } from '../../../core/movements/movements';
import { SettlementFormState } from '../../../core/settlement-form-state/settlement-form-state';
import { SettlementsService } from '../../../core/settlements/settlements';
import { GroupBalance } from './group-balance';

const fakeMembers = [
  { uid: 'u1', displayName: 'Diego', email: 'diego@example.com', photoURL: '' },
  { uid: 'u2', displayName: 'Ana', email: 'ana@example.com', photoURL: '' },
];

function sharedMovement(paidBy: string, amount: number, splits: [string, number][]) {
  return {
    id: 'm1',
    uid: paidBy,
    categoryId: 'cat1',
    type: 'expense' as const,
    amount,
    date: {} as never,
    note: '',
    groupId: 'group1',
    paidBy,
    splitType: 'equal' as const,
    splits: splits.map(([uid, splitAmount]) => ({ uid, amount: splitAmount, settled: false })),
  };
}

describe('GroupBalance (viewed by u1, one of the two parties)', () => {
  let component: GroupBalance;
  let fixture: ComponentFixture<GroupBalance>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [GroupBalance],
      providers: [
        { provide: Auth, useValue: { currentUser: { uid: 'u1' }, isAdmin: false } },
        {
          provide: MovementsService,
          useValue: { groupMovements$: () => of([sharedMovement('u1', 100, [['u1', 50], ['u2', 50]])]) },
        },
        { provide: SettlementsService, useValue: { settlements$: () => of([]) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(GroupBalance);
    fixture.componentRef.setInput('groupId', 'group1');
    fixture.componentRef.setInput('members', fakeMembers);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('computes the debt edge from the group movements', () => {
    expect(component.edges()).toEqual([{ fromUid: 'u2', toUid: 'u1', amount: 50 }]);
  });

  it('resolves a known member profile by uid', () => {
    expect(component.memberProfile('u2').displayName).toBe('Ana');
  });

  it('falls back gracefully for an unknown uid', () => {
    expect(component.memberProfile('ghost').displayName).toBe('Alguien');
  });

  it('shows the "Marcar como saldada" button since the current user is a party to the debt', () => {
    fixture.detectChanges();
    const button = fixture.nativeElement.querySelector('.mfx-btn-primary');
    expect(button).toBeTruthy();
    expect(button.textContent).toContain('Marcar como saldada');
  });

  it('markAsSettled() opens SettlementFormState with the edge context', () => {
    const settlementFormState = TestBed.inject(SettlementFormState);

    component.markAsSettled(component.edges()[0]);

    expect(settlementFormState.context()).toEqual({
      groupId: 'group1',
      fromUid: 'u2',
      toUid: 'u1',
      amount: 50,
      fromName: 'Ana',
      toName: 'Diego',
    });
  });
});

describe('GroupBalance (viewed by an outsider — group member, not a party to the debt)', () => {
  let component: GroupBalance;
  let fixture: ComponentFixture<GroupBalance>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [GroupBalance],
      providers: [
        { provide: Auth, useValue: { currentUser: { uid: 'u3' }, isAdmin: false } },
        {
          provide: MovementsService,
          useValue: { groupMovements$: () => of([sharedMovement('u1', 100, [['u1', 50], ['u2', 50]])]) },
        },
        { provide: SettlementsService, useValue: { settlements$: () => of([]) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(GroupBalance);
    fixture.componentRef.setInput('groupId', 'group1');
    fixture.componentRef.setInput('members', fakeMembers);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('does not show the "Marcar como saldada" button', () => {
    expect(fixture.nativeElement.querySelector('.mfx-btn-primary')).toBeNull();
  });
});

describe('GroupBalance with no debts', () => {
  let fixture: ComponentFixture<GroupBalance>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [GroupBalance],
      providers: [
        { provide: Auth, useValue: { currentUser: { uid: 'u1' }, isAdmin: false } },
        { provide: MovementsService, useValue: { groupMovements$: () => of([]) } },
        { provide: SettlementsService, useValue: { settlements$: () => of([]) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(GroupBalance);
    fixture.componentRef.setInput('groupId', 'group1');
    fixture.componentRef.setInput('members', fakeMembers);
    fixture.detectChanges();
  });

  it('shows the "todo saldado" empty state', () => {
    expect(fixture.nativeElement.textContent).toContain('Todo saldado');
  });
});

describe('GroupBalance (viewed by the admin, not a party to the debt)', () => {
  let fixture: ComponentFixture<GroupBalance>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [GroupBalance],
      providers: [
        { provide: Auth, useValue: { currentUser: { uid: 'admin-uid' }, isAdmin: true } },
        {
          provide: MovementsService,
          useValue: { groupMovements$: () => of([sharedMovement('u1', 100, [['u1', 50], ['u2', 50]])]) },
        },
        { provide: SettlementsService, useValue: { settlements$: () => of([]) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(GroupBalance);
    fixture.componentRef.setInput('groupId', 'group1');
    fixture.componentRef.setInput('members', fakeMembers);
    fixture.detectChanges();
  });

  it('shows the "Marcar como saldada" button to the admin too', () => {
    expect(fixture.nativeElement.querySelector('.mfx-btn-primary')).toBeTruthy();
  });
});
