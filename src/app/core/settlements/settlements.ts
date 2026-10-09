import { Injectable, inject } from '@angular/core';
import { Observable, catchError, combineLatest, firstValueFrom, map, of, switchMap } from 'rxjs';
import {
  Firestore,
  Timestamp,
  collection,
  collectionData,
  doc,
  documentId,
  getDocs,
  increment,
  query,
  serverTimestamp,
  updateDoc,
  where,
  type WriteBatch,
  writeBatch,
} from '@angular/fire/firestore';

import { Auth } from '../auth/auth';
import { AttachmentsService } from '../attachments/attachments';
import type { PreparedAttachment } from '../attachments/attachment-compression';
import { Categories } from '../categories/categories';
import { type Debt, autoAllocateOldestFirst, computeDebts } from '../debts/debts';
import { MovementsService } from '../movements/movements';
import type { PersonalMovement } from '../../models/movement.model';
import type { Settlement, SettlementAllocation, SettlementStatus } from '../../models/settlement.model';

export type SettlementWithId = Settlement & { id: string };

// A qué deuda puntual aplica una porción del abono (ver createSettlement())
// — `full: true` en vez de `amount` significa "lo que falte de ESTA deuda,
// calculado fresco al momento de escribir, nunca lo que ya traía el
// caller" (ver DATABASE.md, "Balance de grupo y abonos" — "pagar completo"
// nunca recalcula fuera de este punto).
export type AllocationRequest = {
  movementId: string;
  debtorUid: string;
  installmentIndex: number | null;
} & ({ amount: number } | { full: true });

export interface CreateSettlementBaseInput {
  groupId: string;
  fromUid: string;
  toUid: string;
  note: string;
  personalMovementAccountId: string | null;
  // Ausente == ahora mismo (Timestamp.fromDate(new Date())) — el modal de
  // abono sí ofrece un campo de fecha (hoy por defecto, editable).
  date?: Date;
}

export interface CreateSettlementManualInput extends CreateSettlementBaseInput {
  allocationMode: 'manual';
  allocations: AllocationRequest[];
  // Opcional: si se pasa, debe coincidir con la suma de las allocations ya
  // resueltas (full -> remaining fresco) — si no coincide, se rechaza. Si
  // se omite, el monto del abono se deriva de esa suma.
  amount?: number;
}

export interface CreateSettlementAutoInput extends CreateSettlementBaseInput {
  // "Marcar como saldada"/"Abonar" con "Distribuir automático": no se pasan
  // allocations, se reparte `amount` a las deudas más antiguas de fromUid
  // -> toUid (ver autoAllocateOldestFirst).
  allocationMode: 'auto';
  amount: number;
}

export type CreateSettlementInput = CreateSettlementManualInput | CreateSettlementAutoInput;

// Errores de createSettlement() causados por datos que cambiaron ENTRE que
// se abrió el modal y que se envió (alguien más abonó, o una deuda ya no
// está vigente) — ver la relectura fresca más abajo. El caller (AbonoForm)
// los distingue de un error genérico para mostrar un mensaje claro y
// recargar las deudas, en vez de "No pudimos registrar el pago."
export class StaleDebtError extends Error {}

// Nombres fijos de las categorías base usadas al convertir un settlement en
// movimiento personal — ver DATABASE.md. No son elegibles por el usuario,
// se resuelven automáticamente según si pagó o recibió.
const DEBT_PAYMENT_CATEGORY_NAME = 'Pago de deuda';
const OTHER_INCOME_CATEGORY_NAME = 'Otros ingresos';

@Injectable({
  providedIn: 'root',
})
export class SettlementsService {
  private readonly firestore = inject(Firestore);
  private readonly auth = inject(Auth);
  private readonly categories = inject(Categories);
  private readonly movementsService = inject(MovementsService);
  private readonly attachmentsService = inject(AttachmentsService);

  // groupId es un filtro de igualdad (constante conocida), así que Firestore
  // puede probar isGroupMember(groupId) estáticamente para toda la lista.
  settlements$(groupId: string): Observable<SettlementWithId[]> {
    return this.auth.currentUser$.pipe(
      switchMap((user) => {
        if (!user) {
          return of([]);
        }
        const settlementsQuery = query(collection(this.firestore, 'settlements'), where('groupId', '==', groupId));
        return collectionData(settlementsQuery, { idField: 'id' }) as Observable<SettlementWithId[]>;
      }),
      catchError((error) => {
        console.error('Error al cargar los settlements del grupo', error);
        return of([]);
      })
    );
  }

