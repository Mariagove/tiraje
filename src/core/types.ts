/**
 * types.ts — el contrato de datos de una cerveza y el de las tablas horneadas.
 *
 * Regla dura del plan §1.5: **cero código por variedad**. Añadir una cerveza
 * es 1 JSON + 1 atlas WebP + 1 sonido, ni una línea de TypeScript.
 */

export interface VarietyConfig {
  id: string
  name: string
  /** Sólo cilindros por ahora. Un perfil no cilíndrico necesita rederivar la
   *  condición de derrame, que está escrita para radio constante. */
  glass: { heightMm: number; radiusMm: number }
  pour: {
    /** Caudal con el grifo en cerveza, fracción de vaso por segundo. */
    beerRatePerSec: number
    /** Cuánto volumen ocupa la espuma frente a la cerveza de la que sale. */
    foamExpansion: number
    /**
     * Cuánta espuma hace la cerveza que entra, según lo inclinado que esté el
     * vaso. Es una recta entre los dos extremos, sin fase de espuma aparte:
     * el grifo echa siempre lo mismo y lo que cambia es dónde cae.
     *
     *   - `foamTilted`: vaso tumbado a `foamRefDeg` o más. La cerveza resbala
     *     por la pared, casi no rompe y apenas hace corona.
     *   - `foamUpright`: vaso recto, 0°. La cerveza cae a plomo sobre la que
     *     ya hay, arrastra gas y se convierte en espuma.
     *
     * Entre medias se interpola linealmente. Nada de trascendentes: esto vive
     * en el núcleo determinista.
     */
    foamUpright: number
    foamTilted: number
    /** Ángulo, en grados, a partir del cual ya no baja más la espuma. */
    foamRefDeg: number
    /**
     * Fracción de vaso por segundo que se pierde derramando, **a 1° por
     * encima del límite**. El caudal crece con `exceso^1,5`, como un
     * vertedero: el caudal por unidad de ancho va con la potencia 3/2 de lo
     * sumergido que está el labio.
     *
     * Constante no vale: el caudal de entrada (~0,12 de vaso por segundo)
     * superaba al de salida, así que por mucho que te pasaras de inclinación
     * el vaso seguía llenándose y el nivel no bajaba nunca.
     */
    spillRatePerSec: number
  }
  targets: {
    /** Llenado total objetivo al cerrar el grifo. */
    fill: number
    /** Fracción del vaso que debe ser espuma (la corona). */
    foam: number
    /** Escala de la gaussiana del bono, en puntos porcentuales. */
    fillTolerancePp: number
    foamTolerancePp: number
  }
  /**
   * Qué pasa tras cerrar el grifo. NO afecta a la puntuación, que se congela
   * en el tercer toque: un vaso rebosado se asienta, y eso es después.
   */
  settle: {
    /** Fracción de vaso por segundo que se va mientras se asienta. */
    drainRatePerSec: number
    /** Cuánto baja el nivel un vaso que ha rebosado, antes de quedarse quieto. */
    overflowSettleFrac: number
  }
  /** Plan §1.3: la curva objetivo es la de derrame con margen. */
  difficulty: { kSafe: number; maxTargetDeg: number }
  /**
   * Gradiente del líquido (plan §1.5). Con la pantalla como vaso, la silueta
   * ya no distingue una cerveza de otra: el color es lo que las separa.
   * PLACEHOLDER — los valores reales salen de los tokens de marca y de la
   * fotografía del cristal.
   */
  look: { beer: [number, number, number]; foam: [number, number, number] }
  scoring: {
    sigmaDeg: number
    rhoScaleDeg: number
    omegaScaleDegPerSec: number
    pointsPerSecBeer: number
    bonusFill: number
    bonusFoam: number
    bonusClean: number
    finalMultiplier: number
    /**
     * Curva de respuesta de la nota: `nota = 100 · (bruto/techo)^gamma`.
     *
     * Con 1 la nota es la fracción del techo a secas. Por encima de 1 estira
     * la zona media —donde se amontonan los jugadores parecidos— y aprieta la
     * de arriba, así que el 100 exige una caña casi perfecta.
     *
     * Medido con ocho novatos simulados: con 1 sacaban de 63 a 79, con 2,2 de
     * 37 a 59. El mismo pulso, pero ocupando la escala en vez de amontonarse.
     */
    gamma: number
    spillPenalty: number
    spillMaxEvents: number
    spillMaxFrac: number
    spilledMultiplier: number
  }
}

/**
 * Lo que consume el runtime. Todo índice es entero y todo valor es un literal
 * doble: ni una trascendente sobrevive al horneado.
 */
export interface BakedVariety {
  id: string
  /** Ángulo objetivo en décimas de grado, indexado por llenado en por mil. */
  TARGET_DDEG: readonly number[]
  /** Ángulo de derrame en décimas de grado, mismo índice. */
  SPILL_DDEG: readonly number[]
  /** gauss(e/σ) para el error en grados enteros, 0..29. */
  GAUSS_E: readonly number[]
  /** gauss(|ρ|/rhoScale) para el ladeo en grados enteros, 0..90. */
  RHO_Q: readonly number[]
  /** gauss(exceso/omegaScale) para el exceso en °/s enteros, 0..200. */
  OMEGA_Q: readonly number[]
  /** gauss(Δllenado/tolerancia) en puntos porcentuales enteros, 0..100. */
  FILL_Q: readonly number[]
  FOAM_Q: readonly number[]
  /** Velocidad angular que la propia curva objetivo exige. Por encima, penaliza. */
  omegaAllowedDegPerSec: number
  /**
   * Techo teórico: la puntuación de una caña perfecta, calculada y no
   * supuesta. Sirve para expresar en fracción del máximo lo que el plan daba
   * en puntos absolutos, que dejan de significar nada en cuanto se toca un
   * caudal o una tarifa.
   */
  maxScore: number
  /**
   * La nota final, indexada por milésimas del techo: `NOTA[fracción·1000]`.
   *
   * Es una tabla y no una fórmula porque `Math.pow` es trascendental y el
   * núcleo no puede usarlas: no son bit-idénticas entre motores, y la fase 2
   * necesita que el servidor saque exactamente el mismo entero. Mismo motivo
   * por el que las gaussianas también están horneadas.
   */
  NOTA: readonly number[]
  cfg: VarietyConfig
}
