import { describe, expect, it } from 'vitest'
import {
  enumerateConstrainedCandidates,
  visitConstrainedCandidates,
} from './constrainedEnumeration'
import type { ConstrainedCandidate } from './constrainedTypes'
import type { OwnedWeaponId, TargetWeapon } from '../../models/publicTypes'
import {
  belowPracticalBonuses,
  constrainedBounds,
  constrainedInput,
  constrainedTarget,
  createConstrainedEngine,
  createConstrainedSearchOrigin,
  gogmaWeapon,
  IDEAL_SERIES_SKILL_ID,
  normalWeapon,
  practicalBonuses,
} from '../../../test/fixtures/constrainedEnumeration'

/**
 * The Production Planner consumes `visitConstrainedCandidates()`, which hands
 * Candidates to the consumer one at a time and stops as soon as a trial is
 * adoptable. The final array sort of `enumerateConstrainedCandidates()` never
 * runs on that path, so the Target's preferred source must reach the traversal
 * priority itself (`docs/SEARCH_SPEC.md` 8.1).
 *
 * The two sources below sort `owned.constrained.aaa` before
 * `owned.constrained.zzz` on `baseKey`, so the stable key alone always delivers
 * `aaa` first. Every test that expects `zzz` therefore proves the preference
 * actually decided.
 */
const EARLIER_BY_STABLE_KEY = 'owned.constrained.aaa'
const LATER_BY_STABLE_KEY = 'owned.constrained.zzz'

interface SetupOptions {
  preferred: string | null
}

/**
 * Two compatible unprotected Gogma sources whose Routes tie on every existing
 * priority.
 *
 * Both already satisfy the Ideal Skill condition, so neither explores Skills
 * and the Skill solution is the identical zero-operation one. Reset Bonuses
 * reads nothing it replaces, so at the same Gogma Counter both sources reach
 * the identical five-slot result at the identical cost. The Normal forge route
 * is disabled, so nothing else competes.
 */
function twoSourceSetup(options: SetupOptions) {
  const sources = [EARLIER_BY_STABLE_KEY, LATER_BY_STABLE_KEY]
  const target: TargetWeapon = {
    ...constrainedTarget(),
    preferredOwnedWeaponId: (options.preferred ?? null) as OwnedWeaponId | null,
  }
  const origin = createConstrainedSearchOrigin({
    normalCounters: [],
    target,
    ownedWeapons: sources.map((id) =>
      gogmaWeapon(id, {
        restorationBonuses: belowPracticalBonuses(),
        seriesSkillId: IDEAL_SERIES_SKILL_ID,
      }),
    ),
  })
  const engine = createConstrainedEngine(origin, {
    // Reset yields the same Practical result at every Gogma position, so the
    // two sources' Bonus axes are literally identical.
    resetResultAt: () => practicalBonuses(),
  })
  return { origin, engine, target }
}

const NORMAL_SOURCE = 'owned.constrained.aaa-normal'
const EXISTING_GOGMA_SOURCE = 'owned.constrained.zzz-gogma'

/**
 * A preferred Route that costs strictly more than a non-preferred one.
 *
 * The preferred source is an owned Normal weapon, so its Route is
 * `convert_normal_to_gogma` plus the Reset Bonuses that turns the inherited
 * normal-scope slots into a Gogma-scope Practical result: two operations. The
 * non-preferred existing-Gogma source reaches the identical five-slot result
 * with that one Reset alone. The Normal source also sorts first on `baseKey`,
 * so nothing but the operation count can put the Gogma source ahead.
 */
function cheaperNonPreferredSetup() {
  const target: TargetWeapon = {
    ...constrainedTarget(),
    preferredOwnedWeaponId: NORMAL_SOURCE as OwnedWeaponId,
  }
  const origin = createConstrainedSearchOrigin({
    normalCounters: [],
    target,
    ownedWeapons: [
      normalWeapon(NORMAL_SOURCE),
      gogmaWeapon(EXISTING_GOGMA_SOURCE, {
        restorationBonuses: belowPracticalBonuses(),
        seriesSkillId: IDEAL_SERIES_SKILL_ID,
      }),
    ],
  })
  const engine = createConstrainedEngine(origin, {
    resetResultAt: () => practicalBonuses(),
  })
  return { origin, engine, target }
}

/** Takes only the first Candidate the streaming enumeration delivers. */
async function firstDelivered(
  setup: ReturnType<typeof twoSourceSetup>,
): Promise<ConstrainedCandidate> {
  const delivered: ConstrainedCandidate[] = []
  await visitConstrainedCandidates(
    constrainedInput(setup.origin, constrainedBounds()),
    setup.engine,
    (candidate) => {
      delivered.push(candidate)
      return 'stop'
    },
  )
  const first = delivered[0]
  if (!first) throw new Error('The enumeration delivered no Candidate.')
  return first
}

