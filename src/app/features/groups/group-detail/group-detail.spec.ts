import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { Accounts } from '../../../core/accounts/accounts';
import { Auth } from '../../../core/auth/auth';
import { AttachmentsService } from '../../../core/attachments/attachments';
import { Categories } from '../../../core/categories/categories';
import { GoalEntriesService } from '../../../core/goal-entries/goal-entries';
import { GoalEntryFormState } from '../../../core/goal-entry-form-state/goal-entry-form-state';
import { GroupsService } from '../../../core/groups/groups';
import { ModalStack } from '../../../core/modal-stack/modal-stack';
import { MovementsService } from '../../../core/movements/movements';
import { SettlementsService } from '../../../core/settlements/settlements';
import { SharedExpenseFormState } from '../../../core/shared-expense-form-state/shared-expense-form-state';
import { ThemeService } from '../../../core/theme/theme';
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
  { provide: GoalEntriesService, useValue: { entries$: () => of([]) } },
  // La torta de aportes (ver GroupDetail) reconstruye sus colores cada vez
  // que cambia el tema — mismo motivo y mismo stub que home.spec.ts: un
  // signal controlable en vez de la instancia real (que depende de
  // matchMedia/Preferences, innecesario para estos tests).
  { provide: ThemeService, useValue: { theme: signal('light') } },
  { provide: AttachmentsService, useValue: { getDownloadUrl: vi.fn().mockResolvedValue('https://example.com/attachment') } },
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

const { mockBrowserOpen } = vi.hoisted(() => ({ mockBrowserOpen: vi.fn().mockResolvedValue(undefined) }));

vi.mock('@capacitor/browser', () => ({
  Browser: { open: mockBrowserOpen },
}));

// jsdom no implementa un contexto 2D de canvas (mismo motivo que en
// home.spec.ts/shell.spec.ts) — la torta de aportes de GroupDetail
// construye un Chart.js real solo cuando el modal está abierto, así que
// sin este mock cualquier test que lo abra fallaría al montar el <canvas>.
const { MockChart, chartInstances } = vi.hoisted(() => {
  const chartInstances: {
    type: string;
    data: { labels: unknown[]; datasets: { data: unknown[]; backgroundColor?: unknown }[] };
    destroy: () => void;
    update: () => void;
  }[] = [];

  class MockChart {
    static register = vi.fn();
    data: (typeof chartInstances)[number]['data'];
    type: string;
    destroy = vi.fn();
    update = vi.fn();

    constructor(_canvas: unknown, config: { type: string; data: (typeof chartInstances)[number]['data'] }) {
      this.type = config.type;
      this.data = config.data;
      chartInstances.push(this as never);
    }
  }

  return { MockChart, chartInstances };
});

