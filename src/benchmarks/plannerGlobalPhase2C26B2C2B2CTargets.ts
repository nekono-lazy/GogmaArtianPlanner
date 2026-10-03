/**
 * Issue #154 Phase 2-C2.6-B2-C2B2C: the E1 ∩ L2 population and its authority chain. Research only. Never import from
 * Production, and never from the B2-C2B2C Search side (the Search module never imports this one).
 *
 * The population is B2-C2B1's cohort `E1` (extent-insufficient AND K1-minimal) restricted to the Routes whose first covering
 * ladder rung B2-C2B1 recorded as `L2` (the "L2-needed" Routes). Both facts were derived post hoc from oracle evidence (B2-C1
 * subgroups, B2-C2B1 required extents): `oracleGuidedTargetPopulation = true`. The common L2 extent is B2-C2B1's ladder rung L2:
 * `oracleInformedCommonExtent = true`. The split E1 = (E1 ∩ L1) ⊔ (E1 ∩ L2) is checked against B2-C2B1 itself and against the
 * Targets the committed B2-C2B2B RESULT searched at L1. This module turns that into a manifest of Target IDs only; no rank,
 * digest, first-compatible context, required extent, ladder rung or oracle field reaches the Search runner. The analyzer
 * reuses the parsers below after the run.
 */
import { stableStringify } from '../domain/models/hashing'
import type { Phase2C26B2C2AB2C1Authority } from './plannerGlobalPhase2C26B2C2ATargets'
import { PHASE2C26B2C2B2A_REGISTERED_B2C2B1, type Phase2C26B2C2B2AB2C2B1Authority } from './plannerGlobalPhase2C26B2C2B2ATargets'
import { PHASE2C26B2C2B2B_EXTENT } from './plannerGlobalPhase2C26B2C2B2B'
import { phase2c26b2c2b2bFits, phase2c26b2c2b2bPopulation, phase2c26b2c2b2bRouteExtents } from './plannerGlobalPhase2C26B2C2B2BTargets'
import {
  PHASE2C26B2C2B2C_CONTEXT_BUDGET,
  PHASE2C26B2C2B2C_EXTENT,
  PHASE2C26B2C2B2C_TARGET_SOURCE,
  PHASE2C26B2C2B2C_TARGETS,
  type Phase2C26B2C2B2CTargetManifest,
} from './plannerGlobalPhase2C26B2C2B2C'

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)
const same = (a: unknown, b: unknown) => {
  try { return stableStringify(a ?? null) === stableStringify(b ?? null) } catch { return false }
}
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
const COMMIT = /^[0-9a-f]{40}$/

/** The B2-C2B1 RESULT is the one B2-C2B2A / B2-C2B2B registered; its L2 rung is this phase's common extent and covers the 4 L2-needed E1 Routes. */
export const PHASE2C26B2C2B2C_REGISTERED_B2C2B1 = {
  resultSha256: PHASE2C26B2C2B2C_TARGET_SOURCE.resultSha256,
  l1Rung: PHASE2C26B2C2B2A_REGISTERED_B2C2B1.rungs[1],
  l2Rung: PHASE2C26B2C2B2A_REGISTERED_B2C2B1.rungs[2],
  e1: PHASE2C26B2C2B2A_REGISTERED_B2C2B1.counts.e1,
  l1Covered: 7,
  l2Covered: 11,
  l2Needed: 4,
} as const

// ---------------------------------------------------------------- the B2-C2B2B RESULT (predecessor: the E1 ∩ L1 half of the ladder)

/** The B2-C2B2B RESULT (E1 ∩ L1 at the common L1 extent, formal, INCOMPLETE with C4C 7 / 7) this phase completes the E1 ladder with. */
export const PHASE2C26B2C2B2C_REGISTERED_B2C2B2B = {
  resultSha256: '2066506462159ae7d7045268e2d5c670de2ec157322265f970786c5ad29684c9',
  decisionCase: 'B2C2B2B_INCOMPLETE',
  evidenceGrade: 'formal',
  measuredHead: 'a84357490cc23b14b383c30510bf5a55a3491b7c',
  targets: 7,
  tasks: 224,
  extent: { ...PHASE2C26B2C2B2B_EXTENT },
} as const

