import { describe, expect, it } from 'vitest'
import { areaBelow, gravityOnScreen, pixelEsLiquido, surfaceTilt } from '@/render/glass2d'

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

describe('qué hay detrás del logotipo', () => {
  // El logotipo flota sobre el lienzo y cambia de color según lo que tenga
  // detrás: calado en blanco sobre el rojo del vaso, en tinta de marca cuando
  // lo cubre la cerveza. La decisión se toma leyendo UN píxel, así que el
  // margen tiene que separar bien tres cosas.
  const BEER = [0xe8, 0xa3, 0x3d] as const
  const FOAM = [0xf4, 0xef, 0xe4] as const
  const FONDO = [0xb0, 0x2c, 0x31] as const

  it('el fondo del vaso no es líquido', () => {
    expect(pixelEsLiquido(...FONDO)).toBe(false)
  })

  it('la cerveza y la espuma sí lo son', () => {
    expect(pixelEsLiquido(...BEER)).toBe(true)
    expect(pixelEsLiquido(...FOAM)).toBe(true)
  })

  it('el bisel y el brillo sobre el fondo NO cuentan como líquido', () => {
    // Son velos blancos; el más fuerte que dibuja el renderer es del 5%.
    for (const a of [0.02, 0.05, 0.08]) {
      const veil = FONDO.map((c) => c + (255 - c) * a) as unknown as [number, number, number]
      expect(pixelEsLiquido(...veil), `velo al ${a * 100}%`).toBe(false)
    }
  })
})
