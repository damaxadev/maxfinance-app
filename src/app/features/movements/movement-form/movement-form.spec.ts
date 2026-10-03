import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { Accounts } from '../../../core/accounts/accounts';
import { AttachmentsService } from '../../../core/attachments/attachments';
import { Categories } from '../../../core/categories/categories';
import { CategoryFormState } from '../../../core/category-form-state/category-form-state';
import { MovementsService } from '../../../core/movements/movements';
import { ReceiptReader } from '../../../core/receipt-reader/receipt-reader';
import { MovementForm } from './movement-form';
import type { PersonalMovement } from '../../../models/movement.model';

const { mockImpact } = vi.hoisted(() => ({
  mockImpact: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@capacitor/haptics', () => ({
  Haptics: { impact: mockImpact },
  ImpactStyle: { Light: 'LIGHT', Medium: 'MEDIUM', Heavy: 'HEAVY' },
}));

const fakeAccounts = [
  { id: 'acc1', uid: 'u1', name: 'Efectivo', type: 'efectivo' as const, balance: 0, currency: 'COP' },
];
const fakeCategories = [
  { id: 'cat-expense', uid: null, name: 'Comida', icon: '🍔', type: 'expense' as const },
  { id: 'cat-income', uid: null, name: 'Salario', icon: '💼', type: 'income' as const },
];

