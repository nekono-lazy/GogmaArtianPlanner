import { describe, expect, it } from 'vitest'
import {
  checkpointCandidate,
  checkpointIdealBonuses,
  checkpointPracticalBonuses,
  checkpointSource,
  checkpointTarget,
} from '../../test/fixtures/checkpointRoute'
import { targetEvaluationMaster } from '../../test/fixtures/targetEvaluation'
import { createValidBuildListEntry } from '../../test/fixtures/domainData'
import { deriveTargetSatisfaction } from '../planner'
import type {
  BuildCandidate,
  ExportRoot,
  IntermediateBonusStateGroup,
  OwnedWeaponStatus,
} from './publicTypes'
import {
  CURRENT_CALCULATION_APP_SCHEMA_VERSION,
  isBuildResultCalculationContextCompatible,
} from './publicTypes'
import { validateBuildCandidate, validateBuildListEntry } from './validation'

const currentContext = () => ({
  gameVersion: 'fixture-only',
  masterDataVersion: 1,
  rngEngineVersion: 'fake-fixture:checkpoint',
  appSchemaVersion: CURRENT_CALCULATION_APP_SCHEMA_VERSION,
})

function currentCandidate(): BuildCandidate {
  return checkpointCandidate([
    checkpointPracticalBonuses(),
    checkpointIdealBonuses(),
  ])
}

function bonusGroup(candidate: BuildCandidate): IntermediateBonusStateGroup {
  const group = candidate.intermediateStateGroups?.find((entry) => entry.axis === 'bonus')
  if (!group || group.axis !== 'bonus') throw new Error('Fixture Candidate has no Bonus state group.')
  return group
}

describe('A starting owned weapon that already satisfies a compromise condition', () => {
  it('is a zero-operation lane state but never a checkpoint on its own', () => {
    const source = checkpointSource()
    source.restorationBonuses = checkpointPracticalBonuses()
    const candidate = checkpointCandidate([checkpointIdealBonuses()])
    candidate.intermediateStateGroups = undefined
    const entry = createValidBuildListEntry()

    // The Route base's own accepted state is offered as the lane start, so it
    // can be held while the other lane moves, or - when both lanes hold one -
    // is a checkpoint the Planner treats as reached before its first action.
    expect(entry.intermediateStateSelection).toBeUndefined()
    expect(validateBuildCandidate(candidate, [source]).isValid).toBe(false)
  })

  it('still decides Target Satisfaction from its actual performance', () => {
    const target = checkpointTarget()
    const practical = checkpointSource()
    practical.restorationBonuses = checkpointPracticalBonuses()
    practical.status = 'unclassified'

    const [satisfaction] = deriveTargetSatisfaction(
      [target],
      [practical],
      targetEvaluationMaster,
    )

    // `status` carries no calculation meaning: the five slots and the Skills
    // decide, exactly as before.
    expect(satisfaction.hasPractical).toBe(true)
    expect(satisfaction.hasIdeal).toBe(false)
    expect(satisfaction.practicalOwnedWeaponIds).toEqual([practical.id])
  })

  it('keeps the practical OwnedWeapon status label', () => {
    const statuses: OwnedWeaponStatus[] = ['unclassified', 'practical', 'ideal']

    expect(statuses).toContain('practical')
    const weapon = checkpointSource()
    weapon.status = 'practical'
    expect(weapon.status).toBe('practical')
  })
})

