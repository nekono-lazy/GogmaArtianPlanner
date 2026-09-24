import type {
  PlannerSearchPhaseTimes,
  PlannerSearchDepthMetrics,
  PlannerSearchEntryMetrics,
  PlannerSearchRunMetrics,
} from '../domain/planner'

/**
 * Derived Issue #103 metrics. Pure arithmetic over the raw instrumentation
 * output; nothing here re-runs or re-derives a search decision.
 */

/** `numerator / denominator`, or `null` when the denominator is zero. */
export function safeRatio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator
}

export interface PlannerSearchPlateau {
  /**
   * The first depth at which the kept beam's best completed Target count
   * reached its final maximum. `null` when no depth ran.
   */
  plateauStartDepth: number | null
  /** Completed Target count held from `plateauStartDepth` to the last depth. */
  plateauCompletedTargetCount: number
  /** Depths spent at that count, the start depth included. */
  plateauDepthCount: number
  /** Generated successors spent from the plateau start to the end. */
  plateauGeneratedSuccessors: number
}

export interface PlannerSearchDerivedMetrics {
  /** generatedSuccessors / expandedBeamStates over the run. */
  successorsPerExpandedState: number | null
  /** 1 - afterDedup / beforeDedup over the run. */
  semanticDedupRatio: number | null
  /** 1 - afterTrim / beforeTrim (= afterDedup) over the run. */
  beamTrimRatio: number | null
  /** 1 - traceFreeUnique / beforeDedup, when projections were collected. */
  traceFreeProjectionMergeRatio: number | null
  /** 1 - progressUnique / beforeDedup, when projections were collected. */
  progressProjectionMergeRatio: number | null
  maxCompletedTargetCount: number
  plateau: PlannerSearchPlateau
  /** Depths in which a trimmed state completed more Targets than every kept one. */
  depthsTrimmingMoreCompletedStates: number
  sharedSuccessorRatio: number | null
  /** Summed phase times over every depth, when a clock was given. */
  phaseMs: PlannerSearchPhaseTimes | null
}

export function derivePlannerSearchMetrics(
  depths: readonly PlannerSearchDepthMetrics[],
  run: PlannerSearchRunMetrics,
): PlannerSearchDerivedMetrics {
  const expandedBeamStates = depths.reduce((sum, depth) => sum + depth.expandedBeamStates, 0)
  const before = run.totals.successorsBeforeSemanticDedup
  const after = run.totals.successorsAfterSemanticDedup
  const trimmed = run.totals.statesAfterBeamTrim
  const withProjections = depths.filter((depth) => depth.diagnosticProjections !== null)
  const projectionBefore = withProjections.reduce(
    (sum, depth) => sum + depth.successorsBeforeSemanticDedup,
    0,
  )
  const traceFree = withProjections.reduce(
    (sum, depth) => sum + (depth.diagnosticProjections?.successorsAfterTraceFreeKey ?? 0),
    0,
  )
  const progress = withProjections.reduce(
    (sum, depth) => sum + (depth.diagnosticProjections?.successorsAfterProgressKey ?? 0),
    0,
  )
  const finalBest = depths.reduce(
    (max, depth) => Math.max(max, depth.bestCompletedTargetCount),
    0,
  )
  const plateauStart = depths.find((depth) => depth.bestCompletedTargetCount === finalBest)
  const plateauDepths =
    plateauStart === undefined ? [] : depths.filter(({ depth }) => depth >= plateauStart.depth)
  const complement = (value: number | null) => (value === null ? null : 1 - value)
  return {
    successorsPerExpandedState: safeRatio(run.totals.generatedSuccessors, expandedBeamStates),
    semanticDedupRatio: complement(safeRatio(after, before)),
    beamTrimRatio: complement(safeRatio(trimmed, after)),
    traceFreeProjectionMergeRatio:
      withProjections.length === 0 ? null : complement(safeRatio(traceFree, projectionBefore)),
    progressProjectionMergeRatio:
      withProjections.length === 0 ? null : complement(safeRatio(progress, projectionBefore)),
    maxCompletedTargetCount: run.maxCompletedTargetCountEverObserved,
    plateau: {
      plateauStartDepth: plateauStart?.depth ?? null,
      plateauCompletedTargetCount: finalBest,
      plateauDepthCount: plateauDepths.length,
      plateauGeneratedSuccessors: plateauDepths.reduce(
        (sum, depth) => sum + depth.generatedSuccessors,
        0,
      ),
    },
    depthsTrimmingMoreCompletedStates: depths.filter(
      (depth) => depth.trimmedStatesAboveKeptBest > 0,
    ).length,
    sharedSuccessorRatio: safeRatio(
      run.totals.sharedPhysicalActionSuccessors,
      run.totals.generatedSuccessors,
    ),
    phaseMs: depths.some((depth) => depth.phaseMs !== null)
      ? depths.reduce<PlannerSearchPhaseTimes>(
          (sum, depth) => ({
            beamStateSetup: sum.beamStateSetup + (depth.phaseMs?.beamStateSetup ?? 0),
            applyAction: sum.applyAction + (depth.phaseMs?.applyAction ?? 0),
            successorEvaluation:
              sum.successorEvaluation + (depth.phaseMs?.successorEvaluation ?? 0),
            dedupAndTrim: sum.dedupAndTrim + (depth.phaseMs?.dedupAndTrim ?? 0),
          }),
          { beamStateSetup: 0, applyAction: 0, successorEvaluation: 0, dedupAndTrim: 0 },
        )
      : null,
  }
}

