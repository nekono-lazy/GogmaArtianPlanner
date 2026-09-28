/**
 * Issue #154 Phase 2-C2 post-hoc analysis only. It reads a finished Phase 2-C2 run record and, as explicit arguments,
 * the Phase 2-C1 evidence and the 1,657 proven-minimum evidence. It runs no Search, no kernel and no Planner, and it
 * feeds neither evidence into any calculation. Fields the evidence does not record are never inferred.
 */
import type { Phase2C2BaselineSummary, Phase2C2CandidateSummary, Phase2C2TargetPortfolio } from './plannerGlobalPhase2C2'

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** The Phase 2-C1 baseline (the ordinary Production Planner over the original Build List), read from its evidence JSON. */
export function comparePhase2C2BaselineWithC1(summary: Phase2C2BaselineSummary, c1: unknown) {
  if (!isRecord(c1) || !isRecord(c1.origin) || !isRecord(c1.origin.baselineComparison) || !isRecord(c1.origin.baselineComparison.original)) {
    throw new Error('Phase 2-C1 evidence: unexpected shape (origin.baselineComparison.original).')
  }
  const original = c1.origin.baselineComparison.original as { selectedTargets: string[]; conflictSignatures: string[]; steps: number | null; completedTargetCount: number | null; termination: string | null }
  const kindsOf = (signatures: readonly string[]) => {
    const out: Record<string, number> = {}
    for (const signature of signatures) { const kind = signature.split(':')[0]; out[kind] = (out[kind] ?? 0) + 1 }
    return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a < b ? -1 : 1))
  }
  const c2 = { planSteps: summary.planSteps, completed: summary.completedTargetCount, termination: summary.termination, conflictsByKind: summary.conflictsByKind,
    conflictSignatures: [...summary.conflictSignatures].sort(), selectedTargets: [...summary.selectedTargets].sort() }
  const c1Side = { planSteps: original.steps, completed: original.completedTargetCount, termination: original.termination, conflictsByKind: kindsOf(original.conflictSignatures),
    conflictSignatures: [...original.conflictSignatures].sort(), selectedTargets: [...original.selectedTargets].sort() }
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
  const checks = { planSteps: c2.planSteps === c1Side.planSteps, completed: c2.completed === c1Side.completed, termination: c2.termination === c1Side.termination,
    conflictsByKind: same(c2.conflictsByKind, c1Side.conflictsByKind), conflictSignatures: same(c2.conflictSignatures, c1Side.conflictSignatures),
    selectedTargets: same(c2.selectedTargets, c1Side.selectedTargets) }
  return { c2, c1: c1Side, checks, matches: Object.values(checks).every(Boolean) }
}

interface OracleStream { first: number | null; last: number | null; operations: number; required?: readonly number[] }
interface OracleRoute {
  targetWeaponId: string
  sourceKind?: string
  sourceOwnedWeaponId?: string | null
  normalPosition?: number | null
  conversionPosition?: number | null
  normal?: OracleStream | null
  gogma?: OracleStream | null
  skill?: OracleStream | null
  routeOperationCount?: number
  finalBonuses?: { bonusTypeId: string; bonusRankId: string }[]
  finalScope?: string
  finalSeriesSkillId?: string | null
  finalGroupSkillId?: string | null
  materialization?: { method?: string; routeKind?: string | null; estimated?: { operations: number; normal: number | null; gogma: number; skill: number } | null }
}
interface OracleUsage { position: number; targetWeaponId: string; type: string; required: boolean }

export type Phase2C2OracleCoverageLevel = 'exact' | 'partial_comparable' | 'not_comparable' | 'uncovered'

const expand = (ranges: readonly [number, number][]) => ranges.flatMap(([a, b]) => Array.from({ length: b - a + 1 }, (_, i) => a + i))
const used = (stream: OracleStream | null | undefined) => stream !== null && stream !== undefined && stream.operations > 0 && stream.first !== null && stream.last !== null

/**
 * One portfolio Candidate against one oracle Route. `mismatch` when a recorded field differs; `exact` when every
 * recorded field matches AND the evidence determines every Route unit position (and Gogma operation type), which
 * then match too; `partial` when every recorded field matches but some position set is not determined by the evidence.
 */
