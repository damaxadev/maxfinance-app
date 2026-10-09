import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { Accounts } from '../../../core/accounts/accounts';
import { Auth } from '../../../core/auth/auth';
import { AttachmentsService } from '../../../core/attachments/attachments';
import { GroupsService } from '../../../core/groups/groups';
import { ModalStack } from '../../../core/modal-stack/modal-stack';
import { MovementsService } from '../../../core/movements/movements';
import { SettlementsService } from '../../../core/settlements/settlements';
import { AbonoDetail } from './abono-detail';

function ts(date: string) {
  return { toDate: () => new Date(date), toMillis: () => new Date(date).getTime() } as never;
}

const fakeMembers = [
  { uid: 'u1', displayName: 'Diego', email: '', photoURL: '' },
  { uid: 'u2', displayName: 'Ana', email: '', photoURL: '' },
];
const fakeAccounts = [{ id: 'acc1', uid: 'u1', name: 'Efectivo', type: 'efectivo' as const, balance: 0, currency: 'COP' }];
// mfx-attachment-picker (dentro de "Comprobante") inyecta esto directo —
// se mockea para no depender de la instancia real, que a su vez
// necesitaría Storage (mismo criterio que shared-expense-form.spec.ts).
const fakeAttachmentsService = { getDownloadUrl: vi.fn().mockResolvedValue(null) };

const fakeMovement = {
  id: 'm1',
  uid: 'u1',
  categoryId: 'cat1',
  categoryName: 'Comida',
  categoryIcon: '🍔',
  type: 'expense' as const,
  amount: 100,
  date: ts('2026-02-01'),
  note: '',
  groupId: 'group1',
  paidBy: 'u1',
  splitType: 'equal' as const,
  splits: [
    { uid: 'u1', amount: 50, settled: false },
    { uid: 'u2', amount: 50, settled: false },
  ],
};

function fakeSettlement(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 's1',
    groupId: 'group1',
    fromUid: 'u1',
    toUid: 'u2',
    amount: 50,
    date: ts('2026-02-10'),
    note: 'Cena',
    linkedMovementId: null,
    allocations: [{ movementId: 'm1', debtorUid: 'u2', installmentIndex: null, amount: 50 }],
    allocationMode: 'manual' as const,
    createdBy: 'u1',
    createdAt: ts('2026-02-10'),
    ...overrides,
  };
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await Promise.resolve();
  }
}

function createSettlementsServiceMock(settlements: unknown[]) {
  return {
    settlements$: vi.fn(() => of(settlements)),
    findLinkedMovementSettlementIds: vi.fn().mockResolvedValue(new Set()),
    updateNote: vi.fn().mockResolvedValue(undefined),
    attachFile: vi.fn().mockResolvedValue(undefined),
    removeAttachment: vi.fn().mockResolvedValue(undefined),
    voidSettlement: vi.fn().mockResolvedValue(undefined),
    linkPersonalMovement: vi.fn().mockResolvedValue(undefined),
  };
}

interface ConfigureOpts {
  settlements?: unknown[];
  movements?: unknown[];
  currentUid?: string;
  settlementsServiceOverrides?: Partial<ReturnType<typeof createSettlementsServiceMock>>;
}

