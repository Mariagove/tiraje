# TIRAJE — Plan de producción

## Contexto

Dakota & Durango va a proponer a Ambar un juego web para activación en bares. De los seis conceptos del brainstorming, el cliente interno eligió empezar por **TIRAJE**: el móvil *es* el vaso, el jugador lo inclina físicamente y la app mide el ángulo con el sensor de movimiento para tirar la caña perfecta.

Mecánica acordada: se abre el grifo (toque 1), se cambia a espuma (toque 2), se cierra (toque 3). Como al tirar una caña de verdad, se empieza a ~45° y hay que ir enderezando el vaso conforme sube el nivel. El ángulo se muestra con 3 decimales al empezar, como instrumento de precisión, y **se desvanece al abrir el grifo**: durante la tirada se lee el vaso, no un número. Al terminar: puntuación, posición en el ranking y entrada de 3 iniciales. Se accede por QR en posavasos, sin descargar nada, y cada variedad de cerveza tiene su vaso y su dificultad.

**Esta fase entrega dos cosas:** un prototipo jugable de verdad para enseñar en el móvil en la reunión de pitch, y este documento como respaldo de arquitectura, coste y calendario de la campaña completa, para que el cliente pueda preguntar "¿y cuánto cuesta esto entero?" y haya respuesta.

Proyecto nuevo en `/Users/macbookluis/Documents/Claude/tiraje/`. No existe nada previo relacionado.

---

## Decisiones de cabecera

| | Elección | Por qué |
|---|---|---|
| Sensor | `devicemotion` (`accelerationIncludingGravity` + `rotationRate`) | `deviceorientation` tiene su singularidad de Euler en `beta = ±90°`, que es **exactamente** donde acaba la tirada. Y `alpha` arrastra magnetómetro: un bar está lleno de acero y neveras |
| Fusión | Complementario sobre el **vector**, τ = 0,40 s | Gyro da latencia baja, acelerómetro da cero deriva. No es un compromiso, es fusión |
| Bucle | Timestep fijo **100 Hz** con acumulador | Puntuación idéntica en iPhone a 120 Hz y Android a 30 Hz |
| Render | **WebGL2 a mano**, foto del vaso como textura + refracción en shader. Canvas 2D como tier de respaldo | Decisión del estudio: la fidelidad del cristal es marca. Ver nota abajo |
| Framework | **Vite + TypeScript vanilla.** Sin React | El bucle de juego en estado de React es un tiro en el pie, y son 6 pantallas. Se conservan Vite, TS, Tailwind y oxlint, que ya son vuestras herramientas |
| Núcleo de puntuación | Módulo puro compartido cliente/servidor, **sin funciones trascendentes** | `Math.exp` no es bit-idéntica entre JavaScriptCore y V8. Si el servidor revalida, cualquier `exp` divide el resultado |
| Backend (fase 2) | **Cloudflare** — Pages + Workers + D1 + R2 + KV | Ver §Fase 2 |

### Nota sobre el render: cómo hacer WebGL sin pagar su precio

Elegiste cristal en WebGL y así se hace, pero **sin three.js**. Three son ~150 KB gzip para dibujar un quad a pantalla completa; a mano son 8-15 KB. El presupuesto entero de primera pantalla jugable es 250 KB, así que three se come más de la mitad para nada.

La receta que da la fidelidad sin el riesgo:

- El vaso real **fotografiado** (ya tenéis acceso a los vasos) se hornea en un atlas WebP: capa trasera, capa frontal con bisel, brillos y logo grabado, y un mapa de espesor/normales derivado.
- El shader hace lo que una foto no puede: **refracción del líquido a través del cristal**, cáustica, y la distorsión de la superficie al chapotear. Un solo fragment shader, un solo draw call.
- Riesgos reales que se mitigan: los 100-400 ms de *stall* de compilación del shader se esconden tras la pantalla del gate (se compila mientras el usuario lee), y **hay tier de respaldo en Canvas 2D** que se activa solo si falla la creación del contexto o si el tiempo de frame medio pasa de 20 ms. Mismo contrato de capas, mismo estado, se cambia el renderer y ya.

El respaldo no es desconfianza en la decisión: es lo que permite tomarla sin tener que probar en cada Android de 2019 antes de enseñar el prototipo.

---

