import { describe, expect, it } from 'vitest'
import type { ExportRoot, ExportRootV10, ProductionPlan } from './publicTypes'
import {
  EXPORT_SCHEMA_VERSION,
  migrateExportRootV10ToV11,
  prepareExportRootForImport,
} from './publicTypes'
import {
  DOMAIN_FIXTURE_TIME,
  buildListEntryId,
  createValidProductionPlan,
  productionPlanId,
} from '../../test/fixtures/domainData'
import { dataTransferRoot, legacyAppSettingsV1, withoutConflictRepairLineage } from '../../test/fixtures/dataTransfer'

/** The reported real case: a Draft naming a Build List Entry that no longer exists. */
const MISSING_ENTRY_ID = buildListEntryId('build-list.fnv1a32-7ab0e079')

function plan(id: string, status: ProductionPlan['status']): ProductionPlan {
  const base = createValidProductionPlan()
  return {
    ...base,
    id: productionPlanId(id),
    status,
    abandonmentReason: status === 'abandoned' ? 'user_abandoned' : null,
    abandonedAt: status === 'abandoned' ? DOMAIN_FIXTURE_TIME : null,
    completedAt: status === 'completed' ? DOMAIN_FIXTURE_TIME : null,
    currentStepId: status === 'completed' ? null : base.currentStepId,
    steps: status === 'completed'
      ? base.steps.map((step) => ({ ...step, isCompleted: true, completedAt: DOMAIN_FIXTURE_TIME }))
      : base.steps,
    recalculationReasons: status === 'stale' ? ['rng_state_changed'] : [],
  }
}

function divergentDraft(id: string, createdAt: string, updatedAt: string): ProductionPlan {
  const draft = plan(id, 'draft')
  return {
    ...draft,
    createdAt,
    updatedAt,
    selectedBuildListEntryIds: [MISSING_ENTRY_ID],
    steps: draft.steps.map((step) => ({ ...step, buildListEntryId: MISSING_ENTRY_ID })),
  }
}

/**
 * A schema 10 root of the old accumulating contract: three Drafts - two of
 * them naming an Entry the user has since removed - beside the running Plan,
 * a completed Plan and an abandoned Plan. The Draft timestamps and IDs are
 * ordered against each other so that no "latest" rule could be read into the
 * result.
 */
function schema10Root(): ExportRootV10 {
  const current = dataTransferRoot()
  const [active, abandoned] = current.productionPlans
  return withoutConflictRepairLineage({
    ...current,
    schemaVersion: 10,
    settings: legacyAppSettingsV1(current.settings),
    productionPlans: [
      divergentDraft('plan.draft.a', '2026-09-01T00:00:00.000Z', '2026-09-03T00:00:00.000Z'),
      active,
      { ...plan('plan.draft.b', 'draft'), createdAt: '2026-09-02T00:00:00.000Z', updatedAt: '2026-09-02T00:00:00.000Z' },
      plan('plan.done.completed', 'completed'),
      divergentDraft('plan.draft.c', '2026-09-03T00:00:00.000Z', '2026-09-01T00:00:00.000Z'),
      abandoned,
    ],
  })
}

const ids = (plans: readonly ProductionPlan[]) => plans.map(({ id }) => id)

