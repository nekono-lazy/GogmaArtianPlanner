import { UnavailableRngEngine } from '../domain/rng/unavailableRngEngine'
import { attachSearchWorker, type CandidateSearchWorkerScope } from './search.worker'

attachSearchWorker(
  self as unknown as CandidateSearchWorkerScope,
  () => new UnavailableRngEngine(),
)
