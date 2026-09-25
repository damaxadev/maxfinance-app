import { Component, inject, output, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';

import { GroupsService } from '../../../core/groups/groups';
import type { GroupType } from '../../../models/group.model';

const GROUP_TYPES: { value: GroupType; label: string }[] = [
  { value: 'personal', label: 'Personal' },
  { value: 'shared', label: 'Compartido' },
];

@Component({
  selector: 'mfx-group-form',
  imports: [ReactiveFormsModule],
  templateUrl: './group-form.html',
  styleUrl: './group-form.scss',
})
export class GroupForm {
  private readonly groups = inject(GroupsService);
  private readonly fb = inject(FormBuilder);

  readonly saved = output<void>();

  readonly groupTypes = GROUP_TYPES;
  readonly saving = signal(false);
  readonly errorMessage = signal<string | null>(null);

  readonly form = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.minLength(2)]],
    type: ['shared' as GroupType, Validators.required],
  });

  readonly typeValue = toSignal(this.form.controls.type.valueChanges, {
    initialValue: this.form.controls.type.value,
  });

  selectType(type: GroupType): void {
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

    try {
      await this.groups.create(raw.name, raw.type);
      this.saved.emit();
    } catch (error) {
      console.error('Error al crear el grupo', error);
      this.errorMessage.set('No pudimos crear el grupo. Intenta de nuevo.');
    } finally {
      this.saving.set(false);
    }
  }
}
