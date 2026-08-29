import { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Checkbox, Chip, FormControl, FormControlLabel, FormHelperText, InputLabel, LinearProgress, MenuItem, Paper, Select, Stack, TextField, Typography } from '@mui/material'
import { PageShell } from '../components/PageShell'
import type { KnownValue, RngState, RngStateSource } from '../domain/models/publicTypes'
import { validateRngState } from '../domain/models/validation'
import { deriveRngCapabilities, type RngCapabilityMissingRequirement } from '../domain/rng/capabilities'
import { UnavailableRngEngine } from '../domain/rng/unavailableRngEngine'
import { normalArtianCounterRepository, rngStateRepository } from '../db/repositories'
import { getRngMissingRequirementLabel, rngStateSourceLabels } from '../presentation/labels'

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
    gogmaCounter: known(parseCounter(form.gogmaCounter.value, '巨戟カウンター'), form.gogmaCounter),
    skillCounter: known(parseCounter(form.skillCounter.value, 'スキルカウンター'), form.skillCounter),
    counterGate: known(parseCounter(form.counterGate.value, 'Counter Gate（カウンターゲート）'), form.counterGate),
    notes: form.notes || null,
    updatedAt: now,
  }
}

const sourceOptions: Array<{ value: RngStateSource; label: string }> = [
  { value: 'manual', label: rngStateSourceLabels.manual },
  { value: 'gogma_seed_finder_import', label: rngStateSourceLabels.gogma_seed_finder_import },
  { value: 'observation', label: rngStateSourceLabels.observation },
]

interface KnownFieldProps { fieldId: string; label: string; description: string; numeric?: boolean; value: FormKnown; onChange(value: FormKnown): void }
function KnownField({ fieldId, label, description, numeric = false, value, onChange }: KnownFieldProps) {
  const stateLabel = value.value === '' ? '未入力' : value.isConfirmed ? '使用中' : '未確認'
  const stateColor = value.value === '' ? 'default' : value.isConfirmed ? 'success' : 'warning'
  return <Paper variant="outlined" sx={{ p: 2 }}><Stack spacing={2}>
    <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center' }}><Typography variant="h3">{label}</Typography><Chip label={stateLabel} color={stateColor} size="small" /></Stack>
    <TextField label={label} helperText={description} value={value.value} type={numeric ? 'number' : 'text'} onChange={(event) => onChange({ ...value, value: event.target.value, isConfirmed: event.target.value === '' ? false : value.isConfirmed, source: event.target.value === '' ? null : value.source })} slotProps={numeric ? { htmlInput: { min: 0, step: 1 } } : undefined} />
    <FormControlLabel control={<Checkbox checked={value.isConfirmed} disabled={value.value === ''} onChange={(event) => onChange({ ...value, isConfirmed: event.target.checked })} />} label="この値を検索・予測に使用する" />
    <FormControl><InputLabel id={`${fieldId}-source-label`}>取得方法</InputLabel><Select id={`${fieldId}-source`} labelId={`${fieldId}-source-label`} label="取得方法" value={value.source ?? ''} disabled={value.value === ''} onChange={(event) => onChange({ ...value, source: (event.target.value || null) as RngStateSource | null })}><MenuItem value="">指定なし</MenuItem>{sourceOptions.map((option) => <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>)}</Select><FormHelperText>この値をどの方法で取得したかを記録します。</FormHelperText></FormControl>
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
  const displayedRequirements = useMemo(() => {
    if (!preview) return []
    const gogma = deriveRngCapabilities(preview, normalCounters, [{ type: 'convert_normal_to_gogma', weaponTypeId: 'capability-display', gogmaCounterBefore: 0, gogmaCounterAfter: 0 }], engine.capabilities)
    const skills = deriveRngCapabilities(preview, normalCounters, [{ type: 'reset_skills', sourceOwnedWeaponId: null, skillCounterBefore: 0, skillCounterAfter: 0 }], engine.capabilities)
    return [...new Set<RngCapabilityMissingRequirement>([
      ...gogma.missingRequirements as RngCapabilityMissingRequirement[],
      ...skills.missingRequirements as RngCapabilityMissingRequirement[],
    ])]
  }, [engine.capabilities, normalCounters, preview])

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

  return <PageShell title="RNG状態設定" description="検索や予測に使うRNG状態を項目ごとに設定します。"><Stack spacing={3}>
    {!form && !error && <LinearProgress />}{error && <Alert severity="error">{error}</Alert>}{notice && <Alert severity="success">{notice}</Alert>}
    {form && <><Alert severity="info">正しいことを確認できた値だけ「この値を検索・予測に使用する」を選択してください。選択していない値も保存されますが、検索やRNG予測には使用されません。</Alert><KnownField fieldId="base-seed" label="Base Seed（基準シード）" description="RNG予測の基準となる文字列です。先頭の0もそのまま保存します。" value={form.baseSeed} onChange={(value) => setForm({ ...form, baseSeed: value })} /><KnownField fieldId="gogma-counter" label="巨戟カウンター" description="巨戟アーティアの復元ボーナス予測に使う位置です。" numeric value={form.gogmaCounter} onChange={(value) => setForm({ ...form, gogmaCounter: value })} /><KnownField fieldId="skill-counter" label="スキルカウンター" description="シリーズ・グループスキル予測に使う位置です。" numeric value={form.skillCounter} onChange={(value) => setForm({ ...form, skillCounter: value })} /><KnownField fieldId="counter-gate" label="Counter Gate（カウンターゲート）" description="予測エンジンが必要とするカウンターゲート値です。" numeric value={form.counterGate} onChange={(value) => setForm({ ...form, counterGate: value })} /><TextField label="メモ" multiline minRows={2} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /><Button variant="contained" onClick={() => void save()}>保存</Button></>}
    {capabilities && <Paper variant="outlined" sx={{ p: 2 }}><Typography variant="h2" gutterBottom>利用可能な機能</Typography><Stack spacing={1}><Typography>巨戟アーティア予測: {capabilities.canPredictGogma ? '利用可能' : '利用不可'}</Typography><Typography>スキル予測: {capabilities.canPredictSkills ? '利用可能' : '利用不可'}</Typography><Typography>通常アーティア検索: {capabilities.canSearchNormalArtian ? '利用可能' : '利用不可'}</Typography><Typography>生産計画作成: 本番RNG予測エンジン未実装のため利用不可（必要項目は作成ルートにより異なります）</Typography>{displayedRequirements.length > 0 && <Alert severity="warning"><Typography variant="subtitle2">現在不足している項目</Typography>{displayedRequirements.map((requirement) => <Typography variant="body2" key={requirement}>{getRngMissingRequirementLabel(requirement)}</Typography>)}</Alert>}<Alert severity="warning">本番RNG予測エンジンが未実装のため、値が揃っていても予測機能は利用できません。</Alert></Stack></Paper>}
  </Stack></PageShell>
}