## Fase 1 — El prototipo (lo que se construye ahora)

**Objetivo: que alguien coja un móvil en la reunión, incline, tire una caña y quiera repetir.** Sin backend, sin bares, sin RGPD.

### 1.1 Capa de sensores — `src/sensors/`

Marco: `y` = eje largo del móvil = eje del vaso. `û` = vector "arriba del mundo" visto desde el móvil.

```
φ (ángulo de vertido) = atan2(û.z, û.y)   ← lo que se puntúa
ρ (ladeo lateral)     = asin(û.x)          ← lo que se penaliza
```

- **Signo iOS/Android.** `accelerationIncludingGravity` tiene el signo invertido entre plataformas. Nada de husmear el user-agent (falla en webviews y en iPadOS): durante los primeros 600 ms se escucha también `deviceorientation`, se comparan las dos hipótesis contra `beta` y gana la que concuerda. El signo se graba en la traza.
- **Calibración.** El *pitch* **no se calibra**: el vaso dibujado rota con el ángulo absoluto, así que el jugador se autocalibra viéndolo. Meter un offset hace que el vaso en pantalla discrepe de la realidad y se siente mal al instante. El *roll* sí, acotado a ±10°: sujetar el móvil con una mano induce ladeo que no es intención de juego.
- **Gate de calidad** antes de empezar: 1,2 s de reposo con `|‖a‖−9,81| < 0,6`, `‖ω‖ < 8 °/s` y desviación de φ < 1,5°. Sin esto la gente calibra andando.
- **Filtro:** complementario sobre el vector (τ = 0,40 s) y **One Euro solo encima del número mostrado** (`mincutoff` 1,0 Hz, `beta` 0,007). Refrescar el readout a 12-15 Hz, no a 60, con `tabular-nums`.

**Los 3 decimales: dónde aparecen y dónde no.** La resolución real tras fusión es ~0,05-0,1° en reposo y ~0,3-0,5° en movimiento (cuantización del acelerómetro ~0,22°/escalón, temblor fisiológico de la mano 0,2-0,5°). El tercer decimal no tiene contenido informativo: es teatro.

Decisión: **el ángulo con 3 decimales se muestra solo antes de empezar** — durante la calibración y en `READY`, donde el móvil está quieto y las milésimas *sí* son estables. Al abrir el grifo (toque 1) **se desvanece**. Vuelve en la pantalla de resultado, ya en grados enteros, como resumen ("error medio: 3°").

Esto resuelve la tensión en lugar de disimularla. El número hace su trabajo —establecer que el instrumento es de precisión, dar la referencia de los 45° de salida— en el único momento en que es honesto, y se retira antes de que empiece a saltar de forma ilegible con el móvil en movimiento. De paso sube la dificultad por la vía buena: durante la tirada no estás leyendo un número, estás leyendo el vaso.

**La puntuación trabaja a grado entero.** El error se cuantiza a grados antes de evaluarse, con σ = 5°. Efecto secundario que conviene aprovechar: al ser el índice de la tabla un entero, desaparece la interpolación y con ella el último resquicio de divergencia entre motores (§1.3).

### 1.2 Bucle y máquina de estados — `src/game/loop.ts`

Tres relojes: sensor (30-60 Hz irregular), `requestAnimationFrame` (30/60/120), simulación (**100 Hz fijo, la única verdad**).

```
BOOT → AGE_GATE → GATE(1 toque) → CALIBRATE → READY
  → POUR_BEER [tap1] → POUR_FOAM [tap2] → CLOSING [tap3]
  → SETTLE (2 s) → RESULT → INITIALS → READY
```

- **El HUD del ángulo se desvanece en la transición `READY → POUR_BEER`** (250 ms, la curva `standard` de vuestro sistema, sin rebote). A partir de ahí no hay un solo número en pantalla hasta el resultado.
- El input entra por `sampleAt(tiempoDeSim)`, que **extrapola con el giróscopo hasta 25 ms** en lugar de interpolar hacia atrás. Es lo que hace que un iPhone a 120 fps con sensor a 60 Hz se sienta fluido.
- `performance.now()` al entrar al handler, nunca `event.timeStamp` (epoch y resolución inconsistentes entre Safari y Chrome).
- **Nunca recargar ni navegar entre partidas.** En iOS una recarga = nuevo prompt de permiso. "OTRA CAÑA" es un cambio de estado.
- **Ventana de blanking del toque (180 ms).** Tocar la pantalla sacude el móvil justo en el instante de máxima precisión: un toque mete un transitorio de 1,5-4°. Durante esa ventana la calidad instantánea se congela en su media de los 100 ms previos. El chapoteo visual sí recibe el impulso, porque es bonito y es honesto.

