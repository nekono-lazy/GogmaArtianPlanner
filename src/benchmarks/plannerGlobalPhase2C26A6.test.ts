import { beforeAll, describe, expect, it } from 'vitest'
import rawC26a from '../../docs/PLANNER_GLOBAL_PHASE2C26A_RESULT.json?raw'
import rawA2 from '../../docs/PLANNER_GLOBAL_PHASE2C26A2_RESULT.json?raw'
import rawA3 from '../../docs/PLANNER_GLOBAL_PHASE2C26A3_RESULT.json?raw'
import rawA4 from '../../docs/PLANNER_GLOBAL_PHASE2C26A4_RESULT.json?raw'
import rawA5 from '../../docs/PLANNER_GLOBAL_PHASE2C26A5_RESULT.json?raw'
import { parsePhase2C26AAuthority, type Phase2C26A2Authority, type Phase2C26A2RunConditions } from './plannerGlobalPhase2C26A2'
import { parsePhase2C26A2ResultAuthority, type Phase2C26A3A2Authority } from './plannerGlobalPhase2C26A3'
import { parsePhase2C26A3ResultAuthority, PHASE2C26A4_SEARCH_INSTRUMENTATION, type Phase2C26A4A3Authority } from './plannerGlobalPhase2C26A4'
import type { Phase2C26A4OrientationAnalysis } from './plannerGlobalPhase2C26A4Analysis'
import { parsePhase2C26A4ResultAuthority, type Phase2C26A5A4Authority } from './plannerGlobalPhase2C26A5'
import {
  isPhase2C26A6ResearchOrTestSource,
  parsePhase2C26A5ResultAuthority,
  PHASE2C26A6_NODE_FLAGS,
  PHASE2C26A6_PRODUCTION_CHANGE,
  PHASE2C26A6_SEARCH_INSTRUMENTATION,
  readPhase2C26A6Before,
  validatePhase2C26A6ConditionParity,
  validatePhase2C26A6ProductionChange,
  type Phase2C26A6Before,
} from './plannerGlobalPhase2C26A6'
import {
  comparePhase2C26A6Orientation,
  comparePhase2C26A6WorkPrefix,
  phase2c26a6Decision,
  PHASE2C26A6_DECISION_RULE,
  type Phase2C26A6Comparison,
} from './plannerGlobalPhase2C26A6Analysis'

/*
 * Issue #154 Phase 2-C2.6-A6. The Production change is `areRestorationBonusSetsEqual()` alone (its semantics are fixed in
 * src/domain/models/restorationBonusMultisetEquality.test.ts). Here: the committed A5 / A4 / A3 / A2 / C2.6-A RESULTs as
 * fail-closed authorities, the registered Production change guard, the A5 condition parity, the semantic work prefix
 * parity against A4 and the pre-registered decision rule, on the committed evidence and synthetic records. No duration is
 * asserted.
 */

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}
const c26aJson = JSON.parse(rawC26a), a2Json = JSON.parse(rawA2), a3Json = JSON.parse(rawA3), a4Json = JSON.parse(rawA4), a5Json = JSON.parse(rawA5)
let shas = { c26a: '', a2: '', a3: '', a4: '' }
beforeAll(async () => { shas = { c26a: await sha256Hex(rawC26a), a2: await sha256Hex(rawA2), a3: await sha256Hex(rawA3), a4: await sha256Hex(rawA4) } })

function authorities(): { c26a: Phase2C26A2Authority; a2: Phase2C26A3A2Authority; a3: Phase2C26A4A3Authority; a4: Phase2C26A5A4Authority } {
  const c26a = parsePhase2C26AAuthority(c26aJson)
  if (!c26a.authority) throw new Error(c26a.issues.join('; '))
  const a2 = parsePhase2C26A2ResultAuthority(a2Json, shas.c26a, c26a.authority)
  if (!a2.authority) throw new Error(a2.issues.join('; '))
  const a3 = parsePhase2C26A3ResultAuthority(a3Json, shas.c26a, shas.a2, a2.authority, c26a.authority)
  if (!a3.authority) throw new Error(a3.issues.join('; '))
  const a4 = parsePhase2C26A4ResultAuthority(a4Json, { c26a: shas.c26a, a2: shas.a2, a3: shas.a3 }, a3.authority, c26a.authority)
  if (!a4.authority) throw new Error(a4.issues.join('; '))
  return { c26a: c26a.authority, a2: a2.authority, a3: a3.authority, a4: a4.authority }
}

