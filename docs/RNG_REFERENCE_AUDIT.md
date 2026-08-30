# Production RNG Engine 参照実装監査

## 0. 結論

この監査は Production RNG Engine の実装前調査であり、Production Engine、Domain、Search、Planner、Master、UI、Worker、Dexie、既存テストは変更していない。

最重要結論は次のとおりである。

1. 参照実装では、通常アーティアから巨戟アーティアへの強化時に復元ボーナスを再抽選しない。通常 tier の5枠をslot順のまま継承する。
2. 巨戟化は Gogma amendment stream を消費しない。代わりに Skill stream の次の1結果を消費し、Series / Group Skillを付与する。
3. Reset Bonuses / Keep BonusesだけがGogma amendment streamを消費する。
4. Keep Bonusesにユーザーがslotを選択する入力はない。全5slotについて各slotのbonus familyを固定し、同family内のtierを再抽選する。
5. 現行契約は `convert_normal_to_gogma -> predictGogmaBonus(new_gogma) -> advanceGogmaCounter`、変換直後Skillは `null/null`、Keepはselection列挙、という前提である。これは参照実装と一致しない。
6. したがって、**Production Engineを実装する前にDomain / RNG / Search / Planner契約を修正する必要がある**。現行interfaceへ無理に参照アルゴリズムを押し込むべきではない。

参照実装はユーザー指定の参照元である。ただし、本監査が確認したのは当該repositoryの実装内容であり、ゲーム本体の逆アセンブル、実機fixture、作者による正当性証明までは行っていない。参照実装内部で確認できない事項は未確認のまま残す。

本監査および後続仕様では確認状態を次のように区別する。

- `reference-verified` / 参照実装で確認済み: この監査commitのrepository実装と一致する
- `game-verified` / 実機確認済み: ユーザーの実機確認または同等の実ゲームfixtureで一致を確認した
- `unverified` / 未確認: 参照実装または実機から十分な根拠を得ていない

本監査のアルゴリズム抽出結果は原則としてreference-verifiedであり、それだけで全weapon、attribute、game versionについてgame-verifiedであるとは扱わない。Master IDの `.verified_*` は既存の安定ID文字列であり、この確認状態を表さない。

---

## 1. 参照元commitとprovenance

監査日: 2026-08-30 (Asia/Tokyo)

参照repository: <https://github.com/WiseHorror/Gogma-Artian-Roll-Planner>

監査commit:

```text
eceb2bd9ca6f4897ec516387acab2ad6beb8b38b
```

commit日時・件名:

```text
2026-08-27T19:59:23+01:00
Fix equip box limit
```

Lua版の自己申告versionは `0.9.4`。直前履歴には Wilds Ver.1.042.00.02 対応commitがあるが、本監査ではゲームversionとの完全な対応関係を別途検証していない。

### 1.1 参照ファイルと関数

