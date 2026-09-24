import type {
  BuildListEntry,
  BuildRoute,
  IntermediateStateOpportunityId,
  OwnedGogmaArtianWeapon,
  OwnedNormalArtianWeapon,
  OwnedWeapon,
  RestorationBonusSet,
  RouteOperation,
  TargetWeapon,
} from '../../domain/models/publicTypes'
import { V1_NORMAL_ARTIAN_RARITY } from '../../domain/models/publicTypes'
import { extractIntermediateStateGroups } from '../../domain/search'
import type { SkillPredictionResult } from '../../domain/rng/rngEngine'
import type {
  PlannerConflictResolution,
  PlannerOptions,
} from '../../domain/planner/plannerTypes'
import { ownedWeaponId } from './domainData'
import {
  CONSTRAINED_START_GOGMA_COUNTER,
  CONSTRAINED_START_NORMAL_COUNTER,
  CONSTRAINED_START_SKILL_COUNTER,
  IDEAL_SERIES_SKILL_ID,
  belowPracticalBonuses,
  constrainedMaster,
  gogmaWeapon,
  normalWeapon,
  practicalVariant,
} from './constrainedEnumeration'
import {
  orchestrationEntry,
  orchestrationNormalCounters,
  orchestrationScenario,
  orchestrationTarget,
  type OrchestrationScenario,
} from './plannerConstrainedOrchestration'

/**
 * Deterministic fixtures for the Issue #103 Phase A deterministic scheduler
 * acceptance scenarios (`docs/ISSUE_103_DETERMINISTIC_PLANNER_DESIGN.md` 16).
 *
 * They reuse the B8 orchestration Fake Engine: every prediction is an explicit
 * fixture entry keyed by its Counter position, so the ordinary Trace Replay
 * reproduces every scheduled action. Each Target gets its own Ideal five slots
 * (`schedulerIdeal(index)`), and a Route's final Reset / Keep / Skill result is
 * registered at exactly its final Counter position, so no weapon satisfies a
 * Target by accident. No Production RNG behavior is implied.
 */

export const G0 = CONSTRAINED_START_GOGMA_COUNTER
export const S0 = CONSTRAINED_START_SKILL_COUNTER
export const N0 = CONSTRAINED_START_NORMAL_COUNTER
export const NORMAL_COUNTER_ID = `weapon.fixture.a:${V1_NORMAL_ARTIAN_RARITY}`

/** A distinct Ideal five-slot set per index (0..47). */
export function schedulerIdeal(index: number): RestorationBonusSet {
  return practicalVariant(index)
}

/** A Skill result that satisfies nothing. */
export function neutralSkill(skillCounter: number): SkillPredictionResult {
  return { seriesSkillId: `series_skill.fixture.s${skillCounter}`, groupSkillId: null }
}

export const IDEAL_SKILL: SkillPredictionResult = {
  seriesSkillId: IDEAL_SERIES_SKILL_ID,
  groupSkillId: null,
}

export interface SchedulerTargetOptions {
  priority?: TargetWeapon['priority']
  idealSeriesSkillId?: string
  preferredOwnedWeaponId?: TargetWeapon['preferredOwnedWeaponId']
}

export interface SchedulerLaneShape {
  /** First Counter position of the lane. */
  from: number
  /** Reset Bonuses (or Reset Skills) count. */
  resets: number
  /** Keep Bonuses after the Resets (Bonus lane only). */
  keeps?: number
}

export interface SchedulerEntryOptions {
  bonus?: SchedulerLaneShape
  skill?: SchedulerLaneShape
  improvementPreference?: 'planner' | 'skill_first' | 'bonus_first'
  /**
   * Select the intermediate state of one lane at `lanePosition` (the number of
   * that lane's operations run so far; 0 is the weapon's own current state).
   */
  select?: { axis: 'skill'; lanePosition: number } | { axis: 'bonus'; lanePosition: number }
}

