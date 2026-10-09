# BACKLOG.md — Fases y tareas

Cada fase debe dejar la app en un estado usable antes de pasar a la siguiente.

## Fase 0 — Setup
1. Crear repo GitHub `damaxadev/maxfinance-app`, `git init`, `.gitignore`
2. `ng new` standalone + `@capacitor/core` (PWA + Android desde el inicio)
3. Configurar Git Flow: ramas `main` y `develop`
4. Crear proyecto Firebase `maxfinance-app`: Firestore, Auth (provider Google), Cloud Messaging, Functions (plan Blaze)
5. Configurar Cloudflare Worker `maxfinance-worker`, secret `ANTHROPIC_API_KEY`
6. Crear `environment.ts`, `environment.prod.ts`, `.env` del Worker, `environment.example.ts`, todos en `.gitignore`
7. Definir reglas de seguridad iniciales de Firestore (uid-based)
8. Generar README.md, CLAUDE.md, DATABASE.md, BACKLOG.md, RISKS.md + primer commit

## Fase 1 — Auth + perfil
9. Integrar Google Sign-In multi-usuario (`@capacitor-firebase/authentication`)
10. Pantalla de login
11. Crear doc en `users` al primer login
12. Pantalla de perfil (foto, displayName editable)
13. Guard de rutas autenticadas

> ⚠️ **TODO antes de cerrar esta fase**: iniciar sesión una vez con Google, copiar el UID real desde Firebase Console → Authentication → Users, y reemplazar el placeholder `'REEMPLAZAR_DESPUES_DE_FASE_1'` en la función `isAdmin()` de `firestore.rules`. Redesplegar las reglas después del cambio.

## Fase 2 — Sistema de diseño e interfaz
Ver `DESIGN.md` para el detalle completo de paleta, tipografía y filosofía de animación.
14. Design tokens: paleta de colores, tipografía Rubik (`@fontsource/rubik`), spacing — variables CSS globales
15. Configurar Angular Animations (transiciones de página, stagger de listas)
16. Componente base `mfx-card` con animación de entrada (fade + slide) y microinteracción al tocar (scale)
17. Instalar Swiper — navegación deslizable horizontal entre las secciones principales
18. Bottom tab bar (Inicio, Movimientos, Grupos, Presupuesto, Ajustes) sincronizado con el swipe de Swiper
19. Contador animado para montos (cuenta ascendente al cargar balance/totales)
20. Anillo de progreso animado para presupuesto (% usado por categoría)
21. Integrar `canvas-confetti` para celebración al saldar una deuda (el disparo real se conecta en Fase 5; el componente se define acá)
22. Integrar `@capacitor/haptics` — feedback táctil en acciones clave (guardar, saldar deuda, error)
23. Floating Action Button (FAB) con menú tipo speed-dial (inspirado en el botón "+" de Google Drive) — animación de apertura/cierre, ícono que rota; las opciones son placeholder por ahora, se conectan a acciones reales en Fases 3 y 5
24. Re-aplicar el sistema de diseño (tokens, tipografía, `mfx-card`) a Login y Perfil — se construyeron en Fase 1, antes de que existiera `DESIGN.md`

## Fase 3 — Movimientos personales
25. CRUD de `accounts`
26. `categories` base (seed) + custom por usuario
27. CRUD de `movements` personales (ingreso/gasto)
28. Lista de movimientos con filtro por cuenta/categoría/fecha
29. Balance rápido por cuenta (usa el contador animado de Fase 2)
30. Reglas de seguridad Firestore para accounts/categories/movements
31. Conectar la opción "Agregar movimiento" del FAB al formulario real

## Fase 4 — Grupos
32. Crear grupo (`groups`)
33. Invitar miembro por email → Cloud Function callable que resuelve a uid
34. Pantalla de gestión de miembros (salir / eliminar miembro si eres creador)
34b. Eliminar grupo completo (solo creador/admin) — bloqueado si el grupo tiene movements o settlements con ese groupId, para no dejar historial de gastos inaccesible cuando exista Fase 5
35. Selector de grupo activo en la UI
36. Reglas de seguridad para `groups`

## Fase 5 — Gastos compartidos (MVP real)
37. Formulario de gasto compartido: quién pagó + grupo
38. División igual — cálculo automático
39. División por porcentaje — validación que sume 100%
40. División por monto fijo — validación que sume el total
41. Cálculo de balance por grupo (neteo de deudas) — función pura + tests
42. `settlements` — marcar deuda como saldada (dispara confetti + haptic de Fase 2); checkbox opcional "Registrar también como movimiento personal" — crea un `movement` tipo expense (si eres fromUid) o income (si eres toUid), categoría "Pago de deuda" / "Otros ingresos", ver `DATABASE.md`
42b. Agregar la categoría base "Pago de deuda" (expense) al script de seed — correrlo de nuevo es seguro, ya es idempotente
43. Reglas de seguridad para movimientos compartidos y settlements
44. Conectar la opción "Agregar gasto compartido" del FAB al formulario real
44b. Vista de Movimientos combinada: incluir gastos compartidos que el usuario pagó (un query por grupo, ver DATABASE.md) junto a los personales, cada uno con etiqueta del grupo de origen
44c. Historial de actividad del grupo (últimos ~10 movimientos + settlements) dentro de GroupDetail, visible a cualquier miembro
44d. Desde ese historial, cada parte de un settlement puede agregar su propio movimiento vinculado si aún no lo tiene (independiente de quién creó el settlement originalmente)
44e. Sección "Invitar" en GroupDetail colapsada por defecto (botón que la expande al tocarlo)
44f. Bajo el historial de actividad (44c), si hay más de 10 registros en total, un enlace "Ver todos" que abre una vista/modal con el historial completo del grupo (sin límite de 10), misma combinación de movements + settlements
44g. Bug: la hora de creación de gastos compartidos no queda correcta (aparece medianoche) mientras que en settlements sí — diagnosticar cómo se construye el campo `date` en shared-expense-form vs. settlement-form y corregir
44h. Permitir crear un gasto compartido desde cualquier grupo, no solo el "grupo activo" — acción disponible desde GroupDetail y desde cada tarjeta en la lista de Grupos
44i. `mfx-checkbox` (ver DESIGN.md) — reemplaza los checkboxes nativos de la app, empezando por "Registrar también como movimiento personal"
44j. Rediseño visual de Grupos (selector de grupo activo tipo píldoras, tarjetas con avatares apilados de miembros) y Movimientos (badge de categoría, refinamiento visual), dentro de los tokens de DESIGN.md

