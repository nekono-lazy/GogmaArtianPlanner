import { ProductionRngEngine } from '../domain/rng/production/productionRngEngine'
import { attachPhase2C25D2BWorker, type Phase2C25D2BWorkerScope } from './plannerGlobalPhase2C25D2B.worker.benchmark'

/**
 * Issue #154 Global Planner Research Phase 2-C2.5-D2-b benchmark-only Worker entry.
 *
 * The Engine is a default `ProductionRngEngine`, exactly what the Phase 2-C2.5-B Worker and the Node D2-a Search child
 * used. The normal application never loads this entry; its Production Workers are unchanged.
 */
attachPhase2C25D2BWorker(self as unknown as Phase2C25D2BWorkerScope, { createEngine: () => new ProductionRngEngine() })
