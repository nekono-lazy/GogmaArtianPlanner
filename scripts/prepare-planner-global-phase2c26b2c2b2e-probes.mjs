// Issue #154 Phase 2-C2.6-B2-C2B2E Research only: the probe manifest of the B2-C2B2D unmeasured unrecovered Targets
// (oracle-guided diagnostic input, declared).
//
// Reads the committed B2-C2B1 RESULT (--b2c2b1-result), B2-C1 RESULT (--b2c1-result), B2-B1 RESULT (--b2b1-result), B2-C2B2B
// RESULT (--b2c2b2b-result), B2-C2B2C RESULT (--b2c2b2c-result) and B2-C2B2D RESULT (--b2c2b2d-result), fails closed unless every
// one is the registered formal result (parsePhase2C26B2C2B2AB2C2B1Authority() / parsePhase2C26B2C2AB2C1Authority() /
// parsePhase2C26B2C2B2CB2C2B2BAuthority() / parsePhase2C26B2C2B2DB2C2B2CAuthority() / parsePhase2C26B2C2B2EB2C2B2DAuthority()),
// the population is exactly the B2-C2B2D Targets with recovery none and a timeout / out-of-memory task (2, with 2 recovered,
// phase2c26b2c2b2ePopulation()), and B2-C2B2D's own probe derivation re-run over the authorities reproduces the B2-C2B2D RESULT's
// probes and each population Target's rank / tight extent / task ID (phase2c26b2c2b2eProbes()); then writes per Target its ID,
// B2-C2B2D task ID, selected P1 rank and tight extent (phase2c26b2c2b2eProbeManifest()) and nothing else: no expected stable key,
// Candidate index, operation cost, Route body, Search result or B2-C2B2D measurement. The Search runner reads this manifest, never
// a RESULT. With --export, the Export SHA-256 must be the one every RESULT recorded.
import { readFile, writeFile } from 'node:fs/promises'
import { lstatSync } from 'node:fs'
import { resolve, basename } from 'node:path'
import { createHash } from 'node:crypto'
import { createServer } from 'vite'

const args = process.argv.slice(2)
const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1] }
const paths = { b2c2b1: option('--b2c2b1-result'), b2c1: option('--b2c1-result'), b2b1: option('--b2b1-result'), b2c2b2b: option('--b2c2b2b-result'), b2c2b2c: option('--b2c2b2c-result'),
  b2c2b2d: option('--b2c2b2d-result'), output: option('--output') }
const exportPath = option('--export')
if (Object.values(paths).some(value => !value)) {
  throw new Error('Usage: node scripts/prepare-planner-global-phase2c26b2c2b2e-probes.mjs --b2c2b1-result docs/PLANNER_GLOBAL_PHASE2C26B2C2B1_RESULT.json --b2c1-result docs/PLANNER_GLOBAL_PHASE2C26B2C1_RESULT.json --b2b1-result docs/PLANNER_GLOBAL_PHASE2C26B2B1_RESULT.json --b2c2b2b-result docs/PLANNER_GLOBAL_PHASE2C26B2C2B2B_RESULT.json --b2c2b2c-result docs/PLANNER_GLOBAL_PHASE2C26B2C2B2C_RESULT.json --b2c2b2d-result docs/PLANNER_GLOBAL_PHASE2C26B2C2B2D_RESULT.json --output .local/PLANNER_GLOBAL_PHASE2C26B2C2B2E_PROBES.json.local [--export <external.json>]')
}
if (lstatSync(paths.output, { throwIfNoEntry: false }) !== undefined) throw new Error(`Output already exists: ${resolve(paths.output)}`)
const sha256 = value => createHash('sha256').update(value).digest('hex')
const raw = Object.fromEntries(await Promise.all(['b2c2b1', 'b2c1', 'b2b1', 'b2c2b2b', 'b2c2b2c', 'b2c2b2d'].map(async key => [key, await readFile(paths[key])])))
const shaOf = Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, sha256(value)]))
const json = key => JSON.parse(raw[key].toString('utf8'))

