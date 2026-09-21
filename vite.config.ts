import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import basicSsl from '@vitejs/plugin-basic-ssl'

// HTTPS is not optional: DeviceMotionEvent requires a secure context, and the
// phone reaches this dev server over the LAN IP, which is never a secure
// context over plain http. See docs/DEV-HTTPS.md for the stable-hostname setup.
export default defineConfig({
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