async function setUp(opts: ConfigureOpts = {}) {
  const settlementsService = {
    ...createSettlementsServiceMock(opts.settlements ?? [fakeSettlement()]),
    ...opts.settlementsServiceOverrides,
  };

  await TestBed.configureTestingModule({
    imports: [AbonoDetail],
    providers: [
      { provide: SettlementsService, useValue: settlementsService },
      { provide: MovementsService, useValue: { groupMovements$: () => of(opts.movements ?? [fakeMovement]) } },
      { provide: GroupsService, useValue: { getMemberProfiles: vi.fn().mockResolvedValue(fakeMembers) } },
      { provide: Accounts, useValue: { accounts$: of(fakeAccounts) } },
      { provide: AttachmentsService, useValue: fakeAttachmentsService },
      { provide: Auth, useValue: { currentUser: { uid: opts.currentUid ?? 'u1' } } },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(AbonoDetail);
  fixture.componentRef.setInput('context', { groupId: 'group1', settlementId: 's1' });
  fixture.detectChanges();
  await flushMicrotasks();
  fixture.detectChanges();

  return { fixture, component: fixture.componentInstance, settlementsService };
}

describe('AbonoDetail', () => {
  it('should create', async () => {
    const { component } = await setUp();
    expect(component).toBeTruthy();
  });

  it('shows "no existe" when the settlement is not found in the live list', async () => {
    const { fixture } = await setUp({ settlements: [] });

    expect(fixture.nativeElement.textContent).toContain('Este abono ya no existe.');
  });

  it('shows amount, names, and the chosen date', async () => {
    const { fixture } = await setUp();
    const text = fixture.nativeElement.textContent;

    expect(text).toContain('Diego');
    expect(text).toContain('Ana');
    expect(text).toMatch(/\$\s*50/);
  });

  it('createdAtLabel(): formats "Registrado el ... por <nombre>" when createdAt/createdBy are present', async () => {
    const { component } = await setUp();

    expect(component.createdAtLabel()).toContain('Registrado el');
    expect(component.createdAtLabel()).toContain('Diego');
  });

  it('createdAtLabel(): null for a legacy abono (no createdBy/createdAt at all)', async () => {
    const legacy = fakeSettlement({ createdBy: undefined, createdAt: undefined, allocations: undefined, allocationMode: undefined });
    const { component } = await setUp({ settlements: [legacy] });

    expect(component.createdAtLabel()).toBeNull();
  });

  it('createdAtLabel(): shows "justo ahora" when createdAt is still a pending serverTimestamp (null)', async () => {
    const pending = fakeSettlement({ createdAt: null });
    const { component } = await setUp({ settlements: [pending] });

    expect(component.createdAtLabel()).toContain('justo ahora');
  });

  describe('estado', () => {
    it('shows "Activo." for an active abono', async () => {
      const { fixture } = await setUp();
      expect(fixture.nativeElement.textContent).toContain('Activo.');
    });

    it('shows who voided it, when, and the reason — struck through', async () => {
      const voided = fakeSettlement({
        status: 'voided',
        voidedBy: 'u2',
        voidedAt: ts('2026-02-20'),
        voidReason: 'monto duplicado',
      });
      const { fixture, component } = await setUp({ settlements: [voided] });

      expect(component.isVoided()).toBe(true);
      const text = fixture.nativeElement.textContent;
      expect(text).toContain('Anulado por Ana');
      expect(text).toContain('monto duplicado');
    });
  });

  describe('nota', () => {
    it('a party can edit the note while active, and save only appears once it changed', async () => {
      const { fixture, component, settlementsService } = await setUp();

      expect(fixture.nativeElement.querySelector('.mfx-form__actions button')).toBeNull();

      component.noteDraft.set('nota nueva');
      fixture.detectChanges();
      const saveButton: HTMLButtonElement = fixture.nativeElement.querySelector('.mfx-form__actions button');
      expect(saveButton).not.toBeNull();

      await component.saveNote();

      expect(settlementsService.updateNote).toHaveBeenCalledWith('s1', 'nota nueva');
    });

    it('a third-party viewer sees the note as read-only text, never a textarea', async () => {
      const { fixture } = await setUp({ currentUid: 'u3' });

      expect(fixture.nativeElement.querySelector('textarea')).toBeNull();
      expect(fixture.nativeElement.textContent).toContain('Cena');
    });

    it('a voided abono shows the note as read-only even for a party', async () => {
      const voided = fakeSettlement({ status: 'voided', voidedBy: 'u2', voidReason: 'motivo' });
      const { fixture } = await setUp({ settlements: [voided] });

      expect(fixture.nativeElement.querySelector('textarea[placeholder="Opcional"]')).toBeNull();
    });
  });

  describe('a qué aplicó', () => {
    it('shows the allocation breakdown with label, amount, and the CURRENT debt status', async () => {
      const { fixture } = await setUp();
      const text = fixture.nativeElement.textContent;

      expect(text).toContain('Comida');
      expect(text).toMatch(/\$\s*50/);
      expect(text).toContain('pagada');
    });

    it('shows a legacy explanation instead of a breakdown when there are no allocations', async () => {
      const legacy = fakeSettlement({ allocations: undefined, allocationMode: undefined });
      const { fixture } = await setUp({ settlements: [legacy] });

      expect(fixture.nativeElement.textContent).toContain('Abono de antes de que se guardara el desglose exacto');
    });

    it('allocationLabel(): falls back to "Gasto eliminado" when the movement no longer exists', async () => {
      const { component } = await setUp({ movements: [] });

      expect(component.allocationLabel({ movementId: 'm1', debtorUid: 'u2', installmentIndex: null, amount: 50 })).toBe(
        'Gasto eliminado'
      );
    });
  });

  describe('comprobante', () => {
    it('a party sees the attachment picker', async () => {
      const { fixture } = await setUp();
      expect(fixture.nativeElement.querySelector('mfx-attachment-picker')).not.toBeNull();
    });

    it('a third party with no edit rights sees only a text indicator, never the picker', async () => {
      const withAttachment = fakeSettlement({ attachmentPath: 'settlements/s1/attachment', attachmentContentType: 'image/jpeg' });
      const { fixture } = await setUp({ settlements: [withAttachment], currentUid: 'u3' });

      expect(fixture.nativeElement.querySelector('mfx-attachment-picker')).toBeNull();
      expect(fixture.nativeElement.textContent).toContain('Tiene comprobante');
    });

    it('a third party with no attachment at all sees "Sin comprobante"', async () => {
      const { fixture } = await setUp({ currentUid: 'u3' });
      expect(fixture.nativeElement.textContent).toContain('Sin comprobante');
    });

    it('onAttachmentReady(): uploads via SettlementsService.attachFile()', async () => {
      const { component, settlementsService } = await setUp();
      const pending = { blob: new Blob(['x']), contentType: 'image/jpeg', fileName: 'recibo.jpg' };

      await component.onAttachmentReady(pending);

      expect(settlementsService.attachFile).toHaveBeenCalledWith('s1', pending);
    });

    it('onAttachmentRemoved(): removes via SettlementsService.removeAttachment()', async () => {
      const withAttachment = fakeSettlement({ attachmentPath: 'settlements/s1/attachment', attachmentContentType: 'image/jpeg' });
      const { component, settlementsService } = await setUp({ settlements: [withAttachment] });

      await component.onAttachmentRemoved();

      expect(settlementsService.removeAttachment).toHaveBeenCalledWith('s1', 'settlements/s1/attachment');
    });
  });

  describe('acciones (solo la pareja)', () => {
    it('hides the whole "Acciones" section for a third party', async () => {
      const { fixture } = await setUp({ currentUid: 'u3' });
      expect(fixture.nativeElement.textContent).not.toContain('Acciones');
    });

    it('"Registrar como gasto/ingreso" varies by which side of the pair is viewing', async () => {
      const asPayer = await setUp({ currentUid: 'u1' });
      expect(asPayer.component.linkLabel()).toBe('Registrar como gasto');

      TestBed.resetTestingModule();
      const asReceiver = await setUp({ currentUid: 'u2' });
      expect(asReceiver.component.linkLabel()).toBe('Registrar como ingreso');
    });

    it('confirmLinking(): requires an account before saving', async () => {
      const { component, settlementsService } = await setUp();

      await component.confirmLinking();

      expect(component.linkError()).toBe('Selecciona una cuenta.');
      expect(settlementsService.linkPersonalMovement).not.toHaveBeenCalled();
    });

    it('confirmLinking(): links the movement and marks it as already linked', async () => {
      // Misma referencia en el fixture y en la aserción — ts()/fakeSettlement()
      // crean funciones nuevas en cada llamada, así que comparar contra una
      // llamada aparte a fakeSettlement() fallaría por igualdad profunda.
      const theSettlement = fakeSettlement();
      const { component, settlementsService } = await setUp({ settlements: [theSettlement] });
      component.linkAccountId.set('acc1');

      await component.confirmLinking();

      expect(settlementsService.linkPersonalMovement).toHaveBeenCalledWith(theSettlement, 'acc1');
      expect(component.linkedAlready()).toBe(true);
      expect(component.linkingOpen()).toBe(false);
    });

    it('hides the link action once already registered, once voided', async () => {
      const voided = fakeSettlement({ status: 'voided', voidedBy: 'u2', voidReason: 'motivo' });
      const { fixture } = await setUp({ settlements: [voided] });

      expect(fixture.nativeElement.textContent).not.toContain('Registrar como gasto');
    });

    // Ajuste visual (ver DESIGN.md): "Registrar como gasto/ingreso" usa el
    // mismo botón principal que "Marcar como saldada" (GroupBalance), de
    // ancho completo (mfx-btn-block) — ya no un <button> sin estilo.
    it('"Registrar como gasto" usa las clases de botón compartidas (mfx-btn-primary mfx-btn-block)', async () => {
      const { fixture } = await setUp();

      const button: HTMLButtonElement | null = fixture.nativeElement.querySelector('.mfx-section-header + button');
      expect(button).toBeTruthy();
      expect(button!.textContent?.trim()).toBe('Registrar como gasto');
      expect(button!.classList.contains('mfx-btn-primary')).toBe(true);
      expect(button!.classList.contains('mfx-btn-block')).toBe(true);
    });

    // "Anular abono" es una acción secundaria/destructiva: contorno rojo
    // (mfx-btn-danger-outline), nunca sólido ni al mismo nivel que la
    // acción principal, y viene DESPUÉS de ella, separada por
    // mfx-abono-detail__danger-zone (espacio + línea divisoria).
    it('"Anular abono" usa el botón destructivo de contorno y aparece después, separado del principal', async () => {
      const { fixture } = await setUp();

      const buttons: HTMLButtonElement[] = Array.from(fixture.nativeElement.querySelectorAll('button'));
      const primaryIndex = buttons.findIndex((btn) => btn.textContent?.trim() === 'Registrar como gasto');
      const voidIndex = buttons.findIndex((btn) => btn.textContent?.trim() === 'Anular abono');

      expect(primaryIndex).toBeGreaterThanOrEqual(0);
      expect(voidIndex).toBeGreaterThan(primaryIndex);

      const voidButton = buttons[voidIndex];
      expect(voidButton.classList.contains('mfx-btn-danger-outline')).toBe(true);
      expect(voidButton.classList.contains('mfx-btn-danger-solid')).toBe(false);
      expect(voidButton.closest('.mfx-abono-detail__danger-zone')).toBeTruthy();
    });
  });

  describe('anular (terminal, con motivo obligatorio)', () => {
    it('canConfirmVoid() requires at least 3 characters', async () => {
      const { component } = await setUp();
      component.startVoid();

      component.voidReason.set('ab');
      expect(component.canConfirmVoid()).toBe(false);

      component.voidReason.set('abc');
      expect(component.canConfirmVoid()).toBe(true);
    });

    it('confirmVoid(): calls SettlementsService.voidSettlement() with the trimmed reason', async () => {
      const theSettlement = fakeSettlement();
      const { component, settlementsService } = await setUp({ settlements: [theSettlement] });
      component.startVoid();
      component.voidReason.set('monto equivocado');

      await component.confirmVoid();

      expect(settlementsService.voidSettlement).toHaveBeenCalledWith(theSettlement, 'monto equivocado');
      expect(component.confirmingVoid()).toBe(false);
    });

    it('confirmVoid(): shows an inline error if the service rejects', async () => {
      const { component, settlementsService } = await setUp({
        settlementsServiceOverrides: { voidSettlement: vi.fn().mockRejectedValue(new Error('ya está anulado')) },
      });
      component.startVoid();
      component.voidReason.set('motivo valido');

      await component.confirmVoid();

      expect(component.voidError()).toBe('ya está anulado');
      expect(settlementsService.voidSettlement).toHaveBeenCalled();
    });

    it('registers its own back-button entry on ModalStack while confirming, and pops it on cancel', async () => {
      const { fixture, component } = await setUp();
      const modalStack = TestBed.inject(ModalStack);

      expect(modalStack.hasOpen).toBe(false);
      component.startVoid();
      fixture.detectChanges();
      expect(modalStack.hasOpen).toBe(true);

      component.cancelVoid();
      fixture.detectChanges();
      expect(modalStack.hasOpen).toBe(false);
    });

    it('does not offer "Anular" once the abono is already voided', async () => {
      const voided = fakeSettlement({ status: 'voided', voidedBy: 'u2', voidReason: 'motivo' });
      const { fixture } = await setUp({ settlements: [voided] });

      expect(fixture.nativeElement.textContent).not.toContain('Anular abono');
    });
  });
});
