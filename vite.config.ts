import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import basicSsl from '@vitejs/plugin-basic-ssl'

// HTTPS is not optional: DeviceMotionEvent requires a secure context, and the
// phone reaches this dev server over the LAN IP, which is never a secure
// context over plain http. See docs/DEV-HTTPS.md for the stable-hostname setup.
export default defineConfig({
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
