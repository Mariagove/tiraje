# TIRAJE

Juego web para Ambar. El móvil es el vaso: lo inclinas, el sensor mide el
ángulo, y tiras la caña perfecta. El porqué de todo: `HANDOFF.md` y `docs/PLAN.md`.

**Jugar: <https://mariagove.github.io/tiraje/>** — se publica solo en cada
push a `main` (`.github/workflows/pages.yml`). Desde ahí funciona el sensor
del móvil sin montar nada: Pages sirve por HTTPS, que es lo que exige
`DeviceMotionEvent`. `?v=negra` elige la variedad.

```bash
npm run dev     # HTTPS en :5173, accesible desde la LAN — ver docs/DEV-HTTPS.md
npm test        # vitest: 101 tests
npm run lint    # oxlint
npm run bake    # rehornea las tablas desde varieties/*.json
npm run build   # bake + typecheck + bundle
npm run lab -- --synth mediocre          # banco de pruebas de escritorio
npm run lab -- traza.json --variety negra
```

## Estado

**Fase 1** — andamiaje y rebanada vertical del sensor. Hecha.
**Fase 2** — núcleo de puntuación y laboratorio de trazas. Hecha.
**Fase 3** — bucle, máquina de estados y renderer 2D. Hecha. Es jugable.
**Fase 4** — `render/glassGL.ts`, cuando haya foto del vaso.

Abre `npm run dev` y tienes tres vistas:

- **JUEGO** — el prototipo jugable. Sin sensor cae al arrastre del dedo, con
  ranking de práctica separado. `?v=negra` elige la variedad, como hará el QR.
- **SENSOR** — φ y ρ con gráfica y diagnóstico de la sonda de signos.
- **TRAZA** — el grabador: tres toques, puntúa y exporta la traza.

Lo que falta y quién lo decide: `docs/PENDIENTE.md`.

## Mapa

```
src/core/scoring.ts        el núcleo. Determinista, sin trascendentes
src/core/types.ts          contrato de variedad y de tablas horneadas
src/core/baked/*.ts        GENERADO por bake-tables. No editar
src/sensors/fusion.ts      permisos, signo iOS/Android, complementario, traza
src/sensors/oneEuro.ts     suavizado SÓLO del número mostrado
src/game/loop.ts           timestep fijo, sampleAt, estados, 100 Hz
src/game/slosh.ts          dos osciladores = los dos modos de chapoteo
src/render/types.ts        contrato de capas, idéntico en GL y en 2D
src/render/glass2d.ts      respaldo Canvas 2D, completo
src/render/tier.ts         escalado adaptativo, sólo baja
src/sensors/thumbSource.ts control alternativo sin sensor
src/dev/shell.ts           el age gate de un toque + las tres vistas
src/dev/game-view.ts       el prototipo jugable
src/dev/trace-recorder.ts  el grabador de trazas
varieties/*.json           cero código por cerveza
tools/bake-tables.ts       hornea las tablas desde el perfil del vaso
tools/trace-lab/           generador sintético, CLI y fixtures dorados
```

## La frontera del determinismo

`core/` no llama a ninguna trascendente, y hay un test que lo comprueba con
grep. Se consigue en dos piezas:

1. La geometría se hornea en tablas de literales dobles (`npm run bake`).
2. La entrada llega **cuantizada a décimas de grado enteras**. `atan2` vive
   sólo en `sensors/`, y lo que entra en la traza es el entero — así el
   servidor de la fase 2 recalcula sobre exactamente los mismos enteros que
   vio el cliente.
