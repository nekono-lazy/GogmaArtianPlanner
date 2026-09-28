import { useState } from 'react'
import { Button, Stack } from '@mui/material'
import { CandidateSearchBenchmarkPage } from './CandidateSearchBenchmarkPage'
import { ConstrainedEnumerationBenchmarkPage } from './ConstrainedEnumerationBenchmarkPage'
import { PlannerAlternativeBenchmarkPage } from './PlannerAlternativeBenchmarkPage'
import { PlannerGlobalBrowserBenchmarkPage } from './PlannerGlobalBrowserBenchmarkPage'
import { PlannerGlobalPhase2C25BBenchmarkPage } from './PlannerGlobalPhase2C25BBenchmarkPage'
import { SkillIdentificationBenchmarkPage } from './SkillIdentificationBenchmarkPage'

type BenchmarkId =
  | 'c8-skill-identification'
  | 'b5-candidate-search'
  | 'b8-constrained-enumeration'
  | 'planner-alternative-phase3'
  | 'planner-global-phase2a'
  | 'planner-global-phase2c25b'

/**
 * Isolated benchmark shell. The C5-E2C8 Skill Identification harness stays the
 * default so its recorded procedure is unchanged; B5 added the Candidate Search
 * harness, B8-B2 the constrained enumeration harness, and B8-E1 the Planner
 * orchestration harness beside them. None of them is reachable from the normal
 * application. B9 adds the what-if harness; the existing four stay unchanged.
 * Issue #103 Phase D-2b removed its Planner search instrumentation harness once
 * the Planner redesign was validated; its measurements stay recorded in
 * `docs/ISSUE_103_PLANNER_SEARCH_INSTRUMENTATION.md` and
 * `docs/ISSUE_103_SCHEDULER_PARITY_BENCHMARK.md`.
 * Issue #101 adds its constrained re-search harness beside the others; none of
 * the existing harnesses changes.
 * Issue #154 Global Planner Research Phase 2-A adds its Browser Worker harness
 * (`docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_PHASE2A.md`); C5 stays the default.
 * Planner Alternative Search Phase 3-A adds its Browser Worker harness
 * (`docs/PLANNER_ALTERNATIVE_BROWSER_WORKER_BENCHMARK.md`); C5 stays the default.
 * Planner Alternative Phase 6-B1 removed the B8 Planner orchestration and B9
 * what-if harnesses together with the legacy Production Planner Worker request
 * kinds they measured (`docs/PLANNER_SPEC.md` 9.2.19.16); their measurements
 * stay recorded in `docs/B8_PLANNER_ORCHESTRATION_BROWSER_WORKER_BENCHMARK.md`
 * and `docs/B9_PLANNER_WHAT_IF_BROWSER_WORKER_BENCHMARK.md`.
 * Phase 6-B2b removed the Issue #101 constrained re-search harness together
 * with the legacy B8 / B9 Planner Domain it measured; its measurements stay
 * recorded in `docs/ISSUE_101_CONSTRAINED_RESEARCH_BENCHMARK.md`, and the
 * Issue #101 real case lives on as a Planner Alternative fixture. The B8
 * constrained enumeration harness is a Search Domain benchmark and stays.
 * Issue #154 Phase 2-C2.5-B adds its Search-only Browser Worker reproduction
 * harness (`docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_PHASE2C25B.md`); C5 stays
 * the default and the existing harnesses are unchanged.
 */
export function BenchmarkApp() {
  const [benchmark, setBenchmark] = useState<BenchmarkId>('c8-skill-identification')
  return (
    <Stack spacing={2} sx={{ p: 2 }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
        <Button
          variant={benchmark === 'c8-skill-identification' ? 'contained' : 'outlined'}
          onClick={() => setBenchmark('c8-skill-identification')}
        >
          C5-E2C8 Skill Identification
        </Button>
        <Button
          variant={benchmark === 'b5-candidate-search' ? 'contained' : 'outlined'}
          onClick={() => setBenchmark('b5-candidate-search')}
        >
          B5 Candidate Search
        </Button>
        <Button
          variant={benchmark === 'b8-constrained-enumeration' ? 'contained' : 'outlined'}
          onClick={() => setBenchmark('b8-constrained-enumeration')}
        >
          B8 Constrained Enumeration
        </Button>
        <Button
          variant={benchmark === 'planner-alternative-phase3' ? 'contained' : 'outlined'}
          onClick={() => setBenchmark('planner-alternative-phase3')}
        >
          Planner Alternative Phase 3
        </Button>
        <Button
          variant={benchmark === 'planner-global-phase2a' ? 'contained' : 'outlined'}
          onClick={() => setBenchmark('planner-global-phase2a')}
        >
          Global Planner Phase 2-A
        </Button>
        <Button
          variant={benchmark === 'planner-global-phase2c25b' ? 'contained' : 'outlined'}
          onClick={() => setBenchmark('planner-global-phase2c25b')}
        >
          Global Planner Phase 2-C2.5-B
        </Button>
      </Stack>
      {benchmark === 'c8-skill-identification' && <SkillIdentificationBenchmarkPage />}
      {benchmark === 'b5-candidate-search' && <CandidateSearchBenchmarkPage />}
      {benchmark === 'b8-constrained-enumeration' && (
        <ConstrainedEnumerationBenchmarkPage />
      )}
      {benchmark === 'planner-alternative-phase3' && <PlannerAlternativeBenchmarkPage />}
      {benchmark === 'planner-global-phase2a' && <PlannerGlobalBrowserBenchmarkPage />}
      {benchmark === 'planner-global-phase2c25b' && <PlannerGlobalPhase2C25BBenchmarkPage />}
    </Stack>
  )
}
