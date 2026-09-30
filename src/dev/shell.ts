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
// Vite le pone hash al nombre y devuelve la URL ya con el `base` del build
// aplicado. Referenciarlo a mano como '/ambar.png' daría 404 en Pages, donde
// el sitio vive en /tiraje/.
import logoAmbar from '@/assets/ambar.png'

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

/**
 * La piel la decide la vista, y la decide en un solo sitio.
 *
 * Tirar la caña es negro porque la pantalla ES el vaso; todo lo demás va sobre
 * papel blanco con tinta de marca — y el vaso ya no es negro tampoco, es el
 * rojo de marca. `theme-color` va con ello: en iOS pinta la barra de estado,
 * y una barra de un color que no es el de la pantalla se ve como un recorte.
 */
function skin(screen: 'game' | 'ui'): void {
  document.body.dataset['screen'] = screen
  document.querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', screen === 'game' ? '#b02c31' : '#ffffff')
}

export function mountShell(root: HTMLElement): void {
  const webview = detectInAppBrowser()
  const aged = isAgeConfirmed()
  const params = new URLSearchParams(location.search)
  // La variedad va en el QR (?v=especial), no en una pantalla de selección.
  const qrVariety = params.get('v')
  /**
   * Qué vista se monta al entrar.
   *
   * Las pestañas JUEGO / SENSOR / TRAZA se han quitado: son instrumentos de
   * medida, no juego, y en la pantalla del jugador estorban. No se borran,
   * porque la fase 2 se calibra con ellas y hacen falta en cada móvil nuevo;
   * se llega con `?vista=sensor` o `?vista=trace`.
   */
  const vista = params.get('vista') ?? 'game'

  root.innerHTML = `
    <main class="mx-auto flex min-h-dvh max-w-md flex-col gap-4 p-5 pt-[max(1.25rem,env(safe-area-inset-top))] pb-[max(1.25rem,env(safe-area-inset-bottom))]">
      <header id="cabecera" class="relative z-30 flex items-baseline justify-between">
        <h1 class="text-xs tracking-[0.3em] text-ambar-dim">TIRAJE</h1>
      </header>

      <section id="gate" class="flex flex-col gap-4">
        ${webview ? `<p class="rounded border border-current p-3 text-sm">
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
          class="boton px-4 py-5 text-base font-bold leading-snug">
          ${aged ? 'TIRAR CAÑA' : 'Sí, soy mayor de 18 · TIRAR CAÑA'}
        </button>
        <p class="text-xs text-ambar-dim">
          Al tocar, el móvil te pedirá permiso para usar el sensor de movimiento.
          Es lo que mide el ángulo del vaso: sin eso no hay juego.
        </p>
      </section>

      <section id="view"></section>
      <div id="status" class="relative z-30 mt-auto w-fit"></div>
    </main>
  `
  const $ = <T extends HTMLElement>(id: string): T => root.querySelector<T>(`#${id}`)!
  const statusEl = $('status'), viewEl = $('view'), gate = $('gate')

  /**
   * Cuando el sensor va bien, el logo; cuando no, el aviso.
   *
   * El cartelito que ponía «midiendo» era ruido: si el juego responde a la
   * inclinación, ya se ve que mide. Ahí va la marca, que es lo que pidió el
   * estudio. Lo que **no** se puede sustituir por un logo son los tres
   * «no hay sensor»: ésos cambian a qué estás jugando —al dedo, con ranking
   * de práctica aparte— y hay que poder leerlos.
   *
   * El logotipo va sin fondo: se le quitó el blanco del PNG deshaciendo la
   * composición sobre blanco, así que conserva el antialias. Medido, su
   * granate `#A23736` sobre el fondo `#B02C31` da 1,04:1 de contraste, o sea
   * que en el vaso vacío casi no se ve; sobre la cerveza sube a 3,11:1 y
   * sobre el papel blanco de las demás pantallas, a 6,70:1. Lo pidió así el
   * estudio, y un logotipo de cliente no se recolorea por cuenta propia.
   */
  function paintStatus(s: SensorStatus): void {
    if (s.kind === 'live' || s.kind === 'probing') {
      statusEl.innerHTML = `<img src="${logoAmbar}" alt="Ambar" class="block h-6 w-auto" />`
      return
    }
    // `idle` no es un fallo, es que todavía no se ha tocado el botón: va en
    // texto apagado. Los otros tres sí lo son y van en negrita.
    const aviso = s.kind === 'idle' ? 'text-ambar-dim' : 'font-bold text-ambar-beer'
    statusEl.innerHTML =
      `<span class="chip block rounded px-1.5 py-0.5 text-xs ${aviso}">${STATUS_ES[s.kind]}</span>`
  }

  const fusion = new Fusion({ onStatus: paintStatus })

  let teardown: (() => void) | null = null
  skin('ui')

  function show(view: string): void {
    teardown?.()
    skin(view === 'game' ? 'game' : 'ui')
    // En el juego la pantalla ES el vaso: el título de arriba sobra.
    $('cabecera').classList.toggle('hidden', view === 'game')
    teardown = view === 'trace' ? mountTraceRecorder(viewEl, fusion)
      : view === 'sensor' ? mountSensorSlice(viewEl, fusion)
        : mountGameView(viewEl, fusion, qrVariety)
  }

  $('go').addEventListener('click', () => {
    // Primera línea del handler: pedir el permiso. Sin `await` por delante,
    // sin `async` en el handler. Si esto se mueve, en iOS deja de funcionar
    // y no da ningún error que lo explique.
    const p = requestMotionPermission()

    // Todo lo demás, después. El age gate va aquí porque ya no exige gesto.
    confirmAge()
    gate.classList.add('hidden')

    void p.then((outcome) => {
      if (outcome !== 'no-api' && outcome !== 'denied') fusion.start()
      else paintStatus({ kind: outcome === 'no-api' ? 'no-api' : 'denied' } as SensorStatus)
      show(vista)
    })
  })
}