describe('Phase 2-C2.6-A5 RESULT as the optimization and selection authority', () => {
  it('accepts the committed formal A5 RESULT (Case MULTISET) made against the committed A4 / A3 / A2 / C2.6-A RESULTs and takes its selection', () => {
    const { c26a, a4 } = authorities()
    const parsed = parsePhase2C26A5ResultAuthority(a5Json, shas, a4, c26a)
    expect(parsed.issues).toEqual([])
    expect(parsed.authority?.decisionCase).toBe('MULTISET_multiset_equality')
    // Evidence check (not a source constant): the committed A5 selection is the A4 one.
    expect(parsed.authority?.primaryOrientationIds).toEqual(a4.primaryOrientationIds)
    expect(parsed.authority?.primaryOrientationIds).toEqual(['c6-p1', 'c13-p1', 'c14-p0'])
    for (const reference of parsed.authority?.references ?? []) expect(reference.multisetShare).toBeGreaterThanOrEqual(0.35)
  })

  it('fails closed on a non-formal A5, another decision, a primary below the multiset threshold, a broken SHA chain or another selection', () => {
    const { c26a, a4 } = authorities()
    const mutate = (edit: (json: typeof a5Json) => void) => { const json = structuredClone(a5Json); edit(json); return parsePhase2C26A5ResultAuthority(json, shas, a4, c26a) }
    const zero = '0'.repeat(64)
    for (const key of ['c26a', 'a2', 'a3', 'a4'] as const) expect(parsePhase2C26A5ResultAuthority(a5Json, { ...shas, [key]: zero }, a4, c26a).valid).toBe(false)
    expect(parsePhase2C26A5ResultAuthority(a5Json, shas, { ...a4, primaryOrientationIds: ['c6-p1', 'c13-p1', 'c20-p1'] }, c26a).valid).toBe(false)
    expect(parsePhase2C26A5ResultAuthority(a5Json, shas, { ...a4, measuredHead: '0'.repeat(40) }, c26a).valid).toBe(false)
    expect(mutate(json => { json.provenance.formal = false }).valid).toBe(false)
    expect(mutate(json => { json.formalSeriesValidation.valid = false }).valid).toBe(false)
    expect(mutate(json => { json.summary.decision.case = 'RANK_rank_reference_validation' }).valid).toBe(false)
    expect(mutate(json => { json.summary.childStatus.timeout = 2; json.summary.childStatus.completed = 1 }).valid).toBe(false)
    expect(mutate(json => { json.perPrimary[1].decisionRow.shares.multiset_equality = 0.2 }).valid).toBe(false)
    expect(mutate(json => { json.perPrimary[0].decisionRow.valid = false }).valid).toBe(false)
    expect(mutate(json => { json.provenance.authorityShaChain.a4ChainRecordedByA4.a2ShaRecordedByA3 = zero }).valid).toBe(false)
    expect(mutate(json => { json.sources.c26a4Result.sha256 = zero }).valid).toBe(false)
    expect(mutate(json => { json.selectionValidation.expected = ['c6-p1', 'c13-p1'] }).valid).toBe(false)
    expect(mutate(json => { json.perPrimary = [json.perPrimary[1], json.perPrimary[0], json.perPrimary[2]] }).valid).toBe(false)
    expect(parsePhase2C26A5ResultAuthority(null, shas, a4, c26a).valid).toBe(false)
  })
})

