# TIRAJE — Handoff

> Para quien recoge el proyecto. Si solo vas a leer una sección, lee **"Lo que te va a morder"**.
> El plan técnico completo está en `~/.claude/plans/me-gustan-las-ideas-typed-acorn.md`.
> Última actualización: 21 de septiembre de 2026.

---

## 1. Qué es esto

Un juego web para **Ambar** (cerveza, La Zaragozana), pensado para activación en bares.

**El móvil es el vaso.** Lo inclinas físicamente, el sensor de movimiento mide el ángulo, y tienes que tirar la caña perfecta: empiezas a ~45° y vas enderezando conforme sube el nivel, igual que un camarero. Tres toques — abrir grifo, pasar a espuma, cerrar. Al acabar, puntuación y tres iniciales estilo recreativa. Se entra por QR en un posavasos. No se descarga nada.

**Estado: nada escrito todavía.** El plan está aprobado, este directorio está vacío salvo por este documento. Empiezas de cero.

---

## 2. Cómo hemos llegado aquí

Se propusieron seis conceptos de videojuego para Ambar (roguelike survivor "Cierzo", brick-breaker de chapas, aventura gráfica de El Tubo, Guitar Hero de jota, idle de la fábrica de 1900, y este). El estudio eligió **Chapas** y **Tiraje**, y decidió empezar por Tiraje.

La mecánica original del brainstorm era más compleja (ángulo del vaso, apertura del grifo, corte de espuma, reposo). **Se simplificó a propósito**: el móvil mide el ángulo y hay tres toques. Menos verbos, misma dificultad.

**Ambar no ha dicho que sí todavía.** Lo que se construye ahora es el prototipo con el que se va a pitchear. Eso condiciona las prioridades: lo que se ve y se siente pesa más que lo que escala.

---

## 3. Decisiones cerradas

No las reabras sin un motivo nuevo. Cada una tiene su porqué, y varias parecen arbitrarias hasta que sabes cuál es.

| Decisión | El porqué que no es obvio |
|---|---|
| **`devicemotion`, no `deviceorientation`** | La descomposición de Euler tiene su singularidad en `beta = ±90°`, que es **exactamente** donde acaba la tirada — el vaso casi vertical, el momento de máxima precisión, justo encima del gimbal lock. Además `alpha` arrastra magnetómetro y un bar está lleno de acero y neveras |
| **El *pitch* no se calibra** | El vaso dibujado rota con el ángulo absoluto, así que el jugador se autocalibra viéndolo. Un offset haría que el vaso en pantalla discrepe de la física real y se siente mal al instante. El *roll* sí se calibra, acotado a ±10° |
| **Simulación a 100 Hz fijo** | Para que un iPhone a 120 fps y un Android a 30 puntúen idéntico. Cada paso aporta exactamente 10 ms |
| **WebGL2 a mano, sin three.js** | Three son ~150 KB gzip para dibujar un quad; a mano son 8-15 KB, sobre un presupuesto total de 250 KB. Hay respaldo automático a Canvas 2D si el contexto falla o el frame se pasa de 20 ms |
| **Vite + TypeScript vanilla, sin React** | El bucle de juego en estado de React es un tiro en el pie, y son seis pantallas. Se conservan Vite, TS, Tailwind y oxlint, que ya son herramientas del estudio |
| **El HUD del ángulo desaparece al abrir el grifo** | Los 3 decimales solo son honestos con el móvil quieto. Se muestran en calibración y en `READY`, se desvanecen al tirar, y vuelven en el resultado ya en grados enteros |
| **La puntuación trabaja a grado entero** | La resolución real del sensor es ~0,1°. Una tolerancia más fina que 1° es una moneda al aire que el jugador percibe como injusta. Beneficio colateral: el índice de la tabla es entero, no hay interpolación, y desaparece la divergencia entre JavaScriptCore y V8 |
| **Núcleo de puntuación sin `Math.exp/sin/pow`** | No son bit-idénticas entre motores. `+ − × ÷ sqrt` sí lo son. El servidor de la fase 2 revalida recalculando, así que cualquier trascendente rompe el sistema |
| **Cloudflare para la fase 2** | ~50 € frente a ~400 € en seis meses, PoP en Madrid, y R2 sin coste de egreso, que es lo que hace viable guardar y re-auditar 200.000 trazas |

### La decisión de la que cuelga todo lo demás

**La curva de dificultad no está inventada, sale de la geometría.** Un vaso de radio `R` y altura `H` inclinado φ derrama cuando `tan(φ) > (1 − f)·H/R`. Con una caña normal: vacío aguanta 77°, al 80% de llenado solo 41°, al 90% solo 23,6°.

De ahí sale gratis la presión de enderezar conforme sube, y una curva que se acelera justo al final. **No toques esa fórmula para "ajustar la dificultad".** La palanca de dificultad es σ (empieza en 5°), no la geometría.

Y el acoplamiento que hace que el juego enganche: **enderezar antes de tiempo genera espuma**, que te llena el vaso sin cerveza y te arruina la corona. El castigo no es "menos puntos", es sistémico y se ve. No lo sustituyas por una penalización numérica.

