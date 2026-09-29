/**
 * Issue #154 Global Planner Research Phase 2-C2.5-D2-e: the Browser workload and the Node D2-d reference. Research only.
 * Never import from Production.
 *
 * D2-e re-measures, in the Chrome Dedicated Worker and under the D2-b (Phase 2-C2.5-B) observation and classification
 * boundary, the current Production Search after D2-d removed the held-aware Bonus stream's past-depth raw solution
 * retention (H1). The workload is exactly the D2-d one, and it is derived, never named:
 *
 * ```text
 * committed D2-d RESULT -> formal reference checks (fail closed) -> its workloadSelection
 * C2.5-A evidence -> phase2c25d2bWorkload() (the D2-b / D2-a rule, unchanged)
 *   -> both must name the same contexts (orientation, work index, Target, context digest, role family), else fail closed
 * ```
 *
 * No orientation, Target, Entry ID or Counter position is named in code. The D2-d RESULT only selects / confirms the
 * contexts and is the post-hoc parity reference; it never reaches a Worker, and no Candidate, oracle or Route state of it
 * is a Search input.
 */
import type { Phase2C25BEvidenceView } from './plannerGlobalPhase2C25BEvidence'
import { phase2c25d2bWorkload, type Phase2C25D2BWorkloadContext } from './plannerGlobalPhase2C25D2B'

/** The D2-d RESULT roles (`workloadSelection`). */
export type Phase2C25D2DSelectionRole = 'primary_oom' | 'cleared_reference' | 'control_first_candidate' | 'control_stopped_by_extent'

export interface Phase2C25D2ESelectionItem {
  readonly role: Phase2C25D2DSelectionRole
  readonly orientationId: string
  readonly workIndex: number
  readonly targetWeaponId: string
  readonly contextDigest: string
}

/**
 * What the committed D2-d RESULT must say before it may be the D2-e reference: a formal run whose post-hoc formal run
 * validation passed, over 5 contexts, whose 2 primaries both left the OOM and ended normally, with D2-a semantic parity
 * and no mode semantic parity failure. These are checks of the reference, not a workload selection.
 */
export const PHASE2C25D2E_D2D_REFERENCE_REQUIREMENTS = {
  formal: true,
  formalRunValidationValid: true,
  contexts: 5,
  primaryLeftOom: 2,
  primaryEndedNormally: 2,
  semanticParityWithD2A: true,
  modeSemanticParityFailures: 0,
} as const

export interface Phase2C25D2EReference {
  readonly measuredHead: string
  readonly exportSha256: string
  readonly c25aEvidenceSha256: string
  readonly validation: {
    readonly formal: boolean
    readonly formalRunValidationValid: boolean
    readonly contexts: number
    readonly primaryLeftOom: number
    readonly primaryEndedNormally: number
    readonly semanticParityWithD2A: boolean
    readonly modeSemanticParityFailures: number
  }
  /** `workloadSelection` in its order: primary, cleared references, controls. */
  readonly selection: readonly Phase2C25D2ESelectionItem[]
}

const SOURCE = 'D2-d RESULT'
function fail(message: string): never {
  throw new Error(`${SOURCE}: ${message}`)
}
function obj(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(`${where} is not an object.`)
  return value as Record<string, unknown>
}
function arr(value: unknown, where: string): unknown[] {
  if (!Array.isArray(value)) fail(`${where} is not an array.`)
  return value
}
function str(value: unknown, where: string): string {
  if (typeof value !== 'string' || value.length === 0) fail(`${where} is not a non-empty string.`)
  return value
}
function int(value: unknown, where: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) fail(`${where} is not a non-negative integer.`)
  return value
}

const ROLES: readonly Phase2C25D2DSelectionRole[] = ['primary_oom', 'cleared_reference', 'control_first_candidate', 'control_stopped_by_extent']

/**
 * The committed D2-d RESULT as the D2-e reference. Every requirement of `PHASE2C25D2E_D2D_REFERENCE_REQUIREMENTS` is
 * checked and any other value fails closed, as does a malformed selection item or an unselected OOM representative.
 */
