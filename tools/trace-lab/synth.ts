/**
 * synth.ts — generador de trazas sintéticas.
 *
 * Dos usos, y el segundo no es opcional:
 *
 *   1. Fixtures deterministas para el banco de pruebas, sin agitar un móvil.
 *   2. El generador de trazas falsas del plan §Antitrampa: «si no lo hacéis
 *      vosotros, lo hará otro y os enteraréis por Twitter». Por eso el temblor
 *      fisiológico de 8-12 Hz —la señal más discriminante contra una traza
 *      inventada— es un interruptor, para poder generar las dos clases y
 *      calibrar el detector contra ambas.
 *
 * Es un lazo cerrado: el jugador sintético lee el objetivo del estado actual
 * y el estado avanza con el ángulo que produce. No es una curva pregrabada.
 */
import {
  createState, finalize, step, tap,
  type GameTrace, type ScoreResult, type ScoreState, type TraceSample,
} from '../../src/core/scoring.ts'
import type { BakedVariety } from '../../src/core/types.ts'

export interface SynthOptions {
  /** Error constante en grados. Positivo = el jugador va demasiado recto. */
  biasDeg?: number
  /** Amplitud del vaivén lento, en grados (el jugador que corrige de más). */
  wobbleDeg?: number
  wobbleHz?: number
  /** Temblor fisiológico 8-12 Hz. Ponlo a 0 para simular una traza inventada. */
  tremorDeg?: number
  /** Ladeo lateral constante, en grados. */
  rhoDeg?: number
  /** Transitorio que mete el propio toque, en grados, durante 150 ms. */
  tapShakeDeg?: number
  seed?: number
  maxSteps?: number
}

/** Ruido reproducible. Un test que depende de `Math.random` no es un test. */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13; s >>>= 0
    s ^= s >>> 17
    s ^= s << 5; s >>>= 0
    return s / 0xffffffff - 0.5
  }
}

export function synthTrace(v: BakedVariety, o: SynthOptions = {}): GameTrace {
  const bias = o.biasDeg ?? 0
  const wobble = o.wobbleDeg ?? 0
  const wobbleHz = o.wobbleHz ?? 0.35
  const tremor = o.tremorDeg ?? 0.25
  const rho = o.rhoDeg ?? 0
  const shake = o.tapShakeDeg ?? 0
  const maxSteps = o.maxSteps ?? 2000
  const rnd = rng(o.seed ?? 20260921)

  const st: ScoreState = createState()
  const samples: TraceSample[] = []
  const taps: number[] = []
  const t = v.cfg.targets
  let shakeLeft = 0

  for (let i = 0; i < maxSteps; i++) {
    const sec = i * 0.01

    // --- Decisión de toque, antes de muestrear: igual que en `replay` -----
    let tapping = false
    if (st.phase === 'ready') tapping = true
    else if (st.phase === 'beer' && t.fill - st.f <= t.foam - st.foam) tapping = true
    else if (st.phase === 'foam' && st.f >= t.fill) tapping = true
    if (tapping) { taps.push(i); shakeLeft = 15 }

    // --- El ángulo que sostiene el jugador --------------------------------
    const fi = Math.min(1000, Math.max(0, Math.round(st.f * 1000)))
    let phi = v.TARGET_DDEG[fi]! / 10 - bias
    phi += wobble * Math.sin(2 * Math.PI * wobbleHz * sec)
    phi += tremor * Math.sin(2 * Math.PI * 9.5 * sec) + tremor * 0.4 * rnd()
    if (shakeLeft > 0) { phi += shake * (shakeLeft / 15); shakeLeft-- }
    if (phi < 0) phi = 0

    const smp: TraceSample = {
      phiDdeg: Math.round(phi * 10),
      rhoDdeg: Math.round((rho + tremor * 0.3 * rnd()) * 10),
    }
    samples.push(smp)

    if (tapping) tap(st)
    step(v, st, smp)
    if (st.phase === 'closed') break
  }

  return {
    version: 1, varietyId: v.id, stepMs: 10, samples, taps,
    meta: { synthetic: true, options: { ...o }, tremorHz: tremor > 0 ? 9.5 : 0 },
  }
}

/** Reproduce sin volver a generar. Útil para comprobar el lazo. */
export function scoreOf(v: BakedVariety, trace: GameTrace): ScoreResult {
  const st = createState()
  const taps = new Set(trace.taps)
  for (let i = 0; i < trace.samples.length; i++) {
    if (taps.has(i)) tap(st)
    step(v, st, trace.samples[i]!)
  }
  return finalize(v, st)
}

/** Los perfiles con nombre que usan los fixtures y el CLI. */
export const PROFILES: Record<string, SynthOptions> = {
  /** Clava el objetivo. Debe rozar el máximo teórico. */
  perfect: { biasDeg: 0, wobbleDeg: 0, tremorDeg: 0.15 },
  /** Buen jugador: corrige con retraso pero se mantiene en tolerancia. */
  good: { biasDeg: 1.2, wobbleDeg: 1.5, rhoDeg: 2, tapShakeDeg: 2.5 },
  /** Primera partida: se endereza antes de tiempo y se le llena de espuma. */
  mediocre: { biasDeg: 5.2, wobbleDeg: 3, rhoDeg: 5, tapShakeDeg: 3.5 },
  /** No endereza: derrama. */
  spiller: { biasDeg: -22, wobbleDeg: 2, rhoDeg: 6, tapShakeDeg: 3 },
  /** Traza inventada: sin temblor fisiológico. El antifraude debe cazarla. */
  fake: { biasDeg: 0, wobbleDeg: 0, tremorDeg: 0 },
}
