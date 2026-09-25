import type { BuildRoute } from '../domain/models/publicTypes'
import type { Issue101RouteSummary } from './issue101ConstrainedResearchProtocol'

/** Summarizes a Route without retaining it. */
export function summarizeIssue101Route(
  route: BuildRoute,
  estimates: {
    readonly estimatedGogmaAdvance: number
    readonly estimatedSkillAdvance: number
    readonly estimatedNormalAdvance: number | null
  },
): Issue101RouteSummary {
  let normalForgeCount: number | null = null
  let normalCounterBefore: number | null = null
  let conversionSkillCounter: number | null = null
  let resetBonusesCount = 0
  let keepBonusesCount = 0
  let resetSkillsCount = 0
  let firstGogmaCounter: number | null = null
  let lastGogmaCounter: number | null = null
  for (const operation of route.operations) {
    switch (operation.type) {
      case 'create_normal_artian':
        normalForgeCount = (normalForgeCount ?? 0) + operation.count
        normalCounterBefore ??= operation.normalCounterBefore
        break
      case 'convert_normal_to_gogma':
        conversionSkillCounter = operation.skillCounterBefore
        break
      case 'reset_bonuses':
      case 'keep_bonuses':
        if (operation.type === 'reset_bonuses') resetBonusesCount += 1
        else keepBonusesCount += 1
        firstGogmaCounter ??= operation.gogmaCounterBefore
        lastGogmaCounter = operation.gogmaCounterBefore
        break
      case 'reset_skills':
        resetSkillsCount += 1
        break
    }
  }
  return {
    kind: route.kind,
    operationCount: route.operations.length,
    normalForgeCount,
    normalCounterBefore,
    conversionSkillCounter,
    resetBonusesCount,
    keepBonusesCount,
    resetSkillsCount,
    firstGogmaCounter,
    lastGogmaCounter,
    estimatedGogmaAdvance: estimates.estimatedGogmaAdvance,
    estimatedSkillAdvance: estimates.estimatedSkillAdvance,
    estimatedNormalAdvance: estimates.estimatedNormalAdvance,
  }
}
