import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { Accounts } from '../../../core/accounts/accounts';
import { ActiveGroup } from '../../../core/active-group/active-group';
import { Auth } from '../../../core/auth/auth';
import { AttachmentsService } from '../../../core/attachments/attachments';
import { Categories } from '../../../core/categories/categories';
import { GroupsService } from '../../../core/groups/groups';
import { ModalStack } from '../../../core/modal-stack/modal-stack';
import { MovementsService } from '../../../core/movements/movements';
import { ReceiptReader } from '../../../core/receipt-reader/receipt-reader';
import { SettlementsService } from '../../../core/settlements/settlements';
import { SharedExpenseFormState } from '../../../core/shared-expense-form-state/shared-expense-form-state';
import { SharedExpenseForm } from './shared-expense-form';

// Usado en todos los TestBed de este spec — SharedExpenseForm necesita
// SettlementsService.settlements$() para calcular isLocked(); por defecto
// sin settlements (nunca bloqueado), salvo que un describe lo sobreescriba.
const fakeSettlementsService = { settlements$: () => of([]) };

// mfx-attachment-picker (primer campo del form) inyecta esto directo — se
// mockea en TODOS los TestBed de este spec para no depender de la
// instancia real, que a su vez necesitaría Storage.
const fakeAttachmentsService = { getDownloadUrl: vi.fn().mockResolvedValue(null) };

// ReceiptReader inyecta Auth -> Firestore — se mockea en TODOS los TestBed
// de este spec por el mismo motivo que fakeAttachmentsService. Ninguno de
// estos tests llama extract() salvo el describe dedicado a la lectura
// automática, que sobreescribe esto con su propio spy.
const fakeReceiptReader = { extract: vi.fn() };

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await Promise.resolve();
  }
}

const fakeAccounts = [{ id: 'acc1', uid: 'u1', name: 'Efectivo', type: 'efectivo' as const, balance: 0, currency: 'COP' }];
const fakeCategories = [
  { id: 'cat-expense', uid: null, name: 'Comida', icon: '🍔', type: 'expense' as const },
  { id: 'cat-income', uid: null, name: 'Salario', icon: '💼', type: 'income' as const },
];
const fakeMembers = [
  { uid: 'u1', displayName: 'Diego', email: 'diego@example.com', photoURL: '' },
  { uid: 'u2', displayName: 'Ana', email: 'ana@example.com', photoURL: '' },
];
const fakeSharedGroup = {
  id: 'group1',
  name: 'Apartamento',
  members: ['u1', 'u2'],
  createdBy: 'u1',
  createdAt: {} as never,
  type: 'shared' as const,
};

