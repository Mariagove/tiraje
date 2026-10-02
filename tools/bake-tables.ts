/**
 * bake-tables.ts — hornea las tablas desde el perfil del vaso.
 *
 *   node tools/bake-tables.ts
 *
 * Aquí SÍ se usan trascendentes, y a propósito: este script corre una vez en
 * build, en una sola máquina, y su salida son literales dobles. El runtime
 * hereda la geometría sin heredar `Math.atan` — que es lo que permite que el
 * servidor de la fase 2 recalcule la puntuación bit a bit.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { VarietyConfig } from '../src/core/types.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const D = 180 / Math.PI

/** La gaussiana del plan. Verificada contra los valores citados en §1.3:
 *  GAUSS[0..2] = 1,00 / 0,96 / 0,85 y GAUSS[9] = 0,04 con σ = 5. */
const gauss = (x: number): number => Math.exp(-(x * x))

/** Derrame ⟺ tan(φ) > (1 − f)·H/R  (plan §1.3). */
const spillDeg = (f: number, hr: number): number => Math.atan(Math.max(0, 1 - f) * hr) * D

/** La curva objetivo es la de derrame con margen. No es una curva inventada. */
const targetDeg = (f: number, hr: number, kSafe: number, cap: number): number =>
  Math.min(cap, Math.atan(Math.max(0, 1 - f) * hr * kSafe) * D)

const arr = (a: readonly number[], p: number): string =>
  `[${a.map((v) => (Number.isInteger(v) ? String(v) : v.toFixed(p))).join(',')}]`

const FILL_STEPS = 1000 // índice en por mil: paso de 0,08° en el tramo final

