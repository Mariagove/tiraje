# Segundo juego — Plan

> Nombre provisional: **LA RECETA**. El definitivo es decisión del estudio; en
> este documento y en el código se usa `receta` para no bloquear el arranque.

## Contexto

TIRAJE mide el pulso: es lento, físico y se juega con el cuerpo. El segundo
juego es su contrario deliberado — **velocidad y vista**, todo con el dedo— y
ése es el motivo de que funcionen juntos en la pantalla de inicio: quien se
atasca con el ángulo tiene algo que sí se le da, y quien viene a competir juega
a los dos.

Mecánica pedida por el estudio: aparecen iconos, el jugador toca los que son
**ingredientes de la cerveza** y evita los que no. Los iconos los entrega el
estudio.

**No hereda nada del sensor.** Eso es una ventaja grande y conviene decirla
pronto: sin `requestPermission()`, sin el baile del signo iOS/Android, sin gate
de calibración, sin modo práctica para móviles sin giróscopo. El juego entero es
dedo y pantalla, y por tanto funciona igual en cualquier móvil, en cualquier
webview y en un portátil.

---

## Decisiones de cabecera

| | Elección | Por qué |
|---|---|---|
| Entrada | Táctil pura | Ni permisos ni sensores. Funciona en el webview de Instagram, donde TIRAJE no puede |
| Generación | **Secuencia determinista desde una semilla entera** | El servidor reconstruye la partida exacta con la semilla y la lista de toques. Es un antitrampa mucho más fuerte que el de TIRAJE, y sale gratis |
| Traza | `{ semilla, toques: [tick, x, y] }` | Todo lo demás se deduce. Unos cientos de bytes por partida frente a los ~2,5 KB de TIRAJE |
| Coordenadas | Rejilla entera **0-1000**, no píxeles | Un iPhone y un Android de distinta resolución producen la misma traza, y el servidor puede recalcular los impactos sin saber el tamaño de pantalla |
| Bucle | Timestep fijo **100 Hz**, el mismo de TIRAJE | Mismo código, mismo acumulador, y la partida no depende de los FPS |
| Núcleo | `src/core/receta.ts`, puro y **sin funciones trascendentes** | Misma frontera que el núcleo de TIRAJE, por el mismo motivo: `Math.exp` no es bit-idéntica entre motores |
| Azar | **xorshift de 32 bits** sembrado, nunca `Math.random` | Enteros puros, reproducible bit a bit. El patrón ya está en `tools/trace-lab/synth.ts` |
| Render | **Canvas 2D**, reutilizando el enjambre de burbujas de `glass2d.ts` | Ya está escrito, ya está medido y ya tiene el lenguaje visual de la marca |
| Ranking | **Tabla aparte**, nunca fusionada | Plan §1.7. Dos juegos distintos no comparten escala |
| Puntuación | 0-100, **y el recuento en crudo junto al número** | La lección de TIRAJE, aplicada de entrada: un número sin desglose que lo explique acaba oliendo a injusto aunque sea correcto |

---

## La mecánica, en concreto

**Los ingredientes suben como burbujas** desde el fondo de la pantalla y salen
por arriba. Es el enjambre que ya dibuja el vaso de TIRAJE, con un icono encima
en vez de un círculo, y resuelve de regalo tres cosas: la vida útil de cada
icono (sale por arriba y desaparece), la sensación de cerveza, y que nunca haya
dos iconos quietos tapándose.

```
duración fija           30 s
toque en ingrediente    acierto. Más puntos cuanto antes lo cojas
toque en distractor     −1,5 s de reloj, y el icono desaparece
ingrediente que escapa  no puntúa, no penaliza
```

**Por qué el castigo es tiempo y no puntos.** Restar puntos permite notas
negativas, obliga a explicar un suelo y no desalienta la estrategia degenerada:
tocar todo lo que se mueva. Quitar tiempo sí la desalienta —tocar todo te deja
sin reloj— y además se entiende sin leer nada: el número de arriba baja de
golpe. Es la alternativa que recomiendo; la de puntos está medida y se cambia en
una constante.

**La dificultad sube sola** a lo largo de los 30 s: más iconos por segundo,
suben más rápido y la proporción de distractores pasa de ~20 % a ~50 %. La rampa
va en una tabla horneada, no en una fórmula con exponenciales, por la frontera
de determinismo.

**La nota** se normaliza a 0-100 contra una partida de referencia, y **debajo va
siempre el recuento**: `23 de 28 ingredientes · 2 fallos`. Que nadie tenga que
preguntar qué mide el número.

