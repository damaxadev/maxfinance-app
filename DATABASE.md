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

### `groups`
| campo | tipo | notas |
|---|---|---|
| name | string | |
| members | array<uid> | quiénes pertenecen |
| createdBy | uid | |
| createdAt | timestamp | |

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
| groupId | string \| null | null = movimiento personal |
| paidBy | uid | solo si groupId existe |
| splitType | string | equal / percentage / fixed — solo si groupId existe |
| splits | array<{uid, amount, settled}> | solo si groupId existe |

### `settlements`
Registra cuando alguien salda su deuda dentro de un grupo.
| campo | tipo | notas |
|---|---|---|
| groupId | string | |
| fromUid | uid | quien paga |
| toUid | uid | quien recibe |
| amount | number | |
| date | timestamp | |
| note | string | |

### `budgets`
| campo | tipo | notas |
|---|---|---|
| uid | uid | |
| categoryId | string | |
| month | string | formato YYYY-MM |
| limit | number | |

### `recurringPayments`
| campo | tipo | notas |
|---|---|---|
| uid | uid \| null | null si es de un grupo |
| groupId | string \| null | |
| name | string | |
| amount | number | |
| categoryId | string | |
| accountId | string | |
| frequency | string | monthly / weekly / etc |
| nextDate | timestamp | |
| active | boolean | |

## Balance de grupo (calculado, no almacenado)

El "quién le debe a quién" **no se guarda como campo**. Se calcula al leer:
`movements` compartidos del grupo (agrupados por `splits`) **menos** `settlements` del mismo grupo, y ahí mismo se simplifica la deuda (neteo: si A le debe a B y B le debe a C, se reduce a una sola transferencia neta cuando aplica).

## Reglas de seguridad (resumen)

- `users`, `accounts`, `categories`, `budgets`, `recurringPayments` (personales): solo el dueño (`request.auth.uid == resource.data.uid`) lee/escribe
- `groups`: solo lee/escribe quien esté en `members`
- `movements`: si `groupId == null`, solo el dueño; si tiene `groupId`, cualquier miembro del grupo puede leer, pero solo puede escribir quien creó el registro o es admin del grupo
- `settlements`: solo miembros del `groupId` correspondiente

## Asunciones tomadas

- Moneda única: COP (multi-moneda no está en el alcance del MVP)
- Invitación a grupo por email, resuelta a `uid` vía Cloud Function callable (no se expone la lista de usuarios al cliente)
