import { describe, expect, it } from 'vitest'
import { upsertPreservingOrder } from './managementListOrder'

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
