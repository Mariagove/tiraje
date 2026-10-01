/**
 * sound.ts — el sonido del juego, SINTETIZADO. Cero ficheros, cero bytes.
 *
 * No hay samples y no es por tacañería de peso: es que el sonido de esta
 * pantalla **no es un efecto, es un estado continuo**. El chorro dura lo que
 * dure la tirada, cambia con la inclinación y con lo lleno que esté el vaso, y
 * eso con un .mp3 en bucle no se hace: o se nota el corte o no reacciona.
 *
 * Y hay un detalle que sale gratis y que es física de verdad: **al llenarse un
 * vaso el sonido sube de tono**, porque la columna de aire que resuena encima
 * del líquido se acorta. Es lo que te deja saber sin mirar que el vaso ya casi
 * está. Aquí el filtro sube de 320 Hz a 1.400 Hz conforme sube el nivel, que es
 * exactamente eso.
 *
 * ---
 *
 * Tres cosas de iOS que no son opcionales:
 *
 * 1. **El contexto hay que crearlo DENTRO del gesto del usuario.** Igual que
 *    `requestMotionPermission()`. Si se crea al cargar la página nace
 *    `suspended` y no suena nada, sin ningún error que lo explique. Por eso
 *    `despierta()` se llama desde el mismo `click` del botón del gate.
 *
 * 2. **El interruptor de silencio del iPhone calla el Web Audio** en Safari.
 *    En un bar, la mitad de los móviles lo llevan puesto. `navigator
 *    .audioSession.type = 'playback'` (Safari 16.4+) le dice al sistema que
 *    esto es reproducción y no un pitido, y entonces suena igual. Se consulta
 *    antes de usarla: donde no exista, simplemente no suena con el móvil en
 *    silencio, que es el comportamiento de hoy.
 *
 * 3. **Un bar es ruidoso.** Esto es un acompañamiento, nunca la única señal:
 *    todo lo que suena se ve también. Si no se oye no se pierde nada.
 */

/**
 * El chorro, en dos capas. La primera versión era UNA banda ancha y grave, y
 * eso no suena a grifo: suena a catarata. Es que literalmente lo es — un salto
 * de agua es ruido de banda ancha con mucha energía abajo, y el tamaño de lo
 * que cae se oye en cuánto grave tiene.
 *
 * Un grifo llenando un vaso son dos cosas distintas a la vez, y hay que
 * separarlas:
 *
 *   1. La RESONANCIA del vaso: una banda estrecha que sube de tono conforme se
 *      llena. Estrecha, no ancha. El `Q` es lo que dice el tamaño.
 *   2. El SISEO del hilo al romper la superficie: muy agudo y muy flojo. Es lo
 *      que hace que suene a chorro fino y no a masa de agua.
 *
 * Sin la 1 suena a sartén; sin la 2, a tubo. Con las dos, a caña.
 */
const CHORRO_HZ_VACIO = 700
const CHORRO_HZ_LLENO = 2400
/**
 * Estrecho = fuente pequeña, y MUY estrecho = tubo.
 *
 * 0,8 era una banda ancha, o sea una catarata. 3,2 seguía siendo ruido con
 * color. A 9 el filtro deja de sonar a ruido filtrado y empieza a sonar a
 * RESONANCIA: es lo que hace una botella cuando soplas por la boca, y es lo
 * que de verdad pasa dentro de un vaso llenándose — un resonador de Helmholtz
 * excitado por el chorro.
 *
 * Subir el `Q` baja el volumen solo, sin tocar la ganancia: al estrechar la
 * banda de 3,2 a 9 pasa un tercio de la energía, unos 4,5 dB menos. Por eso la
 * ganancia baja poco; si bajara al mismo tiempo que sube el `Q`, no se oiría.
 */
const CHORRO_Q = 9
/**
 * El siseo fino. Es lo que más «cantidad de agua» aporta, así que es lo
 * primero que hay que recortar cuando sobra: de 0,05 a 0,012. Queda como un
 * aire muy tenue que impide que la resonancia suene a tono puro de sintetizador,
 * pero ya no se oye como chorro por sí mismo.
 */