describe('SharedExpenseForm', () => {
  let component: SharedExpenseForm;
  let fixture: ComponentFixture<SharedExpenseForm>;
  let createShared: ReturnType<typeof vi.fn>;
  let attachFile: ReturnType<typeof vi.fn>;
  let getMemberProfiles: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    createShared = vi.fn().mockResolvedValue('mov1');
    attachFile = vi.fn().mockResolvedValue(undefined);
    getMemberProfiles = vi.fn().mockResolvedValue(fakeMembers);

    await TestBed.configureTestingModule({
      imports: [SharedExpenseForm],
      providers: [
        { provide: MovementsService, useValue: { createShared, attachFile } },
        { provide: AttachmentsService, useValue: fakeAttachmentsService },
        { provide: ReceiptReader, useValue: fakeReceiptReader },
        { provide: Accounts, useValue: { accounts$: of(fakeAccounts) } },
        { provide: Categories, useValue: { categories$: of(fakeCategories) } },
        { provide: GroupsService, useValue: { getMemberProfiles, groups$: of([fakeSharedGroup]) } },
        { provide: SettlementsService, useValue: fakeSettlementsService },
        { provide: Auth, useValue: { currentUser: { uid: 'u1' } } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SharedExpenseForm);
    component = fixture.componentInstance;
    TestBed.inject(ActiveGroup).select('group1');
    fixture.detectChanges();
    await flushMicrotasks();
    fixture.detectChanges();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('submits with the current time of day, not midnight, when the date is left unchanged', async () => {
    // El campo date ya trae "hoy" por defecto desde la construcción (antes
    // de fijar el reloj falso) — se deriva el año/mes/día esperado de ese
    // mismo valor en vez de asumir uno fijo, para no acoplar el test al
    // momento real en que corre.
    const [year, month, day] = component.form.controls.date.value.split('-').map(Number);
    vi.useFakeTimers();
    vi.setSystemTime(new Date(year, month - 1, day, 14, 30, 15));
    component.form.controls.amount.setValue(100);
    component.form.controls.accountId.setValue('acc1');
    component.form.controls.categoryId.setValue('cat-expense');

    await component.submit();
    vi.useRealTimers();

    const [value] = createShared.mock.calls[0];
    expect(value.date.getFullYear()).toBe(year);
    expect(value.date.getMonth()).toBe(month - 1);
    expect(value.date.getDate()).toBe(day);
    expect(value.date.getHours()).toBe(14);
    expect(value.date.getMinutes()).toBe(30);
    expect(value.date.getSeconds()).toBe(15);
  });

  it('keeps the current time of day even when the date is changed to a past date', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 15, 9, 5, 0));
    component.form.controls.amount.setValue(100);
    component.form.controls.accountId.setValue('acc1');
    component.form.controls.categoryId.setValue('cat-expense');
    component.form.controls.date.setValue('2026-03-01');

    await component.submit();
    vi.useRealTimers();

    const [value] = createShared.mock.calls[0];
    expect(value.date.getDate()).toBe(1);
    expect(value.date.getHours()).toBe(9);
    expect(value.date.getMinutes()).toBe(5);
  });

  it('loads the members of the active group and defaults paidBy to the current user', () => {
    expect(getMemberProfiles).toHaveBeenCalledWith('group1');
    expect(component.members()).toEqual(fakeMembers);
    expect(component.form.controls.paidBy.value).toBe('u1');
  });

  it('needsAccount() is true when the current user is the payer', () => {
    expect(component.needsAccount()).toBe(true);
  });

  it('needsAccount() is false and clears accountId when someone else is selected as payer', () => {
    component.selectPaidBy('u2');
    fixture.detectChanges();

    expect(component.needsAccount()).toBe(false);
    expect(component.form.controls.accountId.value).toBe('');
    expect(component.form.controls.accountId.hasError('required')).toBe(false);
  });

  it('does not require an account even when the payer is the current user (Fase 10, cuenta opcional)', () => {
    expect(component.needsAccount()).toBe(true);
    expect(component.form.controls.accountId.hasError('required')).toBe(false);
    expect(component.form.valid).toBe(false); // amount sigue en 0 por defecto
    component.form.controls.amount.setValue(100);
    expect(component.form.controls.accountId.valid).toBe(true);
  });

  it('does not require a category either (Fase 10, categoría opcional)', () => {
    expect(component.form.controls.categoryId.hasError('required')).toBe(false);
  });

  it('distributes an equal split with the exact total (remainder goes to the first member)', () => {
    component.form.controls.amount.setValue(100);
    fixture.detectChanges();

    // 100 / 2 miembros = 50 c/u, exacto, sin residuo.
    expect(component.equalSplitPreview()).toEqual([
      { uid: 'u1', amount: 50, settled: false },
      { uid: 'u2', amount: 50, settled: false },
    ]);
  });

  it('handles an uneven equal split without losing a cent', () => {
    // 100 entre 3 no divide exacto -> el residuo se lo lleva el primero.
    getMemberProfiles.mockResolvedValue([...fakeMembers, { uid: 'u3', displayName: 'Beto', email: '', photoURL: '' }]);
    component.form.controls.amount.setValue(100);

    const splits = component.equalSplitPreview();
    const total = splits.reduce((sum, s) => sum + s.amount, 0);

    expect(total).toBe(100);
  });

  it('rebuilds split inputs (one per member) when switching to percentage', () => {
    component.selectSplitType('percentage');
    fixture.detectChanges();

    expect(component.splitInputs.length).toBe(2);
    expect(component.splitInputs.at(0).controls.value.value).toBe(50);
    expect(component.splitMismatch()).toBe(false);
  });

  it('flags a mismatch when percentages do not sum to 100', () => {
    component.selectSplitType('percentage');
    fixture.detectChanges();
    component.splitInputs.at(0).controls.value.setValue(20);

    expect(component.splitMismatch()).toBe(true);
  });

  it('flags a mismatch when fixed amounts do not sum to the total', () => {
    component.form.controls.amount.setValue(100);
    component.selectSplitType('fixed');
    fixture.detectChanges();
    component.splitInputs.at(0).controls.value.setValue(10);

    expect(component.splitMismatch()).toBe(true);
  });

  it('blocks submit while there is a split mismatch, without calling the service', async () => {
    component.form.controls.amount.setValue(100);
    component.form.controls.accountId.setValue('acc1');
    component.form.controls.categoryId.setValue('cat-expense');
    component.selectSplitType('percentage');
    fixture.detectChanges();
    component.splitInputs.at(0).controls.value.setValue(20);

    await component.submit();

    expect(createShared).not.toHaveBeenCalled();
  });

  it('submits an equal split with the correct payload', async () => {
    const emitted: void[] = [];
    component.saved.subscribe(() => emitted.push(undefined));
    component.form.controls.amount.setValue(100);
    component.form.controls.accountId.setValue('acc1');
    component.form.controls.categoryId.setValue('cat-expense');

    await component.submit();

    expect(createShared).toHaveBeenCalledWith(
      expect.objectContaining({
        groupId: 'group1',
        paidBy: 'u1',
        amount: 100,
        accountId: 'acc1',
        categoryId: 'cat-expense',
        splitType: 'equal',
        splits: [
          { uid: 'u1', amount: 50, settled: false },
          { uid: 'u2', amount: 50, settled: false },
        ],
      })
    );
    expect(emitted.length).toBe(1);
  });

  it('submits a percentage split converted to actual amounts', async () => {
    component.form.controls.amount.setValue(100);
    component.form.controls.accountId.setValue('acc1');
    component.form.controls.categoryId.setValue('cat-expense');
    component.selectSplitType('percentage');
    fixture.detectChanges();
    component.splitInputs.at(0).controls.value.setValue(70);
    component.splitInputs.at(1).controls.value.setValue(30);

    await component.submit();

    expect(createShared).toHaveBeenCalledWith(
      expect.objectContaining({
        splitType: 'percentage',
        splits: [
          { uid: 'u1', amount: 70, settled: false },
          { uid: 'u2', amount: 30, settled: false },
        ],
      })
    );
  });

  it('sends accountId: null when the payer is someone else', async () => {
    component.selectPaidBy('u2');
    fixture.detectChanges();
    component.form.controls.amount.setValue(100);
    component.form.controls.categoryId.setValue('cat-expense');

    await component.submit();

    expect(createShared).toHaveBeenCalledWith(expect.objectContaining({ paidBy: 'u2', accountId: null }));
  });

  it('resolves categoryName/categoryIcon from the selected category (Fase 10, denormalizada)', async () => {
    component.form.controls.amount.setValue(100);
    component.form.controls.accountId.setValue('acc1');
    component.form.controls.categoryId.setValue('cat-expense');

    await component.submit();

    expect(createShared).toHaveBeenCalledWith(
      expect.objectContaining({ categoryId: 'cat-expense', categoryName: 'Comida', categoryIcon: '🍔' })
    );
  });

  it('sends null category fields when no category is selected (Fase 10, opcional)', async () => {
    component.form.controls.amount.setValue(100);
    component.form.controls.accountId.setValue('acc1');

    await component.submit();

    expect(createShared).toHaveBeenCalledWith(
      expect.objectContaining({ categoryId: null, categoryName: null, categoryIcon: null })
    );
  });

  it('sends accountId: null (not "") when the payer is the current user but leaves the account unselected (Fase 10, opcional)', async () => {
    component.form.controls.amount.setValue(100);
    component.form.controls.categoryId.setValue('cat-expense');

    await component.submit();

    expect(createShared).toHaveBeenCalledWith(expect.objectContaining({ accountId: null }));
  });

  it('shows an inline error if createShared() fails', async () => {
    createShared.mockRejectedValue(new Error('boom'));
    component.form.controls.amount.setValue(100);
    component.form.controls.accountId.setValue('acc1');
    component.form.controls.categoryId.setValue('cat-expense');

    await component.submit();

    expect(component.errorMessage()).toBe('No pudimos guardar el gasto. Intenta de nuevo.');
  });

  it('disables the submit button while the form is invalid', () => {
    component.form.controls.amount.setValue(0);
    fixture.detectChanges();

    const button: HTMLButtonElement = fixture.nativeElement.querySelector('.mfx-form__actions button[type="submit"]');
    expect(button.disabled).toBe(true);
  });

  // Fase 9 (adaptación de copy/UI para grupos de un solo miembro): con 2+
  // miembros nada cambia — cobertura explícita para no regresarlo.
  it('is not the personal flow with 2+ members — both sections render, button says "compartido"', () => {
    expect(component.isPersonalFlow()).toBe(false);
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('¿Quién pagó?');
    expect(text).toContain('División');

    const button: HTMLButtonElement = fixture.nativeElement.querySelector('.mfx-form__actions button');
    expect(button.textContent?.trim()).toBe('Agregar gasto compartido');
  });

  it('publishes isPersonalFlow() into SharedExpenseFormState (Shell reads it for the modal title)', () => {
    expect(TestBed.inject(SharedExpenseFormState).isPersonalFlow()).toBe(false);
  });

  describe('adjunto (mfx-attachment-picker, primer campo)', () => {
    it('renders the picker as the first element inside the form', () => {
      const form = fixture.nativeElement.querySelector('form');
      expect(form.firstElementChild.tagName.toLowerCase()).toBe('mfx-attachment-picker');
    });

    it('does not call attachFile() when nothing was attached', async () => {
      component.form.controls.amount.setValue(100);
      component.form.controls.accountId.setValue('acc1');
      component.form.controls.categoryId.setValue('cat-expense');

      await component.submit();

      expect(attachFile).not.toHaveBeenCalled();
    });

    it('uploads the pending attachment to the new movement id after creating it', async () => {
      const pending = { blob: new Blob(['x']), contentType: 'image/jpeg', fileName: 'recibo.jpg' };
      component.pendingAttachment.set(pending);
      component.form.controls.amount.setValue(100);
      component.form.controls.accountId.setValue('acc1');
      component.form.controls.categoryId.setValue('cat-expense');

      await component.submit();

      expect(createShared).toHaveBeenCalledTimes(1);
      expect(attachFile).toHaveBeenCalledWith('mov1', pending);
    });

    it('retrying after an attachment-upload failure does NOT re-create the movement', async () => {
      attachFile.mockRejectedValueOnce(new Error('network error'));
      component.pendingAttachment.set({ blob: new Blob(['x']), contentType: 'image/jpeg', fileName: 'a.jpg' });
      component.form.controls.amount.setValue(100);
      component.form.controls.accountId.setValue('acc1');
      component.form.controls.categoryId.setValue('cat-expense');

      await component.submit();
      fixture.detectChanges();
      expect(component.errorMessage()).toBe(
        'Guardamos el gasto, pero no pudimos subir el archivo adjunto. Intenta de nuevo.'
      );
      expect(createShared).toHaveBeenCalledTimes(1);
      expect(fixture.nativeElement.querySelector('button[type="submit"]').textContent).toContain(
        'Reintentar subir adjunto'
      );

      const emitted: void[] = [];
      component.saved.subscribe(() => emitted.push(undefined));
      await component.submit(); // reintento — solo el adjunto

      expect(createShared).toHaveBeenCalledTimes(1); // no se repite
      expect(attachFile).toHaveBeenCalledTimes(2);
      expect(emitted.length).toBe(1);
    });
  });

  describe('lectura automática de recibos (ReceiptReader) — mismo pipeline que MovementForm', () => {
    const PREVIEW = { base64: 'x', mediaType: 'image/jpeg' };
    const pendingWithPreview = (aiPreview: typeof PREVIEW | null = PREVIEW) => ({
      blob: new Blob(['x']),
      contentType: 'image/jpeg',
      fileName: 'recibo.jpg',
      aiPreview,
    });
    const HIGH_CONFIDENCE_RESULT = {
      amount: 45000,
      currency: 'COP',
      date: '2026-09-30',
      merchant: 'Supermercado La 14',
      suggestedCategory: 'Comida',
      lineItems: null,
      confidence: 'high' as const,
    };

    it('does not call extract() when the attachment has no aiPreview', () => {
      component.onAttachmentReady({ blob: new Blob(['x']), contentType: 'image/jpeg', fileName: 'a.jpg' });

      expect(fakeReceiptReader.extract).not.toHaveBeenCalled();
    });

    it('patches amount/date/note/categoryId from a high-confidence result and marks them isAiFilled()', async () => {
      fakeReceiptReader.extract.mockResolvedValue(HIGH_CONFIDENCE_RESULT);

      component.onAttachmentReady(pendingWithPreview());
      await Promise.resolve();
      await Promise.resolve();

      expect(component.form.controls.amount.value).toBe(45000);
      expect(component.form.controls.date.value).toBe('2026-09-30');
      expect(component.form.controls.note.value).toBe('Supermercado La 14');
      expect(component.form.controls.categoryId.value).toBe('cat-expense');
      expect(component.isAiFilled('amount')).toBe(true);
      expect(component.isAiFilled('date')).toBe(true);
      expect(component.isAiFilled('note')).toBe(true);
      expect(component.isAiFilled('categoryId')).toBe(true);
    });

    // El requisito explícito de la conversación: la IA solo prellena lo que
    // sale del recibo — paidBy, splitType y las cuotas los pone SIEMPRE el
    // usuario, nunca la lectura automática.
    it('NEVER touches paidBy, splitType, or installment fields — only amount/date/note/categoryId', async () => {
      fakeReceiptReader.extract.mockResolvedValue(HIGH_CONFIDENCE_RESULT);
      const paidByBefore = component.form.controls.paidBy.value;
      const splitTypeBefore = component.form.controls.splitType.value;
      const payInInstallmentsBefore = component.form.controls.payInInstallments.value;

      component.onAttachmentReady(pendingWithPreview());
      await Promise.resolve();
      await Promise.resolve();

      expect(component.form.controls.paidBy.value).toBe(paidByBefore);
      expect(component.form.controls.splitType.value).toBe(splitTypeBefore);
      expect(component.form.controls.payInInstallments.value).toBe(payInInstallmentsBefore);
    });

    it('never fires at all in edit mode, even if somehow given an aiPreview', () => {
      // Defensivo: AttachmentPicker ya no calcula aiPreview en modo edición
      // ([prepareAiPreview]="!initialValue()"), esto confirma el segundo
      // seguro del lado del componente.
      fixture.componentRef.setInput('initialValue', {
        id: 'mov1',
        uid: 'u1',
        groupId: 'group1',
        paidBy: 'u1',
        amount: 100,
        accountId: null,
        categoryId: null,
        categoryName: null,
        categoryIcon: null,
        splitType: 'equal',
        splits: [],
        date: { toDate: () => new Date('2026-01-01') },
        note: '',
      });
      fixture.detectChanges();
      fakeReceiptReader.extract.mockClear(); // descarta llamadas de tests anteriores en este describe

      component.onAttachmentReady(pendingWithPreview());

      expect(fakeReceiptReader.extract).not.toHaveBeenCalled();
    });

    it('confidence "low": patches nothing, shows the discreet note instead', async () => {
      fakeReceiptReader.extract.mockResolvedValue({ ...HIGH_CONFIDENCE_RESULT, confidence: 'low' as const });

      component.onAttachmentReady(pendingWithPreview());
      await Promise.resolve();
      await Promise.resolve();

      expect(component.form.controls.amount.value).toBe(0);
      expect(component.receiptNote()).toBe('No pudimos leer bien el recibo — completa los datos a mano.');
      expect(component.errorMessage()).toBeNull();
    });

    it('never touches a field the user already edited manually (pristine check)', async () => {
      fakeReceiptReader.extract.mockResolvedValue(HIGH_CONFIDENCE_RESULT);
      component.form.controls.amount.setValue(999);
      component.form.controls.amount.markAsDirty();

      component.onAttachmentReady(pendingWithPreview());
      await Promise.resolve();
      await Promise.resolve();

      expect(component.form.controls.amount.value).toBe(999);
      expect(component.isAiFilled('amount')).toBe(false);
      expect(component.form.controls.date.value).toBe('2026-09-30');
    });

    it('shows the ✨ badge in the DOM for an AI-filled field, not just the internal flag', async () => {
      fakeReceiptReader.extract.mockResolvedValue(HIGH_CONFIDENCE_RESULT);

      component.onAttachmentReady(pendingWithPreview());
      await Promise.resolve();
      await Promise.resolve();
      fixture.detectChanges();

      const badges = fixture.nativeElement.querySelectorAll('.mfx-shared-expense-form__ai-badge');
      expect(badges.length).toBe(4); // monto, categoría, fecha, nota — nunca paidBy/división/cuotas
    });

    it('shows a "Cancelar" link while reading, which stops the loading state', () => {
      fakeReceiptReader.extract.mockReturnValue(new Promise(() => {}));
      component.onAttachmentReady(pendingWithPreview());
      fixture.detectChanges();

      const cancelLink: HTMLButtonElement = fixture.nativeElement.querySelector(
        '.mfx-shared-expense-form__receipt-cancel'
      );
      expect(cancelLink).toBeTruthy();
      cancelLink.click();

      expect(component.receiptReading()).toBe(false);
    });
  });
});

