import type {
  DomainValidationIssue,
  ISODateTimeString,
  RngState,
} from '../../domain/models/publicTypes'
import { createInitialRngState } from '../../domain/models/factories'
import { validateRngState } from '../../domain/models/validation'
import { productionRngEngine } from '../../domain/rng/production/productionRngRuntime'
import type { RngEngine } from '../../domain/rng/rngEngine'
import { rngStateRepository } from '../../db/repositories'

export interface IdentificationAdoptionInput {
  readonly baseSeed: string
  readonly startingSkillCounter: number
  readonly startingGogmaCounter: number
}

export interface IdentificationAdoptionRepository {
  ensureInitialRngState(): Promise<RngState>
  putRngState(state: RngState): Promise<RngState>
}

export interface IdentificationAdoptionClock {
  now(): ISODateTimeString
}

export interface IdentificationAdoptionDependencies {
  readonly repository: IdentificationAdoptionRepository
  readonly seedNormalizer: Pick<RngEngine, 'normalizeSeed'>
  readonly clock: IdentificationAdoptionClock
}

export type IdentificationAdoptionErrorCode =
  | 'invalid_input'
  | 'persistent_state_unavailable'
  | 'invalid_persistent_state'

export class IdentificationAdoptionError extends Error {
  readonly code: IdentificationAdoptionErrorCode
  readonly validationIssues: readonly DomainValidationIssue[]

  constructor(
    code: IdentificationAdoptionErrorCode,
    message: string,
    options?: {
      cause?: unknown
      validationIssues?: readonly DomainValidationIssue[]
    },
  ) {
    super(message, { cause: options?.cause })
    this.name = 'IdentificationAdoptionError'
    this.code = code
    this.validationIssues = options?.validationIssues ?? []
  }
}

const INPUT_VALIDATION_TIME = '1970-01-01T00:00:00.000Z'

const defaultDependencies: IdentificationAdoptionDependencies = {
  repository: {
    ensureInitialRngState: () => rngStateRepository.ensureInitialRngState(),
    putRngState: (state) => rngStateRepository.putRngState(state),
  },
  seedNormalizer: productionRngEngine,
  clock: { now: () => new Date().toISOString() },
}

function normalizeAdoptionSeed(
  input: string,
  seedNormalizer: Pick<RngEngine, 'normalizeSeed'>,
): string {
  try {
    return seedNormalizer.normalizeSeed(input)
  } catch (error: unknown) {
    if (!(error instanceof RangeError)) throw error
    throw new IdentificationAdoptionError(
      'invalid_input',
      'Identification Base Seed is invalid.',
      { cause: error },
    )
  }
}

function assertValidAdoptionInput(
  input: IdentificationAdoptionInput,
  canonicalBaseSeed: string,
): void {
  const validationState: RngState = {
    ...createInitialRngState(INPUT_VALIDATION_TIME),
    baseSeed: {
      value: canonicalBaseSeed,
      isConfirmed: true,
      source: 'observation',
    },
    skillCounter: {
      value: input.startingSkillCounter,
      isConfirmed: true,
      source: 'observation',
    },
    gogmaCounter: {
      value: input.startingGogmaCounter,
      isConfirmed: true,
      source: 'observation',
    },
  }
  const validation = validateRngState(validationState)
  if (!validation.isValid) {
    throw new IdentificationAdoptionError(
      'invalid_input',
      'Identification adoption input failed Domain validation.',
      { validationIssues: validation.issues },
    )
  }
}

function assertValidPersistentState(state: RngState): void {
  const validation = validateRngState(state)
  if (!validation.isValid) {
    throw new IdentificationAdoptionError(
      'invalid_persistent_state',
      'The persisted RngState failed Domain validation.',
      { validationIssues: validation.issues },
    )
  }
}

/**
 * Adopts reviewed exact Identification values only. Unique/non-truncated result
 * selection and confirmation that the game was restored belong to the Wizard
 * Coordinator. Observation counts never advance the starting counters here.
 */
export class IdentificationAdoptionService {
  private readonly dependencies: IdentificationAdoptionDependencies

  constructor(
    dependencies: IdentificationAdoptionDependencies = defaultDependencies,
  ) {
    this.dependencies = dependencies
  }

  async adopt(input: IdentificationAdoptionInput): Promise<RngState> {
    const canonicalBaseSeed = normalizeAdoptionSeed(
      input.baseSeed,
      this.dependencies.seedNormalizer,
    )
    assertValidAdoptionInput(input, canonicalBaseSeed)

    const current = await this.dependencies.repository.ensureInitialRngState()
    if (!current) {
      throw new IdentificationAdoptionError(
        'persistent_state_unavailable',
        'The current RngState is unavailable.',
      )
    }
    assertValidPersistentState(current)

    const next: RngState = {
      ...current,
      baseSeed: {
        value: canonicalBaseSeed,
        isConfirmed: true,
        source: 'observation',
      },
      skillCounter: {
        value: input.startingSkillCounter,
        isConfirmed: true,
        source: 'observation',
      },
      gogmaCounter: {
        value: input.startingGogmaCounter,
        isConfirmed: true,
        source: 'observation',
      },
      updatedAt: this.dependencies.clock.now(),
    }
    assertValidPersistentState(next)
    return this.dependencies.repository.putRngState(next)
  }
}

export const identificationAdoptionService = new IdentificationAdoptionService()
