/**
 * Issue #154 Phase 2-C1: post-hoc comparison only. Never import from Production, and never from the Phase 2-C1
 * calculation (`plannerGlobalPhase2C1.ts` does not import this module).
 *
 * It compares the finished control run, the finished origin-independent run and the 1,657 proven-minimum evidence,
 * which the caller passes in explicitly (read from a file by `scripts/analyze-planner-global-phase2c1.mjs` after both
 * runs ended). Nothing here reaches a Search, a Planner run or a Route choice.
 */
import type { Phase2BOptimumEvidence, Phase2BOptimumRoute } from './plannerGlobalPhase2BGapAnalysis'
import type { Phase2C1Analysis, Phase2C1CandidateSummary } from './plannerGlobalPhase2C1'

type FinishedAnalysis = Extract<Phase2C1Analysis, { finished: true }>

export type Phase2C1SourceRelation = 'same_owned_weapon' | 'different_owned_weapon' | 'owned_to_new_normal' | 'new_normal_to_owned' | 'new_normal_same_position' | 'new_normal_different_position'

export function phase2c1SourceRelation(candidate: Pick<Phase2C1CandidateSummary, 'sourceKind' | 'sourceOwnedWeaponId' | 'normalPosition'>, other: Pick<Phase2BOptimumRoute, 'sourceKind' | 'sourceOwnedWeaponId' | 'normalPosition'>): Phase2C1SourceRelation {
  if (candidate.sourceKind === 'owned' && other.sourceKind === 'owned') return candidate.sourceOwnedWeaponId === other.sourceOwnedWeaponId ? 'same_owned_weapon' : 'different_owned_weapon'
  if (candidate.sourceKind === 'owned') return 'owned_to_new_normal'
  if (other.sourceKind === 'owned') return 'new_normal_to_owned'
  return candidate.normalPosition === other.normalPosition ? 'new_normal_same_position' : 'new_normal_different_position'
}

const requiredOf = (use: { readonly required?: readonly number[] } | null | undefined) => [...(use?.required ?? [])]
const sameList = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((value, index) => value === b[index])
const tally = (values: readonly string[]) => {
  const out: Record<string, number> = {}
  for (const value of values) out[value] = (out[value] ?? 0) + 1
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))
}

/** The 1,657 Plan's stream end of each stream key used by the Phase 2-C1 envelope (`skill`, `gogma`, `normal:<counter id>`). */
function optimumEnd(optimum: Phase2BOptimumEvidence, stream: string, weaponTypeId: string | null): number | null {
  if (stream === 'skill') return optimum.skill.end
  if (stream === 'gogma') return optimum.gogma.end
  return weaponTypeId !== null ? optimum.normal[weaponTypeId]?.end ?? null : null
}

function optimumRequiredMax(optimum: Phase2BOptimumEvidence, stream: string, weaponTypeId: string | null): number | null {
  const values = optimum.routes.flatMap(route => stream === 'skill' ? requiredOf(route.skill) : stream === 'gogma' ? requiredOf(route.gogma)
    : route.weaponTypeId === weaponTypeId && route.normalPosition !== null ? [route.normalPosition] : [])
  return values.length ? Math.max(...values) : null
}

export interface Phase2C1ComparisonInput {
  readonly control: FinishedAnalysis
  readonly origin: FinishedAnalysis
  readonly optimum: Phase2BOptimumEvidence
}

