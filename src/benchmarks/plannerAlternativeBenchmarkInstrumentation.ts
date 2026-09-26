import type {
  PlannerAlternativeKernelResult,
  PlannerDependencies,
} from '../domain/planner'
import type { RngEngine } from '../domain/rng/rngEngine'
import type { PlannerAlternativeSearchInstrumentation } from '../domain/search'
import type { ReservedGogmaDepthObservation } from '../domain/search/bonusStream'
import type { ReservedSkillDepthObservation } from '../domain/search/skillStream'
import { summarizeIssue101Route } from './issue101RouteSummary'
import type {
  PlannerAlternativeGogmaDepthAggregate,
  PlannerAlternativeGogmaStreamAggregate,
  PlannerAlternativeKernelResultSummary,
  PlannerAlternativePredictionCounts,
  PlannerAlternativeSkillDepthAggregate,
  PlannerAlternativeSkillStreamAggregate,
} from './plannerAlternativeBenchmarkProtocol'

/**
 * Benchmark-only observers of the Planner Alternative Phase 3 harness. None of
 * them changes a value: the counting Engine returns the wrapped Engine's own
 * result, the stream aggregator only adds numbers, and the Kernel clock
 * observer returns the Production clock's own value.
 */

export interface CountingRngEngine {
  readonly engine: RngEngine
  counts(): PlannerAlternativePredictionCounts
}

/**
 * Wraps an Engine and counts its prediction calls. Every call is forwarded
 * once, with the same input, and its own result is returned: no prediction is
 * added, skipped or cached here.
 */
export function createCountingRngEngine(engine: RngEngine): CountingRngEngine {
  let predictNormalArtian = 0
  let predictSkills = 0
  let resetBonuses = 0
  let keepBonuses = 0
  const counted: RngEngine = {
    version: engine.version,
    capabilities: engine.capabilities,
    getPredictionSupport: (input) => engine.getPredictionSupport(input),
    normalizeSeed: (input) => engine.normalizeSeed(input),
    predictGogmaBonus: (input) => {
      if (input.operation.type === 'reset_bonuses') resetBonuses += 1
      else keepBonuses += 1
      return engine.predictGogmaBonus(input)
    },
    predictSkills: (input) => {
      predictSkills += 1
      return engine.predictSkills(input)
    },
    predictNormalArtian: (input) => {
      predictNormalArtian += 1
      return engine.predictNormalArtian(input)
    },
    advanceGogmaCounter: (current, operation) => engine.advanceGogmaCounter(current, operation),
    advanceSkillCounter: (current, operation) => engine.advanceSkillCounter(current, operation),
    advanceNormalCounter: (current, operation) => engine.advanceNormalCounter(current, operation),
  }
  return {
    engine: counted,
    counts: () => ({ predictNormalArtian, predictSkills, resetBonuses, keepBonuses }),
  }
}

interface MutableSkillDepth {
  streams: Set<number>
  transitions: number
  states: number
  absolutePositions: number
  maxStatesPerStream: number
}

interface MutableGogmaDepth {
  streams: Set<number>
  generatedStates: number
  frontierStates: number
  absolutePositions: number
  familyLayouts: number
  maxGeneratedStatesPerStream: number
  maxFamilyLayoutsPerStream: number
}

export interface PlannerAlternativeSearchObserver {
  /** The Search instrumentation to pass as an execution option. */
  readonly instrumentation: PlannerAlternativeSearchInstrumentation
  settledWorkItems(): number
  skill(): PlannerAlternativeSkillStreamAggregate
  gogma(): PlannerAlternativeGogmaStreamAggregate
}

/**
 * Aggregates the Search instrumentation per depth. Each callback does a few
 * additions, so the observer stays O(1) per event; nothing per state is kept.
 */
