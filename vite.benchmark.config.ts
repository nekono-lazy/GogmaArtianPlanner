import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Issue #154 Phase 2-A: the benchmark build records its own provenance (git HEAD, whether the benchmark-
 * affecting code was committed, and the SHA-256 of that committed code - the same file list and formula as
 * the Node Research runners), so a Browser record names the exact code it measured. Benchmark build only.
 */
const BENCHMARK_CODE_PATHS = ['src', 'scripts', 'package.json', 'package-lock.json', 'vite.config.ts', 'vite.benchmark.config.ts',
  'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json', 'benchmark.html']
function benchmarkBuildProvenance() {
  try {
    const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8' }).trim()
    const hash = createHash('sha256')
    for (const file of git('ls-files', '--', ...BENCHMARK_CODE_PATHS).split(/\r?\n/).filter(Boolean)) {
      hash.update(file + '\0'); hash.update(readFileSync(file)); hash.update('\0')
    }
    return { commit: git('rev-parse', 'HEAD'), uncommittedBenchmarkCode: git('status', '--porcelain', '--', ...BENCHMARK_CODE_PATHS) !== '',
      benchmarkCodeSha256: hash.digest('hex'), benchmarkCodePaths: BENCHMARK_CODE_PATHS }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Phase 2-A memory runs need `crossOriginIsolated` for `performance.measureUserAgentSpecificMemory()`.
 * Opt-in only (`BENCHMARK_CROSS_ORIGIN_ISOLATED=1`), so the existing benchmark harnesses keep their
 * recorded environment by default; the normal app config (`vite.config.ts`) is untouched.
 */
const crossOriginIsolation = process.env.BENCHMARK_CROSS_ORIGIN_ISOLATED === '1'
  ? { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' }
  : undefined

/** Isolated C8 production-build entry; it does not change the normal app build. */
export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: '/GogmaArtianPlanner/',
  define: { __PLANNER_GLOBAL_BENCHMARK_BUILD__: JSON.stringify(command === 'build' ? benchmarkBuildProvenance() : null) },
  server: crossOriginIsolation ? { headers: crossOriginIsolation } : {},
  preview: crossOriginIsolation ? { headers: crossOriginIsolation } : {},
  build: {
    outDir: 'dist-benchmark',
    emptyOutDir: true,
    rollupOptions: { input: 'benchmark.html' },
  },
}))
