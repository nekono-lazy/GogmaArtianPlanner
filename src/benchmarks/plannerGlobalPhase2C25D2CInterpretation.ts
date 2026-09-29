/**
 * Issue #154 Phase 2-C2.5-D2-c: the document-level reading of the formal evidence, Research only. Never import from
 * Production.
 *
 * It is written AFTER the formal run and the post-hoc analysis (it is one of the files the analyzer allows to change
 * after the measured HEAD). Before that it is `null`, and the analyzer writes the evidence without an interpretation.
 * It never changes a measure, a level or the mechanical recommendation; it only reads them.
 */
export const PHASE2C25D2C_INTERPRETATION: null | {
  writtenAfterFormalEvidence: true
  formalConclusions: string[]
  notYetClaimable: string[]
  limitations: string[]
  recommendation: {
    candidate: string
    reduces: string
    mustKeep: string[]
    semanticImpact: { lateDepthRead: string; sameResultLaterPosition: string; absolutePosition: string; amendmentHistory: string; candidateComposition: string
      notice: string; extentAndExhausted: string; prediction: string }
    notImplementedInThisPhase: true
  }
} = null
