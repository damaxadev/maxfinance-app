import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Timestamp } from 'firebase/firestore';
import { of, switchMap } from 'rxjs';

import { Accounts } from '../../../core/accounts/accounts';
import { ActiveGroup } from '../../../core/active-group/active-group';
import { Auth } from '../../../core/auth/auth';
import { Categories } from '../../../core/categories/categories';
import { isSharedMovementLocked } from '../../../core/group-balance/group-balance';
import { GroupsService, type GroupMemberProfile } from '../../../core/groups/groups';
import { ModalStack } from '../../../core/modal-stack/modal-stack';
import { MovementsService, type SharedMovementWithId } from '../../../core/movements/movements';
import { matchCategory } from '../../../core/receipt-category-match/receipt-category-match';
import { ReceiptReader, type ReceiptExtraction } from '../../../core/receipt-reader/receipt-reader';
import { SettlementsService } from '../../../core/settlements/settlements';
import { SharedExpenseFormState } from '../../../core/shared-expense-form-state/shared-expense-form-state';
import type { Installment, MovementSplit, SplitType } from '../../../models/movement.model';
import { AttachmentPicker, type PendingAttachment } from '../../../shared/attachment-picker/attachment-picker';
import { Avatar } from '../../../shared/avatar/avatar';
import { Checkbox } from '../../../shared/checkbox/checkbox';
import { InstallmentRow } from '../../../shared/installment-row/installment-row';
import { MfxCurrencyInputDirective } from '../../../shared/currency/currency-input.directive';
import { MfxCurrencyPipe } from '../../../shared/currency/currency.pipe';