describe('Export schema 10 -> 11 (Draft lifecycle)', () => {
  it('keeps Export schema 11 as the Draft lifecycle boundary below the current schema 13', () => {
    expect(EXPORT_SCHEMA_VERSION).toBe(13)
  })

  it('A: deletes every Draft and chooses none of them to survive', () => {
    const legacy = schema10Root()
    const migrated = migrateExportRootV10ToV11(legacy)
    expect(migrated.ok).toBe(true)
    if (!migrated.ok) return
    expect(migrated.root.schemaVersion).toBe(11)
    expect(ids(migrated.root.productionPlans)).toEqual(['plan.fixture.a', 'plan.done.completed', 'plan.fixture.abandoned'])
    expect(migrated.root.productionPlans.some((entry) => entry.status === 'draft')).toBe(false)
    // Pure: the input root is untouched.
    expect(ids(legacy.productionPlans)).toHaveLength(6)
  })

  it('B: keeps every active / stale / completed / abandoned Plan body exactly', () => {
    const legacy = schema10Root()
    const migrated = migrateExportRootV10ToV11(legacy)
    expect(migrated.ok && migrated.root.productionPlans).toEqual([legacy.productionPlans[1], legacy.productionPlans[3], legacy.productionPlans[5]])

    const stale = { ...schema10Root(), productionPlans: [plan('plan.running.stale', 'stale'), plan('plan.draft.x', 'draft')] }
    const migratedStale = migrateExportRootV10ToV11(stale)
    expect(migratedStale.ok && migratedStale.root.productionPlans).toEqual([stale.productionPlans[0]])
  })

  it('C: keeps the Build List Entries a Draft referenced and every other collection', () => {
    const legacy = schema10Root()
    const migrated = migrateExportRootV10ToV11(legacy)
    expect(migrated.ok).toBe(true)
    if (!migrated.ok) return
    expect(migrated.root.buildListEntries).toEqual(legacy.buildListEntries)
    expect(migrated.root.buildCandidates).toEqual(legacy.buildCandidates)
    expect(migrated.root.targetWeapons).toEqual(legacy.targetWeapons)
    expect(migrated.root.ownedWeapons).toEqual(legacy.ownedWeapons)
    expect(migrated.root.rngState).toEqual(legacy.rngState)
    expect(migrated.root.normalArtianCounters).toEqual(legacy.normalArtianCounters)
    expect(migrated.root.executionHistory).toEqual(legacy.executionHistory)
    expect(migrated.root.executionSavePoints).toEqual(legacy.executionSavePoints)
    expect(migrated.root.settings).toEqual(legacy.settings)
    expect(migrated.root.exportedAt).toBe(legacy.exportedAt)
  })

  it('D: a current-schema root keeps its one current Draft through the Import preparation', () => {
    const current = dataTransferRoot()
    const draft = divergentDraft('plan.draft.current', DOMAIN_FIXTURE_TIME, DOMAIN_FIXTURE_TIME)
    const root: ExportRoot = { ...current, productionPlans: [draft, ...current.productionPlans] }
    const prepared = prepareExportRootForImport(JSON.parse(JSON.stringify(root)))
    expect(prepared.ok, JSON.stringify(prepared)).toBe(true)
    if (!prepared.ok) return
    expect(prepared.root.schemaVersion).toBe(13)
    expect(prepared.root.productionPlans).toEqual(root.productionPlans)
  })

  it('E: the Import preparation runs the schema 10 root through the migrations and reaches 13 without its Drafts', () => {
    const prepared = prepareExportRootForImport(JSON.parse(JSON.stringify(schema10Root())))
    expect(prepared.ok, JSON.stringify(prepared)).toBe(true)
    if (!prepared.ok) return
    expect(prepared.root.schemaVersion).toBe(13)
    expect(ids(prepared.root.productionPlans)).toEqual(['plan.fixture.a', 'plan.done.completed', 'plan.fixture.abandoned'])
  })

  it('leaves a schema 10 root without a Draft unchanged apart from the version', () => {
    const current = dataTransferRoot()
    const legacy: ExportRootV10 = { ...current, schemaVersion: 10, settings: legacyAppSettingsV1(current.settings) }
    const migrated = migrateExportRootV10ToV11(legacy)
    expect(migrated).toEqual({ ok: true, root: { ...legacy, schemaVersion: 11 } })
  })

  it('fails closed on a malformed productionPlans collection instead of throwing', () => {
    const malformed = { ...schema10Root(), productionPlans: 'plans' } as unknown as ExportRootV10
    const result = migrateExportRootV10ToV11(malformed)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues[0]).toMatchObject({ path: 'productionPlans', code: 'invalid_structure' })
    expect(migrateExportRootV10ToV11(null as unknown as ExportRootV10).ok).toBe(false)
  })
})