### 1.3 El núcleo: puntuación — `src/core/scoring.ts`

**La geometría hace el trabajo de diseño.** Vaso de radio `R` y altura `H` inclinado φ con la superficie horizontal:

> **Derrame ⟺ `tan(φ) > (1 − f)·H/R`**

Para una caña (`H=140 mm`, `R=32 mm`): a vaso vacío puedes llegar a 77°, al 80% de llenado solo a 41°, al 90% solo a 23,6°. **La presión de "endereza conforme sube" sale gratis de la física.** No hay que inventar una curva: la curva objetivo es la de derrame con margen (`k_safe = 0.55`, tope 48°), y se acelera al final, que es justo donde debe estar la dificultad.

Espuma acoplada al ángulo, que es la idea que engancha:

```
δ = max(0, φ*(f) − φ)                      // grados de "demasiado recto"
espumaGen = flujo · (0,05 + 0,009·δ)       // enderezar antes de tiempo GENERA ESPUMA
```

Enderezarte pronto no te resta puntos abstractos: te llena el vaso de espuma y te arruina la corona. El castigo es sistémico y legible.

Puntuación por paso (dt = 0,01 s, solo con grifo abierto), que respeta el brief de "precisión + segundos":

```
e = round(|φ − φ*(f)|)             // ← error a GRADO ENTERO
q = GAUSS[e]                       // tabla de 30 entradas, σ = 5°. Sin interpolación
r = gauss(|ρ| / 14°)               // estabilidad lateral
s = gauss(exceso de velocidad angular / 30°/s)
puntos += (900 | 1300) · q · r · s · dt

score = (puntos + 2500·bonusLlenado + 2500·bonusEspuma + 1000·limpieza) × 10
```

`GAUSS[0..2] ≈ 1,00 / 0,96 / 0,85` y `GAUSS[9] ≈ 0,04`: mantenerse dentro de 2° del objetivo móvil durante diez segundos es difícil y se nota en el marcador; pasarse de 9° es tirar la partida.

Máximo teórico ≈ **171.500**. Calibración objetivo: primera partida ~52.000, buen jugador ~126.000, y que **>165.000 salga en menos de 1 de cada 2.000 partidas**. Derrame: pierdes volumen y −1.500 por evento; 3 derrames o >15% derramado = `CAÑA DERRAMADA`, score ×0,35.

**Determinismo (importa aunque en fase 1 no haya servidor, porque define el fichero):** `Math.exp/sin/pow` no son bit-idénticas entre motores; `+ − × ÷ sqrt` sí. El núcleo trabaja con **productos escalares y tablas de consulta**, y nunca calcula un ángulo escalar. `atan2` se usa solo para el número decorativo de la pantalla.

### 1.4 Render — `src/render/`

Orden de capas, idéntico en WebGL y en el respaldo 2D:

```
1. cristal trasero (refracción horneada)
2. [dentro del recorte del interior]
     líquido + superficie · burbujas · banda de espuma · encaje en la pared
3. cristal frontal (bisel, brillos, logo Ambar grabado)
4. brillo que se desplaza 4-8 px con la inclinación
5. UI en DOM, no en canvas (texto nítido gratis, tabular-nums, no cuesta fillrate).
   Solo antes de tirar: durante la partida esta capa está vacía
```

**El vaso tiene que hablar solo.** Al quitar el número durante la tirada, toda la retroalimentación pasa a ser diegética — dentro del vaso, no encima. Tres señales, por orden de importancia:

1. **La espuma es el marcador en tiempo real.** Ya está en la física: enderezar antes de tiempo genera espuma. El jugador no necesita que le digan que va mal, lo ve subir. Esta es la señal principal y es gratis.
2. **La marca del vaso**, grabada en el cristal como la de un vaso real de medida: una línea fina a la altura de llenado objetivo. Da el destino sin dar instrucciones.
3. **El ángulo objetivo, dibujado en el propio líquido.** Una línea de referencia tenue en el interior, paralela al mundo, que marca dónde *debería* estar la superficie. Si el vaso va bien inclinado, la superficie real la tapa; si te desvías, aparece un hueco cuyo grosor es el error. Se lee de un vistazo y a un metro de distancia, que es como se va a jugar esto en una barra.

