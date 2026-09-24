import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    // Stamped in at build time and shown in Settings. Phones hold on to an
    // old copy of the app for a long time, and without this "has this fix
    // reached my phone yet" can only be guessed at.
    __BUILD_STAMP__: JSON.stringify(new Date().toISOString().slice(0, 16).replace("T", " ")),
  },
})
