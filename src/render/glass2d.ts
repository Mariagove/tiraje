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

/** Paleta placeholder. Los tokens de marca reales no están en este Mac. */
const INK = '#0b0b0c'

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
 * Una lengua de espuma bajando por FUERA del vaso.
 *
 * El modelo sale de dos referencias del estudio, una foto y un vídeo, y las
 * dos son ciertas: **la diferencia es el caudal**.
 *
 *   - Poco caudal (la foto): reguero estrecho, ~20% del ancho del vaso, lento,
 *     con cuello fino y **bulbo redondeado en el extremo** —tensión
 *     superficial acumulando masa en el frente— que se para a medio camino.
 *   - Mucho caudal (el vídeo): **lámina ancha**, del 40 al 60% del ancho, de
 *     borde casi recto, **sin bulbo**, que recubre el vaso en un segundo y se
 *     va por abajo.
 *
 * Es la transición de rivulete a lámina: con poco flujo manda la tensión
 * superficial y el líquido se recoge en un hilo con cabeza; con mucho manda la
 * inercia y se extiende. `sheet` interpola entre las dos.
 *
 * Es la única parte del renderer con estado, y hace falta por dos motivos: el
 * recorrido ya depositado se queda pegado al cristal, y la punta avanza según
 * la gravedad **del instante**. Si el jugador endereza el móvil a media
 * caída, la lengua se dobla ahí — que es justo lo que haría.
 */
interface Tongue {
  /** Posición en el labio por la que salió. */
  anchor: number
  /** Recorrido depositado sobre el cristal. La punta es el último punto. */
  path: number[][]
  /** Radio base, en píxeles. */
  r: number
  /** Velocidad de la punta, px/s. Arranca muy lenta: es espesa. */
  v: number
  /** 0 = hilo con bulbo, 1 = lámina ancha. Lo fija el caudal del labio. */
  sheet: number
  /** Si la corona sigue alimentándola. */
  fed: boolean
  /** 1 → 0 una vez deja de alimentarse. */
  life: number
}

/**
 * Una sola lengua a la vez.
 *
 * En la referencia se ve un segundo bulto al otro lado del labio, pero es el
 * REFLEJO DEL CRISTAL, no espuma — lo aclaró el estudio. Sale una lengua, la
 * que se lleva el caudal; cuando muere puede salir otra.
 */
const MAX_TONGUES = 1

/** Separación entre puntos del recorrido. Con radios de ~30 px solapan de sobra. */
const TONGUE_STEP_PX = 8

/**
 * Perfil de grosor a lo largo de la lengua, de 0 en el labio a 1 en la punta.
 *
 * Con `sheet` a 0 sale el hilo de la foto: cuello que afina y bulbo capilar al
 * final. Con `sheet` a 1, la lámina del vídeo: ancho casi constante y sin
 * cabeza, porque a ese caudal la inercia gana a la tensión superficial.
 */
function tongueProfile(sN: number, sheet: number): number {
  const thread = 0.62 + 0.38 * Math.pow(1 - sN, 0.7)
  const neck = thread + (1 - thread) * sheet
  const bulb = sN > 0.8
    ? 1 + 1.25 * Math.pow((sN - 0.8) / 0.2, 1.5) * (1 - sheet)
    : 1
  return neck * bulb
}

interface Bubble {
  x: number
  y: number
  /** Radio base. El radio pintado crece conforme la burbuja sube. */
  r0: number
  /** Velocidad base de ascenso, px/s. Escala con el radio: flotabilidad. */
  v: number
}

