import type {
  BuildCandidate,
  OwnedGogmaArtianWeapon,
  OwnedNormalArtianWeapon,
  OwnedWeapon,
  OwnedWeaponId,
  RestorationBonusSet,
  RouteOperation,
  SkillAmendmentResult,
  TargetWeapon,
} from '../../domain/models/publicTypes'
import { CURRENT_CALCULATION_APP_SCHEMA_VERSION } from '../../domain/models/publicTypes'
import type { SearchMasterSubset } from '../../domain/search'
import { extractIntermediateStateGroups } from '../../domain/search'
import {
  candidateId,
  createValidOwnedWeapon,
  createValidTargetWeapon,
  ownedWeaponId,
  targetWeaponId,
} from './domainData'
import { restorationBonus, restorationBonusSet, targetEvaluationMaster } from './targetEvaluation'

/**
 * Deterministic fixtures for the canonical Ideal Route plus axis-separated
 * intermediate state model (`docs/SEARCH_SPEC.md` 5.8).
 *
 * Every Candidate here is built by hand from recorded observational traces, so
 * intermediate state extraction can be exercised without an RNG Engine at all
 * - which is itself part of the contract: extraction is a pure replay.
 */

export const CHECKPOINT_SOURCE_ID = ownedWeaponId('owned.checkpoint.source')
export const CHECKPOINT_START_GOGMA_COUNTER = 10
export const CHECKPOINT_START_SKILL_COUNTER = 7

const ATTACK = 'bonus_type.fixture.attack'
const ELEMENT = 'bonus_type.fixture.element'
const UTILITY = 'bonus_type.fixture.utility'
const SHARPNESS = 'bonus_type.fixture.sharpness'
const LOW = 'bonus_rank.fixture.low'
const MIDDLE = 'bonus_rank.fixture.middle'
const HIGH = 'bonus_rank.fixture.high'

/** The fixture Target's Ideal Skills: the Ideal Series Skill, no Group Skill. */
export const CHECKPOINT_IDEAL_SKILL: SkillAmendmentResult = {
  seriesSkillId: 'series_skill.fixture.a',
  groupSkillId: null,
}
/** Satisfies the fixture Target's Practical Skill condition (`any` of series a / group a). */
export const CHECKPOINT_PRACTICAL_SKILL: SkillAmendmentResult = {
  seriesSkillId: null,
  groupSkillId: 'group_skill.fixture.a',
}
/** Satisfies neither Skill condition. */
export const CHECKPOINT_MISMATCH_SKILL: SkillAmendmentResult = {
  seriesSkillId: 'series_skill.fixture.other',
  groupSkillId: null,
}

/** The fixture Target's Ideal five slots. */
export function checkpointIdealBonuses(): RestorationBonusSet {
  return restorationBonusSet(
    restorationBonus(ATTACK, HIGH),
    restorationBonus(ATTACK, HIGH),
    restorationBonus(ELEMENT, MIDDLE),
    restorationBonus(UTILITY, LOW),
    restorationBonus(SHARPNESS, HIGH),
  )
}

/** Ideal types and counts with the Sharpness rank relaxed: a Practical match. */
export function checkpointPracticalBonuses(): RestorationBonusSet {
  return restorationBonusSet(
    restorationBonus(ATTACK, HIGH),
    restorationBonus(ATTACK, HIGH),
    restorationBonus(ELEMENT, MIDDLE),
    restorationBonus(UTILITY, LOW),
    restorationBonus(SHARPNESS, LOW),
  )
}

/** The same five labels as `checkpointPracticalBonuses`, in another slot order. */
export function checkpointPracticalBonusesReordered(): RestorationBonusSet {
  return restorationBonusSet(
    restorationBonus(SHARPNESS, LOW),
    restorationBonus(ATTACK, HIGH),
    restorationBonus(UTILITY, LOW),
    restorationBonus(ELEMENT, MIDDLE),
    restorationBonus(ATTACK, HIGH),
  )
}

/** The same Bonus Types with one strictly higher rank: a display-dominating state. */
export function checkpointStrongerPracticalBonuses(): RestorationBonusSet {
  return restorationBonusSet(
    restorationBonus(ATTACK, HIGH),
    restorationBonus(ATTACK, HIGH),
    restorationBonus(ELEMENT, MIDDLE),
    restorationBonus(UTILITY, LOW),
    restorationBonus(SHARPNESS, MIDDLE),
  )
}