/**
 * The representative depths of a run: the first few, the widest one, every
 * depth at which the kept best completed count rose, the plateau start, and
 * the last one. Sorted and unique.
 */
export function selectRepresentativeDepths(
  depths: readonly PlannerSearchDepthMetrics[],
  leading = 4,
): PlannerSearchDepthMetrics[] {
  if (depths.length === 0) return []
  const picked = new Set<number>()
  depths.slice(0, leading).forEach(({ depth }) => picked.add(depth))
  const widest = depths.reduce((best, depth) =>
    depth.generatedSuccessors > best.generatedSuccessors ? depth : best,
  )
  picked.add(widest.depth)
  let previousBest = -1
  depths.forEach((depth) => {
    if (depth.bestCompletedTargetCount > previousBest) {
      picked.add(depth.depth)
      previousBest = depth.bestCompletedTargetCount
    }
  })
  picked.add(depths[depths.length - 1].depth)
  return depths.filter(({ depth }) => picked.has(depth))
}

function entryTotal(entry: PlannerSearchEntryMetrics): number {
  const { base, bonus, skill, reserve } = entry.generatedSuccessors
  return base + bonus + skill + reserve
}

export function topEntriesBySuccessors(
  entries: readonly PlannerSearchEntryMetrics[],
  limit = 10,
): PlannerSearchEntryMetrics[] {
  return [...entries]
    .sort((left, right) => {
      const difference = entryTotal(right) - entryTotal(left)
      if (difference !== 0) return difference
      return left.buildListEntryId < right.buildListEntryId ? -1 : 1
    })
    .slice(0, limit)
}

function percent(value: number | null): string {
  return value === null ? '-' : `${(value * 100).toFixed(1)}%`
}

function fixed(value: number | null, digits = 2): string {
  return value === null ? '-' : value.toFixed(digits)
}

export function formatDepthTable(depths: readonly PlannerSearchDepthMetrics[]): string {
  const header =
    '| Depth | Beam In | Expanded | Generated (B/Bo/S/R) | Dedup After | Beam After | Best / Worst Complete | Max Complete pre-trim | Trimmed above kept | Conflicts on expanded | Shared | FF units (Bo/S) | Cum. expanded |'
  const divider = `|${header.split('|').slice(1, -1).map(() => '---').join('|')}|`
  const rows = depths.map((depth) => {
    const lane = depth.generatedSuccessorsByLane
    return `| ${depth.depth} | ${depth.beamInputStates} | ${depth.expandedBeamStates} | ${depth.generatedSuccessors} (${lane.base}/${lane.bonus}/${lane.skill}/${lane.reserve}) | ${depth.successorsAfterSemanticDedup} | ${depth.statesAfterBeamTrim} | ${depth.bestCompletedTargetCount} / ${depth.worstCompletedTargetCount} | ${depth.maxCompletedTargetCountBeforeTrim} | ${depth.trimmedStatesAboveKeptBest} | ${depth.expandedStateConflicts} | ${depth.sharedPhysicalActionSuccessors} | ${depth.fastForwardedUnits.bonus}/${depth.fastForwardedUnits.skill} | ${depth.cumulativeExpandedStates} |`
  })
  return [header, divider, ...rows].join('\n')
}

export function formatProjectionTable(depths: readonly PlannerSearchDepthMetrics[]): string {
  const header =
    '| Depth | Before dedup | Semantic unique | Trace-free unique | Progress unique | Kept beam distinct progress |'
  const divider = '|---|---|---|---|---|---|'
  const rows = depths.flatMap((depth) =>
    depth.diagnosticProjections === null
      ? []
      : [
          `| ${depth.depth} | ${depth.successorsBeforeSemanticDedup} | ${depth.successorsAfterSemanticDedup} | ${depth.diagnosticProjections.successorsAfterTraceFreeKey} | ${depth.diagnosticProjections.successorsAfterProgressKey} | ${depth.diagnosticProjections.keptBeamDistinctProgressKeys} |`,
        ],
  )
  return [header, divider, ...rows].join('\n')
}