function toDateInputValue(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// Combina la fecha elegida en el <input type="date"> con la hora actual —
// si se deja el valor por defecto (hoy, sin tocar el campo) el gasto queda
// con el instante real de creación en vez de medianoche; si se elige una
// fecha pasada, conserva esa fecha con la hora actual (no hay forma de
// saber la hora real de un gasto pasado, pero al menos no queda en 00:00).
function combineDateWithCurrentTime(dateInputValue: string): Date {
  const [year, month, day] = dateInputValue.split('-').map(Number);
  const now = new Date();
  return new Date(year, month - 1, day, now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds());
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

// Reparte amount entre members sin dejar residuo de redondeo: la suma de
// los splits siempre coincide exactamente con amount (el resto de unos
// pocos centavos se lo lleva el primero de la lista).
function distributeEqually(amount: number, uids: string[]): MovementSplit[] {
  if (uids.length === 0) {
    return [];
  }
  const base = Math.floor((amount / uids.length) * 100) / 100;
  const splits = uids.map((uid) => ({ uid, amount: base, settled: false }));
  const remainder = round2(amount - base * uids.length);
  if (remainder > 0) {
    splits[0].amount = round2(splits[0].amount + remainder);
  }
  return splits;
}

const SPLIT_TYPES: { value: SplitType; label: string }[] = [
  { value: 'equal', label: 'Igual' },
  { value: 'percentage', label: 'Porcentaje' },
  { value: 'fixed', label: 'Monto fijo' },
];

type SplitInputGroup = FormGroup<{ uid: FormControl<string>; value: FormControl<number> }>;

// Lo ÚNICO que la IA puede prellenar (ver conversación) — paidBy, splitType
// y las cuotas NUNCA se tocan, esos los pone siempre el usuario.
type AiFillableField = 'amount' | 'date' | 'categoryId' | 'note';

type InstallmentMode = 'equal' | 'fixed';

const INSTALLMENT_MODES: { value: InstallmentMode; label: string }[] = [
  { value: 'equal', label: 'Partes iguales' },
  { value: 'fixed', label: 'Valor fijo por cuota' },
];

// Mismo residuo-al-primero que distributeEqually, pero sobre un conteo de
// cuotas en vez de uids de miembros — no se reusa esa función porque su
// forma de retorno (MovementSplit, con uid/settled) no aplica acá.
function distributeAmountEqually(total: number, count: number): number[] {
  const base = Math.floor((total / count) * 100) / 100;
  const amounts = Array.from({ length: count }, () => base);
  const remainder = round2(total - base * count);
  if (remainder > 0) {
    amounts[0] = round2(amounts[0] + remainder);
  }
  return amounts;
}

// Mismo fix de fin de mes que addMonthsClamped en functions/src/index.ts —
// duplicado a propósito, los dos son proyectos TS separados sin import
// compartido posible (mismo caso ya documentado ahí para los ids de canal).
function addMonthsClamped(date: Date, months: number): Date {
  const targetMonthIndex = date.getMonth() + months;
  const firstOfTargetMonth = new Date(date.getFullYear(), targetMonthIndex, 1);
  const lastDayOfTargetMonth = new Date(firstOfTargetMonth.getFullYear(), firstOfTargetMonth.getMonth() + 1, 0).getDate();
  const day = Math.min(date.getDate(), lastDayOfTargetMonth);
  return new Date(
    firstOfTargetMonth.getFullYear(),
    firstOfTargetMonth.getMonth(),
    day,
    date.getHours(),
    date.getMinutes(),
    date.getSeconds(),
    date.getMilliseconds()
  );
}

@Component({
  selector: 'mfx-shared-expense-form',
  imports: [ReactiveFormsModule, Avatar, Checkbox, InstallmentRow, MfxCurrencyInputDirective, MfxCurrencyPipe, AttachmentPicker],
  templateUrl: './shared-expense-form.html',
  styleUrl: './shared-expense-form.scss',
})
export class SharedExpenseForm {
  private readonly movementsService = inject(MovementsService);
  private readonly accountsService = inject(Accounts);
  private readonly categoriesService = inject(Categories);
  private readonly groupsService = inject(GroupsService);
  private readonly settlementsService = inject(SettlementsService);
  private readonly receiptReader = inject(ReceiptReader);
  private readonly activeGroup = inject(ActiveGroup);
  private readonly auth = inject(Auth);
  private readonly fb = inject(FormBuilder);
  private readonly sharedExpenseFormState = inject(SharedExpenseFormState);
  private readonly modalStack = inject(ModalStack);

  readonly saved = output<void>();
  readonly deleted = output<void>();

  // Presente solo en modo edición — ver SharedExpenseFormState.openEdit().
  // GroupActivity abre este modal para CUALQUIER miembro que toque la fila,
  // sin filtrar por quién la creó — el guard de permisos (readOnly) y de
  // settlement (isLocked) vive acá, no allá (ver esos computed más abajo).
  readonly initialValue = input<SharedMovementWithId | null>(null);

  // Cuando se abre desde un grupo específico (GroupDetail, tarjeta de la
  // lista de Grupos) fija ese grupo, sin depender del grupo activo. Cuando
  // no se pasa (el FAB, que no cambia), sigue usando ActiveGroup.
  readonly fixedGroupId = input<string | null>(null);
  readonly groupId = computed(() => this.fixedGroupId() ?? this.activeGroup.groupId());
  readonly currentUid = computed(() => this.auth.currentUser?.uid ?? null);

  readonly splitTypes = SPLIT_TYPES;
  readonly accounts = toSignal(this.accountsService.accounts$, { initialValue: [] });
  readonly categories = toSignal(this.categoriesService.categories$, { initialValue: [] });
  readonly expenseCategories = computed(() => this.categories().filter((c) => c.type === 'expense'));

  readonly members = signal<GroupMemberProfile[]>([]);
  readonly membersLoading = signal(false);
  readonly membersError = signal<string | null>(null);

  // Un solo miembro (grupo type: 'personal', o uno type: 'shared' que
  // todavía no ha invitado a nadie) — mismo criterio que se usó al
  // diagnosticar el fix anterior. Solo cambia presentación (título,
  // qué secciones se muestran, texto del botón): paidBy/splitType/splits
  // se siguen guardando igual (ver submit()), el único miembro pagando el
  // 100% con división "igual" implícita.
  readonly isPersonalFlow = computed(() => this.members().length === 1);

  readonly saving = signal(false);
  readonly deleting = signal(false);
  readonly confirmingDelete = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly pendingAttachment = signal<PendingAttachment | null>(null);
  // Una vez createShared()/updateShared() resuelve, queda fijo — reintentar
  // submit() (p. ej. si solo falló subir el adjunto) nunca debe volver a
  // crear/actualizar ni a re-ajustar el balance de la cuenta otra vez.
  private readonly savedMovementId = signal<string | null>(null);
  // Ver movement-form.ts para el mismo criterio: solo queda en true mientras
  // el formulario sigue abierto tras "se guardó el gasto, falló el adjunto".
  readonly attachmentRetryPending = computed(() => this.savedMovementId() !== null);

  // "Eliminar" del adjunto ya guardado (ver AttachmentPicker,
  // existingRemoved) — mismo criterio que MovementForm: lo borra el padre
  // (acá), vía el mismo MovementsService.removeAttachment() (los gastos
  // compartidos viven en la misma colección 'movements').
  readonly removingAttachment = signal(false);
  private readonly attachmentRemovedOverride = signal(false);
  readonly existingAttachmentPath = computed(() =>
    this.attachmentRemovedOverride() ? null : (this.initialValue()?.attachmentPath ?? null)
  );

  // Lectura automática del recibo (ver ReceiptReader/MovementForm, mismo
  // patrón exacto) — solo en modo creación. receiptNote() es el mensaje
  // discreto de fallo/confianza baja, nunca errorMessage() (esa es roja,
  // para fallas de guardado).
  readonly receiptReading = signal(false);
  readonly receiptNote = signal<string | null>(null);
  private receiptReadAbortController: AbortController | null = null;
  // Snapshot de los valores que puso la IA — el ✨ de un campo desaparece
  // apenas el usuario lo cambia a algo distinto (ver isAiFilled()).
  private readonly aiFilledSnapshot = signal<Partial<Record<AiFillableField, unknown>>>({});

  isAiFilled(field: AiFillableField): boolean {
    const snapshot = this.aiFilledSnapshot();
    return field in snapshot && this.form.controls[field].value === snapshot[field];
  }

  readonly form = this.fb.nonNullable.group({
    paidBy: ['', Validators.required],
    amount: [0, [Validators.required, Validators.min(0.01)]],
    // Ninguno de los dos es obligatorio (ver DATABASE.md, "Cuenta y
    // categoría opcionales en gastos compartidos"): un gasto sin cuenta
    // queda solo como deuda compartida, sin afectar ningún balance; uno sin
    // categoría cae en el bucket "Sin categoría" al agrupar/reportar.
    accountId: [''],
    categoryId: [''],
    splitType: ['equal' as SplitType, Validators.required],
    date: [toDateInputValue(new Date()), Validators.required],
    note: [''],
    // Cuotas (ver DATABASE.md / "Pagos a cuotas") — solo aplica al crear
    // (showInstallmentOption()), nunca al editar. El valor por defecto de
    // installmentCount (2) siempre satisface sus propios validadores, así
    // que no hace falta añadirlos/quitarlos dinámicamente cuando el campo
    // está oculto (a diferencia de accountId).
    payInInstallments: [false],
    installmentCount: [2, [Validators.required, Validators.min(2), Validators.max(36)]],
  });

  readonly splitInputs = this.fb.array<SplitInputGroup>([]);
  readonly installmentInputs = this.fb.array<FormControl<number>>([]);

  readonly paidByValue = toSignal(this.form.controls.paidBy.valueChanges, {
    initialValue: this.form.controls.paidBy.value,
  });
  readonly amountValue = toSignal(this.form.controls.amount.valueChanges, {
    initialValue: this.form.controls.amount.value,
  });
  readonly splitTypeValue = toSignal(this.form.controls.splitType.valueChanges, {
    initialValue: this.form.controls.splitType.value,
  });
  // Necesario para que installmentPreview() reaccione si el usuario cambia
  // la fecha sin tocar nada más (conteo/modo/montos) — leer
  // form.controls.date.value directo ahí NO es reactivo dentro de un
  // computed(), se quedaría con el valor de la primera evaluación.
  readonly dateValue = toSignal(this.form.controls.date.valueChanges, {
    initialValue: this.form.controls.date.value,
  });

  readonly needsAccount = computed(() => !!this.paidByValue() && this.paidByValue() === this.currentUid());

  // Settlements del grupo — solo para el chequeo de bloqueo (ver isLocked);
  // en modo creación groupId() puede ir cambiando antes de fijarse, así que
  // reacciona a él igual que members(), no se pide una sola vez.
  private readonly settlements = toSignal(
    toObservable(this.groupId).pipe(switchMap((id) => (id ? this.settlementsService.settlements$(id) : of([])))),
    { initialValue: [] }
  );

  readonly isLocked = computed(() => {
    const existing = this.initialValue();
    return !!existing && isSharedMovementLocked(existing, this.settlements());
  });

  // Solo lectura si quien mira no es quien lo creó, o si ya está bloqueado
  // por un settlement posterior — un plan de cuotas YA NO bloquea por sí
  // solo: mientras ninguna cuota se haya pagado, sigue editable igual que
  // cualquier otro gasto compartido (pagar la primera cuota crea un
  // settlement real, que isLocked() ya detecta — ver DATABASE.md / "Pagos
  // a cuotas"). En modo creación (initialValue null) nunca aplica.
  readonly readOnly = computed(() => {
    const existing = this.initialValue();
    if (!existing) {
      return false;
    }
    return existing.uid !== this.currentUid() || this.isLocked();
  });

  // "Zona de peligro" (eliminar): solo para quien lo creó, y solo si no
  // está bloqueado — igual que readOnly() pero sin confundir "no es mío"
  // con "está bloqueado" en la plantilla.
  readonly showDangerZone = computed(() => {
    const existing = this.initialValue();
    return !!existing && existing.uid === this.currentUid() && !this.isLocked();
  });

  // Vista de solo lectura del plan de cuotas — reemplaza al formulario
  // editable cuando el gasto no se puede tocar (bloqueado, o de otro
  // miembro). Lee installments directo de initialValue(), nunca recalcula
  // nada (sin esto, mostrar el formulario editable con members() todavía
  // sin cargar producía un "$0" pasajero en el encabezado de la deuda —
  // ver DATABASE.md / "Pagos a cuotas").
  readonly readOnlyInstallments = computed(() => {
    if (!this.readOnly()) {
      return null;
    }
    const installments = this.initialValue()?.installments;
    return installments?.length ? installments : null;
  });

  readonly equalSplitPreview = computed(() =>
    distributeEqually(
      this.amountValue(),
      this.members().map((m) => m.uid)
    )
  );

  private readonly splitInputsValue = toSignal(this.splitInputs.valueChanges, {
    initialValue: this.splitInputs.getRawValue(),
  });

  readonly splitSum = computed(() =>
    round2(this.splitInputsValue().reduce((total, entry) => total + (Number(entry.value) || 0), 0))
  );
  readonly splitTarget = computed(() => (this.splitTypeValue() === 'percentage' ? 100 : this.amountValue()));
  readonly splitMismatch = computed(() => {
    if (this.splitTypeValue() === 'equal') {
      return false;
    }
    return Math.abs(this.splitSum() - this.splitTarget()) > 0.01;
  });

  // Cuotas (ver DATABASE.md / "Pagos a cuotas") — solo para grupos de
  // exactamente 2 miembros, y solo mientras el gasto siga editable (al
  // crear, o al editar si todavía no se pagó ninguna cuota — ver
  // readOnly()). Si el grupo creció a 3+ miembros después de crear el plan,
  // esto se oculta pero el plan existente NO se toca (ver submit()).
  readonly showInstallmentOption = computed(() => !this.readOnly() && this.members().length === 2);

  readonly payInInstallmentsValue = toSignal(this.form.controls.payInInstallments.valueChanges, {
    initialValue: this.form.controls.payInInstallments.value,
  });
  readonly installmentCountValue = toSignal(this.form.controls.installmentCount.valueChanges, {
    initialValue: this.form.controls.installmentCount.value,
  });
  readonly installmentMode = signal<InstallmentMode>('equal');
  readonly installmentModes = INSTALLMENT_MODES;

  // El monto base de las cuotas es lo que debe quien NO pagó, no el monto
  // total del gasto (confirmado explícitamente: dividir porcentaje/fijo
  // puede dejar a cada quien debiendo algo distinto, y las cuotas son un
  // plan de pago de ESA deuda, no del precio bruto del gasto).
  readonly debtorAmount = computed(() => {
    const splits = this.computeSplits(this.amountValue(), this.splitTypeValue());
    const paidBy = this.paidByValue();
    return splits.find((split) => split.uid !== paidBy)?.amount ?? 0;
  });

  private readonly installmentInputsValue = toSignal(this.installmentInputs.valueChanges, {
    initialValue: this.installmentInputs.getRawValue(),
  });

  readonly installmentPreview = computed<{ dueDate: Date; amount: number }[]>(() => {
    const count = this.installmentCountValue();
    if (!Number.isFinite(count) || count < 2) {
      return [];
    }
    const baseDate = combineDateWithCurrentTime(this.dateValue());
    if (this.installmentMode() === 'equal') {
      return distributeAmountEqually(this.debtorAmount(), count).map((amount, index) => ({
        dueDate: addMonthsClamped(baseDate, index),
        amount,
      }));
    }
    return this.installmentInputsValue().map((amount, index) => ({
      dueDate: addMonthsClamped(baseDate, index),
      amount: Number(amount) || 0,
    }));
  });

  readonly installmentSum = computed(() => round2(this.installmentPreview().reduce((sum, i) => sum + i.amount, 0)));
  readonly installmentMismatch = computed(() => {
    // Si la sección ni siquiera se ofrece (ver showInstallmentOption()), el
    // plan de cuotas pre-cargado al editar queda intacto y nunca debe
    // bloquear el guardado de un cambio que no tiene nada que ver con él.
    if (!this.showInstallmentOption() || !this.payInInstallmentsValue() || this.installmentMode() === 'equal') {
      return false;
    }
    return Math.abs(this.installmentSum() - this.debtorAmount()) > 0.01;
  });

  constructor() {
    // Modo edición: se ejecuta una sola vez al construir (initialValue es un
    // input estático acá, se pasa una sola vez al abrir el modal) — corre
    // antes de que resuelva el fetch async de miembros, así que cuando ese
    // effect intente poner paidBy por defecto, el control ya no está vacío
    // y no lo sobrescribe (ver el effect de members() más abajo).
    effect(() => {
      const existing = this.initialValue();
      if (existing) {
        this.form.patchValue({
          paidBy: existing.paidBy,
          amount: existing.amount,
          accountId: existing.accountId ?? '',
          categoryId: existing.categoryId ?? '',
          splitType: existing.splitType,
          date: toDateInputValue(existing.date.toDate()),
          note: existing.note,
          payInInstallments: !!existing.installments?.length,
          installmentCount: existing.installments?.length ?? 2,
        });
        // No se guarda si el plan original era "igual" o "fijo" — se trata
        // siempre como "fijo" con los montos reales ya guardados (ver
        // rebuildInstallmentInputs), que es un superconjunto válido de
        // "igual" (si el usuario no toca nada, se regenera exactamente
        // igual al guardar — ver submit()/installmentPreview()).
        if (existing.installments?.length) {
          this.installmentMode.set('fixed');
        }
      }
    });

    effect(() => {
      const id = this.groupId();
      if (!id) {
        this.members.set([]);
        return;
      }
      this.membersLoading.set(true);
      this.membersError.set(null);
      this.groupsService
        .getMemberProfiles(id)
        .then((profiles) => {
          this.members.set(profiles);
          if (!this.form.controls.paidBy.value) {
            this.form.controls.paidBy.setValue(this.currentUid() ?? '');
          }
        })
        .catch((error) => {
          console.error('Error al cargar los miembros del grupo', error);
          this.membersError.set('No pudimos cargar los miembros del grupo.');
        })
        .finally(() => this.membersLoading.set(false));
    });

    // El campo cuenta solo tiene sentido si quien pagó es quien registra el
    // movimiento — la cuenta de cualquier otro miembro es privada, no hay
    // forma de leerla ni de tocarla (ver SharedMovementFormValue). Nunca es
    // obligatorio (ver DATABASE.md): sin cuenta, el gasto queda solo como
    // deuda compartida. Se limpia a '' cuando el campo deja de aplicar, para
    // no dejar un valor oculto que confunda si paidBy vuelve a cambiar.
    effect(() => {
      if (!this.needsAccount()) {
        this.form.controls.accountId.setValue('', { emitEvent: false });
      }
    });

    // Los inputs de porcentaje/monto fijo se reconstruyen (uno por miembro,
    // reparto por defecto) cada vez que cambia el tipo de división o la
    // lista de miembros — no se preserva lo ya tecleado al alternar entre
    // tipos, para mantenerlo simple y predecible.
    effect(() => {
      const splitType = this.splitTypeValue();
      const members = this.members();
      this.rebuildSplitInputs(splitType, members);
    });

    // Mismo criterio que splitInputs: se reconstruye (reparto igual por
    // defecto) cada vez que cambia el número de cuotas o el modo, no se
    // preserva lo tecleado al alternar — sin depender de debtorAmount() acá
    // para no borrar valores ya personalizados solo porque cambió el monto.
    effect(() => {
      const mode = this.installmentMode();
      const count = this.installmentCountValue();
      this.rebuildInstallmentInputs(mode, count);
    });

    // Shell necesita saber esto para el título del modal (ver
    // SharedExpenseFormState.isPersonalFlow) — no lo puede calcular él
    // mismo, el conteo de miembros solo se conoce acá tras el fetch async.
    effect(() => {
      this.sharedExpenseFormState.setPersonalFlow(this.isPersonalFlow());
    });

    // Mismo motivo que isPersonalFlow: Shell necesita saber si el modal es
    // de solo lectura para no titularlo "Editar" (ver shell.html).
    effect(() => {
      this.sharedExpenseFormState.setReadOnly(this.readOnly());
    });

    // Deshabilita TODO el formulario (campos reactivos + splitInputs, que
    // es un FormArray aparte) cuando es de solo lectura — los botones que
    // no son controles reactivos (paidBy, tipo de división) se deshabilitan
    // directo en la plantilla con [disabled]="readOnly()".
    effect(() => {
      if (this.readOnly()) {
        this.form.disable({ emitEvent: false });
        this.splitInputs.disable({ emitEvent: false });
        this.installmentInputs.disable({ emitEvent: false });
      } else {
        this.form.enable({ emitEvent: false });
        this.splitInputs.enable({ emitEvent: false });
        this.installmentInputs.enable({ emitEvent: false });
      }
    });

    // "Zona de peligro" vive dentro de este mismo mfx-modal (no es un
    // modal propio) — sin esto, el botón atrás de Android (ver ModalStack)
    // se saltaría la confirmación y cerraría el modal completo de un
    // golpe. Al registrarla como su propia entrada en la pila, un back
    // primero cancela la confirmación (vuelve a "Eliminar gasto") y solo
    // un segundo back cierra el modal.
    effect((onCleanup) => {
      if (!this.confirmingDelete()) {
        return;
      }
      const onBack = () => this.confirmingDelete.set(false);
      this.modalStack.push(onBack);
      onCleanup(() => this.modalStack.pop(onBack));
    });
  }

  selectPaidBy(uid: string): void {
    this.form.controls.paidBy.setValue(uid);
  }

  memberName(uid: string): string {
    return this.members().find((member) => member.uid === uid)?.displayName || 'Sin nombre';
  }

  selectSplitType(splitType: SplitType): void {
    this.form.controls.splitType.setValue(splitType);
  }

  selectInstallmentMode(mode: InstallmentMode): void {
    this.installmentMode.set(mode);
  }

  formatInstallmentDate(date: Date): string {
    return date.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' });
  }

  private rebuildSplitInputs(splitType: SplitType, members: GroupMemberProfile[]): void {
    this.splitInputs.clear();
    if (splitType === 'equal' || members.length === 0) {
      return;
    }
    const amount = this.form.controls.amount.value;
    const defaultValue =
      splitType === 'percentage' ? round2(100 / members.length) : round2(amount / members.length);

    // Al editar, si el tipo de división no cambió respecto al gasto
    // original, se parte de los montos/porcentajes ya guardados en vez de
    // recalcular un reparto por defecto — si el usuario cambia de tipo
    // mientras edita, sí vuelve al reparto por defecto (igual que al crear).
    const existing = this.initialValue();
    const existingSplitsByUid =
      existing && existing.splitType === splitType ? new Map(existing.splits.map((s) => [s.uid, s.amount])) : null;

    for (const member of members) {
      const existingAmount = existingSplitsByUid?.get(member.uid);
      const value =
        existingAmount === undefined
          ? defaultValue
          : splitType === 'percentage'
            ? round2((existingAmount / existing!.amount) * 100)
            : existingAmount;
      this.splitInputs.push(this.fb.nonNullable.group({ uid: member.uid, value }));
    }

    // El effect que deshabilita splitInputs según readOnly() ya pudo haber
    // corrido antes de que este array tuviera estos grupos (p. ej. members()
    // resuelve después, async) — se refuerza acá para no depender del orden.
    if (this.readOnly()) {
      this.splitInputs.disable({ emitEvent: false });
    }
  }

  // Mismo criterio que rebuildSplitInputs, sin la rama de "preservar lo
  // guardado al editar" — las cuotas son create-only (ver readOnly()).
  private rebuildInstallmentInputs(mode: InstallmentMode, count: number): void {
    this.installmentInputs.clear();
    if (mode === 'equal' || !Number.isFinite(count) || count < 2) {
      return;
    }
    // Al editar, si el número de cuotas no cambió respecto al plan ya
    // guardado, se parte de los montos reales en vez de un reparto por
    // defecto — mismo criterio que rebuildSplitInputs con existing.splitType.
    // Si el usuario cambia el conteo, sí vuelve al reparto por defecto
    // (coincide con "se regenera desde cero").
    const existing = this.initialValue();
    const existingAmounts =
      existing?.installments?.length === count ? existing.installments.map((installment) => installment.amount) : null;

    // debtorAmount() solo se lee cuando realmente hace falta (sin
    // existingAmounts) — evaluarlo sin usarlo forzaría una lectura
    // temprana e innecesaria (p. ej. en el primer flush al editar, antes
    // de que splitInputs tenga datos reales) justo cuando más importa que
    // quede bien cacheado.
    for (let i = 0; i < count; i++) {
      const value = existingAmounts?.[i] ?? round2(this.debtorAmount() / count);
      this.installmentInputs.push(this.fb.nonNullable.control(value));
    }
    if (this.readOnly()) {
      this.installmentInputs.disable({ emitEvent: false });
    }
  }

  // Extraído de submit() para reusarlo en debtorAmount() (base de las
  // cuotas) sin duplicar la lógica de reparto equal/porcentaje/fijo. Lee
  // splitInputsValue() (su toSignal, ya usado por splitSum()/splitMismatch())
  // en vez de splitInputs.controls directo — ese control plano no es
  // reactivo dentro de un computed(): si debtorAmount() se leía por primera
  // vez mientras splitInputs todavía estaba vacío (editar un gasto con
  // división 'fijo'/'porcentaje' + cuotas, antes de que resuelva el fetch
  // async de members()), el resultado quedaba en caché para siempre —
  // amount/paidBy no volvían a cambiar para forzar un recálculo.
  private computeSplits(amount: number, splitType: SplitType): MovementSplit[] {
    return splitType === 'equal'
      ? this.equalSplitPreview()
      : this.splitInputsValue().map((entry) => {
          const inputValue = Number(entry.value) || 0;
          const splitAmount = splitType === 'percentage' ? round2((amount * inputValue) / 100) : inputValue;
          return { uid: entry.uid ?? '', amount: splitAmount, settled: false };
        });
  }

  async submit(): Promise<void> {
    if (this.readOnly() || this.form.invalid || this.splitMismatch() || this.installmentMismatch()) {
      this.form.markAllAsTouched();
      return;
    }
    const groupId = this.groupId();
    if (!groupId) {
      return;
    }

    this.saving.set(true);
    this.errorMessage.set(null);
    const raw = this.form.getRawValue();

    const splits = this.computeSplits(raw.amount, raw.splitType);
    const existing = this.initialValue();

    const category = raw.categoryId ? this.categories().find((c) => c.id === raw.categoryId) : undefined;
    const accountId = this.needsAccount() && raw.accountId ? raw.accountId : null;
    // Si la sección de cuotas ni siquiera se ofreció (p. ej. el grupo creció
    // a 3+ miembros después de crear el plan), se conserva el plan existente
    // tal cual — nunca se borra solo por editar un campo que no tiene nada
    // que ver con cuotas (ver showInstallmentOption()).
    const installments: Installment[] | null = this.showInstallmentOption()
      ? raw.payInInstallments
        ? this.installmentPreview().map((installment) => ({
            dueDate: Timestamp.fromDate(installment.dueDate),
            amount: installment.amount,
            status: 'pending',
          }))
        : null
      : existing?.installments ?? null;

    try {
      const value = {
        groupId,
        paidBy: raw.paidBy,
        amount: raw.amount,
        accountId,
        categoryId: raw.categoryId || null,
        categoryName: category?.name ?? null,
        categoryIcon: category?.icon ?? null,
        splitType: raw.splitType,
        splits,
        date: combineDateWithCurrentTime(raw.date),
        note: raw.note,
        installments,
      };

      // Ya guardado (p. ej. reintentando después de que solo falló el
      // adjunto) — no se vuelve a crear/actualizar ni a re-ajustar el
      // balance de la cuenta una segunda vez.
      let movementId = this.savedMovementId();
      if (!movementId) {
        if (existing) {
          await this.movementsService.updateShared(existing.id, existing, value);
          movementId = existing.id;
        } else {
          movementId = await this.movementsService.createShared(value);
        }
        this.savedMovementId.set(movementId);
      }

      // Se sube DESPUÉS de crear/actualizar a propósito — ver
      // MovementsService.attachFile() (la regla de Storage necesita que el
      // documento ya exista para saber quién es su dueño).
      const pending = this.pendingAttachment();
      if (pending) {
        await this.movementsService.attachFile(movementId, pending);
      }
      this.saved.emit();
    } catch (error) {
      console.error('Error al guardar el gasto compartido', error);
      this.errorMessage.set(
        this.savedMovementId()
          ? 'Guardamos el gasto, pero no pudimos subir el archivo adjunto. Intenta de nuevo.'
          : 'No pudimos guardar el gasto. Intenta de nuevo.'
      );
    } finally {
      this.saving.set(false);
    }
  }

  // Reemplaza el (attachmentReady) directo a pendingAttachment.set() de
  // antes — ver movement-form.ts para el mismo criterio exacto: cualquier
  // cambio del adjunto corta una lectura en curso, y solo arranca una
  // nueva en modo creación (AttachmentPicker tampoco calcula aiPreview en
  // modo edición, [prepareAiPreview]="!initialValue()" en la plantilla).
  onAttachmentReady(pending: PendingAttachment | null): void {
    this.pendingAttachment.set(pending);
    this.cancelReceiptRead();

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
      if (result.confidence === 'low') {
        this.receiptNote.set('No pudimos leer bien el recibo — completa los datos a mano.');
        return;
      }
      this.applyReceiptExtraction(result);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return;
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

  // Parchea SOLO monto/fecha/nota/categoría, y solo los que el usuario
  // todavía no tocó (control.pristine) — paidBy, splitType y las cuotas
  // NUNCA se tocan, esos los pone siempre el usuario (ver conversación).
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
      const matchedId = matchCategory(result.suggestedCategory, this.expenseCategories());
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
      await this.movementsService.removeAttachment(existing.id, existing.attachmentPath);
      this.attachmentRemovedOverride.set(true);
    } catch (error) {
      console.error('Error al eliminar el adjunto', error);
      this.errorMessage.set('No pudimos eliminar el adjunto. Intenta de nuevo.');
    } finally {
      this.removingAttachment.set(false);
    }
  }

  async remove(): Promise<void> {
    const existing = this.initialValue();
    if (!existing || !this.showDangerZone()) {
      return;
    }

    this.deleting.set(true);
    this.errorMessage.set(null);

    try {
      await this.movementsService.removeShared(existing.id, existing);
      this.deleted.emit();
    } catch (error) {
      console.error('Error al eliminar el gasto compartido', error);
      this.errorMessage.set('No pudimos eliminar el gasto.');
    } finally {
      this.deleting.set(false);
    }
  }
}
