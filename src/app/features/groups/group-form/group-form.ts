import { Component, inject, output, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';

import { GroupsService } from '../../../core/groups/groups';

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

  readonly saving = signal(false);
  readonly errorMessage = signal<string | null>(null);

  readonly form = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.minLength(2)]],
  });

  async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.saving.set(true);
    this.errorMessage.set(null);

    try {
      await this.groups.create(this.form.getRawValue().name);
      this.saved.emit();
    } catch (error) {
      console.error('Error al crear el grupo', error);
      this.errorMessage.set('No pudimos crear el grupo. Intenta de nuevo.');
    } finally {
      this.saving.set(false);
    }
  }
}
