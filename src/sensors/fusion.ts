/**
 * fusion.ts — permisos, signo iOS/Android, complementario sobre el vector, traza.
 *
 * Plan §1.1. Tres cosas de aquí son frágiles y están comentadas donde toca:
 *   1. `requestPermission()` es SÍNCRONO respecto al gesto del usuario.
 *   2. El signo del acelerómetro se resuelve midiendo, no leyendo el user-agent.
 *   3. "Permiso concedido" y "llegan datos" son dos cosas distintas.
 *
 * Y una frontera que importa para el determinismo: esta capa es la ÚNICA que
 * usa trascendentes (`atan2`, `asin`).  Su salida se cuantiza a décimas de
 * grado enteras antes de entrar en `core/`, y es ese entero el que va a la
 * traza.  Así el servidor de la fase 2 revalida sobre exactamente los mismos
 * enteros que vio el cliente, y la diferencia de 1 ulp entre JavaScriptCore y
 * V8 en `atan2` deja de poder cambiar un resultado.
 */

const RAD_TO_DEG = 180 / Math.PI
const DEG_TO_RAD = Math.PI / 180

// ---------------------------------------------------------------------------
// Vectores y ángulos
// ---------------------------------------------------------------------------

export interface Vec3 { x: number; y: number; z: number }

export interface Angles {
  /** Ángulo de vertido en grados. 0 = vaso vertical. */
  readonly phi: number
  /** Ladeo lateral en grados, ya calibrado. */
  readonly rho: number
}

/**
 * Marco: `x` a la derecha de la pantalla, `y` hacia su borde superior, `z`
 * saliendo de ella.  `u` = "arriba del mundo" visto desde el móvil.
 *
 *   phi = atan2(u.x, u.y)   ← giro EN EL PLANO de la pantalla. Lo que se puntúa
 *   rho = asin(u.z)         ← inclinación FUERA del plano. Lo que se penaliza
 *
 * **Esto se aparta del plan §1.1**, que medía `phi = atan2(u.z, u.y)`, la
 * rotación sobre el eje x — el gesto de servir. Decisión del estudio tras
 * probarlo en un iPhone: el giro en el plano es el único eje gobernable con
 * la pantalla entera haciendo de vaso.
 *
 * Y tiene una consecuencia geométrica que lo justifica sola: con la pantalla
 * como marco del vaso, la superficie del líquido —horizontal en el mundo— se
 * ve a −phi. Con esta descomposición eso es la PROYECCIÓN LITERAL de la
 * superficie sobre el cristal, no una convención de nivel de burbuja. Lo que
 * ves inclinarse es lo que está inclinado.
 *
 * `phi` es independiente de `rho` mientras `cos(rho) > 0`: la singularidad
 * está en rho = ±90°, el móvil plano, donde la proyección de "arriba" sobre
 * la pantalla se anula y el ángulo deja de existir. Fuera de la zona de juego
 * —se juega mirando la pantalla— y bien lejos del beta = ±90° donde la tiene
 * `deviceorientation`. `planarConfidence` mide cuánto queda de esa proyección.
 */
export function anglesFromUp(u: Vec3): Angles {
  const mag = Math.sqrt(u.x * u.x + u.y * u.y + u.z * u.z) || 1
  return {
    phi: Math.atan2(u.x, u.y) * RAD_TO_DEG,
    rho: Math.asin(Math.max(-1, Math.min(1, u.z / mag))) * RAD_TO_DEG,
  }
}

/**
 * Cuánto de "arriba del mundo" queda proyectado sobre la pantalla, 0..1.
 * Vale `cos(rho)`. Cerca de 0 el móvil está plano y `phi` es puro ruido.
 */
export function planarConfidence(u: Vec3): number {
  const mag = Math.sqrt(u.x * u.x + u.y * u.y + u.z * u.z) || 1
  return Math.sqrt(u.x * u.x + u.y * u.y) / mag
}

/** Pliegue de `beta` al rango de `asin`, [-90, 90]. */
export function foldBeta(beta: number): number {
  if (beta > 90) return 180 - beta
  if (beta < -90) return -180 - beta
  return beta
}

