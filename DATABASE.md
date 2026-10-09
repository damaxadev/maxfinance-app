# DATABASE.md — Modelo de datos (Firestore)

## Colecciones

### `users`
| campo | tipo | notas |
|---|---|---|
| uid | string | = doc id |
| displayName | string | de Google |
| email | string | |
| photoURL | string | |
| createdAt | timestamp | |
| fcmTokens | array<string> | opcional — tokens de Cloud Messaging de cada dispositivo/navegador donde el usuario inició sesión (no un solo valor, para no perder notificaciones al usar más de un dispositivo), para pagos recurrentes (Fase 6) |
| phone | string \| null | opcional, editable desde Perfil (Fase 9) |

### `groups`
| campo | tipo | notas |
|---|---|---|
| name | string | |
| members | array<uid> | quiénes pertenecen — para type: 'personal', siempre un solo uid, para siempre |
| createdBy | uid | |
| createdAt | timestamp | |
| type | string | 'personal' \| 'shared' — elegido al crear, nunca cambia después (Fase 9). Un grupo 'personal' nunca invita miembros nuevos; si más adelante se quiere compartir, se crea un grupo 'shared' aparte |

### `accounts`
| campo | tipo | notas |
|---|---|---|
| uid | uid | dueño, siempre personal |
| name | string | |
| type | string | efectivo / banco / tarjeta |
| balance | number | |
| currency | string | COP por ahora |

### `categories`
| campo | tipo | notas |
|---|---|---|
| uid | uid \| null | null = categoría base/global (seed) |
| name | string | |
| icon | string | |
| type | string | income / expense |

**Categorías base (seed)**: Comida, Transporte, Servicios, Entretenimiento, Salud, Hogar, Educación, Ropa (todas expense); Salario, Otros ingresos (income); Pago de deuda (expense, agregada en Fase 5 para el caso de settlements convertidos en movimiento).

### `movements`
| campo | tipo | notas |
|---|---|---|
| uid | uid | dueño del registro |
| accountId | string | |
| categoryId | string | |
| type | string | income / expense |
| amount | number | |
| date | timestamp | |
| note | string | |
| groupId | string \| null | null = movimiento personal sin grupo |
| paidBy | uid | solo si groupId existe Y el grupo es type: 'shared' |
| splitType | string | equal / percentage / fixed — solo si groupId existe Y el grupo es type: 'shared' |
| splits | array<{uid, amount, settled}> | solo si groupId existe Y el grupo es type: 'shared' |
| settlementId | string \| null | opcional — si este movimiento se generó al convertir un settlement en movimiento personal |

**Gasto en grupo personal (Fase 9)**: cuando `groupId` apunta a un grupo `type: 'personal'`, el movimiento se crea igual que uno sin grupo (mismo formulario simple: cuenta, categoría, monto, fecha, nota) — no lleva `paidBy`/`splitType`/`splits`. El `groupId` solo sirve para agruparlo visualmente (ej. "Apartamento"), no para calcular deudas.

### `settlements` (abonos)
Un pago entre dos miembros de un grupo que reduce una o varias deudas puntuales. **Nunca modifica el gasto que cubre** — un abono es un registro aparte; qué tan pagado está un gasto se CALCULA leyendo sus abonos, no se guarda en el gasto (ver "Balance de grupo y abonos" más abajo).
| campo | tipo | notas |
|---|---|---|
| groupId | string | |
| fromUid | uid | quien paga |
| toUid | uid | quien recibe |
| amount | number | siempre igual a la suma de `allocations[].amount` |
| date | timestamp | |
| note | string | |
| linkedMovementId | string \| null | opcional — si se convirtió en movimiento personal, referencia a ese movimiento |
| allocations | array<{movementId, debtorUid, installmentIndex, amount}> | a qué deuda(s) puntuales aplica — ver abajo. Ausente == abono "legacy" (de antes de este campo) |
| allocationMode | 'manual' \| 'auto' | 'manual': se eligió a mano qué deuda(s) cubre. 'auto': se repartió solo a las deudas más antiguas de la pareja. Ausente == legacy |
| createdBy | uid | quien registró el abono (fromUid o toUid, cualquiera de los dos puede hacerlo) |
| createdAt | timestamp | |
| status | 'active' \| 'voided' | ausente == 'active'. Un abono nunca se edita ni se borra, se anula |
| voidedBy, voidedAt, voidReason | uid \| null, timestamp \| null, string \| null | solo si `status == 'voided'` — motivo obligatorio (mínimo 3 caracteres) |
| attachmentPath, attachmentContentType | string \| null, string \| null | un solo comprobante por abono (foto o PDF), misma convención que `movements`/`goalEntries` — path fijo `settlements/{id}/attachment`. Ambos van de la mano: o los dos están presentes, o ninguno. Solo fromUid/toUid pueden subir/reemplazar/eliminarlo, y solo mientras el abono esté activo — anulado, queda de solo lectura |

