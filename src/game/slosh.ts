/**
 * slosh.ts — chapoteo. Nada de simulación de fluidos.
 *
 * Dos osciladores armónicos amortiguados son los dos primeros modos de
 * chapoteo de un cilindro, y eso basta: lo que se ve en un vaso es el primer
 * modo con un poco del segundo encima.
 *
 * La frecuencia no se elige, sale de la física:
 *
 *     ω_n² = (g · k_n / R) · tanh(k_n · h / R)
 *
 * con `k_n` las raíces de J₁′ (la derivada de la función de Bessel de primer
 * orden), que es la condición de pared vertical impermeable. Para R = 32 mm y
 * una caña llena sale **3,78 Hz**, que es exactamente a lo que chapotea una
 * caña real.
 *
 * Se integra en el bucle fijo de 100 Hz. Con dt variable un oscilador a 3,8 Hz
 * explota: a 30 fps, ω·dt = 0,79 y el Euler semi-implícito deja de ser estable.
 */

/** Raíces de J₁′. Los dos primeros modos antisimétricos de un cilindro. */
export const J1_PRIME_ROOTS = [1.8412, 5.3314] as const
const G = 9.81

export interface SloshOptions {
  /** Radio del vaso en metros. */
  radiusM: number
  /** Amortiguamiento relativo. ~0,06 para cerveza en cristal. */
  damping?: number
  /** Cuánta inclinación de superficie produce un impulso, en grados por (°/s). */
  gain?: number
  /** Peso del segundo modo frente al primero. */
  mode2Weight?: number
}

export class Slosh {
  #r: number
  #zeta: number
  #gain: number
  #w2: number
  /** Desplazamiento y velocidad de cada modo. */
  #x = [0, 0]
  #v = [0, 0]
  #prevOmega = 0

  constructor(o: SloshOptions) {
    this.#r = o.radiusM
    this.#zeta = o.damping ?? 0.06
    this.#gain = o.gain ?? 0.05
    this.#w2 = o.mode2Weight ?? 0.35
  }

  /** Frecuencia natural del modo `n` (0 o 1) a una profundidad de líquido dada. */
  naturalHz(mode: number, depthM: number): number {
    const k = J1_PRIME_ROOTS[mode]!
    const w2 = (G * k / this.#r) * Math.tanh(Math.max(0.02, k * depthM / this.#r))
    return Math.sqrt(w2) / (2 * Math.PI)
  }

  /**
   * Un paso del bucle fijo.
   *
   * @param dt      segundos, siempre 0,01
   * @param omega   velocidad angular del vaso en °/s
   * @param depthM  profundidad del líquido en metros
   * @returns inclinación de la superficie del líquido en grados
   */
  step(dt: number, omega: number, depthM: number): number {
    // El líquido reacciona a que el vaso ACELERE, no a que se mueva.
    const impulse = -this.#gain * (omega - this.#prevOmega)
    this.#prevOmega = omega

    let out = 0
    for (let n = 0; n < 2; n++) {
      const k = J1_PRIME_ROOTS[n]!
      const w = Math.sqrt((G * k / this.#r) * Math.tanh(Math.max(0.02, k * depthM / this.#r)))
      const weight = n === 0 ? 1 : this.#w2
      this.#v[n]! += impulse * weight
      // Euler semi-implícito: estable mientras ω·dt < 1, y a 100 Hz con
      // ω = 23,8 rad/s vale 0,238. A 30 fps valdría 0,79 y se iría.
      const a = -2 * this.#zeta * w * this.#v[n]! - w * w * this.#x[n]!
      this.#v[n]! += a * dt
      this.#x[n]! += this.#v[n]! * dt
      out += this.#x[n]! * weight
    }
    return out
  }

  reset(): void { this.#x = [0, 0]; this.#v = [0, 0]; this.#prevOmega = 0 }
}
