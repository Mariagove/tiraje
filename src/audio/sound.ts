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

/*
 * TODO ESTO ESTÁ MEDIDO CONTRA UNA GRABACIÓN REAL, no elegido de oído — yo no
 * lo oigo. El estudio dejó un wav de 4,6 s de un grifo llenando un vaso; se
 * midió su espectro por bandas, se replicó esta misma cadena de filtros en
 * Python y se buscó la combinación que más se le parece. Herramientas y
 * calibración, en `docs/PENDIENTE.md`.
 *
 * El ajuste final yerra 14,9 puntos porcentuales repartidos en ocho bandas, y
 * la banda que manda —500-1.000 Hz, el 59% de la energía— queda en el 61,7%.
 *
 * Lo que la medida DESMINTIÓ de lo que yo había supuesto:
 *
 *   · La potencia del chorro NO está en los graves. En la grabación, la banda
 *     de 250-500 Hz es el 6% y la de 500-1.000 el 59%. Yo tenía un «cuerpo» a
 *     320 Hz que llegó a ser el 52% de mi energía: justamente al revés.
 *   · Me faltaba casi todo entre 2 y 8 kHz: la referencia tiene ahí el 25,5% y
 *     yo tenía el 5,1%. El siseo no era un adorno, era un cuarto del sonido.
 *   · El `Q` nunca fue el problema. 8 reproduce el de la grabación.
 *
 * AVISO sobre la referencia: por debajo de 250 Hz no tiene prácticamente nada
 * (0,1% + 0,9%), que es lo típico de un micrófono de móvil. O sea que de esta
 * grabación NO se puede saber si un grifo real tiene graves. Lo que se copia
 * aquí es lo que suena en el wav, que es lo que se pidió copiar.
 */

/**
 * La resonancia del vaso, que sube al llenarse. Medido: 624 Hz con el vaso
 * vacío y 818 al final de la grabación — un recorrido mucho más corto del que
 * yo tenía (700→2.400). El final se sube un poco respecto a lo medido, a 880,
 * porque la grabación no llena el vaso del todo y el juego sí llega al 95%.
 */
const CHORRO_HZ_VACIO = 600
const CHORRO_HZ_LLENO = 880
/** Medido 5,3 con el instrumento; 8 en síntesis reproduce esa lectura. */
const CHORRO_Q = 8

/**
 * La banda ancha de turbulencia: el chorro rompiendo la superficie.
 *
 * Ya no es un «siseo» agudo y testimonial: es de 1,1 a 5,5 kHz y vale un
 * cuarto de la energía. Antes era un paso alto a 3 kHz sin techo, con ganancia
 * 0,012; de ahí que sonara a hilo de agua y no a grifo.
 */
const TURBULENCIA_HZ = 1100
const TURBULENCIA_TECHO_HZ = 5500
const TURBULENCIA_GANANCIA = 0.08

/**
 * El cuerpo. Queda, pero MUY recortado: de 0,42 a 0,20. En la referencia esta
 * banda es el 6% de la energía, no el plato principal.
 */
const CUERPO_HZ = 320
const CUERPO_Q = 5
const CUERPO_GANANCIA = 0.20

/**
 * El chorro se APAGA conforme sube el nivel: 12 dB de caída en la grabación,
 * de −21,6 a −33,9. Tiene sentido — cae desde menos altura y el líquido que ya
 * hay amortigua. Es lo contrario del crescendo que había al principio.
 */
const CHORRO_GANANCIA_VACIO = 0.38
const CHORRO_GANANCIA_LLENO = 0.135

/** Volumen general. Por debajo de esto el chorro tapa al resto. */
const VOLUMEN = 0.22

/**
 * El crujido de la corona, y por qué NO va en crescendo.
 *
 * Lo apuntó el estudio: «la caña no suelta gas, las burbujas proceden de la
 * propia fermentación». Correcto. El CO₂ ya viene disuelto —de la
 * fermentación, y en cervecería industrial además añadido en fábrica— y lo que
 * pasa al servir es que se sale de disolución al golpear la superficie. No hay
 * nada que vaya «a más» mientras el grifo está abierto.
 *
 * Y la grabación de referencia lo confirma: tiene 2,4 s de vertido y después
 * 2,1 s de cola unos 15 dB por debajo. El crujido se oye **cuando paras**,
 * porque mientras cae el chorro lo tapa. El juego ya tenía el hueco: los 2 s
 * de reposo entre cerrar y la nota.
 *
 * Son granos de ruido de 8 ms muy agudos, no burbujitas de seno con glissando:
 * aquéllas, sueltas y con tono, eran un arroyo entre piedras.
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
    // Las TRES capas salen del MISMO ruido, y eso no es por ahorrar: así están
    // correlacionadas y el oído las junta en una sola fuente. Con tres ruidos
    // independientes sonarían a tres cosas sucediendo a la vez.
    //
    // Capa 2: la turbulencia, 1,1-5,5 kHz. El techo NO es opcional: sin él
    // el centroide del espectro se iba 1 kHz por encima de la referencia,
    // porque un micrófono real no recoge nada por encima de 8 kHz y un paso
    // alto sintético lo pasa todo hasta Nyquist.
    const turb = ctx.createBiquadFilter()
    turb.type = 'highpass'
    turb.frequency.value = TURBULENCIA_HZ
    const techo = ctx.createBiquadFilter()
    techo.type = 'lowpass'
    techo.frequency.value = TURBULENCIA_TECHO_HZ
    const turbGain = ctx.createGain()
    turbGain.gain.value = TURBULENCIA_GANANCIA
    fuente.connect(turb).connect(techo).connect(turbGain).connect(gain)
    // Capa 3: el cuerpo. Queda muy recortado respecto a lo que yo había puesto:
    // medida la referencia, esta banda es el 6% de su energía, no el plato
    // principal. La «potencia de chorro» no vive aquí abajo.
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

    // La ganancia BAJA conforme se llena, 9 dB entre vaso vacío y lleno. En
    // la grabación de referencia caen 12. Y no depende de la espuma: el
    // crescendo que había era un invento mío — el grifo echa siempre igual.
    const objetivo = f.pouring
      ? CHORRO_GANANCIA_VACIO + (CHORRO_GANANCIA_LLENO - CHORRO_GANANCIA_VACIO) * nivel
      : 0
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
