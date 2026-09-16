import type {
  AppSettings,
  ISODateTimeString,
  NormalArtianCounter,
  RngState,
} from './common'
import type {
  BuildCandidate,
  BuildListEntry,
  OwnedWeapon,
  TargetWeapon,
} from './entities'
import type {
  ExecutionHistory,
  ExecutionSavePoint,
  ProductionPlan,
} from './planning'
import {
  validateExecutionSavePoint,
  validateExecutionSavePointReferences,
  validateOwnedWeapon,
  validateTargetWeapon,
  type DomainValidationIssue,
  type DomainValidationResult,
} from './validation'

/**
 * Current Export shape version. Version 7 adds the Execution lifecycle
 * persisted state: TargetWeapon lifecycle, `OwnedWeapon.executionInProgress`,
 * and `executionSavePoints` (`docs/DATA_MODEL.md` 15). It is independent of
 * `DATABASE_SCHEMA_VERSION` and of `CURRENT_CALCULATION_APP_SCHEMA_VERSION`.
 */
export const EXPORT_SCHEMA_VERSION = 7

export const EXPORT_APP_NAME = 'mh-wilds-gogma-artian-planner'

export interface ExportRoot {
  schemaVersion: typeof EXPORT_SCHEMA_VERSION
  appName: typeof EXPORT_APP_NAME
  exportedAt: ISODateTimeString
  rngState: RngState | null
  normalArtianCounters: NormalArtianCounter[]
  ownedWeapons: OwnedWeapon[]
  targetWeapons: TargetWeapon[]
  buildCandidates: BuildCandidate[]
  buildListEntries: BuildListEntry[]
  productionPlans: ProductionPlan[]
  executionHistory: ExecutionHistory[]
  executionSavePoints: ExecutionSavePoint[]
  settings: AppSettings
}

type SchemaV6OwnedWeapon = OwnedWeapon extends infer T
  ? T extends OwnedWeapon
    ? Omit<T, 'executionInProgress'>
    : never
  : never

type SchemaV6TargetWeapon = Omit<
  TargetWeapon,
  'lifecycleStatus' | 'completedAt' | 'completedByProductionPlanId'
>

/** The schema 6 Export shape, before the Execution lifecycle state existed. */
export interface ExportRootV6
  extends Omit<
    ExportRoot,
    'schemaVersion' | 'ownedWeapons' | 'targetWeapons' | 'executionSavePoints'
  > {
  schemaVersion: 6
  ownedWeapons: SchemaV6OwnedWeapon[]
  targetWeapons: SchemaV6TargetWeapon[]
}

export type ExportRootMigrationResult =
  | { ok: true; root: ExportRoot }
  | { ok: false; issues: DomainValidationIssue[] }

const SCHEMA_V7_OWNED_WEAPON_FIELDS = ['executionInProgress'] as const
const SCHEMA_V7_TARGET_WEAPON_FIELDS = [
  'lifecycleStatus',
  'completedAt',
  'completedByProductionPlanId',
] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function structureIssue(path: string, message: string): DomainValidationIssue {
  return { path, code: 'invalid_structure', message }
}

/**
 * Runtime shape of one entity collection of untrusted Export input: the field
 * is an array and every element is a non-null, non-array object. Typed
 * validators read fields of each element, so they only run once this holds.
 */
function collectionShapeIssues(
  owner: Record<string, unknown>,
  field: string,
  pathPrefix = '',
): DomainValidationIssue[] {
  const path = `${pathPrefix}${field}`
  const value = owner[field]
  if (!Array.isArray(value)) {
    return [structureIssue(path, `${path} must be an array.`)]
  }
  return value.flatMap((element: unknown, index) =>
    isRecord(element)
      ? []
      : [structureIssue(`${path}[${index}]`, `${path}[${index}] must be an object.`)],
  )
}

/**
 * Shape of the save point snapshot fields its typed validator iterates or
 * dereferences. Deeper entity shape is left to the typed validators, guarded by
 * `runTypedValidation()`.
 */
function savePointShapeIssues(
  savePoint: Record<string, unknown>,
  path: string,
): DomainValidationIssue[] {
  const prefix = `${path}.`
  return [
    ...collectionShapeIssues(savePoint, 'normalCounters', prefix),
    ...collectionShapeIssues(savePoint, 'ownedWeapons', prefix),
    ...collectionShapeIssues(savePoint, 'targetWeapons', prefix),
    ...(['rngState', 'productionPlan'] as const)
      .filter((field) => !isRecord(savePoint[field]))
      .map((field) => structureIssue(`${prefix}${field}`, `${prefix}${field} must be an object.`)),
  ]
}

