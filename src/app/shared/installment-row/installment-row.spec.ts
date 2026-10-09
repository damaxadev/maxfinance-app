import { ComponentFixture, TestBed } from '@angular/core/testing';
import { vi } from 'vitest';

import { InstallmentRow } from './installment-row';

// Mediodía local, no medianoche UTC — una fecha "YYYY-MM-DD" sin hora se
// parsea como medianoche UTC, que en zonas con offset negativo (p. ej.
// Bogotá, UTC-5) cae en el día anterior al leerla con getters locales
// (.getDate()), exactamente como ya se maneja en el resto de la app.
function ts(date: string) {
  const withTime = `${date}T12:00:00`;
  return { toDate: () => new Date(withTime), toMillis: () => new Date(withTime).getTime() } as never;
}

describe('InstallmentRow', () => {
  let component: InstallmentRow;
  let fixture: ComponentFixture<InstallmentRow>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [InstallmentRow],
    }).compileComponents();

    fixture = TestBed.createComponent(InstallmentRow);
    component = fixture.componentInstance;
  });

  function setUp(
    overrides: Partial<{
      status: 'pending' | 'paid';
      amount: number;
      index: number;
      interactive: boolean;
      size: 'cozy' | 'compact';
    }> = {}
  ) {
    fixture.componentRef.setInput('installment', {
      dueDate: ts('2026-11-02'),
      amount: overrides.amount ?? 50000,
      status: overrides.status ?? 'pending',
    });
    fixture.componentRef.setInput('index', overrides.index ?? 0);
    if (overrides.interactive !== undefined) {
      fixture.componentRef.setInput('interactive', overrides.interactive);
    }
    if (overrides.size !== undefined) {
      fixture.componentRef.setInput('size', overrides.size);
    }
    fixture.detectChanges();
  }

  it('should create', () => {
    setUp();
    expect(component).toBeTruthy();
  });

  it('formats the date as day + short month only, no time (e.g. "2 de nov")', () => {
    setUp();
    expect(component.formattedDate()).toBe('2 de nov');
  });

  it('shows the cuota number in the indicator when pending', () => {
    setUp({ status: 'pending', index: 2 });
    fixture.detectChanges();

    const indicator = fixture.nativeElement.querySelector('.mfx-installment-row__indicator');
    expect(indicator.textContent?.trim()).toBe('3');
    expect(indicator.classList.contains('mfx-installment-row__indicator--paid')).toBe(false);
  });

  it('shows a check mark in the indicator when paid, styled as paid', () => {
    setUp({ status: 'paid' });

    const indicator = fixture.nativeElement.querySelector('.mfx-installment-row__indicator');
    expect(indicator.textContent?.trim()).toBe('✓');
    expect(indicator.classList.contains('mfx-installment-row__indicator--paid')).toBe(true);
  });

  it('shows the "✓ Pagada" badge when paid, with no action button', () => {
    setUp({ status: 'paid', interactive: true });

    expect(fixture.nativeElement.textContent).toContain('✓ Pagada');
    expect(fixture.nativeElement.querySelector('.mfx-installment-row__pay-btn')).toBeNull();
  });

  it('shows "Marcar como pagada" when pending and interactive', () => {
    setUp({ status: 'pending', interactive: true });

    const button: HTMLButtonElement = fixture.nativeElement.querySelector('.mfx-installment-row__pay-btn');
    expect(button.textContent?.trim()).toBe('Marcar como pagada');
  });

  it('hides the action entirely when pending but not interactive (read-only view)', () => {
    setUp({ status: 'pending', interactive: false });

    expect(fixture.nativeElement.querySelector('.mfx-installment-row__pay-btn')).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('✓ Pagada');
  });

  it('is never interactive for a paid cuota, even if interactive: true', () => {
    setUp({ status: 'paid', interactive: true });

    expect(fixture.nativeElement.querySelector('.mfx-installment-row__pay-btn')).toBeNull();
  });

  it('defaults to interactive when the input is not provided', () => {
    setUp({ status: 'pending' });

    expect(fixture.nativeElement.querySelector('.mfx-installment-row__pay-btn')).toBeTruthy();
  });

  it('emits pay when the button is clicked', () => {
    setUp({ status: 'pending', interactive: true });
    const emitted: void[] = [];
    component.pay.subscribe(() => emitted.push(undefined));

    const button: HTMLButtonElement = fixture.nativeElement.querySelector('.mfx-installment-row__pay-btn');
    button.click();

    expect(emitted.length).toBe(1);
  });

  it('shows the amount via mfx-animated-number', () => {
    setUp({ amount: 75000 });

    expect(fixture.nativeElement.querySelector('.mfx-installment-row__amount mfx-animated-number')).toBeTruthy();
  });

  // Mismo componente, dos layouts distintos a propósito — "cozy" (vista de
  // detalle, SharedExpenseForm) separa título/fecha en líneas propias;
  // "compact" (resumen embebido, GroupActivity) las junta en una sola
  // línea para no alargar una fila de actividad. Ver DATABASE.md.
  describe('size (cozy vs. compact)', () => {
    it('defaults to "cozy" with title and date as separate elements', () => {
      setUp();

      expect(fixture.nativeElement.querySelector('.mfx-installment-row--cozy')).toBeTruthy();
      expect(fixture.nativeElement.querySelector('.mfx-installment-row__title')?.textContent?.trim()).toBe('Cuota 1');
      expect(fixture.nativeElement.querySelector('.mfx-installment-row__date')?.textContent?.trim()).toBe(
        '2 de nov'
      );
    });

    it('"compact" combines "Cuota N — fecha" into a single element instead', () => {
      setUp({ size: 'compact' });

      expect(fixture.nativeElement.querySelector('.mfx-installment-row--compact')).toBeTruthy();
      expect(fixture.nativeElement.querySelector('.mfx-installment-row__title')).toBeNull();
      expect(fixture.nativeElement.querySelector('.mfx-installment-row__title-date')?.textContent?.trim()).toBe(
        'Cuota 1 — 2 de nov'
      );
    });

    it('both sizes still show the amount, the indicator, and the pay button the same way', () => {
      setUp({ size: 'compact', status: 'pending', interactive: true });

      expect(fixture.nativeElement.querySelector('.mfx-installment-row__amount mfx-animated-number')).toBeTruthy();
      expect(fixture.nativeElement.querySelector('.mfx-installment-row__indicator')?.textContent?.trim()).toBe('1');
      expect(fixture.nativeElement.querySelector('.mfx-installment-row__pay-btn')).toBeTruthy();
    });
  });

  // El stopPropagation vive en el propio botón (no en un contenedor del
  // padre) — para que el componente sea seguro de reusar en cualquier
  // fila tappable sin que el padre tenga que acordarse de protegerlo.
  it('the pay button stops the click from bubbling up to a parent listener', () => {
    setUp({ status: 'pending', interactive: true });
    const parentClick = vi.fn();
    fixture.nativeElement.addEventListener('click', parentClick);

    const button: HTMLButtonElement = fixture.nativeElement.querySelector('.mfx-installment-row__pay-btn');
    button.click();

    expect(parentClick).not.toHaveBeenCalled();
  });

  // `debt` (el balance real, computeDebts/debtsByMovement) manda sobre
  // installment().status en cuanto está presente — ver DATABASE.md,
  // "Balance de grupo y abonos". Sin él, cae al criterio viejo (los tests
  // de arriba, que nunca lo pasan).
  describe('[debt] — balance real (computeDebts), nunca installments[].status', () => {
    function fakeDebt(overrides: Partial<{ status: 'pendiente' | 'parcial' | 'pagada'; paid: number; total: number; remaining: number }> = {}) {
      return {
        movementId: 'm1',
        debtorUid: 'u2',
        creditorUid: 'u1',
        installmentIndex: 0,
        total: overrides.total ?? 50000,
        paid: overrides.paid ?? 0,
        remaining: overrides.remaining ?? 50000,
        status: overrides.status ?? 'pendiente',
        anomaly: false,
      };
    }

    it('[debt] pagada se ve pagada aunque installment().status diga "pending"', () => {
      fixture.componentRef.setInput('installment', { dueDate: ts('2026-11-02'), amount: 50000, status: 'pending' });
      fixture.componentRef.setInput('index', 0);
      fixture.componentRef.setInput('debt', fakeDebt({ status: 'pagada', paid: 50000, remaining: 0 }));
      fixture.detectChanges();

      expect(fixture.nativeElement.textContent).toContain('✓ Pagada');
      expect(fixture.nativeElement.querySelector('.mfx-installment-row__pay-btn')).toBeNull();
    });

    it('[debt] pendiente se ve pendiente aunque installment().status diga "paid" (p. ej. desactualizado)', () => {
      fixture.componentRef.setInput('installment', { dueDate: ts('2026-11-02'), amount: 50000, status: 'paid' });
      fixture.componentRef.setInput('index', 0);
      fixture.componentRef.setInput('debt', fakeDebt({ status: 'pendiente' }));
      fixture.detectChanges();

      expect(fixture.nativeElement.textContent).not.toContain('✓ Pagada');
      expect(fixture.nativeElement.querySelector('.mfx-installment-row__pay-btn')).toBeTruthy();
    });

    it('[debt] parcial muestra "Parcial · pagó X · resta Y" Y sigue ofreciendo el botón (para pagar el resto)', () => {
      fixture.componentRef.setInput('installment', { dueDate: ts('2026-11-02'), amount: 50000, status: 'pending' });
      fixture.componentRef.setInput('index', 0);
      fixture.componentRef.setInput('interactive', true);
      fixture.componentRef.setInput('debt', fakeDebt({ status: 'parcial', paid: 20000, remaining: 30000 }));
      fixture.detectChanges();

      const partialBadge = fixture.nativeElement.querySelector('.mfx-installment-row__partial-badge');
      expect(partialBadge.textContent).toContain('Parcial');
      expect(partialBadge.textContent).toContain('pagó');
      expect(partialBadge.textContent).toContain('resta');
      expect(fixture.nativeElement.querySelector('.mfx-installment-row__pay-btn')).toBeTruthy();
    });

    it('[debt] parcial no interactivo no muestra el botón, pero sí la marca', () => {
      fixture.componentRef.setInput('installment', { dueDate: ts('2026-11-02'), amount: 50000, status: 'pending' });
      fixture.componentRef.setInput('index', 0);
      fixture.componentRef.setInput('interactive', false);
      fixture.componentRef.setInput('debt', fakeDebt({ status: 'parcial', paid: 20000, remaining: 30000 }));
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('.mfx-installment-row__partial-badge')).toBeTruthy();
      expect(fixture.nativeElement.querySelector('.mfx-installment-row__pay-btn')).toBeNull();
    });
  });
});