/** Sharpness replaced by Utility through the Target's Alternative Rule. */
export function checkpointAlternativeBonuses(): RestorationBonusSet {
  return restorationBonusSet(
    restorationBonus(ATTACK, HIGH),
    restorationBonus(ATTACK, HIGH),
    restorationBonus(ELEMENT, MIDDLE),
    restorationBonus(UTILITY, LOW),
    restorationBonus(UTILITY, LOW),
  )
}

/** Satisfies neither the Ideal nor any compromise condition. */
export function checkpointBelowPracticalBonuses(): RestorationBonusSet {
  return restorationBonusSet(
    restorationBonus(UTILITY, LOW),
    restorationBonus(UTILITY, LOW),
    restorationBonus(UTILITY, LOW),
    restorationBonus(UTILITY, LOW),
    restorationBonus(UTILITY, LOW),
  )
}

const bonusTypeIds = [ATTACK, ELEMENT, UTILITY, SHARPNESS]
const bonusRankIds = [LOW, MIDDLE, HIGH]

/**
 * A Master subset that can actually rank every fixture bonus.
 *
 * The conservative display dominance refuses to compare a state whose Master
 * reference is missing, disabled, or unavailable for the weapon type, so these
 * definitions have to exist for a dominance test to mean anything.
 */
export function checkpointMaster(): SearchMasterSubset {
  return {
    weaponTypes: [],
    elements: [],
    bonusTypes: bonusTypeIds.map((id) => ({
      id,
      displayNameJa: id,
      displayNameEn: id,
      sortOrder: 1,
      category: 'utility' as const,
      isEnabled: true,
    })),
    bonusRanks: targetEvaluationMaster.bonusRanks.map((rank) => ({ ...rank })),
    artianBonusTypeMappings: [],
    weaponBonusDefinitions: bonusTypeIds.flatMap((bonusTypeId) =>
      bonusRankIds.map((bonusRankId) => ({
        id: `weapon_bonus.checkpoint.${bonusTypeId}.${bonusRankId}`,
        weaponTypeId: 'weapon.fixture.a',
        bonusTypeId,
        bonusRankId,
        scope: 'gogma_artian' as const,
        displayNameJa: `${bonusTypeId} ${bonusRankId}`,
        displayNameEn: `${bonusTypeId} ${bonusRankId}`,
        effectValue: 'fixture-only',
        sortOrder: 1,
        isEnabled: true,
      })),
    ),
    materialCosts: [],
  }
}

export function checkpointTarget(): TargetWeapon {
  return createValidTargetWeapon()
}

/** An unprotected Gogma source that already carries the Ideal Series Skill. */
export function checkpointSource(
  id: OwnedWeaponId = CHECKPOINT_SOURCE_ID,
): OwnedGogmaArtianWeapon {
  const source = createValidOwnedWeapon(id) as OwnedGogmaArtianWeapon
  source.restorationBonusScope = 'gogma_artian'
  source.restorationBonuses = checkpointBelowPracticalBonuses()
  source.seriesSkillId = 'series_skill.fixture.a'
  source.groupSkillId = null
  source.isProtected = false
  return source
}

/** An unprotected owned Normal Artian weapon with five normal-scope slots. */
export function checkpointNormalSource(
  id: OwnedWeaponId = ownedWeaponId('owned.checkpoint.normal'),
): OwnedNormalArtianWeapon {
  return {
    id,
    kind: 'normal',
    name: 'Checkpoint fixture Normal',
    weaponTypeId: 'weapon.fixture.a',
    elementId: 'element.fixture.a',
    rarity: 8,
    restorationBonuses: checkpointIdealBonuses(),
    restorationBonusScope: 'normal_artian',
    seriesSkillId: null,
    groupSkillId: null,
    status: null,
    isProtected: false,
    executionInProgress: null,
    memo: null,
    createdAt: '2026-09-10T00:00:00.000Z',
    updatedAt: '2026-09-10T00:00:00.000Z',
  }
}

export interface CheckpointCandidateOptions {
  sourceOwnedWeaponId?: OwnedWeaponId
  candidateId?: string
  targetWeaponId?: string
}