function bonusOperations(
  sourceId: OwnedWeapon['id'] | null,
  shape: SchedulerLaneShape,
): RouteOperation[] {
  const operations: RouteOperation[] = []
  let counter = shape.from
  for (let index = 0; index < shape.resets; index += 1) {
    operations.push({
      type: 'reset_bonuses',
      sourceOwnedWeaponId: sourceId,
      gogmaCounterBefore: counter,
      gogmaCounterAfter: counter + 1,
    })
    counter += 1
  }
  for (let index = 0; index < (shape.keeps ?? 0); index += 1) {
    operations.push({
      type: 'keep_bonuses',
      sourceOwnedWeaponId: sourceId,
      gogmaCounterBefore: counter,
      gogmaCounterAfter: counter + 1,
    })
    counter += 1
  }
  return operations
}

function skillOperations(
  sourceId: OwnedWeapon['id'] | null,
  shape: SchedulerLaneShape,
): RouteOperation[] {
  return Array.from({ length: shape.resets }, (_unused, index) => ({
    type: 'reset_skills' as const,
    sourceOwnedWeaponId: sourceId,
    skillCounterBefore: shape.from + index,
    skillCounterAfter: shape.from + index + 1,
  }))
}

/**
 * Builds one scheduler scenario. Results are registered per Counter position
 * (`resetAt`, `keepAt`, `skillAt`); a position without a registered result
 * predicts `belowPracticalBonuses()` / `neutralSkill()`.
 */
export class SchedulerScenarioBuilder {
  readonly targets: TargetWeapon[] = []
  readonly entries: BuildListEntry[] = []
  readonly ownedWeapons: OwnedWeapon[] = []
  readonly resetAt = new Map<number, RestorationBonusSet>()
  readonly keepAt = new Map<number, RestorationBonusSet>()
  readonly skillAt = new Map<number, SkillPredictionResult>()
  readonly normalAt = new Map<number, RestorationBonusSet>()
  normalCounters: OrchestrationScenario['input']['normalCounters'] = []
  conflictResolutions: PlannerConflictResolution[] = []

  target(id: string, idealIndex: number, options: SchedulerTargetOptions = {}): TargetWeapon {
    const series = options.idealSeriesSkillId ?? IDEAL_SERIES_SKILL_ID
    const target = orchestrationTarget(id, {
      priority: options.priority ?? 3,
      idealBonuses: schedulerIdeal(idealIndex),
      idealSkillCondition: { seriesSkillId: series, groupSkillId: null, matchMode: 'all' },
      practicalSkillCondition:
        series === IDEAL_SERIES_SKILL_ID
          ? { seriesSkillId: IDEAL_SERIES_SKILL_ID, groupSkillId: 'group_skill.fixture.a', matchMode: 'any' }
          : { seriesSkillId: series, groupSkillId: null, matchMode: 'all' },
      preferredOwnedWeaponId: options.preferredOwnedWeaponId ?? null,
    })
    this.targets.push(target)
    return target
  }

  /**
   * An unprotected owned Gogma. Defaults to below-Practical slots and the
   * Ideal Series Skill, the start of a Bonus-lane Route.
   */
  gogma(id: string, overrides: Partial<OwnedGogmaArtianWeapon> = {}): OwnedGogmaArtianWeapon {
    const weapon = gogmaWeapon(id, {
      restorationBonuses: belowPracticalBonuses(),
      seriesSkillId: IDEAL_SERIES_SKILL_ID,
      groupSkillId: null,
      ...overrides,
    })
    this.ownedWeapons.push(weapon)
    return weapon
  }

  normal(id: string, overrides: Partial<OwnedNormalArtianWeapon> = {}): OwnedNormalArtianWeapon {
    const weapon = normalWeapon(id, { restorationBonuses: belowPracticalBonuses(), ...overrides })
    this.ownedWeapons.push(weapon)
    return weapon
  }

  private finalBonusesOf(
    operations: readonly RouteOperation[],
    start: RestorationBonusSet | null,
  ): RestorationBonusSet {
    let bonuses = start
    operations.forEach((operation) => {
      if (operation.type === 'reset_bonuses') {
        bonuses = this.resetAt.get(operation.gogmaCounterBefore) ?? belowPracticalBonuses()
      } else if (operation.type === 'keep_bonuses') {
        bonuses = this.keepAt.get(operation.gogmaCounterBefore) ?? belowPracticalBonuses()
      }
    })
    if (bonuses === null) throw new Error('A Route with unknown slots needs a Reset.')
    return bonuses
  }

