import type {
  BuildCandidate,
  OwnedGogmaArtianWeapon,
  OwnedWeaponId,
  RestorationBonusSet,
  RouteOperation,
  TargetWeapon,
} from '../../domain/models/publicTypes'
import { CURRENT_CALCULATION_APP_SCHEMA_VERSION } from '../../domain/models/publicTypes'
import type { SearchMasterSubset } from '../../domain/search'
import { extractCandidateCheckpointGroups } from '../../domain/search'
import {
  candidateId,
  createValidOwnedWeapon,
  createValidTargetWeapon,
  ownedWeaponId,
  targetWeaponId,
} from './domainData'
import { restorationBonus, restorationBonusSet, targetEvaluationMaster } from './targetEvaluation'

/**
 * Deterministic fixtures for the canonical Ideal Route plus compromise
 * checkpoint model (`docs/SEARCH_SPEC.md` 5.8).
 *
 * Every Candidate here is built by hand from recorded observational traces, so
 * checkpoint extraction can be exercised without an RNG Engine at all - which
 * is itself part of the contract: extraction is a pure replay.
 */

export const CHECKPOINT_SOURCE_ID = ownedWeaponId('owned.checkpoint.source')
export const CHECKPOINT_START_GOGMA_COUNTER = 10

const ATTACK = 'bonus_type.fixture.attack'
const ELEMENT = 'bonus_type.fixture.element'
const UTILITY = 'bonus_type.fixture.utility'
const SHARPNESS = 'bonus_type.fixture.sharpness'
const LOW = 'bonus_rank.fixture.low'
const MIDDLE = 'bonus_rank.fixture.middle'
const HIGH = 'bonus_rank.fixture.high'

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
    lotteries: [],
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

/**
 * A canonical Ideal Candidate whose Route is one Reset Bonuses per entry of
 * `results`, with `results[i]` recorded as the observed result of operation
 * `i`. The source already holds the Ideal Series Skill, so every Route prefix
 * differs from the Ideal on the Bonus axis alone.
 */
export interface CheckpointCandidateOptions {
  sourceOwnedWeaponId?: OwnedWeaponId
  candidateId?: string
  targetWeaponId?: string
}

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
  const candidate: BuildCandidate = {
    id: candidateId(options.candidateId ?? 'candidate.checkpoint.a'),
    targetWeaponId: targetWeaponId(options.targetWeaponId ?? 'target.fixture.a'),
    finalBonuses: structuredClone(results[results.length - 1]),
    restorationBonusScope: 'gogma_artian',
    seriesSkillId: 'series_skill.fixture.a',
    groupSkillId: null,
    route: {
      kind: 'existing_gogma_reset_bonuses',
      sourceOwnedWeaponId: sourceId,
      operations,
    },
    estimatedOperationCount: results.length,
    estimatedGogmaAdvance: results.length,
    estimatedSkillAdvance: 0,
    estimatedNormalAdvance: null,
    requiredMaterials: [],
    idealDifference: {
      missingBonuses: [],
      extraBonuses: [],
      matchedBonusCount: 5,
      seriesSkillMatches: true,
      groupSkillMatches: true,
      summary: 'Checkpoint fixture only.',
    },
    bonusAmendmentTrace: results.map((restorationBonuses, operationIndex) => ({
      operationIndex,
      operationType: 'reset_bonuses' as const,
      restorationBonuses: structuredClone(restorationBonuses),
      restorationBonusScope: 'gogma_artian' as const,
    })),
    skillAmendmentTrace: [],
    searchRunId: 'search-run.checkpoint',
    searchStateHash: 'hash.checkpoint.search-state',
    referencedOwnedWeaponsHash: 'hash.checkpoint.owned',
    calculationContext: {
      gameVersion: 'fixture-only',
      masterDataVersion: 1,
      rngEngineVersion: 'fake-fixture:checkpoint',
      appSchemaVersion: CURRENT_CALCULATION_APP_SCHEMA_VERSION,
    },
    createdAt: '2026-09-10T00:00:00.000Z',
    checkpointGroups: [],
  }
  candidate.checkpointGroups = extractCandidateCheckpointGroups(candidate, {
    target: {
      ...checkpointTarget(),
      id: candidate.targetWeaponId,
    },
    master: checkpointMaster(),
    ownedWeapons: [checkpointSource(sourceId)],
  })
  return candidate
}
