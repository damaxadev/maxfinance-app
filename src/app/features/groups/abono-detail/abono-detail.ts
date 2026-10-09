import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import type { Timestamp } from 'firebase/firestore';
import { switchMap } from 'rxjs';

import type { AbonoDetailContext } from '../../../core/abono-detail-state/abono-detail-state';
import { Accounts } from '../../../core/accounts/accounts';
import { Auth } from '../../../core/auth/auth';
import { type Debt, debtsByMovement } from '../../../core/debts/debts';
import { GroupsService, type GroupMemberProfile } from '../../../core/groups/groups';
import { ModalStack } from '../../../core/modal-stack/modal-stack';
import { MovementsService, type SharedMovementWithId } from '../../../core/movements/movements';
import { sharedMovementLabel } from '../../../core/movements/movement-label';
import { SettlementsService, type SettlementWithId } from '../../../core/settlements/settlements';
import type { SettlementAllocation } from '../../../models/settlement.model';
import { AttachmentPicker, type PendingAttachment } from '../../../shared/attachment-picker/attachment-picker';
import { Avatar } from '../../../shared/avatar/avatar';
import { MfxCurrencyPipe } from '../../../shared/currency/currency.pipe';

const UNKNOWN_MEMBER: GroupMemberProfile = { uid: '', displayName: 'Alguien', email: '', photoURL: '' };

@Component({
  selector: 'mfx-abono-detail',
  imports: [FormsModule, AttachmentPicker, Avatar, MfxCurrencyPipe],
  templateUrl: './abono-detail.html',
  styleUrl: './abono-detail.scss',
})
export class AbonoDetail {
  private readonly settlementsService = inject(SettlementsService);
  private readonly movementsService = inject(MovementsService);
  private readonly groupsService = inject(GroupsService);
  private readonly accountsService = inject(Accounts);
  private readonly auth = inject(Auth);
  private readonly modalStack = inject(ModalStack);

  readonly context = input.required<AbonoDetailContext>();
  private readonly groupId = computed(() => this.context().groupId);

  readonly currentUid = computed(() => this.auth.currentUser?.uid ?? null);
  readonly accounts = toSignal(this.accountsService.accounts$, { initialValue: [] });

  readonly members = signal<GroupMemberProfile[]>([]);

  private readonly settlements = toSignal(
    toObservable(this.groupId).pipe(switchMap((id) => this.settlementsService.settlements$(id))),
    { initialValue: [] as SettlementWithId[] }
  );
  private readonly movements = toSignal(
    toObservable(this.groupId).pipe(switchMap((id) => this.movementsService.groupMovements$(id))),
    { initialValue: [] as SharedMovementWithId[] }
  );

  // Siempre en vivo (nunca el snapshot con el que se abrió el modal) —
  // anular/editar nota/adjunto mientras está abierto se refleja solo, y si
  // el documento desaparece (no debería pasar, los abonos no se borran)
  // settlement() cae a null y la plantilla lo avisa.
  readonly settlement = computed<SettlementWithId | null>(
    () => this.settlements().find((s) => s.id === this.context().settlementId) ?? null
  );

  readonly isParty = computed(() => {
    const s = this.settlement();
    const uid = this.currentUid();
    return !!s && !!uid && (uid === s.fromUid || uid === s.toUid);
  });
  readonly isVoided = computed(() => this.settlement()?.status === 'voided');
  readonly isActive = computed(() => !this.isVoided());
  readonly isLegacy = computed(() => !this.settlement()?.allocations?.length);

  private readonly movementsById = computed(() => new Map(this.movements().map((m) => [m.id, m])));
  private readonly debtsByMovementId = computed(() => debtsByMovement(this.movements(), this.settlements()));

