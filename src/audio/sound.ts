/**
 * sound.ts — el sonido del juego.
 *
 * El chorro y la espuma son la GRABACIÓN REAL que dejó el estudio, no síntesis.
 * El toque de grifo y las notas del resultado siguen sintetizados, porque son
 * dos chasquidos y tres notas y no merecen un fichero.
 *
 * ---
 *
 * POR QUÉ SE ABANDONÓ LA SÍNTESIS, que es la parte que conviene recordar.
 *
 * Hubo cinco versiones sintetizadas. La última se ajustó **midiendo** el wav de
 * referencia: espectro por bandas de octava, réplica de esta misma cadena de
 * biquads en Python, y búsqueda en rejilla hasta dejar el error en 14,9 puntos
 * porcentuales repartidos en ocho bandas, con la banda dominante —500-1.000 Hz,
 * el 59% de la energía— clavada en 61,7%.
 *
 * Y aun así el estudio dijo, con razón, que no se parecía.
 *
 * El motivo es que **igualar el espectro medio no basta**. Dos sonidos pueden
 * repartir la energía igual por bandas y no parecerse en nada, porque lo que
 * identifica un chorro de verdad es su estructura en el TIEMPO: las
 * irregularidades, los golpes de gota sueltos, el caudal que titubea. La
 * envolvente de la grabación salta ±8 dB entre instantes contiguos; el ruido
 * filtrado es liso por definición. Eso no lo arregla ningún filtro, y menos aún
 * alguien que no puede oír lo que genera.
 *
 * Lo medido no se tira: está en `docs/PENDIENTE.md` y es lo que explica por qué
 * el chorro suena como suena. Pero la fuente es la grabación.
 *
 * ---
 *
 * Tres cosas de iOS que no son opcionales:
 *
 * 1. **El contexto hay que crearlo DENTRO del gesto del usuario**, igual que
 *    `requestMotionPermission()`. Creado al cargar nace `suspended` y no suena
 *    nada, sin ningún error que lo explique.
 * 2. **El interruptor de silencio del iPhone calla el Web Audio** en Safari, y
 *    en un bar media sala lo lleva puesto. `navigator.audioSession.type =
 *    'playback'` (Safari 16.4+) lo arregla; se consulta antes de usarla.
 * 3. **Un bar es ruidoso.** Esto acompaña, nunca informa en exclusiva: todo lo
 *    que suena se ve también.
 */
// Vite les pone hash y devuelve la URL con el `base` del build aplicado.
import vertidoUrl from '@/assets/audio/vertido.m4a'
import colaUrl from '@/assets/audio/cola.m4a'

/**
 * El clip del vertido es la toma entera de 8 s, y sólo se repite su último
 * tramo: `loopStart` 4,0 s, `loopEnd` al final.
 *
 * Dos cosas que esto resuelve de golpe:
 *
 * **El ataque no se repite** —lo pidió el estudio: el primer segundo es la
 * cerveza cayendo sobre VIDRIO y eso pasa una sola vez—. Aquí ni hay que
 * recortarlo: la toma suena de corrido desde el principio, así que ocurre una
 * vez porque así ocurrió al grabarla. Medido en esta toma, la energía por
 * encima de 3 kHz va al 55% los primeros 0,63 s y al 27% después; el bucle vive
 * entero en la zona de líquido sobre líquido.
 *
 * **Y casi nunca llega a repetirse.** Un vertido normal dura 8,1 s, o sea que
 * toca los 8 s de grabación y entra en el bucle sólo 0,1 s. Antes el cuerpo
 * medía 1,13 s y daba 5,4 vueltas: eso era el «disco rayado».
 *
 * ---
 *
 * EL FUNDIDO VA AL REVÉS QUE EN EL MONTAJE ANTERIOR, y es la mejora de fondo.
 *
 * Con sólo 4,6 s de material, el fundido cruzado tenía que mover la CABEZA del
 * bucle, y eso obligaba a que el ataque se llevara el cuerpo una vez para que
 * la junta no chascara: bytes duplicados y una costura delicada.
 *
 * Con 8 s hay material ANTES del bucle, así que se funde la COLA del bucle
 * hacia lo que había justo antes de su principio. Entonces la cabeza queda
 * intacta y entrar al bucle tocando de corrido es continuo **por naturaleza**,
 * sin junta que cuidar.
 *
 * Medido: las dos costuras valen 0,005 frente a 0,039 de salto típico de la
 * propia señal.
 *
 * Si se vuelve a cortar el wav, estos números salen de `bucle2.py`.
 */
const BUCLE_INICIO_S = 4.0

/**
 * Lo que el chorro sube de tono entre vaso vacío y vaso lleno.
 *
 * La grabación ya lleva su propia subida dentro —medida: de 624 a 818 Hz—, pero
 * al repetirla en bucle esa subida se reinicia cada vuelta y el efecto se
 * pierde. Esto lo devuelve, y encima atado al llenado de verdad.
 *
 * Es `playbackRate`, así que sube el tono y acelera a la vez, igual que una
 * cinta: con un 9% no se nota como truco y sí como que el vaso se llena.
 */
