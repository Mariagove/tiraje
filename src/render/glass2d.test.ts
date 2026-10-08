import { describe, expect, it } from 'vitest'
import { areaBelow, gravityOnScreen, surfaceTilt, turbulencia, waveShape } from '@/render/glass2d'
import { ESPECIAL } from '@/core/baked/especial'

/** Rectángulo de semiancho w y semialto h, girado phi grados. */
function glass(w: number, h: number, phiDeg: number): number[][] {
  const p = phiDeg * Math.PI / 180
  const c = Math.cos(p), s = Math.sin(p)
  return [[-w, -h], [w, -h], [w, h], [-w, h]].map(([x, y]) => [x! * c - y! * s, x! * s + y! * c])
}

describe('el sentido de la inclinación', () => {
  it('con el móvil recto, la gravedad apunta abajo', () => {
    const g = gravityOnScreen(0)
    expect(g.x).toBeCloseTo(0, 9)
    expect(g.y).toBeCloseTo(1, 9)
  })

  it('inclinado a la IZQUIERDA (φ > 0), el líquido va a la esquina inferior izquierda', () => {
    // Éste es el bug que se vio en el iPhone: entraba por la esquina
    // contraria. Un vaso de verdad se llena por el lado hacia el que lo
    // inclinas, y φ es el giro del móvil en el plano de su pantalla.
    const g = gravityOnScreen(45)
    expect(g.x).toBeLessThan(0)      // hacia la izquierda
    expect(g.y).toBeGreaterThan(0)   // y hacia abajo
  })

  it('inclinado a la derecha (φ < 0), a la esquina inferior derecha', () => {
    const g = gravityOnScreen(-45)
    expect(g.x).toBeGreaterThan(0)
    expect(g.y).toBeGreaterThan(0)
  })

  it('al rotar el lienzo por surfaceTilt, su +y local ES la gravedad', () => {
    // Es la invariante de la que cuelga todo el dibujo del líquido: el
    // renderer rellena el +y local desde la superficie, así que ese eje tiene
    // que coincidir con la gravedad o el líquido sale por el lado que no es.
    for (const phi of [-70, -45, -12, 0, 12, 45, 70]) {
      const t = surfaceTilt(phi)
      const localY = { x: -Math.sin(t), y: Math.cos(t) }
      const g = gravityOnScreen(phi)
      expect(localY.x).toBeCloseTo(g.x, 9)
      expect(localY.y).toBeCloseTo(g.y, 9)
    }
  })

  it('la superficie es perpendicular a la gravedad', () => {
    for (const phi of [-60, -20, 0, 33, 71]) {
      const t = surfaceTilt(phi)
      const along = { x: Math.cos(t), y: Math.sin(t) }
      const g = gravityOnScreen(phi)
      expect(along.x * g.x + along.y * g.y).toBeCloseTo(0, 9)
    }
  })
})

describe('areaBelow — el nivel del líquido se resuelve por área, no por atajo', () => {
  it('el área total sale del zapatero', () => {
    expect(areaBelow(glass(30, 65, 0), -1e6)).toBeCloseTo(4 * 30 * 65, 6)
  })

  it('con el vaso vertical, la mitad es la mitad', () => {
    expect(areaBelow(glass(30, 65, 0), 0)).toBeCloseTo(2 * 30 * 65, 6)
  })

  it('inclinado, la recta por el centro sigue partiendo el vaso en dos', () => {
    // Una recta por el centroide de un rectángulo lo bisecta a cualquier
    // ángulo. Es la razón de que el atajo funcione en el tramo central.
    for (const phi of [0, 20, 48, 70]) {
      expect(areaBelow(glass(30, 65, phi), 0)).toBeCloseTo(2 * 30 * 65, 6)
    }
  })

  it('por encima del vaso el área es cero, por debajo es todo', () => {
    const g = glass(30, 65, 48)
    const ys = g.map((p) => p[1]!)
    expect(areaBelow(g, Math.max(...ys) + 1)).toBeCloseTo(0, 9)
    expect(areaBelow(g, Math.min(...ys) - 1)).toBeCloseTo(4 * 30 * 65, 6)
  })

  it('es monótona: subir el nivel nunca aumenta el área de debajo', () => {
    const g = glass(30, 65, 33)
    let prev = Infinity
    for (let y = -90; y <= 90; y += 1.5) {
      const a = areaBelow(g, y)
      expect(a).toBeLessThanOrEqual(prev + 1e-9)
      prev = a
    }
  })

  it('el atajo del punto del eje SE EQUIVOCA con el vaso casi vacío', () => {
    // Éste es el bug que se vio en pantalla: con f = 0 y el vaso a 48°, el
    // atajo dibujaba una cuña de cerveza en la esquina de abajo.
    const w = 30, h = 65, phi = 48
    const g = glass(w, h, phi)
    const total = 4 * w * h
    // El atajo pone la superficie en el punto del eje a la altura del llenado.
    const yShortcut = (f: number): number =>
      h * (1 - 2 * f) * Math.cos(phi * Math.PI / 180)
    const errAt = (f: number): number => areaBelow(g, yShortcut(f)) / total - f

    expect(Math.abs(errAt(0))).toBeGreaterThan(0.05)      // >5 puntos de vaso
    // Y en el tramo central es exacto, que es por lo que nadie lo nota hasta
    // que mira el vaso vacío.
    expect(Math.abs(errAt(0.5))).toBeLessThan(1e-9)
    expect(Math.abs(errAt(0.6))).toBeLessThan(1e-9)
  })
})