// Fase 10+1: pagos a cuotas, solo para grupos de exactamente 2 miembros, y
// solo al crear (nunca al editar — ver readOnly()). fakeMembers/fakeSharedGroup
// ya tienen exactamente 2 miembros, igual que el describe principal.
describe('SharedExpenseForm — pagos a cuotas (Fase 10+1)', () => {
  let component: SharedExpenseForm;
  let fixture: ComponentFixture<SharedExpenseForm>;
  let createShared: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    createShared = vi.fn().mockResolvedValue(undefined);

    await TestBed.configureTestingModule({
      imports: [SharedExpenseForm],
      providers: [
        { provide: MovementsService, useValue: { createShared } },
        { provide: AttachmentsService, useValue: fakeAttachmentsService },
        { provide: ReceiptReader, useValue: fakeReceiptReader },
        { provide: Accounts, useValue: { accounts$: of(fakeAccounts) } },
        { provide: Categories, useValue: { categories$: of(fakeCategories) } },
        { provide: GroupsService, useValue: { getMemberProfiles: vi.fn().mockResolvedValue(fakeMembers), groups$: of([fakeSharedGroup]) } },
        { provide: SettlementsService, useValue: fakeSettlementsService },
        { provide: Auth, useValue: { currentUser: { uid: 'u1' } } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SharedExpenseForm);
    component = fixture.componentInstance;
    TestBed.inject(ActiveGroup).select('group1');
    fixture.detectChanges();
    await flushMicrotasks();
    fixture.detectChanges();

    component.form.controls.amount.setValue(100);
    component.form.controls.date.setValue('2026-01-31'); // fin de mes, para probar el clamp
    fixture.detectChanges();
  });

  it('showInstallmentOption() is true for exactly 2 members, in create mode', () => {
    expect(component.showInstallmentOption()).toBe(true);
  });

  it('renders the "¿Pagar a cuotas?" checkbox', () => {
    expect(fixture.nativeElement.textContent).toContain('¿Pagar a cuotas?');
  });

  it('debtorAmount(): equal split — whatever the non-payer owes, not the total', () => {
    // 100 dividido igual entre u1 (paga) y u2 -> u2 debe 50.
    expect(component.debtorAmount()).toBe(50);
  });

  it('debtorAmount(): non-equal split — reads the actual amount the debtor was assigned', () => {
    component.selectSplitType('fixed');
    fixture.detectChanges();
    const debtorGroup = component.splitInputs.controls.find((g) => g.controls.uid.value === 'u2')!;
    debtorGroup.controls.value.setValue(70);
    component.splitInputs.controls.find((g) => g.controls.uid.value === 'u1')!.controls.value.setValue(30);
    fixture.detectChanges();

    expect(component.debtorAmount()).toBe(70);
  });

  it('installmentPreview(): "equal" mode distributes the debt evenly, remainder to the first cuota', () => {
    component.form.controls.payInInstallments.setValue(true);
    component.form.controls.installmentCount.setValue(3);
    fixture.detectChanges();

    const preview = component.installmentPreview();
    expect(preview.map((i) => i.amount)).toEqual([16.68, 16.66, 16.66]);
    expect(preview.reduce((sum, i) => sum + i.amount, 0)).toBeCloseTo(50, 2);
  });

  it('installmentPreview(): due dates are monthly starting from the expense date, clamped at end-of-month', () => {
    component.form.controls.payInInstallments.setValue(true);
    component.form.controls.installmentCount.setValue(3);
    fixture.detectChanges();

    const preview = component.installmentPreview();
    // 31 ene + 1 mes no puede ser 3 mar (overflow) -> se recorta a 28 feb.
    expect(preview[0].dueDate.getFullYear()).toBe(2026);
    expect(preview[0].dueDate.getMonth()).toBe(0); // enero
    expect(preview[0].dueDate.getDate()).toBe(31);
    expect(preview[1].dueDate.getMonth()).toBe(1); // febrero
    expect(preview[1].dueDate.getDate()).toBe(28);
    expect(preview[2].dueDate.getMonth()).toBe(2); // marzo
  });

  it('installmentPreview(): "fixed" mode reads the editable per-cuota inputs', () => {
    component.form.controls.payInInstallments.setValue(true);
    component.form.controls.installmentCount.setValue(2);
    fixture.detectChanges();
    component.selectInstallmentMode('fixed');
    fixture.detectChanges();
    component.installmentInputs.at(0).setValue(20);
    component.installmentInputs.at(1).setValue(30);
    fixture.detectChanges();

    expect(component.installmentPreview().map((i) => i.amount)).toEqual([20, 30]);
  });

  it('installmentMismatch(): true in "fixed" mode when the cuotas do not sum to the debt', () => {
    component.form.controls.payInInstallments.setValue(true);
    component.form.controls.installmentCount.setValue(2);
    fixture.detectChanges();
    component.selectInstallmentMode('fixed');
    fixture.detectChanges();
    component.installmentInputs.at(0).setValue(20);
    component.installmentInputs.at(1).setValue(20); // 40 != 50

    expect(component.installmentMismatch()).toBe(true);
  });

  it('installmentMismatch(): always false in "equal" mode', () => {
    component.form.controls.payInInstallments.setValue(true);
    component.form.controls.installmentCount.setValue(3);
    fixture.detectChanges();

    expect(component.installmentMismatch()).toBe(false);
  });

  it('submit(): includes the installment plan (status "pending") when payInInstallments is checked', async () => {
    component.form.controls.payInInstallments.setValue(true);
    component.form.controls.installmentCount.setValue(2);
    fixture.detectChanges();

    await component.submit();

    expect(createShared).toHaveBeenCalledWith(
      expect.objectContaining({
        installments: [
          expect.objectContaining({ amount: 25, status: 'pending' }),
          expect.objectContaining({ amount: 25, status: 'pending' }),
        ],
      })
    );
  });

  it('submit(): sends installments: null when payInInstallments is left unchecked', async () => {
    await component.submit();

    expect(createShared).toHaveBeenCalledWith(expect.objectContaining({ installments: null }));
  });

  it('blocks submit while there is an installment mismatch, without calling the service', async () => {
    component.form.controls.payInInstallments.setValue(true);
    component.form.controls.installmentCount.setValue(2);
    fixture.detectChanges();
    component.selectInstallmentMode('fixed');
    fixture.detectChanges();
    component.installmentInputs.at(0).setValue(10);
    component.installmentInputs.at(1).setValue(10);

    await component.submit();

    expect(createShared).not.toHaveBeenCalled();
  });
});

describe('SharedExpenseForm without an active group', () => {
  let fixture: ComponentFixture<SharedExpenseForm>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SharedExpenseForm],
      providers: [
        { provide: MovementsService, useValue: { createShared: vi.fn() } },
        { provide: AttachmentsService, useValue: fakeAttachmentsService },
        { provide: ReceiptReader, useValue: fakeReceiptReader },
        { provide: Accounts, useValue: { accounts$: of(fakeAccounts) } },
        { provide: Categories, useValue: { categories$: of(fakeCategories) } },
        { provide: GroupsService, useValue: { getMemberProfiles: vi.fn().mockResolvedValue([]), groups$: of([]) } },
        { provide: SettlementsService, useValue: fakeSettlementsService },
        { provide: Auth, useValue: { currentUser: { uid: 'u1' } } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SharedExpenseForm);
    fixture.detectChanges();
  });

  it('shows a message instead of the form', () => {
    expect(fixture.nativeElement.textContent).toContain('Primero crea o únete a un grupo');
    expect(fixture.nativeElement.querySelector('form')).toBeNull();
  });
});

