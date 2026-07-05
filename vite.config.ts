import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  plugins: [react()],
  // GitHub Pages serves from /slice-studio/; keep dev server at /
  base: command === 'build' ? '/slice-studio/' : '/',
}))
