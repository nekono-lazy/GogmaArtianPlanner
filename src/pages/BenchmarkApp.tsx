import { useState } from 'react'
import { Button, Stack } from '@mui/material'
import { CandidateSearchBenchmarkPage } from './CandidateSearchBenchmarkPage'
import { ConstrainedEnumerationBenchmarkPage } from './ConstrainedEnumerationBenchmarkPage'
import { PlannerOrchestrationBenchmarkPage } from './PlannerOrchestrationBenchmarkPage'
import { SkillIdentificationBenchmarkPage } from './SkillIdentificationBenchmarkPage'

type BenchmarkId =
  | 'c8-skill-identification'
  | 'b5-candidate-search'
  | 'b8-constrained-enumeration'
  | 'b8-planner-orchestration'

/**
 * Isolated benchmark shell. The C5-E2C8 Skill Identification harness stays the
 * default so its recorded procedure is unchanged; B5 added the Candidate Search
 * harness, B8-B2 the constrained enumeration harness, and B8-E1 the Planner
 * orchestration harness beside them. None of them is reachable from the normal
 * application, and the existing three are unchanged.
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
      </Stack>
      {benchmark === 'c8-skill-identification' && <SkillIdentificationBenchmarkPage />}
      {benchmark === 'b5-candidate-search' && <CandidateSearchBenchmarkPage />}
      {benchmark === 'b8-constrained-enumeration' && (
        <ConstrainedEnumerationBenchmarkPage />
      )}
      {benchmark === 'b8-planner-orchestration' && (
        <PlannerOrchestrationBenchmarkPage />
      )}
    </Stack>
  )
}
