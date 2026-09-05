import { useState } from 'react'
import { Button, Stack } from '@mui/material'
import { CandidateSearchBenchmarkPage } from './CandidateSearchBenchmarkPage'
import { SkillIdentificationBenchmarkPage } from './SkillIdentificationBenchmarkPage'

type BenchmarkId = 'c8-skill-identification' | 'b5-candidate-search'

/**
 * Isolated benchmark shell. The C5-E2C8 Skill Identification harness stays the
 * default so its recorded procedure is unchanged; B5 adds the Candidate Search
 * harness beside it. Neither is reachable from the normal application.
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
      </Stack>
      {benchmark === 'c8-skill-identification' ? (
        <SkillIdentificationBenchmarkPage />
      ) : (
        <CandidateSearchBenchmarkPage />
      )}
    </Stack>
  )
}