describe('Intermediate state calculation and Export schema contracts', () => {
  it('fails every schema 1..11 build artifact closed under the current schema', () => {
    expect(CURRENT_CALCULATION_APP_SCHEMA_VERSION).toBe(14)
    const current = currentContext()
    for (let version = 1; version <= 11; version += 1) {
      expect(
        isBuildResultCalculationContextCompatible(current, {
          ...current,
          appSchemaVersion: version,
        }),
      ).toBe(false)
    }
    expect(isBuildResultCalculationContextCompatible(current, current)).toBe(true)
  })

  it('validates the intermediate state shape of a current-schema artifact strictly', () => {
    const candidate = currentCandidate()
    expect(validateBuildCandidate(candidate, [checkpointSource()]).isValid).toBe(true)

    const missing = structuredClone(candidate)
    delete missing.intermediateStateGroups
    expect(validateBuildCandidate(missing, [checkpointSource()]).issues.map(({ path }) => path))
      .toContain('intermediateStateGroups')

    const normalScope = structuredClone(candidate)
    bonusGroup(normalScope).restorationBonusScope = 'normal_artian'
    bonusGroup(normalScope).opportunities[0].restorationBonusScope = 'normal_artian'
    expect(validateBuildCandidate(normalScope, [checkpointSource()]).isValid).toBe(false)

    const laneEnd = structuredClone(candidate)
    laneEnd.intermediateStateGroups![0].opportunities[0].lanePosition = laneEnd.route.operations.length
    expect(validateBuildCandidate(laneEnd, [checkpointSource()]).issues.map(({ path }) => path))
      .toContain('intermediateStateGroups[0].opportunities[0].lanePosition')

    const wrongOperation = structuredClone(candidate)
    wrongOperation.intermediateStateGroups![0].opportunities[0].operationIndex = 1
    expect(validateBuildCandidate(wrongOperation, [checkpointSource()]).issues.map(({ path }) => path))
      .toContain('intermediateStateGroups[0].opportunities[0].operationIndex')

    const mismatchedState = structuredClone(candidate)
    bonusGroup(mismatchedState).opportunities[0].restorationBonuses = checkpointIdealBonuses()
    expect(validateBuildCandidate(mismatchedState, [checkpointSource()]).isValid).toBe(false)

    const wrongAxis = structuredClone(candidate)
    ;(wrongAxis.intermediateStateGroups![0].opportunities[0] as { axis: string }).axis = 'skill'
    expect(validateBuildCandidate(wrongAxis, [checkpointSource()]).issues.map(({ path }) => path))
      .toContain('intermediateStateGroups[0].opportunities[0].axis')
  })

  it('accepts a historical artifact that carries no intermediate state field at all', () => {
    // A Candidate persisted before the field existed is preserved exactly, not
    // rewritten, so it must keep validating and must stay renderable.
    const historical = createValidBuildListEntry()
    delete historical.candidateSnapshot.intermediateStateGroups
    delete historical.intermediateStateSelection
    historical.candidateSnapshot.calculationContext = {
      ...historical.candidateSnapshot.calculationContext,
      appSchemaVersion: 10,
    }
    historical.calculationContext = {
      ...historical.candidateSnapshot.calculationContext,
    }

    expect(validateBuildListEntry(historical).isValid).toBe(true)
    expect(historical.candidateSnapshot.intermediateStateGroups).toBeUndefined()
    expect(historical.intermediateStateSelection).toBeUndefined()
  })

  it('moves the Export schema version with the persisted entity shape', () => {
    const candidate = currentCandidate()
    const root: ExportRoot = {
      schemaVersion: 11,
      appName: 'mh-wilds-gogma-artian-planner',
      exportedAt: '2026-09-12T00:00:00.000Z',
      rngState: null,
      normalArtianCounters: [],
      ownedWeapons: [checkpointSource()],
      targetWeapons: [checkpointTarget()],
      buildCandidates: [candidate],
      buildListEntries: [],
      productionPlans: [],
      executionHistory: [],
      executionSavePoints: [],
      settings: {
        id: 'settings',
        schemaVersion: 1,
        debugMode: false,
        resultPageSize: 20,
        defaultSearchLimit: 200,
        createdAt: '2026-09-12T00:00:00.000Z',
        updatedAt: '2026-09-12T00:00:00.000Z',
      },
    }

    // Version 6 was the first Export shape whose BuildCandidates carry
    // axis-separated intermediate states and whose BuildListEntries carry the
    // per-lane selection plus the improvement preference; version 7 keeps that
    // shape and adds the Execution lifecycle state, version 8 adds the
    // calculation schema 12 ProductionPlan shape, and version 9 adds the Plan
    // lifecycle metadata and the Execution Undo snapshot.
    expect(root.schemaVersion).toBe(11)
    expect(root.buildCandidates[0].intermediateStateGroups).toBeDefined()
    const older = { ...root, schemaVersion: 5 } as unknown as ExportRoot
    expect(older.schemaVersion).not.toBe(root.schemaVersion)
  })

  it('rejects a dominating reference that names itself or no group', () => {
    const self = currentCandidate()
    bonusGroup(self).isDisplaySecondary = true
    bonusGroup(self).dominatingGroupId = bonusGroup(self).id
    expect(validateBuildCandidate(self, [checkpointSource()]).issues)
      .toContainEqual(expect.objectContaining({
        path: 'intermediateStateGroups[0].dominatingGroupId',
      }))

    const unknown = currentCandidate()
    bonusGroup(unknown).isDisplaySecondary = true
    bonusGroup(unknown).dominatingGroupId = 'intermediate-group:unknown' as never
    expect(validateBuildCandidate(unknown, [checkpointSource()]).issues)
      .toContainEqual(expect.objectContaining({
        path: 'intermediateStateGroups[0].dominatingGroupId',
      }))
  })

  it('rejects ids outside the deterministic id families', () => {
    const candidate = currentCandidate()
    candidate.intermediateStateGroups![0].id = 'group:not-deterministic' as never
    candidate.intermediateStateGroups![0].opportunities[0].id = 'opportunity:not-deterministic' as never
    const paths = validateBuildCandidate(candidate, [checkpointSource()]).issues.map(({ path }) => path)
    expect(paths).toContain('intermediateStateGroups[0].id')
    expect(paths).toContain('intermediateStateGroups[0].opportunities[0].id')
  })
})
