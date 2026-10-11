// Issue #154 D2-G-A Research only (non-formal): summarizes the diagnostic run against the formal D2-E / D2-F evidence
// (docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_D2GA.md). Read-only: it reads the diagnostic output and run dir, the formal discovery
// records / memory series of .local/d2e-k2-formal2.run and .local/d2f-k3-formal.run, and the D2-F RESULT; it writes one new
// analysis file under .local and prints Markdown tables. Nothing it reads is modified.
import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { createServer } from 'vite'

const args = process.argv.slice(2)
const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1] }
const diagPath = option('--diag'), runDir = option('--run-dir'), outputPath = option('--output')
if (!diagPath || !runDir || !outputPath) throw new Error('Usage: node scripts/analyze-planner-global-d2ga.mjs --diag <diag .json.local> --run-dir <diag run dir> --output <new .json.local>')
const server = await createServer({ configFile: false, server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom' })
const d2ga = await server.ssrLoadModule('/src/benchmarks/plannerGlobalD2GA.ts')
await server.close()
const json = async path => JSON.parse((await readFile(path)).toString('utf8'))
const jsonl = async path => (await readFile(path)).toString('utf8').trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line))
const GB = 2 ** 30
const gb = bytes => bytes === null || bytes === undefined ? null : +(bytes / GB).toFixed(2)
const ratio = (a, b) => a === null || b === null || b === 0 ? null : +(a / b).toFixed(2)

const diag = await json(diagPath)
const units = {}
for (const entry of diag.units) {
  const record = entry.recordFile ? await json(join(runDir, entry.recordFile)) : null
  const r = record?.result ?? null
  const obs = r?.observation ?? null
  const majors = record?.gc?.major ?? []
  const runtime = obs?.runtime?.byTarget?.[0] ?? null
  const topExclusive = runtime ? Object.entries(runtime.exclusiveMs).filter(([, ms]) => ms > 0).sort(([, a], [, b]) => b - a).slice(0, 8)
    .map(([section, ms]) => ({ section, exclusiveS: +(ms / 1000).toFixed(1), count: runtime.sectionCounts[section] })) : []
  units[entry.unitId] = {
    outcome: entry.outcome, processWallS: +(entry.wallMs / 1000).toFixed(1), status: r?.status ?? null, search: r?.search ?? null,
    searchVisitS: r?.timing ? +(r.timing.searchVisitMs / 1000).toFixed(1) : null, structure: r?.structure ?? null,
    heapPeakGb: gb(record?.memory?.maxima?.heapUsed), heapTotalPeakGb: gb(record?.memory?.maxima?.heapTotal), rssPeakGb: gb(record?.memory?.maxima?.rss),
    postMajorGc: { count: majors.length + (record?.gc?.majorDropped ?? 0), maxHeapUsedGb: gb(record?.gc?.maxPostMajorHeapUsed), lastHeapUsedGb: gb(majors.at(-1)?.heapUsedAfter),
      totalMajorS: +(majors.reduce((s, m) => s + m.durationMs, 0) / 1000).toFixed(1) },
    gcByKind: record?.gc?.byKind ?? null, endOfSearchHeapGb: gb(record?.memory?.endOfSearch?.heapUsed), checkpointsApprox: record?.checkpointsApprox ?? null,
    probe: obs?.probe ?? null, skillStreamsTop: (obs?.skillStreams ?? []).slice().sort((a, b) => b.retainedStates - a.retainedStates).slice(0, 5),
    gogmaStreams: obs?.gogmaStreams ?? [], topExclusive, contractViolations: obs?.runtime?.contractViolations ?? null,
    series: (record?.memory?.series ?? []).map(p => ({ s: +(p.atMs / 1000).toFixed(1), heapGb: gb(p.heapUsed), rssGb: gb(p.rss), postMajorGb: gb(p.postMajorHeapUsed), settled: p.settledWork })),
  }
}

// Formal reference (read-only): discovery records and memory series.
const formal = {}
for (const context of ['K2', 'K3']) {
  const source = d2ga.D2GA_FORMAL_SOURCES[context]
  for (const rung of ['L0', 'L1', 'L2']) {
    const id = `${context}-${rung}`
    const recordPath = join(source.runDir, source.record(rung)), memoryPath = join(source.runDir, source.memory(rung))
    const record = existsSync(recordPath) ? await json(recordPath) : null
    const rows = existsSync(memoryPath) ? await jsonl(memoryPath) : []
    formal[id] = { reference: d2ga.D2GA_FORMAL_REFERENCE[id], recordWallS: record ? +(record.wallMs / 1000).toFixed(1) : null, yields: record?.yields ?? rows.at(-1)?.yields ?? null,
      heapPeakGb: gb(record?.memory?.sampledMaxHeapUsedBytes ?? rows.at(-1)?.maxima?.maxHeapUsedBytes), search: record?.result?.search ?? null,
      segments: d2ga.d2gaFormalSegments(rows, rung === 'L2' ? [0, 60, 120, 240, 360, 480, 600, 900, 1200, 1500, 1800, 2100, 2400] : [0, 30, 60, 120, 180, 240]) }
  }
}
const k3l2 = (await jsonl('.local/d2f-k3-formal.run/discovery.jsonl')).find(r => r.unitId === 'DSC-K3-L2') ?? null
const lastGcs = k3l2?.process?.stderrTail?.match(/\d+ ms: (?:Scavenge|Mark-Compact)[^\r\n]*/g) ?? []

