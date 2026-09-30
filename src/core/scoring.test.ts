import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ESPECIAL } from '@/core/baked/especial'
import { NEGRA } from '@/core/baked/negra'
import {
  MAX_SPILL_RATE_PER_SEC, TAP_BLANKING_MS, createState, finalize, replay, step, tap,
  type GameTrace, type ScoreState, type TraceSample,
} from '@/core/scoring'
import type { BakedVariety } from '@/core/types'

const FIXTURES = 'tools/trace-lab/fixtures'
const load = (n: string): GameTrace =>
  JSON.parse(readFileSync(join(FIXTURES, `${n}.json`), 'utf8')) as GameTrace
const expected = JSON.parse(readFileSync(join(FIXTURES, 'expected.json'), 'utf8')) as
  Record<string, { score: number; verdict: string; err: number; steps: number }>

const V: Record<string, BakedVariety> = { especial: ESPECIAL, negra: NEGRA }

/**
 * La variedad la dice la TRAZA, no el nombre del fichero.
 *
 * Deducirla del prefijo funcionaba mientras todos los fixtures se llamaban
 * `<variedad>-<perfil>`, y se rompió al entrar `real-iphone-1`, que es una
 * partida de verdad grabada en un iPhone y no se llama así.
 */
const varietyOf = (t: GameTrace): BakedVariety => V[t.varietyId] ?? ESPECIAL

// ---------------------------------------------------------------------------
// Lo que exige el plan §Verificación 1
// ---------------------------------------------------------------------------

