import { execSync } from 'node:child_process'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import basicSsl from '@vitejs/plugin-basic-ssl'

/**
 * El sello de versión, visible en la pantalla de inicio.
 *
 * No es adorno de desarrollador: `index.html` se sirve con `max-age=600`, así
 * que durante diez minutos el móvil puede seguir ejecutando el build anterior
 * —y en un iPhone con el sitio en la pantalla de inicio, más—. Sin un sello a
 * la vista, «no noto nada» no se puede distinguir de «estoy probando la
 * versión de antes», que es exactamente lo que pasó: se probó un cambio sobre
 * el bundle viejo y la sesión de pruebas se perdió entera.
 *
 * Con esto, cualquiera que esté probando puede cantar el sello y se sabe qué
 * código tiene en la mano.
 */
function sello(): string {
  try {
    const sha = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim()
    const limpio = execSync('git status --porcelain', { encoding: 'utf8' }).trim() === ''
    const fecha = new Date().toLocaleString('es-ES', {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    })
    return `${sha}${limpio ? '' : '+'} · ${fecha}`
  } catch {
    return 'sin git'
  }
}

// HTTPS is not optional: DeviceMotionEvent requires a secure context, and the
// phone reaches this dev server over the LAN IP, which is never a secure
// context over plain http. See docs/DEV-HTTPS.md for the stable-hostname setup.
export default defineConfig({
  define: { SELLO_BUILD: JSON.stringify(sello()) },
  // Rutas RELATIVAS en el build.
  //
  // En GitHub Pages el sitio no vive en la raíz del dominio sino en
  // `/tiraje/`, así que un `/assets/index.js` absoluto da 404. Con `./` el
  // mismo build sirve en la raíz, en un subdirectorio y abierto desde disco,
  // y no hay que acordarse de cambiar una constante al mover el sitio.
  //
  // Sólo afecta al build: el servidor de desarrollo sigue en la raíz.
  base: './',
  plugins: [tailwindcss(), basicSsl()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    host: true,
    port: 5173,
    strictPort: true,
  },
  build: {
    target: 'es2023',
    // Budget from the handoff: 250 KB total. Shout before we drift past it.
    chunkSizeWarningLimit: 250,
  },
})
