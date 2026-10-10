// Setup for the Node environment project (`vitest.config.ts`, Issue #142).
// It keeps the same IndexedDB global the jsdom setup installs, and nothing
// DOM-specific: Domain tests render nothing and touch no browser API.
import 'fake-indexeddb/auto'