function matchOracleRoute(route: OracleRoute, usage: readonly OracleUsage[], c: Phase2C2CandidateSummary): { level: 'exact' | 'partial' | 'mismatch'; undetermined: string[]; differences: string[] } {
  const differences: string[] = []
  const eq = (name: string, a: unknown, b: unknown) => { if (JSON.stringify(a) !== JSON.stringify(b)) differences.push(name) }
  const m = route.materialization!
  eq('routeKind', c.routeKind, m.routeKind)
  eq('sourceKind', c.sourceKind === 'new_normal' ? 'new_normal' : 'owned', route.sourceKind)
  eq('sourceOwnedWeaponId', c.sourceOwnedWeaponId, route.sourceOwnedWeaponId)
  eq('normalPosition', c.normalProductionTargetPosition, route.normalPosition)
  eq('conversionPosition', c.conversionSkillPosition, route.conversionPosition)
  eq('ownOperationCount', c.ownOperationCount, route.routeOperationCount)
  for (const stream of ['normal', 'gogma', 'skill'] as const) {
    const o = route[stream], mine = c[stream]
    if (!used(o)) { if (mine !== null) differences.push(`${stream}:presence`); continue }
    if (mine === null) { differences.push(`${stream}:presence`); continue }
    eq(`${stream}:first`, mine.first, o!.first)
    eq(`${stream}:last`, mine.last, o!.last)
    eq(`${stream}:operations`, mine.operations, o!.operations)
    if (stream !== 'normal') eq(`${stream}:required`, [...mine.required].sort((a, b) => a - b), [...(o!.required ?? [])].sort((a, b) => a - b))
  }
  eq('finalBonuses', c.finalBonuses, route.finalBonuses)
  eq('finalScope', c.restorationBonusScope, route.finalScope)
  eq('finalSkills', [c.seriesSkillId, c.groupSkillId], [route.finalSeriesSkillId, route.finalGroupSkillId])
  if (m.estimated) {
    eq('estimatedOperations', c.estimatedOperationCount, m.estimated.operations)
    eq('estimatedAdvances', [c.estimatedAdvances.normal, c.estimatedAdvances.gogma, c.estimatedAdvances.skill], [m.estimated.normal, m.estimated.gogma, m.estimated.skill])
  }
  if (differences.length > 0) return { level: 'mismatch', undetermined: [], differences }

  const undetermined: string[] = []
  // Gogma: the per-unit usage (position and operation type) determines the Route's Gogma units when it is complete.
  if (used(route.gogma)) {
    const own = usage.filter(entry => entry.targetWeaponId === route.targetWeaponId).sort((a, b) => a.position - b.position)
    if (own.length === route.gogma!.operations) {
      const mine = c.gogmaTypeRuns.flatMap(([a, b, type]) => Array.from({ length: b - a + 1 }, (_, i) => [a + i, type]))
      if (JSON.stringify(mine) !== JSON.stringify(own.map(entry => [entry.position, entry.type]))) return { level: 'mismatch', undetermined: [], differences: ['gogma:units'] }
    } else undetermined.push('gogma:units')
  }
  // Skill: positions are determined when consecutive, when every unit is required, or with at most two units.
  if (used(route.skill)) {
    const o = route.skill!
    const determined = o.last! - o.first! + 1 === o.operations ? Array.from({ length: o.operations }, (_, i) => o.first! + i)
      : (o.required ?? []).length === o.operations ? [...o.required!].sort((a, b) => a - b)
        : o.operations <= 2 ? [...new Set([o.first!, o.last!])] : null
    if (determined === null) undetermined.push('skill:positions')
    else if (JSON.stringify(expand(c.skill!.positions)) !== JSON.stringify(determined)) return { level: 'mismatch', undetermined: [], differences: ['skill:positions'] }
  }
  // Normal: consecutive forges are determined by first / last / count.
  if (used(route.normal)) {
    const o = route.normal!
    if (o.last! - o.first! + 1 === o.operations) {
      if (JSON.stringify(expand(c.normal!.positions)) !== JSON.stringify(Array.from({ length: o.operations }, (_, i) => o.first! + i))) {
        return { level: 'mismatch', undetermined: [], differences: ['normal:positions'] }
      }
    } else undetermined.push('normal:positions')
  }
  return { level: undetermined.length === 0 ? 'exact' : 'partial', undetermined, differences: [] }
}

