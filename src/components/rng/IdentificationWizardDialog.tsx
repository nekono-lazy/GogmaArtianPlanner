import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import {
  Alert, AlertTitle, Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle,
  FormControl, FormControlLabel, InputLabel, LinearProgress, MenuItem,
  Select, Stack, TextField, Typography,
} from '@mui/material'
import { StatusChip, type StatusTone } from '../StatusChip'
import type { MasterDataRoot } from '../../domain/master/masterTypes'
import { getEnabledElements, getEnabledWeaponTypes } from '../../domain/master/masterSelectors'
import {
  getProductionAvailableBonusDefinitions, getProductionAvailableBonusTypeIds,
  getProductionAvailableRanksForBonusType, ProductionBonusAvailabilityError,
} from '../../domain/artian/productionBonusAvailability'
import { productionBonusAvailabilityErrorMessage } from '../forms/productionBonusAvailabilityText'
import type {
  BonusRankId, BonusTypeId, GroupSkillId, RestorationBonusSet, RngState,
  SeriesSkillId,
} from '../../domain/models/publicTypes'
import {
  CANONICAL_BASE_SEED_MAX, CANONICAL_BASE_SEED_MIN,
  MAX_GOGMA_IDENTIFICATION_COUNTER,
  type CompleteSkillObservation, type InclusiveNumberRange,
} from '../../domain/rng/identification'
import { REFERENCE_GROUP_SKILL_POOL, REFERENCE_SERIES_SKILL_POOL } from '../../domain/rng/production/referenceSkillPools'
import type {
  IdentificationResultClassification, IdentificationWizardCoordinator,
  IdentificationWizardErrorState, IdentificationWizardState,
} from '../../services/rngIdentification/identificationWizardCoordinator'

const INITIAL_OBSERVATION_COUNT = 4
const DEFAULT_COUNTER_RADIUS = 5
/**
 * STEP 1 Seed range starts at the canonical Base Seed domain
 * (`docs/UI_FLOW.md` 5.4). The user may narrow it; it is never widened
 * automatically. The constants are the identification Domain's own authority.
 */
const INITIAL_SEED_RANGE_START = String(CANONICAL_BASE_SEED_MIN)
const INITIAL_SEED_RANGE_END = String(CANONICAL_BASE_SEED_MAX)
/**
 * A Seed range draft is canonical decimal only: empty while editing, otherwise
 * 0-9 up to eight digits. Sign, decimal point, exponent, whitespace, letters and
 * a ninth digit are refused at the draft boundary, so a paste or programmatic
 * change can no longer put them into state. This is the Wizard's search-range
 * UX only; the RNG Setup manual Base Seed keeps its raw decimal / hexadecimal
 * `normalizeSeed()` contract.
 */
const SEED_RANGE_DRAFT_PATTERN = /^[0-9]{0,8}$/
const SEED_RANGE_MAX_LENGTH = 8

function isSeedRangeDraft(value: string): boolean {
  return SEED_RANGE_DRAFT_PATTERN.test(value)
}

interface ApproximateCounterDraft { readonly center: string; readonly radius: string }
interface SkillObservationDraft {
  readonly seriesSkillId: SeriesSkillId | null
  readonly groupSkillId: GroupSkillId | null
}
interface BonusSlotDraft {
  readonly bonusTypeId: BonusTypeId | null
  readonly bonusRankId: BonusRankId | null
}
type BonusObservationDraft = [
  BonusSlotDraft, BonusSlotDraft, BonusSlotDraft, BonusSlotDraft, BonusSlotDraft,
]

export interface IdentificationWizardDialogProps {
  coordinator: IdentificationWizardCoordinator
  initialRngState: RngState
  master: MasterDataRoot
  onAdopted(state: RngState): void
  onClose(): void
}

/**
 * Smartphone: a narrower outer margin keeps the long form usable at 375px. The
 * title, step indicator and actions stay outside the scrolling content (MUI
 * `scroll="paper"`), so Restart / Close stay reachable however long it grows.
 */
const dialogPaperSx = {
  m: { xs: 1, sm: 4 },
  width: { xs: 'calc(100% - 16px)', sm: 'calc(100% - 64px)' },
  maxHeight: { xs: 'calc(100% - 16px)', sm: 'calc(100% - 64px)' },
}

const fieldPairSx = { display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'repeat(2, minmax(0, 1fr))' }, gap: 1.5 } as const
const buttonSx = { minHeight: 44 } as const

function emptySkillObservation(): SkillObservationDraft {
  return { seriesSkillId: null, groupSkillId: null }
}

function emptySkillObservations(): SkillObservationDraft[] {
  return Array.from({ length: INITIAL_OBSERVATION_COUNT }, emptySkillObservation)
}

function emptyBonusObservation(): BonusObservationDraft {
  return Array.from(
    { length: 5 },
    () => ({ bonusTypeId: null, bonusRankId: null }),
  ) as BonusObservationDraft
}

function emptyBonusObservations(): BonusObservationDraft[] {
  return Array.from({ length: INITIAL_OBSERVATION_COUNT }, emptyBonusObservation)
}

