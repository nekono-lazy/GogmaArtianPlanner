import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Checkbox,
  Chip,
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
import { MasterDataStatusAlert } from '../components/MasterDataStatusAlert'
import { loadMasterData } from '../domain/master/loadMasterData'
import {
  getEnabledElements,
  getEnabledWeaponTypes,
  getGroupSkillOptions,
  getSeriesSkillOptions,
} from '../domain/master/masterSelectors'
import {
  createDefaultBonusSet,
  createOwnedWeaponDraft,
  MasterOptionsUnavailableError,
} from '../domain/forms/entityDrafts'
import type {
  OwnedWeapon,
  OwnedWeaponStatus,
  TargetWeapon,
} from '../domain/models/publicTypes'
import { targetWeaponRepository } from '../db/repositories'
import {
  EntityFormValidationError,
  OwnedWeaponCrudService,
  ReferencedEntityDeleteError,
  type OwnedWeaponDraft,
} from '../services/crud/entityCrudServices'
import {
  artianWeaponKindLabels,
  getPersistenceReferenceKindLabel,
  ownedWeaponStatusLabels,
} from '../presentation/labels'

const masterResult = loadMasterData()

export interface OwnedWeaponsPageDependencies {
  getAll(): Promise<OwnedWeapon[]>
  /**
   * Read-only here. Editing the relation belongs to the Target Weapons screen;
   * this screen reads it to show which Target prefers a weapon, and to confirm
   * before a change would break that link (`docs/UI_FLOW.md` 7.1).
   */
  getTargets(): Promise<TargetWeapon[]>
  save(draft: OwnedWeaponDraft, existing: OwnedWeapon | null): Promise<OwnedWeapon>
  delete(id: OwnedWeapon['id']): Promise<void>
}

function referenceMessage(error: ReferencedEntityDeleteError): string {
  return `参照中のため削除できません: ${error.references
    .map(
      (reference) =>
        `${getPersistenceReferenceKindLabel(reference.kind)}（${reference.entityId}）`,
    )
    .join(' / ')}`
}

