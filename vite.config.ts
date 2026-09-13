import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/GogmaArtianPlanner/',
  build: {
    license: {
      fileName: 'licenses.md',
    },
  },
})