const compare = (rung) => {
  const a = units[`K2-${rung}`], b = units[`K3-${rung}`]
  if (!a || !b) return null
  return {
    rung, processWall: ratio(b.processWallS, a.processWallS), searchVisit: ratio(b.searchVisitS, a.searchVisitS), heapPeak: ratio(b.heapPeakGb, a.heapPeakGb),
    postMajorMax: ratio(b.postMajorGc.maxHeapUsedGb, a.postMajorGc.maxHeapUsedGb), rssPeak: ratio(b.rssPeakGb, a.rssPeakGb),
    settledWork: ratio(b.probe?.settledWork ?? null, a.probe?.settledWork ?? null), checkpoints: ratio(b.checkpointsApprox, a.checkpointsApprox),
    skillRetainedStates: ratio(b.probe?.skill.retainedStates ?? null, a.probe?.skill.retainedStates ?? null),
    gogmaGeneratedStates: ratio(b.probe?.gogma.generatedStates ?? null, a.probe?.gogma.generatedStates ?? null),
    formalWall: ratio(formal[`K3-${rung}`].reference.childWallS, formal[`K2-${rung}`].reference.childWallS),
    formalHeap: ratio(formal[`K3-${rung}`].reference.heapPeakGb, formal[`K2-${rung}`].reference.heapPeakGb),
  }
}
const analysis = { phase: d2ga.D2GA_PHASE, formal: false, diag: { status: diag.status, head: diag.repositoryHead, clean: diag.workingTreeClean, docSha256: diag.docSha256 },
  units, formal, comparisons: ['L0', 'L1'].map(compare), k3l2: { process: k3l2?.process ? { ...k3l2.process, stderrTail: undefined } : null, lastGcs } }
await writeFile(outputPath, JSON.stringify(analysis, null, 2) + '\n', { flag: 'wx' })

const table = (head, rows) => [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...rows.map(r => `| ${r.join(' | ')} |`)].join('\n')
const ids = d2ga.D2GA_PROTOCOL.units.map(u => u.id)
console.log(table(['unit', 'outcome', 'status', 'delivered', 'stoppedByExtent', 'process wall s', 'search s', 'heap peak GB', 'post-major max GB', 'RSS peak GB', 'end-of-search heap GB'],
  ids.map(id => { const u = units[id]; return u ? [id, u.outcome, u.status, u.search?.deliveredCandidates, u.search?.stoppedByExtent, u.processWallS, u.searchVisitS, u.heapPeakGb, u.postMajorGc.maxHeapUsedGb, u.rssPeakGb, u.endOfSearchHeapGb] : [id, '-'] })))
console.log()
console.log(table(['unit', 'settled', 'checkpoints', 'skill streams', 'skill depth reads', 'skill retained states', 'skill transitions', 'gogma streams', 'gogma depth reads', 'gogma generated', 'gogma live frontier', 'compositions', 'bonus ch', 'skill ch', 'Ideal bonus kept', 'Ideal skill kept', 'skill subs'],
  ids.map(id => { const p = units[id]?.probe; return p ? [id, p.settledWork, units[id].checkpointsApprox, p.skill.streams, p.skill.depthReads, p.skill.retainedStates, p.skill.transitions, p.gogma.streams, p.gogma.depthReads, p.gogma.generatedStates, p.gogma.liveFrontierStates, p.sections.compositionWork, p.channels.bonus, p.channels.skill, p.channels.retainedIdealBonus, p.channels.retainedIdealSkill, p.channels.skillSubscriptions] : [id, '-'] })))
console.log()
console.log(JSON.stringify(analysis.comparisons, null, 1))
for (const id of ids) console.log(id, JSON.stringify(units[id]?.topExclusive ?? []))
console.log('K3-L2 last GCs', JSON.stringify(lastGcs))
for (const id of ['K2-L2', 'K3-L2']) console.log(id, JSON.stringify(formal[id].segments.map(s => ({ to: Math.round(s.toS), heap: +s.heapMaxToGb.toFixed(2), yps: Math.round(s.yieldsPerS), gbPerMy: s.heapGrowthGbPerMillionYields === null ? null : +s.heapGrowthGbPerMillionYields.toFixed(2) }))))
