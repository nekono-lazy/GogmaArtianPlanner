/**
 * Issue #154 Global Assignment Phase A (Research only; never imported by the app).
 *
 * Required-only replay of one reach option (`docs/PLANNER_GLOBAL_ASSIGNMENT_DESIGN.md` 5.3,
 * `rng_replayed`): the source's initial state (an owned weapon as persisted, or the Production Normal
 * result at the forge position), then the required Skill unit(s) (conversion / Reset Skills), then the
 * required Bonus unit(s) (Reset / Keep), re-predicted with the Engine's public API, and the final state
 * judged with `satisfiesIdealTarget()`.
 *
 * It is an RNG check of the required units only. Skippable chain units another Target may run between
 * them do not change these results (the skip rule's own premise), so they are not replayed. It proves
 * nothing about Production coexistence: no Route is materialized, no Trace Replay runs, and no Planner
 * is involved - those are Phase D / D'. A mismatch is a Research-internal inconsistency between the scan
 * and this replay (both read the same Engine and the same Ideal authority) and fails closed as an
 * invariant error; it is never a game fact.
 */
import type { OwnedWeapon, RestorationBonusSet, TargetWeapon } from '../../domain/models/publicTypes'
import type { NormalizedSeed, RngEngine } from '../../domain/rng/rngEngine'
import { satisfiesIdealTarget } from '../../domain/target/targetEvaluator'
import { GlobalAssignmentInvariantError, type GlobalAssignmentContext, type ReachOption, type ReachOptionFinalState } from './types'

export interface ReachOptionReplayResult {
  /** The same option with `verification: 'rng_replayed'`. */
  option: ReachOption
  /** The replayed final weapon state (the match condition Phase C / D compare against, design 8.3). */
  finalState: ReachOptionFinalState
  /** Engine predictions this replay made. */
  predictions: { skill: number; gogmaReset: number; gogmaKeep: number; normal: number }
}

function fail(code: GlobalAssignmentInvariantError['code'], message: string): never {
  throw new GlobalAssignmentInvariantError(code, message)
}

function requireSupported(engine: RngEngine, query: Parameters<RngEngine['getPredictionSupport']>[0], what: string): void {
  const support = engine.getPredictionSupport(query)
  if (!support.supported) fail('prediction_unsupported', `${what} is unsupported (${support.reason}); the scan never offers an option from an unsupported prediction.`)
}

/**
 * Replays `option` for its Target from the context's PlannerInput and `engine`. Returns the
 * `rng_replayed` option and its final state, or throws `GlobalAssignmentInvariantError`.
 */
