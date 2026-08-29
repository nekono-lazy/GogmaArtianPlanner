import manifestJson from '../../data/master/manifest.json'
import type { MasterDataRoot } from './masterTypes'
import { parseMasterManifest, validateMasterData } from './validateMasterData'

export type MasterDataLoadResult =
  | { ok: true; data: MasterDataRoot }
  | { ok: false; errors: string[] }

export function loadMasterData(): MasterDataLoadResult {
  const manifest = parseMasterManifest(manifestJson as unknown)
  if (!manifest) {
    return { ok: false, errors: ['Master Data manifest is invalid.'] }
  }

  const data: MasterDataRoot = {
    manifest,
    weaponTypes: [],
    elements: [],
    bonusTypes: [],
    bonusRanks: [],
    weaponBonusDefinitions: [],
    seriesSkills: [],
    groupSkills: [],
    lotteries: [],
    materials: [],
    materialCosts: [],
  }
  const validation = validateMasterData(data)
  return validation.isValid
    ? { ok: true, data }
    : { ok: false, errors: validation.errors }
}
