/**
 * loop.ts — timestep fijo, sampleAt, estados, y el bucle de verdad.
 *
 * Tres relojes (plan §1.2):
 *   - sensor: 30-60 Hz, irregular
 *   - requestAnimationFrame: 30 / 60 / 120
 *   - simulación: **100 Hz fijo, la única verdad**
 *
 * El acumulador de paso fijo es lo que hace que un iPhone a 120 fps y un
 * Android a 30 puntúen idéntico: cada paso aporta exactamente 10 ms.
 */
import {
  STEP_MS, STEP_S, createState, finalize, step, tap,
  type GameTrace, type ScoreResult, type ScoreState, type TraceSample,
} from '@/core/scoring'
import type { BakedVariety } from '@/core/types'
import { Slosh } from '@/game/slosh'
import { RestGate, REST_GATE, toDdeg, type Angles } from '@/sensors/fusion'
import type { GlassFrame } from '@/render/types'

export type GameState =
  | 'BOOT' | 'AGE_GATE' | 'GATE' | 'CALIBRATE' | 'READY'
  | 'POUR_BEER' | 'POUR_FOAM' | 'CLOSING' | 'SETTLE' | 'RESULT' | 'INITIALS'

/** El HUD del ángulo se desvanece en READY → POUR_BEER. */
export const HUD_FADE_MS = 250
/** Cola del caudal tras cerrar el grifo. */
export const CLOSING_MS = 150
/** Reposo antes del resultado. Y permite bajar el brazo. */
export const SETTLE_MS = 2000
/** Plan §Riesgos 6: fatiga del brazo a 45°. La partida se cierra sola. */
export const MAX_POUR_MS = 15_000
/** Nunca alcanzar más de esto de golpe tras un parón. */
export const MAX_CATCHUP_MS = 250
/** Por debajo de este ángulo no se cambia de lado de vertido. */
export const SIDE_HYSTERESIS_DEG = 8

/** Lo único que el bucle necesita de la capa de sensores. */
export interface AngleSource {
  sampleAt(t: number): Angles | null
  readonly accelMag: number
  readonly omegaMag: number
  calibrateRoll(): number
}

export interface LoopOptions {
  variety: BakedVariety
  source: AngleSource
  onState?: (s: GameState, prev: GameState) => void
  onResult?: (r: ScoreResult, trace: GameTrace) => void
}

export class GameLoop {
  #v: BakedVariety
  #src: AngleSource
  #onState: LoopOptions['onState']
  #onResult: LoopOptions['onResult']

  #state: GameState = 'CALIBRATE'
  #st: ScoreState = createState()
  #slosh: Slosh
  #gate = new RestGate()

  #simT = 0
  #acc = 0
  #lastFrame = 0
  #stateSince = 0
  #started = false
  #primed = false

  #samples: TraceSample[] = []
  #taps: number[] = []
  #pendingTap = false
  #pourSteps = 0

  #phi = 0
  #rho = 0
  #phiPrev = 0
  #sloshDeg = 0
  #lacing = 0
  #pourSide: 1 | -1 = 1
  #restHeld = 0
  #calibrated = false
  #result: ScoreResult | null = null
  #raf = 0

  constructor(o: LoopOptions) {
    this.#v = o.variety
    this.#src = o.source
    this.#onState = o.onState
    this.#onResult = o.onResult
    this.#slosh = new Slosh({ radiusM: o.variety.cfg.glass.radiusMm / 1000 })
  }