/**
 * "Arriba del mundo" a partir de `accelerationIncludingGravity`.
 *
 * En reposo el acelerómetro mide la reacción a la gravedad, así que el vector
 * es antiparalelo a ella.  `s` es el signo de la plataforma (ver `SignProbe`):
 * s = +1 en iOS, s = -1 en Android y en la especificación.
 */
export function upFromAccel(a: Vec3, s: 1 | -1): Vec3 {
  const m = Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z) || 1
  const k = -s / m
  return { x: a.x * k, y: a.y * k, z: a.z * k }
}

/** Diferencia angular con envoltura a (-180, 180]. */
export function angleDiff(a: number, b: number): number {
  let d = (a - b) % 360
  if (d > 180) d -= 360
  if (d <= -180) d += 360
  return d
}

/**
 * Cuantización a décimas de grado enteras. Es la frontera del determinismo:
 * todo lo que cruza hacia `core/` pasa por aquí.
 *
 * 0,1° está por debajo de la resolución real del sensor tras fusión
 * (~0,05-0,1° en reposo, ~0,3-0,5° en movimiento, plan §1.1), así que no
 * pierde información. Y en ±204,7° cabe en los 12 bits por canal del formato
 * TRZ1 de la fase 2 (3 bytes por muestra: phi y rho).
 */
export function toDdeg(deg: number): number {
  return Math.round(deg * 10)
}

// ---------------------------------------------------------------------------
// 1. Permiso
// ---------------------------------------------------------------------------

export type PermissionOutcome =
  | 'granted'
  | 'denied'
  /** Android / escritorio: no hay diálogo, pero tampoco garantía de datos. */
  | 'granted-no-prompt'
  /** Ni `DeviceMotionEvent` existe. Escritorio. */
  | 'no-api'

interface MotionCtorWithPermission {
  requestPermission?: () => Promise<'granted' | 'denied'>
}

/**
 * PELIGRO — el orden de las líneas de esta función es su razón de ser.
 *
 * iOS exige que `DeviceMotionEvent.requestPermission()` se invoque mientras
 * dura la activación transitoria del gesto del usuario.  Un solo `await` por
 * delante la consume, y la llamada falla sin decir por qué: no tira excepción,
 * simplemente resuelve 'denied' o no resuelve nunca.
 *
 * Por eso esta función NO es `async`.  Devuelve la promesa que le da iOS, y no
 * ejecuta ni una operación asíncrona antes de pedir el permiso.  Si alguna vez
 * necesitas cargar algo antes de pedirlo, cárgalo DESPUÉS: pide primero.
 *
 * Llámala directamente desde el handler del gesto, nunca desde un `.then()`.
 */
export function requestMotionPermission(): Promise<PermissionOutcome> {
  const Ctor = (globalThis as { DeviceMotionEvent?: MotionCtorWithPermission })
    .DeviceMotionEvent

  if (Ctor === undefined) return Promise.resolve<PermissionOutcome>('no-api')
  if (typeof Ctor.requestPermission !== 'function') {
    return Promise.resolve<PermissionOutcome>('granted-no-prompt')
  }

  // ↓↓↓ Primera operación de la función. No meter nada por delante. ↓↓↓
  return Ctor.requestPermission().then(
    (state) => (state === 'granted' ? 'granted' : 'denied'),
    () => 'denied' as const,
  )
}

// ---------------------------------------------------------------------------
// 2. La sonda de signos
// ---------------------------------------------------------------------------

/** Cómo se resolvió el signo, y con cuánto margen. Se muestra en depuración. */
export interface SignResolution {
  /** Factor para `accelerationIncludingGravity`: +1 iOS, -1 Android/spec. */
  accel: 1 | -1
  /** Factor para `rotationRate`, de modo que `gyro·(beta,gamma,alpha)` sea la
   *  velocidad angular verdadera en el marco dextrógiro del dispositivo. */
  gyro: 1 | -1
  /** 'measured' contra deviceorientation, o 'assumed' si no llegó. */
  how: 'measured' | 'assumed'
  /** Error medio en grados de la hipótesis ganadora frente a la perdedora. */
  errWin: number
  errLose: number
  samples: number
}

/**
 * Sonda del signo del acelerómetro y del giróscopo.
 *
 * Separada de `Fusion` a propósito: no toca el DOM, así que se puede verificar
 * con muestras sintéticas en un test unitario en vez de agitando un teléfono.
 */