describe('Phase 2-C2.6-A6 registered Production change', () => {
  it('accepts exactly the registered Production file, ignoring Research and test sources', () => {
    expect(PHASE2C26A6_PRODUCTION_CHANGE).toEqual(['src/domain/models/domainRules.ts'])
    const valid = validatePhase2C26A6ProductionChange([
      'src/benchmarks/plannerGlobalPhase2C26A6.ts', 'src/domain/models/domainRules.ts', 'src/domain/models/restorationBonusMultisetEquality.test.ts', 'src/test/fixtures/x.ts',
    ])
    expect(valid.issues).toEqual([])
    expect(valid.productionChanged).toEqual(['src/domain/models/domainRules.ts'])
    expect(isPhase2C26A6ResearchOrTestSource('src/domain/target/targetEvaluator.test.tsx')).toBe(true)
    expect(isPhase2C26A6ResearchOrTestSource('src/domain/target/targetEvaluator.ts')).toBe(false)
  })

  it('fails closed on another Production change, a missing optimization or a path outside src', () => {
    expect(validatePhase2C26A6ProductionChange(['src/domain/models/domainRules.ts', 'src/domain/target/targetEvaluator.ts']).valid).toBe(false)
    expect(validatePhase2C26A6ProductionChange(['src/benchmarks/plannerGlobalPhase2C26A6.ts']).valid).toBe(false)
    expect(validatePhase2C26A6ProductionChange([]).valid).toBe(false)
    expect(validatePhase2C26A6ProductionChange(['src/domain/models/domainRules.ts', 'docs/SEARCH_SPEC.md']).valid).toBe(false)
  })
})

describe('Phase 2-C2.6-A6 conditions and the A4 "before"', () => {
  it('accepts the A5 primary conditions and rejects another budget, heap flag or instrumentation', () => {
    const { c26a, a2, a3, a4 } = authorities()
    const current = { ...(a5Json.conditions as Phase2C26A2RunConditions), nodeFlags: [...PHASE2C26A6_NODE_FLAGS] }
    const valid = validatePhase2C26A6ConditionParity(current, a5Json.conditions, a4.conditions, a3.conditions, c26a, a2.conditions)
    expect(valid.issues).toEqual([])
    expect(PHASE2C26A6_SEARCH_INSTRUMENTATION).toEqual(PHASE2C26A4_SEARCH_INSTRUMENTATION)
    expect(validatePhase2C26A6ConditionParity({ ...current, orientationBudgetMs: 3_600_000 }, a5Json.conditions, a4.conditions, a3.conditions, c26a, a2.conditions).valid).toBe(false)
    expect(validatePhase2C26A6ConditionParity({ ...current, nodeFlags: ['--max-old-space-size=4096'] }, a5Json.conditions, a4.conditions, a3.conditions, c26a, a2.conditions).valid).toBe(false)
    expect(validatePhase2C26A6ConditionParity({ ...current, extent: { maxNormalAdvance: 4, maxGogmaAdvance: 300, maxSkillAdvance: 4 } }, a5Json.conditions, a4.conditions, a3.conditions,
      c26a, a2.conditions).valid).toBe(false)
    const otherInstrumentation = { ...a5Json.conditions, searchInstrumentation: { ...PHASE2C26A4_SEARCH_INSTRUMENTATION, onGogmaReservedRuntime: true } }
    expect(validatePhase2C26A6ConditionParity(current, otherInstrumentation, a4.conditions, a3.conditions, c26a, a2.conditions).valid).toBe(false)
  })

  it('reads the A4 formal rows of the A5 primaries and fails closed on a missing or malformed row', () => {
    const primaries = ['c6-p1', 'c13-p1', 'c14-p0']
    const before = readPhase2C26A6Before(a4Json, primaries)
    expect(before.issues).toEqual([])
    expect(before.rows.map(row => row.orientationId)).toEqual(primaries)
    for (const row of before.rows) {
      expect(row.childOutcome).toBe('timeout')
      expect(row.searchCompleted).toBe(false)
      expect(row.rawSolutions).toBeGreaterThan(0)
      expect(row.categoryShare.bonus_ideal_filter).toBeGreaterThan(0.1)
    }
    expect(readPhase2C26A6Before(a4Json, [...primaries, 'c20-p1']).valid).toBe(false)
    const broken = structuredClone(a4Json)
    delete broken.perOrientation[0].bonusWork
    expect(readPhase2C26A6Before(broken, primaries).valid).toBe(false)
  })
})