const VELOCIDAD_VACIO = 0.97
const VELOCIDAD_LLENO = 1.06

/**
 * El chorro se APAGA conforme sube el nivel. Medido en la grabación: 12 dB de
 * caída entre el principio y el final del vertido. Cae desde menos altura y el
 * líquido que ya hay amortigua.
 */
const CHORRO_VACIO = 1.0
const CHORRO_LLENO = 0.4

/** Volumen general. */
const VOLUMEN = 0.5

const CLAVE_SILENCIO = 'tiraje.silencio.v1'

/** Tipos de `navigator.audioSession`, que todavía no está en lib.dom. */
interface SesionDeAudio { type: string }

export class Sonido {
  #ctx: AudioContext | null = null
  #maestro: GainNode | null = null

  /** Los dos clips, ya descodificados. */
  #bufVertido: AudioBuffer | null = null
  #bufCola: AudioBuffer | null = null
  /** Dónde empieza el audio de verdad dentro del bucle. Ver `#inicioReal`. */
  #desfase = 0

  /** La fuente del chorro vive mientras dura el vertido, no por frame. */
  #chorro: AudioBufferSourceNode | null = null
  #chorroGain: GainNode | null = null
  #vertiendo = false

  #silenciado = false
  #derramando = false
  /** Las descargas empiezan al construir; descodificar necesita contexto. */
  #crudos: Promise<[ArrayBuffer, ArrayBuffer] | null>

