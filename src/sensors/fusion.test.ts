import { describe, expect, it } from 'vitest'
import {
  MAX_EXTRAPOLATION_MS, REST_GATE, RestGate, SignProbe, TraceBuffer,
  angleDiff, anglesFromUp, foldBeta, planarConfidence, toDdeg, upFromAccel,
  type Sample, type Vec3,
} from '@/sensors/fusion'

const D2R = Math.PI / 180
const G = 9.81

/**
 * "Arriba del mundo" visto desde el móvil, para una pose dada.
 *   phi = giro EN el plano de la pantalla
 *   rho = inclinación FUERA del plano
 */
function upFor(phiDeg: number, rhoDeg = 0): Vec3 {
  const p = phiDeg * D2R
  const r = rhoDeg * D2R
  return { x: Math.sin(p) * Math.cos(r), y: Math.cos(p) * Math.cos(r), z: Math.sin(r) }
}

/** Lo que reporta Android / la especificación: a = +g·û */
const asAndroid = (u: Vec3): Vec3 => ({ x: G * u.x, y: G * u.y, z: G * u.z })
/** Lo que reporta iOS: el signo contrario. */
const asIOS = (u: Vec3): Vec3 => ({ x: -G * u.x, y: -G * u.y, z: -G * u.z })
/** `beta` de deviceorientation para esa pose: asin(u.y), en grados. */
const betaFor = (phiDeg: number, rhoDeg = 0): number =>
  Math.asin(upFor(phiDeg, rhoDeg).y) / D2R

describe('anglesFromUp — giro en el plano de la pantalla', () => {
  it('poses conocidas', () => {
    expect(anglesFromUp(upFor(0)).phi).toBeCloseTo(0, 9)
    expect(anglesFromUp(upFor(48)).phi).toBeCloseTo(48, 9)
    expect(anglesFromUp(upFor(-30)).phi).toBeCloseTo(-30, 9)
  })

  it('phi es independiente de la inclinación fuera del plano', () => {
    // Es la propiedad que hace el eje gobernable: apoyar el móvil hacia
    // atrás para verlo mejor no mueve el ángulo que se puntúa.
    for (const rho of [0, 5, 15, 30, 45]) {
      expect(anglesFromUp(upFor(48, rho)).phi).toBeCloseTo(48, 9)
      expect(anglesFromUp(upFor(48, rho)).rho).toBeCloseTo(rho, 9)
    }
  })

  it('es continuo y monótono en phi = 0, el final de la tirada', () => {
    for (let phi = -3; phi <= 3; phi += 0.25) {
      expect(anglesFromUp(upFor(phi)).phi).toBeCloseTo(phi, 6)
    }
  })

  it('es indiferente al módulo del vector', () => {
    const u = upFor(37)
    expect(anglesFromUp({ x: u.x * 3.3, y: u.y * 3.3, z: u.z * 3.3 }).phi).toBeCloseTo(37, 9)
  })

  it('la singularidad está en el móvil plano, fuera de la zona de juego', () => {
    // Con rho = ±90° la proyección de "arriba" sobre la pantalla se anula y
    // phi deja de existir. `planarConfidence` es lo que lo delata.
    expect(planarConfidence(upFor(48, 0))).toBeCloseTo(1, 9)
    expect(planarConfidence(upFor(48, 60))).toBeCloseTo(0.5, 6)
    expect(planarConfidence(upFor(48, 90))).toBeCloseTo(0, 9)
  })
})

describe('foldBeta', () => {
  it('pliega beta al rango de asin', () => {
    expect(foldBeta(45)).toBe(45)
    expect(foldBeta(120)).toBe(60)
    expect(foldBeta(-120)).toBe(-60)
    expect(foldBeta(-90)).toBe(-90)
  })
})

describe('upFromAccel', () => {
  it('reconstruye la misma pose desde las dos convenciones', () => {
    for (const phi of [0, 15, 45, 72]) {
      const u = upFor(phi, 5)
      expect(anglesFromUp(upFromAccel(asIOS(u), 1)).phi).toBeCloseTo(phi, 9)
      expect(anglesFromUp(upFromAccel(asAndroid(u), -1)).phi).toBeCloseTo(phi, 9)
      expect(anglesFromUp(upFromAccel(asAndroid(u), -1)).rho).toBeCloseTo(5, 9)
    }
  })
})