/** Media del perfil del oleaje a lo ancho de la pantalla, en un instante. */
function media(t: number): number {
  const N = 2000
  let sum = 0
  for (let i = 0; i < N; i++) sum += waveShape(-0.5 + i / N, t)
  return sum / N
}

/** El perfil muestreado en 64 puntos a lo ancho. */
function perfil(t: number): number[] {
  return Array.from({ length: 64 }, (_, i) => waveShape(-0.5 + i / 64, t))
}

describe('el oleaje', () => {
  it('no desplaza el nivel ni un píxel', () => {
    // Es LA invariante del oleaje, no un detalle: el nivel del líquido se
    // resuelve por área, así que la ondulación tiene que quitar por un lado
    // lo mismo que añade por el otro. Una constante o una función asimétrica
    // aquí harían que el llenado dibujado dejara de ser el que dice el
    // núcleo, y no lo notaría nadie hasta comparar con la marca grabada.
    //
    // Cero exacto no sale: las longitudes de onda no caben un número entero
    // de veces en el ancho del vaso, así que siempre queda un resto. Lo que
    // hay que acotar es lo que ese resto vale EN PÍXELES con la amplitud más
    // grande que llega a usar el renderer, `W · 0,010 · 1,5`.
    //
    // Medido: 0,101 de perfil normalizado, o sea 0,57 px sobre una pantalla
    // de 375. Los dos senos que había antes daban 0,79 px, así que las cuatro
    // octavas no sólo no empeoran esto: lo mejoran, porque hay más periodos
    // dentro de la ventana.
    const W = 375
    const ampMax = W * 0.010 * 1.5
    for (const t of [0, 0.37, 1.2, 4.9, 17.3, 41.6]) {
      expect(Math.abs(media(t)) * ampMax, `t=${t}`).toBeLessThan(1)
    }
  })

  it('no se repite: dos instantes separados nunca dan el mismo perfil', () => {
    // Con frecuencias en proporción simple el patrón vuelve, y se ve. Se
    // comprueba que dos instantes bastante separados difieren de verdad.
    const a = perfil(0)
    for (const t of [1.7, 3.3, 8.8, 25.1]) {
      const b = perfil(t)
      const d = a.reduce((m, v, i) => m + Math.abs(v - b[i]!), 0) / a.length
      expect(d, `t=${t}`).toBeGreaterThan(0.15)
    }
  })

  it('se mantiene acotado: nunca pasa de la suma de sus pesos', () => {
    let max = 0
    for (let k = 0; k < 4000; k++) {
      const v = Math.abs(waveShape((k % 97) / 97 - 0.5, k * 0.013))
      if (v > max) max = v
    }
    expect(max).toBeLessThanOrEqual(1)
  })
})

describe('turbulencia del chorro', () => {
  const fp = ESPECIAL.cfg.pour
  /** La misma recta que usa el núcleo: ángulo absoluto -> fracción de espuma. */
  const conAngulo = (phiDeg: number): number => {
    const a = Math.min(Math.abs(phiDeg), fp.foamRefDeg)
    return fp.foamUpright + (fp.foamTilted - fp.foamUpright) * (a / fp.foamRefDeg)
  }

  it('las tres fases, en orden: tumbado revuelve, recto no, cerrado nada', () => {
    // Es la progresión que pidió el estudio y la que de verdad ocurre: con el
    // vaso tumbado el chorro apuñala el líquido; al enderezar se forma corona
    // y el chorro cae sobre un colchón de espuma; con el grifo cerrado no
    // revuelve nadie.
    expect(turbulencia({ pouring: true, foamFrac: conAngulo(45) }, fp)).toBeCloseTo(1, 6)
    expect(turbulencia({ pouring: true, foamFrac: conAngulo(0) }, fp)).toBeCloseTo(0, 6)
    expect(turbulencia({ pouring: false, foamFrac: conAngulo(45) }, fp)).toBe(0)
  })

  it('baja de forma monótona conforme se endereza', () => {
    let previo = Infinity
    for (const phi of [45, 35, 25, 15, 8, 4, 0]) {
      const t = turbulencia({ pouring: true, foamFrac: conAngulo(phi) }, fp)
      expect(t, `${phi}°`).toBeLessThan(previo)
      previo = t
    }
  })

  it('se mantiene en 0..1 aunque la fracción se salga de rango', () => {
    for (const ff of [-1, 0, 0.5, 1, 99]) {
      const t = turbulencia({ pouring: true, foamFrac: ff }, fp)
      expect(t, `${ff}`).toBeGreaterThanOrEqual(0)
      expect(t, `${ff}`).toBeLessThanOrEqual(1)
    }
  })
})
