import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { Accounts } from '../../../core/accounts/accounts';
import { Auth } from '../../../core/auth/auth';
import { Celebration } from '../../../core/celebration/celebration';
import { MovementsService } from '../../../core/movements/movements';
import type { SettlementContext } from '../../../core/settlement-form-state/settlement-form-state';
import { SettlementsService, StaleDebtError } from '../../../core/settlements/settlements';
import { AbonoForm } from './abono-form';

function ts(date: string) {
  return { toDate: () => new Date(date), toMillis: () => new Date(date).getTime() } as never;
}

let movementIdCounter = 0;
function movement(
  paidBy: string,
  splits: [string, number][],
  opts: { date?: string; installments?: { amount: number; dueDate: string; status?: 'pending' | 'paid' }[] } = {}
) {
  movementIdCounter += 1;
  return {
    id: `m${movementIdCounter}`,
    uid: paidBy,
    categoryId: 'cat1',
    categoryName: 'Comida',
    categoryIcon: '🍔',
    type: 'expense' as const,
    amount: splits.reduce((sum, [, amount]) => sum + amount, 0),
    date: ts(opts.date ?? '2026-01-01'),
    note: '',
    groupId: 'group1',
    paidBy,
    splitType: 'equal' as const,
    splits: splits.map(([uid, amount]) => ({ uid, amount, settled: false })),
    installments: opts.installments?.map((i) => ({ amount: i.amount, dueDate: ts(i.dueDate), status: i.status ?? 'pending' })) ?? null,
  };
}

const fakeAccounts = [{ id: 'acc1', uid: 'diego', name: 'Efectivo', type: 'efectivo' as const, balance: 0, currency: 'COP' }];

