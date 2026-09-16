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

  const migrated = structuredClone(root)
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
  const issues: DomainValidationIssue[] = []
  if (root.schemaVersion !== EXPORT_SCHEMA_VERSION) {
    issues.push({
      path: 'schemaVersion',
      code: 'invalid_literal',
      message: `Export schemaVersion must be ${EXPORT_SCHEMA_VERSION}.`,
    })
  }
  if (!Array.isArray(root.executionSavePoints)) {
    issues.push({
      path: 'executionSavePoints',
      code: 'invalid_structure',
      message: 'executionSavePoints must be an array.',
    })
    return { isValid: false, issues }
  }
  root.ownedWeapons.forEach((weapon, index) =>
    issues.push(...prefixed(`ownedWeapons[${index}]`, validateOwnedWeapon(weapon))),
  )
  root.targetWeapons.forEach((target, index) =>
    issues.push(...prefixed(`targetWeapons[${index}]`, validateTargetWeapon(target))),
  )
  root.executionSavePoints.forEach((savePoint, index) =>
    issues.push(
      ...prefixed(
        `executionSavePoints[${index}]`,
        validateExecutionSavePoint(savePoint),
      ),
    ),
  )
  issues.push(
    ...prefixed(
      'executionSavePoints',
      validateExecutionSavePointReferences(
        root.executionSavePoints,
        root.productionPlans,
        root.executionHistory,
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
  const collections = [
    'ownedWeapons',
    'targetWeapons',
    'productionPlans',
    'executionHistory',
  ] as const
  const notArray = collections.filter((field) => !Array.isArray(candidate[field]))
  if (notArray.length > 0) {
    return {
      ok: false,
      issues: notArray.map((field) => ({
        path: field,
        code: 'invalid_structure' as const,
        message: `${field} must be an array.`,
      })),
    }
  }
  let root: ExportRoot
  if (candidate.schemaVersion === EXPORT_SCHEMA_VERSION) {
    root = structuredClone(input as ExportRoot)
  } else if (candidate.schemaVersion === 6) {
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