describe('fixtures dorados', () => {
  // Las bandas van en FRACCIÓN del máximo teórico de cada variedad, no en
  // puntos absolutos. El plan las daba en puntos, y esos números estaban
  // atados al grifo de dos fases: al quedarse el juego en dos toques, el
  // máximo cambió y las bandas absolutas se volvieron mentira sin que el
  // juego hubiera empeorado. La fracción dice lo que de verdad se quería
  // decir: cómo de cerca del techo queda cada perfil.
  const frac = (id: string, name: string): number =>
    replay(V[id]!, load(name)).score / V[id]!.maxScore

  it('la traza perfecta roza el techo: entre el 92% y el 100%', () => {
    for (const id of Object.keys(V)) {
      expect(frac(id, `${id}-perfect`), id).toBeGreaterThanOrEqual(0.92)
      expect(frac(id, `${id}-perfect`), id).toBeLessThanOrEqual(1)
    }
  })

  it('la traza mediocre se queda entre el 35% y el 65% del techo', () => {
    for (const id of Object.keys(V)) {
      expect(frac(id, `${id}-mediocre`), id).toBeGreaterThanOrEqual(0.35)
      expect(frac(id, `${id}-mediocre`), id).toBeLessThanOrEqual(0.65)
    }
  })

  it('reproduce cada fixture al entero exacto', () => {
    // Este es el test que impide que un retoque "inocuo" del algoritmo se
    // cuele sin que nadie lo note. Si falla a propósito, se regeneran los
    // fixtures Y se abre temporada nueva: la puntuación no se parchea viva.
    for (const [name, want] of Object.entries(expected)) {
      const t = load(name)
      const r = replay(varietyOf(t), t)
      expect({ name, score: r.score, verdict: r.verdict }).toEqual(
        { name, score: want.score, verdict: want.verdict })
    }
  })

  it('las dos variedades están equilibradas: <2% entre sus máximos', () => {
    // Plan §Verificación: es lo que impide que una variedad desbalanceada
    // reviente el ranking global.
    const a = replay(ESPECIAL, load('especial-perfect')).score
    const b = replay(NEGRA, load('negra-perfect')).score
    expect(Math.abs(a - b) / Math.max(a, b)).toBeLessThan(0.02)
  })

  it('derramar se castiga y se declara', () => {
    const r = replay(ESPECIAL, load('especial-spiller'))
    expect(r.verdict).toBe('spilled')
    // Por la vía de la FRACCIÓN, no la de los eventos. Con el caudal de
    // vertedero el derrame es continuo, así que es UN episodio largo y no
    // tres cortos: antes el derrame flojo dejaba que el nivel oscilara sobre
    // el umbral y contaba varios. Lo que lo declara derramada es cuánto se ha
    // ido, que es lo que importa.
    expect(r.spilled).toBeGreaterThan(ESPECIAL.cfg.scoring.spillMaxFrac)
    expect(r.spillEvents).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// Determinismo
// ---------------------------------------------------------------------------

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? walk(join(dir, d.name))
      : d.name.endsWith('.ts') && !d.name.endsWith('.test.ts') ? [join(dir, d.name)] : [])

describe('determinismo', () => {
  it('ningún módulo de core/ llama a una función trascendente', () => {
    // Suena tosco y es lo que impide que esto se erosione. `exp`, `sin` y
    // compañía no son bit-idénticas entre JavaScriptCore y V8; el servidor
    // de la fase 2 recalcula la puntuación y cualquiera de ellas lo rompe.
    const BANNED = /Math\.(exp|expm1|log|log1p|log2|log10|pow|sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|cbrt|hypot|random)\s*\(/
    const offenders = walk('src/core')
      .map((f) => [f, readFileSync(f, 'utf8')] as const)
      .filter(([, src]) => BANNED.test(src))
      .map(([f, src]) => `${f}: ${BANNED.exec(src)?.[0]}`)

    expect(offenders).toEqual([])
  })

  it('la misma traza da el mismo entero, siempre', () => {
    const t = load('especial-good')
    const a = replay(ESPECIAL, t)
    const b = replay(ESPECIAL, JSON.parse(JSON.stringify(t)) as GameTrace)
    expect(a).toEqual(b)
    expect(Number.isInteger(a.score)).toBe(true)
  })

  it('la puntuación no depende de cómo se trocee el bucle', () => {
    // Un iPhone a 120 fps y un Android a 30 hacen distinto número de frames,
    // pero el mismo número de pasos de 10 ms. Reproducir en trozos irregulares
    // tiene que dar exactamente lo mismo.
    const t = load('especial-good')
    const taps = new Set(t.taps)
    const st = createState()
    let i = 0
    for (const chunk of [7, 3, 40, 1, 200, 11]) {
      for (let k = 0; k < chunk && i < t.samples.length; k++, i++) {
        if (taps.has(i)) tap(st)
        step(ESPECIAL, st, t.samples[i]!)
      }
    }
    while (i < t.samples.length) {
      if (taps.has(i)) tap(st)
      step(ESPECIAL, st, t.samples[i]!); i++
    }
    expect(finalize(ESPECIAL, st)).toEqual(replay(ESPECIAL, t))
  })
})

// ---------------------------------------------------------------------------
// Las dos mecánicas que el handoff prohíbe tocar
// ---------------------------------------------------------------------------

function hold(v: BakedVariety, phiDeg: number, steps: number, rhoDeg = 0): GameTrace {
  const samples: TraceSample[] = Array.from({ length: steps }, () =>
    ({ phiDdeg: Math.round(phiDeg * 10), rhoDdeg: Math.round(rhoDeg * 10) }))
  return { version: 1, varietyId: v.id, stepMs: 10, samples, taps: [0] }
}

const tgt = (f: number): number => ESPECIAL.TARGET_DDEG[Math.round(f * 1000)]! / 10
const spl = (f: number): number => ESPECIAL.SPILL_DDEG[Math.round(f * 1000)]! / 10
const mk = (samples: TraceSample[]): GameTrace =>
  ({ version: 1, varietyId: 'especial', stepMs: 10, samples, taps: [0] })

describe('el acoplamiento espuma-ángulo', () => {
  it('enderezar antes de tiempo genera espuma, no una resta de puntos', () => {
    // El castigo es sistémico y se ve. No lo sustituyas por una penalización
    // numérica: es lo que hace que el juego enganche.
    const recto = replay(ESPECIAL, hold(ESPECIAL, 10, 400))   // muy enderezado
    const correcto = replay(ESPECIAL, hold(ESPECIAL, 48, 400)) // en el objetivo inicial
    expect(recto.foam).toBeGreaterThan(correcto.foam * 2)
    // Y le llena el vaso sin cerveza: llega más lleno con menos cerveza dentro.
    expect(recto.foam / recto.fill).toBeGreaterThan(correcto.foam / correcto.fill)
  })

  it('la curva objetivo se acelera al final, que es donde debe estar', () => {
    const at = (f: number): number => tgt(f)
    expect(at(0.5) - at(0.6)).toBeLessThan(at(0.8) - at(0.9))
    expect(at(0.0)).toBe(ESPECIAL.cfg.difficulty.maxTargetDeg)
  })

  it('la tabla de derrame reproduce la geometría del plan §1.3', () => {
    const at = (f: number): number => spl(f)
    expect(at(0)).toBeCloseTo(77.1, 1)
    expect(at(0.8)).toBeCloseTo(41.2, 1)
    expect(at(0.9)).toBeCloseTo(23.6, 1)
  })

  it('GAUSS reproduce los valores citados en el plan §1.3', () => {
    expect(ESPECIAL.GAUSS_E[0]).toBeCloseTo(1.0, 2)
    expect(ESPECIAL.GAUSS_E[1]).toBeCloseTo(0.96, 2)
    expect(ESPECIAL.GAUSS_E[2]).toBeCloseTo(0.85, 2)
    expect(ESPECIAL.GAUSS_E[9]).toBeCloseTo(0.04, 2)
  })
})

describe('blanking del toque', () => {
  it('un transitorio de 3° justo tras el toque no cuesta casi nada', () => {
    // Tocar la pantalla sacude el móvil justo en el instante de máxima
    // precisión. Sin blanking, se castiga al jugador por jugar.
    const N = 400
    const clean: TraceSample[] = Array.from({ length: N }, () => ({ phiDdeg: 480, rhoDdeg: 0 }))
    const shaken = clean.map((s, i) => (i < TAP_BLANKING_MS / 10 ? { ...s, phiDdeg: 480 - 30 } : s))
    const a = replay(ESPECIAL, mk(clean)).breakdown.pour
    const b = replay(ESPECIAL, mk(shaken)).breakdown.pour
    expect(Math.abs(a - b) / a).toBeLessThan(0.01)
  })

  it('pero el transitorio SÍ cuesta si cae fuera de la ventana', () => {
    const N = 400
    const clean: TraceSample[] = Array.from({ length: N }, () => ({ phiDdeg: 480, rhoDdeg: 0 }))
    const late = clean.map((s, i) => (i >= 100 && i < 118 ? { ...s, phiDdeg: 450 } : s))
    expect(replay(ESPECIAL, mk(late)).breakdown.pour)
      .toBeLessThan(replay(ESPECIAL, mk(clean)).breakdown.pour)
  })
})

describe('con el grifo cerrado no se derrama', () => {
  it('bajar el brazo tras cerrar no cuesta la partida', () => {
    // Regresión de una traza real de iPhone: cerró con el vaso al 85% y en
    // los 5 s siguientes, al relajar el brazo, el juego le quitó el 23,6% del
    // vaso y le puso CAÑA DERRAMADA con un error medio de 2,5°.
    const pour: TraceSample[] = Array.from({ length: 800 }, (_, i) =>
      ({ phiDdeg: ESPECIAL.TARGET_DDEG[Math.min(1000, i)]!, rhoDdeg: 0 }))
    const relax: TraceSample[] = Array.from({ length: 500 }, () => ({ phiDdeg: 650, rhoDdeg: 0 }))

    const abierto = replay(ESPECIAL, {
      version: 1, varietyId: 'especial', stepMs: 10,
      samples: [...pour, ...relax], taps: [0],
    })
    const cerrado = replay(ESPECIAL, {
      version: 1, varietyId: 'especial', stepMs: 10,
      samples: [...pour, ...relax], taps: [0, 400, pour.length],
    })

    // Con el grifo abierto, 65° a media carga derrama y se nota.
    expect(abierto.spillEvents).toBeGreaterThan(0)
    // Cerrado, la misma inclinación no cuesta nada.
    expect(cerrado.spillEvents).toBe(0)
    expect(cerrado.verdict).toBe('ok')
    // Lo que importa no es acabar más lleno —con el grifo abierto 13 s el
    // vaso rebosa— sino no PERDER nada de lo servido tras cerrar.
    expect(cerrado.spilled).toBe(0)
    expect(abierto.spilled).toBeGreaterThan(0)
  })
})

/** Llena hasta rebosar, cierra, y sigue corriendo `extra` pasos. */
function overflowThen(extra: number): {
  atClose: number; fAtClose: number; foamAtClose: number
  after: ReturnType<typeof finalize>; st: ScoreState
  } {
  const st = createState()
  tap(st)
  for (let i = 0; i < 1400; i++) step(ESPECIAL, st, { phiDdeg: 0, rhoDdeg: 0 })
  tap(st); tap(st)
  step(ESPECIAL, st, { phiDdeg: 0, rhoDdeg: 0 })
  const atClose = finalize(ESPECIAL, st).score
  const fAtClose = st.f
  const foamAtClose = st.foam
  for (let i = 0; i < extra; i++) step(ESPECIAL, st, { phiDdeg: 0, rhoDdeg: 0 })
  return { atClose, fAtClose, foamAtClose, after: finalize(ESPECIAL, st), st }
}

describe('la puntuación se congela en el tercer toque', () => {

  it('el vaso se vacía después de cerrar, pero el marcador no se mueve', () => {
    // Es lo que pasaría de verdad: la corona que sobresalía del borde se va.
    // Pero la física de después no puede cambiar lo que ya hiciste.
    const { atClose, after, st } = overflowThen(400)
    expect(after.score).toBe(atClose)
    expect(st.f).toBeLessThan(1)
    expect(st.f).toBeCloseTo(1 - ESPECIAL.cfg.settle.overflowSettleFrac, 3)
    // Y el resultado sigue contando el llenado del cierre, no el asentado.
    expect(after.fill).toBe(1)
  })

  it('al asentarse baja el nivel y la corona nunca sube', () => {
    // Tras un rebose largo la corona ya se ha ido entera por el borde, así
    // que aquí lo que queda por comprobar es que el asentamiento sigue
    // bajando el nivel y que la espuma nunca crece sola.
    const { st, fAtClose, foamAtClose } = overflowThen(400)
    expect(fAtClose - st.f).toBeGreaterThan(0.05)
    expect(st.foam).toBeLessThanOrEqual(foamAtClose)
    expect(st.foam).toBeLessThanOrEqual(st.f)
  })

  it('un vaso que no rebosó no se asienta', () => {
    const st = createState()
    tap(st)
    for (let i = 0; i < 400; i++) step(ESPECIAL, st, { phiDdeg: 480, rhoDdeg: 0 })
    tap(st); tap(st)
    step(ESPECIAL, st, { phiDdeg: 480, rhoDdeg: 0 })
    const f0 = st.f
    expect(f0).toBeLessThan(1)
    for (let i = 0; i < 400; i++) step(ESPECIAL, st, { phiDdeg: 480, rhoDdeg: 0 })
    expect(st.f).toBe(f0)
  })

  it('el congelado se reproduce igual en el servidor', () => {
    // `replay` recorre la traza entera, asentamiento incluido, y tiene que
    // dar el mismo entero que el móvil enseñó al cerrar.
    const pour: TraceSample[] = Array.from({ length: 1400 }, () => ({ phiDdeg: 0, rhoDdeg: 0 }))
    const after: TraceSample[] = Array.from({ length: 600 }, () => ({ phiDdeg: 0, rhoDdeg: 0 }))
    const trace: GameTrace = {
      version: 1, varietyId: 'especial', stepMs: 10,
      samples: [...pour, ...after], taps: [0, 700, pour.length],
    }
    const corto: GameTrace = { ...trace, samples: pour }
    expect(replay(ESPECIAL, trace).score).toBe(replay(ESPECIAL, corto).score)
  })
})

/** Una tirada entera sosteniendo un ángulo fijo. */
  const run = (phiDdeg: number): { f: number; foam: number; spilled: number } => {
    const st = createState()
    tap(st)
    for (let i = 0; i < 700; i++) step(ESPECIAL, st, { phiDdeg, rhoDdeg: 0 })
    return { f: st.f, foam: st.foam, spilled: st.spilled }
  }

/** Fracción de vaso perdida sosteniendo un ángulo 7 s. */
const perdido = (phiDdeg: number): number => {
  const st = createState()
  tap(st)
  for (let i = 0; i < 700; i++) step(ESPECIAL, st, { phiDdeg, rhoDdeg: 0 })
  return st.spilled
}

describe('derramar baja el nivel', () => {
  it('pasarse de inclinación con el vaso lleno lo vacía, no lo frena', () => {
    // Con caudal de derrame CONSTANTE esto no pasaba: la entrada (~0,12 de
    // vaso por segundo) superaba a la salida (0,06), así que por mucho que te
    // pasaras el vaso seguía llenándose. Ahora el caudal va con `exceso^1,5`,
    // como un vertedero.
    const st = createState()
    tap(st)
    while (st.f < 0.8 && st.steps < 2000) {
      step(ESPECIAL, st, { phiDdeg: ESPECIAL.TARGET_DDEG[Math.round(st.f * 1000)]!, rhoDdeg: 0 })
    }
    const lleno = st.f
    expect(lleno).toBeGreaterThanOrEqual(0.8)

    for (let i = 0; i < 10; i++) step(ESPECIAL, st, { phiDdeg: 750, rhoDdeg: 0 })
    expect(st.f).toBeLessThan(lleno - 0.1)   // en 100 ms ya se ve
  })

  it('el caudal crece con el exceso de ángulo, no es constante', () => {
    const poco = perdido(550)
    const medio = perdido(620)
    const mucho = perdido(750)
    expect(medio).toBeGreaterThan(poco * 2)
    expect(mucho).toBeGreaterThan(medio * 2)
  })

  it('el caudal tiene tope: el vaso no se vacía en un solo paso', () => {
    const st = createState()
    tap(st)
    for (let i = 0; i < 400; i++) step(ESPECIAL, st, { phiDdeg: 400, rhoDdeg: 0 })
    const antes = st.f
    step(ESPECIAL, st, { phiDdeg: 890, rhoDdeg: 0 })   // exceso brutal
    expect(antes - st.f).toBeLessThanOrEqual(MAX_SPILL_RATE_PER_SEC * 0.01 + 1e-9)
  })
})

describe('lo que sale por el borde se pierde, y sale de arriba', () => {
  it('rebosar baja la corona: no sale espuma infinita del vaso lleno', () => {
    // Antes el rebose dejaba `f` clavado en 1 y no tocaba la espuma, así que
    // se veía salir espuma sin fin mientras el vaso seguía igual de lleno.
    const st = createState()
    tap(st)
    for (let i = 0; i < 1100; i++) step(ESPECIAL, st, { phiDdeg: 0, rhoDdeg: 0 })
    expect(st.f).toBeCloseTo(1, 6)
    const foamAlLlenar = st.foam
    expect(foamAlLlenar).toBeGreaterThan(0.05)

    for (let i = 0; i < 400; i++) step(ESPECIAL, st, { phiDdeg: 0, rhoDdeg: 0 })
    expect(st.foam).toBeLessThan(foamAlLlenar)
    expect(st.spilled).toBeGreaterThan(0)
  })

  it('derramar cuesta llenado y corona frente a no derramar', () => {
    // Comparativo a propósito, y esto es un hallazgo del propio test: con el
    // grifo abierto, pasarse de inclinación NO vacía el vaso. El caudal de
    // entrada (0,105/s) supera al de derrame (0,06/s), así que sigue
    // llenándose, sólo que más despacio y perdiendo la corona. Ver
    // docs/PENDIENTE.md: `spillRatePerSec` es constante y probablemente
    // debería crecer con lo pasado que vas de ángulo.
    const limpio = run(480)   // en el objetivo de salida
    const pasado = run(750)   // muy pasado: derrama

    // Ojo: el "limpio" también derrama un pelín. Al llegar al 76% de llenado
    // el límite baja a 46°, así que quedarse en el ángulo de salida acaba
    // derramando — que es exactamente la premisa del juego.
    expect(pasado.spilled).toBeGreaterThan(limpio.spilled * 10)
    expect(pasado.f).toBeLessThan(limpio.f)
    expect(pasado.foam).toBeLessThan(limpio.foam)
  })
})

describe('rebose', () => {
  it('un vaso lleno no acepta más cerveza: la rebosa', () => {
    // 60 s con el grifo abierto y sin cerrar nunca. Antes de este tope el
    // resultado llegaba a decir «120% lleno», lo que además rompe el bono de
    // llenado y deja sin sentido la marca grabada en el cristal.
    const r = replay(ESPECIAL, mk(
      Array.from({ length: 6000 }, () => ({ phiDdeg: 100, rhoDdeg: 0 }))))
    expect(r.fill).toBeLessThanOrEqual(1)
    expect(r.foam).toBeLessThanOrEqual(r.fill)
    expect(r.spillEvents).toBeGreaterThan(0)
  })

  it('deja de rebosar al cerrar el grifo', () => {
    // El bug: tras recortar, `f` queda exactamente en 1, y con un
    // `else if (st.f < 1)` no se cumplía ninguna rama, así que `overflowing`
    // se enganchaba a true para siempre. El vaso seguía rebosando en pantalla
    // después de cerrar el grifo y de acabar la partida.
    const st = createState()
    tap(st)
    for (let i = 0; i < 1400; i++) step(ESPECIAL, st, { phiDdeg: 0, rhoDdeg: 0 })
    expect(st.f).toBe(1)
    expect(st.overflowing).toBe(true)

    // Tres toques: el tercero cierra. A partir de ahí no entra nada.
    tap(st); tap(st)
    expect(st.phase).toBe('closed')
    step(ESPECIAL, st, { phiDdeg: 0, rhoDdeg: 0 })
    expect(st.overflowing).toBe(false)
    // Y a partir de aquí sólo baja por asentamiento, nunca sube.
    expect(st.f).toBeLessThanOrEqual(1)
  })

  it('el rebose cuenta como derrame una vez, no una por paso', () => {
    const r = replay(ESPECIAL, mk(
      Array.from({ length: 3000 }, () => ({ phiDdeg: 0, rhoDdeg: 0 }))))
    // A phi = 0 no hay derrame por inclinación, así que todos los eventos que
    // haya son reboses. Uno, no tres mil.
    expect(r.spillEvents).toBe(1)
  })
})

describe('contrato de la puntuación', () => {
  it('el score es siempre un entero no negativo', () => {
    for (const name of Object.keys(expected)) {
      const t = load(name)
      const r = replay(varietyOf(t), t)
      expect(Number.isInteger(r.score)).toBe(true)
      expect(r.score).toBeGreaterThanOrEqual(0)
    }
  })

  it('el ladeo penaliza, y a 14° cuesta un tercio del vertido', () => {
    const recto = replay(ESPECIAL, hold(ESPECIAL, 48, 400, 0)).breakdown.pour
    const ladeado = replay(ESPECIAL, hold(ESPECIAL, 48, 400, 14)).breakdown.pour
    expect(ladeado / recto).toBeCloseTo(Math.E ** -1, 1)
  })
})