export function createPlannerAlternativeSearchObserver(): PlannerAlternativeSearchObserver {
  let settled = 0
  const skillDepths = new Map<number, MutableSkillDepth>()
  const gogmaDepths = new Map<number, MutableGogmaDepth>()
  const skillStreams = new Set<number>()
  const gogmaStreams = new Set<number>()
  const onSkill = (event: ReservedSkillDepthObservation) => {
    skillStreams.add(event.streamIndex)
    let depth = skillDepths.get(event.depth)
    if (!depth) {
      depth = { streams: new Set(), transitions: 0, states: 0, absolutePositions: 0, maxStatesPerStream: 0 }
      skillDepths.set(event.depth, depth)
    }
    depth.streams.add(event.streamIndex)
    depth.transitions += event.transitions
    depth.states += event.states
    depth.absolutePositions += event.absolutePositions
    depth.maxStatesPerStream = Math.max(depth.maxStatesPerStream, event.states)
  }
  const onGogma = (event: ReservedGogmaDepthObservation) => {
    gogmaStreams.add(event.streamIndex)
    let depth = gogmaDepths.get(event.depth)
    if (!depth) {
      depth = {
        streams: new Set(), generatedStates: 0, frontierStates: 0, absolutePositions: 0,
        familyLayouts: 0, maxGeneratedStatesPerStream: 0, maxFamilyLayoutsPerStream: 0,
      }
      gogmaDepths.set(event.depth, depth)
    }
    depth.streams.add(event.streamIndex)
    depth.generatedStates += event.generatedStates
    depth.frontierStates += event.frontierStates
    depth.absolutePositions += event.absolutePositions
    depth.familyLayouts += event.familyLayouts
    depth.maxGeneratedStatesPerStream = Math.max(depth.maxGeneratedStatesPerStream, event.generatedStates)
    depth.maxFamilyLayoutsPerStream = Math.max(depth.maxFamilyLayoutsPerStream, event.familyLayouts)
  }
  return {
    instrumentation: {
      onWorkSettled: () => {
        settled += 1
      },
      onSkillReservedDepth: onSkill,
      onGogmaReservedDepth: onGogma,
    },
    settledWorkItems: () => settled,
    skill: () => {
      const depths: PlannerAlternativeSkillDepthAggregate[] = [...skillDepths.entries()]
        .sort(([left], [right]) => left - right)
        .map(([depth, value]) => ({
          depth,
          streams: value.streams.size,
          transitions: value.transitions,
          states: value.states,
          absolutePositions: value.absolutePositions,
          maxStatesPerStream: value.maxStatesPerStream,
        }))
      return {
        streams: skillStreams.size,
        totalStates: depths.reduce((sum, { states }) => sum + states, 0),
        totalTransitions: depths.reduce((sum, { transitions }) => sum + transitions, 0),
        maxDepth: depths.at(-1)?.depth ?? 0,
        depths,
      }
    },
    gogma: () => {
      const depths: PlannerAlternativeGogmaDepthAggregate[] = [...gogmaDepths.entries()]
        .sort(([left], [right]) => left - right)
        .map(([depth, value]) => ({
          depth,
          streams: value.streams.size,
          generatedStates: value.generatedStates,
          frontierStates: value.frontierStates,
          absolutePositions: value.absolutePositions,
          familyLayouts: value.familyLayouts,
          maxGeneratedStatesPerStream: value.maxGeneratedStatesPerStream,
          maxFamilyLayoutsPerStream: value.maxFamilyLayoutsPerStream,
        }))
      return {
        streams: gogmaStreams.size,
        totalGeneratedStates: depths.reduce((sum, { generatedStates }) => sum + generatedStates, 0),
        totalFrontierStates: depths.reduce((sum, { frontierStates }) => sum + frontierStates, 0),
        maxDepth: depths.at(-1)?.depth ?? 0,
        depths,
      }
    },
  }
}

export interface ObservedKernelDependencies {
  readonly dependencies: PlannerDependencies
  /** Offset of the first clock read (the first Candidate trial's materialization). */
  firstClockReadMs(): number | null
  /** Clock reads not followed by a ProductionPlan ID: Candidate materializations. */
  materializations(): number
}

/**
 * Wraps the Production Planner dependencies of a Kernel run so its first
 * Candidate trial can be timed. The Kernel reads no clock before its first
 * materialization (preparation is `preparePlannerWhatIfScenario()`, which
 * reads none); a materialization reads the clock once, and Plan generation
 * reads it once immediately before `productionPlanId()`. Every returned value
 * is the Production dependency's own.
 */
export function observePlannerAlternativeKernelDependencies(
  dependencies: PlannerDependencies,
  now: () => number,
  onFirstClockRead: () => void = () => undefined,
): ObservedKernelDependencies {
  let reads = 0
  let planReads = 0
  let lastReadIsPlan = false
  let first: number | null = null
  return {
    dependencies: {
      ...dependencies,
      clock: {
        now: () => {
          reads += 1
          lastReadIsPlan = false
          if (first === null) {
            first = now()
            onFirstClockRead()
          }
          return dependencies.clock.now()
        },
      },
      idFactory: {
        ...dependencies.idFactory,
        productionPlanId: () => {
          if (reads > 0 && !lastReadIsPlan) {
            planReads += 1
            lastReadIsPlan = true
          }
          return dependencies.idFactory.productionPlanId()
        },
      },
    },
    firstClockReadMs: () => first,
    materializations: () => reads - planReads,
  }
}

/** A compact, Plan-free summary of one Kernel result. */
export function summarizePlannerAlternativeKernelResult(
  result: PlannerAlternativeKernelResult,
): PlannerAlternativeKernelResultSummary {
  if (result.status !== 'completed') {
    const detail = 'detail' in result && typeof result.detail === 'string' ? result.detail : null
    return { status: 'failed', kernelStatus: result.status, detail }
  }
  const targets = result.targets.map((target) => {
    const found = target.outcome.status === 'found' ? target.outcome : null
    return {
      targetWeaponId: target.targetWeaponId,
      outcome: target.outcome.status,
      trials: target.trials.length,
      trialResults: target.trials.map(({ result: trial }) =>
        trial.status === 'found' ? `found:${trial.generatedSelected}` : `rejected:${trial.reason}`),
      search: target.search === null ? null : { ...target.search },
      found: found === null ? null : {
        route: summarizeIssue101Route(found.candidate.route, found.candidate),
        generatedSelected: found.generatedSelected,
        trialTerminationStatus: found.trialResult.termination.status,
        trialConflictCount: found.trialResult.conflicts.length,
        planStepCount: found.trialResult.plan?.steps.length ?? null,
      },
    }
  })
  return {
    status: 'completed',
    plannerRerunsUsed: result.plannerRerunsUsed,
    candidateTrials: targets.reduce((sum, { trials }) => sum + trials, 0),
    targets,
  }
}
