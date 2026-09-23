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

## Fase 3 — Movimientos personales
23. CRUD de `accounts`
24. `categories` base (seed) + custom por usuario
25. CRUD de `movements` personales (ingreso/gasto)
26. Lista de movimientos con filtro por cuenta/categoría/fecha
27. Balance rápido por cuenta (usa el contador animado de Fase 2)
28. Reglas de seguridad Firestore para accounts/categories/movements

## Fase 4 — Grupos
29. Crear grupo (`groups`)
30. Invitar miembro por email → Cloud Function callable que resuelve a uid
31. Pantalla de gestión de miembros (salir / eliminar si eres creador)
32. Selector de grupo activo en la UI
33. Reglas de seguridad para `groups`

## Fase 5 — Gastos compartidos (MVP real)
34. Formulario de gasto compartido: quién pagó + grupo
35. División igual — cálculo automático
36. División por porcentaje — validación que sume 100%
37. División por monto fijo — validación que sume el total
38. Cálculo de balance por grupo (neteo de deudas) — función pura + tests
39. `settlements` — marcar deuda como saldada (dispara confetti + haptic de Fase 2)
40. Reglas de seguridad para movimientos compartidos y settlements

## Fase 6 — Presupuesto + recurrentes
41. CRUD de `budgets` (límite mensual por categoría)
42. Alerta visual al acercarse/superar presupuesto (usa el anillo de progreso de Fase 2)
43. CRUD de `recurringPayments`
44. Cloud Function programada: genera el movimiento + dispara notificación
45. Integración con Cloud Messaging (permisos, token, recepción)

## Fase 7 — Dashboard
46. Balance rápido personal + resumen de deudas por grupo
47. Gráfica de tendencia de gasto mensual
48. Gráfica de gasto por categoría
49. Saludo dinámico en el dashboard (la navegación ya quedó lista en Fase 2)

## Fase 8 — IA (vía el Worker)
50. Endpoint del Worker: resumen financiero en lenguaje natural
51. Botón "¿Qué me dices este mes?" en el dashboard
52. Insight automático mensual (trigger Firestore + Cloud Function → Worker)
53. Control de costo/uso de IA visible al usuario

## Fase 9 — Pulido final
54. Ícono de la app + splash screen
55. Ajustes finos de diseño con datos reales ya cargados

## Backlog post-MVP
- Multi-moneda
- Exportar reportes
- Adjuntar foto de recibo al movimiento
