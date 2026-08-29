import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const masterDirectory = resolve('src/data/master')
const writeJson = (name, value) =>
  writeFileSync(
    resolve(masterDirectory, name),
    `${JSON.stringify(value, null, 2)}\n`,
    'utf8',
  )

const weapons = [
  ['weapon.great_sword', '大剣', 'melee'],
  ['weapon.long_sword', '太刀', 'melee'],
  ['weapon.sword_and_shield', '片手剣', 'melee'],
  ['weapon.dual_blades', '双剣', 'melee'],
  ['weapon.hammer', 'ハンマー', 'melee'],
  ['weapon.hunting_horn', '狩猟笛', 'melee'],
  ['weapon.lance', 'ランス', 'melee'],
  ['weapon.gunlance', 'ガンランス', 'melee'],
  ['weapon.switch_axe', 'スラッシュアックス', 'melee'],
  ['weapon.charge_blade', 'チャージアックス', 'melee'],
  ['weapon.insect_glaive', '操虫棍', 'melee'],
  ['weapon.bow', '弓', 'ranged'],
  ['weapon.light_bowgun', 'ライトボウガン', 'ranged'],
  ['weapon.heavy_bowgun', 'ヘビィボウガン', 'ranged'],
].map(([id, name, category], index) => ({
  id,
  displayNameJa: name,
  displayNameEn: name,
  sortOrder: index + 1,
  category,
  supportsElement: true,
  supportsSharpness: category === 'melee',
  isEnabled: true,
}))

const elements = [
  ['element.none', '無属性'],
  ['element.fire', '火'],
  ['element.water', '水'],
  ['element.thunder', '雷'],
  ['element.ice', '氷'],
  ['element.dragon', '龍'],
  ['element.poison', '毒'],
  ['element.paralysis', '麻痺'],
  ['element.sleep', '睡眠'],
  ['element.blast', '爆破'],
].map(([id, name], index) => ({
  id,
  displayNameJa: name,
  displayNameEn: name,
  sortOrder: index + 1,
  isEnabled: true,
}))

const bonusTypes = [
  ['bonus_type.attack', '基礎攻撃力強化', 'offense'],
  ['bonus_type.affinity', '会心率強化', 'offense'],
  ['bonus_type.element', '属性強化', 'element'],
  ['bonus_type.normal_sharpness', '斬れ味強化', 'sharpness'],
  ['bonus_type.normal_capacity', '装填数強化', 'ranged'],
  ['bonus_type.gogma_sharpness_capacity', '斬れ味・装填強化', 'utility'],
].map(([id, name, category], index) => ({
  id,
  displayNameJa: name,
  displayNameEn: name,
  sortOrder: index + 1,
  category,
  isEnabled: true,
}))

const bonusRanks = [
  ['bonus_rank.base', '通常', 0, false],
  ['bonus_rank.i', 'I', 1, false],
  ['bonus_rank.ii', 'II', 2, false],
  ['bonus_rank.iii', 'III', 3, false],
  ['bonus_rank.ex', 'EX', 4, true],
].map(([id, name, order, isEx]) => ({
  id,
  displayNameJa: name,
  displayNameEn: name,
  order,
  isEx,
  isEnabled: true,
}))

const meleeIds = weapons.filter(({ category }) => category === 'melee').map(({ id }) => id)
const bowgunIds = ['weapon.light_bowgun', 'weapon.heavy_bowgun']
const nonBowgunIds = weapons.map(({ id }) => id).filter((id) => !bowgunIds.includes(id))
const nonBowIds = weapons.map(({ id }) => id).filter((id) => id !== 'weapon.bow')
const allWeaponIds = weapons.map(({ id }) => id)

const bonusNameById = new Map(bonusTypes.map(({ id, displayNameJa }) => [id, displayNameJa]))
const rankNameById = new Map(bonusRanks.map(({ id, displayNameJa }) => [id, displayNameJa]))
const definitions = []
let definitionSortOrder = 1
const addDefinitions = (scope, weaponIds, bonusTypeId, rankIds) => {
  for (const weaponTypeId of weaponIds) {
    for (const bonusRankId of rankIds) {
      const rankSuffix = bonusRankId === 'bonus_rank.base' ? '' : rankNameById.get(bonusRankId)
      const displayName = `${bonusNameById.get(bonusTypeId)}${rankSuffix}`
      definitions.push({
        id: `weapon_bonus.${scope}.${weaponTypeId.slice('weapon.'.length)}.${bonusTypeId.slice('bonus_type.'.length)}.${bonusRankId.slice('bonus_rank.'.length)}`,
        weaponTypeId,
        bonusTypeId,
        bonusRankId,
        scope,
        displayNameJa: displayName,
        displayNameEn: displayName,
        effectValue: '未検証',
        sortOrder: definitionSortOrder++,
        isEnabled: true,
      })
    }
  }
}