---

## 4. Lo que sigue abierto

Esto necesita respuesta de alguien, no de código.

**Del estudio o de Ambar:**

1. **¿Hay premio físico?** Cambia todo el antitrampa. Con premio, la validación presencial en el bar es obligatoria y hay que negociarla con la marca al principio. Sin premio, media fase 2 se simplifica.
2. **Dominio.** Se asume `tiraje.es`. ¿Lo compra el estudio o Ambar? Importa: los posavasos impresos apuntan ahí durante años, y si el dominio es del estudio y la relación se acaba, los cartones quedan muertos.
3. **Cristalería.** El plan asume fotografía de los vasos reales de Ambar. ¿Sesión de foto o render 3D? ¿Ambar cede las piezas? Sin esto no hay arte final, solo placeholder.
4. **Variedades del lanzamiento.** El prototipo lleva dos (Especial y Negra) para demostrar que la dificultad cambia. Falta la lista real y sus vasos.
5. **Tamaño de campaña.** Se ha dimensionado para ~1.000 bares y 200.000 partidas en 6 meses. Si son 50 bares o son 5.000, cambian las cifras, no la arquitectura.

**Números que son una conjetura de partida y hay que calibrar con datos reales:**

- `σ = 5°` — la palanca de dificultad. Objetivo: que >165.000 puntos salga en menos de 1 de cada 2.000 partidas. Se calibra con el piloto, no antes.
- Caudales (`beerRatePerSec 0,105`, etc.) — salen de que una caña se tira en ~9,5 s. Ajustables a oído.
- Umbrales de antifraude — **estos no se inventan bajo ningún concepto.** Se fijan con 500 trazas reales recogidas en un bar, en el percentil 99,5.

---

## 5. Lo que te va a morder

Por orden de probabilidad de arruinarte una semana.

**1. iOS pide permiso de sensores en cada carga de página.** Safari no cachea el permiso por dominio. Con un QR, eso es un prompt por escaneo. Consecuencias que están ya en el diseño y que no puedes saltarte:
- El botón de inicio hace el `requestPermission()` **de forma síncrona, antes de cualquier `await`** — si metes un await delante, pierdes la activación transitoria y el permiso falla sin decirte por qué.
- **"OTRA CAÑA" nunca recarga ni navega.** Todo es una SPA de un documento. Una recarga = un prompt nuevo.
- El age gate (obligatorio por ser cerveza) se fusiona con ese mismo botón: *"Sí, soy mayor de 18 · TIRAR CAÑA"*.

**2. Desarrollar esto sin HTTPS estable es una tortura.** Los sensores exigen contexto seguro. Un túnel rápido cambia de URL en cada reinicio, y con la URL cambia el origen: pierdes el permiso concedido y todo el `localStorage`. Vas a aceptar el mismo diálogo cincuenta veces al día. **Monta un túnel de Cloudflare con hostname estable (`dev.tiraje.es`) antes de escribir la primera línea.**

**3. El signo del acelerómetro está invertido entre iOS y Android.** Y no puedes resolverlo husmeando el user-agent: falla en webviews y iPadOS se declara Mac. Hay que escuchar `deviceorientation` los primeros 600 ms y comparar las dos hipótesis contra `beta`.

**4. Tocar la pantalla sacude el móvil justo en el instante de máxima precisión.** Un toque mete un transitorio de 1,5-4° durante 120-200 ms. Si no lo tratas, castigas al jugador por jugar. De ahí la ventana de blanking de 180 ms, que va **dentro** del núcleo determinista para que el servidor la reproduzca igual.

**5. Los webviews de Instagram y TikTok no dan permiso de sensores en iOS, y desde JS no puedes salir del webview.** No tiene arreglo técnico, solo de UX: detectar y mostrar "abre en Safari". La buena noticia es que el QR escaneado con la cámara nativa abre el navegador de verdad; el webview solo aparece cuando alguien comparte el enlace.

**6. Hay tres casos de "no hay sensor", no uno.** `no-api` (escritorio), `denied`, y **`granted-but-silent`** — permiso concedido pero no llega ningún dato. Ese tercero es el que todo el mundo olvida y hay que temporizarlo explícitamente a 1,2 s.

**7. `navigator.vibrate` no existe en Safari iOS.** La háptica es una mejora en Android, nunca un canal del que dependa nada. Y el audio es inútil en un bar ruidoso: todo el feedback tiene que funcionar en silencio.

**8. El límite de rendimiento real es la RAM de texturas, no la GPU.** Tope de 12 MB decodificados: en un móvil de 2 GB es lo que te tumba, y no lo ves venir en el Mac.

---

## 6. Por dónde empezar

**Día 1 — el túnel y el *vertical slice* del sensor.** Una página HTTPS mínima: permiso, fusión, y el número del ángulo en pantalla con una gráfica de debug. Nada más.

