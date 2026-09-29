import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { BenchmarkApp } from './BenchmarkApp'

vi.mock('./SkillIdentificationBenchmarkPage', () => ({ SkillIdentificationBenchmarkPage: () => <div>C5 harness</div> }))
vi.mock('./CandidateSearchBenchmarkPage', () => ({ CandidateSearchBenchmarkPage: () => <div>B5 harness</div> }))
vi.mock('./ConstrainedEnumerationBenchmarkPage', () => ({ ConstrainedEnumerationBenchmarkPage: () => <div>B8 enumeration harness</div> }))
vi.mock('./PlannerAlternativeBenchmarkPage', () => ({ PlannerAlternativeBenchmarkPage: () => <div>Planner Alternative harness</div> }))
vi.mock('./PlannerGlobalPhase2C25BBenchmarkPage', () => ({ PlannerGlobalPhase2C25BBenchmarkPage: () => <div>Phase 2-C2.5-B harness</div> }))
vi.mock('./PlannerGlobalPhase2C25D2BBenchmarkPage', () => ({ PlannerGlobalPhase2C25D2BBenchmarkPage: () => <div>Phase 2-C2.5-D2-b harness</div> }))

describe('BenchmarkApp', () => {
  it('keeps C5 as default and switches between the remaining harnesses', () => {
    render(<BenchmarkApp />)
    expect(screen.getByText('C5 harness')).toBeInTheDocument()
    expect(screen.queryByText('B5 harness')).not.toBeInTheDocument()
    expect(screen.queryByText('Planner Alternative harness')).not.toBeInTheDocument()
    for (const [button, content] of [
      ['B5 Candidate Search', 'B5 harness'],
      ['B8 Constrained Enumeration', 'B8 enumeration harness'],
      ['Planner Alternative Phase 3', 'Planner Alternative harness'],
      ['Global Planner Phase 2-C2.5-B', 'Phase 2-C2.5-B harness'],
      ['Global Planner Phase 2-C2.5-D2-b', 'Phase 2-C2.5-D2-b harness'],
      ['C5-E2C8 Skill Identification', 'C5 harness'],
    ]) {
      fireEvent.click(screen.getByRole('button', { name: button }))
      expect(screen.getByText(content)).toBeInTheDocument()
    }
  })

  it('no longer offers the removed Issue 103 Planner Search harness', () => {
    render(<BenchmarkApp />)
    expect(screen.queryByRole('button', { name: 'Issue 103 Planner Search' })).not.toBeInTheDocument()
    // Issue #154 Phase 2-A added the Global Planner Browser Worker harness as the fifth tab,
    // Phase 2-C2.5-B its Search-only reproduction harness as the sixth, and Phase 2-C2.5-D2-b its
    // post-D2-a Browser re-measurement harness as the seventh.
    expect(screen.getAllByRole('button')).toHaveLength(7)
    expect(screen.getByRole('button', { name: 'Global Planner Phase 2-A' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Global Planner Phase 2-C2.5-B' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Global Planner Phase 2-C2.5-D2-b' })).toBeInTheDocument()
  })

  it('no longer offers the B8 Planner orchestration or B9 what-if harness (Phase 6-B1)', () => {
    render(<BenchmarkApp />)
    expect(screen.queryByRole('button', { name: 'B8 Planner Orchestration' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'B9 What-if' })).not.toBeInTheDocument()
    // The Search-domain constrained enumeration harness is a different
    // responsibility and stays.
    expect(screen.getByRole('button', { name: 'B8 Constrained Enumeration' })).toBeInTheDocument()
  })

  it('no longer offers the Issue #101 constrained re-search harness (Phase 6-B2b)', () => {
    render(<BenchmarkApp />)
    expect(screen.queryByRole('button', { name: 'Issue 101 Constrained Re-search' })).not.toBeInTheDocument()
    // The Planner Alternative harness keeps measuring the Issue #101 real case.
    expect(screen.getByRole('button', { name: 'Planner Alternative Phase 3' })).toBeInTheDocument()
  })
})
