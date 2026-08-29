import { useEffect, useState } from 'react'
import { Alert, Button, Checkbox, FormControlLabel, LinearProgress, Paper, Stack, TextField, Typography } from '@mui/material'
import { PageShell } from '../components/PageShell'
import { loadMasterData } from '../domain/master/loadMasterData'
import { getEnabledWeaponTypes } from '../domain/master/masterSelectors'
import type { NormalArtianCounter } from '../domain/models/publicTypes'
import { V1_NORMAL_ARTIAN_RARITY } from '../domain/models/publicTypes'
import { validateNormalArtianCounter } from '../domain/models/validation'
import { normalArtianCounterId, normalArtianCounterRepository } from '../db/repositories'
import { useSettingsStore } from '../stores/settingsStore'

const masterResult = loadMasterData()

export interface NormalCountersPageDependencies {
  getAll(): Promise<NormalArtianCounter[]>
  save(value: NormalArtianCounter): Promise<NormalArtianCounter>
}
const defaultDependencies: NormalCountersPageDependencies = { getAll: () => normalArtianCounterRepository.getAllNormalArtianCounters(), save: (value) => normalArtianCounterRepository.putNormalArtianCounter(value) }

function emptyCounter(weaponTypeId: string): NormalArtianCounter {
  const now = new Date().toISOString()
  return { id: normalArtianCounterId(weaponTypeId, V1_NORMAL_ARTIAN_RARITY), weaponTypeId, rarity: V1_NORMAL_ARTIAN_RARITY, counter: null, isConfirmed: false, observationCount: 0, lastObservedAt: null, candidateCount: null, createdAt: now, updatedAt: now }
}

export function NormalCountersPage({ dependencies = defaultDependencies }: { dependencies?: NormalCountersPageDependencies }) {
  const debugMode = useSettingsStore((state) => state.debugMode)
  const [values, setValues] = useState<NormalArtianCounter[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  useEffect(() => { let active = true; void dependencies.getAll().then((loaded) => { if (active) setValues(loaded) }).catch((caught: unknown) => { if (active) setError(caught instanceof Error ? caught.message : 'カウンターを読み込めません。') }).finally(() => { if (active) setLoading(false) }); return () => { active = false } }, [dependencies])
  if (!masterResult.ok) return <PageShell title="通常アーティアカウンター" description="通常アーティアカウンターを確認します。"><Alert severity="error">マスターデータが利用できません。</Alert></PageShell>
  const rows = getEnabledWeaponTypes(masterResult.data).map((weaponType) => values.find((value) => value.weaponTypeId === weaponType.id && value.rarity === V1_NORMAL_ARTIAN_RARITY) ?? emptyCounter(weaponType.id))
  const update = (next: NormalArtianCounter) => setValues((current) => [...current.filter(({ id }) => id !== next.id), next])
  const save = async (value: NormalArtianCounter) => { setError(null); try { const next = { ...value, isConfirmed: value.counter === null ? false : value.isConfirmed, updatedAt: new Date().toISOString() }; const validation = validateNormalArtianCounter(next); if (!validation.isValid) throw new Error(validation.issues.map(({ message }) => message).join(' / ')); const saved = await dependencies.save(next); update(saved); setNotice('カウンターを保存しました。') } catch (caught: unknown) { setError(caught instanceof Error ? caught.message : '保存できません。') } }
  return <PageShell title="通常アーティアカウンター" description="レア8通常アーティアの武器種別カウンターを確認します。"><Stack spacing={2}>{loading && <LinearProgress />}{error && <Alert severity="error">{error}</Alert>}{notice && <Alert severity="success">{notice}</Alert>}<Alert severity="info">v1ではレア8のみを扱います。観測検索は未実装で、直接編集はデバッグモード限定です。</Alert>{rows.map((row) => { const weapon = masterResult.data.weaponTypes.find(({ id }) => id === row.weaponTypeId); return <Paper variant="outlined" sx={{ p: 2 }} key={row.id}><Stack spacing={1}><Typography variant="h3">{weapon?.displayNameJa}</Typography><Typography>カウンター: {row.counter ?? '未入力'} ／ {row.isConfirmed ? '検索に使用' : '検索に未使用'}</Typography><Typography variant="body2">観測数 {row.observationCount} ／ 候補数 {row.candidateCount ?? '—'} ／ 最終観測 {row.lastObservedAt ?? '—'}</Typography>{debugMode && <><TextField label="Counter raw値" type="number" value={row.counter ?? ''} onChange={(event) => update({ ...row, counter: event.target.value === '' ? null : Number(event.target.value), isConfirmed: event.target.value === '' ? false : row.isConfirmed })} /><FormControlLabel control={<Checkbox checked={row.isConfirmed} disabled={row.counter === null} onChange={(event) => update({ ...row, isConfirmed: event.target.checked })} />} label="確定済み" /><TextField label="observationCount" type="number" value={row.observationCount} onChange={(event) => update({ ...row, observationCount: Number(event.target.value) })} /><TextField label="candidateCount" type="number" value={row.candidateCount ?? ''} onChange={(event) => update({ ...row, candidateCount: event.target.value === '' ? null : Number(event.target.value) })} /><TextField label="lastObservedAt" value={row.lastObservedAt ?? ''} onChange={(event) => update({ ...row, lastObservedAt: event.target.value || null })} /><Button onClick={() => void save(row)}>デバッグ保存</Button></>}</Stack></Paper>})}</Stack></PageShell>
}
