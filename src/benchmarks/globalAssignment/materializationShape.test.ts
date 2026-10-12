import { describe, expect, it } from 'vitest'
import type { ExpectedRouteShape } from './coverageTypes'
import { plannerStartOrigins, shapeOwnPositions, shapeSearchExtent } from './materializationShape'
import { scenarioConversionFallback, scenarioHeldCrossing, scenarioSkillDependency } from './materializationTestFixture'
import { GlobalAssignmentMaterializationError } from './materializationTypes'

/*
 * Issue #154 Global Assignment Phase D-0A (design 8.3 / 9.1 / 9.2): a shape's own positions per stream, its
 * continuity, and the extent from the Planner-start or the projected origins.
 */

function invalid(run: () => unknown): GlobalAssignmentMaterializationError {
  try {
    run()
  } catch (error) {
    if (error instanceof GlobalAssignmentMaterializationError) return error
    throw error
  }
  throw new Error('Expected a GlobalAssignmentMaterializationError.')
}

describe('Phase D-0A shape analysis (design 8.3 / 9.2)', () => {
  it('reads the own positions per stream and calls a shape continuous only without a held gap', async () => {
    const crossing = await scenarioHeldCrossing()
    expect(shapeOwnPositions(crossing.shape.a!)).toEqual({
      skill: { runs: [], first: null, last: null },
      gogma: { runs: [{ from: 12, to: 12 }], first: 12, last: 12 },
      normal: { runs: [], first: null, last: null },
      continuous: true,
    })
    // c owns 10 (chain), 11, 13 (chain), 14 around a's 12.
    expect(shapeOwnPositions(crossing.shape.c!).gogma).toEqual({ runs: [{ from: 10, to: 11 }, { from: 13, to: 14 }], first: 10, last: 14 })
    expect(shapeOwnPositions(crossing.shape.c!).continuous).toBe(false)
    const conversion = await scenarioConversionFallback()
    expect(shapeOwnPositions(conversion.shape.b!)).toEqual({
      skill: { runs: [{ from: 7, to: 7 }], first: 7, last: 7 },
      gogma: { runs: [{ from: 10, to: 11 }], first: 10, last: 11 },
      normal: { runs: [{ from: 4, to: 5 }], first: 4, last: 5 },
      continuous: true,
    })
    const dependency = await scenarioSkillDependency()
    expect(shapeOwnPositions(dependency.shape.a!).skill).toEqual({ runs: [{ from: 7, to: 8 }], first: 7, last: 8 })
    expect(shapeOwnPositions(dependency.shape.b!).skill).toEqual({ runs: [{ from: 9, to: 9 }], first: 9, last: 9 })
  }, 30_000)

  it('counts the extent to the last required positions from the Planner-start or the projected origins', async () => {
    const conversion = await scenarioConversionFallback()
    const b = conversion.shape.b!
    const start = plannerStartOrigins(b, conversion.scene.table)
    expect(start).toEqual({ skill: 7, gogma: 10, normal: 4 })
    // Conversion window origin .. origin + M: the final Skill 7 is the origin itself, so M stays 1.
    expect(shapeSearchExtent(b, start)).toEqual({ maxNormalAdvance: 2, maxGogmaAdvance: 2, maxSkillAdvance: 1 })
    expect(shapeSearchExtent(b, { skill: 7, gogma: 11, normal: 5 })).toEqual({ maxNormalAdvance: 1, maxGogmaAdvance: 1, maxSkillAdvance: 1 })
    const dependency = await scenarioSkillDependency()
    const a = dependency.shape.a!
    // An existing Gogma's Reset Skills window is origin .. origin + M - 1: Reset Skills at 8 from 7 needs M = 2.
    expect(shapeSearchExtent(a, plannerStartOrigins(a, dependency.scene.table))).toEqual({ maxNormalAdvance: 1, maxGogmaAdvance: 1, maxSkillAdvance: 2 })
    expect(shapeSearchExtent(dependency.shape.b!, plannerStartOrigins(dependency.shape.b!, dependency.scene.table))).toEqual({ maxNormalAdvance: 1, maxGogmaAdvance: 2, maxSkillAdvance: 2 })
  }, 30_000)

  it('fails closed on a shape whose own positions are not a valid partition or whose extent is not positive', async () => {
    const { shape } = await scenarioHeldCrossing()
    const edit = (change: (value: ExpectedRouteShape) => void) => {
      const copy = structuredClone(shape.c!)
      change(copy)
      return copy
    }
    const overlapping = edit(value => { value.predicted.chainSegments.push({ stream: { kind: 'gogma' }, from: 11, to: 11, operation: 'reset_bonuses' }) })
    expect(invalid(() => shapeOwnPositions(overlapping)).code).toBe('invalid_shape')
    const trailing = edit(value => { value.predicted.chainSegments.push({ stream: { kind: 'gogma' }, from: 15, to: 15, operation: 'keep_bonuses' }) })
    expect(invalid(() => shapeOwnPositions(trailing)).code).toBe('invalid_shape')
    const foreignNormal = edit(value => { value.predicted.chainSegments.push({ stream: { kind: 'normal', counterId: 'weapon.fixture.a:8' }, from: 4, to: 4, operation: 'create_normal_artian' }) })
    expect(invalid(() => shapeOwnPositions(foreignNormal)).code).toBe('invalid_shape')
    expect(invalid(() => shapeSearchExtent(shape.c!, { skill: 7, gogma: 15, normal: null })).code).toBe('invalid_shape')
  }, 30_000)
})
