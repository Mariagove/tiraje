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

/** Cuánto sube el filtro del chorro entre vaso vacío y vaso lleno. */
const CHORRO_HZ_VACIO = 320
const CHORRO_HZ_LLENO = 1400
/** Volumen general. Por debajo de esto el chorro tapa al resto. */
const VOLUMEN = 0.22

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
  /** Reloj de las burbujas, en segundos del contexto. */
  #proximaBurbuja = 0

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
    // Q bajo: un chorro es ancho de banda, no un silbido.
    filtro.Q.value = 0.8

    const gain = ctx.createGain()
    gain.gain.value = 0

    fuente.connect(filtro).connect(gain).connect(maestro)
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

    // Más espuma, más sibilante y más fuerte: la espuma es aire rompiendo.
    const objetivo = f.pouring ? 0.5 + 0.5 * f.foamFrac : 0
    this.#chorroGain.gain.setTargetAtTime(objetivo, t, f.pouring ? 0.04 : 0.12)

    if (f.pouring) this.#burbujas(t, f.foamFrac)

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

  /** Burbujas: pulsos cortos de tono aleatorio, como la corona al asentarse. */
  #burbujas(t: number, espuma: number): void {
    const ctx = this.#ctx, maestro = this.#maestro
    if (!ctx || !maestro) return
    if (t < this.#proximaBurbuja) return
    // De 14 a 45 burbujas por segundo según la espuma que esté haciendo.
    const porSegundo = 14 + 31 * espuma
    this.#proximaBurbuja = t + (0.6 + Math.random() * 0.8) / porSegundo

    const osc = ctx.createOscillator()
    osc.type = 'sine'
    // Una burbuja al romper sube de tono. Es lo que la hace sonar a burbuja y
    // no a pitido.
    const base = 600 + Math.random() * 1600
    osc.frequency.setValueAtTime(base, t)
    osc.frequency.exponentialRampToValueAtTime(base * 1.7, t + 0.035)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.06 + Math.random() * 0.05, t)
    g.gain.exponentialRampToValueAtTime(0.0005, t + 0.045)
    osc.connect(g).connect(maestro)
    osc.start(t)
    osc.stop(t + 0.05)
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
