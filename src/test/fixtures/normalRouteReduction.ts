import type { BuildCandidate, RestorationBonusSet } from '../../domain/models/publicTypes'
import type { RngEngine } from '../../domain/rng/rngEngine'
import { keepFamilyLayoutKey } from '../../domain/rng/gogmaBonusFamily'
import { bonusStreamBaseKey, createTargetBonusStream } from '../../domain/search/bonusStream'
import { createTargetSkillStream } from '../../domain/search/skillStream'
import { createSearchExecutionContext } from '../../domain/search/searchExecution'
import { createSearchPredictionSupport, type RouteSearchContext } from '../../domain/search/routeSearchShared'
import { bonusStreamInputForSearch, skillStreamInputForSearch } from '../../domain/search/searchStreamInputs'
import { TargetSearchScheduler } from '../../domain/search/targetSearchScheduler'
import { selectCanonicalIdealCandidate } from '../../domain/search/candidateRetention'
import { searchNormalArtianRoutes } from '../../domain/search/normalArtianRouteSearch'
import { searchOwnedNormalArtianRoutes } from '../../domain/search/ownedNormalArtianRouteSearch'
import { searchExistingGogmaRoutes } from '../../domain/search/existingGogmaRouteSearch'
import type { CandidateSearchInput } from '../../domain/search/searchTypes'

/** Frozen pre-#104 per-offset registration oracle for supported predicted fixtures.
 * Deliberately does not call the reduction or classify layouts. No production switch.
 */
function registerUnreducedNormals(context: RouteSearchContext, scheduler: TargetSearchScheduler) {
  const { input, target, engine } = context
  const candidates: BuildCandidate[] = []
  const counter = input.normalCounters[0]
  const start = counter.counter!
  const skillBefore = input.rngState.skillCounter.value!
  const schedule = (offset: number) => {
    if (offset >= input.settings.maxNormalAdvance) return
    scheduler.queue.enqueue({ lowerBound: offset + 2, settle: async () => {
      const skills = context.skillStream.predictAt(skillBefore)
      const skillAfter = engine.advanceSkillCounter(skillBefore, { type: 'convert_normal_to_gogma' })
      const bonuses = engine.predictNormalArtian({ baseSeed: input.rngState.baseSeed.value!,
        weaponTypeId: target.weaponTypeId, elementId: target.elementId, rarity: 8,
        normalCounter: start + offset, master: input.master })
      context.normalPredictions?.set(start + offset, bonuses)
      scheduler.addBase({
        kindResolution: { type: 'fixed', kind: 'normal_artian_to_gogma' },
        sourceOwnedWeaponId: null,
        baseOperations: [
          { type: 'create_normal_artian', weaponTypeId: target.weaponTypeId, rarity: 8,
            count: offset + 1, normalCounterBefore: start,
            normalCounterAfter: engine.advanceNormalCounter(start, { type: 'create_normal_artian', count: offset + 1 }) },
          { type: 'convert_normal_to_gogma', weaponTypeId: target.weaponTypeId,
            skillCounterBefore: skillBefore, skillCounterAfter: skillAfter },
        ],
        conversionSkill: skills,
        zeroBonus: { gogmaAdvance: 0, lastResetDepth: 0, finalBonuses: bonuses,
          restorationBonusScope: 'normal_artian', operations: [], amendmentResults: [] },
        zeroSkill: { ...skills, resetCount: 0, estimatedSkillAdvance: 1, operations: [], amendmentResults: [] },
        startSkillCounter: skillAfter,
        bonusBase: { startGogmaCounter: input.rngState.gogmaCounter.value!, bonuses, restorationBonusScope: 'normal_artian' },
        onCandidate: candidate => candidates.push(candidate),
      })
      schedule(offset + 1)
    } })
  }
  schedule(0)
  return candidates
}

/** Test/measurement-only counters; no runtime diagnostics or Worker protocol fields. */
export async function measureNormalRouteSearch(input: CandidateSearchInput, engine: RngEngine,
  reduced: boolean, exhaustive = false) {
  const metrics = { normalPredictions: 0, normalBases: 0, uniqueLayouts: 0, bonusChannels: 0,
    skillChannels: 0, settledWork: 0, compositions: 0, idealCost: null as number | null,
    tieDrainWork: 0, bonusStates: 0, checkpoints: 0 }
  const layouts = new Set<string>(), bonusChannels = new Set<string>(), skillChannels = new Set<number>()
  const execution = createSearchExecutionContext({ now: () => '2026-09-24T00:00:00.000Z' })
  const checkpoint = execution.checkpoint
  execution.checkpoint = () => { metrics.checkpoints++; return checkpoint() }
  const target = input.targetWeapons[0]
  const support = createSearchPredictionSupport(engine, target, input.master)
  const normalPredictions = new Map<number, RestorationBonusSet>()
  const bonusStream = createTargetBonusStream(target, bonusStreamInputForSearch(input), engine, execution, support)
  const skillStream = createTargetSkillStream(target, skillStreamInputForSearch(input), engine, execution, () => support.skill().supported)
  const readBonus = bonusStream.readDepth.bind(bonusStream)
  bonusStream.readDepth = async (base, depth) => {
    bonusChannels.add(bonusStreamBaseKey(base, input.master))
    const delta = await readBonus(base, depth)
    metrics.bonusStates += delta.solutions.length
    return delta
  }
  const readSkill = skillStream.readDepth.bind(skillStream)
  skillStream.readDepth = (start, depth) => { skillChannels.add(start); return readSkill(start, depth) }
  const context: RouteSearchContext = { input, engine, target, execution, predictionSupport: support,
    normalPredictions, bonusStream, skillStream }
  const scheduler = new TargetSearchScheduler(context)
  const addBase = scheduler.addBase.bind(scheduler)
  scheduler.addBase = base => {
    if (base.baseOperations[0]?.type === 'create_normal_artian') metrics.normalBases++
    const receive = base.onCandidate
    addBase({ ...base, onCandidate: candidate => {
      metrics.compositions++
      metrics.idealCost ??= candidate.estimatedOperationCount
      receive(candidate)
    } })
  }
  const settle = scheduler.queue.settleNext.bind(scheduler.queue)
  scheduler.queue.settleNext = async () => {
    if (metrics.idealCost !== null) metrics.tieDrainWork++
    await settle(); metrics.settledWork++
  }
  const candidates: BuildCandidate[] = []
  const results = []
  if (input.routeFilter !== 'existing_gogma' && reduced) {
    results.push(await searchNormalArtianRoutes(context, scheduler))
  }
  const oracle = !reduced && input.routeFilter !== 'existing_gogma' ? registerUnreducedNormals(context, scheduler) : []
  if (input.routeFilter !== 'existing_gogma') results.push(await searchOwnedNormalArtianRoutes(context, scheduler))
  if (input.routeFilter !== 'normal_artian') results.push(await searchExistingGogmaRoutes(context, scheduler))
  const started = performance.now()
  await scheduler.run(!exhaustive)
  const elapsedMs = performance.now() - started
  candidates.push(...oracle, ...results.flatMap(result => result.candidates))
  for (const bonuses of normalPredictions.values()) layouts.add(keepFamilyLayoutKey(bonuses, input.master))
  metrics.normalPredictions = normalPredictions.size
  metrics.uniqueLayouts = layouts.size
  metrics.bonusChannels = bonusChannels.size
  metrics.skillChannels = skillChannels.size
  return { candidate: selectCanonicalIdealCandidate(candidates, target.preferredOwnedWeaponId), metrics, elapsedMs }
}
