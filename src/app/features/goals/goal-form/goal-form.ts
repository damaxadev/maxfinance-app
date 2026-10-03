import { Component, effect, inject, output, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';

import { GroupsService } from '../../../core/groups/groups';
import type { GoalMode, GoalReminderFrequency } from '../../../models/group.model';
import { MfxCurrencyInputDirective } from '../../../shared/currency/currency-input.directive';

type ReminderOption = 'none' | GoalReminderFrequency;

const REMINDER_OPTIONS: { value: ReminderOption; label: string }[] = [
  { value: 'none', label: 'Sin recordatorio' },
  { value: 'weekly', label: 'Semanal' },
  { value: 'biweekly', label: 'Quincenal' },
  { value: 'monthly', label: 'Mensual' },
];

const GOAL_MODES: { value: GoalMode; label: string; description: string }[] = [
  { value: 'target', label: 'Con monto objetivo', description: 'Progreso hacia un monto fijo que eliges ahora.' },
  {
    value: 'open-ended',
    label: 'Solo ir ahorrando',
    description: 'Sin monto final — celebra cada cierto monto, de forma continua.',
  },
];

// Sugerencia editable para "monto de celebración" en modo 'open-ended' —
// ver el pedido explícito del usuario, no es el monto final de nada.
const DEFAULT_CELEBRATION_AMOUNT = 1000000;

@Component({
  selector: 'mfx-goal-form',
  imports: [ReactiveFormsModule, MfxCurrencyInputDirective],
  templateUrl: './goal-form.html',
  styleUrl: './goal-form.scss',
})
export class GoalForm {
  private readonly groups = inject(GroupsService);
  private readonly fb = inject(FormBuilder);

  readonly saved = output<void>();

  readonly goalModes = GOAL_MODES;
  readonly reminderOptions = REMINDER_OPTIONS;
  readonly saving = signal(false);
  readonly errorMessage = signal<string | null>(null);

  // goalMode es fijo de por vida una vez creada la meta (ver GroupsService.
  // createGoal) — acá solo se elige una vez, al crear.
  readonly form = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.minLength(2)]],
    goalMode: ['target' as GoalMode, Validators.required],
    targetAmount: [0],
    celebrationAmount: [DEFAULT_CELEBRATION_AMOUNT],
    targetDate: [''],
    reminderFrequency: ['none' as ReminderOption],
    reminderSuggestedAmount: [0],
  });

  readonly goalModeValue = toSignal(this.form.controls.goalMode.valueChanges, {
    initialValue: this.form.controls.goalMode.value,
  });
  readonly reminderFrequencyValue = toSignal(this.form.controls.reminderFrequency.valueChanges, {
    initialValue: this.form.controls.reminderFrequency.value,
  });

  constructor() {
    // Solo el monto del modo activo es obligatorio — el del otro modo
    // queda sin validar (su valor nunca se envía, ver submit(): siempre
    // descarta el campo del modo no elegido, aunque el control conserve
    // lo que haya quedado tecleado ahí de antes de cambiar de modo).
    effect(() => {
      if (this.goalModeValue() === 'target') {
        this.form.controls.targetAmount.setValidators([Validators.required, Validators.min(1)]);
        this.form.controls.celebrationAmount.clearValidators();
      } else {
        this.form.controls.celebrationAmount.setValidators([Validators.required, Validators.min(1)]);
        this.form.controls.targetAmount.clearValidators();
      }
      this.form.controls.targetAmount.updateValueAndValidity({ emitEvent: false });
      this.form.controls.celebrationAmount.updateValueAndValidity({ emitEvent: false });
    });
  }

  selectGoalMode(mode: GoalMode): void {
    this.form.controls.goalMode.setValue(mode);
  }

  async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.saving.set(true);
    this.errorMessage.set(null);
    const raw = this.form.getRawValue();
    const reminderFrequency = raw.reminderFrequency === 'none' ? null : raw.reminderFrequency;

    try {
      await this.groups.createGoal({
        name: raw.name,
        goalMode: raw.goalMode,
        targetAmount: raw.goalMode === 'target' ? raw.targetAmount : null,
        celebrationAmount: raw.goalMode === 'open-ended' ? raw.celebrationAmount : null,
        // Mediodía local, no medianoche UTC (ver installment-row.spec.ts
        // para el mismo caso) — evita que una zona con offset negativo
        // (Bogotá, UTC-5) lea un día antes al convertir de vuelta.
        targetDate: raw.targetDate ? new Date(`${raw.targetDate}T12:00:00`) : null,
        reminderFrequency,
        reminderSuggestedAmount: reminderFrequency && raw.reminderSuggestedAmount > 0 ? raw.reminderSuggestedAmount : null,
      });
      this.saved.emit();
    } catch (error) {
      console.error('Error al crear la meta de ahorro', error);
      this.errorMessage.set('No pudimos crear la meta. Intenta de nuevo.');
    } finally {
      this.saving.set(false);
    }
  }
}