  constructor() {
    // Mismo patrón que SharedExpenseForm: fetch async de perfiles cada vez
    // que cambia el grupo (acá en la práctica es fijo por apertura, pero
    // sigue el mismo criterio por si el modal se reabre con otro contexto).
    effect(() => {
      const id = this.groupId();
      this.groupsService
        .getMemberProfiles(id)
        .then((profiles) => this.members.set(profiles))
        .catch((error) => console.error('Error al cargar los miembros del grupo', error));
    });

    // ¿Ya existe un movimiento personal vinculado a este abono, para el
    // usuario actual? Solo se consulta por ESTE id (no todos los del feed,
    // a diferencia de como lo hacía GroupActivity antes de moverlo acá).
    effect(() => {
      const s = this.settlement();
      const uid = this.currentUid();
      if (!s || !uid) {
        this.linkedAlready.set(false);
        return;
      }
      this.settlementsService
        .findLinkedMovementSettlementIds([s.id], uid)
        .then((ids) => this.linkedAlready.set(ids.has(s.id)))
        .catch((error) => console.error('Error al verificar si ya se registró este abono', error));
    });

    // Nota: se precarga una sola vez (el primer settlement() no nulo) — no
    // se vuelve a pisar en cada emisión del listener, para no borrar lo que
    // el usuario esté escribiendo (ver noteDraft más abajo).
    effect(() => {
      const s = this.settlement();
      if (s && !this.noteInitialized) {
        this.noteDraft.set(s.note);
        this.noteInitialized = true;
      }
    });

    // Back de Android: un primer back cierra el formulario de "Anular"
    // (vuelve al detalle), solo un segundo cierra el modal completo — mismo
    // criterio que confirmingDelete en SharedExpenseForm.
    effect((onCleanup) => {
      if (!this.confirmingVoid()) {
        return;
      }
      const onBack = () => this.confirmingVoid.set(false);
      this.modalStack.push(onBack);
      onCleanup(() => this.modalStack.pop(onBack));
    });
  }

  memberProfile(uid: string): GroupMemberProfile {
    return this.members().find((member) => member.uid === uid) ?? { ...UNKNOWN_MEMBER, uid };
  }