  private skillOf(skillCounter: number): SkillPredictionResult {
    return this.skillAt.get(skillCounter) ?? neutralSkill(skillCounter)
  }

  /** An existing-Gogma Route on `source`: its Bonus lane, then its Skill lane. */
  existingEntry(
    id: string,
    target: TargetWeapon,
    source: OwnedGogmaArtianWeapon,
    options: SchedulerEntryOptions,
  ): BuildListEntry {
    const bonus = options.bonus ? bonusOperations(source.id, options.bonus) : []
    const skill = options.skill ? skillOperations(source.id, options.skill) : []
    const hasKeep = bonus.some(({ type }) => type === 'keep_bonuses')
    const kind: BuildRoute['kind'] =
      bonus.length === 0 && skill.length === 0
        ? 'existing_gogma_current'
        : bonus.length === 0
          ? 'existing_gogma_reset_skills'
          : skill.length > 0 || hasKeep
            ? 'existing_gogma_mixed'
            : 'existing_gogma_reset_bonuses'
    const operations = [...bonus, ...skill]
    const lastSkill = skill.at(-1)
    const finalSkill: SkillPredictionResult =
      lastSkill?.type === 'reset_skills'
        ? this.skillOf(lastSkill.skillCounterBefore)
        : { seriesSkillId: source.seriesSkillId, groupSkillId: source.groupSkillId }
    const entry = orchestrationEntry(
      id,
      target,
      { kind, sourceOwnedWeaponId: source.id, operations },
      {
        finalBonuses: this.finalBonusesOf(bonus, source.restorationBonuses),
        seriesSkillId: finalSkill.seriesSkillId,
      },
    )
    entry.candidateSnapshot.groupSkillId = finalSkill.groupSkillId
    entry.candidateSnapshot.bonusAmendmentTrace = operations.flatMap((operation, operationIndex) =>
      operation.type === 'reset_bonuses' || operation.type === 'keep_bonuses'
        ? [{
            operationIndex,
            operationType: operation.type,
            restorationBonuses: this.finalBonusesOf(operations.slice(0, operationIndex + 1), source.restorationBonuses),
            restorationBonusScope: 'gogma_artian' as const,
          }]
        : [],
    )
    entry.candidateSnapshot.skillAmendmentTrace = operations.flatMap((operation, operationIndex) =>
      operation.type === 'reset_skills'
        ? [{
            operationIndex,
            operationType: 'reset_skills' as const,
            ...this.skillOf(operation.skillCounterBefore),
          }]
        : [],
    )
    entry.intermediateStateSelection = {
      skillOpportunityId: null,
      bonusOpportunityId: null,
      improvementPreference: options.improvementPreference ?? 'planner',
    }
    if (options.select) {
      entry.candidateSnapshot.intermediateStateGroups = extractIntermediateStateGroups(
        entry.candidateSnapshot,
        { target, master: constrainedMaster(), ownedWeapons: [source] },
      )
      const selectAxis = options.select.axis
      const selectPosition = options.select.lanePosition
      const opportunity = entry.candidateSnapshot.intermediateStateGroups
        .filter(({ axis }) => axis === selectAxis)
        .flatMap(({ opportunities }): ReadonlyArray<{ id: IntermediateStateOpportunityId; lanePosition: number }> => opportunities)
        .find(({ lanePosition }) => lanePosition === selectPosition)
      if (!opportunity) throw new Error(`Entry '${id}' offers no ${selectAxis} state at ${selectPosition}.`)
      entry.intermediateStateSelection = {
        ...entry.intermediateStateSelection,
        skillOpportunityId: selectAxis === 'skill' ? opportunity.id : null,
        bonusOpportunityId: selectAxis === 'bonus' ? opportunity.id : null,
      }
    }
    this.entries.push(entry)
    return entry
  }

