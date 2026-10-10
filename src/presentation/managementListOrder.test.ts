import { describe, expect, it } from 'vitest'
import { compareByRegistrationOrder, sortByRegistrationOrder, upsertPreservingOrder } from './managementListOrder'

interface Item {
  id: string
  name: string
}

const a: Item = { id: 'a', name: 'A' }
const b: Item = { id: 'b', name: 'B' }
const c: Item = { id: 'c', name: 'C' }

describe('upsertPreservingOrder', () => {
  it('appends a new item at the end', () => {
    const d: Item = { id: 'd', name: 'D' }
    expect(upsertPreservingOrder([a, b, c], d)).toEqual([a, b, c, d])
  })

  it('replaces an edited item at its original index instead of moving it to the end', () => {
    const edited: Item = { id: 'b', name: "B'" }
    expect(upsertPreservingOrder([a, b, c], edited)).toEqual([a, edited, c])
  })

  it('follows the documented sequence: edit in place, append, then delete preserving relative order', () => {
    const edited: Item = { id: 'b', name: "B'" }
    const d: Item = { id: 'd', name: 'D' }
    const afterEdit = upsertPreservingOrder([a, b, c], edited)
    const afterAdd = upsertPreservingOrder(afterEdit, d)
    const afterDelete = afterAdd.filter(({ id }) => id !== edited.id)
    expect(afterEdit.map(({ name }) => name)).toEqual(['A', "B'", 'C'])
    expect(afterAdd.map(({ name }) => name)).toEqual(['A', "B'", 'C', 'D'])
    expect(afterDelete.map(({ name }) => name)).toEqual(['A', 'C', 'D'])
  })

  it('does not mutate the input array', () => {
    const items = [a, b, c]
    upsertPreservingOrder(items, { id: 'b', name: 'X' })
    expect(items).toEqual([a, b, c])
  })
})

describe('sortByRegistrationOrder', () => {
  const at = (id: string, createdAt: string) => ({ id, createdAt })

  it('orders by createdAt, oldest first, whatever the input (repository) order is', () => {
    const first = at('zz', '2026-01-01T00:00:00.000Z')
    const second = at('aa', '2026-01-02T00:00:00.000Z')
    const third = at('mm', '2026-01-03T00:00:00.000Z')
    expect(sortByRegistrationOrder([third, first, second])).toEqual([first, second, third])
    expect(sortByRegistrationOrder([second, third, first])).toEqual([first, second, third])
  })

  it('compares instants, so an offset timestamp is placed by the moment it denotes', () => {
    const utc = at('a', '2026-01-01T10:00:00.000Z')
    const offset = at('b', '2026-01-01T18:30:00.000+09:00') // 09:30Z
    expect(sortByRegistrationOrder([utc, offset])).toEqual([offset, utc])
  })

  it('breaks a same-instant tie by ID, independent of the input order', () => {
    const b = at('b', '2026-01-01T00:00:00.000Z')
    const a = at('a', '2026-01-01T00:00:00.000Z')
    expect(sortByRegistrationOrder([b, a])).toEqual([a, b])
    expect(sortByRegistrationOrder([a, b])).toEqual([a, b])
    expect(compareByRegistrationOrder(a, { ...a })).toBe(0)
  })

  it('places an unparseable timestamp after every valid one, ordered by ID among themselves', () => {
    const valid = at('z', '2026-01-01T00:00:00.000Z')
    const brokenB = at('b', 'not-a-date')
    const brokenA = at('a', '')
    expect(sortByRegistrationOrder([brokenB, valid, brokenA])).toEqual([valid, brokenA, brokenB])
  })

  it('appends a newly registered item at the end and keeps an edited one in place', () => {
    const a = at('x', '2026-01-01T00:00:00.000Z')
    const b = at('y', '2026-01-02T00:00:00.000Z')
    const added = at('a', '2026-01-03T00:00:00.000Z')
    // An edit keeps createdAt (DATA_MODEL), so its position does not move.
    const editedA = { ...a, name: 'edited' }
    expect(sortByRegistrationOrder([added, b, editedA])).toEqual([editedA, b, added])
  })

  it('returns a copy and never reorders the input array', () => {
    const items = [at('b', '2026-01-02T00:00:00.000Z'), at('a', '2026-01-01T00:00:00.000Z')]
    const snapshot = [...items]
    sortByRegistrationOrder(items)
    expect(items).toEqual(snapshot)
  })
})