const server = await createServer({ configFile: false, server: { middlewareMode: true, watch: null, hmr: false }, appType: 'custom' })
try {
  const targets = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2C2B2ETargets.ts')
  const d2Targets = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2C2B2DTargets.ts')
  const c2b2cTargets = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2C2B2CTargets.ts')
  const e1Targets = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2C2B2ATargets.ts')
  const c2aTargets = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2C2ATargets.ts')
  const search = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2C2B2E.ts')
  const b2c2b1Json = json('b2c2b1')
  const parsed = e1Targets.parsePhase2C26B2C2B2AB2C2B1Authority(b2c2b1Json, shaOf.b2c2b1)
  if (!parsed.valid) throw new Error(`The B2-C2B1 RESULT is not the registered authority: ${parsed.issues.join('; ')}`)
  const exportSha256 = parsed.authority.exportSha256
  const parsedB2C1 = c2aTargets.parsePhase2C26B2C2AB2C1Authority(json('b2c1'), shaOf.b2c1)
  if (!parsedB2C1.valid) throw new Error(`The B2-C1 RESULT is not the registered authority: ${parsedB2C1.issues.join('; ')}`)
  if (shaOf.b2b1 !== parsed.authority.b2b1ResultSha256) throw new Error('The B2-B1 RESULT is not the one B2-C2B1 recorded.')
  const parsedB2C2B2B = c2b2cTargets.parsePhase2C26B2C2B2CB2C2B2BAuthority(json('b2c2b2b'), shaOf.b2c2b2b, { b2c2b1ResultSha256: shaOf.b2c2b1, exportSha256 })
  if (!parsedB2C2B2B.valid) throw new Error(`The B2-C2B2B RESULT is not the registered predecessor: ${parsedB2C2B2B.issues.join('; ')}`)
  const parsedB2C2B2C = d2Targets.parsePhase2C26B2C2B2DB2C2B2CAuthority(json('b2c2b2c'), shaOf.b2c2b2c,
    { b2c2b1ResultSha256: shaOf.b2c2b1, b2c1ResultSha256: shaOf.b2c1, b2c2b2bResultSha256: shaOf.b2c2b2b, exportSha256 })
  if (!parsedB2C2B2C.valid) throw new Error(`The B2-C2B2C RESULT is not the registered authority: ${parsedB2C2B2C.issues.join('; ')}`)
  const parsedB2C2B2D = targets.parsePhase2C26B2C2B2EB2C2B2DAuthority(json('b2c2b2d'), shaOf.b2c2b2d, { b2c2b1ResultSha256: shaOf.b2c2b1, b2c1ResultSha256: shaOf.b2c1,
    b2b1ResultSha256: shaOf.b2b1, b2c2b2bResultSha256: shaOf.b2c2b2b, b2c2b2cResultSha256: shaOf.b2c2b2c, exportSha256 })
  if (!parsedB2C2B2D.valid) throw new Error(`The B2-C2B2D RESULT is not the registered baseline: ${parsedB2C2B2D.issues.join('; ')}`)
  if (exportPath) {
    const exportSha = sha256(await readFile(exportPath))
    if ([parsed, parsedB2C1, parsedB2C2B2B, parsedB2C2B2C, parsedB2C2B2D].some(p => p.authority.exportSha256 !== exportSha)) throw new Error(`The Export ${exportSha} is not the one every RESULT recorded.`)
  }
  const derived = targets.phase2c26b2c2b2eProbes(parsed.authority, parsedB2C1.authority, b2c2b1Json, parsedB2C2B2B.authority, parsedB2C2B2C.authority, parsedB2C2B2D.authority)
  if (!derived.valid) throw new Error(`The B2-C2B2E probes are not valid: ${derived.issues.join('; ')}`)
  const manifest = targets.phase2c26b2c2b2eProbeManifest(parsed.authority, parsedB2C1.authority, b2c2b1Json, parsedB2C2B2B.authority, parsedB2C2B2C.authority, parsedB2C2B2D.authority)
  // The manifest must be exactly what the Search runner accepts.
  const check = search.parsePhase2C26B2C2B2EProbeManifest(JSON.parse(JSON.stringify(manifest)))
  if (!check.valid) throw new Error(`The manifest does not parse: ${check.issues.join('; ')}`)
  const text = JSON.stringify(manifest, null, 2) + '\n'
  await writeFile(paths.output, text, { flag: 'wx' })
  console.log(JSON.stringify({ output: resolve(paths.output), sourceResult: basename(paths.b2c2b1), shas: shaOf, manifestSha256: sha256(text), population: manifest.population,
    previouslyUnrecovered: derived.population.previouslyUnrecovered.length, previouslyRecovered: derived.population.previouslyRecovered.length,
    probes: derived.derivations.map(d => ({ t: d.targetWeaponId.slice(0, 8), task: d.b2c2b2dTaskId, rank: d.b2c1FirstCompatibleRank, tight: d.tightExtent, b2c2b2d: d.b2c2b2dProcess, b2c2b2c: d.b2c2b2cSameContextProcess })),
    exportChecked: Boolean(exportPath) }, null, 2))
} finally {
  await server.close()
}