  formatDate(ts: Timestamp): string {
    return ts.toDate().toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  formatDateTime(ts: Timestamp): string {
    return ts.toDate().toLocaleDateString('es-CO', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }

  // "Registrado el... por..." — null si el abono es legacy (de antes de
  // createdBy/createdAt, ambos ausentes a la vez). createdAt === null es un
  // serverTimestamp() todavía sin resolver en el snapshot local (recién
  // creado) — se muestra "justo ahora" en vez de nada (mismo criterio que
  // orderMillis en GroupActivity).
  readonly createdAtLabel = computed(() => {
    const s = this.settlement();
    if (!s || s.createdAt === undefined) {
      return null;
    }
    const createdAt = s.createdAt as Timestamp | null;
    const when = createdAt ? this.formatDateTime(createdAt) : 'justo ahora';
    const name = this.memberProfile(s.createdBy ?? '').displayName || 'alguien';
    return `Registrado el ${when} por ${name}`;
  });

  readonly modeLabel = computed(() => {
    const mode = this.settlement()?.allocationMode;
    if (mode === 'auto') {
      return 'Automático (deudas más antiguas)';
    }
    if (mode === 'manual') {
      return 'Manual';
    }
    return null;
  });

  // --- desglose (gastos/cuotas que cubre este abono) ---

  allocationLabel(allocation: SettlementAllocation): string {
    const movement = this.movementsById().get(allocation.movementId);
    const base = movement ? sharedMovementLabel(movement) : 'Gasto eliminado';
    return allocation.installmentIndex === null ? base : `${base} · cuota ${allocation.installmentIndex + 1}`;
  }

  // Estado ACTUAL de la deuda que cubre esa allocation — nunca un snapshot
  // de cuando se creó el abono, siempre recalculado desde computeDebts().
  allocationStatus(allocation: SettlementAllocation): Debt['status'] | null {
    const debts = this.debtsByMovementId().get(allocation.movementId) ?? [];
    return debts.find((debt) => debt.installmentIndex === allocation.installmentIndex)?.status ?? null;
  }

  // --- nota (editable solo mientras está activo, ver firestore.rules) ---

  readonly noteDraft = signal('');
  private noteInitialized = false;
  readonly savingNote = signal(false);
  readonly noteError = signal<string | null>(null);

  readonly noteChanged = computed(() => this.noteDraft().trim() !== (this.settlement()?.note ?? ''));

  async saveNote(): Promise<void> {
    const s = this.settlement();
    if (!s || !this.noteChanged()) {
      return;
    }
    this.savingNote.set(true);
    this.noteError.set(null);
    try {
      await this.settlementsService.updateNote(s.id, this.noteDraft().trim());
    } catch (error) {
      console.error('Error al guardar la nota del abono', error);
      this.noteError.set('No pudimos guardar la nota. Intenta de nuevo.');
    } finally {
      this.savingNote.set(false);
    }
  }

  // --- adjunto (hidden entirely for third parties — ver storage.rules) ---

  readonly uploadingAttachment = signal(false);
  readonly removingAttachment = signal(false);
  readonly attachmentError = signal<string | null>(null);

  async onAttachmentReady(pending: PendingAttachment | null): Promise<void> {
    const s = this.settlement();
    if (!pending || !s) {
      return;
    }
    this.uploadingAttachment.set(true);
    this.attachmentError.set(null);
    try {
      await this.settlementsService.attachFile(s.id, pending);
    } catch (error) {
      console.error('Error al subir el comprobante del abono', error);
      this.attachmentError.set('No pudimos subir el comprobante. Intenta de nuevo.');
    } finally {
      this.uploadingAttachment.set(false);
    }
  }

  async onAttachmentRemoved(): Promise<void> {
    const s = this.settlement();
    if (!s?.attachmentPath) {
      return;
    }
    this.removingAttachment.set(true);
    this.attachmentError.set(null);
    try {
      await this.settlementsService.removeAttachment(s.id, s.attachmentPath);
    } catch (error) {
      console.error('Error al eliminar el comprobante del abono', error);
      this.attachmentError.set('No pudimos eliminar el comprobante. Intenta de nuevo.');
    } finally {
      this.removingAttachment.set(false);
    }
  }

  // --- anular (terminal, con motivo obligatorio — ver firestore.rules) ---

  readonly confirmingVoid = signal(false);
  readonly voidReason = signal('');
  readonly voiding = signal(false);
  readonly voidError = signal<string | null>(null);
  readonly canConfirmVoid = computed(() => this.voidReason().trim().length >= 3 && !this.voiding());

  startVoid(): void {
    this.voidReason.set('');
    this.voidError.set(null);
    this.confirmingVoid.set(true);
  }

  cancelVoid(): void {
    this.confirmingVoid.set(false);
  }

  async confirmVoid(): Promise<void> {
    const s = this.settlement();
    if (!s || !this.canConfirmVoid()) {
      return;
    }
    this.voiding.set(true);
    this.voidError.set(null);
    try {
      await this.settlementsService.voidSettlement(s, this.voidReason());
      this.confirmingVoid.set(false);
    } catch (error) {
      console.error('Error al anular el abono', error);
      this.voidError.set(error instanceof Error ? error.message : 'No pudimos anular el abono. Intenta de nuevo.');
    } finally {
      this.voiding.set(false);
    }
  }

  // --- registrar como gasto/ingreso personal (bloqueado si está anulado) ---

  readonly linkedAlready = signal(false);
  readonly linkingOpen = signal(false);
  readonly linkAccountId = signal('');
  readonly linking = signal(false);
  readonly linkError = signal<string | null>(null);

  readonly linkLabel = computed(() => {
    const s = this.settlement();
    const uid = this.currentUid();
    if (!s || !uid) {
      return null;
    }
    if (uid === s.fromUid) {
      return 'Registrar como gasto';
    }
    if (uid === s.toUid) {
      return 'Registrar como ingreso';
    }
    return null;
  });

  startLinking(): void {
    this.linkingOpen.set(true);
    this.linkAccountId.set('');
    this.linkError.set(null);
  }

  cancelLinking(): void {
    this.linkingOpen.set(false);
  }

  async confirmLinking(): Promise<void> {
    const s = this.settlement();
    if (!s) {
      return;
    }
    const accountId = this.linkAccountId();
    if (!accountId) {
      this.linkError.set('Selecciona una cuenta.');
      return;
    }

    this.linking.set(true);
    this.linkError.set(null);
    try {
      await this.settlementsService.linkPersonalMovement(s, accountId);
      this.linkedAlready.set(true);
      this.linkingOpen.set(false);
    } catch (error) {
      console.error('Error al registrar el movimiento vinculado', error);
      this.linkError.set(error instanceof Error ? error.message : 'No pudimos registrar el movimiento. Intenta de nuevo.');
    } finally {
      this.linking.set(false);
    }
  }
}
