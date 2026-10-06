// Issue #154 Phase 2-C2.6-B2-C2B2J Research only: the probe manifest of the B2-C2B2I adopted profiled Target.
//
// Reads the committed B2-C2B2I RESULT (--b2c2b2i-result, the formal before authority), B2-C2B2H RESULT (--b2c2b2h-result),
// B2-C2B2G RESULT (--b2c2b2g-result), B2-C2B2F RESULT (--b2c2b2f-result) and B2-C2B2E RESULT (--b2c2b2e-result), fails closed unless
// each is the registered formal result (parsePhase2C26B2C2B2JB2C2B2IAuthority() / parsePhase2C26B2C2B2IB2C2B2HAuthority() /
// parsePhase2C26B2C2B2HB2C2B2GAuthority() / parsePhase2C26B2C2B2GB2C2B2FAuthority() / parsePhase2C26B2C2B2FB2C2B2EAuthority()),
// derives the population mechanically (the Target B2-C2B2I searched with decision B2C2B2I_ADOPTED: exactly one,
// phase2c26b2c2b2jPopulation()) and cross-checks its probe, expected identity and excluded Route against the ones B2-C2B2I's own
// derivation re-derives from the B2-C2B2H / G / F / E RESULTs; then writes the probe (Target ID, B2-C2B2E task ID, P1 rank, tight
// extent) and the expected Search input identity (phase2c26b2c2b2jProbeManifest()) and nothing else: no expected stable key, Candidate
// index, operation cost, Route body, Search result, hotspot, section, sample category or earlier measurement. The Search runner reads
// this manifest, never a RESULT. With --export, the Export SHA-256 must be the one the RESULTs recorded.
import { readFile, writeFile } from 'node:fs/promises'
import { lstatSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { createServer } from 'vite'

const args = process.argv.slice(2)
const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1] }
const paths = { b2c2b2i: option('--b2c2b2i-result'), b2c2b2h: option('--b2c2b2h-result'), b2c2b2g: option('--b2c2b2g-result'), b2c2b2f: option('--b2c2b2f-result'),
  b2c2b2e: option('--b2c2b2e-result'), output: option('--output') }
const exportPath = option('--export')
if (Object.values(paths).some(value => !value)) {
  throw new Error('Usage: node scripts/prepare-planner-global-phase2c26b2c2b2j-probes.mjs --b2c2b2i-result docs/PLANNER_GLOBAL_PHASE2C26B2C2B2I_RESULT.json --b2c2b2h-result docs/PLANNER_GLOBAL_PHASE2C26B2C2B2H_RESULT.json --b2c2b2g-result docs/PLANNER_GLOBAL_PHASE2C26B2C2B2G_RESULT.json --b2c2b2f-result docs/PLANNER_GLOBAL_PHASE2C26B2C2B2F_RESULT.json --b2c2b2e-result docs/PLANNER_GLOBAL_PHASE2C26B2C2B2E_RESULT.json --output .local/PLANNER_GLOBAL_PHASE2C26B2C2B2J_PROBES.json.local [--export <external.json>]')
}
if (lstatSync(paths.output, { throwIfNoEntry: false }) !== undefined) throw new Error(`Output already exists: ${resolve(paths.output)}`)
const sha256 = value => createHash('sha256').update(value).digest('hex')
const [rawI, rawH, rawG, rawF, rawE] = await Promise.all([paths.b2c2b2i, paths.b2c2b2h, paths.b2c2b2g, paths.b2c2b2f, paths.b2c2b2e].map(path => readFile(path)))

const server = await createServer({ configFile: false, server: { middlewareMode: true, watch: null, hmr: false }, appType: 'custom' })
try {
  const targets = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2C2B2JTargets.ts')
  const iTargets = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2C2B2ITargets.ts')
  const hTargets = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2C2B2HTargets.ts')
  const gTargets = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2C2B2GTargets.ts')
  const fTargets = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2C2B2FTargets.ts')
  const search = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2C2B2J.ts')
  const parsedI = targets.parsePhase2C26B2C2B2JB2C2B2IAuthority(JSON.parse(rawI.toString('utf8')), sha256(rawI))
  if (!parsedI.valid) throw new Error(`The B2-C2B2I RESULT is not the registered authority: ${parsedI.issues.join('; ')}`)
  const parsedH = iTargets.parsePhase2C26B2C2B2IB2C2B2HAuthority(JSON.parse(rawH.toString('utf8')), sha256(rawH))
  if (!parsedH.valid) throw new Error(`The B2-C2B2H RESULT is not the registered authority: ${parsedH.issues.join('; ')}`)
  const parsedG = hTargets.parsePhase2C26B2C2B2HB2C2B2GAuthority(JSON.parse(rawG.toString('utf8')), sha256(rawG))
  if (!parsedG.valid) throw new Error(`The B2-C2B2G RESULT is not the registered authority: ${parsedG.issues.join('; ')}`)
  const parsedF = gTargets.parsePhase2C26B2C2B2GB2C2B2FAuthority(JSON.parse(rawF.toString('utf8')), sha256(rawF))
  if (!parsedF.valid) throw new Error(`The B2-C2B2F RESULT is not the registered authority: ${parsedF.issues.join('; ')}`)
  const parsedE = fTargets.parsePhase2C26B2C2B2FB2C2B2EAuthority(JSON.parse(rawE.toString('utf8')), sha256(rawE))
  if (!parsedE.valid) throw new Error(`The B2-C2B2E RESULT is not the registered authority: ${parsedE.issues.join('; ')}`)
  if (exportPath && sha256(await readFile(exportPath)) !== parsedI.authority.exportSha256) throw new Error('The Export is not the one the B2-C2B2I RESULT recorded.')
  const derived = targets.phase2c26b2c2b2jPopulation(parsedI.authority, parsedH.authority, parsedG.authority, parsedF.authority, parsedE.authority)
  if (!derived.valid) throw new Error(`The B2-C2B2J population is not valid: ${derived.issues.join('; ')}`)
  const manifest = targets.phase2c26b2c2b2jProbeManifest(parsedI.authority, parsedH.authority, parsedG.authority, parsedF.authority, parsedE.authority)
  const check = search.parsePhase2C26B2C2B2JProbeManifest(JSON.parse(JSON.stringify(manifest)))
  if (!check.valid) throw new Error(`The manifest does not parse: ${check.issues.join('; ')}`)
  const text = JSON.stringify(manifest, null, 2) + '\n'
  await writeFile(paths.output, text, { flag: 'wx' })
  console.log(JSON.stringify({ output: resolve(paths.output), b2c2b2iResultSha256: sha256(rawI), b2c2b2hResultSha256: sha256(rawH), b2c2b2gResultSha256: sha256(rawG),
    b2c2b2fResultSha256: sha256(rawF), b2c2b2eResultSha256: sha256(rawE), manifestSha256: sha256(text), population: manifest.population, targets: derived.targetWeaponIds.length,
    chain: derived.chain, probes: manifest.probes.map(p => ({ t: p.targetWeaponId.slice(0, 8), task: p.b2c2b2dTaskId, rank: p.contextRank, extent: p.extent })),
    exportChecked: Boolean(exportPath) }, null, 2))
} finally {
  await server.close()
}
