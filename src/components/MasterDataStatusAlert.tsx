import { Alert } from '@mui/material'
import type { MasterDataRoot } from '../domain/master/masterTypes'
import { getMasterDataStatus, type MasterDataFeature } from '../domain/master/masterDataStatus'

/**
 * A blocking Master gap is one warning; every advisory is its own warning.
 * An advisory never says the feature is unavailable, so the two are never
 * merged into one sentence (`docs/UI_FLOW.md` 9).
 */
export function MasterDataStatusAlert({ master, feature = 'core_ui' }: { master: MasterDataRoot; feature?: MasterDataFeature }) {
  const status = getMasterDataStatus(master, feature)
  if (!status.isProductionReady) {
    return <Alert severity="warning">{status.blockingReason}</Alert>
  }
  return (
    <>
      {status.advisories.map((advisory) => (
        <Alert severity="warning" key={advisory.kind}>
          {advisory.message}
        </Alert>
      ))}
    </>
  )
}