function completeSkillObservations(
  drafts: readonly SkillObservationDraft[],
  validSeriesSkillIds: ReadonlySet<SeriesSkillId>,
  validGroupSkillIds: ReadonlySet<GroupSkillId>,
): CompleteSkillObservation[] {
  return drafts.map((draft, index) => {
    if (
      draft.seriesSkillId === null || draft.groupSkillId === null ||
      !validSeriesSkillIds.has(draft.seriesSkillId) ||
      !validGroupSkillIds.has(draft.groupSkillId)
    ) {
      throw new Error(`Skill Observation ${index + 1}のSeries SkillとGroup Skillを入力してください。`)
    }
    return {
      seriesSkillId: draft.seriesSkillId,
      groupSkillId: draft.groupSkillId,
    }
  })
}

/**
 * The Production Reset availability the observation Selects offer
 * (`docs/RNG_SPEC.md` 6.1.1), so a slot the Reset cannot draw never completes.
 */
function productionResetDefinitions(
  master: MasterDataRoot,
  weaponTypeId: string,
  elementId: string,
) {
  try {
    return getProductionAvailableBonusDefinitions(master, weaponTypeId, elementId, 'gogma_artian')
  } catch (caught) {
    if (caught instanceof ProductionBonusAvailabilityError) {
      throw new Error(productionBonusAvailabilityErrorMessage(caught), { cause: caught })
    }
    throw caught
  }
}

function completeBonusObservations(
  drafts: readonly BonusObservationDraft[],
  master: MasterDataRoot,
  weaponTypeId: string,
  elementId: string,
): RestorationBonusSet[] {
  const validPairs = new Set(
    productionResetDefinitions(master, weaponTypeId, elementId).map(({ bonusTypeId, bonusRankId }) => `${bonusTypeId}\u0000${bonusRankId}`),
  )
  return drafts.map((draft, observationIndex) => draft.map((slot, slotIndex) => {
    if (
      slot.bonusTypeId === null || slot.bonusRankId === null ||
      !validPairs.has(`${slot.bonusTypeId}\u0000${slot.bonusRankId}`)
    ) {
      throw new Error(`Reset Observation ${observationIndex + 1}の枠${slotIndex + 1}を完成させてください。`)
    }
    return { bonusTypeId: slot.bonusTypeId, bonusRankId: slot.bonusRankId }
  }) as RestorationBonusSet)
}

function parseNonNegativeInteger(value: string, label: string): number {
  if (value.trim() === '') throw new Error(`${label}を入力してください。`)
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`${label}は0以上の安全な整数で入力してください。`)
  return parsed
}

function parseInclusiveRange(start: string, end: string, label: string, maximum: number): InclusiveNumberRange {
  const startInclusive = parseNonNegativeInteger(start, `${label}の開始`)
  const endInclusive = parseNonNegativeInteger(end, `${label}の終了`)
  if (endInclusive < startInclusive || endInclusive > maximum) {
    throw new Error(`${label}は0から${maximum}までの昇順inclusive rangeで入力してください。`)
  }
  return { startInclusive, endInclusive }
}

function parseApproximateRange(draft: ApproximateCounterDraft, label: string, maximum: number): InclusiveNumberRange {
  const center = parseNonNegativeInteger(draft.center, `概算${label}`)
  const radius = parseNonNegativeInteger(draft.radius, `${label}の±幅`)
  if (center > maximum) throw new Error(`概算${label}は${maximum}以下で入力してください。`)
  return { startInclusive: Math.max(0, center - radius), endInclusive: Math.min(maximum, center + radius) }
}

function previewApproximateRange(draft: ApproximateCounterDraft, maximum: number): string {
  try {
    const range = parseApproximateRange(draft, 'Counter', maximum)
    const count = range.endInclusive - range.startInclusive + 1
    return `${range.startInclusive} ～ ${range.endInclusive}（inclusive・${count.toLocaleString()}候補）`
  } catch { return '中心値を入力すると検索範囲を表示します。' }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '不明なエラーが発生しました。'
}

function classificationAlert(classification: IdentificationResultClassification | null, step: 'skill' | 'gogma') {
  if (classification === null) return null
  if (classification === 'unique') return <Alert severity="success">完全な探索で一意に特定できました。</Alert>
  if (classification === 'multiple') return <Alert severity="warning">候補が複数あります。候補は選択せず、連続する次の{step === 'skill' ? 'Skill Reset' : 'Reset Bonuses'}結果をObservationへ追加して再検索してください。</Alert>
  if (classification === 'incomplete') return <Alert severity="warning">探索が完全ではないため一意と判定できません。入力と診断情報を確認して同じ範囲を再検索してください。</Alert>
  return <Alert severity="warning">一致する結果がありません。Observationの入力内容、Counter range、実ゲームで行った操作順序を確認してください。範囲は自動拡張されません。</Alert>
}

function errorAlert(error: IdentificationWizardErrorState | null) {
  if (error === null) return null
  if (error.kind === 'cancelled') return <Alert severity="info">検索をキャンセルしました。入力を保持したまま再検索できます。</Alert>
  const prefix = error.kind === 'invalid_input' ? '入力エラー'
    : error.kind === 'unsupported_input' ? '未対応の入力'
      : error.kind === 'worker_unavailable' ? 'Workerを利用できません'
        : error.kind === 'incomplete_parallel_chunk' ? '並列探索を完全に統合できません'
          : '検索処理エラー'
  return <Alert severity="error">{prefix}: {errorMessage(error.error)}</Alert>
}

/**
 * A short status word for one STEP. It only names the Coordinator's own status,
 * classification and error kind; it never re-derives a result.
 */
