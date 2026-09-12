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
import { extractCandidateCheckpointGroups } from '../search'
import { checkpointMaster } from '../../test/fixtures/checkpointRoute'
import { deriveTargetSatisfaction } from '../planner'
import type {
  BuildCandidate,
  CompromiseCheckpointOpportunity,
  ExportRoot,
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

describe('A starting owned weapon that already satisfies a compromise condition', () => {
  it('is never offered as a checkpoint opportunity', () => {
    const source = checkpointSource()
    source.restorationBonuses = checkpointPracticalBonuses()
    const candidate = checkpointCandidate([checkpointIdealBonuses()])

    // The Route base state is not a prefix of the Route, so nothing about the
    // weapon the user already holds becomes a selectable checkpoint.
    expect(
      extractCandidateCheckpointGroups(candidate, {
        target: checkpointTarget(),
        master: checkpointMaster(),
        ownedWeapons: [source],
      }),
    ).toEqual([])
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

describe('Checkpoint calculation and Export schema contracts', () => {
  it('fails a schema 9 build artifact closed under schema 10', () => {
    expect(CURRENT_CALCULATION_APP_SCHEMA_VERSION).toBe(10)
    const current = currentContext()
    for (let version = 1; version <= 9; version += 1) {
      expect(
        isBuildResultCalculationContextCompatible(current, {
          ...current,
          appSchemaVersion: version,
        }),
      ).toBe(false)
    }
    expect(isBuildResultCalculationContextCompatible(current, current)).toBe(true)
  })

  it('validates the checkpoint shape of a current-schema artifact strictly', () => {
    const candidate = currentCandidate()
    expect(validateBuildCandidate(candidate, [checkpointSource()]).isValid).toBe(true)

    const missing = structuredClone(candidate)
    delete missing.checkpointGroups
    expect(validateBuildCandidate(missing, [checkpointSource()]).issues.map(({ path }) => path))
      .toContain('checkpointGroups')

    const normalScope = structuredClone(candidate)
    normalScope.checkpointGroups![0].restorationBonusScope = 'normal_artian'
    normalScope.checkpointGroups![0].opportunities[0].restorationBonusScope = 'normal_artian'
    expect(validateBuildCandidate(normalScope, [checkpointSource()]).isValid).toBe(false)

    const wholeIdeal = structuredClone(candidate)
    wholeIdeal.checkpointGroups![0].conditionMatch = { bonus: 'ideal', skill: 'ideal' }
    wholeIdeal.checkpointGroups![0].opportunities[0].conditionMatch = {
      bonus: 'ideal',
      skill: 'ideal',
    }
    expect(validateBuildCandidate(wholeIdeal, [checkpointSource()]).isValid).toBe(false)

    const finalOperation = structuredClone(candidate)
    const opportunity: CompromiseCheckpointOpportunity =
      finalOperation.checkpointGroups![0].opportunities[0]
    opportunity.afterOperationIndex = finalOperation.route.operations.length - 1
    expect(validateBuildCandidate(finalOperation, [checkpointSource()]).isValid).toBe(false)

    const mismatchedState = structuredClone(candidate)
    mismatchedState.checkpointGroups![0].opportunities[0].seriesSkillId =
      'series_skill.fixture.other'
    expect(validateBuildCandidate(mismatchedState, [checkpointSource()]).isValid).toBe(false)
  })

  it('accepts a historical artifact that carries no checkpoint field at all', () => {
    // A Candidate persisted before the field existed is preserved exactly, not
    // rewritten, so it must keep validating and must stay renderable.
    const historical = createValidBuildListEntry()
    delete historical.candidateSnapshot.checkpointGroups
    delete historical.selectedCheckpointOpportunityIds
    historical.candidateSnapshot.calculationContext = {
      ...historical.candidateSnapshot.calculationContext,
      appSchemaVersion: 9,
    }
    historical.calculationContext = {
      ...historical.candidateSnapshot.calculationContext,
    }

    expect(validateBuildListEntry(historical).isValid).toBe(true)
    expect(historical.candidateSnapshot.checkpointGroups).toBeUndefined()
    expect(historical.selectedCheckpointOpportunityIds).toBeUndefined()
  })

  it('moves the Export schema version with the persisted entity shape', () => {
    const candidate = currentCandidate()
    const root: ExportRoot = {
      schemaVersion: 5,
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

    // Version 5 is the first Export shape whose BuildCandidates carry
    // checkpoint groups and whose BuildListEntries carry a selection.
    expect(root.schemaVersion).toBe(5)
    expect(root.buildCandidates[0].checkpointGroups).toBeDefined()
    const older = { ...root, schemaVersion: 4 } as unknown as ExportRoot
    expect(older.schemaVersion).not.toBe(root.schemaVersion)
  })
})
