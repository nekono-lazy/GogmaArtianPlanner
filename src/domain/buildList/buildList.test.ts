import { describe, expect, it } from 'vitest'
import {
  createBuildCandidateMeaningFingerprint,
  createBuildListEntry,
  createTargetDefinitionHash,
  evaluateBuildListEntryStaleness,
  isSameBuildListCandidate,
} from '.'
import {
  createReferencedOwnedWeaponsHash,
  createSearchStateHash,
} from '../models/hashing'
import {
  buildListEntryId,
  createValidBuildCandidate,
  createValidNormalArtianCounter,
  createValidOwnedWeapon,
  createValidRngState,
  createValidTargetWeapon,
  domainFixtureContext,
  ownedWeaponId,
} from '../../test/fixtures/domainData'

function createFixtureEntry() {
  const target = createValidTargetWeapon()
  const candidate = createValidBuildCandidate()
  const rngState = createValidRngState()
  rngState.skillCounter = { value: 7, isConfirmed: true, source: 'manual' }
  const normalCounters = [createValidNormalArtianCounter()]
  candidate.searchStateHash = createSearchStateHash(candidate.route, rngState, normalCounters)
  candidate.referencedOwnedWeaponsHash = null
  candidate.calculationContext = { ...domainFixtureContext }
  const entry = createBuildListEntry(candidate, target, {
    id: buildListEntryId('build-list.fixture.generated'),
    createdAt: '2026-08-29T02:00:00.000Z',
  })
  return { target, candidate, rngState, normalCounters, entry }
}

describe('targetDefinitionHash', () => {
  it('is deterministic and excludes presentation-only fields', () => {
    const target = createValidTargetWeapon()
    expect(createTargetDefinitionHash(target)).toBe(createTargetDefinitionHash(structuredClone(target)))
    expect(createTargetDefinitionHash({ ...target, name: '別名', memo: '変更', updatedAt: 'later' })).toBe(createTargetDefinitionHash(target))
  })

  it.each([
    ['ideal bonuses', (target: ReturnType<typeof createValidTargetWeapon>) => { target.idealBonuses[0] = { bonusTypeId: 'bonus.changed', bonusRankId: 'rank.changed' } }],
    ['practical condition', (target: ReturnType<typeof createValidTargetWeapon>) => { target.practicalBonusConditions[0].requiredCount = 1 }],
    ['skill condition', (target: ReturnType<typeof createValidTargetWeapon>) => { target.idealSkillCondition.seriesSkillId = null }],
  ])('changes for %s', (_label, mutate) => {
    const target = createValidTargetWeapon()
    const changed = structuredClone(target)
    mutate(changed)
    expect(createTargetDefinitionHash(changed)).not.toBe(createTargetDefinitionHash(target))
  })
})

describe('BuildListEntry creation', () => {
  it('preserves the complete candidate snapshot and search contracts', () => {
    const { entry, candidate, target } = createFixtureEntry()
    expect(entry.candidateSnapshot).toEqual(candidate)
    expect(entry.candidateSnapshot).not.toBe(candidate)
    expect(entry.targetDefinitionHash).toBe(createTargetDefinitionHash(target))
    expect(entry.searchStateHash).toBe(candidate.searchStateHash)
    expect(entry.referencedOwnedWeaponsHash).toBe(candidate.referencedOwnedWeaponsHash)
    expect(entry.calculationContext).toEqual(candidate.calculationContext)
    expect(entry.isStale).toBe(false)
    expect(entry.staleReasons).toEqual([])
  })

  it('detects same candidate meaning without relying on Candidate ID', () => {
    const { entry, candidate } = createFixtureEntry()
    const repeated = { ...candidate, id: 'candidate.new-run' as typeof candidate.id, searchRunId: 'new-run' }
    expect(createBuildCandidateMeaningFingerprint(repeated)).toBe(createBuildCandidateMeaningFingerprint(candidate))
    expect(isSameBuildListCandidate(entry, repeated)).toBe(true)
  })
})

