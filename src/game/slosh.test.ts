import { describe, expect, it } from 'vitest'
import { Slosh } from '@/game/slosh'

const CANA = { radiusM: 0.032 }

describe('Slosh — la frecuencia sale de la física, no se elige', () => {
  it('una caña de R=32 mm chapotea a 3,8 Hz', () => {
    // Plan §1.4. ω² = (g·k₁/R)·tanh(k₁·h/R) con k₁ = 1,8412.
    const s = new Slosh(CANA)
    expect(s.naturalHz(0, 0.10)).toBeCloseTo(3.78, 2)
  })

  it('el segundo modo va más alto, como debe', () => {
    const s = new Slosh(CANA)
    expect(s.naturalHz(1, 0.10)).toBeGreaterThan(s.naturalHz(0, 0.10) * 1.5)
  })

  it('un vaso más ancho chapotea más despacio', () => {
    expect(new Slosh({ radiusM: 0.045 }).naturalHz(0, 0.10))
      .toBeLessThan(new Slosh(CANA).naturalHz(0, 0.10))
  })

  it('a poca profundidad baja la frecuencia (el tanh)', () => {
    const s = new Slosh(CANA)
    expect(s.naturalHz(0, 0.01)).toBeLessThan(s.naturalHz(0, 0.10) * 0.8)
  })
})

describe('Slosh — estabilidad', () => {
  it('a 100 Hz aguanta 60 s de sacudidas sin divergir', () => {
    const s = new Slosh(CANA)
    let worst = 0
    for (let i = 0; i < 6000; i++) {
      const omega = 30 * Math.sin(i * 0.07) + 12 * Math.sin(i * 0.31)
      worst = Math.max(worst, Math.abs(s.step(0.01, omega, 0.10)))
    }
    expect(worst).toBeLessThan(30)
    expect(Number.isFinite(worst)).toBe(true)
  })

  it('un solo frame largo lo revienta — por eso vive en el bucle fijo', () => {
    // Plan §1.4: «con dt variable un oscilador a 3,8 Hz explota». El caso real
    // no es un frame rate bajo constante, es UN parón: pestaña en segundo
    // plano, pausa del GC, cambio de app. Este test es la razón de que el
    // chapoteo se integre en pasos de 10 ms y no en el rAF.
    const fijo = new Slosh(CANA)
    const variable = new Slosh(CANA)
    for (let i = 0; i < 20; i++) fijo.step(0.01, i < 2 ? 200 : 0, 0.10)
    variable.step(0.20, 200, 0.10)          // el mismo tiempo, un solo paso

    const a = Math.abs(fijo.step(0.01, 0, 0.10))
    const b = Math.abs(variable.step(0.20, 0, 0.10))
    expect(a).toBeLessThan(20)
    expect(b).toBeGreaterThan(a * 5)
  })
})
