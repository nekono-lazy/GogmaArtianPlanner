/**
 * Issue #154 Phase 2-C2.6-B2-C2B2B: the E1 ∩ L1 population and its authority chain. Research only. Never import from
 * Production, and never from the B2-C2B2B Search side (the Search module never imports this one).
 *
 * The population is B2-C2B1's cohort `E1` (extent-insufficient AND K1-minimal) restricted to the Routes whose first covering
 * ladder rung B2-C2B1 recorded as `L1`. Both facts were derived post hoc from oracle evidence (B2-C1 subgroups, B2-C2B1
 * required extents): `oracleGuidedTargetPopulation = true`. The common L1 extent is B2-C2B1's ladder rung L1:
 * `oracleInformedCommonExtent = true`. This module turns that RESULT into a manifest of Target IDs only; no rank, digest,
 * first-compatible context, required extent, ladder rung or oracle field reaches the Search runner. The analyzer reuses the
 * parsers below after the run.
 */
import { stableStringify } from '../domain/models/hashing'
import type { Phase2C26B2C2AB2C1Authority } from './plannerGlobalPhase2C26B2C2ATargets'
import {
  phase2c26b2c2b2aPopulation,
  PHASE2C26B2C2B2A_REGISTERED_B2C2B1,
  type Phase2C26B2C2B2AB2C2B1Authority,
} from './plannerGlobalPhase2C26B2C2B2ATargets'
import {
  PHASE2C26B2C2B2B_CONTEXT_BUDGET,
  PHASE2C26B2C2B2B_EXTENT,
  PHASE2C26B2C2B2B_TARGET_SOURCE,
  PHASE2C26B2C2B2B_TARGETS,
  type Phase2C26B2C2B2BTargetManifest,
} from './plannerGlobalPhase2C26B2C2B2B'

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)
const same = (a: unknown, b: unknown) => {
  try { return stableStringify(a ?? null) === stableStringify(b ?? null) } catch { return false }
}
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0

/** The B2-C2B1 RESULT is the one B2-C2B2A registered; its L1 rung is this phase's common extent and covers 7 of the 11 E1 Routes. */
export const PHASE2C26B2C2B2B_REGISTERED_B2C2B1 = {
  resultSha256: PHASE2C26B2C2B2B_TARGET_SOURCE.resultSha256,
  l1Rung: PHASE2C26B2C2B2A_REGISTERED_B2C2B1.rungs[1],
  l1Covered: 7,
  e1: PHASE2C26B2C2B2A_REGISTERED_B2C2B1.counts.e1,
} as const

/** One E1 Route row of the B2-C2B1 RESULT as the population needs it (post hoc; the Search never reads it). */
export interface Phase2C26B2C2B2BRouteExtent {
  targetWeaponId: string
  firstLadderRung: string | null
  required: { normal: number | null; gogma: number | null; skill: number | null }
}

/** The `required` extent and the first ladder rung of every E1 Route, read from the B2-C2B1 RESULT as untrusted JSON. */
export function phase2c26b2c2b2bRouteExtents(b2c2b1Json: unknown, e1: readonly string[]): { valid: boolean; issues: string[]; routes: Phase2C26B2C2B2BRouteExtent[] } {
  const issues: string[] = []
  const rows = isObject(b2c2b1Json) && Array.isArray(b2c2b1Json.routes) ? b2c2b1Json.routes : []
  const routes: Phase2C26B2C2B2BRouteExtent[] = []
  const stream = (value: unknown) => value === null || (Number.isSafeInteger(value) && (value as number) >= 0)
  for (const id of e1) {
    const row = rows.find(r => isObject(r) && r.targetWeaponId === id)
    if (!isObject(row) || !isObject(row.required) || !stream(row.required.normal) || !stream(row.required.gogma) || !stream(row.required.skill)
      || !(row.firstLadderRung === null || typeof row.firstLadderRung === 'string')) {
      issues.push(`${id}: the B2-C2B1 Route row has no readable required extent / first ladder rung`); continue
    }
    routes.push({ targetWeaponId: id, firstLadderRung: row.firstLadderRung as string | null,
      required: { normal: row.required.normal as number | null, gogma: row.required.gogma as number | null, skill: row.required.skill as number | null } })
  }
  return { valid: issues.length === 0, issues, routes }
}

/** Whether a required extent fits a ladder extent (a null stream needs nothing). */
export function phase2c26b2c2b2bFits(required: Phase2C26B2C2B2BRouteExtent['required'], extent: { maxNormalAdvance: number; maxGogmaAdvance: number; maxSkillAdvance: number }): boolean {
  return (required.normal ?? 0) <= extent.maxNormalAdvance && (required.gogma ?? 0) <= extent.maxGogmaAdvance && (required.skill ?? 0) <= extent.maxSkillAdvance
}

/**
 * The E1 ∩ L1 population, derived mechanically from the parsed authorities and cross-checked: the B2-C2B2A E1 population
 * (B2-C2B1 E1 = B2-C1 extentInsufficient AND k1Minimal) must be valid; the Routes whose recorded `firstLadderRung` is `L1`
 * form the population; the B2-C2B1 L1 rung must be the registered L1 and this phase's common extent; every population
 * Route's recorded required extent must fit L1 and every other E1 Route's must not (a first rung L1 that disagrees with the
 * recorded extents fails closed); the population size must be the registered 7 (= ladderCoverage L1 7 of 11).
 */
