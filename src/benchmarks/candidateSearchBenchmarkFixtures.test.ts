import { describe, expect, it } from 'vitest'
import { searchCandidates } from '../domain/search/candidateSearch'
import { PRODUCTION_RNG_ENGINE_VERSION } from '../domain/rng/production/productionRngEngine'
import { REFERENCE_GROUP_SKILL_POOL } from '../domain/rng/production/referenceSkillPools'
import { REFERENCE_GOGMA_RESET_CANDIDATES } from '../domain/rng/production/referenceGogmaBonuses'
import type { RouteKind } from '../domain/models/publicTypes'
import { evaluateSkillCondition, validateTargetIdealImpliesPractical } from '../domain/target'
import { createProductionSearchRngEngine } from '../workers/search.worker.production'
import {
  candidateSearchBenchmarkWorkload,
  candidateSearchBenchmarkWorkloads,
  createCandidateSearchBenchmarkInput,
} from './candidateSearchBenchmarkFixtures'

describe('B5 Candidate Search benchmark fixtures', () => {
  it('exposes unique workload ids and positive documented bounds', () => {
    const ids = candidateSearchBenchmarkWorkloads.map(({ id }) => id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const workload of candidateSearchBenchmarkWorkloads) {
      expect(workload.settings.maxNormalAdvance).toBeGreaterThanOrEqual(1)
      expect(workload.settings.maxGogmaAdvance).toBeGreaterThanOrEqual(1)
      expect(workload.settings.maxSkillAdvance).toBeGreaterThanOrEqual(1)
    }
    expect(() => candidateSearchBenchmarkWorkload('missing')).toThrow(RangeError)
  })

  it('builds a Production-supported input for every workload', () => {
    for (const workload of candidateSearchBenchmarkWorkloads) {
      const { input } = createCandidateSearchBenchmarkInput(workload.id, `test.${workload.id}`)
      expect(input.calculationContext.rngEngineVersion).toBe(PRODUCTION_RNG_ENGINE_VERSION)
      expect(input.rngState.baseSeed.isConfirmed).toBe(true)
      expect(input.rngState.skillCounter.isConfirmed).toBe(true)
      expect(input.rngState.gogmaCounter.isConfirmed).toBe(true)
      // Legacy Counter Gate stays unconfirmed; it is not prediction authority.
      expect(input.rngState.counterGate.value).toBeNull()
      expect(input.settings).toEqual(workload.settings)
    }
  })

  it('keeps every workload Target inside the Ideal implies Practical containment', () => {
    for (const workload of candidateSearchBenchmarkWorkloads) {
      const { input } = createCandidateSearchBenchmarkInput(workload.id, `test.${workload.id}`)
      const containment = validateTargetIdealImpliesPractical(
        input.targetWeapons[0],
        input.master,
      )
      expect(containment.isValid).toBe(true)
    }
  })

  it('produces the same input for the same workload id', () => {
    const first = createCandidateSearchBenchmarkInput('bonus_depth_8_default_bounds', 'run.a')
    const second = createCandidateSearchBenchmarkInput('bonus_depth_8_default_bounds', 'run.b')
    expect({ ...second.input, searchRunId: 'run.a' }).toEqual(first.input)
  })

  it('uses an Ideal the Production streams provably cannot reach for the no-Ideal workloads', () => {
    const { input } = createCandidateSearchBenchmarkInput('no_ideal_gogma_10', 'test.unreachable')
    const target = input.targetWeapons[0]
    // No Reset or Keep result can carry a bonus outside the reference table.
    const reachable = new Set(
      REFERENCE_GOGMA_RESET_CANDIDATES.map(
        ({ bonus }) => `${bonus.bonusTypeId}\u0000${bonus.bonusRankId}`,
      ),
    )
    for (const bonus of target.idealBonuses) {
      expect(reachable.has(`${bonus.bonusTypeId}\u0000${bonus.bonusRankId}`)).toBe(false)
      expect(bonus.bonusRankId).not.toBe('bonus_rank.base')
    }
    // Skill prediction only ever returns members of the reference pool.
    expect(target.idealSkillCondition.groupSkillId).not.toBeNull()
    expect(REFERENCE_GROUP_SKILL_POOL).not.toContain(target.idealSkillCondition.groupSkillId)
  })

  it('never anchors a reachable Ideal on the normal-scope conversion output', () => {
    // SEARCH_SPEC 5.1 requires `finalBonusScope = "gogma_artian"` for an Ideal,
    // and a bare conversion keeps the inherited `normal_artian` slots.
    for (const workload of candidateSearchBenchmarkWorkloads) {
      expect(['gogma_reset', 'owned_gogma_current', 'unreachable']).toContain(
        workload.ideal.bonuses.kind,
      )
    }
  })

  it('gives the Owned Gogma workload a Production-supported Gogma-scope source', () => {
    const { input } = createCandidateSearchBenchmarkInput(
      'skill_depth_8_default_bounds',
      'test.owned',
    )
    const source = input.ownedWeapons[0]
    expect(input.ownedWeapons).toHaveLength(1)
    expect(source.kind).toBe('gogma')
    expect(source.restorationBonusScope).toBe('gogma_artian')
    expect(source.isProtected).toBe(false)
    // Its current bonuses are already the Ideal, so the Bonus stream stops at 0.
    expect(source.restorationBonuses).toEqual(input.targetWeapons[0].idealBonuses)
    // Every slot must be a reference Keep family member for Production support.
    const engine = createProductionSearchRngEngine()
    expect(
      engine.getPredictionSupport({
        type: 'gogma_keep',
        weaponTypeId: source.weaponTypeId,
        elementId: source.elementId,
        currentBonuses: source.restorationBonuses,
      }),
    ).toEqual({ supported: true })
  })

  it('first reaches the Owned Gogma Ideal Skill at Reset Skills depth 8', () => {
    const { input } = createCandidateSearchBenchmarkInput(
      'skill_depth_8_default_bounds',
      'test.skill-depth',
    )
    const target = input.targetWeapons[0]
    const source = input.ownedWeapons[0]
    const engine = createProductionSearchRngEngine()
    const start = input.rngState.skillCounter.value as number
    const satisfies = (
      seriesSkillId: string | null,
      groupSkillId: string | null,
    ) => evaluateSkillCondition(target.idealSkillCondition, seriesSkillId, groupSkillId)

    // Depth 0 is the source's current Skill, which must not already be Ideal.
    expect(satisfies(source.seriesSkillId, source.groupSkillId)).toBe(false)
    // Reset Skills depth k reads Skill Counter `start + k - 1`.
    for (let depth = 1; depth <= 7; depth += 1) {
      const skills = engine.predictSkills({
        baseSeed: input.rngState.baseSeed.value as string,
        weaponTypeId: target.weaponTypeId,
        elementId: target.elementId,
        skillCounter: start + depth - 1,
        master: input.master,
      })
      expect(satisfies(skills.seriesSkillId, skills.groupSkillId)).toBe(false)
    }
    const atDepthEight = engine.predictSkills({
      baseSeed: input.rngState.baseSeed.value as string,
      weaponTypeId: target.weaponTypeId,
      elementId: target.elementId,
      skillCounter: start + 7,
      master: input.master,
    })
    expect(satisfies(atDepthEight.seriesSkillId, atDepthEight.groupSkillId)).toBe(true)
  })

  it('reaches the documented canonical Ideal with a Gogma-scope result', async () => {
    const expectedRouteKinds: Record<string, RouteKind> = {
      near_ideal_default_bounds: 'normal_artian_to_gogma',
      skill_depth_8_default_bounds: 'existing_gogma_reset_skills',
      bonus_depth_8_default_bounds: 'normal_artian_to_gogma',
    }
    for (const id of [
      'near_ideal_default_bounds',
      'skill_depth_8_default_bounds',
      'bonus_depth_8_default_bounds',
      'no_ideal_gogma_10',
    ]) {
      const { input, workload } = createCandidateSearchBenchmarkInput(id, `test.ideal.${id}`)
      const result = await searchCandidates(input, createProductionSearchRngEngine())
      const ideal = result.targetResults[0].candidates.filter(
        ({ category }) => category === 'ideal',
      )
      if (workload.expectedIdealOperationCount === null) {
        expect(ideal).toHaveLength(0)
        continue
      }
      expect(ideal).toHaveLength(1)
      expect(ideal[0].estimatedOperationCount).toBe(workload.expectedIdealOperationCount)
      // A `category === 'ideal'` assertion alone would accept the normal-scope
      // classification defect recorded in the B5 benchmark document.
      expect(ideal[0].restorationBonusScope).toBe('gogma_artian')
      expect(ideal[0].route.kind).toBe(expectedRouteKinds[id])
    }
  }, 60_000)
})
