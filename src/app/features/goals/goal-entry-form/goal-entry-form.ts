import { Component, computed, inject, input, output, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { switchMap } from 'rxjs';

import { Celebration } from '../../../core/celebration/celebration';
import type { GoalEntryContext } from '../../../core/goal-entry-form-state/goal-entry-form-state';
import { GoalEntriesService } from '../../../core/goal-entries/goal-entries';
import {
  computeGoalPercentage,
  computeGoalSavedAmount,
  crossedMilestones,
  crossedOpenEndedMilestones,
  newlyReachedMilestones,
} from '../../../core/goal-progress/goal-progress';
import { GroupsService } from '../../../core/groups/groups';
import type { GoalEntryType } from '../../../models/goal-entry.model';
import { AttachmentPicker, type PendingAttachment } from '../../../shared/attachment-picker/attachment-picker';
import { MfxCurrencyInputDirective } from '../../../shared/currency/currency-input.directive';

function toDateInputValue(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// Mismo criterio que SharedExpenseForm/MovementForm (duplicado a propósito,
// ver esos archivos): si se deja la fecha por defecto (hoy), el aporte
// queda con la hora real del momento en vez de medianoche.
function combineDateWithCurrentTime(dateInputValue: string): Date {
  const [year, month, day] = dateInputValue.split('-').map(Number);
  const now = new Date();
  return new Date(year, month - 1, day, now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds());
}

const ENTRY_TYPES: { value: GoalEntryType; label: string }[] = [
  { value: 'contribution', label: 'Aporte' },
  { value: 'withdrawal', label: 'Retiro' },
];

@Component({
  selector: 'mfx-goal-entry-form',
  imports: [ReactiveFormsModule, MfxCurrencyInputDirective, AttachmentPicker],
  templateUrl: './goal-entry-form.html',
  styleUrl: './goal-entry-form.scss',
})
export class GoalEntryForm {
  private readonly goalEntriesService = inject(GoalEntriesService);
  private readonly groupsService = inject(GroupsService);
  private readonly celebration = inject(Celebration);
  private readonly fb = inject(FormBuilder);

  readonly context = input.required<GoalEntryContext>();
  readonly saved = output<void>();

  readonly entryTypes = ENTRY_TYPES;
  readonly saving = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly pendingAttachment = signal<PendingAttachment | null>(null);
  // Una vez create() resuelve, queda fijo — reintentar submit() (p. ej. si
  // solo falló subir el adjunto) nunca debe volver a crear la entrada ni a
  // re-evaluar hitos/confetti una segunda vez (ver submit()).
  private readonly savedEntryId = signal<string | null>(null);
  // Ver movement-form.ts para el mismo criterio: solo queda en true mientras
  // el formulario sigue abierto tras "se guardó el movimiento, falló el
  // adjunto".
  readonly attachmentRetryPending = computed(() => this.savedEntryId() !== null);

  private readonly groups = toSignal(this.groupsService.groups$, { initialValue: [] });
  private readonly group = computed(() => this.groups().find((g) => g.id === this.context().groupId) ?? null);

  private readonly entries = toSignal(
    toObservable(this.context).pipe(switchMap((context) => this.goalEntriesService.entries$(context.groupId))),
    { initialValue: [] }
  );

  readonly form = this.fb.nonNullable.group({
    type: ['contribution' as GoalEntryType, Validators.required],
    amount: [0, [Validators.required, Validators.min(0.01)]],
    date: [toDateInputValue(new Date()), Validators.required],
    note: [''],
  });

  readonly typeValue = toSignal(this.form.controls.type.valueChanges, { initialValue: this.form.controls.type.value });

  selectType(type: GoalEntryType): void {
    this.form.controls.type.setValue(type);
  }

  async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.saving.set(true);
    this.errorMessage.set(null);
    const raw = this.form.getRawValue();
    const context = this.context();

    try {
      // Ya creada (p. ej. reintentando después de que solo falló el
      // adjunto) — no se vuelve a crear ni a re-evaluar hitos/confetti.
      let entryId = this.savedEntryId();
      if (!entryId) {
        const group = this.group();
        const alreadyReached = group?.reachedMilestones ?? [];
        const savedBefore = computeGoalSavedAmount(this.entries());

        entryId = await this.goalEntriesService.create({
          groupId: context.groupId,
          type: raw.type,
          amount: raw.amount,
          date: combineDateWithCurrentTime(raw.date),
          note: raw.note,
        });
        this.savedEntryId.set(entryId);

        const savedAfter = computeGoalSavedAmount([...this.entries(), { type: raw.type, amount: raw.amount }]);
        // Cada hito se celebra una sola vez en la vida de la meta — el
        // "antes"/"después" se calcula en el momento (sin esperar al
        // listener en vivo de entries$, evitaría una carrera) pero lo
        // cruzado se filtra contra Group.reachedMilestones (ya persistido,
        // ver newlyReachedMilestones en goal-progress.ts) antes de celebrar
        // o de guardar nada nuevo.
        const crossed =
          group?.goalMode === 'open-ended'
            ? crossedOpenEndedMilestones(savedBefore, savedAfter, group.celebrationAmount ?? 0)
            : crossedMilestones(
                computeGoalPercentage(savedBefore, group?.targetAmount ?? 0),
                computeGoalPercentage(savedAfter, group?.targetAmount ?? 0)
              );
        const newMilestones = newlyReachedMilestones(crossed, alreadyReached);

        if (newMilestones.length > 0) {
          await this.groupsService.markMilestonesReached(context.groupId, newMilestones);
          await this.celebration.celebrate();
        }
      }

      // Se sube DESPUÉS de crear la entrada a propósito — ver
      // GoalEntriesService.attachFile() (la regla de Storage necesita que
      // el documento ya exista para saber quién es su dueño).
      const pending = this.pendingAttachment();
      if (pending) {
        await this.goalEntriesService.attachFile(entryId, pending);
      }
      this.saved.emit();
    } catch (error) {
      console.error('Error al registrar el movimiento de la meta', error);
      this.errorMessage.set(
        this.savedEntryId()
          ? 'Guardamos el movimiento, pero no pudimos subir el archivo adjunto. Intenta de nuevo.'
          : 'No pudimos registrar el movimiento. Intenta de nuevo.'
      );
    } finally {
      this.saving.set(false);
    }
  }
}
