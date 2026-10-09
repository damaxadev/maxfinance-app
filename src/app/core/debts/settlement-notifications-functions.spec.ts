// Tests directos de functions/src/settlement-notifications.ts — lógica
// pura de "a quién y qué notificar" al crear/anular un abono (ver
// index.ts, notifySettlementCreated/notifySettlementVoided). Ruta relativa
// a propósito, cruzando a otro proyecto de TypeScript — ver el comentario
// de cabecera de functions/src/debts.ts (mismo patrón ya usado por
// debts-functions.spec.ts/debts-functions-parity.spec.ts).
import {
  buildSettlementCreatedNotification,
  buildSettlementVoidedNotification,
  otherPartyUid,
} from '../../../../functions/src/settlement-notifications';

describe('otherPartyUid', () => {
  it('returns toUid when the actor is fromUid', () => {
    expect(otherPartyUid({ fromUid: 'diego', toUid: 'tatiana' }, 'diego')).toBe('tatiana');
  });

  it('returns fromUid when the actor is toUid', () => {
    expect(otherPartyUid({ fromUid: 'diego', toUid: 'tatiana' }, 'tatiana')).toBe('diego');
  });

  it('returns null when the actor is neither party (inconsistent data)', () => {
    expect(otherPartyUid({ fromUid: 'diego', toUid: 'tatiana' }, 'laura')).toBeNull();
  });
});

describe('buildSettlementCreatedNotification', () => {
  const base = {
    fromUid: 'diego',
    toUid: 'tatiana',
    amount: 50000,
    payerName: 'Diego',
    receiverName: 'Tatiana',
  };

  it('notifies the receiver ("te abonó") when the PAYER registered it', () => {
    const notification = buildSettlementCreatedNotification({ ...base, createdBy: 'diego' });

    expect(notification).toEqual({
      recipientUid: 'tatiana',
      title: 'Nuevo abono',
      body: 'Diego te abonó $50.000',
    });
  });

  it('notifies the payer ("registró que le abonaste") when the RECEIVER registered it', () => {
    const notification = buildSettlementCreatedNotification({ ...base, createdBy: 'tatiana' });

    expect(notification).toEqual({
      recipientUid: 'diego',
      title: 'Nuevo abono',
      body: 'Tatiana registró que le abonaste $50.000',
    });
  });

  it('never targets createdBy itself, regardless of which side created it', () => {
    const asPayer = buildSettlementCreatedNotification({ ...base, createdBy: 'diego' });
    const asReceiver = buildSettlementCreatedNotification({ ...base, createdBy: 'tatiana' });

    expect(asPayer?.recipientUid).not.toBe('diego');
    expect(asReceiver?.recipientUid).not.toBe('tatiana');
  });

  it('returns null when createdBy is neither party (inconsistent data) — no one gets notified', () => {
    expect(buildSettlementCreatedNotification({ ...base, createdBy: 'laura' })).toBeNull();
  });
});

describe('buildSettlementVoidedNotification', () => {
  const base = {
    fromUid: 'diego',
    toUid: 'tatiana',
    amount: 20000,
    voidReason: 'monto duplicado',
    voiderName: 'Tatiana',
  };

  it('notifies the other party, never voidedBy itself', () => {
    const notification = buildSettlementVoidedNotification({ ...base, voidedBy: 'tatiana' });

    expect(notification).toEqual({
      recipientUid: 'diego',
      title: 'Abono anulado',
      body: 'Tatiana anuló un abono de $20.000 — Motivo: monto duplicado',
    });
  });

  it('works the same way when the payer is the one who voided it', () => {
    const notification = buildSettlementVoidedNotification({ ...base, voidedBy: 'diego', voiderName: 'Diego' });

    expect(notification).toEqual({
      recipientUid: 'tatiana',
      title: 'Abono anulado',
      body: 'Diego anuló un abono de $20.000 — Motivo: monto duplicado',
    });
  });

  it('returns null when voidedBy is neither party', () => {
    expect(buildSettlementVoidedNotification({ ...base, voidedBy: 'laura' })).toBeNull();
  });
});
