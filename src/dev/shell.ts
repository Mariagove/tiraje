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
import { Sonido } from '@/audio/sound'
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
      <!-- Sin rótulo. El nombre del juego ya viene en el QR y en la pestaña
           del navegador; en la pantalla sólo competía con el texto que de
           verdad hay que leer. Al quitarlo la cabecera se quedaba vacía, así
           que se va entera y con ella el alternar que la escondía en el
           juego. -->
      <!-- Los tres bloques se centran en el alto libre, en vez de quedarse
           pegados arriba. El logotipo sigue abajo porque va fuera de esta
           sección. -->
      <section id="gate" class="flex flex-1 flex-col justify-center gap-5">
        ${webview ? `<p class="rounded border border-current p-3 text-sm">
          Estás en el navegador de <b>${webview}</b>. En iOS no da permiso de
          sensores y desde aquí no se puede salir. Toca <b>···</b> y abre el
          enlace en Safari.
        </p>` : ''}
        <!-- Instrucciones ALREDEDOR del botón: arriba el qué, abajo el cómo.
             El "qué" va en la titular y a cuerpo grande: es lo primero que se
             lee al escanear el QR y lo único que explica el juego. -->
        <p class="font-titular text-center text-xl font-bold leading-snug text-ambar-dim">
          El móvil es el vaso. Lo inclinas, lo enderezas conforme sube el nivel,
          y tiras la caña perfecta en dos toques.
        </p>
        <!-- El botón se ajusta al texto en vez de ocupar todo el ancho: a
             ancho completo quedaba un desierto a los lados de dos palabras.
             Y en píldora, que es lo que se pidió. La tipografía, la misma
             titular que la explicación. -->
        <button id="go"
          class="boton self-center px-7 py-4 text-base font-bold leading-snug
                 [--boton-radio:9999px] [--boton-tipo:var(--font-titular)]">
          ${aged ? 'TIRAR CAÑA' : 'Sí, soy mayor de 18 · TIRAR CAÑA'}
        </button>
        <p class="text-xs text-ambar-dim">
          Al tocar, el móvil te pedirá permiso para usar el sensor de movimiento.
          Es lo que mide el ángulo del vaso: sin eso no hay juego.
        </p>
        <!-- El sello del build. Pequeño y apagado, pero presente: el
             index.html se sirve con max-age=600, así que el móvil puede estar
             ejecutando el bundle anterior sin que nada lo delate. Ya pasó: se
             probó un cambio contra la versión vieja y la sesión de pruebas
             entera no valió. Quien prueba canta el sello y se sabe cuál es.
             (Sin comillas invertidas aquí dentro: cierran este literal.) -->
        <!-- El sonido se apaga ANTES de entrar, no durante. En la pantalla
             del vaso no cabe un control más sin estorbar, y además es la
             decisión que uno toma al sacar el móvil en un bar, no a mitad de
             tirada. La preferencia se recuerda. -->
        <button id="sonido" class="text-center text-xs text-ambar-dim underline
                decoration-dotted underline-offset-4"></button>
        <p class="text-center text-[0.65rem] text-ambar-dim">${SELLO_BUILD}</p>
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
   * composición sobre blanco, así que conserva el antialias.
   *
   * La palabra va en el rojo de marca EXACTO, el mismo `#B02C31` del fondo
   * del vaso, y eso es a propósito: con el vaso vacío no se lee, y va
   * apareciendo conforme la cerveza le pasa por detrás. El triángulo dorado
   * no se toca, así que la marca sigue estando ahí desde el primer momento.
   *
   * Por eso el color tiene que ser el mismo **bit a bit** y no parecido: a
   * dos unidades de distancia la palabra se insinúa, y eso se lee como un
   * error de impresión, no como una intención.
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
  const sonido = new Sonido()

  const botonSonido = $<HTMLButtonElement>('sonido')
  /**
   * El botón dice lo que PASA, no lo que se pidió.
   *
   * Decía «sonido activado» aunque la descarga de los clips hubiera fallado, y
   * eso convierte una avería en un misterio: pasó de verdad, con el JS viejo en
   * caché pidiendo unos audios con hash antiguo que ya daban 404.
   */
  function pintaSonido(): void {
    botonSonido.textContent = sonido.estado === 'fallo'
      ? 'sonido no disponible · recarga la página'
      : sonido.silenciado ? 'sonido desactivado' : 'sonido activado'
    botonSonido.disabled = sonido.estado === 'fallo'
  }
  sonido.alCambiar = pintaSonido
  pintaSonido()
  botonSonido.addEventListener('click', (e) => {
    // No debe disparar el botón de entrar ni confirmar la edad.
    e.stopPropagation()
    sonido.silencia(!sonido.silenciado)
    pintaSonido()
  })

  let teardown: (() => void) | null = null
  skin('ui')

  function show(view: string): void {
    teardown?.()
    skin(view === 'game' ? 'game' : 'ui')
    teardown = view === 'trace' ? mountTraceRecorder(viewEl, fusion)
      : view === 'sensor' ? mountSensorSlice(viewEl, fusion)
        : mountGameView(viewEl, fusion, qrVariety, sonido)
  }

  $('go').addEventListener('click', () => {
    // Primera línea del handler: pedir el permiso. Sin `await` por delante,
    // sin `async` en el handler. Si esto se mueve, en iOS deja de funcionar
    // y no da ningún error que lo explique.
    const p = requestMotionPermission()

    // El audio, por el mismo motivo y en el mismo gesto: un AudioContext
    // creado fuera de un toque nace `suspended` y no suena nada, sin ningún
    // error que lo explique. Va aquí, no dentro del `then`.
    sonido.despierta()

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
