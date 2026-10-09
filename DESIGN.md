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

## Modo claro (nuevo)

Mismo layout y componentes, solo cambian los tokens de color — nunca reestructurar nada al agregar esto.

| Token | Oscuro (default) | Claro |
|---|---|---|
| `--bg` | `#060B14` | blanco / casi blanco |
| `--surface` | `#101B2E` | gris muy claro, ligeramente distinto de `--bg` (misma relación de jerarquía que en oscuro, solo invertida) |
| `--text` | `#F5F7FA` | oscuro (puede reusar el valor de `--bg` oscuro, `#060B14`, por simetría) |
| `--primary` / `--accent` / `--danger` | `#00E6A8` / `#FFD166` / `#FF6B6B` | mismos valores — verifica contraste suficiente sobre fondo claro, ajusta el tono si hace falta pero manteniendo el mismo matiz reconocible |

**Mecanismo**: arranca respetando `prefers-color-scheme` del sistema; un toggle manual (en Ajustes y en Login) lo sobreescribe. Preferencia guardada localmente en el dispositivo (no en Firestore, no se sincroniza entre dispositivos — es una preferencia de pantalla, no de cuenta).

## Navegación

- **Bottom tab bar**, 5 secciones: Inicio, Movimientos, Grupos, Recurrentes, Ajustes (renombrado de "Presupuesto" en la ronda de rediseño del dashboard — el tab ahora solo contiene pagos recurrentes; la configuración de presupuestos vive en Ajustes, con su resumen visible en Inicio)
- **Swiper.js** para deslizar horizontalmente entre las secciones principales, sincronizado con el tab activo (tocar un tab desliza el contenido; deslizar actualiza el tab resaltado)
- **FAB (Floating Action Button)** flotante sobre la tab bar, menú tipo speed-dial (inspirado en el botón "+" de Google Drive) para acciones rápidas de creación — agregar movimiento, agregar gasto compartido, agregar grupo, agregar recurrente

## Inicio (dashboard) — orden fijo de secciones

1. **Balance total** (tarjeta hero) — tocar abre un modal "Balances": desglose por cuenta + botón "Analizar balances" (IA bajo demanda, vía el Worker — ver sección IA más abajo)
2. **Últimos 3 movimientos**, cada uno con su fecha visible — tocar el encabezado lleva a Movimientos
3. **Historial de gastos compartidos**: los últimos 5 eventos (movimientos + settlements) de TODOS los grupos **tipo 'shared'** a los que pertenece el usuario (los grupos `type: 'personal'` no aplican aquí, no son "compartidos") — mismo formato que la "Actividad reciente" ya construida dentro de cada grupo, cada uno mostrando también a qué grupo pertenece. Tocar el encabezado lleva a Grupos.
4. **3 pagos recurrentes más próximos a vencer** — tocar el encabezado lleva a Recurrentes
5. **3 grupos** — tocar un grupo abre su detalle directo; tocar el encabezado lleva a Grupos
6. **"Zona de análisis"** (encabezado de sección, Fase 9): agrupa visualmente las gráficas de tendencia mensual y gasto por categoría (Fase 7) — antes no tenían una división clara del resto del dashboard
7. **Resumen de presupuesto** (de menor protagonismo, al final — la configuración vive en Ajustes)

Todo filtrado al mes activo (mismo encabezado de mes/rango ya existente).

## IA bajo demanda ("Analizar balances")

- Botón dentro del modal de Balances, dispara una llamada al Worker (`/summary`, ya autenticado desde Fase 0) con el contexto de cuentas/movimientos recientes/presupuesto
- Modelo: Claude Haiku (costo bajo, tarea de resumen simple)
- **Límite: máximo una consulta real cada 24 horas por usuario**, para controlar el costo — el Worker guarda en Cloudflare Workers KV (namespace nuevo, no Firestore) el timestamp y el resultado de la última consulta de cada uid. Si piden otra dentro de las 24h, se devuelve el mismo resultado cacheado (con una nota de cuándo se generó) en vez de llamar a Claude de nuevo — así el botón siempre muestra algo útil, nunca un bloqueo vacío
- Resto de la Fase 8 (insight automático mensual, control de costo visible) queda pendiente para cuando se complete esa fase

