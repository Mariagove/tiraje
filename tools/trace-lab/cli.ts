/**
 * cli.ts — el banco de pruebas de escritorio.
 *
 *   node tools/trace-lab/cli.ts --synth mediocre [--variety negra]
 *   node tools/trace-lab/cli.ts traces/2026-09-21-bar.json
 *   node tools/trace-lab/cli.ts --synth perfect --save traces/perfect.json
 *
 * Reproduce una traza contra la función de puntuación e imprime el desglose.
 * Sin esto, cada iteración del algoritmo cuesta agitar un teléfono treinta
 * veces; con esto, cuesta un segundo.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { GameTrace } from '../../src/core/scoring.ts'
import type { BakedVariety } from '../../src/core/types.ts'
import { ESPECIAL } from '../../src/core/baked/especial.ts'
import { NEGRA } from '../../src/core/baked/negra.ts'
import { PROFILES, scoreOf, synthTrace } from './synth.ts'

const VARIETIES: Record<string, BakedVariety> = { especial: ESPECIAL, negra: NEGRA }

const args = process.argv.slice(2)
const flag = (n: string): string | undefined => {
  const i = args.indexOf(n)
  return i >= 0 ? args[i + 1] : undefined
}

const varietyId = flag('--variety') ?? 'especial'
const v = VARIETIES[varietyId]
if (!v) { console.error(`variedad desconocida: ${varietyId}`); process.exit(1) }

const profile = flag('--synth')
const file = args.find((a) => !a.startsWith('--') && a !== profile && a !== varietyId)

let trace: GameTrace
if (profile) {
  const opts = PROFILES[profile]
  if (!opts) {
    console.error(`perfil desconocido: ${profile}. Hay: ${Object.keys(PROFILES).join(', ')}`)
    process.exit(1)
  }
  trace = synthTrace(v, opts)
} else if (file) {
  trace = JSON.parse(readFileSync(file, 'utf8')) as GameTrace
  if (trace.varietyId !== varietyId && VARIETIES[trace.varietyId]) {
    console.log(`(la traza dice variedad "${trace.varietyId}")`)
  }
} else {
  console.error('uso: cli.ts [--synth <perfil>] [--variety <id>] [fichero.json]')
  process.exit(1)
}

const out = flag('--save')
if (out) {
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, JSON.stringify(trace))
  console.log(`traza guardada en ${out}`)
}

const r = scoreOf(v, trace)
const eur = (n: number): string => Math.round(n).toLocaleString('es-ES')
const pc = (n: number): string => `${(n * 100).toFixed(1)}%`

console.log(`
  variedad          ${v.cfg.name}
  muestras          ${trace.samples.length} (${(trace.samples.length / 100).toFixed(2)} s)
  toques            paso ${trace.taps.join(', ')}
  ─────────────────────────────────────────────
  vertido           ${eur(r.breakdown.pour).padStart(9)}
  bono llenado      ${eur(r.breakdown.fill).padStart(9)}   (${pc(r.fill)} de ${pc(v.cfg.targets.fill)})
  bono espuma       ${eur(r.breakdown.foam).padStart(9)}   (${pc(r.foam)} de ${pc(v.cfg.targets.foam)})
  limpieza          ${eur(r.breakdown.clean).padStart(9)}\n  derrames          ${eur(r.breakdown.penalty).padStart(9)}
  ─────────────────────────────────────────────
  PUNTUACIÓN        ${eur(r.score).padStart(9)}   ${r.verdict === 'spilled' ? '· CAÑA DERRAMADA' : ''}
  error medio       ${r.meanErrorDeg.toFixed(1)}°
  derrames          ${r.spillEvents} evento(s), ${pc(r.spilled)} del vaso
`)
