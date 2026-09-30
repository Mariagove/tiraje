# Lo que falta y no lo decide el código

Lista viva. Cada punto bloquea algo concreto; digo el qué.

## Resuelto por el plan (ya no bloquea)

- **Geometría del vaso.** `H = 140 mm, R = 32 mm` → `H/R = 4,375`, que reproduce
  las tres cifras de derrame del plan §1.3 **exactas** (77,12° / 41,19° / 23,63°).
- **La gaussiana.** El plan cita `GAUSS[0..2] = 1,00 / 0,96 / 0,85` y
  `GAUSS[9] = 0,04` con σ = 5. Eso **no** es `exp(−e²/2σ²)` (daría 0,198 en el 9),
  es `exp(−(e/σ)²)`. Verificado contra los cuatro valores citados.
- **La curva objetivo.** Derrame con margen, `kSafe = 0,55`, tope 48°.

## Decisiones mías que hay que revisar

Están en `varieties/*.json`, marcadas aquí porque no salen del plan:

| Parámetro | Valor | De dónde sale |
|---|---|---|
| `foamExpansion` | 2,0 | **Mío.** Cuánto volumen ocupa la espuma frente a la cerveza de la que sale |
| `foamRatePerSec` | 0,0186 / 0,0230 | **Mío.** Elegido para que la partida perfecta caiga en ~170.000 |
| `spillRatePerSec` | 0,06 | **Mío.** Velocidad de pérdida mientras derrama |
| `targets.fill` / `.foam` | 0,95 / 0,20 (0,25 negra) | **Mío.** Dos dedos de corona |
| tolerancias de bono | 5 / 6 pp | **Mío.** Escala de las gaussianas de los bonos |
| forma de `limpieza` | `meanρ / (1 + derrames)` | **Mío.** El plan da el coeficiente 1000, no la forma |
| geometría de la Negra | H=150, R=38 | **Placeholder.** Falta el vaso real |

El plan fija el máximo teórico en «≈171.500»; con estos números sale
**169.973** (Especial) y **169.996** (Negra). Dentro de la banda del fixture
[160.000, 180.000] y equilibradas entre sí al 0,1%.

## Calibración: medido, no supuesto

Con σ = 5° y los coeficientes del plan, un jugador con error medio constante
puntúa así (`node tools/trace-lab/cli.ts --synth <perfil>`):

| Objetivo del plan §1.3 | Puntuación | Error medio que le corresponde hoy |
|---|---|---|
| primera partida | 52.000 | **9,2°** |
| buen jugador | 126.000 | **2,9°** |
| umbral de 1 en 2.000 | 165.000 | **1,0°** |

Los tres son plausibles, así que σ = 5 no necesita tocarse de momento. Se
calibra con el piloto y 500 trazas reales, no antes.

## Verificado en navegador (21 sept 2026)

Prototipo jugado de punta a punta en el navegador integrado, en modo práctica
(sin sensor). **Cero errores de consola.** Dibujo a 0,1-0,3 ms por frame, tier 0.

Comprobado: el gate de un toque con el age gate fusionado y recordado en
`localStorage`; `?v=negra` selecciona variedad y el vaso se ve más ancho; el
HUD de 3 decimales se desvanece al abrir el grifo y no vuelve; la superficie
se mantiene horizontal en el mundo con el vaso inclinado; la línea de
referencia aparece como un hueco cuyo grosor es el error; el bisel se apaga al
salir de tolerancia; **enderezarse pronto llena el vaso de espuma** (18,3% de
corona con calidad 0,000); iniciales estilo recreativa, ranking de práctica
separado y persistente; OTRA CAÑA sin recarga; autocierre a los 15 s.

**Dos bugs reales encontrados así, que ningún test tenía:**

1. **Cuña de cerveza con el vaso vacío.** El nivel se calculaba rotando el
   punto del eje a la altura del llenado. Eso es exacto mientras la superficie
   corta las dos paredes —el área de debajo es un trapecio de `2·hw·(hh − y)`,
   la misma que sin inclinar— pero en cuanto la recta sale por la base, lo que
   pasa por debajo de `f = hw·tan(φ)/(2·hh)` (el 25% del vaso a 48°), dibuja
   líquido que no existe: un 6% de vaso con `f = 0`. Y ese tramo es justo el
   principio de la tirada. Resuelto por bisección sobre el área del polígono
   recortado, con test.
2. **`f` crecía sin límite.** Con el grifo abierto hasta el autocierre, el
   resultado llegaba a decir «120% lleno». Un vaso lleno rebosa. Con tope, y
   el rebose cuenta como un derrame, una vez y no una por paso. Ninguno de los
   diez fixtures cambia: ningún perfil sintético rebosaba.

**Lo que sigue sin verificar:**

- **El sensor real.** Todo lo de arriba es en modo práctica. La sonda de
  signos, la frecuencia de muestreo y el filtro complementario sólo se prueban
  en un iPhone viejo, un Android barato y un webview de Instagram.
- **La degradación de tiers.** Los 8 tests unitarios la cubren, pero en 2D el
  dibujo cuesta 0,1 ms y nunca se dispara de verdad. Se verifica cuando exista
  `glassGL.ts`.
- **El grabador de trazas no cae al dedo**, a propósito: una traza de
  arrastres de dedo no sirve para calibrar σ. Necesita sensor.

## Primera traza real (iPhone, 21 sept 2026)

`tools/trace-lab/fixtures/real-iphone-1.json` — iOS 18.7, Safari 26.6.1,
sensor a 60 Hz, DPR 3, 20,18 s, 2.018 muestras.

**La sonda de signos funciona en hardware real, y con margen enorme:**

```
accel: +1   how: measured   errWin 0,90°  vs  errLose 179,10°   (n=34)
gyro:  -1
```

Dos cosas que esto zanja. El acelerómetro de iOS sale `+1`, que es lo que
predecía la implementación. Y el giróscopo sale **`-1`**: el `rotationRate` de
este iPhone es el negado de la convención dextrógira. Eso no se podía suponer
—se mide— y confirma que el bug de signo en la correlación, corregido al
reescribir la fusión sobre el vector, era real.

**El temblor fisiológico existe y es medible.** Espectro de φ por bandas:

| banda | potencia |
|---|---|
| 0,2-2 Hz (intención) | 96,23% |
| 2-5 Hz (corrección) | 2,10% |
| 5-8 Hz | 0,91% |
| **8-12 Hz (temblor)** | **0,29%** — RMS **0,057°** |
| 12-20 Hz | 0,19% |
| 20-50 Hz (ruido) | 0,29% |

Tres avisos para el antifraude de la fase 2:

1. **0,057° RMS está por debajo del paso de cuantización de 0,1°.** El ruido de
   cuantización aporta 0,029° RMS repartido en toda la banda, unos 0,008° en
   8-12 Hz, así que la señal sobrevive con relación 7:1 — pero no sobra.
   Bajar la resolución de la traza mataría la señal más discriminante que
   tiene el plan.
