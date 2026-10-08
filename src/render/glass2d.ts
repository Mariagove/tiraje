/**
 * glass2d.ts — la pantalla ES el vaso.
 *
 * El marco del dibujo es el marco del vaso: los bordes de la pantalla son las
 * paredes y no rotan. Lo que rota es la superficie del líquido, horizontal en
 * el MUNDO, que se ve a **−φ** sobre el cristal.
 *
 * Con φ medido en el plano de la pantalla (`sensors/fusion.ts`), ese −φ es la
 * **proyección literal** de la superficie sobre el cristal, no una convención
 * de nivel de burbuja: lo que ves inclinarse es lo que está inclinado. Eso
 * cayó de la decisión de cambiar el eje de medida, y es la razón por la que
 * conviene.
 *
 * Arte PLACEHOLDER: aquí van los tokens de marca y la fotografía del cristal.
 */
import type { BakedVariety } from '@/core/types'
import { TIERS, type GlassFrame, type GlassRenderer, type Tier } from './types'

const D2R = Math.PI / 180

/**
 * El fondo del vaso vacío: el rojo de marca, no negro.
 *
 * Es el único color de esta pantalla que sí es de marca, y lo eligió el
 * estudio. Sobre él la cerveza y la corona blanca siguen destacando; la
 * graduación ya lleva halo oscuro y trazo claro, así que se lee igual.
 */
const FONDO = '#b02c31'
const rgba = (c: readonly number[], a: number): string =>
  `rgba(${c[0]},${c[1]},${c[2]},${a})`

/**
 * Traza una polilínea como curva suave, sin picos.
 *
 * El truco clásico: los puntos dados se usan como puntos de CONTROL y los
 * puntos medios entre ellos como puntos de la curva. Sale una cadena de
 * cuadráticas continua en tangente, así que no queda ni una esquina.
 *
 * Hace falta porque una frontera de líquido trazada con `lineTo` se ve
 * angulosa: la espuma que rebosa quedaba con los bordes a picos.
 */
export function smoothTo(
  ctx: CanvasRenderingContext2D, pts: readonly (readonly number[])[],
): void {
  if (pts.length === 0) return
  if (pts.length < 3) {
    for (const p of pts) ctx.lineTo(p[0]!, p[1]!)
    return
  }
  ctx.lineTo(pts[0]![0]!, pts[0]![1]!)
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i]!
    const b = pts[i + 1]!
    ctx.quadraticCurveTo(a[0]!, a[1]!, (a[0]! + b[0]!) / 2, (a[1]! + b[1]!) / 2)
  }
  const last = pts[pts.length - 1]!
  ctx.lineTo(last[0]!, last[1]!)
}

/** Mezcla lineal de dos colores. */
const mix = (a: readonly number[], b: readonly number[], t: number): number[] =>
  [a[0]! + (b[0]! - a[0]!) * t, a[1]! + (b[1]! - a[1]!) * t, a[2]! + (b[2]! - a[2]!) * t]

/**
 * Intensidad mínima para que haya rebose en pantalla.
 *
 * Se compara contra la intensidad SUAVIZADA, no contra la geometría cruda: el
 * derrame se autolimita —derrama, baja el nivel, para, se vuelve a llenar— y
 * el booleano cruza el cero varias veces por segundo.
 */
const SPILL_ON = 0.08

interface Bubble {
  x: number
  y: number
  /** Radio base. El radio pintado crece conforme la burbuja sube. */
  r0: number
  /** Velocidad base de ascenso, px/s. Escala con el radio: flotabilidad. */
  v: number
  /**
   * Desfase propio del vaivén turbulento, y cuánto vaga esta burbuja en
   * concreto.
   *
   * Que cada una lleve el suyo es lo que separa «remolino» de «cortina»: con
   * una sola fase para todas, el enjambre entero se mueve a la vez y se lee
   * como una bandera, no como un líquido revuelto.
   */
  fase: number
  vagar: number
}

/** Segmentos con que se traza la superficie ondulada. */
const WAVE_SEGMENTS = 72

/**
 * Las componentes del oleaje: longitud de onda en anchos de pantalla, peso,
 * velocidad en Hz y desfase.
 *
 * Lo que las hace parecer desordenadas no es cuántas son sino que sus
 * frecuencias **no guarden proporción simple**: con 2, 3 y 4 veces la
 * fundamental el conjunto se repetiría cada vuelta de la más lenta y volvería
 * a verse el patrón. Los signos alternos hacen además que unas viajen a un
 * lado y otras al contrario.
 */
const OCTAVAS: readonly (readonly [number, number, number, number])[] = [
  [0.62, 0.42, 2.10, 0.0],
  [0.27, 0.27, -3.57, 1.7],
  [0.146, 0.19, 5.31, 4.1],
  [0.079, 0.12, -8.63, 2.3],
]

/**
 * Perfil del oleaje, normalizado: `u` en anchos de pantalla, `t` en segundos.
 *
 * Cada componente es un seno puro, o sea **de media cero**, y esa es la
 * propiedad que no se puede romper: el nivel del líquido se resuelve por área
 * y la ondulación tiene que quitar por un lado lo mismo que añade por el
 * otro. Si alguien añade aquí una constante o una función asimétrica, el
 * llenado que se dibuja deja de ser el que dice el núcleo.
 */
export function waveShape(u: number, t: number): number {
  let y = 0
  for (const [lambda, w, hz, ph] of OCTAVAS) {
    y += w * Math.sin((u * 2 * Math.PI) / lambda + t * 2 * Math.PI * hz + ph)
  }
  return y
}
/** Grosor del chorro en píxeles CSS. Una caña real entra bien gorda. */
/**
 * Qué fracción de las burbujas sigue viva con el grifo cerrado.
 *
 * El resto entra y sale con el caudal. No es cero porque una cerveza en
 * reposo sigue burbujeando: el gas sale de los puntos de nucleación del
 * cristal, no del chorro.
 */
const BUBBLES_AT_REST = 0.3

/**
 * Cuánto revuelve el chorro el líquido, de 0 a 1. Exportada para poder fijarla
 * con un test: es la pieza de la que cuelgan las tres fases.
 *
 * Se normaliza `foamFrac` entre los dos extremos de la variedad. Con el grifo
 * cerrado es cero y punto: en reposo no revuelve nadie.
 */
export function turbulencia(
  f: { pouring: boolean; foamFrac: number },
  pour: { foamUpright: number; foamTilted: number },
): number {
  if (!f.pouring) return 0
  const rango = pour.foamUpright - pour.foamTilted
  if (rango <= 1e-6) return 0
  const corona = (f.foamFrac - pour.foamTilted) / rango
  return 1 - (corona < 0 ? 0 : corona > 1 ? 1 : corona)
}