/**
 * The typed Domain validators trust the declared entity shape. Import input is
 * untrusted, so a nested value of the wrong type that the shallow shape checks
 * did not cover must still become an issue rather than an exception.
 */
function runTypedValidation(
  path: string,
  validate: () => DomainValidationIssue[],
): DomainValidationIssue[] {
  try {
    return validate()
  } catch {
    return [structureIssue(path, `${path || 'Export root'} has a malformed nested structure.`)]
  }
}

/**
 * Pure schema 6 -> 7 Export migration.
 *
 * It only fills the fields schema 6 could not carry with their deterministic
 * "no Execution has happened" values: every Target `active` with no completion
 * metadata, every OwnedWeapon not in progress, and no game save point. It never
 * infers a completed Target from owned Ideal weapons, an in-progress weapon from
 * a Plan, or a save point from ExecutionHistory. Calculation artifacts
 * (BuildCandidate, BuildListEntry, ProductionPlan, ExecutionHistory) keep their
 * exact contents and stay behind the CalculationContext boundary.
 *
 * A schema 6 record that already carries a schema 7 field is not a schema 6
 * record, so it fails closed instead of being overwritten or trusted.
 */
export function migrateExportRootV6ToV7(
  root: ExportRootV6,
): ExportRootMigrationResult {
  // Exported and pure, so it does not rely on its caller having checked the
  // runtime shape of the collections it reads.
  if (!isRecord(root)) {
    return { ok: false, issues: [structureIssue('', 'Export root must be an object.')] }
  }
  const shapeIssues = [
    ...collectionShapeIssues(root as unknown as Record<string, unknown>, 'ownedWeapons'),
    ...collectionShapeIssues(root as unknown as Record<string, unknown>, 'targetWeapons'),
  ]
  if (shapeIssues.length > 0) return { ok: false, issues: shapeIssues }

  const issues: DomainValidationIssue[] = []
  root.ownedWeapons.forEach((weapon, index) => {
    SCHEMA_V7_OWNED_WEAPON_FIELDS.forEach((field) => {
      if (field in weapon) {
        issues.push({
          path: `ownedWeapons[${index}].${field}`,
          code: 'invalid_structure',
          message: `Schema 6 OwnedWeapon cannot carry the schema 7 field '${field}'.`,
        })
      }
    })
  })
  root.targetWeapons.forEach((target, index) => {
    SCHEMA_V7_TARGET_WEAPON_FIELDS.forEach((field) => {
      if (field in target) {
        issues.push({
          path: `targetWeapons[${index}].${field}`,
          code: 'invalid_structure',
          message: `Schema 6 TargetWeapon cannot carry the schema 7 field '${field}'.`,
        })
      }
    })
  })
  if ('executionSavePoints' in root) {
    issues.push({
      path: 'executionSavePoints',
      code: 'invalid_structure',
      message: 'Schema 6 Export cannot carry executionSavePoints.',
    })
  }
  if (issues.length > 0) return { ok: false, issues }

  let migrated: ExportRootV6
  try {
    migrated = structuredClone(root)
  } catch {
    return { ok: false, issues: [structureIssue('', 'Export root cannot be copied.')] }
  }
  return {
    ok: true,
    root: {
      ...migrated,
      schemaVersion: EXPORT_SCHEMA_VERSION,
      ownedWeapons: migrated.ownedWeapons.map(
        (weapon) => ({ ...weapon, executionInProgress: null }) as OwnedWeapon,
      ),
      targetWeapons: migrated.targetWeapons.map((target) => ({
        ...target,
        lifecycleStatus: 'active',
        completedAt: null,
        completedByProductionPlanId: null,
      })),
      executionSavePoints: [],
    },
  }
}

function prefixed(
  prefix: string,
  nested: DomainValidationResult,
): DomainValidationIssue[] {
  return nested.issues.map((issue) => ({
    ...issue,
    path: issue.path
      ? `${prefix}${issue.path.startsWith('[') ? '' : '.'}${issue.path}`
      : prefix,
  }))
}

/**
 * Validates the Execution lifecycle state of a current-schema Export root:
 * TargetWeapon lifecycle, `OwnedWeapon.executionInProgress`, and every game
 * save point with its Plan / ExecutionHistory references and the one-per-Plan
 * rule. It is one step of full-replacement Import validation, not all of it;
 * deep expected-state validation of a save point belongs to the Execution
 * service that restores it.
 */