2. **La traza de partida NO puede llevar la prueba de jitter de muestreo.** El
   plan fija `σ(dt) < 0,4 ms = sintético seguro`, pero la traza se remuestrea
   a 100 Hz exactos por construcción: `σ(dt) = 0`. Esa prueba necesita los
   timestamps crudos del sensor, que la traza de partida no guarda. Hay que
   decidir si se sube también un resumen del muestreo crudo.
3. La interpolación de 60 → 100 Hz atenúa algo a 9,5 Hz, así que el temblor
   real es algo mayor que el medido.

## Bug de reloj encontrado en el iPhone

La vista de juego daba un ángulo que no se correspondía con nada y que parecía
tardar segundos en actualizarse; la de traza iba perfecta. Las dos leen el
mismo φ.

`GameLoop.start()` cebaba `#simT = performance.now()`, pero la vista conduce
`advance()` desde su propio rAF y nunca llamaba a `start()`. Así que el reloj
de simulación arrancaba en **0** mientras la capa de sensores sella con
`performance.now()`. `sampleAt` devolvía entonces la muestra más antigua del
anillo, con un desfase constante igual al tiempo que la página llevara abierta.

Cebado ahora en `advance()`, que es el único sitio por el que se pasa siempre.
**Y el hueco de test que lo permitió:** el doble de `AngleSource` ignoraba el
parámetro `t` y devolvía siempre el ángulo actual. Un doble que ignora el
parámetro que el código de verdad usa no prueba ese código. Corregido, con dos
tests de rampa temporal.

## Cambio de eje de medida (decisión del estudio, 21 sept 2026)

**Se aparta del plan §1.1.** El plan medía `φ = atan2(u.z, u.y)`: la rotación
sobre el eje x del móvil, el gesto de servir. Ahora se mide

```
φ = atan2(u.x, u.y)   ← giro EN el plano de la pantalla
ρ = asin(u.z)         ← inclinación FUERA del plano, lo que se penaliza
```

El motivo es de control: con la pantalla entera haciendo de vaso, el giro en
el plano es el único eje gobernable. Y trae dos consecuencias buenas:

1. **El dibujo pasa a ser exacto.** La superficie se pinta a −φ; con φ medido
   en el plano, eso es la proyección literal de la superficie horizontal sobre
   el cristal, no una convención. Lo que ves inclinarse está inclinado.
2. **φ sigue siendo independiente de ρ** mientras `cos(ρ) > 0`: apoyar el
   móvil hacia atrás para verlo mejor no mueve el ángulo puntuado.

Y una que hay que vigilar:

3. **La singularidad se mueve al móvil plano** (ρ = ±90°), donde la proyección
   de «arriba» sobre la pantalla se anula. Sigue fuera de la zona de juego —se
   juega mirando la pantalla— y sigue lejos del `beta = ±90°` que el plan
   quería evitar. `Fusion.planarConfidence` (= cos ρ) lo mide y se muestra en
   las dos vistas de depuración.

**La sonda de signos hubo que rehacerla.** Su referencia era `φ = 90 − beta`,
propia de la descomposición vieja. Ahora compara la componente `u.y` contra
`asin(beta)`, que es el mejor condicionado de los tres ángulos de Euler: no
arrastra magnetómetro como `alpha` ni se queda sin sentido cerca del gimbal
lock como `gamma`. Beneficio colateral: la sonda ya **no depende de cómo se
defina φ**, así que sobrevive a otro cambio de eje.

El canal del giróscopo también cambia, de `rotationRate.beta` a `.alpha`, y
con él el signo de la correlación: con φ en el plano, `φ̇ = +ω_z`, así que un
giróscopo conforme correlaciona **positivamente** (antes, negativamente). La
sonda lo mide, así que el iPhone que dio `gyro: -1` seguirá resolviéndose
bien — pero hay que **volver a medirlo en el móvil**, porque el número de la
traza guardada es del canal antiguo.

## La pantalla es el vaso (petición del estudio)

El renderer ya no dibuja un vaso que rota dentro de una pantalla fija: la
pantalla **es** el vaso y lo que rota es la superficie, a **−φ**.

Con el eje de medida ya en el plano de la pantalla (ver arriba), ese −φ es la
proyección literal y no hay nada que justificar.

Consecuencia: **la silueta ya no distingue las variedades.** Antes la Negra se
veía más ancha. Ahora se distinguen por el color del líquido, que es lo que el
§1.5 dice que lleva el JSON (`look.beer` / `look.foam`). Placeholder.

## Bug de espejo en la inclinación del líquido (visto en iPhone)

El líquido entraba por la esquina inferior equivocada: inclinando el móvil a
la izquierda se llenaba la derecha.

La gravedad en coordenadas de pantalla vale `(−sin φ, cos φ)`, así que con φ
positivo —móvil girado hacia la izquierda en el plano de su pantalla— el
líquido debe caer hacia abajo-izquierda. El renderer dibujaba la superficie a
**−φ** y calculaba su punto de paso también invertido, de modo que **los dos
errores se cancelaban para la recta** —el ángulo de la superficie parecía
plausible y la fracción de llenado salía exacta— pero dejaban el líquido en la
esquina espejada. Por eso no lo cazó ninguna de las comprobaciones de área.

Arreglado con cinco cambios de signo coherentes entre sí, y fijado con dos
funciones puras (`gravityOnScreen`, `surfaceTilt`) y cinco tests. El que
importa es la invariante de la que cuelga todo el dibujo del líquido:

> al rotar el lienzo por `surfaceTilt(φ)`, su eje **+y local ES la gravedad**

El renderer rellena el +y local desde la superficie hacia abajo, así que si
ese eje no coincide con la gravedad, el líquido sale por el lado que no es.

## La línea de referencia tiene lado (visto en iPhone)

Con φ negativo el líquido caía bien pero la raya discontinua salía espejada.

Causa: la puntuación trabaja con **|φ|** —servir inclinando a izquierda o a
derecha vale lo mismo— así que el objetivo horneado es una magnitud sin signo.
Pero la línea de referencia SÍ tiene lado, y dibujarla siempre en positivo la
dejaba al otro lado del líquido en cuanto se servía hacia la derecha.

Arreglado con `pourSide` en el frame del renderer, con **histéresis de 8°**:
por debajo de ese ángulo se conserva el último lado, para que cruzar el cero
no le dé un latigazo a la línea. La puntuación sigue siendo indiferente al
lado; sólo el dibujo lo usa.

## El toque nunca espera al gate de reposo

El gate de calidad del §1.1 (1,2 s de quietud) bloqueaba el primer toque: el
jugador tocaba, no pasaba nada, y se percibe como que el juego está roto.

Ahora el gate es una **mejora oportunista, no una barrera**. Si el jugador
toca, se abre el grifo con lo que haya y el roll se calibra con el valor
instantáneo, igual de acotado a ±10°. Si espera, la calibración sale de un
móvil quieto. Nunca se le hace esperar.

