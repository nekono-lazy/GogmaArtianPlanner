import { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Checkbox, Chip, FormControlLabel, LinearProgress, Paper, Stack, TextField, Typography } from '@mui/material'
import { PageShell } from '../components/PageShell'
import { IdentificationWizardDialog } from '../components/rng/IdentificationWizardDialog'
import { loadMasterData } from '../domain/master/loadMasterData'
import type { KnownValue, RngState, RngStateSource } from '../domain/models/publicTypes'
import { validateRngState } from '../domain/models/validation'
import { deriveRngCapabilities, type RngCapabilityMissingRequirement } from '../domain/rng/capabilities'
import { productionRngEngine, productionRngRuntime } from '../domain/rng/production/productionRngRuntime'
import type { RngEngine } from '../domain/rng/rngEngine'
import { normalArtianCounterRepository, rngStateRepository } from '../db/repositories'
import { getRngMissingRequirementLabel, rngStateSourceLabels } from '../presentation/labels'
import {
  createProductionIdentificationWizardCoordinator,
  type IdentificationWizardCoordinator,
} from '../services/rngIdentification/identificationWizardCoordinator'

const masterResult = loadMasterData()

type KnownKey = 'baseSeed' | 'gogmaCounter' | 'skillCounter' | 'counterGate'
type FormKnown = { value: string; isConfirmed: boolean; source: RngStateSource | null }
type RngForm = Record<KnownKey, FormKnown> & { notes: string }
const knownKeys: readonly KnownKey[] = [
  'baseSeed', 'gogmaCounter', 'skillCounter', 'counterGate',
]

function toForm(state: RngState): RngForm {
  const map = <T,>(known: KnownValue<T>): FormKnown => ({ value: known.value === null ? '' : String(known.value), isConfirmed: known.isConfirmed, source: known.source })
  return { baseSeed: map(state.baseSeed), gogmaCounter: map(state.gogmaCounter), skillCounter: map(state.skillCounter), counterGate: map(state.counterGate), notes: state.notes ?? '' }
}

function hasUnsavedRngFormChanges(form: RngForm, state: RngState): boolean {
  const persisted = toForm(state)
  return form.notes !== persisted.notes || knownKeys.some((key) => (
    form[key].value !== persisted[key].value ||
    form[key].isConfirmed !== persisted[key].isConfirmed ||
    form[key].source !== persisted[key].source
  ))
}

