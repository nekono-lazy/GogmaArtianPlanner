import { describe, expect, it } from 'vitest'
import { createLazyIdealCross } from './lazyIdealCross'
import type { EvaluatedBonusSolution, EvaluatedSkillSolution } from './streamSolutions'

function bonus(name: string, idealMatch = true): EvaluatedBonusSolution {
  return { idealMatch, retentionKey: name } as unknown as EvaluatedBonusSolution
}
function skill(name: string, idealMatch = true): EvaluatedSkillSolution {
  return { idealMatch, semanticKey: name } as unknown as EvaluatedSkillSolution
}

/** A stand-in scheduler: queued cells and wake-up steps settle only when told. */
function harness() {
  const opened: string[] = []
  const woken: string[] = []
  const pending: Array<() => void> = []
  const wakes: Array<() => void> = []
  const cross = createLazyIdealCross({
    open: (b, s, onSettled) => {
      opened.push(`${b.retentionKey}x${s.semanticKey}`)
      pending.push(onSettled)
    },
    wake: (b, s, resume) => {
      woken.push(`${b.retentionKey}x${s.semanticKey}`)
      wakes.push(resume)
    },
  })
  /** Settles every currently queued cell and wake-up step once. */
  const settleAll = () => {
    const current = [...pending.splice(0), ...wakes.splice(0)]
    for (const settle of current) settle()
    return current.length
  }
  const drain = () => { while (settleAll() > 0) { /* drain */ } }
  return { cross, opened, woken, pending, wakes, settleAll, drain }
}

describe('createLazyIdealCross (SEARCH_SPEC 5.6.8 lazy off-axis composition)', () => {
  it('opens only the head of each row before any cell settles', () => {
    const { cross, opened } = harness()
    for (const name of ['k0', 'k1', 'k2']) cross.addSkill(skill(name))
    for (const name of ['b0', 'b1', 'b2']) cross.addBonus(bonus(name))
    // Three rows, one pending cell each: never the 3 x 3 product up front.
    expect(opened).toEqual(['b0xk0', 'b1xk0', 'b2xk0'])
  })

  it('opens every cell, off-axis included, exactly once as cells settle', () => {
    const { cross, opened, drain } = harness()
    cross.addBonus(bonus('b0'))
    cross.addSkill(skill('k0'))
    cross.addBonus(bonus('b1'))
    cross.addSkill(skill('k1'))
    drain()
    expect(opened.sort()).toEqual(['b0xk0', 'b0xk1', 'b1xk0', 'b1xk1'])
  })

  it('resumes waiting rows one queued wake-up step at a time, in row order', () => {
    const { cross, opened, woken, pending, wakes, settleAll } = harness()
    for (const name of ['b0', 'b1', 'b2', 'b3']) cross.addBonus(bonus(name))
    expect(opened).toEqual([])
    cross.addSkill(skill('k0'))
    // Nothing opens synchronously on arrival: one wake-up step for the
    // cheapest waiting row is queued, and each step queues the next one.
    expect(opened).toEqual([])
    expect(woken).toEqual(['b0xk0'])
    wakes.shift()!()
    expect(opened).toEqual(['b0xk0'])
    expect(woken).toEqual(['b0xk0', 'b1xk0'])
    expect(wakes).toHaveLength(1)
    // A row keeps at most one pending cell while the batch continues.
    pending.shift()!()
    expect(pending).toHaveLength(0)
    while (settleAll() > 0) { /* drain */ }
    expect(opened).toEqual(['b0xk0', 'b1xk0', 'b2xk0', 'b3xk0'])
    expect(woken).toEqual(['b0xk0', 'b1xk0', 'b2xk0', 'b3xk0'])
  })

  it('leaves the rest of a wake-up batch unresumed when the scheduler stops settling', () => {
    const { cross, opened, wakes } = harness()
    for (let row = 0; row < 1000; row += 1) cross.addBonus(bonus('b' + row))
    cross.addSkill(skill('k0'))
    for (let step = 0; step < 3; step += 1) wakes.shift()!()
    expect(opened).toHaveLength(3)
    expect(wakes).toHaveLength(1)
  })

  it('wakes rows by row order even when they started waiting out of order', () => {
    const { cross, opened, pending, drain } = harness()
    cross.addSkill(skill('k0'))
    for (const name of ['b0', 'b1', 'b2']) cross.addBonus(bonus(name))
    // b2 settles first, then b0, then b1: all three wait for k1.
    const [settle0, settle1, settle2] = pending.splice(0)
    settle2()
    settle0()
    settle1()
    cross.addSkill(skill('k1'))
    drain()
    expect(opened.slice(3)).toEqual(['b0xk1', 'b1xk1', 'b2xk1'])
  })

  it('never folds a later solution with the same result into an earlier one', () => {
    const { cross, opened, drain } = harness()
    cross.addBonus(bonus('same'))
    cross.addBonus(bonus('same'))
    cross.addSkill(skill('same'))
    cross.addSkill(skill('same'))
    drain()
    expect(opened).toHaveLength(4)
  })

  it('composes Ideal solutions only', () => {
    const { cross, opened, drain } = harness()
    cross.addBonus(bonus('b0'))
    cross.addBonus(bonus('practical', false))
    cross.addSkill(skill('practical', false))
    cross.addSkill(skill('k0'))
    drain()
    expect(opened).toEqual(['b0xk0'])
  })
})
