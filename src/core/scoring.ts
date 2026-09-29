/**
 * scoring.ts — el núcleo. Define el juego.
 *
 * Módulo puro, compartido cliente/servidor. **Sin funciones trascendentes.**
 *
 * Por qué importa aunque en la fase 1 no haya servidor: las trascendentes no
 * son bit-idénticas entre JavaScriptCore y V8; `+ − × ÷ sqrt` sí lo son. En la
 * fase 2 el servidor recalcula la puntuación desde la traza e ignora la que
 * manda el cliente. Una sola trascendente aquí rompe ese recálculo, y no se ve
 * hasta que hay una disputa por un premio.
 *
 * Cómo se consigue, en dos piezas:
 *
 *   1. Toda la geometría (derrame, curva objetivo, gaussianas) se hornea en
 *      tablas de literales dobles — `tools/bake-tables.ts`, que sí usa
 *      trascendentes porque corre una vez en build.
 *   2. La entrada llega YA CUANTIZADA a décimas de grado enteras. La capa de
 *      sensores es la única que llama a atan2, y lo que guarda en la traza es
 *      el entero. El servidor reproduce exactamente los mismos enteros, así
 *      que una diferencia de 1 ulp entre motores deja de poder cambiar nada.
 *
 * Hay un test que hace grep de este directorio buscando trascendentes. Suena
 * tosco y es lo que impide que esto se erosione.
 */
import type { BakedVariety } from './types.ts'

export const STEP_MS = 10
export const STEP_S = 0.01

/**
 * Ventana de blanking del toque (plan §1.2).
 *
 * Tocar la pantalla sacude el móvil justo en el instante de máxima precisión:
 * un toque mete un transitorio de 1,5-4° durante 120-200 ms. Sin esto, se
 * castiga al jugador por jugar.
 *
 * Va DENTRO del núcleo, no en la capa de presentación, para que el servidor
 * lo reproduzca igual. El chapoteo visual sí recibe el impulso, porque es
 * bonito y es honesto: lo que se congela es la puntuación, no la imagen.
 */
export const TAP_BLANKING_MS = 180
export const BLANKING_MEAN_WINDOW_MS = 100

const BLANKING_STEPS = TAP_BLANKING_MS / STEP_MS
const MEAN_WINDOW_STEPS = BLANKING_MEAN_WINDOW_MS / STEP_MS

export type Phase = 'ready' | 'beer' | 'foam' | 'closed'

/** Una muestra de traza: lo que la capa de sensores deja cruzar la frontera. */
export interface TraceSample {
  /** Ángulo de vertido en décimas de grado. Entero. */
  phiDdeg: number
  /** Ladeo lateral en décimas de grado, ya calibrado. Entero. */
  rhoDdeg: number
}

export interface ScoreState {
  phase: Phase
  steps: number
  /** Llenado total (cerveza + espuma), 0..1+. */
  f: number
  /** Parte del llenado que es espuma. */
  foam: number
  /** Fracción de vaso derramada en total. */
  spilled: number
  spilling: boolean
  /** Rebosando por arriba. Es otro derrame, con otra causa. */
  overflowing: boolean
  spillEvents: number
  points: number
  stepsBeer: number
  stepsFoam: number
  prevPhiDdeg: number | null
  /** Suma de la calidad lateral, para la limpieza. */
  rhoSum: number
  rhoCount: number
  /** Suma del error en grados enteros, para el resumen del resultado. */
  errSum: number
  errCount: number
  // Blanking
  qRing: number[]
  qRingLen: number
  qRingIdx: number
  blankingLeft: number
  blankedQ: number
  /** Calidad usada en el último paso, 0..1. La lee el bisel; no puntúa. */
  lastQuality: number
  /** Objetivo del último paso en décimas de grado. La línea de referencia. */
  lastTargetDdeg: number
  /**
   * Resultado congelado en el tercer toque.
   *
   * **La puntuación es la que hay al cerrar el grifo**, no la del final del
   * reposo. Lo que pase después —que el vaso rebosado se asiente y pierda
   * nivel— es física, y la física de después no puede cambiar lo que ya
   * hiciste. Congelarlo aquí es además lo que permite que el vaso se vacíe en
   * pantalla sin tocar el marcador.
   */
  result: ScoreResult | null
  /** Si estaba rebosando en el instante de cerrar. Decide si se asienta. */
  overflowedAtClose: boolean
}

