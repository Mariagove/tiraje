import { describe, expect, it } from 'vitest'
import { ESPECIAL } from '@/core/baked/especial'
import { replay } from '@/core/scoring'
import {
  GameLoop, MAX_POUR_MS, SETTLE_MS, SIDE_HYSTERESIS_DEG,
  type AngleSource, type GameState,
} from '@/game/loop'
import { REST_GATE, type Angles } from '@/sensors/fusion'

/**
 * Fuente falsa que SÍ respeta el timestamp.
 *
 * La primera versión de este doble ignoraba `t` y devolvía siempre el ángulo
 * actual. Por eso dejó pasar un desfase de cinco segundos entre el reloj de
 * simulación y el del sensor: el test no podía notarlo. Un doble que ignora
 * el parámetro que el código de verdad usa no está probando ese código.
 */
class FakeSource implements AngleSource {
  phi = 48
  rho = 0
  accelMag = 9.81
  omegaMag = 0
  calibrations = 0
  /** Si se define, el ángulo es función del tiempo y `phi` se ignora. */
  ramp: ((t: number) => number) | null = null
  lastAsked = -1

  sampleAt(t: number): Angles | null {
    this.lastAsked = t
    return { phi: this.ramp ? this.ramp(t) : this.phi, rho: this.rho }
  }
  calibrateRoll(): number { this.calibrations++; return 0 }
}

/** Avanza el bucle `ms` de reloj real en frames de `frameMs`. */
function run(loop: GameLoop, ms: number, frameMs = 16, t0 = 0): number {
  let t = t0
  const end = t0 + ms
  while (t < end) { t += frameMs; loop.advance(t) }
  return t
}

function mk(src: FakeSource, states: GameState[] = []): GameLoop {
  return new GameLoop({
    variety: ESPECIAL, source: src, onState: (s) => { states.push(s) },
  })
}

describe('CALIBRATE — el gate de calidad', () => {
  it('aprueba tras 1,2 s de reposo y calibra el roll', () => {
    const src = new FakeSource()
    const loop = mk(src)
    run(loop, REST_GATE.holdMs + 300)
    expect(loop.state).toBe('READY')
    expect(src.calibrations).toBe(1)
  })

  it('no aprueba si el móvil se mueve: sin esto la gente calibra andando', () => {
    const src = new FakeSource()
    src.omegaMag = 25
    const loop = mk(src)
    run(loop, 3000)
    expect(loop.state).toBe('CALIBRATE')
    expect(loop.restProgress).toBe(0)
  })

  it('tampoco si ‖a‖ se desvía de 9,81 (móvil en la mano, andando)', () => {
    const src = new FakeSource()
    src.accelMag = 11.2
    const loop = mk(src)
    run(loop, 3000)
    expect(loop.state).toBe('CALIBRATE')
  })
})

describe('el toque nunca espera al gate de reposo', () => {
  it('abre el grifo desde CALIBRATE, con el móvil en movimiento', () => {
    // Bloquear el primer toque hasta tener 1,2 s de quietud se percibe como
    // que el juego está roto: tocas y no pasa nada. El gate es una mejora
    // oportunista, no una barrera.
    const src = new FakeSource()
    src.omegaMag = 60            // el móvil se está moviendo: el gate no pasa
    const loop = mk(src)
    let t = run(loop, 300)
    expect(loop.state).toBe('CALIBRATE')
    expect(loop.restProgress).toBe(0)

    loop.queueTap()
    t = run(loop, 100, 16, t)
    expect(loop.state).toBe('POUR_BEER')
    // Y calibra el roll con lo que haya, igual de acotado a ±10°.
    expect(src.calibrations).toBe(1)
    expect(loop.trace().taps).toEqual([0])
  })

  it('si el jugador espera, la calibración sale de un móvil quieto', () => {
    const src = new FakeSource()
    const loop = mk(src)
    run(loop, REST_GATE.holdMs + 200)
    expect(loop.state).toBe('READY')
    expect(src.calibrations).toBe(1)
  })

  it('no calibra dos veces', () => {
    const src = new FakeSource()
    const loop = mk(src)
    let t = run(loop, REST_GATE.holdMs + 200)
    loop.queueTap()
    run(loop, 100, 16, t)
    expect(src.calibrations).toBe(1)
  })
})

