import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Haptics, ImpactStyle } from '@capacitor/haptics';

import { Accounts } from '../../../core/accounts/accounts';
import { Categories } from '../../../core/categories/categories';
import { CategoryFormState } from '../../../core/category-form-state/category-form-state';
import { matchCategory } from '../../../core/receipt-category-match/receipt-category-match';
import { ReceiptReader, type ReceiptExtraction } from '../../../core/receipt-reader/receipt-reader';
import { MovementsService, type PersonalMovementWithId } from '../../../core/movements/movements';
import { AttachmentPicker, type PendingAttachment } from '../../../shared/attachment-picker/attachment-picker';
import { MfxCurrencyInputDirective } from '../../../shared/currency/currency-input.directive';
import type { MovementType } from '../../../models/movement.model';

type AiFillableField = 'amount' | 'date' | 'categoryId' | 'note';

function toDateInputValue(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// Combina la fecha elegida en el <input type="date"> con la hora actual —
// si se deja el valor por defecto (hoy, sin tocar el campo) el movimiento
// queda con el instante real de creación en vez de medianoche; si se elige
// una fecha pasada, conserva esa fecha con la hora actual (no hay forma de
// saber la hora real de un gasto pasado, pero al menos no queda en 00:00).
function combineDateWithCurrentTime(dateInputValue: string): Date {
  const [year, month, day] = dateInputValue.split('-').map(Number);
  const now = new Date();
  return new Date(year, month - 1, day, now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds());
}

const MOVEMENT_TYPES: { value: MovementType; label: string }[] = [
  { value: 'expense', label: 'Gasto' },
  { value: 'income', label: 'Ingreso' },
];

// Valor sentinel para la opción "+ Nueva categoría" del <select>: nunca es
// un id de categoría real, así que nunca debe quedar como valor final del
// control (se revierte apenas se detecta, ver el effect correspondiente).
const NEW_CATEGORY_OPTION = '__new_category__';

@Component({
  selector: 'mfx-movement-form',
  imports: [ReactiveFormsModule, MfxCurrencyInputDirective, AttachmentPicker],
  templateUrl: './movement-form.html',
  styleUrl: './movement-form.scss',
})
export class MovementForm {
  private readonly movements = inject(MovementsService);
  private readonly accountsService = inject(Accounts);
  private readonly categoriesService = inject(Categories);
  private readonly categoryFormState = inject(CategoryFormState);
  private readonly receiptReader = inject(ReceiptReader);
  private readonly fb = inject(FormBuilder);

  readonly initialValue = input<PersonalMovementWithId | null>(null);
  // Solo aplica en modo create — etiqueta el movimiento a un grupo type:
  // 'personal' (ver MovementFormState). Ignorado si initialValue está
  // presente (editar nunca cambia el groupId de un movimiento existente).
  readonly groupId = input<string | null>(null);
  readonly saved = output<void>();
  readonly deleted = output<void>();

  readonly movementTypes = MOVEMENT_TYPES;
  readonly newCategoryOption = NEW_CATEGORY_OPTION;
  readonly accounts = toSignal(this.accountsService.accounts$, { initialValue: [] });
  readonly categories = toSignal(this.categoriesService.categories$, { initialValue: [] });

  readonly saving = signal(false);
  readonly deleting = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly categoryError = signal<string | null>(null);
  readonly pendingAttachment = signal<PendingAttachment | null>(null);
  // Una vez create()/update() resuelve, queda fijo — reintentar submit()
  // (p. ej. si solo falló subir el adjunto) nunca debe volver a crear ni a
  // reaplicar el ajuste de balance de la cuenta una segunda vez.
  private readonly savedMovementId = signal<string | null>(null);

  // "Eliminar" del adjunto ya guardado (ver AttachmentPicker,
  // existingRemoved) — lo borra el padre (acá), nunca el picker. Esta
  // bandera local es lo que le permite al picker dejar de mostrarlo sin
  // esperar a que initialValue() se refresque desde Firestore.
  readonly removingAttachment = signal(false);
  private readonly attachmentRemovedOverride = signal(false);
  readonly existingAttachmentPath = computed(() =>
    this.attachmentRemovedOverride() ? null : (this.initialValue()?.attachmentPath ?? null)
  );

  // Lectura automática del recibo (ver ReceiptReader) — solo en modo
  // creación (ver onAttachmentReady()). receiptNote() es el "mensaje
  // discreto" para fallo/confianza baja — a propósito NO usa errorMessage()
  // (esa es roja, para fallas de guardado; esto nunca debe sentirse como un
  // error real, solo como "complétalo tú").
  readonly receiptReading = signal(false);
  readonly receiptNote = signal<string | null>(null);
  private receiptReadAbortController: AbortController | null = null;
  // Snapshot de los valores que puso la IA (no solo qué campos) — el ✨ de
  // un campo desaparece apenas el usuario lo cambia a algo distinto,
  // comparando el valor actual contra lo que se guardó acá (ver
  // isAiFilled()), sin depender de orquestar manualmente emitEvent:false.
  private readonly aiFilledSnapshot = signal<Partial<Record<AiFillableField, unknown>>>({});

  readonly form = this.fb.nonNullable.group({
    type: ['expense' as MovementType, Validators.required],
    amount: [0, [Validators.required, Validators.min(0.01)]],
    accountId: ['', Validators.required],
    categoryId: ['', Validators.required],
    date: [toDateInputValue(new Date()), Validators.required],
    note: [''],
  });

  readonly typeValue = toSignal(this.form.controls.type.valueChanges, {
    initialValue: this.form.controls.type.value,
  });

  private readonly categoryIdValue = toSignal(this.form.controls.categoryId.valueChanges, {
    initialValue: this.form.controls.categoryId.value,
  });

  readonly filteredCategories = computed(() => this.categories().filter((c) => c.type === this.typeValue()));

  // savedMovementId() solo queda fijo mientras el formulario sigue abierto
  // en el escenario de "se guardó el movimiento, falló el adjunto" (en el
  // camino feliz saved.emit() cierra el formulario antes de que esto
  // importe) — por eso alcanza para cambiarle la etiqueta al botón y que
  // el reintento se sienta como lo que es, no como un segundo "Guardar".
  readonly attachmentRetryPending = computed(() => this.savedMovementId() !== null);

  isAiFilled(field: AiFillableField): boolean {
    const snapshot = this.aiFilledSnapshot();
    return field in snapshot && this.form.controls[field].value === snapshot[field];
  }

  constructor() {
    effect(() => {
      const existing = this.initialValue();
      if (existing) {
        this.form.patchValue({
          type: existing.type,
          amount: existing.amount,
          accountId: existing.accountId,
          // Un movimiento personal nunca llega con categoryId null (este
          // formulario siempre la exige) — el ?? '' es solo para el tipo,
          // que ahora es string | null a nivel de modelo porque lo comparte
          // con SharedMovement (categoría opcional, ver movement.model.ts).
          categoryId: existing.categoryId ?? '',
          date: toDateInputValue(existing.date.toDate()),
          note: existing.note,
        });
      }
    });

    // El <select> de categoría usa un valor sentinel para "+ Nueva
    // categoría" en vez de un botón aparte. Al elegirlo, abrimos el modal
    // de categoría (vive a nivel de Shell desde Fase 3, ya resuelto el
    // problema de position:fixed dentro de Swiper) y revertimos el valor
    // sentinel sin emitir el cambio, para que nunca cuente como selección
    // real ni dispare la validación del campo.
    effect(() => {
      if (this.categoryIdValue() === NEW_CATEGORY_OPTION) {
        this.categoryFormState.openCreate();
        this.form.controls.categoryId.setValue('', { emitEvent: false });
      }
    });

    // Sincronizamos también el tipo del movimiento con el de la categoría
    // nueva: si no coincidieran, filteredCategories() (filtrada por tipo)
    // no la incluiría y submit() la rechazaría con el error de categoría
    // inválida en vez de dejarla auto-seleccionada de verdad.
    effect(() => {
      const saved = this.categoryFormState.lastSaved();
      if (saved) {
        this.form.patchValue({ type: saved.type, categoryId: saved.id });
        this.categoryFormState.clearLastSaved();
      }
    });
  }

  selectType(type: MovementType): void {
    if (this.form.controls.type.value === type) {
      return;
    }
    this.form.controls.type.setValue(type);
    void this.buzz();
  }

  // Reemplaza el (attachmentReady) directo a pendingAttachment.set() de
  // antes — además de guardar el adjunto como siempre, dispara (o corta)
  // la lectura automática. Cualquier cambio del adjunto (uno nuevo, o
  // quitarlo) corta de una una lectura en curso: nunca debe aplicarle a un
  // campo el resultado de leer una foto que el usuario ya reemplazó.
  onAttachmentReady(pending: PendingAttachment | null): void {
    this.pendingAttachment.set(pending);
    this.cancelReceiptRead();

    // Solo en modo creación (ver conversación) — editar un movimiento que
    // ya tiene sus datos reales no debe pisarlos porque se adjuntó un
    // recibo nuevo. AttachmentPicker tampoco calcula aiPreview en modo
    // edición ([prepareAiPreview]="!initialValue()", ver el template), así
    // que esto es más que todo un segundo seguro.
    if (!pending?.aiPreview || this.initialValue()) {
      return;
    }
    void this.readReceipt(pending.aiPreview);
  }

  cancelReceiptRead(): void {
    this.receiptReadAbortController?.abort();
    this.receiptReadAbortController = null;
    this.receiptReading.set(false);
    this.receiptNote.set(null);
  }

  private async readReceipt(preview: NonNullable<PendingAttachment['aiPreview']>): Promise<void> {
    const controller = new AbortController();
    this.receiptReadAbortController = controller;
    this.receiptReading.set(true);
    this.receiptNote.set(null);

    try {
      const result = await this.receiptReader.extract(preview, { signal: controller.signal });
      if (controller.signal.aborted) {
        return;
      }
      // confidence 'low' cae en silencio a entrada manual — con un mensaje
      // discreto, nunca un error rojo (nunca bloquea al usuario). No
      // parchea NADA: un campo a medias es peor que ninguno.
      if (result.confidence === 'low') {
        this.receiptNote.set('No pudimos leer bien el recibo — completa los datos a mano.');
        return;
      }
      this.applyReceiptExtraction(result);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return; // cancelado por el usuario, o por un adjunto nuevo/quitado — nunca es un error.
      }
      console.error('Error al leer el recibo automáticamente', error);
      this.receiptNote.set('No pudimos leer el recibo automáticamente — completa los datos a mano.');
    } finally {
      if (this.receiptReadAbortController === controller) {
        this.receiptReading.set(false);
        this.receiptReadAbortController = null;
      }
    }
  }

  // Parchea SOLO los campos que el usuario todavía no tocó (control.pristine)
  // — si ya empezaste a escribir el monto a mano mientras la IA leía, eso
  // queda tal cual. categoryId nunca se fuerza: solo se autoselecciona si
  // matchCategory() encuentra un match con confianza real (ver
  // receipt-category-match.ts) — type nunca se toca a propósito, ya arranca
  // en 'expense' por defecto, que es lo que un recibo casi siempre es.
  private applyReceiptExtraction(result: ReceiptExtraction): void {
    const snapshot: Partial<Record<AiFillableField, unknown>> = {};

    if (this.form.controls.amount.pristine && result.amount !== null && result.amount > 0) {
      this.form.controls.amount.setValue(result.amount);
      snapshot.amount = result.amount;
    }
    if (this.form.controls.date.pristine && result.date && /^\d{4}-\d{2}-\d{2}$/.test(result.date)) {
      this.form.controls.date.setValue(result.date);
      snapshot.date = result.date;
    }
    if (this.form.controls.note.pristine && result.merchant) {
      const items = result.lineItems?.length
        ? ` — ${result.lineItems
            .slice(0, 5)
            .map((item) => item.description)
            .join(', ')}`
        : '';
      const note = `${result.merchant}${items}`;
      this.form.controls.note.setValue(note);
      snapshot.note = note;
    }
    if (this.form.controls.categoryId.pristine && this.categories().length > 0) {
      const matchedId = matchCategory(result.suggestedCategory, this.filteredCategories());
      if (matchedId) {
        this.form.controls.categoryId.setValue(matchedId);
        snapshot.categoryId = matchedId;
      }
    }

    this.aiFilledSnapshot.set(snapshot);
  }

  async onExistingAttachmentRemoved(): Promise<void> {
    const existing = this.initialValue();
    if (!existing?.attachmentPath) {
      return;
    }

    this.removingAttachment.set(true);
    this.errorMessage.set(null);
    try {
      await this.movements.removeAttachment(existing.id, existing.attachmentPath);
      this.attachmentRemovedOverride.set(true);
    } catch (error) {
      console.error('Error al eliminar el adjunto', error);
      this.errorMessage.set('No pudimos eliminar el adjunto. Intenta de nuevo.');
    } finally {
      this.removingAttachment.set(false);
    }
  }

  async submit(): Promise<void> {
    // La categoría se valida acá, no reactivamente: categories() carga de
    // forma async y arranca vacío en cada instancia nueva del componente,
    // así que un effect que reaccionara a filteredCategories() cambiando
    // podría ver una lista todavía vacía y borrar un categoryId que en
    // realidad sí era válido (la carrera que rompía "editar movimiento").
    // Si categories() sigue vacío, todavía no hay datos para juzgar — se
    // deja pasar y que Validators.required actúe si el campo está vacío.
    const categoryId = this.form.controls.categoryId.value;
    const categoriesLoaded = this.categories().length > 0;
    if (categoryId && categoriesLoaded && !this.filteredCategories().some((c) => c.id === categoryId)) {
      this.categoryError.set('La categoría seleccionada no es válida para este tipo, elige otra.');
      return;
    }
    this.categoryError.set(null);

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.saving.set(true);
    this.errorMessage.set(null);
    const raw = this.form.getRawValue();
    const value = { ...raw, date: combineDateWithCurrentTime(raw.date) };

    try {
      // Ya guardado (p. ej. reintentando después de que solo falló el
      // adjunto) — no se vuelve a crear/actualizar ni a re-ajustar el
      // balance de la cuenta una segunda vez.
      let movementId = this.savedMovementId();
      if (!movementId) {
        const existing = this.initialValue();
        if (existing) {
          await this.movements.update(existing.id, existing, value);
          movementId = existing.id;
        } else {
          movementId = await this.movements.create(value, this.groupId());
        }
        this.savedMovementId.set(movementId);
      }

      // Se sube DESPUÉS de crear/actualizar a propósito — ver
      // MovementsService.attachFile() (la regla de Storage necesita que el
      // documento ya exista para saber quién es su dueño).
      const pending = this.pendingAttachment();
      if (pending) {
        await this.movements.attachFile(movementId, pending);
      }
      this.saved.emit();
    } catch (error) {
      console.error('Error al guardar el movimiento', error);
      this.errorMessage.set(
        this.savedMovementId()
          ? 'Guardamos el movimiento, pero no pudimos subir el archivo adjunto. Intenta de nuevo.'
          : 'No pudimos guardar el movimiento. Intenta de nuevo.'
      );
    } finally {
      this.saving.set(false);
    }
  }

  async remove(): Promise<void> {
    const existing = this.initialValue();
    if (!existing) {
      return;
    }

    this.deleting.set(true);
    this.errorMessage.set(null);

    try {
      await this.movements.remove(existing.id, existing);
      this.deleted.emit();
    } catch (error) {
      console.error('Error al eliminar el movimiento', error);
      this.errorMessage.set('No pudimos eliminar el movimiento.');
    } finally {
      this.deleting.set(false);
    }
  }

  private async buzz(): Promise<void> {
    try {
      await Haptics.impact({ style: ImpactStyle.Light });
    } catch {
      // Sin soporte háptico (navegador de escritorio) — no bloquea la UI.
    }
  }
}
