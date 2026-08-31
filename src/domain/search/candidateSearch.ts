import type { RouteKind, TargetWeapon } from '../models/publicTypes'
import type { RngEngine } from '../rng/rngEngine'
import {
  deduplicateCandidates,
  filterCandidates,
  sortCandidates,
} from './candidateProcessing'
import { searchExistingGogmaRoutes } from './existingGogmaRouteSearch'
import { searchNormalArtianRoutes } from './normalArtianRouteSearch'
import { searchOwnedNormalArtianRoutes } from './ownedNormalArtianRouteSearch'
import { createSearchPredictionSupport } from './routeSearchShared'
import {
  createSearchExecutionContext,
  type CandidateSearchExecutionOptions,
} from './searchExecution'
import type {
  CandidateSearchInput,
  CandidateSearchResult,
  CandidateSearchWarning,
  SkippedRoute,
  TargetCandidateSearchResult,
} from './searchTypes'
import { assertCandidateSearchInput } from './searchValidation'

const routeOrder: RouteKind[] = [
  'normal_artian_to_gogma',
  'owned_normal_artian_to_gogma',
  'existing_gogma_reset_bonuses',
  'existing_gogma_keep_bonuses',
  'existing_gogma_reset_skills',
  'existing_gogma_mixed',
]
const normalRouteKinds: RouteKind[] = [
  'normal_artian_to_gogma',
  'owned_normal_artian_to_gogma',
]
const existingGogmaRouteKinds: RouteKind[] = [
  'existing_gogma_reset_bonuses',
  'existing_gogma_keep_bonuses',
  'existing_gogma_reset_skills',
  'existing_gogma_mixed',
]

function routeKindsForFilter(
  filter: CandidateSearchInput['routeFilter'],
): RouteKind[] {
  if (filter === 'normal_artian') return normalRouteKinds
  if (filter === 'existing_gogma') return existingGogmaRouteKinds
  return routeOrder
}

function compareTargets(left: TargetWeapon, right: TargetWeapon): number {
  return (
    right.priority - left.priority ||
    right.updatedAt.localeCompare(left.updatedAt) ||
    left.id.localeCompare(right.id)
  )
}

function uniqueSkippedRoutes(routes: readonly SkippedRoute[]): SkippedRoute[] {
  const keys = new Set<string>()
  return routes.filter((route) => {
    const key = `${route.route}\u0000${route.reason}\u0000${route.detail}`
    if (keys.has(key)) return false
    keys.add(key)
    return true
  })
}

function selectedTargets(
  input: CandidateSearchInput,
): { targets: TargetWeapon[]; warnings: CandidateSearchWarning[] } {
  const byId = new Map(input.targetWeapons.map((target) => [target.id, target]))
  const warnings: CandidateSearchWarning[] = []
  const ids = [...new Set(input.targetWeaponIds)]
  const targets = ids.flatMap((id) => {
    const target = byId.get(id)
    if (!target) {
      warnings.push({
        targetWeaponId: id,
        message: `TargetWeapon '${id}' does not exist and was not searched.`,
      })
      return []
    }
    if (!target.isEnabled) {
      warnings.push({
        targetWeaponId: id,
        message: `TargetWeapon '${id}' is disabled and was not searched.`,
      })
      return []
    }
    return [target]
  })
  return { targets: targets.sort(compareTargets), warnings }
}

function contextSkippedRoutes(input: CandidateSearchInput): SkippedRoute[] {
  const detail = 'The RNG Engine version does not match CalculationContext.'
  return routeKindsForFilter(input.routeFilter).map((route) => ({
    route,
    reason: 'calculation_context_incompatible',
    detail,
  }))
}