---

## Tres avisos sobre la lista de iconos

Esto no es mecánica, es criterio, y por eso va aquí y no lo decido yo. Pero
dejarlo sin decir sería peor.

### 1. La Virgen del Pilar como distractor

La propuesta la incluye entre los iconos que **no** hay que tocar, es decir,
entre los que penalizan. Es una imagen religiosa y es la patrona de Zaragoza, en
una activación de cerveza aragonesa que además convive con las fiestas del
Pilar. Un pantallazo de «−1,5 s» sobre la Virgen circula solo y sin contexto.

Mi recomendación es quitarla. Si la idea era que hubiera guiños aragoneses, se
sostiene igual con elementos laicos.

### 2. La gilda no es aragonesa

Es un pintxo vasco, de Donostia. Si los distractores quieren leerse como «cosas
de aquí que no son ingredientes», desentona. Alternativas aragonesas que sí
funcionan y se dibujan bien en 64 px: **ternasco, longaniza de Graus, melocotón
de Calanda, borraja, cardo, trenza de Almudévar, jamón de Teruel**.

### 3. El triángulo de Ambar y la lata, como cosas que no hay que tocar

Entrenar al jugador a **esquivar la marca** durante 30 segundos es justo lo
contrario de lo que paga la activación. Y la lata es el producto terminado.

Si hace falta llenar la lista, los trastos de bar funcionan sin ese problema:
abrebotellas, chapa, posavasos, jarra, grifo, servilletero. Y si se quiere que
la marca aparezca, que sea como **bonificación**, no como trampa.

### Y una cuarta, sobre los cinco ingredientes

Los propuestos son lúpulo, malta, agua, cebada y maíz. Dos apuntes:

- **Malta y cebada son lo mismo** en la práctica: la malta *es* cebada
  germinada y tostada. Como dos respuestas correctas distintas, confunde a quien
  sepa algo de cerveza y no aporta a quien no.
- **Falta la levadura**, que es el cuarto ingrediente clásico junto a agua,
  malta y lúpulo.
- **Si el maíz está o no en la receta de Ambar lo tiene que confirmar el
  cliente.** Presentar en pantalla cinco iconos como «los ingredientes» es una
  afirmación sobre el producto, y las afirmaciones sobre composición en
  publicidad están reguladas. No es una pega de diseño: es el tipo de detalle
  que el cliente corrige en la última reunión y obliga a rehacer arte.

Lista que yo propondría: **agua, malta, lúpulo, levadura** y, si se quiere un
quinto, **cebada** en grano frente a la malta ya tostada, con los dos iconos
claramente distintos.

---

## Arquitectura

```
src/receta/
  spawn.ts      secuencia determinista: qué icono, cuándo, por dónde sube
  loop.ts       bucle de timestep fijo y máquina de estados
  view.ts       pintado en canvas 2D + detección de impacto
src/core/
  receta.ts     puntuación pura, compartida cliente/servidor
  baked/
    receta.ts   rampa de dificultad y curva de nota, horneadas
tools/
  bake-receta.ts
  receta-lab/   generador de partidas sintéticas y fixtures, como trace-lab
src/dev/
  shell.ts      ← se le añade la elección entre los dos juegos
```

**Lo que se reutiliza tal cual:** el gate de edad, la piel blanca/roja y sus
tokens, el `.boton`, la tipografía, el enjambre de burbujas, el patrón de
ranking en `localStorage`, el sello del build y el acumulador de timestep fijo.

**Lo único que hay que tocar de lo existente** es `shell.ts`, que hoy tiene un
botón y pasará a tener una elección. Es el cambio con más riesgo de estropear
algo que ya funciona, así que va con su test.

---

## Antitrampa: aquí es donde este juego gana

En TIRAJE el servidor tiene que recalcular una traza de 1.000 muestras y confiar
en que el cliente no la inventó. Aquí no: **la partida entera se reconstruye
desde la semilla**. El cliente no envía qué aparecía, sólo dónde y cuándo tocó.

```
cliente → { semilla, toques: [[tick, x, y], ...] }
servidor → regenera la secuencia desde la semilla, aplica los toques, saca la nota
```

Una nota inflada exige inventar una lista de toques que, al replicarla contra la
secuencia real, acierte. Es decir: hay que jugar.

Y quedan dos detectores baratos, que en la fase 2 se calibran con partidas
reales y no antes:

- **Los tiempos entre toques.** Una persona no reacciona por debajo de ~150 ms.
- **La dispersión del punto de impacto.** Un dedo humano no acierta dos veces en
  el mismo píxel; un script sí.