// ---------------------------------------------------------------- work prefix

const workRecord = (seq: number, channel: number, depth: number, rawSolutions: number, filterMs: number, readMs: number, startedMs: number, section = 'bonus_depth_work') => ({
  kind: 'search_work_summary', seq, targetOrdinal: 0, section, work: { channel, depth },
  counts: { rawSolutions, unsupportedPredictions: 0, idealSolutions: 0, evaluatedSolutions: 0, subscriberCount: 1, retainedCountAfter: 0, exhausted: false },
  inclusiveMs: filterMs + readMs, phaseMs: { bonus_depth_read: readMs, bonus_ideal_filter: filterMs, bonus_notice_scan: 0 }, startedMs, completedMs: startedMs + filterMs + readMs,
})
const kernelOf = (records: unknown[]) => ({ runtime: [{ kind: 'search_section_started', seq: 1 }, ...records] })

describe('Phase 2-C2.6-A6 work prefix (semantic parity and like-for-like cost)', () => {
  it('compares the common prefix: equal identities and counts, phase totals over identical raw solutions, span ratio', () => {
    const before = kernelOf([workRecord(3, 0, 1, 100, 10, 20, 0), workRecord(4, 1, 1, 300, 30, 60, 100), workRecord(5, 0, 2, 50, 5, 10, 300)])
    // After: faster filter, one more work, other seq numbers and times (records are ordered by seq, compared by identity).
    const after = kernelOf([workRecord(7, 0, 1, 100, 2, 20, 0), workRecord(9, 1, 1, 300, 6, 60, 50), workRecord(11, 0, 2, 50, 1, 10, 150), workRecord(12, 1, 2, 70, 1, 1, 200)])
    const prefix = comparePhase2C26A6WorkPrefix(before, after)
    expect(prefix.issues).toEqual([])
    expect(prefix).toMatchObject({ valid: true, beforeWorks: 3, afterWorks: 4, commonWorks: 3, commonBonusWorks: 3, commonRawSolutions: 450, afterCoversBefore: true, firstMismatch: null })
    expect(prefix.phaseTotalsMs.bonus_ideal_filter).toMatchObject({ before: 45, after: 9, ratio: 0.2 })
    expect(prefix.phaseTotalsMs.bonus_ideal_filter.beforeNsPerRawSolution).toBe(100_000)
    expect(prefix.phaseTotalsMs.bonus_depth_read).toMatchObject({ before: 90, after: 90, ratio: 1 })
    expect(prefix.prefixSpanMs).toEqual({ before: 315, after: 161, ratio: 0.5111 })
  })

  it('fails closed when a common work differs in identity or counts, or nothing is common', () => {
    const before = kernelOf([workRecord(3, 0, 1, 100, 10, 20, 0), workRecord(4, 1, 1, 300, 30, 60, 100)])
    const countsDiffer = comparePhase2C26A6WorkPrefix(before, kernelOf([workRecord(3, 0, 1, 100, 1, 20, 0), workRecord(4, 1, 1, 301, 3, 60, 100)]))
    expect(countsDiffer.valid).toBe(false)
    expect(countsDiffer.firstMismatch?.index).toBe(1)
    const orderDiffers = comparePhase2C26A6WorkPrefix(before, kernelOf([workRecord(3, 1, 1, 300, 3, 60, 0), workRecord(4, 0, 1, 100, 1, 20, 100)]))
    expect(orderDiffers.firstMismatch?.index).toBe(0)
    const sectionDiffers = comparePhase2C26A6WorkPrefix(before, kernelOf([workRecord(3, 0, 1, 100, 1, 20, 0, 'skill_depth_work')]))
    expect(sectionDiffers.valid).toBe(false)
    expect(comparePhase2C26A6WorkPrefix(before, kernelOf([])).valid).toBe(false)
    expect(comparePhase2C26A6WorkPrefix(null, before).valid).toBe(false)
  })
})

