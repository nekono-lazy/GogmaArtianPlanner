/**
 * Issue #154 Phase 2-C2.6-A10: post-hoc analysis of one raw whole-orientation-set kernel run against the committed Phase
 * 2-C2.6-A RESULT, Research only. Never import from Production.
 *
 * Nothing here runs a Planner or a Search. The analyzer (scripts/analyze-planner-global-phase2c26a10.mjs) passes the raw
 * run, the C2.6-A RESULT (the "before") and the A9 RESULT (authority chain only). Every expected count (orientations,
 * old timeouts, participants) is derived from the C2.6-A RESULT and the run's own baseline; nothing fixes an ID or a count.
 *
 * The before / after is "C2.6-A measured Production -> current Production" as a whole (A6, A9 and every other change in
 * between). It never attributes a transition to A9 alone; A9's own effect is the A9 RESULT's local comparison.
 */
import { stableStringify } from '../domain/models/publicTypes'
import type { Phase2C2BaselineSummary, Phase2C2ChildOutcome, Phase2C2Conditions, Phase2C2Orientation } from './plannerGlobalPhase2C2'
import { PHASE2C26A_CHILD_STATUSES } from './plannerGlobalPhase2C26A'
import {
  comparePhase2C26AOldCompletedSemantics,
  compactPhase2C26AKernel,
  phase2c26aChildMemory,
  phase2c26aParticipantCoverage,
  summarizePhase2C26AKernels,
  validatePhase2C26AFormalRun,
  validatePhase2C26AOldC2Comparability,
  type Phase2C26AFormalExpectations,
  type Phase2C26AOldC2View,
  type Phase2C26AOldOrientationRow,
  type Phase2C26ARawKernel,
} from './plannerGlobalPhase2C26AAnalysis'
import {
  parsePhase2C26AAuthority,
  validatePhase2C26A2BaselineParity,
  validatePhase2C26A2ConditionParity,
  type Phase2C26A2Authority,
  type Phase2C26A2RunConditions,
} from './plannerGlobalPhase2C26A2'
import { PHASE2C26A10_A9_CHAIN_KEYS, PHASE2C26A10_NODE_FLAGS, PHASE2C26A10_NODE_YIELD, PHASE2C26A10_MEMORY_SAMPLE_INTERVAL_MS, PHASE2C26A10_NOT_ATTACHED } from './plannerGlobalPhase2C26A10'

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null)
const same = (a: unknown, b: unknown) => {
  try { return stableStringify(a ?? null) === stableStringify(b ?? null) } catch { return false }
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

// ---------------------------------------------------------------- the committed Phase 2-C2.6-A RESULT as the "before"

/** The extended (deterministic) parts of one C2.6-A Target result that the core comparison does not read. */
export interface Phase2C26A10BeforeTargetExtended {
  targetWeaponId: string
  search: unknown
  found: null | { stableKeySha256: string; generatedSelected: unknown; trialPlan: unknown; summary: unknown }
  skippedExcludedRouteKeys: unknown
}

export interface Phase2C26A10BeforeRow extends Phase2C26AOldOrientationRow {
  childWallMs: number | null
  lastIpcYields: number | null
  memory: { source: string | null; sampledMaxHeapUsedBytes: number | null; sampledMaxRssBytes: number | null; maxRssKiB: number | null }
  extendedTargets: Phase2C26A10BeforeTargetExtended[]
}

export interface Phase2C26A10Before {
  authority: Phase2C26A2Authority
  /** The C2.6-A RESULT in the shape the unchanged C2.6-A comparison helpers read (`rows` = C2.6-A's own rows). */
  view: Omit<Phase2C26AOldC2View, 'rows'> & { rows: Map<string, Phase2C26A10BeforeRow> }
  timeoutOrientationIds: string[]
  completedOrientationIds: string[]
  preparationFailedOrientationIds: string[]
  childStatus: Record<string, number>
  participants: { participantsTotal: number | null; participantsSearched: number | null; participantsNotSearched: string[] }
  kernel: { targetOutcomes: Record<string, number>; trials: unknown; plannerRerunsUsed: unknown; wallMs: unknown; memory: unknown }
}

export interface Phase2C26A10BeforeParse { valid: boolean; issues: string[]; before: Phase2C26A10Before | null }

/**
 * Reads the committed C2.6-A RESULT as the before authority: the unchanged `parsePhase2C26AAuthority()` (formal, the
 * registered counts and case, rows covering the orientations exactly once) first, then every completed row's kernel
 * judgement. A completed row without a well-formed kernel record, or a non-completed row with one, fails closed.
 */
export function parsePhase2C26A10Before(json: unknown): Phase2C26A10BeforeParse {
  const parsed = parsePhase2C26AAuthority(json)
  if (!parsed.valid || parsed.authority === null) return { valid: false, issues: parsed.issues, before: null }
  const authority = parsed.authority
  const root = json as Json
  const issues: string[] = []
  const rows = new Map<string, Phase2C26A10BeforeRow>()
  for (const raw of asArray(root.perOrientation)) {
    const row = raw as Json
    const id = String(row.orientationId)
    const child = row.child as Json
    const memory = isObject(row.memory) ? row.memory : {}
    const kernel = isObject(row.kernel) ? row.kernel : null
    if (kernel === null) { issues.push(`perOrientation ${id}.kernel is missing`); continue }
    const kernelStatus = String(kernel.status)
    if (child.outcome === 'completed' && kernelStatus !== 'completed' && kernelStatus !== 'preparation_failed') issues.push(`perOrientation ${id} completed without a kernel judgement`)
    if (child.outcome !== 'completed' && kernelStatus !== `process_${String(child.outcome)}`) issues.push(`perOrientation ${id} is ${String(child.outcome)} but carries kernel ${kernelStatus}`)
    const targets = kernelStatus === 'completed' ? asArray(kernel.targets) : []
    if (kernelStatus === 'completed' && (targets.length === 0 || num(kernel.plannerRerunsUsed) === null)) issues.push(`perOrientation ${id} has no Target results or reruns`)
    const core: Phase2C26AOldOrientationRow['targets'] = []
    const extendedTargets: Phase2C26A10BeforeTargetExtended[] = []
    for (const value of targets) {
      const t = isObject(value) ? value : null
      if (t === null || typeof t.targetWeaponId !== 'string' || typeof t.outcome !== 'string' || typeof t.searched !== 'boolean') { issues.push(`perOrientation ${id} holds a malformed Target`); continue }
      const found = isObject(t.found) ? t.found : null
      if (t.found !== null && found === null) issues.push(`perOrientation ${id} Target ${t.targetWeaponId} has a malformed found`)
      if (found !== null && typeof found.stableKeySha256 !== 'string') issues.push(`perOrientation ${id} Target ${t.targetWeaponId} found has no key SHA-256`)
      const trials = asArray(t.trials).map(trial => {
        const r = isObject(trial) ? trial : {}
        if (typeof r.candidateKeySha256 !== 'string' || typeof r.result !== 'string') issues.push(`perOrientation ${id} Target ${String(t.targetWeaponId)} holds a malformed trial`)
        return { candidateKeySha256: String(r.candidateKeySha256), result: String(r.result), reason: r.reason === null || r.reason === undefined ? null : String(r.reason),
          generatedSelected: typeof r.generatedSelected === 'boolean' ? r.generatedSelected : null }
      })
      core.push({ targetWeaponId: t.targetWeaponId, outcome: t.outcome, searched: t.searched, foundStableKeySha256: found ? String(found.stableKeySha256) : null, trials })
      extendedTargets.push({ targetWeaponId: t.targetWeaponId, search: t.search ?? null,
        found: found === null ? null : { stableKeySha256: String(found.stableKeySha256), generatedSelected: found.generatedSelected ?? null, trialPlan: found.trialPlan ?? null, summary: found.summary ?? null },
        skippedExcludedRouteKeys: t.skippedExcludedRouteKeys ?? null })
    }
    rows.set(id, {
      orientationId: id, kind: String(row.kind), conflictKey: String(row.conflictKey), fixedBuildListEntryId: String(row.fixedBuildListEntryId), fixedTargetWeaponId: String(row.fixedTargetWeaponId),
      outcome: String(child.outcome), wallMs: Number(child.wallMs),
      peakSampledHeapUsedBytes: num(memory.sampledMaxHeapUsedBytes), maxRssKiB: num(memory.maxRssKiB),
      kernelStatus, plannerRerunsUsed: num(kernel.plannerRerunsUsed), targets: core,
      childWallMs: num(child.childWallMs), lastIpcYields: num(child.lastIpcYields),
      memory: { source: typeof memory.source === 'string' ? memory.source : null, sampledMaxHeapUsedBytes: num(memory.sampledMaxHeapUsedBytes),
        sampledMaxRssBytes: num(memory.sampledMaxRssBytes), maxRssKiB: num(memory.maxRssKiB) },
      extendedTargets,
    })
  }
  const kernelSummary = isObject(root.kernel) ? root.kernel : {}
  const trials = isObject(kernelSummary.trials) ? kernelSummary.trials : {}
  const participants = isObject(root.participants) ? root.participants : {}
  if (issues.length > 0) return { valid: false, issues, before: null }
  const ids = authority.orientations.map(o => o.orientationId)
  const statusOf = (id: string) => rows.get(id)?.outcome
  const childStatus = Object.fromEntries(PHASE2C26A_CHILD_STATUSES.map(status => [status, ids.filter(id => statusOf(id) === status).length]))
  return {
    valid: true, issues: [],
    before: {
      authority,
      view: {
        exportSha256: authority.conditions.exportSha256, measuredHead: authority.measuredHead,
        childHeapLimitMb: authority.conditions.childHeapLimitMb, concurrency: authority.conditions.concurrency, orientationBudgetMs: authority.conditions.orientationBudgetMs,
        conditions: { extent: authority.conditions.extent as Phase2C2Conditions['extent'], bounds: authority.conditions.bounds as Phase2C2Conditions['bounds'] },
        researchMaxPlanSteps: authority.conditions.researchMaxPlanSteps, nodeYield: authority.conditions.nodeYield, calculationContext: authority.conditions.calculationContext,
        baseline: authority.baseline, orientations: authority.orientations, rows,
        trialRejectionReasons: (isObject(trials.rejectionReasons) ? trials.rejectionReasons : {}) as Record<string, number>,
        targetOutcomes: (isObject(kernelSummary.targetOutcomes) ? kernelSummary.targetOutcomes : {}) as Record<string, number>,
      },
      timeoutOrientationIds: authority.timeoutOrientationIds,
      completedOrientationIds: ids.filter(id => statusOf(id) === 'completed'),
      preparationFailedOrientationIds: ids.filter(id => rows.get(id)?.kernelStatus === 'preparation_failed'),
      childStatus,
      participants: { participantsTotal: num(participants.participantsTotal), participantsSearched: num(participants.participantsSearched),
        participantsNotSearched: asArray(participants.participantsNotSearched).map(String) },
      kernel: { targetOutcomes: (isObject(kernelSummary.targetOutcomes) ? kernelSummary.targetOutcomes : {}) as Record<string, number>, trials: kernelSummary.trials ?? null,
        plannerRerunsUsed: kernelSummary.plannerRerunsUsed ?? null, wallMs: kernelSummary.wallMs ?? null, memory: kernelSummary.memory ?? null },
    },
  }
}

// ---------------------------------------------------------------- formal series completeness (A10)

export interface Phase2C26A10FormalRunValidation {
  valid: boolean
  failures: string[]
  c26aFormalRun: ReturnType<typeof validatePhase2C26AFormalRun>
  shaMatches: { c26a: boolean; a9: boolean; chain: Record<string, boolean> }
  runnerParity: { baselineParity: boolean; conditionParity: boolean; taskSet: boolean }
  executionConditions: { nodeFlags: boolean; nodeYield: boolean; memorySampleIntervalMs: boolean; notAttached: boolean }
}

/**
 * Whether `raw` is a complete formal A10 series: the unchanged C2.6-A completeness (status, no smoke, committed code,
 * heap / concurrency / budget, a completed baseline, exactly one record per baseline orientation, known statuses, task
 * metadata), the runner's pre-kernel parity gates all valid, the C2.6-A / A9 / chain RESULT SHA-256s the runner read equal
 * to the files analysed, and the heap-only Node flags with nothing attached.
 */
export function validatePhase2C26A10FormalRun(raw: unknown, expected: Phase2C26AFormalExpectations,
  shas: { c26a: string; a9: string; chain: Record<string, string> }): Phase2C26A10FormalRunValidation {
  const c26aFormalRun = validatePhase2C26AFormalRun(raw, expected)
  const failures = [...c26aFormalRun.failures]
  const root = isObject(raw) ? raw : {}
  const environment = isObject(root.environment) ? root.environment : {}
  const recordedChain = isObject(environment.a9ChainResultSha256) ? environment.a9ChainResultSha256 : {}
  const shaMatches = {
    c26a: environment.c26aResultSha256 === shas.c26a,
    a9: environment.a9ResultSha256 === shas.a9,
    chain: Object.fromEntries(PHASE2C26A10_A9_CHAIN_KEYS.map(({ source }) => [source, typeof shas.chain[source] === 'string' && recordedChain[source] === shas.chain[source]])),
  }
  if (!shaMatches.c26a) failures.push('environment.c26aResultSha256 is not the SHA-256 of the C2.6-A RESULT analysed')
  if (!shaMatches.a9) failures.push('environment.a9ResultSha256 is not the SHA-256 of the A9 RESULT analysed')
  for (const [source, ok] of Object.entries(shaMatches.chain)) if (!ok) failures.push(`environment.a9ChainResultSha256.${source} is not the SHA-256 of the file analysed`)
  const valid = (key: string) => isObject(root[key]) && (root[key] as Json).valid === true
  const runnerParity = { baselineParity: valid('baselineParity'), conditionParity: valid('conditionParity'), taskSet: valid('taskSet') }
  for (const [gate, ok] of Object.entries(runnerParity)) if (!ok) failures.push(`the runner's ${gate} is not valid`)
  const executionConditions = {
    nodeFlags: same(environment.nodeFlags, PHASE2C26A10_NODE_FLAGS),
    nodeYield: environment.nodeYield === PHASE2C26A10_NODE_YIELD,
    memorySampleIntervalMs: environment.memorySampleIntervalMs === PHASE2C26A10_MEMORY_SAMPLE_INTERVAL_MS,
    notAttached: same(environment.notAttached, PHASE2C26A10_NOT_ATTACHED),
  }
  for (const [condition, ok] of Object.entries(executionConditions)) if (!ok) failures.push(`environment.${condition} is not the registered A10 value`)
  return { valid: failures.length === 0, failures, c26aFormalRun, shaMatches, runnerParity, executionConditions }
}

// ---------------------------------------------------------------- comparability with C2.6-A (post-hoc, fail closed)

export interface Phase2C26A10Comparability {
  valid: boolean
  issues: string[]
  /** The unchanged C2.6-A validator with the C2.6-A RESULT as its old side ("Phase 2-C2" in its issue text = that old side). */
  c26aStyle: ReturnType<typeof validatePhase2C26AOldC2Comparability>
  /** The A2 authority parity recomputed post-hoc from the raw baseline (summary, ordered IDs, identity, metadata, old timeouts). */
  baselineParity: ReturnType<typeof validatePhase2C26A2BaselineParity>
  /** Every C2.6-A run condition, recomputed post-hoc from the raw environment / baseline / conditions. */
  conditionParity: ReturnType<typeof validatePhase2C26A2ConditionParity>
  currentConditions: Phase2C26A2RunConditions
}

/** The current run conditions as the raw run itself records them (never the runner's own summary of them). */
export function phase2c26a10CurrentConditions(raw: unknown): Phase2C26A2RunConditions {
  const root = isObject(raw) ? raw : {}
  const environment = isObject(root.environment) ? root.environment : {}
  const baseline = isObject(root.baseline) ? root.baseline : {}
  const conditions = isObject(root.conditions) ? root.conditions : {}
  return {
    exportSha256: String(environment.exportSha256), childHeapLimitMb: Number(environment.childHeapLimitMb), concurrency: Number(environment.concurrency),
    orientationBudgetMs: Number(environment.orientationBudgetMs), nodeYield: String(environment.nodeYield), extent: conditions.extent ?? null, bounds: conditions.bounds ?? null,
    researchMaxPlanSteps: Number(baseline.researchMaxPlanSteps), calculationContext: baseline.calculationContext ?? null,
    // The kernel request lineage is the unchanged phase2c2KernelRequest() invariant (empty), tested; it is not a raw field.
    lineage: { priorFixedBuildListEntryIds: [], priorExcludedRoutes: [] },
  }
}

/**
 * Whether the before / after with the C2.6-A RESULT compares the same measurement: the unchanged C2.6-A comparability
 * (Export, baseline, ordered orientations and their Conflict / Entry metadata, extent / bounds, heap / concurrency /
 * budget, maxPlanSteps / yield / CalculationContext) AND the A2 authority parity AND every C2.6-A run condition (lineage
 * included). Any one invalid makes it invalid.
 */
export function validatePhase2C26A10Comparability(raw: unknown, before: Phase2C26A10Before): Phase2C26A10Comparability {
  const c26aStyle = validatePhase2C26AOldC2Comparability(raw, before.view)
  const root = isObject(raw) ? raw : {}
  const baselineRoot = isObject(root.baseline) && isObject(root.baseline.record) ? root.baseline.record : {}
  const summary = (isObject(baselineRoot.summary) ? baselineRoot.summary : {}) as unknown as Phase2C2BaselineSummary
  const orientations = asArray(baselineRoot.orientations) as Phase2C2Orientation[]
  const baselineParity = validatePhase2C26A2BaselineParity(summary, orientations, before.authority)
  const currentConditions = phase2c26a10CurrentConditions(raw)
  const conditionParity = validatePhase2C26A2ConditionParity(currentConditions, before.authority)
  const issues = [...c26aStyle.issues.map(issue => `c26a: ${issue}`), ...baselineParity.issues.map(issue => `baseline: ${issue}`), ...conditionParity.issues.map(issue => `conditions: ${issue}`)]
  return { valid: issues.length === 0, issues, c26aStyle, baselineParity, conditionParity, currentConditions }
}

// ---------------------------------------------------------------- before -> current

function completedKernel(kernel: Phase2C26ARawKernel) {
  return kernel.process.outcome === 'completed' && kernel.record?.kernel.status === 'completed' ? kernel.record.kernel : null
}

export function phase2c26a10Transitions(before: Pick<Phase2C26A10Before['view'], 'rows'>, kernels: readonly Pick<Phase2C26ARawKernel, 'orientationId' | 'process'>[]) {
  const matrix: Record<string, Record<string, number>> = {}
  const rows: { orientationId: string; before: string; current: string }[] = []
  for (const kernel of kernels) {
    const from = before.rows.get(kernel.orientationId)?.outcome ?? 'not_in_c26a'
    matrix[from] ??= Object.fromEntries(PHASE2C26A_CHILD_STATUSES.map(status => [status, 0]))
    matrix[from][kernel.process.outcome] = (matrix[from][kernel.process.outcome] ?? 0) + 1
    rows.push({ orientationId: kernel.orientationId, before: from, current: kernel.process.outcome })
  }
  const group = (from: string) => ({ total: rows.filter(r => r.before === from).length,
    ...Object.fromEntries(PHASE2C26A_CHILD_STATUSES.map(status => [`to_${status}`, rows.filter(r => r.before === from && r.current === status).map(r => r.orientationId)])) }) as
    { total: number } & Record<`to_${Phase2C2ChildOutcome}`, string[]>
  return { matrix, beforeCompleted: group('completed'), beforeTimeout: group('timeout'), beforeOutOfMemory: group('out_of_memory'), beforeProcessFailure: group('process_failure'),
    notInC26a: rows.filter(r => r.before === 'not_in_c26a').map(r => r.orientationId), rows }
}

/**
 * For every orientation completed both in C2.6-A and now, the extended deterministic parts the core comparison does not
 * read: each Target's Search summary (delivered / excluded Candidates, exhausted, stopped by extent / consumer), the found
 * `generatedSelected`, trial Plan summary and Route summary, and `skippedExcludedRouteKeys`. Also every orientation whose
 * C2.6-A kernel completed but whose current completed child carries another kernel status (e.g. a preparation failure).
 */
export function comparePhase2C26A10ExtendedSemantics(before: Pick<Phase2C26A10Before['view'], 'rows'>, kernels: readonly Phase2C26ARawKernel[], sha256: (value: string) => string) {
  const rows: { orientationId: string; identical: boolean; fields: string[] }[] = []
  const kernelStatusMismatches: { orientationId: string; before: string; current: string }[] = []
  for (const kernel of kernels) {
    const row = before.rows.get(kernel.orientationId)
    if (!row || row.kernelStatus !== 'completed' || kernel.process.outcome !== 'completed') continue
    const current = completedKernel(kernel)
    if (current === null) { kernelStatusMismatches.push({ orientationId: kernel.orientationId, before: row.kernelStatus, current: String(kernel.record?.kernel.status ?? 'no_record') }); continue }
    const now = current.targets.map(t => ({ targetWeaponId: t.targetWeaponId, search: t.search ?? null,
      found: t.found === null ? null : { stableKeySha256: sha256(t.found.stableKey), generatedSelected: t.found.generatedSelected ?? null, trialPlan: t.found.trialPlan ?? null, summary: t.found.summary ?? null },
      skippedExcludedRouteKeys: t.skippedExcludedRouteKeys ?? null }))
    const fields: string[] = []
    if (now.length !== row.extendedTargets.length) fields.push('targets.length')
    now.forEach((t, index) => {
      const b = row.extendedTargets[index]
      if (!b) return
      for (const field of ['targetWeaponId', 'search', 'found', 'skippedExcludedRouteKeys'] as const) if (!same(t[field], b[field])) fields.push(`targets[${index}].${field}`)
    })
    rows.push({ orientationId: kernel.orientationId, identical: fields.length === 0, fields })
  }
  return { compared: rows.length, identical: rows.filter(r => r.identical).length, differing: rows.filter(r => !r.identical), kernelStatusMismatches }
}

/** Found Candidates of completed kernels: count, distinct Targets, held Routes, generatedSelected. */
export function phase2c26a10FoundSummary(targets: readonly { targetWeaponId: string; outcome: string; heldRoute: unknown; generatedSelected: unknown }[]) {
  const found = targets.filter(t => t.outcome === 'found')
  const count = (pick: (t: typeof found[number]) => unknown) => {
    const out: Record<string, number> = {}
    for (const t of found) out[String(pick(t))] = (out[String(pick(t))] ?? 0) + 1
    return out
  }
  return { found: found.length, distinctTargets: new Set(found.map(t => t.targetWeaponId)).size, heldRoute: count(t => t.heldRoute), generatedSelected: count(t => t.generatedSelected) }
}

function currentFoundTargets(kernels: readonly Phase2C26ARawKernel[]) {
  return kernels.flatMap(kernel => (completedKernel(kernel)?.targets ?? []).map(t => ({ targetWeaponId: t.targetWeaponId, outcome: t.outcome,
    heldRoute: isObject(t.found?.summary) ? (t.found.summary as Json).heldRoute ?? null : null, generatedSelected: t.found?.generatedSelected ?? null })))
}

function beforeFoundTargets(before: Pick<Phase2C26A10Before['view'], 'rows'>) {
  return [...before.rows.values()].flatMap(row => row.targets.map((t, index) => {
    const extended = row.extendedTargets[index]
    return { targetWeaponId: t.targetWeaponId, outcome: t.outcome, heldRoute: isObject(extended?.found?.summary) ? (extended.found.summary as Json).heldRoute ?? null : null,
      generatedSelected: extended?.found?.generatedSelected ?? null }
  }))
}

/** Completed wall time by Conflict kind, and the paired wall ratio of the orientations completed in both runs (descriptive). */
export function phase2c26a10Runtime(before: Pick<Phase2C26A10Before['view'], 'rows'>, kernels: readonly Phase2C26ARawKernel[]) {
  const byKind: Record<string, { completed: number; completedMedianMs: number | null; completedMaxMs: number | null }> = {}
  const kinds = [...new Set(kernels.map(k => k.task.orientation.kind))].sort()
  for (const kind of kinds) {
    const walls = kernels.filter(k => k.task.orientation.kind === kind && k.process.outcome === 'completed').map(k => k.process.wallMs)
    byKind[kind] = { completed: walls.length, completedMedianMs: median(walls), completedMaxMs: walls.length ? Math.max(...walls) : null }
  }
  const paired = kernels.flatMap(k => {
    const row = before.rows.get(k.orientationId)
    return row && row.outcome === 'completed' && k.process.outcome === 'completed' ? [{ orientationId: k.orientationId, beforeMs: row.wallMs, currentMs: k.process.wallMs, ratio: k.process.wallMs / row.wallMs }] : []
  })
  const ratios = paired.map(p => p.ratio)
  return { byKind, pairedBothCompleted: { count: paired.length, medianRatio: median(ratios), minRatio: ratios.length ? Math.min(...ratios) : null, maxRatio: ratios.length ? Math.max(...ratios) : null,
    slower: paired.filter(p => p.ratio > 1).map(p => p.orientationId), rows: paired } }
}

/** Every C2.6-A timeout orientation, before and now (the A9 local outcome only as a reference with its own conditions). */
export function phase2c26a10OldTimeoutRows(before: Phase2C26A10Before, kernels: readonly Phase2C26ARawKernel[], sha256: (value: string) => string,
  a9Primaries: readonly { orientationId: string; childOutcome: string; childWallMs: number | null }[]) {
  return before.timeoutOrientationIds.map(id => {
    const row = before.view.rows.get(id)!
    const kernel = kernels.find(k => k.orientationId === id) ?? null
    const current = kernel ? completedKernel(kernel) : null
    const a9 = a9Primaries.find(p => p.orientationId === id) ?? null
    return {
      orientationId: id, kind: row.kind, fixedTargetWeaponId: row.fixedTargetWeaponId,
      before: { outcome: row.outcome, wallMs: row.wallMs, memory: row.memory, lastIpcYields: row.lastIpcYields },
      current: kernel === null ? null : { outcome: kernel.process.outcome, wallMs: kernel.process.wallMs, memory: phase2c26aChildMemory(kernel), lastIpcYields: kernel.process.lastIpcYields,
        kernelStatus: kernel.record?.kernel.status ?? `process_${kernel.process.outcome}`, plannerRerunsUsed: current?.plannerRerunsUsed ?? null,
        targets: current === null ? null : current.targets.map(t => ({ targetWeaponId: t.targetWeaponId, outcome: t.outcome, searched: t.reservation !== null, search: t.search ?? null,
          trials: t.trials.map(trial => ({ candidateKeySha256: sha256(trial.candidateKey), result: trial.result, reason: trial.reason, generatedSelected: trial.generatedSelected })),
          found: t.found === null ? null : { stableKeySha256: sha256(t.found.stableKey), generatedSelected: t.found.generatedSelected,
            heldRoute: isObject(t.found.summary) ? (t.found.summary as Json).heldRoute ?? null : null } })) },
      transition: `${row.outcome} -> ${kernel?.process.outcome ?? 'not_run'}`,
      a9Reference: a9 === null ? null : { ...a9, note: 'A9: concurrency 1, CPU profiler (Search start +120 .. +720 s), A7 section observers. Not an A10 before value; wall times are not directly comparable.' },
    }
  })
}

/**
 * The before / after with C2.6-A, produced ONLY for a valid comparability (an invalid one throws): transitions, the core
 * semantic parity of the C2.6-A completed kernels (the unchanged C2.6-A comparison: Target outcome, trial result / reason /
 * generatedSelected / Candidate key SHA-256, found key SHA-256, reruns), the extended semantic parity, the regressions,
 * the old timeout rows, the participant coverage, the trial / Target outcome / found before and after, and the runtime.
 */
export function comparePhase2C26A10WithC26A(comparability: Phase2C26A10Comparability, before: Phase2C26A10Before, kernels: readonly Phase2C26ARawKernel[],
  orientations: readonly Phase2C2Orientation[], sha256: (value: string) => string, a9Primaries: readonly { orientationId: string; childOutcome: string; childWallMs: number | null }[]) {
  if (!comparability.valid) throw new Error(`The C2.6-A RESULT is not comparable with this run: ${comparability.issues.join('; ')}`)
  const summary = summarizePhase2C26AKernels(kernels)
  const transitions = phase2c26a10Transitions(before.view, kernels)
  const coreSemantics = comparePhase2C26AOldCompletedSemantics(before.view, kernels, sha256)
  const extendedSemantics = comparePhase2C26A10ExtendedSemantics(before.view, kernels, sha256)
  const beforeCompletedRegressions = transitions.rows.filter(r => r.before === 'completed' && r.current !== 'completed')
  const preparationFailedNew = kernels.filter(k => k.record?.kernel.status === 'preparation_failed' && !before.preparationFailedOrientationIds.includes(k.orientationId)).map(k => k.orientationId)
  const semanticMismatches = [...new Set([...coreSemantics.differing, ...extendedSemantics.differing.map(r => r.orientationId), ...extendedSemantics.kernelStatusMismatches.map(r => r.orientationId)])]
  const coverage = phase2c26aParticipantCoverage(orientations, kernels, before.view)
  const { oldC2ParticipantsSearched, ...rest } = coverage
  const beforeNotSearched = new Set(before.participants.participantsNotSearched)
  const participants = { ...rest, c26aParticipantsSearched: oldC2ParticipantsSearched, c26aParticipantsSearchedRecorded: before.participants.participantsSearched,
    c26aParticipantsNotSearched: before.participants.participantsNotSearched,
    newlySearched: before.participants.participantsNotSearched.filter(id => !coverage.participantsNotSearched.includes(id)),
    lostSearched: coverage.participantsNotSearched.filter(id => !beforeNotSearched.has(id)),
    note: 'searched = the Planner Alternative Search of that Target ran in at least one completed kernel. All participants searched is not a completable Global Plan.' }
  return {
    summary,
    transitions,
    beforeCompletedRegressions,
    preparationFailedNew,
    coreSemantics,
    extendedSemantics,
    semanticMismatches,
    oldTimeouts: phase2c26a10OldTimeoutRows(before, kernels, sha256, a9Primaries),
    participants,
    trialRejectionBeforeAfter: { c26a: before.view.trialRejectionReasons, current: summary.trials.rejectionReasons },
    targetOutcomeBeforeAfter: { c26a: before.view.targetOutcomes, current: summary.targetOutcomes, currentOther: summary.otherTargetOutcomes },
    trialsBeforeAfter: { c26a: before.kernel.trials, current: summary.trials },
    plannerRerunsBeforeAfter: { c26a: before.kernel.plannerRerunsUsed, current: summary.plannerRerunsUsed },
    foundBeforeAfter: { c26a: phase2c26a10FoundSummary(beforeFoundTargets(before.view)), current: phase2c26a10FoundSummary(currentFoundTargets(kernels)) },
    runtime: phase2c26a10Runtime(before.view, kernels),
    wallMemoryBeforeAfter: { c26a: { wallMs: before.kernel.wallMs, memory: before.kernel.memory }, current: { wallMs: summary.wallMs, memory: summary.memory } },
  }
}

/** One compact per-orientation row: the unchanged C2.6-A compact row, with its old side relabelled as the C2.6-A before. */
export function compactPhase2C26A10Kernel(kernel: Phase2C26ARawKernel, before: Phase2C26A10BeforeRow | null, sha256: (value: string) => string, v8FatalGc: unknown) {
  const { old: _old, transition: _transition, ...row } = compactPhase2C26AKernel(kernel, null, sha256, v8FatalGc)
  void _old; void _transition
  return { ...row,
    before: before === null ? null : { outcome: before.outcome, wallMs: before.wallMs, memory: before.memory, kernelStatus: before.kernelStatus, plannerRerunsUsed: before.plannerRerunsUsed,
      targetOutcomes: before.targets.map(t => t.outcome) },
    transition: `${before?.outcome ?? 'not_in_c26a'} -> ${kernel.process.outcome}` }
}

// ---------------------------------------------------------------- the pre-registered decision rule

export type Phase2C26A10DecisionCase = 'R0_all_completed' | 'R1_improved_timeouts_remain' | 'R2_unchanged_timeout_count' | 'R3_regression_or_failure'

/** Registered before the formal run. The before timeout count is the C2.6-A RESULT's, never a constant. */
export const PHASE2C26A10_DECISION_RULE = {
  order: [
    'R3 regression_or_failure: comparability / parity invalid, OR out_of_memory > 0, OR process_failure > 0, OR timeout > the C2.6-A timeout count, OR any C2.6-A completed orientation is not completed now, OR any orientation completed in both runs differs semantically (core or extended, or another kernel status), OR a new preparation failure',
    'R0 all_completed: every orientation completed (timeout = 0)',
    'R2 unchanged_timeout_count: timeout = the C2.6-A timeout count',
    'R1 improved_timeouts_remain: otherwise (1 <= timeout < the C2.6-A timeout count)',
  ],
  semanticParity: 'core = the unchanged C2.6-A comparison (Target outcome, searched, trial result / reason / generatedSelected / Candidate key SHA-256, found key SHA-256, plannerRerunsUsed); extended = each Target Search summary, found generatedSelected / trial Plan summary / Route summary, skippedExcludedRouteKeys; plus the kernel status',
  note: 'A same timeout count with some old timeouts completed and another orientation newly timed out is R3 (a C2.6-A completed orientation regressed).',
} as const

export const PHASE2C26A10_RECOMMENDATION: Record<Phase2C26A10DecisionCase, string> = {
  R0_all_completed: 'kernel availability上は全orientationを評価可能になった。次はportfolio / global route quality側（C2.6-B相当）へ進む。',
  R1_improved_timeouts_remain: 'runtimeは改善したが未解消。残timeoutの内容とparticipant coverageを見て、portfolioへ進むか追加runtime対策をするかを判断する。',
  R2_unchanged_timeout_count: '全orientation条件ではavailability改善を確認できない。A9局所改善（concurrency 1）とconcurrency 3全体結果の差を整理する。',
  R3_regression_or_failure: '次へ進まず原因調査（regression / failure / parity）。',
}

export function phase2c26a10Decision(input: {
  orientations: number
  childStatus: Record<Phase2C2ChildOutcome, number>
  beforeTimeout: number
  comparabilityValid: boolean
  beforeCompletedRegressions: readonly string[]
  semanticMismatches: readonly string[]
  preparationFailedNew: readonly string[]
}) {
  const { completed, out_of_memory: oom, timeout, process_failure: failure } = input.childStatus
  if (completed + oom + timeout + failure !== input.orientations) throw new Error('Child status counts do not cover every orientation.')
  const reasons: string[] = []
  if (!input.comparabilityValid) reasons.push('comparability_invalid')
  if (oom > 0) reasons.push(`out_of_memory ${oom}`)
  if (failure > 0) reasons.push(`process_failure ${failure}`)
  if (timeout > input.beforeTimeout) reasons.push(`timeout ${timeout} > C2.6-A ${input.beforeTimeout}`)
  if (input.beforeCompletedRegressions.length > 0) reasons.push(`C2.6-A completed regressed: ${input.beforeCompletedRegressions.join(', ')}`)
  if (input.semanticMismatches.length > 0) reasons.push(`semantic mismatch: ${input.semanticMismatches.join(', ')}`)
  if (input.preparationFailedNew.length > 0) reasons.push(`new preparation failure: ${input.preparationFailedNew.join(', ')}`)
  const kase: Phase2C26A10DecisionCase = reasons.length > 0 ? 'R3_regression_or_failure' : timeout === 0 ? 'R0_all_completed'
    : timeout === input.beforeTimeout ? 'R2_unchanged_timeout_count' : 'R1_improved_timeouts_remain'
  return { case: kase, reasons, recommendation: PHASE2C26A10_RECOMMENDATION[kase] }
}

export function phase2c26a10Conclusion(decision: ReturnType<typeof phase2c26a10Decision>, counts: { orientations: number; childStatus: Record<Phase2C2ChildOutcome, number>; beforeChildStatus: Record<string, number> }) {
  const { completed, out_of_memory: oom, timeout, process_failure: failure } = counts.childStatus
  const b = counts.beforeChildStatus
  const statement = `Phase 2-C2.6-Aと同じ元Export・${counts.orientations} orientation・Node条件（fresh child、heap 8 GB、concurrency 3、30分budget）で、current Production（C2.6-A measured HEAD以降のA6・A9等を含むProduction全体）のkernelを全件1回ずつ再実行した: `
    + `completed ${b.completed ?? '-'} → ${completed}、timeout ${b.timeout ?? '-'} → ${timeout}、OOM ${b.out_of_memory ?? '-'} → ${oom}、process failure ${b.process_failure ?? '-'} → ${failure}。decision case ${decision.case}`
    + (decision.reasons.length > 0 ? `（${decision.reasons.join('; ')}）` : '') + '。'
  return {
    case: decision.case, statement, recommendation: decision.recommendation,
    cannotSay: [
      'C2.6-A → currentの差をA9単独の効果とすること（A6・A9・その間の全変更を含むcurrent Production全体のbefore / afterである。A9単独効果はA9 RESULTの局所比較がauthority）',
      'foundがそのorientationのfixed Route setとのkernel trialで選ばれた以上の意味（全planning Target完成・全Conflict解消・global assignment成立・1,657-step oracle到達）を持つこと',
      '全participantが測定可能 = Global Planが完成可能、とすること',
      'timeoutがCandidateなしを意味すること',
      'portfolio / global assignment / oracle coverage / C3 readiness（本Phaseでは実行していない）',
      'Browser Workerや他のdevice / heap / concurrency条件での挙動、run間のwall time分散',
    ],
  }
}