Y una regla de color: nada de rojo/verde de videojuego sobre un producto de marca. El desvío se comunica con la **saturación del brillo del bisel**, que sube cuando estás en tolerancia. Se percibe sin leerse.

**El truco que resuelve toda la metáfora** (y que en 2D son ocho líneas; en WebGL es la misma idea en el shader): entrar al recorte rotado y salir al marco del mundo.

```ts
ctx.rotate(phi)            // marco del VASO
ctx.clip(interiorPath)     // cavidad, en coordenadas del vaso
ctx.rotate(-phi)           // ← de vuelta al MUNDO, con el recorte ya fijado
// a partir de aquí "abajo" es abajo de verdad: la superficie es una recta horizontal
```

**Chapoteo:** nada de simulación de fluidos. Dos osciladores armónicos amortiguados = los dos primeros modos de chapoteo de un cilindro. Para R=32 mm sale **3,8 Hz**, que es exactamente a lo que chapotea una caña real. Integrados en el mismo bucle fijo de 100 Hz (con dt variable un oscilador a 3,8 Hz explota).

**Detalle que vende el realismo más que ningún otro:** el **encaje** (*lacing*) que deja la espuma en la pared, como máscara alpha que sigue el nivel máximo alcanzado. Y las burbujas suben en *world-up*, no en *glass-up* — es lo que hace que se note que el vaso está inclinado.

**Presupuesto:** 60 fps en iPhone 8 / Galaxy A50, suelo de 30 fps por debajo. Backing store con tope duro de 1,1 Mpx. **Texturas decodificadas ≤ 12 MB** (este es el límite real en un móvil de 2 GB, no la GPU). Payload de primera pantalla ≤ 250 KB gzip. Escalado adaptativo por media móvil de 30 frames: burbujas 40→12→0, espuma animada→estática, DPR→1.0, y en último extremo el cambio a Canvas 2D. **La simulación nunca cambia de tasa; solo degrada el render.**

### 1.5 Variedades — `varieties/*.json`

Regla dura: **cero código por variedad**. Un JSON con la geometría del vaso (`profile`: perfil radio/altura), caudales, espuma objetivo, parámetros de puntuación, rectángulos del atlas y gradiente del líquido. Un script de build **hornea** las tablas de derrame y de ángulo objetivo desde el perfil, para que el runtime quede libre de trascendentes.

**Añadir una cerveza = 1 JSON + 1 atlas WebP + 1 sonido.** Ni una línea de TypeScript. En el prototipo bastan dos: Especial y Negra, para demostrar que la dificultad cambia.

### 1.6 Onboarding: un solo toque

**El hecho que condiciona todo el diseño de entrada:** iOS exige `DeviceMotionEvent.requestPermission()` desde un gesto de usuario y **Safari no cachea el permiso por dominio** — el prompt sale en *cada* carga de página. Con un QR, eso es un prompt por escaneo.

Por eso un único `pointerdown` hace, **de forma síncrona antes de cualquier `await`**: pedir el permiso de movimiento, desbloquear el audio y arrancar las cargas diferidas. Y ese botón es a la vez el age gate, que es obligatorio:

> **"Sí, soy mayor de 18 · TIRAR CAÑA"**

La respuesta de edad va a `localStorage` (que sobrevive aunque el permiso no), así que en el re-escaneo son cero toques salvo el prompt de iOS. La variedad va en el QR (`?v=especial`), no en una pantalla de selección. Las instrucciones van **alrededor** del botón, no detrás, para que cuando aparezca el diálogo de iOS tenga sentido. Los primeros 3 s de `READY` son el tutorial: el vaso ya responde a la inclinación antes de abrir el grifo.

### 1.7 Respaldo sin sensor

Tres casos distintos con tres respuestas distintas: `no-api` (escritorio), `denied`, y **`granted-but-silent`** — permiso concedido pero en 1,2 s no llega ningún dato, que es el caso que todo el mundo olvida y que pasa en webviews.