Efecto colateral que salió al probarlo: el HUD del ángulo no se desvanecía al
abrir desde `CALIBRATE`, porque el handler miraba la transición concreta
(`READY → POUR_BEER`) en vez del estado de destino. Corregido.

**Ojo con verificar esto en escritorio:** el control de dedo reporta
`‖a‖ = 9,81` y `‖ω‖ = 0` siempre, así que el gate pasa igual y la prueba
visual no lo ejercita. Quien lo comprueba es el test unitario, que fuerza
`omegaMag = 60`.

## Oleaje, burbujas y chorro (petición del estudio)

Tres cosas de oficio visual, todas en `render/glass2d.ts`, y las tres suman
**0,0 ms** medidos: el dibujo sigue en 0,2 ms de media.

**Oleaje.** La superficie era una recta. Ahora son dos senos de longitudes de
onda distintas que se baten (0,62·λ y 0,27·λ del ancho, a 2,1 y 3,6 Hz). La
amplitud sale del chapoteo —que sí es físico, los dos osciladores
amortiguados— más un fondo mientras entra el chorro, que agita.

Detalle que importa: **las ondas son simétricas respecto a la línea media, así
que el área bajo la superficie no cambia** y el nivel resuelto por área sigue
siendo exacto. El oleaje es cosmético y no miente sobre el llenado.

Y la fase de la onda se mide sobre el eje de la superficie **desde el centro
de la pantalla**, no desde el origen de cada banda: si no, la cresta del borde
inferior de la espuma y la del borde superior de la cerveza —que son la misma
frontera— no coincidirían.

**Burbujas.** Tres cosas a la vez, gobernadas por una `actividad` 0..1 con
ataque rápido y caída lenta (~1,5 s): la cantidad (40 → 0), el tamaño base
(×1 → ×0,55) y, encima de eso, **crecen al subir** (×1 en el fondo, ×2,1 al
llegar a la superficie), porque cae la presión y coalescen. Las gordas suben
más rápido. Al cerrar el grifo el vaso se calma en vez de cortarse de golpe.

**Chorro.** Entra por el borde SUPERIOR de la pantalla, que es la boca del
vaso, en un punto **fijo** en el centro: el jugador sostiene el vaso bajo el
grifo y lo deja quieto, así que lo único que cambia con la inclinación es por
dónde cae, no por dónde entra. Grosor 28 px CSS.

Dos intentos fallidos antes de llegar aquí, y el segundo lo cazó el estudio en
el iPhone:

1. Trazarlo hacia delante desde la parte baja del borde —lo físico, es donde
   se apunta el grifo para no derramar— da un recorrido cortísimo con el vaso
   a 48°: **se salía por el lateral antes de tocar el líquido** y se veía un
   muñón en la esquina.
2. Elegir primero el punto de impacto y trazar hacia atrás lo hacía visible,
   pero entonces **entraba por el lateral de la pantalla, o sea atravesando el
   cristal del vaso**.

La solución es lo que pasa de verdad: cae desde la boca según la gravedad
hasta lo primero que encuentra —la superficie del líquido o la pared— y si da
en la pared, **baja por ella** hasta la cerveza. Es la técnica real de servir
con el vaso inclinado, y además es lo que conecta visualmente el chorro con el
líquido. El reguero de pared se mete hacia dentro medio grosor, porque
centrado en el borde se pierde media anchura fuera de pantalla y se lee como
una raya oscura en vez de como cerveza.

**El chorro es una cinta rellena, no un trazo.** Así el grosor puede variar a
lo largo del recorrido —se estrecha al acelerar y se estrangula, que es la
inestabilidad de Rayleigh-Plateau y es lo que hace que se lea como líquido y
no como un palo— y admite ondulación.

La envolvente de la ondulación es `sin(π·s)`: **cero en los dos extremos**.
Ondula por el medio pero no se mueve ni de la boca del vaso ni del punto de
impacto, que tienen que estar fijos.

El volumen se consigue con **tres cintas concéntricas sobre la misma
ondulación** —cuerpo, borde oscuro desplazado, brillo desplazado— y no con un
degradado transversal. El degradado se calcula sobre la cuerda recta, así que
con el chorro ondulando el brillo se quedaba clavado en una línea, se salía de
la cinta por trozos, y el conjunto se leía como un palo con una raya pintada.

La salpicadura es una fuente balística **sin estado**: 26 gotas recorriendo un
ciclo de vida desfasado, con velocidad inicial contra la gravedad del MUNDO
—no hacia arriba en pantalla— y caída parabólica. Al no guardar estado no hay
nada que reiniciar entre partidas. Más un montículo de espuma de tres lóbulos
donde entra el chorro, porque ahí es donde se bate el aire. Siempre color
espuma, y en fase de espuma el chorro entero cambia de color (`pouringFoam`).

## Espuma por fuera del vaso al desbordar

Lo que lo hace posible es el modelo mental: **la pantalla es la cara frontal
del cristal** y la cerveza se ve a través de él. Así que lo que está por fuera
va dibujado ENCIMA de todo, bisel incluido. No hay que inventar un exterior:
es la misma superficie, en otra capa.

### Lo decide la geometría, no la señal del núcleo

La primera versión dibujaba a partir de `spillingOver` suavizada, y producía
dos mentiras que el estudio cazó en el móvil:

- espuma asomando por el borde **con el vaso derecho y el líquido lejos del
  borde**, porque la señal seguía encendida;
- espuma **pegada al canto** segundos después de enderezar, porque el reguero
  era una banda estática anclada al borde.

Ahora se calcula la profundidad de cada punto del labio por debajo de la
superficie. Si ninguno está sumergido, **no sale nada**. Reparto: sobre un
vertedero el caudal por unidad de ancho va con la **profundidad^1,5**, así que
el labio más bajo se lleva el grueso y el resto aporta cada vez menos hasta
donde la superficie corta el borde, donde es cero. Eso hace que rebose también
por el centro, en menor medida, como pedía la física.

### Y lo que ya salió: de hilo a lámina según el caudal

Corregido dos veces con referencias del estudio, una foto y un vídeo. Yo había
apostado primero por regueros finos y luego por pegotes redondos sueltos; las
dos cosas estaban mal. Y **las dos referencias son ciertas: la diferencia es
el caudal.**

| | Poco caudal (la foto) | Mucho caudal (el vídeo) |
|---|---|---|
| Forma | hilo | **lámina** |
| Ancho | ~20% del vaso | **40-60%** |
| Punta | **bulbo** redondeado | sin cabeza, se va por abajo |
| Borde | curvo | casi **recto** |
| Velocidad | repta y se para | recubre el vaso en ~1 s |

Es la transición de rivulete a lámina: con poco flujo manda la tensión
superficial y el líquido se recoge en un hilo con cabeza capilar; con mucho
manda la inercia y se extiende. El parámetro `sheet` de la lengua interpola
entre las dos, y el ancho y la velocidad escalan con él.