export class SignProbe {
  #errPos = 0
  #errNeg = 0
  #n = 0
  #gyroCorr = 0
  #lastPhiPos: number | null = null
  #lastT: number | null = null

  /**
   * @param a     `accelerationIncludingGravity` tal cual llega, sin tocar.
   * @param beta  `beta` de `deviceorientation`, o null si aún no llegó.
   * @param wBeta `rotationRate.beta` tal cual llega, o null.
   * @param t     ms.
   */
  /**
   * @param a      `accelerationIncludingGravity` tal cual llega, sin tocar.
   * @param beta   `beta` de `deviceorientation`, o null si aún no llegó.
   * @param wAlpha `rotationRate.alpha` tal cual llega, o null.
   * @param t      ms.
   */
  add(a: Vec3, beta: number | null, wAlpha: number | null, t: number): void {
    // La hipótesis contraria es exactamente el vector negado, así que su
    // `asin(u.y)` es `-aPos`: no hace falta calcularla aparte.
    const uPos = upFromAccel(a, 1)

    // La referencia ya no es `phi`, sino la COMPONENTE `u.y`, porque
    // `asin(u.y) = beta` y `beta` es el mejor condicionado de los tres
    // ángulos de Euler: no se apoya en el magnetómetro como `alpha` ni se
    // queda sin sentido cerca del gimbal lock como `gamma`.
    //
    // Además así la sonda no depende de cómo se defina `phi`, lo que la deja
    // intacta si mañana se vuelve a cambiar el eje de medida.
    if (beta !== null) {
      const ref = foldBeta(beta)
      const aPos = Math.asin(Math.max(-1, Math.min(1, uPos.y))) * RAD_TO_DEG
      this.#errPos += Math.abs(aPos - ref)
      this.#errNeg += Math.abs(-aPos - ref)
      this.#n++
    }

    // El signo del giróscopo sale de su correlación con la deriva del ángulo,
    // sin depender de la plataforma ni de `beta`.
    //
    // Para un vector fijo del mundo visto desde un marco que rota,
    // du/dt = -w × u. Con w = (0, 0, w_z) y u = (sin phi, cos phi, 0) sale
    // **phi̇ = +w_z**: la correlación de un giróscopo bien orientado es
    // POSITIVA. (Con la descomposición anterior, sobre el eje x, era
    // negativa. El canal también cambia: `alpha`, no `beta`.)
    const phiPos = anglesFromUp(uPos).phi
    if (wAlpha !== null && this.#lastPhiPos !== null && this.#lastT !== null) {
      const dt = (t - this.#lastT) / 1000
      if (dt > 0) this.#gyroCorr += wAlpha * (angleDiff(phiPos, this.#lastPhiPos) / dt)
    }
    this.#lastPhiPos = phiPos
    this.#lastT = t
  }

  resolve(): SignResolution {
    const gyro: 1 | -1 = this.#gyroCorr >= 0 ? 1 : -1
    if (this.#n === 0) {
      // `deviceorientation` no disparó ni una vez. Raro, pero pasa. Se asume
      // la convención de la especificación y se DECLARA la suposición, para
      // que la pantalla de depuración lo enseñe en vez de mentir.
      return { accel: -1, gyro, how: 'assumed', errWin: 0, errLose: 0, samples: 0 }
    }
    const ep = this.#errPos / this.#n
    const en = this.#errNeg / this.#n
    return {
      accel: ep <= en ? 1 : -1,
      gyro,
      how: 'measured',
      errWin: Math.min(ep, en),
      errLose: Math.max(ep, en),
      samples: this.#n,
    }
  }
}

// ---------------------------------------------------------------------------
// 3. La traza
// ---------------------------------------------------------------------------

export interface Sample {
  /** ms, reloj `performance.now()` al RECIBIR el evento (nunca `event.timeStamp`). */
  t: number
  phi: number
  rho: number
  /** dphi/dt en °/s, del giróscopo ya con signo resuelto. Para extrapolar. */
  phiRate: number
  /** phi crudo del acelerómetro, sin fusionar. Sólo diagnóstico. */
  phiAccel: number
}

/** Plan §1.2: se extrapola hacia delante, no se interpola hacia atrás. */
export const MAX_EXTRAPOLATION_MS = 25

/**
 * Anillo de muestras a la cadencia del sensor.
 *
 * Separado de `Fusion` porque el laboratorio de trazas lo rellena desde un
 * fichero grabado, sin sensor y sin DOM.
 */
export class TraceBuffer {
  #buf: Sample[] = []
  #cap: number
  #head = 0
  #len = 0

