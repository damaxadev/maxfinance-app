import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { Accounts } from '../../../core/accounts/accounts';
import { Auth } from '../../../core/auth/auth';
import { Categories } from '../../../core/categories/categories';
import { GroupsService } from '../../../core/groups/groups';
import { MovementFormState } from '../../../core/movement-form-state/movement-form-state';
import { MovementsService } from '../../../core/movements/movements';
import { SettlementsService } from '../../../core/settlements/settlements';
import { SharedExpenseFormState } from '../../../core/shared-expense-form-state/shared-expense-form-state';
import { GroupDetail } from './group-detail';

// GroupBalance y GroupActivity (renderizados dentro de GroupDetail) inyectan
// estos servicios — se stubean vacíos en las cuatro suites de este archivo,
// ya que ambos se prueban por separado en sus propios specs. GroupBalance
// usa groupMovements$ (un solo grupo); GroupActivity usa
// allSharedMovementsForGroups$ (uno o varios) — ambos necesitan su propio
// método en el stub.
const groupChildStubs = [
  {
    provide: MovementsService,
    useValue: {
      groupMovements$: () => of([]),
      allSharedMovementsForGroups$: () => of([]),
      countGroupMovements: vi.fn().mockResolvedValue(0),
    },
  },
  {
    provide: SettlementsService,
    useValue: {
      settlements$: () => of([]),
      settlementsForGroups$: () => of([]),
      findLinkedMovementSettlementIds: vi.fn().mockResolvedValue(new Set()),
      countGroupSettlements: vi.fn().mockResolvedValue(0),
    },
  },
  { provide: Accounts, useValue: { accounts$: of([]) } },
  { provide: Categories, useValue: { categories$: of([]) } },
];

const { mockImpact, mockNotification } = vi.hoisted(() => ({
  mockImpact: vi.fn().mockResolvedValue(undefined),
  mockNotification: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@capacitor/haptics', () => ({
  Haptics: { impact: mockImpact, notification: mockNotification },
  ImpactStyle: { Light: 'LIGHT', Medium: 'MEDIUM', Heavy: 'HEAVY' },
  NotificationType: { Success: 'SUCCESS', Warning: 'WARNING', Error: 'ERROR' },
}));

// getMemberProfiles()/getKnownContacts() encadenan .then().catch().finally()
// dentro de effects/promesas del constructor — cada eslabón necesita su
// propio microtask, así que se drenan varios turnos explícitamente en vez
// de confiar en whenStable()/zone tracking.
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await Promise.resolve();
  }
}

const fakeGroup = { id: 'group1', name: 'Apartamento', members: ['u1', 'u2'], createdBy: 'u1', createdAt: {} as never };
const fakeMemberProfiles = [
  { uid: 'u1', displayName: 'Diego', email: 'diego@example.com', photoURL: '' },
  { uid: 'u2', displayName: 'Ana', email: 'ana@example.com', photoURL: 'https://example.com/ana.jpg' },
];
// Ana (u2) ya es miembro de group1 -> debe quedar excluida de las sugerencias.
// Beto (u3) no lo es -> debe aparecer como chip sugerido.
const fakeContacts = [
  { uid: 'u2', displayName: 'Ana', email: 'ana@example.com', photoURL: 'https://example.com/ana.jpg' },
  { uid: 'u3', displayName: 'Beto', email: 'beto@example.com', photoURL: '' },
];

