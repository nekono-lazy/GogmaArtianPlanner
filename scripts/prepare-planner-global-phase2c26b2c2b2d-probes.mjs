// Issue #154 Phase 2-C2.6-B2-C2B2D Research only: the E1 ∩ L2 probe manifest (oracle-guided diagnostic input, declared).
//
// Reads the committed B2-C2B1 RESULT (--b2c2b1-result), B2-C1 RESULT (--b2c1-result), B2-C2B2B RESULT (--b2c2b2b-result) and
// B2-C2B2C RESULT (--b2c2b2c-result), fails closed unless all four are the registered formal results
// (parsePhase2C26B2C2B2AB2C2B1Authority() / parsePhase2C26B2C2AB2C1Authority() / parsePhase2C26B2C2B2CB2C2B2BAuthority() /
// parsePhase2C26B2C2B2DB2C2B2CAuthority()), E1 splits into L1 7 + L2 4 and E1 ∩ L2 is exactly the 4 Targets B2-C2B2C searched
// (phase2c26b2c2b2dPopulation()), and every Target's B2-C1 / B2-C2B1 / B2-C2B2C first compatible ranks agree and its tight extent
// covers its required extent inside the bounds (phase2c26b2c2b2dProbes()); then writes per Target its ID, selected P1 rank and
// tight extent (phase2c26b2c2b2dProbeManifest()) and nothing else: no expected stable key, Candidate index, operation cost, Route
// body or Search result. The Search runner reads this manifest, never a RESULT. With --export, the Export SHA-256 must be the
// one every RESULT recorded.
import { readFile, writeFile } from 'node:fs/promises'
import { lstatSync } from 'node:fs'
import { resolve, basename } from 'node:path'
import { createHash } from 'node:crypto'
import { createServer } from 'vite'

const args = process.argv.slice(2)
const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1] }
const b2c2b1Path = option('--b2c2b1-result'), b2c1Path = option('--b2c1-result'), b2c2b2bPath = option('--b2c2b2b-result'), b2c2b2cPath = option('--b2c2b2c-result')
const outputPath = option('--output'), exportPath = option('--export')
if (!b2c2b1Path || !b2c1Path || !b2c2b2bPath || !b2c2b2cPath || !outputPath) {
  throw new Error('Usage: node scripts/prepare-planner-global-phase2c26b2c2b2d-probes.mjs --b2c2b1-result docs/PLANNER_GLOBAL_PHASE2C26B2C2B1_RESULT.json --b2c1-result docs/PLANNER_GLOBAL_PHASE2C26B2C1_RESULT.json --b2c2b2b-result docs/PLANNER_GLOBAL_PHASE2C26B2C2B2B_RESULT.json --b2c2b2c-result docs/PLANNER_GLOBAL_PHASE2C26B2C2B2C_RESULT.json --output .local/PLANNER_GLOBAL_PHASE2C26B2C2B2D_PROBES.json.local [--export <external.json>]')
}
if (lstatSync(outputPath, { throwIfNoEntry: false }) !== undefined) throw new Error(`Output already exists: ${resolve(outputPath)}`)
const sha256 = value => createHash('sha256').update(value).digest('hex')
const rawB2C2B1 = await readFile(b2c2b1Path)
const rawB2C1 = await readFile(b2c1Path)
const rawB2C2B2B = await readFile(b2c2b2bPath)
const rawB2C2B2C = await readFile(b2c2b2cPath)

