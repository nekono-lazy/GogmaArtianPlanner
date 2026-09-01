import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import {
  Alert, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle,
  FormControl, FormControlLabel, InputLabel, LinearProgress, MenuItem, Paper,
  Select, Stack, TextField, Typography,
} from '@mui/material'
import { BonusSetEditor } from '../forms/BonusSetEditor'
import { createDefaultBonusSet } from '../../domain/forms/entityDrafts'
import type { MasterDataRoot } from '../../domain/master/masterTypes'
import { getEnabledElements, getEnabledWeaponTypes } from '../../domain/master/masterSelectors'
import type { RestorationBonusSet, RngState } from '../../domain/models/publicTypes'
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

interface ApproximateCounterDraft { readonly center: string; readonly radius: string }

export interface IdentificationWizardDialogProps {
  coordinator: IdentificationWizardCoordinator
  initialRngState: RngState
  master: MasterDataRoot
  onAdopted(state: RngState): void
  onClose(): void
}

function cloneBonusSet(value: RestorationBonusSet): RestorationBonusSet {
  return value.map((bonus) => ({ ...bonus })) as RestorationBonusSet
}

function repeatedSkillObservations(): CompleteSkillObservation[] {
  const seriesSkillId = REFERENCE_SERIES_SKILL_POOL[0]
  const groupSkillId = REFERENCE_GROUP_SKILL_POOL[0]
  if (!seriesSkillId || !groupSkillId) throw new Error('Production Skill observation options are unavailable.')
  return Array.from({ length: INITIAL_OBSERVATION_COUNT }, () => ({ seriesSkillId, groupSkillId }))
}

function repeatedBonusObservations(master: MasterDataRoot, weaponTypeId: string, elementId: string): RestorationBonusSet[] {
  const initial = createDefaultBonusSet(master, weaponTypeId, elementId, 'gogma_artian')
  return Array.from({ length: INITIAL_OBSERVATION_COUNT }, () => cloneBonusSet(initial))
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
    return `${range.startInclusive} ～ ${range.endInclusive}（inclusive）`
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

function SearchProgress({ completed, total, matches }: { completed: number; total: number; matches: number }) {
  const percent = total > 0 ? Math.min(100, (completed / total) * 100) : 0
  return <Stack spacing={0.5} aria-label="検索進捗"><LinearProgress variant="determinate" value={percent} /><Typography variant="body2">{completed.toLocaleString()} / {total.toLocaleString()}（一致 {matches.toLocaleString()}件）</Typography></Stack>
}

function ApproximateCounterFields({ label, draft, maximum, disabled, onChange }: { label: string; draft: ApproximateCounterDraft; maximum: number; disabled: boolean; onChange(value: ApproximateCounterDraft): void }) {
  return <Stack spacing={1}><Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}><TextField fullWidth label={`概算${label}`} type="number" value={draft.center} disabled={disabled} slotProps={{ htmlInput: { min: 0, max: maximum, step: 1 } }} onChange={(event) => onChange({ ...draft, center: event.target.value })} /><TextField fullWidth label={`${label}の±幅`} type="number" value={draft.radius} disabled={disabled} slotProps={{ htmlInput: { min: 0, step: 1 } }} onChange={(event) => onChange({ ...draft, radius: event.target.value })} /></Stack><Typography variant="body2" color="text.secondary">検索範囲: {previewApproximateRange(draft, maximum)}</Typography></Stack>
}

function currentStepLabel(state: IdentificationWizardState): string {
  if (state.review !== null) return 'Review'
  return state.skill.classification === 'unique' ? 'STEP 2' : 'STEP 1'
}