**Webviews de Instagram/TikTok/Facebook:** en iOS el permiso de movimiento típicamente no se puede obtener y desde JS no se puede salir del webview. No tiene arreglo técnico, solo de UX: detección por user-agent, `intent://` para saltar a Chrome en Android, y en iOS una pantalla ilustrada que señala el `•••` → "Abrir en Safari". La buena noticia es que el tráfico del QR viene de la cámara nativa, que abre el navegador de verdad; el webview solo aparece al compartir enlace.

Control alternativo: **arrastre vertical del pulgar** (no slider), que genera un `û` sintético y entra por el mismo pipeline, con ruido determinista de 0,15° RMS para que el número de 3 decimales no se quede clavado. Rankings separados, nunca fusionados: **oficial** (sensor) y **de práctica** (dedo).

### 1.8 Entregable de fase 1

Una URL HTTPS que se abre con un QR y se juega. Dos variedades, arte placeholder sustituible, ranking simulado en `localStorage` con la pantalla de iniciales completa. **Y una herramienta que vale más que el resto: el grabador/reproductor de trazas** — captura trazas reales en el móvil, las exporta, y un banco de pruebas en escritorio las reproduce contra la función de puntuación. Sin esto, cada iteración del algoritmo cuesta agitar un teléfono treinta veces.

---

## Fase 2 — La campaña completa (documentado, no construido)

### Infraestructura: Cloudflare

El perfil de carga decide: ~1.000 bares y 200.000 partidas en 6 meses son **0,013 req/s de media**, con picos patológicos de 50-100 req/s durante diez minutos. Es un caso de libro de escala-a-cero, y cualquier arquitectura con coste fijo paga aire el 95% del tiempo.

| | Coste real 6 meses | Latencia desde España |
|---|---|---|
| **Cloudflare** | **~50 €** | PoP en Madrid, Barcelona, Bilbao, Valencia |
| Vercel + Upstash + Neon | ~400 € (3 facturas) | París/Frankfurt |
| Supabase Pro | ~200 € | París/Irlanda |

Tres razones, en orden: el coste en los valles; la latencia (es el único con presencia en Madrid, y el QR se escanea con la wifi de un bar); y **R2 sin coste de egreso**, que es lo que hace económicamente viable guardar y re-auditar 200.000 trazas de sensor.

**Cuándo elegiría Supabase en su lugar:** si Ambar exige acceso SQL directo o integración con su BI corporativo, o si aparecen cuentas con login por bar. Y si la fecha de activación es inamovible y el estudio no ha tocado Workers nunca — con fecha fija, el stack conocido gana al óptimo.

Lo único que Cloudflare no regala es el panel de métricas para el cliente: son 2-3 días contra una tabla `daily_stats`. El ahorro frente a las alternativas los paga de sobra.

### Antitrampa

El cliente sube la **traza binaria completa** y el servidor **recalcula la puntuación**, ignorando la que envía el cliente. Formato TRZ1: 3 bytes/muestra, **~2,5 KB por partida comprimida** frente a los 42 KB de JSON ingenuo. Coste total del antitrampa en toda la campaña: **menos de 2 €**. El coste real no es el dinero, es la red del bar: 2,5 KB se suben, 42 KB no.

Capas, y hay que ser preciso sobre qué resuelve cada una:

1. **Recálculo en servidor.** Elimina al 99% de los tramposos reales: el que abre las DevTools y hace `fetch('/api/plays', {score: 9999})`.
2. **Plausibilidad física.** La señal más discriminante es el **temblor fisiológico de la mano, 8-12 Hz**, que aparece en cualquier traza real y que un generador ingenuo no reproduce. Más: jitter del muestreo (σ(dt) < 0,4 ms = sintético seguro), techo de velocidad angular humana (~900 °/s), y hash único de traza contra el replay exacto.
3. **Token de sesión HMAC** de un solo uso, consumido con un `UPDATE ... WHERE state='open'` atómico. `plays.id = session_id` da idempotencia natural: sin eso, la mala conectividad del bar genera puntuaciones duplicadas.
4. **La capa que decide de verdad, y no es técnica:** en las bases legales, **el premio se reclama jugando una partida de validación en el bar delante del personal**. Eso vuelve económicamente inútil cualquier trampa remota. Hay que negociarlo con Ambar al principio, no cuando aparezca el primer caso.