function parseCounter(value: string, label: string): number | null {
  if (value === '') return null
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${label}は0以上の整数で入力してください。`)
  return parsed
}

function toState(
  form: RngForm,
  current: RngState,
  modifiedKeys: ReadonlySet<KnownKey>,
  now: string,
  engine: Pick<RngEngine, 'normalizeSeed'>,
): RngState {
  const updateKnown = <T,>(
    key: KnownKey,
    input: FormKnown,
    existing: KnownValue<T>,
    parse: (value: string) => T,
  ): KnownValue<T> => {
    if (!modifiedKeys.has(key) || input.value === '') return existing
    return {
      value: parse(input.value),
      isConfirmed: input.isConfirmed,
      source: input.source ?? 'manual',
    }
  }
  return {
    ...current,
    baseSeed: updateKnown('baseSeed', form.baseSeed, current.baseSeed, (value) => engine.normalizeSeed(value)),
    gogmaCounter: updateKnown('gogmaCounter', form.gogmaCounter, current.gogmaCounter, (value) => parseCounter(value, '巨戟カウンター') as number),
    skillCounter: updateKnown('skillCounter', form.skillCounter, current.skillCounter, (value) => parseCounter(value, 'スキルカウンター') as number),
    counterGate: updateKnown('counterGate', form.counterGate, current.counterGate, (value) => parseCounter(value, 'Counter Gate（カウンターゲート）') as number),
    notes: form.notes || null,
    updatedAt: now,
  }
}

interface KnownFieldProps { fieldId: string; label: string; description: string; numeric?: boolean; value: FormKnown; onChange(value: FormKnown): void }
function KnownField({ fieldId, label, description, numeric = false, value, onChange }: KnownFieldProps) {
  const stateLabel = value.value === '' ? '未入力' : value.isConfirmed ? '使用中' : '未確認'
  const stateColor = value.value === '' ? 'default' : value.isConfirmed ? 'success' : 'warning'
  return <Paper variant="outlined" sx={{ p: 2 }}><Stack spacing={2}>
    <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center' }}><Typography variant="h3">{label}</Typography><Chip label={stateLabel} color={stateColor} size="small" /></Stack>
    <TextField label={label} helperText={description} value={value.value} type={numeric ? 'number' : 'text'} onChange={(event) => onChange({ ...value, value: event.target.value, isConfirmed: event.target.value === '' ? false : value.isConfirmed, source: event.target.value === '' ? value.source : 'manual' })} slotProps={numeric ? { htmlInput: { min: 0, step: 1 } } : undefined} />
    <FormControlLabel control={<Checkbox checked={value.isConfirmed} disabled={value.value === ''} onChange={(event) => onChange({ ...value, isConfirmed: event.target.checked })} />} label="この値を検索・予測に使用する" />
    <Typography variant="body2" color="text.secondary" id={`${fieldId}-source`}>
      取得方法: {value.source === null ? '指定なし' : rngStateSourceLabels[value.source]}
    </Typography>
  </Stack></Paper>
}

export interface RngSetupPageDependencies {
  ensure(): Promise<RngState>
  save(state: RngState): Promise<RngState>
  getNormalCounters(): ReturnType<typeof normalArtianCounterRepository.getAllNormalArtianCounters>
  createIdentificationCoordinator?(): IdentificationWizardCoordinator
}
const defaultDependencies: RngSetupPageDependencies = {
  ensure: () => rngStateRepository.ensureInitialRngState(),
  save: (state) => rngStateRepository.putRngState(state),
  getNormalCounters: () => normalArtianCounterRepository.getAllNormalArtianCounters(),
  createIdentificationCoordinator: createProductionIdentificationWizardCoordinator,
}

export function RngSetupPage({ dependencies = defaultDependencies }: { dependencies?: RngSetupPageDependencies }) {
  const [state, setState] = useState<RngState | null>(null)
  const [form, setForm] = useState<RngForm | null>(null)
  const [normalCounters, setNormalCounters] = useState<Awaited<ReturnType<RngSetupPageDependencies['getNormalCounters']>>>([])
  const [modifiedKeys, setModifiedKeys] = useState<Set<KnownKey>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [identificationCoordinator, setIdentificationCoordinator] =
    useState<IdentificationWizardCoordinator | null>(null)
  useEffect(() => { let active = true; void Promise.all([dependencies.ensure(), dependencies.getNormalCounters()]).then(([loaded, counters]) => { if (active) { setState(loaded); setForm(toForm(loaded)); setNormalCounters(counters) } }).catch((caught: unknown) => { if (active) setError(caught instanceof Error ? caught.message : 'RNG状態を読み込めません。') }); return () => { active = false } }, [dependencies])

  // The page owns Coordinator lifetime: the Wizard session ends only when the
  // Coordinator is cleared by a real Close or when this page unmounts.
  useEffect(() => {
    if (!identificationCoordinator) return
    return () => { identificationCoordinator.dispose() }
  }, [identificationCoordinator])

  const updateField = (key: KnownKey, value: FormKnown) => {
    setForm((current) => current ? { ...current, [key]: value } : current)
    setModifiedKeys((current) => new Set(current).add(key))
  }

  const preview = useMemo(() => { if (!state || !form) return null; try { return toState(form, state, modifiedKeys, state.updatedAt, productionRngEngine) } catch { return state } }, [form, modifiedKeys, state])
  const hasUnsavedChanges = useMemo(
    () => state !== null && form !== null && hasUnsavedRngFormChanges(form, state),
    [form, state],
  )
  const capabilities = preview ? deriveRngCapabilities(preview, normalCounters, [], productionRngEngine.capabilities) : null
  const displayedRequirements = useMemo(() => {
    if (!preview) return []
    const gogma = deriveRngCapabilities(preview, normalCounters, [{ type: 'reset_bonuses', sourceOwnedWeaponId: null, gogmaCounterBefore: 0, gogmaCounterAfter: 0 }], productionRngEngine.capabilities)
    const skills = deriveRngCapabilities(preview, normalCounters, [{ type: 'reset_skills', sourceOwnedWeaponId: null, skillCounterBefore: 0, skillCounterAfter: 0 }], productionRngEngine.capabilities)
    return [...new Set<RngCapabilityMissingRequirement>([
      ...gogma.missingRequirements as RngCapabilityMissingRequirement[],
      ...skills.missingRequirements as RngCapabilityMissingRequirement[],
    ])]
  }, [normalCounters, preview])

  const save = async () => {
    if (!state || !form) return
    setError(null); setNotice(null)
    try {
      const next = toState(form, state, modifiedKeys, new Date().toISOString(), productionRngEngine)
      const validation = validateRngState(next)
      if (!validation.isValid) throw new Error(validation.issues.map(({ message }) => message).join(' / '))
      const saved = await dependencies.save(next)
      setState(saved); setForm(toForm(saved)); setModifiedKeys(new Set()); setNotice('RNG状態を保存しました。')
    } catch (caught: unknown) { setError(caught instanceof Error ? caught.message : 'RNG状態を保存できません。') }
  }

  const startIdentification = () => {
    setError(null)
    setNotice(null)
    if (hasUnsavedChanges) {
      setError('Identification Wizardを開始する前に、RNG状態設定の変更を保存するか元に戻してください。')
      return
    }
    try {
      setIdentificationCoordinator(
        (dependencies.createIdentificationCoordinator ??
          createProductionIdentificationWizardCoordinator)(),
      )
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'Identification Wizardを開始できません。')
    }
  }

  const handleIdentificationAdopted = (saved: RngState) => {
    setState(saved)
    setForm(toForm(saved))
    setModifiedKeys(new Set())
    setNotice('Identification結果をRNG状態へ採用しました。')
  }

  return <PageShell title="RNG状態設定" description="検索や予測に使うRNG状態を項目ごとに設定します。"><Stack spacing={3}>
    {!form && !error && <LinearProgress />}{error && <Alert severity="error">{error}</Alert>}{notice && <Alert severity="success">{notice}</Alert>}
    {form && <><Alert severity="info">正しいことを確認できた値だけ「この値を検索・予測に使用する」を選択してください。直接入力した値の取得方法は「手動入力」になります。空欄は既存値を変更しません。</Alert><Paper variant="outlined" sx={{ p: 2 }}><Stack spacing={1}><Typography variant="h2">値が分からない場合</Typography><Typography>Normal → Gogma conversionと連続Resetの観測から、Base Seedと調査開始前のSkill / Gogma Counterを専用Wizardで特定します。手動入力は引き続き利用できます。</Typography><Button variant="outlined" disabled={!masterResult.ok || identificationCoordinator !== null || hasUnsavedChanges} onClick={startIdentification}>Identification Wizardを開始</Button>{hasUnsavedChanges && <Alert severity="warning">Identification Wizardを開始する前に、RNG状態設定の変更を保存するか元に戻してください。</Alert>}{!masterResult.ok && <Alert severity="error">マスターデータが利用できないためWizardを開始できません。</Alert>}</Stack></Paper><KnownField fieldId="base-seed" label="Base Seed（基準シード）" description="10進数または0xで始まる16進数を入力します。保存時に予測用の10進文字列へ正規化します。" value={form.baseSeed} onChange={(value) => updateField('baseSeed', value)} /><KnownField fieldId="gogma-counter" label="巨戟カウンター" description="巨戟アーティアの復元ボーナス予測に使う位置です。" numeric value={form.gogmaCounter} onChange={(value) => updateField('gogmaCounter', value)} /><KnownField fieldId="skill-counter" label="スキルカウンター" description="シリーズ・グループスキル予測に使う位置です。" numeric value={form.skillCounter} onChange={(value) => updateField('skillCounter', value)} /><KnownField fieldId="counter-gate" label="Counter Gate（カウンターゲート）" description="legacy / diagnostic / compatibility情報です。Production予測やIdentificationのauthorityではありません。" numeric value={form.counterGate} onChange={(value) => updateField('counterGate', value)} /><TextField label="メモ" multiline minRows={2} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /><Button variant="contained" onClick={() => void save()}>保存</Button></>}
    <Paper variant="outlined" sx={{ p: 2 }}><Typography variant="h2" gutterBottom>Production RNG Engine</Typography><Stack spacing={1}><Typography>Engine mode: {productionRngRuntime.mode}</Typography><Typography>Engine version: {productionRngRuntime.version}</Typography><Typography>通常アーティア予測 capability: {productionRngRuntime.capabilities.supportsNormalArtianPrediction ? '対応' : '未対応'}</Typography><Typography>スキル予測 capability: {productionRngRuntime.capabilities.supportsSkillPrediction ? '対応' : '未対応'}</Typography><Typography>巨戟アーティア予測 capability: {productionRngRuntime.capabilities.supportsGogmaPrediction ? '対応' : '未対応'}</Typography><Typography>Keep Bonuses予測 capability: {productionRngRuntime.capabilities.supportsKeepBonusesPrediction ? '対応' : '未対応'}</Typography><Typography>Seed Search capability: {productionRngRuntime.capabilities.supportsSeedSearch ? '対応' : '未対応'}</Typography></Stack></Paper>
    {capabilities && <Paper variant="outlined" sx={{ p: 2 }}><Typography variant="h2" gutterBottom>現在のRNG状態で利用可能な機能</Typography><Stack spacing={1}><Typography>巨戟アーティア予測: {capabilities.canPredictGogma ? '利用可能' : '利用不可'}</Typography><Typography>スキル予測: {capabilities.canPredictSkills ? '利用可能' : '利用不可'}</Typography><Typography>通常アーティア検索: {capabilities.canSearchNormalArtian ? '利用可能' : '利用不可'}</Typography><Typography>生産計画作成: Production Engine有効（必要項目は作成ルートにより異なります）</Typography>{displayedRequirements.length > 0 && <Alert severity="warning"><Typography variant="subtitle2">現在不足している項目</Typography>{displayedRequirements.map((requirement) => <Typography variant="body2" key={requirement}>{getRngMissingRequirementLabel(requirement)}</Typography>)}</Alert>}</Stack></Paper>}
    {identificationCoordinator && state && masterResult.ok && <IdentificationWizardDialog coordinator={identificationCoordinator} initialRngState={state} master={masterResult.data} onAdopted={handleIdentificationAdopted} onClose={() => setIdentificationCoordinator(null)} />}
  </Stack></PageShell>
}