/** One B2-C2B2B Target row as the E1 ladder aggregate needs it (post hoc; the Search never reads it). */
export interface Phase2C26B2C2B2CB2C2B2BTarget {
  targetWeaponId: string
  firstLadderRung: 'L1'
  b2c1FirstCompatibleRank: number | null
  firstExact: Record<'C8' | 'C32' | 'C4C', { contextRank: number | null; candidateIndex: number | null; operationCost: number | null }>
}

export interface Phase2C26B2C2B2CB2C2B2BAuthority {
  resultSha256: string
  measuredHead: string
  decisionCase: string
  evidenceGrade: string
  formal: boolean
  partialRun: boolean
  b2c2b1ResultSha256: string
  exportSha256: string
  extent: { maxNormalAdvance: number; maxGogmaAdvance: number; maxSkillAdvance: number }
  targetWeaponIds: string[]
  targets: Phase2C26B2C2B2CB2C2B2BTarget[]
  exactTargets: { C8: number; C32: number; C4C: number }
  firstExactEqualsFirstCompatible: { recoveredC4C: number; equal: number; later: number }
  execution: { tasks: number; started: number; completed: number; timeout: number; outOfMemory: number; processFailure: number; contextMismatch: number; notRun: number }
}

const count = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0
const rankOrNull = (value: unknown) => value === null || (Number.isSafeInteger(value) && (value as number) >= 0)

/**
 * Reads the committed B2-C2B2B RESULT as untrusted JSON and fails closed unless it is the registered formal predecessor: its
 * own SHA-256; formal with verified launch provenance, not partial; the registered measured HEAD and case with no invalid
 * reason; the registered B2-C2B1 RESULT; the common L1 extent; 7 Target rows whose first ladder rung is L1 with readable C8 /
 * C32 / C4C first exact rows; 224 tasks; exact Target counts agreeing with the rows. Nothing here reaches the Search.
 */
