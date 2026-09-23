# CLAUDE.md — Contexto para Claude Code

## Proyecto

**MaxFinance** — app de finanzas familiares/grupales. Permite llevar gastos personales y gastos compartidos entre varios usuarios registrados (grupos tipo "Splitwise + presupuesto"), con resúmenes generados por IA.

## Identidad del proyecto

- App ID: `com.maxfinance.app` (nunca cambiar)
- Prefijo de componentes: `mfx-`
- Nombre del paquete: `maxfinance`
- Repo: GitHub, cuenta personal `damaxadev` (separada de la cuenta de Kadree — ver sección Git más abajo)

## Convenciones

- Código en inglés, UI en español (tuteo colombiano, **nunca** voseo — ni en textos estáticos ni en los generados por IA)
- Angular standalone components, sin NgModules
- Git Flow simplificado: `main`, `develop`, más `feature/`, `fix/`, `chore/`, `hotfix/` — nunca commit directo a `main` o `develop`
- Nunca commitear credenciales: usar `environment.ts`, `environment.prod.ts` y un `.env` para el Worker, todos en `.gitignore`, con `environment.example.ts` como plantilla

## Identidad Git

Máquina Windows con dos identidades separadas (mismo patrón que Zentra/WeMatch):
- `damaxadev` (GitHub, SSH) → para este repo
- Separación vía `gitconfig` condicional por carpeta + llaves SSH distintas

## Workflow de trabajo

- Decisiones de arquitectura, modelo de datos y Firestore: en chat con Claude
- Componentes, vistas y servicios Angular: en Claude Code (este contexto)

## Stack técnico

- **Firebase**: Firestore + Auth (Google Sign-In **sin restricción**, multi-usuario) + Cloud Messaging + Cloud Functions v2 (plan Blaze, requerido por las Scheduled Functions de recurrentes)
- **Cloudflare Worker** (`maxfinance-worker`) como proxy de IA — guarda `ANTHROPIC_API_KEY` como secret
  - Auth del Worker: verifica ID token de Firebase (uid exacto) para llamadas del frontend, o secret compartido `X-Internal-Key` para llamadas servidor-a-servidor desde Cloud Functions
- Modelo de datos completo: ver `DATABASE.md`
- **UI/animación**: `@fontsource/rubik`, `swiper` (navegación deslizable), `canvas-confetti` (celebraciones), `@capacitor/haptics` (feedback táctil), Angular Animations — sistema de diseño completo en `DESIGN.md`

## Fases

Ver `BACKLOG.md`. Trabajamos fase por fase; cada fase debe quedar en un estado usable antes de pasar a la siguiente.
