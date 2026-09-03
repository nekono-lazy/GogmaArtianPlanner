import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/** Isolated C8 production-build entry; it does not change the normal app build. */
export default defineConfig({
  plugins: [react()],
  base: '/GogmaArtianPlanner/',
  build: {
    outDir: 'dist-benchmark',
    emptyOutDir: true,
    rollupOptions: { input: 'benchmark.html' },
  },
})
