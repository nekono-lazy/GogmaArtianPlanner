import { afterEach, describe, expect, it, vi } from 'vitest'
import preD0A2A from '../../test/fixtures/shapeConstrainedSeamProductionGoldenPreD0A2A.json'
import {
  recordSeamCandidateSearch,
  recordSeamOrdinaryStream,
  recordSeamPlannerAlternative,
  recordSeamReservedStream,
  recordSeamStreamKeys,
  seamGoldenScenarios,
  seamOrdinaryStreamCases,
  type SeamProductionGolden,
} from '../../test/fixtures/shapeConstrainedSeamProductionGolden'
import { reservedBonusStreamCases } from '../../test/fixtures/reservedBonusStreamSinglePass'

/*
 * Issue #154 Global Assignment Phase D-0A-2a (`docs/PLANNER_GLOBAL_ASSIGNMENT_D0A2_DESIGN.md` 4.2 / 15 "Production不変"):
 * every Production caller of the Search Domain seams the Research-only shape-constrained Route search touches keeps the
 * behavior recorded ONCE on main e6da7bd before any D-0A-2a change (`shapeConstrainedSeamProductionGoldenPreD0A2A.json`,
 * never regenerated): Planner Alternative Search (delivery, summary, prediction calls, support queries, the Route bases
 * the three primitives register and their Bonus notices, the runtime observer sections, the instrumentation and the
 * cancellation / yield checkpoints), the ordinary Candidate Search (the canonical Ideal, searched / skipped Routes,
 * notices, the #104 Normal reduction), and the Bonus stream (held-aware and ordinary reads, frontier, memo, support
 * evaluation and unsupported notices, the stream keys).
 */

afterEach(() => vi.restoreAllMocks())

const golden = preD0A2A as unknown as SeamProductionGolden & { provenance: string }

describe('D-0A-2a Production golden: the recorded population', () => {
  it('records every scenario exactly once, from main e6da7bd before the change', () => {
    expect(golden.provenance).toMatch(/main e6da7bde07eec45cf29ce0e8b50114f3e728a897/)
    expect(golden.plannerAlternative.map((record) => record.name))
      .toEqual(seamGoldenScenarios.filter((scenario) => scenario.routeFilter === undefined).map((scenario) => scenario.name))
    expect(golden.candidateSearch.map((record) => record.name))
      .toEqual(seamGoldenScenarios.filter((scenario) => scenario.reservation === undefined && scenario.limit === undefined).map((scenario) => scenario.name))
    expect(golden.reservedStreams.map((record) => record.name)).toEqual(reservedBonusStreamCases.map((testCase) => testCase.name))
    expect(golden.ordinaryStreams.map((record) => record.name)).toEqual(seamOrdinaryStreamCases.map((testCase) => testCase.name))
    // The golden really exercises the touched seams: every Route kind, several conversion positions and Normal offsets,
    // unsupported notices, a consumer stop, extents and checkpoints.
    const bases = golden.plannerAlternative.flatMap((record) => record.bases)
    for (const kind of ['existing_gogma|', 'owned_normal_artian_to_gogma|', 'normal_artian_to_gogma|-|n1@null']) {
      expect(bases.some((base) => base.startsWith(kind)), kind).toBe(true)
    }
    expect(golden.plannerAlternative.find((record) => record.name === 'owned-normal:skill-held')!.bases
      .filter((base) => base.startsWith('owned_normal_artian_to_gogma')).map((base) => base.split('|')[2])).toEqual(['c7', 'c8', 'c9'])
    expect(golden.plannerAlternative.some((record) => record.notices.some((notice) => notice.includes('"unsupported"')))).toBe(true)
    expect(golden.plannerAlternative.some((record) => record.stoppedByConsumer)).toBe(true)
    expect(golden.plannerAlternative.every((record) => record.checkpoints.shouldCancel > 0)).toBe(true)
  })
})

describe('D-0A-2a Production golden: Planner Alternative Search', () => {
  it.each(golden.plannerAlternative.map((record) => [record.name, record] as const))('%s', async (name, expected) => {
    const scenario = seamGoldenScenarios.find((candidate) => candidate.name === name)!
    expect(await recordSeamPlannerAlternative(scenario)).toEqual(expected)
  })
})

describe('D-0A-2a Production golden: ordinary Candidate Search', () => {
  it.each(golden.candidateSearch.map((record) => [record.name, record] as const))('%s', async (name, expected) => {
    const scenario = seamGoldenScenarios.find((candidate) => candidate.name === name)!
    expect(await recordSeamCandidateSearch(scenario)).toEqual(expected)
  })
})

describe('D-0A-2a Production golden: Bonus stream', () => {
  it.each(golden.reservedStreams.map((record) => [record.name, record] as const))('held-aware %s', async (name, expected) => {
    const testCase = reservedBonusStreamCases.find((candidate) => candidate.name === name)!
    expect(await recordSeamReservedStream(testCase)).toEqual(expected)
  })

  it.each(golden.ordinaryStreams.map((record) => [record.name, record] as const))('%s', async (name, expected) => {
    const testCase = seamOrdinaryStreamCases.find((candidate) => candidate.name === name)!
    expect(await recordSeamOrdinaryStream(testCase)).toEqual(expected)
  })

  it('keeps every Production stream key verbatim', () => {
    expect(recordSeamStreamKeys()).toEqual(golden.streamKeys)
  })
})