  // Settlements de varios grupos a la vez — un query por grupo (mismo
  // criterio que MovementsService.allSharedMovementsForGroups$: cada uno
  // sigue siendo un filtro de igualdad sobre una constante conocida, provable
  // por la regla). Usado por GroupActivity cuando recibe más de un groupId
  // (ver Inicio, "Gastos compartidos recientes").
  settlementsForGroups$(groupIds: string[]): Observable<SettlementWithId[]> {
    return this.auth.currentUser$.pipe(
      switchMap((user) => {
        if (!user || groupIds.length === 0) {
          return of([]);
        }
        const queries$ = groupIds.map((groupId) => this.settlements$(groupId));
        return combineLatest(queries$).pipe(map((lists) => lists.flat()));
      }),
      catchError((error) => {
        console.error('Error al cargar los settlements de los grupos', error);
        return of([]);
      })
    );
  }

  // Estado (activo/voided) de abonos por id, sin filtrar por groupId — a
  // diferencia de settlements$/settlementsForGroups$, acá no se conoce de
  // antemano a qué grupo pertenece cada id (lo usa Movimientos para marcar
  // "Abono anulado" en un movimiento personal con settlementId, que puede
  // venir de CUALQUIER grupo del usuario — ver shell/views/movements). La
  // regla de Firestore (isGroupMember(resource.data.groupId)) se evalúa
  // por documento devuelto incluso en este query por documentId(): si
  // alguna vez deja de sostenerse, catchError lo deja en un mapa vacío —
  // el marcador simplemente no aparece, nunca rompe la vista.
  settlementsStatusByIds$(settlementIds: string[]): Observable<Map<string, SettlementStatus | undefined>> {
    if (settlementIds.length === 0) {
      return of(new Map());
    }
    const chunks: string[][] = [];
    for (let i = 0; i < settlementIds.length; i += 30) {
      chunks.push(settlementIds.slice(i, i + 30));
    }

    const queries$ = chunks.map((ids) => {
      const idsQuery = query(collection(this.firestore, 'settlements'), where(documentId(), 'in', ids));
      return (collectionData(idsQuery, { idField: 'id' }) as Observable<SettlementWithId[]>).pipe(
        catchError((error) => {
          console.error('Error al consultar el estado de abonos vinculados', error);
          return of([] as SettlementWithId[]);
        })
      );
    });

    return combineLatest(queries$).pipe(
      map((lists) => new Map(lists.flat().map((settlement) => [settlement.id, settlement.status])))
    );
  }

