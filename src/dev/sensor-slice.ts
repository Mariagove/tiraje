/**
 * sensor-slice.ts — la vista del día 1: permiso, fusión, ángulo y gráfica.
 *
 * Es el aparato con el que se contesta, en un iPhone viejo, un Android barato
 * y un webview de Instagram, la única pregunta que importa el día 1:
 * ¿llega el ángulo, a qué frecuencia, y con cuánto ruido?
 */
import type { Fusion } from '@/sensors/fusion'
import { OneEuro } from '@/sensors/oneEuro'

/** Plan §1.1: el readout se refresca a 12-15 Hz, no a 60. */
const READOUT_INTERVAL_MS = 75

/**
 * La tinta de la piel actual, con alfa, para dibujar en el canvas.
 *
 * El canvas no hereda `currentColor`, así que el color hay que leerlo del
 * token y componerlo a mano. Se lee una vez al montar: `getComputedStyle` en
 * cada frame fuerza un reflujo, y la piel no cambia mientras la vista vive.
 */
function inkFactory(): (alpha: number) => string {
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue('--color-marca').trim() || '#b02c31'
  return (alpha) => (alpha >= 1 ? raw : `color-mix(in srgb, ${raw} ${alpha * 100}%, transparent)`)
}

export function mountSensorSlice(root: HTMLElement, fusion: Fusion): () => void {
  const ink = inkFactory()
  root.innerHTML = `
    <div class="flex flex-col gap-3">
      <div class="grid grid-cols-2 gap-3">
        <div><div class="text-[0.65rem] tracking-widest text-ambar-dim">φ EN PLANO</div>
          <div id="phi" class="font-mono text-4xl tabular-nums">—</div></div>
        <div><div class="text-[0.65rem] tracking-widest text-ambar-dim">ρ FUERA DE PLANO</div>
          <div id="rho" class="font-mono text-4xl tabular-nums">—</div></div>
      </div>
      <canvas id="graph" class="superficie w-full rounded" height="160"></canvas>
      <dl id="diag" class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-xs text-ambar-dim"></dl>
      <div class="flex gap-2">
        <button id="cal" class="boton flex-1 px-3 py-3 text-sm">CALIBRAR ρ</button>
        <button id="dump" class="boton flex-1 px-3 py-3 text-sm">COPIAR CRUDO</button>
      </div>
      <p id="note" class="text-xs text-ambar-dim"></p>
    </div>
  `
  const $ = <T extends HTMLElement>(id: string): T => root.querySelector<T>(`#${id}`)!
  const phiEl = $('phi'), rhoEl = $('rho'), diagEl = $('diag'), note = $('note')
  const canvas = $<HTMLCanvasElement>('graph')
  const ctx = canvas.getContext('2d')

  // El One Euro sólo toca el número mostrado, nunca la traza (plan §1.1).
  const fPhi = new OneEuro(1.0, 0.007)
  const fRho = new OneEuro(1.0, 0.007)
  let lastReadout = 0

  $('cal').addEventListener('click', () => {
    note.textContent = `ρ calibrado, offset ${fusion.calibrateRoll().toFixed(2)}° (acotado a ±10°)`
  })

  $('dump').addEventListener('click', () => {
    const tr = fusion.trace()
    const json = JSON.stringify({ ua: navigator.userAgent, sign: fusion.sign, samples: tr })
    void navigator.clipboard?.writeText(json).then(
      () => { note.textContent = `${tr.length} muestras crudas, ${(json.length / 1024).toFixed(1)} KB` },
      () => { console.log(json); note.textContent = 'el portapapeles falló; va por consola' },
    )
  })

  let raf = 0
  function draw(now: number): void {
    raf = requestAnimationFrame(draw)
    const { phi, rho } = fusion.angles

    if (now - lastReadout >= READOUT_INTERVAL_MS) {
      lastReadout = now
      // 3 decimales: sólo son honestos con el móvil quieto, y aquí lo está a
      // propósito. En el juego el HUD desaparece al abrir el grifo.
      phiEl.textContent = `${fPhi.filter(phi, now).toFixed(3)}°`
      rhoEl.textContent = `${fRho.filter(rho, now).toFixed(3)}°`

      const s = fusion.sign
      diagEl.innerHTML = ([
        ['muestras/s', `${fusion.rateHz().toFixed(1)} Hz`],
        ['eventos motion', String(fusion.motionEvents)],
        ['eventos orient', String(fusion.orientationEvents)],
        ['signo accel', `${s.accel > 0 ? '+1 (iOS)' : '−1 (Android)'} · ${s.how}`],
        ['signo giro', s.gyro > 0 ? '+1' : '−1'],
        ['margen sonda', s.how === 'measured'
          ? `${s.errWin.toFixed(1)}° vs ${s.errLose.toFixed(1)}° · n=${s.samples}`
          : 'sin deviceorientation'],
        ['confianza', `${(fusion.planarConfidence * 100).toFixed(0)}% (cos ρ)`],
        ['‖a‖', `${fusion.accelMag.toFixed(2)} m/s²`],
        ['‖ω‖', `${fusion.omegaMag.toFixed(1)} °/s`],
        ['traza cruda', `${fusion.traceLength} muestras`],
      ] as const).map(([k, v]) => `<dt>${k}</dt><dd class="text-right text-ambar-foam">${v}</dd>`).join('')
    }

    if (!ctx) return
    const w = (canvas.width = canvas.clientWidth * devicePixelRatio)
    const h = canvas.height
    ctx.clearRect(0, 0, w, h)

    const tr = fusion.trace()
    const n = Math.min(tr.length, 300)
    if (n < 2) return
    const slice = tr.slice(-n)

    // Escala fija 0-90°, que es el rango de juego. Sin autoescala: una gráfica
    // que se reescala sola oculta justo el ruido que vienes a ver.
    const yOf = (deg: number): number => h - (Math.max(0, Math.min(90, deg)) / 90) * h
    // El trazo crudo y el filtrado, los dos en la tinta de marca: esta vista
    // vive sobre papel blanco, donde un blanco al 28% no existe.
    for (const [key, color, lw] of [
      ['phiAccel', ink(0.3), 1],
      ['phi', ink(1), 2],
    ] as const) {
      ctx.beginPath()
      ctx.strokeStyle = color
      ctx.lineWidth = lw * devicePixelRatio
      slice.forEach((smp, i) => {
        const x = (i / (n - 1)) * w
        const y = yOf(smp[key])
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
      })
      ctx.stroke()
    }
  }

  raf = requestAnimationFrame(draw)
  return () => { cancelAnimationFrame(raf) }
}