/** Segmentos con que se traza la superficie ondulada. */
const WAVE_SEGMENTS = 72
/** Grosor del chorro en píxeles CSS. Una caña real entra bien gorda. */
const STREAM_WIDTH = 28
/** Segmentos de la cinta del chorro. */
const STREAM_SEGMENTS = 26
/** Gotas de la salpicadura. */
const SPLASH_DROPS = 26

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
  #seed = 12345
  /**
   * Actividad del vertido, 0..1, suavizada.
   *
   * Manda en cuántas burbujas hay y en lo gordas que son: entrando cerveza el
   * vaso burbujea, y al cerrar el grifo se va calmando en vez de cortarse de
   * golpe. También alimenta la amplitud del oleaje.
   */
  #activity = 0
  #tongues: Tongue[] = []
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
    this.#bubbles = Array.from({ length: this.#tier.bubbles }, () => {
      const r0 = 0.7 + this.#rnd() * 2.0
      return {
        x: (this.#rnd() - 0.5) * this.#w,
        y: (this.#rnd() - 0.5) * this.#h,
        r0,
        // Las gordas suben más rápido. No es exacto (la velocidad terminal de
        // una burbuja pequeña va con r²) pero es lo que se lee como cerveza.
        v: 16 + r0 * 16 + this.#rnd() * 14,
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
    const ctx = this.#ctx
    const W = this.#w
    const H = this.#h
    ctx.setTransform(this.#dpr, 0, 0, this.#dpr, 0, 0)
    ctx.fillStyle = INK
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
    // No es simulación: son dos senos de longitudes de onda distintas que se
    // baten. La amplitud sale del chapoteo —que sí es físico, dos osciladores
    // amortiguados— más un fondo mientras entra el chorro, que agita.
    //
    // Las ondas son simétricas respecto a la línea media, así que el área bajo
    // la superficie no cambia: el nivel resuelto por área sigue siendo exacto.
    // ================================================================
    const swell = Math.min(1, Math.abs(f.sloshDeg) / 2.5)
    const amp = W * 0.010 * (0.35 + 0.65 * swell + 0.5 * act)
    const k1 = (2 * Math.PI) / (W * 0.62)
    const k2 = (2 * Math.PI) / (W * 0.27)
    const ph1 = f.t * 2 * Math.PI * 2.1
    const ph2 = f.t * 2 * Math.PI * 3.6
    const wave = (u: number, scale: number): number =>
      amp * scale * (Math.sin(u * k1 + ph1) * 0.62 + Math.sin(u * k2 - ph2) * 0.38)

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
    const live = Math.round(this.#tier.bubbles * Math.max(0, Math.min(1, act * 1.15)))
    if (live > 0 && f.fill - f.foam > 0.01 && beerThickness > 6) {
      const grav = gravityOnScreen(f.phi)
      const dt = 1 / 60
      /** Distancia de un punto por debajo de la superficie de la cerveza. */
      const depth = (x: number, y: number): number =>
        (x - beerTop.x) * -st + (y - beerTop.y) * ct
      for (let i = 0; i < live; i++) {
        const b = this.#bubbles[i]!
        const sizeScale = 0.55 + 0.45 * act
        const d = depth(b.x, b.y)
        if (d < 1.5 || d > beerThickness + R) {
          // Reaparece repartida por la columna de cerveza.
          const along = (this.#rnd() - 0.5) * W * 1.1
          const deep = beerThickness * (0.35 + 0.65 * this.#rnd())
          b.x = beerTop.x + ct * along - st * deep
          b.y = beerTop.y + st * along + ct * deep
          continue
        }
        // Crecen conforme se acercan a la superficie: cae la presión y
        // coalescen. Es lo que las hace leerse como burbujas y no como puntos.
        const rise = 1 - Math.max(0, Math.min(1, d / beerThickness))
        const r = b.r0 * sizeScale * (1 + 1.1 * rise)
        b.x += -grav.x * b.v * sizeScale * dt
        b.y += -grav.y * b.v * sizeScale * dt
        ctx.beginPath()
        ctx.fillStyle = `rgba(255,255,255,${(0.16 + 0.26 * rise).toFixed(3)})`
        ctx.arc(b.x, b.y, r, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    // Burbujeo de la corona, sobre el borde ondulado de la espuma.
    if (f.foam > 0.0005 && this.#tier.animatedFoam) {
      const s0 = foamTop.x * ct + foamTop.y * st
      ctx.save()
      ctx.translate(foamTop.x, foamTop.y)
      ctx.rotate(tilt)
      ctx.fillStyle = 'rgba(255,255,255,0.55)'
      for (let i = 0; i < 30; i++) {
        const x = -W * 0.75 + ((i * 149 + (Math.floor(f.t * 8) % 11) * 13) % (W * 1.5))
        ctx.beginPath()
        ctx.arc(x, wave(x + s0, 1.35) + 2.5 + ((i * 37) % 7), 1 + (i % 3) * 0.7, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.restore()
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
      const entry = { x: 0, y: -H / 2 }

      // Cae según la gravedad hasta lo primero que encuentre: la superficie
      // del líquido, o la pared del vaso.
      const dir = { x: ct, y: st }
      const rel = { x: foamTop.x - entry.x, y: foamTop.y - entry.y }
      const den = grav.x * dir.y - grav.y * dir.x
      const tSurfRaw = Math.abs(den) < 1e-6
        ? Infinity : (rel.x * dir.y - rel.y * dir.x) / den
      const tSurf = tSurfRaw > 0 ? tSurfRaw : Infinity

      const wallX = grav.x < 0 ? -W / 2 : W / 2
      const tWallRaw = Math.abs(grav.x) < 1e-6 ? Infinity : (wallX - entry.x) / grav.x
      const tWall = tWallRaw > 0 ? tWallRaw : Infinity

      const hitsWall = tWall < tSurf
      const tEnd = Math.min(tSurf, tWall, R)
      const land = { x: entry.x + grav.x * tEnd, y: entry.y + grav.y * tEnd }

      /** Altura de la superficie sobre la vertical de un `x` dado. */
      const surfaceYAt = (x: number): number => Math.abs(ct) < 1e-6
        ? foamTop.y : foamTop.y + ((x - foamTop.x) * st) / ct

      const streamColor = f.pouringFoam ? FOAM : BEER

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
       * Volumen de cilindro: tres cintas concéntricas sobre la MISMA
       * ondulación, en vez de un degradado transversal.
       *
       * El degradado se calcula sobre la cuerda recta, así que con el chorro
       * ondulando el brillo se quedaba clavado en una línea, se salía de la
       * cinta por trozos, y el conjunto se leía como un palo con una raya.
       * Tres cintas desplazadas comparten la ondulación y la siguen.
       */
      const flow = (
        from: { x: number; y: number }, to: { x: number; y: number },
        w0: number, w1: number, wob: number, seed: number,
      ): void => {
        ribbon(from, to, w0, w1, wob, seed, rgba(streamColor, 0.95))
        ribbon(from, to, w0, w1, wob, seed, 'rgba(0,0,0,0.16)', 0.34, 0.3)
        ribbon(from, to, w0, w1, wob, seed, 'rgba(255,255,255,0.20)', -0.2, 0.26)
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
      ctx.save()
      ctx.translate(join.x, join.y)
      ctx.rotate(tilt)
      ctx.fillStyle = rgba(FOAM, 0.92)
      for (let lobe = 0; lobe < 3; lobe++) {
        const off = (lobe - 1) * STREAM_WIDTH * 0.52
        const puff = 0.08 * Math.sin(f.t * 17 + lobe * 2.1)
        ctx.beginPath()
        ctx.ellipse(off, -STREAM_WIDTH * 0.06 * lobe,
          STREAM_WIDTH * (0.62 + puff) * (lobe === 1 ? 1.25 : 1),
          STREAM_WIDTH * (0.30 + puff), 0, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.restore()

      for (let i = 0; i < SPLASH_DROPS; i++) {
        const life = ((f.t * 1.7 + i / SPLASH_DROPS) % 1)
        // Pseudoaleatorio estable por gota: mismo reparto en cada ciclo.
        const h = Math.sin(i * 12.9898) * 43758.5453
        const rnd = h - Math.floor(h)
        const vx = (rnd - 0.5) * 1.9
        const vy = 0.55 + ((i * 7) % 5) * 0.17
        const d = S * (vx * life)
        const u = S * (vy * life - 0.5 * GRAV * life * life)
        const x = join.x + ct * d + upx * u
        const y = join.y + st * d + upy * u
        const r = (1.8 + ((i * 5) % 5) * 1.0) * (1 - life * 0.45)
        ctx.fillStyle = `rgba(255,255,255,${(0.85 * (1 - life)).toFixed(3)})`
        ctx.beginPath()
        ctx.arc(x, y, Math.max(0.4, r), 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.restore()
    }

    // ================================================================
    // La línea de referencia: el ángulo objetivo.
    //
    // Va al ángulo objetivo CON EL SIGNO del lado por el que se sirve: el
    // objetivo horneado es una magnitud, y dibujarlo siempre en positivo lo
    // dejaba espejado al servir inclinando hacia el otro lado.
    // ================================================================
    if (f.pouring) {
      ctx.save()
      ctx.translate(beerTop.x, beerTop.y)
      ctx.rotate(surfaceTilt(f.pourSide * f.targetPhi))
      ctx.beginPath()
      ctx.moveTo(-R / 2, 0)
      ctx.lineTo(R / 2, 0)
      ctx.strokeStyle = 'rgba(0,0,0,0.30)'
      ctx.lineWidth = 4
      ctx.stroke()
      ctx.strokeStyle = 'rgba(255,255,255,0.62)'
      ctx.lineWidth = 2
      ctx.setLineDash([9, 7])
      ctx.stroke()
      ctx.restore()
    }

    // La marca grabada en el cristal, a la altura de llenado objetivo. Con la
    // pantalla llena queda SOBRE la cerveza; con el vaso vacío, sobre el
    // fondo. Un trazo claro con halo oscuro se lee en los dos casos.
    const yMark = (H / 2) * (1 - 2 * f.targetFill)
    ctx.beginPath()
    ctx.moveTo(-W / 2, yMark)
    ctx.lineTo(W / 2, yMark)
    ctx.setLineDash([])
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'
    ctx.lineWidth = 3
    ctx.stroke()
    ctx.strokeStyle = 'rgba(255,255,255,0.55)'
    ctx.lineWidth = 1
    ctx.setLineDash([3, 5])
    ctx.stroke()
    ctx.setLineDash([])

    // Logo grabado, placeholder.
    const sat = 0.18 + 0.72 * Math.min(1, Math.max(0, f.quality))
    ctx.fillStyle = `rgba(255,255,255,${(0.05 + 0.07 * sat).toFixed(3)})`
    ctx.font = `700 ${Math.round(W * 0.17)}px ui-sans-serif, system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.fillText('AMBAR', 0, H * 0.06)

    ctx.restore()

    // ================================================================
    // El bisel del cristal, que ahora es el borde de la pantalla.
    // El desvío se comunica con la SATURACIÓN del brillo, que sube cuando
    // estás en tolerancia. Nada de rojo/verde de videojuego.
    // ================================================================
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
      const FOAM_OUT = mix(FOAM, BEER, 0.05)
      ctx.save()
      ctx.translate(cx, cy)

      // ----------------------------------------------------------------
      // ¿Está pasando líquido por encima del borde? Lo decide la GEOMETRÍA,
      // no la señal del núcleo.
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
      this.#spill += (raw - this.#spill) * (raw > this.#spill ? 0.25 : 0.06)
      const strength = this.#spill
      const over = strength > 0.02

      // El perfil se guarda mientras haya rebose, y se reutiliza mientras se
      // desvanece: si no, la cortina se quedaría sin forma en cuanto el labio
      // deja de estar sumergido y volvería el parpadeo por otra vía.
      if (wet) this.#weir = ds.map((d) => (d > 0 ? Math.pow(d / maxD, 1.5) : 0))
      const weir = this.#weir.length === ds.length ? this.#weir : ds.map(() => 0)

      const grav = gravityOnScreen(f.phi)
      const dt = 1 / 60

      this.#spillInfo = over
        ? `caudal ${strength.toFixed(2)}` +
          (this.#tongues.length > 0
            ? ` · lengua ${(this.#tongues[0]!.r * 2).toFixed(0)}px (${((this.#tongues[0]!.r * 2 / W) * 100).toFixed(0)}% del vaso)` +
              ` · lámina ${this.#tongues[0]!.sheet.toFixed(2)}`
            : ' · sin lengua')
        : this.#tongues.length > 0 ? 'escurriendo' : 'no'

      // --- El copete que asoma por encima del labio ----------------------
      if (over) {
        const curtain = H * 0.055 * strength
        const front: number[][] = []
        for (let i = RIM; i >= 0; i--) {
          const jag = 1 + 0.16 * Math.sin(i * 1.7 - f.t * 2.2) + 0.09 * Math.sin(i * 4.1 + f.t * 1.4)
          front.push([xs[i]!, rimY + curtain * weir[i]! * jag])
        }
        ctx.save()
        ctx.shadowColor = 'rgba(0,0,0,0.42)'
        ctx.shadowBlur = 7
        ctx.shadowOffsetY = 3
        ctx.beginPath()
        ctx.moveTo(-W / 2, rimY)
        ctx.lineTo(W / 2, rimY)
        smoothTo(ctx, front)
        ctx.closePath()
        ctx.fillStyle = rgba(FOAM_OUT, 0.96)
        ctx.fill()
        ctx.restore()

        // Nace dentro de la franja del labio con más caudal, en su punto más
        // interior. No en el máximo exacto: ése es la esquina, y una lengua
        // que nace en la esquina se va medio fuera de pantalla en cuanto la
        // gravedad la empuja. El rebose ocurre sobre un TRAMO del labio, no
        // sobre un punto, así que elegir el borde interior de ese tramo es
        // igual de cierto y se ve entero.
        if (this.#tongues.length < MAX_TONGUES) {
          const MIN_FLOW = 0.65
          let best = -1
          for (let i = 0; i <= RIM; i++) {
            if (weir[i]! < MIN_FLOW) continue
            if (this.#tongues.some((t) => Math.abs(t.anchor - xs[i]!) < W * 0.2)) continue
            if (best < 0 || Math.abs(xs[i]!) < Math.abs(xs[best]!)) best = i
          }
          // Sin azar cuando no hay ninguna: si está rebosando tiene que
          // haber lengua. El 3% por frame que había antes dejaba huecos de
          // varios segundos con el caudal al máximo y nada en pantalla.
          if (best >= 0 && (this.#tongues.length === 0 || this.#rnd() < 0.03)) {
            const x = xs[best]!
            this.#tongues.push({
              anchor: x,
              path: [[x, rimY], [x + grav.x * 4, rimY + grav.y * 4]],
              // Al ancho de la PANTALLA, no a píxeles fijos, y muy sensible al
              // caudal: un quinto del vaso con poco, la mitad con mucho.
              r: W * (0.035 + 0.05 * weir[best]!) * (0.8 + 2.2 * strength),
              v: 6,
              sheet: strength,
              fed: true,
              life: 1,
            })
          }
        }
      }

      // --- Las lenguas ---------------------------------------------------
      ctx.save()
      ctx.shadowColor = 'rgba(0,0,0,0.4)'
      ctx.shadowBlur = 8
      for (let i = this.#tongues.length - 1; i >= 0; i--) {
        const t = this.#tongues[i]!

        // ¿La sigue alimentando la corona? Se mira el caudal del labio en su
        // propia posición, no en general.
        // Se alimenta de la intensidad suavizada, no del booleano crudo: con
        // el derrame autolimitándose, la lengua se moría y renacía varias
        // veces por segundo.
        t.fed = strength > 0.08
        if (t.fed) {
          // Se ENSANCHA mientras la alimenten. El caudal crece conforme sube
          // el nivel, y la lengua nace en cuanto asoma el primer hilo: si el
          // radio se congela al nacer, se queda fina para siempre por mucho
          // que después esté rebosando a chorro.
          const rWanted = W * 0.068 * (0.8 + 2.2 * strength)
          t.r += (rWanted - t.r) * 0.03
          t.sheet += (strength - t.sheet) * 0.03
        } else {
          t.life -= dt / 3.2
        }

        // La punta avanza según la gravedad ACTUAL. Un hilo repta; una lámina
        // baja rápido — en el vídeo recubre el vaso en poco más de un segundo.
        t.v = Math.min(52 + 200 * t.sheet, t.v + (20 + 220 * t.sheet) * dt)
        const tip = t.path[t.path.length - 1]!
        tip[0]! += grav.x * t.v * dt
        tip[1]! += grav.y * t.v * dt

        // Se deposita un punto nuevo cuando la punta se ha separado lo
        // suficiente **del último punto YA DEPOSITADO**, no de sí misma.
        //
        // Ésa era la comparación mal hecha: medía lo que avanza la punta en
        // un frame, unos 0,87 px, que nunca llega al umbral. No se depositaba
        // nada, el recorrido se quedaba en dos puntos —el ancla en el labio y
        // la punta— y se dibujaban dos círculos sueltos: uno clavado en el
        // borde y otro alejándose. De ahí los dos síntomas a la vez, que la
        // lengua no deslizaba y que salía cortada.
        const prev = t.path[t.path.length - 2]
        if (prev && Math.hypot(tip[0]! - prev[0]!, tip[1]! - prev[1]!) > TONGUE_STEP_PX
            && t.path.length < 140) {
          t.path.push([tip[0]!, tip[1]!])
        }

        const last = t.path[t.path.length - 1]!
        if (t.life <= 0 || last[1]! > H / 2 + 40 || Math.abs(last[0]!) > W / 2 + 40) {
          this.#tongues.splice(i, 1)
          continue
        }

        // Se dibuja como una cadena de círculos en UN SOLO path: la unión sale
        // suave y sin costuras, y el bulbo del extremo es sólo un radio mayor.
        const n = t.path.length
        const fade = Math.min(1, t.life * 1.4)
        ctx.beginPath()
        for (let j = 0; j < n; j++) {
          const sN = n > 1 ? j / (n - 1) : 0
          const r = t.r * tongueProfile(sN, t.sheet) * (t.fed ? 1 : 0.55 + 0.45 * t.life)
          const p = t.path[j]!
          ctx.moveTo(p[0]! + r, p[1]!)
          ctx.arc(p[0]!, p[1]!, r, 0, Math.PI * 2)
        }
        ctx.fillStyle = rgba(FOAM_OUT, 0.95 * fade)
        ctx.fill()
      }
      ctx.restore()
      ctx.restore()
    }
    // (La UI va en DOM, no en canvas: texto nítido gratis y no cuesta fillrate.)
  }

  dispose(): void { this.#bubbles = []; this.#tongues = [] }
}
