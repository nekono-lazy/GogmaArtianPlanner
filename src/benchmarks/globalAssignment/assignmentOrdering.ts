/**
 * Issue #154 Global Assignment Phase B-1 (Research only; never imported by the app).
 *
 * The value order of one node and the MRV option count (`docs/PLANNER_GLOBAL_ASSIGNMENT_DESIGN.md`
 * 6.3 / 6.4), both lazy.
 *
 * Value order (design 6.3): smallest Σ stream-end increment first (`streamEndDelta()` against the node's
 * partial assignment), then an owned source before a new Normal, then the smaller required positions,
 * then the stable option key. "Smaller required positions" is realized as: the final Skill position,
 * the final Gogma position, the Normal forge position, then the secondary positions in Phase A's own
 * order (a conversion closest to its final Skill position first, i.e. `c` descending; `reset` before
 * `keep_from_source` before `reset_then_keep` at one final position; the earliest Reset of a
 * `reset_then_keep` first). The key is a pure function of the option and the partial assignment, so the
 * order never depends on enumeration history, Clock or run.
 *
 * The order is produced without materializing the `source x Skill x Bonus` product. Per source, the
 * Skill requirements are an indexable sequence whose stream end is monotone along the index (Phase A's
 * order), and each of the three Bonus streams (`reset`, `keep_from_source`, `reset_then_keep`) is an
 * ascending position array, so every (source, Bonus stream) pair is a 2-D lattice whose key is monotone
 * along both axes. A min-heap frontier merges every lattice: the roots are pushed first and a popped
 * cell pushes its right neighbour `(i, j + 1)` and, when `j = 0`, its lower neighbour `(i + 1, 0)`, so
 * each cell is reached exactly once and the memory held is the frontier - the roots plus the cells
 * popped so far - never the product. A source the partial assignment already uses is left out whole
 * (exact: every option of a used source violates C1). No option is dropped or reordered for cost.
 *
 * The MRV count walks Phase A's per-source generator and stops at the lookahead `k`; it reads no lower
 * bound (design 6.4, review R1).
 */
import { findResourceViolation, streamEndDelta } from './assignmentFeasibility'
import type { PartialResourceAssignment, ResourceViolationKind } from './assignmentTypes'
import {
  bonusRequirementIsNone, createReachOption, createResetThenKeepIndex, enumerateReachOptionsOfSource, keepFromSourcePositions, reachOptionKey,
  skillRequirementBlocks, sourceResourceKey,
} from './reachOptions'
import type { BonusRequirement, ReachOption, ReachTable, SkillRequirement, SourceCandidate, TargetReach } from './types'

/** A random-access view of a finite sequence that is never materialized as a whole. */
export interface IndexedSequence<T> {
  readonly length: number
  at(index: number): T
}

/**
 * The Skill requirements of one source as an indexable sequence in Phase A's order
 * (`enumerateSkillRequirements()`): `none`; `reset_skills` by final position; for a Normal source the
 * conversion blocks `(s*, c = s*), (s*, s* - 1), ..., (s*, origin)` per ascending `s*`, addressed through
 * block prefix sums so no `(c, s*)` pair is stored.
 */
export function indexedSkillRequirements(target: TargetReach, source: SourceCandidate, table: ReachTable): IndexedSequence<SkillRequirement> {
  const blocks = skillRequirementBlocks(target, source, table.originSkill)
  switch (blocks.kind) {
    case 'none':
      return { length: 1, at: () => ({ kind: 'none' }) }
    case 'reset_skills':
      return { length: blocks.finalPositions.length, at: index => ({ kind: 'reset_skills', finalPosition: blocks.finalPositions[index]! }) }
    case 'conversion': {
      const starts: number[] = []
      let length = 0
      for (const finalPosition of blocks.finalPositions) {
        starts.push(length)
        length += finalPosition - blocks.originSkill + 1
      }
      return {
        length,
        at: index => {
          if (!Number.isSafeInteger(index) || index < 0 || index >= length) throw new RangeError(`Skill requirement index ${String(index)} is out of range (${length}).`)
          let low = 0, high = starts.length - 1
          while (low < high) {
            const middle = (low + high + 1) >> 1
            if (starts[middle]! <= index) low = middle
            else high = middle - 1
          }
          const finalPosition = blocks.finalPositions[low]!
          return { kind: 'conversion', conversionPosition: finalPosition - (index - starts[low]!), finalPosition }
        },
      }
    }
  }
}