En las dos es **casi blanca** (el 14% de tinte que le había puesto era
demasiado; está en el 5%) y **opaca**.

Dos avisos para quien mire las mismas referencias:

- En la foto, el segundo bulto que asoma al otro lado del labio **es el
  reflejo del cristal, no espuma**. Lo aclaró el estudio.
- En el vídeo **el vaso está prácticamente vertical**, así que la lámina baja
  por la cara visible y se ve entera. En el juego, a 48°, baja pegada al canto
  y se ve menos ancha. Es geometría, no un fallo: al enderezar el vaso al
  final de la tirada se parece más al vídeo.

El ancho **se recalcula mientras la alimenten**, no se congela al nacer. La
lengua nace en cuanto asoma el primer hilo, con el caudal aún bajo; si el
radio quedara fijo, se vería fina para siempre por mucho que después estuviera
rebosando a chorro.

Y si hay caudal pero no hay lengua, nace **sin azar**. El 3% por frame que
tenía dejaba huecos de segundos con el caudal al máximo y nada en pantalla.
Eso se vio con el panel de depuración, que ahora muestra
`caudal · ancho de lengua en px y en % del vaso · lámina`: el ancho se venía
estimando a ojo desde capturas y así no se puede calibrar.

Implementación: es la única parte del renderer con estado. Una lengua guarda
su recorrido depositado sobre el cristal, y la punta avanza según la gravedad
**del instante**. Eso da gratis dos cosas correctas: lo ya depositado se queda
pegado donde estaba, y si el jugador endereza el móvil a media caída, **la
lengua se dobla ahí**. Se dibuja como una cadena de círculos en un solo path,
así la unión sale sin costuras y el bulbo es sólo un radio mayor.

Nace en el punto más INTERIOR de la franja del labio con caudal alto, no en el
máximo exacto: ése es la esquina, y una lengua que nace en la esquina se va
medio fuera de pantalla en cuanto la gravedad la empuja. El rebose ocurre
sobre un tramo del labio, no sobre un punto, así que es igual de cierto.

Lleva **sombra**: sin ella se fundía con la corona del propio vaso —las dos
blancas, una justo detrás de la otra— y quedaba una mancha sin profundidad.

### El bug que hacía que no deslizase y saliera cortada

Un error de una línea con dos síntomas. El recorrido se depositaba comparando
la distancia recorrida por la punta **consigo misma**, o sea lo que avanza en
un frame: unos 0,87 px, que nunca llega al umbral de 5. No se depositaba ni un
punto, el recorrido se quedaba en dos —el ancla del labio, que no se mueve
nunca, y la punta— y se dibujaban dos círculos sueltos. De ahí que pareciera a
la vez que la espuma se quedaba pegada al borde y que salía cortada.

La comparación correcta es contra el último punto **ya depositado**.

### Lo que sale por el borde se pierde, y sale de arriba

También corregido. `loseOverRim` baja llenado y corona a la vez, con la espuma
primero: lo que pasa por encima del borde es lo de arriba.

Antes el rebose dejaba `f` clavado en 1 sin tocar la espuma —se veía salir
espuma sin fin con el vaso igual de lleno— y el derrame por inclinación bajaba
el nivel pero dejaba la corona intacta, que es justo al revés. De los diez
fixtures sólo se movió `negra-spiller`, −160 puntos, que es la consecuencia
esperada.

### El caudal de derrame es de vertedero, no constante

Estaba anotado como hallazgo sin resolver y el estudio lo reportó dos veces,
así que se ha hecho: con caudal **constante** (0,06/s) la entrada (~0,12 de
vaso por segundo) superaba a la salida, de modo que por mucho que te pasaras
de inclinación el vaso seguía llenándose y el nivel no bajaba nunca.

Ahora crece con **`exceso^1,5`** —el caudal por unidad de ancho de un
vertedero va con la potencia 3/2 de lo sumergido que está el labio— y
`spillRatePerSec` (0,015) pasa a significar *fracción de vaso por segundo a 1°
por encima del límite*. Con tope de 2,5/s, para que no se vacíe en un frame.
`exceso^1,5` se calcula como `e·√e`: ni una trascendente, que en `core/` están
prohibidas.

Medido, sosteniendo el ángulo 7 s con el grifo abierto:

| ángulo | llenado final | derramado |
|---|---|---|
| 48° | 76,6% | 0,5% |
| 55° | 71,4% | 5,7% |
| 62° | 63,0% | 14,1% |
| 75° | 32,7% | 44,5% |

Y el nivel **baja de verdad**: llegando al 80% y pasándose a 75°, cae al 63,7%
en 100 ms. Sólo se movieron los dos fixtures de derrame.

**Efecto secundario en el veredicto:** al ser el derrame continuo, ahora es UN
episodio largo en vez de tres cortos, así que la regla de `spillMaxEvents ≥ 3`
casi no dispara y lo que declara la caña derramada es la fracción perdida. Es
lo que importa, pero conviene saberlo si algún día se toca el umbral.

### La lengua va del labio a la base, y se consume desde el labio

Se veía como si la espuma **volviera a subir** en lugar de acabar de caer.
Eran dos ciclos de nacimiento y muerte, uno detrás de otro:

1. La lengua se mataba al llegar abajo y, con una sola permitida, nacía otra
   en el labio **al instante**. Eso es literalmente un salto a lo alto.
2. Corregido lo anterior, quedaba una franja de intensidad en la que **sí se
   dibujaba y sí podía nacer una lengua, pero no se alimentaba**: se consumía,
   moría, y nacía otra. El mismo salto por otra puerta.

Ahora **un solo umbral** (`SPILL_ON`) decide las tres cosas: si se dibuja la
cortina, si puede nacer una lengua y si la lengua se alimenta. Una lengua
alimentada **no se mata nunca**: llega del labio a la base y ahí se queda, que
es lo que hace un rebose continuo.

Y al dejar de alimentarse **se consume desde el labio hacia abajo**, al mismo
ritmo al que resbala: el índice `from` avanza, así que el tramo visible migra
hacia la base y se acaba. No se esfuma entero de golpe.

### Consecuencia del caudal de vertedero que conviene evaluar

Con el derrame ahora tan sensible al ángulo, **sostener 48° ya no llega a
rebosar**: el vaso se autolimita en el 76% de llenado. Para que rebose de
verdad hay que estar casi vertical, que es cuando el límite de derrame es
alto y el vaso sí se llena hasta el borde.

Tiene sentido físico y refuerza la premisa del juego —hay que enderezar— pero
cambia bastante cuándo se ve el rebose. Si se quiere que aparezca más a
menudo, la palanca es `spillRatePerSec` (0,015) o el exponente.

### La costura entre la cortina y la lengua

Aparecía una línea oscura entre la lengua y el borde del rebose. En un líquido
no hay cortes: son la misma masa.