// ---------------------------------------------------------------- decision

function comparison(orientationId: string, filterRatio: number | null, completed: boolean): Phase2C26A6Comparison {
  return { orientationId, searchCompleted: { before: false, after: completed }, prefix: { filterRatio } } as unknown as Phase2C26A6Comparison
}

describe('Phase 2-C2.6-A6 pre-registered decision', () => {
  it('evaluates C, then R, then F, then M with majority 2 of 3', () => {
    expect(PHASE2C26A6_DECISION_RULE).toMatchObject({ majority: 2, filterReducedRatio: 0.5 })
    expect(phase2c26a6Decision([comparison('a', 0.2, true), comparison('b', 0.9, true), comparison('c', 0.2, false)]).case).toBe('C_primary_search_completed')
    expect(phase2c26a6Decision([comparison('a', 0.2, true), comparison('b', 0.5, false), comparison('c', 0.9, false)]).case).toBe('R_filter_reduced_timeout_remains')
    expect(phase2c26a6Decision([comparison('a', 0.2, false), comparison('b', 0.51, false), comparison('c', 0.9, false)]).case).toBe('F_filter_improvement_small')
    expect(phase2c26a6Decision([comparison('a', 0.2, false), comparison('b', 0.9, false), comparison('c', null, false)]).case).toBe('M_mixed')
    expect(phase2c26a6Decision([comparison('a', 0.2, false), comparison('b', 0.2, false)]).case).toBe('M_mixed')
  })

  it('builds a comparison row from the A4-style after analysis, the A4 before row and the prefix', () => {
    const before = readPhase2C26A6Before(a4Json, ['c6-p1']).rows[0] as Phase2C26A6Before
    const prefix = comparePhase2C26A6WorkPrefix(kernelOf([workRecord(3, 0, 1, 100, 10, 20, 0)]), kernelOf([workRecord(3, 0, 1, 100, 2, 20, 0)]))
    const totals = { ...before.categoryTotalsMs, bonus_ideal_filter: 100, bonus_depth_read: 900, bonus_notice_scan: 10 }
    const after = {
      orientationId: 'c6-p1', childOutcome: 'timeout', resultClass: 'timeout_in_search',
      primarySearch: { completed: false, searchWallMs: 1000, coverage: 1, maxCategory: 'bonus_depth_read', categoryTotalsMs: totals,
        categoryShare: { ...before.categoryShare, bonus_ideal_filter: 0.1, bonus_depth_read: 0.9, bonus_notice_scan: 0.01 },
        bonusDepth: { rawSolutions: 1_000_000, idealSolutions: 0, works: 10 } },
      counters: { deliveredCandidates: 0, trialsStarted: 0, fullPlannerRunsStarted: 0 },
      bonusWork: { nsPerRawSolution: { bonus_ideal_filter: { median: 100 }, bonus_depth_read: { median: 900 } } },
      predictionCounts: {}, memory: {},
    } as unknown as Phase2C26A4OrientationAnalysis
    const row = comparePhase2C26A6Orientation(after, before, prefix)
    expect(row.prefix.filterRatio).toBe(0.2)
    expect(row.semanticFailures).toBe(0)
    expect(row.budget.bonus_ideal_filter).toMatchObject({ afterMs: 100, afterShare: 0.1, afterNsPerRawSolution: 100, afterMedianNsPerRawSolution: 100 })
    expect(row.budget.bonus_ideal_filter.beforeMedianNsPerRawSolution).toBe(before.bonusIdealFilterMedianNsPerRawSolution)
    expect(row.rawSolutions.after).toBe(1_000_000)
    expect(row.outcome).toEqual({ before: 'timeout', after: 'timeout' })
  })
})
