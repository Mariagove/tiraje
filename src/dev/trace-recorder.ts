/**
 * trace-recorder.ts — el grabador. Se construye ANTES que el juego.
 *
 * Corre el bucle de 100 Hz de verdad (acumulador con paso fijo), muestrea el
 * sensor con `sampleAt`, cuantiza a décimas de grado y alimenta el núcleo de
 * puntuación. Al acabar exporta una `GameTrace` que el banco de escritorio
 * reproduce y puntúa idéntica.
 *
 * Esto no es el juego: no hay vaso dibujado ni máquina de estados completa.
 * Es el instrumento con el que se va a un bar, se graban treinta tiradas
 * reales y se calibra σ con datos en vez de con opiniones.
 */
import { ESPECIAL } from '@/core/baked/especial'
import { NEGRA } from '@/core/baked/negra'
import {
  STEP_MS, createState, finalize, step, tap,
  type GameTrace, type ScoreResult, type ScoreState, type TraceSample,
} from '@/core/scoring'
import type { BakedVariety } from '@/core/types'
import { toDdeg, type Fusion } from '@/sensors/fusion'

const VARIETIES: Record<string, BakedVariety> = { especial: ESPECIAL, negra: NEGRA }
/** Tras cerrar el grifo, 2 s de reposo antes del resultado (plan §1.2). */
const SETTLE_MS = 2000
/** Techo de recuperación del acumulador: nunca alcanzar más de esto de golpe. */
const MAX_CATCHUP_MS = 250

