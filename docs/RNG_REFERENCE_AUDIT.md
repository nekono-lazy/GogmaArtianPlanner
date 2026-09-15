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

Project: WiseHorror / Gogma Artian Roll Planner

正式な外部RNG Reference Implementationは次の固定Luaのみとする。READMEは操作・概念の補助説明として参照できるが、algorithm authorityではない。

| 項目 | 固定値 |
|---|---|
| Reference version | `0.9.4` |
| Repository | <https://github.com/WiseHorror/Gogma-Artian-Roll-Planner> |
| Reference commit | `eceb2bd9ca6f4897ec516387acab2ad6beb8b38b` |
| Reference file | `reframework/autorun/GARP.lua` |
| GARP.lua SHA-256 | `dd9ff4ede166542c1efa4bc13595b2d064c581676c289893946af2f9b5551282` |
| Nexus Mods | <https://www.nexusmods.com/monsterhunterwilds/mods/4705> |
| Nexus archive SHA-256 | `24c799cd96af0356b010c97eba4aa190486e2896454cbb5a922ba94dc988e5fa` |

Nexus配布版 `0.9.4` の `reframework/autorun/GARP.lua` と上記GitHub commitの同fileは同一であることを確認済み。

監査commit:

```text
eceb2bd9ca6f4897ec516387acab2ad6beb8b38b
```

commit日時・件名:

```text
2026-08-27T19:59:23+01:00
Fix equip box limit
```

`GARP.lua` の自己申告versionは `0.9.4`。直前履歴には Wilds Ver.1.042.00.02 対応commitがあるが、本監査ではゲームversionとの完全な対応関係を別途検証していない。

### 1.1 参照ファイルと関数

