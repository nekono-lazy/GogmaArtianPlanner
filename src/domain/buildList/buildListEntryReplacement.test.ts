import { describe, expect, it } from 'vitest'
import type { BuildListEntry } from '../models/publicTypes'
import {
  applyBuildListEntryReplacements,
  resolveBuildListEntryReplacement,
  sortBuildListEntryReplacements,
  validateBuildListEntryReplacements,
  validateGeneratedBuildListEntryReplacements,
  validateReplacedBuildListCardinality,
  type BuildListEntryReplacement,
} from './buildListEntryReplacement'

type EntryRef = Pick<BuildListEntry, 'id' | 'targetWeaponId'>

function entry(id: string, targetWeaponId: string): EntryRef {
  return { id: id as EntryRef['id'], targetWeaponId: targetWeaponId as EntryRef['targetWeaponId'] }
}

function replacement(targetWeaponId: string, replaced: string, generated: string): BuildListEntryReplacement {
  return {
    targetWeaponId: targetWeaponId as BuildListEntryReplacement['targetWeaponId'],
    replacedBuildListEntryId: replaced as BuildListEntryReplacement['replacedBuildListEntryId'],
    generatedBuildListEntryId: generated as BuildListEntryReplacement['generatedBuildListEntryId'],
  }
}

/**
 * The shared replacement authority of `docs/PLANNER_SPEC.md` 9.2.18 that B8,
 * B9, the ordinary Draft save and the replan adoption all read.
 */
describe('resolveBuildListEntryReplacement', () => {
  it('names the Target\'s one persisted Entry as the replaced Entry', () => {
    const persisted = [entry('a1', 'target.a'), entry('b1', 'target.b')]
    expect(resolveBuildListEntryReplacement(persisted, entry('b2', 'target.b'))).toEqual({
      status: 'ready',
      replacement: replacement('target.b', 'b1', 'b2'),
    })
  })

  it('fails closed when the Target holds no persisted Entry', () => {
    expect(resolveBuildListEntryReplacement([entry('a1', 'target.a')], entry('b2', 'target.b')))
      .toMatchObject({ status: 'invalid', reason: 'replaced_entry_missing' })
  })

  it('fails closed when which persisted Entry is replaced is unknown, choosing neither', () => {
    const persisted = [entry('b1', 'target.b'), entry('b0', 'target.b')]
    const result = resolveBuildListEntryReplacement(persisted, entry('b2', 'target.b'))
    expect(result).toMatchObject({ status: 'invalid', reason: 'replaced_entry_ambiguous' })
    expect(result.status === 'invalid' && result.detail).toContain('b0, b1')
  })

  it('fails closed when the generated ID is already a persisted Entry\'s', () => {
    expect(resolveBuildListEntryReplacement([entry('b1', 'target.b')], entry('b1', 'target.b')))
      .toMatchObject({ status: 'invalid', reason: 'generated_entry_id_in_use' })
  })
})

describe('applyBuildListEntryReplacements', () => {
  it('removes each replaced Entry and adds each generated Entry to a persisted set', () => {
    const persisted = [entry('a1', 'target.a'), entry('b1', 'target.b'), entry('c1', 'target.c')]
    const result = applyBuildListEntryReplacements(
      persisted,
      [replacement('target.a', 'a1', 'a2'), replacement('target.b', 'b1', 'b2')],
      [entry('a2', 'target.a'), entry('b2', 'target.b')],
    )
    expect(result.map(({ id }) => id)).toEqual(['c1', 'a2', 'b2'])
  })

  it('keeps generated Entries an augmented set already holds without duplicating them', () => {
    const augmented = [entry('a1', 'target.a'), entry('a2', 'target.a'), entry('b1', 'target.b')]
    const result = applyBuildListEntryReplacements(
      augmented,
      [replacement('target.a', 'a1', 'a2')],
      [entry('a2', 'target.a')],
    )
    expect(result.map(({ id }) => id)).toEqual(['a2', 'b1'])
  })
})