export function createState(): ScoreState {
  return {
    phase: 'ready', steps: 0, f: 0, foam: 0, spilled: 0,
    spilling: false, overflowing: false, spillEvents: 0, points: 0,
    stepsBeer: 0, stepsFoam: 0, prevPhiDdeg: null,
    rhoSum: 0, rhoCount: 0, errSum: 0, errCount: 0,
    qRing: Array.from<number>({ length: MEAN_WINDOW_STEPS }).fill(1),
    qRingLen: 0, qRingIdx: 0, blankingLeft: 0, blankedQ: 1,
    lastQuality: 1, lastTargetDdeg: 0, result: null, overflowedAtClose: false,
  }
}

const clampInt = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v)

/**
 * Se va `amount` de vaso por encima del borde.
 *
 * Lo que sale es lo de ARRIBA, o sea espuma antes que cerveza. Y sale del
 * vaso: baja el llenado. Antes el rebose dejaba `f` clavado en 1 y no tocaba
 * la espuma, así que se veía salir espuma sin fin mientras el vaso seguía
 * igual de lleno; y el derrame por inclinación bajaba el nivel pero dejaba la
 * corona intacta, que es al revés de lo que pasa.
 */
function loseOverRim(st: ScoreState, amount: number): void {
  st.f = st.f > amount ? st.f - amount : 0
  st.foam = st.foam > amount ? st.foam - amount : 0
  st.spilled += amount
}

/**
 * Un toque. Avanza la fase y abre la ventana de blanking.
 * `ready → beer → foam → closed`; más toques no hacen nada.
 */
export function tap(st: ScoreState): void {
  if (st.phase === 'closed') return

  // La calidad se congela en su media de los 100 ms previos, tomada AQUÍ,
  // antes de que llegue el temblor del propio toque.
  let sum = 0
  const n = st.qRingLen
  for (let i = 0; i < n; i++) sum += st.qRing[i]!
  st.blankedQ = n > 0 ? sum / n : 1
  st.blankingLeft = BLANKING_STEPS

  st.phase = st.phase === 'ready' ? 'beer' : st.phase === 'beer' ? 'foam' : 'closed'
}

/**
 * Un paso de simulación. dt es SIEMPRE 10 ms: cada paso aporta exactamente lo
 * mismo, así que un iPhone a 120 fps y un Android a 30 puntúan idéntico.
 */