vi.mock('chart.js', () => ({ Chart: MockChart, registerables: [] }));

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
  let rename: ReturnType<typeof vi.fn>;
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
    rename = vi.fn().mockResolvedValue(undefined);
    inviteByEmail = vi.fn().mockResolvedValue(undefined);
    inviteByUid = vi.fn().mockResolvedValue(undefined);
    getMemberProfiles = vi.fn().mockResolvedValue(fakeMemberProfiles);
    getKnownContacts = vi.fn().mockResolvedValue(fakeContacts);

    await TestBed.configureTestingModule({
      imports: [GroupDetail],
      providers: [
        provideNoopAnimations(),
        { provide: Auth, useValue: { currentUser: { uid: 'u1', email: 'diego@example.com' }, isAdmin: false } },
        {
          provide: GroupsService,
          useValue: {
            groups$: of([fakeGroup]),
            leave,
            removeMember,
            remove,
            rename,
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

    expect(state.request()).toEqual({ mode: 'create', groupId: 'group1' });
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

  it('shows a "Salir" button for the current user and "Eliminar" for others, inside the "⋮" menu', () => {
    component.openMenu();
    fixture.detectChanges();
    const buttons = Array.from<HTMLButtonElement>(fixture.nativeElement.querySelectorAll('button'));
    const labels = buttons.map((b) => b.textContent?.trim());

    expect(labels).toContain('Salir');
    expect(labels).toContain('Eliminar');
  });

  it('shows "Eliminar grupo" to the creator inside the menu, with no confirmation visible yet', () => {
    component.openMenu();
    fixture.detectChanges();
    const buttons = Array.from<HTMLButtonElement>(fixture.nativeElement.querySelectorAll('button'));
    const labels = buttons.map((b) => b.textContent?.trim());

    expect(labels).toContain('Eliminar grupo');
    expect(component.confirmingDeleteGroup()).toBe(false);
    expect(fixture.nativeElement.querySelector('.mfx-group-detail__confirm')).toBeNull();
  });

  it('confirmDeleteGroup() shows the inline confirmation and buzzes a warning notification', () => {
    component.openMenu();
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

  // Ajuste posterior al botón atrás de Android: "Zona de peligro" vive
  // dentro del mismo mfx-modal del menú "⋮" (no es un modal propio) — sin
  // registrar la confirmación como su propia entrada en ModalStack, un
  // back se saltaría la confirmación y cerraría el menú entero de un golpe.
  describe('confirmación de eliminar grupo registrada en ModalStack (botón atrás)', () => {
    beforeEach(() => {
      component.openMenu();
      fixture.detectChanges();
    });

    it('only the menu itself is on the stack while not confirming', () => {
      const modalStack = TestBed.inject(ModalStack);
      modalStack.closeTop();
      fixture.detectChanges();

      expect(component.menuOpen()).toBe(false);
    });

    it('a back-button close cancels the confirmation, leaving the menu open', () => {
      component.confirmDeleteGroup();
      fixture.detectChanges();
      const modalStack = TestBed.inject(ModalStack);

      const handled = modalStack.closeTop();
      fixture.detectChanges();

      expect(handled).toBe(true);
      expect(component.confirmingDeleteGroup()).toBe(false);
      expect(component.menuOpen()).toBe(true);
      expect(remove).not.toHaveBeenCalled();
    });

    it('a second back then closes the menu itself', () => {
      component.confirmDeleteGroup();
      fixture.detectChanges();
      const modalStack = TestBed.inject(ModalStack);

      modalStack.closeTop(); // cancela la confirmación
      fixture.detectChanges();
      modalStack.closeTop(); // ahora sí cierra el menú
      fixture.detectChanges();

      expect(component.menuOpen()).toBe(false);
    });

    it('pops its entry when cancelled normally, leaving only the menu on the stack', () => {
      component.confirmDeleteGroup();
      fixture.detectChanges();
      component.cancelDeleteGroup();
      fixture.detectChanges();

      const modalStack = TestBed.inject(ModalStack);
      modalStack.closeTop(); // debe cerrar el menú, no una confirmación huérfana
      fixture.detectChanges();

      expect(component.menuOpen()).toBe(false);
    });
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
    component.openMenu();
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
    component.openMenu();
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
    component.openMenu();
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
    component.openMenu();
    component.inviteSectionExpanded.set(true);
    component.inviteForm.controls.email.setValue('diego@example.com');
    component.inviteForm.controls.email.markAsTouched();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.mfx-form__error').textContent).toContain(
      'No puedes invitarte a ti mismo.'
    );
  });

  it('shows the specific inline error message for the already-a-member case', () => {
    component.openMenu();
    component.inviteSectionExpanded.set(true);
    component.inviteForm.controls.email.setValue('ana@example.com');
    component.inviteForm.controls.email.markAsTouched();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.mfx-form__error').textContent).toContain(
      'Ya es miembro de este grupo.'
    );
  });

  it('disables the "Invitar" button while the email field is invalid', () => {
    component.openMenu();
    component.inviteSectionExpanded.set(true);
    component.inviteForm.controls.email.setValue('');
    fixture.detectChanges();

    const submitButton: HTMLButtonElement = fixture.nativeElement.querySelector('.mfx-form__actions button');
    expect(submitButton.disabled).toBe(true);
  });

  it('enables the "Invitar" button once the email is valid', () => {
    component.openMenu();
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

// Rediseño posterior: las acciones administrativas (nombre, miembros,
// zona de peligro) se movieron del cuerpo principal a un menú "⋮" (un
// mfx-modal anidado, ver group-detail.ts) — la pantalla principal solo
// conserva nombre + menú, avatares compactos + "+ Agregar gasto", Balance
// y Actividad reciente.
describe('GroupDetail — menú "⋮" (rediseño posterior)', () => {
  let component: GroupDetail;
  let fixture: ComponentFixture<GroupDetail>;
  let rename: ReturnType<typeof vi.fn>;

  const manyMembers = [
    { uid: 'u1', displayName: 'Diego', email: 'diego@example.com', photoURL: '' },
    { uid: 'u2', displayName: 'Ana', email: 'ana@example.com', photoURL: '' },
    { uid: 'u3', displayName: 'Beto', email: 'beto@example.com', photoURL: '' },
    { uid: 'u4', displayName: 'Carla', email: 'carla@example.com', photoURL: '' },
  ];

  beforeEach(async () => {
    rename = vi.fn().mockResolvedValue(undefined);

    await TestBed.configureTestingModule({
      imports: [GroupDetail],
      providers: [
        provideNoopAnimations(),
        { provide: Auth, useValue: { currentUser: { uid: 'u1', email: 'diego@example.com' }, isAdmin: false } },
        {
          provide: GroupsService,
          useValue: {
            groups$: of([fakeGroup]),
            leave: vi.fn(),
            removeMember: vi.fn(),
            remove: vi.fn(),
            rename,
            inviteByEmail: vi.fn(),
            inviteByUid: vi.fn(),
            getMemberProfiles: vi.fn().mockResolvedValue(manyMembers),
            getKnownContacts: vi.fn().mockResolvedValue([]),
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

  it('starts with the menu closed', () => {
    expect(component.menuOpen()).toBe(false);
    expect(fixture.nativeElement.querySelector('mfx-modal')).toBeNull();
  });

  it('renders a "⋮" button that opens the menu', () => {
    const menuButton: HTMLButtonElement = fixture.nativeElement.querySelector('.mfx-group-detail__menu-btn');
    expect(menuButton.textContent?.trim()).toBe('⋮');

    menuButton.click();
    fixture.detectChanges();

    expect(component.menuOpen()).toBe(true);
    expect(fixture.nativeElement.querySelector('mfx-modal')).toBeTruthy();
  });

  it('closeMenu() closes it again', () => {
    component.openMenu();
    component.closeMenu();
    fixture.detectChanges();

    expect(component.menuOpen()).toBe(false);
  });

  it('keeps "Salir"/"Eliminar"/"Eliminar grupo" out of the main screen while the menu is closed', () => {
    const buttons = Array.from<HTMLButtonElement>(fixture.nativeElement.querySelectorAll('button'));
    const labels = buttons.map((b) => b.textContent?.trim());

    expect(labels).not.toContain('Salir');
    expect(labels).not.toContain('Eliminar');
    expect(labels).not.toContain('Eliminar grupo');
  });

  it('keeps "+ Agregar gasto" visible on the main screen without opening the menu', () => {
    const buttons = Array.from<HTMLButtonElement>(fixture.nativeElement.querySelectorAll('button'));
    expect(buttons.map((b) => b.textContent?.trim())).toContain('+ Agregar gasto');
  });

  it('shows a compact avatar row capped at maxStackedAvatars, with a "+N" overflow badge', () => {
    expect(component.maxStackedAvatars).toBe(3);
    const avatars = fixture.nativeElement.querySelectorAll('.mfx-group-detail__avatars mfx-avatar');
    expect(avatars.length).toBe(3);

    const more = fixture.nativeElement.querySelector('.mfx-group-detail__avatar-more');
    expect(more.textContent?.trim()).toBe('+1'); // 4 miembros - 3 visibles
  });

  it('shows no "+N" badge when there are 3 members or fewer', () => {
    component.members.set(manyMembers.slice(0, 2));
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.mfx-group-detail__avatar-more')).toBeNull();
  });

  describe('editar nombre del grupo (dentro del menú)', () => {
    beforeEach(() => {
      component.openMenu();
      fixture.detectChanges();
    });

    it('shows the current name, not yet editable', () => {
      expect(fixture.nativeElement.textContent).toContain('Nombre del grupo');
      const row = fixture.nativeElement.querySelector('.mfx-group-detail__name-row');
      expect(row.textContent).toContain('Apartamento');
      expect(fixture.nativeElement.querySelector('.mfx-group-detail__name-row input')).toBeNull();
    });

    it('startEditName() pre-fills the control with the current name', () => {
      component.startEditName();

      expect(component.nameControl.value).toBe('Apartamento');
      expect(component.editingName()).toBe(true);
    });

    it('cancelEditName() discards changes without saving', () => {
      component.startEditName();
      component.nameControl.setValue('Otro nombre');
      component.cancelEditName();

      expect(component.editingName()).toBe(false);
      expect(rename).not.toHaveBeenCalled();
    });

    it('rejects a name shorter than 2 characters', async () => {
      component.startEditName();
      component.nameControl.setValue('A');

      await component.saveName();

      expect(component.nameControl.touched).toBe(true);
      expect(rename).not.toHaveBeenCalled();
    });

    it('saveName() renames the group and closes the inline editor on success', async () => {
      component.startEditName();
      component.nameControl.setValue('Apto 302');

      await component.saveName();

      expect(rename).toHaveBeenCalledWith('group1', 'Apto 302');
      expect(component.editingName()).toBe(false);
    });

    it('trims whitespace before saving', async () => {
      component.startEditName();
      component.nameControl.setValue('  Apto 302  ');

      await component.saveName();

      expect(rename).toHaveBeenCalledWith('group1', 'Apto 302');
    });

    it('shows an inline error and keeps the editor open if saving fails', async () => {
      rename.mockRejectedValue(new Error('boom'));
      component.startEditName();
      component.nameControl.setValue('Apto 302');

      await component.saveName();
      fixture.detectChanges();

      expect(component.nameError()).toBe('No pudimos actualizar el nombre. Intenta de nuevo.');
      expect(component.editingName()).toBe(true);
      expect(fixture.nativeElement.textContent).toContain('No pudimos actualizar el nombre');
    });
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
        provideNoopAnimations(),
        { provide: Auth, useValue: { currentUser: { uid: 'u1', email: 'diego@example.com' }, isAdmin: false } },
        {
          provide: GroupsService,
          useValue: {
            groups$: of([personalGroup]),
            leave: vi.fn(),
            removeMember: vi.fn(),
            remove: vi.fn(),
            rename: vi.fn(),
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
        { provide: GoalEntriesService, useValue: { entries$: () => of([]) } },
        { provide: ThemeService, useValue: { theme: signal('light') } },
        { provide: AttachmentsService, useValue: { getDownloadUrl: vi.fn().mockResolvedValue(null) } },
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

  it('never shows the "Invitar" section for a personal group, even inside the menu', () => {
    component.openMenu();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).not.toContain('Invitar');
    expect(fixture.nativeElement.querySelector('.mfx-group-detail__contacts')).toBeNull();
  });

  it('still shows "Actividad reciente"', () => {
    expect(fixture.nativeElement.querySelector('mfx-group-activity')).toBeTruthy();
  });

  // Fase 9 (corrección posterior): "+ Agregar gasto" siempre abre el
  // formulario estándar de gasto compartido, sin importar el type del
  // grupo — un intento anterior de esta feature sí tenía una rama especial
  // acá (MovementForm para grupos personales), ya revertida.
  it('addExpense() opens the standard shared-expense form, same as for a shared group', () => {
    const sharedExpenseFormState = TestBed.inject(SharedExpenseFormState);

    component.addExpense();

    expect(sharedExpenseFormState.request()).toEqual({ mode: 'create', groupId: 'group-personal' });
  });
});

describe('GroupDetail (viewed by a non-creator member)', () => {
  let component: GroupDetail;
  let fixture: ComponentFixture<GroupDetail>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [GroupDetail],
      providers: [
        provideNoopAnimations(),
        { provide: Auth, useValue: { currentUser: { uid: 'u2', email: 'ana@example.com' }, isAdmin: false } },
        {
          provide: GroupsService,
          useValue: {
            groups$: of([fakeGroup]),
            leave: vi.fn(),
            removeMember: vi.fn(),
            remove: vi.fn(),
            rename: vi.fn(),
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

  it('does not show "Eliminar grupo" to a non-creator, non-admin member, even inside the menu', () => {
    component.openMenu();
    fixture.detectChanges();
    const buttons = Array.from<HTMLButtonElement>(fixture.nativeElement.querySelectorAll('button'));
    const labels = buttons.map((b) => b.textContent?.trim());

    expect(labels).not.toContain('Eliminar grupo');
  });

  it('only shows "Salir" for itself, never "Eliminar" on someone else\'s row', () => {
    component.openMenu();
    fixture.detectChanges();
    const buttons = Array.from<HTMLButtonElement>(fixture.nativeElement.querySelectorAll('button'));
    const labels = buttons.map((b) => b.textContent?.trim());

    expect(labels).toContain('Salir');
    expect(labels).not.toContain('Eliminar');
  });

  it('does not show the "Nombre del grupo" rename section, even inside the menu', () => {
    component.openMenu();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).not.toContain('Nombre del grupo');
  });
});

describe('GroupDetail (viewed by an admin who is not the creator)', () => {
  let component: GroupDetail;
  let fixture: ComponentFixture<GroupDetail>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [GroupDetail],
      providers: [
        provideNoopAnimations(),
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
            rename: vi.fn(),
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

  it('shows "Eliminar" on other members\' rows and "Eliminar grupo", inside the menu', () => {
    component.openMenu();
    fixture.detectChanges();
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
        provideNoopAnimations(),
        { provide: Auth, useValue: { currentUser: { uid: 'u1', email: 'diego@example.com' }, isAdmin: false } },
        {
          provide: GroupsService,
          useValue: {
            groups$: of([fakeGroup]),
            leave: vi.fn(),
            removeMember: vi.fn(),
            remove: vi.fn(),
            rename: vi.fn(),
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
    component.openMenu();
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
        provideNoopAnimations(),
        { provide: Auth, useValue: { currentUser: { uid: 'u1', email: 'diego@example.com' }, isAdmin: false } },
        {
          provide: GroupsService,
          useValue: {
            groups$: of([fakeGroup]),
            leave: vi.fn(),
            removeMember: vi.fn(),
            remove: vi.fn(),
            rename: vi.fn(),
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
    component.openMenu();
    fixture.detectChanges();

    expect(component.inviteSectionExpanded()).toBe(false);
    expect(fixture.nativeElement.querySelector('.mfx-form')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('+ Invitar miembro');
  });

  it('expands on toggle, revealing the email form', () => {
    component.openMenu();
    component.toggleInviteSection();
    fixture.detectChanges();

    expect(component.inviteSectionExpanded()).toBe(true);
    expect(fixture.nativeElement.querySelector('.mfx-form')).toBeTruthy();
  });

  it('collapses again on a second toggle', () => {
    component.openMenu();
    component.toggleInviteSection();
    component.toggleInviteSection();
    fixture.detectChanges();

    expect(component.inviteSectionExpanded()).toBe(false);
    expect(fixture.nativeElement.querySelector('.mfx-form')).toBeNull();
  });

  it('collapses automatically after a successful email invite, and still shows the success message', async () => {
    component.openMenu();
    component.toggleInviteSection();
    component.inviteForm.setValue({ email: 'friend@example.com' });

    await component.invite();
    fixture.detectChanges();

    expect(component.inviteSectionExpanded()).toBe(false);
    expect(fixture.nativeElement.querySelector('.mfx-form')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('¡Invitación enviada!');
  });
});

// Metas de ahorro (type: 'savings', ver DATABASE.md) — mismo componente,
// una tercera rama: progreso + historial de goalEntries en vez de
// Balance/Total gastado + Actividad reciente (movements/settlements, que
// una meta nunca tiene). isSharedGroup() también da true para una meta
// (no es 'personal'), así que esto confirma que isSavingsGoal() se
// chequea primero y gana esa rama.
describe('GroupDetail — meta de ahorro (type: "savings")', () => {
  let component: GroupDetail;
  let fixture: ComponentFixture<GroupDetail>;
  let entries$: ReturnType<typeof vi.fn>;

  const fakeGoal = {
    id: 'goal1',
    name: 'Vacaciones',
    members: ['u1'],
    createdBy: 'u1',
    createdAt: {} as never,
    type: 'savings' as const,
    goalMode: 'target' as 'target' | 'open-ended',
    targetAmount: 1000,
    celebrationAmount: null as number | null,
    targetDate: { toDate: () => new Date('2026-12-01T12:00:00') } as { toDate: () => Date } | null,
  };

  // Mediodía local, no medianoche UTC (ver installment-row.spec.ts para el
  // mismo caso) — evita que una zona con offset negativo (Bogotá, UTC-5)
  // lea un día antes al convertir de vuelta con getters locales.
  function ts(millisForSort: number) {
    return { toMillis: () => millisForSort, toDate: () => new Date(`2026-06-0${millisForSort}T12:00:00`) };
  }

  const oneMember = [{ uid: 'u1', displayName: 'Diego', email: '', photoURL: '' }];

  async function setUp(
    entries: {
      id: string;
      type: 'contribution' | 'withdrawal';
      amount: number;
      date: ReturnType<typeof ts>;
      note: string;
      uid?: string;
      attachmentPath?: string;
    }[],
    groupOverrides: Partial<typeof fakeGoal> = {},
    members: { uid: string; displayName: string; email: string; photoURL: string }[] = oneMember
  ) {
    entries$ = vi.fn().mockReturnValue(of(entries));

    await TestBed.configureTestingModule({
      imports: [GroupDetail],
      providers: [
        provideNoopAnimations(),
        { provide: Auth, useValue: { currentUser: { uid: 'u1', email: 'diego@example.com' }, isAdmin: false } },
        {
          provide: GroupsService,
          useValue: {
            groups$: of([{ ...fakeGoal, ...groupOverrides }]),
            getMemberProfiles: vi.fn().mockResolvedValue(members),
            getKnownContacts: vi.fn().mockResolvedValue([]),
          },
        },
        ...groupChildStubs.filter((p) => p.provide !== GoalEntriesService),
        { provide: GoalEntriesService, useValue: { entries$ } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(GroupDetail);
    fixture.componentRef.setInput('groupId', 'goal1');
    component = fixture.componentInstance;
    fixture.detectChanges();
    await flushMicrotasks();
    fixture.detectChanges();
    return fixture;
  }

  it('isSavingsGoal() is true, and isSharedGroup() stays true too (not "personal") — the template must check savings first', async () => {
    await setUp([]);

    expect(component.isSavingsGoal()).toBe(true);
    expect(component.isSharedGroup()).toBe(true);
  });

  it('shows "+ Aporte/retiro" instead of "+ Agregar gasto"', async () => {
    await setUp([]);

    expect(fixture.nativeElement.textContent).toContain('+ Aporte/retiro');
    expect(fixture.nativeElement.textContent).not.toContain('+ Agregar gasto');
  });

  it('never shows Balance, Total gastado, or Actividad reciente', async () => {
    await setUp([]);

    expect(fixture.nativeElement.querySelector('mfx-group-balance')).toBeNull();
    expect(fixture.nativeElement.querySelector('mfx-group-activity')).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('Balance');
    expect(fixture.nativeElement.textContent).not.toContain('Total gastado');
    expect(fixture.nativeElement.textContent).not.toContain('Actividad reciente');
  });

  it('goalSavedAmount() nets contributions against withdrawals from the live ledger', async () => {
    await setUp([
      { id: 'e1', type: 'contribution', amount: 600, date: ts(2), note: '' },
      { id: 'e2', type: 'withdrawal', amount: 100, date: ts(1), note: '' },
    ]);

    expect(component.goalSavedAmount()).toBe(500);
  });

  it('goalProgressPercent() is the saved amount over the target, clamped at 100', async () => {
    await setUp([{ id: 'e1', type: 'contribution', amount: 5000, date: ts(1), note: '' }]);

    expect(component.goalProgressPercent()).toBe(100);
  });

  it('shows the target amount and the (optional) target date', async () => {
    await setUp([]);

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('1 de dic');
  });

  it('sorts the ledger newest-first and renders amount with a sign (+ aporte, - retiro)', async () => {
    await setUp([
      { id: 'old', type: 'contribution', amount: 100, date: ts(1), note: 'primero' },
      { id: 'new', type: 'withdrawal', amount: 40, date: ts(2), note: 'segundo' },
    ]);

    expect(component.goalEntriesSorted().map((e) => e.id)).toEqual(['new', 'old']);
    const amounts = Array.from<HTMLElement>(
      fixture.nativeElement.querySelectorAll('.mfx-group-detail__goal-entry-amount')
    ).map((el) => el.textContent?.trim());
    expect(amounts[0]).toContain('-');
    expect(amounts[1]).toContain('+');
  });

  it('shows an empty-ledger message when there are no entries yet', async () => {
    await setUp([]);

    expect(fixture.nativeElement.textContent).toContain('Todavía no hay aportes ni retiros registrados.');
  });

  describe('adjunto por entrada (GoalEntryForm no tiene modo edición — este es el único lugar para volver a verlo)', () => {
    it('shows the 📎 link only for entries that have an attachment', async () => {
      await setUp([
        { id: 'e1', type: 'contribution', amount: 100, date: ts(1), note: '', attachmentPath: 'goalEntries/e1/attachment' },
        { id: 'e2', type: 'contribution', amount: 50, date: ts(2), note: '' },
      ]);

      const links = fixture.nativeElement.querySelectorAll('.mfx-group-detail__goal-entry-attachment');
      expect(links.length).toBe(1);
    });

    it('openGoalEntryAttachment() resolves the download URL and opens it via @capacitor/browser (Chrome Custom Tabs, not window.open)', async () => {
      await setUp([]);
      mockBrowserOpen.mockClear();
      const getDownloadUrl = TestBed.inject(AttachmentsService).getDownloadUrl as ReturnType<typeof vi.fn>;

      await component.openGoalEntryAttachment('goalEntries/e1/attachment');

      expect(getDownloadUrl).toHaveBeenCalledWith('goalEntries/e1/attachment');
      expect(mockBrowserOpen).toHaveBeenCalledWith({ url: 'https://example.com/attachment' });
    });
  });

  it('addGoalEntry() opens the goal-entry form state for this goal', async () => {
    await setUp([]);
    const goalEntryFormState = TestBed.inject(GoalEntryFormState);

    component.addGoalEntry();

    expect(goalEntryFormState.context()).toEqual({ groupId: 'goal1', groupName: 'Vacaciones' });
  });

  describe('modo "open-ended" (solo ir ahorrando, sin monto objetivo)', () => {
    it('isOpenEndedGoal() is true, and goalProgressPercent() is the % toward the NEXT multiple, not of a total', async () => {
      await setUp([{ id: 'e1', type: 'contribution', amount: 650000, date: ts(1), note: '' }], {
        goalMode: 'open-ended',
        celebrationAmount: 1000000,
      });

      expect(component.isOpenEndedGoal()).toBe(true);
      expect(component.goalProgressPercent()).toBe(65);
    });

    it('resets to 0% right at an exact multiple of celebrationAmount', async () => {
      await setUp([{ id: 'e1', type: 'contribution', amount: 1000000, date: ts(1), note: '' }], {
        goalMode: 'open-ended',
        celebrationAmount: 1000000,
      });

      expect(component.goalProgressPercent()).toBe(0);
    });

    it('goalNextCelebrationRemaining() shows how much is left for the next celebration', async () => {
      await setUp([{ id: 'e1', type: 'contribution', amount: 650000, date: ts(1), note: '' }], {
        goalMode: 'open-ended',
        celebrationAmount: 1000000,
      });

      expect(component.goalNextCelebrationRemaining()).toBe(350000);
    });

    it('shows "faltan $X para celebrar" instead of "de $X" / the target date', async () => {
      await setUp([{ id: 'e1', type: 'contribution', amount: 650000, date: ts(1), note: '' }], {
        goalMode: 'open-ended',
        celebrationAmount: 1000000,
        targetDate: null,
      });

      const text = fixture.nativeElement.textContent;
      expect(text).toContain('faltan');
      expect(text).toContain('para celebrar');
      expect(text).not.toContain('meta:');
    });
  });

  describe('"Ver aportes por persona" (2+ miembros, desglose + torta)', () => {
    const twoMembers = [
      { uid: 'u1', displayName: 'Diego', email: '', photoURL: '' },
      { uid: 'u2', displayName: 'Ana', email: '', photoURL: '' },
    ];

    beforeEach(() => {
      chartInstances.length = 0;
    });

    it('hides the link with only 1 member, even with contributions', async () => {
      await setUp([{ id: 'e1', type: 'contribution', amount: 100, date: ts(1), note: '' }], {}, oneMember);

      expect(component.showContributorBreakdownLink()).toBe(false);
      expect(fixture.nativeElement.textContent).not.toContain('Ver aportes por persona');
    });

    it('hides the link with 2 members but only 1 of them has ever contributed', async () => {
      await setUp(
        [{ id: 'e1', type: 'contribution', amount: 100, date: ts(1), uid: 'u1', note: '' }],
        {},
        twoMembers
      );

      expect(component.showContributorBreakdownLink()).toBe(false);
    });

    it('shows the link with 2+ members and 2+ distinct contributors', async () => {
      await setUp(
        [
          { id: 'e1', type: 'contribution', amount: 100, date: ts(1), uid: 'u1', note: '' },
          { id: 'e2', type: 'contribution', amount: 50, date: ts(2), uid: 'u2', note: '' },
        ],
        {},
        twoMembers
      );

      expect(component.showContributorBreakdownLink()).toBe(true);
      expect(fixture.nativeElement.textContent).toContain('Ver aportes por persona');
    });

    it('opens the modal and builds a doughnut chart from the breakdown', async () => {
      await setUp(
        [
          { id: 'e1', type: 'contribution', amount: 600, date: ts(1), uid: 'u1', note: '' },
          { id: 'e2', type: 'contribution', amount: 400, date: ts(2), uid: 'u2', note: '' },
        ],
        {},
        twoMembers
      );

      component.openContributorsModal();
      fixture.detectChanges();

      const chart = chartInstances.find((c) => c.type === 'doughnut');
      expect(chart).toBeTruthy();
      expect(chart!.data.labels).toEqual(['Diego', 'Ana']);
      expect(chart!.data.datasets[0].data).toEqual([600, 400]);
    });

    it('destroys the chart when the modal closes', async () => {
      await setUp(
        [
          { id: 'e1', type: 'contribution', amount: 600, date: ts(1), uid: 'u1', note: '' },
          { id: 'e2', type: 'contribution', amount: 400, date: ts(2), uid: 'u2', note: '' },
        ],
        {},
        twoMembers
      );
      component.openContributorsModal();
      fixture.detectChanges();
      const chart = chartInstances.find((c) => c.type === 'doughnut')!;

      component.closeContributorsModal();
      fixture.detectChanges();

      expect(chart.destroy).toHaveBeenCalled();
      expect(fixture.nativeElement.querySelector('canvas')).toBeNull();
    });

    it('renders a legend row per contributor with avatar, name, net amount (can be negative) and percentage', async () => {
      await setUp(
        [
          { id: 'e1', type: 'contribution', amount: 800, date: ts(1), uid: 'u1', note: '' },
          { id: 'e2', type: 'withdrawal', amount: 100, date: ts(2), uid: 'u2', note: '' },
        ],
        {},
        twoMembers
      );
      component.openContributorsModal();
      fixture.detectChanges();

      const rows = Array.from<HTMLElement>(fixture.nativeElement.querySelectorAll('.mfx-group-detail__contributor-row'));
      expect(rows.length).toBe(2);
      expect(rows[0].textContent).toContain('Diego');
      expect(rows[0].querySelector('mfx-avatar')).toBeTruthy();
      // u1 (Diego): neto real 800, pero su porción se reescala a 700 (el
      // total real ahorrado, 800 - 100) -> 100% de la torta, no 800/800.
      expect(rows[0].textContent).toContain('100%');
      // u2 (Ana): neto real -100 — visible tal cual en el texto, nunca
      // oculto — con porción 0% en la torta (ver computeGoalContributorBreakdown).
      expect(rows[1].textContent).toContain('Ana');
      expect(rows[1].textContent).toContain('0%');
    });
  });
});