/**
 * The Bonus requirement streams of one source, each ascending in its final position (Phase A's
 * `enumerateBonusRequirements()` split by kind): `reset`, `keep_from_source` (only while supported for the
 * source's layout) and `reset_then_keep`; a single `none` for an owned Gogma already Ideal. Empty streams
 * are omitted. `resetThenKeep` is the Target's compact `reset_then_keep` index (`createResetThenKeepIndex()`,
 * no pair materialized), shared by its sources.
 */
export function indexedBonusStreams(target: TargetReach, source: SourceCandidate, resetThenKeep: IndexedSequence<BonusRequirement>): IndexedSequence<BonusRequirement>[] {
  if (bonusRequirementIsNone(source)) return [{ length: 1, at: () => ({ kind: 'none' }) }]
  const streams: IndexedSequence<BonusRequirement>[] = []
  const resets = target.bonus.resetIdealPositions
  if (resets.length > 0) streams.push({ length: resets.length, at: index => ({ kind: 'reset', finalPosition: resets[index]! }) })
  const keeps = keepFromSourcePositions(target, source)
  if (keeps.length > 0) streams.push({ length: keeps.length, at: index => ({ kind: 'keep_from_source', finalPosition: keeps[index]! }) })
  if (resetThenKeep.length > 0) streams.push(resetThenKeep)
  return streams
}

export interface TargetOptionLatticeSource {
  source: SourceCandidate
  key: string
  skills: IndexedSequence<SkillRequirement>
  bonusStreams: IndexedSequence<BonusRequirement>[]
}

/** The per-source lattices of one Target, built once per search and shared by every node. */
export interface TargetOptionLattice {
  target: TargetReach
  sources: readonly TargetOptionLatticeSource[]
}

/** `resetThenKeep` defaults to the Target's own compact index; a caller holding one already (the solver) passes it so one Target has one index. */
export function createTargetOptionLattice(target: TargetReach, table: ReachTable, resetThenKeep: IndexedSequence<BonusRequirement> = createResetThenKeepIndex(target)): TargetOptionLattice {
  return {
    target,
    sources: target.sources.map(source => ({
      source, key: sourceResourceKey(source), skills: indexedSkillRequirements(target, source, table), bonusStreams: indexedBonusStreams(target, source, resetThenKeep),
    })),
  }
}

/** The value order key of design 6.3 (see the module comment); compared lexicographically, then by the stable option key. */
export interface ValueOrderKey {
  components: readonly number[]
  optionKey: string
}

function bonusKindRank(bonus: BonusRequirement): number {
  switch (bonus.kind) {
    case 'none': return 0
    case 'reset': return 1
    case 'keep_from_source': return 2
    case 'reset_then_keep': return 3
  }
}

export function valueOrderKey(option: ReachOption, partial: PartialResourceAssignment): ValueOrderKey {
  const skill = option.skillRequired
  const bonus = option.bonusRequired
  return {
    components: [
      streamEndDelta(option, partial),
      option.source.kind === 'new_normal' ? 1 : 0,
      skill.kind === 'none' ? -1 : skill.finalPosition,
      bonus.kind === 'none' ? -1 : bonus.finalPosition,
      option.normalRequired === null ? -1 : option.normalRequired.position,
      skill.kind === 'conversion' ? skill.finalPosition - skill.conversionPosition : 0,
      bonusKindRank(bonus),
      bonus.kind === 'reset_then_keep' ? bonus.resetPosition : -1,
    ],
    optionKey: reachOptionKey(option),
  }
}

export function compareValueOrder(left: ValueOrderKey, right: ValueOrderKey): number {
  for (let index = 0; index < left.components.length; index++) {
    const difference = left.components[index]! - right.components[index]!
    if (difference !== 0) return difference
  }
  return left.optionKey < right.optionKey ? -1 : left.optionKey > right.optionKey ? 1 : 0
}

interface LatticeCell {
  sourceIndex: number
  streamIndex: number
  i: number
  j: number
  option: ReachOption
  key: ValueOrderKey
}

class CellHeap {
  private readonly cells: LatticeCell[] = []

  get size(): number {
    return this.cells.length
  }

  push(cell: LatticeCell): void {
    const cells = this.cells
    cells.push(cell)
    let index = cells.length - 1
    while (index > 0) {
      const parent = (index - 1) >> 1
      if (compareValueOrder(cells[index]!.key, cells[parent]!.key) >= 0) break
      ;[cells[index], cells[parent]] = [cells[parent]!, cells[index]!]
      index = parent
    }
  }

