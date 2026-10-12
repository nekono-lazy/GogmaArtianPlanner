/**
 * Test-only fixtures for the Phase B-1 resource assignment solver (Issue #154). Hand-built ReachTables
 * (no Engine, no oracle, no real Target or weapon ID) and a brute-force enumerator of every complete
 * assignment that re-derives C1 / C2 and the objective on its own, independently of the solver's
 * feasibility, ordering and lower-bound modules. The brute force is the correctness reference of the
 * solver tests (design 13.1 Phase B).
 */
import type { ElementId, TargetWeaponId, WeaponTypeId } from '../../domain/models/publicTypes'
import type { PlanningTargetPriority } from './assignmentTypes'
import { enumerateReachOptions, reachOptionKey } from './reachOptions'
import type { ReachOption, ReachTable, ReachWindow, SourceCandidate, TargetReach } from './types'

export const COUNTER_A = 'weapon.fixture.a:8'
export const COUNTER_B = 'weapon.fixture.b:8'

export const targetId = (value: string): TargetWeaponId => value as TargetWeaponId

type GogmaSourceOverrides = Partial<Extract<SourceCandidate, { kind: 'owned_gogma' }>>

export function gogmaSource(id: string, overrides: GogmaSourceOverrides = {}): SourceCandidate {
  return { kind: 'owned_gogma', ownedWeaponId: id, layout: 'X', scope: 'gogma_artian', currentSkillIdeal: false, currentBonusIdeal: false, isProtected: false, keepSupported: true, ...overrides } as SourceCandidate
}

export function normalSource(id: string, layout = 'L'): SourceCandidate {
  return { kind: 'owned_normal', ownedWeaponId: id, layout, isProtected: false, keepSupported: true } as SourceCandidate
}

export function newNormalSource(position: number, layout = 'X', counterId = COUNTER_A): SourceCandidate {
  return { kind: 'new_normal', counterId, position, layout, keepSupported: true }
}

/** Ideal Skill at 8 and 10 of a Skill window 7..11 (Reset Skills up to 10, a conversion up to 11). */
export const DEFAULT_SKILL: TargetReach['skill'] = { idealPositions: [8, 10], resetSkillsLimit: 10, conversionLimit: 11 }

/**
 * Gogma window 10..15: Ideal Reset at 12; Reset layouts X / L / I / X / L at 10..14; Keep-Ideal at 11 and
 * 13 from layout I, at 13 and 15 from layout L (so `reset_then_keep` is (11, 13), (12, 13), (11, 15), (14, 15)).
 */
export function defaultBonus(): TargetReach['bonus'] {
  return {
    resetIdealPositions: [12],
    resetLayoutByPosition: new Map([[10, 'X'], [11, 'L'], [12, 'I'], [13, 'X'], [14, 'L']]),
    keepIdealPositionsByLayout: new Map([['I', [11, 13]], ['L', [13, 15]]]),
    keepUnsupportedLayouts: [],
  }
}

/** The option-free Bonus row: no Ideal Reset, no Keep layout of interest. */
export function noBonus(): TargetReach['bonus'] {
  return { resetIdealPositions: [], resetLayoutByPosition: new Map(), keepIdealPositionsByLayout: new Map(), keepUnsupportedLayouts: [] }
}

export interface HandBuiltTargetSpec {
  id: string
  weaponTypeId?: string
  elementId?: string
  /** Default `COUNTER_A`; `null` for a Target without a confirmed Normal Counter. */
  normalCounterId?: string | null
  sources: SourceCandidate[]
  skill?: Partial<TargetReach['skill']>
  bonus?: Partial<TargetReach['bonus']>
  priority?: 1 | 2 | 3 | 4 | 5
}

export interface HandBuiltTableSpec {
  originSkill?: number
  originGogma?: number
  originNormal?: Record<string, number>
  window?: ReachWindow
  targets: HandBuiltTargetSpec[]
}

/** A ReachTable with the given rows (Target ID order, like a context's planning Targets) and the matching planning Target list. */
export function handBuiltReachTable(spec: HandBuiltTableSpec): { table: ReachTable; planningTargets: PlanningTargetPriority[] } {
  const originSkill = spec.originSkill ?? 7
  const originGogma = spec.originGogma ?? 10
  const originNormal = spec.originNormal ?? { [COUNTER_A]: 4 }
  const window = spec.window ?? { skill: 4, gogma: 6, normal: 3 }
  const sorted = [...spec.targets].sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
  const targets: TargetReach[] = sorted.map(target => ({
    targetWeaponId: targetId(target.id),
    weaponTypeId: (target.weaponTypeId ?? 'weapon.fixture.a') as WeaponTypeId,
    elementId: (target.elementId ?? 'element.fixture.a') as ElementId,
    normalCounterId: target.normalCounterId === undefined ? COUNTER_A : target.normalCounterId,
    support: { normal: true, skill: true, gogmaReset: true },
    skill: { ...DEFAULT_SKILL, ...target.skill },
    bonus: { ...defaultBonus(), ...target.bonus },
    sources: target.sources,
    excludedOwnedWeapons: [],
  }))
  const table: ReachTable = {
    originSkill, originGogma, originNormal, window,
    scanned: {
      skill: { from: originSkill, to: originSkill + window.skill },
      gogma: { from: originGogma, to: originGogma + window.gogma - 1 },
      normal: Object.fromEntries(Object.entries(originNormal).map(([counterId, origin]) => [counterId, { from: origin, to: origin + window.normal - 1 }])),
    },
    targets,
    summary: { predictions: { skill: 0, gogmaReset: 0, gogmaKeep: 0, normal: 0 }, memoHits: { skill: 0, gogmaReset: 0, gogmaKeep: 0, normal: 0 }, supportQueries: 0, groups: [], unsupported: [] },
  }
  const planningTargets = sorted.map(target => ({ id: targetId(target.id), priority: target.priority ?? 3 }))
  return { table, planningTargets }
}