Y dos reglas de operación: nunca dar al cliente un mensaje de "traza sospechosa" (es un oráculo con el que el tramposo calibra su generador), y **gastar el escrutinio solo donde hay premio** — a nadie le importa una trampa en el puesto 8.000, y bloquearla solo genera falsos positivos furiosos.

**Los umbrales no se inventan.** Entregable obligatorio antes del lanzamiento: piloto en 2-3 bares, **500 trazas reales en condiciones de bar** (gente bebida, móviles viejos, de pie), y fijar los umbrales en el percentil 99,5 de lo real. En paralelo, escribir vosotros el generador de trazas sintéticas: si no lo hacéis vosotros, lo hará otro y os enteraréis por Twitter.

### Rankings

Fuente de verdad en D1 (SQLite). El ranking **por bar** no tiene problema: 200 filas por bar, un escaneo de índice. El **global** con 200.000 filas necesita un **histograma acumulado por buckets de 100 puntos**: el rango sale de 1 lectura O(1) más un puñado de filas del bucket, y escala a millones sin tocar nada. El top 100, que es el que importa, se calcula siempre exacto. Cachés en KV con TTL de 30-120 s.

Descartado Redis con sorted sets: es la solución más limpia y la más cara en complejidad — un segundo almacén que no es la fuente de verdad, que hay que resincronizar cada vez que moderas una partida. Para 200.000 filas es matar moscas a cañonazos.

**`score` como entero, nunca float.** Ordenar floats y comparar empates en un ranking con premios es pedir problemas. Desempate por fecha ascendente, y eso debe estar escrito en las bases.

**Congelar `scoring_version` el día del lanzamiento.** Si hay que cambiar el algoritmo, no se recalcula lo anterior: se abre temporada nueva. Este riesgo es organizativo — alguien de marca pedirá "hacerlo un poco más fácil" en la semana 3.

### QR y bares

Tres identificadores separados a propósito: `code` impreso (`AB7K2`, base32 de Crockford sin I/L/O/U para que nadie confunda 0 con O), `slug` visible, `id` interno. URL impresa: `tiraje.es/r/AB7K2`.

**El QR apunta siempre a un redirector propio**, y esto merece defenderse ante el cliente: el posavasos es inmutable y va a estar en cajas de almacén durante meses; el redirector es lo único que permite que un cartón impreso en 2026 siga haciendo algo sensato en 2028. Además es **el único punto donde se mide "escaneos" frente a "partidas"** — y esa diferencia es la métrica más valiosa del informe, porque dice si el problema está en el posavasos o en el juego. Nunca un acortador de terceros. Y **302, jamás 301**: un 301 lo cachean los navegadores de forma efectivamente permanente, y un solo despliegue con 301 quema los posavasos de forma irreversible.

Impresión: corrección de errores **nivel Q (25%)**, no M — el posavasos se moja y se le apoya un vaso encima. Mínimo 25-30 mm, zona de silencio de 4 módulos respetada (el diseñador la querrá comer; no dejarle), y **la URL en texto junto al QR** porque un porcentaje de escaneos falla siempre.

El flujo real no es "damos de alta el bar y luego imprimimos": se imprimen 2.000 posavasos antes de saber a qué bares van. Por eso los códigos viven en un **pool sin asignar** y se asignan después por CSV del distribuidor. Un código sin asignar que se escanea no da 404: pregunta "¿en qué bar estás?" con geolocalización, convirtiendo un fallo logístico en un alta semiautomática.

### Pantalla del bar

`tiraje.es/tv/:slug` con **polling con ETag cada 20 s, no WebSocket**. Es una tablet de 80 € en la pared de un bar con wifi que se cae tres veces al día: un GET condicional que devuelve 304 es robusto a eso sin lógica de reconexión. Wake Lock (iOS 16.4+, con fallback de vídeo mudo en bucle) y watchdog que recarga cada 60 min. Rotación de paneles cada 15 s, y uno de ellos es un **QR grande en pantalla** — que la gente escanee desde la TV es una fuente de partidas que no necesita posavasos.

Exportación imprimible: HTML con `@media print`, que el camarero imprime con Ctrl+P. Solo partidas válidas y **con fecha y hora de corte visible** — un ranking impreso sin fecha de corte es una reclamación esperando a ocurrir. Cron semanal que deja CSV+HTML de cada bar y manda el enlace a la marca.

