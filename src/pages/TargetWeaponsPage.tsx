import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  InputLabel,
  LinearProgress,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { PageShell } from '../components/PageShell'
import { BonusSetEditor } from '../components/forms/BonusSetEditor'
import { TargetCompromiseEditor } from '../components/forms/TargetCompromiseEditor'
import {
  hasTargetCompromise,
  isCompatiblePreferredOwnedWeapon,
  isEligiblePreferredOwnedWeapon,
} from '../domain/target'
import { SkillConditionEditor } from '../components/forms/SkillConditionEditor'
import { MasterDataStatusAlert } from '../components/MasterDataStatusAlert'
import { loadMasterData } from '../domain/master/loadMasterData'
import {
  getEnabledElements,
  getEnabledWeaponTypes,
} from '../domain/master/masterSelectors'
import {
  createDefaultBonusSet,
  createTargetWeaponDraft,
  MasterOptionsUnavailableError,
} from '../domain/forms/entityDrafts'
import type {
  OwnedWeapon,
  TargetWeapon,
} from '../domain/models/publicTypes'
import { ownedWeaponRepository } from '../db/repositories'
import {
  artianWeaponKindLabels,
  ownedWeaponStatusLabels,
} from '../presentation/labels'
import {
  EntityFormValidationError,
  ReferencedEntityDeleteError,
  TargetWeaponCrudService,
  type TargetWeaponDraft,
} from '../services/crud/entityCrudServices'
import { getPersistenceReferenceKindLabel } from '../presentation/labels'

const NO_PREFERRED_OWNED_WEAPON = ''

/**
 * The Target edit dropdown order of `docs/UI_FLOW.md` 8.1.
 *
 * Group 0 is the weapon this Target currently prefers, 1 an unassigned
 * unprotected weapon, 2 one another Target already prefers, and 3 a protected
 * one, which is shown but never selectable so the user can see why it is
 * unavailable. Within a group the existing stable order - display name, then ID
 * - decides, so the list never depends on load order.
 */
function preferredOptionGroup(
  weapon: OwnedWeapon,
  currentPreferredId: string | null,
  claimedByOtherTarget: boolean,
): number {
  if (weapon.id === currentPreferredId) return 0
  if (weapon.isProtected) return 3
  return claimedByOtherTarget ? 2 : 1
}

const masterResult = loadMasterData()

export interface TargetWeaponsPageDependencies {
  getAll(): Promise<TargetWeapon[]>
  save(draft: TargetWeaponDraft, existing: TargetWeapon | null): Promise<TargetWeapon>
  delete(id: TargetWeapon['id']): Promise<void>
  /** The preferred-origin candidates shown in the edit dialog. */
  getOwnedWeapons(): Promise<OwnedWeapon[]>
}

function deleteReferenceMessage(error: ReferencedEntityDeleteError) {
  return `参照中のため削除できません: ${error.references
    .map(
      (reference) =>
        `${getPersistenceReferenceKindLabel(reference.kind)}（${reference.entityId}）`,
    )
    .join(' / ')}`
}