| 参照 | 関数・節 | 監査で使用した意味 |
|---|---|---|
| [README.md](https://github.com/WiseHorror/Gogma-Artian-Roll-Planner/blob/eceb2bd9ca6f4897ec516387acab2ad6beb8b38b/README.md) | How Artian Weapons Work / Usage | 補助説明: 3 streamの独立性、巨戟化でSkill消費、Reset/Keepの意味、通常tier継承 |
| [GARP.lua](https://github.com/WiseHorror/Gogma-Artian-Roll-Planner/blob/eceb2bd9ca6f4897ec516387acab2ad6beb8b38b/reframework/autorun/GARP.lua#L190) | `weapon_type_names`, `artian_set_table_order`, `artian_group_table_order`, `gogma_bonus_ids` | weapon numeric順、21×14 Skill順、Gogma候補順 |
| [GARP.lua](https://github.com/WiseHorror/Gogma-Artian-Roll-Planner/blob/eceb2bd9ca6f4897ec516387acab2ad6beb8b38b/reframework/autorun/GARP.lua#L332) | `u32` | uint32 bit-pattern正規化 |
| [GARP.lua](https://github.com/WiseHorror/Gogma-Artian-Roll-Planner/blob/eceb2bd9ca6f4897ec516387acab2ad6beb8b38b/reframework/autorun/GARP.lua#L527) | `rng_state_from_static_reference`, `read_skill_rng_state` | raw seed、`% 100000000`、live counter/Gate読取 |
| [GARP.lua](https://github.com/WiseHorror/Gogma-Artian-Roll-Planner/blob/eceb2bd9ca6f4897ec516387acab2ad6beb8b38b/reframework/autorun/GARP.lua#L619) | `rng_step`, `initialize_rng`, `initialize_gogma_rng` | PRNG本体、seed初期化、Gogma Gateと10-step block |
| [GARP.lua](https://github.com/WiseHorror/Gogma-Artian-Roll-Planner/blob/eceb2bd9ca6f4897ec516387acab2ad6beb8b38b/reframework/autorun/GARP.lua#L977) | `gogma_repeat_penalty`, `gogma_keep_family`, `build_gogma_pool`, `simulate_gogma_roll` | Gogma候補、weight、重複penalty、Keep family、5-slot抽選 |
| [GARP.lua](https://github.com/WiseHorror/Gogma-Artian-Roll-Planner/blob/eceb2bd9ca6f4897ec516387acab2ad6beb8b38b/reframework/autorun/GARP.lua#L1051) | `skill_type_from_table_index`, `predict_skill_route` | Skill seed、294組、counter/Gate、block先頭値 |
| [GARP.lua](https://github.com/WiseHorror/Gogma-Artian-Roll-Planner/blob/eceb2bd9ca6f4897ec516387acab2ad6beb8b38b/reframework/autorun/GARP.lua#L1193) | `skill_attribute_force_for_recipe`, `configured_base_reinforcement_pool`, `draw_base_reinforcement`, `predict_base_reinforcement` | attribute変換、通常seed/pool/advance/slot抽選 |
| [GARP.lua](https://github.com/WiseHorror/Gogma-Artian-Roll-Planner/blob/eceb2bd9ca6f4897ec516387acab2ad6beb8b38b/reframework/autorun/GARP.lua#L1529) | `packed_reinforcement_tier`, `find_mixed_gogma_route_from` | 通常tierを保持する巨戟と最初のReset強制 |
| [GARP.lua](https://github.com/WiseHorror/Gogma-Artian-Roll-Planner/blob/eceb2bd9ca6f4897ec516387acab2ad6beb8b38b/reframework/autorun/GARP.lua#L1837) | `install_create_count_hooks` | Normal counterのbefore/after |
| [GARP.lua](https://github.com/WiseHorror/Gogma-Artian-Roll-Planner/blob/eceb2bd9ca6f4897ec516387acab2ad6beb8b38b/reframework/autorun/GARP.lua#L1919) | `calculate_from_scratch_plan`, `calculate_existing_weapon_route` | conversion、initial skill、amendment streamの関係 |
| [GARP.lua](https://github.com/WiseHorror/Gogma-Artian-Roll-Planner/blob/eceb2bd9ca6f4897ec516387acab2ad6beb8b38b/reframework/autorun/GARP.lua#L2681) | `capture_target_planning_inputs` | 内部rarity 7、getter counterは次forge block |

固定した `GARP.lua v0.9.4` が、PRNG、seed salt、normal seed、skill seed、Gogma seed、Gate threshold、10-step block、5-slot draw、Gogma候補順、weight、repeat penalty、Keep family、21×14順序、およびlive game state抽出を含む正式なalgorithm authorityである。

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

以下を含む既存reference fixture expected valuesは、固定hashの `GARP.lua v0.9.4` のpure sectionを独立Lua harnessで実行して再検証済みである。fixture値の変更は不要だった。

| 検証項目 | 結果 |
|---|---|
| 検証日 | 2026-09-13 (Asia/Tokyo) |
| Runtime | Lua 5.4 via Wasmoon 1.16.0（一時verification tooling。Project dependencyではない） |
| GARP.lua SHA-256 | `dd9ff4ede166542c1efa4bc13595b2d064c581676c289893946af2f9b5551282` |
| `referenceRngVectors.ts` | 20 / 20 PASS、81 scalar comparisons |
| `referenceGogmaVectors.ts` | 14 / 14 PASS、70 bonus-slot comparisons |
| `referenceNormalVectors.ts` | 23 / 23 PASS、155 slot-level comparisons |
| mismatch | none |

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

したがって、参照modのGARP exportに含まれる `baseSeed` はraw値ではなく8桁範囲へ正規化済みの値である。現行 `RngState.baseSeed` が「REFrameworkが表示したraw qword」なのか「GARP exportの正規化済み値」なのかはUI文言だけでは区別されていない。`RngSetupPage` は現在文字列をそのまま保存し、`UnavailableRngEngine` のため `normalizeSeed()` を呼んでいない。

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

`GARP.lua` の `capture_target_planning_inputs` は対象を表示上のRarity 8として扱い、内部 `rarity = 7` を設定する。`install_create_count_hooks` も `rarity = 7` のNormal counterを取得し、seed式へ同じ内部値を渡す。

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

補記（2026-09-14）: 上記C4-C時点のgame-verified poolはcandidate構成だけを確定しており、
candidate別 `maximumOccurrences` はreference値（Element 5 / Affinity 5）を流用していた。
14.13の再検証（属性ありMelee 1293個体）でAttack 5 / Element 4 / Sharpness 2 / Affinity 3を
直接game-verifiedし、Capacity 2およびBow / Bowgun / none poolへの適用はGame8上限情報と既存
fixtureとの無矛盾を根拠に、Production poolだけをAttack 5 / Element 4 / family 7 2 /
Affinity 3へ修正した。本節のreference pool表（Element 5 / Affinity 5）はpinned reference
implementationの挙動であり、変更しない。

補記（2026-09-14、Melee support拡張）: 上記C4-C時点のgame-verified matrixのうちLong Swordの
2条件は、14.14でSwitch Axeを除く近接10武器種の共通Melee pool（属性あり `[6, 4, 7, 8]` /
none `[6, 7, 8]`）へ昇格した。directly game-verifiedな武器・条件と、category-level Production
adoptionにとどまる武器・条件の区別は14.14に従う。Switch Axeは14.14の時点では引き続きunsupportedであり
（その後14.16で独立したsingle poolとしてsupportedへ昇格）、
「その他の近接武器」を一律に未検証とする本節の記述は14.14以前の状態を表す。

補記（2026-09-15、Bow Table A / B修正）: 本節の「属性ありBowは属性種類では分岐しない」は
C4-C時点でFire Bowだけを実測した結果に基づく記述であり、14.15の実機検証で誤りと確定した。
Bowでは火 / 水 / 雷 / 氷 / 龍 / 爆破がTable A `[6, 4, 8]`、無属性 / 毒 / 麻痺 / 睡眠がTable B
`[6, 8]` を使う。上表のBow「Attribute present」列は現在のTable A、「None」列はTable Bに対応し、
毒 / 麻痺 / 睡眠は「None」側である。Production pool選択は `NormalArtianLotteryTableClass` を
正式概念とし、Melee / Bowgunの分類（none / 属性あり）とNormal seed / Counterは変更していない。

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

固定reference repository単独では、Gogma poolはweapon/elementで候補を除外しない。noneでもElement、BowでもSharpness/Ammo、LBG/HBGでもElementが候補に残る。Current `WeaponBonusDefinition` はこれらを無効とするため、reference repositoryだけではどちらを採用すべきか未確定だった。後続の実ゲームfixtureとProduction game-adjusted predictorでの扱いは10.4に記録する。

### 10.4 Game-verified Reset availability filtering / Keep parity

Gogma Resetの固定reference candidate順は `[8, 12, 15, 9, 13, 16, 11, 14, 6, 10]`
のまま維持する。実ゲームfixtureでは、`WeaponBonusDefinition` のweapon type / element /
`gogma_artian` scope availabilityで使用不能なcandidateを**weighted draw前**にfilterすると、
同じseed、raw値、repeat penalty、slot順で一致した。これはretry、candidate replacement、ID置換、
候補並べ替えではない。

| Observed condition | Counter | Filtered IDs | Game result IDs |
|---|---:|---|---|
| Bow / Fire | 55 | `6, 10` | `[8, 9, 16, 11, 14]` |
| Bow / none | 55 | `11, 14, 6, 10` | `[12, 13, 9, 13, 15]` |
| LBG / Fire | 56 | `11, 14` | `[13, 12, 6, 9, 8]` |
| HBG / Fire | 56 | `11, 14` | `[13, 10, 8, 8, 15]` |
| Long Sword / none | 55 | `11, 14` | `[10, 15, 9, 13, 6]` |

この5条件はgame-verified fixtureである。一方、同じMaster availability filterを未観測の
weapon/elementへ適用することはDomain availabilityに基づくgame-adjusted generalizationであり、
全weapon・全attribute・全game versionのgame verificationを意味しない。C3のPRNG、seed、100 mix、
10-step block、Counter Gate、weighted draw、exact-ID repeat penalty、slot順は変更不要だった。

Bow / FireでCounter 55 Reset後の `[8, 9, 16, 11, 14]` をcurrent ordered slotsとしてCounter 56で
Keepした実ゲーム結果は `[8, 13, 16, 11, 11]` であり、C3 `predictReferenceGogmaKeep` が5slot完全一致した。
Keepはslot family固定・family内tier再抽選のままとし、未確認の使用不能family current inputへの
filter/retry/replacementは追加しない。

訂正（2026-09-15、14.17）: 上記5条件は、Master availability filterでも、同じweapon / elementの
Production Normal pool family集合によるfilterでも同じ結果になる。その後のBow / 毒とSwitch Axe /
`element.none` の直接実測により、Master availability（`WeaponBonusDefinition` +
`ElementMaster.allowsElementBonus`）を未観測のweapon / elementへ一般化する契約は誤りと確認された。
Production Gogma Reset family availabilityのauthorityはProduction Normal pool family集合へ置き換え、
さらに `sharpness_capacity` family上限2を加える（[RNG_SPEC.md](./RNG_SPEC.md) 6.1.1）。pre-draw filter
mechanism（候補順維持、retry / 置換なし）とKeep parityは変わらない。`production-rng:c5-e6` までのruntimeは
本節のMaster availability filterであり、PR-B（現在の `production-rng:c5-e7`）でProduction Normal pool family集合と
`sharpness_capacity` family上限2へ置き換えた（14.17）。

参照Reset/Keep poolにAttack/Affinity/Elementのrank Iは存在しない。参照上、巨戟化直後は通常tierをそのまま持ち、rank Iへ変換しない。

訂正（normal-scope Keep仕様訂正）: かつてプロジェクトオーナーの実機確認として
「`gogma_artian` scopeの所持巨戟アーティアがAttack/Affinity/Elementのrank Iを保持し得る」と
追記していたが、再確認の結果、そのrank I表示は通常アーティアから巨戟化した直後でまだ
Bonus amendmentを行っていないnormal-scope状態をGogma Bonusと誤認したものだった。
Reset / Keep結果として基礎攻撃力強化I / 会心率強化I / 属性強化Iが出現した実機確認はない。
したがってCurrent Gogma Masterから `gogma_artian` scopeのrank I定義を除外し、
「gogma scope rank Iが実機で確認済み」という前提を撤回する。Keep family解決はrankを
一切参照せず、`bonusTypeId`（通常側はArtianBonusTypeMappingで巨戟側へ正規化）だけで決める。
normal-scope表示上の「I」と現行Master `bonus_rank.base` の対応はRepositoryからは確定できない
ため、`base` を機械的に `i` へ置換せず、未確認のNormal rank tableも追加しない。

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

`enumerateKeepSelections()` に相当する分岐は参照実装にない。現在bonusの各slot familyから候補poolが一意に定まる。

GogmaArtianPlannerでのfamily解決はscope非依存である。各current slotの `bonusTypeId` が巨戟側Bonus Typeならそのfamilyを直接使い、通常側Bonus Type（`bonus_type.normal_sharpness` / `bonus_type.normal_capacity` 等）は `ArtianBonusTypeMapping` で巨戟側Bonus Typeへ正規化してからfamilyを引く。`bonusRankId` はfamily判定に使わない。参照実装がbase-tier状態でKeep開始を許可しないのは、参照実装がnormal-scope current bonusesをPrediction入力として扱わないという実装上の制約であり、ゲームルールではない（12 F参照）。normal-scope current bonusesからのKeep結果はgame-verified fixtureをまだ持たない（20参照）。現行Searchのfrontier自体は連続Keep結果を追う用途には使えるが、各depthでselectionを列挙して枝分かれする必要はない。

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
| F. 最初のReset Bonuses時の入力bonus | 継承したnormal/base-tierのpacked 5枠。Reset抽選自体は以前の値を無視する。参照実装はbase-tier状態で最初のamendmentをResetに強制しKeep開始を許可しないが、これは参照実装がbase-tier packed値をKeep family入力へ変換しないことによる実装上の制約であり、ゲーム上Resetしか選べないという意味ではない。GogmaArtianPlannerはArtianBonusTypeMappingで通常側Bonus Typeを巨戟familyへ正規化し、5枠既知ならKeepを予測する。 |

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
- `ProductionRngEngine` facadeが存在し、Candidate Search Worker entryはWorker内部factoryからこれを生成する。`UnavailableRngEngine` は全capability falseのfallback/test用として残る。
- Planner domainはoperation capabilityに加えて具体的semantic inputを
  `getPredictionSupport()` で確認し、既知unsupportedをBuildListEntry単位で除外する。
  Trace Replayはordered current bonusesを追跡してPrediction直前にsupportを再確認し、
  support query例外とsupport=true後のPrediction例外をfatal error経路へ伝播する。
- Planner Workerはproduction entry/factory/clientを持ち、Worker内部で`ProductionRngEngine`、ID Factory、Clockを生成してPlanner controllerへ注入する。Search/Planner Production Workerはactive、Seed Searchはinactiveである。
- Settingsは「RNG予測エンジン: 未設定」。Debug画面はEngine情報を含め全項目placeholder。
- RNG Setupは4 KnownValueを独立保存するが、capability表示は引き続き`UnavailableRngEngine`を使用し、manual Base Seedをまだ`normalizeSeed()`へ通さない。
- Lottery Masterは1件だけ、weight 0 / disabled / unverified placeholder。Candidate Searchにenabled Lottery gateはなく、Production RNGもLotteryMasterへ依存しない。

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

### 14.3 C5-E1完了後のcurrent state（2026-09-01）

14.1と14.2はC5-A監査時点の記録として保持する。C5-E1完了後の実装状態は次のとおり。

- `ProductionRngEngine` / `PRODUCTION_RNG_ENGINE_VERSION`からmode、version、capabilitiesを取得するnon-persistent runtime descriptorを追加した。version literalやUI専用Fake Engineは持たない。
- SettingsはProduction Engine active、Engine version、`supportsSeedSearch = false`に基づくSeed Search未対応を表示する。Production RNG全体を未設定・未対応とは表示しない。
- DebugはProduction mode/versionとNormal、Skill、Gogma、Keep、Seed Searchのoperation-level capabilityを表示する。具体的semantic input coverageとは混同しない。
- RNG Setupは`UnavailableRngEngine`ではなくmain-thread Production authorityをcapability導出と表示に使用する。大量Candidate SearchとPlannerは引き続きWorkerで実行する。
- manual Base Seedは保存直前に`ProductionRngEngine.normalizeSeed()`を通り、10進/16進rawをcanonical 10進文字列へ正規化する。不正入力は既存error経路で保存を拒否し、sourceは`manual`とする。
- RNG Setupの4 KnownValueは独立更新を維持する。変更していない項目と空欄項目は既存値を保持し、Counter validation semanticsは変更しない。
- `UnavailableRngEngine`自体はfallback/test/明示的unavailable用途のため残るが、本番RNG Setup/capability表示のauthorityからは外れた。
- Search Production WorkerとPlanner Production Workerはactive、Seed Searchはinactiveのままである。`supportsSeedSearch`はfalseのままで、Seed Search algorithm/Worker/UIはC5-E2へ残す。
- Production RNGとUIの有効判定はlegacy `LotteryMaster`へ依存しない。LotteryMaster cleanupと最終dependency auditはC5-E3へ残す。
- persistent schema、`CalculationContext` contract、`PRODUCTION_RNG_ENGINE_VERSION`は変更していない。

### 14.4 C5-E2B1 Skill Identification foundation（2026-09-01）

- Skill Identificationは汎用Seed Searchではなく、Normal→Gogma conversion時の初回Skillと、それに続くReset Skillsの完全なSeries/Group観測列を使う専用kernelとして実装する。
- Base Seedはcanonical `0..99,999,999` inclusive、Skill Counterはcaller-supplied bounded inclusive rangeを探索する。順序はBase Seed昇順、Skill Counter昇順である。
- Counter Gate exact値はIdentification入力にしない。Skill active branchを選択するためだけに内部代表値54を使用し、RngStateへactual Gateとして保存しない。
- compiled matcherのcorrectness authorityは`ProductionRngEngine.predictSkills()`である。ProductionのPRNG、Skill seed derivation、294通りのsemantic Skill mappingを再利用し、独立したRNG仕様を持たない。
- reference-generated bounded fixture `Seed 8,500,000..8,550,000`、`Skill Counter 180..190`、Insect Glaive/Thunder、4観測は`{ baseSeed: 8524433, startSkillCounter: 186 }`のみを返す。これはreference-verified provenanceであり、独立したgame-verified fixtureではない。
- Worker foundationはstructured-clone可能なinputだけを受け、Worker内で`ProductionRngEngine`を生成する。requestId単位のprogress/cancelとlate response無視を持ち、active requestIdの再利用を拒否し、terminal時にrequest-scoped cancel tokenを破棄する。Production UIからは未接続である。
- C5-E2B1では`supportsSeedSearch = false`、Production RNG version、RngState schema、Settings/RNG Setup、Search/Plannerを変更しない。

### 14.5 C5-E2B2 Gogma Counter Identification foundation（2026-09-01）

- STEP 1で確定したBase Seedを入力とし、Reset-onlyの連続ordered five-slot観測からbounded Gogma Counterだけを昇順探索する専用kernelを追加した。Seed再探索とKeep observationは行わない。
- Counter Gate exact値を入力・探索・保存せず、active branchの内部代表値35を使う。固定live inputではGate 35/36/54/200が同一Predictionになる。
- caller-supplied Master subsetは`weaponTypes`、`elements`、`bonusTypes`、`weaponBonusDefinitions`である。Worker内Master loadとLotteryMaster dependencyはない。
- correctness authorityは`ProductionRngEngine.predictGogmaBonus(reset)`である。compiled kernelはProduction PRNG/seed derivation、availability filtering、candidate order、weighted draw、repeat penaltyを共有する。
- 2026-09-13（Asia/Tokyo）にGogmaArtianPlanner userが独立採取したgame-verified vectorを記録した。GARP live RNG state readで確認したBase Seed 51231782、starting Gogma Counter 55、actual Counter Gate 200と、Hammer/Paralysisでの6連続Reset Bonuses draw（Counter 55..60、30 ordered slots）を使用する。Production Gate 35/200の双方で全slotが一致し、50..65探索は1観測から55だけ、0..100,000探索は1観測で55/31237/51953/84602/91845、2観測以降は55だけを返す。Reset drawを実行した時点でCounterが進み、その後に抽選結果を武器へ反映するか破棄するかはCounter進行へ影響しないことも実機確認した。save / autosave / reload semanticsはこの実測から推測しない。Identification kernelはGogmaArtianPlanner-owned implementationであり、GARP.luaで確認されたProduction RNG primitives / semantic mappingsを使用する。
- WorkerはB1のactive requestId拒否、request-scoped cancel token、terminal cleanup、late response ignore、`production-engine-unavailable` contractを維持する。UIには未接続である。
- C5-E2B2でも`supportsSeedSearch = false`、`production-rng:c5-b`、RngState schema、UI、Search/Plannerを変更しない。

### 14.6 C5-E2C2 Active Counter Gate Production contract（2026-09-01）

14.4 / 14.5のIdentification kernel方針とC5-E2C1 Production Integration Contract Auditを受け、Production v1のcurrent approved contractを次のとおり確定した。本節は6.1 / 10.1に記録したexternal reference / CoreのGate semanticsを改変せず、GogmaArtianPlanner Product runtime policyを別に定義する。

- Production v1は通常アーティアおよび巨戟アーティアを利用可能なゲーム進行状態を対象とし、Skill / Gogma Predictionでactive Counter branchを使用する
- Skill operationは54、Gogma operationは35をactive branch選択用の内部representativeとして使用する。54 / 35はactual game Counter Gate値ではない
- Core / reference semanticsの低Gate branchとthreshold testは保持する。変更対象はProduction v1 adapterが選択するbranchである
- `RngState.counterGate` はlegacy/manual/import compatibility、将来のround-trip、diagnostic / reference情報としてschemaに保持するが、Production Prediction、Candidate Search、Planner、Trace Replayのavailabilityまたは結果のauthorityにしない
- Identification WizardはGateを入力、探索、Observation、result、adoptionへ含めず、54 / 35をpersistしない
- Production CapabilityはSkillでBase Seed / Skill Counter、GogmaでBase Seed / Gogma Counterと、該当Prediction / concrete semantic input supportを要求する。confirmed Gateは要求しない
- Normal Counterは新規Normal Artian生成だけに必要であり、Gogma-only route、existing Gogma route、Skill Prediction、適合するowned Normalからのconversionには要求しない
- `searchStateHash`、route-dependent RNG hash、`ExpectedPlanState.rngStateHash`からlegacy Gateを除外し、Gateだけの変更によるfalse staleを防ぐ
- `supportsSeedSearch`は旧generic Seed Search capabilityであり、Identification availabilityに流用せず `false`を維持する。新しいRngEngine capability flagはC5-E2C2で追加しない
- Identification adoptionはcanonical Base Seed、starting Skill Counter、starting Gogma Counterを採用し、sourceには既存の `observation` を使用する。Counter GateとNormal Counterは変更しない
- 調査中はゲーム状態を保存せず、調査前状態へ戻してから採用する。観測操作数をstarting Counterへ加算しない
- 実Browser Worker benchmarkはC5-E2C8で完了した（[C5_E2C8_BROWSER_WORKER_BENCHMARK.md](./C5_E2C8_BROWSER_WORKER_BENCHMARK.md)）。Skill live-game verificationはC5-E2C9で完了した（[C5_E2C9_SKILL_LIVE_GAME_VERIFICATION.md](./C5_E2C9_SKILL_LIVE_GAME_VERIFICATION.md)）。Node benchmarkはBrowser benchmarkの代用ではない。C9完了自体はactivationではなく、C5-E2C10 Production activationは別途完了した（[C5_E2C10_PRODUCTION_IDENTIFICATION_ACTIVATION.md](./C5_E2C10_PRODUCTION_IDENTIFICATION_ACTIVATION.md)）
- Skill Production UXはcontiguous / non-overlapping Seed chunk、deterministic merge、global progress、cancel propagation、Worker failureの明示errorを持つmulti-worker orchestrationを維持する

C5-E2C2完了時点では仕様先行でruntime implementationはC5-E2C3 pendingだった。次節のC5-E2C3でその差を解消した。

### 14.7 C5-E2C3 Active Counter Gate runtime integration（2026-09-01）

- Production Domain Prediction inputからcaller-supplied `counterGate`を除外し、Production adapterがCore/reference predictorへSkill 54、Gogma 35を内部供給する。Coreの低Gate branchとthreshold fixtureは変更しない
- Capability、Candidate Search、Planner validation、Trace Replayからconfirmed Gate requirementを除外し、Base Seedとoperation別CounterおよびEngine/concrete semantic supportだけを要求する
- `searchStateHash`と`ExpectedPlanState.rngStateHash`からlegacy Gateのvalue / isConfirmed / sourceを除外し、Gate-only変更によるfalse staleを防ぐ
- `RngState.counterGate`、validation、manual/import互換性は保持し、schema migrationは行わない
- `PRODUCTION_RNG_ENGINE_VERSION`を `production-rng:c5-e2`へbumpし、旧CalculationContextを `calculation_context_changed`としてstaleにする
- Normal Counter unknownでもexisting Gogma、Gogma-only、適合するowned Normal conversionをroute-localに利用できる。新規Normal forgeだけをunavailableにする
- `supportsSeedSearch = false`を維持する。Skill / Gogma Identification kernelとWorker foundationは存在するが、Identification Production UIはinactiveのままである

### 14.8 C5-E2C4 Identification Result Adoption Service（2026-09-01）

- review済みexact `baseSeed` / `startingSkillCounter` / `startingGogmaCounter`だけを受けるapplication serviceを追加した。raw Worker resultのunique / truncation判定は後続Coordinatorへ残す
- Base SeedをProduction normalizerで再validation / canonicalizeし、3つの採用値をconfirmed・source `observation`として保存する。観測数によるCounter加算は行わない
- current RngStateを既存ensure契約で取得し、Counter Gate、notes、createdAt、その他fieldを保持した1つのvalidated stateを1回だけputする。成功時は保存済みRngStateを返す
- Normal Counter、Candidate、Build List、Planのrepositoryには依存せず、直接mutationしない。Counter Gate unknown / 54 / 200のいずれもadoptionをblockしない
- invalid input / invalid persisted stateはwrite前に拒否し、repository failureはswallowしない。既存repositoryにCASはないためread-modify-put raceは残存riskである
- Production versionは `production-rng:c5-e2`、`supportsSeedSearch = false`を維持する。Wizard UI、STEP 1/2 Coordinator、multi-worker orchestrationは未実装である

### 14.9 C5-E2C5 Identification Wizard Coordinator（2026-09-01）

- React非依存・非永続のapplication Coordinatorを追加し、専用Skill / Gogma Counter Worker ClientとC5-E2C4 Adoption Serviceをcomposeした。repository direct mutation、RngEngine Identification API、Wizard draft persistenceは追加していない
- 両STEPとも1件かつnon-truncatedだけをuniqueとし、truncated、0件、複数、Worker errorを区別する。候補手動選択、自動range拡張、Seed再探索は行わず、STEP 2 SeedはSTEP 1 unique結果からのみ注入する
- reviewはcanonical Base Seed、starting Skill Counter、starting Gogma Counterだけから生成し、観測数を加算しない。再検索は下流review / confirmationをinvalidateし、step / generation / sequence request IDとgeneration guardでlate responseを無視する
- adoptionは調査前ゲーム状態へ戻した明示確認後にC5-E2C4だけを呼ぶ。重複adoptionをguardし、失敗時はreviewと確認を保持してretry可能とする。Coordinatorは両Worker Clientを所有し、cancel / restart / disposeを提供する
- CoordinatorとWizard UIはimplementedである。Skill multi-workerと実Browser Worker benchmarkはC5-E2C8まで、Skill live-game verificationはC5-E2C9まで完了し、C5-E2C10 Production activationは完了した（[C5_E2C10_PRODUCTION_IDENTIFICATION_ACTIVATION.md](./C5_E2C10_PRODUCTION_IDENTIFICATION_ACTIVATION.md)）。測定記録は[C5_E2C8_BROWSER_WORKER_BENCHMARK.md](./C5_E2C8_BROWSER_WORKER_BENCHMARK.md)、live verification記録は[C5_E2C9_SKILL_LIVE_GAME_VERIFICATION.md](./C5_E2C9_SKILL_LIVE_GAME_VERIFICATION.md)をauthorityとする。Production versionは `production-rng:c5-e2`、`supportsSeedSearch = false`を維持する

### 14.10 C5-E2C6 Skill Identification Multi-Worker Orchestration（2026-09-01）

- 既存 `SkillIdentificationWorkerClient` interfaceを維持したProduction multi-worker clientを追加し、Coordinator Production factoryのSkill Clientだけを差し替えた。Gogma Counter Client、Coordinator state machine、Skill kernel、Production RNG coreは変更していない
- logical coreが4以上なら4 Worker、2から3なら2 Worker、それ以外または取得不能なら1 Workerとし、最大4に制限する。Seed数が少ない場合は空chunkを生成せず、inclusive Seed rangeをcontiguous / non-overlapping / gap-freeに完全被覆する
- 各childは同じSkill Counter rangeを受け、Seed rangeだけが異なる。child request IDはparent、logical token、chunk indexで分離し、同一active parent IDのduplicate reject、terminal後reuse、複数parent同時実行を維持する
- parent `maxMatches`はchildへ渡さない。全chunkのnon-truncated完了を確認し、Seed / Counter順にdeterministic mergeしてからglobal limitを適用する。これにより `matches.length === 1 && !isTruncated` のunique契約をlocal truncationで偽造しない。欠落・overlap・truncated childは `incomplete_parallel_chunk` で全体failureになる
- 各childのlatest progressを保持してglobal `searchedSeeds / totalSeeds / matchesFound`を集約し、out-of-order eventでもsearched値を巻き戻さない。cancelは全childへ伝播し、1 child failure / unavailableは全siblingをcancelしてpartial successを禁止する。late responseはlogical request identityで無視する
- child factory creation failureとEngine version mismatchはfail closedとし、生成済みchildをdisposeする。Production Engine versionは `production-rng:c5-e2`、`supportsSeedSearch = false`を維持する。C5-E2C6時点ではWizard UIはinactiveであり、後続C5-E2C7でRNG Setupへ接続した。development StrictMode環境で報告されていたCoordinator lifecycle起因のWizard表示不具合は、C5-E2C7 lifecycle hotfixで解消済みである
- Skill multi-worker orchestrationと実Browser Worker benchmarkはC5-E2C8まで完了している（測定記録は[C5_E2C8_BROWSER_WORKER_BENCHMARK.md](./C5_E2C8_BROWSER_WORKER_BENCHMARK.md)）。独立したSkill live-game verificationはC5-E2C9で完了した（[C5_E2C9_SKILL_LIVE_GAME_VERIFICATION.md](./C5_E2C9_SKILL_LIVE_GAME_VERIFICATION.md)）。C5-E2C10 Identification Production activationは完了した（[C5_E2C10_PRODUCTION_IDENTIFICATION_ACTIVATION.md](./C5_E2C10_PRODUCTION_IDENTIFICATION_ACTIVATION.md)）

### 14.11 C5-E2C7 Identification Wizard UI（2026-09-01）

- RNG Setupから専用Identification Wizardを開始できるDialog UIを追加し、既存Coordinatorのstate / subscribe、STEP 1/2 identify / cancel、restart、復元確認、adoptへ接続した。UIはCoordinatorのclassification、review、invalidation、adoption guardを再実装せず、presentation用form draftだけを保持する
- STEP 1は武器種、属性、ordered Series / Group観測、明示Seed range、概算Skill Counter ±幅を入力し、STEP 2はSTEP 1 Seedを再入力させずordered five-slot Reset観測と概算Gogma Counter ±幅だけを入力する。Counter Gate、Keep観測、Normal Counter Identification、candidate pickerを追加していない
- ReviewはBase Seed、starting Skill Counter、starting Gogma Counterだけを表示し、調査前ゲーム状態への復元確認後にCoordinator経由でadoptする。DialogはCoordinatorのsubscriptionとpresentation lifecycleだけを所有し、unmount時にunsubscribeする。per-open Coordinatorのlifetimeは生成元であるRNG Setup側が所有し、実際のClose時とowner unmount時にdisposeする。この所有分離により、development StrictModeのeffect replayが利用中のCoordinatorをpremature disposeしない
- 実Browser Worker benchmarkはC5-E2C8で完了した（測定記録は[C5_E2C8_BROWSER_WORKER_BENCHMARK.md](./C5_E2C8_BROWSER_WORKER_BENCHMARK.md)）。独立したSkill live-game verificationはC5-E2C9で完了した（[C5_E2C9_SKILL_LIVE_GAME_VERIFICATION.md](./C5_E2C9_SKILL_LIVE_GAME_VERIFICATION.md)）。C5-E2C10 Production Identification activationは完了した（[C5_E2C10_PRODUCTION_IDENTIFICATION_ACTIVATION.md](./C5_E2C10_PRODUCTION_IDENTIFICATION_ACTIVATION.md)）。Production Engine versionは `production-rng:c5-e2`、`supportsSeedSearch = false`を維持する

### 14.12 Normal Artian Counter Identification foundation（2026-09-14）

- 既知canonical Base Seed、武器種、連続forgeした通常アーティアの5枠観測、bounded inclusive Counter rangeから、武器種別レア8の開始Normal Counterを昇順探索する専用kernel / Worker / Worker Clientを追加した（[RNG_SPEC.md](./RNG_SPEC.md) 9.12）。9.3のgeneric `searchKind = "normal_artian_counter"` 案はsupersededである
- correctness authorityは `ProductionRngEngine.predictNormalArtian()` である。kernelはProductionのNormal seed derivation（Base Seed + weapon type + internal rarity 7）、100 mix、10-step block positioning、game-verified candidate pool、pool step（`selectReferenceNormalLotteryIdsFromRawValues()`）を共有し、`predictNormalArtian` を呼ばずにPRNG stateをblock単位で前進させる。Production Normal RNG output、Normal seed derivation、block size、Weapon Type numeric mapping、rarity mappingは変更していない
- 属性はNormal seedへ影響せずcandidate pool選択だけを変えるため（5.3）、Counter Searchの入力domainは `none` / `attribute_present` の2 classだけである。Production adapter内部では `element.none` / `element.fire` をpool選択のrepresentativeとして使うが、`element.fire` は実属性を意味せず永続化・表示しない
- 5.3のHBG監査（Base Seed 51231782 / Counter 4, 5, 6 / 15slot / 開始Counter 0..5000で `k = 4` の1件）を `src/test/fixtures/gameVerifiedNormalVectors.ts` の既存fixtureからkernel golden testとして固定した。1観測では0..5000に19候補（先頭 4 / 189 / 227）、2観測以降は4だけであり、0..100,000では2観測で 4 / 23662 / 36383 / 59681 / 64966 / 65023、3観測で4だけである
- **Production pool coverageは既存実測範囲を維持する。** 5.3のgame-verified matrix（Bow / Light Bowgun / Heavy Bowgun / Long Sword）はC4-C時点の監査結果としてそのまま保持し、本foundationは他の10武器種をProduction supportedへ昇格しない。未検証武器種のCounter Searchは `unsupported_input` / `normal_pool_unverified` でfail closedし、reference poolへfallbackしない
- 今後の実機検証仮説はBow / Bowgun / Meleeの3カテゴリ（Melee 属性あり `[6, 4, 7, 8]`、Melee none `[6, 7, 8]`、Bowgun `[6, 7, 8]`、Bow 属性あり `[6, 4, 8]`、Bow none `[6, 8]`）である。Long Swordの実測はMelee仮説と一致するが、Long Swordだけを根拠に他10近接武器を昇格しない。大剣・双剣等の連続観測fixtureが得られた後、`predictReferenceNormalRaw()` によるreference melee pool仮説の一致Counter調査を経て、別PRでカテゴリ化とProduction support拡張を判断する
- `supportsSeedSearch = false`、`production-rng:c5-e2`、`NormalArtianCounter` persisted shape、`DATABASE_SCHEMA_VERSION`、`CURRENT_CALCULATION_APP_SCHEMA_VERSION`、Master dataVersionは変更していない。NormalCountersPageへのUI接続とCounter確定処理は後続PRである

---

### 14.13 通常アーティア復元ボーナス抽選上限の実ゲーム再検証（2026-09-14）

監査日: 2026-09-14 (Asia/Tokyo)

- 過去に `MHWilds-ArtianBonus-OCRTool` で取得した実ゲームデータ（Base Seed 51231782、レア8通常アーティア、5枠はゲーム画面上のslot順、武器種ごとに連続したNormal Counter系列）を再検証した。今回確認した4武器はすべて属性ありである

| Weapon | 個体数 | slots |
|---|---:|---:|
| Dual Blades | 348 | 1740 |
| Great Sword | 348 | 1740 |
| Hammer | 66 | 330 |
| Charge Blade | 531 | 2655 |
| 合計 | 1293 | 6465 |

- 実ゲームの最大出現数を **Attack 5 / Element 4 / Sharpness（family 7）2 / Affinity 3** として属性ありMelee pool `[6, 4, 7, 8]` を適用すると、保存画像を正として **1293 / 1293個体、6465 / 6465 slots** がRNG予測と一致した。PRNG、seed derivation、100 mix、10-step block、raw値のskip/retryは一切変更していない
- 元OCR CSVには10件の誤認識 / slot取り込み誤りがあった。保存されていた元画像をユーザーが手動確認し、10件すべてRNG予測側が正しいことを確認済みである。したがってこの10件はRNG反例ではない。双剣は348 / 348がOCR結果のまま完全一致している
- この1293個体で直接game-verifiedした上限はAttack 5 / Element 4 / Sharpness 2 / Affinity 3であり、対象はいずれも属性ありMelee（Great Sword / Dual Blades / Hammer / Charge Blade）である
- ユーザー提示のGame8記事（<https://game8.jp/mhwilds/673616>）も通常アーティアの上限を基礎攻撃力 5 / 属性 4 / 会心率 3 / 斬れ味 2 / 装填数 2と記載している。属性ありMeleeの上限についてはProduction correctnessの根拠はGame8ではなく本節の実ゲーム画像確認である
- 次は今回の1293個体による直接境界観測ではない。ユーザー提示のGame8上限情報と、既存game-observed fixture（Bow 属性あり / none、LBG Fire / none、HBG Fire / none、Long Sword Fire / none、各15 slots）が新上限と矛盾しないことを根拠にProduction contractとして採用している
  - Capacity 2（LBG / HBG）
  - BowへのElement 4 / Affinity 3上限の適用
  - LBG / HBGへのAffinity 3上限の適用
  - none poolへのAffinity 3上限の適用
- **corrected Production limits**: Production pool（`src/domain/rng/production/gameNormalBonuses.ts`）の `maximumOccurrences` を、これまでreference値を流用していたElement 5 / Affinity 5から **Attack 5 / Element 4 / family 7 2 / Affinity 3** へ修正した。`ReferenceNormalCandidate.maximumOccurrences` の型は `2 | 3 | 4 | 5` へ拡張した。修正前のProductionは一部Counterで実ゲームと異なる予測（3回目以降のAffinity、4回目以降のElementが除外されない）を生成していた
- reference parity層（`REFERENCE_NORMAL_NONE_CANDIDATES` / `REFERENCE_NORMAL_ELEMENTAL_CANDIDATES`、`predictReferenceNormalRaw()`、`referenceNormalCandidatesForElement()`、reference golden）はpinned GARP.lua v0.9.4とのparity契約であり、Element 5 / Affinity 5のまま変更していない。Element 5 / Affinity 5は実ゲーム仕様ではなくpinned reference implementationの挙動である
- 既存game-observed fixture（Bow 属性あり / none、LBG Fire / none、HBG Fire / none、Long Sword Fire / none）はすべて修正後のProduction poolで引き続き一致する。PR #32のHBG Counter golden（Base Seed 51231782、Counter 4 / 5 / 6、開始Counter 0..5000で `startNormalCounter = 4` の唯一一致）も維持されている
- Normal Artian Counter Identificationのobservation validationは修正後の `maximumOccurrences` を使い、Element 5枠、Affinity 4枠、family 7 3枠の観測を「検索0件」ではなく `invalid_input` として拒否する。「入力自体がProduction poolから生成不能」と「範囲内に一致なし」の区別は維持した
- Production Normal prediction結果が変わるobservable RNG semantics changeとして `PRODUCTION_RNG_ENGINE_VERSION` を `production-rng:c5-e2` から `production-rng:c5-e3` へ更新した。旧version下で生成されたBuildCandidate / BuildListEntry / ProductionPlanは `rngEngineVersion` の差で `calculation_context_changed` となる。`CURRENT_CALCULATION_APP_SCHEMA_VERSION`、`DATABASE_SCHEMA_VERSION`、`AppSettings.schemaVersion`、Master dataVersionは変更していない
- 今回の証拠は属性ありMelee（Great Sword、Dual Blades、Hammer、Charge Blade）についてMelee pool仮説 `[6, 4, 7, 8]` を非常に強く支持するが、本PRではProduction supportを拡張しない。`gameVerifiedNormalCandidatesForWeaponAndElement()` のsupport対象はBow / Light Bowgun / Heavy Bowgun / Long Swordのままである。Meleeカテゴリ化と全近接へのsupport拡張は別PRの責務である
- Game8から武器種ごとのTable A / B条件に関する情報も得ているが、table-selection modelの正式化、PR #32の `NormalArtianAttributeClass = 'none' | 'attribute_present'` の再設計、Bowの属性分類変更は本PRの対象外であり別途検証・設計する。`NormalArtianCounter` persisted model、ID、Counter semantics（武器種 + rarityごとに1本、Table A / Bのどちらを作成しても1進む）は変更していない

---

### 14.14 通常アーティアPredictionの近接武器Melee support拡張（2026-09-14）

監査日: 2026-09-14 (Asia/Tokyo)

- 通常アーティアPrediction / Counter IdentificationのProduction support対象武器種を、Long Sword単独のMelee supportから、Switch Axeを除く近接10武器種（Great Sword / Sword and Shield / Dual Blades / Long Sword / Hammer / Hunting Horn / Lance / Gunlance / Charge Blade / Insect Glaive）の共通Meleeカテゴリへ拡張した。Bow / Light Bowgun / Heavy Bowgunの既存supportは変更していない。今回の拡張後にProduction Normal unsupportedな武器種はSwitch Axeだけである
- Melee共通poolは14.13で確定したProduction candidate上限をそのまま使う。属性あり `[6, 4, 7, 8]`（Attack 5 / Element 4 / Sharpness 2 / Affinity 3）、none `[6, 7, 8]`（Attack 5 / Sharpness 2 / Affinity 3）であり、既存Long Sword poolと完全に同一である。`gameNormalBonuses.ts` ではLong Sword専用定数を `GAME_VERIFIED_MELEE_ELEMENTAL_NORMAL_CANDIDATES` / `GAME_VERIFIED_MELEE_NONE_NORMAL_CANDIDATES` へ整理し、Melee membershipは `PRODUCTION_MELEE_NORMAL_POOL_WEAPON_TYPE_IDS` の明示allow-listだけで決める。unknown WeaponTypeIdを暗黙にMelee扱いせず、allow-list外はfail closedする

**verification provenance（直接検証とcategory-level adoptionの区別）**

10武器すべてを個別に直接game-verifiedしたわけではない。

| 区分 | 武器 / 条件 | 根拠 |
|---|---|---|
| directly game-verified | Long Sword 属性あり / none | 既存fixture（Base Seed 51231782、Counter 0..2、各15 slots、5.3） |
| directly game-verified | Great Sword / Dual Blades / Hammer / Charge Blade 属性あり | 14.13の再検証。Base Seed 51231782、1293個体 / 6465 slotsを保存画像authorityで確認し、Melee属性ありpool `[6, 4, 7, 8]` / Attack 5 / Element 4 / Sharpness 2 / Affinity 3と完全一致 |
| category-level Production adoption | Sword and Shield / Hunting Horn / Lance / Gunlance / Insect Glaive 属性あり / none | 直接大量検証なし |
| category-level Production adoption | Great Sword / Dual Blades / Hammer / Charge Blade none | 14.13の1293個体には含まれていない |

category-level adoptionの根拠は次のcategory-level evidenceである。

- Long Sword + Great Sword + Dual Blades + Hammer + Charge Bladeという5種類の異なるMelee weapon streamで共通規則が成立する
- ユーザー提示のGame8通常アーティアTable情報で、Switch Axeが明示的な別カテゴリとなり、その他の近接武器が共通条件として扱われている
- none poolは既存Long Sword none fixtureと整合する
- PRNG / seed derivation / weaponType stream自体は全武器共通であり、weaponType numeric値だけがseedを分離する

**golden / fixture**

- 14.13の1293件CSV全データはrepository fixtureへ入れていない（repositoryの巨大化を避ける）。再検証時点でユーザーが確認したcurrent Normal CounterはDual Blades 349、Great Sword 156、Hammer 24、Charge Blade 0であるが、各武器の正確な5-slot ordered sequenceはrepository内の監査記録に存在しないため、Production予測で生成した系列を「game-observed」としてfixture化することはしていない。テストはProduction Engineとkernelの一致、Melee poolの同一性、support境界、14.13上限の適用だけを固定する。game-observed goldenとして扱ってよいMelee fixtureは引き続きLong Sword Fire / noneの既存fixtureだけである

**Switch Axe**

- Game8情報ではSwitch Axeは他の近接とTable条件が異なり、パーツ構成によらず同一Tableとされている。しかし使用candidate pool、属性あり / noneの扱い、current `NormalArtianAttributeClass` との対応を今回の実ゲームfixtureでは確認していないため、推測でMelee poolへ入れない。`gameVerifiedNormalCandidatesForWeaponAndElement('weapon.switch_axe', ...)` は引き続き `UnsupportedGameVerifiedNormalPredictionError` であり、`getPredictionSupport` は `normal_pool_unverified`、Counter Identificationは `unsupported_input` / `normal_pool_unverified` でfail closedすることをtestで固定した（この状態は14.16のSwitch Axe実機検証で解除され、Switch Axeは独立したsingle pool contractとしてsupportedになった。Melee allow-listへは引き続き入れていない）

**Counter Identification**

- PR #32のNormal Counter Identification kernelは `ProductionRngEngine.getPredictionSupport()` と `gameVerifiedNormalCandidatesForWeaponAndElement()` を共有しているため、kernel側の変更なしに新しいMelee supportを利用できる。Great Sword / Dual Blades / Hammer / Charge Bladeの `attribute_present`、およびSword and Shield / Hunting Horn / Lance / Gunlance / Insect Glaiveの `attribute_present` / `none` がinput supportを通り、Switch Axeだけが `unsupported_input` のままであることをtestで固定した。observation validationのAttack 5 / Element 4 / Sharpness 2 / Affinity 3上限は14.13契約をそのまま使う。HBG golden（Counter 4 / 5 / 6、0..5000で `startNormalCounter = 4` 唯一）は変わらない

**version**

- 以前unsupportedだったNormal Prediction inputがsupportedになり、Candidate SearchのRoute availabilityとCounter Identification supportが変わるため、observable Production RNG semantics changeとして `PRODUCTION_RNG_ENGINE_VERSION` を `production-rng:c5-e3` から `production-rng:c5-e4` へ更新した。`rngEngineVersion` の差がCalculationContextの失効境界である。`CURRENT_CALCULATION_APP_SCHEMA_VERSION`、`DATABASE_SCHEMA_VERSION`、`AppSettings.schemaVersion`、Master dataVersionは変更していない
- 変更していないもの: reference parity pool、reference golden、PRNG、seed derivation、10-step block、candidate `maximumOccurrences`、Normal Counter semantics（武器種 + rarityごとに1本、Table A / Bのどちらを作成しても1進む）、`NormalArtianCounter` persisted shape、persistence schema、`NormalArtianAttributeClass`、Bowの属性分類、Gogma RNG、Skill RNG、Search algorithm、Planner algorithm、UI。Table A / Bの新Domain model導入も行っていない

---

### 14.15 Bow Normal Table A / B実機検証（2026-09-15）

監査日: 2026-09-15 (Asia/Tokyo)

**背景**

- PR #32以降のNormal Counter Identificationと従来のProduction poolは、Bowを `none -> [6, 8]` / それ以外すべて `-> [6, 4, 8]` の2分類（`NormalArtianAttributeClass = 'none' | 'attribute_present'`）で扱っていた。これはFire Bowだけを実測した5.3のC4-C matrixから一般化した契約であり、Bowの毒 / 麻痺 / 睡眠で実ゲームと異なることが今回の実機検証で確定した
- ユーザー提示のGame8記事（<https://game8.jp/mhwilds/673616>）はBowの通常アーティア抽選poolをTable A（火 / 水 / 雷 / 氷 / 龍 / 爆破）とTable B（無属性 / 毒 / 麻痺 / 睡眠）に分類している

**調査方法**

- Base Seed 51231782、Bow Normal Counter 0
- 同じ保存状態からCounter 0で開始し、対象Bowをforgeして復元ボーナス5枠を確認したのち、保存せず調査前状態へ戻し、再びCounter 0から別属性をforgeした。したがって異なる属性を同じPRNG Counter 0で比較できている

**観測結果（Counter 0、lottery ID順 = 画面slot順）**

| Bow element | 5枠 | lottery IDs | Table | provenance |
|---|---|---|---|---|
| 火 | 基礎攻撃力強化 / 基礎攻撃力強化 / 会心率強化 / 属性強化 / 属性強化 | `[6, 6, 8, 4, 4]` | A | direct observation（既存fixtureと再一致。Counter 1 `[4, 6, 4, 6, 4]` も再一致） |
| 爆破 | 基礎攻撃力強化 / 基礎攻撃力強化 / 会心率強化 / 属性強化 / 属性強化 | `[6, 6, 8, 4, 4]` | A | direct observation（火Counter 0と完全一致） |
| 毒 | 会心率強化 / 会心率強化 / 基礎攻撃力強化 / 基礎攻撃力強化 / 会心率強化 | `[8, 8, 6, 6, 8]` | B | direct observation（既存none Counter 0と完全一致） |
| 麻痺 | 会心率強化 / 会心率強化 / 基礎攻撃力強化 / 基礎攻撃力強化 / 会心率強化 | `[8, 8, 6, 6, 8]` | B | direct observation |
| 睡眠 | 会心率強化 / 会心率強化 / 基礎攻撃力強化 / 基礎攻撃力強化 / 会心率強化 | `[8, 8, 6, 6, 8]` | B | direct observation |
| 無属性 | 会心率強化 / 会心率強化 / 基礎攻撃力強化 / 基礎攻撃力強化 / 会心率強化 | `[8, 8, 6, 6, 8]` | B | existing observation（C4-C fixture、Counter 0..2） |

- Production predictionは、Table A pool `[6, 4, 8]`（Attack 5 / Element 4 / Affinity 3）とTable B pool `[6, 8]`（Attack 5 / Affinity 3）を同じNormal seed / 同じCounter 0のraw blockへ適用するだけで、上記6条件すべてと一致する。PRNG、seed derivation（ElementIdはseedへ入れない）、10-step block、pool step、occurrence limitは変更していない
- Game8のTable A / B分類と、今回直接確認した5属性 + 既存noneの分類は完全に一致する

**provenanceの区別（過剰主張の禁止）**

| 区分 | Bow element | 根拠 |
|---|---|---|
| direct observation（今回） | 火 / 爆破 / 毒 / 麻痺 / 睡眠 | 本節の実機観測（Counter 0。火はCounter 1も再一致） |
| existing observation | 無属性 | 5.3のC4-C fixture（Counter 0..2） |
| category-level Production adoption | 水 / 雷 / 氷 / 龍 → Table A | Game8分類、火と爆破がTable Aである直接fixture、従来Productionが五属性を同一elemental poolとして扱っていたことを反証するevidenceがないこと |

「Bowの全属性を今回直接実機検証した」と記述してはならない。

**Domain / 実装**

- Table A / Bを正式Domain概念 `NormalArtianLotteryTableClass = 'table_a' | 'table_b'`（`src/domain/rng/normalArtianLotteryTable.ts`）として導入し、`NormalArtianAttributeClass = 'none' | 'attribute_present'` は廃止した。Production側は exact ElementId → table class（`normalArtianLotteryTableClassForWeaponAndElement()`）、weaponType + table class → candidates（`gameVerifiedNormalCandidatesForWeaponAndTableClass()`）に責務を分離し、既存 `gameVerifiedNormalCandidatesForWeaponAndElement()` はその合成へdelegateする。Bow poolの定数は `GAME_VERIFIED_BOW_TABLE_A_NORMAL_CANDIDATES` / `GAME_VERIFIED_BOW_TABLE_B_NORMAL_CANDIDATES` へ整理した
- Table A / BはCounter streamではない。Bowの火 / 爆破 / 毒 / 麻痺 / 睡眠 / 無属性はすべて同じ `weapon.bow:8` Counterを共有し、Counter Cで火、次に毒をforgeすればC+1を消費する。`NormalArtianCounter.id`、persisted shape、`normalArtianCounterId()`、DB schemaは変更していない
- Melee 10種（Switch Axe除く）はTable A = 属性あり `[6, 4, 7, 8]`、Table B = 無属性 `[6, 7, 8]` のまま既存semanticsを維持し、毒 / 麻痺 / 睡眠 / 爆破の近接は従来どおりTable A側である。LBG / HBGは両tableとも `[6, 7, 8]` で変更なし。Switch Axeはtable class / pool対応が未確認のまま `normal_pool_unverified` でfail closedし、推測でsupportへ追加していない
- Normal Counter Identificationは `NormalArtianCounterObservation.tableClass` を受け取り、各観測のpoolを `gameVerifiedNormalCandidatesForWeaponAndTableClass()` から直接取得する。`getPredictionSupport()` のsupport queryにだけ `table_a -> element.fire` / `table_b -> element.none` の内部代表値を使い、永続化・Observation・UIへは出さない。UIはBowで「テーブルA（火・水・雷・氷・龍・爆破）/ テーブルB（無属性・毒・麻痺・睡眠）」、その他の武器種で「属性あり / 無属性」を選ばせ、exact ElementIdは選ばせない。選択可能Bonusは引き続きProduction poolから導出する
- fixture: `src/test/fixtures/gameVerifiedNormalVectors.ts` に爆破 / 毒 / 麻痺 / 睡眠のCounter 0 direct observationを追加した。既存Fire / None fixtureは保持し重複追加していない

**golden**

- Bow Counter 0: Fire `[6, 6, 8, 4, 4]`、Blast `[6, 6, 8, 4, 4]`、Poison `[8, 8, 6, 6, 8]`、Paralysis `[8, 8, 6, 6, 8]`、Sleep `[8, 8, 6, 6, 8]`、None `[8, 8, 6, 6, 8]` をProduction golden testで固定し、ElementId分類（Table A: fire / water / thunder / ice / dragon / blast、Table B: none / poison / paralysis / sleep）をexhaustiveにtestした
- Counter Identification: HBG golden（Counter 4 / 5 / 6、0..5000で `startNormalCounter = 4` 唯一）不変、Bow Table A Counter 0観測 `[Attack, Attack, Affinity, Element, Element]` とTable B Counter 0観測 `[Affinity, Affinity, Attack, Attack, Affinity]` がC = 0に一致、同じBow identification内のTable A / B混在を受理、Bow / Table B / Elementは `invalid_input`、Switch Axeは `unsupported_input` / `normal_pool_unverified`
- Candidate Search Production integration: Bow PoisonのNormal PredictionがTable B poolを使い、forged slotに対するKeepで到達するIdealをCandidate Searchが見つけることを1件固定した。Search / Planner algorithm自体は変更していない

**version**

- Bow毒 / 麻痺 / 睡眠のProduction Normal Prediction outputが変わるobservable Production RNG semantics changeとして、`PRODUCTION_RNG_ENGINE_VERSION` を `production-rng:c5-e4` から `production-rng:c5-e5` へ更新した。旧CalculationContextのBuildCandidate / BuildListEntry / ProductionPlanは `rngEngineVersion` の差で `calculation_context_changed` になる
- 変更していないもの: `CURRENT_CALCULATION_APP_SCHEMA_VERSION`、`DATABASE_SCHEMA_VERSION`、`AppSettings.schemaVersion`、Master dataVersion、`ExportRoot.schemaVersion`、`NormalArtianCounter` persisted shape、reference parity pool（`REFERENCE_NORMAL_ELEMENTAL_CANDIDATES` / `REFERENCE_NORMAL_NONE_CANDIDATES`、`predictReferenceNormalRaw()`、reference golden。referenceのnone / non-none分類はreference parity契約として残す）、PRNG、seed derivation、10-step block、occurrence limits、Counter increment semantics、Skill RNG、Gogma RNG、Search algorithm、Planner algorithm、Material rules、当時のSwitch Axeのunsupported（その後14.16で解除）

---

### 14.16 Switch Axe Normal single-pool実機検証（2026-09-15）

監査日: 2026-09-15 (Asia/Tokyo)

**背景**

- 14.14 / 14.15の時点でSwitch Axeだけが `normal_pool_unverified` としてProduction Normal Prediction / Counter Identificationからfail closedされていた。Game8はSwitch Axeを他の近接と別条件（「どんなパーツ構成でも同じテーブル」）としているが、使用pool、属性あり / 無属性の扱い、`NormalArtianLotteryTableClass` / pool対応を実機fixtureで確認していなかった
- 調査開始時のSwitch Axe rarity-8 Normal Counterは「過去に作成した記憶がないためおそらく0」という状態であり、確定値ではなかった

**調査方法**

- Base Seed 51231782、Switch Axe rarity 8
- A. 調査前saveから火属性構成をCounter 0で作成 → 観測 → 保存せず戻る
- B. 同じsaveから3パーツをすべて異なる属性にした構成（Domainでは `element.none` として表現する無属性構成）をCounter 0で作成 → 観測 → 保存せず戻る
- C. 同じsaveから、reloadを挟まずに火構成（Counter 0）→ 全部別々構成（Counter 1）を連続作成 → 観測

**観測結果（lottery ID順 = 画面slot順）**

| 手順 | 構成 | Counter | 5枠 | lottery IDs |
|---|---|---|---|---|
| A | 火 | 0 | 斬れ味強化 / 斬れ味強化 / 会心率強化 / 基礎攻撃力強化 / 属性強化 | `[7, 7, 8, 6, 4]` |
| B | 全部別々（none） | 0 | 斬れ味強化 / 斬れ味強化 / 会心率強化 / 基礎攻撃力強化 / 属性強化 | `[7, 7, 8, 6, 4]` |
| C-1 | 火 | 0 | 斬れ味強化 / 斬れ味強化 / 会心率強化 / 基礎攻撃力強化 / 属性強化 | `[7, 7, 8, 6, 4]` |
| C-2 | 全部別々（none） | 1 | 会心率強化 / 基礎攻撃力強化 / 属性強化 / 属性強化 / 基礎攻撃力強化 | `[8, 6, 4, 4, 6]` |

- 既存PRNG、Switch Axe reference weapon type = 8、rarity 8 internal = 7、Base Seed 51231782、10-step blockに、pool `[6, 4, 7, 8]`（Attack 5 / Element 4 / Sharpness 2 / Affinity 3）を適用したCounter 0 / Counter 1のPredictionは、AとBとC-1の `[7, 7, 8, 6, 4]`、C-2の `[8, 6, 4, 4, 6]` とslot順を含め完全一致する。PRNG、seed derivation（ElementIdはseedへ入れない）、10-step block、pool step、occurrence limitは変更していない
- AとBが完全一致することから、少なくとも直接比較した「属性あり構成」と「全部別々の属性パーツ構成」の間にはpool切替が存在しない。Melee Table B pool `[6, 7, 8]` は無属性構成の属性強化（4）を抽選できないため、この観測はSwitch AxeをMelee分類（属性あり `[6, 4, 7, 8]` / 無属性 `[6, 7, 8]`）で扱うことを直接反証する。Game8の「スラアクはどんなパーツ構成でも同じテーブル」という分類とも一致する
- C-1 → C-2の連続観測は、既存Normal Counter semantics（武器種 + rarityごとに1本、1 forgeで1進む）と一致する。C `[7, 7, 8, 6, 4]` / C+1 `[8, 6, 4, 4, 6]` の2観測を開始Counter 0..5000で照合すると `startNormalCounter = 0` の1件だけに一致し（Counter 0観測1件だけでは候補が複数）、「おそらく0」だったCounterをCounter 0として再現できる。この一意性はrepositoryの現行kernel（`selectReferenceNormalLotteryIdsFromRawValues()` + `readReferenceRngBlock()`）でも独立に確認した

**結論**

- Switch Axeはパーツ構成非依存のsingle pool `[6, 4, 7, 8]`（Attack / Element / Sharpness / Affinity）である
- Counter streamは `weapon.switch_axe:8` の1本であり、Table classやパーツ構成をIDへ追加しない
- C0 / C1進行は既存Normal Counter semanticsと一致する

**provenanceの区別（過剰主張の禁止）**

| 区分 | 対象 | 根拠 |
|---|---|---|
| direct observation（今回） | pool membership `[6, 4, 7, 8]` | 本節のA / B / C観測（Base Seed 51231782、Counter 0 / 1） |
| direct observation（今回） | 火 / 全部別々（none）構成に依存しないこと | AとBが同じCounter 0で完全一致 |
| direct observation（今回） | Counter 0 → 1の連続stream | C-1 → C-2 |
| category-level Production adoption | Attack 5 / Element 4 / Sharpness 2 / Affinity 3の `maximumOccurrences` 境界 | 14.13のMelee 1293個体 / 6465 slots直接検証、ユーザー提示のGame8上限表、今回のSwitch Axe観測がこれらを一切反証しないこと |

「Switch AxeでAttack 5 / Element 4 / Sharpness 2 / Affinity 3の境界を直接game-verifiedした」と記述してはならない。

**Domain / 実装**

- `gameNormalBonuses.ts` にSwitch Axe専用Production定数 `GAME_VERIFIED_SWITCH_AXE_NORMAL_CANDIDATES = [GAME_ATTACK, GAME_ELEMENT, GAME_SHARPNESS_OR_CAPACITY, GAME_AFFINITY]` を追加した。`PRODUCTION_MELEE_NORMAL_POOL_WEAPON_TYPE_IDS`（Melee共通10種）には入れていない。pool配列の値がMelee Table Aと同じであっても、Melee Table Bが `[6, 7, 8]` である以上category semanticsは異なるため、provenance / classification上は独立したSwitch Axe contractとして扱う
- formal Domainの `NormalArtianLotteryTableClass = 'table_a' | 'table_b'` は変更していない。Switch Axeでは `normalArtianLotteryTableClassForWeaponAndElement()` が `element.none -> table_b`、それ以外 -> `table_a` に分類し（Identification / UIのsemantic observation adapter）、`gameVerifiedNormalCandidatesForWeaponAndTableClass('weapon.switch_axe', ...)` は `table_a` / `table_b` のどちらでも同一のSwitch Axe poolを返す（LBG / HBGで両tableが同じpoolを返すのと同じadapter構造）。「Switch Axeにはゲーム上別々のTable A / Bがある」と主張してはならない。BowのTable A / B splitはSwitch Axeへ適用しない
- `ProductionRngEngine.getPredictionSupport()` はSwitch Axe rarity 8 Normal Predictionを `supported: true` とする。rarity 8以外は従来どおり `reference_adapter_unsupported`、unknown weapon / unknown elementはfail closed。`normal_pool_unverified` の構造化reasonは、Production poolを持たない将来の武器種のためのfail-closed契約として残す（現時点で該当する武器種はない）
- Counter Identification: `getNormalArtianCounterIdentificationSupport('weapon.switch_axe', 8)` は `supported: true`。kernelは `gameVerifiedNormalCandidatesForWeaponAndTableClass()` を共有しているため、Switch Axeの両table classが同じsingle poolで1本のCounterを検索できる。Observationのoption authority（`normalArtianCounterObservationBonusOptions()`）は両tableとも基礎攻撃力強化 / 属性強化 / 斬れ味強化 / 会心率強化であり、`table_b` でもElementは有効である。Melee Table BのElement invalidをSwitch Axeへ誤適用しない。occurrence validation（Sharpness 3 / Affinity 4 / Element 5は `invalid_input`、Attack 5は有効）は6.3.1契約をそのまま使う
- UI: NormalCountersPageのSwitch Axe行は「Production検証対象外」ではなくなり「観測・検索」を利用できる。Dialogの区分は弓ではないため既存generic表示（属性あり / 無属性）を維持し、exact Element dropdownは追加していない。両区分のbonus optionsはDomainから導出し、UIにSwitch Axe専用lottery tableをハードコードしない。両table classが同じpoolを返す武器種（LBG / HBG / Switch Axe）には、Domainのpool同一性から導出した補足文「この武器種は属性の有無によらず同じ復元ボーナス抽選を使用するため、どちらの区分でも選択できる復元ボーナスは同じです。」を表示する
- Candidate Search: 確定Base Seed + 確定Switch Axe Normal Counterがある場合、new Normal → convert Gogma系routeがpredicted variantで探索可能になる。Search algorithm / Planner algorithm自体は変更していない。Production integration testとして、Base Seed 51231782 / Switch Axe Normal Counter 0 confirmedで `create_normal_artian`（`normalCounterBefore = 0`）を含むrouteが `normal_pool_unverified` で除外されず探索され、forged slotがC0 fixture `[Sharpness, Sharpness, Affinity, Attack, Element]` であり、そのKeepで到達するIdealをCandidate Searchが見つけることを1件固定した
- Counter persistence: `weapon.switch_axe:8` の1本のみ。Table class / パーツ構成をIDへ追加せず、DB schema、`NormalArtianCounter` persisted shape、Observation履歴のmemory-only運用は変更していない
- fixture: `src/test/fixtures/gameVerifiedNormalVectors.ts` に `gameVerifiedSwitchAxeFireNormalVectors`（火 Counter 0）と `gameVerifiedSwitchAxeNoneNormalVectors`（none Counter 0 / 1）を追加し、各行のprovenance（save reload後の直接観測 / 火C0直後のreloadなし連続観測）をcommentに記録した

**golden**

- Production: Switch Axe Fire C0 `[7, 7, 8, 6, 4]`、None C0 `[7, 7, 8, 6, 4]`、None C1 `[8, 6, 4, 4, 6]`。supported exact ElementIdすべてでpool `[6, 4, 7, 8]`、両table classが同一定数、火 / none（および全属性）で同じCounterなら同じraw result（elementはNormal seedへ入らない）
- Counter Identification: Table A C0観測 `[Sharpness, Sharpness, Affinity, Attack, Element]` + Table B C1観測 `[Affinity, Attack, Element, Element, Attack]`、Base Seed 51231782、0..5000で `matches = [{ startNormalCounter: 0 }]`、`isTruncated = false`。両tableが同じCounter streamを共有し、どちらのtable classで各観測を宣言しても同じ結果になる。結果にraw elementIdを含まない。Counter保存はC（観測数を加算しない）
- Regression: Bow Table A / B、Melee 10種、LBG / HBG、HBG Counter golden、reference parityはすべて不変

**version**

- 以前unsupportedだったSwitch AxeのNormal Prediction inputがsupportedになり、Candidate SearchのRoute availabilityとCounter Identification supportが変わるため、observable Production RNG semantics changeとして `PRODUCTION_RNG_ENGINE_VERSION` を `production-rng:c5-e5` から `production-rng:c5-e6` へ更新した。旧CalculationContextのBuildCandidate / BuildListEntry / ProductionPlanは `rngEngineVersion` の差で `calculation_context_changed` になる
- 変更していないもの: `CURRENT_CALCULATION_APP_SCHEMA_VERSION`、`DATABASE_SCHEMA_VERSION`、`AppSettings.schemaVersion`、Master dataVersion、`ExportRoot.schemaVersion`、`NormalArtianCounter` ID / persisted shape、reference parity pool（`REFERENCE_NORMAL_ELEMENTAL_CANDIDATES` / `REFERENCE_NORMAL_NONE_CANDIDATES`、`predictReferenceNormalRaw()`、reference golden。referenceのnone / non-none分類はSwitch Axeでもreference parity契約として残す）、PRNG、seed derivation、10-step block、Counter increment rule、occurrence limits、Bow分類、Melee 10種の分類とallow-list、LBG / HBG pool、Skill RNG、Gogma RNG、Search algorithm、Planner algorithm、Material rules

---

### 14.17 Gogma Reset family availability / family上限 / Keep実機検証（2026-09-15）

監査日: 2026-09-15 (Asia/Tokyo)

本節は仕様確定（PR-A）の記録である。src、test / fixture、Master JSON、DB / persistence schema、`PRODUCTION_RNG_ENGINE_VERSION` は変更していない。Production RNGへの実装はPR-B、UI / Validationへの反映はPR-Cで行う。正式契約は [RNG_SPEC.md](./RNG_SPEC.md) 6.1.1 である。

**背景**

- PR-A時点のProduction Gogma Reset（`production-rng:c5-e6`）は `getBonusDefinitionsForWeapon(master, weaponTypeId, elementId, 'gogma_artian')` のMaster availabilityで `REFERENCE_GOGMA_RESET_CANDIDATES` をpre-draw filterし（10.4）、weighted drawはGARP v0.9.4 parityの `weight = max(0, 100 - exactIdOccurrenceCount * repeatPenalty)` だけを使う。family / category単位の上限は持たない
- 10.4の5条件（Bow火 / Bow none / LBG火 / HBG火 / Long Sword none）はMaster availabilityで説明できたが、Master availabilityを未観測のweapon / elementへ一般化してよいことは直接確認していなかった

**provenance**

- Date: 2026-09-15
- Time zone: Asia/Tokyo
- Observation source: GogmaArtianPlanner user live-game observation
- Base Seed: 51231782
- Counter位置: Bow / 毒 C55、Switch Axe / 全パーツ別属性相当（Domain `element.none`）C55、Hammer / 麻痺 C64 / C79 / C94 / C103 / C104 / C105 / C129 / C154 / C159 / C160 / C161、Bow / 毒 C179、Lance / 龍 C197、Dual Blades / 龍 Keep C55..C59
- 本節の仕様根拠として5枠値を記録するのは下表の観測である。上記Counter位置のうち下表にない補助観測は位置だけを記録し、5枠値は転記していない

**仕様根拠とした観測（reference ID順 = 画面slot順）**

Reset:

| 条件 | Counter | 観測5枠 | reference IDs | 現行model（c5-e6） | 新Production model | 根拠とする事項 |
|---|---:|---|---|---|---|---|
| Bow / 毒 | 55 | Affinity EX / Attack EX / Attack II / Attack III / Affinity II | `[16, 15, 8, 12, 9]` | `[9, 8, 11, 14, 12]` 不一致 | 一致 | Table BにElement familyがない |
| Switch Axe / none | 55 | Sharpness base / Element EX / Affinity II / Attack II / Sharpness base | `[6, 14, 9, 8, 6]` | `[13, 9, 6, 9, 8]` 不一致 | 一致 | single poolにElement familyがある |
| Hammer / 麻痺 | 94 | Attack III / Sharpness base / Sharpness EX / Attack II / Attack EX | `[12, 6, 10, 8, 15]` | `[12, 6, 10, 8, 13]` 不一致 | 一致 | 補助観測（上限2と矛盾しない裏付け。仕様根拠はC104） |
| Hammer / 麻痺 | 104 | Sharpness base / Sharpness base / Affinity EX / Attack II / Affinity III | `[6, 6, 16, 8, 13]` | `[6, 6, 8, 10, 8]` 不一致 | 一致 | `sharpness_capacity` family上限2（primary evidence） |
| Hammer / 麻痺 | 160 | Affinity EX / Affinity II / Affinity EX / Element EX / Affinity III | `[16, 9, 16, 14, 13]` | 一致 | 一致 | Gogma ResetでAffinity 4枠 |
| Bow / 毒 | 179 | Affinity EX / Affinity II / Affinity II / Affinity III / Affinity III | `[16, 9, 9, 13, 13]` | `[14, 9, 15, 11, 8]` 不一致 | 一致 | Gogma ResetでAffinity 5枠 |
| Lance / 龍 | 197 | Element II / Affinity III / Element EX / Element II / Element EX | `[11, 13, 14, 11, 14]` | 一致 | 一致 | Element 4枠（II×2 + EX×2） |

Keep（Dual Blades / 龍、current family layout Element / Element / Element / Element / Sharpness）:

| Counter | reference IDs | 現行Keep model |
|---:|---|---|
| 55 | `[14, 14, 11, 11, 6]` | 一致 |
| 56 | `[14, 14, 11, 11, 6]` | 一致 |
| 57 | `[11, 14, 14, 11, 10]` | 一致 |
| 58 | `[11, 14, 11, 14, 10]` | 一致 |
| 59 | `[11, 11, 14, 14, 6]` | 一致 |

- 「現行model」列はPR-A時点のrepositoryの `predictGameAdjustedGogmaReset()`（Master availability filter + exact-ID repeat penalty。PR-Bで `predictProductionGogmaReset()` へ置き換えて削除）、「新Production model」列はProduction Normal pool family集合によるpre-draw filter + exact-ID repeat penalty + `sharpness_capacity` family上限2を、同じPRNG / Gogma seed derivation / 10-step blockへ適用した検算値である。Keepは現行 `predictReferenceGogmaKeep()` の検算値である。検算はrepository外のscratch harnessで既存関数を呼び出して行い、repositoryは変更していない
- Hammer / 麻痺 C104（`sharpness_capacity` family上限2のprimary evidence）: slot 1..2 `[6, 6]` で `sharpness_capacity` が2枠に達する。exact-ID repeat penaltyだけのmodel（現行 / GARP parity）ではID 6はweight 0になるがID 10のweightが残るため `[6, 6, 8, 10, 8]` となる。実ゲーム `[6, 6, 16, 8, 13]` は、2枠到達時点でID 6とID 10の両candidateをpoolから除外するmodelと一致した。slot 1..2は同一ID 6（Sharpness base）の2枠であり、rank転記の解釈に依存せずfamily 2枠到達を示すため、`sharpness_capacity` family上限2のProduction契約はC104単独で確定する
- Hammer / 麻痺 C94（補助観測）: 5枠値は今回の観測入力で転記された `[12, 6, 10, 8, 15]`（slot 3 = Sharpness EX / ID 10）であり、repository内に独立した既存記録はない。この転記値ではslot 1..4 `[12, 6, 10, 8]` で `sharpness_capacity` が2枠に達し、上限なしmodelはslot 5でID 13、上限2 modelはID 15を引き、実ゲームは15だった。C104の契約と矛盾しない裏付けとして記録するが、上限2の仕様根拠をC94へ依存させない
- Hammer / 麻痺 C160（Affinity 4枠）とBow / 毒 C179（Affinity 5枠）により、Normal Affinity上限3をGogma Resetへ適用するmodelは直接反証される
- Lance / 龍 C197はElement II×2 + EX×2の4枠が実在することを示す。Element candidateはID 11 / 14の2つだけで、exact-ID repeat penaltyにより各2個でweight 0になるため、明示family上限なしで実効最大4となる
- Keep 5件は、少なくとも今回のlayoutではElement II×3 + EX×1やII×1 + EX×3にならず、II×2 + EX×2となることを直接示し、現行Keep weighted modelとslot順を含め一致した

**既存fixtureとの整合**

- 10.4の5条件と14.5のHammer / 麻痺 C55..C60（30 ordered slots）は、新Production modelでも全slot一致した（同じscratch検算）。Bow火はTable A（Sharpnessなし）、Bow noneはTable B（Element / Sharpnessなし）、LBG / HBG火はElementなし、Long Sword noneはMelee Table B（Elementなし）であり、これらの条件ではMaster availabilityとNormal pool family集合が同じfamily集合になる
- 10.4のBow火 C56 Keep fixtureは変更対象外である

**結論（Production契約、[RNG_SPEC.md](./RNG_SPEC.md) 6.1.1）**

1. Production Gogma Resetのfamily availabilityは、同じ `weaponTypeId` + `elementId` のProduction Normal Artian candidate poolのfamily集合とする。共有するのはfamily集合だけで、Normal seed / Counter / `maximumOccurrences` は共有しない
2. Bow Table A / BとSwitch Axe single poolはGogma Reset family availabilityにもそのまま使う
3. `WeaponBonusDefinition` + `ElementMaster.allowsElementBonus` はProduction lottery family authorityにしない
4. Production Gogma Resetに追加するfamily上限は `sharpness_capacity` = 2だけである。Attack / Affinity / Elementには明示family上限を設けない
5. Gogma exact-ID repeat penalty（非EX candidate 100 → 50 → 0、EX candidate 100 → 20 → 0）はReset / Keepとも維持する
6. Keepアルゴリズムは変更しない
7. Gogma Counter IdentificationはProduction Resetと同じcandidate availabilityとweighted draw semanticsを共有する
8. reference parity（`REFERENCE_GOGMA_RESET_CANDIDATES`、`buildReferenceWeightedGogmaPool`、`predictReferenceGogmaReset`、reference golden / tests）は変更しない

**provenanceの区別（過剰主張の禁止）**

| 区分 | 対象 | 根拠 |
|---|---|---|
| direct observation（今回） | Bow Table B（毒）のGogma ResetでElement familyが候補にない | Bow / 毒 C55 / C179 |
| direct observation（今回） | Switch Axe `element.none` のGogma ResetでElement familyが候補にある | Switch Axe / none C55 |
| direct observation（今回） | `sharpness_capacity` family合計上限2（6 / 10の両方を除外） | Hammer / 麻痺 C104（primary evidence、単独で確定）。C94は補助観測であり根拠に含めない |
| direct observation（今回） | Gogma ResetでAffinity 4 / 5枠が実在する | Hammer / 麻痺 C160、Bow / 毒 C179 |
| direct observation（今回） | Element II×2 + EX×2の4枠が実在する | Lance / 龍 C197 |
| direct observation（今回） | Element×4 + Sharpness layoutのKeepが現行Keep modelと一致する | Dual Blades / 龍 C55..C59 |
| category-level Production adoption | Bow / 麻痺・睡眠のGogma Reset family availability（Table B） | Normal Table B分類（14.15）の適用。Gogma側の直接実測はない |
| category-level Production adoption | 直接観測していないweapon type / elementへのNormal pool family集合の適用 | 上記直接観測と、10.4 / 14.5の既存fixtureがすべてこのmodelと一致し反証がないこと |
| category-level Production adoption | Hammer / 麻痺以外（Capacityを持つLBG / HBGを含む）への `sharpness_capacity` family上限2の適用 | Hammer / 麻痺の直接観測と既存fixtureとの無矛盾 |

「全weapon / 全elementでGogma Reset availabilityを実機検証した」「全武器種でSharpness / Capacity上限2を直接実測した」と記述してはならない。

**未確認として残す事項**

- current layoutに `sharpness_capacity` familyを3枠以上持つKeepの実ゲーム結果。unsupported化やKeepへのfamily上限2強制は行わない
- 武器種のProduction family availability外のfamily（例: Bow Table BのElement、LBG / HBGのElement）をcurrentに持つKeepの実ゲーム結果（10.4の既存方針どおりfilter / retry / replacementを追加しない）
- normal-scope current bonusesからのKeep結果（20）

**後続PR**

- PR-B（Production RNG、実装済み。下記「PR-B実装」）: Production Gogma Resetのcandidate availabilityをProduction Normal pool family集合へ置き換え、`sharpness_capacity` family上限2を実装した。Gogma Counter Identification kernelも同じauthorityへ移行した。今回の観測をprovenance付きgame-verified fixtureとして追加し、10.4 / 14.5の既存fixtureとreference golden / reference testsが不変であることを確認した。`PRODUCTION_RNG_ENGINE_VERSION` を `production-rng:c5-e6` から `production-rng:c5-e7` へ更新した
- PR-C（UI / Validation）: Masterのweapon type / scope定義とProduction family availabilityの積を返す複合availability selectorを、Master層がProduction RNG層へ依存しない依存方向で追加し、Owned Weapon editor、Target editor、Target compromise editor、Entity validation、Identification Wizard、new entity draftへ適用する。現行UI / Validationで保存済みの、Production family availability外のbonusを持つ既存データの扱いはPR-Cで仕様決定する

**PR-B実装（2026-09-16）**

- family availability: `productionGogmaResetCandidatesForWeaponAndElement()`（`gameGogmaBonuses.ts`）が `gameVerifiedNormalCandidatesForWeaponAndElement()` の返すProduction Normal poolからfamily集合だけを導出し（Normal lottery ID 6 / 4 / 7 / 8 → attack / element / sharpness_capacity / affinity のProduction内部mapping）、固定reference順 `[8, 12, 15, 9, 13, 16, 11, 14, 6, 10]` からfamily外candidateを除く。Bow Table A / B、Switch Axe single pool、Melee / Bowgunの分類は `gameNormalBonuses.ts` にだけ残し、Gogma側へ複製しない。Normalの `maximumOccurrences`、seed、Counterは読まない
- family上限: `buildProductionWeightedGogmaResetPool()` が、既選択reference IDのうち `sharpness_capacity` familyが2以上ならID 6 / 10をcandidateから除き、残りを変更しない `buildReferenceWeightedGogmaPool()` へ渡してexact-ID repeat penaltyを適用する。Attack / Affinity / Elementのfamily上限は持たない
- draw: `predictProductionGogmaResetSlotsFromRawValues()` がProduction Reset（`predictProductionGogmaReset()` / `ProductionRngEngine.predictGogmaBonus(reset)`）とGogma Counter Identification kernelで共有する唯一のdraw pathである。Identificationは旧Master availability pathを持たない
- `ProductionRngEngine.getPredictionSupport(gogma_reset)` はMasterを読まない。unknown weapon / elementは `reference_adapter_unsupported`、Production Normal poolを持たない入力は `normal_pool_unverified`（現行14武器種には該当なし）である。Keepの `artianBonusTypeMappings` 要件は不変である
- 本節の観測はgame-verified fixture（`gameVerifiedProductionGogmaResetVectors`、`gameVerifiedDualBladesDragonKeepChain`、`src/test/fixtures/gameVerifiedGogmaVectors.ts`）として追加した。Keep chain fixtureのcurrent rankはfamily layoutのtest encodingであり実ゲーム観測値ではない。C94はfixtureにしていない。10.4の5条件、14.5のHammer / 麻痺 C55..C60、reference golden / reference testsは不変のまま全件一致する

**version**

- PR-A時点のimplementation: `production-rng:c5-e6`。PR-Aは仕様変更だけでありversionを変更しなかった
- current implementation（PR-B）: `production-rng:c5-e7`（Gogma Reset Prediction outputが変わるobservable Production RNG semantics change）
- 変更しないもの: `CURRENT_CALCULATION_APP_SCHEMA_VERSION`、`DATABASE_SCHEMA_VERSION`、`AppSettings.schemaVersion`、`ExportRoot.schemaVersion`、`RngState.schemaVersion`、`supportsSeedSearch = false`、PRNG、seed derivation、10-step block、Counter semantics、reference candidate table、reference weighted draw、Keepアルゴリズム、Search algorithm、Planner algorithm、Worker protocol。Master JSON / `allowsElementBonus` / Master dataVersionはPR-Aで変更していない

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
- 巨戟tier targetへ進む場合、conversion後の最初のbonus amendmentはReset / Keepのどちらでもよい（normal-scope Keep仕様訂正で確定。参照実装のReset強制は実装上の制約であってゲームルールではない）。amendmentを同Routeで扱うか、確保後の別routeとするかはproduct仕様判断が必要。
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

期待値はGogmaArtianPlanner実装から生成しない。固定version、commit、file hashを確認した `GARP.lua` のpure関数・tableを独立Lua harnessで実行してfixture化または再検証する。fixtureには必ずsource version/commit/file/hash、関数名、入力のnumeric namespace、semantic変換後期待値を併記する。

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
- 直接観測していないweapon type / elementにおけるGogma Reset family availability（Production Normal pool family集合からのcategory-level adoption、14.17）と、Hammer / 麻痺以外への `sharpness_capacity` family上限2の適用。直接観測済みの範囲は、Bow火 / Bow none / LBG火 / HBG火 / Long Sword noneが10.4、Hammer麻痺 C55..C60が14.5、2026-09-15の追加観測（Bow毒 / Switch Axe none / Hammer麻痺 / Lance龍、Dual Blades龍 Keep）が14.17である。
- 武器種のProduction family availability外のfamily（Bow Table BのElement、LBG / HBGのElement等）をcurrentに持つKeepの実ゲーム結果。
- `sharpness_capacity` familyを3枠以上currentに持つKeepの実ゲーム結果（unsupported化やfamily上限2の強制はしない）。
- Current Masterの栄光の誉れ、祝祭の巡りがArtian RNG対象か、別用途か、update差か。
- `gogma_artian` scopeのrank I。かつて実機で確認したと記録したrank Iは巨戟化直後のnormal-scope状態の誤認であり、gogma scope rank IはMasterから除外した。normal-scope表示上の「I」と `bonus_rank.base` の対応は未確認（10.4訂正を参照）。
- normal-scope current bonusesからのKeep結果の実機一致。family正規化はプロジェクトオーナー確認済みのMaster意味対応（ArtianBonusTypeMapping）、family内tier drawは参照実装に従うが、game-verified fixtureは未取得である。
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