export function step(v: BakedVariety, st: ScoreState, smp: TraceSample): void {
  st.steps++
  const { cfg } = v
  const p = cfg.pour
  const sc = cfg.scoring

  // --- El grifo acaba de cerrarse: se congela la puntuación ------------
  //
  // Nada se ha añadido desde el toque, así que este estado ES el del cierre.
  if (st.phase === 'closed' && st.result === null) {
    st.overflowedAtClose = st.overflowing || st.f >= 1
    st.result = computeResult(v, st)
  }

  // --- Asentamiento -----------------------------------------------------
  //
  // Un vaso que ha rebosado pierde nivel: la corona que sobresalía del borde
  // se va. Pasa DESPUÉS de congelar la puntuación, así que se ve en pantalla
  // y no toca el marcador.
  if (st.phase === 'closed' && st.overflowedAtClose) {
    const settled = 1 - cfg.settle.overflowSettleFrac
    if (st.f > settled) {
      loseOverRim(st, Math.min(cfg.settle.drainRatePerSec * STEP_S, st.f - settled))
    }
  }

  const fi = clampInt(((st.f * 1000 + 0.5) | 0), 0, 1000)
  const aPhi = smp.phiDdeg < 0 ? -smp.phiDdeg : smp.phiDdeg
  const target = v.TARGET_DDEG[fi]!
  st.lastTargetDdeg = target

  // --- Derrame ---------------------------------------------------------
  // Derrame ⟺ tan(φ) > (1 − f)·H/R, horneado en SPILL_DDEG.
  //
  // Sólo con el grifo abierto. Medido en una traza real de un iPhone: el
  // jugador cerró a los 15,09 s con el vaso al 85%, bajó el brazo, y el juego
  // le «derramó» el 23,6% del vaso en los cinco segundos siguientes — tres
  // eventos, los tres con el grifo ya cerrado, y CAÑA DERRAMADA con un error
  // medio de 2,5°, que es de buen jugador.
  //
  // El `SETTLE` de 2 s existe precisamente para poder bajar el brazo (plan
  // §Riesgos 6). Castigar ahí es castigar por jugar, igual que castigar el
  // temblor del propio toque: la ventana de puntuación acaba al cerrar.
  if (st.phase !== 'closed' && st.f > 0 && aPhi > v.SPILL_DDEG[fi]!) {
    if (!st.spilling) { st.spilling = true; st.spillEvents++ }
    loseOverRim(st, p.spillRatePerSec * STEP_S)
  } else {
    st.spilling = false
  }

  if (st.phase === 'beer' || st.phase === 'foam') {
    // --- Calidad instantánea ------------------------------------------
    const dErr = aPhi > target ? aPhi - target : target - aPhi
    const e = clampInt(((dErr + 5) / 10) | 0, 0, 29)
    const aRho = smp.rhoDdeg < 0 ? -smp.rhoDdeg : smp.rhoDdeg
    const q = v.GAUSS_E[e]!
    const r = v.RHO_Q[clampInt(((aRho + 5) / 10) | 0, 0, 90)]!

    // Velocidad angular: derivada de la propia traza, no del giróscopo. Así
    // el servidor obtiene el mismo número sin necesitar los datos crudos.
    let om = 0
    if (st.prevPhiDdeg !== null) {
      const d = smp.phiDdeg - st.prevPhiDdeg
      om = (d < 0 ? -d : d) * (1 / (10 * STEP_S))
    }
    const excess = om - v.omegaAllowedDegPerSec
    const s = v.OMEGA_Q[clampInt(excess > 0 ? ((excess + 0.5) | 0) : 0, 0, 200)]!

    const inst = q * r * s

    // --- Blanking -------------------------------------------------------
    let used: number
    if (st.blankingLeft > 0) {
      st.blankingLeft--
      used = st.blankedQ
      // El anillo también se congela: si no, al salir de la ventana la media
      // arrastraría precisamente el temblor que se quería excluir.
    } else {
      used = inst
      st.qRing[st.qRingIdx] = inst
      st.qRingIdx = (st.qRingIdx + 1) % MEAN_WINDOW_STEPS
      if (st.qRingLen < MEAN_WINDOW_STEPS) st.qRingLen++
    }

    st.lastQuality = used
    const rate = st.phase === 'beer' ? sc.pointsPerSecBeer : sc.pointsPerSecFoam
    st.points += rate * used * STEP_S

    st.rhoSum += r; st.rhoCount++
    st.errSum += e; st.errCount++

    // --- Caudal y espuma ------------------------------------------------
    if (st.phase === 'beer') {
      st.stepsBeer++
      // δ = grados de "demasiado recto". Enderezar antes de tiempo GENERA
      // ESPUMA: el castigo no es abstracto, te llena el vaso sin cerveza.
      const delta = target > aPhi ? (target - aPhi) / 10 : 0
      let frac = p.foamBase + p.foamPerDegree * delta
      if (frac > 1) frac = 1
      const dFoam = p.beerRatePerSec * frac * p.foamExpansion * STEP_S
      const dLiq = p.beerRatePerSec * (1 - frac) * STEP_S
      st.f += dLiq + dFoam
      st.foam += dFoam
    } else {
      st.stepsFoam++
      const dFoam = p.foamRatePerSec * p.foamExpansion * STEP_S
      st.f += dFoam
      st.foam += dFoam
    }
  }

  // Un vaso lleno no acepta más cerveza: la rebosa. Sin este tope `f` crece
  // sin límite y el resultado llega a decir «120% lleno», que además rompe el
  // bono de llenado y la marca grabada en el cristal.
  if (st.f > 1) {
    loseOverRim(st, st.f - 1)
    if (!st.overflowing) { st.overflowing = true; st.spillEvents++ }
  } else {
    // `else`, no `else if (st.f < 1)`. Tras recortar, `f` queda EXACTAMENTE
    // en 1, así que con el `else if` no se cumplía ninguna de las dos ramas y
    // `overflowing` se quedaba enganchado a true para siempre: el vaso seguía
    // rebosando en pantalla después de cerrar el grifo y de acabar la partida.
    st.overflowing = false
  }
  if (st.foam > st.f) st.foam = st.f

  st.prevPhiDdeg = smp.phiDdeg
}

