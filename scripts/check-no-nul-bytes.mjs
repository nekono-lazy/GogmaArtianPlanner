// Fails when a source or documentation text file contains a raw NUL byte.
//
// A raw NUL byte makes Git treat the file as binary, which hides its diff from
// review. A delimiter that needs NUL must be written as the six-character
// `\u0000` escape in TypeScript source instead of the byte itself.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join } from 'node:path'

const TEXT_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.md', '.css', '.html', '.yml', '.yaml', '.txt'])
const SCAN_ROOTS = ['src', 'docs', 'scripts', '.github']
const TOP_LEVEL_FILES = ['AGENTS.md', 'CLAUDE.md', 'README.md', 'package.json', 'index.html', 'vite.config.ts', 'vitest.config.ts']

function collectTextFiles(root, files) {
  let entries
  try {
    entries = readdirSync(root)
  } catch {
    return
  }
  for (const entry of entries) {
    const path = join(root, entry)
    if (statSync(path).isDirectory()) collectTextFiles(path, files)
    else if (TEXT_EXTENSIONS.has(extname(entry))) files.push(path)
  }
}

const files = []
for (const root of SCAN_ROOTS) collectTextFiles(root, files)
for (const file of TOP_LEVEL_FILES) {
  try {
    if (statSync(file).isFile()) files.push(file)
  } catch {
    // Optional top-level file.
  }
}

const offenders = files.filter((file) => readFileSync(file).includes(0))
if (offenders.length > 0) {
  console.error('Raw NUL bytes found in text files:')
  for (const file of offenders) console.error(`  ${file}`)
  process.exit(1)
}
console.log(`No raw NUL bytes in ${files.length} text files.`)
