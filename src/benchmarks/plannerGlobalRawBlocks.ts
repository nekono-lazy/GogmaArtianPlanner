/** Phase 1-B only. No Production caller imports this observer/cache. */
import { ProductionRngEngine } from '../domain/rng/production/productionRngEngine'
import { readReferenceRngBlock, REFERENCE_RNG_BLOCK_SIZE, type ReferenceRngBlock } from '../domain/rng/production/referencePrng'

export type RawBlockCacheMode = 'off' | 'per-search'

export interface RawBlockProfile {
  targetId: string
  requests: number
  uniqueBlocks: number
  duplicateRequests: number
  theoreticalHitRatio: number
  hits: number
  misses: number
  failures: number
  hitRatio: number
  readerElapsedMs: number
  missReadElapsedMs: number
  maxBlockIndex: number | null
  /** Request counts in [0], [1..255], [256..511], [512..1023], ... */
  blockIndexDistribution: Record<string, number>
  peakEntries: number
  rawUint32Count: number
  /** Packed uint32 equivalent only; JS numbers/arrays/Map have extra overhead. */
  approximatePayloadBytes: number
}

export class GlobalRawBlockResearch {
  readonly profiles: RawBlockProfile[] = []
  private active = false
  readonly mode: RawBlockCacheMode
  readonly maxEntries: number
  private readonly underlying: typeof readReferenceRngBlock
  private readonly nowMs: () => number

  constructor(mode: RawBlockCacheMode, underlying = readReferenceRngBlock,
    nowMs = () => performance.now(), maxEntries = 20000) {
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) throw new RangeError('Invalid raw block cache limit')
    this.mode = mode; this.underlying = underlying; this.nowMs = nowMs; this.maxEntries = maxEntries
  }

  beginSearch(targetId: string) {
    if (this.active) throw new Error('Raw block Research searches must be sequential')
    this.active = true
    const cache = new Map<string, ReferenceRngBlock>()
    const seen = new Set<string>()
    let ended = false
    const profile: RawBlockProfile = { targetId, requests: 0, uniqueBlocks: 0, duplicateRequests: 0,
      theoreticalHitRatio: 0, hits: 0, misses: 0, failures: 0, hitRatio: 0,
      readerElapsedMs: 0, missReadElapsedMs: 0, maxBlockIndex: null, blockIndexDistribution: {},
      peakEntries: 0, rawUint32Count: 0, approximatePayloadBytes: 0 }
    this.profiles.push(profile)
    const read: typeof readReferenceRngBlock = (seed, blockIndex) => {
      if (ended) throw new Error('Raw block Search lifetime has ended')
      // These are the actual arguments AFTER seed derivation and gate selection.
      const key = `${seed}:${blockIndex}`
      profile.requests++
      seen.add(key)
      profile.uniqueBlocks = seen.size
      profile.duplicateRequests = profile.requests - seen.size
      profile.theoreticalHitRatio = profile.duplicateRequests / profile.requests
      profile.maxBlockIndex = Math.max(profile.maxBlockIndex ?? blockIndex, blockIndex)
      const power = Math.max(8, Math.floor(Math.log2(Math.max(1, blockIndex))) + 1)
      const bucket = blockIndex === 0 ? '0' : power === 8 ? '1..255' : `${2 ** (power - 1)}..${2 ** power - 1}`
      profile.blockIndexDistribution[bucket] = (profile.blockIndexDistribution[bucket] ?? 0) + 1
      const start = this.nowMs()
      try {
        const hit = cache.get(key)
        if (hit !== undefined) { profile.hits++; return hit }
        profile.misses++
        const readStart = this.nowMs()
        let block: ReferenceRngBlock
        try { block = this.underlying(seed, blockIndex) }
        catch (error) { profile.failures++; throw error }
        finally { profile.missReadElapsedMs += this.nowMs() - readStart }
        if (this.mode === 'off') return block // same reference, no mutation, no extra RNG call
        // Own and freeze both levels. Consumers cannot corrupt a subsequent hit.
        const immutable = Object.freeze({ blockIndex: block.blockIndex, values: Object.freeze([...block.values]) })
        if (cache.size === this.maxEntries) cache.delete(cache.keys().next().value!) // FIFO: performance only
        cache.set(key, immutable)
        profile.peakEntries = Math.max(profile.peakEntries, cache.size)
        profile.rawUint32Count = profile.peakEntries * REFERENCE_RNG_BLOCK_SIZE
        profile.approximatePayloadBytes = profile.rawUint32Count * 4
        return immutable
      } finally {
        profile.readerElapsedMs += this.nowMs() - start
        profile.hitRatio = profile.hits / profile.requests
      }
    }
    return { engine: new ProductionRngEngine(read), read, profile, end: () => {
      ended = true; this.active = false; cache.clear(); seen.clear()
    } }
  }
}