**Pruébalo en un iPhone viejo, un Android barato y un webview de Instagram antes de escribir nada más.** Ahí es donde mueren los proyectos de sensores, y descubrirlo en la semana 3 cuesta la semana 3.

**Día 2-3 — el laboratorio de trazas**, antes que el juego. Un modo que graba trazas reales en el móvil y las exporta, y un banco de pruebas en escritorio que las reproduce contra la función de puntuación. Sin esto, cada iteración del algoritmo cuesta agitar un teléfono treinta veces; con esto, cuesta un test unitario. **Es la herramienta que más tiempo te va a ahorrar de todo el proyecto.**

Luego: núcleo determinista con sus tests → renderer con arte placeholder → las dos variedades → pulido del gate de entrada.

Orden de ficheros según el plan:

```
src/core/scoring.ts      ← define el juego. Determinista, sin trascendentes
src/sensors/fusion.ts    ← permisos, signo iOS/Android, complementario, traza
src/game/loop.ts         ← timestep fijo, sampleAt, estados, blanking del toque
src/render/glassGL.ts    ← WebGL2: refracción, líquido, espuma
src/render/glass2d.ts    ← respaldo automático, mismo contrato de capas
varieties/especial.json  ← contrato de datos por cerveza
tools/bake-tables.ts     ← hornea las tablas desde el perfil del vaso
tools/trace-lab/         ← el grabador. Se construye ANTES que el juego
```

Se copian de `dakota-durango-redesign/app`: el `tsconfig` (ES2023, `verbatimModuleSyntax`, alias `@/*`), `.oxlintrc.json`, la config de Tailwind con los tokens de marca y el subset de Gotham. **No se copia React ni three.js.**

---

## 7. Lo que NO hay que hacer

- **No añadas una barra de progreso, un contador o un indicador numérico durante la tirada.** El HUD desaparece a propósito. Toda la retroalimentación es diegética: la espuma subiendo, la marca grabada en el vaso, y la línea de referencia dentro del líquido cuyo hueco con la superficie real *es* el error.
- **Nada de rojo/verde de videojuego** sobre un producto de marca. El desvío se comunica con la saturación del brillo del bisel.
- **El jugador sirve, nunca bebe.** No es una decisión estética: es lo que hace el juego defendible en publicidad de alcohol en España. Nada de "beber más da más puntos", nada de velocidad de consumo.
- **No metas trascendentes en `core/`** para "que quede más elegante". Rompe la revalidación en servidor de la fase 2 de una forma que no se ve hasta que hay una disputa por un premio.
- **No cambies la función de puntuación con la campaña viva.** Se congela el día del lanzamiento; los cambios abren temporada nueva. Alguien de marca pedirá "hacerlo un poco más fácil" en la semana 3: la respuesta es una temporada nueva, no un parche.
- **No uses un acortador de terceros para el QR.** El posavasos es inmutable y va a estar en almacenes durante meses. Y si algún día usas un `301` en el redirector en vez de un `302`, quemas todos los posavasos impresos de forma irreversible.

---

## 8. Glosario

| | |
|---|---|
| **φ** (phi) | Ángulo de vertido del vaso. Lo que se puntúa. `0°` = vertical |
| **ρ** (rho) | Ladeo lateral. Lo que se penaliza |
| **f** | Fracción de llenado, 0 a 1 |
| **σ** (sigma) | Tolerancia de la puntuación. La palanca de dificultad. Empieza en 5° |
| **Traza** | El registro completo de muestras del sensor de una partida. ~2,5 KB comprimida. Es lo que sube al servidor en la fase 2 para revalidar |
| **Tier** | Nivel de degradación del render (burbujas, espuma, DPR, y en último extremo el cambio a Canvas 2D). La simulación nunca cambia de tasa, solo el render |
| **Encaje** (*lacing*) | El rastro que deja la espuma en la pared del vaso. Dos líneas de código y vende el realismo más que ninguna otra cosa |
| **Blanking** | La ventana de 180 ms tras cada toque en la que se congela la calidad, para no castigar el temblor que produce el propio toque |

---

## 9. Contexto que no está en el código

- **Tono de Ambar:** "Pequeños cerveceros". Cercanía, sobremesa, música, festivales, orgullo maño sin cansinismo. Sus ejes actuales: Festivales, Abremesa, Probiótica. Aviso de mayoría de edad en su propia bio de Instagram.
- **Nostalgia 2000** como vector creativo del pitch: el age gate y los menús con estética de web de marca de 2003 (el "cargando 87%", el cursor personalizado) son gratis y marcan el tono desde el segundo cero.
- **El concepto hermano es CHAPAS**, un brick-breaker con físicas donde la bola es una chapa de Ambar y la chapa física con código desbloquea contenido. Si Tiraje funciona, es el siguiente, y comparten la infraestructura de rankings y bares.
- **Entregables legales de Ambar que hay que arrancar en la semana 1, no en la última:** bases de la promoción, contrato de encargo art. 28 RGPD, y la clasificación habilidad-vs-azar del premio. Tardan más en aprobarse que en desarrollarse el backend.
