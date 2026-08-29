import { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Checkbox, FormControl, FormControlLabel, InputLabel, LinearProgress, MenuItem, Paper, Select, Stack, TextField, Typography } from '@mui/material'
import { PageShell } from '../components/PageShell'
import type { KnownValue, RngState, RngStateSource } from '../domain/models/publicTypes'
import { validateRngState } from '../domain/models/validation'
import { deriveRngCapabilities } from '../domain/rng/capabilities'
import { UnavailableRngEngine } from '../domain/rng/unavailableRngEngine'
import { normalArtianCounterRepository, rngStateRepository } from '../db/repositories'

type KnownKey = 'baseSeed' | 'gogmaCounter' | 'skillCounter' | 'counterGate'
type FormKnown = { value: string; isConfirmed: boolean; source: RngStateSource | null }
type RngForm = Record<KnownKey, FormKnown> & { notes: string }

function toForm(state: RngState): RngForm {
  const map = <T,>(known: KnownValue<T>): FormKnown => ({ value: known.value === null ? '' : String(known.value), isConfirmed: known.isConfirmed, source: known.source })
  return { baseSeed: map(state.baseSeed), gogmaCounter: map(state.gogmaCounter), skillCounter: map(state.skillCounter), counterGate: map(state.counterGate), notes: state.notes ?? '' }
}