Dos causas, una detrás de otra:

1. Se dibujaban como **dos rellenos con dos sombras**, y la sombra de la
   lengua caía sobre la cortina justo donde se tocan. Ahora van en un único
   trazado, un relleno.
2. Aun fundidos, **la sombra del conjunto caía sobre la corona del propio
   vaso**, que está justo detrás y también es blanca, y volvía a dibujar un
   corte. La sombra estaba ahí para decir "esto está delante del cristal";
   ahora eso lo dice el **tinte** (11% de cerveza sobre el blanco), que por
   fuera queda más cálido que el blanco de dentro.

Requisito que hay que respetar si se toca: los arcos de la lengua y el
polígono de la cortina se trazan con el **mismo sentido de giro** (horario en
pantalla), para que la regla nonzero los una en vez de restarlos. Invertir el
orden de los puntos de la cortina abriría agujeros donde se solapan.

### Las referencias son una escala lateral, no líneas que cruzan

Eran dos líneas discontinuas de lado a lado del vaso —el llenado objetivo y el
ángulo objetivo— y confundían. Sobre todo la de arriba: **se leía como el
borde del vaso** en vez de como el nivel objetivo de cerveza. Cruzando el
líquido, una raya parece una frontera del recipiente.

Ahora es una **graduación a un solo lado**, como la de una probeta:

- marcas menores cada 10% de llenado, grabadas y discretas;
- marca mayor en el llenado objetivo, como la línea de medida de un vaso real;
- y un **marcador vivo** en la altura a la que debería cortar la superficie esa
  pared si el ángulo fuera el correcto. El hueco entre el marcador y donde la
  corta de verdad sigue siendo el error, sólo que ahora se lee en una pared en
  vez de cruzando el vaso.

Va en el lado **contrario al que se sirve**, para no comerse con la espuma que
rebosa, que siempre cae por el lado hacia el que tira la gravedad.

Y va con **halo oscuro debajo y trazo claro encima**, como la marca mayor. Con
un solo trazo translúcido se leía sobre el fondo negro pero desaparecía en
cuanto le pasaba la cerveza por detrás. Está impresa en el cristal: tiene que
verse sobre lo que sea.

### Parpadeo del rebose

Todo el dibujo del rebose colgaba del booleano `maxD > 0`, sin suavizar. Como
el derrame se autolimita —derrama, baja el nivel, para, se vuelve a llenar— el
booleano cruza el cero varias veces por segundo y la cortina parpadeaba con
él, y la lengua se moría y renacía.

La **geometría sigue mandando** en si hay rebose, pero se suaviza la
INTENSIDAD: subida rápida, bajada de ~0,3 s. Lo justo para tapar el parpadeo
sin que vuelva la espuma colgada del borde que se corrigió antes. El perfil
del labio se guarda mientras hay rebose y se reutiliza mientras se desvanece,
porque si no la cortina se quedaría sin forma al dejar de estar sumergido el
labio y volvería el parpadeo por otra vía.

### La lengua tardaba demasiado en irse

Al enderezar el móvil la espuma seguía pegada al cristal **1,47 s** medidos, y
en partida real bastante más, porque la lengua se consumía a la velocidad a la
que resbalaba: unos 6 puntos de recorrido por segundo sobre un trazado de
cien. Tres cosas la frenaban, y las tres estaban:

1. La intensidad del rebose bajaba a 0,06 por frame, casi **0,7 s** sólo en
   apagarse, y hasta que no se apagaba la lengua ni empezaba a secarse. Ahora
   baja a 0,12, ~0,3 s, que sigue siendo de sobra para tapar el parpadeo del
   derrame autolimitado.
2. Sin alimento, la punta seguía depositando recorrido nuevo: la lengua crecía
   por abajo mientras se consumía por arriba. Ahora, en cuanto deja de
   alimentarse, deja de alargarse; la punta sigue moviéndose, pero estirando
   el último tramo.
3. El consumo era a velocidad fija. Ahora va **en proporción a lo que queda**,
   con τ = 0,12 s, así que tarda lo mismo sea larga o corta. Además la punta
   se descuelga —acelera, porque ya no la sujeta el labio— y el trazo adelgaza
   hasta la mitad conforme se seca.

Medido con el banco nuevo: **0,67 s** desde que se endereza hasta que no queda
ni un círculo en pantalla.

### Rebosaba por un lado y al ladear al contrario ya no rebosaba

Bug de verdad, y viejo: el comentario del código decía que la lengua se
alimenta «del caudal del labio en su propia posición, no en general», y lo que
hacía era `t.fed = over` — el rebose **del vaso entero**.

Así que al inclinar al otro lado la lengua vieja se seguía dando por
alimentada, y una lengua alimentada no se consume nunca: ocupaba la única
plaza que hay y por el labio nuevo no salía nada.

Dos arreglos, los dos necesarios:

- El alimento se mira **en el ancla**, interpolando el perfil de vertedero en
  esa x. Como el perfil se renormaliza cada frame al labio más hundido, al
  mudarse el derrame de lado el valor en el ancla cae a cero solo.
- El tope de una sola lengua cuenta sólo las **alimentadas**. Las que ya se
  están secando siguen escurriendo por su lado mientras nace otra por donde
  ahora rebosa, que es lo que hace un vaso de verdad. Tope duro de 3 en el
  array para que ladear de un lado a otro no acumule.

Medido: la lengua nueva asoma por el labio nuevo en **menos de 1 s**.

Los dos fallos tienen banco propio, `src/render/tongue.test.ts`, con un
contexto 2D falso que apunta los `arc` y mide cuántos círculos de lengua hay y
dónde. Los dos tests fallan contra el código anterior.

## Bug del enganche de rebose

`overflowing` se quedaba pegado a `true` para siempre, así que el vaso seguía
rebosando en pantalla después de cerrar el grifo y de acabar la partida.

La causa, en una palabra: `else if (st.f < 1)`. Tras recortar el llenado, `f`
queda **exactamente** en 1, así que no se cumplía ninguna de las dos ramas y
el flag no se limpiaba nunca. Con un `else` a secas, al cerrar el grifo ya no
entra nada, `f` se queda en 1, y la rama else lo apaga. Con test.

## La puntuación se congela en el tercer toque

Decisión del estudio, y es mejor diseño que lo que había: **la puntuación es
la que hay al cerrar el grifo**, no la del final del reposo. La física de
después no puede cambiar lo que ya hiciste.

Eso desbloquea lo que antes era un conflicto. Ahora un vaso que ha rebosado
**se asienta y pierde nivel** tras cerrar —la corona que sobresalía del borde
se va, que es lo que pasa de verdad— y se ve en pantalla sin tocar el
marcador. Antes no se podía añadir porque habría cambiado el bono de llenado.