describe('BuildListEntry staleness', () => {
  function evaluate(overrides: Partial<Parameters<typeof evaluateBuildListEntryStaleness>[1]> = {}) {
    const fixture = createFixtureEntry()
    return {
      fixture,
      result: evaluateBuildListEntryStaleness(fixture.entry, {
        target: fixture.target,
        rngState: fixture.rngState,
        normalCounters: fixture.normalCounters,
        ownedWeapons: [],
        calculationContext: domainFixtureContext,
        ...overrides,
      }),
    }
  }

  it('is not stale when all semantic inputs are unchanged', () => {
    expect(evaluate().result).toEqual({ isStale: false, staleReasons: [] })
  })

  it('detects Target changes but ignores Target name changes', () => {
    const base = createFixtureEntry()
    expect(evaluateBuildListEntryStaleness(base.entry, { target: { ...base.target, name: '別名' }, rngState: base.rngState, normalCounters: base.normalCounters, ownedWeapons: [], calculationContext: domainFixtureContext }).isStale).toBe(false)
    const changed = structuredClone(base.target)
    changed.practicalBonusConditions[0].requiredCount = 1
    expect(evaluateBuildListEntryStaleness(base.entry, { target: changed, rngState: base.rngState, normalCounters: base.normalCounters, ownedWeapons: [], calculationContext: domainFixtureContext }).staleReasons).toContain('target_definition_changed')
  })

  it('ignores RNG source and unrelated normal counters', () => {
    const base = createFixtureEntry()
    const rngState = structuredClone(base.rngState)
    rngState.baseSeed.source = 'observation'
    const unrelated = { ...createValidNormalArtianCounter(), id: 'weapon.other:8', weaponTypeId: 'weapon.other', rarity: 8 as const, counter: 999 }
    expect(evaluateBuildListEntryStaleness(base.entry, { target: base.target, rngState, normalCounters: [...base.normalCounters, unrelated], ownedWeapons: [], calculationContext: domainFixtureContext }).isStale).toBe(false)
  })

  it('detects a route-dependent RNG change', () => {
    const base = createFixtureEntry()
    const rngState = structuredClone(base.rngState)
    rngState.gogmaCounter.value = 99
    expect(evaluateBuildListEntryStaleness(base.entry, { target: base.target, rngState, normalCounters: base.normalCounters, ownedWeapons: [], calculationContext: domainFixtureContext }).staleReasons).toContain('rng_state_changed')
  })

  it('detects referenced weapon changes and ignores names and unrelated weapons', () => {
    const base = createFixtureEntry()
    const source = createValidOwnedWeapon(ownedWeaponId('owned.fixture.source'))
    base.candidate.route = {
      kind: 'existing_gogma_reset_skills',
      sourceOwnedWeaponId: source.id,
      operations: [{ type: 'reset_skills', sourceOwnedWeaponId: source.id, skillCounterBefore: 7, skillCounterAfter: 8 }],
    }
    base.candidate.searchStateHash = createSearchStateHash(base.candidate.route, base.rngState, base.normalCounters)
    base.candidate.referencedOwnedWeaponsHash = createReferencedOwnedWeaponsHash(base.candidate.route, [source])
    const entry = createBuildListEntry(base.candidate, base.target, { id: buildListEntryId('build-list.owned'), createdAt: base.entry.createdAt })
    const context = { target: base.target, rngState: base.rngState, normalCounters: base.normalCounters, calculationContext: domainFixtureContext }
    expect(evaluateBuildListEntryStaleness(entry, { ...context, ownedWeapons: [{ ...source, name: '別名' }, createValidOwnedWeapon(ownedWeaponId('owned.unrelated'))] }).isStale).toBe(false)
    const changed = structuredClone(source)
    changed.restorationBonuses[0].bonusRankId = 'rank.changed'
    expect(evaluateBuildListEntryStaleness(entry, { ...context, ownedWeapons: [changed] }).staleReasons).toContain('owned_weapon_changed')
  })

  it('marks an owned-Normal route stale when its source bonuses change', () => {
    const base = createFixtureEntry()
    const gogma = createValidOwnedWeapon(ownedWeaponId('owned.fixture.normal'))
    const source = {
      ...gogma,
      kind: 'normal' as const,
      rarity: 8 as const,
      seriesSkillId: null,
      groupSkillId: null,
      status: null,
      isProtected: false,
    }
    base.candidate.route = {
      kind: 'owned_normal_artian_to_gogma',
      sourceOwnedWeaponId: source.id,
      operations: [
        {
          type: 'convert_normal_to_gogma',
          weaponTypeId: source.weaponTypeId,
          gogmaCounterBefore: 10,
          gogmaCounterAfter: 11,
        },
      ],
    }
    base.candidate.searchStateHash = createSearchStateHash(
      base.candidate.route,
      base.rngState,
      base.normalCounters,
    )
    base.candidate.referencedOwnedWeaponsHash =
      createReferencedOwnedWeaponsHash(base.candidate.route, [source])
    const entry = createBuildListEntry(base.candidate, base.target, {
      id: buildListEntryId('build-list.owned-normal'),
      createdAt: base.entry.createdAt,
    })
    const changed = structuredClone(source)
    changed.restorationBonuses[0].bonusRankId = 'rank.changed'
    expect(
      evaluateBuildListEntryStaleness(entry, {
        target: base.target,
        rngState: base.rngState,
        normalCounters: base.normalCounters,
        ownedWeapons: [changed],
        calculationContext: domainFixtureContext,
      }).staleReasons,
    ).toContain('owned_weapon_changed')
  })

  it('detects CalculationContext changes', () => {
    const { fixture } = evaluate()
    const result = evaluateBuildListEntryStaleness(fixture.entry, { target: fixture.target, rngState: fixture.rngState, normalCounters: fixture.normalCounters, ownedWeapons: [], calculationContext: { ...domainFixtureContext, masterDataVersion: 2 } })
    expect(result.staleReasons).toEqual(['calculation_context_changed'])
  })

  it('returns every reason in deterministic order', () => {
    const base = createFixtureEntry()
    const target = structuredClone(base.target)
    target.priority = 5
    const rngState = structuredClone(base.rngState)
    rngState.gogmaCounter.value = 999
    const result = evaluateBuildListEntryStaleness(base.entry, { target, rngState, normalCounters: base.normalCounters, ownedWeapons: [], calculationContext: { ...domainFixtureContext, gameVersion: 'changed' } })
    expect(result.staleReasons).toEqual(['target_definition_changed', 'rng_state_changed', 'calculation_context_changed'])
  })
})
