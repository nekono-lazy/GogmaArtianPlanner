import { useEffect, useState } from 'react'
import { Alert, Button, LinearProgress, Stack, Typography } from '@mui/material'
import { PageShell } from '../components/PageShell'
import { CandidateCard } from '../components/search/CandidateCard'
import { staleReasonLabels } from '../components/search/searchPresentation'
import { loadMasterData } from '../domain/master/loadMasterData'
import type { MasterDataRoot } from '../domain/master/masterTypes'
import type { BuildListEntry, BuildListEntryId, CalculationContext, OwnedWeapon, TargetWeapon } from '../domain/models/publicTypes'
import { useSettingsStore } from '../stores/settingsStore'
import { buildListService } from '../services/buildList/buildListService'

const loadedMaster = loadMasterData()
const defaultMaster = loadedMaster.ok ? loadedMaster.data : null

export interface BuildListPageDependencies {
  master: MasterDataRoot
  calculationContext: CalculationContext
  refresh(): Promise<{ entries: BuildListEntry[]; targets: TargetWeapon[]; ownedWeapons: OwnedWeapon[] }>
  deleteEntry(id: BuildListEntryId): Promise<void>
}

const defaultDependencies: BuildListPageDependencies | null = defaultMaster
  ? {
      master: defaultMaster,
      calculationContext: {
        gameVersion: defaultMaster.manifest.gameVersion,
        masterDataVersion: defaultMaster.manifest.dataVersion,
        rngEngineVersion: 'production-engine-unavailable',
        appSchemaVersion: 1,
      },
      refresh: () => buildListService.refreshStaleness({
        gameVersion: defaultMaster.manifest.gameVersion,
        masterDataVersion: defaultMaster.manifest.dataVersion,
        rngEngineVersion: 'production-engine-unavailable',
        appSchemaVersion: 1,
      }),
      deleteEntry: (id) => buildListService.deleteEntry(id),
    }
  : null

interface BuildListPageProps { dependencies?: BuildListPageDependencies }

export function BuildListPage({ dependencies = defaultDependencies ?? undefined }: BuildListPageProps) {
  const debugMode = useSettingsStore((state) => state.debugMode)
  const [entries, setEntries] = useState<BuildListEntry[]>([])
  const [targets, setTargets] = useState<TargetWeapon[]>([])
  const [ownedWeapons, setOwnedWeapons] = useState<OwnedWeapon[]>([])
  const [loading, setLoading] = useState(dependencies !== undefined)
  const [error, setError] = useState<string | null>(
    dependencies ? null : 'Master Dataを読み込めません。',
  )
  const masterForDisplay = dependencies?.master ?? defaultMaster

  useEffect(() => {
    let active = true
    if (!dependencies) {
      return
    }
    void dependencies.refresh().then((loaded) => {
      if (!active) return
      setEntries(loaded.entries)
      setTargets(loaded.targets)
      setOwnedWeapons(loaded.ownedWeapons)
    }).catch((caught: unknown) => {
      if (active) setError(caught instanceof Error ? caught.message : 'Build Listの読み込みに失敗しました。')
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [dependencies])

  const remove = async (id: BuildListEntryId) => {
    if (!dependencies) return
    try {
      await dependencies.deleteEntry(id)
      setEntries((current) => current.filter((entry) => entry.id !== id))
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'Build Listから削除できませんでした。')
    }
  }

  return (
    <PageShell title="Build List" description="Plannerに検討させる候補を確認します。">
      <Stack spacing={3}>
        {loading && <LinearProgress aria-label="Build Listを読み込み中" />}
        {error && <Alert severity="error">{error}</Alert>}
        {!loading && !error && entries.length === 0 && <Alert severity="info">Build Listは空です。検索結果から候補を追加してください。</Alert>}
        {entries.map((entry) => {
          const target = targets.find(({ id }) => id === entry.targetWeaponId) ?? null
          return <Stack spacing={1} key={entry.id}>
            <Typography variant="h2">{target?.name ?? '削除済みTarget'}</Typography>
            {entry.isStale && <Alert severity="warning"><Typography variant="subtitle2">再検索が必要</Typography>{entry.staleReasons.map((reason) => <Typography variant="body2" key={reason}>{staleReasonLabels[reason]}</Typography>)}</Alert>}
            {masterForDisplay && <CandidateCard candidate={entry.candidateSnapshot} target={target} master={masterForDisplay} ownedWeapons={ownedWeapons} debugMode={debugMode} />}
            {debugMode && <Alert severity="info">targetDefinitionHash: {entry.targetDefinitionHash}</Alert>}
            <Typography variant="caption">追加日時: {entry.createdAt}</Typography>
            <Button color="error" variant="outlined" onClick={() => void remove(entry.id)}>Build Listから削除</Button>
          </Stack>
        })}
      </Stack>
    </PageShell>
  )
}
