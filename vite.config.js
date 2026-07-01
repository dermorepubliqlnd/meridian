import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import legacy from '@vitejs/plugin-legacy'

// base: './' + legacy plugin => produces a classic (non-module) script bundle
// that can be opened directly by double-clicking dist/index.html, no server
// or "npm run dev" needed. This is only for quick local previews; the
// Netlify-deployed build still works normally either way.
export default defineConfig({
  base: './',
  plugins: [
    react(),
    tailwindcss(),
    legacy({ targets: ['defaults', 'not IE 11'], renderLegacyChunks: true, modernPolyfills: false }),
  ],
})