function searchStatus(step: IdentificationWizardState['skill'] | IdentificationWizardState['gogma']): { label: string; tone: StatusTone } {
  if (step.status === 'idle') return { label: '未検索', tone: 'neutral' }
  if (step.status === 'searching') return { label: '検索中', tone: 'info' }
  if (step.status === 'cancelled') return { label: 'キャンセル済み', tone: 'neutral' }
  if (step.status === 'error') return { label: 'エラー', tone: 'caution' }
  if (step.classification === 'unique') return { label: '一意に特定', tone: 'positive' }
  if (step.classification === 'multiple') return { label: '候補が複数', tone: 'caution' }
  if (step.classification === 'incomplete') return { label: '探索未完了', tone: 'caution' }
  if (step.classification === 'zero') return { label: '一致なし', tone: 'caution' }
  return { label: '完了', tone: 'neutral' }
}

type StepProgress = 'current' | 'done' | 'upcoming' | 'adopted'

/** The step position, derived from the same Coordinator state the sections use. */
function wizardStepProgress(state: IdentificationWizardState): readonly [StepProgress, StepProgress, StepProgress] {
  if (state.review !== null) return ['done', 'done', state.adoption.status === 'adopted' ? 'adopted' : 'current']
  if (state.skill.classification === 'unique') return ['done', 'current', 'upcoming']
  return ['current', 'upcoming', 'upcoming']
}

const stepProgressLabels: Record<StepProgress, string> = {
  current: '現在',
  done: '完了',
  upcoming: '未到達',
  adopted: '採用済み',
}

function StepIndicator({ state }: { state: IdentificationWizardState }) {
  const progress = wizardStepProgress(state)
  const steps = ['STEP 1', 'STEP 2', 'Review / 採用']
  return (
    <Box component="nav" aria-label="Identificationの進行状況" sx={{ px: { xs: 2, sm: 3 }, pb: 1.5 }}>
      <Box component="ol" sx={{ m: 0, p: 0, display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 0.75 }}>
        {steps.map((label, index) => {
          const status = progress[index]!
          const current = status === 'current'
          return (
            <Box
              component="li"
              key={label}
              aria-current={current ? 'step' : undefined}
              sx={{
                listStyle: 'none', minWidth: 0, px: 1, py: 0.5, borderRadius: 1,
                border: current ? 2 : 1,
                borderStyle: status === 'upcoming' ? 'dashed' : 'solid',
                borderColor: current ? 'primary.main' : 'divider',
                bgcolor: current ? 'action.selected' : 'transparent',
              }}
            >
              <Typography component="span" variant="subtitle2" sx={{ display: 'block', overflowWrap: 'anywhere', lineHeight: 1.3 }}>{label}</Typography>
              <Typography component="span" variant="caption" color={current ? 'primary' : 'text.secondary'} sx={{ display: 'block', fontWeight: current ? 600 : 400 }}>
                {stepProgressLabels[status]}
              </Typography>
            </Box>
          )
        })}
      </Box>
    </Box>
  )
}

/** A bordered STEP section with its own h3 heading under the Dialog title. */
function StepSection({ title, status, children }: { title: string; status?: { label: string; tone: StatusTone }; children: ReactNode }) {
  const headingId = useId()
  return (
    <Box component="section" aria-labelledby={headingId} sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: { xs: 1.5, sm: 2 }, minWidth: 0 }}>
      <Stack spacing={2}>
        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography id={headingId} component="h3" variant="h2" sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>{title}</Typography>
          {status && <Box role="status"><StatusChip label={status.label} tone={status.tone} /></Box>}
        </Stack>
        {children}
      </Stack>
    </Box>
  )
}

function SubHeading({ children }: { children: ReactNode }) {
  return <Typography component="h4" variant="subtitle1">{children}</Typography>
}

function SearchProgress({ completed, total, matches }: { completed: number; total: number; matches: number }) {
  const percent = total > 0 ? Math.min(100, (completed / total) * 100) : 0
  const textId = useId()
  return <Stack spacing={0.5} role="group" aria-label="検索進捗"><LinearProgress variant="determinate" value={percent} aria-labelledby={textId} /><Typography id={textId} variant="body2" className="tabular-nums">{completed.toLocaleString()} / {total.toLocaleString()}（一致 {matches.toLocaleString()}件）</Typography></Stack>
}

function ApproximateCounterFields({ label, draft, maximum, disabled, onChange }: { label: string; draft: ApproximateCounterDraft; maximum: number; disabled: boolean; onChange(value: ApproximateCounterDraft): void }) {
  return <Stack spacing={1}>
    <Box sx={fieldPairSx}>
      <TextField fullWidth label={`概算${label}`} type="number" value={draft.center} disabled={disabled} slotProps={{ htmlInput: { min: 0, max: maximum, step: 1 } }} onChange={(event) => onChange({ ...draft, center: event.target.value })} />
      <TextField fullWidth label={`${label}の±幅`} type="number" value={draft.radius} disabled={disabled} slotProps={{ htmlInput: { min: 0, step: 1 } }} onChange={(event) => onChange({ ...draft, radius: event.target.value })} />
    </Box>
    <Box sx={{ px: 1.5, py: 1, borderLeft: 3, borderColor: 'primary.main', bgcolor: 'background.default', borderRadius: 1 }}>
      <Typography variant="body2" className="tabular-nums" sx={{ fontWeight: 500, overflowWrap: 'anywhere' }}>検索範囲: {previewApproximateRange(draft, maximum)}</Typography>
    </Box>
  </Stack>
}

