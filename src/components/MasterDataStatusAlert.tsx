import { Alert } from '@mui/material'
import type { MasterDataRoot } from '../domain/master/masterTypes'
import { getMasterDataStatus } from '../domain/master/masterDataStatus'

export function MasterDataStatusAlert({ master }: { master: MasterDataRoot }) {
  const status = getMasterDataStatus(master)
  return status.isProductionReady ? null : <Alert severity="warning">{status.reason}</Alert>
}