describe('el lado del vertido', () => {
  it('sigue al ángulo, con histéresis para no dar latigazos en el cero', () => {
    // El objetivo horneado es una magnitud sin signo, así que la línea de
    // referencia hay que dibujarla en el lado por el que se está sirviendo.
    // Sin histéresis, cruzar el cero la haría saltar de un lado al otro.
    const src = new FakeSource()
    const loop = mk(src)
    let t = run(loop, 200)
    expect(loop.pourSide).toBe(1)

    src.phi = -40
    t = run(loop, 200, 16, t)
    expect(loop.pourSide).toBe(-1)

    src.phi = SIDE_HYSTERESIS_DEG - 2      // cruza el cero, pero poco
    t = run(loop, 200, 16, t)
    expect(loop.pourSide).toBe(-1)         // conserva el lado

    src.phi = SIDE_HYSTERESIS_DEG + 5
    run(loop, 200, 16, t)
    expect(loop.pourSide).toBe(1)
  })

  it('el frame lo expone para el renderer', () => {
    const src = new FakeSource()
    src.phi = -48
    const loop = mk(src)
    run(loop, 300)
    expect(loop.frame().pourSide).toBe(-1)
    // Y el objetivo sigue siendo una magnitud positiva.
    expect(loop.frame().targetPhi).toBeGreaterThanOrEqual(0)
  })
})

describe('la máquina de estados del plan §1.2', () => {
  function toReady(): { src: FakeSource; loop: GameLoop; seen: GameState[]; t: number } {
    const src = new FakeSource()
    const seen: GameState[] = []
    const loop = mk(src, seen)
    const t = run(loop, REST_GATE.holdMs + 200)
    return { src, loop, seen, t }
  }

  it('recorre READY → POUR_BEER → POUR_FOAM → CLOSING → SETTLE → RESULT', () => {
    const { loop, seen } = toReady()
    let t = REST_GATE.holdMs + 200
    for (const _ of [1, 2, 3]) {
      loop.queueTap()
      t = run(loop, 1500, 16, t)
    }
    t = run(loop, SETTLE_MS + 300, 16, t)
    expect(loop.state).toBe('RESULT')
    expect(seen).toEqual(['READY', 'POUR_BEER', 'POUR_FOAM', 'CLOSING', 'SETTLE', 'RESULT'])
    expect(loop.result).not.toBeNull()
    expect(Number.isInteger(loop.result!.score)).toBe(true)
  })

  it('el toque se aplica en un paso de simulación, no en el del evento', () => {
    // El índice del toque en la traza tiene que ser exacto para que el
    // servidor lo reproduzca en el mismo paso.
    const { loop } = toReady()
    loop.queueTap()
    expect(loop.trace().taps).toEqual([])   // aún no ha corrido un paso
    run(loop, 50, 16, 2000)
    expect(loop.trace().taps).toEqual([0])
  })

  it('se cierra sola a los 15 s: fatiga del brazo a 45°', () => {
    const { loop } = toReady()
    loop.queueTap()
    const t = run(loop, MAX_POUR_MS + 1000, 16, 2000)
    run(loop, SETTLE_MS + 400, 16, t)
    expect(loop.state).toBe('RESULT')
    expect(loop.trace().taps.length).toBe(3)
  })

  it('OTRA CAÑA es un cambio de estado, no una recarga', () => {
    const { loop } = toReady()
    loop.queueTap()
    let t = run(loop, 1000, 16, 2000)
    loop.restart()
    expect(loop.state).toBe('READY')
    expect(loop.trace().samples).toEqual([])
    expect(loop.result).toBeNull()
    // Y se puede volver a jugar sin pasar por CALIBRATE.
    loop.queueTap()
    t = run(loop, 500, 16, t)
    expect(loop.state).toBe('POUR_BEER')
  })
})

describe('la traza que graba el bucle es la que el servidor recalcula', () => {
  it('replay() de la traza da exactamente la puntuación del bucle', () => {
    // Este es el test que hace que la fase 2 sea posible: si el móvil y el
    // servidor no coinciden aquí, no coinciden en ninguna disputa.
    const src = new FakeSource()
    const loop = mk(src)
    let t = run(loop, REST_GATE.holdMs + 200)

    src.phi = 46
    loop.queueTap(); t = run(loop, 4000, 16, t)
    src.phi = 24
    t = run(loop, 3000, 16, t)
    loop.queueTap(); t = run(loop, 2500, 16, t)
    src.phi = 8
    loop.queueTap(); t = run(loop, SETTLE_MS + 600, 16, t)

    expect(loop.state).toBe('RESULT')
    const own = loop.result!
    const server = replay(ESPECIAL, loop.trace())
    expect(server.score).toBe(own.score)
    expect(server).toEqual(own)
  })

  it('el mismo juego a 120 fps y a 30 fps da el mismo entero', () => {
    // Tres relojes, una sola verdad. Es la razón de ser del acumulador.
    const play = (frameMs: number): number => {
      const src = new FakeSource()
      const loop = mk(src)
      let t = run(loop, REST_GATE.holdMs + 200, frameMs)
      src.phi = 44
      loop.queueTap(); t = run(loop, 4000, frameMs, t)
      src.phi = 20
      loop.queueTap(); t = run(loop, 2000, frameMs, t)
      loop.queueTap(); run(loop, SETTLE_MS + 600, frameMs, t)
      return loop.result!.score
    }
    const a = play(8.3)    // 120 fps
    const b = play(33.3)   // 30 fps
    // Los pasos de simulación son los mismos; el reparto por frame no.
    expect(Math.abs(a - b) / a).toBeLessThan(0.02)
  })
})