export interface ScoreResult {
  /** Entero, siempre. Ordenar floats en un ranking con premios es pedir problemas. */
  score: number
  verdict: 'ok' | 'spilled'
  fill: number
  foam: number
  spilled: number
  spillEvents: number
  /** Para la pantalla de resultado: "error medio: 3°". */
  meanErrorDeg: number
  durationS: number
  breakdown: { pour: number; fill: number; foam: number; clean: number; penalty: number }
}

/**
 * La puntuación del estado ACTUAL. Úsese `finalize`, que respeta el congelado.
 */
function computeResult(v: BakedVariety, st: ScoreState): ScoreResult {
  const sc = v.cfg.scoring
  const t = v.cfg.targets

  const dFill = clampInt(
    Math.abs((((st.f * 100 + 0.5) | 0) - ((t.fill * 100 + 0.5) | 0))), 0, 100)
  const dFoam = clampInt(
    Math.abs((((st.foam * 100 + 0.5) | 0) - ((t.foam * 100 + 0.5) | 0))), 0, 100)

  const meanR = st.rhoCount > 0 ? st.rhoSum / st.rhoCount : 0
  const clean = meanR / (1 + st.spillEvents)

  const bFill = sc.bonusFill * v.FILL_Q[dFill]!
  const bFoam = sc.bonusFoam * v.FOAM_Q[dFoam]!
  const bClean = sc.bonusClean * clean

  // La penalización va en unidades de puntuación final, después del ×10:
  // el plan dice «−1.500 por evento», no −1.500 antes de multiplicar por diez.
  const penalty = sc.spillPenalty * st.spillEvents
  let raw = (st.points + bFill + bFoam + bClean) * sc.finalMultiplier - penalty
  if (raw < 0) raw = 0

  const spilledOut =
    st.spillEvents >= sc.spillMaxEvents || st.spilled > sc.spillMaxFrac
  if (spilledOut) raw *= sc.spilledMultiplier

  return {
    score: Math.round(raw),
    verdict: spilledOut ? 'spilled' : 'ok',
    fill: st.f,
    foam: st.foam,
    spilled: st.spilled,
    spillEvents: st.spillEvents,
    meanErrorDeg: st.errCount > 0 ? st.errSum / st.errCount : 0,
    durationS: st.steps * STEP_S,
    breakdown: {
      pour: st.points * sc.finalMultiplier,
      fill: bFill * sc.finalMultiplier,
      foam: bFoam * sc.finalMultiplier,
      clean: bClean * sc.finalMultiplier,
      penalty: -penalty,
    },
  }
}

/**
 * El resultado de la partida.
 *
 * Devuelve el congelado en el tercer toque si lo hay. Sólo calcula sobre el
 * estado actual cuando la partida no llegó a cerrarse.
 */
export function finalize(v: BakedVariety, st: ScoreState): ScoreResult {
  return st.result ?? computeResult(v, st)
}

// ---------------------------------------------------------------------------
// Reproducción
// ---------------------------------------------------------------------------

/** El formato que graba el móvil y que en la fase 2 sube al servidor. */
export interface GameTrace {
  version: 1
  varietyId: string
  stepMs: typeof STEP_MS
  /** Una muestra por paso de 10 ms. */
  samples: TraceSample[]
  /** Índice de paso de cada toque: abrir grifo, pasar a espuma, cerrar. */
  taps: number[]
  meta?: Record<string, unknown>
}

/**
 * Reproduce una traza completa. Es la misma función que llamará el servidor
 * de la fase 2 y la que usa el banco de pruebas de escritorio; si estas dos
 * dan resultados distintos, el bug está aquí y no en el móvil.
 */
export function replay(v: BakedVariety, trace: GameTrace): ScoreResult {
  const st = createState()
  const taps = new Set(trace.taps)
  for (let i = 0; i < trace.samples.length; i++) {
    if (taps.has(i)) tap(st)
    step(v, st, trace.samples[i]!)
  }
  return finalize(v, st)
}