function baseCandidate(
  options: CheckpointCandidateOptions,
  route: BuildCandidate['route'],
  finalBonuses: RestorationBonusSet,
  restorationBonusScope: BuildCandidate['restorationBonusScope'],
  skills: SkillAmendmentResult,
): BuildCandidate {
  const operations = route.operations
  return {
    id: candidateId(options.candidateId ?? 'candidate.checkpoint.a'),
    targetWeaponId: targetWeaponId(options.targetWeaponId ?? 'target.fixture.a'),
    finalBonuses: structuredClone(finalBonuses),
    restorationBonusScope,
    seriesSkillId: skills.seriesSkillId,
    groupSkillId: skills.groupSkillId,
    route,
    estimatedOperationCount: operations.reduce(
      (total, operation) => total + (operation.type === 'create_normal_artian' ? operation.count : 1),
      0,
    ),
    estimatedGogmaAdvance: operations.filter(
      ({ type }) => type === 'reset_bonuses' || type === 'keep_bonuses',
    ).length,
    estimatedSkillAdvance: operations.filter(
      ({ type }) => type === 'reset_skills' || type === 'convert_normal_to_gogma',
    ).length,
    estimatedNormalAdvance: operations.some(({ type }) => type === 'create_normal_artian') ? 1 : null,
    requiredMaterials: [],
    idealDifference: {
      missingBonuses: [],
      extraBonuses: [],
      matchedBonusCount: 5,
      seriesSkillMatches: true,
      groupSkillMatches: true,
      summary: 'Checkpoint fixture only.',
    },
    searchRunId: 'search-run.checkpoint',
    searchStateHash: 'hash.checkpoint.search-state',
    referencedOwnedWeaponsHash: route.sourceOwnedWeaponId === null ? null : 'hash.checkpoint.owned',
    calculationContext: {
      gameVersion: 'fixture-only',
      masterDataVersion: 1,
      rngEngineVersion: 'fake-fixture:checkpoint',
      appSchemaVersion: CURRENT_CALCULATION_APP_SCHEMA_VERSION,
    },
    createdAt: '2026-09-10T00:00:00.000Z',
    intermediateStateGroups: [],
  }
}

function attachIntermediateStates(
  candidate: BuildCandidate,
  ownedWeapons: readonly OwnedWeapon[],
): BuildCandidate {
  candidate.intermediateStateGroups = extractIntermediateStateGroups(candidate, {
    target: { ...checkpointTarget(), id: candidate.targetWeaponId },
    master: checkpointMaster(),
    ownedWeapons,
  })
  return candidate
}

/**
 * A canonical Ideal Candidate whose Route is one Reset Bonuses per entry of
 * `results`, with `results[i]` recorded as the observed result of operation
 * `i`. The source already holds the Ideal Series Skill, so every Bonus lane
 * position differs from the Ideal on the Bonus axis alone.
 */
export function checkpointCandidate(
  results: readonly RestorationBonusSet[],
  options: CheckpointCandidateOptions = {},
): BuildCandidate {
  const sourceId = options.sourceOwnedWeaponId ?? CHECKPOINT_SOURCE_ID
  const operations: RouteOperation[] = results.map((_, index) => ({
    type: 'reset_bonuses' as const,
    sourceOwnedWeaponId: sourceId,
    gogmaCounterBefore: CHECKPOINT_START_GOGMA_COUNTER + index,
    gogmaCounterAfter: CHECKPOINT_START_GOGMA_COUNTER + index + 1,
  }))
  const candidate = baseCandidate(
    options,
    { kind: 'existing_gogma_reset_bonuses', sourceOwnedWeaponId: sourceId, operations },
    results[results.length - 1],
    'gogma_artian',
    CHECKPOINT_IDEAL_SKILL,
  )
  candidate.bonusAmendmentTrace = results.map((restorationBonuses, operationIndex) => ({
    operationIndex,
    operationType: 'reset_bonuses' as const,
    restorationBonuses: structuredClone(restorationBonuses),
    restorationBonusScope: 'gogma_artian' as const,
  }))
  candidate.skillAmendmentTrace = []
  return attachIntermediateStates(candidate, [checkpointSource(sourceId)])
}

