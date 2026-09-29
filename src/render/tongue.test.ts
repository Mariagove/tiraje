import { describe, expect, it } from 'vitest'
import { Glass2D } from '@/render/glass2d'
import { ESPECIAL } from '@/core/baked/especial'
import type { GlassFrame } from '@/render/types'

/**
 * Banco de la lengua de derrame, sin DOM.
 *
 * El contexto 2D es un Proxy que traga todas las llamadas y sólo apunta los
 * `arc`, que es como se dibuja la lengua: una cadena de círculos. Con eso se
 * puede medir lo único que importa aquí —cuántos hay y dónde— sin pintar.
 *
 * Las burbujas también son arcos, así que se filtran por radio: las de la
 * lengua andan por los 25-40 px y las burbujas no pasan de 12.
 */
function bench() {
  let arcs: number[][] = []
  const ctx = new Proxy({}, {
    get(_t, k) {
      if (k === 'canvas') return { width: 375, height: 812 }
      if (k === 'arc') return (x: number, y: number, r: number) => { arcs.push([x, y, r]) }
      if (k === 'createLinearGradient' || k === 'createRadialGradient') {
        return () => ({ addColorStop() {} })
      }
      if (k === 'measureText') return () => ({ width: 10 })
      return () => {}
    },
    set: () => true,
  }) as unknown as CanvasRenderingContext2D
  const canvas = { width: 375, height: 812, style: {}, getContext: () => ctx } as unknown as HTMLCanvasElement

  const g = new Glass2D(canvas, ESPECIAL)
  g.resize(375, 812, 1)

  let t = 0
  /** Avanza `secs` a 60 fps y devuelve los círculos de lengua del último frame. */
  function run(phi: number, secs: number): number[][] {
    for (let i = 0; i < Math.round(secs * 60); i++) {
      t += 1 / 60
      arcs = []
      const f: GlassFrame = {
        phi, rho: 0, fill: 0.97, foam: 0.18, lacing: 0.97, targetPhi: 45,
        pourSide: phi >= 0 ? 1 : -1, targetFill: 0.9, quality: 0.8, sloshDeg: 0,
        pouring: false, pouringFoam: false, spillingOver: false, t,
      }
      g.draw(f)
    }
    return arcs.filter((a) => a[2]! > 12)
  }
  /** Frames hasta que no queda ni un círculo de lengua, o -1. */
  function until(phi: number, maxSecs: number): number {
    for (let i = 1; i <= Math.round(maxSecs * 60); i++) {
      if (run(phi, 1 / 60).length === 0) return i
    }
    return -1
  }
  return { run, until, info: () => g.spillInfo }
}

/**
 * Posición en x del ANCLA: el círculo más alto, el que está en el labio.
 *
 * Hay que mirar el ancla y no la nube entera, porque la punta de una lengua
 * vieja sigue a la gravedad del momento, así que se cruza al otro lado ella
 * sola y da el pego. El ancla no se mueve del labio por el que salió.
 */
function anchorX(cs: number[][]): number {
  return cs.reduce((a, c) => (c[1]! < a[1]! ? c : a))[0]!
}

describe('la lengua de derrame', () => {
  it('sale al inclinar el vaso lleno', () => {
    const b = bench()
    expect(b.run(-60, 2.5).length).toBeGreaterThan(3)
  })

  it('desaparece en menos de un segundo al enderezar', () => {
    // Antes se consumía a la velocidad a la que resbalaba —unos 6 puntos por
    // segundo sobre un recorrido de cien— y se quedaba pegada al cristal más
    // de diez segundos después de dejar de rebosar.
    const b = bench()
    b.run(-60, 2.5)
    const frames = b.until(0, 6)
    expect(frames).toBeGreaterThan(0)
    expect(frames / 60).toBeLessThan(1)
  })

  it('vuelve a derramar si se ladea al lado contrario', () => {
    // El fallo: la lengua del primer lado seguía contándose como alimentada
    // porque el vaso seguía rebosando (por el otro lado), no moría nunca y
    // ocupaba la única plaza. Por el lado nuevo no salía nada.
    const b = bench()
    // φ < 0 inclina a la derecha, así que el labio que rebosa es el derecho.
    const der = b.run(-60, 2.5)
    expect(anchorX(der)).toBeGreaterThan(0)

    // Y sale pronto: no vale que aparezca cuando la vieja acabe de secarse.
    let frames = -1
    for (let i = 1; i <= 120; i++) {
      const cs = b.run(60, 1 / 60)
      if (cs.length > 0 && anchorX(cs) < 0) { frames = i; break }
    }
    expect(frames).toBeGreaterThan(0)
    expect(frames / 60).toBeLessThan(1)
  })
})
