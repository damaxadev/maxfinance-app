import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { switchMap } from 'rxjs';

import { Accounts } from '../../../core/accounts/accounts';
import { Auth } from '../../../core/auth/auth';
import { Celebration } from '../../../core/celebration/celebration';
import { type Debt, autoAllocateOldestFirst, computeDebts, groupDebtsByMovement } from '../../../core/debts/debts';
import { MovementsService, type SharedMovementWithId } from '../../../core/movements/movements';
import { sharedMovementLabel } from '../../../core/movements/movement-label';
import type { SettlementContext } from '../../../core/settlement-form-state/settlement-form-state';
import {
  type AllocationRequest,
  type CreateSettlementInput,
  SettlementsService,
  StaleDebtError,
} from '../../../core/settlements/settlements';
import { Checkbox } from '../../../shared/checkbox/checkbox';
import { MfxCurrencyInputDirective } from '../../../shared/currency/currency-input.directive';
import { MfxCurrencyPipe } from '../../../shared/currency/currency.pipe';

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

// "YYYY-MM-DD" en hora LOCAL, no UTC — new Date().toISOString() corta en
// UTC, que en Bogotá (UTC-5) puede caer en el día anterior cerca de
// medianoche (mismo cuidado que installment-row.spec.ts documenta).
function todayInputValue(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

function rowKey(debt: { movementId: string; installmentIndex: number | null }): string {
  return `${debt.movementId}|${debt.installmentIndex ?? 'null'}`;
}

@Component({
  selector: 'mfx-abono-form',
  imports: [FormsModule, Checkbox, MfxCurrencyInputDirective, MfxCurrencyPipe, DatePipe],
  templateUrl: './abono-form.html',
  styleUrl: './abono-form.scss',
})
export class AbonoForm {
  private readonly settlementsService = inject(SettlementsService);
  private readonly movementsService = inject(MovementsService);
  private readonly accountsService = inject(Accounts);
  private readonly auth = inject(Auth);
  private readonly celebration = inject(Celebration);

  readonly context = input.required<SettlementContext>();
  readonly saved = output<void>();

  readonly currentUid = computed(() => this.auth.currentUser?.uid ?? null);
  // "Vas a registrar que le pagaste a X" (quien paga) vs. "X te pagó a ti"
  // (quien recibe) — el abono siempre va fromUid -> toUid sin importar
  // quién lo registra, solo cambia el texto según quién mira.
  readonly isPayerView = computed(() => this.currentUid() === this.context().fromUid);

  readonly accounts = toSignal(this.accountsService.accounts$, { initialValue: [] });

  private readonly movements = toSignal(
    toObservable(this.context).pipe(switchMap((ctx) => this.movementsService.groupMovements$(ctx.groupId))),
    { initialValue: [] as SharedMovementWithId[] }
  );
  private readonly settlements = toSignal(
    toObservable(this.context).pipe(switchMap((ctx) => this.settlementsService.settlements$(ctx.groupId))),
    { initialValue: [] }
  );
  private readonly movementsById = computed(() => new Map(this.movements().map((m) => [m.id, m])));

  private readonly debts = computed(() => computeDebts(this.movements(), this.settlements()));

  // Deudas de ESTA dirección (fromUid -> toUid) — las que el abono puede
  // cubrir. Decisión de producto: nunca se mira ni se resta la dirección
  // contraria (ver DATABASE.md, "Balance de grupo y abonos" — las deudas
  // no se cruzan). computeDebts() ya las devuelve de más antigua a más
  // reciente.
  readonly rows = computed(() =>
    this.debts().filter((d) => d.debtorUid === this.context().fromUid && d.creditorUid === this.context().toUid)
  );
  readonly unpaidRows = computed(() => this.rows().filter((d) => d.remaining > 0.001));
  readonly paidRows = computed(() => this.rows().filter((d) => d.remaining <= 0.001));

  // Filas agrupadas por gasto, en el mismo orden (más antiguo primero) —
  // para pintar un encabezado de gasto con sus cuotas debajo.
  readonly unpaidByMovement = computed(() => groupDebtsByMovement(this.unpaidRows()));
  readonly paidByMovement = computed(() => groupDebtsByMovement(this.paidRows()));

  readonly showPaidRows = signal(false);
  // "Distribuir un monto" — oculto y secundario por defecto (ver
  // DATABASE.md): el campo + botón de reparto automático solo aparecen si
  // se activa este check.
  readonly showDistribute = signal(false);

  movementFor(movementId: string): SharedMovementWithId | undefined {
    return this.movementsById().get(movementId);
  }

  movementLabel(movementId: string): string {
    const movement = this.movementFor(movementId);
    return movement ? sharedMovementLabel(movement) : 'Gasto eliminado';
  }

  // --- selección: qué deudas se van a cubrir, y con cuánto ---

  // Map<rowKey, monto | 'full'> — 'full' significa "lo que falte de ESTA
  // deuda al momento de escribir, nunca lo que ya se veía acá" (ver
  // DATABASE.md, "Balance de grupo y abonos" — "pagar completo" nunca
  // recalcula fuera de createSettlement()).
  private readonly selection = signal<Map<string, number | 'full'>>(new Map());
  // 'auto' mientras la selección actual salió tal cual de "Distribuir"
  // (o del preselect "Marcar como saldada") y nadie ha tocado una fila a
  // mano todavía; cualquier edición manual lo pasa a 'manual' de forma
  // permanente para esta sesión del modal.
  private readonly allocationMode = signal<'auto' | 'manual'>('manual');
  // Se vuelve true en cuanto el usuario toca algo — apaga el preselect
  // automático para que no le pise encima la selección mientras edita.
  private readonly userTouchedSelection = signal(false);

  isSelected(debt: Debt): boolean {
    return this.selection().has(rowKey(debt));
  }

  resolvedAmount(debt: Debt): number {
    const value = this.selection().get(rowKey(debt));
    if (value === undefined) {
      return 0;
    }
    return value === 'full' ? debt.remaining : value;
  }

  toggleRow(debt: Debt): void {
    this.userTouchedSelection.set(true);
    if (this.isSelected(debt)) {
      this.removeFromSelection(debt);
      this.allocationMode.set('manual');
      return;
    }
    this.setFull(debt);
  }

  setFull(debt: Debt): void {
    this.userTouchedSelection.set(true);
    this.allocationMode.set('manual');
    const next = new Map(this.selection());
    next.set(rowKey(debt), 'full');
    this.selection.set(next);
  }

  // Mientras el campo tiene foco, 0 es un valor transitorio válido — la
  // fila SIGUE seleccionada (con monto 0, no cuenta para el total) para
  // que el input no desaparezca a medio escribir. Solo onAmountBlur()
  // decide si, al salir con 0, la fila se desmarca sola.
  setAmount(debt: Debt, raw: number): void {
    this.userTouchedSelection.set(true);
    this.allocationMode.set('manual');
    const clamped = Math.min(Math.max(raw, 0), debt.remaining);
    const next = new Map(this.selection());
    // Si lo que escribió coincide con el remaining, lo trata como "completo"
    // (mismo criterio que "Pagar completo") — evita un remaining de 0.01
    // fantasma por redondeo si el valor mostrado y el real difieren un
    // centavo entre el render y el submit.
    next.set(rowKey(debt), clamped > 0 && Math.abs(clamped - debt.remaining) < 0.005 ? 'full' : round2(clamped));
    this.selection.set(next);
  }

  onAmountBlur(debt: Debt): void {
    if (this.resolvedAmount(debt) <= 0) {
      this.removeFromSelection(debt);
    }
  }

  private removeFromSelection(debt: Debt): void {
    const next = new Map(this.selection());
    next.delete(rowKey(debt));
    this.selection.set(next);
  }

  // --- total (solo lectura) y "Distribuir un monto" (oculto, secundario) ---

  readonly total = computed(() =>
    round2(this.rows().reduce((sum, debt) => (this.isSelected(debt) ? sum + this.resolvedAmount(debt) : sum), 0))
  );

  readonly autoDistributeAmount = signal(0);
  readonly autoDistributeError = signal<string | null>(null);

  // Reemplaza la selección actual por completo.
  distributeAutomatic(): void {
    this.userTouchedSelection.set(true);
    this.applyAutoDistribution(this.autoDistributeAmount());
  }

  private applyAutoDistribution(amount: number): boolean {
    const plan = autoAllocateOldestFirst(this.unpaidRows(), this.context().fromUid, this.context().toUid, amount);
    if (!plan) {
      this.autoDistributeError.set('Ese monto supera lo que se debe en total.');
      return false;
    }
    this.autoDistributeError.set(null);
    this.allocationMode.set('auto');
    const next = new Map<string, number | 'full'>();
    for (const item of plan) {
      const debt = this.unpaidRows().find((d) => d.movementId === item.movementId && d.installmentIndex === item.installmentIndex);
      const isFull = !!debt && Math.abs(item.amount - debt.remaining) < 0.005;
      next.set(rowKey(item), isFull ? 'full' : item.amount);
    }
    this.selection.set(next);
    return true;
  }

  // --- preselect (ver DATABASE.md, "Balance de grupo y abonos") ---
  // Se reaplica mientras el usuario no haya tocado nada: las filas salen
  // de datos vivos (toSignal), así que la primera emisión puede llegar
  // vacía antes de la real — reintentar hasta que haya algo que
  // seleccionar evita quedar con el modal vacío por una carrera de carga.
  constructor() {
    effect(() => {
      if (this.userTouchedSelection()) {
        return;
      }
      const preselect = this.context().preselect;
      const rows = this.unpaidRows();

      if (preselect.mode === 'empty') {
        return;
      }
      if (preselect.mode === 'installment') {
        const debt = rows.find(
          (d) => d.movementId === preselect.movementId && d.installmentIndex === preselect.installmentIndex
        );
        if (debt) {
          this.allocationMode.set('manual');
          const next = new Map<string, number | 'full'>();
          next.set(rowKey(debt), 'full');
          this.selection.set(next);
        }
        return;
      }
      // 'auto-total': TODAS las deudas pendientes de esta dirección,
      // preseleccionadas por su remaining — nunca se resta la dirección
      // contraria (ver DATABASE.md: las deudas no se cruzan).
      const total = round2(rows.reduce((sum, d) => sum + d.remaining, 0));
      if (total > 0) {
        this.autoDistributeAmount.set(total);
        this.applyAutoDistribution(total);
      }
    });
  }

  // --- vista previa ---

  previewStatusFor(debt: Debt): 'parcial' | 'pagada' {
    return round2(debt.remaining - this.resolvedAmount(debt)) <= 0.001 ? 'pagada' : 'parcial';
  }

  previewRemainingFor(debt: Debt): number {
    return Math.max(0, round2(debt.remaining - this.resolvedAmount(debt)));
  }

  // Cuánto le seguirá debiendo fromUid a toUid EN ESTA DIRECCIÓN tras el
  // abono — nunca un neto: la dirección contraria (si existe) ni se mira.
  readonly totalPendingThisDirection = computed(() => round2(this.unpaidRows().reduce((sum, d) => sum + d.remaining, 0)));
  readonly remainingAfter = computed(() => Math.max(0, round2(this.totalPendingThisDirection() - this.total())));

  // --- registrar también como movimiento personal (igual que antes) ---

  readonly registerPersonalMovement = signal(false);
  readonly accountId = signal('');

  // --- nota / fecha ---

  readonly note = signal('');
  readonly date = signal(todayInputValue());

  // --- envío ---

  readonly saving = signal(false);
  readonly errorMessage = signal<string | null>(null);

  readonly canSubmit = computed(() => {
    if (this.saving()) {
      return false;
    }
    if (this.selection().size === 0 || this.total() <= 0) {
      return false;
    }
    if (this.registerPersonalMovement() && !this.accountId()) {
      return false;
    }
    return this.rows().every((debt) => !this.isSelected(debt) || this.resolvedAmount(debt) <= debt.remaining + 0.005);
  });

  private buildAllocations(): AllocationRequest[] {
    return this.rows()
      .filter((debt) => this.isSelected(debt))
      .map((debt) => {
        const value = this.selection().get(rowKey(debt));
        const base = { movementId: debt.movementId, debtorUid: debt.debtorUid, installmentIndex: debt.installmentIndex };
        return value === 'full' ? { ...base, full: true as const } : { ...base, amount: value as number };
      });
  }

  async submit(): Promise<void> {
    if (!this.canSubmit()) {
      return;
    }

    this.saving.set(true);
    this.errorMessage.set(null);

    const context = this.context();
    const base = {
      groupId: context.groupId,
      fromUid: context.fromUid,
      toUid: context.toUid,
      note: this.note(),
      personalMovementAccountId: this.registerPersonalMovement() ? this.accountId() : null,
      date: new Date(`${this.date()}T00:00:00`),
    };
    // 'auto' sin tocar nada: se manda tal cual al servicio, que vuelve a
    // repartir fresco al escribir (más robusto que mandar la selección de
    // la UI, que puede haber quedado un instante desactualizada). Cualquier
    // edición manual (incluida una sola cuota) manda allocations explícitas.
    const input: CreateSettlementInput =
      this.allocationMode() === 'auto'
        ? { ...base, allocationMode: 'auto', amount: this.total() }
        : { ...base, allocationMode: 'manual', allocations: this.buildAllocations() };

    try {
      await this.settlementsService.createSettlement(input);
      await this.celebration.celebrate();
      this.saved.emit();
    } catch (error) {
      if (error instanceof StaleDebtError) {
        this.errorMessage.set('Esto cambió mientras llenabas el formulario — ya actualizamos los montos, revísalos e intenta de nuevo.');
        this.selection.set(new Map());
        this.userTouchedSelection.set(false);
      } else {
        console.error('Error al registrar el abono', error);
        this.errorMessage.set('No pudimos registrar el abono. Intenta de nuevo.');
      }
    } finally {
      this.saving.set(false);
    }
  }
}