  constructor() {
    try { this.#silenciado = localStorage.getItem(CLAVE_SILENCIO) === '1' }
    catch { /* modo privado */ }
    // Se bajan ya, sin esperar al gesto: son 33 KB, y así al tocar el botón
    // sólo queda descodificar. Si falla la red, el juego sigue sin sonido.
    this.#crudos = Promise.all([
      fetch(vertidoUrl).then((r) => r.arrayBuffer()),
      fetch(colaUrl).then((r) => r.arrayBuffer()),
    ]).catch(() => null)
  }

  get silenciado(): boolean { return this.#silenciado }
  get disponible(): boolean { return this.#bufVertido !== null }

  /**
   * Arranca el audio. **Llamar dentro de un gesto del usuario**, sin `await`
   * por delante — la misma regla que el permiso de movimiento.
   */
  despierta(): void {
    if (this.#ctx) { void this.#ctx.resume(); return }
    const Ctor = window.AudioContext ?? (window as unknown as
      { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return

    const sesion = (navigator as unknown as { audioSession?: SesionDeAudio }).audioSession
    if (sesion) { try { sesion.type = 'playback' } catch { /* no soportado */ } }

    const ctx = new Ctor()
    this.#ctx = ctx
    const maestro = ctx.createGain()
    maestro.gain.value = this.#silenciado ? 0 : VOLUMEN
    maestro.connect(ctx.destination)
    this.#maestro = maestro

    const gain = ctx.createGain()
    gain.gain.value = 0
    gain.connect(maestro)
    this.#chorroGain = gain

    void this.#crudos.then(async (crudos) => {
      if (!crudos) return
      const [a, b] = crudos
      this.#bufVertido = await ctx.decodeAudioData(a.slice(0))
      this.#bufCola = await ctx.decodeAudioData(b.slice(0))
      this.#desfase = this.#inicioReal(this.#bufVertido)
      // Si el grifo ya estaba abierto al terminar de cargar, se engancha.
      if (this.#vertiendo) this.#arrancaChorro()
    })
  }

  /**
   * Dónde empieza el audio de verdad dentro del buffer descodificado.
   *
   * **AAC mete silencio al principio** —el *priming delay* del códec, entre mil
   * y dos mil muestras— y el descodificador de cada navegador lo deja o lo
   * quita a su manera. Si el bucle se montara sobre el buffer entero, cada
   * vuelta metería ese silencio y se oiría un hueco rítmico. Se busca la
   * primera muestra con señal y se repite desde ahí exactamente `BUCLE_S`.
   */
  #inicioReal(buf: AudioBuffer): number {
    const d = buf.getChannelData(0)
    const limite = Math.min(d.length, buf.sampleRate / 2)
    for (let i = 0; i < limite; i++) {
      if (Math.abs(d[i]!) > 0.002) return i / buf.sampleRate
    }
    return 0
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

  /** El estado continuo, una vez por frame. */
  actualiza(f: { pouring: boolean; fill: number; foamFrac: number; spillingOver: boolean }): void {
    const ctx = this.#ctx
    if (!ctx || !this.#chorroGain) return
    const t = ctx.currentTime
    const nivel = f.fill < 0 ? 0 : f.fill > 1 ? 1 : f.fill

    if (f.pouring && !this.#vertiendo) {
      this.#vertiendo = true
      this.#arrancaChorro()
    } else if (!f.pouring && this.#vertiendo) {
      this.#vertiendo = false
      this.#paraChorro()
      // La cola de espuma, justo donde se corta el chorro: es el sonido que
      // cualquiera reconoce de una caña recién puesta, y mientras cae el
      // chorro no se oye porque lo tapa.
      if (f.fill > 0.05) this.#cola()
    }

    // Nada de saltos por frame: `setTargetAtTime` interpola. A saltos se oyen
    // los escalones como un crujido.
    this.#chorroGain.gain.setTargetAtTime(
      f.pouring ? CHORRO_VACIO + (CHORRO_LLENO - CHORRO_VACIO) * nivel : 0,
      // Al cerrar, 0,015 de constante: el 95% del apagado cae en 45 ms. Con
      // 0,10 tardaba 300 ms y se oía el chorro seguir después del toque, que
      // es lo que el estudio describió como «se corta demasiado tarde». Un
      // grifo de barril cierra de golpe; no tiene cola.
      t, f.pouring ? 0.04 : 0.015)
    this.#chorro?.playbackRate.setTargetAtTime(
      VELOCIDAD_VACIO + (VELOCIDAD_LLENO - VELOCIDAD_VACIO) * nivel, t, 0.12)

    // El derrame suena UNA vez por episodio, no mientras dure.
    if (f.spillingOver && !this.#derramando) this.#salpica()
    this.#derramando = f.spillingOver
  }

  #arrancaChorro(): void {
    const ctx = this.#ctx
    if (!ctx || !this.#bufVertido || !this.#chorroGain || this.#chorro) return
    const s = ctx.createBufferSource()
    s.buffer = this.#bufVertido
    s.loop = true
    // Se arranca desde el principio, así que la cerveza contra el vidrio vacío
    // suena una vez por caña y la repetición se queda en el tramo de líquido
    // sobre líquido.
    s.loopStart = this.#desfase + BUCLE_INICIO_S
    // Acotado al buffer: `ffmpeg` quita el relleno del códec y deja los 1,750 s
    // exactos, pero no todos los descodificadores hacen lo mismo. Si alguno
    // recorta la cola, un `loopEnd` fuera del buffer rompería el bucle entero;
    // así, en el peor caso, se acorta un poco y se sigue oyendo.
    // Hasta el final del fichero: el bucle es su último tramo.
    s.loopEnd = s.buffer.duration
    s.connect(this.#chorroGain)
    s.start(ctx.currentTime, this.#desfase)
    this.#chorro = s
  }

  #paraChorro(): void {
    const ctx = this.#ctx, s = this.#chorro
    if (!ctx || !s) return
    this.#chorro = null
    // Se para DESPUÉS de que la ganancia haya bajado; si no, se oye el corte.
    // 0,08 s basta porque la constante de apagado es 0,015: a los 60 ms ya
    // está 50 dB por debajo.
    try { s.stop(ctx.currentTime + 0.08) } catch { /* ya parada */ }
  }

  #cola(): void {
    const ctx = this.#ctx, maestro = this.#maestro
    if (!ctx || !maestro || !this.#bufCola) return
    const s = ctx.createBufferSource()
    s.buffer = this.#bufCola
    s.connect(maestro)
    s.start(ctx.currentTime)
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
    g.gain.setValueAtTime(0.4, t)
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.08)
    osc.connect(g).connect(maestro)
    osc.start(t)
    osc.stop(t + 0.1)
  }

  /** Resultado: tres notas. Suben si la caña fue buena, bajan si fue mala. */
  resultado(nota: number): void {
    const ctx = this.#ctx, maestro = this.#maestro
    if (!ctx || !maestro) return
    const t = ctx.currentTime
    // Pentatónica: suena a premio sin sonar a máquina tragaperras. Al revés
    // para una caña mala, que lo entiende todo el mundo sin explicación.
    const notas = nota >= 60 ? [392, 523.25, 659.25] : [392, 329.63, 261.63]
    notas.forEach((hz, i) => {
      const inicio = t + i * 0.11
      const osc = ctx.createOscillator()
      osc.type = 'triangle'
      osc.frequency.value = hz
      const g = ctx.createGain()
      g.gain.setValueAtTime(0, inicio)
      g.gain.linearRampToValueAtTime(0.22, inicio + 0.015)
      g.gain.exponentialRampToValueAtTime(0.001, inicio + 0.38)
      osc.connect(g).connect(maestro)
      osc.start(inicio)
      osc.stop(inicio + 0.4)
    })
  }

  /**
   * Derrame: la propia cola de espuma, grave y a destiempo.
   *
   * Reusar el clip en vez de sintetizar un golpe mantiene el sonido en la misma
   * familia; bajarle la velocidad a 0,55 lo convierte en algo pesado que no se
   * confunde con la corona asentándose.
   */
  #salpica(): void {
    const ctx = this.#ctx, maestro = this.#maestro
    if (!ctx || !maestro || !this.#bufCola) return
    const t = ctx.currentTime
    const s = ctx.createBufferSource()
    s.buffer = this.#bufCola
    s.playbackRate.value = 0.55
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.9, t)
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.5)
    s.connect(g).connect(maestro)
    s.start(t)
    s.stop(t + 0.55)
  }
}