export function comparePhase2C1(input: Phase2C1ComparisonInput) {
  const { control, origin, optimum } = input
  const optimumByTarget = new Map(optimum.routes.map(route => [route.targetWeaponId, route]))
  const controlByTarget = new Map(control.candidates.map(candidate => [candidate.targetWeaponId, candidate]))
  if (control.pendingCount !== origin.pendingCount || control.discoveryOrder.some((id, index) => origin.discoveryOrder[index] !== id)) {
    throw new Error('Control and origin-independent runs did not search the same pending Targets in the same order.')
  }

  // Per pending Target: the origin-independent Candidate against the control Candidate and the 1,657 Route.
  const perTarget = origin.candidates.map(candidate => {
    const opt = optimumByTarget.get(candidate.targetWeaponId)
    if (!opt) throw new Error(`Optimum evidence lacks Target ${candidate.targetWeaponId}.`)
    const ctl = controlByTarget.get(candidate.targetWeaponId)!
    const found = candidate.found
    const relation = found ? phase2c1SourceRelation(candidate, opt) : null
    const sameSource = relation === 'same_owned_weapon' || relation === 'new_normal_same_position'
    return {
      discoveryIndex: candidate.discoveryIndex, targetWeaponId: candidate.targetWeaponId, weaponTypeId: candidate.weaponTypeId, elementId: candidate.elementId,
      origin: { found, foundBy: candidate.foundBy, sourceKind: candidate.sourceKind, sourceOwnedWeaponId: candidate.sourceOwnedWeaponId, normalPosition: candidate.normalPosition,
        routeKind: candidate.routeKind, estimatedOperationCount: candidate.estimatedOperationCount,
        gogmaRequiredMax: candidate.gogma?.requiredMax ?? null, skillRequiredMax: candidate.skill?.requiredMax ?? null },
      control: { foundBy: ctl.foundBy, sourceKind: ctl.sourceKind, sourceOwnedWeaponId: ctl.sourceOwnedWeaponId, normalPosition: ctl.normalPosition, routeKind: ctl.routeKind,
        estimatedOperationCount: ctl.estimatedOperationCount, gogmaRequiredMax: ctl.gogma?.requiredMax ?? null, skillRequiredMax: ctl.skill?.requiredMax ?? null },
      optimum: { sourceKind: opt.sourceKind, sourceOwnedWeaponId: opt.sourceOwnedWeaponId, normalPosition: opt.normalPosition, materializedBy: opt.materialization.method,
        routeKind: opt.materialization.routeKind, routeOperationCount: opt.routeOperationCount,
        gogmaRequiredMax: requiredOf(opt.gogma).length ? Math.max(...requiredOf(opt.gogma)) : null,
        skillRequiredMax: requiredOf(opt.skill).length ? Math.max(...requiredOf(opt.skill)) : null },
      sourceRelationToOptimum: relation,
      sourceRelationToControl: found && ctl.found ? phase2c1SourceRelation(candidate, { sourceKind: ctl.sourceKind!, sourceOwnedWeaponId: ctl.sourceOwnedWeaponId, normalPosition: ctl.normalPosition }) : null,
      /** Same source and the same required Gogma / Skill positions as the 1,657 Route (Normal: same production-target position). */
      requiredPositionsMatchOptimum: sameSource && sameList(requiredOf(candidate.gogma), requiredOf(opt.gogma)) && sameList(requiredOf(candidate.skill), requiredOf(opt.skill)),
    }
  })

  // Streams: control executed end (Plan), origin static required end (Route set), 1,657 end.
  const controlPlanStreams = control.final?.physical?.streams ?? {}
  const streams = origin.staticEnvelope.finalInput.streams.map(row => {
    const ctlStatic = control.staticEnvelope.finalInput.streams.find(other => other.stream === row.stream) ?? null
    const ctlPlan = (controlPlanStreams as Record<string, { end: number }>)[row.stream] ?? null
    return { stream: row.stream, weaponTypeId: row.weaponTypeId, origin: row.origin,
      controlPlanEnd: ctlPlan?.end ?? null, controlStaticRequiredEnd: ctlStatic?.requiredEnd ?? null, controlRequiredMax: ctlStatic?.requiredMax ?? null,
      originStaticRequiredEnd: row.requiredEnd, originRequiredMax: row.requiredMax, originGeneratedOnlyRequiredEnd:
        origin.staticEnvelope.generatedOnly.streams.find(other => other.stream === row.stream)?.requiredEnd ?? null,
      originSelectedRequiredEnd: origin.staticEnvelope.selected?.streams.find(other => other.stream === row.stream)?.requiredEnd ?? null,
      optimumEnd: optimumEnd(optimum, row.stream, row.weaponTypeId), optimumRequiredMax: optimumRequiredMax(optimum, row.stream, row.weaponTypeId) }
  })

  const crossesHeld = (route: Phase2BOptimumRoute) => [route.gogma, route.skill].some(use => use !== null && use.first !== null && use.last !== null && use.last - use.first + 1 > use.operations)
  const optimumSourceUse = new Map<string, number>()
  for (const route of optimum.routes) if (route.sourceOwnedWeaponId) optimumSourceUse.set(route.sourceOwnedWeaponId, (optimumSourceUse.get(route.sourceOwnedWeaponId) ?? 0) + 1)

  return {
    perTarget,
    sourceRelationToOptimum: tally(perTarget.filter(row => row.sourceRelationToOptimum !== null).map(row => row.sourceRelationToOptimum!)),
    sourceRelationToControl: tally(perTarget.filter(row => row.sourceRelationToControl !== null).map(row => row.sourceRelationToControl!)),
    requiredPositionsMatchOptimum: perTarget.filter(row => row.requiredPositionsMatchOptimum).length,
    streams,
    optimum: {
      physicalOperations: optimum.physicalOperations, routeOperationSum: optimum.routeOperationSum, targets: optimum.routes.length,
      ownedSourceTargets: optimum.routes.filter(route => route.sourceKind === 'owned').length,
      newNormalSourceTargets: optimum.routes.filter(route => route.sourceKind === 'new_normal').length,
      materializedBy: tally(optimum.routes.map(route => route.materialization.method)),
      heldRoutes: optimum.routes.filter(crossesHeld).length,
      ownedWeaponsUsedByMoreThanOneRoute: [...optimumSourceUse.values()].filter(count => count > 1).length,
      newNormalPositionsByWeaponType: tally(optimum.routes.filter(route => route.sourceKind === 'new_normal').map(route => `${route.weaponTypeId}@${route.normalPosition}`)),
    },
  }
}