/**
 * La turbulencia del chorro entrando en el líquido, y las tres fases que
 * describe el estudio:
 *
 *   1. Chorro cayendo sobre cerveza, con el vaso tumbado: muchísimas más
 *      burbujas, por TODO el volumen, y moviéndose de forma desordenada.
 *   2. Al enderezar y salir la espuma: bajan y se ordenan.
 *   3. En reposo: lo que ya había.
 *
 * No hace falta una variable nueva para distinguirlas, porque el juego ya
 * calcula la magnitud exacta: **`foamFrac`**, la fracción de lo que entra que
 * se convierte en espuma. Tumbado vale casi nada —la cerveza resbala por la
 * pared y el chorro apuñala el líquido— y recto sube al máximo —cae a plomo,
 * rompe arriba y forma corona—. Y eso es justo lo que pasa de verdad: cuando
 * hay corona, el chorro cae sobre un colchón de espuma y deja de revolver la
 * cerveza. La turbulencia es su complementario.
 */
/**
 * Cuántas burbujas de más se reservan para el momento de máxima turbulencia.
 *
 * Empezó en 1,6 y se quedaba corto: el estudio seguía viendo pocas al principio
 * del vertido. 2,8 pone el pico en 420 con el presupuesto de tier 0, que son
 * 150 en reposo. Si un móvil no puede con ellas, el medidor de tier lo detecta
 * por tiempo de dibujo y baja de nivel solo; no hace falta adivinar aquí.
 */
const POOL_TURBULENCIA = 2.8
const EXTRA_TURBULENCIA = 1.8
/** Amplitud del vaivén lateral, px/s, a turbulencia máxima. */
const VAGAR_PX_S = 26
/** Cuánto varía la velocidad de ascenso con la turbulencia. */
const JITTER_VERTICAL = 0.55

/**
 * Lo que se aclaran las burbujas mientras el chorro revuelve.
 *
 * Esto importaba tanto como el recuento, y no lo vi: una burbuja se dibuja con
 * alfa `0,16 + 0,26·subida`, o sea que **las del fondo salen a 0,16** —casi
 * transparentes sobre el ámbar—. Al repartirlas por todo el volumen, buena
 * parte de las nuevas caían justo ahí y no se veía ninguna. Más burbujas
 * invisibles siguen siendo pocas burbujas.
 *
 * Y tiene sentido físico: el gas arrastrado por el chorro va en burbujas más
 * gordas y más juntas que el que rezuma del cristal en reposo.
 */
const ALFA_TURBULENCIA = 0.18
const TAMANO_TURBULENCIA = 0.35

const STREAM_WIDTH = 28

/**
 * Capas en que se reparte cada lóbulo de sombra y de brillo del chorro, y su
 * opacidad. Ver `lobe`: con seis al 4% el centro llega al 22% y ningún
 * escalón pasa del 4%, que es lo que hace que no se vean bandas.
 */
const SHADE_LAYERS = 6
const SHADE_ALPHA = 0.04
/** Segmentos de la cinta del chorro. */
const STREAM_SEGMENTS = 26
/** Gotas de la salpicadura. */
const SPLASH_DROPS = 44

/**
 * Dirección de la gravedad en coordenadas de PANTALLA (y hacia abajo), unitaria.
 *
 * `phi` es el giro del móvil en el plano de su pantalla, así que "arriba del
 * mundo" visto desde la pantalla vale `(sin φ, −cos φ)` y la gravedad es su
 * opuesta. Con φ positivo —móvil inclinado hacia la izquierda— la gravedad
 * apunta abajo-izquierda, y el líquido llena primero la esquina inferior
 * IZQUIERDA. Que es lo que hace un vaso de verdad.
 *
 * Esto estaba espejado: se dibujaba la superficie a −φ y el punto de paso
 * también invertido, de modo que los dos errores se cancelaban para la recta
 * pero el líquido entraba por la esquina equivocada.
 */
export function gravityOnScreen(phiDeg: number): { x: number; y: number } {
  const p = phiDeg * D2R
  return { x: -Math.sin(p), y: Math.cos(p) }
}

/**
 * Ángulo de la superficie del líquido en pantalla, en radianes: es `+phi`.
 * Al rotar el lienzo por él, su eje +y local coincide con `gravityOnScreen`.
 */
export function surfaceTilt(phiDeg: number): number { return phiDeg * D2R }

/**
 * Área del polígono recortada al semiplano `y >= level` (por debajo, con la
 * `y` del canvas creciendo hacia abajo). Sutherland-Hodgman y el teorema del
 * zapatero, ambos exactos.
 */
export function areaBelow(poly: readonly number[][], level: number): number {
  const out: number[][] = []
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!
    const b = poly[(i + 1) % poly.length]!
    const aIn = a[1]! >= level
    const bIn = b[1]! >= level
    if (aIn) out.push(a)
    if (aIn !== bIn) {
      const t = (level - a[1]!) / (b[1]! - a[1]!)
      out.push([a[0]! + (b[0]! - a[0]!) * t, level])
    }
  }
  let s2 = 0
  for (let i = 0; i < out.length; i++) {
    const a = out[i]!
    const b = out[(i + 1) % out.length]!
    s2 += a[0]! * b[1]! - b[0]! * a[1]!
  }
  return Math.abs(s2) / 2
}

export class Glass2D implements GlassRenderer {
  readonly kind = 'canvas2d' as const

  #ctx: CanvasRenderingContext2D
  #canvas: HTMLCanvasElement
  #v: BakedVariety
  #tier: Tier = TIERS[0]!
  #dpr = 1
  #w = 0
  #h = 0
  #bubbles: Bubble[] = []
  /**
   * Las de la corona, aparte de las de la cerveza.
   *
   * Van en su propio enjambre porque viven en otra banda —entre la superficie
   * y el techo de la espuma—, son más finas y tienen que respetar ese grosor,
   * que cambia a cada frame. Comparten dirección: **suben en world-up**, igual
   * que las de la cerveza. Antes la corona llevaba treinta puntos colocados
   * con una tabla de hash que saltaban de sitio ocho veces por segundo: no
   * subían, parpadeaban.
   */
  #foamBubbles: Bubble[] = []
  #seed = 12345
  /**
   * Actividad del vertido, 0..1, suavizada.
   *
   * Manda en cuántas burbujas hay y en lo gordas que son: entrando cerveza el
   * vaso burbujea, y al cerrar el grifo se va calmando en vez de cortarse de
   * golpe. También alimenta la amplitud del oleaje.
   */
  #activity = 0
  /** Última medida del rebose, para el panel de depuración. */
  #spillInfo = 'no'
  /**
   * Intensidad del rebose, suavizada.
   *
   * La GEOMETRÍA sigue mandando en si hay rebose o no, pero el derrame se
   * autolimita —derrama, baja el nivel, para, se vuelve a llenar— así que el
   * booleano cruza el cero varias veces por segundo. Dibujar directamente de
   * él hacía parpadear la cortina. Se suaviza la intensidad, con subida
   * rápida y bajada de ~0,3 s: lo justo para tapar el parpadeo sin que la
   * espuma se quede colgada del borde cuando ya no rebosa.
   */
  #spill = 0
  /** Último perfil de vertedero conocido, para que la cortina se desvanezca. */
  #weir: number[] = []

