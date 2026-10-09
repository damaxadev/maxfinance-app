// Lógica pura (sin imports de firebase-admin/firebase-functions, mismo
// motivo que debts.ts — ver su comentario de cabecera) para decidir A
// QUIÉN y QUÉ notificar cuando se crea o se anula un abono (ver index.ts,
// notifySettlementCreated/notifySettlementVoided). Separada en funciones
// puras para poder probarla desde el runner de Angular, importándola por
// ruta relativa igual que debts.ts (ver
// src/app/core/debts/settlement-notifications-functions.spec.ts).
//
// Regla de producto (ver DATABASE.md, "Balance de grupo y abonos"): la
// notificación es siempre para "la otra parte" — nunca para quien hizo la
// acción (createdBy al crear, voidedBy al anular), y nunca para un tercero
// del grupo (un abono es cosa de dos, no un evento de grupo).

export interface SettlementParties {
  fromUid: string;
  toUid: string;
}

// La otra parte del abono, relativa a quien hizo la acción — nunca asume
// que quien actúa es fromUid, puede ser cualquiera de los dos. null si
// actorUid no es ninguna de las dos partes (dato inconsistente): no hay a
// quién notificar.
export function otherPartyUid(parties: SettlementParties, actorUid: string): string | null {
  if (actorUid === parties.fromUid) {
    return parties.toUid;
  }
  if (actorUid === parties.toUid) {
    return parties.fromUid;
  }
  return null;
}

export interface SettlementNotification {
  recipientUid: string;
  title: string;
  body: string;
}

function formatCOP(amount: number): string {
  return `$${Math.round(amount).toLocaleString('es-CO')}`;
}

export interface SettlementCreatedParams extends SettlementParties {
  createdBy: string;
  amount: number;
  payerName: string;
  receiverName: string;
}

// Quien pagó (fromUid) registrándolo -> el receptor se entera de que le
// pagaron. Quien recibió (toUid) registrándolo en nombre del otro -> el
// pagador se entera de que quedó anotado. El texto cambia según cuál de
// los dos casos es, nunca un genérico "se registró un abono".
export function buildSettlementCreatedNotification(params: SettlementCreatedParams): SettlementNotification | null {
  const recipientUid = otherPartyUid(params, params.createdBy);
  if (!recipientUid) {
    return null;
  }
  const amountLabel = formatCOP(params.amount);
  const body =
    recipientUid === params.toUid
      ? `${params.payerName} te abonó ${amountLabel}`
      : `${params.receiverName} registró que le abonaste ${amountLabel}`;
  return { recipientUid, title: 'Nuevo abono', body };
}

export interface SettlementVoidedParams extends SettlementParties {
  voidedBy: string;
  amount: number;
  voidReason: string;
  voiderName: string;
}

export function buildSettlementVoidedNotification(params: SettlementVoidedParams): SettlementNotification | null {
  const recipientUid = otherPartyUid(params, params.voidedBy);
  if (!recipientUid) {
    return null;
  }
  const amountLabel = formatCOP(params.amount);
  return {
    recipientUid,
    title: 'Abono anulado',
    body: `${params.voiderName} anuló un abono de ${amountLabel} — Motivo: ${params.voidReason}`,
  };
}
