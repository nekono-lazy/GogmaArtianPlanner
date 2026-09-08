import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { BenchmarkApp } from './BenchmarkApp'

vi.mock('./SkillIdentificationBenchmarkPage', () => ({ SkillIdentificationBenchmarkPage: () => <div>C5 harness</div> }))
vi.mock('./CandidateSearchBenchmarkPage', () => ({ CandidateSearchBenchmarkPage: () => <div>B5 harness</div> }))
vi.mock('./ConstrainedEnumerationBenchmarkPage', () => ({ ConstrainedEnumerationBenchmarkPage: () => <div>B8 enumeration harness</div> }))
vi.mock('./PlannerOrchestrationBenchmarkPage', () => ({ PlannerOrchestrationBenchmarkPage: () => <div>B8 orchestration harness</div> }))
vi.mock('./PlannerWhatIfBenchmarkPage', () => ({ PlannerWhatIfBenchmarkPage: () => <div>B9 harness</div> }))

describe('BenchmarkApp', () => {
  it('keeps C5 as default and adds B9 beside all four existing harnesses', () => {
    render(<BenchmarkApp />)
    expect(screen.getByText('C5 harness')).toBeInTheDocument()
    expect(screen.queryByText('B9 harness')).not.toBeInTheDocument()
    for (const [button, content] of [
      ['B5 Candidate Search', 'B5 harness'],
      ['B8 Constrained Enumeration', 'B8 enumeration harness'],
      ['B8 Planner Orchestration', 'B8 orchestration harness'],
      ['B9 What-if', 'B9 harness'],
      ['C5-E2C8 Skill Identification', 'C5 harness'],
    ]) {
      fireEvent.click(screen.getByRole('button', { name: button }))
      expect(screen.getByText(content)).toBeInTheDocument()
    }
  })
})