async function searchTarget(
  target: TargetWeapon,
  input: CandidateSearchInput,
  engine: RngEngine,
  execution: ReturnType<typeof createSearchExecutionContext>,
): Promise<{ result: TargetCandidateSearchResult; warnings: CandidateSearchWarning[]; truncated: boolean }> {
  const skippedRoutes: SkippedRoute[] = []
  const searchedRoutes: RouteKind[] = []
  const candidates = []
  const warnings: CandidateSearchWarning[] = []

  if (engine.version !== input.calculationContext.rngEngineVersion) {
    return {
      result: {
        targetWeaponId: target.id,
        candidates: [],
        searchedRoutes: [],
        skippedRoutes: contextSkippedRoutes(input),
      },
      warnings,
      truncated: false,
    }
  }

  const routeContext = {
    target,
    input,
    engine,
    execution,
    predictionSupport: createSearchPredictionSupport(engine, target, input.master),
  }

  if (input.routeFilter === 'existing_gogma') {
    skippedRoutes.push(...normalRouteKinds.map((route) => ({
      route,
      reason: 'disabled_by_filter',
      detail: 'Normal Artian routes are disabled by routeFilter.',
    } as const)))
  } else {
    const normalResult = await searchNormalArtianRoutes(routeContext)
    candidates.push(...normalResult.candidates)
    searchedRoutes.push(...normalResult.searchedRoutes)
    skippedRoutes.push(...normalResult.skippedRoutes)
    warnings.push(...normalResult.warnings)
    const ownedNormalResult = await searchOwnedNormalArtianRoutes(routeContext)
    candidates.push(...ownedNormalResult.candidates)
    searchedRoutes.push(...ownedNormalResult.searchedRoutes)
    skippedRoutes.push(...ownedNormalResult.skippedRoutes)
    warnings.push(...ownedNormalResult.warnings)
  }

  if (input.routeFilter === 'normal_artian') {
    skippedRoutes.push(...existingGogmaRouteKinds.map((route) => ({
      route,
      reason: 'disabled_by_filter',
      detail: 'Existing Gogma routes are disabled by routeFilter.',
    } as const)))
  } else {
    const existingResult = await searchExistingGogmaRoutes(routeContext)
    candidates.push(...existingResult.candidates)
    searchedRoutes.push(...existingResult.searchedRoutes)
    skippedRoutes.push(...existingResult.skippedRoutes)
    warnings.push(...existingResult.warnings)
  }

  const processed = filterCandidates(
    sortCandidates(deduplicateCandidates(candidates)),
    input.resultFilter,
  )
  const truncated = processed.length > input.settings.maxCandidatesPerTarget
  const orderedSearchedRoutes = routeOrder.filter((route) =>
    searchedRoutes.includes(route),
  )
  const searchedRouteSet = new Set(orderedSearchedRoutes)
  return {
    result: {
      targetWeaponId: target.id,
      candidates: processed.slice(0, input.settings.maxCandidatesPerTarget),
      searchedRoutes: orderedSearchedRoutes,
      skippedRoutes: uniqueSkippedRoutes(skippedRoutes).filter(
        ({ route }) => !searchedRouteSet.has(route),
      ),
    },
    warnings,
    truncated,
  }
}

export async function searchCandidates(
  input: CandidateSearchInput,
  engine: RngEngine,
  options: CandidateSearchExecutionOptions = {},
): Promise<CandidateSearchResult> {
  assertCandidateSearchInput(input)
  const execution = createSearchExecutionContext(options)
  const startedAt = execution.nowMs()
  const selection = selectedTargets(input)
  const targetResults: TargetCandidateSearchResult[] = []
  const warnings = [...selection.warnings]
  let isTruncated = false

  for (let index = 0; index < selection.targets.length; index += 1) {
    await execution.checkpoint()
    const target = selection.targets[index]
    const searched = await searchTarget(target, input, engine, execution)
    targetResults.push(searched.result)
    warnings.push(...searched.warnings)
    isTruncated ||= searched.truncated
    execution.onProgress({
      completedTargets: index + 1,
      totalTargets: selection.targets.length,
      currentTargetWeaponId: target.id,
    })
    await (options.yieldControl ?? (() => Promise.resolve()))()
  }

  return {
    searchRunId: input.searchRunId,
    calculationContext: { ...input.calculationContext },
    targetResults,
    relaxationSuggestions: [],
    warnings,
    elapsedMs: Math.max(0, execution.nowMs() - startedAt),
    isTruncated,
  }
}
