# DESIGN.md — Sistema de diseño

Principio (mismo criterio que Max Gym Tracker): **UI simple, animación rica con propósito**. Cada animación comunica algo (progreso, éxito, cambio de estado) — no se anima por animar.

## Identidad

MaxFinance es "hermana" de Max Gym Tracker: mismo fondo oscuro, misma tipografía, misma filosofía de animación — pero con su propio acento de color para distinguirse de un vistazo.

## Tipografía

- **Rubik** (idéntica al gym app) — vía `@fontsource/rubik`

## Paleta (modo oscuro)

| Token | Valor | Uso |
|---|---|---|
| `--bg` | `#060B14` | Fondo base |
| `--surface` | `#101B2E` | Tarjetas, superficies elevadas |
| `--primary` | `#00E6A8` | Verde esmeralda — ingresos, positivo, CTA principal |
| `--accent` | `#FFD166` | Dorado — totales destacados, insignias, balance hero |
| `--danger` | `#FF6B6B` | Coral — gastos, alertas de presupuesto, deudas pendientes |
| `--text` | `#F5F7FA` | Texto principal |

**Gradiente hero** (tarjeta de balance total, splash): `#00E6A8 → #FFD166`

## Navegación

- **Bottom tab bar**, 5 secciones: Inicio, Movimientos, Grupos, Presupuesto, Ajustes
- **Swiper.js** para deslizar horizontalmente entre las secciones principales, sincronizado con el tab activo (tocar un tab desliza el contenido; deslizar actualiza el tab resaltado)

## Animaciones (Angular Animations + librerías)

- **Entrada de listas**: fade + slide-up en cascada (stagger) al cargar movimientos, grupos, etc.
- **Tarjetas** (`mfx-card`): microinteracción de scale al tocar + feedback háptico (`@capacitor/haptics`)
- **Montos**: contador animado (cuenta ascendente) al cargar balances y totales
- **Presupuesto**: anillo de progreso animado mostrando % usado por categoría
- **Saldar deuda**: celebración con `canvas-confetti` + haptic de éxito — el momento "de otro mundo" de la app

## Librerías nuevas a instalar

- `@fontsource/rubik`
- `swiper`
- `canvas-confetti`
- `@capacitor/haptics`
- `@angular/animations` (ya viene incluido con Angular, solo hay que habilitarlo)

## Pendiente

- Ícono de la app y splash screen — se definen en la fase de pulido final, inspirados en el gradiente verde→dorado