  // Abono con allocations (ver DATABASE.md, "Balance de grupo y abonos") —
  // único camino para crear un settlement (el antiguo create(), que no
  // validaba nada ni guardaba allocations, se eliminó: cualquier abono
  // nuevo queda identificado a qué deuda puntual aplica). Un solo modal
  // (AbonoForm) cubre las 3 entradas: "Marcar como saldada" y "Abonar" en
  // GroupBalance, y "Marcar como pagada" de una cuota en GroupActivity —
  // las tres llaman acá, con allocationMode 'auto' o 'manual' según si se
  // tocó algo a mano (ver AbonoForm.allocationMode).
  //
  // Mitigación de concurrencia: relee movements+settlements del grupo
  // FRESCOS justo antes de validar y escribir (en vez de confiar en lo que
  // el caller ya tenía cargado) — reduce la ventana de una carrera entre
  // dos abonos casi simultáneos a la misma deuda a lo que tarda esta
  // relectura más el commit() de abajo. No la cierra del todo: el SDK
  // cliente de Firestore no permite queries dentro de una transacción, así
  // que no hay forma de releer settlements Y escribir en una sola
  // operación atómica. El clamp de computeDebts() (remaining nunca
  // negativo, `anomaly: true`) es la red de seguridad si de verdad se
  // cruzan dos escrituras en esa ventana — no rompe la pantalla, pero el
  // sobrepago puntual puede quedar. Si se necesita una garantía dura, hay
  // que mover esto a una Cloud Function (como payInstallment): el SDK
  // Admin sí soporta queries dentro de una transacción.
  async createSettlement(input: CreateSettlementInput): Promise<string> {
    const uid = this.requireUid();
    if (input.fromUid === input.toUid) {
      throw new Error('fromUid y toUid no pueden ser la misma persona.');
    }
    if (uid !== input.fromUid && uid !== input.toUid) {
      throw new Error('No eres parte de esta deuda.');
    }

    const [movements, settlements] = await Promise.all([
      firstValueFrom(this.movementsService.groupMovements$(input.groupId)),
      firstValueFrom(this.settlements$(input.groupId)),
    ]);
    const debts = computeDebts(movements, settlements);

    const { amount, allocations } =
      input.allocationMode === 'auto' ? this.resolveAutoAllocations(debts, input) : this.resolveManualAllocations(debts, input);

    const batch = writeBatch(this.firestore);
    const settlementRef = doc(collection(this.firestore, 'settlements'));
    // `date` es cuándo PASÓ el pago (hoy por defecto, editable en el
    // modal) — necesita un valor concreto ya mismo para el movimiento
    // vinculado opcional, así que usa la hora del cliente. `createdAt` es
    // cuándo se REGISTRÓ de verdad y es lo que ordena el historial (ver
    // GroupActivity) — serverTimestamp(), no la hora del cliente, para no
    // depender del reloj del teléfono.
    const settlementDate = input.date ? Timestamp.fromDate(input.date) : Timestamp.fromDate(new Date());

    let linkedMovementId: string | null = null;
    if (input.personalMovementAccountId) {
      linkedMovementId = await this.appendLinkedMovement(batch, {
        settlementId: settlementRef.id,
        uid,
        isPayer: uid === input.fromUid,
        accountId: input.personalMovementAccountId,
        amount,
        note: input.note,
        date: settlementDate,
      });
    }

    const settlement: Omit<Settlement, 'createdAt'> & { createdAt: ReturnType<typeof serverTimestamp> } = {
      groupId: input.groupId,
      fromUid: input.fromUid,
      toUid: input.toUid,
      amount,
      date: settlementDate,
      note: input.note,
      linkedMovementId,
      allocations,
      allocationMode: input.allocationMode,
      createdBy: uid,
      createdAt: serverTimestamp(),
    };
    batch.set(settlementRef, settlement);

    await batch.commit();
    return settlementRef.id;
  }

  private resolveAutoAllocations(
    debts: Debt[],
    input: CreateSettlementAutoInput
  ): { amount: number; allocations: SettlementAllocation[] } {
    if (input.amount <= 0) {
      throw new Error('El monto debe ser mayor a cero.');
    }
    const plan = autoAllocateOldestFirst(debts, input.fromUid, input.toUid, input.amount);
    if (!plan) {
      throw new StaleDebtError('Ese monto supera lo que se debe entre estas dos personas.');
    }
    return { amount: input.amount, allocations: plan };
  }

  private resolveManualAllocations(
    debts: Debt[],
    input: CreateSettlementManualInput
  ): { amount: number; allocations: SettlementAllocation[] } {
    if (input.allocations.length === 0) {
      throw new Error('Falta indicar a qué deuda aplica el abono.');
    }

    const allocations = input.allocations.map((request) => {
      const debt = debts.find(
        (candidate) =>
          candidate.movementId === request.movementId &&
          candidate.debtorUid === request.debtorUid &&
          candidate.installmentIndex === request.installmentIndex
      );
      if (!debt) {
        throw new StaleDebtError('Esa deuda no existe o ya no está vigente.');
      }
      // Nunca en el sentido contrario: una allocation solo puede cubrir una
      // deuda de fromUid hacia toUid.
      if (debt.debtorUid !== input.fromUid || debt.creditorUid !== input.toUid) {
        throw new Error('Esa deuda no es entre estas dos personas, en ese sentido.');
      }

      const amount = 'full' in request ? debt.remaining : request.amount;
      if (amount <= 0) {
        throw new Error('El monto debe ser mayor a cero.');
      }
      if (Math.round(amount * 100) > Math.round(debt.remaining * 100)) {
        throw new StaleDebtError('Ese abono supera lo que falta de esa deuda.');
      }

      return {
        movementId: debt.movementId,
        debtorUid: debt.debtorUid,
        installmentIndex: debt.installmentIndex,
        amount,
      };
    });

    const total = allocations.reduce((sum, allocation) => sum + allocation.amount, 0);
    if (input.amount !== undefined && Math.round(input.amount * 100) !== Math.round(total * 100)) {
      throw new Error('La suma de lo asignado no coincide con el monto del abono.');
    }

    return { amount: total, allocations };
  }