  /**
   * A conversion Route: an owned Normal (`source`) or a new Normal
   * (`forge`: predicted `count` forges from `N0`, or a blind forge), converted
   * at `convertAt`, then a transient Bonus lane and Skill lane.
   */
  conversionEntry(
    id: string,
    target: TargetWeapon,
    base:
      | { kind: 'owned'; source: OwnedNormalArtianWeapon; convertAt: number }
      | { kind: 'predicted'; count: number; normalFrom?: number; convertAt: number }
      | { kind: 'blind'; convertAt: number },
    options: { bonus: SchedulerLaneShape; skill?: SchedulerLaneShape },
  ): BuildListEntry {
    const baseOperations: RouteOperation[] = []
    let inherited: RestorationBonusSet | null = null
    if (base.kind === 'predicted') {
      const from = base.normalFrom ?? N0
      baseOperations.push({
        type: 'create_normal_artian',
        weaponTypeId: 'weapon.fixture.a',
        rarity: V1_NORMAL_ARTIAN_RARITY,
        count: base.count,
        normalCounterBefore: from,
        normalCounterAfter: from + base.count,
      })
      inherited = this.normalAt.get(from + base.count - 1) ?? belowPracticalBonuses()
    } else if (base.kind === 'blind') {
      baseOperations.push({
        type: 'create_normal_artian',
        weaponTypeId: 'weapon.fixture.a',
        rarity: V1_NORMAL_ARTIAN_RARITY,
        count: 1,
        normalCounterBefore: null,
        normalCounterAfter: null,
      })
    } else {
      inherited = base.source.restorationBonuses
    }
    baseOperations.push({
      type: 'convert_normal_to_gogma',
      weaponTypeId: 'weapon.fixture.a',
      skillCounterBefore: base.convertAt,
      skillCounterAfter: base.convertAt + 1,
    })
    const bonus = bonusOperations(null, options.bonus)
    const skill = options.skill ? skillOperations(null, options.skill) : []
    const operations = [...baseOperations, ...bonus, ...skill]
    const lastSkill = skill.at(-1)
    const finalSkill =
      lastSkill?.type === 'reset_skills'
        ? this.skillOf(lastSkill.skillCounterBefore)
        : this.skillOf(base.convertAt)
    const route: BuildRoute = {
      kind: base.kind === 'owned' ? 'owned_normal_artian_to_gogma' : 'normal_artian_to_gogma',
      sourceOwnedWeaponId: base.kind === 'owned' ? base.source.id : null,
      operations,
    }
    const entry = orchestrationEntry(id, target, route, {
      finalBonuses: this.finalBonusesOf(bonus, inherited),
      seriesSkillId: finalSkill.seriesSkillId,
    })
    entry.candidateSnapshot.groupSkillId = finalSkill.groupSkillId
    if (base.kind === 'predicted') {
      entry.candidateSnapshot.estimatedNormalAdvance = base.count
    }
    this.entries.push(entry)
    return entry
  }

  withNormalCounter(overrides: Partial<OrchestrationScenario['input']['normalCounters'][number]> = {}) {
    this.normalCounters = orchestrationNormalCounters().map((counter) => ({ ...counter, ...overrides }))
    return this
  }

  build(options: Partial<PlannerOptions> = {}): OrchestrationScenario {
    const keepInputs = [
      belowPracticalBonuses(),
      ...this.resetAt.values(),
      ...this.keepAt.values(),
    ].filter(
      (bonuses, index, all) =>
        all.findIndex((other) => JSON.stringify(other) === JSON.stringify(bonuses)) === index,
    )
    const scenario = orchestrationScenario({
      targets: this.targets,
      entries: this.entries,
      ownedWeapons: this.ownedWeapons,
      normalCounters: this.normalCounters,
      conflictResolutions: this.conflictResolutions,
      engine: {
        gogmaPositions: 240,
        skillPositions: 240,
        normalPositions: 12,
        keepSupported: true,
        keepInputs,
        resetResultAt: (counter) => this.resetAt.get(counter) ?? belowPracticalBonuses(),
        keepResultAt: (counter) => this.keepAt.get(counter) ?? belowPracticalBonuses(),
        skillResultAt: (counter) => this.skillOf(counter),
        normalResultAt: (counter) => this.normalAt.get(counter) ?? belowPracticalBonuses(),
      },
    })
    scenario.input.options = { ...scenario.input.options, ...options }
    return scenario
  }
}

export function ownedId(value: string) {
  return ownedWeaponId(value)
}