/** One numbered observation card: title, completion, delete, then its inputs. */
function ObservationCard({ dataAttribute, title, subtitle, completion, deleteLabel, deleteDisabled, onDelete, children }: {
  dataAttribute: Record<string, number>
  title: string
  subtitle?: string
  completion: { label: string; tone: StatusTone }
  deleteLabel: string
  deleteDisabled: boolean
  onDelete(): void
  children: ReactNode
}) {
  return (
    <Box component="li" {...dataAttribute} sx={{ listStyle: 'none', border: 1, borderColor: 'divider', borderRadius: 1, p: { xs: 1.5, sm: 2 }, minWidth: 0 }}>
      <Stack spacing={1.5}>
        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
          <Box sx={{ flex: '1 1 auto', minWidth: 0 }}>
            <Typography component="h5" variant="subtitle2" sx={{ overflowWrap: 'anywhere' }}>{title}</Typography>
            {subtitle && <Typography variant="caption" color="text.secondary" component="p">{subtitle}</Typography>}
          </Box>
          <StatusChip label={completion.label} tone={completion.tone} />
          <Button color="error" aria-label={deleteLabel} disabled={deleteDisabled} onClick={onDelete} sx={{ minHeight: 44, minWidth: 64 }}>削除</Button>
        </Stack>
        {children}
      </Stack>
    </Box>
  )
}

