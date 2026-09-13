import { useEffect, useId, useState } from 'react'
import { Alert, Box, Button, Checkbox, FormControlLabel, LinearProgress, Paper, Stack, TextField, Typography } from '@mui/material'
import type { Theme } from '@mui/material/styles'
import { PageShell } from '../components/PageShell'
import { StatusChip, type StatusTone } from '../components/StatusChip'
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

/**
 * Status shown per row. It only restates `isConfirmed` and whether a value is
 * held; the raw Counter value itself is Debug Mode only (`docs/UI_FLOW.md` 3).
 */
function counterStatus(row: NormalArtianCounter): { label: string; tone: StatusTone } {
  if (row.isConfirmed) return { label: '確定・検索に使用', tone: 'positive' }
  if (row.counter === null) return { label: '未設定・検索に未使用', tone: 'neutral' }
  return { label: '未確定・検索に未使用', tone: 'caution' }
}

/** Visually hidden from `md` up, where the column header row names the cell. */
const inlineCellLabelSx = (theme: Theme) => ({
  color: 'text.secondary',
  mr: 0.75,
  [theme.breakpoints.up('md')]: {
    position: 'absolute',
    width: 1,
    height: 1,
    overflow: 'hidden',
    clip: 'rect(0 0 0 0)',
    whiteSpace: 'nowrap',
    m: 0,
  },
})

/** PC: one table-like row per weapon type. Smartphone: the same row stacked as a card. */
const rowGridSx = {
  display: 'grid',
  gridTemplateColumns: { xs: 'minmax(0, 1fr) auto', md: 'minmax(0, 1.4fr) minmax(0, 1.4fr) repeat(3, minmax(0, 0.8fr))' },
  gridTemplateAreas: {
    xs: '"name status" "metrics metrics"',
    md: '"name status observations candidates observed"',
  },
  columnGap: 2,
  rowGap: 0.75,
  alignItems: 'center',
} as const

function CounterRow({ row, weaponName, debugMode, onChange, onSave }: {
  row: NormalArtianCounter
  weaponName: string
  debugMode: boolean
  onChange(next: NormalArtianCounter): void
  onSave(value: NormalArtianCounter): void
}) {
  const headingId = useId()
  const status = counterStatus(row)
  return (
    <Box
      component="li"
      aria-labelledby={headingId}
      sx={{ position: 'relative', listStyle: 'none', px: { xs: 2, md: 2.5 }, py: 1.5, borderTop: 1, borderColor: 'divider' }}
    >
      <Box sx={rowGridSx}>
        <Typography id={headingId} component="h3" variant="h3" sx={{ gridArea: 'name', minWidth: 0 }}>{weaponName}</Typography>
        <Box sx={{ gridArea: 'status', justifySelf: { xs: 'end', md: 'start' } }}><StatusChip label={status.label} tone={status.tone} /></Box>
        <Box sx={{ gridArea: { xs: 'metrics', md: 'auto' }, display: { xs: 'flex', md: 'contents' }, flexWrap: 'wrap', columnGap: 2, rowGap: 0.25 }}>
          <Typography variant="body2" className="tabular-nums" sx={{ gridArea: { md: 'observations' } }}><Box component="span" sx={inlineCellLabelSx}>観測数</Box>{row.observationCount}</Typography>
          <Typography variant="body2" className="tabular-nums" sx={{ gridArea: { md: 'candidates' } }}><Box component="span" sx={inlineCellLabelSx}>候補数</Box>{row.candidateCount ?? '—'}</Typography>
          <Typography variant="body2" className="tabular-nums" sx={{ gridArea: { md: 'observed' }, overflowWrap: 'anywhere' }}><Box component="span" sx={inlineCellLabelSx}>最終観測</Box>{row.lastObservedAt ?? '—'}</Typography>
        </Box>
      </Box>
      {debugMode && (
        <Box
          sx={{
            mt: 1.5,
            p: 1.5,
            border: 1,
            borderStyle: 'dashed',
            borderColor: 'warning.main',
            borderRadius: 1,
            display: 'grid',
            gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', md: 'repeat(3, minmax(0, 1fr)) minmax(0, 1.4fr) auto auto' },
            gap: 1.5,
            alignItems: 'center',
          }}
        >
          <TextField size="small" label="Counter raw値" type="number" value={row.counter ?? ''} onChange={(event) => onChange({ ...row, counter: event.target.value === '' ? null : Number(event.target.value), isConfirmed: event.target.value === '' ? false : row.isConfirmed })} />
          <TextField size="small" label="observationCount" type="number" value={row.observationCount} onChange={(event) => onChange({ ...row, observationCount: Number(event.target.value) })} />
          <TextField size="small" label="candidateCount" type="number" value={row.candidateCount ?? ''} onChange={(event) => onChange({ ...row, candidateCount: event.target.value === '' ? null : Number(event.target.value) })} />
          <TextField size="small" label="lastObservedAt" value={row.lastObservedAt ?? ''} onChange={(event) => onChange({ ...row, lastObservedAt: event.target.value || null })} sx={{ gridColumn: { xs: '1 / -1', md: 'auto' } }} />
          <FormControlLabel sx={{ m: 0, minHeight: 44 }} control={<Checkbox checked={row.isConfirmed} disabled={row.counter === null} onChange={(event) => onChange({ ...row, isConfirmed: event.target.checked })} />} label="確定済み" />
          <Button variant="outlined" onClick={() => onSave(row)} aria-describedby={headingId} sx={{ minHeight: 44, justifySelf: { xs: 'end', md: 'stretch' } }}>デバッグ保存</Button>
        </Box>
      )}
    </Box>
  )
}

