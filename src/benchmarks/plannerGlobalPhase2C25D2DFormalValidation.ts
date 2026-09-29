/**
 * Issue #154 Phase 2-C2.5-D2-d: the formal completeness check of one raw run, Research only. Never import from
 * Production.
 *
 * This is post-hoc code (added after the formal measurement at `aebe6bbb2e52ca59641fb70b25754de0a76b78c5`): it decides
 * whether a raw run may become formal evidence, and neither the runner nor any Search / benchmark calculation imports
 * it. The analyzer runs it before `analyzePhase2C25D2DRun()`, which stays a Partial-tolerant helper; an incomplete
 * series is rejected here instead of being analysed with missing modes read as "not evaluated".
 *
 * The expected workload is the one the runner derived (`selectPhase2C25D2CWorkload()` -> `phase2c25d2dWorkloadItems()`),
 * passed in by the caller; nothing here fixes an ID or a count. The raw run is read as untrusted JSON.
 */
import { PHASE2C25D2D_MODES } from './plannerGlobalPhase2C25D2D'
import type { Phase2C25D2CWorkloadItem } from './plannerGlobalPhase2C25D2C'

type ExpectedItem = Pick<Phase2C25D2CWorkloadItem, 'orientationId' | 'workIndex' | 'targetWeaponId' | 'role' | 'contextDigest'>

/** The item fields a raw run record must carry exactly as the expected workload item. */
export const PHASE2C25D2D_FORMAL_ITEM_FIELDS = ['orientationId', 'workIndex', 'targetWeaponId', 'role', 'contextDigest'] as const