  pop(): LatticeCell | undefined {
    const cells = this.cells
    if (cells.length === 0) return undefined
    const top = cells[0]!
    const last = cells.pop()!
    if (cells.length > 0) {
      cells[0] = last
      let index = 0
      while (true) {
        const left = index * 2 + 1
        const right = left + 1
        let smallest = index
        if (left < cells.length && compareValueOrder(cells[left]!.key, cells[smallest]!.key) < 0) smallest = left
        if (right < cells.length && compareValueOrder(cells[right]!.key, cells[smallest]!.key) < 0) smallest = right
        if (smallest === index) break
        ;[cells[index], cells[smallest]] = [cells[smallest]!, cells[index]!]
        index = smallest
      }
    }
    return top
  }
}

export interface OrderedOptionEnumerator {
  /** The next option of the Target in value order, or undefined when every option of an unused source was delivered. */
  next(): ReachOption | undefined
  /** Cells currently held (the lattice frontier). */
  readonly frontierSize: number
  /** Options delivered so far. */
  readonly delivered: number
  /** Sources left out whole because the partial assignment already uses them (C1). */
  readonly excludedUsedSources: number
}

/**
 * Enumerates every option of the lattice's Target whose source the partial assignment does not use, in
 * value order against that partial assignment (which the caller keeps fixed for the enumerator's life).
 * Position feasibility (C2) is not filtered here: the caller judges each delivered option.
 */
export function createOrderedOptionEnumerator(lattice: TargetOptionLattice, table: ReachTable, partial: PartialResourceAssignment): OrderedOptionEnumerator {
  const heap = new CellHeap()
  let delivered = 0
  let excludedUsedSources = 0
  const cell = (sourceIndex: number, streamIndex: number, i: number, j: number): LatticeCell => {
    const source = lattice.sources[sourceIndex]!
    const option = createReachOption(lattice.target, table, source.source, source.skills.at(i), source.bonusStreams[streamIndex]!.at(j))
    return { sourceIndex, streamIndex, i, j, option, key: valueOrderKey(option, partial) }
  }
  lattice.sources.forEach((source, sourceIndex) => {
    if (partial.usedSources.has(source.key)) { excludedUsedSources += 1; return }
    if (source.skills.length === 0) return
    source.bonusStreams.forEach((stream, streamIndex) => {
      if (stream.length > 0) heap.push(cell(sourceIndex, streamIndex, 0, 0))
    })
  })
  return {
    next: () => {
      const top = heap.pop()
      if (!top) return undefined
      const source = lattice.sources[top.sourceIndex]!
      const stream = source.bonusStreams[top.streamIndex]!
      if (top.j + 1 < stream.length) heap.push(cell(top.sourceIndex, top.streamIndex, top.i, top.j + 1))
      if (top.j === 0 && top.i + 1 < source.skills.length) heap.push(cell(top.sourceIndex, top.streamIndex, top.i + 1, 0))
      delivered += 1
      return top.option
    },
    get frontierSize() { return heap.size },
    get delivered() { return delivered },
    get excludedUsedSources() { return excludedUsedSources },
  }
}

export interface FeasibleOptionCount {
  /** Resource-feasible options found, saturated at the limit. */
  count: number
  /**
   * What the walk skipped before it stopped: `source` counts used sources skipped whole (C1), the position
   * kinds count options (C2). Exact only when the count did not reach the limit (then every option was walked).
   */
  rejections: Record<ResourceViolationKind, number>
}

/**
 * `countUpTo(k)` of design 6.4: the resource-feasible options of `target` under `partial`, counted in
 * Phase A's order until `limit` is reached. A used source is skipped whole; no lower bound is read.
 * `onOptionWalked` is called once per option examined (feasible or not), so a long walk can poll the
 * Research cancel seam; it never changes the count.
 */
export function countFeasibleOptionsUpTo(target: TargetReach, table: ReachTable, partial: PartialResourceAssignment, limit: number,
  onOptionWalked?: () => void): FeasibleOptionCount {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError(`countFeasibleOptionsUpTo limit must be a positive integer (got ${String(limit)}).`)
  const rejections: Record<ResourceViolationKind, number> = { source: 0, skill_position: 0, gogma_position: 0, normal_position: 0 }
  let count = 0
  for (const source of target.sources) {
    if (partial.usedSources.has(sourceResourceKey(source))) { rejections.source += 1; continue }
    for (const option of enumerateReachOptionsOfSource(target, table, source)) {
      onOptionWalked?.()
      const violation = findResourceViolation(option, partial)
      if (violation !== null) { rejections[violation] += 1; continue }
      count += 1
      if (count >= limit) return { count, rejections }
    }
  }
  return { count, rejections }
}
