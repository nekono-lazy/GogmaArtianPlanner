// Issue #154 Phase 2-C2.6-B2-C2A-R1 Research only: the retry manifest.
//
// Reads the committed B2-C2A RESULT (--b2c2a-result), fails closed unless it is the registered formal B2C2A_INCOMPLETE
// result (parsePhase2C26B2C2AR1Authority()), and writes the task IDs of the rows B2-C2A never measured because their
// child timed out (`process === 'timeout' && record === null`, phase2c26b2c2ar1RetryManifest()) with the source hashes and
// nothing else: no compatibility, coverage, exact index, first-compatible rank, oracle operation cost or route kind.
// With --export, the Export SHA-256 must be the one B2-C2A recorded; with --targets, the Target manifest SHA-256 must be the
// one B2-C2A recorded. The retry runner reads this manifest, never the B2-C2A RESULT.
import { readFile, writeFile } from 'node:fs/promises'
import { lstatSync } from 'node:fs'
import { resolve, basename } from 'node:path'
import { createHash } from 'node:crypto'
import { createServer } from 'vite'

const args = process.argv.slice(2)
const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1] }
const resultPath = option('--b2c2a-result'), outputPath = option('--output'), exportPath = option('--export'), targetsPath = option('--targets')
if (!resultPath || !outputPath) {
  throw new Error('Usage: node scripts/prepare-planner-global-phase2c26b2c2ar1-retry.mjs --b2c2a-result docs/PLANNER_GLOBAL_PHASE2C26B2C2A_RESULT.json --output .local/PLANNER_GLOBAL_PHASE2C26B2C2AR1_RETRY.json.local [--export <external.json>] [--targets <targets manifest>]')
}
if (lstatSync(outputPath, { throwIfNoEntry: false }) !== undefined) throw new Error(`Output already exists: ${resolve(outputPath)}`)
const sha256 = value => createHash('sha256').update(value).digest('hex')
const raw = await readFile(resultPath)

const server = await createServer({ configFile: false, server: { middlewareMode: true, watch: null, hmr: false }, appType: 'custom' })
try {
  const authorityModule = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2C2AR1Authority.ts')
  const r1 = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2C2AR1.ts')
  const parsed = authorityModule.parsePhase2C26B2C2AR1Authority(JSON.parse(raw.toString('utf8')), sha256(raw))
  if (!parsed.valid) throw new Error(`The B2-C2A RESULT is not the registered authority: ${parsed.issues.join('; ')}`)
  if (exportPath) {
    const exportSha = sha256(await readFile(exportPath))
    if (exportSha !== parsed.authority.exportSha256) throw new Error(`The Export ${exportSha} is not the one B2-C2A recorded (${parsed.authority.exportSha256}).`)
  }
  if (targetsPath) {
    const targetsSha = sha256(await readFile(targetsPath))
    if (targetsSha !== parsed.authority.targetManifestSha256) throw new Error(`The Target manifest ${targetsSha} is not the one B2-C2A recorded (${parsed.authority.targetManifestSha256}).`)
  }
  const manifest = authorityModule.phase2c26b2c2ar1RetryManifest(parsed.authority)
  // The manifest must be exactly what the retry runner accepts.
  const check = r1.parsePhase2C26B2C2AR1RetryManifest(JSON.parse(JSON.stringify(manifest)))
  if (!check.valid) throw new Error(`The retry manifest does not parse: ${check.issues.join('; ')}`)
  const text = JSON.stringify(manifest, null, 2) + '\n'
  await writeFile(outputPath, text, { flag: 'wx' })
  console.log(JSON.stringify({ output: resolve(outputPath), sourceResult: basename(resultPath), sourceResultSha256: sha256(raw), manifestSha256: sha256(text),
    taskIds: manifest.taskIds, exportChecked: Boolean(exportPath), targetsChecked: Boolean(targetsPath) }, null, 2))
} finally {
  await server.close()
}