export interface CheckpointMixedCandidateOptions extends CheckpointCandidateOptions {
  /** Reset Bonuses results in execution order; empty means no Bonus amendment. */
  bonusResults: readonly RestorationBonusSet[]
  /** Reset Skills results in execution order; empty means no Skill amendment. */
  skillResults: readonly SkillAmendmentResult[]
  /** The source's own current Skills; mismatching by default. */
  sourceSkill?: SkillAmendmentResult
  /** The source's own current five slots; below Practical by default. */
  sourceBonuses?: RestorationBonusSet
}

/**
 * An existing-Gogma Candidate with both lanes: `bonusResults.length` Reset
 * Bonuses from Gogma Counter 10 and `skillResults.length` Reset Skills from
 * Skill Counter 7, recorded Bonus operations first exactly as the Search
 * composes them. The returned `source` is the Route base weapon.
 */
export function checkpointMixedCandidate(
  options: CheckpointMixedCandidateOptions,
): { candidate: BuildCandidate; source: OwnedGogmaArtianWeapon } {
  const sourceId = options.sourceOwnedWeaponId ?? CHECKPOINT_SOURCE_ID
  const source = checkpointSource(sourceId)
  const sourceSkill = options.sourceSkill ?? CHECKPOINT_MISMATCH_SKILL
  source.seriesSkillId = sourceSkill.seriesSkillId
  source.groupSkillId = sourceSkill.groupSkillId
  source.restorationBonuses = structuredClone(options.sourceBonuses ?? checkpointBelowPracticalBonuses())
  const bonusOperations: RouteOperation[] = options.bonusResults.map((_, index) => ({
    type: 'reset_bonuses' as const,
    sourceOwnedWeaponId: sourceId,
    gogmaCounterBefore: CHECKPOINT_START_GOGMA_COUNTER + index,
    gogmaCounterAfter: CHECKPOINT_START_GOGMA_COUNTER + index + 1,
  }))
  const skillOperations: RouteOperation[] = options.skillResults.map((_, index) => ({
    type: 'reset_skills' as const,
    sourceOwnedWeaponId: sourceId,
    skillCounterBefore: CHECKPOINT_START_SKILL_COUNTER + index,
    skillCounterAfter: CHECKPOINT_START_SKILL_COUNTER + index + 1,
  }))
  const kind =
    bonusOperations.length > 0 && skillOperations.length > 0
      ? 'existing_gogma_mixed'
      : bonusOperations.length > 0
        ? 'existing_gogma_reset_bonuses'
        : skillOperations.length > 0
          ? 'existing_gogma_reset_skills'
          : 'existing_gogma_current'
  const finalBonuses = options.bonusResults.at(-1) ?? source.restorationBonuses
  const finalSkill = options.skillResults.at(-1) ?? sourceSkill
  const candidate = baseCandidate(
    options,
    { kind, sourceOwnedWeaponId: sourceId, operations: [...bonusOperations, ...skillOperations] },
    finalBonuses,
    'gogma_artian',
    finalSkill,
  )
  candidate.bonusAmendmentTrace = options.bonusResults.map((restorationBonuses, operationIndex) => ({
    operationIndex,
    operationType: 'reset_bonuses' as const,
    restorationBonuses: structuredClone(restorationBonuses),
    restorationBonusScope: 'gogma_artian' as const,
  }))
  candidate.skillAmendmentTrace = options.skillResults.map((skills, index) => ({
    operationIndex: bonusOperations.length + index,
    operationType: 'reset_skills' as const,
    seriesSkillId: skills.seriesSkillId,
    groupSkillId: skills.groupSkillId,
  }))
  return { candidate: attachIntermediateStates(candidate, [source]), source }
}

export interface CheckpointConversionCandidateOptions extends CheckpointCandidateOptions {
  /** The Skills the conversion assigns at Skill Counter 7. */
  conversionSkill: SkillAmendmentResult
  /** Reset Bonuses results from Gogma Counter 10, in execution order. */
  bonusResults: readonly RestorationBonusSet[]
  /** Reset Skills results from Skill Counter 8, in execution order. */
  skillResults: readonly SkillAmendmentResult[]
  /**
   * An owned Normal source instead of a predicted new forge. Its five
   * normal-scope slots are inherited at conversion.
   */
  ownedNormalSource?: OwnedNormalArtianWeapon
}

