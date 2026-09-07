import { useState } from 'react'
import { Button, Stack } from '@mui/material'
import { CandidateSearchBenchmarkPage } from './CandidateSearchBenchmarkPage'
import { ConstrainedEnumerationBenchmarkPage } from './ConstrainedEnumerationBenchmarkPage'
import { SkillIdentificationBenchmarkPage } from './SkillIdentificationBenchmarkPage'

type BenchmarkId =
  | 'c8-skill-identification'
  | 'b5-candidate-search'
  | 'b8-constrained-enumeration'

/**
 * Isolated benchmark shell. The C5-E2C8 Skill Identification harness stays the
 * default so its recorded procedure is unchanged; B5 added the Candidate Search
 * harness and B8-B2 adds the constrained enumeration harness beside it. None of
 * them is reachable from the normal application.
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
      </Stack>
      {benchmark === 'c8-skill-identification' && <SkillIdentificationBenchmarkPage />}
      {benchmark === 'b5-candidate-search' && <CandidateSearchBenchmarkPage />}
      {benchmark === 'b8-constrained-enumeration' && (
        <ConstrainedEnumerationBenchmarkPage />
      )}
    </Stack>
  )
}
