import { DecimalPipe } from '@angular/common';
import { Component, DestroyRef, ElementRef, computed, effect, inject, input, output, signal, viewChild } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { type AbstractControl, FormBuilder, ReactiveFormsModule, type ValidationErrors, Validators } from '@angular/forms';
import { Browser } from '@capacitor/browser';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { Chart, registerables } from 'chart.js';
import { switchMap } from 'rxjs';

import { Auth } from '../../../core/auth/auth';
import { AttachmentsService } from '../../../core/attachments/attachments';
import { GoalEntriesService } from '../../../core/goal-entries/goal-entries';
import { GoalEntryFormState } from '../../../core/goal-entry-form-state/goal-entry-form-state';
import {
  computeGoalContributorBreakdown,
  computeGoalPercentage,
  computeGoalSavedAmount,
  computeOpenEndedPercentage,
  distinctContributorCount,
} from '../../../core/goal-progress/goal-progress';
import { GroupsService, type GroupMemberProfile } from '../../../core/groups/groups';
import { ModalStack } from '../../../core/modal-stack/modal-stack';
import { MovementsService } from '../../../core/movements/movements';
import { SharedExpenseFormState } from '../../../core/shared-expense-form-state/shared-expense-form-state';
import { ThemeService } from '../../../core/theme/theme';
import { isSavingsGoal, isSharedGroup } from '../../../models/group.model';
import { AnimatedNumber } from '../../../shared/animated-number/animated-number';
import { Avatar } from '../../../shared/avatar/avatar';
import { MfxCurrencyPipe } from '../../../shared/currency/currency.pipe';
import { Modal } from '../../../shared/modal/modal';
import { ProgressRing } from '../../../shared/progress-ring/progress-ring';
import { GroupActivity } from '../group-activity/group-activity';
import { GroupBalance } from '../group-balance/group-balance';

Chart.register(...registerables);

const JUST_INVITED_DURATION_MS = 2000;
// Mismo criterio visual que Groups/Home (ver MAX_STACKED_AVATARS ahí): hasta
// 3 avatares superpuestos antes de pasar a un "+N".
const MAX_STACKED_AVATARS = 3;

// Mismo criterio que EXTRA_CHART_COLORS en home.ts (categoryChart) — no
// existe un color por persona en mfx-avatar (el fallback sin foto es
// siempre --primary para todos), así que la torta de aportes usa esta
// misma paleta cíclica por índice, no un color "propio" de cada persona.
const CONTRIBUTOR_CHART_EXTRA_COLORS = ['#5AC8FA', '#B388FF', '#FF8FB1'];