export function parsePhase2C26B2C2B2CB2C2B2BAuthority(json: unknown, resultSha256: string, expected: { b2c2b1ResultSha256: string; exportSha256: string }):
  { valid: boolean; issues: string[]; authority: Phase2C26B2C2B2CB2C2B2BAuthority | null } {
  const reg = PHASE2C26B2C2B2C_REGISTERED_B2C2B2B
  const issues: string[] = []
  if (!isObject(json) || !isObject(json.provenance) || !isObject(json.decision) || !isObject(json.conditions) || !isObject(json.aggregates) || !Array.isArray(json.targets)) {
    return { valid: false, issues: ['B2-C2B2B RESULT lacks provenance / decision / conditions / aggregates / targets'], authority: null }
  }
  const { provenance, decision, conditions, aggregates } = json
  if (resultSha256 !== reg.resultSha256) issues.push(`B2-C2B2B RESULT SHA-256 ${resultSha256} is not the registered ${reg.resultSha256}`)
  if (provenance.formal !== true || provenance.evidenceGrade !== reg.evidenceGrade || provenance.launchProvenanceVerified !== true) issues.push('the B2-C2B2B RESULT is not formal with verified launch provenance')
  if (provenance.partialRun !== false) issues.push('the B2-C2B2B RESULT is a partial run')
  if (typeof provenance.measuredHead !== 'string' || !COMMIT.test(provenance.measuredHead) || provenance.measuredHead !== reg.measuredHead) issues.push('provenance.measuredHead is not the registered B2-C2B2B measured HEAD')
  if (decision.case !== reg.decisionCase) issues.push(`decision.case ${String(decision.case)} is not ${reg.decisionCase}`)
  if (!Array.isArray(json.invalidReasons) || json.invalidReasons.length !== 0) issues.push('invalidReasons is not empty')
  if (provenance.b2c2b1ResultSha256 !== expected.b2c2b1ResultSha256) issues.push('provenance.b2c2b1ResultSha256 is not the B2-C2B1 RESULT of this phase')
  if (provenance.exportSha256 !== expected.exportSha256) issues.push('provenance.exportSha256 is not the Export of this phase')
  if (!same(conditions.searchExtent, reg.extent)) issues.push('conditions.searchExtent is not the common L1 extent')
  const targets: Phase2C26B2C2B2CB2C2B2BTarget[] = []
  for (const raw of json.targets as unknown[]) {
    if (!isObject(raw) || typeof raw.targetWeaponId !== 'string' || raw.firstLadderRung !== 'L1' || !rankOrNull(raw.b2c1FirstCompatibleRank) || !isObject(raw.policies)) {
      issues.push('a B2-C2B2B Target row is malformed or not first rung L1'); continue
    }
    const policies = raw.policies
    const firstExact = {} as Phase2C26B2C2B2CB2C2B2BTarget['firstExact']
    let ok = true
    for (const policy of ['C8', 'C32', 'C4C'] as const) {
      const p = policies[policy]
      if (!isObject(p) || !rankOrNull(p.firstExactContextRank) || !rankOrNull(p.firstExactCandidateIndex) || !rankOrNull(p.firstExactOperationCost)) { ok = false; break }
      firstExact[policy] = { contextRank: p.firstExactContextRank as number | null, candidateIndex: p.firstExactCandidateIndex as number | null, operationCost: p.firstExactOperationCost as number | null }
    }
    if (!ok) { issues.push(`${raw.targetWeaponId}: the B2-C2B2B first exact rows are not readable`); continue }
    targets.push({ targetWeaponId: raw.targetWeaponId, firstLadderRung: 'L1', b2c1FirstCompatibleRank: raw.b2c1FirstCompatibleRank as number | null, firstExact })
  }
  if (targets.length !== reg.targets || (json.targets as unknown[]).length !== reg.targets) issues.push(`the B2-C2B2B RESULT holds ${targets.length} readable Targets, not ${reg.targets}`)
  if (new Set(targets.map(t => t.targetWeaponId)).size !== targets.length) issues.push('a B2-C2B2B Target repeats')
  const exact = isObject(aggregates.exactTargets) ? aggregates.exactTargets : {}
  const exactTargets = { C8: exact.C8 as number, C32: exact.C32 as number, C4C: exact.C4C as number }
  if (![exactTargets.C8, exactTargets.C32, exactTargets.C4C].every(count)) issues.push('aggregates.exactTargets is not readable')
  for (const policy of ['C8', 'C32', 'C4C'] as const) {
    if (targets.filter(t => t.firstExact[policy].contextRank !== null).length !== exactTargets[policy]) issues.push(`aggregates.exactTargets.${policy} disagrees with the Target rows`)
  }
  const equal = isObject(aggregates.firstExactEqualsFirstCompatible) ? aggregates.firstExactEqualsFirstCompatible : {}
  const firstExactEqualsFirstCompatible = { recoveredC4C: equal.recoveredC4C as number, equal: equal.equal as number, later: equal.later as number }
  if (![firstExactEqualsFirstCompatible.recoveredC4C, firstExactEqualsFirstCompatible.equal, firstExactEqualsFirstCompatible.later].every(count)) issues.push('aggregates.firstExactEqualsFirstCompatible is not readable')
  const ex = isObject(aggregates.execution) ? aggregates.execution : {}
  const execution = { tasks: ex.tasks as number, started: ex.started as number, completed: ex.completed as number, timeout: ex.timeout as number, outOfMemory: ex.outOfMemory as number,
    processFailure: ex.processFailure as number, contextMismatch: ex.contextMismatch as number, notRun: ex.notRun as number }
  if (!Object.values(execution).every(count)) issues.push('aggregates.execution is not readable')
  else if (execution.tasks !== reg.tasks) issues.push(`the B2-C2B2B RESULT has ${execution.tasks} tasks, not ${reg.tasks}`)
  if (issues.length > 0) return { valid: false, issues, authority: null }
  return { valid: true, issues: [], authority: { resultSha256, measuredHead: String(provenance.measuredHead), decisionCase: String(decision.case), evidenceGrade: String(provenance.evidenceGrade),
    formal: true, partialRun: false, b2c2b1ResultSha256: String(provenance.b2c2b1ResultSha256), exportSha256: String(provenance.exportSha256), extent: { ...reg.extent },
    targetWeaponIds: targets.map(t => t.targetWeaponId).sort(compare), targets: [...targets].sort((a, b) => compare(a.targetWeaponId, b.targetWeaponId)), exactTargets,
    firstExactEqualsFirstCompatible, execution } }
}

