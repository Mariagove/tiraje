/**
 * Comillas invertidas dentro de comentarios HTML: el error que va por su
 * cuarta vez.
 *
 * El marcado de estas vistas vive en template literals, así que una comilla
 * invertida escrita dentro de un `<!-- ... -->` CIERRA el literal. El fallo que
 * produce no menciona comentarios ni comillas: `tsc` dice «';' expected» en una
 * línea cualquiera de más abajo, y uno se va a buscar el punto y coma.
 *
 * Ha pasado con `tabular-nums`, con `flex-1`, con `index.html` y con `px-4`.
 * Cuatro veces es un patrón, no un despiste, así que se automatiza.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

function ficheros(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? ficheros(join(dir, d.name))
      : d.name.endsWith('.ts') ? [join(dir, d.name)] : [])
}

describe('marcado dentro de template literals', () => {
  it('ningún comentario HTML lleva comillas invertidas dentro', () => {
    const culpables: string[] = []
    for (const f of ficheros('src')) {
      const texto = readFileSync(f, 'utf8')
      // `[^]` en vez de `.` para que cruce saltos de línea: estos comentarios
      // casi siempre ocupan varias.
      for (const m of texto.matchAll(/<!--[^]*?-->/g)) {
        if (m[0].includes('`')) {
          const linea = texto.slice(0, m.index).split('\n').length
          culpables.push(`${f}:${linea}`)
        }
      }
    }
    expect(culpables, culpables.join(' · ')).toEqual([])
  })
})