### Cumplimiento

*Análisis técnico-organizativo, no asesoramiento jurídico. Lo marcado abajo lo valida el DPO de Ambar.*

- **Publicidad de alcohol.** El jugador **sirve, nunca bebe** — esto ya está en la mecánica desde el diseño, y es lo que la hace defendible. Age gate obligatorio fusionado con el botón de inicio, mensaje de consumo responsable en la pantalla de resultado, nada que se pueda leer como incentivo al consumo ni dirigido a menores.
- **Sin banner de cookies.** El art. 22.2 LSSI no habla de "cookies" sino de almacenamiento en el terminal: cubre `localStorage` igual. La recomendación es **una sola clave con un UUID aleatorio de primera parte**, sin fingerprinting de ningún tipo, usada solo para la partida y para prevenir fraude en una promoción con premios — lo que encaja razonablemente en la exención de la Guía de Cookies de la AEPD. Una línea informativa, no un muro. **Esta es una decisión legal disfrazada de técnica: que la valide el DPO por escrito antes del lanzamiento.**
- **Analítica:** Cloudflare Web Analytics (gratis, sin consentimiento). Las métricas que Ambar de verdad quiere —escaneos por bar, partidas, tasa de finalización— **no son métricas de analítica web, salen de vuestra propia base de datos**. Plausible (9 €/mes) solo si su agencia pide un dashboard clásico; presupuestadlo como opción.
- **Sobre "comparticiones":** `navigator.share()` no dice de forma fiable si el usuario completó el envío. La métrica honesta son las visitas a `/p/:playId` desde fuera. Y ojo: **compartir imagen funciona en Android pero es inestable en Safari iOS** (a veces comparte el texto en lugar de la imagen), así que hace falta el respaldo de "guardar imagen".
- **Retención:** trazas 90 días (regla de ciclo de vida de R2, sin código). **La ventana de reclamación de premios tiene que ser más corta que la retención de trazas**, o no podréis auditar una disputa — hay que cerrar ese encaje con la marca antes de escribir las bases.
- **Entregables legales de Ambar, en la semana 1 y no en la última:** bases de la promoción (con desempate y validación presencial), contrato de encargo art. 28, política de privacidad con Ambar como responsable, y la clasificación habilidad-vs-azar del premio. Tardan más en aprobarse que en desarrollarse el backend.

### Desarrollo y despliegue

**HTTPS en móvil real es un requisito, no un lujo** (los sensores exigen contexto seguro). mkcert es doloroso en iOS (perfil de configuración por dispositivo) y un túnel rápido cambia de URL en cada reinicio — con ella se pierde el permiso concedido y todo el `localStorage`, que es una forma eficaz de odiar el proyecto. **Túnel con nombre y hostname estable `dev.tiraje.es`**, uno por persona del equipo, protegido con Cloudflare Access.

CI: typecheck, oxlint, Vitest, y **fixtures dorados de puntuación ejecutados en WebKit y Chromium reales vía Playwright** — los tres resultados deben ser idénticos al entero. Ese test es el que os salva. Más una regla que hace grep del bundle buscando `Math.exp` y compañía en el paquete de scoring; suena tosco y funciona.

---

## Calendario y coste

| Fase | Duración | Contenido |
|---|---|---|
| **1. Prototipo** | **3-4 semanas** | Vertical slice de sensor → núcleo → render → 2 variedades → pulido del gate |
| 2. Núcleo de campaña | 3 semanas | Worker, D1, trazas, rankings, redirector, gestión de bares |
| 3. Piloto | 1 semana | 2-3 bares reales, 500 trazas, calibrar σ y umbrales antifraude |
| 4. Operación | 2 semanas | TV, exportación, panel de métricas, moderación |
| 5. Lanzamiento | 1 semana | Carga, WAF, flags, ensayo de despliegue |

**Coste de infraestructura en campaña: ~50-60 € en seis meses.** Lo caro es el arte y el tiempo, no los servidores.

**Orden no negociable dentro de la fase 1:** el vertical slice de sensor va primero, y se prueba en **un iPhone viejo, un Android barato y un webview de Instagram antes de escribir nada más**. Ahí es donde mueren los proyectos de sensores.

---

## Riesgos, por probabilidad de arruinar la campaña

