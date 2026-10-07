/**
 * Issue #154 Phase 2-C2.7-B: the E1 population and its authority chain. Research only. Never import from Production, and
 * never from the Phase 2-C2.7-B scheduler / unit side (`plannerGlobalPhase2C27B.ts` never imports this module).
 *
 * The population is B2-C2B1's cohort `E1` (extent-insufficient AND K1-minimal, 11 Targets), re-derived mechanically from the
 * committed B2-C2B1 and B2-C1 RESULTs by the unchanged B2-C2B2A authority parsers. Both facts were derived post hoc from oracle
 * evidence, so the manifest declares `oracleGuidedTargetPopulation = true`. The manifest carries Target IDs only: no oracle
 * Route, stable key, first-compatible context, required extent, ladder rung, expected index or Counter position (§2.4).
 */
import { parsePhase2C26B2C2AB2C1Authority, type Phase2C26B2C2AB2C1Authority } from './plannerGlobalPhase2C26B2C2ATargets'
import {
  parsePhase2C26B2C2B2AB2C2B1Authority,
  phase2c26b2c2b2aPopulation,
  type Phase2C26B2C2B2AB2C2B1Authority,
} from './plannerGlobalPhase2C26B2C2B2ATargets'
import {
  PHASE2C27B_POPULATION_AUTHORITY,
  PHASE2C27B_TARGETS,
  type Phase2C27BTargetManifest,
} from './plannerGlobalPhase2C27B'

export const PHASE2C27B_MANIFEST_PHASE = 'Issue #154 Phase 2-C2.7-B population manifest (B2-C2B1 cohort E1; Target IDs only; oracle-guided population)'

export interface Phase2C27BPopulationAuthorities {
  b2c2b1: Phase2C26B2C2B2AB2C2B1Authority
  b2c1: Phase2C26B2C2AB2C1Authority
}

/**
 * Parses both committed RESULTs as untrusted JSON with the unchanged authority parsers (each fails closed unless it is the
 * registered formal result, its own SHA-256 included) and checks they are the registered Phase 2-C2.7-B population authorities
 * and name one Export.
 */
export function parsePhase2C27BPopulationAuthorities(input: { b2c2b1Json: unknown; b2c2b1Sha256: string; b2c1Json: unknown; b2c1Sha256: string }):
  { valid: boolean; issues: string[]; authorities: Phase2C27BPopulationAuthorities | null } {
  const issues: string[] = []
  if (input.b2c2b1Sha256 !== PHASE2C27B_POPULATION_AUTHORITY.b2c2b1ResultSha256) issues.push('the B2-C2B1 RESULT is not the registered population authority')
  if (input.b2c1Sha256 !== PHASE2C27B_POPULATION_AUTHORITY.b2c1ResultSha256) issues.push('the B2-C1 RESULT is not the registered population authority')
  const b2c2b1 = parsePhase2C26B2C2B2AB2C2B1Authority(input.b2c2b1Json, input.b2c2b1Sha256)
  issues.push(...b2c2b1.issues.map(i => `b2c2b1: ${i}`))
  const b2c1 = parsePhase2C26B2C2AB2C1Authority(input.b2c1Json, input.b2c1Sha256)
  issues.push(...b2c1.issues.map(i => `b2c1: ${i}`))
  if (b2c2b1.authority && b2c1.authority && b2c2b1.authority.exportSha256 !== b2c1.authority.exportSha256) issues.push('the B2-C2B1 and B2-C1 RESULTs name different Exports')
  if (issues.length > 0 || !b2c2b1.authority || !b2c1.authority) return { valid: false, issues, authorities: null }
  return { valid: true, issues: [], authorities: { b2c2b1: b2c2b1.authority, b2c1: b2c1.authority } }
}

/**
 * The E1 population, re-derived from both authorities by the unchanged B2-C2B2A rule (B2-C2B1 E1 = B2-C1 extentInsufficient AND
 * k1Minimal, recovered, never defaultExtent / unreached / k2Minimal / E2): exactly the registered 11 Targets, ascending.
 */
export function phase2c27bPopulation(authorities: Phase2C27BPopulationAuthorities): { valid: boolean; issues: string[]; targetWeaponIds: string[] } {
  const derived = phase2c26b2c2b2aPopulation(authorities.b2c2b1, authorities.b2c1)
  const issues = [...derived.issues]
  if (derived.e1.length !== PHASE2C27B_TARGETS && issues.length === 0) issues.push(`E1 holds ${derived.e1.length} Targets, not ${PHASE2C27B_TARGETS}`)
  const ids = [...derived.e1].sort((a, b) => a < b ? -1 : a > b ? 1 : 0)
  return { valid: issues.length === 0, issues, targetWeaponIds: issues.length === 0 ? ids : [] }
}

/** The population manifest: Target IDs and the provenance of their source, nothing else. */
export function phase2c27bTargetManifest(authorities: Phase2C27BPopulationAuthorities): Phase2C27BTargetManifest {
  const population = phase2c27bPopulation(authorities)
  if (!population.valid) throw new Error(`The E1 population is not valid: ${population.issues.join('; ')}`)
  return { phase: PHASE2C27B_MANIFEST_PHASE, population: 'E1', b2c2b1ResultSha256: authorities.b2c2b1.resultSha256, b2c1ResultSha256: authorities.b2c1.resultSha256,
    exportSha256: authorities.b2c2b1.exportSha256, oracleGuidedTargetPopulation: true, targetWeaponIds: population.targetWeaponIds }
}