describe('validateBuildListEntryReplacements', () => {
  it('accepts persisted O + temporary G as an augmented set, and G alone as the replacement set', () => {
    const replacements = [replacement('target.a', 'a1', 'a2')]
    expect(validateBuildListEntryReplacements(
      [entry('a1', 'target.a'), entry('a2', 'target.a'), entry('b1', 'target.b')],
      replacements,
      'augmented',
    ).isValid).toBe(true)
    expect(validateBuildListEntryReplacements(
      [entry('a2', 'target.a'), entry('b1', 'target.b')],
      replacements,
      'replaced',
    ).isValid).toBe(true)
  })

  it('accepts one O + G pair on each of two Targets', () => {
    expect(validateBuildListEntryReplacements(
      [entry('a1', 'target.a'), entry('a2', 'target.a'), entry('b1', 'target.b'), entry('b2', 'target.b')],
      [replacement('target.a', 'a1', 'a2'), replacement('target.b', 'b1', 'b2')],
      'augmented',
    ).isValid).toBe(true)
  })

  it('fails closed on persisted O1 + persisted O2 + temporary G', () => {
    const result = validateBuildListEntryReplacements(
      [entry('a1', 'target.a'), entry('a0', 'target.a'), entry('a2', 'target.a')],
      [replacement('target.a', 'a1', 'a2')],
      'augmented',
    )
    expect(result.isValid).toBe(false)
  })

  it('fails closed on persisted O + temporary G1 + temporary G2', () => {
    const result = validateBuildListEntryReplacements(
      [entry('a1', 'target.a'), entry('a2', 'target.a'), entry('a3', 'target.a')],
      [replacement('target.a', 'a1', 'a2'), replacement('target.a', 'a1', 'a3')],
      'augmented',
    )
    expect(result.isValid).toBe(false)
    expect(result.issues.map(({ message }) => message)).toContainEqual(
      expect.stringContaining("TargetWeapon 'target.a' has more than one temporary BuildListEntry replacement"),
    )
  })

  it('fails closed on a temporary Entry whose Target is not the replacement\'s', () => {
    expect(validateBuildListEntryReplacements(
      [entry('a1', 'target.a'), entry('a2', 'target.b')],
      [replacement('target.a', 'a1', 'a2')],
      'augmented',
    ).isValid).toBe(false)
  })

  it('fails closed on a replacement set still holding O, and on an augmented set missing it', () => {
    const replacements = [replacement('target.a', 'a1', 'a2')]
    expect(validateBuildListEntryReplacements(
      [entry('a1', 'target.a'), entry('a2', 'target.a')],
      replacements,
      'replaced',
    ).isValid).toBe(false)
    expect(validateBuildListEntryReplacements(
      [entry('a2', 'target.a')],
      replacements,
      'augmented',
    ).isValid).toBe(false)
  })

  it('fails closed on an Entry replaced by itself', () => {
    expect(validateBuildListEntryReplacements(
      [entry('a1', 'target.a')],
      [replacement('target.a', 'a1', 'a1')],
      'augmented',
    ).isValid).toBe(false)
  })
})

describe('validateGeneratedBuildListEntryReplacements', () => {
  const generated = [entry('a2', 'target.a'), entry('b2', 'target.b')]

  it('accepts exactly one replacement per generated Entry for its own Target', () => {
    expect(validateGeneratedBuildListEntryReplacements(generated, [
      replacement('target.b', 'b1', 'b2'),
      replacement('target.a', 'a1', 'a2'),
    ]).isValid).toBe(true)
    expect(validateGeneratedBuildListEntryReplacements([], []).isValid).toBe(true)
  })

  it('refuses missing metadata, a generated Entry with no replacement, an extra replacement and a Target mismatch', () => {
    expect(validateGeneratedBuildListEntryReplacements(generated, undefined).isValid).toBe(false)
    expect(validateGeneratedBuildListEntryReplacements(generated, [
      replacement('target.a', 'a1', 'a2'),
    ]).isValid).toBe(false)
    expect(validateGeneratedBuildListEntryReplacements([], [
      replacement('target.a', 'a1', 'a2'),
    ]).isValid).toBe(false)
    expect(validateGeneratedBuildListEntryReplacements(generated, [
      replacement('target.b', 'a1', 'a2'),
      replacement('target.a', 'b1', 'b2'),
    ]).isValid).toBe(false)
  })

  it('refuses one Entry replaced twice and one Target replaced twice', () => {
    expect(validateGeneratedBuildListEntryReplacements(
      [entry('a2', 'target.a'), entry('a3', 'target.a')],
      [replacement('target.a', 'a1', 'a2'), replacement('target.a', 'a1', 'a3')],
    ).isValid).toBe(false)
  })
})

describe('validateReplacedBuildListCardinality', () => {
  it('requires each replaced Target to end with one Entry and leaves other Targets to the Build List', () => {
    const replacements = [replacement('target.a', 'a1', 'a2')]
    expect(validateReplacedBuildListCardinality(
      [entry('a2', 'target.a'), entry('c1', 'target.c'), entry('c2', 'target.c')],
      replacements,
    ).isValid).toBe(true)
    expect(validateReplacedBuildListCardinality(
      [entry('a2', 'target.a'), entry('a9', 'target.a')],
      replacements,
    ).isValid).toBe(false)
  })
})

describe('sortBuildListEntryReplacements', () => {
  it('orders by Target and never mutates the caller\'s records', () => {
    const input = [replacement('target.b', 'b1', 'b2'), replacement('target.a', 'a1', 'a2')]
    const sorted = sortBuildListEntryReplacements(input)
    expect(sorted.map(({ targetWeaponId }) => targetWeaponId)).toEqual(['target.a', 'target.b'])
    expect(input[0].targetWeaponId).toBe('target.b')
    expect(sorted[1]).not.toBe(input[0])
  })
})
