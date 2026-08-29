import { Alert } from '@mui/material'
import type { MasterDataRoot } from '../domain/master/masterTypes'
import { getMasterDataStatus, type MasterDataFeature } from '../domain/master/masterDataStatus'

export function MasterDataStatusAlert({ master, feature = 'core_ui' }: { master: MasterDataRoot; feature?: MasterDataFeature }) {
  const status = getMasterDataStatus(master, feature)
  return status.isProductionReady ? null : <Alert severity="warning">{status.reason}</Alert>
}