describe('GroupDetail (viewed by the creator)', () => {
  let component: GroupDetail;
  let fixture: ComponentFixture<GroupDetail>;
  let leave: ReturnType<typeof vi.fn>;
  let removeMember: ReturnType<typeof vi.fn>;
  let remove: ReturnType<typeof vi.fn>;
  let inviteByEmail: ReturnType<typeof vi.fn>;
  let inviteByUid: ReturnType<typeof vi.fn>;
  let getMemberProfiles: ReturnType<typeof vi.fn>;
  let getKnownContacts: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    mockImpact.mockClear();
    mockNotification.mockClear();
    leave = vi.fn().mockResolvedValue(undefined);
    removeMember = vi.fn().mockResolvedValue(undefined);
    remove = vi.fn().mockResolvedValue(undefined);
    inviteByEmail = vi.fn().mockResolvedValue(undefined);
    inviteByUid = vi.fn().mockResolvedValue(undefined);
    getMemberProfiles = vi.fn().mockResolvedValue(fakeMemberProfiles);
    getKnownContacts = vi.fn().mockResolvedValue(fakeContacts);

    await TestBed.configureTestingModule({
      imports: [GroupDetail],
      providers: [
        { provide: Auth, useValue: { currentUser: { uid: 'u1', email: 'diego@example.com' }, isAdmin: false } },
        {
          provide: GroupsService,
          useValue: {
            groups$: of([fakeGroup]),
            leave,
            removeMember,
            remove,
            inviteByEmail,
            inviteByUid,
            getMemberProfiles,
            getKnownContacts,
          },
        },
        ...groupChildStubs,
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(GroupDetail);
    fixture.componentRef.setInput('groupId', 'group1');
    component = fixture.componentInstance;
    fixture.detectChanges();
    await flushMicrotasks();
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('resolves the group by id from groups$', () => {
    expect(component.group()).toEqual(fakeGroup);
  });

  it('is the creator, so it can manage the group', () => {
    expect(component.canManageGroup()).toBe(true);
  });

  it('renders the "Actividad reciente" section', () => {
    expect(fixture.nativeElement.querySelector('mfx-group-activity')).toBeTruthy();
  });

  it('addExpense() opens the shared-expense form fixed to this group', () => {
    const state = TestBed.inject(SharedExpenseFormState);
    component.addExpense();

    expect(state.request()).toEqual({ groupId: 'group1' });
  });

  it('treats a group with no type field as shared (backward compat, Fase 9)', () => {
    expect(component.isSharedGroup()).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('Balance');
    expect(fixture.nativeElement.textContent).not.toContain('Total gastado');
  });

  it('renders the "+ Agregar gasto" button', () => {
    const buttons = Array.from<HTMLButtonElement>(fixture.nativeElement.querySelectorAll('button'));
    expect(buttons.map((b) => b.textContent?.trim())).toContain('+ Agregar gasto');
  });

  it('loads member profiles for the group', () => {
    expect(getMemberProfiles).toHaveBeenCalledWith('group1');
    expect(component.members()).toEqual(fakeMemberProfiles);
  });

  it('shows a "Salir" button for the current user and "Eliminar" for others (creator view)', () => {
    const buttons = Array.from<HTMLButtonElement>(fixture.nativeElement.querySelectorAll('button'));
    const labels = buttons.map((b) => b.textContent?.trim());

    expect(labels).toContain('Salir');
    expect(labels).toContain('Eliminar');
  });

  it('shows "Eliminar grupo" to the creator, with no confirmation visible yet', () => {
    const buttons = Array.from<HTMLButtonElement>(fixture.nativeElement.querySelectorAll('button'));
    const labels = buttons.map((b) => b.textContent?.trim());

    expect(labels).toContain('Eliminar grupo');
    expect(component.confirmingDeleteGroup()).toBe(false);
    expect(fixture.nativeElement.querySelector('.mfx-group-detail__confirm')).toBeNull();
  });

  it('confirmDeleteGroup() shows the inline confirmation and buzzes a warning notification', () => {
    component.confirmDeleteGroup();
    fixture.detectChanges();

    expect(component.confirmingDeleteGroup()).toBe(true);
    expect(fixture.nativeElement.querySelector('.mfx-group-detail__confirm').textContent).toContain(
      '¿Seguro que quieres eliminar este grupo? Esta acción no se puede deshacer'
    );
    expect(mockNotification).toHaveBeenCalledWith({ type: 'WARNING' });
  });

  it('cancelDeleteGroup() hides the confirmation again without deleting anything', () => {
    component.confirmDeleteGroup();
    component.cancelDeleteGroup();
    fixture.detectChanges();

    expect(component.confirmingDeleteGroup()).toBe(false);
    expect(remove).not.toHaveBeenCalled();
  });

  it('deleteGroup() removes the group, buzzes success, and emits left', async () => {
    const emitted: void[] = [];
    component.left.subscribe(() => emitted.push(undefined));
    component.confirmDeleteGroup();
    mockNotification.mockClear();

    await component.deleteGroup();

    expect(remove).toHaveBeenCalledWith('group1');
    expect(mockNotification).toHaveBeenCalledWith({ type: 'SUCCESS' });
    expect(emitted.length).toBe(1);
  });

  it('shows the "gastos registrados" guard message inline if deleting is blocked, without emitting left', async () => {
    remove.mockRejectedValue(new Error('No puedes eliminar un grupo con gastos registrados.'));
    const emitted: void[] = [];
    component.left.subscribe(() => emitted.push(undefined));
    component.confirmDeleteGroup();

    await component.deleteGroup();
    fixture.detectChanges();

    expect(component.deleteError()).toBe('No puedes eliminar un grupo con gastos registrados.');
    expect(component.confirmingDeleteGroup()).toBe(false);
    expect(emitted.length).toBe(0);
    expect(fixture.nativeElement.querySelector('.mfx-form__error').textContent).toContain(
      'No puedes eliminar un grupo con gastos registrados.'
    );
  });

  it('leave() calls the service and emits left on success', async () => {
    const emitted: void[] = [];
    component.left.subscribe(() => emitted.push(undefined));

    await component.leave();

    expect(leave).toHaveBeenCalledWith('group1');
    expect(emitted.length).toBe(1);
  });

  it('removeMember() calls the service with the target uid', async () => {
    await component.removeMember('u2');

    expect(removeMember).toHaveBeenCalledWith('group1', 'u2');
  });

  it('shows an action error if leave() fails, without emitting left', async () => {
    leave.mockRejectedValue(new Error('No perteneces a este grupo.'));
    const emitted: void[] = [];
    component.left.subscribe(() => emitted.push(undefined));

    await component.leave();

    expect(component.actionError()).toBe('No perteneces a este grupo.');
    expect(emitted.length).toBe(0);
  });

  it('loads known-contact suggestions, excluding people already in this group', () => {
    expect(getKnownContacts).toHaveBeenCalled();
    expect(component.suggestedContacts()).toEqual([fakeContacts[1]]); // solo Beto, no Ana
  });

  it('renders a chip only for the suggested (non-member) contact', () => {
    component.inviteSectionExpanded.set(true);
    fixture.detectChanges();
    const chips = Array.from<HTMLButtonElement>(fixture.nativeElement.querySelectorAll('.mfx-group-detail__chip'));

    expect(chips.length).toBe(1);
    expect(chips[0].textContent).toContain('Beto');
  });

  it('inviteContact() invites by uid directly, buzzes, and marks the contact as just invited', async () => {
    await component.inviteContact(fakeContacts[1]);

    expect(inviteByUid).toHaveBeenCalledWith('group1', 'u3');
    expect(mockImpact).toHaveBeenCalledWith({ style: 'LIGHT' });
    expect(component.justInvitedUids().has('u3')).toBe(true);
  });

  it('shows "Invitado ✓" in the chip right after a successful invite', async () => {
    component.inviteSectionExpanded.set(true);
    await component.inviteContact(fakeContacts[1]);
    fixture.detectChanges();

    const chip = fixture.nativeElement.querySelector('.mfx-group-detail__chip');
    expect(chip.textContent).toContain('Invitado ✓');
  });

  it('shows an inline error (not an alert) if inviting a contact fails', async () => {
    inviteByUid.mockRejectedValue(new Error('Esta persona ya es miembro del grupo.'));

    await component.inviteContact(fakeContacts[1]);

    expect(component.inviteError()).toBe('Esta persona ya es miembro del grupo.');
  });

  it('does not submit an invalid email', async () => {
    component.inviteForm.patchValue({ email: 'not-an-email' });

    await component.invite();

    expect(inviteByEmail).not.toHaveBeenCalled();
  });

  it('blocks inviting your own email, without calling the function', async () => {
    component.inviteForm.controls.email.setValue('Diego@Example.com'); // mismo correo, distinto casing

    expect(component.inviteForm.controls.email.hasError('selfInvite')).toBe(true);
    expect(component.inviteForm.invalid).toBe(true);

    await component.invite();
    expect(inviteByEmail).not.toHaveBeenCalled();
  });

  it('blocks an email that already belongs to a current member, without calling the function', async () => {
    component.inviteForm.controls.email.setValue('ana@example.com');

    expect(component.inviteForm.controls.email.hasError('alreadyMember')).toBe(true);

    await component.invite();
    expect(inviteByEmail).not.toHaveBeenCalled();
  });

  it('shows the specific inline error message for the self-invite case', () => {
    component.inviteSectionExpanded.set(true);
    component.inviteForm.controls.email.setValue('diego@example.com');
    component.inviteForm.controls.email.markAsTouched();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.mfx-form__error').textContent).toContain(
      'No puedes invitarte a ti mismo.'
    );
  });

  it('shows the specific inline error message for the already-a-member case', () => {
    component.inviteSectionExpanded.set(true);
    component.inviteForm.controls.email.setValue('ana@example.com');
    component.inviteForm.controls.email.markAsTouched();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.mfx-form__error').textContent).toContain(
      'Ya es miembro de este grupo.'
    );
  });

  it('disables the "Invitar" button while the email field is invalid', () => {
    component.inviteSectionExpanded.set(true);
    component.inviteForm.controls.email.setValue('');
    fixture.detectChanges();

    const submitButton: HTMLButtonElement = fixture.nativeElement.querySelector('.mfx-form__actions button');
    expect(submitButton.disabled).toBe(true);
  });

  it('enables the "Invitar" button once the email is valid', () => {
    component.inviteSectionExpanded.set(true);
    component.inviteForm.controls.email.setValue('newperson@example.com');
    fixture.detectChanges();

    const submitButton: HTMLButtonElement = fixture.nativeElement.querySelector('.mfx-form__actions button');
    expect(submitButton.disabled).toBe(false);
  });

  it('invites by email, resets the form, and shows success', async () => {
    component.inviteForm.setValue({ email: 'friend@example.com' });

    await component.invite();

    expect(inviteByEmail).toHaveBeenCalledWith('group1', 'friend@example.com');
    expect(component.inviteSuccess()).toBe(true);
    expect(component.inviteForm.controls.email.value).toBe('');
  });

  it('shows the callable error message if inviting by email fails', async () => {
    inviteByEmail.mockRejectedValue(new Error('Esta persona aún no tiene cuenta en MaxFinance.'));
    component.inviteForm.setValue({ email: 'nobody@example.com' });

    await component.invite();

    expect(component.inviteError()).toBe('Esta persona aún no tiene cuenta en MaxFinance.');
    expect(component.inviteSuccess()).toBe(false);
  });
});

describe('GroupDetail with a personal group (Fase 9)', () => {
  let component: GroupDetail;
  let fixture: ComponentFixture<GroupDetail>;

  const personalGroup = {
    id: 'group-personal',
    name: 'Ahorros',
    members: ['u1'],
    createdBy: 'u1',
    createdAt: {} as never,
    type: 'personal' as const,
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [GroupDetail],
      providers: [
        { provide: Auth, useValue: { currentUser: { uid: 'u1', email: 'diego@example.com' }, isAdmin: false } },
        {
          provide: GroupsService,
          useValue: {
            groups$: of([personalGroup]),
            leave: vi.fn(),
            removeMember: vi.fn(),
            remove: vi.fn(),
            inviteByEmail: vi.fn(),
            inviteByUid: vi.fn(),
            getMemberProfiles: vi.fn().mockResolvedValue([]),
            getKnownContacts: vi.fn().mockResolvedValue([]),
          },
        },
        {
          provide: MovementsService,
          useValue: {
            groupMovements$: () =>
              of([
                { id: 'm1', type: 'expense', amount: 100000, categoryId: 'c1', date: {} as never, note: '', groupId: 'group-personal' },
                { id: 'm2', type: 'expense', amount: 50000, categoryId: 'c1', date: {} as never, note: '', groupId: 'group-personal' },
                { id: 'm3', type: 'income', amount: 999999, categoryId: 'c1', date: {} as never, note: '', groupId: 'group-personal' },
              ]),
            allSharedMovementsForGroups$: () => of([]),
            countGroupMovements: vi.fn().mockResolvedValue(0),
          },
        },
        {
          provide: SettlementsService,
          useValue: {
            settlements$: () => of([]),
            settlementsForGroups$: () => of([]),
            findLinkedMovementSettlementIds: vi.fn().mockResolvedValue(new Set()),
            countGroupSettlements: vi.fn().mockResolvedValue(0),
          },
        },
        { provide: Accounts, useValue: { accounts$: of([]) } },
        { provide: Categories, useValue: { categories$: of([]) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(GroupDetail);
    fixture.componentRef.setInput('groupId', 'group-personal');
    component = fixture.componentInstance;
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();
  });

  it('is not a shared group', () => {
    expect(component.isSharedGroup()).toBe(false);
  });

  it('shows "Total gastado" instead of "Balance"', () => {
    expect(fixture.nativeElement.textContent).toContain('Total gastado');
    expect(fixture.nativeElement.textContent).not.toContain('Balance');
    expect(fixture.nativeElement.querySelector('mfx-group-balance')).toBeNull();
  });

  it('totalSpent() sums only expense movements, ignoring income', () => {
    expect(component.totalSpent()).toBe(150000);
  });

  it('never shows the "Invitar" section for a personal group', () => {
    expect(fixture.nativeElement.textContent).not.toContain('Invitar');
    expect(fixture.nativeElement.querySelector('.mfx-group-detail__contacts')).toBeNull();
  });

  it('still shows "Actividad reciente"', () => {
    expect(fixture.nativeElement.querySelector('mfx-group-activity')).toBeTruthy();
  });

  it('addExpense() opens the plain movement form tagged to this group, not the shared-expense form', () => {
    const movementFormState = TestBed.inject(MovementFormState);
    const sharedExpenseFormState = TestBed.inject(SharedExpenseFormState);

    component.addExpense();

    expect(movementFormState.request()).toEqual({ mode: 'create', groupId: 'group-personal' });
    expect(sharedExpenseFormState.request()).toBeNull();
  });
});

describe('GroupDetail (viewed by a non-creator member)', () => {
  let component: GroupDetail;
  let fixture: ComponentFixture<GroupDetail>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [GroupDetail],
      providers: [
        { provide: Auth, useValue: { currentUser: { uid: 'u2', email: 'ana@example.com' }, isAdmin: false } },
        {
          provide: GroupsService,
          useValue: {
            groups$: of([fakeGroup]),
            leave: vi.fn(),
            removeMember: vi.fn(),
            remove: vi.fn(),
            inviteByEmail: vi.fn(),
            inviteByUid: vi.fn(),
            getMemberProfiles: vi.fn().mockResolvedValue(fakeMemberProfiles),
            getKnownContacts: vi.fn().mockResolvedValue(fakeContacts),
          },
        },
        ...groupChildStubs,
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(GroupDetail);
    fixture.componentRef.setInput('groupId', 'group1');
    component = fixture.componentInstance;
    fixture.detectChanges();
    await flushMicrotasks();
    fixture.detectChanges();
  });

  it('is neither the creator nor the admin, so it cannot manage the group', () => {
    expect(component.canManageGroup()).toBe(false);
  });

  it('does not show "Eliminar grupo" to a non-creator, non-admin member', () => {
    const buttons = Array.from<HTMLButtonElement>(fixture.nativeElement.querySelectorAll('button'));
    const labels = buttons.map((b) => b.textContent?.trim());

    expect(labels).not.toContain('Eliminar grupo');
  });

  it('only shows "Salir" for itself, never "Eliminar" on someone else\'s row', () => {
    const buttons = Array.from<HTMLButtonElement>(fixture.nativeElement.querySelectorAll('button'));
    const labels = buttons.map((b) => b.textContent?.trim());

    expect(labels).toContain('Salir');
    expect(labels).not.toContain('Eliminar');
  });
});

describe('GroupDetail (viewed by an admin who is not the creator)', () => {
  let component: GroupDetail;
  let fixture: ComponentFixture<GroupDetail>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [GroupDetail],
      providers: [
        // Admin real (isAdmin() en firestore.rules), pero no createdBy de
        // este grupo — la UI debe tratarlo igual que al creador.
        { provide: Auth, useValue: { currentUser: { uid: 'admin-uid', email: 'admin@example.com' }, isAdmin: true } },
        {
          provide: GroupsService,
          useValue: {
            groups$: of([fakeGroup]),
            leave: vi.fn(),
            removeMember: vi.fn(),
            remove: vi.fn(),
            inviteByEmail: vi.fn(),
            inviteByUid: vi.fn(),
            getMemberProfiles: vi.fn().mockResolvedValue(fakeMemberProfiles),
            getKnownContacts: vi.fn().mockResolvedValue(fakeContacts),
          },
        },
        ...groupChildStubs,
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(GroupDetail);
    fixture.componentRef.setInput('groupId', 'group1');
    component = fixture.componentInstance;
    fixture.detectChanges();
    await flushMicrotasks();
    fixture.detectChanges();
  });

  it('can manage the group despite not being its creator', () => {
    expect(component.canManageGroup()).toBe(true);
  });

  it('shows "Eliminar" on other members\' rows and "Eliminar grupo"', () => {
    const buttons = Array.from<HTMLButtonElement>(fixture.nativeElement.querySelectorAll('button'));
    const labels = buttons.map((b) => b.textContent?.trim());

    expect(labels).toContain('Eliminar');
    expect(labels).toContain('Eliminar grupo');
  });
});

describe('GroupDetail with no suggested contacts', () => {
  let component: GroupDetail;
  let fixture: ComponentFixture<GroupDetail>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [GroupDetail],
      providers: [
        { provide: Auth, useValue: { currentUser: { uid: 'u1', email: 'diego@example.com' }, isAdmin: false } },
        {
          provide: GroupsService,
          useValue: {
            groups$: of([fakeGroup]),
            leave: vi.fn(),
            removeMember: vi.fn(),
            remove: vi.fn(),
            inviteByEmail: vi.fn(),
            inviteByUid: vi.fn(),
            getMemberProfiles: vi.fn().mockResolvedValue(fakeMemberProfiles),
            getKnownContacts: vi.fn().mockResolvedValue([]), // primer grupo, nadie más que conocer todavía
          },
        },
        ...groupChildStubs,
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(GroupDetail);
    fixture.componentRef.setInput('groupId', 'group1');
    component = fixture.componentInstance;
    fixture.detectChanges();
    await flushMicrotasks();
    fixture.detectChanges();
  });

  it('does not render the contacts section at all', () => {
    component.inviteSectionExpanded.set(true);
    fixture.detectChanges();

    expect(component.suggestedContacts()).toEqual([]);
    expect(fixture.nativeElement.querySelector('.mfx-group-detail__contacts')).toBeNull();
  });
});