export function parsePhase2C25D2EReference(json: unknown): Phase2C25D2EReference {
  const root = obj(json, 'root')
  const provenance = obj(root.provenance, 'provenance')
  const formalRunValidation = obj(root.formalRunValidation, 'formalRunValidation')
  const totals = obj(root.totals, 'totals')
  const validation = {
    formal: provenance.formal === true,
    formalRunValidationValid: formalRunValidation.valid === true,
    contexts: arr(root.contexts, 'contexts').length,
    primaryLeftOom: int(totals.primaryLeftOom, 'totals.primaryLeftOom'),
    primaryEndedNormally: int(totals.primaryEndedNormally, 'totals.primaryEndedNormally'),
    semanticParityWithD2A: totals.semanticParityWithD2A === true,
    modeSemanticParityFailures: int(totals.modeSemanticParityFailures, 'totals.modeSemanticParityFailures'),
  }
  for (const [key, expected] of Object.entries(PHASE2C25D2E_D2D_REFERENCE_REQUIREMENTS)) {
    const actual = validation[key as keyof typeof validation]
    if (actual !== expected) fail(`${key} is ${String(actual)}, not ${String(expected)}; it is not a formal D2-e reference.`)
  }
  const selectionRoot = obj(root.workloadSelection, 'workloadSelection')
  if (arr(selectionRoot.unselected, 'workloadSelection.unselected').length !== 0) fail('workloadSelection.unselected is not empty.')
  const selection = (['primary', 'clearedReferences', 'controls'] as const).flatMap(group => arr(selectionRoot[group], `workloadSelection.${group}`).map((raw, i) => {
    const where = `workloadSelection.${group}[${i}]`
    const item = obj(raw, where)
    const role = str(item.role, `${where}.role`) as Phase2C25D2DSelectionRole
    if (!ROLES.includes(role)) fail(`${where}.role ${role} is unknown.`)
    const groupRoles: Record<typeof group, readonly Phase2C25D2DSelectionRole[]> = { primary: ['primary_oom'], clearedReferences: ['cleared_reference'],
      controls: ['control_first_candidate', 'control_stopped_by_extent'] }
    if (!groupRoles[group].includes(role)) fail(`${where}.role ${role} does not belong to ${group}.`)
    return { role, orientationId: str(item.orientationId, `${where}.orientationId`), workIndex: int(item.workIndex, `${where}.workIndex`),
      targetWeaponId: str(item.targetWeaponId, `${where}.targetWeaponId`), contextDigest: str(item.contextDigest, `${where}.contextDigest`) }
  }))
  if (selection.length !== validation.contexts) fail(`workloadSelection names ${selection.length} contexts, the RESULT holds ${validation.contexts}.`)
  const keys = selection.map(s => `${s.orientationId}#${s.workIndex}`)
  if (new Set(keys).size !== keys.length) fail('workloadSelection names a context twice.')
  return {
    measuredHead: str(provenance.measuredHead, 'provenance.measuredHead'), exportSha256: str(provenance.exportSha256, 'provenance.exportSha256'),
    c25aEvidenceSha256: str(provenance.c25aEvidenceSha256, 'provenance.c25aEvidenceSha256'), validation, selection,
  }
}

export interface Phase2C25D2EWorkloadContext extends Phase2C25D2BWorkloadContext {
  /** The role the committed D2-d RESULT gave this context. */
  readonly d2dRole: Phase2C25D2DSelectionRole
}

const d2dRoleFamily = (role: Phase2C25D2DSelectionRole) => role === 'primary_oom' || role === 'cleared_reference' ? 'oom_representative' : role

/**
 * The D2-e workload: the D2-b rule (`phase2c25d2bWorkload()`) re-applied to the C2.5-A evidence, in its order, which must
 * name exactly the contexts of the D2-d RESULT's `workloadSelection` - the same orientation, work index, Target and context
 * digest, and a role of the same family (a D2-d primary / cleared reference is a D2-b OOM representative, a D2-d control is
 * the same D2-b control). The D2-d RESULT must also have measured the same Export. Anything else fails closed.
 */
export function phase2c25d2eWorkload(view: Phase2C25BEvidenceView, c25aJson: unknown, reference: Phase2C25D2EReference): Phase2C25D2EWorkloadContext[] {
  if (reference.exportSha256 !== view.exportSha256) throw new Error('The D2-d RESULT measured another Export than the Phase 2-C2.5-A evidence.')
  const rule = phase2c25d2bWorkload(view, c25aJson)
  const unmatched = reference.selection.filter(s => !rule.some(c => c.orientationId === s.orientationId && c.workIndex === s.workIndex))
  if (rule.length !== reference.selection.length || unmatched.length > 0) {
    throw new Error(`The D2-b rule selects ${rule.map(c => `${c.orientationId}#${c.workIndex}`).join(', ')}, the D2-d RESULT ${reference.selection
      .map(s => `${s.orientationId}#${s.workIndex}`).join(', ')}: the workloads differ.`)
  }
  return rule.map(context => {
    const item = reference.selection.find(s => s.orientationId === context.orientationId && s.workIndex === context.workIndex)!
    if (item.targetWeaponId !== context.targetWeaponId || item.contextDigest !== context.contextDigest) {
      throw new Error(`${context.orientationId}#${context.workIndex}: the D2-d RESULT names another Target or context digest than the D2-b rule.`)
    }
    if (d2dRoleFamily(item.role) !== context.selectionRole) {
      throw new Error(`${context.orientationId}#${context.workIndex}: D2-d role ${item.role} disagrees with the D2-b selection role ${context.selectionRole}.`)
    }
    return { ...context, d2dRole: item.role }
  })
}
