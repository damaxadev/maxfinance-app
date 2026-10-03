import { Injectable, inject } from '@angular/core';
import { Observable, catchError, of, switchMap } from 'rxjs';
import {
  Firestore,
  Timestamp,
  addDoc,
  collection,
  deleteDoc,
  doc,
  collectionData,
  query,
  updateDoc,
  where,
} from '@angular/fire/firestore';

import { Auth } from '../auth/auth';
import { AttachmentsService } from '../attachments/attachments';
import type { PreparedAttachment } from '../attachments/attachment-compression';
import type { GoalEntry, GoalEntryType } from '../../models/goal-entry.model';

export type GoalEntryWithId = GoalEntry & { id: string };

export interface GoalEntryFormValue {
  groupId: string;
  type: GoalEntryType;
  amount: number;
  date: Date;
  note: string;
}

// Ledger de una meta de ahorro — colección aparte de movements/settlements
// a propósito (ver DATABASE.md, "Metas de ahorro"): ningún aporte/retiro
// toca una cuenta personal ni genera un movement, y no participa del
// cálculo de balance de deuda entre personas.
@Injectable({
  providedIn: 'root',
})
export class GoalEntriesService {
  private readonly firestore = inject(Firestore);
  private readonly auth = inject(Auth);
  private readonly attachmentsService = inject(AttachmentsService);

  // groupId es un filtro de igualdad (constante conocida), mismo criterio
  // que settlements$ — provable estáticamente por la regla de Firestore.
  entries$(groupId: string): Observable<GoalEntryWithId[]> {
    return this.auth.currentUser$.pipe(
      switchMap((user) => {
        if (!user) {
          return of([]);
        }
        const entriesQuery = query(collection(this.firestore, 'goalEntries'), where('groupId', '==', groupId));
        return collectionData(entriesQuery, { idField: 'id' }) as Observable<GoalEntryWithId[]>;
      }),
      catchError((error) => {
        console.error('Error al cargar el historial de la meta', error);
        return of([]);
      })
    );
  }

  async create(value: GoalEntryFormValue): Promise<string> {
    const uid = this.requireUid();
    const entry: GoalEntry = {
      groupId: value.groupId,
      uid,
      type: value.type,
      amount: value.amount,
      date: Timestamp.fromDate(value.date),
      note: value.note,
    };
    const ref = await addDoc(collection(this.firestore, 'goalEntries'), entry);
    return ref.id;
  }

  // Sube/reemplaza el único adjunto de una entrada (ver DATABASE.md /
  // "Adjuntos") — se llama DESPUÉS de que create() ya resolvió, mismo
  // motivo que MovementsService.attachFile(): la regla de Storage lee la
  // entrada vía firestore.get(), así que el documento debe existir antes.
  async attachFile(entryId: string, attachment: PreparedAttachment): Promise<void> {
    const path = `goalEntries/${entryId}/attachment`;
    await this.attachmentsService.upload(path, attachment.blob, attachment.contentType);
    await updateDoc(doc(this.firestore, 'goalEntries', entryId), {
      attachmentPath: path,
      attachmentContentType: attachment.contentType,
    });
  }

  async remove(id: string, entry: GoalEntry): Promise<void> {
    await deleteDoc(doc(this.firestore, 'goalEntries', id));
    if (entry.attachmentPath) {
      await this.attachmentsService.remove(entry.attachmentPath);
    }
  }

  private requireUid(): string {
    const uid = this.auth.currentUser?.uid;
    if (!uid) {
      throw new Error('No hay un usuario autenticado.');
    }
    return uid;
  }
}