  // Convierte un settlement YA EXISTENTE en movimiento personal, de forma
  // independiente de si el otro lado (o este mismo, al crearlo) ya lo hizo.
  // No se toca el settlement ni su linkedMovementId: DATABASE.md es explícito
  // en que esa relación se deriva consultando movements, no se guarda un mapa
  // de "quién ya convirtió el suyo".
  //
  // Un abono anulado ya no se puede registrar (ver DATABASE.md, "Balance de
  // grupo y abonos"). Y se releen fresco (ANTES de escribir) tanto eso como
  // "¿ya lo registré?" — el chequeo de la UI (findLinkedMovementSettlementIds,
  // usado para mostrar/ocultar el botón) es solo eso, una pista visual; dos
  // taps casi simultáneos (o dos dispositivos) podrían pasarlo igual. Misma
  // mitigación y mismo residual que createSettlement(): reduce la ventana de
  // la carrera, no la cierra del todo (el SDK cliente no permite queries
  // dentro de una transacción).
  async linkPersonalMovement(settlement: SettlementWithId, accountId: string): Promise<void> {
    const uid = this.requireUid();

    const [freshSettlement, alreadyLinked] = await Promise.all([
      this.getSettlement(settlement.groupId, settlement.id),
      this.findLinkedMovementSettlementIds([settlement.id], uid),
    ]);
    if (!freshSettlement) {
      throw new Error('Este abono ya no existe.');
    }
    if (freshSettlement.status === 'voided') {
      throw new Error('Este abono fue anulado — ya no se puede registrar.');
    }
    if (alreadyLinked.has(settlement.id)) {
      throw new Error('Ya registraste este abono.');
    }

    const batch = writeBatch(this.firestore);
    await this.appendLinkedMovement(batch, {
      settlementId: settlement.id,
      uid,
      isPayer: uid === settlement.fromUid,
      accountId,
      amount: settlement.amount,
      note: settlement.note,
      date: Timestamp.fromDate(new Date()),
    });

    await batch.commit();
  }

  // Anular (ver DATABASE.md): terminal, nunca se des-anula — para
  // corregirlo se registra un abono nuevo. Solo fromUid/toUid, con motivo
  // (recortado, mínimo 3 caracteres — mismo mínimo que exige la regla de
  // Firestore, para que el botón quede deshabilitado ANTES de intentar
  // escribir, no solo después de que la regla lo rechace).
  async voidSettlement(settlement: SettlementWithId, reason: string): Promise<void> {
    const uid = this.requireUid();
    if (uid !== settlement.fromUid && uid !== settlement.toUid) {
      throw new Error('No eres parte de este abono.');
    }
    if (settlement.status === 'voided') {
      throw new Error('Este abono ya está anulado.');
    }
    const trimmedReason = reason.trim();
    if (trimmedReason.length < 3) {
      throw new Error('Escribe un motivo de al menos 3 caracteres.');
    }

    await updateDoc(doc(this.firestore, 'settlements', settlement.id), {
      status: 'voided',
      voidedBy: uid,
      voidedAt: serverTimestamp(),
      voidReason: trimmedReason,
    });
  }

  // La nota es el único campo de texto libre editable después de creado,
  // con el abono todavía activo (ver firestore.rules) — adjunto aparte, ver
  // attachFile()/removeAttachment() abajo.
  async updateNote(settlementId: string, note: string): Promise<void> {
    await updateDoc(doc(this.firestore, 'settlements', settlementId), { note });
  }

