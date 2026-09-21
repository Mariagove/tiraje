/**
 * shell.ts — el gate de entrada de un solo toque y las vistas.
 *
 * Plan §1.6. El hecho que condiciona todo el diseño de entrada: iOS exige
 * `requestPermission()` desde un gesto de usuario y **Safari no cachea el
 * permiso por dominio** — el prompt sale en cada carga. Con un QR, eso es un
 * prompt por escaneo.
 *
 * Por eso un único `pointerdown` hace, de forma síncrona antes de cualquier
 * `await`, todo lo que exige gesto. Y ese botón es a la vez el age gate, que
 * es obligatorio por ser cerveza.
 *
 * Las instrucciones van ALREDEDOR del botón, no detrás: cuando aparezca el
 * diálogo de iOS tiene que tener sentido.
 *
 * Cambiar de vista NO recarga ni navega. Nunca.
 */
import { Fusion, requestMotionPermission, type SensorStatus } from '@/sensors/fusion'
import { mountSensorSlice } from '@/dev/sensor-slice'
import { mountTraceRecorder } from '@/dev/trace-recorder'
import { mountGameView } from '@/dev/game-view'

const AGE_KEY = 'tiraje.age.v1'

/** Sobrevive aunque el permiso no: en el re-escaneo son cero toques de edad. */
function isAgeConfirmed(): boolean {
  try { return localStorage.getItem(AGE_KEY) === '1' } catch { return false }
}
function confirmAge(): void {
  try { localStorage.setItem(AGE_KEY, '1') } catch { /* modo privado */ }
}

/** Webviews que en iOS no conceden sensores y de los que JS no puede salir. */
function detectInAppBrowser(): string | null {
  const ua = navigator.userAgent
  if (/FBAN|FBAV|FB_IAB/i.test(ua)) return 'Facebook'
  if (/Instagram/i.test(ua)) return 'Instagram'
  if (/(BytedanceWebview|TikTok|musical_ly)/i.test(ua)) return 'TikTok'
  if (/Twitter|LinkedInApp|Snapchat/i.test(ua)) return 'otra app'
  return null
}

const STATUS_ES: Record<SensorStatus['kind'], string> = {
  idle: 'sin pedir',
  'no-api': 'NO HAY API — modo práctica: arrastra el dedo',
  denied: 'DENEGADO — modo práctica: arrastra el dedo',
  'granted-but-silent': 'CONCEDIDO PERO MUDO — modo práctica: arrastra el dedo',
  probing: 'sondeando el signo…',
  live: 'midiendo',
}

export function mountShell(root: HTMLElement): void {
  const webview = detectInAppBrowser()
  const aged = isAgeConfirmed()
  // La variedad va en el QR (?v=especial), no en una pantalla de selección.
  const qrVariety = new URLSearchParams(location.search).get('v')

  root.innerHTML = `
    <main class="mx-auto flex min-h-dvh max-w-md flex-col gap-4 p-5 pt-[max(1.25rem,env(safe-area-inset-top))]">
      <header class="relative z-30 flex items-baseline justify-between">
        <h1 class="text-xs tracking-[0.3em] text-ambar-dim">TIRAJE</h1>
        <nav id="tabs" class="hidden gap-1 rounded bg-black/60 p-0.5 text-xs backdrop-blur">
          <button data-view="game" class="rounded px-2 py-1">JUEGO</button>
          <button data-view="sensor" class="rounded px-2 py-1">SENSOR</button>
          <button data-view="trace" class="rounded px-2 py-1">TRAZA</button>
        </nav>
      </header>

      <section id="gate" class="flex flex-col gap-4">
        ${webview ? `<p class="rounded border border-ambar-beer p-3 text-sm">
          Estás en el navegador de <b>${webview}</b>. En iOS no da permiso de
          sensores y desde aquí no se puede salir. Toca <b>···</b> y abre el
          enlace en Safari.
        </p>` : ''}
        <!-- Instrucciones ALREDEDOR del botón: arriba el qué, abajo el cómo. -->
        <p class="text-sm text-ambar-dim">
          El móvil es el vaso. Lo inclinas, lo enderezas conforme sube el nivel,
          y tiras la caña perfecta en tres toques.
        </p>
        <button id="go"
          class="rounded bg-ambar-beer px-4 py-5 text-base font-bold leading-snug text-ambar-ink active:opacity-80">
          ${aged ? 'TIRAR CAÑA' : 'Sí, soy mayor de 18 · TIRAR CAÑA'}
        </button>
        <p class="text-xs text-ambar-dim">
          Al tocar, el móvil te pedirá permiso para usar el sensor de movimiento.
          Es lo que mide el ángulo del vaso: sin eso no hay juego.
        </p>
      </section>

      <section id="view"></section>
      <p id="status" class="relative z-30 mt-auto w-fit rounded bg-black/55 px-1.5 py-0.5 text-xs text-ambar-dim backdrop-blur">sin pedir</p>
    </main>
  `
  const $ = <T extends HTMLElement>(id: string): T => root.querySelector<T>(`#${id}`)!
  const statusEl = $('status'), viewEl = $('view'), tabs = $('tabs'), gate = $('gate')

  const fusion = new Fusion({
    onStatus: (s) => {
      statusEl.textContent = STATUS_ES[s.kind]
      const base = 'relative z-30 mt-auto w-fit rounded bg-black/55 px-1.5 py-0.5 text-xs backdrop-blur'
      statusEl.className = `${base} ${s.kind === 'live' || s.kind === 'probing' ? 'text-ambar-dim' : 'text-ambar-beer'}`
    },
  })

  let teardown: (() => void) | null = null
  function show(view: string): void {
    teardown?.()
    for (const b of tabs.querySelectorAll('button')) {
      b.className = b.dataset['view'] === view
        ? 'rounded bg-ambar-beer px-2 py-1 text-ambar-ink'
        : 'rounded px-2 py-1 text-ambar-dim'
    }
    teardown = view === 'trace' ? mountTraceRecorder(viewEl, fusion)
      : view === 'sensor' ? mountSensorSlice(viewEl, fusion)
        : mountGameView(viewEl, fusion, qrVariety)
  }
  tabs.addEventListener('click', (e) => {
    const v = (e.target as HTMLElement).dataset['view']
    if (v) show(v)   // cambio de vista, nunca recarga ni navegación
  })

  $('go').addEventListener('click', () => {
    // Primera línea del handler: pedir el permiso. Sin `await` por delante,
    // sin `async` en el handler. Si esto se mueve, en iOS deja de funcionar
    // y no da ningún error que lo explique.
    const p = requestMotionPermission()

    // Todo lo demás, después. El age gate va aquí porque ya no exige gesto.
    confirmAge()
    gate.classList.add('hidden')
    tabs.classList.remove('hidden')
    tabs.classList.add('flex')

    void p.then((outcome) => {
      if (outcome !== 'no-api' && outcome !== 'denied') fusion.start()
      else statusEl.textContent = STATUS_ES[outcome === 'no-api' ? 'no-api' : 'denied']
      show('game')
    })
  })
}
