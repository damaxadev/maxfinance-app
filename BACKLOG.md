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

## Fase 2 — Movimientos personales
14. CRUD de `accounts`
15. `categories` base (seed) + custom por usuario
16. CRUD de `movements` personales (ingreso/gasto)
17. Lista de movimientos con filtro por cuenta/categoría/fecha
18. Balance rápido por cuenta
19. Reglas de seguridad Firestore para accounts/categories/movements

## Fase 3 — Grupos
20. Crear grupo (`groups`)
21. Invitar miembro por email → Cloud Function callable que resuelve a uid
22. Pantalla de gestión de miembros (salir / eliminar si eres creador)
23. Selector de grupo activo en la UI
24. Reglas de seguridad para `groups`

## Fase 4 — Gastos compartidos (MVP real)
25. Formulario de gasto compartido: quién pagó + grupo
26. División igual — cálculo automático
27. División por porcentaje — validación que sume 100%
28. División por monto fijo — validación que sume el total
29. Cálculo de balance por grupo (neteo de deudas) — función pura + tests
30. `settlements` — marcar deuda como saldada
31. Reglas de seguridad para movimientos compartidos y settlements

## Fase 5 — Presupuesto + recurrentes
32. CRUD de `budgets` (límite mensual por categoría)
33. Alerta visual al acercarse/superar presupuesto
34. CRUD de `recurringPayments`
35. Cloud Function programada: genera el movimiento + dispara notificación
36. Integración con Cloud Messaging (permisos, token, recepción)

## Fase 6 — Dashboard
37. Balance rápido personal + resumen de deudas por grupo
38. Gráfica de tendencia de gasto mensual
39. Gráfica de gasto por categoría
40. Navegación final (Inicio, Movimientos, Grupos, Presupuesto, Ajustes) + saludo dinámico

## Fase 7 — IA (vía el Worker)
41. Endpoint del Worker: resumen financiero en lenguaje natural
42. Botón "¿Qué me dices este mes?" en el dashboard
43. Insight automático mensual (trigger Firestore + Cloud Function → Worker)
44. Control de costo/uso de IA visible al usuario

## Fase 8 — Pulido visual
45. Sistema de diseño (paleta, tipografía)
46. Animaciones (transiciones, celebración al saldar deuda)
47. Ícono de la app + splash screen

## Backlog post-MVP
- Multi-moneda
- Exportar reportes
- Adjuntar foto de recibo al movimiento