function parseCounter(value: string, label: string): number | null {
  if (value === '') return null
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${label}は0以上の整数で入力してください。`)
  return parsed
}

function toState(form: RngForm, current: RngState, now: string): RngState {
  const known = <T,>(value: T | null, input: FormKnown): KnownValue<T> => ({ value, isConfirmed: value === null ? false : input.isConfirmed, source: value === null ? null : input.source })
  return {
    ...current,
    baseSeed: known(form.baseSeed.value === '' ? null : form.baseSeed.value, form.baseSeed),
    gogmaCounter: known(parseCounter(form.gogmaCounter.value, 'Gogma Counter'), form.gogmaCounter),
    skillCounter: known(parseCounter(form.skillCounter.value, 'Skill Counter'), form.skillCounter),
    counterGate: known(parseCounter(form.counterGate.value, 'Counter Gate'), form.counterGate),
    notes: form.notes || null,
    updatedAt: now,
  }
}

const sourceOptions: Array<{ value: RngStateSource; label: string }> = [
  { value: 'manual', label: '手動入力' },
  { value: 'gogma_seed_finder_import', label: 'GogmaSeedFinder Import' },
  { value: 'observation', label: '観測検索' },
]

interface KnownFieldProps { label: string; numeric?: boolean; value: FormKnown; onChange(value: FormKnown): void }
function KnownField({ label, numeric = false, value, onChange }: KnownFieldProps) {
  return <Paper variant="outlined" sx={{ p: 2 }}><Stack spacing={2}>
    <TextField label={label} value={value.value} type={numeric ? 'number' : 'text'} onChange={(event) => onChange({ ...value, value: event.target.value, isConfirmed: event.target.value === '' ? false : value.isConfirmed, source: event.target.value === '' ? null : value.source })} slotProps={numeric ? { htmlInput: { min: 0, step: 1 } } : undefined} />
    <FormControlLabel control={<Checkbox checked={value.isConfirmed} disabled={value.value === ''} onChange={(event) => onChange({ ...value, isConfirmed: event.target.checked })} />} label="確定済み" />
    <FormControl><InputLabel id={`${label}-source`}>取得方法</InputLabel><Select labelId={`${label}-source`} label="取得方法" value={value.source ?? ''} disabled={value.value === ''} onChange={(event) => onChange({ ...value, source: (event.target.value || null) as RngStateSource | null })}><MenuItem value="">指定なし</MenuItem>{sourceOptions.map((option) => <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>)}</Select></FormControl>
  </Stack></Paper>
}

export interface RngSetupPageDependencies {
  ensure(): Promise<RngState>
  save(state: RngState): Promise<RngState>
  getNormalCounters(): ReturnType<typeof normalArtianCounterRepository.getAllNormalArtianCounters>
}
const defaultDependencies: RngSetupPageDependencies = {
  ensure: () => rngStateRepository.ensureInitialRngState(),
  save: (state) => rngStateRepository.putRngState(state),
  getNormalCounters: () => normalArtianCounterRepository.getAllNormalArtianCounters(),
}

export function RngSetupPage({ dependencies = defaultDependencies }: { dependencies?: RngSetupPageDependencies }) {
  const [state, setState] = useState<RngState | null>(null)
  const [form, setForm] = useState<RngForm | null>(null)
  const [normalCounters, setNormalCounters] = useState<Awaited<ReturnType<RngSetupPageDependencies['getNormalCounters']>>>([])
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  useEffect(() => { let active = true; void Promise.all([dependencies.ensure(), dependencies.getNormalCounters()]).then(([loaded, counters]) => { if (active) { setState(loaded); setForm(toForm(loaded)); setNormalCounters(counters) } }).catch((caught: unknown) => { if (active) setError(caught instanceof Error ? caught.message : 'RNG状態を読み込めません。') }); return () => { active = false } }, [dependencies])

  const preview = useMemo(() => { if (!state || !form) return null; try { return toState(form, state, state.updatedAt) } catch { return state } }, [form, state])
  const engine = useMemo(() => new UnavailableRngEngine(), [])
  const capabilities = preview ? deriveRngCapabilities(preview, normalCounters, [], engine.capabilities) : null

  const save = async () => {
    if (!state || !form) return
    setError(null); setNotice(null)
    try {
      const next = toState(form, state, new Date().toISOString())
      const validation = validateRngState(next)
      if (!validation.isValid) throw new Error(validation.issues.map(({ message }) => message).join(' / '))
      const saved = await dependencies.save(next)
      setState(saved); setForm(toForm(saved)); setNotice('RNG状態を保存しました。')
    } catch (caught: unknown) { setError(caught instanceof Error ? caught.message : 'RNG状態を保存できません。') }
  }

  return <PageShell title="RNG Setup" description="RNG状態を項目ごとに設定・確認します。"><Stack spacing={3}>
    {!form && !error && <LinearProgress />}{error && <Alert severity="error">{error}</Alert>}{notice && <Alert severity="success">{notice}</Alert>}
    {form && <><KnownField label="Base Seed" value={form.baseSeed} onChange={(value) => setForm({ ...form, baseSeed: value })} /><KnownField label="Gogma Counter" numeric value={form.gogmaCounter} onChange={(value) => setForm({ ...form, gogmaCounter: value })} /><KnownField label="Skill Counter" numeric value={form.skillCounter} onChange={(value) => setForm({ ...form, skillCounter: value })} /><KnownField label="Counter Gate" numeric value={form.counterGate} onChange={(value) => setForm({ ...form, counterGate: value })} /><TextField label="notes" multiline minRows={2} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /><Button variant="contained" onClick={() => void save()}>保存</Button></>}
    {capabilities && <Paper variant="outlined" sx={{ p: 2 }}><Typography variant="h2" gutterBottom>利用可能な機能</Typography><Stack spacing={1}><Typography>巨戟予測: {capabilities.canPredictGogma ? '利用可能' : '利用不可'}</Typography><Typography>スキル予測: {capabilities.canPredictSkills ? '利用可能' : '利用不可'}</Typography><Typography>通常アーティア検索: {capabilities.canSearchNormalArtian ? '利用可能' : '利用不可'}</Typography><Typography>Planner: 本番RNG Engine未実装のため利用不可（必要Capabilityは選択Route依存）</Typography><Alert severity="warning">本番RNG Engine未実装のため、値が揃っていても予測Capabilityは利用できません。</Alert></Stack></Paper>}
  </Stack></PageShell>
}