// ---------------------------------------------------------------- the E1 ∩ L2 population

/**
 * The E1 ∩ L2 population, derived mechanically from the parsed authorities and cross-checked:
 *   - the B2-C2B2B population function over the same B2-C2B1 RESULT is valid (E1 = B2-C1 extentInsufficient AND k1Minimal; the
 *     L1 Routes fit L1, the L2-needed Routes do not; the L1 rung, L1 coverage 7 of 11);
 *   - the Routes whose recorded first ladder rung is `L2` form the population, and each one's recorded required extent fits the
 *     B2-C2B1 rung L2, which must be the registered L2 and this phase's common extent; ladderCoverage L2 is 11 of 11;
 *   - E1 ∩ L1 = 7 equals exactly the Targets the committed B2-C2B2B RESULT searched; E1 ∩ L2 = 4; overlap 0; union = E1 (11).
 */
export function phase2c26b2c2b2cPopulation(b2c2b1: Phase2C26B2C2B2AB2C2B1Authority, b2c1: Phase2C26B2C2AB2C1Authority, b2c2b1Json: unknown, b2c2b2b: Phase2C26B2C2B2CB2C2B2BAuthority | null):
  { valid: boolean; issues: string[]; targetWeaponIds: string[]; split: { e1: string[]; l1: string[]; l2: string[]; overlap: number; union: number } } {
  const l1Split = phase2c26b2c2b2bPopulation(b2c2b1, b2c1, b2c2b1Json)
  const issues = l1Split.issues.map(i => `e1_l1_split: ${i}`)
  if (b2c2b1.resultSha256 !== PHASE2C26B2C2B2C_REGISTERED_B2C2B1.resultSha256) issues.push('the B2-C2B1 RESULT is not the registered one')
  if (!same(PHASE2C26B2C2B2C_REGISTERED_B2C2B1.l2Rung, { id: 'L2', name: 'larger', extent: { ...PHASE2C26B2C2B2C_EXTENT } })) issues.push('the registered B2-C2B1 L2 rung is not the common L2 extent')
  const ladder = isObject(b2c2b1Json) && isObject(b2c2b1Json.ladder) && Array.isArray(b2c2b1Json.ladder.rungs) ? b2c2b1Json.ladder.rungs : []
  const l2Rung = ladder.find(r => isObject(r) && r.id === 'L2')
  if (!isObject(l2Rung) || !same(l2Rung.extent, { ...PHASE2C26B2C2B2C_EXTENT })) issues.push('the B2-C2B1 ladder rung L2 is not the common L2 extent')
  const e1 = [...b2c2b1.e1].sort(compare)
  const extents = phase2c26b2c2b2bRouteExtents(b2c2b1Json, e1)
  issues.push(...extents.issues)
  const l2: string[] = []
  for (const id of e1) {
    const route = extents.routes.find(r => r.targetWeaponId === id)
    const authorityRoute = b2c2b1.routes.find(r => r.targetWeaponId === id)
    if (!route || !authorityRoute) { issues.push(`${id}: no B2-C2B1 Route`); continue }
    if (route.firstLadderRung !== authorityRoute.firstLadderRung) issues.push(`${id}: the parsed and raw first ladder rungs disagree`)
    if (route.firstLadderRung !== 'L2') continue
    if (!phase2c26b2c2b2bFits(route.required, PHASE2C26B2C2B2C_EXTENT)) issues.push(`${id}: first ladder rung L2 but the recorded required extent does not fit L2`)
    if (phase2c26b2c2b2bFits(route.required, PHASE2C26B2C2B2B_EXTENT)) issues.push(`${id}: first ladder rung L2 but the recorded required extent fits L1`)
    l2.push(id)
  }
  const coverage = isObject(b2c2b1Json) && isObject(b2c2b1Json.ladderCoverage) && isObject(b2c2b1Json.ladderCoverage.e1) ? b2c2b1Json.ladderCoverage.e1 : {}
  const l2Coverage = Array.isArray(coverage.byRung) ? coverage.byRung.find(r => isObject(r) && r.id === 'L2') : undefined
  if (!isObject(l2Coverage) || l2Coverage.covered !== PHASE2C26B2C2B2C_REGISTERED_B2C2B1.l2Covered || l2Coverage.of !== PHASE2C26B2C2B2C_REGISTERED_B2C2B1.e1) issues.push('ladderCoverage.e1 L2 is not the registered 11 of 11')
  const histogram = isObject(coverage.firstRungHistogram) ? coverage.firstRungHistogram : {}
  if (histogram.L2 !== PHASE2C26B2C2B2C_REGISTERED_B2C2B1.l2Needed || histogram.L1 !== PHASE2C26B2C2B2C_REGISTERED_B2C2B1.l1Covered) issues.push('ladderCoverage.e1 firstRungHistogram is not L1 7 / L2 4')
  const l1 = [...l1Split.targetWeaponIds].sort(compare)
  const l2Sorted = [...l2].sort(compare)
  if (!same(l2Sorted, l1Split.l2Needed)) issues.push('E1 ∩ L2 is not the L2-needed set of the B2-C2B2B population')
  if (l2Sorted.length !== PHASE2C26B2C2B2C_TARGETS) issues.push(`E1 ∩ L2 holds ${l2Sorted.length} Targets, not ${PHASE2C26B2C2B2C_TARGETS}`)
  if (l1.length !== PHASE2C26B2C2B2C_REGISTERED_B2C2B1.l1Covered) issues.push(`E1 ∩ L1 holds ${l1.length} Targets, not ${PHASE2C26B2C2B2C_REGISTERED_B2C2B1.l1Covered}`)
  const overlap = l1.filter(id => l2Sorted.includes(id)).length
  const union = [...new Set([...l1, ...l2Sorted])].sort(compare)
  if (overlap !== 0) issues.push(`E1 ∩ L1 and E1 ∩ L2 overlap in ${overlap} Targets`)
  if (!same(union, e1) || e1.length !== PHASE2C26B2C2B2C_REGISTERED_B2C2B1.e1) issues.push('E1 ∩ L1 and E1 ∩ L2 do not partition E1 (11)')
  if (b2c2b2b === null) issues.push('no B2-C2B2B authority')
  else {
    if (!same(b2c2b2b.targetWeaponIds, l1)) issues.push('the B2-C2B2B RESULT Targets are not E1 ∩ L1')
    if (b2c2b2b.b2c2b1ResultSha256 !== b2c2b1.resultSha256) issues.push('the B2-C2B2B RESULT is not over this B2-C2B1 RESULT')
    if (b2c2b2b.targetWeaponIds.some(id => l2Sorted.includes(id))) issues.push('the B2-C2B2B RESULT searched an E1 ∩ L2 Target')
  }
  const valid = issues.length === 0
  return { valid, issues, targetWeaponIds: valid ? l2Sorted : [], split: { e1, l1, l2: l2Sorted, overlap, union: union.length } }
}