export function IdentificationWizardDialog({
  coordinator, initialRngState, master, onAdopted, onClose,
}: IdentificationWizardDialogProps) {
  const subscribe = useCallback((listener: () => void) => coordinator.subscribe(listener), [coordinator])
  const getSnapshot = useCallback(() => coordinator.getState(), [coordinator])
  const wizardState = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      coordinator.dispose()
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
  const [skillObservations, setSkillObservations] = useState(repeatedSkillObservations)
  const [seedStart, setSeedStart] = useState(String(CANONICAL_BASE_SEED_MIN))
  const [seedEnd, setSeedEnd] = useState(String(CANONICAL_BASE_SEED_MAX))
  const [skillRange, setSkillRange] = useState<ApproximateCounterDraft>({
    center: initialRngState.skillCounter.value === null ? '' : String(initialRngState.skillCounter.value),
    radius: String(DEFAULT_COUNTER_RADIUS),
  })
  const [gogmaRange, setGogmaRange] = useState<ApproximateCounterDraft>({
    center: initialRngState.gogmaCounter.value === null ? '' : String(initialRngState.gogmaCounter.value),
    radius: String(DEFAULT_COUNTER_RADIUS),
  })
  const [gogmaObservations, setGogmaObservations] = useState(
    () => repeatedBonusObservations(master, initialWeaponTypeId, initialElementId),
  )
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
    setGogmaObservations(repeatedBonusObservations(master, step2WeaponTypeId, step2ElementId))
  }, [master, step2ElementId, step2InputKey, step2WeaponTypeId])

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
      await coordinator.identifySkill({
        weaponTypeId,
        elementId,
        observations: skillObservations.map((observation) => ({ ...observation })),
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
      await coordinator.identifyGogma({
        weaponTypeId: step2WeaponTypeId,
        elementId: step2ElementId,
        observations: gogmaObservations.map(cloneBonusSet),
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
    setSkillObservations(repeatedSkillObservations())
    setSeedStart(String(CANONICAL_BASE_SEED_MIN))
    setSeedEnd(String(CANONICAL_BASE_SEED_MAX))
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
    setGogmaObservations(
      repeatedBonusObservations(master, initialWeaponTypeId, initialElementId),
    )
    coordinator.restart()
  }

  return (
    <Dialog
      open
      fullWidth
      maxWidth="md"
      onClose={(_, reason) => {
        if (!adopting && reason !== 'backdropClick') onClose()
      }}
    >
      <DialogTitle>RNG Identification Wizard</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={3}>
          <Alert severity="warning">
            このWizardはC7 UI実装段階です。実Browser Worker benchmarkと独立したSkill実機検証は未完了で、Production Identificationは正式activation前です。
          </Alert>
          <Alert severity="info">
            観測結果の記録が終わるまでゲーム状態を保存しないでください。開始前にバックアップ方法と自動保存の設定・挙動を確認し、案内された操作だけを順番に連続して行ってください。観測後は調査前の状態へ戻してから採用します。ゲーム側の保存仕様や安全をこのアプリが保証するものではありません。
          </Alert>
          <Typography variant="h2">現在: {currentStepLabel(wizardState)}</Typography>

          <Paper variant="outlined" sx={{ p: 2 }}>
            <Stack spacing={2}>
              <Typography variant="h2">STEP 1 — Base Seed / Starting Skill Counter</Typography>
              <Typography>
                Normal → Gogma conversionで自動付与されたSkillをObservation 1へ記録し、その後の連続したSkill Reset結果をObservation 2以降へ順番どおり記録します。
              </Typography>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
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
              </Stack>
              <Stack spacing={1}>
                <Typography variant="h3">ordered Skill observations</Typography>
                {skillObservations.map((observation, index) => (
                  <Paper key={index} variant="outlined" sx={{ p: 1.5 }}>
                    <Stack spacing={1}>
                      <Typography variant="subtitle2">
                        Observation {index + 1} — {index === 0 ? 'conversion自動Skill' : `連続Skill Reset ${index}`}
                      </Typography>
                      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                        <FormControl fullWidth disabled={skillSearching}>
                          <InputLabel id={`skill-observation-${index}-series-label`}>Observation {index + 1} Series Skill</InputLabel>
                          <Select
                            labelId={`skill-observation-${index}-series-label`}
                            label={`Observation ${index + 1} Series Skill`}
                            value={observation.seriesSkillId}
                            onChange={(event) => {
                              const next = [...skillObservations]
                              next[index] = { ...observation, seriesSkillId: event.target.value }
                              setSkillObservations(next)
                            }}
                          >
                            {seriesSkills.map((skill) => <MenuItem key={skill.id} value={skill.id}>{skill.displayNameJa}</MenuItem>)}
                          </Select>
                        </FormControl>
                        <FormControl fullWidth disabled={skillSearching}>
                          <InputLabel id={`skill-observation-${index}-group-label`}>Observation {index + 1} Group Skill</InputLabel>
                          <Select
                            labelId={`skill-observation-${index}-group-label`}
                            label={`Observation ${index + 1} Group Skill`}
                            value={observation.groupSkillId}
                            onChange={(event) => {
                              const next = [...skillObservations]
                              next[index] = { ...observation, groupSkillId: event.target.value }
                              setSkillObservations(next)
                            }}
                          >
                            {groupSkills.map((skill) => <MenuItem key={skill.id} value={skill.id}>{skill.displayNameJa}</MenuItem>)}
                          </Select>
                        </FormControl>
                      </Stack>
                      <Button
                        color="error"
                        disabled={skillSearching || skillObservations.length === 1}
                        onClick={() => setSkillObservations((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                      >
                        Observation {index + 1}を削除
                      </Button>
                    </Stack>
                  </Paper>
                ))}
                <Button
                  disabled={skillSearching}
                  onClick={() => setSkillObservations((current) => [...current, { ...current.at(-1)! }])}
                >
                  Skill Observationを追加
                </Button>
              </Stack>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                <TextField
                  fullWidth label="Base Seed range start" type="number" value={seedStart}
                  disabled={skillSearching}
                  slotProps={{ htmlInput: { min: CANONICAL_BASE_SEED_MIN, max: CANONICAL_BASE_SEED_MAX, step: 1 } }}
                  onChange={(event) => setSeedStart(event.target.value)}
                />
                <TextField
                  fullWidth label="Base Seed range end" type="number" value={seedEnd}
                  disabled={skillSearching}
                  slotProps={{ htmlInput: { min: CANONICAL_BASE_SEED_MIN, max: CANONICAL_BASE_SEED_MAX, step: 1 } }}
                  onChange={(event) => setSeedEnd(event.target.value)}
                />
              </Stack>
              <Typography variant="body2" color="text.secondary">
                既定値はProduction契約のcanonical Base Seed全域です。範囲は明示的に変更でき、自動拡張やbackground wideningは行いません。
              </Typography>
              <ApproximateCounterFields
                label="Skill Counter"
                draft={skillRange}
                maximum={Math.floor((Number.MAX_SAFE_INTEGER - 1) / 10)}
                disabled={skillSearching}
                onChange={setSkillRange}
              />
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
              <Stack direction="row" spacing={1}>
                <Button variant="contained" disabled={skillSearching || adopting} onClick={() => void identifySkill()}>
                  STEP 1 Search
                </Button>
                <Button disabled={!skillSearching} onClick={() => coordinator.cancelSkill()}>
                  STEP 1 Cancel
                </Button>
              </Stack>
            </Stack>
          </Paper>
          {wizardState.skill.classification === 'unique' && (
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Stack spacing={2}>
                <Typography variant="h2">STEP 2 — Starting Gogma Counter</Typography>
                <Typography>
                  STEP 1で一意に特定したBase Seedを内部利用します。Base Seedの再入力は不要です。同じ武器でReset Bonusesだけを連続して行い、各5枠を枠順どおり記録してください。Keep Bonusesは使用しません。
                </Typography>
                <Typography variant="body2">
                  Weapon Type: {weaponTypes.find(({ id }) => id === step2WeaponTypeId)?.displayNameJa ?? step2WeaponTypeId} ／ Element: {elements.find(({ id }) => id === step2ElementId)?.displayNameJa ?? step2ElementId}
                </Typography>
                <Stack spacing={1}>
                  <Typography variant="h3">ordered Gogma Reset observations</Typography>
                  {gogmaObservations.map((observation, index) => (
                    <Paper key={index} variant="outlined" sx={{ p: 1.5 }}>
                      <Stack spacing={1}>
                        <BonusSetEditor
                          label={`Reset Observation ${index + 1}`}
                          master={master}
                          weaponTypeId={step2WeaponTypeId}
                          elementId={step2ElementId}
                          scope="gogma_artian"
                          value={observation}
                          onChange={(value) => {
                            const next = [...gogmaObservations]
                            next[index] = value
                            setGogmaObservations(next)
                          }}
                        />
                        <Button
                          color="error"
                          disabled={gogmaSearching || gogmaObservations.length === 1}
                          onClick={() => setGogmaObservations((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                        >
                          Reset Observation {index + 1}を削除
                        </Button>
                      </Stack>
                    </Paper>
                  ))}
                  <Button
                    disabled={gogmaSearching}
                    onClick={() => setGogmaObservations((current) => [...current, cloneBonusSet(current.at(-1)!)])}
                  >
                    Reset Observationを追加
                  </Button>
                </Stack>
                <ApproximateCounterFields
                  label="Gogma Counter"
                  draft={gogmaRange}
                  maximum={MAX_GOGMA_IDENTIFICATION_COUNTER}
                  disabled={gogmaSearching}
                  onChange={setGogmaRange}
                />
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
                <Stack direction="row" spacing={1}>
                  <Button variant="contained" disabled={gogmaSearching || adopting} onClick={() => void identifyGogma()}>
                    STEP 2 Search
                  </Button>
                  <Button disabled={!gogmaSearching} onClick={() => coordinator.cancelGogma()}>
                    STEP 2 Cancel
                  </Button>
                </Stack>
              </Stack>
            </Paper>
          )}

          {wizardState.review && (
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Stack spacing={2}>
                <Typography variant="h2">Review</Typography>
                <Typography>Base Seed: {wizardState.review.baseSeed}</Typography>
                <Typography>Starting Skill Counter: {wizardState.review.startingSkillCounter}</Typography>
                <Typography>Starting Gogma Counter: {wizardState.review.startingGogmaCounter}</Typography>
                <Alert severity="warning">
                  表示値は調査開始前のstarting valuesです。Observation数は加算されません。ゲーム状態を調査前へ戻した後に採用してください。
                </Alert>
                <FormControlLabel
                  control={(
                    <Checkbox
                      checked={wizardState.gameRestoredConfirmed}
                      disabled={adopting || wizardState.adoption.status === 'adopted'}
                      onChange={(event) => coordinator.setGameRestoredConfirmed(event.target.checked)}
                    />
                  )}
                  label="調査前のゲーム状態へ戻した"
                />
                {wizardState.adoption.error && (
                  <Alert severity="error">
                    Adoption failure: {errorMessage(wizardState.adoption.error.error)}。Reviewと復元確認を保持しています。再試行できます。
                  </Alert>
                )}
                {wizardState.adoption.status === 'adopted' && (
                  <Alert severity="success">Identification結果をRNG状態へ採用しました。</Alert>
                )}
                <Button
                  variant="contained"
                  disabled={!wizardState.gameRestoredConfirmed || adopting || wizardState.adoption.status === 'adopted'}
                  onClick={() => void adopt()}
                >
                  {adopting ? 'Adopting…' : 'Adopt starting values'}
                </Button>
              </Stack>
            </Paper>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button disabled={adopting} onClick={restart}>Restart</Button>
        <Button disabled={adopting} onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  )
}
