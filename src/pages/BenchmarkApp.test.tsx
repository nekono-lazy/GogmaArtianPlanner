import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { BenchmarkApp } from './BenchmarkApp'

vi.mock('./SkillIdentificationBenchmarkPage', () => ({ SkillIdentificationBenchmarkPage: () => <div>C5 harness</div> }))
vi.mock('./CandidateSearchBenchmarkPage', () => ({ CandidateSearchBenchmarkPage: () => <div>B5 harness</div> }))
vi.mock('./ConstrainedEnumerationBenchmarkPage', () => ({ ConstrainedEnumerationBenchmarkPage: () => <div>B8 enumeration harness</div> }))
vi.mock('./Issue101ConstrainedResearchBenchmarkPage', () => ({ Issue101ConstrainedResearchBenchmarkPage: () => <div>Issue 101 harness</div> }))
vi.mock('./PlannerAlternativeBenchmarkPage', () => ({ PlannerAlternativeBenchmarkPage: () => <div>Planner Alternative harness</div> }))

describe('BenchmarkApp', () => {
  it('keeps C5 as default and switches between the remaining harnesses', () => {
    render(<BenchmarkApp />)
    expect(screen.getByText('C5 harness')).toBeInTheDocument()
    expect(screen.queryByText('B5 harness')).not.toBeInTheDocument()
    expect(screen.queryByText('Planner Alternative harness')).not.toBeInTheDocument()
    for (const [button, content] of [
      ['B5 Candidate Search', 'B5 harness'],
      ['B8 Constrained Enumeration', 'B8 enumeration harness'],
      ['Issue 101 Constrained Re-search', 'Issue 101 harness'],
      ['Planner Alternative Phase 3', 'Planner Alternative harness'],
      ['C5-E2C8 Skill Identification', 'C5 harness'],
    ]) {
      fireEvent.click(screen.getByRole('button', { name: button }))
      expect(screen.getByText(content)).toBeInTheDocument()
    }
  })

  it('no longer offers the removed Issue 103 Planner Search harness', () => {
    render(<BenchmarkApp />)
    expect(screen.queryByRole('button', { name: 'Issue 103 Planner Search' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('button')).toHaveLength(5)
  })

  it('no longer offers the B8 Planner orchestration or B9 what-if harness (Phase 6-B1)', () => {
    render(<BenchmarkApp />)
    expect(screen.queryByRole('button', { name: 'B8 Planner Orchestration' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'B9 What-if' })).not.toBeInTheDocument()
    // The Search-domain constrained enumeration harness is a different
    // responsibility and stays.
    expect(screen.getByRole('button', { name: 'B8 Constrained Enumeration' })).toBeInTheDocument()
  })
})