function BonusObservationEditor({
  label, master, weaponTypeId, elementId, value, disabled, onChange,
}: {
  label: string
  master: MasterDataRoot
  weaponTypeId: string
  elementId: string
  value: BonusObservationDraft
  disabled: boolean
  onChange(value: BonusObservationDraft): void
}) {
  // Options follow the Production Reset candidates of the STEP 1 weapon type /
  // element, never the Master-only `getBonusDefinitionsForWeapon()`.
  let typeIds: string[]
  try {
    typeIds = getProductionAvailableBonusTypeIds(master, weaponTypeId, elementId, 'gogma_artian')
  } catch (caught) {
    if (caught instanceof ProductionBonusAvailabilityError) {
      return <Alert severity="error">{label}: {productionBonusAvailabilityErrorMessage(caught)}</Alert>
    }
    throw caught
  }
  const fieldIdPrefix = label.replaceAll(' ', '-').toLowerCase()

  const update = (index: number, nextSlot: BonusSlotDraft) => {
    const next = value.map((slot) => ({ ...slot })) as BonusObservationDraft
    next[index] = nextSlot
    onChange(next)
  }

  // Type and rank sit side by side at every width, so each rank reads as
  // belonging to its slot on a narrow screen too.
  return <Box component="ol" aria-label={`${label}の5枠`} sx={{ m: 0, p: 0, display: 'grid', gap: 1.25 }}>
    {value.map((slot, index) => {
      const ranks = slot.bonusTypeId === null
        ? []
        : getProductionAvailableRanksForBonusType(
          master, weaponTypeId, elementId, slot.bonusTypeId, 'gogma_artian',
        )
      return <Box component="li" key={index} sx={{ listStyle: 'none', display: 'grid', gridTemplateColumns: 'minmax(0, 1.6fr) minmax(0, 1fr)', gap: 1 }}>
        <FormControl fullWidth disabled={disabled}>
          <InputLabel shrink id={`${fieldIdPrefix}-${index}-type`}>枠{index + 1} ボーナス種別</InputLabel>
          <Select
            displayEmpty
            labelId={`${fieldIdPrefix}-${index}-type`}
            label={`枠${index + 1} ボーナス種別`}
            value={slot.bonusTypeId ?? ''}
            onChange={(event) => update(index, {
              bonusTypeId: event.target.value === '' ? null : event.target.value,
              bonusRankId: null,
            })}
          >
            <MenuItem value=""><em>未入力</em></MenuItem>
            {typeIds.map((id) => (
              <MenuItem key={id} value={id} sx={{ whiteSpace: 'normal', overflowWrap: 'anywhere' }}>
                {master.bonusTypes.find((type) => type.id === id)?.displayNameJa ?? '不明'}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <FormControl fullWidth disabled={disabled || slot.bonusTypeId === null}>
          <InputLabel shrink id={`${fieldIdPrefix}-${index}-rank`}>枠{index + 1} ランク</InputLabel>
          <Select
            displayEmpty
            labelId={`${fieldIdPrefix}-${index}-rank`}
            label={`枠${index + 1} ランク`}
            value={slot.bonusRankId ?? ''}
            onChange={(event) => update(index, {
              bonusTypeId: slot.bonusTypeId,
              bonusRankId: event.target.value === '' ? null : event.target.value,
            })}
          >
            <MenuItem value=""><em>未入力</em></MenuItem>
            {ranks.map((rank) => (
              <MenuItem key={rank.id} value={rank.id}>{rank.displayNameJa}</MenuItem>
            ))}
          </Select>
        </FormControl>
      </Box>
    })}
  </Box>
}

export function IdentificationWizardDialog({
  coordinator, initialRngState, master, onAdopted, onClose,
}: IdentificationWizardDialogProps) {
  const subscribe = useCallback((listener: () => void) => coordinator.subscribe(listener), [coordinator])
  const getSnapshot = useCallback(() => coordinator.getState(), [coordinator])
  const wizardState = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  // The Dialog owns only presentation lifecycle and the Coordinator subscription.
  // Coordinator lifetime belongs to the Application side that created it, so a
  // development StrictMode effect replay must never dispose a still-live Coordinator.
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [coordinator])

  const weaponTypes = useMemo(() => getEnabledWeaponTypes(master), [master])
  const elements = useMemo(() => getEnabledElements(master), [master])
  const seriesSkills = useMemo(
    () => REFERENCE_SERIES_SKILL_POOL
      .map((id) => master.seriesSkills.find((skill) => skill.id === id))
      .filter((skill): skill is NonNullable<typeof skill> => Boolean(skill?.isEnabled)),
    [master],
  )
  const groupSkills = useMemo(
    () => REFERENCE_GROUP_SKILL_POOL
      .map((id) => master.groupSkills.find((skill) => skill.id === id))
      .filter((skill): skill is NonNullable<typeof skill> => Boolean(skill?.isEnabled)),
    [master],
  )
  const initialWeaponTypeId = weaponTypes[0]?.id ?? ''
  const initialElementId = elements[0]?.id ?? ''
  const [weaponTypeId, setWeaponTypeId] = useState(initialWeaponTypeId)
  const [elementId, setElementId] = useState(initialElementId)
  const [skillObservations, setSkillObservations] = useState(emptySkillObservations)
  const [seedStart, setSeedStart] = useState(INITIAL_SEED_RANGE_START)
  const [seedEnd, setSeedEnd] = useState(INITIAL_SEED_RANGE_END)
  const [skillRange, setSkillRange] = useState<ApproximateCounterDraft>({
    center: initialRngState.skillCounter.value === null ? '' : String(initialRngState.skillCounter.value),
    radius: String(DEFAULT_COUNTER_RADIUS),
  })
  const [gogmaRange, setGogmaRange] = useState<ApproximateCounterDraft>({
    center: initialRngState.gogmaCounter.value === null ? '' : String(initialRngState.gogmaCounter.value),
    radius: String(DEFAULT_COUNTER_RADIUS),
  })
  const [gogmaObservations, setGogmaObservations] = useState(emptyBonusObservations)
  const [step1FormError, setStep1FormError] = useState<string | null>(null)
  const [step2FormError, setStep2FormError] = useState<string | null>(null)

  const authoritativeStep1Input = wizardState.skill.input
  const step2WeaponTypeId = authoritativeStep1Input?.weaponTypeId ?? weaponTypeId
  const step2ElementId = authoritativeStep1Input?.elementId ?? elementId
  const step2InputKey = `${step2WeaponTypeId}\u0000${step2ElementId}`
  const previousStep2InputKey = useRef(step2InputKey)
  useEffect(() => {
    if (previousStep2InputKey.current === step2InputKey) return
    previousStep2InputKey.current = step2InputKey
    setGogmaObservations(emptyBonusObservations())
  }, [step2InputKey])

  const skillSearching = wizardState.skill.status === 'searching'
  const gogmaSearching = wizardState.gogma.status === 'searching'
  const adopting = wizardState.adoption.status === 'adopting'

  const identifySkill = async () => {
    setStep1FormError(null)
    try {
      const seedRange = parseInclusiveRange(seedStart, seedEnd, 'Base Seed range', CANONICAL_BASE_SEED_MAX)
      const skillCounterRange = parseApproximateRange(
        skillRange, 'Skill Counter', Math.floor((Number.MAX_SAFE_INTEGER - 1) / 10),
      )
      const observations = completeSkillObservations(
        skillObservations,
        new Set(seriesSkills.map(({ id }) => id)),
        new Set(groupSkills.map(({ id }) => id)),
      )
      await coordinator.identifySkill({
        weaponTypeId,
        elementId,
        observations,
        seedRange,
        skillCounterRange,
      })
    } catch (error) {
      const status = coordinator.getState().skill.status
      if (status !== 'error' && status !== 'cancelled') setStep1FormError(errorMessage(error))
    }
  }

  const identifyGogma = async () => {
    setStep2FormError(null)
    try {
      const gogmaCounterRange = parseApproximateRange(
        gogmaRange, 'Gogma Counter', MAX_GOGMA_IDENTIFICATION_COUNTER,
      )
      const observations = completeBonusObservations(
        gogmaObservations, master, step2WeaponTypeId, step2ElementId,
      )
      await coordinator.identifyGogma({
        weaponTypeId: step2WeaponTypeId,
        elementId: step2ElementId,
        observations,
        gogmaCounterRange,
        master: {
          weaponTypes: master.weaponTypes,
          elements: master.elements,
          bonusTypes: master.bonusTypes,
          weaponBonusDefinitions: master.weaponBonusDefinitions,
        },
      })
    } catch (error) {
      const status = coordinator.getState().gogma.status
      if (status !== 'error' && status !== 'cancelled') setStep2FormError(errorMessage(error))
    }
  }

  const adopt = async () => {
    try {
      const saved = await coordinator.adopt()
      if (mounted.current) onAdopted(saved)
    } catch {
      // Coordinator publishes the failure while retaining review and confirmation.
    }
  }

  const restart = () => {
    setStep1FormError(null)
    setStep2FormError(null)
    setWeaponTypeId(initialWeaponTypeId)
    setElementId(initialElementId)
    setSkillObservations(emptySkillObservations())
    setSeedStart(INITIAL_SEED_RANGE_START)
    setSeedEnd(INITIAL_SEED_RANGE_END)
    setSkillRange({
      center: initialRngState.skillCounter.value === null
        ? ''
        : String(initialRngState.skillCounter.value),
      radius: String(DEFAULT_COUNTER_RADIUS),
    })
    setGogmaRange({
      center: initialRngState.gogmaCounter.value === null
        ? ''
        : String(initialRngState.gogmaCounter.value),
      radius: String(DEFAULT_COUNTER_RADIUS),
    })
    setGogmaObservations(emptyBonusObservations())
    coordinator.restart()
  }

  const nameOf = (list: readonly { id: string; displayNameJa: string }[], id: string) =>
    list.find((entry) => entry.id === id)?.displayNameJa ?? id

  return (
    <Dialog
      open
      fullWidth
      maxWidth="md"
      slotProps={{ paper: { sx: dialogPaperSx } }}
      onClose={(_, reason) => {
        if (!adopting && reason !== 'backdropClick') onClose()
      }}
    >
      <DialogTitle sx={{ px: { xs: 2, sm: 3 }, pb: 1 }}>RNG Identification Wizard</DialogTitle>
      <StepIndicator state={wizardState} />
      <DialogContent dividers sx={{ px: { xs: 2, sm: 3 } }}>
        <Stack spacing={{ xs: 2, sm: 3 }}>
          <Alert severity="warning">
            <AlertTitle>開始前に必ず確認してください</AlertTitle>
            <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
              <li>観測結果の記録が終わるまでゲーム状態を保存しないでください。</li>
              <li>開始前にバックアップ方法と自動保存の設定・挙動を確認してください。</li>
              <li>案内された操作だけを順番に連続して行ってください。</li>
              <li>観測後は調査前の状態へ戻してから採用します。</li>
              <li>ゲーム側の保存仕様や安全をこのアプリが保証するものではありません。</li>
            </Box>
          </Alert>
          <Alert severity="info">
            <AlertTitle>検証範囲</AlertTitle>
            Production Identificationは実機確認済みです。ただし確認条件は限定されており、全武器種・全属性・全ゲームバージョンを保証するものではありません。採用後の予測結果はゲーム側でも確認してください。
          </Alert>

          <StepSection title="STEP 1 — Base Seed / Starting Skill Counter" status={searchStatus(wizardState.skill)}>
            <Typography>
              Normal → Gogma conversionで自動付与されたSkillをObservation 1へ記録し、その後の連続したSkill Reset結果をObservation 2以降へ順番どおり記録します。
            </Typography>
            <Stack spacing={1}>
              <SubHeading>観測する武器</SubHeading>
              <Box sx={fieldPairSx}>
                <FormControl fullWidth disabled={skillSearching}>
                  <InputLabel id="identification-weapon-type-label">Weapon Type</InputLabel>
                  <Select labelId="identification-weapon-type-label" label="Weapon Type" value={weaponTypeId} onChange={(event) => setWeaponTypeId(event.target.value)}>
                    {weaponTypes.map((weaponType) => <MenuItem key={weaponType.id} value={weaponType.id}>{weaponType.displayNameJa}</MenuItem>)}
                  </Select>
                </FormControl>
                <FormControl fullWidth disabled={skillSearching}>
                  <InputLabel id="identification-element-label">Element</InputLabel>
                  <Select labelId="identification-element-label" label="Element" value={elementId} onChange={(event) => setElementId(event.target.value)}>
                    {elements.map((element) => <MenuItem key={element.id} value={element.id}>{element.displayNameJa}</MenuItem>)}
                  </Select>
                </FormControl>
              </Box>
            </Stack>
            <Stack spacing={1}>
              <SubHeading>ordered Skill observations（記録順）</SubHeading>
              <Box component="ol" sx={{ m: 0, p: 0, display: 'grid', gap: 1.25 }}>
                {skillObservations.map((observation, index) => {
                  const complete = observation.seriesSkillId !== null && observation.groupSkillId !== null
                  return (
                    <ObservationCard
                      key={index}
                      dataAttribute={{ 'data-skill-observation': index + 1 }}
                      title={`Observation ${index + 1}`}
                      subtitle={index === 0 ? 'conversion自動Skill' : `連続Skill Reset ${index}`}
                      completion={complete ? { label: '入力済み', tone: 'positive' } : { label: '未入力あり', tone: 'neutral' }}
                      deleteLabel={`Observation ${index + 1}を削除`}
                      deleteDisabled={skillSearching || skillObservations.length === 1}
                      onDelete={() => setSkillObservations((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                    >
                      <Box sx={fieldPairSx}>
                        <FormControl fullWidth disabled={skillSearching}>
                          <InputLabel shrink id={`skill-observation-${index}-series-label`}>Observation {index + 1} Series Skill</InputLabel>
                          <Select
                            displayEmpty
                            labelId={`skill-observation-${index}-series-label`}
                            label={`Observation ${index + 1} Series Skill`}
                            value={observation.seriesSkillId ?? ''}
                            onChange={(event) => {
                              const next = [...skillObservations]
                              next[index] = {
                                ...observation,
                                seriesSkillId: event.target.value === '' ? null : event.target.value,
                              }
                              setSkillObservations(next)
                            }}
                          >
                            <MenuItem value=""><em>未入力</em></MenuItem>
                            {seriesSkills.map((skill) => <MenuItem key={skill.id} value={skill.id} sx={{ whiteSpace: 'normal', overflowWrap: 'anywhere' }}>{skill.displayNameJa}</MenuItem>)}
                          </Select>
                        </FormControl>
                        <FormControl fullWidth disabled={skillSearching}>
                          <InputLabel shrink id={`skill-observation-${index}-group-label`}>Observation {index + 1} Group Skill</InputLabel>
                          <Select
                            displayEmpty
                            labelId={`skill-observation-${index}-group-label`}
                            label={`Observation ${index + 1} Group Skill`}
                            value={observation.groupSkillId ?? ''}
                            onChange={(event) => {
                              const next = [...skillObservations]
                              next[index] = {
                                ...observation,
                                groupSkillId: event.target.value === '' ? null : event.target.value,
                              }
                              setSkillObservations(next)
                            }}
                          >
                            <MenuItem value=""><em>未入力</em></MenuItem>
                            {groupSkills.map((skill) => <MenuItem key={skill.id} value={skill.id} sx={{ whiteSpace: 'normal', overflowWrap: 'anywhere' }}>{skill.displayNameJa}</MenuItem>)}
                          </Select>
                        </FormControl>
                      </Box>
                    </ObservationCard>
                  )
                })}
              </Box>
              <Box>
                <Button
                  variant="outlined"
                  sx={buttonSx}
                  disabled={skillSearching}
                  onClick={() => setSkillObservations((current) => [...current, emptySkillObservation()])}
                >
                  Skill Observationを追加
                </Button>
              </Box>
            </Stack>
            <Stack spacing={1.5}>
              <SubHeading>検索範囲</SubHeading>
              <Box sx={fieldPairSx}>
                <TextField
                  fullWidth label="Base Seed range start" type="text" value={seedStart}
                  disabled={skillSearching}
                  slotProps={{ htmlInput: { inputMode: 'numeric', pattern: '[0-9]*', maxLength: SEED_RANGE_MAX_LENGTH, className: 'tabular-nums' } }}
                  onChange={(event) => { if (isSeedRangeDraft(event.target.value)) setSeedStart(event.target.value) }}
                />
                <TextField
                  fullWidth label="Base Seed range end" type="text" value={seedEnd}
                  disabled={skillSearching}
                  slotProps={{ htmlInput: { inputMode: 'numeric', pattern: '[0-9]*', maxLength: SEED_RANGE_MAX_LENGTH, className: 'tabular-nums' } }}
                  onChange={(event) => { if (isSeedRangeDraft(event.target.value)) setSeedEnd(event.target.value) }}
                />
              </Box>
              <Typography variant="body2" color="text.secondary">
                初期値はBase Seed全域（{CANONICAL_BASE_SEED_MIN.toLocaleString()} ～ {CANONICAL_BASE_SEED_MAX.toLocaleString()}）です。数字のみ最大8桁で、必要なら狭い範囲へ変更できます。自動拡張やbackground wideningは行いません。
              </Typography>
              <ApproximateCounterFields
                label="Skill Counter"
                draft={skillRange}
                maximum={Math.floor((Number.MAX_SAFE_INTEGER - 1) / 10)}
                disabled={skillSearching}
                onChange={setSkillRange}
              />
            </Stack>
            {step1FormError && <Alert severity="error">{step1FormError}</Alert>}
            {wizardState.skill.progress && (
              <SearchProgress
                completed={wizardState.skill.progress.searchedSeeds}
                total={wizardState.skill.progress.totalSeeds}
                matches={wizardState.skill.progress.matchesFound}
              />
            )}
            {classificationAlert(wizardState.skill.classification, 'skill')}
            {errorAlert(wizardState.skill.error)}
            <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
              <Button variant="contained" sx={buttonSx} disabled={skillSearching || adopting} onClick={() => void identifySkill()}>
                STEP 1 Search
              </Button>
              <Button variant="outlined" sx={buttonSx} disabled={!skillSearching} onClick={() => coordinator.cancelSkill()}>
                STEP 1 Cancel
              </Button>
            </Stack>
          </StepSection>

          {wizardState.skill.classification === 'unique' && (
            <StepSection title="STEP 2 — Starting Gogma Counter" status={searchStatus(wizardState.gogma)}>
              <Box component="dl" sx={{ m: 0, display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'repeat(3, minmax(0, 1fr))' }, gap: 1, p: 1.5, border: 1, borderColor: 'divider', borderRadius: 1, bgcolor: 'background.default' }}>
                <Box sx={{ minWidth: 0 }}>
                  <Typography component="dt" variant="caption" color="text.secondary">Weapon Type</Typography>
                  <Typography component="dd" variant="body2" sx={{ m: 0, fontWeight: 500, overflowWrap: 'anywhere' }}>{nameOf(weaponTypes, step2WeaponTypeId)}</Typography>
                </Box>
                <Box sx={{ minWidth: 0 }}>
                  <Typography component="dt" variant="caption" color="text.secondary">Element</Typography>
                  <Typography component="dd" variant="body2" sx={{ m: 0, fontWeight: 500, overflowWrap: 'anywhere' }}>{nameOf(elements, step2ElementId)}</Typography>
                </Box>
                <Box sx={{ minWidth: 0 }}>
                  <Typography component="dt" variant="caption" color="text.secondary">STEP 1</Typography>
                  <Box component="dd" sx={{ m: 0 }}><StatusChip label="完了（一意に特定）" tone="positive" /></Box>
                </Box>
              </Box>
              <Typography>
                STEP 1で一意に特定したBase Seedを内部利用します。Base Seedの再入力は不要です。同じ武器でReset Bonusesだけを連続して行い、各5枠を枠順どおり記録してください。Keep Bonusesは使用しません。
              </Typography>
              <Stack spacing={1}>
                <SubHeading>ordered Gogma Reset observations（記録順）</SubHeading>
                <Box component="ol" sx={{ m: 0, p: 0, display: 'grid', gap: 1.25 }}>
                  {gogmaObservations.map((observation, index) => {
                    const filled = observation.filter((slot) => slot.bonusTypeId !== null && slot.bonusRankId !== null).length
                    return (
                      <ObservationCard
                        key={index}
                        dataAttribute={{ 'data-reset-observation': index + 1 }}
                        title={`Reset Observation ${index + 1}`}
                        completion={{ label: `入力 ${filled}/5枠`, tone: filled === 5 ? 'positive' : 'neutral' }}
                        deleteLabel={`Reset Observation ${index + 1}を削除`}
                        deleteDisabled={gogmaSearching || gogmaObservations.length === 1}
                        onDelete={() => setGogmaObservations((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                      >
                        <BonusObservationEditor
                          label={`Reset Observation ${index + 1}`}
                          master={master}
                          weaponTypeId={step2WeaponTypeId}
                          elementId={step2ElementId}
                          value={observation}
                          disabled={gogmaSearching}
                          onChange={(value) => {
                            const next = [...gogmaObservations]
                            next[index] = value
                            setGogmaObservations(next)
                          }}
                        />
                      </ObservationCard>
                    )
                  })}
                </Box>
                <Box>
                  <Button
                    variant="outlined"
                    sx={buttonSx}
                    disabled={gogmaSearching}
                    onClick={() => setGogmaObservations((current) => [...current, emptyBonusObservation()])}
                  >
                    Reset Observationを追加
                  </Button>
                </Box>
              </Stack>
              <Stack spacing={1.5}>
                <SubHeading>検索範囲</SubHeading>
                <ApproximateCounterFields
                  label="Gogma Counter"
                  draft={gogmaRange}
                  maximum={MAX_GOGMA_IDENTIFICATION_COUNTER}
                  disabled={gogmaSearching}
                  onChange={setGogmaRange}
                />
              </Stack>
              {step2FormError && <Alert severity="error">{step2FormError}</Alert>}
              {wizardState.gogma.progress && (
                <SearchProgress
                  completed={wizardState.gogma.progress.searchedCounters}
                  total={wizardState.gogma.progress.totalCounters}
                  matches={wizardState.gogma.progress.matchesFound}
                />
              )}
              {classificationAlert(wizardState.gogma.classification, 'gogma')}
              {errorAlert(wizardState.gogma.error)}
              <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
                <Button variant="contained" sx={buttonSx} disabled={gogmaSearching || adopting} onClick={() => void identifyGogma()}>
                  STEP 2 Search
                </Button>
                <Button variant="outlined" sx={buttonSx} disabled={!gogmaSearching} onClick={() => coordinator.cancelGogma()}>
                  STEP 2 Cancel
                </Button>
              </Stack>
            </StepSection>
          )}

          {wizardState.review && (
            <StepSection title="Review">
              <Box sx={{ p: 1.5, border: 1, borderColor: 'divider', borderRadius: 1, bgcolor: 'background.default' }}>
                <Stack spacing={0.5} className="tabular-nums">
                  <Typography sx={{ overflowWrap: 'anywhere' }}>Base Seed: {wizardState.review.baseSeed}</Typography>
                  <Typography>Starting Skill Counter: {wizardState.review.startingSkillCounter}</Typography>
                  <Typography>Starting Gogma Counter: {wizardState.review.startingGogmaCounter}</Typography>
                </Stack>
              </Box>
              <Alert severity="warning">
                表示値は調査開始前のstarting valuesです。Observation数は加算されません。ゲーム状態を調査前へ戻した後に採用してください。
              </Alert>
              <FormControlLabel
                sx={{ m: 0, minHeight: 44 }}
                control={(
                  <Checkbox
                    checked={wizardState.gameRestoredConfirmed}
                    disabled={adopting || wizardState.adoption.status === 'adopted'}
                    onChange={(event) => coordinator.setGameRestoredConfirmed(event.target.checked)}
                  />
                )}
                label="調査前のゲーム状態へ戻した"
              />
              {!wizardState.gameRestoredConfirmed && wizardState.adoption.status !== 'adopted' && (
                <Typography variant="body2" color="text.secondary">「調査前のゲーム状態へ戻した」を確認すると採用できます。</Typography>
              )}
              {wizardState.adoption.error && (
                <Alert severity="error">
                  Adoption failure: {errorMessage(wizardState.adoption.error.error)}。Reviewと復元確認を保持しています。再試行できます。
                </Alert>
              )}
              {wizardState.adoption.status === 'adopted' && (
                <Alert severity="success">Identification結果をRNG状態へ採用しました。</Alert>
              )}
              <Box>
                <Button
                  variant="contained"
                  sx={buttonSx}
                  disabled={!wizardState.gameRestoredConfirmed || adopting || wizardState.adoption.status === 'adopted'}
                  onClick={() => void adopt()}
                >
                  {adopting ? 'Adopting…' : 'Adopt starting values'}
                </Button>
              </Box>
            </StepSection>
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: { xs: 2, sm: 3 }, py: 1.5, gap: 1, justifyContent: 'space-between' }}>
        <Button variant="outlined" sx={buttonSx} disabled={adopting} onClick={restart}>Restart</Button>
        <Button sx={buttonSx} disabled={adopting} onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  )
}