export function OwnedWeaponsPage({
  dependencies,
}: {
  dependencies?: OwnedWeaponsPageDependencies
}) {
  const defaultService = useMemo(
    () => (masterResult.ok ? new OwnedWeaponCrudService(masterResult.data) : null),
    [],
  )
  const api = useMemo<OwnedWeaponsPageDependencies | null>(
    () =>
      dependencies ??
      (defaultService
        ? {
            getAll: () => defaultService.getAll(),
            getTargets: () => targetWeaponRepository.getAllTargetWeapons(),
            save: (draft, existing) => defaultService.save(draft, existing),
            delete: (id) => defaultService.delete(id),
          }
        : null),
    [defaultService, dependencies],
  )
  const [weapons, setWeapons] = useState<OwnedWeapon[]>([])
  const [targets, setTargets] = useState<TargetWeapon[]>([])
  const [loading, setLoading] = useState(api !== null)
  const [editing, setEditing] = useState<OwnedWeapon | null>(null)
  const [draft, setDraft] = useState<OwnedWeaponDraft | null>(null)
  const [error, setError] = useState<string | null>(
    api ? null : 'マスターデータが利用できません。',
  )
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    if (!api) return
    let active = true
    void Promise.all([api.getAll(), api.getTargets()])
      .then(([loaded, loadedTargets]) => {
        if (active) {
          setWeapons(loaded)
          setTargets(loadedTargets)
        }
      })
      .catch((caught: unknown) => {
        if (active) {
          setError(
            caught instanceof Error
              ? caught.message
              : '所持武器を読み込めません。',
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
      <PageShell
        title="所持武器"
        description="所持している通常／巨戟アーティアを管理します。"
      >
        <Alert severity="error">マスターデータが利用できません。</Alert>
      </PageShell>
    )
  }

  const master = masterResult.data
  const weaponTypes = getEnabledWeaponTypes(master)
  const elements = getEnabledElements(master)
  const scopeFor = (value: OwnedWeaponDraft) =>
    value.kind === 'normal' ? 'normal_artian' : 'gogma_artian'

  const openNew = () => {
    try {
      setEditing(null)
      setDraft(createOwnedWeaponDraft(master))
      setError(null)
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : '入力選択肢がありません。',
      )
    }
  }

  const openEdit = (weapon: OwnedWeapon) => {
    const {
      id: _id,
      createdAt: _createdAt,
      updatedAt: _updatedAt,
      ...value
    } = weapon
    void _id
    void _createdAt
    void _updatedAt
    setEditing(weapon)
    setDraft(structuredClone(value))
  }

  const save = async () => {
    if (!api || !draft) return
    // Protecting, or re-typing, a weapon a Target prefers as its Route origin
    // would leave that Target holding a preference the Domain rejects. Confirm
    // first, then let the Service release the link in the same transaction as
    // the save (`docs/UI_FLOW.md` 7.1).
    const releasedTargets = editing
      ? targets.filter(
          (target) =>
            target.preferredOwnedWeaponId === editing.id &&
            (draft.isProtected ||
              draft.weaponTypeId !== target.weaponTypeId ||
              draft.elementId !== target.elementId),
        )
      : []
    if (releasedTargets.length > 0) {
      const names = releasedTargets.map(({ name }) => name).join('、')
      const reason = draft.isProtected
        ? '保護すると生産計画でこの武器を変更できなくなるため、'
        : '武器種または属性が一致しなくなるため、'
      if (
        !window.confirm(
          `この武器は「${names}」の優先起点に設定されています。\n` +
            `${reason}「${names}」との紐づけを解除します。\n` +
            'よろしいですか？',
        )
      ) {
        return
      }
    }
    try {
      const saved = await api.save(draft, editing)
      setWeapons((current) => [
        ...current.filter(({ id }) => id !== saved.id),
        saved,
      ])
      const releasedIds = new Set(releasedTargets.map(({ id }) => id))
      if (releasedIds.size > 0) {
        setTargets((current) =>
          current.map((target) =>
            releasedIds.has(target.id)
              ? { ...target, preferredOwnedWeaponId: null }
              : target,
          ),
        )
      }
      setDraft(null)
      setEditing(null)
      setNotice('所持武器を保存しました。')
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

  const remove = async (weapon: OwnedWeapon) => {
    if (!api || !window.confirm(`${weapon.name}を削除しますか？`)) return
    try {
      await api.delete(weapon.id)
      setWeapons((current) => current.filter(({ id }) => id !== weapon.id))
      setNotice('所持武器を削除しました。')
      setError(null)
    } catch (caught: unknown) {
      setError(
        caught instanceof ReferencedEntityDeleteError
          ? referenceMessage(caught)
          : caught instanceof Error
            ? caught.message
            : '削除できません。',
      )
    }
  }

  const resetBonuses = (
    value: OwnedWeaponDraft,
    weaponTypeId: string,
    elementId: string,
  ): OwnedWeaponDraft => ({
    ...value,
    weaponTypeId,
    elementId,
    restorationBonuses: createDefaultBonusSet(
      master,
      weaponTypeId,
      elementId,
      scopeFor(value),
    ),
  })

  return (
    <PageShell
      title="所持武器"
      description="所持している通常／巨戟アーティアを1本ずつ管理します。"
    >
      <Stack spacing={2}>
        <MasterDataStatusAlert master={master} />
        {loading && <LinearProgress />}
        {error && <Alert severity="error">{error}</Alert>}
        {notice && <Alert severity="success">{notice}</Alert>}
        <Button variant="contained" onClick={openNew}>
          所持武器を追加
        </Button>
        {!loading && weapons.length === 0 && (
          <Alert severity="info">所持武器は未登録です。</Alert>
        )}
        {weapons.map((weapon) => {
          const scope =
            weapon.kind === 'normal' ? 'normal_artian' : 'gogma_artian'
          return (
            <Paper key={weapon.id} variant="outlined" sx={{ p: 2 }}>
              <Stack spacing={1}>
                <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
                  <Typography variant="h3">{weapon.name}</Typography>
                  <Chip label={artianWeaponKindLabels[weapon.kind]} />
                  {weapon.kind === 'gogma' && (
                    <Chip label={ownedWeaponStatusLabels[weapon.status]} />
                  )}
                  <Chip
                    label={weapon.isProtected ? '保護中' : '未保護'}
                    color={weapon.isProtected ? 'success' : 'default'}
                  />
                </Stack>
                <Typography>
                  {
                    weaponTypes.find(({ id }) => id === weapon.weaponTypeId)
                      ?.displayNameJa
                  }{' '}
                  /{' '}
                  {
                    elements.find(({ id }) => id === weapon.elementId)
                      ?.displayNameJa
                  }
                </Typography>
                <Typography variant="body2">
                  復元ボーナス:{' '}
                  {weapon.restorationBonuses
                    .map(
                      (bonus) =>
                        master.weaponBonusDefinitions.find(
                          (definition) =>
                            definition.scope === scope &&
                            definition.weaponTypeId === weapon.weaponTypeId &&
                            definition.bonusTypeId === bonus.bonusTypeId &&
                            definition.bonusRankId === bonus.bonusRankId,
                        )?.displayNameJa ?? '不明',
                    )
                    .join('、')}
                </Typography>
                {weapon.kind === 'gogma' && (
                  <Typography variant="body2">
                    シリーズスキル:{' '}
                    {master.seriesSkills.find(
                      ({ id }) => id === weapon.seriesSkillId,
                    )?.displayNameJa ?? 'なし'}{' '}
                    ／ グループスキル:{' '}
                    {master.groupSkills.find(
                      ({ id }) => id === weapon.groupSkillId,
                    )?.displayNameJa ?? 'なし'}
                  </Typography>
                )}
                <Typography variant="body2">
                  状態:{' '}
                  {weapon.kind === 'gogma'
                    ? ownedWeaponStatusLabels[weapon.status]
                    : '—'}
                </Typography>
                <Typography variant="body2">
                  優先起点:{' '}
                  {targets.find(
                    (target) => target.preferredOwnedWeaponId === weapon.id,
                  )?.name ?? 'なし'}
                </Typography>
                <Stack direction="row" spacing={1}>
                  <Button onClick={() => openEdit(weapon)}>編集</Button>
                  <Button color="error" onClick={() => void remove(weapon)}>
                    削除
                  </Button>
                </Stack>
              </Stack>
            </Paper>
          )
        })}
        <Dialog
          open={draft !== null}
          onClose={() => setDraft(null)}
          fullWidth
          maxWidth="md"
        >
          <DialogTitle>
            {editing ? '所持武器を編集' : '所持武器を追加'}
          </DialogTitle>
          {draft && (
            <DialogContent>
              <Stack spacing={2} sx={{ pt: 1 }}>
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={draft.kind === 'normal'}
                      disabled={editing !== null}
                      onChange={(event) => {
                        try {
                          setDraft(
                            createOwnedWeaponDraft(
                              master,
                              event.target.checked ? 'normal' : 'gogma',
                            ),
                          )
                        } catch (caught) {
                          if (caught instanceof Error) setError(caught.message)
                        }
                      }}
                    />
                  }
                  label="通常アーティアとして登録"
                />
                {editing && (
                  <Typography variant="caption">
                    登録済み武器の種類は変更できません。
                  </Typography>
                )}
                <TextField
                  label="名前"
                  value={draft.name}
                  required
                  onChange={(event) =>
                    setDraft({ ...draft, name: event.target.value })
                  }
                />
                <FormControl>
                  <InputLabel id="owned-weapon-type">武器種</InputLabel>
                  <Select
                    labelId="owned-weapon-type"
                    label="武器種"
                    value={draft.weaponTypeId}
                    onChange={(event) => {
                      try {
                        setDraft(
                          resetBonuses(
                            draft,
                            event.target.value,
                            draft.elementId,
                          ),
                        )
                      } catch (caught) {
                        if (caught instanceof MasterOptionsUnavailableError) {
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
                <FormControl>
                  <InputLabel id="owned-element">属性</InputLabel>
                  <Select
                    labelId="owned-element"
                    label="属性"
                    value={draft.elementId}
                    onChange={(event) => {
                      try {
                        setDraft(
                          resetBonuses(
                            draft,
                            draft.weaponTypeId,
                            event.target.value,
                          ),
                        )
                      } catch (caught) {
                        if (caught instanceof MasterOptionsUnavailableError) {
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
                <BonusSetEditor
                  label="復元ボーナス5枠"
                  master={master}
                  weaponTypeId={draft.weaponTypeId}
                  elementId={draft.elementId}
                  scope={scopeFor(draft)}
                  value={draft.restorationBonuses}
                  onChange={(restorationBonuses) =>
                    setDraft({ ...draft, restorationBonuses })
                  }
                />
                {draft.kind === 'gogma' && (
                  <>
                    <FormControl>
                      <InputLabel id="owned-series">
                        シリーズスキル
                      </InputLabel>
                      <Select
                        labelId="owned-series"
                        label="シリーズスキル"
                        value={draft.seriesSkillId ?? ''}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            seriesSkillId: event.target.value || null,
                          })
                        }
                      >
                        <MenuItem value="">なし</MenuItem>
                        {getSeriesSkillOptions(master).map((skill) => (
                          <MenuItem key={skill.id} value={skill.id}>
                            {skill.displayNameJa}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                    <FormControl>
                      <InputLabel id="owned-group">
                        グループスキル
                      </InputLabel>
                      <Select
                        labelId="owned-group"
                        label="グループスキル"
                        value={draft.groupSkillId ?? ''}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            groupSkillId: event.target.value || null,
                          })
                        }
                      >
                        <MenuItem value="">なし</MenuItem>
                        {getGroupSkillOptions(master).map((skill) => (
                          <MenuItem key={skill.id} value={skill.id}>
                            {skill.displayNameJa}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                    <FormControl>
                      <InputLabel id="owned-status">状態</InputLabel>
                      <Select
                        labelId="owned-status"
                        label="状態"
                        value={draft.status}
                        onChange={(event) => {
                          const status = event.target.value as OwnedWeaponStatus
                          setDraft({
                            ...draft,
                            status,
                            ...(editing === null
                              ? { isProtected: status === 'ideal' }
                              : {}),
                          })
                        }}
                      >
                        {Object.entries(ownedWeaponStatusLabels).map(
                          ([value, label]) => (
                            <MenuItem key={value} value={value}>
                              {label}
                            </MenuItem>
                          ),
                        )}
                      </Select>
                    </FormControl>
                  </>
                )}
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={draft.isProtected}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          isProtected: event.target.checked,
                        })
                      }
                    />
                  }
                  label="保護する"
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