**Identidad de una deuda**: `movementId` + `debtorUid` + `installmentIndex` (`null` si el gasto no es a cuotas). Un gasto sin cuotas genera una deuda por cada split distinto de quien pagó; un gasto a cuotas (ver "Pagos a cuotas" abajo) genera una deuda POR CUOTA de su única deudora/deudor — nunca una deuda por el total. `allocations[].amount` siempre es cuánto de ESE abono va a ESA deuda puntual; la suma de todas sus allocations es `amount`.

**Abonos "legacy"**: los settlements creados antes de que existiera `allocations` no saben a qué gasto aplican. En vez de migrarlos, se auto-asignan a las deudas más antiguas de su misma dirección (fromUid → toUid) **al momento de leer** (ver `core/debts/debts.ts`, `computeDebts()`) — nunca se reescriben en Firestore. Si hay varios abonos legacy para la misma pareja, se procesan del más viejo al más nuevo, para que un pago anterior siempre consuma primero lo más antiguo.

**Convertir un abono en movimiento (opcional)**: al crear un abono, quien lo registra (fromUid o toUid, según quién esté logueado) puede marcar un checkbox para además generar un `movement` personal — tipo `expense` si es quien pagó (fromUid), tipo `income` si es quien recibió (toUid). Este movimiento nace con `groupId: null` (no participa en el cálculo de balance del grupo) y `categoryId` apunta a la categoría base fija "Pago de deuda" (expense) o "Otros ingresos" (income, ya existente). Es opcional porque no siempre se paga en efectivo/transferencia rastreable. **Cada lado (fromUid, toUid) puede convertir su propio abono en movimiento de forma independiente y en momentos distintos** — no solo quien lo creó originalmente. No se guarda un mapa de "quién ya lo convirtió"; se deriva consultando `movements` filtrando por `settlementId == X` y `uid == usuario actual`.

**Pagos a cuotas**: un gasto compartido puede dividirse en un plan de `installments: array<{dueDate, amount, status}>` sobre el monto que debe quien NO pagó — solo existe en grupos de 2 miembros. `installments[i].status` ('pending' \| 'paid') sigue existiendo para la UI del plan y para el recordatorio de Cloud Function (`hasPendingInstallments`, denormalizado en el movimiento), pero **ya no es la fuente de verdad del balance** — eso ahora sale enteramente de los abonos con `allocations`, igual que cualquier otra deuda. "Marcar como pagada" una cuota puntual sigue corriendo vía Cloud Function (`payInstallment`, necesita escribir `installments[]` de un movimiento que el deudor no necesariamente posee) y, en la misma transacción, además crea el abono con una sola allocation por el monto exacto de esa cuota.

