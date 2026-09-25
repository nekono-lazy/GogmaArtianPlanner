import { describe, expect, it } from 'vitest'
import { createLazyIdealCross } from './lazyIdealCross'
import type { EvaluatedBonusSolution, EvaluatedSkillSolution } from './streamSolutions'

function bonus(name: string, idealMatch = true): EvaluatedBonusSolution {
  return { idealMatch, retentionKey: name } as unknown as EvaluatedBonusSolution
}
function skill(name: string, idealMatch = true): EvaluatedSkillSolution {
  return { idealMatch, semanticKey: name } as unknown as EvaluatedSkillSolution
}

function harness() {
  const opened: string[] = []
  const pending: Array<() => void> = []
  const cross = createLazyIdealCross((b, s, onSettled) => {
    opened.push(`${b.retentionKey}x${s.semanticKey}`)
    pending.push(onSettled)
  })
  /** Settles every currently opened cell once, in opening order. */
  const settleAll = () => {
    const current = pending.splice(0)
    for (const settle of current) settle()
    return current.length
  }
  return { cross, opened, pending, settleAll }
}

describe('createLazyIdealCross (SEARCH_SPEC 5.6.8 lazy off-axis composition)', () => {
  it('opens only the head of each row before any cell settles', () => {
    const { cross, opened } = harness()
    for (const name of ['b0', 'b1', 'b2']) cross.addBonus(bonus(name))
    for (const name of ['k0', 'k1', 'k2']) cross.addSkill(skill(name))
    // Three rows, one pending cell each: never the 3 x 3 product up front.
    expect(opened).toEqual(['b0xk0', 'b1xk0', 'b2xk0'])
  })

  it('opens every cell, off-axis included, exactly once as cells settle', () => {
    const { cross, opened, settleAll } = harness()
    cross.addBonus(bonus('b0'))
    cross.addSkill(skill('k0'))
    cross.addBonus(bonus('b1'))
    cross.addSkill(skill('k1'))
    while (settleAll() > 0) { /* drain */ }
    expect(opened.sort()).toEqual(['b0xk0', 'b0xk1', 'b1xk0', 'b1xk1'])
  })

  it('keeps at most one pending cell per row and resumes a waiting row when its Skill arrives', () => {
    const { cross, opened, pending, settleAll } = harness()
    cross.addBonus(bonus('b0'))
    cross.addBonus(bonus('b1'))
    expect(opened).toEqual([])
    cross.addSkill(skill('k0'))
    expect(pending).toHaveLength(2)
    settleAll()
    // Both rows wait for column 1; nothing is opened without it.
    expect(pending).toHaveLength(0)
    cross.addSkill(skill('k1'))
    expect(opened).toEqual(['b0xk0', 'b1xk0', 'b0xk1', 'b1xk1'])
    expect(pending).toHaveLength(2)
  })

  it('never folds a later solution with the same result into an earlier one', () => {
    const { cross, opened, settleAll } = harness()
    cross.addBonus(bonus('same'))
    cross.addBonus(bonus('same'))
    cross.addSkill(skill('same'))
    cross.addSkill(skill('same'))
    while (settleAll() > 0) { /* drain */ }
    expect(opened).toHaveLength(4)
  })

  it('composes Ideal solutions only', () => {
    const { cross, opened, settleAll } = harness()
    cross.addBonus(bonus('b0'))
    cross.addBonus(bonus('practical', false))
    cross.addSkill(skill('practical', false))
    cross.addSkill(skill('k0'))
    while (settleAll() > 0) { /* drain */ }
    expect(opened).toEqual(['b0xk0'])
  })
})
