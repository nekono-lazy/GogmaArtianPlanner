import { ProductionRngEngine } from '../domain/rng/production/productionRngEngine'
import {
  attachConstrainedEnumerationBenchmarkWorker,
  type ConstrainedEnumerationBenchmarkWorkerScope,
} from './constrainedEnumeration.worker.benchmark'

/**
 * B8-B2 benchmark-only Worker entry.
 *
 * It composes an unmodified `ProductionRngEngine` inside the Worker boundary
 * and runs `visitConstrainedCandidates()` there, so every recorded throughput
 * number comes from a real Browser Worker with the Production RNG. The normal
 * application never loads this entry, and no Production Worker protocol is
 * touched.
 */
attachConstrainedEnumerationBenchmarkWorker(
  self as unknown as ConstrainedEnumerationBenchmarkWorkerScope,
  () => new ProductionRngEngine(),
)
