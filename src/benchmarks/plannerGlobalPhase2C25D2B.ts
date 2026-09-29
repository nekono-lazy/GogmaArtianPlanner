/**
 * Issue #154 Global Planner Research Phase 2-C2.5-D2-b: the Browser workload. Research only. Never import from Production.
 *
 * The workload is the D2-a one, derived the same way: the committed Phase 2-C2.5-A evidence read by the existing
 * `parsePhase2C25CEvidence()` and selected by the existing `selectPhase2C25CWorkload()` rule (every Search-only OOM
 * representative, then the first completed control ending with a first Candidate and the first ending by the extent).
 * No orientation, Target, Entry ID or Counter position is named in code; the evidence only selects the contexts and is
 * the parity reference, and never reaches a Worker.
 */
import type { Phase2C25BEvidenceView, Phase2C25BWorkloadContext } from './plannerGlobalPhase2C25BEvidence'
import { parsePhase2C25CEvidence, selectPhase2C25CWorkload, type Phase2C25CWorkloadRole } from './plannerGlobalPhase2C25C'

export interface Phase2C25D2BWorkloadContext extends Phase2C25BWorkloadContext {
  /** The role the `selectPhase2C25CWorkload()` rule gave this context (the D2-a role). */
  readonly selectionRole: Phase2C25CWorkloadRole
}

/**
 * The D2-a workload over this evidence, in the rule's order (representatives, then the two controls). Every selected
 * context must be a searchable pre-search context of the same evidence with the same Target and digest; anything else
 * fails closed.
 */
export function phase2c25d2bWorkload(view: Phase2C25BEvidenceView, json: unknown): Phase2C25D2BWorkloadContext[] {
  const selected = selectPhase2C25CWorkload(parsePhase2C25CEvidence(json))
  return [...selected.oomRepresentatives, ...selected.controls].map(item => {
    const expected = view.expectedContexts.find(c => c.orientationId === item.orientationId && c.workIndex === item.workIndex)
    if (!expected) throw new Error(`The selected context ${item.orientationId}#${item.workIndex} has no recorded pre-search context.`)
    if (expected.status !== 'searchable' || expected.targetWeaponId !== item.targetWeaponId || expected.contextDigest !== item.contextDigest) {
      throw new Error(`The selected context ${item.orientationId}#${item.workIndex} disagrees with its recorded pre-search context.`)
    }
    return { orientationId: item.orientationId, kind: expected.kind, role: expected.role, workIndex: item.workIndex, targetWeaponId: item.targetWeaponId,
      contextDigest: item.contextDigest, selectionRole: item.role }
  })
}
