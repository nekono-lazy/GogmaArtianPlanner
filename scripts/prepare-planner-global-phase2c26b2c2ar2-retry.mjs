// Issue #154 Phase 2-C2.6-B2-C2A-R2 Research only: the retry manifest.
//
// Reads the committed B2-C2A RESULT (--b2c2a-result) and the committed R1 RESULT (--r1-result), fails closed unless they are
// the registered formal B2C2A_INCOMPLETE result (the unchanged parsePhase2C26B2C2AR1Authority()) and the registered formal
// B2C2AR1_INCOMPLETE result (parsePhase2C26B2C2AR2R1Authority()) describing one chain (phase2c26b2c2ar2ChainIssues()), and
// writes the task IDs of the R1 retry rows R1 never measured because their child timed out (`process === 'timeout' &&
// record === null`, phase2c26b2c2ar2RetryManifest()) with the source hashes and nothing else: no
// compatibility, coverage, exact index, first-compatible rank, oracle operation cost, route kind or other-rank exact.
// With --export, the Export SHA-256 must be the one both RESULTs recorded; with --targets, the Target manifest SHA-256 must
// be the one both recorded. The retry runner reads this manifest, never a RESULT.
import { readFile, writeFile } from 'node:fs/promises'
import { lstatSync } from 'node:fs'
import { resolve, basename } from 'node:path'
import { createHash } from 'node:crypto'
import { createServer } from 'vite'

const args = process.argv.slice(2)
const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1] }
const b2c2aPath = option('--b2c2a-result'), r1Path = option('--r1-result'), outputPath = option('--output'), exportPath = option('--export'), targetsPath = option('--targets')
if (!b2c2aPath || !r1Path || !outputPath) {
  throw new Error('Usage: node scripts/prepare-planner-global-phase2c26b2c2ar2-retry.mjs --b2c2a-result docs/PLANNER_GLOBAL_PHASE2C26B2C2A_RESULT.json --r1-result docs/PLANNER_GLOBAL_PHASE2C26B2C2AR1_RESULT.json --output .local/PLANNER_GLOBAL_PHASE2C26B2C2AR2_RETRY.json.local [--export <external.json>] [--targets <targets manifest>]')
}
if (lstatSync(outputPath, { throwIfNoEntry: false }) !== undefined) throw new Error(`Output already exists: ${resolve(outputPath)}`)
const sha256 = value => createHash('sha256').update(value).digest('hex')
const rawB2C2A = await readFile(b2c2aPath)
const rawR1 = await readFile(r1Path)

const server = await createServer({ configFile: false, server: { middlewareMode: true, watch: null, hmr: false }, appType: 'custom' })
try {
  const r1AuthorityModule = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2C2AR1Authority.ts')
  const r2AuthorityModule = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2C2AR2Authority.ts')
  const r2 = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2C2AR2.ts')
  const b2c2a = r1AuthorityModule.parsePhase2C26B2C2AR1Authority(JSON.parse(rawB2C2A.toString('utf8')), sha256(rawB2C2A))
  if (!b2c2a.valid) throw new Error(`The B2-C2A RESULT is not the registered authority: ${b2c2a.issues.join('; ')}`)
  const r1 = r2AuthorityModule.parsePhase2C26B2C2AR2R1Authority(JSON.parse(rawR1.toString('utf8')), sha256(rawR1))
  if (!r1.valid) throw new Error(`The R1 RESULT is not the registered authority: ${r1.issues.join('; ')}`)
  const chain = r2AuthorityModule.phase2c26b2c2ar2ChainIssues(b2c2a.authority, r1.authority)
  if (chain.length > 0) throw new Error(`The B2-C2A and R1 RESULTs are not one chain: ${chain.join('; ')}`)
  if (exportPath) {
    const exportSha = sha256(await readFile(exportPath))
    if (exportSha !== r1.authority.exportSha256) throw new Error(`The Export ${exportSha} is not the one B2-C2A / R1 recorded (${r1.authority.exportSha256}).`)
  }
  if (targetsPath) {
    const targetsSha = sha256(await readFile(targetsPath))
    if (targetsSha !== r1.authority.targetManifestSha256) throw new Error(`The Target manifest ${targetsSha} is not the one B2-C2A / R1 recorded (${r1.authority.targetManifestSha256}).`)
  }
  const manifest = r2AuthorityModule.phase2c26b2c2ar2RetryManifest(r1.authority)
  // The manifest must be exactly what the retry runner accepts.
  const check = r2.parsePhase2C26B2C2AR2RetryManifest(JSON.parse(JSON.stringify(manifest)))
  if (!check.valid) throw new Error(`The retry manifest does not parse: ${check.issues.join('; ')}`)
  const text = JSON.stringify(manifest, null, 2) + '\n'
  await writeFile(outputPath, text, { flag: 'wx' })
  console.log(JSON.stringify({ output: resolve(outputPath), sourceB2C2AResult: basename(b2c2aPath), sourceB2C2AResultSha256: sha256(rawB2C2A), sourceR1Result: basename(r1Path),
    sourceR1ResultSha256: sha256(rawR1), manifestSha256: sha256(text), taskIds: manifest.taskIds, exportChecked: Boolean(exportPath), targetsChecked: Boolean(targetsPath) }, null, 2))
} finally {
  await server.close()
}