**Vista de Movimientos combinada**: la pantalla de Movimientos muestra tanto los movimientos personales (`groupId == null`) como los gastos compartidos que el usuario pagó (`uid == usuario`, `groupId == alguno de sus grupos`), cada uno con una etiqueta visible del grupo de origen. Importante: esto NO se resuelve con un query `where('groupId', '!=', null)` — Firestore no permite combinar una desigualdad con `orderBy` en un campo distinto sin restructurar el índice, y además repetiría la ambigüedad de regla que causó el bug de permisos de la Fase 3. La solución correcta es un query por grupo (`where('uid','==',uid), where('groupId','==', groupId)`, uno por cada grupo del usuario), combinado y ordenado en el cliente junto con el query personal existente.

**Marcador "Abono anulado" en Movimientos**: un movimiento personal con `settlementId` (ver arriba, "Convertir un abono en movimiento") puede quedar apuntando a un abono que se anuló DESPUÉS de crearlo — nunca se borra solo, pero se marca "Abono anulado" para no leerse como un gasto/ingreso legítimo. Como ese `settlementId` puede ser de CUALQUIER grupo del usuario (el movimiento vinculado es personal, `groupId: null`), la consulta de estado (`SettlementsService.settlementsStatusByIds$`) no puede filtrar por `groupId` como las demás — usa `where(documentId(), 'in', ids)` sobre la colección `settlements` completa, apoyándose en que la regla (`isGroupMember(resource.data.groupId)`) se evalúa por documento devuelto. Si esa lectura llegara a fallar, queda envuelta en su propio `catchError`: el marcador simplemente no aparece, nunca rompe la vista.

**Historial de actividad del grupo**: dentro del detalle de un grupo, se muestran los últimos ~10 movimientos compartidos y settlements de ESE grupo (`where('groupId','==', groupId)`, visible para cualquier miembro, sin filtrar por uid — la regla de Firestore ya lo permite), ordenados por `createdAt` (cuándo se registró de verdad, no `date`, que sigue siendo lo que se MUESTRA en cada fila). Cada fila de abono es compacta (de/a, monto, tags de legacy/anulado/registrado-por, indicador 📎 si tiene comprobante); tocarla abre su detalle completo (`AbonoDetail`), nunca se expande inline.

**Detalle del abono (`AbonoDetail`)**: breakdown completo (a qué gasto/cuota aplica cada allocation, con el estado ACTUAL de esa deuda, nunca un snapshot), estado (activo o anulado con quién/cuándo/motivo), nota editable (solo mientras esté activo), comprobante (ver arriba — oculto por completo para quien no es parte, que solo ve el texto "📎 Tiene comprobante"), y las acciones de la pareja: anular (con motivo obligatorio, ver abajo) y "Registrar como gasto/ingreso". Lo abren tanto `GroupActivity` (tocar una fila) como el aviso de bloqueo de `SharedExpenseForm` (enlace a cada abono que aplicó).

**Anular un abono**: terminal — un abono anulado nunca se "des-anula"; para corregirlo se registra uno nuevo. Solo `fromUid`/`toUid` (ni el admin ni un tercero del grupo), con un motivo de al menos 3 caracteres. `computeDebts()` ignora los abonos anulados (vuelven a contar como no pagado). Una vez anulado, el abono completo queda de solo lectura: ni nota ni adjunto se pueden seguir editando, y "Registrar como gasto/ingreso" deja de ofrecerse (ver `SettlementsService.linkPersonalMovement`).

**Bloqueo de edición/borrado de un gasto compartido**: un gasto está bloqueado (monto, división, quién pagó, cuotas y borrar — nunca categoría/nota/adjunto) si alguna de sus deudas tiene `paid > 0` según `computeDebts()` (`core/debts/debts.ts`, `movementHasPayments()`), considerando abonos activos **incluidos los legacy auto-asignados**. Esto reemplaza a un heurístico anterior por fecha (`isSharedMovementLocked`, eliminado) y a `installments[].status` como fuente — ninguno de los dos detectaba con certeza todos los casos. El formulario (`SharedExpenseForm`) muestra cuántos abonos aplicaron y, para los que tienen `allocations` explícitas, un enlace a cada uno (abre su `AbonoDetail`); un abono legacy auto-asignado no deja ese enlace, solo un aviso genérico.