describe('SignProbe — el bicho nº3: el signo invertido entre iOS y Android', () => {
  /**
   * Una tirada sintética: el vaso se endereza de 50° a 5° en 600 ms.
   * @param conv lateralidad del giróscopo. Para uno que siga la
   *   especificación (conv = +1), w_z = +phi̇ con esta descomposición.
   */
  function sweep(convert: (u: Vec3) => Vec3, conv: 1 | -1, withBeta: boolean): SignProbe {
    const probe = new SignProbe()
    const N = 36
    let prevPhi: number | null = null
    for (let i = 0; i < N; i++) {
      const t = (i * 600) / N
      const phi = 50 - (45 * i) / (N - 1)
      const dphi = prevPhi === null ? 0 : (phi - prevPhi) / (600 / N / 1000)
      prevPhi = phi
      probe.add(convert(upFor(phi)), withBeta ? betaFor(phi) : null, conv * dphi, t)
    }
    return probe
  }

  it('resuelve iOS a +1 y con margen amplio', () => {
    const r = sweep(asIOS, 1, true).resolve()
    expect(r.accel).toBe(1)
    expect(r.how).toBe('measured')
    expect(r.errWin).toBeLessThan(0.001)
    // El margen entre hipótesis tiene que ser enorme, no marginal. Con la
    // referencia sobre `u.y`, la hipótesis perdedora da el ángulo negado.
    expect(r.errLose).toBeGreaterThan(60)
  })

  it('resuelve Android a -1 y con margen amplio', () => {
    const r = sweep(asAndroid, 1, true).resolve()
    expect(r.accel).toBe(-1)
    expect(r.errWin).toBeLessThan(0.001)
    expect(r.errLose).toBeGreaterThan(60)
  })

  it('el margen se estrecha cerca de phi = 90°, y la sonda lo declara', () => {
    // Ahí u.y ≈ 0 y las dos hipótesis dan casi lo mismo. No es un fallo: es
    // información, y por eso errWin/errLose se muestran en depuración.
    const probe = new SignProbe()
    for (let i = 0; i < 36; i++) {
      probe.add(asIOS(upFor(89.4)), betaFor(89.4), null, i * 16.7)
    }
    expect(probe.resolve().errLose).toBeLessThan(5)
  })

  it('aguanta ruido de sensor de ±0,5° sin cambiar de hipótesis', () => {
    const probe = new SignProbe()
    let seed = 42
    const rnd = (): number => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff - 0.5)
    for (let i = 0; i < 36; i++) {
      const phi = 50 - (45 * i) / 35
      probe.add(asIOS(upFor(phi + rnd())), betaFor(phi + rnd()), null, i * 16.7)
    }
    const r = probe.resolve()
    expect(r.accel).toBe(1)
    expect(r.errWin).toBeLessThan(2)
  })

  it('resuelve la lateralidad del giróscopo por correlación, sin user-agent', () => {
    // Con phi en el plano de la pantalla, phi̇ = +w_z, así que un giróscopo
    // conforme a la especificación correlaciona POSITIVAMENTE. Si esto se
    // invierte, la predicción del filtro se resta en vez de sumarse y el
    // ángulo se va al doble de rápido. En el iPhone medido salió -1.
    expect(sweep(asIOS, 1, true).resolve().gyro).toBe(1)
    expect(sweep(asIOS, -1, true).resolve().gyro).toBe(-1)
    expect(sweep(asAndroid, -1, true).resolve().gyro).toBe(-1)
  })

  it('sin deviceorientation, declara la suposición en vez de mentir', () => {
    const r = sweep(asIOS, 1, false).resolve()
    expect(r.how).toBe('assumed')
    expect(r.samples).toBe(0)
    expect(r.accel).toBe(-1) // convención de la especificación
  })
})

const mk = (t: number, phi: number, phiRate = 0): Sample =>
  ({ t, phi, rho: 0, phiRate, phiAccel: phi })

