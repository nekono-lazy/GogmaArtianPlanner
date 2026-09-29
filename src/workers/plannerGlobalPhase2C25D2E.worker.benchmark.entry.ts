import { ProductionRngEngine } from '../domain/rng/production/productionRngEngine'
import { attachPhase2C25D2EWorker, type Phase2C25D2EWorkerScope } from './plannerGlobalPhase2C25D2E.worker.benchmark'

/**
 * Issue #154 Global Planner Research Phase 2-C2.5-D2-e benchmark-only Worker entry.
 *
 * The Engine is a default `ProductionRngEngine`, exactly what the Phase 2-C2.5-B / D2-b Worker and the Node D2-d Search
 * child used. The normal application never loads this entry; its Production Workers are unchanged.
 */
attachPhase2C25D2EWorker(self as unknown as Phase2C25D2EWorkerScope, { createEngine: () => new ProductionRngEngine() })
