// Issue #154 Phase 2-C2.6-B2-C2A Research only: the validation Target manifest.
//
// Reads the committed B2-C1 RESULT (--b2c1-result), fails closed unless it is the registered formal result
// (parsePhase2C26B2C2AB2C1Authority()), and writes the post-hoc subgroup `defaultExtent` as a manifest of Target IDs only
// (phase2c26b2c2aTargetManifest()): no rank, digest, first-compatible context or oracle field. The population choice is
// oracle-guided (B2-C1's post-hoc evaluation) and is declared as such; the Search runner reads this manifest, never the
// B2-C1 RESULT. With --export, the Export SHA-256 must be the one B2-C1 recorded.
import { readFile, writeFile } from 'node:fs/promises'
import { lstatSync } from 'node:fs'
import { resolve, basename } from 'node:path'
import { createHash } from 'node:crypto'
import { createServer } from 'vite'

const args = process.argv.slice(2)
const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1] }
const b2c1Path = option('--b2c1-result'), outputPath = option('--output'), exportPath = option('--export')
if (!b2c1Path || !outputPath) {
  throw new Error('Usage: node scripts/prepare-planner-global-phase2c26b2c2a-targets.mjs --b2c1-result docs/PLANNER_GLOBAL_PHASE2C26B2C1_RESULT.json --output .local/PLANNER_GLOBAL_PHASE2C26B2C2A_TARGETS.json.local [--export <external.json>]')
}
if (lstatSync(outputPath, { throwIfNoEntry: false }) !== undefined) throw new Error(`Output already exists: ${resolve(outputPath)}`)
const sha256 = value => createHash('sha256').update(value).digest('hex')
const raw = await readFile(b2c1Path)

const server = await createServer({ configFile: false, server: { middlewareMode: true, watch: null, hmr: false }, appType: 'custom' })
try {
  const targets = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2C2ATargets.ts')
  const search = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2C2A.ts')
  const parsed = targets.parsePhase2C26B2C2AB2C1Authority(JSON.parse(raw.toString('utf8')), sha256(raw))
  if (!parsed.valid) throw new Error(`The B2-C1 RESULT is not the registered authority: ${parsed.issues.join('; ')}`)
  if (exportPath) {
    const exportSha = sha256(await readFile(exportPath))
    if (exportSha !== parsed.authority.exportSha256) throw new Error(`The Export ${exportSha} is not the one B2-C1 recorded (${parsed.authority.exportSha256}).`)
  }
  const manifest = targets.phase2c26b2c2aTargetManifest(parsed.authority)
  // The manifest must be exactly what the Search runner accepts.
  const check = search.parsePhase2C26B2C2ATargetManifest(JSON.parse(JSON.stringify(manifest)))
  if (!check.valid) throw new Error(`The manifest does not parse: ${check.issues.join('; ')}`)
  const text = JSON.stringify(manifest, null, 2) + '\n'
  await writeFile(outputPath, text, { flag: 'wx' })
  console.log(JSON.stringify({ output: resolve(outputPath), sourceResult: basename(b2c1Path), sourceResultSha256: sha256(raw), manifestSha256: sha256(text),
    population: manifest.population, policy: manifest.policy, contextBudget: manifest.contextBudget, targets: manifest.targetWeaponIds.length, exportChecked: Boolean(exportPath) }, null, 2))
} finally {
  await server.close()
}