export function TargetWeaponsPage({
  dependencies,
}: {
  dependencies?: TargetWeaponsPageDependencies
}) {
  const defaultService = useMemo(
    () => (masterResult.ok ? new TargetWeaponCrudService(masterResult.data) : null),
    [],
  )
  const api = useMemo<TargetWeaponsPageDependencies | null>(
    () =>
      dependencies ??
      (defaultService
        ? {
            getAll: () => defaultService.getAll(),
            save: (draft, existing) => defaultService.save(draft, existing),
            delete: (id) => defaultService.delete(id),
            getOwnedWeapons: () => ownedWeaponRepository.getAllOwnedWeapons(),
          }
        : null),
    [defaultService, dependencies],
  )
  const [targets, setTargets] = useState<TargetWeapon[]>([])
  const [ownedWeapons, setOwnedWeapons] = useState<OwnedWeapon[]>([])
  const [loading, setLoading] = useState(api !== null)
  const [editing, setEditing] = useState<TargetWeapon | null>(null)
  const [draft, setDraft] = useState<TargetWeaponDraft | null>(null)
  const [error, setError] = useState<string | null>(
    api ? null : 'マスターデータが利用できません。',
  )
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    if (!api) return
    let active = true
    void Promise.all([api.getAll(), api.getOwnedWeapons()])
      .then(([loaded, loadedWeapons]) => {
        if (active) {
          setTargets(loaded)
          setOwnedWeapons(loadedWeapons)
        }
      })
      .catch((caught: unknown) => {
        if (active) {
          setError(
            caught instanceof Error
              ? caught.message
              : '目標武器を読み込めません。',
          )
        }
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [api])

  if (!masterResult.ok) {
    return (
      <PageShell title="目標武器" description="欲しい完成武器を管理します。">
        <Alert severity="error">マスターデータが利用できません。</Alert>
      </PageShell>
    )
  }

  const master = masterResult.data
  const weaponTypes = getEnabledWeaponTypes(master)
  const elements = getEnabledElements(master)
  const openNew = () => {
    try {
      setEditing(null)
      setDraft(createTargetWeaponDraft(master))
      setError(null)
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : '入力選択肢がありません。',
      )
    }
  }

  const openEdit = (target: TargetWeapon) => {
    const {
      id: _id,
      createdAt: _createdAt,
      updatedAt: _updatedAt,
      ...value
    } = target
    void _id
    void _createdAt
    void _updatedAt
    setEditing(target)
    setDraft(structuredClone(value))
  }

  const save = async () => {
    if (!api || !draft) return
    try {
      const saved = await api.save(draft, editing)
      setTargets((current) =>
        [...current.filter(({ id }) => id !== saved.id), saved].map((target) =>
          // The Service released the previous holder in the same transaction,
          // so the list must show that release too (`docs/UI_FLOW.md` 8.1).
          target.id !== saved.id &&
          saved.preferredOwnedWeaponId !== null &&
          target.preferredOwnedWeaponId === saved.preferredOwnedWeaponId
            ? { ...target, preferredOwnedWeaponId: null }
            : target,
        ),
      )
      setDraft(null)
      setEditing(null)
      setNotice('目標武器を保存しました。')
      setError(null)
    } catch (caught: unknown) {
      setError(
        caught instanceof EntityFormValidationError
          ? caught.issues.join(' / ')
          : caught instanceof Error
            ? caught.message
            : '保存できません。',
      )
    }
  }

  const remove = async (target: TargetWeapon) => {
    if (!api || !window.confirm(`${target.name}を削除しますか？`)) return
    try {
      await api.delete(target.id)
      setTargets((current) => current.filter(({ id }) => id !== target.id))
      setNotice('目標武器を削除しました。')
      setError(null)
    } catch (caught: unknown) {
      setError(
        caught instanceof ReferencedEntityDeleteError
          ? deleteReferenceMessage(caught)
          : caught instanceof Error
            ? caught.message
            : '削除できません。',
      )
    }
  }

  const resetBonusConditions = (
    value: TargetWeaponDraft,
    weaponTypeId: string,
    elementId: string,
  ): TargetWeaponDraft => {
    // Changing the Target's own definition can make its preferred weapon
    // incompatible. Clearing it here touches the draft only; nothing is written
    // until save, and this is never treated as taking a weapon from another
    // Target (`docs/UI_FLOW.md` 8.1).
    const preferred = ownedWeapons.find(
      ({ id }) => id === value.preferredOwnedWeaponId,
    )
    const keepsPreferred =
      preferred !== undefined &&
      isEligiblePreferredOwnedWeapon({ weaponTypeId, elementId }, preferred)
    return {
      ...value,
      weaponTypeId,
      elementId,
      preferredOwnedWeaponId: keepsPreferred
        ? value.preferredOwnedWeaponId
        : null,
      idealBonuses: createDefaultBonusSet(
        master,
        weaponTypeId,
        elementId,
        'gogma_artian',
      ),
      practicalBonusConditions: [],
      alternativeBonusRules: [],
    }
  }

  // Compatible weapons only, protected ones included so the user can see why
  // they cannot be chosen. Status is deliberately not a filter: a Material,
  // Practical, or Ideal weapon is equally selectable (`docs/UI_FLOW.md` 8.1).
  const preferredOwnedWeaponOptions = draft
    ? ownedWeapons
        .filter((weapon) => isCompatiblePreferredOwnedWeapon(draft, weapon))
        .map((weapon) => {
          const holder =
            targets.find(
              (target) =>
                target.id !== editing?.id &&
                target.preferredOwnedWeaponId === weapon.id,
            ) ?? null
          return {
            weapon,
            holder,
            selectable: !weapon.isProtected,
            group: preferredOptionGroup(
              weapon,
              draft.preferredOwnedWeaponId,
              holder !== null,
            ),
          }
        })
        .sort(
          (left, right) =>
            left.group - right.group ||
            left.weapon.name.localeCompare(right.weapon.name) ||
            left.weapon.id.localeCompare(right.weapon.id),
        )
    : []

  return (
    <PageShell
      title="目標武器"
      description="欲しい完成武器の理想条件と実用条件を管理します。"
    >
      <Stack spacing={2}>
        <MasterDataStatusAlert master={master} />
        {loading && <LinearProgress />}
        {error && <Alert severity="error">{error}</Alert>}
        {notice && <Alert severity="success">{notice}</Alert>}
        <Button variant="contained" onClick={openNew}>
          目標武器を追加
        </Button>
        {!loading && targets.length === 0 && (
          <Alert severity="info">目標武器は未登録です。</Alert>
        )}
        {targets.map((target) => (
          <Paper key={target.id} variant="outlined" sx={{ p: 2 }}>
            <Stack spacing={1}>
              <Typography variant="h3">{target.name}</Typography>
              <Typography>
                {
                  weaponTypes.find(({ id }) => id === target.weaponTypeId)
                    ?.displayNameJa
                }{' '}
                /{' '}
                {
                  elements.find(({ id }) => id === target.elementId)
                    ?.displayNameJa
                }{' '}
                ／ 優先度 {target.priority} ／{' '}
                {target.isEnabled ? '有効' : '無効'}
              </Typography>
              <Typography variant="body2">
                優先起点:{' '}
                {ownedWeapons.find(
                  ({ id }) => id === target.preferredOwnedWeaponId,
                )?.name ?? 'なし'}
              </Typography>
              <Typography variant="body2">理想: 5枠設定済み</Typography>
              {!hasTargetCompromise(target) && <Typography>妥協なし（理想のみ検索）</Typography>}
              {target.compromiseNeedsReview && <Alert severity="info">条件の仕様変更により旧妥協条件を解除しました。理想条件を保持しています。実用・代替・実用スキルを確認して再設定してください。</Alert>}
              <Typography variant="body2">
                実用: 条件 {target.practicalBonusConditions.length}件、代替条件{' '}
                {target.alternativeBonusRules.length}件
              </Typography>
              <Stack direction="row">
                <Button onClick={() => openEdit(target)}>編集</Button>
                <Button color="error" onClick={() => void remove(target)}>
                  削除
                </Button>
              </Stack>
            </Stack>
          </Paper>
        ))}
        <Dialog
          open={draft !== null}
          onClose={() => setDraft(null)}
          fullWidth
          maxWidth="lg"
        >
          <DialogTitle>
            {editing ? '目標武器を編集' : '目標武器を追加'}
          </DialogTitle>
          {draft && (
            <DialogContent>
              <Stack spacing={3} sx={{ pt: 1 }}>
                <TextField
                  label="名前"
                  required
                  value={draft.name}
                  onChange={(event) =>
                    setDraft({ ...draft, name: event.target.value })
                  }
                />
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                  <FormControl fullWidth>
                    <InputLabel id="target-weapon-type">武器種</InputLabel>
                    <Select
                      labelId="target-weapon-type"
                      label="武器種"
                      value={draft.weaponTypeId}
                      onChange={(event) => {
                        try {
                          setDraft(
                            resetBonusConditions(
                              draft,
                              event.target.value,
                              draft.elementId,
                            ),
                          )
                        } catch (caught) {
                          if (
                            caught instanceof MasterOptionsUnavailableError
                          ) {
                            setError(caught.message)
                          }
                        }
                      }}
                    >
                      {weaponTypes.map((type) => (
                        <MenuItem key={type.id} value={type.id}>
                          {type.displayNameJa}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                  <FormControl fullWidth>
                    <InputLabel id="target-element">属性</InputLabel>
                    <Select
                      labelId="target-element"
                      label="属性"
                      value={draft.elementId}
                      onChange={(event) => {
                        try {
                          setDraft(
                            resetBonusConditions(
                              draft,
                              draft.weaponTypeId,
                              event.target.value,
                            ),
                          )
                        } catch (caught) {
                          if (
                            caught instanceof MasterOptionsUnavailableError
                          ) {
                            setError(caught.message)
                          }
                        }
                      }}
                    >
                      {elements.map((element) => (
                        <MenuItem key={element.id} value={element.id}>
                          {element.displayNameJa}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                  <FormControl fullWidth>
                    <InputLabel id="target-priority">優先度</InputLabel>
                    <Select
                      labelId="target-priority"
                      label="優先度"
                      value={draft.priority}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          priority: Number(
                            event.target.value,
                          ) as TargetWeapon['priority'],
                        })
                      }
                    >
                      {[1, 2, 3, 4, 5].map((value) => (
                        <MenuItem key={value} value={value}>
                          {value}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Stack>
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={draft.isEnabled}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          isEnabled: event.target.checked,
                        })
                      }
                    />
                  }
                  label="有効"
                />
                <FormControl fullWidth>
                  <InputLabel id="target-preferred-owned-weapon">
                    優先する所持武器
                  </InputLabel>
                  <Select
                    labelId="target-preferred-owned-weapon"
                    label="優先する所持武器"
                    value={
                      draft.preferredOwnedWeaponId ?? NO_PREFERRED_OWNED_WEAPON
                    }
                    onChange={(event) => {
                      const value = event.target.value
                      if (value === NO_PREFERRED_OWNED_WEAPON) {
                        setDraft({ ...draft, preferredOwnedWeaponId: null })
                        return
                      }
                      const holder = targets.find(
                        (target) =>
                          target.id !== editing?.id &&
                          target.preferredOwnedWeaponId === value,
                      )
                      if (
                        holder &&
                        !window.confirm(
                          `この武器は現在「${holder.name}」の優先起点に設定されています。\n` +
                            `この目標武器に変更すると、「${holder.name}」との紐づけは解除されます。\n` +
                            '変更しますか？',
                        )
                      ) {
                        return
                      }
                      setDraft({
                        ...draft,
                        preferredOwnedWeaponId:
                          value as TargetWeapon['preferredOwnedWeaponId'],
                      })
                    }}
                  >
                    <MenuItem value={NO_PREFERRED_OWNED_WEAPON}>指定なし</MenuItem>
                    {preferredOwnedWeaponOptions.map(
                      ({ weapon, holder, selectable }) => (
                        <MenuItem
                          key={weapon.id}
                          value={weapon.id}
                          disabled={!selectable}
                        >
                          {`${artianWeaponKindLabels[weapon.kind]} / ${weapon.name}`}
                          {weapon.kind === 'gogma'
                            ? ` / ${ownedWeaponStatusLabels[weapon.status]}`
                            : ''}
                          {weapon.isProtected
                            ? ' [保護中・選択不可]'
                            : holder
                              ? ` [${holder.name}に割当中]`
                              : ''}
                        </MenuItem>
                      ),
                    )}
                  </Select>
                </FormControl>
                <Typography variant="body2">
                  この目標を作る際の起点として優先します。
                  より短い作成ルートがある場合は、そちらが選ばれることがあります。
                </Typography>
                <BonusSetEditor
                  label="理想の復元ボーナス5枠"
                  master={master}
                  weaponTypeId={draft.weaponTypeId}
                  elementId={draft.elementId}
                  scope="gogma_artian"
                  value={draft.idealBonuses}
                  onChange={(idealBonuses) =>
                    setDraft({ ...draft, idealBonuses })
                  }
                />
                <TargetCompromiseEditor target={draft} master={master} onChange={(conditions) => setDraft({ ...draft, ...conditions })} />
                <Typography>実用スキルの指定がない場合、スキルは理想条件だけを許可します。ボーナスが実用・代替の場合も、実用スキルと組み合わせられます。</Typography>
                <SkillConditionEditor
                  label="理想スキル条件"
                  master={master}
                  value={draft.idealSkillCondition}
                  onChange={(idealSkillCondition) =>
                    setDraft({ ...draft, idealSkillCondition })
                  }
                />
                <SkillConditionEditor
                  label="実用スキル条件"
                  master={master}
                  value={draft.practicalSkillCondition}
                  onChange={(practicalSkillCondition) =>
                    setDraft({ ...draft, practicalSkillCondition })
                  }
                />
                <TextField
                  label="メモ"
                  multiline
                  value={draft.memo ?? ''}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      memo: event.target.value || null,
                    })
                  }
                />
              </Stack>
            </DialogContent>
          )}
          <DialogActions>
            <Button onClick={() => setDraft(null)}>キャンセル</Button>
            <Button variant="contained" onClick={() => void save()}>
              保存
            </Button>
          </DialogActions>
        </Dialog>
      </Stack>
    </PageShell>
  )
}