describe('GroupDetail — "Invitar" section starts collapsed', () => {
  let component: GroupDetail;
  let fixture: ComponentFixture<GroupDetail>;
  let inviteByEmail: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    inviteByEmail = vi.fn().mockResolvedValue(undefined);

    await TestBed.configureTestingModule({
      imports: [GroupDetail],
      providers: [
        { provide: Auth, useValue: { currentUser: { uid: 'u1', email: 'diego@example.com' }, isAdmin: false } },
        {
          provide: GroupsService,
          useValue: {
            groups$: of([fakeGroup]),
            leave: vi.fn(),
            removeMember: vi.fn(),
            remove: vi.fn(),
            inviteByEmail,
            inviteByUid: vi.fn(),
            getMemberProfiles: vi.fn().mockResolvedValue(fakeMemberProfiles),
            getKnownContacts: vi.fn().mockResolvedValue(fakeContacts),
          },
        },
        ...groupChildStubs,
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(GroupDetail);
    fixture.componentRef.setInput('groupId', 'group1');
    component = fixture.componentInstance;
    fixture.detectChanges();
    await flushMicrotasks();
    fixture.detectChanges();
  });

  it('starts collapsed, showing only the "+ Invitar miembro" link', () => {
    expect(component.inviteSectionExpanded()).toBe(false);
    expect(fixture.nativeElement.querySelector('.mfx-form')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('+ Invitar miembro');
  });

  it('expands on toggle, revealing the email form', () => {
    component.toggleInviteSection();
    fixture.detectChanges();

    expect(component.inviteSectionExpanded()).toBe(true);
    expect(fixture.nativeElement.querySelector('.mfx-form')).toBeTruthy();
  });

  it('collapses again on a second toggle', () => {
    component.toggleInviteSection();
    component.toggleInviteSection();
    fixture.detectChanges();

    expect(component.inviteSectionExpanded()).toBe(false);
    expect(fixture.nativeElement.querySelector('.mfx-form')).toBeNull();
  });

  it('collapses automatically after a successful email invite, and still shows the success message', async () => {
    component.toggleInviteSection();
    component.inviteForm.setValue({ email: 'friend@example.com' });

    await component.invite();
    fixture.detectChanges();

    expect(component.inviteSectionExpanded()).toBe(false);
    expect(fixture.nativeElement.querySelector('.mfx-form')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('¡Invitación enviada!');
  });
});
