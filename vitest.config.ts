import { configDefaults, defineConfig } from 'vitest/config'

/**
 * Domain unit tests run in the plain Node environment (Issue #142).
 *
 * `src/domain` is the pure calculation layer: it depends on neither React,
 * the DOM nor IndexedDB (`AGENTS.md` Architecture Rules), and its tests use no
 * DOM API. Creating a jsdom window and loading the React Testing Library
 * setup for each of those files cost far more than the tests themselves, so
 * they skip it. Every other test file - React components and pages, Services,
 * repositories, Workers, stores, benchmarks and scripts - keeps the jsdom
 * environment and the full setup unchanged.
 */
const nodeEnvironmentTestFiles = ['src/domain/**/*.test.ts']

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          include: nodeEnvironmentTestFiles,
          setupFiles: ['./src/test/setup.node.ts'],
        },
      },
      {
        test: {
          name: 'jsdom',
          environment: 'jsdom',
          exclude: [...configDefaults.exclude, ...nodeEnvironmentTestFiles],
          setupFiles: ['./src/test/setup.ts'],
        },
      },
    ],
  },
})