describe('AbonoForm', () => {
  let fixture: ComponentFixture<AbonoForm>;
  let component: AbonoForm;
  let createSettlement: ReturnType<typeof vi.fn>;
  let groupMovements$: ReturnType<typeof vi.fn>;
  let settlements$: ReturnType<typeof vi.fn>;
  let celebrate: ReturnType<typeof vi.fn>;

  function setUp(context: SettlementContext, currentUid = 'diego') {
    TestBed.configureTestingModule({
      imports: [AbonoForm],
      providers: [
        { provide: SettlementsService, useValue: { createSettlement, settlements$ } },
        { provide: MovementsService, useValue: { groupMovements$ } },
        { provide: Accounts, useValue: { accounts$: of(fakeAccounts) } },
        { provide: Auth, useValue: { currentUser: { uid: currentUid } } },
        { provide: Celebration, useValue: { celebrate } },
      ],
    });
    fixture = TestBed.createComponent(AbonoForm);
    fixture.componentRef.setInput('context', context);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  beforeEach(() => {
    movementIdCounter = 0;
    createSettlement = vi.fn().mockResolvedValue('settlement1');
    groupMovements$ = vi.fn(() => of([]));
    settlements$ = vi.fn(() => of([]));
    celebrate = vi.fn().mockResolvedValue(undefined);
  });

  // TEST OBLIGATORIO (funciones puras: distribución) — A=55.400, B=30.000,
  // C=3 cuotas de 52.667, abono de 80.000 -> A pagada, B parcial (resta
  // 5.400), C intacta, suma exacta.
  describe('distribución automática', () => {
    const movA = movement('tatiana', [['tatiana', 0], ['diego', 55400]], { date: '2026-01-01' });
    const movB = movement('tatiana', [['tatiana', 0], ['diego', 30000]], { date: '2026-01-02' });
    const movC = movement('tatiana', [['tatiana', 0], ['diego', 158001]], {
      date: '2026-01-03',
      installments: [
        { amount: 52667, dueDate: '2026-02-01' },
        { amount: 52667, dueDate: '2026-03-01' },
        { amount: 52667, dueDate: '2026-04-01' },
      ],
    });
    const context: SettlementContext = {
      groupId: 'group1',
      fromUid: 'diego',
      toUid: 'tatiana',
      fromName: 'Diego',
      toName: 'Tatiana',
      preselect: { mode: 'empty' },
    };

    beforeEach(() => {
      groupMovements$.mockReturnValue(of([movA, movB, movC]));
      setUp(context);
    });

    it('reparte 80.000 a lo más antiguo primero: A pagada, B parcial (resta 5.400), C intacta, suma exacta', () => {
      component.autoDistributeAmount.set(80000);
      component.distributeAutomatic();
      fixture.detectChanges();

      const [debtA] = component.rows().filter((d) => d.movementId === movA.id);
      const [debtB] = component.rows().filter((d) => d.movementId === movB.id);
      const debtsC = component.rows().filter((d) => d.movementId === movC.id);

      expect(component.resolvedAmount(debtA)).toBe(55400);
      expect(component.previewStatusFor(debtA)).toBe('pagada');

      expect(component.resolvedAmount(debtB)).toBe(24600);
      expect(component.previewStatusFor(debtB)).toBe('parcial');
      expect(component.previewRemainingFor(debtB)).toBe(5400);

      for (const debt of debtsC) {
        expect(component.isSelected(debt)).toBe(false);
      }

      expect(component.total()).toBe(80000);
    });

    it('rechaza (muestra error) si el monto supera lo que se debe en total, sin seleccionar nada', () => {
      component.autoDistributeAmount.set(999999);
      component.distributeAutomatic();
      fixture.detectChanges();

      expect(component.autoDistributeError()).toContain('supera');
      expect(component.total()).toBe(0);
    });
  });

  // TEST OBLIGATORIO — "Saldada" prellena el TOTAL de la dirección, nunca
  // un neto: con deudas cruzadas (diego->tatiana 27.700, tatiana->diego
  // 15.000, dos líneas independientes), el preselect de la línea
  // diego->tatiana prellena 27.700 completo — la otra dirección ni se mira.
  describe('preselect "auto-total" (Marcar como saldada): prellena el total de ESA dirección, nunca un neto', () => {
    it('con deudas cruzadas 27.700 (diego->tatiana) y 15.000 (tatiana->diego), prellena 27.700 completo', () => {
      const movA = movement('tatiana', [['tatiana', 0], ['diego', 27700]]);
      const movB = movement('diego', [['diego', 0], ['tatiana', 15000]]);
      groupMovements$.mockReturnValue(of([movA, movB]));

      setUp({
        groupId: 'group1',
        fromUid: 'diego',
        toUid: 'tatiana',
        fromName: 'Diego',
        toName: 'Tatiana',
        preselect: { mode: 'auto-total' },
      });
      fixture.detectChanges();

      // 27.700, no 12.700 — la deuda tatiana->diego (dirección contraria)
      // nunca se resta ni aparece en ningún aviso (ver DATABASE.md: las
      // deudas no se cruzan).
      expect(component.total()).toBe(27700);
      expect(component.rows()).toHaveLength(1);
      expect(fixture.nativeElement.textContent).not.toContain('te debe');
    });
  });

  describe('preselect "installment" (Marcar como pagada): esa cuota, por su remaining completo', () => {
    it('preselecciona exactamente esa cuota, con "full" (no un monto fijo)', () => {
      const mov = movement('tatiana', [['tatiana', 0], ['diego', 100000]], {
        installments: [
          { amount: 50000, dueDate: '2026-02-01' },
          { amount: 50000, dueDate: '2026-03-01' },
        ],
      });
      groupMovements$.mockReturnValue(of([mov]));
      // La cuota 0 ya tiene un abono parcial — el preselect debe usar el
      // remaining FRESCO (30.000), no el monto original de la cuota.
      settlements$.mockReturnValue(
        of([
          {
            id: 's1',
            groupId: 'group1',
            fromUid: 'diego',
            toUid: 'tatiana',
            amount: 20000,
            date: ts('2026-01-15'),
            note: '',
            linkedMovementId: null,
            allocations: [{ movementId: mov.id, debtorUid: 'diego', installmentIndex: 0, amount: 20000 }],
            allocationMode: 'manual',
          },
        ])
      );

      setUp({
        groupId: 'group1',
        fromUid: 'diego',
        toUid: 'tatiana',
        fromName: 'Diego',
        toName: 'Tatiana',
        preselect: { mode: 'installment', movementId: mov.id, installmentIndex: 0 },
      });
      fixture.detectChanges();

      expect(component.total()).toBe(30000);
    });
  });

  describe('DOM', () => {
    const mov = movement('tatiana', [['tatiana', 0], ['diego', 50000]]);
    const movPaid = movement('tatiana', [['tatiana', 0], ['diego', 30000]], { date: '2025-12-01' });
    const context: SettlementContext = {
      groupId: 'group1',
      fromUid: 'diego',
      toUid: 'tatiana',
      fromName: 'Diego',
      toName: 'Tatiana',
      preselect: { mode: 'empty' },
    };

    beforeEach(() => {
      groupMovements$.mockReturnValue(of([mov, movPaid]));
      settlements$.mockReturnValue(
        of([
          {
            id: 's-paid',
            groupId: 'group1',
            fromUid: 'diego',
            toUid: 'tatiana',
            amount: 30000,
            date: ts('2025-12-05'),
            note: '',
            linkedMovementId: null,
            allocations: [{ movementId: movPaid.id, debtorUid: 'diego', installmentIndex: null, amount: 30000 }],
            allocationMode: 'manual',
          },
        ])
      );
      setUp(context);
    });

    it('renderiza una fila por deuda pendiente, con checkbox', () => {
      const checkboxes = fixture.nativeElement.querySelectorAll('.mfx-abono-form__row-check button[role="checkbox"]');
      expect(checkboxes.length).toBe(1);
    });

    it('el botón de enviar arranca deshabilitado (nada seleccionado)', () => {
      const button: HTMLButtonElement = fixture.nativeElement.querySelector('.mfx-form__actions button');
      expect(button.disabled).toBe(true);
    });

    it('marcar el checkbox selecciona la fila completa y habilita el botón de enviar', () => {
      const checkbox: HTMLButtonElement = fixture.nativeElement.querySelector('.mfx-abono-form__row-check button[role="checkbox"]');
      checkbox.click();
      fixture.detectChanges();

      const button: HTMLButtonElement = fixture.nativeElement.querySelector('.mfx-form__actions button');
      expect(button.disabled).toBe(false);
      expect(fixture.nativeElement.textContent).toContain('Quedará pagada');
    });

    // Ajuste visual (ver DESIGN.md): el monto parcial de la fila usa el
    // mismo input compartido que "Monto" en MovementForm/SharedExpenseForm
    // (.mfx-input, ver styles.scss) — no un <input> nativo suelto.
    it('el monto parcial de la fila usa el input compartido (.mfx-input) con placeholder "0"', () => {
      const checkbox: HTMLButtonElement = fixture.nativeElement.querySelector('.mfx-abono-form__row-check button[role="checkbox"]');
      checkbox.click();
      fixture.detectChanges();

      const amountInput: HTMLInputElement = fixture.nativeElement.querySelector('.mfx-abono-form__row-amount input');
      expect(amountInput.classList.contains('mfx-input')).toBe(true);
      expect(amountInput.placeholder).toBe('0');
    });

    it('las deudas pagadas quedan escondidas detrás de "Ver pagadas" y no tienen checkbox', () => {
      expect(fixture.nativeElement.textContent).not.toContain('✓ Pagada');

      const toggle: HTMLButtonElement = fixture.nativeElement.querySelector('.mfx-abono-form__toggle-paid');
      toggle.click();
      fixture.detectChanges();

      expect(fixture.nativeElement.textContent).toContain('✓ Pagada');
      expect(fixture.nativeElement.querySelector('.mfx-abono-form__row--paid button[role="checkbox"]')).toBeNull();
    });

    it('el texto se adapta según quién mira: quien paga ve "le pagaste"', () => {
      expect(fixture.nativeElement.textContent).toContain('le pagaste a Tatiana');
    });

    it('el texto se adapta según quién mira: quien recibe ve "te pagó"', () => {
      TestBed.resetTestingModule();
      setUp(context, 'tatiana');
      expect(fixture.nativeElement.textContent).toContain('Diego te pagó');
    });

    // TEST OBLIGATORIO — el total ya no es un input.
    it('"Total a abonar" es texto, no un <input> — y "Distribuir un monto" arranca oculto', () => {
      const totalBlock = fixture.nativeElement.querySelector('.mfx-abono-form__total');
      expect(totalBlock.querySelector('input')).toBeNull();
      expect(totalBlock.textContent).toMatch(/\$\s*0/);

      expect(fixture.nativeElement.querySelector('.mfx-abono-form__distribute')).toBeNull();
      const toggle: HTMLButtonElement = fixture.nativeElement.querySelector('.mfx-abono-form__distribute-toggle button[role="checkbox"]');
      expect(toggle.getAttribute('aria-checked')).toBe('false');
    });

    it('activar "Distribuir un monto" muestra el campo + botón; el total sigue siendo de solo lectura', () => {
      const toggle: HTMLButtonElement = fixture.nativeElement.querySelector('.mfx-abono-form__distribute-toggle button[role="checkbox"]');
      toggle.click();
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('.mfx-abono-form__distribute')).toBeTruthy();
      expect(fixture.nativeElement.querySelector('.mfx-abono-form__total input')).toBeNull();
    });

    // TEST OBLIGATORIO — borrar el monto deja 0 (fila sigue marcada
    // mientras el campo tiene foco) y se desmarca sola al blur.
    it('borrar el monto del campo deja la fila en 0 pero seleccionada; el blur con 0 la desmarca', () => {
      const [debt] = component.unpaidRows();
      component.setFull(debt);
      fixture.detectChanges();
      expect(component.isSelected(debt)).toBe(true);

      component.setAmount(debt, 0);
      expect(component.isSelected(debt)).toBe(true);
      expect(component.resolvedAmount(debt)).toBe(0);

      component.onAmountBlur(debt);
      expect(component.isSelected(debt)).toBe(false);
    });

    it('el blur con un monto > 0 deja la fila seleccionada (no la desmarca)', () => {
      const [debt] = component.unpaidRows();
      component.setFull(debt);
      component.setAmount(debt, 10000);

      component.onAmountBlur(debt);

      expect(component.isSelected(debt)).toBe(true);
      expect(component.resolvedAmount(debt)).toBe(10000);
    });
  });

  // Corrige un bug real: categoryId null ("sin categoría elegida") se
  // mostraba como "Categoría eliminada" — solo debe decirlo cuando
  // categoryId apunta a algo que ya NO existe.
  describe('movementLabel(): "Sin categoría" vs. "Categoría eliminada"', () => {
    const context: SettlementContext = {
      groupId: 'group1',
      fromUid: 'diego',
      toUid: 'tatiana',
      fromName: 'Diego',
      toName: 'Tatiana',
      preselect: { mode: 'empty' },
    };

    it('categoryId null -> "Sin categoría" (nunca "Categoría eliminada")', () => {
      const movSinCategoria = movement('tatiana', [['tatiana', 0], ['diego', 50000]]);
      (movSinCategoria as { categoryId: string | null }).categoryId = null;
      (movSinCategoria as { categoryName: string | null }).categoryName = null;
      (movSinCategoria as { categoryIcon: string | null }).categoryIcon = null;
      groupMovements$.mockReturnValue(of([movSinCategoria]));
      setUp(context);

      expect(component.movementLabel(movSinCategoria.id)).toBe('🗂️ Sin categoría');
    });

    it('categoryId apuntando a algo que ya no existe -> "Categoría eliminada"', () => {
      const movCategoriaBorrada = movement('tatiana', [['tatiana', 0], ['diego', 50000]]);
      (movCategoriaBorrada as { categoryName: string | null }).categoryName = null;
      (movCategoriaBorrada as { categoryIcon: string | null }).categoryIcon = null;
      groupMovements$.mockReturnValue(of([movCategoriaBorrada]));
      setUp(context);

      expect(component.movementLabel(movCategoriaBorrada.id)).toBe('❓ Categoría eliminada');
    });
  });

  describe('submit()', () => {
    const mov = movement('tatiana', [['tatiana', 0], ['diego', 50000]]);
    const installmentMov = movement('tatiana', [['tatiana', 0], ['diego', 50000]], {
      installments: [{ amount: 50000, dueDate: '2026-02-01' }],
    });
    const context: SettlementContext = {
      groupId: 'group1',
      fromUid: 'diego',
      toUid: 'tatiana',
      fromName: 'Diego',
      toName: 'Tatiana',
      preselect: { mode: 'installment', movementId: installmentMov.id, installmentIndex: 0 },
    };

    beforeEach(() => {
      groupMovements$.mockReturnValue(of([installmentMov]));
      setUp(context);
      fixture.detectChanges();
    });

    it('envía allocations explícitas con "full" para la cuota preseleccionada', async () => {
      await component.submit();

      expect(createSettlement).toHaveBeenCalledWith(
        expect.objectContaining({
          groupId: 'group1',
          fromUid: 'diego',
          toUid: 'tatiana',
          allocationMode: 'manual',
          allocations: [{ movementId: installmentMov.id, debtorUid: 'diego', installmentIndex: 0, full: true }],
        })
      );
      expect(celebrate).toHaveBeenCalled();
    });

    it('con el preselect "auto-total" (sin tocar nada), envía allocationMode "auto" con el total', async () => {
      TestBed.resetTestingModule();
      groupMovements$.mockReturnValue(of([mov]));
      setUp({ ...context, preselect: { mode: 'auto-total' } });
      fixture.detectChanges();

      await component.submit();

      expect(createSettlement).toHaveBeenCalledWith(
        expect.objectContaining({ allocationMode: 'auto', amount: 50000 })
      );
    });

    it('si createSettlement rechaza con StaleDebtError, muestra un mensaje claro y limpia la selección (no el genérico)', async () => {
      createSettlement.mockRejectedValueOnce(new StaleDebtError('Ese abono supera lo que falta de esa deuda.'));

      await component.submit();

      expect(component.errorMessage()).toContain('cambió mientras llenabas el formulario');
      expect(component.errorMessage()).not.toBe('No pudimos registrar el abono. Intenta de nuevo.');
    });

    it('si createSettlement rechaza con un error genérico, muestra el mensaje genérico', async () => {
      createSettlement.mockRejectedValueOnce(new Error('boom'));

      await component.submit();

      expect(component.errorMessage()).toBe('No pudimos registrar el abono. Intenta de nuevo.');
    });
  });
});