describe('el reloj de simulación', () => {
  it('nace pegado al del llamante, no en cero', () => {
    // El bug real: la vista de juego conduce `advance()` sin pasar por
    // `start()`, así que el reloj arrancaba en 0 mientras el sensor sellaba
    // en `performance.now()`. `sampleAt` devolvía la muestra más antigua del
    // anillo y el ángulo parecía congelado cinco segundos por detrás.
    const src = new FakeSource()
    src.ramp = (t) => t / 100          // rampa conocida: 1° por cada 100 ms
    const loop = mk(src)
    const T0 = 9_137                   // la página llevaba 9 s abierta
    run(loop, 400, 16, T0)
    // Se le pregunta por el instante actual, no por el arranque del proceso.
    expect(src.lastAsked).toBeGreaterThan(T0)
    expect(loop.frame().phi).toBeCloseTo(src.lastAsked / 100, 6)
  })

  it('el desfase no se acumula con frames irregulares', () => {
    const src = new FakeSource()
    src.ramp = (t) => t / 100
    const loop = mk(src)
    let t = 4_000
    for (const fm of [16, 33, 8, 120, 16, 16, 50]) { t += fm; loop.advance(t) }
    // Tras un frame de 120 ms el acumulador se recupera, pero nunca salta
    // más de MAX_CATCHUP_MS de golpe, así que puede quedarse algo corto.
    expect(t - src.lastAsked).toBeLessThan(120)
  })
})

describe('el frame que ve el renderer', () => {
  it('avisa al renderer cuando se va líquido por el borde', () => {
    // Las dos causas —rebose por lleno y exceso de inclinación— son la misma
    // cosa vista desde fuera: líquido pasando por encima del borde. El
    // renderer las dibuja igual, así que el frame las une en una sola señal.
    //
    // Se muestrea una ventana y no un instante porque **el derrame se
    // autolimita**: derrama, pierde volumen, baja del umbral, deja de
    // derramar, se vuelve a llenar. La señal parpadea, y por eso el renderer
    // la suaviza con ataque rápido y caída lenta en vez de leerla en crudo.
    const src = new FakeSource()
    src.phi = 70                        // muy pasado de inclinación
    const loop = mk(src)
    let t = run(loop, 200)
    loop.queueTap()

    let everSpilled = false
    for (let i = 0; i < 300; i++) {
      t = run(loop, 16, 16, t)
      if (loop.frame().spillingOver) everSpilled = true
    }
    expect(everSpilled).toBe(true)
    expect(loop.scoreState.spillEvents).toBeGreaterThan(0)

    // Y deja de avisar al enderezar del todo.
    src.phi = 5
    let stillSpilling = false
    for (let i = 0; i < 60; i++) {
      t = run(loop, 16, 16, t)
      if (loop.frame().spillingOver) stillSpilling = true
    }
    expect(stillSpilling).toBe(false)
  })


  it('expone el objetivo y la calidad, y nada del núcleo', () => {
    const src = new FakeSource()
    const loop = mk(src)
    let t = run(loop, REST_GATE.holdMs + 200)
    loop.queueTap()
    t = run(loop, 2000, 16, t)
    const f = loop.frame()
    expect(f.pouring).toBe(true)
    expect(f.targetPhi).toBeGreaterThan(0)
    expect(f.quality).toBeGreaterThan(0)
    expect(f.quality).toBeLessThanOrEqual(1)
    expect(f.lacing).toBeGreaterThanOrEqual(f.fill - 1e-9)
    expect(f.targetFill).toBe(ESPECIAL.cfg.targets.fill)
  })
})
