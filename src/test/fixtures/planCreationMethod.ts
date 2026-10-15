import type { BuildListEntry, BuildRoute, NormalArtianCounter, OwnedWeapon, TargetWeapon } from '../../domain/models/publicTypes'
import type { PlannerInput } from '../../domain/planner'
import { IDEAL_SERIES_SKILL_ID } from './constrainedEnumeration'
import {
  CONFLICT_GOGMA_COUNTER,
  CONFLICT_SKILL_COUNTER,
  checkpointBonusEntry,
  orchestrationEntry,
  orchestrationScenario,
  orchestrationSource,
  orchestrationTarget,
  resetRoute,
  resetSkillsRoute,
  synchronizeOrchestrationEntry,
  type OrchestrationScenario,
} from './plannerConstrainedOrchestration'

/**
 * Inputs for the plan creation method (`docs/PLANNER_SPEC.md` 17.2 U1 / 17.4, Issue #260 PR-6B1) that the real
 * `validatePlannerInput()` judges: the constrained orchestration fixture (one weapon type and element, a fixture Engine whose
 * prediction support follows its capabilities). Each part is one Target with its one Build List Entry.
 */

export interface PlanCreationPart {
  target: TargetWeapon
  entry: BuildListEntry
  source: OwnedWeapon | null
}

/** A Reset Bonuses Route on the Target's own unprotected Gogma (its Skills already Ideal): valid without the Skill Counter. */
export function bonusPart(key: string, targetOverrides: Partial<TargetWeapon> = {}): PlanCreationPart {
  const target = orchestrationTarget(`target.method.${key}`, targetOverrides)
  const source = orchestrationSource(`owned.method.${key}`, { seriesSkillId: IDEAL_SERIES_SKILL_ID })
  return { target, source, entry: orchestrationEntry(`build-list.method.${key}`, target, resetRoute(source.id)) }
}

/** A Reset Skills Route on the Target's own unprotected Gogma: valid without the Gogma Counter. */
export function skillPart(key: string): PlanCreationPart {
  const target = orchestrationTarget(`target.method.${key}`)
  const source = orchestrationSource(`owned.method.${key}`)
  return { target, source, entry: orchestrationEntry(`build-list.method.${key}`, target, resetSkillsRoute(source.id)) }
}

/** A five-Reset Route whose first Reset is a selectable checkpoint (`checkpointBonusEntry`), selected unless `select` is false. */
export function checkpointPart(key: string, select = true): PlanCreationPart {
  const target = orchestrationTarget(`target.method.${key}`)
  const source = orchestrationSource(`owned.method.${key}`, { seriesSkillId: IDEAL_SERIES_SKILL_ID })
  return { target, source, entry: checkpointBonusEntry(`build-list.method.${key}`, target, source.id, source, { select }) }
}

/** The forced Reset (blind) Normal Artian Route (SEARCH_SPEC 6.1.1): no owned weapon, no Normal Counter position. */
export function blindRoute(weaponTypeId: string): BuildRoute {
  return {
    kind: 'normal_artian_to_gogma',
    sourceOwnedWeaponId: null,
    operations: [
      { type: 'create_normal_artian', weaponTypeId, rarity: 8, count: 1, normalCounterBefore: null, normalCounterAfter: null },
      { type: 'convert_normal_to_gogma', weaponTypeId, skillCounterBefore: CONFLICT_SKILL_COUNTER, skillCounterAfter: CONFLICT_SKILL_COUNTER + 1 },
      { type: 'reset_bonuses', sourceOwnedWeaponId: null, gogmaCounterBefore: CONFLICT_GOGMA_COUNTER, gogmaCounterAfter: CONFLICT_GOGMA_COUNTER + 1 },
    ],
  }
}

/** A Target reachable by the blind Route only (no owned weapon of its weapon type and element). */
export function blindPart(key: string): PlanCreationPart {
  const target = orchestrationTarget(`target.method.${key}`)
  return { target, source: null, entry: orchestrationEntry(`build-list.method.${key}`, target, blindRoute(target.weaponTypeId)) }
}

export interface PlanCreationScenarioOptions {
  normalCounters?: NormalArtianCounter[]
  normalSupported?: boolean
}

export function planCreationScenario(parts: PlanCreationPart[], options: PlanCreationScenarioOptions = {}): OrchestrationScenario {
  return orchestrationScenario({
    targets: parts.map(({ target }) => target),
    entries: parts.map(({ entry }) => entry),
    ownedWeapons: parts.flatMap(({ source }) => (source === null ? [] : [source])),
    normalCounters: options.normalCounters,
    engine: options.normalSupported === undefined ? {} : { normalSupported: options.normalSupported },
  })
}

/** Two Entries of one Target (a legacy duplicate) beside one other valid Target. */
export function legacyDuplicateScenario(): OrchestrationScenario {
  const a = bonusPart('a')
  const b = bonusPart('b')
  const second = orchestrationSource('owned.method.a2', { seriesSkillId: IDEAL_SERIES_SKILL_ID })
  return orchestrationScenario({
    targets: [a.target, b.target],
    entries: [a.entry, orchestrationEntry('build-list.method.a2', a.target, resetRoute(second.id)), b.entry],
    ownedWeapons: [a.source!, second, b.source!],
  })
}

/** Edits the input's RNG state and keeps every Entry's derived hashes on it (an Entry stays valid when its Route ignores the change). */
export function withPlanCreationRngState(built: OrchestrationScenario, edit: (state: PlannerInput['rngState']) => void): OrchestrationScenario {
  edit(built.input.rngState)
  built.input.buildListEntries.forEach((entry) => synchronizeOrchestrationEntry(built.input, entry))
  return built
}