const REQUIRED_ORACLE_FIELDS = ['sourceKind', 'sourceOwnedWeaponId', 'normalPosition', 'conversionPosition', 'normal', 'gogma', 'skill', 'routeOperationCount',
  'finalBonuses', 'finalScope', 'finalSeriesSkillId', 'finalGroupSkillId', 'materialization'] as const

type PortfolioLike = Pick<Phase2C2TargetPortfolio, 'targetWeaponId'> & { candidates: readonly { stableKey: string; origin: 'original' | 'alternative'; summary: Phase2C2CandidateSummary; provenance: readonly { extentLabel: string }[]; kernelFound: boolean }[] }

/**
 * For every oracle Route: is it in the Target's portfolio? `coveredBy` prefers the original Candidate at the same level.
 * An oracle Route missing a compared field is `not_comparable`; nothing is filled in.
 */
export function phase2c2OracleCoverage(portfolio: readonly PortfolioLike[], oracle: { routes: readonly unknown[]; gogmaUsage: readonly unknown[] }) {
  const usage = oracle.gogmaUsage as OracleUsage[]
  const byTarget = new Map(portfolio.map(entry => [entry.targetWeaponId, entry]))
  const targets = (oracle.routes as OracleRoute[]).map(route => {
    const missing = REQUIRED_ORACLE_FIELDS.filter(field => route[field] === undefined)
    if (missing.length > 0 || !route.materialization?.routeKind) {
      return { targetWeaponId: route.targetWeaponId, coverage: 'not_comparable' as Phase2C2OracleCoverageLevel, missingOracleFields: [...missing], coveredBy: null, matchedStableKey: null,
        matchedExtentLabels: [], matchedKernelFound: null, undetermined: [], oracleHeldRoute: null, oracleMaterialization: route.materialization?.method ?? null, closestDifferences: [] }
    }
    const spread = (s: OracleStream | null | undefined) => used(s) && s!.last! - s!.first! + 1 > s!.operations
    const oracleHeldRoute = spread(route.gogma) || spread(route.skill)
    const candidates = byTarget.get(route.targetWeaponId)?.candidates ?? []
    const matched = candidates.map(candidate => ({ candidate, match: matchOracleRoute(route, usage, candidate.summary) }))
    const pick = (level: 'exact' | 'partial') => {
      const at = matched.filter(entry => entry.match.level === level)
      return at.find(entry => entry.candidate.origin === 'original') ?? at[0] ?? null
    }
    const best = pick('exact') ?? pick('partial')
    const closest = [...matched].sort((a, b) => a.match.differences.length - b.match.differences.length)[0]
    return {
      targetWeaponId: route.targetWeaponId,
      coverage: (best === null ? 'uncovered' : best.match.level === 'exact' ? 'exact' : 'partial_comparable') as Phase2C2OracleCoverageLevel,
      missingOracleFields: [], coveredBy: best?.candidate.origin ?? null, matchedStableKey: best?.candidate.stableKey ?? null,
      matchedExtentLabels: best ? [...new Set(best.candidate.provenance.map(entry => entry.extentLabel))].sort() : [],
      matchedKernelFound: best?.candidate.kernelFound ?? null, undetermined: best?.match.undetermined ?? [], oracleHeldRoute,
      oracleMaterialization: route.materialization.method ?? null,
      closestDifferences: best === null && closest ? closest.match.differences : [],
    }
  })
  const count = (predicate: (row: typeof targets[number]) => boolean) => targets.filter(predicate).length
  return {
    targets,
    totals: {
      routes: targets.length,
      exact: count(row => row.coverage === 'exact'),
      exactByOriginal: count(row => row.coverage === 'exact' && row.coveredBy === 'original'),
      exactByAlternative: count(row => row.coverage === 'exact' && row.coveredBy === 'alternative'),
      exactByAlternativeDefaultExtent: count(row => row.coverage === 'exact' && row.coveredBy === 'alternative' && row.matchedExtentLabels.includes('default')),
      exactByAlternativeProbeOnly: count(row => row.coverage === 'exact' && row.coveredBy === 'alternative' && !row.matchedExtentLabels.includes('default')),
      partialComparable: count(row => row.coverage === 'partial_comparable'),
      partialByOriginal: count(row => row.coverage === 'partial_comparable' && row.coveredBy === 'original'),
      partialByAlternative: count(row => row.coverage === 'partial_comparable' && row.coveredBy === 'alternative'),
      notComparable: count(row => row.coverage === 'not_comparable'),
      uncovered: count(row => row.coverage === 'uncovered'),
      oracleHeldRoutes: count(row => row.oracleHeldRoute === true),
      oracleHeldRoutesCovered: count(row => row.oracleHeldRoute === true && (row.coverage === 'exact' || row.coverage === 'partial_comparable')),
    },
  }
}