describe('TraceBuffer', () => {
  it('interpola linealmente dentro del buffer', () => {
    const b = new TraceBuffer(10)
    b.push(mk(0, 40)); b.push(mk(100, 20))
    expect(b.sampleAt(50)!.phi).toBeCloseTo(30, 9)
    expect(b.sampleAt(25)!.phi).toBeCloseTo(35, 9)
  })

  it('extrapola hacia delante con el giróscopo, acotado a 25 ms', () => {
    const b = new TraceBuffer(10)
    b.push(mk(0, 40, -20)); b.push(mk(100, 38, -20)) // -20 °/s
    expect(b.sampleAt(110)!.phi).toBeCloseTo(38 - 0.2, 9)
    // Más allá del tope no sigue extrapolando: 25 ms · 20 °/s = 0,5°
    expect(b.sampleAt(100 + MAX_EXTRAPOLATION_MS)!.phi).toBeCloseTo(37.5, 9)
    expect(b.sampleAt(5000)!.phi).toBeCloseTo(37.5, 9)
  })

  it('satura hacia atrás en vez de extrapolar', () => {
    const b = new TraceBuffer(10)
    b.push(mk(100, 40)); b.push(mk(200, 20))
    expect(b.sampleAt(-999)!.phi).toBe(40)
  })

  it('devuelve null con la traza vacía', () => {
    expect(new TraceBuffer(10).sampleAt(0)).toBeNull()
  })

  it('el anillo conserva el orden cronológico tras dar la vuelta', () => {
    const b = new TraceBuffer(4)
    for (let i = 0; i < 10; i++) b.push(mk(i * 10, i))
    expect(b.all().map((s) => s.phi)).toEqual([6, 7, 8, 9])
    expect(b.length).toBe(4)
    expect(b.sampleAt(65)!.phi).toBeCloseTo(6.5, 9)
  })

  it('mide la frecuencia real de muestreo', () => {
    const b = new TraceBuffer(200)
    for (let i = 0; i < 60; i++) b.push(mk(i * (1000 / 60), 0))
    expect(b.rateHz()).toBeCloseTo(60, 6)
  })

  it('reconstruye 100 Hz exactos desde un sensor a 60 Hz irregular', () => {
    // El caso real: el sensor entrega a ~60 Hz con jitter, la simulación pide
    // pasos de 10 ms clavados.
    const b = new TraceBuffer(500)
    let seed = 7
    const jitter = (): number => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff - 0.5) * 6
    for (let i = 0; i < 61; i++) {
      const t = i * (1000 / 60) + (i === 0 ? 0 : jitter())
      b.push(mk(t, 45 - (45 * t) / 1000, -45))
    }
    let worst = 0
    for (let t = 20; t <= 980; t += 10) {
      worst = Math.max(worst, Math.abs(b.sampleAt(t)!.phi - (45 - (45 * t) / 1000)))
    }
    // Muy por debajo de la resolución real del sensor (~0,1°) y del grado
    // entero con el que trabaja la puntuación.
    expect(worst).toBeLessThan(0.01)
  })
})

describe('RestGate', () => {
  it('acumula reposo y aprueba a los 1,2 s', () => {
    const g = new RestGate()
    let held = 0
    for (let t = 0; t <= 1400; t += 20) held = g.update(t, 9.81, 0.5, 30)
    expect(held).toBeGreaterThanOrEqual(REST_GATE.holdMs)
  })

  it('se reinicia si el móvil se mueve', () => {
    const g = new RestGate()
    for (let t = 0; t <= 1000; t += 20) g.update(t, 9.81, 0.5, 30)
    expect(g.update(1020, 9.81, 40, 30)).toBe(0)       // giro excesivo
    expect(g.update(1040, 9.81, 0.5, 30)).toBe(0)      // vuelve a empezar
  })

  it('se reinicia si phi deriva más de 1,5° aunque el móvil parezca quieto', () => {
    const g = new RestGate()
    for (let t = 0; t <= 800; t += 20) g.update(t, 9.81, 1, 30)
    expect(g.update(820, 9.81, 1, 32)).toBe(0)
  })
})

describe('cuantización — la frontera del determinismo', () => {
  it('redondea a décimas de grado enteras', () => {
    expect(toDdeg(45.06)).toBe(451)
    expect(toDdeg(-12.34)).toBe(-123)
    expect(toDdeg(0)).toBe(0)
  })

  it('cabe en los 12 bits por canal del formato TRZ1', () => {
    expect(Math.abs(toDdeg(180))).toBeLessThan(2048)
  })
})

describe('angleDiff', () => {
  it('envuelve a (-180, 180]', () => {
    expect(angleDiff(10, 350)).toBe(20)
    expect(angleDiff(350, 10)).toBe(-20)
    expect(angleDiff(0, 0)).toBe(0)
    expect(Math.abs(angleDiff(180, 0))).toBe(180)
  })
})