export function NormalCountersPage({ dependencies = defaultDependencies }: { dependencies?: NormalCountersPageDependencies }) {
  const debugMode = useSettingsStore((state) => state.debugMode)
  const [values, setValues] = useState<NormalArtianCounter[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const listHeadingId = useId()
  useEffect(() => { let active = true; void dependencies.getAll().then((loaded) => { if (active) setValues(loaded) }).catch((caught: unknown) => { if (active) setError(caught instanceof Error ? caught.message : 'カウンターを読み込めません。') }).finally(() => { if (active) setLoading(false) }); return () => { active = false } }, [dependencies])
  if (!masterResult.ok) return <PageShell title="通常アーティアカウンター" description="通常アーティアカウンターを確認します。"><Alert severity="error">マスターデータが利用できません。</Alert></PageShell>
  const rows = getEnabledWeaponTypes(masterResult.data).map((weaponType) => values.find((value) => value.weaponTypeId === weaponType.id && value.rarity === V1_NORMAL_ARTIAN_RARITY) ?? emptyCounter(weaponType.id))
  const confirmedCount = rows.filter((row) => row.isConfirmed && row.counter !== null).length
  const update = (next: NormalArtianCounter) => setValues((current) => [...current.filter(({ id }) => id !== next.id), next])
  const save = async (value: NormalArtianCounter) => { setError(null); try { const next = { ...value, isConfirmed: value.counter === null ? false : value.isConfirmed, updatedAt: new Date().toISOString() }; const validation = validateNormalArtianCounter(next); if (!validation.isValid) throw new Error(validation.issues.map(({ message }) => message).join(' / ')); const saved = await dependencies.save(next); update(saved); setNotice('カウンターを保存しました。') } catch (caught: unknown) { setError(caught instanceof Error ? caught.message : '保存できません。') } }
  return (
    <PageShell title="通常アーティアカウンター" description="レア8通常アーティアの武器種別カウンターを確認します。">
      <Stack spacing={2}>
        {error && <Alert severity="error">{error}</Alert>}
        {notice && <Alert severity="success" onClose={() => setNotice(null)}>{notice}</Alert>}
        <Alert severity="info">v1ではレア8のみを扱います。観測検索は未実装で、直接編集はデバッグモード限定です。</Alert>
        {debugMode && <Alert severity="warning">デバッグモード: カウンターを直接編集できます。保存した値は通常アーティア経由の候補検索に使用されます。</Alert>}
        <Paper component="section" variant="outlined" aria-labelledby={listHeadingId} sx={{ overflow: 'hidden' }}>
          <Stack direction="row" spacing={1} useFlexGap sx={{ px: { xs: 2, md: 2.5 }, pt: 2, pb: { xs: 1.5, md: 2 }, alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap' }}>
            <Typography id={listHeadingId} component="h2" variant="h2">武器種別カウンター（レア8）</Typography>
            {!loading && <Typography variant="body2" color="text.secondary" className="tabular-nums">確定 {confirmedCount} / {rows.length}</Typography>}
          </Stack>
          {loading ? (
            <LinearProgress aria-label="カウンターを読み込み中" />
          ) : (
            <>
              <Box aria-hidden="true" sx={{ ...rowGridSx, display: { xs: 'none', md: 'grid' }, gridTemplateAreas: undefined, px: 2.5, py: 1, bgcolor: 'background.default', borderTop: 1, borderColor: 'divider' }}>
                {['武器種', '状態', '観測数', '候補数', '最終観測'].map((label) => <Typography key={label} variant="subtitle2" color="text.secondary">{label}</Typography>)}
              </Box>
              <Box component="ul" sx={{ m: 0, p: 0 }}>
                {rows.map((row) => <CounterRow key={row.id} row={row} weaponName={masterResult.data.weaponTypes.find(({ id }) => id === row.weaponTypeId)?.displayNameJa ?? row.weaponTypeId} debugMode={debugMode} onChange={update} onSave={(value) => void save(value)} />)}
              </Box>
            </>
          )}
        </Paper>
      </Stack>
    </PageShell>
  )
}