export interface Phase2C25D2DFormalRunValidation {
  valid: boolean
  /** Every reason the run is not a complete formal series; empty when valid. */
  failures: string[]
  rawStatus: string | null
  smokeIsNull: boolean
  uncommittedBenchmarkCode: boolean | null
  expectedModes: string[]
  environmentModes: string[] | null
  environmentModeMismatch: boolean
  expectedContexts: number
  actualContexts: number
  expectedSearchRuns: number
  actualSearchRuns: number
  missingContexts: string[]
  duplicateContexts: string[]
  unexpectedContexts: string[]
  itemMismatches: { context: string; field: string; expected: unknown; actual: unknown }[]
  missingModes: { context: string; mode: string }[]
  unexpectedModes: { context: string; mode: string }[]
  /** Auxiliary: the child processes the parent recorded (`contexts` child 1, Search child = expectedSearchRuns). */
  processCounts: { contexts: number; search: number; other: number }
  processCountMismatch: boolean
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const keyOf = (orientationId: unknown, workIndex: unknown) => `${String(orientationId)}#${String(workIndex)}`

/**
 * Whether `raw` is a complete formal D2-d series over `expected`: status completed, no smoke option, committed
 * benchmark code, `environment.modes` exactly the D2-d modes, exactly one run record per expected context with the
 * expected item metadata, no foreign or duplicate context, and every expected mode (and no other) in every record.
 */
export function validatePhase2C25D2DFormalRun(expected: readonly ExpectedItem[], raw: unknown): Phase2C25D2DFormalRunValidation {
  const failures: string[] = []
  const root = isObject(raw) ? raw : {}
  if (!isObject(raw)) failures.push('the raw run is not an object')
  const environment = isObject(root.environment) ? root.environment : null
  if (environment === null) failures.push('environment is missing')
  const expectedModes: string[] = [...PHASE2C25D2D_MODES]

  const rawStatus = typeof root.status === 'string' ? root.status : null
  if (rawStatus !== 'completed') failures.push(`raw status is ${String(rawStatus)}, not completed`)
  const smokeIsNull = environment !== null && environment.smoke === null
  if (!smokeIsNull) failures.push('environment.smoke is not null (a smoke run is never formal)')
  const uncommittedBenchmarkCode = environment !== null && typeof environment.uncommittedBenchmarkCode === 'boolean' ? environment.uncommittedBenchmarkCode : null
  if (uncommittedBenchmarkCode !== false) failures.push('environment.uncommittedBenchmarkCode is not false')

  const environmentModes = environment !== null && Array.isArray(environment.modes) ? environment.modes.map(String) : null
  const environmentModeMismatch = environmentModes === null ||
    environmentModes.length !== expectedModes.length || new Set(environmentModes).size !== expectedModes.length ||
    !expectedModes.every(mode => environmentModes.includes(mode))
  if (environmentModeMismatch) failures.push(`environment.modes is ${JSON.stringify(environmentModes)}, not exactly ${JSON.stringify(expectedModes)}`)

  const runs = Array.isArray(root.runs) ? root.runs : null
  if (runs === null) failures.push('runs is not an array')
  const expectedByKey = new Map(expected.map(item => [keyOf(item.orientationId, item.workIndex), item]))
  const records = new Map<string, Record<string, unknown>[]>()
  const unexpectedContexts: string[] = []
  for (const [index, run] of (runs ?? []).entries()) {
    const item = isObject(run) && isObject(run.item) ? run.item : null
    if (item === null) {
      unexpectedContexts.push(`runs[${index}] (no item)`)
      continue
    }
    const key = keyOf(item.orientationId, item.workIndex)
    if (!expectedByKey.has(key)) {
      unexpectedContexts.push(key)
      continue
    }
    records.set(key, [...(records.get(key) ?? []), run as Record<string, unknown>])
  }

  const missingContexts: string[] = []
  const duplicateContexts: string[] = []
  const itemMismatches: Phase2C25D2DFormalRunValidation['itemMismatches'] = []
  const missingModes: Phase2C25D2DFormalRunValidation['missingModes'] = []
  const unexpectedModes: Phase2C25D2DFormalRunValidation['unexpectedModes'] = []
  let actualSearchRuns = 0
  for (const [key, item] of expectedByKey) {
    const found = records.get(key) ?? []
    if (found.length === 0) missingContexts.push(key)
    if (found.length > 1) duplicateContexts.push(key)
    for (const run of found) {
      const actual = run.item as Record<string, unknown>
      for (const field of PHASE2C25D2D_FORMAL_ITEM_FIELDS) {
        if (actual[field] !== item[field]) itemMismatches.push({ context: key, field, expected: item[field], actual: actual[field] })
      }
      const modes = isObject(run.modes) ? run.modes : {}
      for (const mode of expectedModes) {
        if (isObject(modes[mode])) actualSearchRuns += 1
        else missingModes.push({ context: key, mode })
      }
      for (const mode of Object.keys(modes)) {
        if (!expectedModes.includes(mode)) unexpectedModes.push({ context: key, mode })
      }
    }
  }
  if (missingContexts.length > 0) failures.push(`missing contexts: ${missingContexts.join(', ')}`)
  if (duplicateContexts.length > 0) failures.push(`duplicate contexts: ${duplicateContexts.join(', ')}`)
  if (unexpectedContexts.length > 0) failures.push(`unexpected contexts: ${unexpectedContexts.join(', ')}`)
  if (itemMismatches.length > 0) failures.push(`item metadata mismatches: ${itemMismatches.map(m => `${m.context}.${m.field}`).join(', ')}`)
  if (missingModes.length > 0) failures.push(`missing modes: ${missingModes.map(m => `${m.context}:${m.mode}`).join(', ')}`)
  if (unexpectedModes.length > 0) failures.push(`unexpected modes: ${unexpectedModes.map(m => `${m.context}:${m.mode}`).join(', ')}`)

  const expectedSearchRuns = expected.length * expectedModes.length
  if (actualSearchRuns !== expectedSearchRuns) failures.push(`Search runs ${actualSearchRuns}, expected ${expectedSearchRuns}`)

  const processes = Array.isArray(root.processes) ? root.processes : []
  const processCounts = { contexts: 0, search: 0, other: 0 }
  for (const child of processes) {
    const role = isObject(child) ? child.role : null
    if (role === 'contexts') processCounts.contexts += 1
    else if (role === 'search') processCounts.search += 1
    else processCounts.other += 1
  }
  const processCountMismatch = processCounts.contexts !== 1 || processCounts.search !== expectedSearchRuns || processCounts.other !== 0
  if (processCountMismatch) failures.push(`child processes ${JSON.stringify(processCounts)}, expected 1 contexts child and ${expectedSearchRuns} Search children`)

  return {
    valid: failures.length === 0, failures, rawStatus, smokeIsNull, uncommittedBenchmarkCode, expectedModes, environmentModes, environmentModeMismatch,
    expectedContexts: expected.length, actualContexts: records.size, expectedSearchRuns, actualSearchRuns,
    missingContexts, duplicateContexts, unexpectedContexts, itemMismatches, missingModes, unexpectedModes, processCounts, processCountMismatch,
  }
}
