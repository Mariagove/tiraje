/**
 * types.ts — el contrato de capas, idéntico en WebGL y en el respaldo 2D.
 *
 * Plan §1.4. El orden no es decorativo: es lo que permite cambiar de renderer
 * en caliente sin que se note.
 *
 *   1. cristal trasero (refracción horneada)
 *   2. [dentro del recorte del interior]
 *        líquido + superficie · burbujas · banda de espuma · encaje en la pared
 *   3. cristal frontal (bisel, brillos, logo grabado)
 *   4. brillo que se desplaza 4-8 px con la inclinación
 *   5. UI en DOM, no en canvas
 */

/** Todo lo que el renderer necesita saber. No conoce el núcleo ni el sensor. */
export interface GlassFrame {
  /** Ángulo del vaso en grados, para DIBUJAR. La puntuación usa el entero. */
  phi: number
  rho: number
  /** Llenado total y parte que es espuma, 0..1. */
  fill: number
  foam: number
  /** Nivel máximo alcanzado. Es lo que deja el encaje en la pared. */
  lacing: number
  /** Ángulo objetivo actual, para la línea de referencia dentro del líquido. */
  targetPhi: number
  /**
   * Hacia qué lado se está sirviendo, +1 o −1.
   *
   * La puntuación trabaja con |φ|, así que servir inclinando a izquierda o a
   * derecha vale lo mismo y el objetivo horneado es una magnitud sin signo.
   * Pero la línea de referencia SÍ tiene lado: dibujada a +objetivo con el
   * móvil inclinado hacia el otro lado, sale espejada respecto al líquido.
   */
  pourSide: 1 | -1
  /** Altura de la marca grabada en el cristal. */
  targetFill: number
  /** Calidad instantánea 0..1. Sube la saturación del bisel. Nada de rojo/verde. */
  quality: number
  /** Inclinación de la superficie por chapoteo, en grados. */
  sloshDeg: number
  /** Si el grifo está abierto (para el chorro y las burbujas). */
  pouring: boolean
  /** Y si lo que cae es espuma en vez de cerveza. Cambia el color del chorro. */
  /**
   * Cuánto de lo que está cayendo se convierte en espuma, 0..1.
   *
   * Era un booleano, `pouringFoam`, porque había un tercer toque que conmutaba
   * el grifo a espuma. Ya no: el grifo echa siempre lo mismo y lo que cambia
   * con la inclinación es cuánta corona hace, así que el chorro se tiñe de
   * forma continua en vez de cambiar de golpe.
   */
  foamFrac: number
  /**
   * Si se está yendo líquido por el borde, por rebose o por exceso de
   * inclinación. Las dos causas son la misma cosa vista desde fuera —líquido
   * pasando por encima del borde— así que se dibujan igual.
   */
  spillingOver: boolean
  /** Segundos desde que arrancó la partida, para animaciones. */
  t: number
}

export interface GlassRenderer {
  readonly kind: 'webgl2' | 'canvas2d'
  resize(cssW: number, cssH: number, dpr: number): void
  draw(f: GlassFrame): void
  setTier(t: Tier): void
  dispose(): void
}

/** Plan §1.4: la simulación NUNCA cambia de tasa; sólo degrada el render. */
export interface Tier {
  level: 0 | 1 | 2 | 3
  bubbles: number
  animatedFoam: boolean
  maxDpr: number
  /** En el nivel 3 se abandona WebGL y se cambia a Canvas 2D. */
  forceCanvas2d: boolean
}

export const TIERS: readonly Tier[] = [
  { level: 0, bubbles: 84, animatedFoam: true, maxDpr: 2, forceCanvas2d: false },
  { level: 1, bubbles: 28, animatedFoam: true, maxDpr: 1.5, forceCanvas2d: false },
  { level: 2, bubbles: 0, animatedFoam: false, maxDpr: 1, forceCanvas2d: false },
  { level: 3, bubbles: 0, animatedFoam: false, maxDpr: 1, forceCanvas2d: true },
]