const SISEO_HZ = 3000
const SISEO_GANANCIA = 0.012
/**
 * El CUERPO: la fuerza del grifo.
 *
 * Con sólo la resonancia aguda y el siseo, el chorro sonaba a riachuelo — un
 * hilo de agua cayendo por su propio peso. Un grifo de barril tiene presión
 * detrás, y la presión se oye abajo.
 *
 * Pero abajo **y estrecho**, que es toda la diferencia con el primer intento:
 * grave + ancho es una catarata, grave + `Q` 5 es un golpe de caudal. La banda
 * no se mueve con el llenado; la que sube es la resonancia, que es la que
 * cuenta cuánto queda.
 */
const CUERPO_HZ = 320
const CUERPO_Q = 5
const CUERPO_GANANCIA = 0.42
/** Volumen general. Por debajo de esto el chorro tapa al resto. */
const VOLUMEN = 0.22

/**
 * El chisporroteo de la corona, y por qué ya NO va en crescendo.
 *
 * Lo apuntó el estudio y tiene razón: el grifo no suelta gas. El CO₂ ya viene
 * disuelto en la cerveza —de la fermentación, y en cervecería industrial
 * además añadido en fábrica— y lo que pasa al servir es que se sale de
 * disolución al golpear la superficie. O sea que no hay nada que vaya «a más»
 * mientras el grifo está abierto.
 *
 * Y hay algo mejor: el crujido de la corona **se oye sobre todo cuando paras**.
 * Mientras cae el chorro lo tapa; al cerrar el grifo se queda solo y se
 * extingue en unos segundos. Es el sonido que todo el mundo reconoce de una
 * caña recién puesta, y el juego ya tiene su sitio — los 2 s de reposo entre
 * cerrar y la nota.
 *
 * Por eso son granos de ruido muy cortos y agudos, no las burbujitas de seno
 * que había antes: aquellas, sueltas y con glissando, eran exactamente un
 * riachuelo.
 */
const CRUJIDO_HZ = 2600
const CRUJIDO_POR_SEG = 70
const CRUJIDO_MS = 2800

const CLAVE_SILENCIO = 'tiraje.silencio.v1'

/** Tipos de `navigator.audioSession`, que todavía no está en lib.dom. */
interface SesionDeAudio { type: string }

export class Sonido {
  #ctx: AudioContext | null = null
  #maestro: GainNode | null = null
  /** El chorro es UNA fuente continua, no un disparo por frame. */
  #ruido: AudioBufferSourceNode | null = null
  #filtro: BiquadFilterNode | null = null
  #chorroGain: GainNode | null = null
  #silenciado = false
  /** Para no disparar el derrame sesenta veces por segundo. */
  #derramando = false
  /** Reloj del crujido, en segundos del contexto. */
  #proximoGrano = 0
  /** Instante en que se cerró el grifo, para apagar el crujido. */
  #cerradoEn = 0