const server = await createServer({ configFile: false, server: { middlewareMode: true, watch: null, hmr: false }, appType: 'custom' })
try {
  const targets = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2C2B2DTargets.ts')
  const c2b2cTargets = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2C2B2CTargets.ts')
  const e1Targets = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2C2B2ATargets.ts')
  const c2aTargets = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2C2ATargets.ts')
  const search = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2C2B2D.ts')
  const b2c2b1Json = JSON.parse(rawB2C2B1.toString('utf8'))
  const parsed = e1Targets.parsePhase2C26B2C2B2AB2C2B1Authority(b2c2b1Json, sha256(rawB2C2B1))
  if (!parsed.valid) throw new Error(`The B2-C2B1 RESULT is not the registered authority: ${parsed.issues.join('; ')}`)
  const parsedB2C1 = c2aTargets.parsePhase2C26B2C2AB2C1Authority(JSON.parse(rawB2C1.toString('utf8')), sha256(rawB2C1))
  if (!parsedB2C1.valid) throw new Error(`The B2-C1 RESULT is not the registered authority: ${parsedB2C1.issues.join('; ')}`)
  const parsedB2C2B2B = c2b2cTargets.parsePhase2C26B2C2B2CB2C2B2BAuthority(JSON.parse(rawB2C2B2B.toString('utf8')), sha256(rawB2C2B2B),
    { b2c2b1ResultSha256: sha256(rawB2C2B1), exportSha256: parsed.authority.exportSha256 })
  if (!parsedB2C2B2B.valid) throw new Error(`The B2-C2B2B RESULT is not the registered predecessor: ${parsedB2C2B2B.issues.join('; ')}`)
  const parsedB2C2B2C = targets.parsePhase2C26B2C2B2DB2C2B2CAuthority(JSON.parse(rawB2C2B2C.toString('utf8')), sha256(rawB2C2B2C),
    { b2c2b1ResultSha256: sha256(rawB2C2B1), b2c1ResultSha256: sha256(rawB2C1), b2c2b2bResultSha256: sha256(rawB2C2B2B), exportSha256: parsed.authority.exportSha256 })
  if (!parsedB2C2B2C.valid) throw new Error(`The B2-C2B2C RESULT is not the registered baseline: ${parsedB2C2B2C.issues.join('; ')}`)
  if (exportPath) {
    const exportSha = sha256(await readFile(exportPath))
    if (exportSha !== parsed.authority.exportSha256 || exportSha !== parsedB2C1.authority.exportSha256 || exportSha !== parsedB2C2B2B.authority.exportSha256 || exportSha !== parsedB2C2B2C.authority.exportSha256) {
      throw new Error(`The Export ${exportSha} is not the one B2-C2B1 / B2-C1 / B2-C2B2B / B2-C2B2C recorded.`)
    }
  }
  const derived = targets.phase2c26b2c2b2dProbes(parsed.authority, parsedB2C1.authority, b2c2b1Json, parsedB2C2B2B.authority, parsedB2C2B2C.authority)
  if (!derived.valid) throw new Error(`The B2-C2B2D probes are not valid: ${derived.issues.join('; ')}`)
  const manifest = targets.phase2c26b2c2b2dProbeManifest(parsed.authority, parsedB2C1.authority, b2c2b1Json, parsedB2C2B2B.authority, parsedB2C2B2C.authority)
  // The manifest must be exactly what the Search runner accepts.
  const check = search.parsePhase2C26B2C2B2DProbeManifest(JSON.parse(JSON.stringify(manifest)))
  if (!check.valid) throw new Error(`The manifest does not parse: ${check.issues.join('; ')}`)
  const text = JSON.stringify(manifest, null, 2) + '\n'
  await writeFile(outputPath, text, { flag: 'wx' })
  console.log(JSON.stringify({ output: resolve(outputPath), sourceResult: basename(b2c2b1Path), sourceResultSha256: sha256(rawB2C2B1), b2c1ResultSha256: sha256(rawB2C1),
    b2c2b2bResultSha256: sha256(rawB2C2B2B), b2c2b2cResultSha256: sha256(rawB2C2B2C), manifestSha256: sha256(text), population: manifest.population, policy: manifest.policy,
    contextSelection: manifest.contextSelection, extentRule: manifest.extentRule,
    split: { e1: derived.population.split.e1.length, l1: derived.population.split.l1.length, l2: derived.population.split.l2.length, overlap: derived.population.split.overlap, union: derived.population.split.union },
    probes: derived.derivations.map(d => ({ t: d.targetWeaponId.slice(0, 8), rank: d.b2c1FirstCompatibleRank, required: d.required, tight: d.tightExtent, smaller: d.strictlySmallerStreams })),
    exportChecked: Boolean(exportPath) }, null, 2))
} finally {
  await server.close()
}
