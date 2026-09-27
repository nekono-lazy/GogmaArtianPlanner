import { describe, expect, it } from 'vitest'
import * as legacyFacade from '../constrained/constrainedMaterializationErrors'
import * as plannerBarrel from '..'
import {
  ConstrainedMaterializationError,
  PlannerMaterializationError,
} from './plannerMaterializationErrors'

/**
 * Phase 6-B2a moved the materialization error into the shared module without
 * changing its runtime contract: one constructor, reachable under the legacy
 * name, the neutral alias, the legacy import path and the Planner barrel.
 */
describe('materialization error runtime contract (Phase 6-B2a)', () => {
  it('exposes one constructor under the neutral alias and every import path', () => {
    expect(PlannerMaterializationError).toBe(ConstrainedMaterializationError)
    expect(legacyFacade.ConstrainedMaterializationError).toBe(ConstrainedMaterializationError)
    expect(legacyFacade.PlannerMaterializationError).toBe(ConstrainedMaterializationError)
    expect(plannerBarrel.ConstrainedMaterializationError).toBe(ConstrainedMaterializationError)
    expect(plannerBarrel.PlannerMaterializationError).toBe(ConstrainedMaterializationError)
  })

  it('keeps the legacy name, constructor name, code and message', () => {
    const error = new PlannerMaterializationError('generated_entry_id_collision', 'detail')
    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(ConstrainedMaterializationError)
    expect(error).toBeInstanceOf(PlannerMaterializationError)
    expect(error.name).toBe('ConstrainedMaterializationError')
    expect(error.constructor.name).toBe('ConstrainedMaterializationError')
    expect(error.code).toBe('generated_entry_id_collision')
    expect(error.message).toBe('detail')
  })
})