Implementación: `step()` congela el resultado en el primer paso con la fase ya
cerrada —nada se ha añadido desde el toque, así que ese estado ES el del
cierre— y `finalize()` devuelve el congelado si existe. El servidor de la fase
2 reproduce lo mismo recorriendo la traza entera, asentamiento incluido, y hay
test que lo comprueba. Los diez fixtures no se mueven.

Parámetros nuevos en el JSON de cada variedad, y son conjetura mía:
`settle.drainRatePerSec` (0,055 Especial / 0,040 Negra) y
`settle.overflowSettleFrac` (0,09, o sea el nivel baja 9 puntos de vaso). Lo
que se va es espuma, no cerveza, y hay test que lo fija.

## Bordes de líquido suavizados

Todas las fronteras de líquido se trazaban con `lineTo` entre muestras, y se
veían angulosas — la espuma que rebosa quedaba con los bordes a picos.

Ahora pasan por `smoothTo`, que usa los puntos dados como puntos de CONTROL y
los puntos medios como puntos de la curva: una cadena de cuadráticas continua
en tangente, sin una sola esquina. Aplicado a la superficie del líquido, la
cortina del rebose, el reguero por el canto y la cinta del chorro.

## Desviaciones deliberadas del plan (fase 3)

1. **El escalado adaptativo mide el coste de nuestro dibujo, no el intervalo
   entre frames.** El plan dice «si el tiempo de frame medio pasa de 20 ms».
   Tomado literalmente, una pantalla bloqueada a 30 Hz da 33 ms de intervalo
   con un dibujo baratísimo y degradaríamos al tier 3 sin motivo. Se mide
   `performance.now()` alrededor de `draw()`. **Aviso para la fase de WebGL:**
   ahí el coste de GPU no aparece en el tiempo de CPU, así que habrá que
   combinarlo con el intervalo o con una consulta de temporizador.
2. **El escalado sólo baja, nunca sube.** Subir de vuelta produce oscilación
   entre dos calidades. Una partida de 15 s no necesita recuperar calidad.
3. **La traza se graba desde el primer toque**, no desde `READY`. Es la
   ventana que se puntúa y la que `replay()` reproduce. Para el antifraude de
   la fase 2 quizá convenga incluir los segundos de aproximación.
4. **Con el grifo cerrado ya no se derrama.** Medido en la traza real: cerró
   al 85% de llenado y en los 5 s siguientes, al bajar el brazo, el juego le
   quitó el 23,6% del vaso y le puso CAÑA DERRAMADA con un error medio de
   2,5°, que es de buen jugador. La puntuación pasó de **28.889 a 94.584** al
   acotar el derrame a la ventana de vertido. El `SETTLE` de 2 s existe
   precisamente para bajar el brazo (§Riesgos 6).
5. **`glassGL.ts` no está escrito.** Su razón de ser es «foto del vaso real
   horneada en atlas + refracción en shader», y no hay foto (pregunta abierta
   nº1). Escribir un cristal procedural en WebGL sería construir lo que luego
   se tira. El contrato de capas, el sistema de tiers y el respaldo 2D están
   completos y probados, así que entra en cuanto haya atlas.

## Dos pieles: papel blanco fuera, negro dentro del vaso

Petición del estudio: todo lo que no es tirar la caña va sobre **blanco** con
la tipografía en **`#B02C31`**, y los botones son de ese rojo con el texto en
blanco. La pantalla de tirar se queda negra: ahí la pantalla ES el vaso y
cualquier cosa que no sea cerveza estorba.

Está hecho **redefiniendo los tokens**, no reescribiendo las clases de cada
vista. Las utilidades de Tailwind compilan a `var(--color-…)`, así que basta
con volver a declarar las variables dentro de `body:not([data-screen="game"])`
y un `text-ambar-dim` escrito una vez sirve para las dos pieles. Lo decide un
solo atributo en `<body>`, que pone `skin()` desde el cambio de vista.

El `:not` es necesario, no es adorno: declarar los tokens en `body` a secas
los deja aplicándose también en el juego, porque redeclarar `background` en
una regla más específica no borra las custom properties de la otra.

Tres cosas que salieron de hacerlo:

- **Todo el texto va al rojo entero, sin aclarar.** Lo primero que hice fue un
  segundo rojo más claro para el texto secundario, que es casi todo el texto
  de estas pantallas: quedaba en **2,66:1** de contraste sobre blanco y no se
  leía. A pelo da **6,46:1**, y sobre el fondo de panel **5,77:1**. La
  jerarquía la hacen el cuerpo y el peso, que el marcado ya varía.
- **El canvas no hereda `currentColor`.** La gráfica del sensor pintaba el
  trazo crudo en blanco al 28%, que sobre papel no existe. Ahora lee
  `--color-marca` del DOM **una vez al montar** —`getComputedStyle` por frame
  fuerza un reflujo— y compone el alfa a mano.
- **`theme-color` cambia con la piel.** En iOS pinta la barra de estado, y una
  barra negra sobre una pantalla blanca se lee como un recorte.

Lo que NO he tocado, porque es la pantalla de tirar y las decisiones de
aspecto son del estudio: la tarjeta de resultado, con su botón ámbar de
GUARDAR Y OTRA CAÑA. Flota sobre la cerveza, no sobre papel.

## Publicado en GitHub Pages, y el repositorio es público

<https://mariagove.github.io/tiraje/>, desplegado por
`.github/workflows/pages.yml` en cada push a `main`.

Esto resuelve de raíz el «no me funciona el enlace en el móvil» que salió tres
veces: ya no hace falta que el Mac esté encendido, ni estar en la misma red,
ni aceptar un certificado autofirmado. Pages sirve por HTTPS, que es lo que
exige `DeviceMotionEvent`, así que el sensor funciona igual que en local.

Dos decisiones que hay que tener presentes:

- **El repositorio pasó a público.** Pages no está disponible para
  repositorios privados en el plan gratuito, y el estudio prefirió eso a pagar
  Pro o salir de GitHub. Antes de cambiarlo se revisó que no hubiera claves ni
  credenciales versionadas; no había. Lo que sí queda a la vista es toda la
  documentación interna, este archivo incluido, y tres rutas locales con un
  nombre de usuario en `docs/PLAN.md` (`/Users/macbookluis/…`), que vienen del
  plan original y se han dejado tal cual.
- **`base: './'` en `vite.config.ts`.** El sitio no vive en la raíz del
  dominio sino en `/tiraje/`, y con rutas absolutas los assets dan 404. Con
  rutas relativas el mismo build sirve en la raíz, en un subdirectorio y
  abierto desde disco. Verificado sirviendo `dist/` desde un subdirectorio
  antes de desplegar, y después contra la URL real: index, CSS y JS a 200.

El flujo compila en el runner y **no versiona `dist/`**: guardar el compilado
garantiza que antes o después se publica uno rancio. Pasa `lint`, `test` y
`build` —que incluye `tsc --noEmit` y el horneado de variedades— antes de
publicar, así que un error de tipos tumba el despliegue en vez de salir al
aire.