En fase 1 la semilla la pone el cliente. En fase 2 **la pone el servidor** al
abrir la partida, con caducidad: si no, se juega la misma semilla hasta
memorizarla.

---

## Qué necesito del estudio

**Los iconos, en SVG.** Esto importa más de lo que parece. El sitio pesa hoy
**50,7 KB comprimido** de un presupuesto de 250 KB, y la foto del vaso en WebGL
todavía no ha gastado su parte. Once iconos en PNG a resolución de retina son
~150 KB y se comen casi todo el margen; los mismos en SVG son 1-3 KB cada uno,
unos 25 KB en total, y además escalan a cualquier pantalla sin pesar más.

Si sólo hay PNG, se puede — se hornean en un único atlas WebP— pero cuesta peso
y pierde nitidez en pantallas grandes.

Requisitos de cada icono:
- **Legible a 64 px** sobre fondo rojo de marca. Es el tamaño real en un móvil.
- **Distinguible por silueta, no por color.** Entre un 5 % y un 8 % de los
  hombres no separa rojo de verde, y aquí la diferencia entre acertar y fallar
  no puede depender del tono.
- Un solo trazo o un solo relleno, sin degradados ni sombras: se va a dibujar en
  movimiento y sobre un fondo que cambia.
- Transparente de verdad, sin fondo blanco. (El logotipo que mandaste traía
  fondo blanco y hubo que deshacer la composición para recuperar el alfa.)

---

## Lo que falta decidir, y es del estudio

1. **El nombre.** «LA RECETA» es provisional.
2. **La lista final de iconos**, con los tres avisos de arriba resueltos.
3. **Duración.** Propongo 30 s: suficiente para que la rampa se note, corto para
   que se juegue de pie en un bar y se repita.
4. **Castigo por distractor:** tiempo (mi recomendación) o puntos.
5. **La pantalla de inicio con dos juegos.** Hoy es un solo botón que además
   hace de gate de edad. Con dos juegos hay que decidir si la edad se confirma
   antes de elegir o dentro de cada uno.
6. **Si los ingredientes son los de Ambar**, confirmado por el cliente.

---

## Calendario

| | Duración | Contenido |
|---|---|---|
| Núcleo y bucle | 3-4 días | `spawn.ts`, `receta.ts`, horneado, fixtures y tests. Sin arte: se juega con círculos de colores |
| Arte y render | 2-3 días | Iconos reales, enjambre, impactos, rampa afinada |
| Pantalla de elección | 1 día | `shell.ts`, con su test |
| Calibración | 2 días | Partidas sintéticas, y **probar con personas antes de fijar la nota** |
| **Total** | **~2 semanas** | |

Va deliberadamente en este orden: **el núcleo primero y jugable con círculos**,
porque permite afinar la mecánica sin esperar a los iconos y sin tirar arte si
la rampa resulta estar mal.

---

## Riesgos

| Riesgo | Mitigación |
|---|---|
| **Fijar la nota antes de ver jugar a gente.** Es exactamente lo que pasó en TIRAJE: σ y la curva se eligieron por elegantes y hubo que recalibrar dos veces | La calibración va al final del calendario, con personas delante, y los números viven en un JSON como las variedades |
| Los iconos no se distinguen en movimiento a 64 px | Se prueban en movimiento, en un móvil, antes de dibujar los once |
| El peso se dispara con PNG | Pedir SVG. Si no hay, atlas WebP y medir antes de integrar |
| Tocar dos iconos superpuestos | La detección de impacto resuelve al **más cercano al centro del dedo**, no al primero de la lista, y se fija en un test |
| Romper TIRAJE al tocar `shell.ts` | Test de la pantalla de elección, y el sello del build para que las pruebas no se hagan contra la versión vieja |
| Que un juego de velocidad excluya a quien no tiene buenos reflejos | Es el contrario de TIRAJE a propósito: quien no puede con uno, juega al otro. Rankings separados precisamente por esto |

---

## Verificación

- La misma semilla produce la misma secuencia, en dos motores distintos.
- Una traza grabada se vuelve a puntuar al entero exacto (el test de fixtures de
  TIRAJE, calcado).
- Ninguna función trascendente en `src/core/` (el grep que ya existe).
- Tocar todos los iconos sin mirar da una nota **mala**, medida, no supuesta.
- No jugar da 0 y no rompe nada.
- El peso total sigue por debajo de 250 KB comprimido, con los iconos dentro.