describe('MovementForm', () => {
  let component: MovementForm;
  let fixture: ComponentFixture<MovementForm>;
  let create: ReturnType<typeof vi.fn>;
  let update: ReturnType<typeof vi.fn>;
  let remove: ReturnType<typeof vi.fn>;
  let attachFile: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.mocked(FirebaseAuthentication.getCurrentUser).mockReset().mockResolvedValue({ user: null });
    vi.mocked(FirebaseAuthentication.addListener).mockReset().mockResolvedValue({ remove: vi.fn() });
    mockImpact.mockClear();
    create = vi.fn().mockResolvedValue('mov1');
    update = vi.fn().mockResolvedValue(undefined);
    remove = vi.fn().mockResolvedValue(undefined);
    attachFile = vi.fn().mockResolvedValue(undefined);

    await TestBed.configureTestingModule({
      imports: [MovementForm],
      providers: [
        { provide: MovementsService, useValue: { create, update, remove, attachFile, removeAttachment: vi.fn() } },
        { provide: Accounts, useValue: { accounts$: of(fakeAccounts) } },
        { provide: Categories, useValue: { categories$: of(fakeCategories) } },
        // mfx-attachment-picker (primer campo del form) inyecta esto
        // directo — se mockea para no depender de la instancia real, que
        // a su vez necesitaría Storage (ver attachments.spec.ts).
        { provide: AttachmentsService, useValue: { getDownloadUrl: vi.fn().mockResolvedValue(null) } },
        // ReceiptReader inyecta Auth -> Firestore — se mockea para no
        // necesitar ninguno de los dos (ver receipt-reader.spec.ts para el
        // servicio probado a fondo aparte).
        { provide: ReceiptReader, useValue: { extract: vi.fn() } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(MovementForm);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('selectType() switches the type and triggers a light haptic', () => {
    component.selectType('income');

    expect(component.form.controls.type.value).toBe('income');
    expect(mockImpact).toHaveBeenCalledWith({ style: 'LIGHT' });
  });

  it('selectType() does nothing if the type is already active', () => {
    component.selectType('expense'); // ya es el valor por defecto

    expect(mockImpact).not.toHaveBeenCalled();
  });

  it('opens the category form when "+ Nueva categoría" is picked, without keeping it as the value', () => {
    const categoryFormState = TestBed.inject(CategoryFormState);

    component.form.controls.categoryId.setValue(component.newCategoryOption);
    fixture.detectChanges();

    expect(categoryFormState.request()).toEqual({ mode: 'create' });
    expect(component.form.controls.categoryId.value).toBe('');
  });

  it('auto-selects a category just created from its own selector, syncing the movement type', () => {
    const categoryFormState = TestBed.inject(CategoryFormState);

    categoryFormState.close({ id: 'cat-income', type: 'income' });
    fixture.detectChanges();

    expect(component.form.controls.type.value).toBe('income');
    expect(component.form.controls.categoryId.value).toBe('cat-income');
    expect(categoryFormState.lastSaved()).toBeNull();
  });

  it('filters categories by the selected type (defaults to expense)', () => {
    expect(component.filteredCategories().map((c) => c.id)).toEqual(['cat-expense']);
  });

  it('does NOT reactively clear categoryId when the type changes (validated at submit time instead)', () => {
    // Regresión: un effect que limpiaba categoryId al cambiar filteredCategories()
    // corría antes de que categories() tuviera datos reales y borraba valores
    // válidos (p. ej. al editar un movimiento existente). Ahora el control no
    // se toca reactivamente; solo submit() decide si el valor es válido.
    component.form.controls.categoryId.setValue('cat-expense');

    component.form.controls.type.setValue('income');
    fixture.detectChanges();

    expect(component.filteredCategories().map((c) => c.id)).toEqual(['cat-income']);
    expect(component.form.controls.categoryId.value).toBe('cat-expense');
  });

  it('does not submit an invalid form', async () => {
    await component.submit();
    expect(create).not.toHaveBeenCalled();
  });

  it('shows every required-field error at once after submitting an empty form (markAllAsTouched)', async () => {
    // amount usa null (no 0) para simular el campo realmente vacío: así lo
    // deja NumberValueAccessor cuando el usuario borra el input, y es lo
    // único que dispara Validators.required en vez de Validators.min.
    component.form.patchValue({ amount: null as unknown as number, accountId: '', categoryId: '', date: '' });

    await component.submit();
    fixture.detectChanges();

    const errors = Array.from<HTMLElement>(fixture.nativeElement.querySelectorAll('.mfx-form__error')).map((el) =>
      el.textContent?.trim()
    );

    expect(errors).toContain('El monto es obligatorio.');
    expect(errors).toContain('Selecciona una cuenta.');
    expect(errors).toContain('Selecciona una categoría.');
    expect(errors).toContain('La fecha es obligatoria.');
  });

  it('shows "monto debe ser mayor a 0" when amount is 0 or negative but touched', async () => {
    component.form.patchValue({ amount: -5 });
    component.form.controls.amount.markAsTouched();
    fixture.detectChanges();

    const errors = Array.from<HTMLElement>(fixture.nativeElement.querySelectorAll('.mfx-form__error')).map((el) =>
      el.textContent?.trim()
    );

    expect(errors).toContain('El monto debe ser mayor a 0.');
  });

  it('submit() rejects a categoryId that no longer matches the current type, with a visible error, without touching the control', async () => {
    component.form.setValue({
      type: 'income',
      amount: 10,
      accountId: 'acc1',
      categoryId: 'cat-expense', // ya no aplica al tipo income
      date: '2026-03-10',
      note: '',
    });

    await component.submit();

    expect(create).not.toHaveBeenCalled();
    expect(component.categoryError()).toBe('La categoría seleccionada no es válida para este tipo, elige otra.');
    expect(component.form.controls.categoryId.value).toBe('cat-expense');
  });

  it('creates a movement with the selected date and the current time of day (not midnight)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 10, 14, 30, 15));
    const emitted: void[] = [];
    component.saved.subscribe(() => emitted.push(undefined));

    component.form.setValue({
      type: 'expense',
      amount: 45.5,
      accountId: 'acc1',
      categoryId: 'cat-expense',
      date: '2026-03-10',
      note: 'Almuerzo',
    });

    await component.submit();
    vi.useRealTimers();

    expect(create).toHaveBeenCalledTimes(1);
    const [value] = create.mock.calls[0];
    expect(value.amount).toBe(45.5);
    expect(value.accountId).toBe('acc1');
    expect(value.date.getFullYear()).toBe(2026);
    expect(value.date.getMonth()).toBe(2);
    expect(value.date.getDate()).toBe(10);
    expect(value.date.getHours()).toBe(14);
    expect(value.date.getMinutes()).toBe(30);
    expect(value.date.getSeconds()).toBe(15);
    expect(emitted.length).toBe(1);
  });

  it('keeps the current time of day even when the date is changed to a past date', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 15, 9, 5, 0));

    component.form.setValue({
      type: 'expense',
      amount: 20,
      accountId: 'acc1',
      categoryId: 'cat-expense',
      date: '2026-03-01', // fecha pasada, elegida a propósito
      note: '',
    });

    await component.submit();
    vi.useRealTimers();

    const [value] = create.mock.calls[0];
    expect(value.date.getDate()).toBe(1);
    expect(value.date.getHours()).toBe(9);
    expect(value.date.getMinutes()).toBe(5);
  });

  it('creates without a groupId by default (plain personal movement)', async () => {
    component.form.setValue({
      type: 'expense',
      amount: 10,
      accountId: 'acc1',
      categoryId: 'cat-expense',
      date: '2026-03-10',
      note: '',
    });

    await component.submit();

    expect(create).toHaveBeenCalledWith(expect.anything(), null);
  });

  it('passes the groupId input through to create() (expense inside a personal group, Fase 9)', async () => {
    fixture.componentRef.setInput('groupId', 'personal-group-1');
    component.form.setValue({
      type: 'expense',
      amount: 10,
      accountId: 'acc1',
      categoryId: 'cat-expense',
      date: '2026-03-10',
      note: '',
    });

    await component.submit();

    expect(create).toHaveBeenCalledWith(expect.anything(), 'personal-group-1');
  });

  describe('adjunto (mfx-attachment-picker, primer campo)', () => {
    it('renders the picker as the first element inside the form', () => {
      const form = fixture.nativeElement.querySelector('form');
      expect(form.firstElementChild.tagName.toLowerCase()).toBe('mfx-attachment-picker');
    });

    it('does not call attachFile() when nothing was attached', async () => {
      component.form.setValue({
        type: 'expense',
        amount: 10,
        accountId: 'acc1',
        categoryId: 'cat-expense',
        date: '2026-03-10',
        note: '',
      });

      await component.submit();

      expect(attachFile).not.toHaveBeenCalled();
    });

    it('uploads the pending attachment to the new movement id after creating it', async () => {
      const pending = { blob: new Blob(['x']), contentType: 'image/jpeg', fileName: 'recibo.jpg' };
      component.pendingAttachment.set(pending);
      component.form.setValue({
        type: 'expense',
        amount: 10,
        accountId: 'acc1',
        categoryId: 'cat-expense',
        date: '2026-03-10',
        note: '',
      });

      await component.submit();

      expect(create).toHaveBeenCalledTimes(1);
      expect(attachFile).toHaveBeenCalledWith('mov1', pending);
    });

    it('retrying after an attachment-upload failure does NOT re-create the movement', async () => {
      attachFile.mockRejectedValueOnce(new Error('network error'));
      component.pendingAttachment.set({ blob: new Blob(['x']), contentType: 'image/jpeg', fileName: 'a.jpg' });
      component.form.setValue({
        type: 'expense',
        amount: 10,
        accountId: 'acc1',
        categoryId: 'cat-expense',
        date: '2026-03-10',
        note: '',
      });

      await component.submit();
      fixture.detectChanges();
      expect(component.errorMessage()).toBe(
        'Guardamos el movimiento, pero no pudimos subir el archivo adjunto. Intenta de nuevo.'
      );
      expect(create).toHaveBeenCalledTimes(1);
      // El botón deja de decir "Agregar movimiento" — el reintento es
      // solo del adjunto, no debe sentirse como un segundo guardado.
      expect(fixture.nativeElement.querySelector('button[type="submit"]').textContent).toContain(
        'Reintentar subir adjunto'
      );

      const emitted: void[] = [];
      component.saved.subscribe(() => emitted.push(undefined));
      await component.submit(); // reintento — solo el adjunto

      expect(create).toHaveBeenCalledTimes(1); // no se repite
      expect(attachFile).toHaveBeenCalledTimes(2);
      expect(emitted.length).toBe(1);
    });
  });

  describe('lectura automática de recibos (ReceiptReader)', () => {
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

    function extractMock(): ReturnType<typeof vi.fn> {
      return TestBed.inject(ReceiptReader).extract as ReturnType<typeof vi.fn>;
    }

    it('does not call extract() when the attachment has no aiPreview', () => {
      component.onAttachmentReady({ blob: new Blob(['x']), contentType: 'image/jpeg', fileName: 'a.jpg' });

      expect(extractMock()).not.toHaveBeenCalled();
    });

    it('calls extract() with the aiPreview when present, toggling receiptReading() around it', async () => {
      let resolveExtract!: (value: unknown) => void;
      extractMock().mockReturnValue(new Promise((resolve) => (resolveExtract = resolve)));

      component.onAttachmentReady(pendingWithPreview());
      expect(component.receiptReading()).toBe(true);
      expect(extractMock()).toHaveBeenCalledWith(PREVIEW, { signal: expect.any(AbortSignal) });

      resolveExtract(HIGH_CONFIDENCE_RESULT);
      await Promise.resolve();
      await Promise.resolve();

      expect(component.receiptReading()).toBe(false);
    });

    it('patches amount/date/note/categoryId from a high-confidence result and marks them isAiFilled()', async () => {
      extractMock().mockResolvedValue(HIGH_CONFIDENCE_RESULT);

      component.onAttachmentReady(pendingWithPreview());
      await Promise.resolve();
      await Promise.resolve();

      expect(component.form.controls.amount.value).toBe(45000);
      expect(component.form.controls.date.value).toBe('2026-09-30');
      expect(component.form.controls.note.value).toBe('Supermercado La 14');
      expect(component.form.controls.categoryId.value).toBe('cat-expense'); // "Comida" matchea por substring/exacto
      expect(component.isAiFilled('amount')).toBe(true);
      expect(component.isAiFilled('date')).toBe(true);
      expect(component.isAiFilled('note')).toBe(true);
      expect(component.isAiFilled('categoryId')).toBe(true);
      expect(component.receiptNote()).toBeNull();
    });

    it('actually renders the ✨ badge in the DOM for each AI-filled field — not just the internal isAiFilled() flag', async () => {
      extractMock().mockResolvedValue(HIGH_CONFIDENCE_RESULT);

      component.onAttachmentReady(pendingWithPreview());
      await Promise.resolve();
      await Promise.resolve();
      fixture.detectChanges();

      const badges: HTMLElement[] = Array.from(
        fixture.nativeElement.querySelectorAll('.mfx-movement-form__ai-badge')
      );
      // amount, categoría, fecha, nota — exactamente esos 4 campos, nunca cuenta.
      expect(badges.length).toBe(4);
      for (const badge of badges) {
        expect(badge.textContent?.trim()).toBe('✨');
        expect(badge.title).toContain('IA');
      }
      // El de "Cuenta" nunca se completa por IA — su <label> no debe tener badge.
      const accountLabel = Array.from<HTMLElement>(fixture.nativeElement.querySelectorAll('label')).find((label) =>
        label.textContent?.trim().startsWith('Cuenta')
      );
      expect(accountLabel?.querySelector('.mfx-movement-form__ai-badge')).toBeNull();
    });

    it('never touches a field the user already edited manually (pristine check, field by field)', async () => {
      extractMock().mockResolvedValue(HIGH_CONFIDENCE_RESULT);
      // setValue() por sí solo NO marca dirty (eso solo pasa vía la
      // directiva [formControlName] ante un evento real del <input>) —
      // markAsDirty() es lo que replica de verdad "el usuario ya escribió
      // algo acá" a nivel de componente.
      component.form.controls.amount.setValue(999);
      component.form.controls.amount.markAsDirty();

      component.onAttachmentReady(pendingWithPreview());
      await Promise.resolve();
      await Promise.resolve();

      expect(component.form.controls.amount.value).toBe(999); // intacto
      expect(component.isAiFilled('amount')).toBe(false);
      expect(component.form.controls.date.value).toBe('2026-09-30'); // este sí, seguía pristine
    });

    it('does not auto-select a category when matchCategory() finds no confident match', async () => {
      extractMock().mockResolvedValue({ ...HIGH_CONFIDENCE_RESULT, suggestedCategory: 'Algo que no existe' });

      component.onAttachmentReady(pendingWithPreview());
      await Promise.resolve();
      await Promise.resolve();

      expect(component.form.controls.categoryId.value).toBe('');
      expect(component.isAiFilled('categoryId')).toBe(false);
    });

    it('confidence "low": patches nothing, shows the discreet note instead', async () => {
      extractMock().mockResolvedValue({ ...HIGH_CONFIDENCE_RESULT, confidence: 'low' as const });

      component.onAttachmentReady(pendingWithPreview());
      await Promise.resolve();
      await Promise.resolve();

      expect(component.form.controls.amount.value).toBe(0);
      expect(component.receiptNote()).toBe('No pudimos leer bien el recibo — completa los datos a mano.');
      expect(component.errorMessage()).toBeNull(); // nunca el mensaje rojo de guardado
    });

    it('a real failure (network/502) patches nothing and shows the discreet note, not errorMessage', async () => {
      extractMock().mockRejectedValue(new Error('No se pudo leer el recibo.'));

      component.onAttachmentReady(pendingWithPreview());
      await Promise.resolve();
      await Promise.resolve();

      expect(component.form.controls.amount.value).toBe(0);
      expect(component.receiptNote()).toBe('No pudimos leer el recibo automáticamente — completa los datos a mano.');
      expect(component.errorMessage()).toBeNull();
    });

    it('an AbortError (cancelled) patches nothing and shows no note at all — it was not a failure', async () => {
      extractMock().mockRejectedValue(new DOMException('aborted', 'AbortError'));

      component.onAttachmentReady(pendingWithPreview());
      await Promise.resolve();
      await Promise.resolve();

      expect(component.receiptNote()).toBeNull();
      expect(component.receiptReading()).toBe(false);
    });

    it('cancelReceiptRead() aborts the in-flight signal and resets the loading state', () => {
      extractMock().mockReturnValue(new Promise(() => {})); // nunca resuelve
      component.onAttachmentReady(pendingWithPreview());
      const [, options] = extractMock().mock.calls[0] as [unknown, { signal: AbortSignal }];

      component.cancelReceiptRead();

      expect(options.signal.aborted).toBe(true);
      expect(component.receiptReading()).toBe(false);
    });

    it('replacing the attachment while a read is in flight aborts the previous read before starting a new one', () => {
      extractMock().mockReturnValue(new Promise(() => {}));
      component.onAttachmentReady(pendingWithPreview());
      const [, firstOptions] = extractMock().mock.calls[0] as [unknown, { signal: AbortSignal }];

      component.onAttachmentReady(pendingWithPreview());

      expect(firstOptions.signal.aborted).toBe(true);
      expect(extractMock()).toHaveBeenCalledTimes(2);
    });

    it('isAiFilled() stops being true once the user changes a field away from what the IA put there', async () => {
      extractMock().mockResolvedValue(HIGH_CONFIDENCE_RESULT);
      component.onAttachmentReady(pendingWithPreview());
      await Promise.resolve();
      await Promise.resolve();
      expect(component.isAiFilled('amount')).toBe(true);

      component.form.controls.amount.setValue(123);

      expect(component.isAiFilled('amount')).toBe(false);
    });

    it('shows a "Cancelar" link while reading, which calls cancelReceiptRead()', () => {
      extractMock().mockReturnValue(new Promise(() => {}));
      component.onAttachmentReady(pendingWithPreview());
      fixture.detectChanges();

      const cancelLink: HTMLButtonElement = fixture.nativeElement.querySelector(
        '.mfx-movement-form__receipt-cancel'
      );
      expect(cancelLink).toBeTruthy();
      cancelLink.click();

      expect(component.receiptReading()).toBe(false);
    });
  });
});

