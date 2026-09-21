/**
 * oneEuro.ts — filtro One Euro, SOLO para el número que se muestra.
 *
 * Plan §1.1: mincutoff 1,0 Hz, beta 0,007, y el readout refrescado a 12-15 Hz
 * en vez de a 60. Quieto, el número deja de bailar en la tercera cifra; en
 * movimiento, apenas añade retraso porque el corte sube con la velocidad.
 *
 * No toca la señal que va a la traza ni a la puntuación. Es cosmético a
 * propósito: un filtro adaptativo no es reproducible en el servidor.
 */
export class OneEuro {
  #minCutoff: number
  #beta: number
  #dCutoff: number
  #x: number | null = null
  #dx = 0
  #t: number | null = null

  constructor(minCutoff = 1.0, beta = 0.007, dCutoff = 1.0) {
    this.#minCutoff = minCutoff
    this.#beta = beta
    this.#dCutoff = dCutoff
  }

  /** α de un paso-bajo de primer orden. Sin trascendentes: sólo ÷ y +. */
  static alpha(cutoff: number, dt: number): number {
    const tau = 1 / (2 * Math.PI * cutoff)
    return 1 / (1 + tau / dt)
  }

  filter(x: number, t: number): number {
    if (this.#x === null || this.#t === null) { this.#x = x; this.#t = t; return x }
    const dt = (t - this.#t) / 1000
    this.#t = t
    if (dt <= 0) return this.#x

    const dxRaw = (x - this.#x) / dt
    this.#dx += OneEuro.alpha(this.#dCutoff, dt) * (dxRaw - this.#dx)

    const cutoff = this.#minCutoff + this.#beta * Math.abs(this.#dx)
    this.#x += OneEuro.alpha(cutoff, dt) * (x - this.#x)
    return this.#x
  }

  reset(): void { this.#x = null; this.#t = null; this.#dx = 0 }
}
