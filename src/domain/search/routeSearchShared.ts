import type {
  BuildCandidate,
  BuildRoute,
  GroupSkillId,
  OwnedWeaponId,
  RestorationBonusSet,
  RouteOperation,
  SeriesSkillId,
  TargetWeapon,
} from '../models/publicTypes'
import type { RngEngine } from '../rng/rngEngine'
import { createCandidateFromPrediction } from './candidateFactory'
import type { SearchExecutionContext } from './searchExecution'
import type {
  CandidateSearchInput,
  CandidateSearchWarning,
  SkippedRoute,
} from './searchTypes'

export interface RouteSearchResult {
  candidates: BuildCandidate[]
  searchedRoutes: BuildRoute['kind'][]
  skippedRoutes: SkippedRoute[]
  warnings: CandidateSearchWarning[]
}

export interface RouteSearchContext {
  target: TargetWeapon
  input: CandidateSearchInput
  engine: RngEngine
  execution: SearchExecutionContext
}

export interface SkillVariantBase {
  bonuses: RestorationBonusSet
  operations: RouteOperation[]
  sourceOwnedWeaponId: OwnedWeaponId | null
  resetSkillsSourceOwnedWeaponId?: OwnedWeaponId | null
  kind: BuildRoute['kind']
}

export async function searchResetSkillVariants(
  context: RouteSearchContext,
  base: SkillVariantBase,
): Promise<BuildCandidate[]> {
  const { target, input, engine, execution } = context
  const baseSeed = input.rngState.baseSeed.value
  const skillCounter = input.rngState.skillCounter.value
  const counterGate = input.rngState.counterGate.value
  if (baseSeed === null || skillCounter === null || counterGate === null) {
    return []
  }

  const candidates: BuildCandidate[] = []
  const resetSkillsSourceOwnedWeaponId =
    base.resetSkillsSourceOwnedWeaponId === undefined
      ? base.sourceOwnedWeaponId
      : base.resetSkillsSourceOwnedWeaponId
  let currentCounter = skillCounter
  const resetOperations: RouteOperation[] = []
  for (let index = 0; index < input.settings.maxSkillAdvance; index += 1) {
    await execution.checkpoint()
    const skill = engine.predictSkills({
      baseSeed,
      skillCounter: currentCounter,
      counterGate,
      weaponTypeId: target.weaponTypeId,
      elementId: target.elementId,
      master: input.master,
    })
    const nextCounter = engine.advanceSkillCounter(currentCounter, {
      type: 'reset_skills',
    })
    resetOperations.push({
      type: 'reset_skills',
      sourceOwnedWeaponId: resetSkillsSourceOwnedWeaponId,
      skillCounterBefore: currentCounter,
      skillCounterAfter: nextCounter,
    })
    const candidate = createCandidateFromPrediction(
      target,
      {
        finalBonuses: base.bonuses,
        seriesSkillId: skill.seriesSkillId,
        groupSkillId: skill.groupSkillId,
        route: {
          kind: base.kind,
          sourceOwnedWeaponId: base.sourceOwnedWeaponId,
          operations: [...base.operations, ...resetOperations],
        },
      },
      input,
      execution,
    )
    if (candidate) candidates.push(candidate)
    currentCounter = nextCounter
  }
  return candidates
}

export function createBaseCandidate(
  context: RouteSearchContext,
  bonuses: RestorationBonusSet,
  seriesSkillId: SeriesSkillId | null,
  groupSkillId: GroupSkillId | null,
  route: BuildRoute,
): BuildCandidate | null {
  return createCandidateFromPrediction(
    context.target,
    { finalBonuses: bonuses, seriesSkillId, groupSkillId, route },
    context.input,
    context.execution,
  )
}