  constructor(capacity = 3000) { this.#cap = capacity }

  get length(): number { return this.#len }

  push(s: Sample): void {
    if (this.#len < this.#cap) { this.#buf.push(s); this.#len++ }
    else { this.#buf[this.#head] = s }
    this.#head = (this.#head + 1) % this.#cap
  }

  clear(): void { this.#buf = []; this.#head = 0; this.#len = 0 }

  /** Las muestras en orden cronológico. */
  all(): Sample[] {
    if (this.#len < this.#cap) return this.#buf.slice()
    return [...this.#buf.slice(this.#head), ...this.#buf.slice(0, this.#head)]
  }

  /**
   * El ángulo en `t` (ms, mismo reloj que las muestras).
   *
   * Dentro del buffer, interpola linealmente.  Por delante de la última
   * muestra, EXTRAPOLA con el giróscopo hasta `MAX_EXTRAPOLATION_MS` en vez de
   * devolver el último valor: es lo que hace que un iPhone a 120 fps con el
   * sensor a 60 Hz se sienta fluido en vez de escalonado (plan §1.2).
   */
  sampleAt(t: number): Angles | null {
    const tr = this.all()
    if (tr.length === 0) return null
    const first = tr[0]!
    const last = tr[tr.length - 1]!
    if (t <= first.t) return { phi: first.phi, rho: first.rho }
    if (t >= last.t) {
      const lead = Math.min(t - last.t, MAX_EXTRAPOLATION_MS) / 1000
      return { phi: last.phi + last.phiRate * lead, rho: last.rho }
    }

    let lo = 0
    let hi = tr.length - 1
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (tr[mid]!.t <= t) lo = mid
      else hi = mid
    }
    const a = tr[lo]!
    const b = tr[hi]!
    const span = b.t - a.t
    const u = span > 0 ? (t - a.t) / span : 0
    return { phi: a.phi + (b.phi - a.phi) * u, rho: a.rho + (b.rho - a.rho) * u }
  }

  /** Frecuencia media de muestreo sobre las últimas `n` muestras, en Hz. */
  rateHz(n = 60): number {
    const tr = this.all()
    if (tr.length < 2) return 0
    const slice = tr.slice(-Math.min(n, tr.length))
    const span = slice[slice.length - 1]!.t - slice[0]!.t
    return span > 0 ? ((slice.length - 1) * 1000) / span : 0
  }
}

// ---------------------------------------------------------------------------
// 4. El gate de calidad
// ---------------------------------------------------------------------------

/** Plan §1.1: sin esto la gente calibra andando. */
export const REST_GATE = {
  holdMs: 1200,
  maxAccelDeviation: 0.6,   // |‖a‖ − 9,81| m/s²
  maxOmegaDegPerSec: 8,
  maxPhiSpreadDeg: 1.5,
} as const

export class RestGate {
  #since: number | null = null
  #phiMin = Infinity
  #phiMax = -Infinity

  /** @returns ms de reposo acumulado; `holdMs` o más significa aprobado. */
  update(t: number, accelMag: number, omegaMag: number, phi: number): number {
    const still =
      Math.abs(accelMag - 9.81) < REST_GATE.maxAccelDeviation &&
      omegaMag < REST_GATE.maxOmegaDegPerSec

    if (!still) { this.reset(); return 0 }

    this.#phiMin = Math.min(this.#phiMin, phi)
    this.#phiMax = Math.max(this.#phiMax, phi)
    if (this.#phiMax - this.#phiMin > REST_GATE.maxPhiSpreadDeg) { this.reset(); return 0 }

    if (this.#since === null) { this.#since = t; return 0 }
    return t - this.#since
  }

  reset(): void { this.#since = null; this.#phiMin = Infinity; this.#phiMax = -Infinity }
}

// ---------------------------------------------------------------------------
// 5. Fusion
// ---------------------------------------------------------------------------

export type SensorStatus =
  | { kind: 'idle' }
  | { kind: 'no-api' }
  | { kind: 'denied' }
  /** Permiso concedido y ni un evento en `SILENCE_TIMEOUT_MS`. El olvidado. */
  | { kind: 'granted-but-silent' }
  | { kind: 'probing' }
  | { kind: 'live'; sign: SignResolution }

export const SILENCE_TIMEOUT_MS = 1200
export const PROBE_MS = 600
/** Plan: complementario sobre el vector, τ = 0,40 s. */
export const TAU_S = 0.40
/** El roll sí se calibra, acotado. El pitch nunca — plan §1.1. */
export const ROLL_OFFSET_CLAMP_DEG = 10

interface MotionLike {
  accelerationIncludingGravity: { x: number | null; y: number | null; z: number | null } | null
  rotationRate: { alpha: number | null; beta: number | null; gamma: number | null } | null
}

export interface FusionOptions {
  traceCapacity?: number
  onStatus?: (s: SensorStatus) => void
}

export class Fusion {
  #status: SensorStatus = { kind: 'idle' }
  #onStatus: ((s: SensorStatus) => void) | undefined
  #sign: SignResolution = { accel: -1, gyro: 1, how: 'assumed', errWin: 0, errLose: 0, samples: 0 }

  #probeUntil = 0
  #probeBeta: number | null = null
  #probe = new SignProbe()

  /** Estado del filtro: "arriba del mundo" visto desde el móvil. */
  #up: Vec3 = { x: 0, y: 1, z: 0 }
  #lastT: number | null = null
  #rollOffset = 0
  #phiRate = 0

  #trace: TraceBuffer
  #silenceTimer: ReturnType<typeof setTimeout> | undefined
  #onMotion: ((e: Event) => void) | undefined
  #onOrientation: ((e: Event) => void) | undefined

  /** Últimas magnitudes crudas, para el gate de calidad. */
  accelMag = 9.81
  omegaMag = 0
  motionEvents = 0
  orientationEvents = 0

  constructor(opts: FusionOptions = {}) {
    this.#trace = new TraceBuffer(opts.traceCapacity ?? 3000)
    this.#onStatus = opts.onStatus
  }

  get status(): SensorStatus { return this.#status }
  get up(): Vec3 { return this.#up }
  /** cos(rho): cuánto de "arriba" queda sobre la pantalla. Cerca de 0, phi es ruido. */
  get planarConfidence(): number { return planarConfidence(this.#up) }
  get sign(): SignResolution { return this.#sign }
  get traceLength(): number { return this.#trace.length }

  get angles(): Angles {
    const a = anglesFromUp(this.#up)
    return { phi: a.phi, rho: a.rho - this.#rollOffset }
  }

  #setStatus(s: SensorStatus): void { this.#status = s; this.#onStatus?.(s) }

  /**
   * Arranca la escucha. Llamar DESPUÉS de `requestMotionPermission()` y sólo
   * si su resultado fue 'granted' o 'granted-no-prompt'.
   */
  start(): void {
    this.#probeUntil = performance.now() + PROBE_MS
    this.#setStatus({ kind: 'probing' })

    // El tercer caso. Permiso concedido no significa que llegue un solo evento.
    this.#silenceTimer = setTimeout(() => {
      if (this.motionEvents === 0) this.#setStatus({ kind: 'granted-but-silent' })
    }, SILENCE_TIMEOUT_MS)

    this.#onOrientation = (e: Event): void => {
      const beta = (e as DeviceOrientationEvent).beta
      if (beta !== null) { this.#probeBeta = beta; this.orientationEvents++ }
    }
    this.#onMotion = (e: Event): void => { this.#handleMotion(e as unknown as MotionLike) }

    addEventListener('deviceorientation', this.#onOrientation)
    addEventListener('devicemotion', this.#onMotion)
  }

  stop(): void {
    if (this.#onMotion) removeEventListener('devicemotion', this.#onMotion)
    if (this.#onOrientation) removeEventListener('deviceorientation', this.#onOrientation)
    if (this.#silenceTimer !== undefined) clearTimeout(this.#silenceTimer)
  }

  /** Congela el ladeo actual como cero lateral, acotado a ±10°. */
  calibrateRoll(): number {
    const raw = anglesFromUp(this.#up).rho
    this.#rollOffset = Math.max(-ROLL_OFFSET_CLAMP_DEG, Math.min(ROLL_OFFSET_CLAMP_DEG, raw))
    return this.#rollOffset
  }

  #handleMotion(e: MotionLike): void {
    const a = e.accelerationIncludingGravity
    if (!a || a.x === null || a.y === null || a.z === null) return

    const now = performance.now()  // nunca `event.timeStamp`: epoch y resolución
    this.motionEvents++            // inconsistentes entre Safari y Chrome.
    const av: Vec3 = { x: a.x, y: a.y, z: a.z }
    this.accelMag = Math.sqrt(av.x * av.x + av.y * av.y + av.z * av.z)

    const rr = e.rotationRate
    if (rr) {
      const wa = rr.alpha ?? 0, wb = rr.beta ?? 0, wg = rr.gamma ?? 0
      this.omegaMag = Math.sqrt(wa * wa + wb * wb + wg * wg)
    }

    if (now < this.#probeUntil) {
      this.#probe.add(av, this.#probeBeta, rr?.alpha ?? null, now)
      return
    }
    if (this.#status.kind === 'probing') {
      this.#sign = this.#probe.resolve()
      this.#setStatus({ kind: 'live', sign: this.#sign })
    }

    // --- Complementario sobre el VECTOR (plan §1.1) ----------------------
    //
    // No es un compromiso entre dos medidas malas: el giróscopo aporta la
    // latencia baja y el acelerómetro la ausencia de deriva, y cada uno manda
    // en la banda de frecuencia en la que es bueno.
    //
    // Se filtra el vector, no los dos ángulos por separado, porque phi y rho
    // están acoplados por la rotación: filtrarlos sueltos introduce un error
    // que crece con el ladeo.
    const uAcc = upFromAccel(av, this.#sign.accel)
    const dt = this.#lastT === null ? 0 : (now - this.#lastT) / 1000
    const prevPhi = anglesFromUp(this.#up).phi
    this.#lastT = now

    if (dt <= 0 || dt > 0.25) {
      // Primer evento, o hueco largo (pestaña en segundo plano): no integres
      // medio segundo de giro de golpe, reengancha al acelerómetro.
      this.#up = uAcc
      this.#phiRate = 0
    } else {
      const g = this.#sign.gyro * DEG_TO_RAD
      const w: Vec3 = { x: (rr?.beta ?? 0) * g, y: (rr?.gamma ?? 0) * g, z: (rr?.alpha ?? 0) * g }
      const u = this.#up
      // du/dt = -w × u  (vector fijo del mundo visto desde un marco que rota)
      const pred: Vec3 = {
        x: u.x - (w.y * u.z - w.z * u.y) * dt,
        y: u.y - (w.z * u.x - w.x * u.z) * dt,
        z: u.z - (w.x * u.y - w.y * u.x) * dt,
      }
      const k = TAU_S / (TAU_S + dt)
      const m: Vec3 = {
        x: k * pred.x + (1 - k) * uAcc.x,
        y: k * pred.y + (1 - k) * uAcc.y,
        z: k * pred.z + (1 - k) * uAcc.z,
      }
      const n = Math.sqrt(m.x * m.x + m.y * m.y + m.z * m.z) || 1
      this.#up = { x: m.x / n, y: m.y / n, z: m.z / n }
    }

    const ang = anglesFromUp(this.#up)
    if (dt > 0 && dt <= 0.25) this.#phiRate = angleDiff(ang.phi, prevPhi) / dt

    this.#trace.push({
      t: now,
      phi: ang.phi,
      rho: ang.rho - this.#rollOffset,
      phiRate: this.#phiRate,
      phiAccel: anglesFromUp(uAcc).phi,
    })
  }

  // --- Traza (delegada) -------------------------------------------------
  trace(): Sample[] { return this.#trace.all() }
  clearTrace(): void { this.#trace.clear() }
  sampleAt(t: number): Angles | null { return this.#trace.sampleAt(t) }
  rateHz(n = 60): number { return this.#trace.rateHz(n) }
}