**Push al crear/anular un abono**: dos Cloud Functions (`notifySettlementCreated` en `onDocumentCreated`, `notifySettlementVoided` en `onDocumentUpdated`, solo en la transición activo → anulado) notifican siempre a **la otra parte** — nunca a `createdBy`/`voidedBy`, nunca a un tercero del grupo (un abono es cosa de dos, no un evento de grupo). La lógica de "a quién y qué texto" vive en `functions/src/settlement-notifications.ts`, pura y sin dependencias de runtime (mismo patrón que `functions/src/debts.ts`) para poder probarla desde el runner de Angular.

**"Registrar como gasto/ingreso" y doble conteo**: convertir un abono en movimiento personal (ver arriba) relee fresco, justo antes de escribir, tanto si el abono sigue activo como si el usuario actual ya lo había registrado antes — mitiga (no elimina del todo, el SDK cliente no permite queries dentro de una transacción) la ventana en que dos taps casi simultáneos (o dos dispositivos) duplicarían el movimiento. Un abono anulado ya no se puede registrar como movimiento, ni siquiera por quien todavía no lo había hecho.

### `budgets`
| campo | tipo | notas |
|---|---|---|
| uid | uid | |
| categoryId | string | |
| month | string | formato YYYY-MM |
| limit | number | |

### `monthlyInsights`
Insight generado automáticamente una vez al mes por Cloud Function (nunca escrito desde el cliente). Doc id determinístico: `{uid}_{month}`.
| campo | tipo | notas |
|---|---|---|
| uid | uid | |
| month | string | formato YYYY-MM, el mes que resume (el que ya cerró) |
| text | string | resultado generado por Claude |
| generatedAt | timestamp | |
| notifiedAt | timestamp \| null | cuándo se envió el push avisando que está listo (evita reenviar si la función corre dos veces) |

Reglas: solo lectura para el dueño (`isOwner(resource.data.uid)`), escritura solo vía Admin SDK — igual que las categorías base, el cliente nunca escribe aquí directo.

### `recurringPayments`
| campo | tipo | notas |
|---|---|---|
| uid | uid \| null | null si es de un grupo |
| groupId | string \| null | |
| name | string | |
| amount | number | |
| categoryId | string | |
| accountId | string | |
| frequency | string | 'daily' \| 'weekly' \| 'biweekly' \| 'monthly' \| 'bimonthly' \| 'quarterly' \| 'semiannual' \| 'annual' (Fase 9 — antes solo monthly/weekly) |
| nextDate | timestamp | |
| active | boolean | |

## Balance de grupo y abonos (calculado, no almacenado)

El "quién le debe a quién" **no se guarda como campo**. Se calcula en dos pasos, ambos funciones puras en `core/debts/debts.ts` y `core/group-balance/group-balance.ts`:

1. **`computeDebts(movements, settlements)`** deriva la lista de deudas del grupo (una por gasto × deudor, o una por gasto × deudor × cuota — ver "Identidad de una deuda" arriba) y les aplica los abonos activos (`status != 'voided'`): los de `allocations` explícitas reducen exactamente la deuda que apuntan; los legacy (sin `allocations`) se auto-asignan a las más antiguas de su misma dirección. El resultado de cada deuda es `{ total, paid, remaining, status, anomaly }` — `remaining` nunca es negativo (se clampea; un sobrepago por datos inconsistentes solo se marca con `anomaly: true`, no rompe la pantalla).
2. **`calculateGroupBalance(movements, settlements)`** suma el `remaining` de todas las deudas agrupándolas **por DIRECCIÓN** (debtorUid → creditorUid) — una línea por dirección, nunca una por pareja. **Decisión de producto: las deudas NUNCA se cruzan, ni siquiera dentro de la misma pareja.** Si A le debe 30 a B y B le debe 30 a A, salen DOS líneas de 30 — nunca se simplifican a una sola ni a cero. No existe ninguna acción de "Compensar" (cruzar/netear dos direcciones a mano): cada dirección se salda de forma independiente, abonando esa dirección específica.

