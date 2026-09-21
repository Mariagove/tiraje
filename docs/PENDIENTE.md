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

Se va por el punto del borde que queda más bajo en el mundo, que es el mismo
por el que desborda: el borde superior de la pantalla es la boca, y su punto
más bajo es la esquina hacia la que tira la gravedad. Lengüeta sobre la
esquina, reguero pegado al canto con el frente irregular —la espuma avanza a
tirones, no como una barra— y cinco goterones descolgándose, otra vez sin
estado.

**Se reparte a lo largo del borde, no se va todo por una esquina.** Sobre un
vertedero el caudal por unidad de ancho va con la **profundidad^1,5** del
labio bajo la superficie, así que la esquina más baja se lleva el grueso y el
resto del borde aporta cada vez menos hasta donde la superficie corta el
borde, donde es cero. La FORMA sale de la geometría; la CANTIDAD, de la señal
suavizada. Con eso el mismo dibujo sirve para las dos causas: en el rebose por
lleno el borde entero está sumergido y el perfil es el real; en el derrame por
inclinación la superficie ni toca el borde, y entra un perfil de reserva
centrado en el labio bajo.

Dos pistas visuales que hicieron falta: la espuma de fuera va **teñida** de
cerveza (arrastra líquido) y lleva **sombra bajo el frente**. Sin la sombra se
fundía con la corona del propio vaso —las dos blancas, una justo detrás de la
otra— y el conjunto se leía como una mancha sin profundidad.

**Las dos causas se unen en una sola señal** (`spillingOver` en el frame):
rebosar por lleno y pasarse de inclinación son la misma cosa vista desde
fuera, líquido pasando por encima del borde.

Y un hallazgo del test: **el derrame por inclinación se autolimita** —derrama,
pierde volumen, baja del umbral, deja de derramar, se vuelve a llenar— así que
la señal parpadea. Por eso el renderer la suaviza con ataque rápido y caída
lenta en vez de leerla en crudo, y por eso el test muestrea una ventana y no
un instante. El rebose por lleno, en cambio, es sostenido, y ahí el reguero
sale a plena intensidad.

## Bug del enganche de rebose

`overflowing` se quedaba pegado a `true` para siempre, así que el vaso seguía
rebosando en pantalla después de cerrar el grifo y de acabar la partida.

La causa, en una palabra: `else if (st.f < 1)`. Tras recortar el llenado, `f`
queda **exactamente** en 1, así que no se cumplía ninguna de las dos ramas y
el flag no se limpiaba nunca. Con un `else` a secas, al cerrar el grifo ya no
entra nada, `f` se queda en 1, y la rama else lo apaga. Con test.

**Lo que sigue sin modelarse:** al cerrar con el vaso rebosando, el nivel no
baja. La espuma de fuera se acaba yendo, pero dentro `f` se queda en 1 porque
**el colapso de la espuma no está en el modelo**. Añadirlo cambia el bono de
llenado del resultado, así que es decisión de diseño, no mecánica.

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

## Sigue abierto, y no lo decide el código

1. **Cristalería.** ¿Sesión de foto o render 3D? ¿Ambar cede las piezas? Sin
   esto no hay arte final, y la geometría de la Negra es inventada.
2. **Dominio `tiraje.es`.** ¿Estudio o Ambar? Ver `DEV-HTTPS.md`.
3. **Tokens de marca y Gotham.** `dakota-durango-redesign/app` no está en este
   Mac; los colores de `src/styles.css` son placeholder declarado.
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