## Fase 6 — Presupuesto + recurrentes
45. CRUD de `budgets` (límite mensual por categoría)
46. Alerta visual al acercarse/superar presupuesto (usa el anillo de progreso de Fase 2)
47. CRUD de `recurringPayments`
48. Cloud Function programada: genera el movimiento + dispara notificación
49. Integración con Cloud Messaging (permisos, token, recepción)
49b. Reestructuración: tab "Presupuesto" → "Recurrentes" (solo pagos recurrentes + toggle de notificaciones, movido desde Ajustes); presupuestos pasan a configurarse desde una sección propia en Ajustes, con opt-in por categoría (solo se muestran/crean las categorías que el usuario decide presupuestar, no las 10 de una vez) — ver DESIGN.md

## Fase 7 — Dashboard
Orden fijo de secciones documentado en DESIGN.md. Sustituye y amplía las tareas originales 50-53:
50. Balance total (hero) — tocar abre modal "Balances": desglose por cuenta + botón "Analizar balances"
50b. Adelanto de Fase 8 (54/55): endpoint real del Worker `/summary` (Claude Haiku, límite de 1 consulta real/24h por usuario vía Cloudflare KV con cache del último resultado — ver DESIGN.md) + el botón "Analizar balances" que lo consume, dentro del modal de Balances
50c. Últimos 3 movimientos generales, cada uno con fecha visible, con acceso directo a Movimientos
50c2. Historial de gastos compartidos: últimos 5 eventos agregados de todos los grupos del usuario (reutiliza el formato de "Actividad reciente" del grupo, sin calcular la parte específica del usuario), con acceso directo a Grupos
50d. 3 pagos recurrentes más próximos a vencer, con acceso directo a Recurrentes
50e. 3 grupos, cada uno abre su detalle directo; acceso directo a Grupos
51. Gráfica de tendencia de gasto mensual
52. Gráfica de gasto por categoría
53. Resumen de presupuesto, de menor protagonismo, al final del dashboard

## Fase 8 — IA (vía el Worker)
54. ~~Endpoint del Worker: resumen financiero en lenguaje natural~~ — adelantado a Fase 7 (50b)
55. ~~Botón "¿Qué me dices este mes?"~~ — adelantado a Fase 7 (50b), integrado en el modal de Balances
56. Insight automático mensual: Cloud Function programada (`onSchedule`, no un trigger de escritura — corre una vez al mes, ej. el día 1 a las 7am Bogotá, después del schedule de recurrentes) que, para cada usuario con actividad el mes anterior, llama al Worker servidor-a-servidor (usa por fin `INTERNAL_KEY`, configurado desde Fase 0 y nunca usado), guarda el resultado en `monthlyInsights` y envía push notification avisando que está listo (reutiliza la infraestructura de Cloud Messaging de Fase 6). No comparte el límite de 24h de KV del análisis bajo demanda — es un flujo completamente aparte
57. Control de uso de IA visible: sección en Ajustes mostrando cuántas veces se ha usado "Analizar balances" y cuándo está disponible el próximo (dato que ya existe en KV), sin inventar una cifra en dólares

## Fase 9 — Cierre de la v1
58. Ícono de la app (SVG casa + signo de peso, gradiente de marca `--primary`→`--accent`) + splash screen
59. Perfil: entrada más vistosa desde Ajustes (tarjeta con avatar, no solo un link de texto), botón de volver, "Cerrar sesión" como botón evidente (no texto discreto), campo nuevo de teléfono editable, correo y "miembro desde" como datos de solo lectura
60. Login: rediseño completo con fondo animado reutilizando el gradiente de marca — debe verse bien en modo claro y oscuro
61. Dashboard: encabezado "Zona de análisis" agrupando las gráficas de tendencia y gasto por categoría
62. Grupos personales: campo `type` ('personal' / 'shared') en `groups`, elegido al crear y ya no cambia. Personales: sin invitar nunca, formulario de gasto simplificado (sin paidBy/splitType/splits — se comporta como un movimiento personal con groupId), "total gastado" en vez de balance en el detalle, excluidos del feed "Gastos compartidos recientes" del dashboard, etiqueta con el nombre del grupo (sin decir "Compartido") en Movimientos
63. Más opciones de frecuencia en recurringPayments: diaria, semanal, quincenal, mensual, bimestral, trimestral, semestral, anual (antes solo mensual/semanal) — actualizar el selector del formulario y la lógica de avance de `nextDate` en la Cloud Function programada

## Backlog post-MVP
- Multi-moneda
- Exportar reportes
- Adjuntar foto de recibo al movimiento
- Pagos recurrentes de grupo (el modelo ya lo soporta vía groupId en recurringPayments, pero Fase 6 solo construyó la UI personal)
- Foto de perfil personalizada (requiere configurar Firebase Storage, que no existe todavía en este proyecto)