export function formatTopEntryTable(entries: readonly PlannerSearchEntryMetrics[]): string {
  const header =
    '| Entry | Route | Units (B/Bo/S) | Base | Bonus | Skill | Reserve | Total | Shared secondary | FF (Bo/S) | Rejected |'
  const divider = '|---|---|---|---|---|---|---|---|---|---|---|'
  const rows = entries.map((entry) => {
    const successors = entry.generatedSuccessors
    return `| ${entry.buildListEntryId} | ${entry.routeKind} | ${entry.unitCounts.base}/${entry.unitCounts.bonus}/${entry.unitCounts.skill} | ${successors.base} | ${successors.bonus} | ${successors.skill} | ${successors.reserve} | ${entryTotal(entry)} | ${entry.progressedAsSharedSecondary} | ${entry.fastForwardedUnits.bonus}/${entry.fastForwardedUnits.skill} | ${entry.rejectedAttempts} |`
  })
  return [header, divider, ...rows].join('\n')
}

export function formatRunSummary(
  run: PlannerSearchRunMetrics,
  derived: PlannerSearchDerivedMetrics,
): string {
  const totals = run.totals
  const lines = [
    `termination: ${run.terminationStatus}, completed ${run.completedTargetCount} / ${run.planningTargetCount}, expandedStates ${run.expandedStates} / ${run.maxExpandedStates}, depths ${run.depthCount}`,
    `generated successors ${totals.generatedSuccessors} (base ${totals.generatedSuccessorsByLane.base}, bonus ${totals.generatedSuccessorsByLane.bonus}, skill ${totals.generatedSuccessorsByLane.skill}, reserve ${totals.generatedSuccessorsByLane.reserve})`,
    `successors per expanded beam state ${fixed(derived.successorsPerExpandedState)}`,
    `semantic dedup ratio ${percent(derived.semanticDedupRatio)} (${totals.successorsBeforeSemanticDedup} -> ${totals.successorsAfterSemanticDedup})`,
    `beam trim ratio ${percent(derived.beamTrimRatio)} (${totals.successorsAfterSemanticDedup} -> ${totals.statesAfterBeamTrim})`,
    `trace-free projection merge ${percent(derived.traceFreeProjectionMergeRatio)}, progress projection merge ${percent(derived.progressProjectionMergeRatio)}`,
    `max completed ever ${derived.maxCompletedTargetCount}, plateau at ${derived.plateau.plateauCompletedTargetCount} from depth ${derived.plateau.plateauStartDepth ?? '-'} for ${derived.plateau.plateauDepthCount} depths / ${derived.plateau.plateauGeneratedSuccessors} successors`,
    `depths trimming a state that completed more Targets than every kept one: ${derived.depthsTrimmingMoreCompletedStates}`,
    `attempts ${totals.attemptedActions}, rejected ${totals.rejectedAttempts}, pruned dominated skippable ${totals.prunedDominatedSkippableUnits}, conflict-blocked ${totals.conflictBlockedUnits}`,
    `shareable primary attempts ${totals.shareablePrimaryAttempts}, shared successors ${totals.sharedPhysicalActionSuccessors} (${percent(derived.sharedSuccessorRatio)}), extra progressed Entries ${totals.sharedProgressedEntries}`,
    `fast-forwarded units bonus ${totals.fastForwardedUnits.bonus} / skill ${totals.fastForwardedUnits.skill} in ${totals.fastForwardedEntries} (successor, Entry) pairs`,
    `reserve attempts ${totals.reserveAttempts}, reserve successors ${totals.reserveSuccesses}, Target-completing successors ${totals.targetCompletionSuccessors}`,
    `rejection occurrences ${JSON.stringify(run.rejectionOccurrencesByReason)}`,
    `unique conflicts ${JSON.stringify(run.uniqueConflictsByKind)}, conflicts on expanded states ${JSON.stringify(run.expandedStateConflictsByKind)}`,
    `first depth by completed count ${JSON.stringify(run.firstDepthByCompletedTargetCount)}`,
    `phase ms ${derived.phaseMs === null ? '-' : JSON.stringify(Object.fromEntries(Object.entries(derived.phaseMs).map(([key, value]) => [key, Math.round(value)])))}`,
  ]
  return lines.join('\n')
}
