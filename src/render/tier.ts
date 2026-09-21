/**
 * tier.ts — escalado adaptativo por media móvil de 30 frames.
 *
 * Plan §1.4: 60 fps en iPhone 8 / Galaxy A50, suelo de 30 fps por debajo.
 * Cuando el tiempo de frame medio pasa de 20 ms se baja un escalón:
 * burbujas 40 → 12 → 0, espuma animada → estática, DPR → 1.0, y en último
 * extremo el cambio a Canvas 2D.
 *
 * **Sólo baja, nunca sube.** Subir de vuelta produce oscilación: se recupera
 * el frame rate al degradar, se vuelve a subir, se vuelve a caer, y el juego
 * parpadea entre dos calidades. Un juego de 15 segundos no necesita recuperar
 * la calidad; necesita no dar tirones.
 */
import { TIERS, type Tier } from './types'

export const WINDOW_FRAMES = 30
export const DEGRADE_ABOVE_MS = 20

export class TierController {
  #times: number[] = []
  #i = 0
  #n = 0
  #level: 0 | 1 | 2 | 3 = 0
  #sinceChange = 0

  get tier(): Tier { return TIERS[this.#level]! }
  get level(): number { return this.#level }
  get meanFrameMs(): number {
    if (this.#n === 0) return 0
    let s = 0
    for (let k = 0; k < this.#n; k++) s += this.#times[k]!
    return s / this.#n
  }

  /** @returns true si el escalón ha cambiado en este frame. */
  sample(frameMs: number): boolean {
    this.#times[this.#i] = frameMs
    this.#i = (this.#i + 1) % WINDOW_FRAMES
    if (this.#n < WINDOW_FRAMES) this.#n++
    this.#sinceChange++

    // Ventana llena y un margen tras el último cambio: degradar cuesta un
    // frame caro por sí mismo (recrear buffers), y sin la espera se
    // desencadenaría en cascada hasta el nivel 3 en tres frames.
    if (this.#n < WINDOW_FRAMES || this.#sinceChange < WINDOW_FRAMES) return false
    if (this.meanFrameMs <= DEGRADE_ABOVE_MS || this.#level >= 3) return false

    this.#level = (this.#level + 1) as 0 | 1 | 2 | 3
    this.#sinceChange = 0
    this.#n = 0
    this.#i = 0
    return true
  }

  /** Fallo de creación del contexto WebGL: al fondo directamente. */
  forceCanvas2d(): void { this.#level = 3; this.#sinceChange = 0 }

  reset(): void { this.#times = []; this.#i = 0; this.#n = 0; this.#level = 0; this.#sinceChange = 0 }
}
