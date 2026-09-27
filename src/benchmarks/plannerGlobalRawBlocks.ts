/** Phase 1-B only. No Production caller imports this observer/cache. */
import { ProductionRngEngine } from '../domain/rng/production/productionRngEngine'
import { readReferenceRngBlock, REFERENCE_RNG_BLOCK_SIZE, type ReferenceRngBlock } from '../domain/rng/production/referencePrng'

export type RawBlockCacheMode = 'off' | 'per-search' | 'run'

export interface RawBlockProfile {
  targetId: string
  requests: number
  uniqueBlocks: number
  duplicateRequests: number
  theoreticalHitRatio: number
  hits: number
  misses: number
  failures: number
  evictions: number
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
  private disposed = false
  private readonly runCache = new Map<string, ReferenceRngBlock>()
  private readonly runSeen = new Set<string>()
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
    if (this.disposed) throw new Error('Raw block Research run has ended')
    if (this.active) throw new Error('Raw block Research searches must be sequential')
    this.active = true
    const cache = this.mode === 'run' ? this.runCache : new Map<string, ReferenceRngBlock>()
    const seen = new Set<string>()
    let ended = false
    const profile: RawBlockProfile = { targetId, requests: 0, uniqueBlocks: 0, duplicateRequests: 0,
      theoreticalHitRatio: 0, hits: 0, misses: 0, failures: 0, evictions: 0, hitRatio: 0,
      readerElapsedMs: 0, missReadElapsedMs: 0, maxBlockIndex: null, blockIndexDistribution: {},
      peakEntries: cache.size, rawUint32Count: cache.size * REFERENCE_RNG_BLOCK_SIZE,
      approximatePayloadBytes: cache.size * REFERENCE_RNG_BLOCK_SIZE * 4 }
    this.profiles.push(profile)
    const read: typeof readReferenceRngBlock = (seed, blockIndex) => {
      if (ended) throw new Error('Raw block Search lifetime has ended')
      // These are the actual arguments AFTER seed derivation and gate selection.
      const key = `${seed}:${blockIndex}`
      profile.requests++
      seen.add(key)
      this.runSeen.add(key)
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
        if (cache.size === this.maxEntries) { cache.delete(cache.keys().next().value!); profile.evictions++ } // FIFO: performance only
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
      if (ended) return
      ended = true; this.active = false
      if (this.mode !== 'run') cache.clear()
      seen.clear()
    } }
  }

  summary() {
    const sum = (key: 'requests' | 'hits' | 'misses' | 'failures' | 'evictions' | 'readerElapsedMs' | 'missReadElapsedMs') =>
      this.profiles.reduce((total, profile) => total + profile[key], 0)
    const requests = sum('requests'), hits = sum('hits')
    const peakEntries = Math.max(0, ...this.profiles.map(p => p.peakEntries))
    return { requests, uniqueBlocks: this.runSeen.size, duplicateRequests: requests - this.runSeen.size,
      theoreticalHitRatio: requests ? (requests - this.runSeen.size) / requests : 0,
      hits, hitRatio: requests ? hits / requests : 0, misses: sum('misses'), failures: sum('failures'), evictions: sum('evictions'),
      readerElapsedMs: sum('readerElapsedMs'), missReadElapsedMs: sum('missReadElapsedMs'),
      peakEntries, rawUint32Count: peakEntries * REFERENCE_RNG_BLOCK_SIZE,
      approximatePayloadBytes: peakEntries * REFERENCE_RNG_BLOCK_SIZE * 4,
      maxBlockIndex: this.profiles.reduce<number | null>((max, p) => p.maxBlockIndex === null ? max : Math.max(max ?? p.maxBlockIndex, p.maxBlockIndex), null),
      blockIndexDistribution: this.profiles.reduce<Record<string, number>>((counts, p) => {
        for (const [bucket, count] of Object.entries(p.blockIndexDistribution)) counts[bucket] = (counts[bucket] ?? 0) + count
        return counts
      }, {}) }
  }

  endRun() {
    if (this.active) throw new Error('End the active Search before ending the run')
    this.runCache.clear(); this.runSeen.clear(); this.disposed = true
  }
}