/**
 * The Target manifest from the parsed authorities: the E1 ∩ L2 Target IDs in ascending order, and nothing of their ranks,
 * digests, required extents, ladder rungs or oracle comparison.
 */
export function phase2c26b2c2b2cTargetManifest(b2c2b1: Phase2C26B2C2B2AB2C2B1Authority, b2c1: Phase2C26B2C2AB2C1Authority, b2c2b1Json: unknown,
  b2c2b2b: Phase2C26B2C2B2CB2C2B2BAuthority | null): Phase2C26B2C2B2CTargetManifest {
  const population = phase2c26b2c2b2cPopulation(b2c2b1, b2c1, b2c2b1Json, b2c2b2b)
  if (!population.valid) throw new Error(`The E1 ∩ L2 population is not valid: ${population.issues.join('; ')}`)
  return { phase: 'Issue #154 Phase 2-C2.6-B2-C2B2C Target manifest (B2-C2B1 cohort E1 ∩ first ladder rung L2; Target IDs only)',
    sourceResultSha256: b2c2b1.resultSha256, population: 'E1_L2', policy: 'P1', contextBudget: PHASE2C26B2C2B2C_CONTEXT_BUDGET, exportSha256: b2c2b1.exportSha256,
    targetWeaponIds: population.targetWeaponIds }
}
