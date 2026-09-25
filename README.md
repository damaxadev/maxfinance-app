# MaxFinance

App de finanzas familiares/grupales — control de gastos personales y compartidos, con IA integrada.

## Stack

- **Angular** (standalone components) + **Capacitor** — PWA + Android nativo desde el inicio, sin Ionic
- **Firebase**: Firestore, Auth (Google Sign-In multi-usuario), Cloud Messaging, Cloud Functions v2 (plan Blaze)
- **Cloudflare Worker** — proxy de IA (Claude vía Anthropic API)

## Hermana de

Max Gym Tracker (`my-gym-track-app`) — mismo stack, mismo dueño, apps completamente independientes.

## Identidad

- App ID: `com.maxfinance.app`
- Prefijo de componentes: `mfx-`
- Repo: GitHub, cuenta personal `damaxadev`

## Documentación

- [`CLAUDE.md`](./CLAUDE.md) — contexto y convenciones para Claude Code
- [`DATABASE.md`](./DATABASE.md) — modelo de datos en Firestore
- [`DESIGN.md`](./DESIGN.md) — sistema de diseño: paleta, tipografía, animaciones
- [`BACKLOG.md`](./BACKLOG.md) — fases y tareas
- [`RISKS.md`](./RISKS.md) — riesgos técnicos identificados

## Convenciones rápidas

- Código en inglés, UI en español (tuteo colombiano, nunca voseo)
- Git Flow simplificado: `main`, `develop`, `feature/`, `fix/`, `chore/`, `hotfix/`
- Nunca commitear credenciales (ver `.gitignore`)