describe('MovementForm while categories are still loading', () => {
  let component: MovementForm;
  let fixture: ComponentFixture<MovementForm>;
  let create: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.mocked(FirebaseAuthentication.getCurrentUser).mockReset().mockResolvedValue({ user: null });
    vi.mocked(FirebaseAuthentication.addListener).mockReset().mockResolvedValue({ remove: vi.fn() });
    create = vi.fn().mockResolvedValue(undefined);

    await TestBed.configureTestingModule({
      imports: [MovementForm],
      providers: [
        { provide: MovementsService, useValue: { create, update: vi.fn(), remove: vi.fn() } },
        { provide: Accounts, useValue: { accounts$: of(fakeAccounts) } },
        { provide: Categories, useValue: { categories$: of([]) } }, // todavía sin snapshot
        { provide: AttachmentsService, useValue: { getDownloadUrl: vi.fn().mockResolvedValue(null) } },
        { provide: ReceiptReader, useValue: { extract: vi.fn() } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(MovementForm);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('does not reject categoryId just because categories() is still empty — lets Validators.required decide', async () => {
    component.form.setValue({
      type: 'expense',
      amount: 10,
      accountId: 'acc1',
      categoryId: 'cat-not-loaded-yet',
      date: '2026-03-10',
      note: '',
    });

    await component.submit();

    expect(create).toHaveBeenCalledTimes(1);
    expect(component.categoryError()).toBeNull();
  });
});

describe('MovementForm without accounts', () => {
  let fixture: ComponentFixture<MovementForm>;

  beforeEach(async () => {
    vi.mocked(FirebaseAuthentication.getCurrentUser).mockReset().mockResolvedValue({ user: null });
    vi.mocked(FirebaseAuthentication.addListener).mockReset().mockResolvedValue({ remove: vi.fn() });

    await TestBed.configureTestingModule({
      imports: [MovementForm],
      providers: [
        { provide: MovementsService, useValue: { create: vi.fn(), update: vi.fn(), remove: vi.fn() } },
        { provide: Accounts, useValue: { accounts$: of([]) } },
        { provide: Categories, useValue: { categories$: of(fakeCategories) } },
        { provide: ReceiptReader, useValue: { extract: vi.fn() } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(MovementForm);
    fixture.detectChanges();
  });

  it('shows a message instead of the form', () => {
    expect(fixture.nativeElement.textContent).toContain('Primero crea una cuenta');
    expect(fixture.nativeElement.querySelector('form')).toBeNull();
  });
});

describe('MovementForm in edit mode', () => {
  let component: MovementForm;
  let fixture: ComponentFixture<MovementForm>;
  let update: ReturnType<typeof vi.fn>;
  let remove: ReturnType<typeof vi.fn>;
  let attachFile: ReturnType<typeof vi.fn>;
  let getDownloadUrl: ReturnType<typeof vi.fn>;

  const existingMovement = {
    id: 'mov1',
    uid: 'u1',
    accountId: 'acc1',
    categoryId: 'cat-expense',
    type: 'expense' as const,
    amount: 100,
    date: { toDate: () => new Date('2026-02-01T00:00:00') } as unknown as PersonalMovement['date'],
    note: 'Mercado',
    groupId: null,
    attachmentPath: 'movements/mov1/attachment',
    attachmentContentType: 'image/jpeg',
  };

  beforeEach(async () => {
    vi.mocked(FirebaseAuthentication.getCurrentUser).mockReset().mockResolvedValue({ user: null });
    vi.mocked(FirebaseAuthentication.addListener).mockReset().mockResolvedValue({ remove: vi.fn() });
    update = vi.fn().mockResolvedValue(undefined);
    remove = vi.fn().mockResolvedValue(undefined);
    attachFile = vi.fn().mockResolvedValue(undefined);
    getDownloadUrl = vi.fn().mockResolvedValue('https://example.com/attachment');

    await TestBed.configureTestingModule({
      imports: [MovementForm],
      providers: [
        {
          provide: MovementsService,
          useValue: { create: vi.fn(), update, remove, attachFile, removeAttachment: vi.fn() },
        },
        { provide: Accounts, useValue: { accounts$: of(fakeAccounts) } },
        { provide: Categories, useValue: { categories$: of(fakeCategories) } },
        { provide: AttachmentsService, useValue: { getDownloadUrl } },
        { provide: ReceiptReader, useValue: { extract: vi.fn() } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(MovementForm);
    fixture.componentRef.setInput('initialValue', existingMovement);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('pre-fills the form from the existing movement', () => {
    expect(component.form.getRawValue()).toEqual({
      type: 'expense',
      amount: 100,
      accountId: 'acc1',
      categoryId: 'cat-expense',
      date: '2026-02-01',
      note: 'Mercado',
    });
  });

  it('updates passing the previous movement and the new form value', async () => {
    component.form.patchValue({ amount: 120 });

    await component.submit();

    expect(update).toHaveBeenCalledTimes(1);
    const [id, previous, next] = update.mock.calls[0];
    expect(id).toBe('mov1');
    expect(previous).toBe(existingMovement);
    expect(next.amount).toBe(120);
  });

  it('deletes and emits deleted', async () => {
    const emitted: void[] = [];
    component.deleted.subscribe(() => emitted.push(undefined));

    await component.remove();

    expect(remove).toHaveBeenCalledWith('mov1', existingMovement);
    expect(emitted.length).toBe(1);
  });

  it('passes the existing attachment path/contentType through to the picker', async () => {
    await Promise.resolve();
    fixture.detectChanges();

    expect(getDownloadUrl).toHaveBeenCalledWith('movements/mov1/attachment');
    expect(fixture.nativeElement.textContent).toContain('Toca para verlo');
  });

  it('uploads a newly-picked attachment via attachFile() after update() succeeds', async () => {
    const pending = { blob: new Blob(['x']), contentType: 'image/jpeg', fileName: 'nuevo.jpg' };
    component.pendingAttachment.set(pending);

    await component.submit();

    expect(update).toHaveBeenCalledTimes(1);
    expect(attachFile).toHaveBeenCalledWith('mov1', pending);
  });

  it('retrying after an attachment-upload failure does NOT re-run update() (would double-adjust the account balance)', async () => {
    attachFile.mockRejectedValueOnce(new Error('network error'));
    component.pendingAttachment.set({ blob: new Blob(['x']), contentType: 'image/jpeg', fileName: 'a.jpg' });

    await component.submit();
    fixture.detectChanges();
    expect(update).toHaveBeenCalledTimes(1);
    expect(component.errorMessage()).toBe(
      'Guardamos el movimiento, pero no pudimos subir el archivo adjunto. Intenta de nuevo.'
    );
    expect(fixture.nativeElement.querySelector('button[type="submit"]').textContent).toContain(
      'Reintentar subir adjunto'
    );

    await component.submit(); // reintento

    expect(update).toHaveBeenCalledTimes(1); // no se repite
    expect(attachFile).toHaveBeenCalledTimes(2);
  });

  describe('eliminar el adjunto ya guardado (onExistingAttachmentRemoved)', () => {
    it('calls MovementsService.removeAttachment() and then hides the existing attachment from the picker', async () => {
      const removeAttachment = TestBed.inject(MovementsService).removeAttachment as ReturnType<typeof vi.fn>;
      removeAttachment.mockResolvedValue(undefined);

      await component.onExistingAttachmentRemoved();

      expect(removeAttachment).toHaveBeenCalledWith('mov1', 'movements/mov1/attachment');
      expect(component.existingAttachmentPath()).toBeNull();
      expect(component.removingAttachment()).toBe(false);
      expect(component.errorMessage()).toBeNull();
    });

    it('shows an error and keeps the attachment visible if removeAttachment() fails', async () => {
      const removeAttachment = TestBed.inject(MovementsService).removeAttachment as ReturnType<typeof vi.fn>;
      removeAttachment.mockRejectedValue(new Error('network error'));

      await component.onExistingAttachmentRemoved();

      expect(component.errorMessage()).toBe('No pudimos eliminar el adjunto. Intenta de nuevo.');
      expect(component.existingAttachmentPath()).toBe('movements/mov1/attachment');
      expect(component.removingAttachment()).toBe(false);
    });

    it('never calls extract() for an attachment removed/replaced in edit mode (AttachmentPicker never computes aiPreview there anyway)', () => {
      const extract = TestBed.inject(ReceiptReader).extract as ReturnType<typeof vi.fn>;

      component.onAttachmentReady({
        blob: new Blob(['x']),
        contentType: 'image/jpeg',
        fileName: 'nuevo.jpg',
        aiPreview: { base64: 'x', mediaType: 'image/jpeg' },
      });

      expect(extract).not.toHaveBeenCalled();
    });
  });
});

describe('MovementForm editing an income movement (regression: type differs from the form default)', () => {
  let component: MovementForm;
  let fixture: ComponentFixture<MovementForm>;
  let update: ReturnType<typeof vi.fn>;

  // El form arranca con type: 'expense' hardcodeado — editar un movimiento
  // de tipo 'income' es justo el escenario que disparaba la carrera entre
  // el (ya eliminado) effect reactivo y la carga async de categories().
  const existingIncomeMovement = {
    id: 'mov2',
    uid: 'u1',
    accountId: 'acc1',
    categoryId: 'cat-income',
    type: 'income' as const,
    amount: 500,
    date: { toDate: () => new Date('2026-02-01T00:00:00') } as unknown as PersonalMovement['date'],
    note: 'Salario',
    groupId: null,
  };

  beforeEach(async () => {
    vi.mocked(FirebaseAuthentication.getCurrentUser).mockReset().mockResolvedValue({ user: null });
    vi.mocked(FirebaseAuthentication.addListener).mockReset().mockResolvedValue({ remove: vi.fn() });
    update = vi.fn().mockResolvedValue(undefined);

    await TestBed.configureTestingModule({
      imports: [MovementForm],
      providers: [
        { provide: MovementsService, useValue: { create: vi.fn(), update, remove: vi.fn() } },
        { provide: Accounts, useValue: { accounts$: of(fakeAccounts) } },
        { provide: Categories, useValue: { categories$: of(fakeCategories) } },
        { provide: AttachmentsService, useValue: { getDownloadUrl: vi.fn().mockResolvedValue(null) } },
        { provide: ReceiptReader, useValue: { extract: vi.fn() } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(MovementForm);
    fixture.componentRef.setInput('initialValue', existingIncomeMovement);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('pre-fills categoryId from the existing income movement without wiping it', () => {
    expect(component.form.controls.type.value).toBe('income');
    expect(component.form.controls.categoryId.value).toBe('cat-income');
  });

  it('saves successfully — no silent no-op from an invalid categoryId', async () => {
    await component.submit();

    expect(update).toHaveBeenCalledTimes(1);
    expect(component.categoryError()).toBeNull();
    expect(component.errorMessage()).toBeNull();
  });
});