/** The delivery order of the whole streaming enumeration. */
async function deliveredSources(
  setup: ReturnType<typeof twoSourceSetup>,
): Promise<(OwnedWeaponId | null)[]> {
  const sources: (OwnedWeaponId | null)[] = []
  await visitConstrainedCandidates(
    constrainedInput(setup.origin, constrainedBounds()),
    setup.engine,
    (candidate) => {
      sources.push(candidate.route.sourceOwnedWeaponId)
      return 'continue'
    },
  )
  return sources
}

describe('Constrained streaming delivery and the Target preferred source', () => {
  it('delivers the preferred source first when every existing priority ties', async () => {
    const setup = twoSourceSetup({ preferred: LATER_BY_STABLE_KEY })
    const first = await firstDelivered(setup)

    // Without the traversal priority this would be EARLIER_BY_STABLE_KEY: the
    // two cells tie on category, cost, Counter advance and closeness, so only
    // the stable `semanticKey` separated them, and a consumer that stops at the
    // first adoptable Candidate would never see the preferred source at all.
    expect(first.route.sourceOwnedWeaponId).toBe(
      setup.target.preferredOwnedWeaponId,
    )
    expect(first.route.sourceOwnedWeaponId).toBe(LATER_BY_STABLE_KEY)
  })

  it('delivers the preferred source first whichever of the two it is', async () => {
    // Flipping the preference flips the delivered source, which the stable key
    // alone could never do: it always favours EARLIER_BY_STABLE_KEY.
    const preferringEarlier = twoSourceSetup({ preferred: EARLIER_BY_STABLE_KEY })
    expect((await firstDelivered(preferringEarlier)).route.sourceOwnedWeaponId)
      .toBe(EARLIER_BY_STABLE_KEY)
  })

  it('never lets the preference overtake a cheaper non-preferred Route', async () => {
    // The preferred source is an owned Normal weapon, so its Route pays one
    // conversion before the same Reset Bonuses the existing-Gogma Route needs
    // on its own: two operations against one. Cost is decided strictly above
    // the preference, so the cheaper non-preferred Route is delivered first.
    const setup = cheaperNonPreferredSetup()
    const first = await firstDelivered(setup)

    expect(first.route.sourceOwnedWeaponId).toBe(EXISTING_GOGMA_SOURCE)
    expect(first.estimatedOperationCount).toBe(1)
    expect(first.route.sourceOwnedWeaponId).not.toBe(
      setup.target.preferredOwnedWeaponId,
    )
  })

  it('still delivers the more expensive preferred Route, only later', async () => {
    // The preference is not a filter: the two-operation preferred Route is
    // enumerated as usual, it simply does not come first.
    const setup = cheaperNonPreferredSetup()
    const order = await deliveredSources(setup)

    expect(order[0]).toBe(EXISTING_GOGMA_SOURCE)
    expect(order).toContain(NORMAL_SOURCE)
  })

  it('keeps the existing deterministic order when the Target sets no preference', async () => {
    const setup = twoSourceSetup({ preferred: null })
    const order = await deliveredSources(setup)

    expect(order.length).toBeGreaterThan(1)
    // Unchanged stable traversal: the lower `baseKey` still comes first, and no
    // `null`-source Route is treated as preferred by a `null` preference.
    expect(order[0]).toBe(EARLIER_BY_STABLE_KEY)
    expect(await deliveredSources(twoSourceSetup({ preferred: null }))).toEqual(
      order,
    )
  })

  it('delivers the same order on a rerun of the same preferred input', async () => {
    const first = await deliveredSources(
      twoSourceSetup({ preferred: LATER_BY_STABLE_KEY }),
    )
    expect(
      await deliveredSources(twoSourceSetup({ preferred: LATER_BY_STABLE_KEY })),
    ).toEqual(first)
    expect(first[0]).toBe(LATER_BY_STABLE_KEY)
  })

  it('changes the delivery order without changing the enumerated set', async () => {
    // The preference orders traversal only. The same Candidates are found, the
    // same number of pairs is examined, and exhaustion is still reported.
    const withoutPreference = twoSourceSetup({ preferred: null })
    const withPreference = twoSourceSetup({ preferred: LATER_BY_STABLE_KEY })

    const plain = await enumerateConstrainedCandidates(
      constrainedInput(withoutPreference.origin, constrainedBounds()),
      withoutPreference.engine,
    )
    const preferred = await enumerateConstrainedCandidates(
      constrainedInput(withPreference.origin, constrainedBounds()),
      withPreference.engine,
    )

    expect(preferred.candidates).toHaveLength(plain.candidates.length)
    expect(preferred.summary.examinedCandidates).toBe(
      plain.summary.examinedCandidates,
    )
    expect(preferred.summary.evaluatedOffAxisPairs).toBe(
      plain.summary.evaluatedOffAxisPairs,
    )
    expect(preferred.summary.exhausted).toBe(plain.summary.exhausted)
    expect(preferred.summary.stoppedByBound).toBe(plain.summary.stoppedByBound)
  })
})
