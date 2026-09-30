import { describe, expect, it } from 'vitest'
import { DEGRADE_ABOVE_MS, TierController, WINDOW_FRAMES } from '@/render/tier'

const feed = (t: TierController, ms: number, n: number): number => {
  let changes = 0
  for (let i = 0; i < n; i++) if (t.sample(ms)) changes++
  return changes
}

describe('TierController', () => {
  it('no degrada con la ventana a medio llenar', () => {
    const t = new TierController()
    expect(feed(t, 40, WINDOW_FRAMES - 1)).toBe(0)
    expect(t.level).toBe(0)
  })

  it('degrada un escalón cuando la media pasa de 20 ms', () => {
    const t = new TierController()
    feed(t, DEGRADE_ABOVE_MS + 5, WINDOW_FRAMES)
    expect(t.level).toBe(1)
    // Y si la cosa sigue mal, sigue bajando: 30 frames malos más, otro escalón.
    feed(t, DEGRADE_ABOVE_MS + 5, WINDOW_FRAMES)
    expect(t.level).toBe(2)
  })

  it('no cae en cascada: espera 30 frames entre escalones', () => {
    const t = new TierController()
    // 30 frames malos bastan para UN escalón, no para tres.
    feed(t, 40, WINDOW_FRAMES)
    const l1 = t.level
    feed(t, 40, WINDOW_FRAMES - 1)
    expect(t.level).toBe(l1)
  })

  it('llega hasta el nivel 3 y ahí se queda', () => {
    const t = new TierController()
    feed(t, 60, WINDOW_FRAMES * 10)
    expect(t.level).toBe(3)
    expect(t.tier.forceCanvas2d).toBe(true)
  })

  it('a 60 fps no degrada nunca', () => {
    const t = new TierController()
    expect(feed(t, 16.7, 600)).toBe(0)
    expect(t.level).toBe(0)
  })

  it('sólo baja, nunca sube: subir produce parpadeo entre calidades', () => {
    const t = new TierController()
    feed(t, 40, WINDOW_FRAMES)
    expect(t.level).toBe(1)
    feed(t, 8, 600)
    expect(t.level).toBe(1)
  })

  it('un fallo de contexto WebGL va al fondo directamente', () => {
    const t = new TierController()
    t.forceCanvas2d()
    expect(t.level).toBe(3)
  })

  it('los escalones degradan lo que dice el plan', () => {
    const t = new TierController()
    const seen: number[] = []
    for (let k = 0; k < 4; k++) { seen.push(t.tier.bubbles); feed(t, 60, WINDOW_FRAMES) }
    expect(seen).toEqual([150, 48, 0, 0])
  })
})
