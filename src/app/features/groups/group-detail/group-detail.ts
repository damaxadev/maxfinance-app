import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { type AbstractControl, FormBuilder, ReactiveFormsModule, type ValidationErrors, Validators } from '@angular/forms';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { switchMap } from 'rxjs';

import { Auth } from '../../../core/auth/auth';
import { GroupsService, type GroupMemberProfile } from '../../../core/groups/groups';
import { MovementFormState } from '../../../core/movement-form-state/movement-form-state';
import { MovementsService } from '../../../core/movements/movements';
import { SharedExpenseFormState } from '../../../core/shared-expense-form-state/shared-expense-form-state';
import { isSharedGroup } from '../../../models/group.model';
import { AnimatedNumber } from '../../../shared/animated-number/animated-number';
import { Avatar } from '../../../shared/avatar/avatar';
import { GroupActivity } from '../group-activity/group-activity';
import { GroupBalance } from '../group-balance/group-balance';

const JUST_INVITED_DURATION_MS = 2000;

@Component({
  selector: 'mfx-group-detail',
  imports: [ReactiveFormsModule, Avatar, AnimatedNumber, GroupBalance, GroupActivity],
  templateUrl: './group-detail.html',
  styleUrl: './group-detail.scss',
})
export class GroupDetail {
  private readonly groupsService = inject(GroupsService);
  private readonly movementsService = inject(MovementsService);
  private readonly auth = inject(Auth);
  private readonly fb = inject(FormBuilder);
  private readonly sharedExpenseFormState = inject(SharedExpenseFormState);
  private readonly movementFormState = inject(MovementFormState);

  readonly groupId = input.required<string>();
  readonly left = output<void>();

  private readonly groups = toSignal(this.groupsService.groups$, { initialValue: [] });
  readonly group = computed(() => this.groups().find((g) => g.id === this.groupId()) ?? null);
  readonly isSharedGroup = computed(() => isSharedGroup(this.group()));

  // "Total gastado" (grupos type: 'personal', ver DATABASE.md) — reemplaza
  // a "Balance", que no aplica: un grupo personal nunca tiene deuda entre
  // personas. Solo cuenta gastos (expense), no ingresos.
  private readonly groupMovements = toSignal(
    toObservable(this.groupId).pipe(switchMap((id) => this.movementsService.groupMovements$(id))),
    { initialValue: [] }
  );
  readonly totalSpent = computed(() =>
    this.groupMovements()
      .filter((m) => m.type === 'expense')
      .reduce((sum, m) => sum + m.amount, 0)
  );

  readonly currentUid = computed(() => this.auth.currentUser?.uid ?? null);
  // "Eliminar miembro" y "Eliminar grupo" son acciones de creador — pero la
  // regla de Firestore también las permite al admin (isAdmin() en
  // firestore.rules), así que la UI tiene que espejar ese mismo bypass.
  readonly canManageGroup = computed(() => {
    const group = this.group();
    return !!group && (group.createdBy === this.currentUid() || this.auth.isAdmin);
  });

  readonly members = signal<GroupMemberProfile[]>([]);
  readonly membersLoading = signal(false);
  readonly membersError = signal<string | null>(null);

  // uid de la persona sobre la que se está actuando (salir/eliminar) — solo
  // deshabilita el botón de esa fila, no todo el modal.
  readonly pendingUid = signal<string | null>(null);
  readonly actionError = signal<string | null>(null);

  readonly confirmingDeleteGroup = signal(false);
  readonly deletingGroup = signal(false);
  readonly deleteError = signal<string | null>(null);

  // Contactos sugeridos: gente con la que ya se comparte ALGÚN grupo (no
  // depende de cuál se está viendo ahora — ver GroupsService.getKnownContacts).
  // Se filtran acá los que ya son miembros de ESTE grupo específico.
  readonly contacts = signal<GroupMemberProfile[]>([]);
  readonly suggestedContacts = computed(() => {
    const group = this.group();
    if (!group) {
      return [];
    }
    return this.contacts().filter((contact) => !group.members.includes(contact.uid));
  });
  readonly invitingContactUid = signal<string | null>(null);
  readonly justInvitedUids = signal<ReadonlySet<string>>(new Set());

  readonly inviteForm = this.fb.nonNullable.group({
    email: [
      '',
      [Validators.required, Validators.email, this.notSelfEmailValidator(), this.alreadyMemberValidator()],
    ],
  });
  readonly inviting = signal(false);
  readonly inviteError = signal<string | null>(null);
  readonly inviteSuccess = signal(false);

  // La sección "Invitar" arranca colapsada — ver BACKLOG 44e. inviteSuccess
  // se muestra fuera del bloque colapsable para que siga siendo visible
  // aunque el éxito la vuelva a colapsar.
  readonly inviteSectionExpanded = signal(false);