  // Un solo comprobante por abono, mismo patrón que MovementsService.
  // attachFile() — se sube DESPUÉS de que el doc ya existe (la regla de
  // Storage necesita leerlo vía firestore.get() para saber de quién es).
  async attachFile(settlementId: string, attachment: PreparedAttachment): Promise<void> {
    const path = `settlements/${settlementId}/attachment`;
    await this.attachmentsService.upload(path, attachment.blob, attachment.contentType);
    await updateDoc(doc(this.firestore, 'settlements', settlementId), {
      attachmentPath: path,
      attachmentContentType: attachment.contentType,
    });
  }

  async removeAttachment(settlementId: string, attachmentPath: string): Promise<void> {
    await this.attachmentsService.remove(attachmentPath);
    await updateDoc(doc(this.firestore, 'settlements', settlementId), {
      attachmentPath: null,
      attachmentContentType: null,
    });
  }

  // Lectura puntual de UN settlement, fresca (no del cache de un listener
  // viejo) — usada solo para la relectura defensiva de arriba. Filtra por
  // groupId (igual que settlements$) para que la regla pueda probar
  // isGroupMember() estáticamente.
  private async getSettlement(groupId: string, settlementId: string): Promise<SettlementWithId | null> {
    const settlements = await firstValueFrom(this.settlements$(groupId));
    return settlements.find((s) => s.id === settlementId) ?? null;
  }

  // ¿Ya existe un movimiento personal de ESTE usuario vinculado a cada uno
  // de estos settlements? groupId == null hace la lectura provable contra
  // la regla (misma razón que personalMovements$) — sin ese filtro, Firestore
  // no podría descartar que algún resultado cayera en la rama de grupo.
  async findLinkedMovementSettlementIds(settlementIds: string[], uid: string): Promise<Set<string>> {
    if (settlementIds.length === 0) {
      return new Set();
    }
    // 'in' acepta hasta 30 valores — de sobra para el historial (~10) y para
    // la vista "ver todos", que tampoco crece más allá de unas decenas.
    const chunks: string[][] = [];
    for (let i = 0; i < settlementIds.length; i += 30) {
      chunks.push(settlementIds.slice(i, i + 30));
    }

    const results = await Promise.all(
      chunks.map(async (ids) => {
        const linkedQuery = query(
          collection(this.firestore, 'movements'),
          where('settlementId', 'in', ids),
          where('uid', '==', uid),
          where('groupId', '==', null)
        );
        const snapshot = await getDocs(linkedQuery);
        return snapshot.docs.map((d) => d.data()['settlementId'] as string);
      })
    );

    return new Set(results.flat());
  }

  private async appendLinkedMovement(
    batch: WriteBatch,
    params: {
      settlementId: string;
      uid: string;
      isPayer: boolean;
      accountId: string;
      amount: number;
      note: string;
      date: Timestamp;
    }
  ): Promise<string> {
    const categoryName = params.isPayer ? DEBT_PAYMENT_CATEGORY_NAME : OTHER_INCOME_CATEGORY_NAME;
    const categoryId = await this.findBaseCategoryId(categoryName);

    const movementRef = doc(collection(this.firestore, 'movements'));
    const movement: Omit<PersonalMovement, 'createdAt'> & { createdAt: ReturnType<typeof serverTimestamp> } = {
      uid: params.uid,
      accountId: params.accountId,
      categoryId,
      type: params.isPayer ? 'expense' : 'income',
      amount: params.amount,
      date: params.date,
      note: params.note,
      groupId: null,
      settlementId: params.settlementId,
      createdAt: serverTimestamp(),
    };
    batch.set(movementRef, movement);

    const accountRef = doc(this.firestore, 'accounts', params.accountId);
    batch.update(accountRef, { balance: increment(params.isPayer ? -params.amount : params.amount) });

    return movementRef.id;
  }

  private async findBaseCategoryId(name: string): Promise<string> {
    const categories = await firstValueFrom(this.categories.categories$);
    const match = categories.find((category) => category.uid === null && category.name === name);
    if (!match) {
      throw new Error(`No encontramos la categoría base "${name}". Corre scripts/seed-categories.mjs de nuevo.`);
    }
    return match.id;
  }

  private requireUid(): string {
    const uid = this.auth.currentUser?.uid;
    if (!uid) {
      throw new Error('No hay un usuario autenticado.');
    }
    return uid;
  }
}
