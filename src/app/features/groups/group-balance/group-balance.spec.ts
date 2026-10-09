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

// computeDebts() ordena "deuda más antigua primero" por movement.date, así
// que necesita un Timestamp real (con toMillis()), no un objeto vacío.
const FAKE_DATE = { toDate: () => new Date('2026-01-01'), toMillis: () => new Date('2026-01-01').getTime() } as never;

function sharedMovement(paidBy: string, amount: number, splits: [string, number][]) {
  return {
    id: 'm1',
    uid: paidBy,
    categoryId: 'cat1',
    type: 'expense' as const,
    amount,
    date: FAKE_DATE,
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

  it('markAsSettled() opens SettlementFormState with the "auto-total" preselect', () => {
    const settlementFormState = TestBed.inject(SettlementFormState);

    component.markAsSettled(component.edges()[0]);

    expect(settlementFormState.context()).toEqual({
      groupId: 'group1',
      fromUid: 'u2',
      toUid: 'u1',
      fromName: 'Ana',
      toName: 'Diego',
      preselect: { mode: 'auto-total' },
    });
  });

  it('shows the "Abonar" button alongside "Marcar como saldada"', () => {
    const button: HTMLButtonElement = fixture.nativeElement.querySelector('.mfx-group-balance__abonar-btn');
    expect(button.textContent?.trim()).toBe('Abonar');
  });

  it('abonar() opens SettlementFormState with the "empty" preselect', () => {
    const settlementFormState = TestBed.inject(SettlementFormState);

    component.abonar(component.edges()[0]);

    expect(settlementFormState.context()).toEqual({
      groupId: 'group1',
      fromUid: 'u2',
      toUid: 'u1',
      fromName: 'Ana',
      toName: 'Diego',
      preselect: { mode: 'empty' },
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

  it('does not show the "Abonar" button either', () => {
    expect(fixture.nativeElement.querySelector('.mfx-group-balance__abonar-btn')).toBeNull();
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

// TEST OBLIGATORIO (DOM) — la línea expandida muestra el desglose por
// gasto, con cuotas agrupadas bajo su gasto.
describe('GroupBalance — línea expandible (desglose por gasto)', () => {
  let fixture: ComponentFixture<GroupBalance>;

  beforeEach(async () => {
    const movSinCuotas = sharedMovement('u1', 20000, [['u1', 0], ['u2', 20000]]);
    const movCuotas = {
      ...sharedMovement('u1', 60000, [['u1', 0], ['u2', 60000]]),
      id: 'm-cuotas',
      installments: [
        { amount: 30000, dueDate: FAKE_DATE, status: 'pending' as const },
        { amount: 30000, dueDate: FAKE_DATE, status: 'pending' as const },
      ],
    };

    await TestBed.configureTestingModule({
      imports: [GroupBalance],
      providers: [
        { provide: Auth, useValue: { currentUser: { uid: 'u1' }, isAdmin: false } },
        { provide: MovementsService, useValue: { groupMovements$: () => of([movSinCuotas, movCuotas]) } },
        { provide: SettlementsService, useValue: { settlements$: () => of([]) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(GroupBalance);
    fixture.componentRef.setInput('groupId', 'group1');
    fixture.componentRef.setInput('members', fakeMembers);
    fixture.detectChanges();
  });

  it('arranca colapsada: sin desglose visible', () => {
    expect(fixture.nativeElement.querySelector('.mfx-group-balance__breakdown')).toBeNull();
  });

  it('al tocar la línea, se expande y muestra el desglose con las cuotas agrupadas bajo su gasto', () => {
    const peopleRow: HTMLElement = fixture.nativeElement.querySelector('.mfx-group-balance__people');
    peopleRow.click();
    fixture.detectChanges();

    const breakdown = fixture.nativeElement.querySelector('.mfx-group-balance__breakdown');
    expect(breakdown).toBeTruthy();
    expect(breakdown.querySelectorAll('.mfx-group-balance__breakdown-movement').length).toBe(2);
    expect(breakdown.textContent).toContain('Cuota 1');
    expect(breakdown.textContent).toContain('Cuota 2');
  });

  it('tocar la línea otra vez la colapsa de nuevo', () => {
    const peopleRow: HTMLElement = fixture.nativeElement.querySelector('.mfx-group-balance__people');
    peopleRow.click();
    fixture.detectChanges();
    peopleRow.click();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.mfx-group-balance__breakdown')).toBeNull();
  });
});

// TEST OBLIGATORIO — orden estable, con las líneas donde participa quien
// mira primero.
describe('GroupBalance — orden de las líneas (quien mira primero)', () => {
  it('pone las líneas donde participa el uid actual antes que las demás', async () => {
    const movAB = { ...sharedMovement('u2', 10000, [['u2', 0], ['u3', 10000]]), id: 'm-ab' };
    const movCD = { ...sharedMovement('u1', 20000, [['u1', 0], ['u4', 20000]]), id: 'm-cd' };

    await TestBed.configureTestingModule({
      imports: [GroupBalance],
      providers: [
        { provide: Auth, useValue: { currentUser: { uid: 'u1' }, isAdmin: false } },
        { provide: MovementsService, useValue: { groupMovements$: () => of([movAB, movCD]) } },
        { provide: SettlementsService, useValue: { settlements$: () => of([]) } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(GroupBalance);
    fixture.componentRef.setInput('groupId', 'group1');
    fixture.componentRef.setInput('members', fakeMembers);
    fixture.detectChanges();

    // u3->u2 no involucra a u1; u4->u1 sí — debe ir primero aunque
    // calculateGroupBalance() la haya calculado después.
    expect(fixture.componentInstance.edges()[0]).toEqual({ fromUid: 'u4', toUid: 'u1', amount: 20000 });
  });
});

// Cambio de comportamiento a propósito (ver DATABASE.md, "Balance de grupo
// y abonos"): el modal de abono es de la pareja, ya no un superpoder de
// administración — antes el admin sí veía el botón aunque no fuera parte
// de la deuda.
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

  it('does NOT show the "Marcar como saldada" button to the admin — solo la pareja', () => {
    expect(fixture.nativeElement.querySelector('.mfx-btn-primary')).toBeNull();
  });

  it('does NOT show the "Abonar" button to the admin either', () => {
    expect(fixture.nativeElement.querySelector('.mfx-group-balance__abonar-btn')).toBeNull();
  });
});