const baseRank = ['bonus_rank.base']
addDefinitions('normal_artian', allWeaponIds, 'bonus_type.attack', baseRank)
addDefinitions('normal_artian', allWeaponIds, 'bonus_type.affinity', baseRank)
addDefinitions('normal_artian', nonBowgunIds, 'bonus_type.element', baseRank)
addDefinitions('normal_artian', meleeIds, 'bonus_type.normal_sharpness', baseRank)
addDefinitions('normal_artian', bowgunIds, 'bonus_type.normal_capacity', baseRank)

const fourGogmaRanks = ['bonus_rank.i', 'bonus_rank.ii', 'bonus_rank.iii', 'bonus_rank.ex']
addDefinitions('gogma_artian', allWeaponIds, 'bonus_type.attack', fourGogmaRanks)
addDefinitions('gogma_artian', allWeaponIds, 'bonus_type.affinity', fourGogmaRanks)
addDefinitions('gogma_artian', nonBowgunIds, 'bonus_type.element', ['bonus_rank.i', 'bonus_rank.ii', 'bonus_rank.ex'])
addDefinitions('gogma_artian', nonBowIds, 'bonus_type.gogma_sharpness_capacity', ['bonus_rank.base', 'bonus_rank.ex'])

const seriesSkillNames = [
  '闢獣の力', '火竜の力', '兇爪竜の力', '護鎖刃竜の命脈', '波衣竜の守護',
  '煌雷竜の力', '雷顎竜の闘志', '雪獅子の闘志', '鎧竜の守護', '凍峰竜の反逆',
  '暗器蛸の力', '獄焔蛸の反逆', '黒蝕竜の力', '鎖刃竜の飢餓', '泡狐竜の力',
  '白熾龍の脈動', '花舞の祈り', '千刃竜の闘志', '海竜の渦雷', '踊火の祈り',
  '暗黒騎士の証', 'オメガレゾナンス', '夢灯の祈り', '巨戟龍の黙示録', '祝謡の祈り',
]
const groupSkillNames = [
  '鱗張りの技法', '革細工の柔性', '毛皮の昂揚', '甲虫の知らせ', '護竜の脈動',
  'ヌシの誇り', '甲虫の擬態', '革細工の滑性', '鱗重ねの工夫', '毛皮の誘惑',
  '護竜の守り', 'ヌシの憤激', '先達の導き', '栄光の誉れ', '祝祭の巡り',
  'ヌシの魂', '拳を極めし者',
]
const skillMaster = (prefix, names, preservedIds = {}) => names.map((name, index) => ({
  id: preservedIds[name] ?? `${prefix}.verified_${String(index + 1).padStart(2, '0')}`,
  displayNameJa: name,
  displayNameEn: name,
  sortOrder: index + 1,
  isEnabled: true,
}))

writeJson('manifest.json', {
  gameTitle: 'Monster Hunter Wilds',
  appDataKind: 'gogma-artian-planner-master',
  gameVersion: 'unknown-initial',
  dataVersion: 2,
  generatedAt: null,
  notes: 'Weapon, element, bonus, rank, applicability, mapping, series skill, and group skill masters are project-owner verified. Lottery and material data remain disabled and unverified.',
})
writeJson('weapon-types.json', weapons)
writeJson('elements.json', elements)
writeJson('bonus-types.json', bonusTypes)
writeJson('bonus-ranks.json', bonusRanks)
writeJson('weapon-bonus-definitions.json', definitions)
writeJson(
  'series-skills.json',
  skillMaster('series_skill', seriesSkillNames, {
    '黒蝕竜の力': 'series_skill.gore_magala',
  }),
)
writeJson(
  'group-skills.json',
  skillMaster('group_skill', groupSkillNames, {
    'ヌシの魂': 'group_skill.apex',
  }),
)