/** Sorted option keys joined: the identity of one complete assignment, independent of assignment order. */
export function assignmentKeyOf(options: Iterable<ReachOption>): string {
  return [...options].map(option => reachOptionKey(option)).sort().join('\n')
}

interface BruteOption {
  option: ReachOption
  source: string
  skill: number[]
  gogma: number[]
  normal: string | null
}

/** The resources of one option, derived here on purpose (not through the solver's feasibility module). */
function bruteOption(option: ReachOption): BruteOption {
  const source = option.source.kind === 'new_normal' ? `N|${option.source.counterId}|${option.source.position}` : `O|${option.source.ownedWeaponId}`
  const skill = option.skillRequired.kind === 'none' ? []
    : option.skillRequired.kind === 'reset_skills' ? [option.skillRequired.finalPosition]
      : [...new Set([option.skillRequired.conversionPosition, option.skillRequired.finalPosition])]
  const gogma = option.bonusRequired.kind === 'none' ? []
    : option.bonusRequired.kind === 'reset_then_keep' ? [option.bonusRequired.resetPosition, option.bonusRequired.finalPosition]
      : [option.bonusRequired.finalPosition]
  const normal = option.normalRequired === null ? null : `${option.normalRequired.counterId}|${option.normalRequired.position}`
  return { option, source, skill, gogma, normal }
}

/** Σ_streams (max streamEnd − origin), computed from the options' own `streamEnd`s. */
export function bruteObjective(options: readonly ReachOption[], table: ReachTable): number {
  let skill = table.originSkill
  let gogma = table.originGogma
  const normal: Record<string, number> = { ...table.originNormal }
  for (const option of options) {
    skill = Math.max(skill, option.streamEnd.skill)
    gogma = Math.max(gogma, option.streamEnd.gogma)
    for (const [counterId, end] of Object.entries(option.streamEnd.normal)) normal[counterId] = Math.max(normal[counterId] ?? end, end)
  }
  let total = (skill - table.originSkill) + (gogma - table.originGogma)
  for (const [counterId, origin] of Object.entries(table.originNormal)) total += normal[counterId]! - origin
  return total
}

export interface BruteAssignment {
  /** Table Target order. */
  options: ReachOption[]
  key: string
  objective: number
}

function disjoint(values: readonly number[], used: readonly number[]): boolean {
  return values.every(value => !used.includes(value))
}

/**
 * Every complete assignment satisfying C1 / C2, by a plain product over Phase A's full option lists, in
 * Target order. `prefix` fixes the first Targets' options (the brute force of a partial assignment).
 */
export function bruteForceAssignments(table: ReachTable, prefix: readonly ReachOption[] = []): BruteAssignment[] {
  const optionsPerTarget = table.targets.map(target => [...enumerateReachOptions(target, table)].map(bruteOption))
  const results: BruteAssignment[] = []
  const chosen: BruteOption[] = []
  const usedSources: string[] = []
  const usedSkill: number[] = []
  const usedGogma: number[] = []
  const usedNormal: string[] = []
  const feasible = (candidate: BruteOption) => !usedSources.includes(candidate.source) && disjoint(candidate.skill, usedSkill)
    && disjoint(candidate.gogma, usedGogma) && (candidate.normal === null || !usedNormal.includes(candidate.normal))
  const push = (candidate: BruteOption) => {
    chosen.push(candidate)
    usedSources.push(candidate.source)
    usedSkill.push(...candidate.skill)
    usedGogma.push(...candidate.gogma)
    if (candidate.normal !== null) usedNormal.push(candidate.normal)
  }
  const pop = (candidate: BruteOption) => {
    chosen.pop()
    usedSources.pop()
    usedSkill.length -= candidate.skill.length
    usedGogma.length -= candidate.gogma.length
    if (candidate.normal !== null) usedNormal.pop()
  }
  const recurse = (index: number) => {
    if (index === table.targets.length) {
      const options = chosen.map(entry => entry.option)
      results.push({ options, key: assignmentKeyOf(options), objective: bruteObjective(options, table) })
      return
    }
    const fixed = prefix[index]
    const candidates = fixed === undefined ? optionsPerTarget[index]! : optionsPerTarget[index]!.filter(entry => reachOptionKey(entry.option) === reachOptionKey(fixed))
    for (const candidate of candidates) {
      if (!feasible(candidate)) continue
      push(candidate)
      recurse(index + 1)
      pop(candidate)
    }
  }
  recurse(0)
  return results
}

/** The smallest objective of any complete assignment extending `prefix` (Target order), or null when none exists. */
export function bruteMinCompletionObjective(table: ReachTable, prefix: readonly ReachOption[]): number | null {
  const completions = bruteForceAssignments(table, prefix)
  return completions.length === 0 ? null : Math.min(...completions.map(completion => completion.objective))
}