  /**
   * Qué está haciendo el rebose ahora mismo, en números.
   *
   * Está aquí porque el ancho de la lengua se venía estimando a ojo desde
   * capturas y eso no sirve para calibrar: el caudal del labio y el ancho en
   * píxeles son dos números y hay que poder leerlos, también en el móvil.
   */
  get spillInfo(): string { return this.#spillInfo }

  constructor(canvas: HTMLCanvasElement, variety: BakedVariety) {
    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) throw new Error('sin contexto 2d')
    this.#canvas = canvas
    this.#ctx = ctx
    this.#v = variety
  }

  #rnd(): number {
    this.#seed = (this.#seed * 1103515245 + 12345) & 0x7fffffff
    return this.#seed / 0x7fffffff
  }

  setTier(t: Tier): void {
    this.#tier = t
    this.resize(this.#w, this.#h, this.#dpr)
  }

  resize(cssW: number, cssH: number, dpr: number): void {
    this.#w = cssW
    this.#h = cssH
    this.#dpr = Math.min(dpr, this.#tier.maxDpr)
    this.#canvas.width = Math.round(cssW * this.#dpr)
    this.#canvas.height = Math.round(cssH * this.#dpr)
    this.#spawnBubbles()
  }

  #spawnBubbles(): void {
    this.#foamBubbles = Array.from({ length: Math.round(this.#tier.bubbles * 0.55) }, () => {
      // Más finas que las de la cerveza, que con el crecimiento al subir
      // llegan a pasar de 8 px, pero **no diminutas**: con `0,35 + 1,0·u^2,2`
      // el radio medio salía a 0,68 px, o sea menos de un píxel a DPR 1. No
      // es que no se vieran por el color: es que no había nada que ver.
      const r0 = 0.8 + 2.0 * Math.pow(this.#rnd(), 2.2)
      return {
        x: (this.#rnd() - 0.5) * this.#w,
        y: (this.#rnd() - 0.5) * this.#h,
        r0,
        // Más lentas: la espuma es viscosa y el gas asciende a duras penas.
        v: 5 + r0 * 6 + this.#rnd() * 5,
        fase: this.#rnd() * Math.PI * 2,
        vagar: 0.3 + this.#rnd() * 0.7,
      }
    })
    // El depósito se reserva MÁS GRANDE que el presupuesto del tier: las de
    // más sólo se dibujan en el pico de turbulencia, que dura un par de
    // segundos por caña. En reposo se usa el recuento de siempre, así que un
    // móvil lento no paga por un momento que casi no ocurre.
    this.#bubbles = Array.from(
      { length: Math.round(this.#tier.bubbles * POOL_TURBULENCIA) }, () => {
      // Tamaños repartidos con sesgo a lo pequeño: muchas finas y unas pocas
      // gordas, que es lo que se ve en un vaso. Repartidas de forma uniforme
      // salían todas parecidas y el conjunto se leía como una trama.
      const r0 = 0.5 + 3.4 * Math.pow(this.#rnd(), 2.5)
      return {
        x: (this.#rnd() - 0.5) * this.#w,
        y: (this.#rnd() - 0.5) * this.#h,
        r0,
        // Las gordas suben más rápido. No es exacto (la velocidad terminal de
        // una burbuja pequeña va con r²) pero es lo que se lee como cerveza.
        v: 16 + r0 * 16 + this.#rnd() * 14,
        fase: this.#rnd() * Math.PI * 2,
        vagar: 0.3 + this.#rnd() * 0.7,
      }
    })
  }

  /**
   * Nivel del líquido, resuelto por área real.
   *
   * La cavidad es la pantalla entera. Se lleva al marco del MUNDO rotándola
   * φ, se busca por bisección la recta horizontal que deja por debajo la
   * fracción pedida, y se devuelve esa altura en coordenadas del mundo.
   *
   * No sirve el atajo de «altura proporcional al llenado»: es exacto mientras
   * la superficie corta las dos paredes, pero en cuanto sale por la base
   * dibuja líquido que no existe — con el vaso vacío, un 6% de pantalla.
   */
  #levelOfFill(f: number, sin: number, cos: number): number {
    const w = this.#w / 2
    const h = this.#h / 2
    // pantalla → mundo es Rot(−φ). (Para un rectángulo el área por debajo de
    // una horizontal es la misma con Rot(+φ), porque es su reflejo; da igual
    // para el número pero no para entender el código.)
    const poly: number[][] = [[-w, -h], [w, -h], [w, h], [-w, h]]
      .map(([x, y]) => [x! * cos + y! * sin, -x! * sin + y! * cos])
    const total = 4 * w * h
    const want = Math.min(1, Math.max(0, f)) * total
    const ys = poly.map((p) => p[1]!)
    if (want <= 0) return Math.max(...ys)
    if (want >= total) return Math.min(...ys)

    let lo = Math.min(...ys)
    let hi = Math.max(...ys)
    for (let i = 0; i < 26; i++) {
      const mid = (lo + hi) / 2
      if (areaBelow(poly, mid) > want) lo = mid
      else hi = mid
    }
    return (lo + hi) / 2
  }

  draw(f: GlassFrame): void {
    const BEER = this.#v.cfg.look.beer
    const FOAM = this.#v.cfg.look.foam
    /**
     * Gris del contorno de las celdillas: la espuma, ensombrecida.
     *
     * Con 0,55 de mezcla y 0,5 de opacidad el trazo quedaba en 1,58:1 de
     * contraste contra la corona y se leía como tinta. A 0,40 y 0,42 baja a
     * **1,31:1**: se sigue viendo la celdilla, pero como un pliegue de la
     * propia espuma y no como un dibujo encima.
     */
    const FOAM_BUBBLE = mix(FOAM, [70, 66, 60], 0.40)
    const ctx = this.#ctx
    const W = this.#w
    const H = this.#h
    ctx.setTransform(this.#dpr, 0, 0, this.#dpr, 0, 0)
    ctx.fillStyle = FONDO
    ctx.fillRect(0, 0, W, H)

    const cx = W / 2
    const cy = H / 2
    const phi = f.phi * D2R
    const sin = Math.sin(phi)
    const cos = Math.cos(phi)
    const R = Math.hypot(W, H)

    // Actividad del vertido, con ataque rápido y caída lenta: al abrir el
    // grifo el vaso burbujea enseguida, al cerrarlo se calma en ~1,5 s.
    const target = f.pouring ? 1 : 0
    const k = target > this.#activity ? 0.12 : 0.012
    this.#activity += (target - this.#activity) * k
    const act = this.#activity


    /** Superficie de un nivel de llenado, en coordenadas de PANTALLA. */
    const surfaceOf = (fill: number): { x: number; y: number } => {
      const y0 = this.#levelOfFill(fill, sin, cos)
      return { x: -y0 * sin, y: y0 * cos }   // = Rot(+φ)·(0, y0)
    }

    const foamTop = surfaceOf(f.fill)
    const beerTop = surfaceOf(f.fill - f.foam)
    const laceTop = surfaceOf(f.lacing)
    const tilt = surfaceTilt(f.phi) + f.sloshDeg * D2R
    const ct = Math.cos(tilt)
    const st = Math.sin(tilt)

    // ================================================================
    // El oleaje.
    //
    // No es simulación: son varios senos de longitudes de onda distintas que
    // se baten. La amplitud sale del chapoteo —que sí es físico, dos
    // osciladores amortiguados— más un fondo mientras entra el chorro.
    //
    // Eran DOS senos, y dos senos se leen como lo que son: un patrón que va y
    // viene con un ritmo reconocible. Ahora son cuatro, y lo que los hace
    // parecer desordenados no es el número sino que sus frecuencias **no
    // guarden proporción simple** entre sí: con 2, 3 y 4 veces la fundamental
    // el conjunto se repetiría cada vuelta de la más lenta y volvería a verse
    // el patrón. Con razones irracionales, el perfil no se repite nunca.
    //
    // Cada componente es un seno puro, o sea de media cero, así que el área
    // bajo la superficie no cambia y el nivel resuelto por área sigue exacto.
    // Eso es lo que no se puede romper al tocar aquí.
    // ================================================================
    const swell = Math.min(1, Math.abs(f.sloshDeg) / 2.5)
    const amp = W * 0.010 * (0.35 + 0.65 * swell + 0.5 * act)
    const wave = (u: number, scale: number): number => amp * scale * waveShape(u / W, f.t)

    /**
     * Rellena desde una superficie ondulada hacia la gravedad.
     *
     * La fase de la onda se mide sobre el eje de la superficie desde el CENTRO
     * de la pantalla, no desde el origen de la banda: si no, la cresta del
     * borde inferior de la espuma y la del borde superior de la cerveza
     * —que son la misma frontera— no coincidirían.
     */
    const fillTo = (top: { x: number; y: number }, scale: number, style: string | CanvasGradient): void => {
      const s0 = top.x * ct + top.y * st
      const step = (R * 2) / WAVE_SEGMENTS
      ctx.save()
      ctx.translate(top.x, top.y)
      ctx.rotate(tilt)
      const crest: number[][] = []
      for (let x = -R; x <= R; x += step) crest.push([x, wave(x + s0, scale)])
      ctx.beginPath()
      ctx.moveTo(crest[0]![0]!, crest[0]![1]!)
      smoothTo(ctx, crest)
      ctx.lineTo(R, R * 2)
      ctx.lineTo(-R, R * 2)
      ctx.closePath()
      ctx.fillStyle = style
      ctx.fill()
      ctx.restore()
    }

    ctx.save()
    ctx.translate(cx, cy)

    // ================================================================
    // Espuma primero, cerveza encima: así la banda de espuma queda entre las
    // dos superficies sin que haya que cuadrar dos bordes a mano.
    // ================================================================
    if (f.foam > 0.0005) fillTo(foamTop, 1.35, rgba(FOAM, 0.96))

    if (f.fill - f.foam > 0.0005) {
      const g = ctx.createLinearGradient(0, beerTop.y, 0, beerTop.y + H)
      g.addColorStop(0, rgba(BEER, 0.97))
      g.addColorStop(1, rgba(BEER, 0.74))
      fillTo(beerTop, 1, g)
    }

    // ================================================================
    // Burbujas. Suben en world-up, crecen al subir, y son más y más gordas
    // mientras entra cerveza.
    // ================================================================
    const beerThickness = Math.hypot(beerTop.x - surfaceOf(0).x, beerTop.y - surfaceOf(0).y)
    // Nunca se apagan del todo: una cerveza servida sigue soltando burbujas
    // de los puntos de nucleación del cristal, sólo que muchas menos. Antes
    // el recuento iba directo con la actividad y al cerrar el grifo el vaso
    // se quedaba muerto de golpe.
    const acti = Math.max(0, Math.min(1, act * 1.15))

    /**
     * Cuánto revuelve el chorro el líquido, de 0 a 1.
     *
     * Sale de `foamFrac`, normalizada entre sus dos extremos de la variedad:
     * con el vaso tumbado tiende a `foamTilted` y recto a `foamUpright`. El
     * chorro revuelve cuando NO está haciendo corona, porque en cuanto hay
     * corona cae sobre un colchón de espuma. Y con el grifo cerrado, cero.
     */
    const turb = turbulencia(f, this.#v.cfg.pour)

    const base = this.#tier.bubbles * (BUBBLES_AT_REST + (1 - BUBBLES_AT_REST) * acti)
    const live = Math.min(
      this.#bubbles.length, Math.round(base * (1 + EXTRA_TURBULENCIA * turb)))
    if (live > 0 && f.fill - f.foam > 0.01 && beerThickness > 6) {
      const grav = gravityOnScreen(f.phi)
      const dt = 1 / 60
      /** Distancia de un punto por debajo de la superficie de la cerveza. */
      const depth = (x: number, y: number): number =>
        (x - beerTop.x) * -st + (y - beerTop.y) * ct
      for (let i = 0; i < live; i++) {
        const b = this.#bubbles[i]!
        const sizeScale = (0.55 + 0.45 * act) * (1 + TAMANO_TURBULENCIA * turb)
        const d = depth(b.x, b.y)
        if (d < 1.5 || d > beerThickness + R) {
          // Reaparece repartida por la columna de cerveza. Con el chorro
          // revolviendo aparecen también ARRIBA del todo, no sólo en el
          // tercio de abajo: es lo que hace que se vean «por todo el
          // volumen» en vez de subir en fila desde el fondo.
          const along = (this.#rnd() - 0.5) * W * 1.1
          const desde = 0.35 - 0.30 * turb
          const deep = beerThickness * (desde + (1 - desde) * this.#rnd())
          b.x = beerTop.x + ct * along - st * deep
          b.y = beerTop.y + st * along + ct * deep
          continue
        }
        // Crecen conforme se acercan a la superficie: cae la presión y
        // coalescen. Es lo que las hace leerse como burbujas y no como puntos.
        const rise = 1 - Math.max(0, Math.min(1, d / beerThickness))
        const r = b.r0 * sizeScale * (1 + 1.1 * rise)

        // Desorden. Dos cosas a la vez y las dos sólo con el chorro
        // revolviendo: un vaivén LATERAL —perpendicular a la gravedad, que
        // aquí no apunta hacia abajo de la pantalla sino hacia abajo del
        // MUNDO— y una velocidad de ascenso que deja de ser la misma de
        // siempre. Sin lo segundo el enjambre sube ordenado aunque serpentee.
        const ang = f.t * 2.4 + b.fase
        const lateral = turb * b.vagar * VAGAR_PX_S * Math.sin(ang)
        const vJit = 1 + JITTER_VERTICAL * turb * b.vagar * Math.sin(ang * 1.37 + 1.1)
        b.x += (-grav.x * b.v * sizeScale * vJit - grav.y * lateral) * dt
        b.y += (-grav.y * b.v * sizeScale * vJit + grav.x * lateral) * dt
        ctx.beginPath()
        const alfa = 0.16 + 0.26 * rise + ALFA_TURBULENCIA * turb
        ctx.fillStyle = `rgba(255,255,255,${alfa.toFixed(3)})`
        ctx.arc(b.x, b.y, r, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    // Burbujeo de la corona: el mismo modelo que en la cerveza, en la banda
    // de espuma y con la MISMA dirección de ascenso. Lo que las distingue es
    // que son más finas, más lentas y más claras.
    const foamThickness = Math.hypot(foamTop.x - beerTop.x, foamTop.y - beerTop.y)
    if (this.#foamBubbles.length > 0 && f.foam > 0.0005 && foamThickness > 4) {
      const grav = gravityOnScreen(f.phi)
      const dt = 1 / 60
      /** Profundidad por debajo del TECHO de la espuma. */
      const depth = (x: number, y: number): number =>
        (x - foamTop.x) * -st + (y - foamTop.y) * ct
      const liveFoam = Math.round(this.#foamBubbles.length
        * (BUBBLES_AT_REST + (1 - BUBBLES_AT_REST) * Math.max(0, Math.min(1, act * 1.15))))
      for (let i = 0; i < liveFoam; i++) {
        const b = this.#foamBubbles[i]!
        const d = depth(b.x, b.y)
        // Se recicla en cuanto sale de la banda, sin holgura.
        //
        // Llevaba `+ R` —la diagonal de la pantalla— copiado del enjambre de
        // la cerveza, donde la banda es gruesa y da igual. Aquí la corona mide
        // 160 px y esa holgura dejaba burbujas de espuma dibujadas por todo el
        // vaso, muy por debajo de la corona: medido, se repartían entre
        // y = −301 y y = 383 sobre una banda que iba de −284 a −122.
        if (d < 0.5 || d > foamThickness) {
          const along = (this.#rnd() - 0.5) * W * 1.1
          const deep = foamThickness * (0.45 + 0.55 * this.#rnd())
          b.x = foamTop.x + ct * along - st * deep
          b.y = foamTop.y + st * along + ct * deep
          continue
        }
        const rise = 1 - Math.max(0, Math.min(1, d / foamThickness))
        b.x += -grav.x * b.v * dt
        b.y += -grav.y * b.v * dt
        // Cada celdilla es un ANILLO, no un disco: relleno clarísimo y
        // contorno oscuro. Sobre una corona casi blanca, un disco —de
        // cualquier tono— compite con el fondo; un contorno se lee siempre,
        // que es lo que hace que una espuma parezca espuma y no una mancha.
        const rr = b.r0 * (1 + 0.35 * rise)
        ctx.beginPath()
        ctx.arc(b.x, b.y, rr, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(255,255,255,${(0.30 + 0.25 * rise).toFixed(3)})`
        ctx.fill()
        ctx.strokeStyle = rgba(FOAM_BUBBLE, 0.42 + 0.24 * rise)
        ctx.lineWidth = rr > 1.6 ? 1.1 : 0.8
        ctx.stroke()
      }
    }

    // ================================================================
    // Encaje: el rastro que deja la espuma en la pared. Va en el marco de la
    // PANTALLA, que aquí es el del vaso, porque se pega al cristal.
    // ================================================================
    const laceDepth = Math.hypot(laceTop.x - foamTop.x, laceTop.y - foamTop.y)
    if (f.lacing > f.fill + 0.002 && laceDepth > 2) {
      const lace = ctx.createLinearGradient(-W / 2, 0, W / 2, 0)
      lace.addColorStop(0, rgba(FOAM, 0.20))
      lace.addColorStop(0.2, rgba(FOAM, 0.015))
      lace.addColorStop(0.8, rgba(FOAM, 0.015))
      lace.addColorStop(1, rgba(FOAM, 0.20))
      ctx.save()
      ctx.translate(laceTop.x, laceTop.y)
      ctx.rotate(tilt)
      ctx.fillStyle = lace
      ctx.fillRect(-R, 0, R * 2, laceDepth)
      ctx.restore()
    }

    // ================================================================
    // El chorro.
    //
    // Cae según la gravedad del MUNDO, entra por el punto del borde que queda
    // más bajo —que es donde se apunta el grifo para no derramar— y salpica
    // donde encuentra la superficie.
    // ================================================================
    if (f.pouring) {
      const grav = gravityOnScreen(f.phi)

      // La boca del vaso es el borde SUPERIOR de la pantalla, y el chorro
      // entra por ahí, en un punto FIJO: el jugador sostiene el vaso bajo el
      // grifo y lo deja quieto, así que lo único que cambia con la
      // inclinación es por dónde cae, no por dónde entra.
      //
      // Se probaron dos alternativas y las dos eran peores. Colocar el punto
      // de IMPACTO a mano dejaba el tramo de caída a 24° cuando la gravedad en
      // pantalla va a 45°: se veía como una barra flotando con un codo, y en
      // un fluido no hay codos. Mover la ENTRADA al punto del labio que baja
      // al inclinar sí caía bien, pero pegaba el chorro al borde de la
      // pantalla. Entrando por el centro, la caída es larga y se ve caer, que
      // es de lo que se trata.
      const side = grav.x < 0 ? -1 : 1
      const entry = { x: 0, y: -H / 2 }

      // Cae según la gravedad hasta lo primero que encuentre: la superficie
      // del líquido, o la pared del vaso. El impacto sale de la trayectoria,
      // no se coloca a mano: es lo único que garantiza que el chorro y lo que
      // toca estén siempre pegados.
      const dir = { x: ct, y: st }
      const rel = { x: foamTop.x - entry.x, y: foamTop.y - entry.y }
      const den = grav.x * dir.y - grav.y * dir.x
      const tSurfRaw = Math.abs(den) < 1e-6
        ? Infinity : (rel.x * dir.y - rel.y * dir.x) / den
      const tSurf = tSurfRaw > 0 ? tSurfRaw : Infinity

      const wallX = side * (W / 2)
      const tWallRaw = Math.abs(grav.x) < 1e-6 ? Infinity : (wallX - entry.x) / grav.x
      const tWall = tWallRaw > 0 ? tWallRaw : Infinity

      const hitsWall = tWall < tSurf
      const tEnd = Math.min(tSurf, tWall, R)
      const land = { x: entry.x + grav.x * tEnd, y: entry.y + grav.y * tEnd }

      /** Altura de la superficie sobre la vertical de un `x` dado. */
      const surfaceYAt = (x: number): number => Math.abs(ct) < 1e-6
        ? foamTop.y : foamTop.y + ((x - foamTop.x) * st) / ct

      // El chorro se aclara conforme hace más espuma. La mezcla no llega a
      // blanco del todo: incluso cayendo a plomo, lo que baja por el aire es
      // cerveza que espuma AL LLEGAR, no espuma ya hecha.
      const streamColor = mix(BEER, FOAM, Math.min(1, f.foamFrac * 1.2))

      /**
       * Cinta de líquido entre dos puntos, ondulando al caer.
       *
       * Es un relleno y no un trazo, por dos motivos: el grosor puede variar
       * a lo largo del recorrido —el chorro se estrecha al acelerar y se
       * estrangula, que es la inestabilidad de Rayleigh-Plateau y es lo que
       * hace que se lea como líquido y no como un palo— y admite un degradado
       * transversal que le da volumen de cilindro.
       *
       * La envolvente de la ondulación es `sin(π·s)`: **cero en los dos
       * extremos**. Así el chorro ondula por el medio pero no se mueve ni de
       * la boca del vaso ni del punto de impacto, que tienen que estar fijos.
       */
      const ribbon = (
        from: { x: number; y: number }, to: { x: number; y: number },
        w0: number, w1: number, wobble: number, seed: number, style: string,
        bias = 0, widthScale = 1,
      ): void => {
        const dx = to.x - from.x
        const dy = to.y - from.y
        const len = Math.hypot(dx, dy) || 1
        const ux = dx / len
        const uy = dy / len
        const px = -uy          // perpendicular
        const py = ux
        const left: number[][] = []
        const right: number[][] = []
        for (let i = 0; i <= STREAM_SEGMENTS; i++) {
          const sN = i / STREAM_SEGMENTS
          const env = Math.sin(Math.PI * sN)
          const wig = wobble * env *
            (Math.sin(sN * 9 - f.t * 13 + seed) * 0.62 + Math.sin(sN * 21 - f.t * 21 + seed) * 0.38)
          const full = w0 + (w1 - w0) * sN
          const cxp = from.x + ux * len * sN + px * (wig + bias * full)
          const cyp = from.y + uy * len * sN + py * (wig + bias * full)
          // Se estrangula: el caudal no es uniforme al caer.
          const neck = 1 + 0.16 * Math.sin(sN * 17 - f.t * 19 + seed)
          const hw = (full / 2) * neck * widthScale
          left.push([cxp + px * hw, cyp + py * hw])
          right.push([cxp - px * hw, cyp - py * hw])
        }
        ctx.beginPath()
        ctx.moveTo(left[0]![0]!, left[0]![1]!)
        smoothTo(ctx, left)
        smoothTo(ctx, right.toReversed())
        ctx.closePath()
        ctx.fillStyle = style
        ctx.fill()
      }

      /**
       * Volumen de cilindro: cintas concéntricas sobre la MISMA ondulación.
       *
       * Un degradado transversal de verdad no vale: se calcula sobre la cuerda
       * recta, así que con el chorro ondulando el brillo se queda clavado en
       * una línea y se sale de la cinta por trozos. Estas cintas siguen la
       * ondulación porque comparten el mismo trazado.
       *
       * Eran tres —núcleo, sombra y brillo— y se veían como tres bandas con el
       * corte a la vista. Ahora la sombra y el brillo se reparten en varias
       * capas cada vez más estrechas y con poca opacidad: cada escalón queda
       * por debajo de lo que el ojo separa y el conjunto se lee como un
       * degradado. Con `k` capas al `a`, el centro del lóbulo llega a
       * `1 − (1 − a)^k`, así que el borde entra suave sin que el núcleo pierda
       * fuerza.
       */
      const lobe = (
        from: { x: number; y: number }, to: { x: number; y: number },
        w0: number, w1: number, wob: number, seed: number,
        style: string, bias: number, wide: number,
      ): void => {
        // En los niveles degradados bastan dos capas: ahí lo que sobra es
        // presupuesto de dibujo, no fidelidad del chorro.
        const capas = this.#tier.animatedFoam ? SHADE_LAYERS : 2
        for (let capa = 0; capa < capas; capa++) {
          // De la más ancha a la más estrecha: la opacidad se acumula hacia
          // dentro sin que ninguna capa tenga un borde duro.
          const t = capa / capas
          ribbon(from, to, w0, w1, wob, seed, style,
            bias * (0.55 + 0.45 * t), wide * (1 - t * 0.82))
        }
      }

      const flow = (
        from: { x: number; y: number }, to: { x: number; y: number },
        w0: number, w1: number, wob: number, seed: number,
      ): void => {
        ribbon(from, to, w0, w1, wob, seed, rgba(streamColor, 0.95))
        lobe(from, to, w0, w1, wob, seed, `rgba(0,0,0,${SHADE_ALPHA})`, 0.34, 0.52)
        lobe(from, to, w0, w1, wob, seed, `rgba(255,255,255,${SHADE_ALPHA})`, -0.2, 0.44)
      }

      ctx.save()

      // Caída libre desde la boca. Se estrecha al acelerar.
      flow(entry, land, STREAM_WIDTH, STREAM_WIDTH * 0.82, STREAM_WIDTH * 0.22, 0)

      // Si da en la pared, baja por ella hasta el líquido. Es lo que pasa de
      // verdad al servir con el vaso inclinado, y es lo que conecta el chorro
      // con la cerveza.
      let join = land
      if (hitsWall) {
        // Metido hacia dentro medio grosor: centrado en el borde se pierde
        // media anchura fuera de pantalla y se lee como una raya oscura.
        const runW = STREAM_WIDTH * 0.72
        const x = wallX + (wallX < 0 ? runW / 2 : -runW / 2)
        const yEndRaw = surfaceYAt(x)
        const yEnd = Math.max(land.y, Math.min(yEndRaw, H / 2))
        join = { x, y: yEnd }
        // Se ensancha al bajar: en la pared se extiende en lámina.
        flow(land, join, runW, runW * 1.35, runW * 0.16, 1.7)
      }

      // ----------------------------------------------------------------
      // Salpicadura.
      //
      // Fuente balística sin estado: cada gota recorre un ciclo de vida
      // desfasado, sale con velocidad hacia arriba —contra la gravedad del
      // mundo, no hacia arriba en pantalla— y vuelve a caer. Al no guardar
      // estado, no hay nada que reiniciar entre partidas.
      // ----------------------------------------------------------------
      const upx = -grav.x
      const upy = -grav.y
      const S = STREAM_WIDTH * 2.1
      const GRAV = 2.4

      // Montículo de espuma donde entra el chorro: ahí es donde se bate.
      //
      // Crece con `foamFrac`, o sea con lo recto que esté el vaso, que es la
      // misma recta con la que el núcleo decide cuánta corona sale. Sirviendo
      // por la pared el chorro apenas rompe y el montículo casi no está;
      // cayendo a plomo revienta contra el líquido y se bate de verdad. Antes
      // era del mismo tamaño siempre, y pequeño.
      const churn = 0.75 + 1.35 * Math.min(1, f.foamFrac)
      ctx.save()
      ctx.translate(join.x, join.y)
      ctx.rotate(tilt)
      // Un velo ancho por debajo y los bultos encima: el borde del montículo
      // se difumina en vez de cortarse contra el líquido.
      ctx.fillStyle = rgba(FOAM, 0.34)
      ctx.beginPath()
      ctx.ellipse(0, 0, STREAM_WIDTH * 1.85 * churn, STREAM_WIDTH * 0.72 * churn,
        0, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = rgba(FOAM, 0.92)
      for (let bulto = 0; bulto < 5; bulto++) {
        const off = (bulto - 2) * STREAM_WIDTH * 0.46 * churn
        const puff = 0.1 * Math.sin(f.t * 17 + bulto * 2.1)
        const alto = 1 - Math.abs(bulto - 2) * 0.22
        ctx.beginPath()
        ctx.ellipse(off, -STREAM_WIDTH * 0.1 * alto * churn,
          STREAM_WIDTH * (0.52 + puff) * churn * (0.7 + 0.5 * alto),
          STREAM_WIDTH * (0.26 + puff) * churn * alto,
          0, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.restore()

      // Las gotas que saltan. Tantas como se esté batiendo, por lo mismo que
      // el montículo: a plomo salpica, por la pared no.
      const drops = Math.round(SPLASH_DROPS * (0.45 + 0.55 * Math.min(1, f.foamFrac * 1.4)))
      for (let i = 0; i < drops; i++) {
        const life = ((f.t * 1.7 + i / SPLASH_DROPS) % 1)
        // Pseudoaleatorio estable por gota: mismo reparto en cada ciclo.
        const h = Math.sin(i * 12.9898) * 43758.5453
        const rnd = h - Math.floor(h)
        const h2 = Math.sin(i * 78.233 + 4.1) * 24634.6345
        const rnd2 = h2 - Math.floor(h2)
        const vx = (rnd - 0.5) * 2.3
        const vy = 0.6 + ((i * 7) % 5) * 0.2
        const d = S * (vx * life)
        const u = S * (vy * life - 0.5 * GRAV * life * life)
        const x = join.x + ct * d + upx * u
        const y = join.y + st * d + upy * u
        const r = (2.1 + ((i * 5) % 5) * 1.5) * (1 - life * 0.4)
        // Un tercio son cerveza y el resto espuma: lo que salta del choque es
        // la mezcla, no sólo la corona. Y las de cerveza se ven sobre el
        // blanco del montículo, que es donde las de espuma se pierden.
        ctx.fillStyle = rnd2 < 0.34
          ? rgba(BEER, 0.9 * (1 - life))
          : `rgba(255,255,255,${(0.85 * (1 - life)).toFixed(3)})`
        ctx.beginPath()
        ctx.arc(x, y, Math.max(0.4, r), 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.restore()
    }

    // ================================================================
    // Escala de referencia, a UN SOLO LADO, como las marcas de una probeta.
    //
    // Antes eran dos líneas discontinuas que cruzaban el vaso de lado a lado y
    // confundían: la de arriba se leía como el BORDE del vaso en vez de como
    // el nivel objetivo de cerveza. Cruzando el líquido, una raya parece una
    // frontera del recipiente; pegada a una pared, parece lo que es, una
    // graduación.
    //
    // Va en el lado contrario al que se sirve, para no comerse con la espuma
    // que rebosa, que siempre cae por el lado hacia el que tira la gravedad.
    // ================================================================
    const railSide = f.pourSide > 0 ? 1 : -1
    const railX = railSide * (W / 2 - W * 0.055)
    const inward = -railSide
    const yOfFill = (fill: number): number => (H / 2) * (1 - 2 * fill)

    // Graduación menor cada 10% de llenado. Grabada, discreta.
    ctx.setLineDash([])
    ctx.beginPath()
    for (let tick = 1; tick < 10; tick++) {
      const y = yOfFill(tick / 10)
      ctx.moveTo(railX, y)
      ctx.lineTo(railX + inward * W * (tick === 5 ? 0.05 : 0.028), y)
    }
    // Halo oscuro debajo y trazo claro encima, como la marca mayor: con un
    // solo trazo translúcido la graduación se leía sobre el fondo negro pero
    // desaparecía en cuanto le pasaba la cerveza por detrás. Está impresa en
    // el cristal, así que tiene que verse sobre lo que sea.
    ctx.strokeStyle = 'rgba(0,0,0,0.3)'
    ctx.lineWidth = 3
    ctx.stroke()
    ctx.strokeStyle = 'rgba(255,255,255,0.5)'
    ctx.lineWidth = 1.2
    ctx.stroke()

    // Marca mayor: el llenado objetivo. Como la línea de medida de un vaso de
    // verdad, da el destino sin dar instrucciones.
    const yMark = yOfFill(f.targetFill)
    ctx.beginPath()
    ctx.moveTo(railX, yMark)
    ctx.lineTo(railX + inward * W * 0.13, yMark)
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'
    ctx.lineWidth = 3.5
    ctx.stroke()
    ctx.strokeStyle = 'rgba(255,255,255,0.82)'
    ctx.lineWidth = 1.8
    ctx.stroke()

    // Y la flecha viva: **cuánto hay dentro**, leído contra la graduación.
    //
    // Antes marcaba a qué altura debería cortar la superficie esta pared si el
    // ángulo fuera el correcto, o sea el error de inclinación. Eso tenía dos
    // problemas: con el vaso muy tumbado la superficie corta la pared por
    // abajo, así que la flecha se quedaba pegada al suelo con el vaso ya
    // medio lleno —no marcaba ningún volumen mientras el líquido entraba—, y
    // encima decía lo mismo que la línea de referencia, sólo que peor.
    //
    // Ahora marca el nivel que tendría el líquido **con el vaso derecho**, que
    // es el volumen de verdad y la única lectura que no depende de cómo estés
    // sujetando el móvil. Sube desde el primer instante y se lee contra las
    // marcas de la graduación, que están en esa misma escala.
    if (f.fill > 0) {
      const yRef = yOfFill(f.fill)
      const w = W * 0.05
      ctx.beginPath()
      ctx.moveTo(railX, yRef)
      ctx.lineTo(railX + inward * w, yRef - w * 0.42)
      ctx.lineTo(railX + inward * w, yRef + w * 0.42)
      ctx.closePath()
      ctx.fillStyle = 'rgba(0,0,0,0.35)'
      ctx.fill()
      ctx.fillStyle = 'rgba(255,255,255,0.8)'
      ctx.fill()
    }

    // Aquí iba el logo grabado en el cristal. Lo ocupa ahora el ángulo, que
    // va en DOM —texto nítido gratis y `tabular-nums`— centrado en pantalla.

    ctx.restore()

    // ================================================================
    // El bisel del cristal, que ahora es el borde de la pantalla.
    // El desvío se comunica con la SATURACIÓN del brillo, que sube cuando
    // estás en tolerancia. Nada de rojo/verde de videojuego.
    // ================================================================
    const sat = 0.18 + 0.72 * Math.min(1, Math.max(0, f.quality))
    const inner = ctx.createLinearGradient(0, 0, 0, H)
    inner.addColorStop(0, `rgba(255,255,255,${(sat * 0.5).toFixed(3)})`)
    inner.addColorStop(0.5, 'rgba(255,255,255,0)')
    inner.addColorStop(1, `rgba(255,255,255,${(sat * 0.28).toFixed(3)})`)
    ctx.strokeStyle = inner
    ctx.lineWidth = 3
    ctx.strokeRect(1.5, 1.5, W - 3, H - 3)

    // Brillo que se desplaza 4-8 px con la inclinación, alineado con la
    // superficie: sin silueta de vaso, una franja vertical se lee como un
    // artefacto de degradado en vez de como un reflejo.
    const glint = Math.max(-1, Math.min(1, f.phi / 48)) * 8
    ctx.save()
    ctx.translate(cx + glint, cy)
    ctx.rotate(tilt)
    const gl = ctx.createLinearGradient(0, -R * 0.18, 0, R * 0.05)
    gl.addColorStop(0, 'rgba(255,255,255,0)')
    gl.addColorStop(0.6, `rgba(255,255,255,${(0.02 + 0.03 * sat).toFixed(3)})`)
    gl.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = gl
    ctx.fillRect(-R, -R, R * 2, R * 2)
    ctx.restore()

    // ================================================================
    // Espuma por FUERA del vaso.
    //
    // La pantalla es la cara frontal del cristal y la cerveza se ve a través
    // de él, así que lo que está por fuera va dibujado ENCIMA de todo, bisel
    // incluido. Es exactamente cómo se vería.
    //
    // Se va por el punto del borde que queda más bajo en el mundo, que es el
    // mismo por el que desborda: el borde superior de la pantalla es la boca,
    // y su punto más bajo es la esquina hacia la que tira la gravedad.
    // ================================================================
    {
      // Casi blanca: en la referencia apenas está teñida de cerveza.
      const FOAM_OUT = mix(FOAM, BEER, 0.11)
      ctx.save()
      ctx.translate(cx, cy)

      // ----------------------------------------------------------------
      // ¿Está pasando líquido por encima del borde? Lo decide la GEOMETRÍA,
      // no la señal del núcleo.
      //
      // (La bajada era de 0,06 por frame, casi 0,7 s hasta apagarse. Era la
      // parte más lenta de todo el derrame: la lengua no podía empezar a
      // secarse hasta que se apagara. A 0,12 quedan ~0,3 s, de sobra para
      // tapar el parpadeo del derrame autolimitado.)
      //
      // Antes se dibujaba a partir de `spillingOver` suavizada, y eso
      // producía dos mentiras: espuma asomando con el vaso derecho y el
      // líquido lejos del borde, y espuma que se quedaba pegada al canto
      // segundos después de enderezar. Si el líquido no llega al borde, no
      // sale nada; y punto.
      //
      // Reparto a lo largo del borde: sobre un vertedero el caudal por unidad
      // de ancho va con la **profundidad^1,5** del labio bajo la superficie,
      // así que el labio más bajo se lleva el grueso y el resto aporta cada
      // vez menos hasta donde la superficie corta el borde, donde es cero.
      // ----------------------------------------------------------------
      const RIM = 26
      const rimY = -H / 2
      const xs: number[] = []
      const ds: number[] = []
      let maxD = -Infinity
      for (let i = 0; i <= RIM; i++) {
        const x = -W / 2 + (W * i) / RIM
        // Profundidad del labio por debajo de la superficie del líquido.
        const d = (x - foamTop.x) * -st + (rimY - foamTop.y) * ct
        xs.push(x); ds.push(d)
        if (d > maxD) maxD = d
      }
      const wet = maxD > 0
      // Cuánto asoma: 4% del alto de pantalla ya es un rebose de los gordos.
      const raw = wet ? Math.min(1, maxD / (H * 0.04)) : 0
      this.#spill += (raw - this.#spill) * (raw > this.#spill ? 0.25 : 0.12)
      const strength = this.#spill
      // UN solo umbral para dibujar, para engendrar y para alimentar.
      //
      // Con dos umbrales distintos quedaba una franja en la que había rebose
      // —así que podía nacer una lengua— pero no alimento, así que la lengua
      // se consumía, moría, y nacía otra en el labio. Se ve como si la espuma
      // volviera a subir en lugar de acabar de caer.
      const over = strength > SPILL_ON

      // El perfil se guarda mientras haya rebose, y se reutiliza mientras se
      // desvanece: si no, la cortina se quedaría sin forma en cuanto el labio
      // deja de estar sumergido y volvería el parpadeo por otra vía.
      if (wet) this.#weir = ds.map((d) => (d > 0 ? Math.pow(d / maxD, 1.5) : 0))
      const weir = this.#weir.length === ds.length ? this.#weir : ds.map(() => 0)

      this.#spillInfo = over ? `caudal ${strength.toFixed(2)}` : 'no'

      // --- El copete que asoma por encima del labio ----------------------
      //
      // Es TODO lo que se dibuja del rebose. Antes de aquí salía además una
      // lengua que resbalaba por el cristal hasta la base; se quitó a
      // petición del estudio, después de cinco rondas de arreglos —no
      // deslizaba, salía cortada, volvía a subir, tardaba en secarse, no
      // cambiaba de lado— y de que ninguna quedara bien. El copete solo
      // cuenta lo mismo: hay líquido pasando por encima del borde.
      if (over) {
        const curtain = H * 0.055 * strength
        const front: number[][] = []
        for (let i = RIM; i >= 0; i--) {
          const jag = 1 + 0.16 * Math.sin(i * 1.7 - f.t * 2.2) + 0.09 * Math.sin(i * 4.1 + f.t * 1.4)
          front.push([xs[i]!, rimY + curtain * weir[i]! * jag])
        }
        ctx.save()
        ctx.beginPath()
        ctx.moveTo(-W / 2, rimY)
        ctx.lineTo(W / 2, rimY)
        smoothTo(ctx, front)
        ctx.closePath()
        // El tinte, y no una sombra, es lo que dice que esto está DELANTE del
        // cristal: detrás está la corona del propio vaso, también blanca, y
        // la sombra caía sobre ella dibujando un corte que no existe en un
        // líquido. Por fuera arrastra cerveza, así que queda más cálido.
        ctx.fillStyle = rgba(FOAM_OUT, 0.96)
        ctx.fill()
        ctx.restore()
      }
      ctx.restore()
    }
    // (La UI va en DOM, no en canvas: texto nítido gratis y no cuesta fillrate.)
  }

  dispose(): void { this.#bubbles = []; this.#foamBubbles = [] }
}