export function phase2c26b2c2b2bPopulation(b2c2b1: Phase2C26B2C2B2AB2C2B1Authority, b2c1: Phase2C26B2C2AB2C1Authority, b2c2b1Json: unknown):
  { valid: boolean; issues: string[]; targetWeaponIds: string[]; l2Needed: string[] } {
  const e1 = phase2c26b2c2b2aPopulation(b2c2b1, b2c1)
  const issues = [...e1.issues]
  if (b2c2b1.resultSha256 !== PHASE2C26B2C2B2B_REGISTERED_B2C2B1.resultSha256) issues.push('the B2-C2B1 RESULT is not the registered one')
  if (!same(PHASE2C26B2C2B2B_REGISTERED_B2C2B1.l1Rung, { id: 'L1', name: 'intermediate', extent: { ...PHASE2C26B2C2B2B_EXTENT } })) issues.push('the registered B2-C2B1 L1 rung is not the common L1 extent')
  const ladder = isObject(b2c2b1Json) && isObject(b2c2b1Json.ladder) && Array.isArray(b2c2b1Json.ladder.rungs) ? b2c2b1Json.ladder.rungs : []
  const l1 = ladder.find(r => isObject(r) && r.id === 'L1')
  if (!isObject(l1) || !same(l1.extent, { ...PHASE2C26B2C2B2B_EXTENT })) issues.push('the B2-C2B1 ladder rung L1 is not the common L1 extent')
  const extents = phase2c26b2c2b2bRouteExtents(b2c2b1Json, b2c2b1.e1)
  issues.push(...extents.issues)
  const population: string[] = []
  const l2Needed: string[] = []
  for (const id of b2c2b1.e1) {
    const authorityRoute = b2c2b1.routes.find(r => r.targetWeaponId === id)
    const route = extents.routes.find(r => r.targetWeaponId === id)
    if (!authorityRoute || !route) { issues.push(`${id}: no B2-C2B1 Route`); continue }
    if (authorityRoute.firstLadderRung !== route.firstLadderRung) issues.push(`${id}: the parsed and raw first ladder rungs disagree`)
    const fitsL1 = phase2c26b2c2b2bFits(route.required, PHASE2C26B2C2B2B_EXTENT)
    if (route.firstLadderRung === 'L1') {
      if (!fitsL1) issues.push(`${id}: first ladder rung L1 but the recorded required extent does not fit L1`)
      population.push(id)
    } else if (route.firstLadderRung === 'L2') {
      if (fitsL1) issues.push(`${id}: first ladder rung L2 but the recorded required extent fits L1`)
      l2Needed.push(id)
    } else issues.push(`${id}: an E1 Route whose first ladder rung is neither L1 nor L2`)
  }
  const coverage = isObject(b2c2b1Json) && isObject(b2c2b1Json.ladderCoverage) && isObject(b2c2b1Json.ladderCoverage.e1) ? b2c2b1Json.ladderCoverage.e1 : {}
  const l1Coverage = Array.isArray(coverage.byRung) ? coverage.byRung.find(r => isObject(r) && r.id === 'L1') : undefined
  if (!isObject(l1Coverage) || l1Coverage.covered !== PHASE2C26B2C2B2B_REGISTERED_B2C2B1.l1Covered || l1Coverage.of !== PHASE2C26B2C2B2B_REGISTERED_B2C2B1.e1) issues.push('ladderCoverage.e1 L1 is not the registered 7 of 11')
  if (population.length !== PHASE2C26B2C2B2B_TARGETS) issues.push(`E1 ∩ L1 holds ${population.length} Targets, not ${PHASE2C26B2C2B2B_TARGETS}`)
  if (population.length + l2Needed.length !== b2c2b1.e1.length) issues.push('E1 is not exactly E1 ∩ L1 plus the L2-needed Routes')
  const valid = issues.length === 0
  return { valid, issues, targetWeaponIds: valid ? [...population].sort(compare) : [], l2Needed: valid ? [...l2Needed].sort(compare) : [] }
}

/**
 * The Target manifest from the parsed authorities: the E1 ∩ L1 Target IDs in ascending order, and nothing of their ranks,
 * digests, required extents, ladder rungs or oracle comparison.
 */
export function phase2c26b2c2b2bTargetManifest(b2c2b1: Phase2C26B2C2B2AB2C2B1Authority, b2c1: Phase2C26B2C2AB2C1Authority, b2c2b1Json: unknown): Phase2C26B2C2B2BTargetManifest {
  const population = phase2c26b2c2b2bPopulation(b2c2b1, b2c1, b2c2b1Json)
  if (!population.valid) throw new Error(`The E1 ∩ L1 population is not valid: ${population.issues.join('; ')}`)
  return { phase: 'Issue #154 Phase 2-C2.6-B2-C2B2B Target manifest (B2-C2B1 cohort E1 ∩ first ladder rung L1; Target IDs only)',
    sourceResultSha256: b2c2b1.resultSha256, population: 'E1_L1', policy: 'P1', contextBudget: PHASE2C26B2C2B2B_CONTEXT_BUDGET, exportSha256: b2c2b1.exportSha256,
    targetWeaponIds: population.targetWeaponIds }
}