## Animaciones (Angular Animations + librerías)

- **Entrada de listas**: fade + slide-up en cascada (stagger) al cargar movimientos, grupos, etc.
- **Tarjetas** (`mfx-card`): microinteracción de scale al tocar + feedback háptico (`@capacitor/haptics`)
- **Montos**: contador animado (cuenta ascendente) al cargar balances y totales
- **Presupuesto**: anillo de progreso animado mostrando % usado por categoría
- **Saldar deuda**: celebración con `canvas-confetti` + haptic de éxito — el momento "de otro mundo" de la app
- **Checkbox** (`mfx-checkbox`): reemplaza el `<input type="checkbox">` nativo en toda la app — al marcar, el check se dibuja con una animación de trazo (stroke-dashoffset) en vez de aparecer de golpe, fondo transición a `var(--primary)`, + haptic ligero

## Formato de moneda

Todos los montos de la app (etiquetas Y campos de entrada) se muestran formateados como pesos colombianos: separador de miles, sin decimales, símbolo `$` — **nunca el texto "COP"** (ej. `$150.000`, no `COP 150.000` ni `150000`). Un solo pipe/directiva compartida para toda la app, no una implementación por componente.

## Componentes reutilizables

- `mfx-checkbox`: ver Animaciones arriba
- **Selector de "activo"** (patrón para grupo activo, y reutilizable donde aplique "elegir uno entre varios"): fila horizontal de píldoras con scroll, cada una con nombre + mini-avatar(es); la píldora activa tiene fondo `var(--primary)` con transición suave al cambiar de selección (no un `<select>` nativo). Las tarjetas completas de cada ítem (con más detalle) van debajo, separadas del selector — tocar una píldora cambia cuál está activa; tocar una tarjeta abre su detalle.

## Librerías nuevas a instalar

- `@fontsource/rubik`
- `swiper`
- `canvas-confetti`
- `@capacitor/haptics`
- `@angular/animations` (ya viene incluido con Angular, solo hay que habilitarlo)

## Grupos personales (Fase 9)

Un grupo puede ser `type: 'shared'` (todo lo construido hasta ahora) o `type: 'personal'` — elegido al crear, nunca cambia. Sirve para organizar gastos propios bajo una etiqueta (ej. "Apartamento": arriendo, luz, agua, internet) sin que exista ningún concepto de deuda entre personas.

- Al crear un grupo: segmented control "Personal" / "Compartido" (mismo patrón visual que Gasto/Ingreso en el formulario de movimiento)
- Personal: se salta el paso de invitar, arranca y se queda con un solo miembro para siempre — nunca aparece la opción de invitar
- Agregar un gasto a un grupo personal usa el formulario simple de movimiento (cuenta, categoría, monto, fecha, nota) — sin "¿quién pagó?" ni tipo de división, esos campos no aplican
- El detalle del grupo muestra "Total gastado" en vez de "Balance" (no hay nada que saldar)
- No aparece en el feed "Historial de gastos compartidos" de Inicio (ver arriba) — sí aparece en Movimientos normal, con el nombre del grupo como etiqueta (sin la palabra "Compartido")

## Login

Rediseño con fondo animado reutilizando el gradiente de marca (`--primary` → `--accent`), debe funcionar en modo claro y oscuro. El toggle de tema es visible ahí también (ver Modo claro arriba).

## Ícono de la app

SVG hecho a mano: una casa + un símbolo de peso, con el gradiente de marca `--primary` → `--accent` (mismo espíritu que la llama del gym app — geométrico, no una ilustración compleja).
