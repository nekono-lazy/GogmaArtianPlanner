import type {
  AppSettings,
  ISODateTimeString,
  NormalArtianCounter,
  RngState,
} from './common'
import type {
  BuildCandidate,
  BuildListEntry,
  OwnedWeapon,
  TargetWeapon,
} from './entities'
import type { ExecutionHistory, ProductionPlan } from './planning'

export interface ExportRoot {
  schemaVersion: 4
  appName: 'mh-wilds-gogma-artian-planner'
  exportedAt: ISODateTimeString
  rngState: RngState | null
  normalArtianCounters: NormalArtianCounter[]
  ownedWeapons: OwnedWeapon[]
  targetWeapons: TargetWeapon[]
  buildCandidates: BuildCandidate[]
  buildListEntries: BuildListEntry[]
  productionPlans: ProductionPlan[]
  executionHistory: ExecutionHistory[]
  settings: AppSettings
}
