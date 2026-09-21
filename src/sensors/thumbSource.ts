/**
 * thumbSource.ts — control alternativo para cuando no hay sensor.
 *
 * Plan §1.7. **Arrastre vertical del pulgar, no un slider**: un slider es una
 * interfaz, un arrastre es un gesto, y el gesto conserva algo de la metáfora.
 *
 * Genera un `û` sintético y entra por el mismo `AngleSource` que el sensor, así
 * que el bucle, el núcleo y el renderer no saben de dónde viene el ángulo.
 *
 * Dos cosas que no son decorativas:
 *
 *   - Lleva ruido determinista de 0,15° RMS. Sin él, el número de 3 decimales
 *     se queda clavado en `48.000°` y delata que esto no es una medida.
 *   - Sus puntuaciones van a un ranking **de práctica**, nunca al oficial. No
 *     se fusionan: un dedo no compite con un pulso.
 */
import type { Angles } from './fusion'

/** Recorrido del arrastre, en píxeles, para barrer todo el rango de ángulo. */
const DRAG_PX_FULL_RANGE = 340
const PHI_MAX = 75
const NOISE_RMS_DEG = 0.15

export class ThumbSource {
  readonly kind = 'thumb' as const
  /** El bucle sólo necesita esto; con el dedo el gate de reposo pasa siempre. */
  accelMag = 9.81
  omegaMag = 0

  #phi = 48
  #base = 48
  #dragFrom: number | null = null
  #seed = 987654321
  #detach: () => void

  constructor(target: HTMLElement) {
    const down = (e: PointerEvent): void => { this.#dragFrom = e.clientY; this.#base = this.#phi }
    const move = (e: PointerEvent): void => {
      if (this.#dragFrom === null) return
      // Arrastrar hacia arriba endereza el vaso, que es el gesto natural.
      const dy = e.clientY - this.#dragFrom
      const next = this.#base + (dy / DRAG_PX_FULL_RANGE) * PHI_MAX * 2
      // Se permite el rango completo, negativo incluido: servir inclinando a
      // un lado o al otro vale lo mismo, y así el modo práctica también
      // ejercita el lado negativo.
      this.#phi = Math.max(-PHI_MAX, Math.min(PHI_MAX, next))
    }
    const up = (): void => { this.#dragFrom = null }

    target.addEventListener('pointerdown', down)
    target.addEventListener('pointermove', move)
    target.addEventListener('pointerup', up)
    target.addEventListener('pointercancel', up)
    this.#detach = () => {
      target.removeEventListener('pointerdown', down)
      target.removeEventListener('pointermove', move)
      target.removeEventListener('pointerup', up)
      target.removeEventListener('pointercancel', up)
    }
  }

  /** Ruido reproducible: dos uniformes sumadas se acercan a una normal. */
  #noise(): number {
    const r = (): number => {
      this.#seed = (this.#seed * 1103515245 + 12345) & 0x7fffffff
      return this.#seed / 0x7fffffff - 0.5
    }
    return (r() + r()) * NOISE_RMS_DEG * 1.73
  }

  sampleAt(): Angles | null {
    return { phi: this.#phi + this.#noise(), rho: this.#noise() * 0.5 }
  }

  calibrateRoll(): number { return 0 }
  dispose(): void { this.#detach() }
}