  constructor() {
    try { this.#silenciado = localStorage.getItem(CLAVE_SILENCIO) === '1' }
    catch { /* modo privado */ }
  }

  get silenciado(): boolean { return this.#silenciado }
  get disponible(): boolean { return this.#ctx !== null }

  /**
   * Arranca el audio. **Llamar dentro de un gesto del usuario**, sin `await`
   * por delante — la misma regla que el permiso de movimiento.
   */
  despierta(): void {
    if (this.#ctx) { void this.#ctx.resume(); return }
    const Ctor = window.AudioContext ?? (window as unknown as
      { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return

    // El interruptor de silencio, antes de nada.
    const sesion = (navigator as unknown as { audioSession?: SesionDeAudio }).audioSession
    if (sesion) { try { sesion.type = 'playback' } catch { /* no soportado */ } }

    const ctx = new Ctor()
    this.#ctx = ctx
    const maestro = ctx.createGain()
    maestro.gain.value = this.#silenciado ? 0 : VOLUMEN
    maestro.connect(ctx.destination)
    this.#maestro = maestro

    // --- El chorro -------------------------------------------------------
    // Ruido blanco en bucle a través de un paso banda. Un líquido cayendo ES
    // ruido filtrado: no hay tono, hay una banda que se mueve. Sintetizarlo
    // sale mejor que grabarlo, y aquí además tiene que responder al ángulo.
    const segundos = 2
    const buffer = ctx.createBuffer(1, ctx.sampleRate * segundos, ctx.sampleRate)
    const datos = buffer.getChannelData(0)
    for (let i = 0; i < datos.length; i++) datos[i] = Math.random() * 2 - 1

    const fuente = ctx.createBufferSource()
    fuente.buffer = buffer
    fuente.loop = true

    const filtro = ctx.createBiquadFilter()
    filtro.type = 'bandpass'
    filtro.frequency.value = CHORRO_HZ_VACIO
    filtro.Q.value = CHORRO_Q

    const gain = ctx.createGain()
    gain.gain.value = 0

    // Capa 1: la resonancia del vaso, que sube al llenarse.
    fuente.connect(filtro).connect(gain)
    // Capa 2: el siseo del hilo. Sale del MISMO ruido, así que las dos capas
    // están correlacionadas y se oyen como una sola fuente. Con dos ruidos
    // independientes sonarían a dos cosas sucediendo a la vez.
    const siseo = ctx.createBiquadFilter()
    siseo.type = 'highpass'
    siseo.frequency.value = SISEO_HZ
    const siseoGain = ctx.createGain()
    siseoGain.gain.value = SISEO_GANANCIA
    fuente.connect(siseo).connect(siseoGain).connect(gain)
    // Capa 3: el cuerpo. Grave pero estrecho — la presión del barril.
    const cuerpo = ctx.createBiquadFilter()
    cuerpo.type = 'bandpass'
    cuerpo.frequency.value = CUERPO_HZ
    cuerpo.Q.value = CUERPO_Q
    const cuerpoGain = ctx.createGain()
    cuerpoGain.gain.value = CUERPO_GANANCIA
    fuente.connect(cuerpo).connect(cuerpoGain).connect(gain)
    gain.connect(maestro)
    fuente.start()
    this.#ruido = fuente
    this.#filtro = filtro
    this.#chorroGain = gain
  }

  /** Enmudece sin apagar: el contexto sigue vivo y vuelve al instante. */
  silencia(valor: boolean): void {
    this.#silenciado = valor
    try { localStorage.setItem(CLAVE_SILENCIO, valor ? '1' : '0') } catch { /* privado */ }
    if (this.#maestro && this.#ctx) {
      this.#maestro.gain.setTargetAtTime(
        valor ? 0 : VOLUMEN, this.#ctx.currentTime, 0.02)
    }
  }

  /**
   * El estado continuo, una vez por frame.
   *
   * Nada de `setValueAtTime`: todo con `setTargetAtTime`, que interpola. Si se
   * salta el valor a cada frame se oyen los escalones como un crujido.
   */
  actualiza(f: { pouring: boolean; fill: number; foamFrac: number; spillingOver: boolean }): void {
    const ctx = this.#ctx
    if (!ctx || !this.#filtro || !this.#chorroGain) return
    const t = ctx.currentTime

    // El tono sube con el nivel: la columna de aire que resuena se acorta.
    const nivel = f.fill < 0 ? 0 : f.fill > 1 ? 1 : f.fill
    this.#filtro.frequency.setTargetAtTime(
      CHORRO_HZ_VACIO + (CHORRO_HZ_LLENO - CHORRO_HZ_VACIO) * nivel, t, 0.08)

    // Ganancia FIJA mientras el grifo está abierto. Antes subía con la
    // espuma y eso era el crescendo que sobraba: el grifo no echa más fuerte
    // según avanza la caña, echa igual. Lo que cambia es el tono, no el
    // volumen.
    const objetivo = f.pouring ? 0.34 : 0
    this.#chorroGain.gain.setTargetAtTime(objetivo, t, f.pouring ? 0.04 : 0.12)

    // El crujido de la corona: muy poco con el grifo abierto —lo tapa el
    // chorro— y en primer plano justo al cerrar, extinguiéndose. Es el sonido
    // de una caña recién puesta.
    if (f.pouring) {
      this.#cerradoEn = 0
      this.#crujido(t, 0.18)
    } else if (f.fill > 0.05) {
      if (this.#cerradoEn === 0) this.#cerradoEn = t
      const transcurrido = (t - this.#cerradoEn) * 1000
      if (transcurrido < CRUJIDO_MS) {
        // Se apaga de forma cuadrática: empieza fuerte y se va rápido, que es
        // como se deshace la espuma.
        const queda = 1 - transcurrido / CRUJIDO_MS
        this.#crujido(t, queda * queda)
      }
    }

    // El derrame suena UNA vez por episodio, no mientras dure.
    if (f.spillingOver && !this.#derramando) this.#salpica()
    this.#derramando = f.spillingOver
  }

  /** Toque de grifo: un chasquido corto, seco y sin tono definido. */
  toque(): void {
    const ctx = this.#ctx, maestro = this.#maestro
    if (!ctx || !maestro) return
    const t = ctx.currentTime
    const osc = ctx.createOscillator()
    osc.type = 'square'
    osc.frequency.setValueAtTime(220, t)
    osc.frequency.exponentialRampToValueAtTime(90, t + 0.06)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.9, t)
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.08)
    osc.connect(g).connect(maestro)
    osc.start(t)
    osc.stop(t + 0.1)
  }

  /** Resultado: tres notas. Sube si la caña fue buena, baja si fue mala. */
  resultado(nota: number): void {
    const ctx = this.#ctx, maestro = this.#maestro
    if (!ctx || !maestro) return
    const t = ctx.currentTime
    // Si/mi/si de una pentatónica: suena a premio sin sonar a máquina
    // tragaperras. Al revés para una caña mala, que es lo que todo el mundo
    // entiende sin que se lo expliquen.
    const buena = nota >= 60
    const notas = buena ? [392, 523.25, 659.25] : [392, 329.63, 261.63]
    notas.forEach((hz, i) => {
      const inicio = t + i * 0.11
      const osc = ctx.createOscillator()
      osc.type = 'triangle'
      osc.frequency.value = hz
      const g = ctx.createGain()
      g.gain.setValueAtTime(0, inicio)
      g.gain.linearRampToValueAtTime(0.5, inicio + 0.015)
      g.gain.exponentialRampToValueAtTime(0.001, inicio + 0.38)
      osc.connect(g).connect(maestro)
      osc.start(inicio)
      osc.stop(inicio + 0.4)
    })
  }

  /**
   * Un grano de crujido: 8 ms de ruido agudo. Nada de tono.
   *
   * Lo que había antes eran senos con glissando, uno cada 60-200 ms. Eso, por
   * separado y con tono, es el sonido de un arroyo entre piedras; de ahí el
   * «riachuelo». La espuma de la cerveza no hace notas: hace chasquidos muy
   * finos, muy densos y muy agudos, que es lo que son estos granos.
   */
  #crujido(t: number, intensidad: number): void {
    const ctx = this.#ctx, maestro = this.#maestro
    if (!ctx || !maestro || !this.#ruido?.buffer || intensidad <= 0.01) return
    if (t < this.#proximoGrano) return
    this.#proximoGrano = t + (0.5 + Math.random()) / (CRUJIDO_POR_SEG * intensidad)

    const f = ctx.createBufferSource()
    f.buffer = this.#ruido.buffer
    // Cada grano arranca en un punto distinto del ruido: si todos salieran del
    // mismo sitio se oiría el patrón repetido como un zumbido.
    const desde = Math.random() * (this.#ruido.buffer.duration - 0.05)
    const hp = ctx.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.value = CRUJIDO_HZ * (0.7 + Math.random() * 0.9)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.14 * intensidad, t)
    g.gain.exponentialRampToValueAtTime(0.0005, t + 0.008)
    f.connect(hp).connect(g).connect(maestro)
    f.start(t, desde, 0.01)
  }

  /** Derrame: un golpe de ruido grave. Se nota sin necesidad de mirar. */
  #salpica(): void {
    const ctx = this.#ctx, maestro = this.#maestro
    if (!ctx || !maestro || !this.#ruido?.buffer) return
    const t = ctx.currentTime
    const f = ctx.createBufferSource()
    f.buffer = this.#ruido.buffer
    f.loop = true
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.setValueAtTime(900, t)
    lp.frequency.exponentialRampToValueAtTime(180, t + 0.3)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.8, t + 0.02)
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.35)
    f.connect(lp).connect(g).connect(maestro)
    f.start(t)
    f.stop(t + 0.4)
  }
}
