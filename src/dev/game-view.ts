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
/** Cada cuánto se repinta el ángulo. */
const TICK_MS = 500

/**
 * El ángulo que ve el jugador, en grados enteros.
 *
 * Por dentro φ es el giro del móvil en el plano de su pantalla, y vale 0 con
 * el móvil de pie. Pero nadie lo lee así: con el móvil de pie, su lado largo
 * está a **90° del suelo**, y eso es lo que la gente dice. Así que se muestra
 * el ángulo respecto al SUELO, que es la referencia que tiene delante:
 *
 *   suelo (móvil tumbado)        →   0°
 *   a media inclinación           →  45°   (igual que antes, ahí coinciden)
 *   perpendicular (móvil de pie)  →  90°
 *
 * Es sólo presentación: el núcleo sigue puntuando con |φ| en décimas de grado
 * y la traza sigue llevando el entero de siempre. Cambiar la unidad AQUÍ y no
 * allí es deliberado — la puntuación de una traza vieja no puede depender de
 * cómo decidamos rotular el número hoy.
 */
export function gradosDelJugador(phiDeg: number): number {
  const a = phiDeg < 0 ? -phiDeg : phiDeg
  const g = 90 - a
  return Math.round(g < 0 ? 0 : g > 90 ? 90 : g)
}
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

/**
 * Las instrucciones, y sólo antes del primer toque.
 *
 * Tres líneas debajo del ángulo. Desaparecen al abrir el grifo y no vuelven:
 * a partir de ahí toda la retroalimentación es diegética, que es lo que se
 * decidió desde el principio.
 *
 * Ya no se anuncia la calibración. Era un porcentaje que subía en la parte de
 * abajo y no pedía nada al jugador —el toque abre el grifo esté calibrado o
 * no—, así que sólo era ruido con pinta de estar esperando algo.
 */
const INSTRUCCIONES = [
  'Usa la inclinación para tirar la caña perfecta',
  'Da un toque para abrir el grifo',
  'y un segundo toque para cerrarlo.',
].map((l) => `<div>${l}</div>`).join('')

