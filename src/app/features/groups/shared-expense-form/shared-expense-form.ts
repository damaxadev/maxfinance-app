import { Component, computed, effect, inject, output, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';

import { Accounts } from '../../../core/accounts/accounts';
import { ActiveGroup } from '../../../core/active-group/active-group';
import { Auth } from '../../../core/auth/auth';
import { Categories } from '../../../core/categories/categories';
import { GroupsService, type GroupMemberProfile } from '../../../core/groups/groups';
import { MovementsService } from '../../../core/movements/movements';
import type { MovementSplit, SplitType } from '../../../models/movement.model';
import { Avatar } from '../../../shared/avatar/avatar';

function toDateInputValue(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
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

@Component({
  selector: 'mfx-shared-expense-form',
  imports: [ReactiveFormsModule, Avatar],
  templateUrl: './shared-expense-form.html',
  styleUrl: './shared-expense-form.scss',
})
export class SharedExpenseForm {
  private readonly movementsService = inject(MovementsService);
  private readonly accountsService = inject(Accounts);
  private readonly categoriesService = inject(Categories);
  private readonly groupsService = inject(GroupsService);
  private readonly activeGroup = inject(ActiveGroup);
  private readonly auth = inject(Auth);
  private readonly fb = inject(FormBuilder);

  readonly saved = output<void>();

  readonly groupId = computed(() => this.activeGroup.groupId());
  readonly currentUid = computed(() => this.auth.currentUser?.uid ?? null);

  readonly splitTypes = SPLIT_TYPES;
  readonly accounts = toSignal(this.accountsService.accounts$, { initialValue: [] });
  readonly categories = toSignal(this.categoriesService.categories$, { initialValue: [] });
  readonly expenseCategories = computed(() => this.categories().filter((c) => c.type === 'expense'));

  readonly members = signal<GroupMemberProfile[]>([]);
  readonly membersLoading = signal(false);
  readonly membersError = signal<string | null>(null);

  readonly saving = signal(false);
  readonly errorMessage = signal<string | null>(null);

  readonly form = this.fb.nonNullable.group({
    paidBy: ['', Validators.required],
    amount: [0, [Validators.required, Validators.min(0.01)]],
    accountId: [''],
    categoryId: ['', Validators.required],
    splitType: ['equal' as SplitType, Validators.required],
    date: [toDateInputValue(new Date()), Validators.required],
    note: [''],
  });

  readonly splitInputs = this.fb.array<SplitInputGroup>([]);

  readonly paidByValue = toSignal(this.form.controls.paidBy.valueChanges, {
    initialValue: this.form.controls.paidBy.value,
  });
  readonly amountValue = toSignal(this.form.controls.amount.valueChanges, {
    initialValue: this.form.controls.amount.value,
  });
  readonly splitTypeValue = toSignal(this.form.controls.splitType.valueChanges, {
    initialValue: this.form.controls.splitType.value,
  });

  readonly needsAccount = computed(() => !!this.paidByValue() && this.paidByValue() === this.currentUid());

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

  constructor() {
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

    // accountId solo es obligatorio si quien pagó es quien registra el
    // movimiento — la cuenta de cualquier otro miembro es privada, no hay
    // forma de leerla ni de tocarla (ver SharedMovementFormValue).
    effect(() => {
      if (this.needsAccount()) {
        this.form.controls.accountId.addValidators(Validators.required);
      } else {
        this.form.controls.accountId.clearValidators();
        this.form.controls.accountId.setValue('', { emitEvent: false });
      }
      this.form.controls.accountId.updateValueAndValidity();
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

  private rebuildSplitInputs(splitType: SplitType, members: GroupMemberProfile[]): void {
    this.splitInputs.clear();
    if (splitType === 'equal' || members.length === 0) {
      return;
    }
    const amount = this.form.controls.amount.value;
    const defaultValue =
      splitType === 'percentage' ? round2(100 / members.length) : round2(amount / members.length);
    for (const member of members) {
      this.splitInputs.push(this.fb.nonNullable.group({ uid: member.uid, value: defaultValue }));
    }
  }

  async submit(): Promise<void> {
    if (this.form.invalid || this.splitMismatch()) {
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

    const splits: MovementSplit[] =
      raw.splitType === 'equal'
        ? this.equalSplitPreview()
        : this.splitInputs.controls.map((group) => {
            const uid = group.controls.uid.value;
            const inputValue = Number(group.controls.value.value) || 0;
            const amount = raw.splitType === 'percentage' ? round2((raw.amount * inputValue) / 100) : inputValue;
            return { uid, amount, settled: false };
          });

    try {
      await this.movementsService.createShared({
        groupId,
        paidBy: raw.paidBy,
        amount: raw.amount,
        accountId: this.needsAccount() ? raw.accountId : null,
        categoryId: raw.categoryId,
        splitType: raw.splitType,
        splits,
        date: new Date(`${raw.date}T00:00:00`),
        note: raw.note,
      });
      this.saved.emit();
    } catch (error) {
      console.error('Error al guardar el gasto compartido', error);
      this.errorMessage.set('No pudimos guardar el gasto. Intenta de nuevo.');
    } finally {
      this.saving.set(false);
    }
  }
}
