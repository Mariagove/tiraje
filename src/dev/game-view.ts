/**
 * game-view.ts — el prototipo jugable.
 *
 * Un solo rAF conduce las tres capas: avanza el bucle (que internamente da
 * pasos de 10 ms clavados), dibuja, y mide el coste para el escalado.
 *
 * La UI va en DOM, no en canvas: texto nítido gratis, `tabular-nums`, y no
 * cuesta fillrate. Y durante la partida esta capa está VACÍA — toda la
 * retroalimentación es diegética.
 */
import { ESPECIAL } from '@/core/baked/especial'
import { NEGRA } from '@/core/baked/negra'
import type { GameTrace, ScoreResult } from '@/core/scoring'
import type { BakedVariety } from '@/core/types'
import { GameLoop, HUD_FADE_MS, type GameState } from '@/game/loop'
import { Glass2D } from '@/render/glass2d'
import { TierController } from '@/render/tier'
import type { GlassRenderer } from '@/render/types'
import { OneEuro } from '@/sensors/oneEuro'
import { ThumbSource } from '@/sensors/thumbSource'
import type { Fusion } from '@/sensors/fusion'
import type { AngleSource } from '@/game/loop'
import type { Angles } from '@/sensors/fusion'

const VARIETIES: Record<string, BakedVariety> = { especial: ESPECIAL, negra: NEGRA }
const RANKING_KEY = 'tiraje.ranking.v1'
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

interface Entry {
  initials: string
  score: number
  variety: string
  at: number
  /** Plan §1.7: rankings separados, nunca fusionados. */
  mode: 'sensor' | 'practice'
}

/**
 * Elige la fuente de ángulo en caliente.
 *
 * Los tres «no hay sensor» del plan §1.7 no son el mismo caso, pero tienen la
 * misma respuesta: pasar al dedo. Y `granted-but-silent` puede aparecer 1,2 s
 * DESPUÉS de montar la vista, así que la decisión se consulta en cada muestra
 * en vez de tomarse una vez.
 */
class HybridSource implements AngleSource {
  constructor(private readonly f: Fusion, private readonly thumb: ThumbSource) {}
  get practice(): boolean {
    const k = this.f.status.kind
    return k === 'idle' || k === 'no-api' || k === 'denied' || k === 'granted-but-silent'
  }
  sampleAt(t: number): Angles | null {
    return this.practice ? this.thumb.sampleAt() : this.f.sampleAt(t)
  }
  get accelMag(): number { return this.practice ? 9.81 : this.f.accelMag }
  get omegaMag(): number { return this.practice ? 0 : this.f.omegaMag }
  calibrateRoll(): number { return this.practice ? 0 : this.f.calibrateRoll() }
}

/** `localStorage` puede tirar en modo privado. Nunca romper el juego por esto. */
function readRanking(): Entry[] {
  try { return JSON.parse(localStorage.getItem(RANKING_KEY) ?? '[]') as Entry[] }
  catch { return [] }
}
function writeRanking(rows: Entry[]): void {
  try { localStorage.setItem(RANKING_KEY, JSON.stringify(rows.slice(0, 10))) } catch { /* privado */ }
}

const PROMPTS: Partial<Record<GameState, string>> = {
  CALIBRATE: 'inclínalo como un vaso · toca para <b class="text-ambar-foam">ABRIR EL GRIFO</b>',
  READY: 'inclínalo como un vaso · toca para <b class="text-ambar-foam">ABRIR EL GRIFO</b>',
  POUR_BEER: '',
  POUR_FOAM: '',
  CLOSING: '',
  SETTLE: '',
}