export function validateExportRootExecutionLifecycle(
  root: ExportRoot,
): DomainValidationResult {
  if (!isRecord(root)) {
    return { isValid: false, issues: [structureIssue('', 'Export root must be an object.')] }
  }
  const record = root as unknown as Record<string, unknown>
  const issues: DomainValidationIssue[] = []
  if (root.schemaVersion !== EXPORT_SCHEMA_VERSION) {
    issues.push({
      path: 'schemaVersion',
      code: 'invalid_literal',
      message: `Export schemaVersion must be ${EXPORT_SCHEMA_VERSION}.`,
    })
  }
  // Every collection this function reads is shape-checked element by element
  // before any typed validator dereferences a field.
  const shapeIssues = [
    'ownedWeapons',
    'targetWeapons',
    'productionPlans',
    'executionHistory',
    'executionSavePoints',
  ].flatMap((field) => collectionShapeIssues(record, field))
  if (shapeIssues.length > 0) {
    return { isValid: false, issues: [...issues, ...shapeIssues] }
  }
  const savePointShapeProblems = (root.executionSavePoints as unknown[]).flatMap(
    (savePoint, index) =>
      savePointShapeIssues(savePoint as Record<string, unknown>, `executionSavePoints[${index}]`),
  )
  if (savePointShapeProblems.length > 0) {
    return { isValid: false, issues: [...issues, ...savePointShapeProblems] }
  }

  root.ownedWeapons.forEach((weapon, index) => {
    const path = `ownedWeapons[${index}]`
    issues.push(...runTypedValidation(path, () => prefixed(path, validateOwnedWeapon(weapon))))
  })
  root.targetWeapons.forEach((target, index) => {
    const path = `targetWeapons[${index}]`
    issues.push(...runTypedValidation(path, () => prefixed(path, validateTargetWeapon(target))))
  })
  root.executionSavePoints.forEach((savePoint, index) => {
    const path = `executionSavePoints[${index}]`
    issues.push(...runTypedValidation(path, () => prefixed(path, validateExecutionSavePoint(savePoint))))
  })
  issues.push(
    ...runTypedValidation('executionSavePoints', () =>
      prefixed(
        'executionSavePoints',
        validateExecutionSavePointReferences(
          root.executionSavePoints,
          root.productionPlans,
          root.executionHistory,
        ),
      ),
    ),
  )
  return { isValid: issues.length === 0, issues }
}

/**
 * Brings a parsed Export object to the current schema and validates its
 * Execution lifecycle state, failing closed on anything else. Schema 7 is read
 * as is, schema 6 goes through `migrateExportRootV6ToV7()`, and every other
 * version is refused. Nothing is applied here: the caller replaces its data
 * only after a successful result.
 */
export function prepareExportRootForImport(
  input: unknown,
): ExportRootMigrationResult {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return {
      ok: false,
      issues: [{ path: '', code: 'invalid_structure', message: 'Export root must be an object.' }],
    }
  }
  const candidate = input as Record<string, unknown>
  if (candidate.appName !== EXPORT_APP_NAME) {
    return {
      ok: false,
      issues: [{ path: 'appName', code: 'invalid_literal', message: 'Export appName is not supported.' }],
    }
  }
  let root: ExportRoot
  if (candidate.schemaVersion === EXPORT_SCHEMA_VERSION) {
    const shapeIssues = [
      'ownedWeapons',
      'targetWeapons',
      'productionPlans',
      'executionHistory',
      'executionSavePoints',
    ].flatMap((field) => collectionShapeIssues(candidate, field))
    if (shapeIssues.length > 0) return { ok: false, issues: shapeIssues }
    try {
      root = structuredClone(input as ExportRoot)
    } catch {
      return { ok: false, issues: [structureIssue('', 'Export root cannot be copied.')] }
    }
  } else if (candidate.schemaVersion === 6) {
    const shapeIssues = ['productionPlans', 'executionHistory']
      .flatMap((field) => collectionShapeIssues(candidate, field))
    if (shapeIssues.length > 0) return { ok: false, issues: shapeIssues }
    const migrated = migrateExportRootV6ToV7(input as ExportRootV6)
    if (!migrated.ok) return migrated
    root = migrated.root
  } else {
    return {
      ok: false,
      issues: [{
        path: 'schemaVersion',
        code: 'invalid_literal',
        message: 'Export schemaVersion is not supported.',
      }],
    }
  }
  const validation = validateExportRootExecutionLifecycle(root)
  return validation.isValid ? { ok: true, root } : { ok: false, issues: validation.issues }
}
