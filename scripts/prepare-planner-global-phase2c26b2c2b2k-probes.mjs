// Issue #154 Phase 2-C2.6-B2-C2B2K Research only: the probe manifest of the B2-C2B2E time-bound Target that timed out unrecovered
// (oracle-guided diagnostic input, declared).
//
// Reads the committed B2-C2B2E RESULT (--b2c2b2e-result), B2-C2B2I RESULT (--b2c2b2i-result) and B2-C2B2J RESULT (--b2c2b2j-result),
// fails closed unless each is the registered formal result (parsePhase2C26B2C2B2KB2C2B2EAuthority() / parsePhase2C26B2C2B2KB2C2B2IAuthority()
// / parsePhase2C26B2C2B2KB2C2B2JAuthority()), the population is exactly the one B2-C2B2E Target with process timeout, recovery none and
// next-branch type time_bound, and its probe, Search input identity and excluded current Route equal the ones B2-C2B2I and B2-C2B2J
// searched (phase2c26b2c2b2kPopulation()); then writes the probe, the expected Search input identity and the authority SHA-256s
// (phase2c26b2c2b2kProbeManifest()) and nothing else: no expected stable key, Candidate index, operation cost, Route kind, Route body,
// Search result or B2-C2B2E / B2-C2B2I / B2-C2B2J measurement. The Search child reads this manifest's task only, never a RESULT. With
// --export, the Export SHA-256 must be the one every RESULT recorded.
import { readFile, writeFile } from 'node:fs/promises'
import { lstatSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { createServer } from 'vite'

const args = process.argv.slice(2)
const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1] }
const paths = { e: option('--b2c2b2e-result'), i: option('--b2c2b2i-result'), j: option('--b2c2b2j-result'), output: option('--output') }
const exportPath = option('--export')
if (Object.values(paths).some(value => !value)) {
  throw new Error('Usage: node scripts/prepare-planner-global-phase2c26b2c2b2k-probes.mjs --b2c2b2e-result docs/PLANNER_GLOBAL_PHASE2C26B2C2B2E_RESULT.json --b2c2b2i-result docs/PLANNER_GLOBAL_PHASE2C26B2C2B2I_RESULT.json --b2c2b2j-result docs/PLANNER_GLOBAL_PHASE2C26B2C2B2J_RESULT.json --output .local/PLANNER_GLOBAL_PHASE2C26B2C2B2K_PROBES.json.local [--export <external.json>]')
}
if (lstatSync(paths.output, { throwIfNoEntry: false }) !== undefined) throw new Error(`Output already exists: ${resolve(paths.output)}`)
const sha256 = value => createHash('sha256').update(value).digest('hex')
const raw = Object.fromEntries(await Promise.all(['e', 'i', 'j'].map(async key => [key, await readFile(paths[key])])))
const json = key => JSON.parse(raw[key].toString('utf8'))

const server = await createServer({ configFile: false, server: { middlewareMode: true, watch: null, hmr: false }, appType: 'custom' })
try {
  const targets = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2C2B2KTargets.ts')
  const search = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2C2B2K.ts')
  const e = targets.parsePhase2C26B2C2B2KB2C2B2EAuthority(json('e'), sha256(raw.e))
  if (!e.valid) throw new Error(`The B2-C2B2E RESULT is not the registered before authority: ${e.issues.join('; ')}`)
  const i = targets.parsePhase2C26B2C2B2KB2C2B2IAuthority(json('i'), sha256(raw.i))
  if (!i.valid) throw new Error(`The B2-C2B2I RESULT is not the registered authority: ${i.issues.join('; ')}`)
  const j = targets.parsePhase2C26B2C2B2KB2C2B2JAuthority(json('j'), sha256(raw.j))
  if (!j.valid) throw new Error(`The B2-C2B2J RESULT is not the registered authority: ${j.issues.join('; ')}`)
  if (exportPath) {
    const exportSha = sha256(await readFile(exportPath))
    if ([e.authority.exportSha256, i.authority.exportSha256, j.authority.exportSha256].some(value => value !== exportSha)) throw new Error(`The Export ${exportSha} is not the one every RESULT recorded.`)
  }
  const derived = targets.phase2c26b2c2b2kPopulation(e, i.authority, j.authority)
  if (!derived.valid) throw new Error(`The B2-C2B2K population is not valid: ${derived.issues.join('; ')}`)
  const manifest = targets.phase2c26b2c2b2kProbeManifest(e, i.authority, j.authority)
  // The manifest must be exactly what the Search runner accepts.
  const check = search.parsePhase2C26B2C2B2KProbeManifest(JSON.parse(JSON.stringify(manifest)))
  if (!check.valid) throw new Error(`The manifest does not parse: ${check.issues.join('; ')}`)
  const text = JSON.stringify(manifest, null, 2) + '\n'
  await writeFile(paths.output, text, { flag: 'wx' })
  console.log(JSON.stringify({ output: resolve(paths.output), shas: { e: sha256(raw.e), i: sha256(raw.i), j: sha256(raw.j) }, manifestSha256: sha256(text), population: manifest.population,
    chain: derived.chain, probes: manifest.probes.map(p => ({ t: p.targetWeaponId.slice(0, 8), task: p.b2c2b2dTaskId, rank: p.contextRank, tight: p.extent })),
    adopted: targets.phase2c26b2c2b2kAdoptedOptimizations(i.authority, j.authority).map(o => ({ phase: o.phase, id: o.id, files: o.files, measuredHead: o.measuredHead })),
    exportChecked: Boolean(exportPath) }, null, 2))
} finally {
  await server.close()
}
