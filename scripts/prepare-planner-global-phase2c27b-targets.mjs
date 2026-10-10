// Issue #154 Phase 2-C2.7-B Research only: the E1 population manifest (Target IDs only).
//
// Reads the committed B2-C2B1 RESULT (--b2c2b1-result) and B2-C1 RESULT (--b2c1-result), fails closed unless both are the registered
// formal authorities (parsePhase2C27BPopulationAuthorities(): the unchanged B2-C2B2A parsers plus the registered SHA-256s and one Export),
// re-derives the E1 cohort mechanically (phase2c27bPopulation(): B2-C2B1 E1 = B2-C1 extentInsufficient AND k1Minimal, 11 Targets), and
// writes it as a manifest of Target IDs only (phase2c27bTargetManifest()): no oracle Route, stable key, rank, first-compatible
// context, required extent, ladder rung, expected index or Counter position. The population itself is oracle-guided
// (`oracleGuidedTargetPopulation = true`); the runner reads this manifest, never a RESULT. With --export, the Export SHA-256 must be
// the one both authorities name.
import { readFile, writeFile } from 'node:fs/promises'
import { lstatSync } from 'node:fs'
import { resolve, basename } from 'node:path'
import { createHash } from 'node:crypto'
import { createServer } from 'vite'

const args = process.argv.slice(2)
const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1] }
const b2c2b1Path = option('--b2c2b1-result'), b2c1Path = option('--b2c1-result'), outputPath = option('--output'), exportPath = option('--export')
if (!b2c2b1Path || !b2c1Path || !outputPath) {
  throw new Error('Usage: node scripts/prepare-planner-global-phase2c27b-targets.mjs --b2c2b1-result docs/PLANNER_GLOBAL_PHASE2C26B2C2B1_RESULT.json --b2c1-result docs/PLANNER_GLOBAL_PHASE2C26B2C1_RESULT.json --output .local/PLANNER_GLOBAL_PHASE2C27B_TARGETS.json.local [--export <external.json>]')
}
if (lstatSync(outputPath, { throwIfNoEntry: false }) !== undefined) throw new Error(`Output already exists: ${resolve(outputPath)}`)
const sha256 = value => createHash('sha256').update(value).digest('hex')
const rawB2C2B1 = await readFile(b2c2b1Path)
const rawB2C1 = await readFile(b2c1Path)

const server = await createServer({ configFile: false, server: { middlewareMode: true, watch: null, hmr: false }, appType: 'custom' })
try {
  const targets = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C27BTargets.ts')
  const b = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C27B.ts')
  const parsed = targets.parsePhase2C27BPopulationAuthorities({ b2c2b1Json: JSON.parse(rawB2C2B1.toString('utf8')), b2c2b1Sha256: sha256(rawB2C2B1),
    b2c1Json: JSON.parse(rawB2C1.toString('utf8')), b2c1Sha256: sha256(rawB2C1) })
  if (!parsed.valid) throw new Error(`The population authorities are not the registered ones: ${parsed.issues.join('; ')}`)
  if (exportPath) {
    const exportSha = sha256(await readFile(exportPath))
    if (exportSha !== parsed.authorities.b2c2b1.exportSha256) throw new Error(`The Export ${exportSha} is not the one the population authorities name.`)
  }
  const manifest = targets.phase2c27bTargetManifest(parsed.authorities)
  const check = b.parsePhase2C27BTargetManifest(JSON.parse(JSON.stringify(manifest)))
  if (!check.valid) throw new Error(`The manifest does not parse: ${check.issues.join('; ')}`)
  const text = JSON.stringify(manifest, null, 2) + '\n'
  await writeFile(outputPath, text, { flag: 'wx' })
  console.log(JSON.stringify({ output: resolve(outputPath), b2c2b1Result: basename(b2c2b1Path), b2c2b1ResultSha256: sha256(rawB2C2B1), b2c1ResultSha256: sha256(rawB2C1),
    manifestSha256: sha256(text), population: manifest.population, targets: manifest.targetWeaponIds.length, exportChecked: Boolean(exportPath) }, null, 2))
} finally {
  await server.close()
}
