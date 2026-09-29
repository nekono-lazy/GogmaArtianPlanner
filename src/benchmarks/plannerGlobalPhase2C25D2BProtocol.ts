import {
  PHASE2C25B_CANDIDATE_STOP_BOUND,
  PHASE2C25B_CDP_SAMPLE_INTERVAL_MS,
  PHASE2C25B_RUN_BUDGET_MS,
  PHASE2C25B_SNAPSHOT_POLICY,
  isPhase2C25BRequest,
  isPhase2C25BResponse,
  type Phase2C25BRequest,
  type Phase2C25BResponse,
} from './plannerGlobalPhase2C25BProtocol'

/**
 * Issue #154 Global Planner Research Phase 2-C2.5-D2-b: benchmark-only Browser Worker protocol
 * (`docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_PHASE2C25D2B.md`).
 *
 * D2-b re-measures, under the Phase 2-C2.5-B observation and classification boundary, the Search after the D2-a Ideal-only
 * publication. The requests, responses and Search-only run are exactly the Phase 2-C2.5-B ones (the same pre-search
 * context derivation, the same `visitPlannerAlternativeCandidates()` call with a first-Candidate consumer stop, the same
 * sparse instrumented observer); only the wire namespace differs, so a D2-b message, relay line or record can never be
 * mistaken for a Phase 2-C2.5-B one:
 *
 * - every message type is `pg2c25d2b_benchmark_*` on the wire (`pg2c25b_benchmark_*` never crosses the D2-b Worker boundary);
 * - the page relays its lifecycle as `console.info('[pg2c25d2b]', json)`;
 * - the Worker reports the D2-b protocol version in its environment.
 *
 * The translation is a pure prefix rename (the payload is untouched). It is NOT a Production Worker protocol and is
 * never reachable from the normal application.
 */
export const PHASE2C25D2B_PROTOCOL_VERSION = 'planner-global-phase2c25d2b'
export const PHASE2C25D2B_MESSAGE_PREFIX = 'pg2c25d2b_benchmark_'
export const PHASE2C25D2B_RELAY_PREFIX = '[pg2c25d2b]'
const PHASE2C25B_MESSAGE_PREFIX = 'pg2c25b_benchmark_'

/** The D2-b conditions are the Phase 2-C2.5-B ones, unchanged (Production default extent, 1 Candidate, same budgets / snapshots). */
export const PHASE2C25D2B_CANDIDATE_STOP_BOUND = PHASE2C25B_CANDIDATE_STOP_BOUND
export const PHASE2C25D2B_RUN_BUDGET_MS = PHASE2C25B_RUN_BUDGET_MS
export const PHASE2C25D2B_SNAPSHOT_POLICY = PHASE2C25B_SNAPSHOT_POLICY
export const PHASE2C25D2B_CDP_SAMPLE_INTERVAL_MS = PHASE2C25B_CDP_SAMPLE_INTERVAL_MS

type Renamed<T> = T extends { readonly type: `pg2c25b_benchmark_${infer Suffix}` }
  ? Omit<T, 'type'> & { readonly type: `pg2c25d2b_benchmark_${Suffix}` }
  : never

export type Phase2C25D2BRequest = Renamed<Phase2C25BRequest>
export type Phase2C25D2BResponse = Renamed<Phase2C25BResponse>

function renamed<T extends { readonly type: string }>(message: T, from: string, to: string): Record<string, unknown> {
  if (!message.type.startsWith(from)) throw new Error(`Not a ${from}* message: ${message.type}.`)
  return { ...message, type: `${to}${message.type.slice(from.length)}` }
}
function typeOf(value: unknown): string | null {
  return typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string' ? (value as { type: string }).type : null
}

/** Worker side, outgoing: a Phase 2-C2.5-B response on the D2-b wire; the ready environment names the D2-b protocol. */
export function toPhase2C25D2BResponse(response: Phase2C25BResponse): Phase2C25D2BResponse {
  const message = response.type === 'pg2c25b_benchmark_ready'
    ? { ...response, environment: { ...response.environment, protocolVersion: PHASE2C25D2B_PROTOCOL_VERSION } }
    : response
  return renamed(message, PHASE2C25B_MESSAGE_PREFIX, PHASE2C25D2B_MESSAGE_PREFIX) as Phase2C25D2BResponse
}

/** Worker side, incoming: a D2-b request as the Phase 2-C2.5-B controller reads it; anything else is ignored (`null`). */
export function fromPhase2C25D2BRequest(value: unknown): Phase2C25BRequest | null {
  const type = typeOf(value)
  if (type === null || !type.startsWith(PHASE2C25D2B_MESSAGE_PREFIX)) return null
  const request = renamed(value as { type: string }, PHASE2C25D2B_MESSAGE_PREFIX, PHASE2C25B_MESSAGE_PREFIX)
  return isPhase2C25BRequest(request) ? request : null
}

/** Page side, outgoing: a runner request on the D2-b wire. */
export function toPhase2C25D2BRequest(request: Phase2C25BRequest): Phase2C25D2BRequest {
  return renamed(request, PHASE2C25B_MESSAGE_PREFIX, PHASE2C25D2B_MESSAGE_PREFIX) as Phase2C25D2BRequest
}

/** Page side, incoming: a D2-b response as the runner reads it; anything else (a Phase 2-C2.5-B message included) is `null`. */
export function fromPhase2C25D2BResponse(value: unknown): Phase2C25BResponse | null {
  const type = typeOf(value)
  if (type === null || !type.startsWith(PHASE2C25D2B_MESSAGE_PREFIX)) return null
  const response = renamed(value as { type: string }, PHASE2C25D2B_MESSAGE_PREFIX, PHASE2C25B_MESSAGE_PREFIX)
  return isPhase2C25BResponse(response) ? response : null
}