1. **Prompt de permiso en cada escaneo en iOS.** Pérdida estimada del 15-30% del funnel. Gate de un toque, Service Worker, nunca recargar entre partidas. **Instrumentar escaneo→permiso→partida desde el día uno.**
2. **Webviews sociales sin sensor.** Y es justo la métrica de compartición que quiere la marca. Detección + `intent://` en Android + pantalla ilustrada en iOS. Medir el porcentaje.
3. **Varianza de sensor entre dispositivos** (30 Hz frente a 100 Hz) creando ventaja injusta. No se arregla con software. Registrar el tier en todo score, medir la brecha en el piloto y, si supera el 8%, documentarla o normalizar.
4. **Cambiar la puntuación con la campaña viva.** Congelar la versión; los cambios abren temporada nueva.
5. **GPU de gama baja con el shader.** Tiers adaptativos y el respaldo automático a Canvas 2D.
6. **Fatiga del brazo a 45°.** Partida de 15 s como máximo; el `SETTLE` de 2 s permite bajar el brazo.
7. **Audio inútil en un bar ruidoso.** Todo el feedback tiene que funcionar sin sonido. Y **`navigator.vibrate` no existe en Safari iOS**: la háptica es una mejora en Android, nunca un canal del que dependa nada.

---

## Verificación de la fase 1

1. **Banco de pruebas determinista.** `npm test` reproduce trazas `.trz` grabadas contra el núcleo de puntuación y compara con fixtures. Incluye una traza perfecta sintética (debe caer en [160.000, 180.000]) y una mediocre ([70.000, 100.000]). Este test es el que impide que una variedad desbalanceada reviente el ranking.
2. **Simulador de sensor en escritorio.** Modo que inyecta eventos `devicemotion` sintéticos, para poder desarrollar sin agitar un teléfono. Verificable en el navegador integrado con `preview_start`.
3. **Prueba en dispositivo real, obligatoria y no delegable:** iPhone (flujo de permiso completo, incluido denegar y reintentar), Android Chrome, y el webview de Instagram para confirmar que el mensaje de "abre en Safari" aparece. Túnel con hostname estable para no reinstalar el permiso cada vez.
4. **Presupuesto de rendimiento medido, no supuesto:** overlay de debug con tiempo de frame, tasa de muestreo del sensor y tier activo. Verificar que el cambio automático a Canvas 2D se dispara y no se ve roto.
5. **Lighthouse con 4G lento simulado:** LCP < 1,8 s, JS de primera pantalla < 250 KB gzip.
6. **Prueba específica del HUD que se va:** jugar tapando mentalmente el número y confirmar que las tres señales diegéticas bastan. Si alguien pregunta "¿pero cuánto tengo que inclinar?" después de la segunda partida, la línea de referencia del líquido no es lo bastante legible y hay que subirle contraste antes que nada.
7. **La prueba que de verdad cuenta:** llevar el móvil a un bar y que tres personas que no han visto el juego lo entiendan sin explicación y quieran repetir. Si la segunda partida no es mejor que la primera, la curva de aprendizaje está mal y hay que retocar σ antes de seguir.

---

## Ficheros clave

```
/Users/macbookluis/Documents/Claude/tiraje/
├── src/core/scoring.ts        ← define el juego. Determinista, sin trascendentes
├── src/sensors/fusion.ts      ← permisos, signo iOS/Android, complementario, traza
├── src/game/loop.ts           ← timestep fijo, sampleAt, estados, blanking del toque
├── src/render/glassGL.ts      ← WebGL2 a mano: refracción, líquido, espuma
├── src/render/glass2d.ts      ← respaldo automático, mismo contrato de capas
├── varieties/especial.json    ← contrato de datos por cerveza
├── tools/bake-tables.ts       ← hornea tablas de derrame y ángulo objetivo
└── tools/trace-lab/           ← grabador y reproductor. Se construye ANTES que el juego
```

Se copian de `dakota-durango-redesign/app`: `tsconfig` (target ES2023, `verbatimModuleSyntax`, alias `@/*`), `.oxlintrc.json`, la configuración de Tailwind con los tokens de marca, y el subset de Gotham de `public/fonts/`. Se añade una entrada a `/Users/macbookluis/Documents/Claude/.claude/launch.json` junto a las existentes. **No se copia React ni three.js.**
