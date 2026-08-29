import type { MasterDataRoot } from './masterTypes'

export interface MasterDataStatus {
  isProductionReady: boolean
  reason: string | null
}

export function getMasterDataStatus(master: MasterDataRoot): MasterDataStatus {
  const metadata = `${master.manifest.gameVersion} ${master.manifest.notes ?? ''}`.toLowerCase()
  const isPlaceholder = [
    'unknown-initial',
    'placeholder',
    'not yet verified',
    'unverified',
    'fixture-only',
    'validation-only',
  ].some((marker) => metadata.includes(marker))

  return isPlaceholder
    ? {
        isProductionReady: false,
        reason: '現在、一部のゲームデータは未登録または未検証です。表示される選択肢がゲーム全体を網羅しているとは限りません。',
      }
    : { isProductionReady: true, reason: null }
}