const PROMPTS: Partial<Record<GameState, string>> = {
  CALIBRATE: INSTRUCCIONES,
  READY: INSTRUCCIONES,
  POUR_BEER: '',
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

    <!-- El ángulo va en el CENTRO de la pantalla, donde antes estaba el logo
         grabado en el cristal: es lo único que hay que leer mientras
         calibras, y en el centro se lee sin desviar la vista del líquido.
         En DOM y no en canvas: texto nítido gratis y cifras de ancho fijo,
         que es lo que evita que el número baile al cambiar de cifra. -->
    <div class="pointer-events-none fixed inset-0 z-10 flex flex-col items-center justify-center gap-4 px-8">
      <!-- Sombra: el número se queda durante todo el vertido, así que le pasa
           la cerveza por detrás. Crema sobre ámbar da 1,5:1 y no se lee. -->
      <div id="hud" class="font-mono text-6xl tabular-nums transition-opacity
                  [text-shadow:0_2px_8px_rgba(0,0,0,.5)]"
           style="transition-duration:${HUD_FADE_MS}ms">—</div>
      <div id="prompt" class="max-w-xs text-center text-sm leading-relaxed text-ambar-foam/85
                  [text-shadow:0_1px_3px_rgba(0,0,0,.45)]"></div>
    </div>

    <!-- La tarjeta va sobre papel blanco con tinta de marca, como el resto de
         pantallas que no son el vaso, y deja hueco por abajo para el logo:
         el relleno inferior es el alto del logotipo más un respiro, para que
         la tarjeta no se le monte encima. Todo el texto de dentro hereda el
         color, así que las clases de color no se repiten pieza a pieza. -->
    <div class="pointer-events-none fixed inset-x-0 bottom-0 z-20 flex justify-center
                px-5 pb-[calc(max(1rem,env(safe-area-inset-bottom))+3.5rem)]">
      <div id="resultCard" class="pointer-events-auto hidden w-full max-w-[19rem] flex-col gap-2
                  rounded-xl bg-white p-3 text-marca shadow-lg">
        <!-- Sin opacidades: el rojo rebajado sobre blanco se queda en 3,4:1 de
             contraste y este texto es de 0,7rem. La jerarquía la hacen el
             cuerpo y el peso, igual que en las demás pantallas. -->
        <div class="text-center">
          <div class="text-[0.6rem] tracking-widest">PUNTUACIÓN</div>
          <div id="score" class="font-mono text-5xl tabular-nums">0</div>
          <div id="verdict" class="mt-0.5 text-[0.7rem]"></div>
        </div>
        <div class="flex items-center justify-center gap-3">
          ${[0, 1, 2].map((i) => `
            <div class="flex flex-col items-center">
              <button data-up="${i}" class="px-3 py-0.5 text-base">▲</button>
              <div data-slot="${i}" class="font-mono text-3xl">A</div>
              <button data-down="${i}" class="px-3 py-0.5 text-base">▼</button>
            </div>`).join('')}
        </div>
        <button id="save" class="boton px-4 py-2.5 text-sm font-bold">GUARDAR Y OTRA CAÑA</button>
        <ol id="ranking" class="font-mono text-[0.7rem]"></ol>
      </div>
    </div>

    <!-- La variedad, en dos pestañas. La activa va en blanco sólido con la
         tinta de marca: el botón de marca es rojo sobre blanco, pero aquí el
         fondo YA es ese rojo, así que rojo sobre rojo no se vería. -->
    <div class="pointer-events-none fixed inset-x-0 top-0 z-20 flex items-start justify-center gap-1.5
                px-5 pt-[max(1.25rem,env(safe-area-inset-top))]">
      ${[['especial', 'ESPECIAL'], ['negra', 'NEGRA']].map(([id, label]) => `
        <button data-variety="${id}" class="pointer-events-auto rounded-full px-4 py-1.5 text-xs font-bold tracking-wide">${label}</button>`).join('')}
    </div>

    <dl id="dbg" class="pointer-events-none fixed left-5 top-[max(2.8rem,calc(env(safe-area-inset-top)+2.4rem))] z-20
               hidden grid-cols-[auto_1fr] gap-x-3 rounded bg-black/70 p-2 font-mono text-[0.65rem] text-ambar-dim backdrop-blur"></dl>
  `
  const $ = <T extends HTMLElement>(sel: string): T => root.querySelector<T>(sel)!
  const canvas = $<HTMLCanvasElement>('#glass')
  const hud = $('#hud'), prompt = $('#prompt')
  const card = $('#resultCard'), dbg = $('#dbg')

  // La variedad viene en el QR (?v=especial); las pestañas son para probar.
  let v: BakedVariety = VARIETIES[qrVariety ?? ''] ?? ESPECIAL
  let renderer: GlassRenderer = new Glass2D(canvas, v)
  const tier = new TierController()
  const smooth = new OneEuro(1.0, 0.007)
  const initials = [0, 0, 0]
  let lastResult: ScoreResult | null = null
  let lastTrace: GameTrace | null = null
  let raf = 0
  let lastNow = 0
  let drawMs = 0
  let lastTick = 0

  const thumb = new ThumbSource(canvas)
  const src = new HybridSource(fusion, thumb)

  /**
   * Pinta lo que corresponde al estado ACTUAL, sin esperar a una transición.
   *
   * `onState` sólo dispara al cambiar de estado, y al entrar en la vista no ha
   * cambiado nada todavía: el juego arranca en CALIBRATE. Sin esto, las
   * instrucciones no aparecían hasta que el gate de reposo pasaba a READY —un
   * segundo largo de pantalla muda, justo cuando el jugador no sabe qué hacer.
   * Y al cambiar de variedad se reconstruye el bucle, que es el mismo caso.
   */
  function pintaEstado(): void {
    prompt.innerHTML = PROMPTS[loop.state] ?? ''
    hud.style.opacity = '1'
    hud.textContent = `${gradosDelJugador(loop.frame().phi)}°`
  }

  let loop = build()
  function build(): GameLoop {
    return new GameLoop({
      variety: v,
      source: src,
      onState: (s) => {
        prompt.innerHTML = PROMPTS[s] ?? ''
        // El ángulo se queda EN PANTALLA durante todo el vertido y sólo se va
        // al cerrar el grifo.
        //
        // Antes desaparecía al abrir, para que el vertido fuera del todo
        // diegético. Ya no vale: con la corona saliendo de la inclinación, el
        // jugador necesita saber cuándo tiene el móvil recto, y el líquido
        // dibujado no da esa lectura con la precisión que hace falta.
        //
        // Se mira el estado de DESTINO, no la transición concreta: se puede
        // abrir el grifo desde CALIBRATE además de desde READY.
        if (s === 'CLOSING') hud.style.opacity = '0'
        if (s === 'READY') { hud.style.opacity = '1'; card.classList.add('hidden'); card.classList.remove('flex') }
      },
      onResult: (r, t) => {
        lastResult = r; lastTrace = t
        // El HUD se queda oculto; el resumen en grados enteros va en la
        // tarjeta. Se vacía para no dejar un ángulo obsoleto en el DOM.
        hud.style.opacity = '0'
        hud.textContent = ''
        // Una nota de 0 a 100: sin separador de miles y sin decimales.
        $('#score').textContent = String(r.score)
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

  /**
   * Pinta cuál de las dos pestañas está activa.
   *
   * La activa va en blanco sólido con la tinta de marca, y la otra en blanco
   * al 30% con el texto en blanco. El botón de marca es rojo con texto
   * blanco, pero esta pantalla YA es ese rojo: rojo sobre rojo no se ve.
   */
  function paintVariety(): void {
    for (const b of root.querySelectorAll<HTMLElement>('[data-variety]')) {
      const on = b.dataset['variety'] === v.id
      b.className = 'pointer-events-auto rounded-full px-4 py-1.5 text-xs font-bold tracking-wide '
        + (on ? 'bg-white text-marca' : 'bg-white/25 text-white')
    }
  }
  paintVariety()

  for (const b of root.querySelectorAll<HTMLElement>('[data-variety]')) {
    b.addEventListener('click', () => {
      const id = b.dataset['variety'] ?? ''
      if (id === v.id) return
      v = VARIETIES[id] ?? ESPECIAL
      paintVariety()
      renderer.dispose()
      renderer = new Glass2D(canvas, v)
      renderer.setTier(tier.tier)
      resize()
      loop = build()
      pintaEstado()
    })
  }

  // El panel de depuración ya no tiene botón: estorbaba en una pantalla que
  // es el vaso. Sigue ahí para calibrar, con `?debug=1` en la URL.
  if (new URLSearchParams(location.search).has('debug')) {
    dbg.classList.remove('hidden')
    dbg.classList.add('grid')
  }

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
        `<span class="font-bold">${r.score}</span></li>`).join('')
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

    // --- El latido lento: dos veces por segundo ---------------------------
    //
    // El ángulo se REFRESCA a 2 Hz, no a 60. No es una cifra menos: un número
    // que cambia sesenta veces por segundo no se lee, se percibe como
    // parpadeo, y además invita a perseguirlo. A 2 Hz y en grados enteros se
    // lee de un vistazo y se deja de mirar, que es lo que se quiere: el
    // instrumento de verdad es el líquido.
    //
    // El filtro sigue corriendo a cada frame; lo que se espacia es sólo el
    // pintado, así que el número que sale es el filtrado del instante, no una
    // media de medio segundo.
    const suave = smooth.filter(loop.frame().phi, now)
    if (now - lastTick >= TICK_MS) {
      lastTick = now
      if (st === 'CALIBRATE' || st === 'READY' || st === 'POUR_BEER') {
        hud.textContent = `${gradosDelJugador(suave)}°`
      }
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
        ['rebose', renderer instanceof Glass2D ? renderer.spillInfo : '—'],
        ['calidad', f.quality.toFixed(3)],
        ['llenado', `${(f.fill * 100).toFixed(1)}% · espuma ${(f.foam * 100).toFixed(1)}%`],
        ['chapoteo', `${f.sloshDeg.toFixed(2)}°`],
        ['traza', `${loop.trace().samples.length} muestras`],
      ] as const).map(([k, val]) => `<dt>${k}</dt><dd class="text-right text-ambar-foam">${val}</dd>`).join('')
    }
    lastNow = now
  }

  renderRanking()
  pintaEstado()
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