  get state(): GameState { return this.#state }
  get result(): ScoreResult | null { return this.#result }
  get scoreState(): Readonly<ScoreState> { return this.#st }
  get restProgress(): number { return Math.min(1, this.#restHeld / REST_GATE.holdMs) }
  get pourSide(): 1 | -1 { return this.#pourSide }
  /** ms desde que se entró en el estado actual. Para las transiciones. */
  get stateAgeMs(): number { return this.#simT - this.#stateSince }

  trace(): GameTrace {
    return {
      version: 1, varietyId: this.#v.id, stepMs: STEP_MS,
      samples: this.#samples, taps: this.#taps,
    }
  }

  #go(s: GameState): void {
    if (s === this.#state) return
    const prev = this.#state
    this.#state = s
    this.#stateSince = this.#simT
    this.#onState?.(s, prev)
  }

  /**
   * Un toque. Se encola y se aplica en el siguiente paso de simulación, no
   * aquí: así el índice del toque en la traza es exacto y el servidor lo
   * reproduce en el mismo paso.
   */
  queueTap(): void { this.#pendingTap = true }

  /** OTRA CAÑA. Cambio de estado, jamás una recarga: en iOS sería un prompt nuevo. */
  restart(): void {
    this.#st = createState()
    this.#samples = []
    this.#taps = []
    this.#pendingTap = false
    this.#pourSteps = 0
    this.#result = null
    this.#lacing = 0
    this.#slosh.reset()
    this.#go('READY')
  }

  start(): void {
    if (this.#started) return
    this.#started = true
    const pump = (now: number): void => {
      this.#raf = requestAnimationFrame(pump)
      this.advance(now)
    }
    this.#raf = requestAnimationFrame(pump)
  }

  stop(): void { cancelAnimationFrame(this.#raf); this.#started = false }

  /**
   * La bomba de paso fijo. Separada de `start` para poder llamarla desde un
   * test con un reloj falso: el bucle de un juego no se prueba con rAF.
   */
  advance(now: number): void {
    // El reloj de simulación tiene que nacer PEGADO al del llamante, porque
    // es el mismo reloj con el que la capa de sensores sella sus muestras.
    //
    // Arrancarlo en 0 no produce un desfase que se corrija: produce un
    // desfase CONSTANTE igual al tiempo que la página llevara abierta, y
    // `sampleAt` devuelve entonces la muestra más antigua del anillo. El
    // síntoma es un ángulo que no se corresponde con nada y que parece
    // tardar muchísimo en actualizarse. Se cebaba en `start()`, pero quien
    // conduce el bucle puede llamar a `advance()` directamente, así que se
    // ceba aquí, que es el único sitio por el que se pasa siempre.
    if (!this.#primed) {
      this.#primed = true
      this.#simT = now
      this.#stateSince = now
      this.#lastFrame = now
      return
    }
    this.#acc += Math.min(now - this.#lastFrame, MAX_CATCHUP_MS)
    this.#lastFrame = now

    while (this.#acc >= STEP_MS) {
      this.#acc -= STEP_MS
      this.#tick()
      this.#simT += STEP_MS
    }
  }

  #tick(): void {
    // `sampleAt` extrapola hacia delante con el giróscopo hasta 25 ms; no
    // interpola hacia atrás. Es lo que evita el escalonado a 120 fps.
    const a = this.#src.sampleAt(this.#simT)
    if (a) { this.#phiPrev = this.#phi; this.#phi = a.phi; this.#rho = a.rho }

    const omega = (this.#phi - this.#phiPrev) / STEP_S
    const depthM = Math.max(0, (this.#st.f - this.#st.foam)) *
      (this.#v.cfg.glass.heightMm / 1000)
    this.#sloshDeg = this.#slosh.step(STEP_S, omega, depthM)

    switch (this.#state) {
      case 'CALIBRATE': {
        // El gate de reposo es una MEJORA OPORTUNISTA, no una barrera.
        //
        // Bloquear el primer toque hasta tener 1,2 s de quietud se percibe
        // como que el juego está roto: tocas y no pasa nada. Así que si el
        // jugador toca, se abre el grifo con lo que haya — se calibra el roll
        // con el valor instantáneo, igual de acotado a ±10° — y si en cambio
        // espera, la calibración sale mejor. Nunca se le hace esperar.
        this.#restHeld = this.#gate.update(
          this.#simT, this.#src.accelMag, this.#src.omegaMag, this.#phi)
        if (this.#consumeTap()) { this.#open() }
        else if (this.#restHeld >= REST_GATE.holdMs) {
          // El roll sí se calibra, acotado a ±10°. El pitch nunca: el líquido
          // dibujado rota con el ángulo absoluto y el jugador se autocalibra
          // viéndolo.
          this.#src.calibrateRoll()
          this.#calibrated = true
          this.#go('READY')
        }
        break
      }

      case 'READY': {
        // Los primeros 3 s son el tutorial: el líquido ya responde a la
        // inclinación antes de abrir el grifo. No hay nada que explicar.
        if (this.#consumeTap()) this.#open()
        break
      }

      case 'POUR_BEER':
      case 'POUR_FOAM': {
        const t = this.#consumeTap()
        if (t) {
          this.#taps.push(this.#samples.length)
          tap(this.#st)
          this.#go(this.#st.phase === 'foam' ? 'POUR_FOAM' : 'CLOSING')
        } else if (this.#pourSteps * STEP_MS >= MAX_POUR_MS) {
          // Se cierra sola: 15 s con el brazo a 45° es el límite.
          this.#taps.push(this.#samples.length)
          tap(this.#st)
          if (this.#st.phase !== 'closed') { this.#taps.push(this.#samples.length); tap(this.#st) }
          this.#go('CLOSING')
        }
        this.#record()
        this.#pourSteps++
        break
      }

      case 'CLOSING': {
        this.#record()
        if (this.stateAgeMs >= CLOSING_MS) this.#go('SETTLE')
        break
      }

      case 'SETTLE': {
        this.#record()
        if (this.stateAgeMs >= SETTLE_MS) {
          this.#result = finalize(this.#v, this.#st)
          this.#onResult?.(this.#result, this.trace())
          this.#go('RESULT')
        }
        break
      }

      case 'RESULT': {
        if (this.#consumeTap()) this.#go('INITIALS')
        break
      }

      default: break
    }

    if (this.#st.f > this.#lacing) this.#lacing = this.#st.f

    // El lado por el que se sirve, con histéresis: por debajo de
    // HYSTERESIS_DEG se conserva el último, para que la línea de referencia
    // no dé un latigazo cada vez que el ángulo cruza el cero.
    if (this.#phi > SIDE_HYSTERESIS_DEG) this.#pourSide = 1
    else if (this.#phi < -SIDE_HYSTERESIS_DEG) this.#pourSide = -1
  }

  /** Abre el grifo. Entra aquí tanto desde READY como desde CALIBRATE. */
  #open(): void {
    if (!this.#calibrated) { this.#src.calibrateRoll(); this.#calibrated = true }
    this.#taps.push(0)
    tap(this.#st)
    this.#go('POUR_BEER')
  }

  #consumeTap(): boolean {
    if (!this.#pendingTap) return false
    this.#pendingTap = false
    return true
  }

  #record(): void {
    const smp: TraceSample = { phiDdeg: toDdeg(this.#phi), rhoDdeg: toDdeg(this.#rho) }
    this.#samples.push(smp)
    step(this.#v, this.#st, smp)
  }

  /** Lo que el renderer necesita. No le pasamos ni el núcleo ni el sensor. */
  frame(): GlassFrame {
    const pouring = this.#state === 'POUR_BEER' || this.#state === 'POUR_FOAM'
    return {
      phi: this.#phi,
      rho: this.#rho,
      fill: this.#st.f,
      foam: this.#st.foam,
      lacing: this.#lacing,
      targetPhi: this.#st.lastTargetDdeg / 10,
      pourSide: this.#pourSide,
      targetFill: this.#v.cfg.targets.fill,
      quality: this.#st.lastQuality,
      sloshDeg: this.#sloshDeg,
      pouring,
      pouringFoam: this.#state === 'POUR_FOAM',
      spillingOver: this.#st.spilling || this.#st.overflowing,
      t: this.#simT / 1000,
    }
  }
}
