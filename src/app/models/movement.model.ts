import type { Timestamp } from 'firebase/firestore';

import type { Uid } from './shared.model';

export type MovementType = 'income' | 'expense';
export type SplitType = 'equal' | 'percentage' | 'fixed';

export interface MovementSplit {
  uid: Uid;
  amount: number;
  settled: boolean;
}

export type InstallmentStatus = 'pending' | 'paid';

export interface Installment {
  dueDate: Timestamp;
  amount: number;
  status: InstallmentStatus;
}

export interface BaseMovement {
  uid: Uid;
  // null == sin categoría (ver DATABASE.md, "Categoría opcional en gastos
  // compartidos") — el formulario de movimiento personal sigue exigiéndola,
  // así que en la práctica solo un SharedMovement llega a tener null acá.
  categoryId: string | null;
  type: MovementType;
  amount: number;
  date: Timestamp;
  note: string;
  // Un solo adjunto por movimiento (foto de recibo o PDF) — ver
  // AttachmentsService. Path fijo "movements/{id}/attachment" (sin
  // extensión: el tipo real vive en attachmentContentType, no en el
  // nombre del archivo), así que subir uno nuevo siempre REEMPLAZA al
  // anterior, nunca acumula. Ambos campos van de la mano: o los dos están
  // presentes, o ninguno.
  attachmentPath?: string | null;
  attachmentContentType?: string | null;
}

export interface PersonalMovement extends BaseMovement {
  // string == etiquetado a un grupo type: 'personal' (Fase 9, ver
  // DATABASE.md "Gasto en grupo personal") — se crea y se lee igual que un
  // movimiento sin grupo, groupId solo sirve para agruparlo visualmente,
  // nunca lleva paidBy/splitType/splits.
  groupId: string | null;
  accountId: string;
  // Presente solo si este movimiento se generó al convertir un settlement
  // en movimiento personal (ver DATABASE.md, sección de settlements).
  settlementId?: string | null;
}

export interface SharedMovement extends BaseMovement {
  groupId: string;
  paidBy: Uid;
  splitType: SplitType;
  splits: MovementSplit[];
  // accountId es opcional acá porque solo tenemos acceso a la cuenta de
  // quien REGISTRA el movimiento — si paidBy es otro miembro del grupo,
  // no hay ninguna cuenta suya que se pueda leer/tocar (son siempre
  // privadas, ver reglas de Firestore), así que queda sin definir. También
  // queda en null cuando quien paga sí es quien registra pero elige no
  // asociar ninguna cuenta (gasto que solo queda como deuda compartida).
  accountId?: string | null;
  // Copia de category.name/icon al momento de crear el gasto — necesaria
  // porque `categories` solo es legible para su dueño + categorías base, así
  // que un miembro no puede resolver en vivo la categoría personalizada de
  // otro (ver DATABASE.md, "Categoría denormalizada en gastos compartidos").
  // null junto con categoryId null == "sin categoría". Ausentes (undefined)
  // en gastos creados antes de este cambio — ahí se sigue resolviendo contra
  // `categories` en vivo como fallback.
  categoryName?: string | null;
  categoryIcon?: string | null;
  // Plan de cuotas (ver DATABASE.md, "Pagos a cuotas") — solo posible en
  // grupos de 2 miembros, sobre el monto que debe quien NO pagó (no el
  // monto total del gasto). Ausente o null == sin cuotas. No se edita una
  // vez creado (ver SharedExpenseForm.readOnly()); pagar una cuota marca
  // su status acá Y crea un settlement (ver MovementsService.payInstallment).
  installments?: Installment[] | null;
  // Denormalizado a propósito: permite que la Cloud Function del
  // recordatorio a 3 días filtre con un solo campo en vez de traer TODOS
  // los movements a revisar sus cuotas en memoria (ver functions/src/index.ts).
  // Se recalcula cada vez que se paga una cuota.
  hasPendingInstallments?: boolean;
}

export type Movement = PersonalMovement | SharedMovement;