| 参照 | 関数・節 | 監査で使用した意味 |
|---|---|---|
| [README.md](https://github.com/WiseHorror/Gogma-Artian-Roll-Planner/blob/eceb2bd9ca6f4897ec516387acab2ad6beb8b38b/README.md) | How Artian Weapons Work / Usage | 3 streamの独立性、巨戟化でSkill消費、Reset/Keepの意味、通常tier継承 |
| [app.js](https://github.com/WiseHorror/Gogma-Artian-Roll-Planner/blob/eceb2bd9ca6f4897ec516387acab2ad6beb8b38b/app.js#L109) | `u32`, `rngStep`, `initializeRng`, `advance` | 32-bit PRNG本体 |
| [app.js](https://github.com/WiseHorror/Gogma-Artian-Roll-Planner/blob/eceb2bd9ca6f4897ec516387acab2ad6beb8b38b/app.js#L149) | `skillFromIndex`, `predictSkillRoute` | Skill seed、294組、counter/Gate、`counterIsNext` |
| [app.js](https://github.com/WiseHorror/Gogma-Artian-Roll-Planner/blob/eceb2bd9ca6f4897ec516387acab2ad6beb8b38b/app.js#L176) | `skillAttributeForce`, `configuredBasePool`, `drawBase` | attribute変換、通常pool、slot抽選 |
| [app.js](https://github.com/WiseHorror/Gogma-Artian-Roll-Planner/blob/eceb2bd9ca6f4897ec516387acab2ad6beb8b38b/app.js#L210) | `repeatPenalty`, `keepFamily`, `familyId`, `buildGogmaPool`, `simulateGogma` | Gogma候補順、weight、重複penalty、Keep family |
| [app.js](https://github.com/WiseHorror/Gogma-Artian-Roll-Planner/blob/eceb2bd9ca6f4897ec516387acab2ad6beb8b38b/app.js#L258) | `initializeGogma`, `findGogmaRoute`, `findKeepGogmaRoute` | Gogma seed、Gate、Reset/Keep探索、10-step block |
| [app.js](https://github.com/WiseHorror/Gogma-Artian-Roll-Planner/blob/eceb2bd9ca6f4897ec516387acab2ad6beb8b38b/app.js#L342) | `calculate`, `calculateExisting` | 新規/既存route全体、conversion非Gogma消費、first reset |
| [app.js](https://github.com/WiseHorror/Gogma-Artian-Roll-Planner/blob/eceb2bd9ca6f4897ec516387acab2ad6beb8b38b/app.js#L724) | `getValues` | 表示Rarity 8に対する内部 `rarity = 7` |
| [GARP.lua](https://github.com/WiseHorror/Gogma-Artian-Roll-Planner/blob/eceb2bd9ca6f4897ec516387acab2ad6beb8b38b/reframework/autorun/GARP.lua#L527) | `rng_state_from_static_reference`, `read_skill_rng_state` | raw seed、`% 100000000`、live counter/Gate読取 |
| [GARP.lua](https://github.com/WiseHorror/Gogma-Artian-Roll-Planner/blob/eceb2bd9ca6f4897ec516387acab2ad6beb8b38b/reframework/autorun/GARP.lua#L619) | `rng_step`, `initialize_rng`, `initialize_gogma_rng` | Lua版PRNGとWeb版の一致 |
| [GARP.lua](https://github.com/WiseHorror/Gogma-Artian-Roll-Planner/blob/eceb2bd9ca6f4897ec516387acab2ad6beb8b38b/reframework/autorun/GARP.lua#L977) | `gogma_repeat_penalty` から `simulate_gogma_roll` | Lua版Gogma/KeepとWeb版の一致 |
| [GARP.lua](https://github.com/WiseHorror/Gogma-Artian-Roll-Planner/blob/eceb2bd9ca6f4897ec516387acab2ad6beb8b38b/reframework/autorun/GARP.lua#L1051) | `skill_type_from_table_index`, `predict_skill_route` | Lua版SkillとWeb版の一致 |
| [GARP.lua](https://github.com/WiseHorror/Gogma-Artian-Roll-Planner/blob/eceb2bd9ca6f4897ec516387acab2ad6beb8b38b/reframework/autorun/GARP.lua#L1193) | `skill_attribute_force_for_recipe`, `configured_base_reinforcement_pool`, `draw_base_reinforcement`, `predict_base_reinforcement` | 通常seed/pool/advance |
| [GARP.lua](https://github.com/WiseHorror/Gogma-Artian-Roll-Planner/blob/eceb2bd9ca6f4897ec516387acab2ad6beb8b38b/reframework/autorun/GARP.lua#L1529) | `packed_reinforcement_tier`, `find_mixed_gogma_route_from` | 通常tierを保持する巨戟と最初のReset強制 |
| [GARP.lua](https://github.com/WiseHorror/Gogma-Artian-Roll-Planner/blob/eceb2bd9ca6f4897ec516387acab2ad6beb8b38b/reframework/autorun/GARP.lua#L1837) | `install_create_count_hooks` | Normal counterのbefore/after |
| [GARP.lua](https://github.com/WiseHorror/Gogma-Artian-Roll-Planner/blob/eceb2bd9ca6f4897ec516387acab2ad6beb8b38b/reframework/autorun/GARP.lua#L1919) | `calculate_from_scratch_plan`, `calculate_existing_weapon_route` | conversion、initial skill、amendment streamの関係 |
| [GARP.lua](https://github.com/WiseHorror/Gogma-Artian-Roll-Planner/blob/eceb2bd9ca6f4897ec516387acab2ad6beb8b38b/reframework/autorun/GARP.lua#L2681) | `capture_target_planning_inputs` | 内部rarity 7、getter counterは次forge block |

Web版とLua版は、PRNG、seed salt、normal seed、skill seed、Gogma seed、Gate threshold、10-step block、5-slot draw、Gogma候補順、weight、repeat penalty、Keep family、21×14順序で一致する。Lua版だけがlive game state抽出、game runtime Skill Type変換、装備box decodingを持つ。

---

## 2. RNG概要とstream独立性

参照実装は以下の3 streamを別々に初期化・進行する。

1. Normal forge stream: `baseSeed + weaponType * 1000 + internalRarity`
2. Skill stream: `baseSeed + weaponType * 1000 + attributeForce`
3. Gogma amendment stream: Skillと同じseed材料だが、別counterと別Gate thresholdを使う

操作別の進行は次のとおり。

| Operation | Normal | Skill | Gogma |
|---|---:|---:|---:|
| create normal | +1 | 0 | 0 |
| convert to Gogma | 0 | +1（初回Skill付与） | 0 |
| reset skills | 0 | +1 | 0 |
| reset bonuses | 0 | 0 | +1 |
| keep bonuses | 0 | 0 | +1 |
| use as material | 参照元では確認不能 | 参照元では確認不能 | 参照元では確認不能 |

表の `+1` はDomain counter 1 block分であり、PRNG内部では隣接blockが10 `rngStep` 離れている。Normal/Gogmaの1結果は5slot抽選で5 stepを直接使用し、残り5 stepは次blockまでのpaddingになる。Skill結果はblock内の先頭1 stepを使用する。

---

## 3. PRNG

### 3.1 uint32とseed初期化

共通salt:

```text
0x00ac9365
```

初期state:

```text
x = 0x159a55e5
y = 0x1f123bb5
z = 0x05491333
w = 0x05491333
```

入力seedをuint32化後、100回のmixingを行う。各iterationでは `seedState & 3` による `0x65ac9365` の右shift、複数の左右shiftとXOR、xorshift形の `nextW` 計算を行う。100回目以外はstateを1wordずつshiftする。通常のstream進行 `rngStep` は次式のbit patternである。

```text
t = u32(x XOR u32(x << 15))
nextW = u32(w XOR (w >>> 21) XOR t XOR (t >>> 4))
(x, y, z, w) = (y, z, w, nextW)
```

### 3.2 TypeScript移植上の注意

- JavaScript bitwise演算の中間値はsigned 32-bitだが、`>>> 0` は同じ32-bit patternをunsigned numberへ戻す。
- 論理右shiftは必ず `>>>`。`>>` は符号拡張するため置換不可。
- 左shift、XOR直後、および外部へstateを返す境界で `>>> 0` を明示する。
- `^ 0x00ac9365` の結果もsignedになり得るため、初期化入口で必ずuint32化する。
- Luaの `& 0xffffffff` とJavaScriptの `>>> 0` を同じbit-pattern正規化として扱う。
- raw seedは64-bitになり得る。`Number`へ先に変換すると精度を失うため、raw入力のparseと `% 100000000` は `BigInt` で行い、その後に安全なnumberへ落とす案が安全である。
- このアルゴリズムには乗算mixはないため `Math.imul` は不要。ただし `weaponType * 1000` を含む加算全体はseed式の最後でuint32化する。

### 3.3 PRNG core Golden候補

参照 `app.js` 自身をNode VMで実行して採取した値。

| input seed | initialize `(x,y,z,w)` | 1 step後 `(x,y,z,w)` |
|---:|---|---|
| 0 | 1789334513, 75484576, 917002911, 723841435 | 75484576, 917002911, 723841435, 3327040012 |
| 1 | 310994555, 572947858, 2418431193, 3735855589 | 572947858, 2418431193, 3735855589, 1963134732 |
| 8524433 | 741306819, 761301096, 2928213327, 3487477469 | 761301096, 2928213327, 3487477469, 1381807740 |
| 4294967295 | 994290633, 1011362247, 235882909, 760277502 | 1011362247, 235882909, 760277502, 3441275361 |

---

## 4. Base Seed

Lua版はgame stateの64-bit `base_seed_raw` を読み、予測用Base Seedを次のように作る。

```text
baseSeed = baseSeedRaw % 100000000
```

したがって、参照mod/Web exportの `baseSeed` はraw値ではなく8桁範囲へ正規化済みの値である。現行 `RngState.baseSeed` が「REFrameworkが表示したraw qword」なのか「GARP exportの正規化済み値」なのかはUI文言だけでは区別されていない。`RngSetupPage` は現在文字列をそのまま保存し、`UnavailableRngEngine` のため `normalizeSeed()` を呼んでいない。

提案:

- `NormalizedSeed` のcanonical形式を `baseSeedRaw mod 100000000` の10進文字列と定義する。
- `normalizeSeed()` は10進/16進rawを`BigInt`でparseし、moduloを適用する。既に正規化済みの0..99,999,999へ再適用しても値は変わらない。
- Import parserとmanual saveの両方で同じ正規化境界を通す。
- raw値自体を監査表示したい場合は、予測用Base Seedとは別のdebug/provenance fieldとして扱う。今回は型変更しない。

---

## 5. Normal forge stream

### 5.1 seedとcounter

```text
seed = u32(baseSeed + referenceWeaponType * 1000 + internalRarity)
       XOR 0x00ac9365
state = initializeRng(seed)
state = advance(state, normalCounter * 10)
```

`normalCounter` / `createCount` は「次にforgeする結果の0-based block index」である。Luaの `getArtianCreateCount` コメントも、getterが次forgeで消費するblockを返すと明記する。forge 1回でDomain counterは `before -> before + 1`。抽選はblock先頭から5 step、次結果はさらに5 step進めた10-step境界から開始する。

### 5.2 表示Rarity 8と内部rarity

参照Web版はUI上Rarity 8を扱う一方、`getValues()`で常に `rarity = 7` を設定する。Lua版も `getArtianCreateCount(..., rarity = 7)` とseed式へ7を渡す。

```text
Domain NormalArtianRarity 8 -> game/reference internal rarity 7
```

Domain値8をそのままseedへ足してはならない。Domain IDと内部enumの明示adapterが必要であり、Master配列indexを流用してはならない。

### 5.3 5slot抽選とpool

各slotで1回 `rngStep` し、`w % pool.length` でpool entryを等確率選択する。選ばれたfamilyのcountを増やし、maxへ達したfamilyをpoolから除く。rankはすべてbase/通常tier。

| final attribute | pool順 | 上限 |
|---|---|---|
| None | Attack(6), Sharpness/Ammo family(7), Affinity(8) | Attack 5, family 7は2, Affinity 5 |
| Fire/Water/Thunder/Ice/Dragon/Poison/Paralysis/Sleep/Blast | Attack(6), Element(4), Sharpness/Ammo family(7), Affinity(8) | Attack 5, Element 5, family 7は2, Affinity 5 |

Normal seed自体にはelement/attributeを含めないが、pool選択には最終attributeが必要である。現行 `NormalArtianPredictionInput` は `elementId` またはrecipe/pool入力を持たないため不足している。

参照のconfigured poolはweapon typeで分岐しない。Bowからfamily 7を除外せず、LBG/HBGのelement familyも除外しない。これは現行Master制約と衝突するが、参照repositoryだけから「参照実装が省略している」のか「現行Domain制約が誤り」なのかは確定できない。Production poolへ採用する前に実機fixtureで確認し、現行Domain制約を勝手に変更しない。

固定commitのBow / Blast / `baseSeed=42` / `normalCounter=0` は lottery ID
`[4, 8, 7, 4, 7]` を返す。これは **reference-verified** のraw parityであり、
Bowでもfamily 7を含むreference poolをそのまま保持する。現DomainではBowにfamily 7
（Sharpness/Capacity）のsemantic対応がないため、このreference raw結果はDomain bonusへ
推測変換してはならず、ID 7を含む結果は明示的にunmappableとして扱う。

別途、game ruleとしてNormalの付与可能bonusは武器種と属性有無で分岐する。C4-C時点の
**game-verified Normal pool** は次の限定されたmatrixである。

| Weapon | Attribute present | None |
|---|---|---|
| Bow | `[6, 4, 8]` | `[6, 8]` |
| Light Bowgun | `[6, 7, 8]` | `[6, 7, 8]` |
| Heavy Bowgun | `[6, 7, 8]` | `[6, 7, 8]` |
| Long Sword | `[6, 4, 7, 8]` | `[6, 7, 8]` |

属性ありBowは属性種類では分岐しない。実測fixtureはすべて `baseSeed=51231782` / display
rarity 8 / Normal Counter 0, 1, 2 である。Fire Bow（C4-B）、Bow none、Light Bowgun
Fire/none、Long Sword Fire/noneの5追加条件・75slotは、PRNG、seed、100 mix、10-step
block、family 7上限、raw値のskip/retryを変えずcandidate poolだけで実ゲーム観測と完全一致
した。LBG Fireとnoneは同じ15slotであり、LBGのNormal poolにfamily 4は含まれない。

HBG Fire/noneは `baseSeed=51231782` / display rarity 8 / Normal Counter 4, 5, 6 の各3本・
15slotが同一である。`[6, 7, 8]` poolは開始Counter 0..5000のうち `k=4` の1件だけでこの
連続15slotに完全一致する。一方Fireのreference elemental pool `[6, 4, 7, 8]` には同範囲で
完全一致がない。従ってHBGについてもcandidate pool以外のPRNG、seed、100 mix、10-step block、
family 7上限、raw値のskip/retryを変更せず、属性あり／noneとも `[6, 7, 8]` をgame-verifiedとする。

reference full poolでは、Fire Bowの開始Counter 0..5000に同じ3本連続の完全一致はない。
この差異はfamily 7を抽選後にskip/retryするのではなく、candidate pool自体から除外する
game-adjusted predictionの根拠である。reference-verified poolとgame-verified poolは別に
維持する。

このgame-verified APIは上表以外を明示unsupportedとする。その他の近接武器、その他
referenceとDomain制約が衝突する条件の実ゲームRNG poolは未検証であり、reference-only結果を
game-verifiedとしてfallback返却してはならない。この観測は全weapon・全game versionを確定
するものではない。

### 5.4 numeric ID namespace注意

参照Luaには別namespaceがある。

- Normal lottery計算用: 4=Element, 6=Attack, 7=Sharpness/Ammo family, 8=Affinity
- 保存済みbase-tier `BonusByGrinding` 表示用: 4=Attack, 6=Element, 7=Sharpness, 8=Affinity

同じ数値4/6でも文脈が違う。参照numeric IDをDomainへ直接保存せず、`reference lottery ID` と `saved equipment ID` を別adapter tableにする必要がある。

---

## 6. Skill stream

### 6.1 seed、Gate、抽選位置

```text
seed = u32(baseSeed + referenceWeaponType * 1000 + attributeForce)
       XOR 0x00ac9365
state = initializeRng(seed)
effectiveBlock = counterGate < 0x36 ? 0 : skillCounter
state = advance(state, effectiveBlock * 10)
state = rngStep(state)
combinationIndex = state.w % 294
```

Skill Gate thresholdは `0x36 = 54`。Gateが54未満なら保存counter値をseed offsetへ使わず、effective block 0から予測する。counter値そのものを書き換える処理ではない。

`skillCounter` は次に消費されるSkill resultのblock index。巨戟化時の初回付与とReset Skillsはいずれも1 blockを消費し、Domain counterは+1。結果間隔は10 PRNG stepで、結果値は各blockの最初の1 step後の`w`を使う。

### 6.2 `counterIsNext`

`counterIsNext` はcounterの別定義ではなく、route起点の違いを補正する検索flagである。

- New weapon (`false`): 現在counterの結果はconversion時のinitial skill。最初のReset Skillsはさらに10 step先。
- Existing weapon (`true`): 現在武器のskillは既に過去に消費済み。現在counterの結果が次のReset Skills 1回目なので、reroll 1では追加10 stepしない。

現行の `skillCounterBefore/After` へ対応させる場合、conversion initial assignmentも `before = current`, `after = current + 1`、Reset Skillsも同じ+1である。現行RouteOperationにはconversionのSkill before/afterを表す場所がない。

### 6.3 21 Series × 14 Group

```text
setIndex   = floor(combinationIndex / 14)
groupIndex = combinationIndex % 14
```

Series-major、Group-minorの294通り。現在Masterのenabled件数から直積を再構築してはならない。Luaはさらに組合せをgame runtime Skill Typeへ写像し、最初のSeries blockでは値6、以降の15幅blockでは各blockの1値をskipする。Production Engineの出力はsemantic IDとし、このruntime numeric typeをDomainへ漏らさない。

---

## 7. Series Skill mapping

参照RNG順はMaster `sortOrder` と同じとは限らない。次の固定adapterが必要である。

| RNG index | 参照名 | SeriesSkillId |
|---:|---|---|
| 0 | Doshaguma's Might | `series_skill.verified_01`（闢獣の力） |
| 1 | Rathalos's Flare | `series_skill.verified_02`（火竜の力） |
| 2 | Xu Wu's Vigor | `series_skill.verified_11`（暗器蛸の力） |
| 3 | Gravios's Protection | `series_skill.verified_09`（鎧竜の守護） |
| 4 | Blangonga's Spirit | `series_skill.verified_08`（雪獅子の闘志） |
| 5 | Ebony Odogaron's Power | `series_skill.verified_03`（兇爪竜の力） |
| 6 | Fulgur Anjanath's Will | `series_skill.verified_07`（雷顎竜の闘志） |
| 7 | Uth Duna's Cover | `series_skill.verified_05`（波衣竜の守護） |
| 8 | Rey Dau's Voltage | `series_skill.verified_06`（煌雷竜の力） |
| 9 | Nu Udra's Mutiny | `series_skill.verified_12`（獄焔蛸の反逆） |
| 10 | Jin Dahaad's Revolt | `series_skill.verified_10`（凍峰竜の反逆） |
| 11 | Gore Magala's Tyranny | `series_skill.gore_magala`（黒蝕竜の力） |
| 12 | Arkveld's Hunger | `series_skill.verified_14`（鎖刃竜の飢餓） |
| 13 | Guardian Arkveld's Vitality | `series_skill.verified_04`（護鎖刃竜の命脈） |
| 14 | Mizutsune's Prowess | `series_skill.verified_15`（泡狐竜の力） |
| 15 | Zoh Shia's Pulse | `series_skill.verified_16`（白熾龍の脈動） |
| 16 | Leviathan's Fury | `series_skill.verified_19`（海竜の渦雷） |
| 17 | Seregios's Tenacity | `series_skill.verified_18`（千刃竜の闘志） |
| 18 | Gogmapocalypse | `series_skill.verified_24`（巨戟龍の黙示録） |
| 19 | Soul of the Dark Knight | `series_skill.verified_21`（暗黒騎士の証） |
| 20 | Omega Resonance | `series_skill.verified_22`（オメガレゾナンス） |

Current Masterは25件、enabled 21件で、参照pool 21件とsemantic setは一致する。disabledの花舞の祈り、踊火の祈り、夢灯の祈り、祝謡の祈りは参照RNG poolにない。

---

## 8. Group Skill mapping

| RNG index | 参照名 | GroupSkillId |
|---:|---|---|
| 0 | Neopteron Alert | `group_skill.verified_04`（甲虫の知らせ） |
| 1 | Neopteron Camouflage | `group_skill.verified_07`（甲虫の擬態） |
| 2 | Flexible Leathercraft | `group_skill.verified_02`（革細工の柔性） |
| 3 | Buttery Leathercraft | `group_skill.verified_08`（革細工の滑性） |
| 4 | Scaling Prowess | `group_skill.verified_01`（鱗張りの技法） |
| 5 | Scale Layering | `group_skill.verified_09`（鱗重ねの工夫） |
| 6 | Fortifying Pelt | `group_skill.verified_03`（毛皮の昂揚） |
| 7 | Alluring Pelt | `group_skill.verified_10`（毛皮の誘惑） |
| 8 | Lord's Favor | `group_skill.verified_06`（ヌシの誇り） |
| 9 | Lord's Fury | `group_skill.verified_12`（ヌシの憤激） |
| 10 | Guardian's Pulse | `group_skill.verified_05`（護竜の脈動） |
| 11 | Guardian's Protection | `group_skill.verified_11`（護竜の守り） |
| 12 | Imparted Wisdom | `group_skill.verified_13`（先達の導き） |
| 13 | Lord's Soul | `group_skill.apex`（ヌシの魂） |

Current Masterは17件、enabled 16件。参照poolは14件であり、次のenabled 2件が参照RNG poolに存在しない。

- `group_skill.verified_14`（栄光の誉れ）
- `group_skill.verified_15`（祝祭の巡り）

disabledの `group_skill.verified_17`（拳を極めし者）も参照poolにない。参照repositoryからは、追加2件が別用途Masterなのか、ゲームupdate差なのか、参照実装の欠落なのかを判断できない。Production Skill poolへ含めず、実機fixtureまたは別の一次根拠が得られるまで未確認とする。

---

## 9. Weapon / Element mapping

### 9.1 WeaponType

参照値は0-based。Current Masterの配列index/sortOrderを暗黙利用せず明示adapterを置く。

| 参照値 | WeaponTypeId | 注記 |
|---:|---|---|
| 0 | `weapon.great_sword` | Great Sword |
| 1 | `weapon.sword_and_shield` | Sword & Shield |
| 2 | `weapon.dual_blades` | Dual Blades |
| 3 | `weapon.long_sword` | Long Sword |
| 4 | `weapon.hammer` | Hammer |
| 5 | `weapon.hunting_horn` | Hunting Horn |
| 6 | `weapon.lance` | Lance |
| 7 | `weapon.gunlance` | Gunlance |
| 8 | `weapon.switch_axe` | Switch Axe |
| 9 | `weapon.charge_blade` | Charge Blade |
| 10 | `weapon.insect_glaive` | Insect Glaive |
| 11 | `weapon.bow` | Bow |
| 12 | `weapon.heavy_bowgun` | Heavy Bowgun |
| 13 | `weapon.light_bowgun` | Light Bowgun |

Current Master表示順はLong Swordが2、Sword & Shieldが3、Dual Bladesが4であり、またLBGが13、HBGが14である。sortOrderから参照値を導くと誤る。

### 9.2 Element / display attribute / attributeForce

参照Web/Luaのrecipe selectorは1-based display index、seedは0-basedかつThunder/Iceが入れ替わる`attributeForce`を使う。

| ElementId | display index | attributeForce |
|---|---:|---:|
| `element.none` | 1 | 0 |
| `element.fire` | 2 | 1 |
| `element.water` | 3 | 2 |
| `element.thunder` | 4 | 4 |
| `element.ice` | 5 | 3 |
| `element.dragon` | 6 | 5 |
| `element.poison` | 7 | 6 |
| `element.paralysis` | 8 | 7 |
| `element.sleep` | 9 | 8 |
| `element.blast` | 10 | 9 |

Normal seedはattributeForceを使わず、none/non-noneでpoolが変わる。Skill/Gogma seedは必ずattributeForceを使う。Current Element Masterの配列indexをそのままseedへ使ってはならない。

---

## 10. Gogma amendment stream

### 10.1 seed、Gate、counter

```text
seed = u32(baseSeed + referenceWeaponType * 1000 + attributeForce)
       XOR 0x00ac9365
state = initializeRng(seed)
effectiveBlock = counterGate < 0x23 ? 0 : gogmaCounter
state = advance(state, effectiveBlock * 10)
```

Gogma Gate thresholdは `0x23 = 35`。Gateが35未満ならeffective block 0を使う。`gogmaCounter` は次のReset/Keep amendment結果のblock index。各amendmentで+1。各結果は5slotで5 stepを使い、次amendment blockは10 step先。

### 10.2 Reset Bonuses候補順・weight

Resetは以前の5枠を完全に無視し、全slotを次の固定順poolから抽選する。

| 参照ID | Domain | 初期weight | repeat penalty |
|---:|---|---:|---:|
| 8 | `bonus_type.attack / bonus_rank.ii` | 100 | 50 |
| 12 | `bonus_type.attack / bonus_rank.iii` | 100 | 50 |
| 15 | `bonus_type.attack / bonus_rank.ex` | 100 | 80 |
| 9 | `bonus_type.affinity / bonus_rank.ii` | 100 | 50 |
| 13 | `bonus_type.affinity / bonus_rank.iii` | 100 | 50 |
| 16 | `bonus_type.affinity / bonus_rank.ex` | 100 | 80 |
| 11 | `bonus_type.element / bonus_rank.ii` | 100 | 50 |
| 14 | `bonus_type.element / bonus_rank.ex` | 100 | 80 |
| 6 | `bonus_type.gogma_sharpness_capacity / bonus_rank.base` | 100 | 50 |
| 10 | `bonus_type.gogma_sharpness_capacity / bonus_rank.ex` | 100 | 80 |

slotごとに、既に選択済みの「同じ参照ID」の個数 `n` に対して次を使う。

```text
weight = max(0, 100 - n * repeatPenalty(id))
```

`w % totalWeight` を候補順に減算して選択する。penaltyはfamily単位ではなくexact tier ID単位。いずれのIDも最大2回までだが、EXの2回目はweight 20、非EXの2回目はweight 50になる。

参照実装のGogma poolはweapon/elementで候補を除外しない。noneでもElement、BowでもSharpness/Ammo、LBG/HBGでもElementが候補に残る。Current `WeaponBonusDefinition` はこれらを無効とするため衝突する。どちらを正すべきかは参照repositoryだけでは確定不能であり、Production採用前のfixture確認事項である。

Current Gogma MasterにはAttack/Affinity/Elementのrank Iも存在するが、参照Reset/Keep poolにはない。参照上、巨戟化直後は通常tierをそのまま持ち、rank Iへ変換しない。

---

## 11. Keep Bonuses

参照実装のKeepは次の仕様である。

- 全5slotを再抽選する。
- 各slotは現在slotのbonus familyを保持する。
- 保持するのはexact rankではなくfamily。
- ユーザーが保持slotを選択するparameterはない。
- Resetと同じGogma counter/seed/Gateを使う。
- 1回でGogma counterを+1する。
- slotごとに1 step、結果block間は10 step。
- 同じ5slot結果内のexact ID重複penaltyはResetと同じ。

family:

| family | 参照ID |
|---|---|
| Attack | 8, 12, 15 |
| Affinity | 9, 13, 16 |
| Element | 11, 14 |
| Sharpness/Ammo | 6, 10 |

`enumerateKeepSelections()` に相当する分岐は参照実装にない。現在bonusの各slot familyから候補poolが一意に定まる。現行Searchのfrontier自体は連続Keep結果を追う用途には使えるが、各depthでselectionを列挙して枝分かれする必要はない。

また現行 `predictGogmaBonus({ operation: { type: "keep_bonuses", selection }})` はsourceの現在5枠を直接受け取らない。`engineParameters`へpacked layoutを埋め込むことは技術上可能でも、参照numeric encodingをDomainへ漏らすため推奨しない。Keep prediction inputへcurrent `RestorationBonusSet` を明示する契約が必要である。

---

## 12. 通常アーティアから巨戟化

質問A-Fへの回答:

| 質問 | 参照実装の回答 |
|---|---|
| A. conversionでRestoration Bonusは変わるか | 変わらない。normal/base-tierのslot順5枠を継承する。 |
| B. conversionでGogma Counterは進むか | 進まない。 |
| C. conversionでSkill Counterは進むか | 1進む。 |
| D. 初回Series/Group Skillはどの位置か | conversion前の`skillCounter`が指す次block。Gate適用後 `counter*10 + 1 step` の `w % 294`。 |
| E. 巨戟化直後に通常tier bonusを保持するか | 保持する。Luaはpacked値中の各3桁が9未満のみならbase-tierと判定する。 |
| F. 最初のReset Bonuses時の入力bonus | 継承したnormal/base-tierのpacked 5枠。Reset抽選自体は以前の値を無視するが、base-tier状態では最初のamendmentをResetに強制し、Keep開始を許可しない。 |

New weapon計算はNormal forge候補を何本進めてもNormal streamだけを進め、選択した1本を一度だけ巨戟化する。Skill initial resultは全Normal候補で同じ現在Skill位置から計算され、Gogma amendmentは必要な場合だけ現在Gogma位置から始まる。

現行 `normalArtianRouteSearch` は各Normal候補ごとに`predictGogmaBonus(new_gogma)`を呼び、discardした各forgeにも`convert_normal_to_gogma`を追加し、NormalとGogma counterをpaired advanceする。これは参照routeと一致しない。

---

## 13. Counter / Gate対応表

| stream | 参照counterの意味 | 1操作後 | PRNG位置 | Gate |
|---|---|---:|---|---|
| Normal | 次forge結果の0-based block index | +1 | `counter*10`から5 draw | なし |
| Skill | 次にconversion/resetで消費する結果block | +1 | effective `counter*10`後に1 draw | `<54`ならcounter offset無視/0 |
| Gogma | 次Reset/Keep結果のblock | +1 | effective `counter*10`から5 draw | `<35`ならcounter offset無視/0 |

現行before/afterとの対応:

| Route operation | 現行field | 参照上の正しいbefore/after |
|---|---|---|
| `create_normal_artian` | `normalCounterBefore/After` | `c -> c + count` |
| `convert_normal_to_gogma` | `gogmaCounterBefore/After` | Gogmaは`g -> g`。代わりにSkill `s -> s+1`が必要 |
| `reset_skills` | `skillCounterBefore/After` | `s -> s+1` |
| `reset_bonuses` | `gogmaCounterBefore/After` | `g -> g+1` |
| `keep_bonuses` | `gogmaCounterBefore/After` | `g -> g+1` |

Gate未満時も保存counterのDomain before/afterが+1するかどうかは、参照コードの予測offset処理だけでは実機state更新まで直接確認できない。参照予測はcounter値を0へ書き換えず、offset計算時だけ無視する。実装時は「Domain counter更新」と「effective PRNG offset」を分離し、実機fixtureでGate未満の更新を確認する。

---

## 14. Current RngEngine対応表

### 14.1 現状

- `RngEngine` interfaceとfixture-only `FakeRngEngine`が存在する。
- `FakeRngEngine` は入力全体のJSON一致fixtureだけを返し、weight/counter/Keepを推測しない。
- production placeholderは `UnavailableRngEngine` で全capability false、全methodがunsupported error。
- Candidate Search Worker entryは `UnavailableRngEngine` を生成する。
- Planner Worker controllerはdependency注入境界だけ存在し、現行treeにproduction entry/factory/client wiringはない。
- Settingsは「RNG予測エンジン: 未設定」。Debug画面はEngine情報を含め全項目placeholder。
- RNG Setupは4 KnownValueを独立保存するが、manual Base Seedをまだ`normalizeSeed()`へ通さない。
- Lottery Masterは1件だけ、weight 0 / disabled / unverified placeholder。Normal Searchはenabled normal lotteryを要求するため現状skipされる。

### 14.2 method判定

| method | 判定 | 理由・必要変更 |
|---|---|---|
| `normalizeSeed` | 入力意味の明確化が必要 | signatureは維持可能。raw qword/10進/16進を`mod 100000000`したcanonical decimal stringにする案。 |
| `predictNormalArtian` | 入力変更が必要 | seedにはDomain rarity8→internal7 mapping。結果poolのためelement/recipe/finalAttributeまたはreference-verified pool入力が不足。 |
| `predictGogmaBonus` | 意味が誤っている + 入力変更が必要 | `new_gogma`はGogma bonus predictionではない。Resetは利用可。Keepはcurrent 5slot入力が必要。 |
| `predictSkills` | そのまま使える（意味明確化とID adapterは必要） | 次Skill blockのSeries/Groupを返す契約として適合。21×14固定tableを使う。 |
| `enumerateKeepSelections` | 不要 | 参照Keepにユーザーselection/slot subset分岐がない。全slot family固定の単一動作。 |
| `advanceGogmaCounter` | 一部の意味が誤っている | Reset/Keepは+1。`create_gogma_from_normal`は+0またはoperation自体をGogma unionから除外。`consume_as_material`は未確認。 |
| `advanceSkillCounter` | そのまま使える | `assign_skills`と`reset_skills`はいずれも+1。Search/Routeが前者を現在表現していない。 |
| `advanceNormalCounter` | そのまま使える | `count`分加算。Engine内部のPRNG step数10とDomain counter deltaを混同しない。 |

不足契約の第一候補は、(a) conversionでinitial Skillを予測・記録するRoute表現、(b) current bonusesを受けるGogma amendment prediction、(c) Normal recipe/pool入力、(d) semantic IDと参照numeric/orderを分離するreference-verified adapter tableである。新methodが必須か、既存method/operation inputを直すかは仕様決定事項。

---

## 15. 現在契約との仕様衝突

### 15.1 必ず先に直す衝突

1. `RNG_SPEC.md` の `predictGogmaBonus(operation: new_gogma)` は、参照上存在しないbonus再抽選を表す。
2. `GogmaOperation.create_gogma_from_normal` と `ConvertToGogmaOperation.gogmaCounterBefore/After` はstreamが誤っている。
3. conversion initial SkillをRouteOperation/ExpectedResult/Traceが表現できない。
4. `PLANNER_SPEC.md` 11.0の「巨戟化直後Skillはnull/null、Skillはreset_skillsだけが設定」は参照と正反対。
5. OwnedGogma/Target bonus validationが`gogma_artian` scopeだけを許すため、通常tierを継承した巨戟を正しく表現・評価できない。
6. Keep selection列挙は参照にない。Keep predictionにはcurrent slot familyが必要。
7. Normal inputにfinal attribute/recipe/poolがない。
8. Domain rarity8を内部seed値7へ明示mappingする契約がない。

### 15.2 Searchへの影響

- Normal routeの`maximumPairedAdvance = min(maxNormalAdvance,maxGogmaAdvance)`を廃し、discard forgeはNormalのみ進める必要がある。
- Normal候補ごとの複数conversion operation生成を止め、採用する1本に1 conversionだけ置く。
- conversionはGogma capability/counterを要求せず、initial Skill predictionに必要なSkill capabilityを要求する。
- conversion result bonusesはnormal scope継承、skillsはinitial prediction。
- Reset Skills探索はconversionがSkillを1消費した後のcounterから始める。
- Owned Normal routeも同じ。`predictGogmaBonus(new_gogma)`を呼ばない。
- 巨戟tier targetへ進む場合、conversion後の最初のbonus amendmentはResetでなければならず、同Route Keep禁止の既存v1方針とは整合する。ただしResetを同Routeで扱うか、確保後の別routeとするかはproduct仕様判断が必要。
- Existing Gogma Keepはselection branchではなく、現在slot familyから一意の次結果を連鎖させる。
- Search Trace、estimated advances、searchStateHashの依存streamを更新する。

### 15.3 Plannerへの影響

- `plannerRouteProgress.counterDetails/engineAdvance`でconversionをGogmaからSkillへ移す。
- same-counter conflictはconversionについて`same_skill_counter`になる。
- Beam Searchのshared RNG simulationとroute prerequisiteをSkill進行へ変更する。
- Trace Replay conversionはnormal bonusをそのままtransient Gogmaへ渡し、initial skillsを予測し、Skill counterを進める。
- `ExpectedResult`、`RngAdvance`、debug before/afterはconversionのSkill deltaを記録する。
- material replenishmentのconversionもSkill streamを消費し、Gogma streamを消費しない。
- reserve時にnormal-tier bonusを持つGogmaをInventoryへ保存できる型/validationが必要。
- Candidate SnapshotとBuildRoute operation意味が変わるため、CalculationContext/RNG Engine versionだけでなくspec/schema migration方針が必要。

### 15.4 影響対象一覧

| 対象 | 影響 |
|---|---|
| `BuildRoute` / `RouteOperation` | conversion counter fields、initial Skill付与、bonus scope |
| Candidate Search | Normal/Skill/Gogmaの進行分離、Keep単一路、Normal input |
| Search Trace / hash | conversion依存streamとcounter位置 |
| Beam Search | counter stream、conflict、material conversion |
| Trace Replay | conversion prediction、transient result、counter delta |
| `ExpectedResult` | conversion直後の継承bonus + initial skills |
| `RngAdvance` | conversion `skill +1`, `gogma +0` |
| ProductionPlan | Step expected state/debug/instruction |
| Tests | Fake fixturesではなく参照由来Golden、route/stream/conflict期待値 |

---

## 16. Master / Lottery Master方針

推奨は提示案Dに相当する **B + Cのhybrid**。

### Engine内部定数 (C)

- PRNG初期stateとmix定数
- XOR salt
- block size 10、slot draw 5
- Skill/Gogma Gate threshold
- seed式

これらは表示・ユーザー選択用Masterではなくアルゴリズムそのもの。

### RNG-specific reference-verified table (B)

- WeaponTypeId ↔ reference numeric value
- ElementId ↔ display index ↔ attributeForce
- Series/Group fixed RNG order
- reference Gogma bonus ID ↔ Domain bonus type/rank/family
- Reset候補順、base weight、repeat penalty class
- Normal lottery IDと保存equipment IDの別mapping
- Normal pool order/max（実機確認後）

tableにはsource commit、game version、rngEngineVersion、検証状態を持たせる。Domain/Worker境界ではsemantic IDへ変換済みとし、reference numeric IDを永続entityへ漏らさない。

現行 `LotteryMaster` をそのまま有効化する案Aは不適切。現行schemaはslot間repeat penalty、Keep family、候補順、Gate、seed式、別numeric namespace、Cartesian skill orderを表現できず、現在データもdisabled placeholderである。全値をEngine private constantだけにする案C単独は実装可能だが、provenanceとtable-driven Golden reviewが弱くなる。現行Lottery Masterは仕様改訂までdisabledのまま維持する。

---

## 17. Golden Test Vector方針

期待値はGogmaArtianPlanner実装から生成しない。commit固定した参照 `app.js` の関数をNode VMで直接実行する抽出script、または同commitのLua関数を独立harnessで実行してJSON fixture化する。fixtureには必ずsource commit、関数名、入力のnumeric namespace、semantic変換後期待値を併記する。

### 17.1 Skill候補

| baseSeed | weapon | attributeForce | Gate | counter | index | SeriesSkillId | GroupSkillId |
|---:|---:|---:|---:|---:|---:|---|---|
| 8524433 | 10 | 4 | 200 | 186 | 275 | `series_skill.verified_21` | `group_skill.verified_12` |
| 1 | 0 | 0 | 0 | 999 | 107 | `series_skill.verified_05` | `group_skill.verified_12` |
| 99999999 | 13 | 9 | 54 | 0 | 196 | `series_skill.verified_15` | `group_skill.verified_04` |

2件目はGate未満でcounter 999が無視される境界、3件目はthreshold等値を含む。

### 17.2 Gogma Reset候補

current 5枠はReset結果へ影響しないことも同seed/counterで別currentを与えて検証する。

| baseSeed / weapon / attr / Gate / counter | current reference IDs | result Domain順 |
|---|---|---|
| 8524433 / 10 / 4 / 200 / 45 | 5,3,6,7,5（base-tier例） | element II, affinity III, affinity II, attack III, element II |
| 1 / 0 / 0 / 0 / 999 | 8,9,11,6,8 | affinity EX, attack EX, attack II, attack II, attack EX |

2件目はGogma Gate未満でcounterが無視される境界。

### 17.3 Keep候補

| baseSeed / weapon / attr / Gate / counter | current | next Keep |
|---|---|---|
| 8524433 / 10 / 4 / 200 / 45 | attack EX, attack III, attack II, affinity EX, sharp/ammo EX | attack III, attack II, attack EX, affinity EX, sharp/ammo base |
| 42 / 0 / 1 / 35 / 2 | attack II, affinity II, element II, sharp/ammo base, attack EX | attack EX, affinity II, element II, sharp/ammo base, attack III |

各slotのfamilyが不変でrankだけ変化することをslot順でassertする。2件目は4 familyを含みGate threshold等値を含む。

### 17.4 Normal候補

| baseSeed / weapon / internal rarity / counter / display attribute | result Domain順 |
|---|---|
| 8524433 / 10 / 7 / 33 / Thunder(4) | attack base, element base, attack base, affinity base, element base |
| 1 / 0 / 7 / 0 / None(1) | attack base, attack base, affinity base, affinity base, sharpness family base |
| 99999999 / 13 / 7 / 123 / Blast(10) | affinity base, element base, element base, affinity base, element base |

3件目は参照上LBGでもElementが出ることを示す**衝突検出vector**であり、実機で確認されるまでProduction correctnessの肯定fixtureにはしない。

### 17.5 追加すべき境界vector

- Gate 34/35 (Gogma)、53/54 (Skill)
- counter 0/1、隣接counterの10-step separation
- visible rarity8をinternal7へ変換した結果と、誤って8を使ったnegative test
- 全14 weapon mapping
- Thunder/Ice attributeForce swap
- exact ID重複が0/1/2回のweight 100/50/0および100/20/0
- Keepの全family layout、同family複数slot
- Normal sharpness family上限2
- raw seedが2^53を超える場合のBigInt modulo
- Web/Lua両harnessで同一fixtureが一致するparity test

---

## 18. Production Engine実装前に決める事項

1. `OwnedGogmaArtianWeapon` がnormal-tier bonusを保持できる表現。scopeをbonus instanceに持たせるか、weapon stateでtierを持つか。
2. Targetがnormal-tier継承状態を完成条件にできるか。v1で対象外なら、conversion後の最初のResetをどのRouteへ含めるか。
3. conversion initial Skillを `ConvertToGogmaOperation` に内包するか、`assign_skills` RouteOperationを追加するか。
4. `ConvertToGogmaOperation` のGogma before/afterを削除し、Skill before/afterへ変えるschema/migration。
5. `predictGogmaBonus(new_gogma)` と `create_gogma_from_normal` を削除/再定義する方針。
6. Keep current bonus入力と、`enumerateKeepSelections`廃止方針。
7. Normal Predictionへrecipe/finalAttribute/poolのどれを渡すか。
8. Rarity8→internal7、Weapon、Element、Skill、Bonusのreference-verified adapter配置。
9. Bow/LBG/HBG/elementlessのpool restrictionを参照実装どおりにするか、現行Domain制約を維持するか。実機fixture必須。
10. Current Masterにある参照pool外Group 2件、Gogma rank Iの意味。
11. Gate未満で実ゲームcounter自体が操作後どう更新されるか。
12. `consume_as_material` がどのstreamを進めるか。参照元では確認不能。
13. 参照repositoryのgame update対応範囲と、GogmaArtianPlanner `CalculationContext.gameVersion` の確定値。

---

## 19. 推奨実装フェーズ

依存順は次のとおり。

### A. Contract decision / specification correction

上記18項を決定し、RNG_SPEC、DATA_MODEL、SEARCH_SPEC、PLANNER_SPECを先に改訂する。特にconversion stream、bonus scope、Keep input、Normal inputを固定する。ここを飛ばしてProduction Engineを実装しない。

### B. Reference-verified adapter tables + PRNG core

reference commit/game version provenance付きtable、Base Seed normalize、uint32 PRNG、seed builder、Gate offset、mapping validationを実装。PRNG Goldenだけで独立検証する。

### C. Skill Prediction

21×14固定順、attributeForce、initial assignment/resetのcounter意味を実装。conversion Route変更前でもpure engine testを先行できる。

### D. Gogma Reset / Keep

Reset pool/order/weight/repeat penalty、Keep slot family固定、Gogma Gateを実装。weapon restriction未確認fixtureはcapabilityまたはvalidationで安全側に扱う。

### E. Normal Artian Prediction

internal rarity mapping、recipe/pool input、10-step block、5slot抽選を実装。weapon-specific restrictionの実機確認後にproduction capabilityを有効化する。

### F. Search / Planner / Route / Trace correction

conversionをSkill streamへ移し、bonus継承、initial Skill、normal discard forge、Keep単一路、Beam/Conflict/Trace Replay/ExpectedResultを修正する。新CalculationContext/RNG Engine versionで旧candidate/planをstale化する。

### G. Production wiring / Worker / UI / Debug

Unavailable factoryをProduction factoryへ切替え、Search/Planner Workerを配線する。Settings/Debugへengine version、mapping/source commit、active capabilitiesを表示し、Base Seed normalizerをRNG Setupへ接続する。

### H. Reference-vs-production integration verification

commit固定fixtureを両実装へ流し、Web/Lua/reference extractorとProduction Engineの出力を比較する。全capabilityを一括で有効にせず、reference-verified stream単位で有効化する。実機fixtureを通過した範囲だけをgame-verifiedへ昇格する。

---

## 20. 未確認事項と推測禁止事項

次は参照repositoryから確定できないため、Production値として推測しない。

- 参照実装自体のアルゴリズムが全weapon/attribute/game versionで実ゲームと一致すること。
- BowのSharpness/Ammo family、LBG/HBGのElement family、elementless Gogma Element bonusの実ゲーム可否。
- Current Masterの栄光の誉れ、祝祭の巡りがArtian RNG対象か、別用途か、update差か。
- Gogma rank I Master entriesの実ゲーム上の意味。参照Reset/Keep poolにはない。
- Gate未満時の実counter保存更新。
- use as materialのRNG進行。
- Normal poolのnative recipe capture/fitted poolとconfigured fallbackが全recipeで一致すること。
- Lua内のNormal lottery IDとsaved equipment IDの4/6入替えが、意図的な別namespaceであることの作者説明。コード上は別tableとして存在する事実だけ確認した。
- game runtime Skill Typeのholeを含むnumeric値が将来versionでも同じこと。

これらは「未確認」のままGolden/Capability/Debugへ明示し、現行Masterまたは参照numeric値から補完しない。

---

## 21. 監査対象となった現行ファイル

主要な現行実装確認先:

- `src/domain/rng/rngEngine.ts`
- `src/domain/rng/fakeRngEngine.ts`
- `src/domain/rng/unavailableRngEngine.ts`
- `src/domain/rng/capabilities.ts`
- `src/domain/search/normalArtianRouteSearch.ts`
- `src/domain/search/ownedNormalArtianRouteSearch.ts`
- `src/domain/search/existingGogmaRouteSearch.ts`
- `src/domain/search/routeSearchShared.ts`
- `src/domain/planner/plannerRouteProgress.ts`
- `src/domain/planner/plannerTraceReplay.ts`
- `src/domain/planner/productionPlanGeneration.ts`
- `src/workers/search.worker.entry.ts`
- `src/workers/search.worker.ts`
- `src/workers/planner.worker.ts`
- `src/pages/RngSetupPage.tsx`
- `src/pages/SettingsPage.tsx`
- `src/pages/DebugPage.tsx`
- `src/data/master/*.json`

仕様確認先:

- `AGENTS.md`
- `docs/REQUIREMENTS.md`
- `docs/RNG_SPEC.md`
- `docs/SEARCH_SPEC.md`
- `docs/PLANNER_SPEC.md`
- `docs/DATA_MODEL.md`
- `docs/MASTER_DATA.md`
- `docs/UI_FLOW.md`

この監査で変更するのは本ファイル `docs/RNG_REFERENCE_AUDIT.md` だけである。