function bake(cfg: VarietyConfig): { src: string; report: Record<string, string> } {
  const hr = cfg.glass.heightMm / cfg.glass.radiusMm
  const { kSafe, maxTargetDeg } = cfg.difficulty
  const s = cfg.scoring

  const TARGET_DDEG: number[] = []
  const SPILL_DDEG: number[] = []
  for (let i = 0; i <= FILL_STEPS; i++) {
    const f = i / FILL_STEPS
    TARGET_DDEG.push(Math.round(targetDeg(f, hr, kSafe, maxTargetDeg) * 10))
    SPILL_DDEG.push(Math.round(spillDeg(f, hr) * 10))
  }

  // --- Cuánto dura una caña perfecta -------------------------------------
  //
  // Con un solo grifo, el tiempo sale de las dos ecuaciones de volumen sin
  // necesidad de simular. Con `F = ∫frac dt`:
  //
  //   espuma  = r · E · F                    →  F = espuma / (r · E)
  //   llenado = r · (t + (E − 1) · F)        →  t = llenado/r − (E−1)·F
  //
  // Antes había que resolver dos fases porque el tercer toque conmutaba el
  // grifo a espuma; ahora el grifo es uno solo y esto es aritmética.
  const fp = cfg.pour
  const F = cfg.targets.foam / (fp.beerRatePerSec * fp.foamExpansion)
  const tPerfect = cfg.targets.fill / fp.beerRatePerSec - (fp.foamExpansion - 1) * F

  const GAUSS_E = Array.from({ length: 30 }, (_, e) => gauss(e / s.sigmaDeg))
  const OMEGA_Q = Array.from({ length: 201 }, (_, w) => gauss(w / s.omegaScaleDegPerSec))
  const FILL_Q = Array.from({ length: 101 }, (_, d) => gauss(d / cfg.targets.fillTolerancePp))
  const FOAM_Q = Array.from({ length: 101 }, (_, d) => gauss(d / cfg.targets.foamTolerancePp))

  // La velocidad angular que la propia curva objetivo exige a un jugador
  // perfecto. Por encima de eso, el movimiento ya no es seguir el objetivo.
  // Se deriva de la geometría, no se elige: es dφ*/df · df/dt.
  let maxSlope = 0
  // Caudal medio de una caña perfecta, que es el que ve el jugador al que se
  // le exige seguir la curva. Sale de `tPerfect`, más abajo: llenado partido
  // por lo que tarda.
  const fRateBeer = cfg.targets.fill / tPerfect
  for (let i = 1; i <= FILL_STEPS; i++) {
    const d = Math.abs(TARGET_DDEG[i]! - TARGET_DDEG[i - 1]!) / 10 * FILL_STEPS
    if (i / FILL_STEPS <= cfg.targets.fill) maxSlope = Math.max(maxSlope, d * fRateBeer)
  }
  // El mayor de los dos: lo que exige la curva, y lo que hace una mano
  // corrigiendo. Este término está para detectar que ya NO estás siguiendo el
  // objetivo —agitar el móvil, o una traza inventada—, no para cobrarte las
  // correcciones.
  const omegaAllowedDegPerSec = Math.max(
    Math.ceil(maxSlope * 1.5), cfg.difficulty.omegaFloorDegPerSec)

  const maxPoints = s.pointsPerSecBeer * tPerfect
  const maxScore = Math.round(
    (maxPoints + s.bonusFill + s.bonusFoam + s.bonusNoSpill) * s.finalMultiplier)

  // La curva de la nota, horneada en milésimas del techo. Aquí sí se puede
  // usar `pow`: esto corre en el horno, no en el núcleo.
  const NOTA = Array.from({ length: 1001 }, (_, i) =>
    Math.min(100, Math.round(100 * Math.pow(i / 1000, s.gamma))))

  const src = `// GENERADO POR tools/bake-tables.ts — NO EDITAR A MANO.
// Fuente: varieties/${cfg.id}.json
// Vaso H=${cfg.glass.heightMm}mm R=${cfg.glass.radiusMm}mm → H/R=${hr.toFixed(4)}
// Derrame: vacío ${spillDeg(0, hr).toFixed(2)}° · 80% ${spillDeg(0.8, hr).toFixed(2)}° · 90% ${spillDeg(0.9, hr).toFixed(2)}°
// Objetivo: salida ${(TARGET_DDEG[0]! / 10).toFixed(1)}° · 80% ${(TARGET_DDEG[800]! / 10).toFixed(1)}° · 95% ${(TARGET_DDEG[950]! / 10).toFixed(1)}°
// Caña perfecta: ${tPerfect.toFixed(2)}s de grifo abierto = ${maxScore.toLocaleString('es-ES')} puntos
import type { BakedVariety } from '../types.ts'
import cfg from '../../../varieties/${cfg.id}.json' with { type: 'json' }

export const ${cfg.id.toUpperCase()}: BakedVariety = {
  id: ${JSON.stringify(cfg.id)},
  TARGET_DDEG: ${arr(TARGET_DDEG, 0)},
  SPILL_DDEG: ${arr(SPILL_DDEG, 0)},
  GAUSS_E: ${arr(GAUSS_E, 9)},
  OMEGA_Q: ${arr(OMEGA_Q, 9)},
  FILL_Q: ${arr(FILL_Q, 9)},
  FOAM_Q: ${arr(FOAM_Q, 9)},
  omegaAllowedDegPerSec: ${omegaAllowedDegPerSec},
  maxScore: ${maxScore},
  NOTA: ${arr(NOTA, 0)},
  cfg: cfg as BakedVariety['cfg'],
}
`
  return {
    src,
    report: {
      'H/R': hr.toFixed(4),
      'derrame vacío': `${spillDeg(0, hr).toFixed(2)}°`,
      'derrame 90%': `${spillDeg(0.9, hr).toFixed(2)}°`,
      'objetivo salida': `${(TARGET_DDEG[0]! / 10).toFixed(1)}°`,
      'objetivo 95%': `${(TARGET_DDEG[950]! / 10).toFixed(1)}°`,
      'ω permitida': `${omegaAllowedDegPerSec} °/s`,
      'caña perfecta': `${tPerfect.toFixed(2)}s de grifo abierto`,
      'máximo teórico': maxScore.toLocaleString('es-ES'),
      'curva de la nota': `gamma ${s.gamma} · 70% del techo = ${NOTA[700]}`,
    },
  }
}

const outDir = join(ROOT, 'src/core/baked')
mkdirSync(outDir, { recursive: true })
const files = readdirSync(join(ROOT, 'varieties')).filter((f) => f.endsWith('.json'))
const rows: [string, Record<string, string>][] = []

for (const file of files) {
  const cfg = JSON.parse(readFileSync(join(ROOT, 'varieties', file), 'utf8')) as VarietyConfig
  const { src, report } = bake(cfg)
  writeFileSync(join(outDir, `${cfg.id}.ts`), src)
  rows.push([cfg.name, report])
}

const keys = Object.keys(rows[0]![1])
const w = Math.max(...keys.map((k) => k.length))
console.log('')
for (const k of keys) {
  console.log(`  ${k.padEnd(w)}  ${rows.map(([, r]) => (r[k] ?? '').padEnd(22)).join('')}`)
}
console.log(`  ${''.padEnd(w)}  ${rows.map(([n]) => n.padEnd(22)).join('')}\n`)