export function mountGameView(
  root: HTMLElement, fusion: Fusion, qrVariety: string | null = null,
): () => void {
  // El móvil es el vaso: el canvas es la pantalla entera, en `fixed`, y la UI
  // flota encima. Sólo los controles reciben punteros; el resto de la
  // pantalla es zona de toque, porque toda ella es el vaso.
  root.innerHTML = `
    <canvas id="glass" class="fixed inset-0 z-0 h-full w-full"></canvas>

    <div class="pointer-events-none fixed inset-0 z-10 flex flex-col items-center justify-between
                px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(4.5rem,calc(env(safe-area-inset-top)+3.5rem))]">
      <div id="hud" class="font-mono text-4xl tabular-nums transition-opacity"
           style="transition-duration:${HUD_FADE_MS}ms">—</div>
      <div id="prompt" class="text-center text-sm text-ambar-foam/70 [text-shadow:0_1px_3px_rgba(0,0,0,.7)]"></div>
    </div>

    <div class="pointer-events-none fixed inset-x-0 bottom-0 z-20 flex justify-center
                px-5 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div id="resultCard" class="pointer-events-auto hidden w-full max-w-sm flex-col gap-3 rounded-xl
                  border border-white/15 bg-black/70 p-4 backdrop-blur-md">
        <div class="text-center">
          <div class="text-[0.65rem] tracking-widest text-ambar-dim">PUNTUACIÓN</div>
          <div id="score" class="font-mono text-5xl tabular-nums">0</div>
          <div id="verdict" class="mt-1 text-xs text-ambar-dim"></div>
        </div>
        <div class="flex items-center justify-center gap-4">
          ${[0, 1, 2].map((i) => `
            <div class="flex flex-col items-center">
              <button data-up="${i}" class="px-4 py-1 text-lg text-ambar-dim">▲</button>
              <div data-slot="${i}" class="font-mono text-4xl">A</div>
              <button data-down="${i}" class="px-4 py-1 text-lg text-ambar-dim">▼</button>
            </div>`).join('')}
        </div>
        <button id="save" class="rounded-lg bg-ambar-beer px-4 py-3 font-bold text-ambar-ink">GUARDAR Y OTRA CAÑA</button>
        <ol id="ranking" class="font-mono text-xs text-ambar-dim"></ol>
      </div>
    </div>

    <div class="pointer-events-none fixed inset-x-0 top-0 z-20 flex items-start justify-end gap-2
                px-5 pt-[max(2.8rem,calc(env(safe-area-inset-top)+2.4rem))]">
      <select id="variety" class="pointer-events-auto rounded border border-white/20 bg-black/60 px-2 py-1 text-xs backdrop-blur">
        <option value="especial">Especial</option>
        <option value="negra">Negra</option>
      </select>
      <button id="dbgToggle" class="pointer-events-auto rounded border border-white/20 bg-black/60 px-2 py-1 text-xs backdrop-blur">DEBUG</button>
    </div>

    <dl id="dbg" class="pointer-events-none fixed left-5 top-[max(2.8rem,calc(env(safe-area-inset-top)+2.4rem))] z-20
               hidden grid-cols-[auto_1fr] gap-x-3 rounded bg-black/70 p-2 font-mono text-[0.65rem] text-ambar-dim backdrop-blur"></dl>
  `
  const $ = <T extends HTMLElement>(sel: string): T => root.querySelector<T>(sel)!
  const canvas = $<HTMLCanvasElement>('#glass')
  const hud = $('#hud'), prompt = $('#prompt')
  const card = $('#resultCard'), dbg = $('#dbg')

  // La variedad viene en el QR (?v=especial), no de una pantalla de selección.
  let v: BakedVariety = VARIETIES[qrVariety ?? ''] ?? ESPECIAL
  $<HTMLSelectElement>('#variety').value = v.id
  let renderer: GlassRenderer = new Glass2D(canvas, v)
  const tier = new TierController()
  const smooth = new OneEuro(1.0, 0.007)
  const initials = [0, 0, 0]
  let lastResult: ScoreResult | null = null
  let lastTrace: GameTrace | null = null
  let raf = 0
  let lastNow = 0
  let drawMs = 0

  const thumb = new ThumbSource(canvas)
  const src = new HybridSource(fusion, thumb)

  let loop = build()
  function build(): GameLoop {
    return new GameLoop({
      variety: v,
      source: src,
      onState: (s) => {
        prompt.innerHTML = PROMPTS[s] ?? ''
        // El HUD se desvanece al abrir el grifo, 250 ms sin rebote, y a partir
        // de ahí no hay un solo número hasta el resultado.
        //
        // Se mira el estado de DESTINO, no la transición concreta: ahora se
        // puede abrir el grifo desde CALIBRATE además de desde READY, y
        // condicionarlo a `prev === 'READY'` dejaba el número en pantalla.
        if (s === 'POUR_BEER') hud.style.opacity = '0'
        if (s === 'READY') { hud.style.opacity = '1'; card.classList.add('hidden'); card.classList.remove('flex') }
      },
      onResult: (r, t) => {
        lastResult = r; lastTrace = t
        // El HUD se queda oculto; el resumen en grados enteros va en la
        // tarjeta. Se vacía para no dejar un ángulo obsoleto en el DOM.
        hud.style.opacity = '0'
        hud.textContent = ''
        $('#score').textContent = r.score.toLocaleString('es-ES')
        $('#verdict').innerHTML = (r.verdict === 'spilled' ? '<b>CAÑA DERRAMADA</b> · ' : '') +
          `error medio ${r.meanErrorDeg.toFixed(0)}° · ${(r.fill * 100).toFixed(0)}% lleno, ` +
          `${(r.foam * 100).toFixed(0)}% de corona`
        card.classList.remove('hidden'); card.classList.add('flex')
        renderRanking()
      },
    })
  }

  // La cavidad es el viewport. `visualViewport` porque en iOS la barra de
  // Safari entra y sale y `innerHeight` se queda desactualizado.
  function resize(): void {
    const vv = window.visualViewport
    renderer.resize(vv?.width ?? innerWidth, vv?.height ?? innerHeight, devicePixelRatio)
  }
  addEventListener('resize', resize)
  window.visualViewport?.addEventListener('resize', resize)
  resize()

  // Un toque en el escenario. Aquí sólo se encola; el paso de simulación le
  // pone el índice, para que la traza sea exacta.
  //
  // En modo práctica el mismo gesto sirve para arrastrar el ángulo, así que
  // hay que distinguir: un toque es corto y quieto, un arrastre no.
  let downAt = 0
  let downY = 0
  let moved = 0
  canvas.addEventListener('pointerdown', (e) => {
    if (!src.practice) { loop.queueTap(); return }
    downAt = performance.now(); downY = e.clientY; moved = 0
  })
  canvas.addEventListener('pointermove', (e) => {
    if (src.practice && downAt > 0) moved = Math.max(moved, Math.abs(e.clientY - downY))
  })
  canvas.addEventListener('pointerup', () => {
    if (src.practice && downAt > 0 && moved < 8 && performance.now() - downAt < 400) loop.queueTap()
    downAt = 0
  })

  $('#variety').addEventListener('change', (e) => {
    v = VARIETIES[(e.target as HTMLSelectElement).value] ?? ESPECIAL
    renderer.dispose()
    renderer = new Glass2D(canvas, v)
    renderer.setTier(tier.tier)
    resize()
    loop = build()
  })

  $('#dbgToggle').addEventListener('click', () => {
    dbg.classList.toggle('hidden')
    dbg.classList.toggle('grid')
  })

  // --- Iniciales estilo recreativa --------------------------------------
  const drawSlots = (): void => {
    for (let i = 0; i < 3; i++) {
      root.querySelector(`[data-slot="${i}"]`)!.textContent = LETTERS[initials[i]!]!
    }
  }
  root.querySelectorAll('[data-up]').forEach((b) => {
    b.addEventListener('click', () => {
      const i = Number((b as HTMLElement).dataset['up'])
      initials[i] = (initials[i]! + 25) % 26
      drawSlots()
    })
  })
  root.querySelectorAll('[data-down]').forEach((b) => {
    b.addEventListener('click', () => {
      const i = Number((b as HTMLElement).dataset['down'])
      initials[i] = (initials[i]! + 1) % 26
      drawSlots()
    })
  })
  drawSlots()

  function renderRanking(): void {
    const rows = readRanking().toSorted((a, b) => b.score - a.score || a.at - b.at)
    // Oficial (sensor) y de práctica (dedo) no se mezclan nunca.
    const mine = rows.filter((r) => r.mode === (src.practice ? 'practice' : 'sensor'))
    $('#ranking').innerHTML =
      `<li class="mb-1 tracking-widest">${src.practice ? 'RANKING DE PRÁCTICA' : 'RANKING OFICIAL'}</li>` +
      mine.slice(0, 5).map((r, i) =>
        `<li class="flex justify-between"><span>${i + 1}. ${r.initials} · ${r.variety}</span>` +
        `<span class="text-ambar-foam">${r.score.toLocaleString('es-ES')}</span></li>`).join('')
  }

  $('#save').addEventListener('click', () => {
    if (lastResult) {
      const rows = readRanking()
      rows.push({
        initials: initials.map((i) => LETTERS[i]!).join(''),
        score: lastResult.score, variety: v.id, at: Date.now(),
        mode: src.practice ? 'practice' : 'sensor',
      })
      writeRanking(rows.toSorted((a, b) => b.score - a.score || a.at - b.at))
    }
    // OTRA CAÑA: cambio de estado. Jamás una recarga — sería un prompt nuevo.
    loop.restart()
  })

  // --- El único rAF ------------------------------------------------------
  function frame(now: number): void {
    raf = requestAnimationFrame(frame)
    loop.advance(now)

    const t0 = performance.now()
    renderer.draw(loop.frame())
    drawMs = performance.now() - t0

    // Se mide el coste de NUESTRO dibujo, no el intervalo entre frames: una
    // pantalla bloqueada a 30 Hz daría 33 ms de intervalo con un dibujo
    // baratísimo, y degradaríamos al tier 3 sin motivo.
    if (tier.sample(drawMs)) renderer.setTier(tier.tier)

    const st = loop.state
    if (st === 'CALIBRATE') {
      // Se informa de la calibración sin convertirla en una espera: el toque
      // ya abre el grifo, quedarse quieto sólo la mejora.
      const pct = Math.round(loop.restProgress * 100)
      prompt.innerHTML = 'inclínalo como un vaso · toca para <b class="text-ambar-foam">ABRIR EL GRIFO</b>'
        + (pct > 0 ? `<br><span class="text-[0.65rem] opacity-60">calibrando ${pct}%</span>` : '')
    }
    if (st === 'CALIBRATE' || st === 'READY') {
      // 3 decimales: sólo son honestos con el móvil quieto, y en estos dos
      // estados lo está. Establecen que el instrumento es de precisión y dan
      // la referencia de los 45° de salida.
      hud.textContent = `${smooth.filter(loop.frame().phi, now).toFixed(3)}°`
    }

    if (!dbg.classList.contains('hidden')) {
      const f = loop.frame()
      dbg.innerHTML = ([
        ['estado', st],
        ['dibujo', `${drawMs.toFixed(1)} ms (media ${tier.meanFrameMs.toFixed(1)})`],
        ['intervalo', `${(now - lastNow).toFixed(1)} ms`],
        ['tier', `${tier.level} · ${tier.tier.bubbles} burbujas · DPR ${tier.tier.maxDpr}`],
        ['renderer', renderer.kind],
        ['fuente', src.practice ? 'dedo (práctica)' : 'sensor'],
        ['sensor', `${fusion.rateHz().toFixed(0)} Hz`],
        ['φ / objetivo', `${f.phi.toFixed(1)}° / ${f.targetPhi.toFixed(1)}°`],
        ['confianza', `${(fusion.planarConfidence * 100).toFixed(0)}%`],
        ['lado', f.pourSide > 0 ? '+1 (izquierda)' : '−1 (derecha)'],
        ['derramando', f.spillingOver ? 'sí' : 'no'],
        ['calidad', f.quality.toFixed(3)],
        ['llenado', `${(f.fill * 100).toFixed(1)}% · espuma ${(f.foam * 100).toFixed(1)}%`],
        ['chapoteo', `${f.sloshDeg.toFixed(2)}°`],
        ['traza', `${loop.trace().samples.length} muestras`],
      ] as const).map(([k, val]) => `<dt>${k}</dt><dd class="text-right text-ambar-foam">${val}</dd>`).join('')
    }
    lastNow = now
  }

  renderRanking()
  raf = requestAnimationFrame(frame)

  return () => {
    cancelAnimationFrame(raf)
    removeEventListener('resize', resize)
    window.visualViewport?.removeEventListener('resize', resize)
    thumb.dispose()
    renderer.dispose()
    if (lastTrace) console.log('última traza', lastTrace)
  }
}
