import { useState } from 'react'
import { PlannerWhatIfBenchmarkPage } from './PlannerWhatIfBenchmarkPage'
import { Button, Stack } from '@mui/material'
import { CandidateSearchBenchmarkPage } from './CandidateSearchBenchmarkPage'
import { ConstrainedEnumerationBenchmarkPage } from './ConstrainedEnumerationBenchmarkPage'
import { Issue101ConstrainedResearchBenchmarkPage } from './Issue101ConstrainedResearchBenchmarkPage'
import { PlannerAlternativeBenchmarkPage } from './PlannerAlternativeBenchmarkPage'
import { PlannerOrchestrationBenchmarkPage } from './PlannerOrchestrationBenchmarkPage'
import { SkillIdentificationBenchmarkPage } from './SkillIdentificationBenchmarkPage'

type BenchmarkId =
  | 'c8-skill-identification'
  | 'b5-candidate-search'
  | 'b8-constrained-enumeration'
  | 'b8-planner-orchestration'
  | 'b9-what-if'
  | 'issue101-constrained-research'
  | 'planner-alternative-phase3'

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
 * Planner Alternative Search Phase 3-A adds its Browser Worker harness
 * (`docs/PLANNER_ALTERNATIVE_BROWSER_WORKER_BENCHMARK.md`); C5 stays the default.
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
          variant={benchmark === 'b8-planner-orchestration' ? 'contained' : 'outlined'}
          onClick={() => setBenchmark('b8-planner-orchestration')}
        >
          B8 Planner Orchestration
        </Button>
        <Button
          variant={benchmark === 'b9-what-if' ? 'contained' : 'outlined'}
          onClick={() => setBenchmark('b9-what-if')}
        >
          B9 What-if
        </Button>
        <Button
          variant={benchmark === 'issue101-constrained-research' ? 'contained' : 'outlined'}
          onClick={() => setBenchmark('issue101-constrained-research')}
        >
          Issue 101 Constrained Re-search
        </Button>
        <Button
          variant={benchmark === 'planner-alternative-phase3' ? 'contained' : 'outlined'}
          onClick={() => setBenchmark('planner-alternative-phase3')}
        >
          Planner Alternative Phase 3
        </Button>
      </Stack>
      {benchmark === 'b9-what-if' && <PlannerWhatIfBenchmarkPage />}
      {benchmark === 'c8-skill-identification' && <SkillIdentificationBenchmarkPage />}
      {benchmark === 'b5-candidate-search' && <CandidateSearchBenchmarkPage />}
      {benchmark === 'b8-constrained-enumeration' && (
        <ConstrainedEnumerationBenchmarkPage />
      )}
      {benchmark === 'b8-planner-orchestration' && (
        <PlannerOrchestrationBenchmarkPage />
      )}
      {benchmark === 'issue101-constrained-research' && (
        <Issue101ConstrainedResearchBenchmarkPage />
      )}
      {benchmark === 'planner-alternative-phase3' && <PlannerAlternativeBenchmarkPage />}
    </Stack>
  )
}