  constructor() {
    effect(() => {
      const id = this.group()?.id;
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
          // Los validadores de email leen members() al momento de validar,
          // pero solo se re-evalúan cuando el control cambia de valor — hay
          // que forzarlo ahora que los datos reales ya están disponibles.
          this.inviteForm.controls.email.updateValueAndValidity();
        })
        .catch((error) => {
          console.error('Error al cargar los miembros del grupo', error);
          this.membersError.set('No pudimos cargar los datos de los miembros.');
        })
        .finally(() => this.membersLoading.set(false));
    });

    // Los contactos sugeridos no dependen del grupo que se está viendo
    // (salen de TODOS los grupos del usuario), así que se cargan una sola
    // vez por apertura del modal, no cada vez que cambia groupId.
    this.groupsService.getKnownContacts().then(
      (profiles) => this.contacts.set(profiles),
      (error) => console.error('Error al cargar contactos sugeridos', error)
    );
  }

  async leave(): Promise<void> {
    const group = this.group();
    const uid = this.currentUid();
    if (!group || !uid) {
      return;
    }

    this.pendingUid.set(uid);
    this.actionError.set(null);

    try {
      await this.groupsService.leave(group.id);
      this.left.emit();
    } catch (error) {
      console.error('Error al salir del grupo', error);
      this.actionError.set(error instanceof Error ? error.message : 'No pudimos completar la acción.');
    } finally {
      this.pendingUid.set(null);
    }
  }

  async removeMember(memberUid: string): Promise<void> {
    const group = this.group();
    if (!group) {
      return;
    }

    this.pendingUid.set(memberUid);
    this.actionError.set(null);

    try {
      await this.groupsService.removeMember(group.id, memberUid);
    } catch (error) {
      console.error('Error al eliminar al miembro', error);
      this.actionError.set('No pudimos eliminar a esta persona.');
    } finally {
      this.pendingUid.set(null);
    }
  }

  confirmDeleteGroup(): void {
    this.confirmingDeleteGroup.set(true);
    this.deleteError.set(null);
    void this.notify(NotificationType.Warning);
  }

  cancelDeleteGroup(): void {
    this.confirmingDeleteGroup.set(false);
  }

  async deleteGroup(): Promise<void> {
    const group = this.group();
    if (!group) {
      return;
    }

    this.deletingGroup.set(true);
    this.deleteError.set(null);

    try {
      await this.groupsService.remove(group.id);
      void this.notify(NotificationType.Success);
      this.left.emit();
    } catch (error) {
      console.error('Error al eliminar el grupo', error);
      this.deleteError.set(error instanceof Error ? error.message : 'No pudimos eliminar el grupo.');
      this.confirmingDeleteGroup.set(false);
    } finally {
      this.deletingGroup.set(false);
    }
  }

  async invite(): Promise<void> {
    if (this.inviteForm.invalid) {
      this.inviteForm.markAllAsTouched();
      return;
    }
    const group = this.group();
    if (!group) {
      return;
    }

    this.inviting.set(true);
    this.inviteError.set(null);
    this.inviteSuccess.set(false);

    try {
      await this.groupsService.inviteByEmail(group.id, this.inviteForm.getRawValue().email);
      this.inviteForm.reset({ email: '' });
      this.markInviteSuccess();
    } catch (error) {
      console.error('Error al invitar', error);
      this.inviteError.set(error instanceof Error ? error.message : 'No pudimos invitar a esta persona.');
    } finally {
      this.inviting.set(false);
    }
  }

  async inviteContact(contact: GroupMemberProfile): Promise<void> {
    const group = this.group();
    if (!group) {
      return;
    }

    this.invitingContactUid.set(contact.uid);
    this.inviteError.set(null);

    try {
      await this.groupsService.inviteByUid(group.id, contact.uid);
      void this.buzz();
      this.markJustInvited(contact.uid);
    } catch (error) {
      console.error('Error al invitar al contacto', error);
      this.inviteError.set(error instanceof Error ? error.message : 'No pudimos invitar a esta persona.');
    } finally {
      this.invitingContactUid.set(null);
    }
  }

  toggleInviteSection(): void {
    this.inviteSectionExpanded.update((expanded) => !expanded);
  }

  addExpense(): void {
    if (this.isSharedGroup()) {
      this.sharedExpenseFormState.openCreate(this.groupId());
    } else {
      // Grupo personal: formulario simple de movimiento, no el de gasto
      // compartido — nunca lleva paidBy/splitType/splits (DATABASE.md).
      this.movementFormState.openCreate(this.groupId());
    }
  }

  private markJustInvited(uid: string): void {
    this.justInvitedUids.set(new Set([...this.justInvitedUids(), uid]));
    setTimeout(() => {
      const next = new Set(this.justInvitedUids());
      next.delete(uid);
      this.justInvitedUids.set(next);
    }, JUST_INVITED_DURATION_MS);
  }

  private markInviteSuccess(): void {
    this.inviteSectionExpanded.set(false);
    this.inviteSuccess.set(true);
    setTimeout(() => this.inviteSuccess.set(false), JUST_INVITED_DURATION_MS);
  }

  private notSelfEmailValidator() {
    return (control: AbstractControl<string>): ValidationErrors | null => {
      const value = control.value?.trim().toLowerCase();
      const currentEmail = this.auth.currentUser?.email?.trim().toLowerCase();
      return value && currentEmail && value === currentEmail ? { selfInvite: true } : null;
    };
  }

  private alreadyMemberValidator() {
    return (control: AbstractControl<string>): ValidationErrors | null => {
      const value = control.value?.trim().toLowerCase();
      if (!value) {
        return null;
      }
      const isMember = this.members().some((member) => member.email?.trim().toLowerCase() === value);
      return isMember ? { alreadyMember: true } : null;
    };
  }

  private async buzz(): Promise<void> {
    try {
      await Haptics.impact({ style: ImpactStyle.Light });
    } catch {
      // Sin soporte háptico (navegador de escritorio) — no bloquea la UI.
    }
  }

  private async notify(type: NotificationType): Promise<void> {
    try {
      await Haptics.notification({ type });
    } catch {
      // Sin soporte háptico (navegador de escritorio) — no bloquea la UI.
    }
  }
}