// Chart.js dibuja en <canvas> vía opciones JS, no CSS — nunca hereda los
// custom properties del tema por su cuenta (mismo motivo y misma función
// que en home.ts, duplicada acá: no hay un helper compartido para esto).
function resolvedColor(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

@Component({
  selector: 'mfx-group-detail',
  imports: [ReactiveFormsModule, Avatar, AnimatedNumber, Modal, GroupBalance, GroupActivity, ProgressRing, MfxCurrencyPipe, DecimalPipe],
  templateUrl: './group-detail.html',
  styleUrl: './group-detail.scss',
})
export class GroupDetail {
  private readonly groupsService = inject(GroupsService);
  private readonly movementsService = inject(MovementsService);
  private readonly goalEntriesService = inject(GoalEntriesService);
  private readonly goalEntryFormState = inject(GoalEntryFormState);
  private readonly attachmentsService = inject(AttachmentsService);
  private readonly auth = inject(Auth);
  private readonly fb = inject(FormBuilder);
  private readonly sharedExpenseFormState = inject(SharedExpenseFormState);
  private readonly modalStack = inject(ModalStack);
  private readonly themeService = inject(ThemeService);

  readonly groupId = input.required<string>();
  readonly left = output<void>();

  private readonly groups = toSignal(this.groupsService.groups$, { initialValue: [] });
  readonly group = computed(() => this.groups().find((g) => g.id === this.groupId()) ?? null);
  // isSavingsGoal() se chequea PRIMERO en la plantilla — isSharedGroup()
  // también da true para una meta (no es 'personal'), pero una meta nunca
  // muestra "Balance"/deuda entre personas (ver isSavingsGoal() en
  // group.model.ts).
  readonly isSharedGroup = computed(() => isSharedGroup(this.group()));
  readonly isSavingsGoal = computed(() => isSavingsGoal(this.group()));

  // Meta de ahorro (ver DATABASE.md) — ledger aparte de movements/
  // settlements, calculado en el cliente (mismo criterio que el balance de
  // grupo: "calculado, no almacenado").
  private readonly goalEntries = toSignal(
    toObservable(this.groupId).pipe(switchMap((id) => this.goalEntriesService.entries$(id))),
    { initialValue: [] }
  );
  readonly goalSavedAmount = computed(() => computeGoalSavedAmount(this.goalEntries()));
  readonly isOpenEndedGoal = computed(() => this.group()?.goalMode === 'open-ended');
  // Modo 'target': % del monto objetivo. Modo 'open-ended': % hacia el
  // PRÓXIMO múltiplo del monto de celebración (ver computeOpenEndedPercentage
  // en goal-progress.ts) — en ambos casos el anillo clampea a 100, aunque
  // el valor real pueda superarlo (ver computeGoalPercentage).
  readonly goalProgressPercent = computed(() => {
    const group = this.group();
    if (group?.goalMode === 'open-ended') {
      return Math.min(100, computeOpenEndedPercentage(this.goalSavedAmount(), group.celebrationAmount ?? 0).percentage);
    }
    return Math.min(100, computeGoalPercentage(this.goalSavedAmount(), group?.targetAmount ?? 0));
  });
  // Cuánto falta para la próxima celebración en modo 'open-ended' — p. ej.
  // con celebrationAmount 1.000.000 y 650.000 ahorrados, faltan 350.000.
  // Directo por módulo (no vía computeOpenEndedPercentage) para no perder
  // precisión en el viaje de ida y vuelta por porcentaje.
  readonly goalNextCelebrationRemaining = computed(() => {
    const celebrationAmount = this.group()?.celebrationAmount ?? 0;
    if (celebrationAmount <= 0) {
      return 0;
    }
    const safeSaved = Math.max(0, this.goalSavedAmount());
    return celebrationAmount - (safeSaved % celebrationAmount);
  });
  readonly goalEntriesSorted = computed(() =>
    [...this.goalEntries()].sort((a, b) => b.date.toMillis() - a.date.toMillis())
  );
  readonly goalTargetDateLabel = computed(() => {
    const targetDate = this.group()?.targetDate;
    return targetDate ? targetDate.toDate().toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' }) : null;
  });

  // "Ver aportes por persona" — solo con 2+ miembros Y 2+ personas
  // DISTINTAS que ya hayan aportado algo (una sola porción no dice nada,
  // ver DATABASE.md / "Metas de ahorro"). El desglose en sí (neto real +
  // porción reescalada, nunca negativa) vive en computeGoalContributorBreakdown.
  readonly goalContributorBreakdown = computed(() => computeGoalContributorBreakdown(this.goalEntries()));
  readonly showContributorBreakdownLink = computed(
    () => this.members().length >= 2 && distinctContributorCount(this.goalEntries()) >= 2
  );
  readonly contributorsModalOpen = signal(false);

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

  readonly maxStackedAvatars = MAX_STACKED_AVATARS;

  // Torta de aportes por persona (ver goalContributorBreakdown arriba) —
  // el canvas solo existe mientras contributorsModalOpen() es true (un
  // @if lo monta/desmonta), así que el chart se crea/destruye cada vez
  // que el modal abre/cierra, no una sola vez como los de Home.
  private readonly contributorsCanvas = viewChild<ElementRef<HTMLCanvasElement>>('contributorsCanvas');
  private contributorsChart: Chart<'doughnut'> | null = null;

  // Menú "⋮" (nombre, miembros, zona de peligro) — un mfx-modal anidado
  // dentro de este mismo componente. Funciona porque GroupDetail ya se
  // renderiza como modal a nivel de Shell (fuera del árbol de Swiper), así
  // que no hereda el problema de position:fixed que obliga a otros modales
  // a vivir en shell.html.
  readonly menuOpen = signal(false);

  readonly members = signal<GroupMemberProfile[]>([]);
  readonly membersLoading = signal(false);
  readonly membersError = signal<string | null>(null);

  readonly editingName = signal(false);
  readonly nameControl = this.fb.nonNullable.control('', [Validators.required, Validators.minLength(2)]);
  readonly savingName = signal(false);
  readonly nameError = signal<string | null>(null);

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

    // "Zona de peligro" vive dentro del mismo mfx-modal del menú "⋮" (no es
    // un modal propio) — sin esto, el botón atrás de Android (ver
    // ModalStack) se saltaría la confirmación y cerraría el menú entero de
    // un golpe. Al registrarla como su propia entrada en la pila, un back
    // primero cancela la confirmación y solo un segundo back cierra el menú.
    effect((onCleanup) => {
      if (!this.confirmingDeleteGroup()) {
        return;
      }
      const onBack = () => this.cancelDeleteGroup();
      this.modalStack.push(onBack);
      onCleanup(() => this.modalStack.pop(onBack));
    });

    // Mismo "botón atrás cancela antes de cerrar" que confirmingDeleteGroup
    // arriba — el modal de la torta vive anidado dentro de este mismo
    // componente, igual que el menú "⋮".
    effect((onCleanup) => {
      if (!this.contributorsModalOpen()) {
        return;
      }
      const onBack = () => this.closeContributorsModal();
      this.modalStack.push(onBack);
      onCleanup(() => this.modalStack.pop(onBack));
    });

    // Construye/actualiza la torta de aportes — mismo patrón que
    // categoryChart en home.ts (canvas vía viewChild, colores resueltos
    // del tema en vivo). A diferencia de Home, el canvas se desmonta al
    // cerrar el modal: cuando desaparece, se destruye el chart en vez de
    // dejarlo "vivo" apuntando a un <canvas> que ya no existe.
    effect(() => {
      const canvas = this.contributorsCanvas()?.nativeElement;
      this.themeService.theme(); // re-construye los colores si cambia el tema en vivo
      if (!canvas) {
        this.contributorsChart?.destroy();
        this.contributorsChart = null;
        return;
      }

      const breakdown = this.goalContributorBreakdown();
      const labels = breakdown.map((entry) => this.memberName(entry.uid));
      const values = breakdown.map((entry) => entry.displayAmount);
      const palette = [
        resolvedColor('--primary'),
        resolvedColor('--accent'),
        resolvedColor('--danger'),
        ...CONTRIBUTOR_CHART_EXTRA_COLORS,
      ];
      const colors = breakdown.map((_, i) => palette[i % palette.length]);

      if (this.contributorsChart) {
        this.contributorsChart.data.labels = labels;
        this.contributorsChart.data.datasets[0].data = values;
        this.contributorsChart.data.datasets[0].backgroundColor = colors;
        this.contributorsChart.update();
        return;
      }
      this.contributorsChart = new Chart(canvas, {
        type: 'doughnut',
        data: { labels, datasets: [{ data: values, backgroundColor: colors, borderWidth: 0 }] },
        // legend: false — la leyenda la dibuja la plantilla a mano (avatar +
        // nombre + monto neto + %, ver group-detail.html), no la de Chart.js.
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } },
      });
    });

    inject(DestroyRef).onDestroy(() => this.contributorsChart?.destroy());
  }

  openMenu(): void {
    this.menuOpen.set(true);
  }

  closeMenu(): void {
    this.menuOpen.set(false);
  }

  startEditName(): void {
    this.nameControl.setValue(this.group()?.name ?? '');
    this.nameError.set(null);
    this.editingName.set(true);
  }

  cancelEditName(): void {
    this.editingName.set(false);
  }

  async saveName(): Promise<void> {
    if (this.nameControl.invalid) {
      this.nameControl.markAsTouched();
      return;
    }
    const group = this.group();
    if (!group) {
      return;
    }

    this.savingName.set(true);
    this.nameError.set(null);

    try {
      await this.groupsService.rename(group.id, this.nameControl.getRawValue().trim());
      this.editingName.set(false);
    } catch (error) {
      console.error('Error al renombrar el grupo', error);
      this.nameError.set('No pudimos actualizar el nombre. Intenta de nuevo.');
    } finally {
      this.savingName.set(false);
    }
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

  // "+ Agregar gasto" siempre abre el formulario estándar de gasto
  // compartido, sin importar el type del grupo — incluido uno personal
  // de un solo miembro (ver Fase 9, corrección posterior al primer intento
  // de esta feature, que sí tenía una rama especial acá).
  addExpense(): void {
    this.sharedExpenseFormState.openCreate(this.groupId());
  }

  formatGoalEntryDate(entry: { date: { toDate: () => Date } }): string {
    return entry.date.toDate().toLocaleDateString('es-CO', { day: 'numeric', month: 'short' });
  }

  // GoalEntryForm no tiene modo edición (ver ese archivo) — este es el
  // ÚNICO lugar donde se puede volver a ver el adjunto de un aporte/retiro
  // ya guardado, ya que no hay un formulario al que volver a abrir. Mismo
  // bug/fix que AttachmentPicker.openAttachment(): window.open() es poco
  // confiable en el WebView nativo, @capacitor/browser (Chrome Custom Tabs)
  // no. A diferencia de ese componente, acá SIEMPRE hay una URL real — este
  // path solo se llama con entry.attachmentPath, que viene de un goalEntry
  // YA guardado en Firestore (nunca hay un adjunto "pendiente" que mostrar).
  async openGoalEntryAttachment(path: string): Promise<void> {
    try {
      const url = await this.attachmentsService.getDownloadUrl(path);
      await Browser.open({ url });
    } catch (error) {
      console.error('Error al abrir el adjunto', error);
    }
  }

  addGoalEntry(): void {
    const group = this.group();
    if (!group) {
      return;
    }
    this.goalEntryFormState.open({ groupId: group.id, groupName: group.name });
  }

  memberName(uid: string): string {
    return this.members().find((member) => member.uid === uid)?.displayName || 'Sin nombre';
  }

  memberProfile(uid: string): GroupMemberProfile | null {
    return this.members().find((member) => member.uid === uid) ?? null;
  }

  // Mismo índice/paleta que el effect() del chart (ver constructor) — así
  // el punto de color de la leyenda coincide con la porción de la torta.
  contributorColorClass(index: number): string {
    const palette = ['primary', 'accent', 'danger', 'extra-1', 'extra-2', 'extra-3'];
    return `mfx-group-detail__contributor-dot--${palette[index % palette.length]}`;
  }

  openContributorsModal(): void {
    this.contributorsModalOpen.set(true);
  }

  closeContributorsModal(): void {
    this.contributorsModalOpen.set(false);
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