export function mountTraceRecorder(root: HTMLElement, fusion: Fusion): () => void {
  root.innerHTML = `
    <div class="flex flex-col gap-3">
      <div class="flex items-center gap-2">
        <select id="variety" class="flex-1 rounded border border-ambar-dim bg-transparent px-2 py-2 text-sm">
          <option value="especial">Ambar Especial</option>
          <option value="negra">Ambar Negra</option>
        </select>
        <button id="reset" class="rounded border border-ambar-dim px-3 py-2 text-sm">REINICIAR</button>
      </div>

      <div id="pad" class="relative flex h-64 select-none items-center justify-center rounded bg-black/40 text-center">
        <div id="padLabel" class="px-6 text-sm text-ambar-dim">toca para <b class="text-ambar-foam">ABRIR EL GRIFO</b></div>
        <div id="hud" class="absolute top-3 font-mono text-3xl tabular-nums">—</div>
        <div id="fill" class="absolute bottom-0 left-0 w-full origin-bottom bg-ambar-beer/25" style="height:0"></div>
        <div id="foam" class="absolute left-0 w-full bg-ambar-foam/40" style="height:0;bottom:0"></div>
      </div>

      <dl id="live" class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-xs text-ambar-dim"></dl>
      <div class="flex gap-2">
        <button id="copy" class="flex-1 rounded border border-ambar-dim px-3 py-3 text-sm">COPIAR TRAZA</button>
        <button id="dl" class="flex-1 rounded border border-ambar-dim px-3 py-3 text-sm">DESCARGAR .json</button>
      </div>
      <p id="note" class="text-xs text-ambar-dim"></p>
    </div>
  `
  const $ = <T extends HTMLElement>(id: string): T => root.querySelector<T>(`#${id}`)!
  const pad = $('pad'), hud = $('hud'), padLabel = $('padLabel')
  const fillEl = $('fill'), foamEl = $('foam'), liveEl = $('live'), note = $('note')

  let v: BakedVariety = ESPECIAL
  let st: ScoreState = createState()
  let samples: TraceSample[] = []
  let taps: number[] = []
  let pendingTap = false
  let simT = 0
  let acc = 0
  let lastFrame = 0
  let closedAt: number | null = null
  let result: ScoreResult | null = null
  let raf = 0

  function reset(): void {
    st = createState(); samples = []; taps = []; pendingTap = false
    simT = performance.now(); acc = 0; lastFrame = simT
    closedAt = null; result = null
    padLabel.innerHTML = 'toca para <b class="text-ambar-foam">ABRIR EL GRIFO</b>'
    padLabel.classList.remove('hidden')
    hud.classList.remove('opacity-0')
    note.textContent = ''
  }

  const LABELS = ['ABRIR EL GRIFO', 'PASAR A ESPUMA', 'CERRAR']
  pad.addEventListener('pointerdown', () => {
    if (result || st.phase === 'closed') return
    pendingTap = true
  })

  $('reset').addEventListener('click', reset)
  $('variety').addEventListener('change', (e) => {
    v = VARIETIES[(e.target as HTMLSelectElement).value] ?? ESPECIAL
    reset()
  })

  function buildTrace(): GameTrace {
    return {
      version: 1, varietyId: v.id, stepMs: STEP_MS, samples, taps,
      meta: {
        recordedAt: new Date().toISOString(),
        ua: navigator.userAgent,
        sign: fusion.sign,
        sensorHz: +fusion.rateHz().toFixed(1),
        dpr: devicePixelRatio,
      },
    }
  }

  $('copy').addEventListener('click', () => {
    const json = JSON.stringify(buildTrace())
    void navigator.clipboard?.writeText(json).then(
      () => { note.textContent = `copiada: ${samples.length} muestras, ${(json.length / 1024).toFixed(1)} KB` },
      () => { console.log(json); note.textContent = 'el portapapeles falló; va por consola' },
    )
  })

  $('dl').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(buildTrace())], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `traza-${v.id}-${Date.now()}.json`
    a.click()
    setTimeout(() => { URL.revokeObjectURL(a.href) }, 1000)
  })

  // --- El bucle de 100 Hz ------------------------------------------------
  //
  // Tres relojes: el sensor (30-60 Hz irregular), rAF (30/60/120) y la
  // simulación (100 Hz fijo, la única verdad). El acumulador es lo que hace
  // que un iPhone a 120 fps y un Android a 30 puntúen idéntico.
  function frame(now: number): void {
    raf = requestAnimationFrame(frame)
    acc += Math.min(now - lastFrame, MAX_CATCHUP_MS)
    lastFrame = now

    while (acc >= STEP_MS) {
      acc -= STEP_MS
      const a = fusion.sampleAt(simT)
      simT += STEP_MS
      if (!a) continue

      const smp: TraceSample = { phiDdeg: toDdeg(a.phi), rhoDdeg: toDdeg(a.rho) }
      if (pendingTap) {
        pendingTap = false
        taps.push(samples.length)
        tap(st)
        if (st.phase === 'closed') closedAt = now
        padLabel.innerHTML = st.phase === 'closed'
          ? 'reposando…'
          : `toca para <b class="text-ambar-foam">${LABELS[taps.length] ?? ''}</b>`
        // El HUD se desvanece al abrir el grifo. A partir de aquí no hay un
        // solo número en pantalla hasta el resultado.
        if (taps.length === 1) hud.classList.add('opacity-0')
      }
      samples.push(smp)
      step(v, st, smp)
    }

    if (closedAt !== null && result === null && now - closedAt > SETTLE_MS) {
      result = finalize(v, st)
      hud.classList.remove('opacity-0')
      hud.textContent = result.score.toLocaleString('es-ES')
      padLabel.innerHTML = `error medio <b class="text-ambar-foam">${result.meanErrorDeg.toFixed(0)}°</b>` +
        (result.verdict === 'spilled' ? ' · <b>CAÑA DERRAMADA</b>' : '')
      padLabel.classList.remove('hidden')
    }

    // --- Pintado (fuera del paso fijo, a la cadencia de rAF) -------------
    if (result === null) {
      const { phi, rho } = fusion.angles
      if (taps.length === 0) hud.textContent = `${phi.toFixed(3)}°`
      fillEl.style.height = `${Math.min(100, st.f * 100)}%`
      foamEl.style.height = `${Math.min(100, st.foam * 100)}%`
      foamEl.style.bottom = `${Math.min(100, (st.f - st.foam) * 100)}%`

      const fi = Math.min(1000, Math.max(0, Math.round(st.f * 1000)))
      liveEl.innerHTML = ([
        ['fase', st.phase],
        ['pasos', `${st.steps} (${(st.steps / 100).toFixed(2)} s)`],
        ['llenado', `${(st.f * 100).toFixed(1)}% · espuma ${(st.foam * 100).toFixed(1)}%`],
        ['objetivo φ', `${(v.TARGET_DDEG[fi]! / 10).toFixed(1)}°  (derrame ${(v.SPILL_DDEG[fi]! / 10).toFixed(1)}°)`],
        ['ρ', `${rho.toFixed(1)}°`],
        ['sensor', `${fusion.rateHz().toFixed(0)} Hz`],
        ['derrames', String(st.spillEvents)],
      ] as const).map(([k, val]) => `<dt>${k}</dt><dd class="text-right text-ambar-foam">${val}</dd>`).join('')
    }
  }

  reset()
  raf = requestAnimationFrame(frame)
  return () => { cancelAnimationFrame(raf) }
}