/**
 * A conversion Candidate: a predicted new Normal Artian (or an owned Normal
 * source) converted at Skill Counter 7, then `bonusResults.length` Reset
 * Bonuses and `skillResults.length` Reset Skills.
 */
export function checkpointConversionCandidate(
  options: CheckpointConversionCandidateOptions,
): BuildCandidate {
  const owned = options.ownedNormalSource
  const baseOperations: RouteOperation[] = owned
    ? [{
        type: 'convert_normal_to_gogma',
        weaponTypeId: 'weapon.fixture.a',
        skillCounterBefore: CHECKPOINT_START_SKILL_COUNTER,
        skillCounterAfter: CHECKPOINT_START_SKILL_COUNTER + 1,
      }]
    : [
        {
          type: 'create_normal_artian',
          weaponTypeId: 'weapon.fixture.a',
          rarity: 8,
          count: 1,
          normalCounterBefore: 4,
          normalCounterAfter: 5,
        },
        {
          type: 'convert_normal_to_gogma',
          weaponTypeId: 'weapon.fixture.a',
          skillCounterBefore: CHECKPOINT_START_SKILL_COUNTER,
          skillCounterAfter: CHECKPOINT_START_SKILL_COUNTER + 1,
        },
      ]
  const bonusOperations: RouteOperation[] = options.bonusResults.map((_, index) => ({
    type: 'reset_bonuses' as const,
    sourceOwnedWeaponId: null,
    gogmaCounterBefore: CHECKPOINT_START_GOGMA_COUNTER + index,
    gogmaCounterAfter: CHECKPOINT_START_GOGMA_COUNTER + index + 1,
  }))
  const skillOperations: RouteOperation[] = options.skillResults.map((_, index) => ({
    type: 'reset_skills' as const,
    sourceOwnedWeaponId: null,
    skillCounterBefore: CHECKPOINT_START_SKILL_COUNTER + 1 + index,
    skillCounterAfter: CHECKPOINT_START_SKILL_COUNTER + 2 + index,
  }))
  const operations = [...baseOperations, ...bonusOperations, ...skillOperations]
  const finalBonuses = options.bonusResults.at(-1) ?? owned?.restorationBonuses ?? checkpointIdealBonuses()
  const scope = options.bonusResults.length > 0 ? 'gogma_artian' : 'normal_artian'
  const finalSkill = options.skillResults.at(-1) ?? options.conversionSkill
  const candidate = baseCandidate(
    options,
    {
      kind: owned ? 'owned_normal_artian_to_gogma' : 'normal_artian_to_gogma',
      sourceOwnedWeaponId: owned?.id ?? null,
      operations,
    },
    finalBonuses,
    scope,
    finalSkill,
  )
  candidate.conversionSkillTrace = {
    operationIndex: baseOperations.length - 1,
    operationType: 'convert_normal_to_gogma',
    seriesSkillId: options.conversionSkill.seriesSkillId,
    groupSkillId: options.conversionSkill.groupSkillId,
  }
  candidate.bonusAmendmentTrace = options.bonusResults.map((restorationBonuses, index) => ({
    operationIndex: baseOperations.length + index,
    operationType: 'reset_bonuses' as const,
    restorationBonuses: structuredClone(restorationBonuses),
    restorationBonusScope: 'gogma_artian' as const,
  }))
  candidate.skillAmendmentTrace = options.skillResults.map((skills, index) => ({
    operationIndex: baseOperations.length + bonusOperations.length + index,
    operationType: 'reset_skills' as const,
    seriesSkillId: skills.seriesSkillId,
    groupSkillId: skills.groupSkillId,
  }))
  return attachIntermediateStates(candidate, owned ? [owned] : [])
}

/** The opportunity of one lane at one lane position, or a loud failure. */
export function intermediateOpportunityAt(
  candidate: BuildCandidate,
  axis: 'skill' | 'bonus',
  lanePosition: number,
) {
  const found = (candidate.intermediateStateGroups ?? [])
    .filter((group) => group.axis === axis)
    .flatMap((group) => group.opportunities.map((opportunity) => ({ group, opportunity })))
    .find(({ opportunity }) => opportunity.lanePosition === lanePosition)
  if (!found) {
    throw new Error(`Fixture Candidate has no ${axis} intermediate state at lane position ${lanePosition}.`)
  }
  return found
}
