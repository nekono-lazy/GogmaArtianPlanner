import { ProductionRngEngine } from '../domain/rng/production/productionRngEngine'
import { attachPhase2C25BWorker, type Phase2C25BWorkerScope } from './plannerGlobalPhase2C25B.worker.benchmark'

/**
 * Issue #154 Global Planner Research Phase 2-C2.5-B benchmark-only Worker entry.
 *
 * The Engine is a default `ProductionRngEngine`, exactly what the Node Phase 2-C2.5-A Search child used. The normal
 * application never loads this entry; its Production Workers are unchanged.
 */
attachPhase2C25BWorker(self as unknown as Phase2C25BWorkerScope, { createEngine: () => new ProductionRngEngine() })