/**
 * The C3 readiness judgement. The A / B / C rule classifies portfolio diversity and presupposes that every Conflict
 * participant was actually searched. A participant no completed Search context reached (a kernel child process that
 * ran out of memory, timed out or failed) is unmeasured, not a portfolio of size 1, so while any participant is
 * unexplored the premise of the rule is not met and the judgement fails closed as `inconclusive` instead of classifying.
 *
 * Only with every participant explored:
 * - C: fewer than half of the Conflict participant Targets have more than one portfolio Candidate;
 * - A: at least half do, and every oracle Route is covered (exact or partial comparable);
 * - B: at least half do, but some oracle Route is not covered.
 *
 * `multipleShareOverallLowerBound` counts every unexplored participant as having no alternative: it is an observed
 * lower bound, never the portfolio diversity rate. `multipleShareAmongExplored` is observed over explored participants only.
 */
export interface Phase2C2ReadinessInput {
  participantsTotal: number
  /** Participants at least one completed Search context searched. */
  participantsExplored: number
  /** Explored participants whose portfolio holds more than one Candidate. */
  participantsWithMultipleAmongExplored: number
  /** Participants whose portfolio holds more than one Candidate (an unexplored participant only ever has its original). */
  participantsWithMultipleOverall: number
  oracleRoutes: number
  oracleCovered: number
}

export const PHASE2C2_READINESS_RULE = 'inconclusive while any Conflict participant is unexplored (the A / B / C premise is not met: an OOM / timeout / failed process is unmeasured, never a portfolio of size 1); '
  + 'only when every participant is explored: C if < 1/2 of Conflict participants have portfolio > 1; else A if every oracle Route is covered (exact or partial comparable); else B'

export function phase2c2ReadinessJudgement(input: Phase2C2ReadinessInput) {
  const { participantsTotal: total, participantsExplored: explored, participantsWithMultipleAmongExplored: multipleExplored, participantsWithMultipleOverall: multipleOverall } = input
  const integers = [total, explored, multipleExplored, multipleOverall, input.oracleRoutes, input.oracleCovered]
  if (integers.some(value => !Number.isInteger(value) || value < 0) || explored > total || multipleExplored > explored || multipleOverall !== multipleExplored
    || input.oracleCovered > input.oracleRoutes) {
    throw new Error(`Inconsistent Phase 2-C2 readiness input: ${JSON.stringify(input)}`)
  }
  const participantsUnexplored = total - explored
  const shares = {
    participantsTotal: total, participantsExplored: explored, participantsUnexplored,
    participantsWithMultipleOverall: multipleOverall, participantsWithMultipleAmongExplored: multipleExplored,
    multipleShareOverallLowerBound: total === 0 ? null : multipleOverall / total,
    multipleShareOverallLowerBoundFraction: `${multipleOverall}/${total}`,
    multipleShareAmongExplored: explored === 0 ? null : multipleExplored / explored,
    multipleShareAmongExploredFraction: `${multipleExplored}/${explored}`,
    oracleRoutes: input.oracleRoutes, oracleCovered: input.oracleCovered,
    rule: PHASE2C2_READINESS_RULE,
  }
  if (participantsUnexplored > 0) {
    return { status: 'inconclusive' as const, case: null,
      reason: 'incomplete_measurement: Candidate portfolio sufficiency cannot be judged while Conflict participants are unexplored; make them measurable first.', ...shares }
  }
  const caseId = total === 0 || multipleExplored / total < 0.5 ? 'C' as const : input.oracleCovered === input.oracleRoutes ? 'A' as const : 'B' as const
  return { status: 'classified' as const, case: caseId, reason: 'every Conflict participant explored', ...shares }
}