export function replayReachOptionRequiredOnly(option: ReachOption, context: GlobalAssignmentContext, engine: RngEngine): ReachOptionReplayResult {
  const input = context.plannerInput
  const master = input.master
  const target: TargetWeapon | undefined = context.planningTargets.find(value => value.id === option.targetWeaponId)
  if (!target) fail('target_not_planning', `Target ${option.targetWeaponId} is not a planning Target of this context.`)
  const { baseSeed } = input.rngState
  if (!baseSeed.isConfirmed || baseSeed.value === null) fail('requirement_inconsistent', 'The replay needs a confirmed Base Seed.')
  const seed = baseSeed.value as NormalizedSeed
  const { weaponTypeId, elementId } = target
  const predictions = { skill: 0, gogmaReset: 0, gogmaKeep: 0, normal: 0 }
  const { source, skillRequired, bonusRequired } = option

  // 1. The source's initial state.
  let bonuses: RestorationBonusSet
  let scope: ReachOptionFinalState['restorationBonusScope']
  let seriesSkillId: ReachOptionFinalState['seriesSkillId'] = null
  let groupSkillId: ReachOptionFinalState['groupSkillId'] = null
  if (source.kind === 'new_normal') {
    if (option.normalRequired === null || option.normalRequired.position !== source.position || option.normalRequired.counterId !== source.counterId) {
      fail('requirement_inconsistent', 'A new_normal option must name its forge position as normalRequired.')
    }
    requireSupported(engine, { type: 'normal_artian', weaponTypeId, elementId, rarity: 8 }, 'Normal Artian prediction')
    predictions.normal += 1
    bonuses = engine.predictNormalArtian({ baseSeed: seed, weaponTypeId, elementId, rarity: 8, normalCounter: source.position, master })
    scope = 'normal_artian'
  } else {
    if (option.normalRequired !== null) fail('requirement_inconsistent', 'An owned source has no Normal forge requirement.')
    const owned: OwnedWeapon | null = input.ownedWeapons.find(weapon => weapon.id === source.ownedWeaponId) ?? null
    if (!owned) fail('source_missing', `OwnedWeapon ${source.ownedWeaponId} is not in the PlannerInput.`)
    if (owned.weaponTypeId !== weaponTypeId || owned.elementId !== elementId) fail('source_kind_mismatch', `OwnedWeapon ${owned.id} is not compatible with Target ${target.id}.`)
    if ((source.kind === 'owned_gogma') !== (owned.kind === 'gogma')) fail('source_kind_mismatch', `OwnedWeapon ${owned.id} is a ${owned.kind} weapon; the option names ${source.kind}.`)
    if (owned.kind === 'normal' && owned.isProtected) fail('source_kind_mismatch', `OwnedWeapon ${owned.id} is a protected Normal and never a conversion source.`)
    bonuses = structuredClone(owned.restorationBonuses)
    scope = owned.restorationBonusScope
    seriesSkillId = owned.seriesSkillId
    groupSkillId = owned.groupSkillId
  }

  // 2. The required Skill unit(s): conversion (Skill +1 at c) and / or the final Skill position s*.
  if (skillRequired.kind === 'conversion') {
    if (source.kind === 'owned_gogma') fail('source_kind_mismatch', 'A conversion needs a Normal source.')
    if (skillRequired.conversionPosition > skillRequired.finalPosition) fail('requirement_inconsistent', `conversionPosition ${skillRequired.conversionPosition} is after finalPosition ${skillRequired.finalPosition}.`)
    requireSupported(engine, { type: 'skill', weaponTypeId, elementId }, 'Skill prediction')
    predictions.skill += 1
    const conversion = engine.predictSkills({ baseSeed: seed, skillCounter: skillRequired.conversionPosition, weaponTypeId, elementId, master })
    seriesSkillId = conversion.seriesSkillId
    groupSkillId = conversion.groupSkillId
    if (skillRequired.finalPosition > skillRequired.conversionPosition) {
      predictions.skill += 1
      const final = engine.predictSkills({ baseSeed: seed, skillCounter: skillRequired.finalPosition, weaponTypeId, elementId, master })
      seriesSkillId = final.seriesSkillId
      groupSkillId = final.groupSkillId
    }
  } else if (skillRequired.kind === 'reset_skills') {
    if (source.kind !== 'owned_gogma') fail('source_kind_mismatch', 'Reset Skills needs an owned Gogma source.')
    requireSupported(engine, { type: 'skill', weaponTypeId, elementId }, 'Skill prediction')
    predictions.skill += 1
    const final = engine.predictSkills({ baseSeed: seed, skillCounter: skillRequired.finalPosition, weaponTypeId, elementId, master })
    seriesSkillId = final.seriesSkillId
    groupSkillId = final.groupSkillId
  } else if (source.kind !== 'owned_gogma') {
    fail('source_kind_mismatch', 'A Normal source always needs a conversion.')
  }

  // 3. The required Bonus unit(s). Reset reads no current slot; Keep reads the current families (any scope).
  const reset = (position: number) => {
    requireSupported(engine, { type: 'gogma_reset', weaponTypeId, elementId, master }, 'Gogma Reset prediction')
    predictions.gogmaReset += 1
    return engine.predictGogmaBonus({ baseSeed: seed, gogmaCounter: position, weaponTypeId, elementId, operation: { type: 'reset_bonuses' }, master })
  }
  const keep = (position: number, current: RestorationBonusSet) => {
    requireSupported(engine, { type: 'gogma_keep', weaponTypeId, elementId, currentBonuses: current, master }, 'Gogma Keep prediction')
    predictions.gogmaKeep += 1
    return engine.predictGogmaBonus({ baseSeed: seed, gogmaCounter: position, weaponTypeId, elementId, operation: { type: 'keep_bonuses', currentBonuses: structuredClone(current) }, master })
  }
  if (bonusRequired.kind === 'none') {
    if (source.kind !== 'owned_gogma' || scope !== 'gogma_artian') fail('requirement_inconsistent', 'A Bonus requirement of none needs an owned Gogma already in gogma_artian scope.')
  } else if (bonusRequired.kind === 'reset') {
    bonuses = reset(bonusRequired.finalPosition)
    scope = 'gogma_artian'
  } else if (bonusRequired.kind === 'keep_from_source') {
    bonuses = keep(bonusRequired.finalPosition, bonuses)
    scope = 'gogma_artian'
  } else {
    if (bonusRequired.resetPosition >= bonusRequired.finalPosition) fail('requirement_inconsistent', `reset_then_keep needs resetPosition ${bonusRequired.resetPosition} < finalPosition ${bonusRequired.finalPosition}.`)
    bonuses = keep(bonusRequired.finalPosition, reset(bonusRequired.resetPosition))
    scope = 'gogma_artian'
  }

  // 4. The final state must satisfy the Ideal (the same authority the scan used).
  if (!satisfiesIdealTarget(target, bonuses, scope, seriesSkillId, groupSkillId, master)) {
    fail('ideal_mismatch', `Required-only replay of Target ${target.id} (${sourceDescription(option)}) does not reach the Ideal; the scan and the replay disagree.`)
  }
  if (!Number.isSafeInteger(option.streamEnd.skill) || !Number.isSafeInteger(option.streamEnd.gogma)) fail('requirement_inconsistent', 'streamEnd must hold integers.')
  return {
    option: { ...option, verification: 'rng_replayed' },
    finalState: { finalBonuses: bonuses, restorationBonusScope: scope, seriesSkillId, groupSkillId },
    predictions,
  }
}

function sourceDescription(option: ReachOption): string {
  const source = option.source.kind === 'new_normal' ? `new_normal ${option.source.counterId}@${option.source.position}` : `${option.source.kind} ${option.source.ownedWeaponId}`
  return `${source}, skill ${JSON.stringify(option.skillRequired)}, bonus ${JSON.stringify(option.bonusRequired)}`
}