## Fuera la lengua del derrame

Decisión del estudio el 30/09/2026: **quitarla**. No quedó bien en ninguno de
los cinco intentos, y arriba están todos documentados —no deslizaba, salía
cortada, volvía a subir, tardaba segundos en secarse, no cambiaba de lado—.
Cada arreglo era correcto y el resultado seguía sin convencer, que es la señal
de que el problema no era el arreglo.

Lo que queda del rebose es el **copete que asoma por encima del labio**, con
su reparto de vertedero y su borde ondulante. Cuenta lo mismo que hacía falta
contar: hay líquido pasando por encima del borde. Lo que se ha ido es el
estado —la única parte con estado que tenía el renderer— y con él 190 líneas
de `glass2d.ts` y los tres tests de `tongue.test.ts`.

La física del núcleo NO cambia: se sigue perdiendo líquido al rebosar, el
nivel sigue bajando y el veredicto sigue siendo «caña derramada». Lo que se
quita es sólo el dibujo de la lengua.

## El vaso en rojo de marca, y el ángulo en el centro

Tres cambios de aspecto pedidos a la vez:

- **El fondo del vaso es `#B02C31`, no negro.** En CSS es un token aparte,
  `--color-ambar-fondo`, y no `--color-ambar-ink`: la tinta casi negra sigue
  hacienda falta porque es lo que se pone ENCIMA del ámbar en los botones del
  juego. Confundir los dos papeles dejaba texto granate sobre botón ámbar.
  `theme-color` pasa a rojo en esa pantalla por lo mismo que pasó a blanco en
  las otras.
- **El ángulo, centrado y a un decimal**, donde estaba el logo grabado en el
  cristal, que se ha quitado. Tres decimales eran honestos con el móvil
  quieto, pero en la mano las milésimas bailan sin que puedas hacer nada con
  ellas, y la décima es justo el paso de cuantización del sensor. Sigue
  desvaneciéndose al abrir el grifo: durante el vertido no hay un solo número
  en pantalla.
- **El logo de Ambar en lugar del cartelito «midiendo».** Si el juego responde
  a la inclinación ya se ve que mide. Lo que **no** se sustituye por un logo
  son los tres «no hay sensor» del plan §1.7: ésos cambian a qué estás jugando
  —al dedo, con ranking de práctica aparte— y hay que poder leerlos. `idle`
  tampoco es un fallo, así que va en texto apagado y no en negrita.

El logotipo va **siempre sobre su propio blanco**, también en la pantalla
roja. Medido en el PNG: el granate del logotipo es `#A23736` y el fondo de la
pantalla `#B02C31`, más claro, así que la marca se perdería encima. Un
logotipo de cliente no se recolorea para que encaje. El PNG entra por `import`
para que Vite le ponga hash y le aplique el `base` del build; referenciarlo a
mano como `/ambar.png` daría 404 en Pages.

## La pantalla del jugador se queda sin instrumentos

Quitado a petición del estudio: las pestañas JUEGO / SENSOR / TRAZA y el botón
DEBUG. Son aparatos de medida, no juego, y en una pantalla que ES el vaso
estorban.

**No se ha borrado nada.** La fase 2 se calibra con esas vistas y hacen falta
en cada móvil nuevo —la sonda de signos, la frecuencia real del sensor, el
grabador de trazas—, así que siguen montándose, sólo que por URL:

    ?vista=sensor     la rebanada del sensor
    ?vista=trace      el grabador de trazas
    ?debug=1          el panel de números sobre el juego

En el juego se oculta además el título TIRAJE de la cabecera, por lo mismo.

## Aspecto de la tarjeta de resultado y de las variedades

- **La tarjeta, sobre papel blanco con tinta de marca**, como las demás
  pantallas que no son el vaso, y el botón de guardar en rojo con texto
  blanco. Sin opacidades dentro: el rojo rebajado sobre blanco se queda en
  3,4:1 y ese texto es de 0,7 rem. Misma decisión que en el resto de la
  interfaz, la jerarquía la hacen el cuerpo y el peso.
- **Más pequeña y levantada del suelo.** Ancho máximo de 19 rem en vez de
  24 y menos relleno, y un hueco por debajo del alto del logotipo más un
  respiro, para que no se le monte encima. El aviso de «inclínalo como un
  vaso» lleva el mismo hueco por el mismo motivo.
- **Especial y Negra, en dos pestañas** en vez de un desplegable. La activa va
  en blanco sólido con la tinta de marca: el botón de marca es rojo sobre
  blanco, pero esta pantalla YA es ese rojo y rojo sobre rojo no se vería.

## El logotipo, sin fondo

Se le ha quitado el blanco al PNG **deshaciendo la composición**, no a umbral:
cada píxel del borde es tinta mezclada con blanco, así que de `P = a·C +
(1−a)·255` se despeja el alfa con la tinta conocida y se recupera el color
original. La tinta se elige entre las dos del logotipo por el canal que las
separa. Resultado: tintas planas `#A23736` y `#B69E6C`, 2.830 píxeles de borde
suave y ni un diente de sierra. A umbral habrían quedado dientes y un halo
claro alrededor de cada letra.

**Lo que hay que saber, medido:** el granate sobre el fondo del vaso da
**1,04:1** de contraste. Con el vaso vacío el logotipo prácticamente no se ve.
Sobre la cerveza sube a 3,11:1 y sobre el papel blanco de las demás pantallas
a 6,70:1. Lo pidió así el estudio y un logotipo de cliente no se recolorea por
cuenta propia; si hiciera falta que se lea sobre el rojo, la solución es una
versión calada en blanco, que tiene que dar el estudio.

## Dos toques, y la espuma la hace la inclinación

Cambio de mecánica pedido por el estudio, y es el cambio más profundo hasta
ahora porque toca el núcleo determinista.

**Antes:** tres toques. Abrir, conmutar el grifo a espuma, cerrar. La espuma
de la fase de cerveza dependía de `δ = objetivo − ángulo`, o sea de lo
adelantado que fueras respecto a la curva.

**Ahora:** dos toques, abrir y cerrar. El grifo echa siempre lo mismo y lo que
cambia con la inclinación es **cuánto de lo que entra se convierte en
corona**: una recta entre `foamTilted` a 45° o más y `foamUpright` a 0°. El
ángulo es ABSOLUTO, no relativo al objetivo, que es lo que se pidió.

Es más fiel a un tirador de verdad —la corona no la decide un mando, la decide
cómo sostienes el vaso— y es un toque menos que explicar. **Y la tensión del
juego no se pierde, ahora sale sola de la física**: conforme sube el nivel hay
que enderezar para no derramar, y enderezar es justo lo que hace la corona.

### Calibrado, no inventado

Las dos constantes se eligieron simulando al jugador que sigue la curva
objetivo, no a ojo:

| variedad | `foamUpright` | `foamTilted` | espuma siguiendo la curva | objetivo |
|---|---|---|---|---|
| Especial | 0,74 | 0,03 | 19,7% | 20% |
| Negra    | 0,85 | 0,04 | 24,1% | 25% |

Queda a propósito **un poco por debajo del objetivo**: para clavarlo hay que
enderezar algo más que la curva en el último tramo, que es exactamente lo que
hace un camarero al levantar la corona, y cuesta unas décimas de grado de
error medio. Ese intercambio ES el juego.

### Lo que arrastró el cambio

- **El máximo teórico ya no se simula, se calcula.** Con un solo grifo salen
  dos ecuaciones de volumen y el tiempo se despeja: `F = espuma/(r·E)` y
  `t = llenado/r − (E−1)·F`. Caña perfecta: 8,10 s en la Especial, 8,42 s en
  la Negra.
- **`maxScore` pasa a la variedad horneada.** Hacía falta para lo siguiente.
- **Las bandas de los fixtures dorados van en FRACCIÓN del máximo**, no en
  puntos. El plan las daba en puntos —perfecta en [160.000, 180.000]— y esos
  números estaban atados al grifo de dos fases: al cambiar la mecánica el
  techo bajó a 132.857 y la banda absoluta se volvió mentira sin que el juego
  hubiera empeorado. Ahora: perfecta entre el 92% y el 100% del techo,
  mediocre entre el 35% y el 65%.
- **Se regeneraron los diez fixtures sintéticos y `expected.json`**, que es lo
  que manda el propio comentario del test: «si falla a propósito, se regeneran
  los fixtures Y se abre temporada nueva». La traza real del iPhone se
  conserva tal cual; su puntuación pasa de 57.710 a 58.191 con las reglas
  nuevas, y su tercer toque simplemente no hace nada.
- **La variedad de un fixture la dice la TRAZA, no el nombre del fichero.**
  Deducirla del prefijo funcionaba mientras todos se llamaban
  `<variedad>-<perfil>` y se rompió con `real-iphone-1`.
- **Reequilibrio.** La Negra tarda más en llenarse, así que con la misma
  tarifa su techo quedaba un 2,1% por encima. Su `pointsPerSecBeer` baja a
  865,5 para igualar los máximos: 132.857 contra 132.861. Desequilibrio
  medido entre partidas perfectas: **0,35%**.
- **El chorro se tiñe de forma continua.** `pouringFoam` era un booleano
  porque el grifo conmutaba; ahora es `foamFrac`, 0..1, y el chorro se aclara
  conforme hace más corona. No llega a blanco: lo que baja por el aire es
  cerveza que espuma AL LLEGAR, no espuma ya hecha.

## Instrucciones antes del primer toque, y fuera el «calibrando»

Las tres líneas van debajo del ángulo, en el centro, y desaparecen al abrir el
grifo para no volver.

El aviso de «calibrando N%» se ha quitado: era un porcentaje subiendo en la
parte de abajo que no pedía nada al jugador —el toque abre el grifo esté
calibrado o no— así que sólo era ruido con pinta de estar esperando algo. La
calibración sigue ocurriendo igual.

## El logotipo, calado sobre el rojo

Va la versión en tinta sobre el papel blanco y la **calada en blanco** sobre
el rojo del vaso, porque ahí el granate daba 1,04:1 de contraste. El oro del
triángulo se queda: sólo se cala la palabra.

Las dos versiones van en el marcado y **las conmuta el CSS con la piel**, en
vez de repintarlas desde JS: así el cambio de pantalla no tiene que acordarse
de volver a pintar el estado del sensor. Cuesta 7 KB de PNG de más.

La versión calada se genera reescribiendo el color de los píxeles granates y
**conservando su alfa**, que es donde vive el antialias; el oro se distingue
por el canal verde, igual que al extraer el fondo.

## El ángulo late a 2 Hz, y el logotipo lee lo que tiene detrás

- **El ángulo, en grados enteros y refrescado dos veces por segundo.** No es
  una cifra menos: un número que cambia sesenta veces por segundo no se lee,
  se percibe como parpadeo, y encima invita a perseguirlo. A 2 Hz y en enteros
  se lee de un vistazo y se deja de mirar, que es lo que se quiere — el
  instrumento de verdad es el líquido. El filtro sigue corriendo a cada frame;
  lo que se espacia es el **pintado**, así que el número que sale es el
  filtrado de ese instante y no una media de medio segundo.

- **El logotipo cambia de color según lo que tenga detrás.** Calado en blanco
  sobre el rojo del vaso, y en tinta de marca en cuanto la cerveza le pasa por
  detrás.

  Lo decide **leyendo el píxel ya pintado** en el centro del propio logotipo,
  no rehaciendo la geometría. Parece un atajo y es lo contrario: la respuesta
  tiene que contar con el oleaje, el chapoteo, la corona y la espuma que
  rebosa, y todo eso ya está en el píxel. Recalcularlo sería mantener una
  segunda copia de la misma cuenta, que es justo como se acaba con la etiqueta
  de un color y el vaso de otro.

  El margen está medido, no elegido a ojo: el fondo lleva encima un bisel y un
  brillo que como mucho son un velo blanco al 5%, unas **16 unidades** de
  distancia de color; la cerveza y la espuma están a más de **130**. El corte
  en 30 deja sitio de sobra por los dos lados, y hay tres tests que lo fijan.

  Se mira el rectángulo real del logotipo en vez de suponer dónde está, y se
  pregunta dos veces por segundo, no por frame: un `getImageData` fuerza a
  esperar a la GPU.

## Sigue abierto, y no lo decide el código

1. **Cristalería.** ¿Sesión de foto o render 3D? ¿Ambar cede las piezas? Sin
   esto no hay arte final, y la geometría de la Negra es inventada.
2. **Dominio `tiraje.es`.** ¿Estudio o Ambar? Ver `DEV-HTTPS.md`.
3. **Gotham y el resto de los tokens.** `dakota-durango-redesign/app` no está
   en este Mac. El rojo ya es de marca (`#B02C31`, lo dio el estudio); la
   tipografía sigue siendo la del sistema y el ámbar y el negro de la pantalla
   de tirar siguen siendo placeholder declarado.
4. **¿Hay premio físico?** Cambia todo el antitrampa de la fase 2.
5. **Umbrales de antifraude.** 500 trazas reales, percentil 99,5. No inventar.

## Hallazgo sobre el formato de traza

El plan dimensiona TRZ1 en 3 bytes/muestra, ~2,5 KB comprimido, frente a
«42 KB de JSON ingenuo». Medido con una traza real de 10,4 s:

- JSON sin comprimir: **30,3 KB**
- El mismo JSON con gzip: **1,68 KB**

O sea que el JSON comprimido ya bate la estimación de TRZ1. Aviso: las trazas
sintéticas comprimen mejor que las reales, así que hay que volver a medir con
trazas del bar antes de decidir que TRZ1 no hace falta.
