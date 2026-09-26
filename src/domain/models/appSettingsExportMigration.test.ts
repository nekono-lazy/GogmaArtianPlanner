import { describe, expect, it } from 'vitest'
import type { ExportRoot, ExportRootV10, ExportRootV11 } from './publicTypes'
import {
  EXPORT_SCHEMA_VERSION,
  migrateExportRootV11ToV12,
  prepareExportRootForImport,
  upgradeAppSettingsToV2,
} from './publicTypes'
import { dataTransferRoot, dataTransferSettings, legacyAppSettingsV1, withoutConflictRepairLineage } from '../../test/fixtures/dataTransfer'

const RECOMMENDED = { maxNormalAdvance: 350, maxGogmaAdvance: 500, maxSkillAdvance: 1500 }

/** A schema 11 root: the current collections with an AppSettings v1 record. */
function schema11Root(): ExportRootV11 {
  const current = withoutConflictRepairLineage(dataTransferRoot())
  return {
    ...current,
    schemaVersion: 11,
    // A user who turned Debug Mode on and whose other settings are not the defaults.
    settings: legacyAppSettingsV1(dataTransferSettings({ debugMode: true, resultPageSize: 25, defaultSearchLimit: 4000 })),
  }
}

describe('Export schema 11 -> 12 (AppSettings Candidate Search defaults)', () => {
  it('moves the Export schema past 12 (the current schema is 13)', () => {
    expect(EXPORT_SCHEMA_VERSION).toBe(13)
  })

  it('fills the recommended 350 / 500 / 1500 and keeps every other settings field', () => {
    const legacy = schema11Root()
    const migrated = migrateExportRootV11ToV12(legacy)
    expect(migrated.ok, JSON.stringify(migrated)).toBe(true)
    if (!migrated.ok) return
    expect(migrated.root.schemaVersion).toBe(12)
    expect(migrated.root.settings).toEqual({
      ...legacy.settings,
      schemaVersion: 2,
      candidateSearchDefaults: RECOMMENDED,
    })
    // `defaultSearchLimit` keeps its own meaning and is never copied into the bounds.
    expect(migrated.root.settings.defaultSearchLimit).toBe(4000)
    expect(migrated.root.settings.debugMode).toBe(true)
    // Nothing else changes, and the input is not mutated.
    const { settings: _migratedSettings, schemaVersion: _migratedVersion, ...rest } = migrated.root
    const { settings: _legacySettings, schemaVersion: _legacyVersion, ...legacyRest } = legacy
    void [_migratedSettings, _migratedVersion, _legacySettings, _legacyVersion]
    expect(rest).toEqual(legacyRest)
    expect(legacy.settings.schemaVersion).toBe(1)
    expect('candidateSearchDefaults' in legacy.settings).toBe(false)
  })

  it('reaches the current schema through the Import preparation with the recommendation filled', () => {
    const prepared = prepareExportRootForImport(JSON.parse(JSON.stringify(schema11Root())))
    expect(prepared.ok, JSON.stringify(prepared)).toBe(true)
    if (!prepared.ok) return
    expect(prepared.root.schemaVersion).toBe(13)
    expect(prepared.root.settings.candidateSearchDefaults).toEqual(RECOMMENDED)
    expect(prepared.root.settings.debugMode).toBe(true)
  })

  it('fills the recommendation for an older root too, after the earlier migrations', () => {
    const legacy: ExportRootV10 = { ...schema11Root(), schemaVersion: 10 }
    const prepared = prepareExportRootForImport(JSON.parse(JSON.stringify(legacy)))
    expect(prepared.ok, JSON.stringify(prepared)).toBe(true)
    if (!prepared.ok) return
    expect(prepared.root.schemaVersion).toBe(13)
    expect(prepared.root.settings.candidateSearchDefaults).toEqual(RECOMMENDED)
  })

  it('keeps a current-schema root with the user values exactly as it is', () => {
    const root: ExportRoot = {
      ...dataTransferRoot(),
      settings: dataTransferSettings({ candidateSearchDefaults: { maxNormalAdvance: 1000, maxGogmaAdvance: 200, maxSkillAdvance: 2500 } }),
    }
    const prepared = prepareExportRootForImport(JSON.parse(JSON.stringify(root)))
    expect(prepared).toEqual({ ok: true, root })
  })

  it('fails closed on a schema 11 settings that is not an AppSettings v1 record instead of guessing', () => {
    const withField = { ...schema11Root(), settings: dataTransferSettings() } as unknown as ExportRootV11
    expect(migrateExportRootV11ToV12(withField)).toMatchObject({ ok: false, issues: [{ path: 'settings', code: 'invalid_structure' }] })
    expect(prepareExportRootForImport(withField).ok).toBe(false)
    const otherVersion = { ...schema11Root(), settings: { ...schema11Root().settings, schemaVersion: 3 } } as unknown as ExportRootV11
    expect(migrateExportRootV11ToV12(otherVersion).ok).toBe(false)
    const notAnObject = { ...schema11Root(), settings: 'settings' } as unknown as ExportRootV11
    expect(migrateExportRootV11ToV12(notAnObject)).toMatchObject({ ok: false, issues: [{ path: 'settings' }] })
    expect(migrateExportRootV11ToV12(null as unknown as ExportRootV11).ok).toBe(false)
  })
})

describe('upgradeAppSettingsToV2', () => {
  it('upgrades only an AppSettings v1 record', () => {
    const legacy = legacyAppSettingsV1(dataTransferSettings()) as unknown as Record<string, unknown>
    expect(upgradeAppSettingsToV2(legacy)).toBe(true)
    expect(legacy).toMatchObject({ schemaVersion: 2, candidateSearchDefaults: RECOMMENDED })
    // A second run changes nothing.
    const snapshot = structuredClone(legacy)
    expect(upgradeAppSettingsToV2(legacy)).toBe(false)
    expect(legacy).toEqual(snapshot)
    const current = dataTransferSettings() as unknown as Record<string, unknown>
    expect(upgradeAppSettingsToV2(current)).toBe(false)
    expect(current).toEqual(dataTransferSettings())
  })
})