**Dos formas de pagar, mismo mecanismo (`SettlementsService.createSettlement`)**:
- **"Marcar como saldada"** (una línea/dirección completa, `GroupBalance`): un solo abono por el monto que se ve en esa línea, `allocationMode: 'auto'` — se reparte solo (`autoAllocateOldestFirst`) a las deudas más antiguas de esa DIRECCIÓN hasta agotar el monto. Deja esa dirección en 0 — la dirección contraria (si existe) ni se mira, nunca se cruzan.
- **"Marcar como pagada"** (una cuota puntual, `GroupActivity`): un solo abono con una allocation `manual` por exactamente el `remaining` fresco de esa cuota (nunca un monto recalculado por el cliente) — vía Cloud Function `payInstallment`, que además marca `installments[i].status = 'paid'`.

En ambos casos **el gasto original nunca se toca** — el abono es una fila nueva en el historial, no una mutación del gasto.

**Concurrencia**: el SDK cliente de Firestore no permite queries dentro de una transacción, así que `createSettlement()` no puede releer y escribir de forma atómica. Mitigación: relee `movements`+`settlements` del grupo FRESCOS justo antes de validar/escribir, reduciendo la ventana de carrera a lo que tarda esa relectura más el `commit()`. Riesgo residual: dos abonos a la misma deuda, casi simultáneos, dentro de esa ventana, podrían sobrepasarla — el clamp de `computeDebts()` evita que explote la pantalla, pero el sobrepago puntual puede quedar. Una garantía dura requeriría mover esto a una Cloud Function (como `payInstallment`), donde el SDK Admin sí soporta queries dentro de una transacción.

## Reglas de seguridad (resumen)

- `users`, `accounts`, `categories`, `budgets`, `recurringPayments` (personales): solo el dueño (`request.auth.uid == resource.data.uid`) lee/escribe
- `groups`: solo lee/escribe quien esté en `members`
- `movements`: si `groupId == null`, solo el dueño; si tiene `groupId`, cualquier miembro del grupo puede leer, pero solo puede escribir quien creó el registro o es admin del grupo
- `settlements` (abonos): solo miembros del `groupId` correspondiente leen; crear exige además ser fromUid o toUid, y que `createdBy` (si está presente) sea quien llama. Un abono es un ledger: `amount`/`allocations`/`fromUid`/`toUid`/`groupId`/`date`/`createdBy`/`createdAt` son inmutables para siempre. Un update solo puede ser UNA de estas dos cosas, nunca una mezcla, y solo mientras el abono está activo (uno ya anulado es inmutable por completo): **(a)** anular (`status: 'active'|ausente → 'voided'`, con `voidedBy == quien llama` y un `voidReason` de al menos 3 caracteres), o **(b)** nota y/o comprobante (`note`/`attachmentPath`/`attachmentContentType`). En los dos casos, solo `fromUid` o `toUid` — **ni el admin ni un tercero del grupo** (a diferencia de otras colecciones, esto no es un superpoder de administración). Borrar sigue siendo solo para admin — un abono se anula, nunca se borra.
- Storage, `settlements/{id}/attachment`: leer/subir/reemplazar/eliminar limitado a `fromUid`/`toUid` (NO a cualquier miembro del grupo, a diferencia de `movements`/`goalEntries` — un comprobante de pago trae datos personales) y solo mientras el abono esté activo; valida tipo (imagen o PDF) y tamaño (igual que el tope del cliente, `MAX_ATTACHMENT_BYTES`)

## Asunciones tomadas

- Moneda única: COP (multi-moneda no está en el alcance del MVP)
- Invitación a grupo por email, resuelta a `uid` vía Cloud Function callable (no se expone la lista de usuarios al cliente)
- Sugerencias de contactos al invitar: solo gente con la que ya se comparte un grupo (Cloud Function `getKnownContacts`), nunca el directorio completo de usuarios de la app — decisión explícita de privacidad, no un directorio público