// Fase 9 (corrección posterior al primer intento de "grupos personales"):
// "+ Agregar gasto" en CUALQUIER grupo abre este mismo formulario — con un
// solo miembro, solo cambia la presentación (título, secciones visibles,
// texto del botón), nunca la lógica de guardado.
describe('SharedExpenseForm with a single-member group (Fase 9, personal-flow UI)', () => {
  let component: SharedExpenseForm;
  let fixture: ComponentFixture<SharedExpenseForm>;
  let createShared: ReturnType<typeof vi.fn>;

  const soloMember = [{ uid: 'u1', displayName: 'Diego', email: 'diego@example.com', photoURL: '' }];

  beforeEach(async () => {
    createShared = vi.fn().mockResolvedValue(undefined);

    await TestBed.configureTestingModule({
      imports: [SharedExpenseForm],
      providers: [
        { provide: MovementsService, useValue: { createShared } },
        { provide: AttachmentsService, useValue: fakeAttachmentsService },
        { provide: ReceiptReader, useValue: fakeReceiptReader },
        { provide: Accounts, useValue: { accounts$: of(fakeAccounts) } },
        { provide: Categories, useValue: { categories$: of(fakeCategories) } },
        { provide: GroupsService, useValue: { getMemberProfiles: vi.fn().mockResolvedValue(soloMember) } },
        { provide: SettlementsService, useValue: fakeSettlementsService },
        { provide: Auth, useValue: { currentUser: { uid: 'u1' } } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SharedExpenseForm);
    component = fixture.componentInstance;
    TestBed.inject(ActiveGroup).select('group-personal');
    fixture.detectChanges();
    await flushMicrotasks();
    fixture.detectChanges();
  });

  it('detects the personal flow and publishes it to SharedExpenseFormState', () => {
    expect(component.isPersonalFlow()).toBe(true);
    expect(TestBed.inject(SharedExpenseFormState).isPersonalFlow()).toBe(true);
  });

  it('hides "¿Quién pagó?" and "División", keeps Monto/Categoría/Fecha/Nota', () => {
    const text = fixture.nativeElement.textContent;
    expect(text).not.toContain('¿Quién pagó?');
    expect(text).not.toContain('División');
    expect(text).toContain('Monto');
    expect(text).toContain('Categoría');
    expect(text).toContain('Fecha');
    expect(text).toContain('Nota');
  });

  it('labels the submit button "Agregar gasto", not "Agregar gasto compartido"', () => {
    const button: HTMLButtonElement = fixture.nativeElement.querySelector('.mfx-form__actions button');
    expect(button.textContent?.trim()).toBe('Agregar gasto');
  });

  it('still saves paidBy = the sole member with an implicit 100% equal split', async () => {
    component.form.controls.amount.setValue(50000);
    component.form.controls.accountId.setValue('acc1');
    component.form.controls.categoryId.setValue('cat-expense');

    await component.submit();

    expect(createShared).toHaveBeenCalledWith(
      expect.objectContaining({
        paidBy: 'u1',
        splitType: 'equal',
        splits: [{ uid: 'u1', amount: 50000, settled: false }],
      })
    );
  });
});

// Fase 10: editar/eliminar un gasto compartido ya existente — el modal lo
// abre GroupActivity solo para quien lo registró (uid), ver su guard.
describe('SharedExpenseForm in edit mode (Fase 10)', () => {
  let component: SharedExpenseForm;
  let fixture: ComponentFixture<SharedExpenseForm>;
  let updateShared: ReturnType<typeof vi.fn>;
  let removeShared: ReturnType<typeof vi.fn>;
  let createShared: ReturnType<typeof vi.fn>;
  let attachFile: ReturnType<typeof vi.fn>;
  let removeAttachment: ReturnType<typeof vi.fn>;
  let getDownloadUrl: ReturnType<typeof vi.fn>;

  const existingMovement = {
    id: 'm1',
    uid: 'u1',
    categoryId: 'cat-expense',
    categoryName: 'Comida',
    categoryIcon: '🍔',
    type: 'expense' as const,
    amount: 100,
    date: { toDate: () => new Date('2026-03-01'), toMillis: () => new Date('2026-03-01').getTime() } as never,
    note: 'Cena',
    groupId: 'group1',
    paidBy: 'u1',
    splitType: 'equal' as const,
    splits: [
      { uid: 'u1', amount: 50, settled: false },
      { uid: 'u2', amount: 50, settled: false },
    ],
    accountId: 'acc1',
    attachmentPath: 'movements/m1/attachment',
    attachmentContentType: 'image/jpeg',
  };

  beforeEach(async () => {
    updateShared = vi.fn().mockResolvedValue(undefined);
    removeShared = vi.fn().mockResolvedValue(undefined);
    createShared = vi.fn().mockResolvedValue(undefined);
    attachFile = vi.fn().mockResolvedValue(undefined);
    removeAttachment = vi.fn().mockResolvedValue(undefined);
    getDownloadUrl = vi.fn().mockResolvedValue('https://example.com/attachment');

    await TestBed.configureTestingModule({
      imports: [SharedExpenseForm],
      providers: [
        {
          provide: MovementsService,
          useValue: { updateShared, removeShared, createShared, attachFile, removeAttachment },
        },
        { provide: AttachmentsService, useValue: { getDownloadUrl } },
        { provide: ReceiptReader, useValue: fakeReceiptReader },
        { provide: Accounts, useValue: { accounts$: of(fakeAccounts) } },
        { provide: Categories, useValue: { categories$: of(fakeCategories) } },
        { provide: GroupsService, useValue: { getMemberProfiles: vi.fn().mockResolvedValue(fakeMembers) } },
        { provide: SettlementsService, useValue: fakeSettlementsService },
        { provide: Auth, useValue: { currentUser: { uid: 'u1' } } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SharedExpenseForm);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('fixedGroupId', 'group1');
    fixture.componentRef.setInput('initialValue', existingMovement);
    fixture.detectChanges();
    await flushMicrotasks();
    fixture.detectChanges();
  });

  it('patches the form with the existing values', () => {
    expect(component.form.controls.paidBy.value).toBe('u1');
    expect(component.form.controls.amount.value).toBe(100);
    expect(component.form.controls.accountId.value).toBe('acc1');
    expect(component.form.controls.categoryId.value).toBe('cat-expense');
    expect(component.form.controls.note.value).toBe('Cena');
  });

  it('shows "Guardar cambios" instead of "Agregar gasto compartido"', () => {
    const button: HTMLButtonElement = fixture.nativeElement.querySelector('.mfx-form__actions button[type="submit"]');
    expect(button.textContent?.trim()).toBe('Guardar cambios');
  });

  it('submit() calls updateShared with the existing id, leaving createShared untouched', async () => {
    await component.submit();

    expect(updateShared).toHaveBeenCalledWith('m1', existingMovement, expect.objectContaining({ amount: 100 }));
    expect(createShared).not.toHaveBeenCalled();
  });

  it('remove() calls removeShared and emits deleted', async () => {
    const emitted: void[] = [];
    component.deleted.subscribe(() => emitted.push(undefined));

    await component.remove();

    expect(removeShared).toHaveBeenCalledWith('m1', existingMovement);
    expect(emitted.length).toBe(1);
  });

  it('requires a second click (confirmation) before actually deleting', () => {
    const deleteButton: HTMLButtonElement = fixture.nativeElement.querySelector('.mfx-btn-danger');
    expect(deleteButton.textContent?.trim()).toBe('Eliminar gasto');

    deleteButton.click();
    fixture.detectChanges();

    const confirmButton: HTMLButtonElement = fixture.nativeElement.querySelector('.mfx-btn-danger');
    expect(confirmButton.textContent?.trim()).toBe('Sí, eliminar');
    expect(removeShared).not.toHaveBeenCalled();
  });

  it('shows the "Zona de peligro" section with the delete action, for the creator with no lock', () => {
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Zona de peligro');
    expect(component.showDangerZone()).toBe(true);
    expect(component.readOnly()).toBe(false);
  });

  // Ajuste posterior: un plan de cuotas ya NO bloquea la edición por sí
  // solo — solo pagar la primera cuota lo hace (ver isLocked()). Un gasto
  // SIN cuotas (este fixture) sigue totalmente editable, incluida la
  // posibilidad de agregarlas retroactivamente.
  it('showInstallmentOption() is true — editable, 2 miembros, sin cuotas (aún) pagadas', () => {
    expect(component.showInstallmentOption()).toBe(true);
  });

  // Ajuste posterior al botón atrás de Android: "Zona de peligro" vive
  // dentro del mismo mfx-modal (no es un modal propio) — sin registrar la
  // confirmación como su propia entrada en ModalStack, un back la saltaría
  // y cerraría el modal entero de un golpe en vez de solo cancelarla.
  // Este componente se prueba aislado (sin el <mfx-modal> que lo envuelve
  // de verdad en shell.html), así que ModalStack solo ve lo que SU propio
  // effect de confirmingDelete empuja/saca — no un mfx-modal real.
  describe('confirmación de borrado registrada en ModalStack (botón atrás)', () => {
    it('does not touch the stack while not confirming', () => {
      expect(TestBed.inject(ModalStack).hasOpen).toBe(false);
    });

    it('pushes its own entry as soon as the confirmation opens', () => {
      component.confirmingDelete.set(true);
      fixture.detectChanges();

      expect(TestBed.inject(ModalStack).hasOpen).toBe(true);
    });

    it('a back-button close cancels the confirmation instead of deleting', () => {
      component.confirmingDelete.set(true);
      fixture.detectChanges();
      const modalStack = TestBed.inject(ModalStack);

      const handled = modalStack.closeTop();
      fixture.detectChanges();

      expect(handled).toBe(true);
      expect(component.confirmingDelete()).toBe(false);
      expect(removeShared).not.toHaveBeenCalled();
      expect(modalStack.hasOpen).toBe(false);
    });

    it('pops its entry when cancelled normally, leaving nothing orphaned on the stack', () => {
      component.confirmingDelete.set(true);
      fixture.detectChanges();
      component.confirmingDelete.set(false);
      fixture.detectChanges();

      expect(TestBed.inject(ModalStack).hasOpen).toBe(false);
    });
  });

  describe('adjunto (mfx-attachment-picker, primer campo)', () => {
    it('passes the existing attachment path/contentType through to the picker', async () => {
      await Promise.resolve();
      fixture.detectChanges();

      expect(getDownloadUrl).toHaveBeenCalledWith('movements/m1/attachment');
      expect(fixture.nativeElement.textContent).toContain('Toca para verlo');
    });

    it('onExistingAttachmentRemoved() calls MovementsService.removeAttachment() and then hides it from the picker', async () => {
      await component.onExistingAttachmentRemoved();

      expect(removeAttachment).toHaveBeenCalledWith('m1', 'movements/m1/attachment');
      expect(component.existingAttachmentPath()).toBeNull();
      expect(component.removingAttachment()).toBe(false);
    });

    it('onExistingAttachmentRemoved() shows an error and keeps the attachment if removeAttachment() fails', async () => {
      removeAttachment.mockRejectedValue(new Error('network error'));

      await component.onExistingAttachmentRemoved();

      expect(component.errorMessage()).toBe('No pudimos eliminar el adjunto. Intenta de nuevo.');
      expect(component.existingAttachmentPath()).toBe('movements/m1/attachment');
    });

    it('uploads a newly-picked attachment via attachFile() after updateShared() succeeds', async () => {
      const pending = { blob: new Blob(['x']), contentType: 'image/jpeg', fileName: 'nuevo.jpg' };
      component.pendingAttachment.set(pending);

      await component.submit();

      expect(updateShared).toHaveBeenCalledTimes(1);
      expect(attachFile).toHaveBeenCalledWith('m1', pending);
    });

    it('retrying after an attachment-upload failure does NOT re-run updateShared() (would double-adjust the account balance)', async () => {
      attachFile.mockRejectedValueOnce(new Error('network error'));
      component.pendingAttachment.set({ blob: new Blob(['x']), contentType: 'image/jpeg', fileName: 'a.jpg' });

      await component.submit();
      fixture.detectChanges();
      expect(updateShared).toHaveBeenCalledTimes(1);
      expect(component.errorMessage()).toBe(
        'Guardamos el gasto, pero no pudimos subir el archivo adjunto. Intenta de nuevo.'
      );
      expect(fixture.nativeElement.querySelector('button[type="submit"]').textContent).toContain(
        'Reintentar subir adjunto'
      );

      await component.submit(); // reintento

      expect(updateShared).toHaveBeenCalledTimes(1); // no se repite
      expect(attachFile).toHaveBeenCalledTimes(2);
    });
  });
});

// Ajuste posterior (ronda después de Fase 10+1): editar un gasto que YA
// tiene cuotas, antes de que se pague ninguna, debe regenerar el plan
// desde cero con lo que sea que el usuario cambie — nunca dejarlo obsoleto.
describe('SharedExpenseForm editing an existing installment plan (not yet paid)', () => {
  let component: SharedExpenseForm;
  let fixture: ComponentFixture<SharedExpenseForm>;
  let updateShared: ReturnType<typeof vi.fn>;

  const existingInstallments = [
    { dueDate: { toDate: () => new Date('2026-03-01') } as never, amount: 25, status: 'pending' as const },
    { dueDate: { toDate: () => new Date('2026-04-01') } as never, amount: 25, status: 'pending' as const },
  ];
  const existingMovement = {
    id: 'm1',
    uid: 'u1',
    categoryId: 'cat-expense',
    categoryName: 'Comida',
    categoryIcon: '🍔',
    type: 'expense' as const,
    amount: 100,
    date: { toDate: () => new Date('2026-03-01'), toMillis: () => new Date('2026-03-01').getTime() } as never,
    note: 'Nevera',
    groupId: 'group1',
    paidBy: 'u1',
    splitType: 'equal' as const,
    splits: [
      { uid: 'u1', amount: 50, settled: false },
      { uid: 'u2', amount: 50, settled: false },
    ],
    accountId: 'acc1',
    installments: existingInstallments,
  };

  beforeEach(async () => {
    updateShared = vi.fn().mockResolvedValue(undefined);

    await TestBed.configureTestingModule({
      imports: [SharedExpenseForm],
      providers: [
        { provide: MovementsService, useValue: { updateShared, removeShared: vi.fn(), createShared: vi.fn() } },
        { provide: AttachmentsService, useValue: fakeAttachmentsService },
        { provide: ReceiptReader, useValue: fakeReceiptReader },
        { provide: Accounts, useValue: { accounts$: of(fakeAccounts) } },
        { provide: Categories, useValue: { categories$: of(fakeCategories) } },
        { provide: GroupsService, useValue: { getMemberProfiles: vi.fn().mockResolvedValue(fakeMembers) } },
        { provide: SettlementsService, useValue: fakeSettlementsService },
        { provide: Auth, useValue: { currentUser: { uid: 'u1' } } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SharedExpenseForm);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('fixedGroupId', 'group1');
    fixture.componentRef.setInput('initialValue', existingMovement);
    fixture.detectChanges();
    await flushMicrotasks();
    fixture.detectChanges();
  });

  it('is editable (no longer locked just for having an installment plan)', () => {
    expect(component.readOnly()).toBe(false);
  });

  it('pre-checks "¿Pagar a cuotas?" and pre-fills the count from the existing plan', () => {
    expect(component.form.controls.payInInstallments.value).toBe(true);
    expect(component.form.controls.installmentCount.value).toBe(2);
    expect(component.installmentMode()).toBe('fixed');
  });

  it('pre-fills the per-cuota inputs with the real saved amounts, not a default equal split', () => {
    expect(component.installmentInputs.at(0).value).toBe(25);
    expect(component.installmentInputs.at(1).value).toBe(25);
  });

  it('resaving without changing anything regenerates the exact same plan', async () => {
    await component.submit();

    expect(updateShared).toHaveBeenCalledWith(
      'm1',
      existingMovement,
      expect.objectContaining({
        installments: [
          expect.objectContaining({ amount: 25, status: 'pending' }),
          expect.objectContaining({ amount: 25, status: 'pending' }),
        ],
      })
    );
  });

  it('changing the amount regenerates the plan with the new debt, split evenly across the same cuotas', async () => {
    component.form.controls.amount.setValue(200); // antes 100 -> deuda de u2 pasa de 50 a 100
    fixture.detectChanges();
    // El usuario no tocó los montos por cuota a mano todavía, pero cambió
    // el total -> al guardar, se regenera desde cero con la nueva deuda.
    component.selectInstallmentMode('equal');
    fixture.detectChanges();

    await component.submit();

    expect(updateShared).toHaveBeenCalledWith(
      'm1',
      existingMovement,
      expect.objectContaining({
        installments: [expect.objectContaining({ amount: 50 }), expect.objectContaining({ amount: 50 })],
      })
    );
  });

  it('changing the number of cuotas regenerates with a fresh default distribution, not the stale amounts', () => {
    component.form.controls.installmentCount.setValue(4);
    fixture.detectChanges();

    // 4 cuotas nuevas, reparto por defecto de 50/4 = 12.5 c/u (no quedan
    // los 2 valores de 25 del plan original, que era para solo 2 cuotas).
    expect(component.installmentInputs.length).toBe(4);
    expect(component.installmentInputs.controls.map((c) => c.value)).toEqual([12.5, 12.5, 12.5, 12.5]);
  });

  it('due dates are recalculated from the (possibly new) expense date, not shifted from the old dates', async () => {
    component.form.controls.date.setValue('2026-05-15');
    fixture.detectChanges();

    await component.submit();

    const [, , value] = updateShared.mock.calls[0];
    const installments = value.installments as { dueDate: { toDate: () => Date } }[];
    expect(installments[0].dueDate.toDate().getMonth()).toBe(4); // mayo
    expect(installments[0].dueDate.toDate().getDate()).toBe(15);
    expect(installments[1].dueDate.toDate().getMonth()).toBe(5); // junio
  });

  it('unchecking "¿Pagar a cuotas?" removes the plan entirely on save', async () => {
    component.form.controls.payInInstallments.setValue(false);

    await component.submit();

    expect(updateShared).toHaveBeenCalledWith('m1', existingMovement, expect.objectContaining({ installments: null }));
  });

  it('shows the pre-existing plan in the breakdown UI', () => {
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('¿Pagar a cuotas?');
    expect(text).toContain('Cuota 1');
    expect(text).toContain('Cuota 2');
  });
});

// Auditoría de punta a punta de monto -> división -> debtorAmount() ->
// cuotas (reportado como "las cuotas deben sumar $0" al editar un gasto
// con división 'fijo') — simula la secuencia real de un usuario tocando
// estos campos EN ORDEN, no solo funciones aisladas (ver diagnóstico en
// la conversación: computeSplits() leía splitInputs.controls directo,
// sin pasar por splitInputsValue() — su propio toSignal reactivo, ya
// usado por splitSum()/splitMismatch() pero NO por debtorAmount()). El
// fixture replica el reporte exacto: división 'fijo' (no 'equal', el
// único caso donde computeSplits() cae en esa rama no reactiva).
describe('SharedExpenseForm — cadena reactiva monto → división → cuotas (regresión)', () => {
  let component: SharedExpenseForm;
  let fixture: ComponentFixture<SharedExpenseForm>;
  let updateShared: ReturnType<typeof vi.fn>;

  const existingFixedMovement = {
    id: 'm1',
    uid: 'u1',
    categoryId: 'cat-expense',
    categoryName: 'Comida',
    categoryIcon: '🍔',
    type: 'expense' as const,
    amount: 500000,
    date: { toDate: () => new Date('2026-03-01'), toMillis: () => new Date('2026-03-01').getTime() } as never,
    note: '',
    groupId: 'group1',
    paidBy: 'u1',
    splitType: 'fixed' as const,
    splits: [
      { uid: 'u1', amount: 250000, settled: false },
      { uid: 'u2', amount: 250000, settled: false },
    ],
    accountId: 'acc1',
    installments: [
      { dueDate: { toDate: () => new Date('2026-04-01') } as never, amount: 125000, status: 'pending' as const },
      { dueDate: { toDate: () => new Date('2026-05-01') } as never, amount: 125000, status: 'pending' as const },
    ],
  };

  beforeEach(async () => {
    updateShared = vi.fn().mockResolvedValue(undefined);

    await TestBed.configureTestingModule({
      imports: [SharedExpenseForm],
      providers: [
        { provide: MovementsService, useValue: { updateShared, removeShared: vi.fn(), createShared: vi.fn() } },
        { provide: AttachmentsService, useValue: fakeAttachmentsService },
        { provide: ReceiptReader, useValue: fakeReceiptReader },
        { provide: Accounts, useValue: { accounts$: of(fakeAccounts) } },
        { provide: Categories, useValue: { categories$: of(fakeCategories) } },
        { provide: GroupsService, useValue: { getMemberProfiles: vi.fn().mockResolvedValue(fakeMembers) } },
        { provide: SettlementsService, useValue: fakeSettlementsService },
        { provide: Auth, useValue: { currentUser: { uid: 'u1' } } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SharedExpenseForm);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('fixedGroupId', 'group1');
    fixture.componentRef.setInput('initialValue', existingFixedMovement);
    fixture.detectChanges();
    await flushMicrotasks();
    fixture.detectChanges();
  });

  it('REGRESIÓN: al editar, debtorAmount() refleja la división "fijo" real (250.000) desde el primer render, no se queda en $0', () => {
    expect(component.debtorAmount()).toBe(250000);
  });

  it('REGRESIÓN: no dispara un falso mismatch de cuotas al abrir (250.000 contra 250.000 ya guardados)', () => {
    expect(component.installmentSum()).toBe(250000);
    expect(component.installmentMismatch()).toBe(false);
  });

  // 1. Monto total -> ¿se actualizan split/debtorAmount()/cuotas los tres a
  // la vez? Para división 'fijo' los montos por persona son literales (no
  // se re-escalan solos, por diseño) — lo que importa es que debtorAmount()
  // no se quede pegado en un valor viejo, y acá queda confirmado que sigue
  // reflejando la división vigente tras el cambio.
  it('1. cambiar el monto total mantiene debtorAmount() sincronizado con la división "fijo" vigente', () => {
    component.form.controls.amount.setValue(600000);
    fixture.detectChanges();

    expect(component.debtorAmount()).toBe(250000);
  });

  // 2. Alternar tipos de división: 'fijo' (preserva los 250.000/250.000
  // guardados) -> 'porcentaje' (reparto por defecto, 50%/50% de 500.000)
  // -> de vuelta a 'fijo' (coincide con el original -> se restauran los
  // montos reales). El encabezado y la validación deben usar siempre el
  // mismo número, sin desfasarse como en el reporte.
  it('2. alternar entre tipos de división mantiene debtorAmount() y la validación de cuotas sincronizados, sin desfases', () => {
    component.selectSplitType('percentage');
    fixture.detectChanges();
    expect(component.debtorAmount()).toBe(250000); // 50% por defecto de 500.000

    component.selectSplitType('fixed');
    fixture.detectChanges();
    expect(component.debtorAmount()).toBe(250000); // vuelve a los montos reales guardados
    expect(component.installmentMismatch()).toBe(false);
  });

  it('3. cambiar el número de cuotas regenera valores y fechas frescos, sin residuo del cálculo anterior', () => {
    component.form.controls.date.setValue('2026-03-01'); // explícito, no depende del prefill desde Timestamp
    component.form.controls.installmentCount.setValue(5);
    fixture.detectChanges();

    expect(component.installmentInputs.length).toBe(5);
    // 250.000 / 5 = 50.000 c/u -- reparto fresco, no quedan los 2 valores
    // de 125.000 del plan original (que era para 2 cuotas).
    expect(component.installmentInputs.controls.map((c) => c.value)).toEqual([50000, 50000, 50000, 50000, 50000]);
    const preview = component.installmentPreview();
    expect(preview[0].dueDate.getMonth()).toBe(2); // marzo
    expect(preview[4].dueDate.getMonth()).toBe(6); // julio (marzo + 4)
  });

  // 4. Partes iguales <-> Valor fijo por cuota, con un conteo (3) que ya NO
  // coincide con el plan original (2) -- fuerza la rama que depende de
  // debtorAmount() en vez de reusar los montos guardados, para que la
  // prueba discrimine de verdad si debtorAmount() está al día o pegado.
  it('4. alternar "Partes iguales" <-> "Valor fijo por cuota" recalcula de inmediato con el monto correcto, sin tocar otro campo', () => {
    component.form.controls.installmentCount.setValue(3);
    fixture.detectChanges();

    component.selectInstallmentMode('equal');
    fixture.detectChanges();
    expect(component.installmentPreview().map((i) => i.amount)).toEqual([83333.34, 83333.33, 83333.33]);

    component.selectInstallmentMode('fixed');
    fixture.detectChanges();
    expect(component.installmentInputs.controls.map((c) => c.value)).toEqual([83333.33, 83333.33, 83333.33]);
  });

  it('guardar sin tocar nada regenera el mismo plan (250.000 repartidos en las mismas 2 cuotas)', async () => {
    await component.submit();

    expect(updateShared).toHaveBeenCalledWith(
      'm1',
      existingFixedMovement,
      expect.objectContaining({
        installments: [
          expect.objectContaining({ amount: 125000, status: 'pending' }),
          expect.objectContaining({ amount: 125000, status: 'pending' }),
        ],
      })
    );
  });
});

// Si el grupo creció a 3+ miembros DESPUÉS de crear un plan de cuotas (solo
// válido para grupos de 2), la sección deja de ofrecerse — pero el plan ya
// guardado no se debe borrar solo porque el usuario edite otro campo.
describe('SharedExpenseForm editing a movement whose group grew beyond 2 members', () => {
  let component: SharedExpenseForm;
  let fixture: ComponentFixture<SharedExpenseForm>;
  let updateShared: ReturnType<typeof vi.fn>;

  const threeMembers = [
    ...fakeMembers,
    { uid: 'u3', displayName: 'Beto', email: 'beto@example.com', photoURL: '' },
  ];
  const existingMovement = {
    id: 'm1',
    uid: 'u1',
    categoryId: 'cat-expense',
    type: 'expense' as const,
    amount: 100,
    date: { toDate: () => new Date('2026-03-01'), toMillis: () => new Date('2026-03-01').getTime() } as never,
    note: '',
    groupId: 'group1',
    paidBy: 'u1',
    splitType: 'equal' as const,
    splits: [
      { uid: 'u1', amount: 50, settled: false },
      { uid: 'u2', amount: 50, settled: false },
    ],
    accountId: 'acc1',
    installments: [
      { dueDate: { toDate: () => new Date('2026-03-01') } as never, amount: 25, status: 'pending' as const },
      { dueDate: { toDate: () => new Date('2026-04-01') } as never, amount: 25, status: 'pending' as const },
    ],
  };

  beforeEach(async () => {
    updateShared = vi.fn().mockResolvedValue(undefined);

    await TestBed.configureTestingModule({
      imports: [SharedExpenseForm],
      providers: [
        { provide: MovementsService, useValue: { updateShared, removeShared: vi.fn(), createShared: vi.fn() } },
        { provide: AttachmentsService, useValue: fakeAttachmentsService },
        { provide: ReceiptReader, useValue: fakeReceiptReader },
        { provide: Accounts, useValue: { accounts$: of(fakeAccounts) } },
        { provide: Categories, useValue: { categories$: of(fakeCategories) } },
        { provide: GroupsService, useValue: { getMemberProfiles: vi.fn().mockResolvedValue(threeMembers) } },
        { provide: SettlementsService, useValue: fakeSettlementsService },
        { provide: Auth, useValue: { currentUser: { uid: 'u1' } } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SharedExpenseForm);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('fixedGroupId', 'group1');
    fixture.componentRef.setInput('initialValue', existingMovement);
    fixture.detectChanges();
    await flushMicrotasks();
    fixture.detectChanges();
  });

  it('hides the cuotas section (not a 2-member group anymore)', () => {
    expect(component.showInstallmentOption()).toBe(false);
    expect(fixture.nativeElement.textContent).not.toContain('¿Pagar a cuotas?');
  });

  it('preserves the existing plan untouched when saving an unrelated change', async () => {
    component.form.controls.note.setValue('nota nueva, nada que ver con cuotas');

    await component.submit();

    expect(updateShared).toHaveBeenCalledWith(
      'm1',
      existingMovement,
      expect.objectContaining({ installments: existingMovement.installments, note: 'nota nueva, nada que ver con cuotas' })
    );
  });
});

describe('SharedExpenseForm in edit mode with a non-equal split (Fase 10)', () => {
  let component: SharedExpenseForm;
  let fixture: ComponentFixture<SharedExpenseForm>;

  const existingPercentageMovement = {
    id: 'm1',
    uid: 'u1',
    categoryId: 'cat-expense',
    categoryName: 'Comida',
    categoryIcon: '🍔',
    type: 'expense' as const,
    amount: 100,
    date: { toDate: () => new Date('2026-03-01'), toMillis: () => new Date('2026-03-01').getTime() } as never,
    note: '',
    groupId: 'group1',
    paidBy: 'u1',
    splitType: 'percentage' as const,
    splits: [
      { uid: 'u1', amount: 70, settled: false },
      { uid: 'u2', amount: 30, settled: false },
    ],
    accountId: 'acc1',
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SharedExpenseForm],
      providers: [
        { provide: MovementsService, useValue: { updateShared: vi.fn(), removeShared: vi.fn(), createShared: vi.fn() } },
        { provide: AttachmentsService, useValue: fakeAttachmentsService },
        { provide: ReceiptReader, useValue: fakeReceiptReader },
        { provide: Accounts, useValue: { accounts$: of(fakeAccounts) } },
        { provide: Categories, useValue: { categories$: of(fakeCategories) } },
        { provide: GroupsService, useValue: { getMemberProfiles: vi.fn().mockResolvedValue(fakeMembers) } },
        { provide: SettlementsService, useValue: fakeSettlementsService },
        { provide: Auth, useValue: { currentUser: { uid: 'u1' } } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SharedExpenseForm);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('fixedGroupId', 'group1');
    fixture.componentRef.setInput('initialValue', existingPercentageMovement);
    fixture.detectChanges();
    await flushMicrotasks();
    fixture.detectChanges();
  });

  it('seeds the percentage inputs from the saved splits instead of the default even distribution', () => {
    expect(component.splitTypeValue()).toBe('percentage');
    expect(component.splitInputs.at(0).controls.value.value).toBe(70);
    expect(component.splitInputs.at(1).controls.value.value).toBe(30);
    expect(component.splitMismatch()).toBe(false);
  });
});

// Ajuste de UX (ronda posterior a Fase 10): GroupActivity ahora abre este
// modal para CUALQUIER miembro que toque la fila, sin filtrar por quién la
// creó — el guard vive acá. "No es mío" -> solo lectura, sin mensaje
// especial (a diferencia de "está bloqueado", que sí lo tiene).
describe('SharedExpenseForm viewed by someone who did not register it (read-only)', () => {
  let component: SharedExpenseForm;
  let fixture: ComponentFixture<SharedExpenseForm>;

  const existingMovement = {
    id: 'm1',
    uid: 'u2', // lo registró Ana, no Diego (currentUid: 'u1')
    categoryId: 'cat-expense',
    categoryName: 'Comida',
    categoryIcon: '🍔',
    type: 'expense' as const,
    amount: 100,
    date: { toDate: () => new Date('2026-03-01'), toMillis: () => new Date('2026-03-01').getTime() } as never,
    note: 'Cena',
    groupId: 'group1',
    paidBy: 'u2',
    splitType: 'equal' as const,
    splits: [
      { uid: 'u1', amount: 50, settled: false },
      { uid: 'u2', amount: 50, settled: false },
    ],
    accountId: null,
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SharedExpenseForm],
      providers: [
        { provide: MovementsService, useValue: { updateShared: vi.fn(), removeShared: vi.fn(), createShared: vi.fn() } },
        { provide: AttachmentsService, useValue: fakeAttachmentsService },
        { provide: ReceiptReader, useValue: fakeReceiptReader },
        { provide: Accounts, useValue: { accounts$: of(fakeAccounts) } },
        { provide: Categories, useValue: { categories$: of(fakeCategories) } },
        { provide: GroupsService, useValue: { getMemberProfiles: vi.fn().mockResolvedValue(fakeMembers) } },
        { provide: SettlementsService, useValue: fakeSettlementsService },
        { provide: Auth, useValue: { currentUser: { uid: 'u1' } } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SharedExpenseForm);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('fixedGroupId', 'group1');
    fixture.componentRef.setInput('initialValue', existingMovement);
    fixture.detectChanges();
    await flushMicrotasks();
    fixture.detectChanges();
  });

  it('readOnly() is true, isLocked() is false, and there is no delete section', () => {
    expect(component.readOnly()).toBe(true);
    expect(component.isLocked()).toBe(false);
    expect(component.showDangerZone()).toBe(false);
    expect(fixture.nativeElement.textContent).not.toContain('Zona de peligro');
  });

  it('shows no lock message (that one is reserved for the settlement guard)', () => {
    expect(fixture.nativeElement.textContent).not.toContain('ya hay un saldo relacionado');
  });

  it('disables the whole reactive form', () => {
    expect(component.form.disabled).toBe(true);
  });

  it('hides the submit button entirely', () => {
    expect(fixture.nativeElement.querySelector('button[type="submit"]')).toBeNull();
  });

  it('disables the paidBy selector buttons', () => {
    const personButtons: HTMLButtonElement[] = Array.from(
      fixture.nativeElement.querySelectorAll('.mfx-shared-expense-form__person')
    );
    expect(personButtons.length).toBeGreaterThan(0);
    expect(personButtons.every((btn) => btn.disabled)).toBe(true);
  });

  it('publishes readOnly() into SharedExpenseFormState so Shell can title the modal correctly', () => {
    expect(TestBed.inject(SharedExpenseFormState).readOnly()).toBe(true);
  });

  it('submit() is a no-op even if called directly', async () => {
    const updateShared = TestBed.inject(MovementsService).updateShared;
    await component.submit();
    expect(updateShared).not.toHaveBeenCalled();
  });

  it('remove() is a no-op even if called directly', async () => {
    const removeShared = TestBed.inject(MovementsService).removeShared;
    await component.remove();
    expect(removeShared).not.toHaveBeenCalled();
  });

  it('readOnlyInstallments() is null — this gasto never had a cuota plan', () => {
    expect(component.readOnlyInstallments()).toBeNull();
    expect(fixture.nativeElement.querySelector('mfx-installment-row')).toBeNull();
  });

  it('the attachment picker never shows the replace/remove affordance for a read-only viewer', () => {
    expect(fixture.nativeElement.querySelector('.mfx-attachment-picker__options-trigger')).toBeNull();
  });
});

describe('SharedExpenseForm locked by a later settlement (even for the creator)', () => {
  let component: SharedExpenseForm;
  let fixture: ComponentFixture<SharedExpenseForm>;

  const existingMovement = {
    id: 'm1',
    uid: 'u1', // Diego SÍ lo registró...
    categoryId: 'cat-expense',
    categoryName: 'Comida',
    categoryIcon: '🍔',
    type: 'expense' as const,
    amount: 100,
    date: { toDate: () => new Date('2026-02-10'), toMillis: () => new Date('2026-02-10').getTime() } as never,
    note: '',
    groupId: 'group1',
    paidBy: 'u1',
    splitType: 'equal' as const,
    splits: [
      { uid: 'u1', amount: 50, settled: false },
      { uid: 'u2', amount: 50, settled: false },
    ],
    accountId: 'acc1',
  };
  // ...pero ya hay un settlement posterior entre los involucrados.
  const lockingSettlement = {
    id: 's1',
    groupId: 'group1',
    fromUid: 'u2',
    toUid: 'u1',
    amount: 50,
    date: { toDate: () => new Date('2026-02-15'), toMillis: () => new Date('2026-02-15').getTime() } as never,
    note: '',
    linkedMovementId: null,
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SharedExpenseForm],
      providers: [
        { provide: MovementsService, useValue: { updateShared: vi.fn(), removeShared: vi.fn(), createShared: vi.fn() } },
        { provide: AttachmentsService, useValue: fakeAttachmentsService },
        { provide: ReceiptReader, useValue: fakeReceiptReader },
        { provide: Accounts, useValue: { accounts$: of(fakeAccounts) } },
        { provide: Categories, useValue: { categories$: of(fakeCategories) } },
        { provide: GroupsService, useValue: { getMemberProfiles: vi.fn().mockResolvedValue(fakeMembers) } },
        { provide: SettlementsService, useValue: { settlements$: () => of([lockingSettlement]) } },
        { provide: Auth, useValue: { currentUser: { uid: 'u1' } } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SharedExpenseForm);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('fixedGroupId', 'group1');
    fixture.componentRef.setInput('initialValue', existingMovement);
    fixture.detectChanges();
    await flushMicrotasks();
    fixture.detectChanges();
  });

  it('isLocked() and readOnly() are both true, even though the viewer is the creator', () => {
    expect(component.isLocked()).toBe(true);
    expect(component.readOnly()).toBe(true);
    expect(component.showDangerZone()).toBe(false);
  });

  it('shows the lock message and hides "Zona de peligro"', () => {
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('No se puede modificar, ya hay un saldo relacionado marcado como pagado.');
    expect(text).not.toContain('Zona de peligro');
  });

  it('hides the submit button', () => {
    expect(fixture.nativeElement.querySelector('button[type="submit"]')).toBeNull();
  });
});

// Ajuste posterior: antes, un gasto bloqueado CON cuotas seguía mostrando el
// formulario editable (con members() todavía sin cargar, produciendo un
// "$0" pasajero en "¿Cómo se divide la deuda?") — ahora, bloqueado + con
// cuotas muestra el mensaje de bloqueo y el plan en modo solo lectura, sin
// el formulario editable ni su validación de descuadre.
describe('SharedExpenseForm locked with an installment plan (read-only cuotas view)', () => {
  let fixture: ComponentFixture<SharedExpenseForm>;

  const existingMovement = {
    id: 'm1',
    uid: 'u1',
    categoryId: 'cat-expense',
    categoryName: 'Comida',
    categoryIcon: '🍔',
    type: 'expense' as const,
    amount: 100,
    date: { toDate: () => new Date('2026-02-10'), toMillis: () => new Date('2026-02-10').getTime() } as never,
    note: '',
    groupId: 'group1',
    paidBy: 'u1',
    splitType: 'equal' as const,
    splits: [
      { uid: 'u1', amount: 50, settled: false },
      { uid: 'u2', amount: 50, settled: false },
    ],
    accountId: 'acc1',
    installments: [
      { dueDate: { toDate: () => new Date('2026-02-10') } as never, amount: 25, status: 'paid' as const },
      { dueDate: { toDate: () => new Date('2026-03-10') } as never, amount: 25, status: 'pending' as const },
    ],
  };
  const lockingSettlement = {
    id: 's1',
    groupId: 'group1',
    fromUid: 'u2',
    toUid: 'u1',
    amount: 25,
    date: { toDate: () => new Date('2026-02-10'), toMillis: () => new Date('2026-02-10').getTime() } as never,
    note: '',
    linkedMovementId: null,
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SharedExpenseForm],
      providers: [
        { provide: MovementsService, useValue: { updateShared: vi.fn(), removeShared: vi.fn(), createShared: vi.fn() } },
        { provide: AttachmentsService, useValue: fakeAttachmentsService },
        { provide: ReceiptReader, useValue: fakeReceiptReader },
        { provide: Accounts, useValue: { accounts$: of(fakeAccounts) } },
        { provide: Categories, useValue: { categories$: of(fakeCategories) } },
        { provide: GroupsService, useValue: { getMemberProfiles: vi.fn().mockResolvedValue(fakeMembers) } },
        { provide: SettlementsService, useValue: { settlements$: () => of([lockingSettlement]) } },
        { provide: Auth, useValue: { currentUser: { uid: 'u1' } } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SharedExpenseForm);
    fixture.componentRef.setInput('fixedGroupId', 'group1');
    fixture.componentRef.setInput('initialValue', existingMovement);
    fixture.detectChanges();
    await flushMicrotasks();
    fixture.detectChanges();
  });

  it('never shows the editable "¿Pagar a cuotas?" form or its debt header', () => {
    const text = fixture.nativeElement.textContent;
    expect(text).not.toContain('¿Pagar a cuotas?');
    expect(text).not.toContain('¿Cómo se divide la deuda');
  });

  it('shows the lock message and the read-only installment plan', () => {
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('No se puede modificar, ya hay un saldo relacionado marcado como pagado.');
    expect(text).toContain('Cuotas');

    const rows = fixture.nativeElement.querySelectorAll('mfx-installment-row');
    expect(rows.length).toBe(2);
  });

  it('renders every cuota as read-only, with no "Marcar como pagada" button at all (that lives in GroupActivity)', () => {
    expect(fixture.nativeElement.querySelector('.mfx-installment-row__pay-btn')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('✓ Pagada');
  });

  it('readOnlyInstallments() exposes the plan straight from initialValue(), no live recalculation involved', () => {
    expect(fixture.componentInstance.readOnlyInstallments()).toEqual(existingMovement.installments);
  });
});
