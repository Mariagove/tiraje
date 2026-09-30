import { describe, expect, it } from 'vitest'
import { gradosDelJugador } from '@/dev/game-view'

/**
 * El número que se enseña NO es φ.
 *
 * Por dentro φ es el giro del móvil en el plano de su pantalla y vale 0 con el
 * móvil de pie; el jugador, en cambio, mide contra el suelo, que es lo que
 * tiene delante. Este test fija la correspondencia, que es lo único que hay
 * que mirar cuando alguien dude de si el 45 significa lo mismo que antes.
 */
describe('los grados que ve el jugador', () => {
  it('móvil de pie: φ = 0 se enseña como 90°', () => {
    expect(gradosDelJugador(0)).toBe(90)
  })

  it('móvil tumbado: φ = 90 se enseña como 0°', () => {
    expect(gradosDelJugador(90)).toBe(0)
  })

  it('a media inclinación los dos sistemas coinciden: 45 es 45', () => {
    expect(gradosDelJugador(45)).toBe(45)
    expect(gradosDelJugador(-45)).toBe(45)
  })

  it('da igual hacia qué lado se incline: se mide la magnitud', () => {
    for (const a of [12, 30, 48, 67]) {
      expect(gradosDelJugador(a), `${a}°`).toBe(gradosDelJugador(-a))
    }
  })

  it('nunca se sale de 0..90, pase lo que pase con el sensor', () => {
    for (const phi of [-180, -120, -91, 91, 140, 180]) {
      const g = gradosDelJugador(phi)
      expect(g, `${phi}°`).toBeGreaterThanOrEqual(0)
      expect(g, `${phi}°`).toBeLessThanOrEqual(90)
    }
  })

  it('es entero: el HUD no enseña decimales', () => {
    for (const phi of [12.4, 33.51, 44.99, 61.2]) {
      expect(Number.isInteger(gradosDelJugador(phi)), `${phi}°`).toBe(true)
    }
  })
})
