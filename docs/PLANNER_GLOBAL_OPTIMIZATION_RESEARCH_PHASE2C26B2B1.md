# Global Planner Research Phase 2-C2.6-B2-B1（current Route 0 / 1 / 2本固定によるreservation回収の測定）

Refs #154。Research only。Production source、Search / Planner semantics、extent、capture bound、trial / rerun bound、RNG、
schema / version、Persistence、UIは変更していない。`visitPlannerAlternativeCandidates()`、Candidate Search、extent probe、
Candidate capture、Planner Alternative kernel、Candidate trial、full Planner rerun、global assignment、Candidate組合せ探索、
alternative Route生成、K3以上の固定集合、runtime optimizationは行っていない。

- measured HEAD: `b7d04bb32ae38676d9b6364a4a087779c9ba4368`（固定集合列挙・validity判定・reservation導出・snapshot runner・
  post-hoc analyzer・事前登録decision rule・testsを含むclean HEAD。初回formal snapshotは `3b5dac2` で取り、改行正規化の後に
  再測定した。snapshot本体は完全一致。§18）
- analysis HEAD: `b7d04bb32ae38676d9b6364a4a087779c9ba4368`（`codeChangedSinceMeasuredHead = []`、
  `calculationCodeChangedSinceMeasuredHead = []`）
- RESULT: [`docs/PLANNER_GLOBAL_PHASE2C26B2B1_RESULT.json`](PLANNER_GLOBAL_PHASE2C26B2B1_RESULT.json)（`provenance.formal = true`）

## 1. 結論（`B2B1_PARTIAL_ELIGIBLE_RECOVERY`）

oracleを一切読まずに、current searchable Entry 43件から **K0（固定0本）/ K1（1本）/ K2（2本）** の固定集合を全列挙し、
Production authorityでvalidity判定とreservation導出を行った。その後、post-hoc analyzerだけが1,657 oracle Routeと照合した。

| B2-A context gap 40件（search-eligible 40件、checkpoint hard constraint 0件） | 件数 |
| --- | ---: |
| K0でcompatible | 0 |
| **K1で初めてcompatible**（`newlyCompatibleByAllCurrentK1`） | **28** |
| **K2で初めてcompatible**（`newlyCompatibleByK2`） | **9** |
| K≤2でもunreached（`stillUnreached`） | **3** |

事前登録ruleにより **B2B1_PARTIAL_ELIGIBLE_RECOVERY**（37 / 40を回収、3件が残る）。

- B2-Aのsingle fixed winnerでは非互換 / context無しだった40件のうち **28件は「別のcurrent Entryを1本固定」するだけで**
  reservation-compatibleになる。B1 / B2-AはConflict orientationが選んだwinnerしか固定しておらず、互換になる1本を試していなかった。
- **9件はcurrent Route 2本のheld unionが必要**（どの1本でも足りない）。
- 残る **3件はK≤2では到達せず、しかも§9の必要条件によりcurrent Routeを何本固定しても到達しない**。current Route自体が
  必要なheld supportを持っていない（2件はNormal Counterの前方position、1件はSkill前方positionを、own positionをblockしない
  current Routeが誰もholdしない）。この3件はalternative-to-alternative support（他Targetのalternative Routeによるheld）が必要。
- extentは別軸: 回収37件のうち **default extent内18件 / extent不足19件**（不足はSkill 19・Normal 3、Gogma 0。重複あり）。

**formalに言えること**（このExport・current Production・default extent `{ 4, 235, 4 }` について）:

- B2-Aのsingle-winner context 146件はすべて今回のK1 contextに含まれ、reservation・origin・excluded Route・extent・B1
  `searchInputDigest`・oracle reachability verdict（146 / 146）・extent（43 / 43）・empty reservation verdict（43 / 43）が一致した。
- B2-Aのprobe gap（02876df4）はK1でcompatibleかつextent不足（Normal・Skill）として再現した。
- compatibleは「oracle RouteそのものがSearch Domainのheld / blocked / exclusive OwnedWeapon contract上で表現可能」までであり、
  SearchがそのCandidateを実際にdeliverすること、その固定集合が最終43 Target Planに採用できることは **証明していない**。

## 2. 方針

B2-Aは、Conflict orientation由来のsingle fixed winnerだけではheldが足りない、fixed winnerのcurrent Routeがblocked positionを
占有する、non-participant 9 TargetにはSearch contextそのものが無い、という3点を示した。B2-B1はSearchを回す前に、

```text
current BuildListEntry 43件
  -> 固定集合 K0 / K1 / K2 を全列挙（Entry ID順、oracle非依存）
  -> validity: createPlannerRouteUnitPlans() のrejection無し + detectPlannerConflicts()（固定Entryのみ、resolution無し）でConflict無し
  -> reservation: derivePlannerAlternativeReservation()（normalizePlannerAlternativeReservation() 形）
  -> 同一reservationの固定集合はexact dedup（alias provenanceは全保持）
  -> Target T のcontext = T自身のEntryを含まないaliasを1つ以上持つreservation
  -> post-hoc: B2-A K1 parity、oracle Route × context のreachability（B2-Aのhelperを再利用）
```

だけを行い、「single winner不足」の次の問い（**複数のcurrent Route固定で足りるのか、alternative Routeを含む反復的 / global
supportが必要なのか**）を切り分けた。

calculation（`plannerGlobalPhase2C26B2B1.ts` + runner）はExportだけを読み、oracle RESULT・manifest・oracle Target ID・
oracle Counter位置・B2-Aのuncovered判定・support providerを一切知らない（testで確認）。oracle support providerはcontext生成後に
analyzerが説明用に読むだけで、固定集合の選択には使っていない。

## 3. authority

| authority | 値 |
| --- | --- |
| B2-A RESULT | `docs/PLANNER_GLOBAL_PHASE2C26B2A_RESULT.json` SHA-256 `7f425ca46d7908280793440570d8af6e85fe589ec8772160021f15f2e814b883`（登録値と一致） |
| B2-A provenance | `formal = true`、`calculationCodeChangedSinceMeasuredHead = []`、measured `ae2083f` / analysis `d671794` |
| B2-A 登録値 | `B2A_BOTH`、covered 2 / uncovered 41、probe gap 1 / context gap 40、compatibleContextUnfinished 1、compatibleButExtentInsufficient 1、no Search context 9、no compatible context 31、invalidReasons []、inconsistencies 0、subgroups 9 / 31 / 17（held 17件はすべてcontext gap） |
| oracle RESULT | `docs/PLANNER_GLOBAL_1657_ORACLE_RESULT.json` SHA-256 `be51e7cd…f16b584a1`（B2-Aが読んだものと一致） |
| oracle manifest | file SHA-256 `c8b240f6…3c9d81af`、routes SHA-256 `ffb6db5a…6e0e73cc`（B2-A・oracle RESULT記録値と一致）、manifest ↔ RESULT整合も再検査して一致 |
| Export | `cc35fb5bd85acb417b2ce0229cd79441b48c642ac8af70bbc2dfdfc8c89e1e6b`（snapshot = B2-A = oracle RESULT） |

## 4. current input（`preparePlannerInitialContext()`）

| 項目 | 値 |
| --- | ---: |
| planning Target | 43 |
| current searchable Entry（`allSearchEntries`） | 43（全Targetでちょうど1件。0件・2件以上のTargetは無し） |
| initially relevant Entry | 43 |
| Route unit plan rejection | 0 |
| initial Conflict | 21 |
| checkpoint hard constraint Target（`checkpointRequirements.requiredEntryIdByTargetId`） | 0 |

valid Entry・planning Targetは独自判定せず、initial contextの `allSearchEntries` / `planningTargets` / `checkpointRequirements` を使った。
Planner-start Search originは `createPlannerStartSearchOrigin()` で作り、`hashStableValue()` がB2-Aの146 contextすべての
`originDigest` と一致、Counter origin（Skill 341 / Gogma 55 / Normal 14 Counter）も一致した。

## 5. 固定集合

| family | proposed | valid | invalid |
| --- | ---: | ---: | ---: |
| K0 | 1 | 1 | 0 |
| K1 | 43 | 43 | 0 |
| K2 | 903 | 835 | 68 |

invalid K2 68件はすべて `detectPlannerConflicts()` のConflictによる（Route unit plan rejectionは0）。

| invalid K2のConflict kind組合せ | pair数 |
| --- | ---: |
| same_skill_counter | 46 |
| same_gogma_counter | 18 |
| same_owned_weapon_consumed | 2 |
| same_gogma_counter + same_skill_counter | 1 |
| same_gogma_counter + same_normal_counter + same_skill_counter | 1 |

（kind出現数: Skill 49 / Gogma 20 / OwnedWeapon 2 / Normal 1）

cross-check: invalid K2 pairはすべてinitial contextの `initialConflictDetection` のいずれかのConflictに同時に載っている（68 / 68）。
今回のExportでは逆方向（initial Conflictに同時に載るがK2単独ではConflictでないpair）も0件だった（shareable physical actionの
共有があれば逆方向は生じうるため、判定には片方向だけを使う。testで確認）。

K0のreservationはProductionのempty reservationと一致、全reservationは `normalizePlannerAlternativeReservation()` の不動点、
K1のunit planはinitial contextの `allUnitPlans` と全Entryで一致した。

## 6. reservation / semantic context

| 項目 | 値 |
| --- | ---: |
| raw valid fixed set | 879 |
| unique reservation | 879（dedup 0） |
| alias数分布 | 1 alias: 879 |
| raw Target × reservation context（Target自身のEntryを含まないvalid固定集合） | 36,084 |
| unique semantic context | 36,084（dedup 0） |

このExportでは異なる固定集合が同じreservationになる例は無かった（各current Routeが固有のexclusive OwnedWeapon / positionを持つため）。
dedup機構（同一reservationのalias保持、Targetが違えば別context）はsynthetic testで確認している。
semantic context identityは `{ targetWeaponId, origin（normalizePlannerSearchOrigin）, reservation, excludedRouteKeys =
[candidateStableKey(current Route)], extent = Production default }` で、origin / exclusion / extentはTargetごとに一定なため、
exact な `(Target, reservation group)` がidentityになる。固定Entry IDはidentityに入れない。

## 7. B2-A parity（すべて一致）

| 項目 | 結果 |
| --- | --- |
| B2-A context 146件 → K1 context | 146 / 146一致（固定Entry 1本のvalid K1、reservation range、current Entry、excluded Route key SHA-256、extent、origin、Targetのeligible context、B1 `searchInputDigest` 再計算） |
| oracle Route × B2-A contextのreachability verdict | 146 / 146一致（compatible、reasons、lane別missing held / blocked own / Normal held-prefix overlap、Production limit walk） |
| oracle Route extent | 43 / 43一致 |
| empty reservation verdict（B2-A）↔ K0 | 43 / 43一致 |
| B2-A covered 2件 | どちらもK1 compatible |
| B2-A probe gap 02876df4 | K1 compatible（compatible context: K1 3 / K2 219）かつextent不足（Normal・Skill）を再現 |

reachabilityはB2-Aの `phase2c26b2aReachability()` / `phase2c26b2aRouteExtent()` をそのまま呼び（Production
`nextOperationPositions()` / `heldPrefixNormalCreation()` / `createCounterReservation()`）、再実装していない。

## 8. oracle reachability

### 8.1 minimal compatible cardinality

| 集合 | Route | K0 | K1 | K2 | unreached | checkpoint |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 全43 | 43 | 0 | 31 | 9 | 3 | 0 |
| B2-A uncovered | 41 | 0 | 29 | 9 | 3 | 0 |
| **B2-A context gap** | **40** | **0** | **28** | **9** | **3** | **0** |
| non-participant（B2-A: Search context無し） | 9 | 0 | 9 | 0 | 0 | 0 |
| participant context gap（B2-A: 全context非互換） | 31 | 0 | 19 | 9 | 3 | 0 |
| uncovered oracle held Route | 17 | 0 | 13 | 4 | 0 | 0 |
| B2-A probe gap | 1 | 0 | 1 | 0 | 0 | 0 |
| B2-A covered | 2 | 0 | 2 | 0 | 0 | 0 |

minimal cardinality = 「T自身のEntryを含まないaliasのうち、reservation-compatibleになる最小の固定本数」。どのRouteもK0では非互換
（全Routeが他Targetによる前方positionのheldを必要とする）。

- `newlyCompatibleByAllCurrentK1`（context gap）= 28: non-participant 9（B2-Aではcontext自体が無かった）+ participant 19
  （B2-Aのsingle winnerでは非互換、別のcurrent Entry 1本なら互換）。
- `newlyCompatibleByK2`（context gap）= 9: すべてparticipant。K1互換contextは無く、current Route 2本のheld unionで初めて互換。
- uncovered oracle held Route 17件は **17 / 17回収**（K1 13・K2 4）。

### 8.2 B2-A patternとのcross（context gap 40件）

| B2-A single-winner pattern | K1 | K2 | unreached |
| --- | ---: | ---: | ---: |
| no_context:needs_held[gogma] | 5 | 0 | 0 |
| no_context:needs_held[skill+gogma] | 4 | 0 | 0 |
| blocked only（`blocked_position_conflict[gogma]` 5 / `[skill]` 2 / exclusive + blocked 1） | 6 | 1 | 1 |
| held gap only（`[gogma]` 7 / `[skill]` 3 / `[skill+gogma]` 6 / `[normal+gogma]` 1 / `[normal+skill]` 1） | 10 | 6 | 2 |
| blocked + held gap（`[gogma]+[gogma]` 1 / `[gogma]+[skill]` 3 / `[skill]+[normal]` 1） | 3 | 2 | 0 |

詳細（RESULT `aggregates.patternCross.contextGap`）:

| pattern | → minimal |
| --- | --- |
| blocked_position_conflict[gogma] | K1 4 / unreached 1 |
| blocked_position_conflict[skill] | K1 1 / K2 1 |
| exclusive_owned_weapon_conflict + blocked_position_conflict[gogma] | K1 1 |
| held_coverage_gap[gogma] | K1 7 |
| held_coverage_gap[skill] | K1 2 / K2 1 |
| held_coverage_gap[skill+gogma] | K1 1 / K2 5 |
| held_coverage_gap[normal+gogma] | unreached 1 |
| held_coverage_gap[normal+skill] | unreached 1 |
| blocked[gogma] + held_gap[gogma] | K1 1 |
| blocked[gogma] + held_gap[skill] | K1 2 / K2 1 |
| blocked[skill] + held_gap[normal] | K2 1 |

読み取り:

- **blocked問題は別のfixed winnerでほぼ解消する**（blocked only 8件中6件がK1、1件がK2）。B2-Aのwinnerのcurrent Routeが
  oracle Routeのown positionをblockしていただけで、blockしない別のcurrent Routeが同じheldを提供できた。
- **Gogma単独のheld gapはK1で解消**（7 / 7）。**Skill + Gogmaの両stream held gapは多くがK2を要する**（6件中5件）:
  1本のcurrent RouteではSkill前方とGogma前方の両方をholdできず、2本のunionで足りる。
- **Normal前方heldを要するRouteの扱いが分かれる**: `held_gap[normal+…]` 2件はunreached、`blocked[skill]+held_gap[normal]` 1件はK2。

### 8.3 extent（reservationとは別軸）

| context gap 40件 | default extent内 | extent不足 |
| --- | ---: | ---: |
| K1で回収（28） | 18 | 10 |
| K2で回収（9） | 0 | 9 |
| unreached（3） | 0 | 3 |

回収37件: default extent内 **18** / extent不足 **19**（Skill 19・Normal 3・Gogma 0、重複あり）。全43件では回収40件中
default extent内20 / 不足20。K2でしか回収できない9件はすべてSkill extent不足でもある（Skill lane（existing Gogmaの
Reset Skills 6件、new Normalのconversion以降3件）の必要Skill extentが55〜552で、default `maxSkillAdvance = 4` を大きく超える。
2件はNormalも不足）。

### 8.4 固定集合の多様性（診断）

K1回収28件のcompatible K1 context数は1〜36（8件は1つだけ）。K2回収9件のcompatible K2 context数は1〜66。
代表contextは「minimal cardinalityのcompatible contextのうちreservation group順で最初」の決定的選択で、表示用であり
semantic rankingには使っていない。

## 9. unreached 3件（K≤2で到達しない）の必要条件解析

post-hocの緩和条件で「current Routeを何本固定しても届かないか」を調べた（どちらも到達性の必要条件。満たしても到達は証明しない）。

- **held union**: 全current Routeのheld和集合（blocked・exclusive無し）。ここに無いpositionはどのcurrent固定集合もholdしない。
- **non-blocking held union**（§18で追加）: T自身以外で、単独K1 reservationが **Tのown positionをblockせず、Tのsource OwnedWeaponを
  exclusiveにしない** current Routeだけのheld和集合。compatibleな固定集合はこの条件を満たすRouteだけから成る（固定集合の
  blocked / exclusiveは各memberのそれを含む）ため、ここで必要positionが欠ければ **K≥3でもcurrent Routeでは到達しない**。

| oracle Route | B2-A pattern | K≤2の最良context | held union欠落 | non-blocking member / 欠落 |
| --- | --- | --- | --- | --- |
| 2e26c0b1（new Normal・dual_blades、forge 470、Normal origin 349） | held_gap[normal+skill] | held_gap[normal] 64 | Normal 64 | 42 / Normal 64 |
| cbdf9d8f（new Normal・dual_blades、forge 413） | held_gap[normal+gogma] | blocked[skill] + held_gap[normal] 7 | Normal 7 | 41 / Normal 54 |
| 711f7d15（new Normal・charge_blade、Gogma 55..289連続、conversion Skill 399） | blocked[gogma] | blocked[gogma] 1 | 0 | **1** / Skill 58 |

`unreachedNonBlockingUnionMissesNeeded = 3`、`unreachedNonBlockingUnionCoversNeeded = 0`。

- 2e26c0b1 / cbdf9d8f: dual_blades Normal Counterの前方position（349から自分のforgeの手前まで）を、current Routeは一部しか
  forge（hold）しない。oracle Planでは他Targetのforgeがこの前方を進めている（B2-A support、provider 2+）。
- 711f7d15: Gogma 55..289の235 positionを自分で連続operateするため、current Routeのほぼ全て（41 / 42）がそのどこかに
  required unitを持ちblockになる。blockしない唯一のcurrent RouteはSkill前方341..398をholdしない。

したがってこの3件は **K3以上のcurrent Route固定では解消せず**、current Routeとは異なる他TargetのRoute（alternative Route）が
前方を進める支援 = alternative-to-alternative support / iterative context生成が必要である、というのが今回のevidenceの範囲内の結論。

## 10. oracle support（post-hoc説明のみ）

minimal compatible contextのalias 472件のうち、固定TargetにoracleのsupportTarget（required unit owner、または唯一 / 複数の
operator候補）を含むもの308件、全固定Targetがsupporterのもの234件。回収37件はいずれもminimal aliasのどれかにsupporterを含む。
ただしsupporter集合はRouteごとに8〜42 Targetと大きく（B2-Aのprovider数は全件2+）、この一致は「oracle providerを選んだ」ことの
証拠にはならない（固定集合はoracle非依存に全列挙している）。説明用の参考値にとどめる。

## 11. interpretation

current Route 0 / 1 / 2本固定で、B2-A context gap 40件のうち **37件をreservation-compatibleにできた**。

- B1 / B2-Aのcontext不足の大部分（28件）は **固定winnerの選び方** の問題だった。Conflict orientationのwinnerに限らず
  任意のcurrent Entry 1本を固定すれば、blocked問題もGogma単独のheld gapも解消する。
- 9件は **2本のcurrent Routeのheld union** を要する（主にSkill + Gogma両stream、1件はSkill blocked + Normal held）。
- 3件は **current Route自体ではheld supportが不足** しており、K3以上を足しても解消しない（§9の必要条件）。
  そのためK3以上のcurrent Route固定へ拡張するより、alternative Routeを含むsupport context生成が必要と判断する。
- extent不足はreservationと独立に19件残る（主にSkill）。reservation-compatibleでもdefault extentでは届かない。

## 12. 次Phaseの推奨（formal結果から）

1. **B2-B2（Search / extent validation）**: 回収37件について、minimal compatible contexts（K1 28件・K2 9件の各Targetで
   minimal cardinalityのcontext）だけを対象に実Searchを回し、oracle Candidate（またはcomparable Candidate）が実際にdeliverされるかを
   検証する。default extent内18件を先に、extent不足19件は別軸（Skill中心の局所extent拡張）で扱う。
   compatible context数が多いTarget（最大36 / 66）は、全context SearchではなくOracle非依存な優先順位付けが必要になる。
2. **residual 3件**: current Route固定では原理的に届かないため、Searchを先に回さず、他Targetのalternative Routeが前方
   （dual_blades Normal Counter前方 / Skill前方）を進めるsupport context（alternative-to-alternative / iterative global context）
   の設計研究へ進む。
3. 最終的な共存（43 Target Planへの採用）は将来のPlanner trial / global validationがauthorityであり、本Phaseの互換性は
   その前提条件にすぎない。

## 13. limitations

- compatibleは表現可能性のみ。Search delivery・Candidate順序・runtime・最終Plan採用は未検証。
- K2 validityは固定Entry同士のConflictのみで判定し、固定集合と探索対象Targetのalternative Routeとの共存はreservation
  （held / blocked / exclusive）以外では見ていない。
- §9の必要条件はheld欠落のみを使い、Normal held-prefix overlapとpairwise Conflictは考慮しない（満たしてもK≥3到達の証明ではない）。
- oracle support provider集合が大きく、support一致率は説明力が弱い。
- 単一Export・current Production・default extentのみ。

## 14. 事前登録したdecision rule（初回formal snapshot前に `3b5dac2` でcommit、以後無変更）

1. **B2B1_INVALID**: B2-A authority mismatch、Export / oracle / manifest mismatch、initial context未ready、Targetごとのcurrent Entryが1件でない、
   snapshot整合（列挙・validity・alias分割・context・計算側check）失敗、origin parity不一致、B2-A K1 context / reachability / extent parity不一致、
   B2-A probe gap RouteがK1 compatible + extent不足として再現しない、covered RouteにK≤1 compatible contextが無い、primitive判定と分解の不一致、
   Production limit walkとextent判定の不一致、search-eligible context gapが0件。
2. **B2B1_ALL_ELIGIBLE_RECOVERED**: search-eligible context gap（B2-A context gap − checkpoint hard constraint）の全件がK0 / K1 / K2のどれかでcompatible。
3. **B2B1_PARTIAL_ELIGIBLE_RECOVERY**: 1件以上compatible、1件以上unreached。
4. **B2B1_NO_ELIGIBLE_RECOVERY**: 1件もcompatibleにならない。

回収はreservation compatibilityのみで判定し、extentは別軸で報告する。

## 15. 変更ファイル

| file | 内容 |
| --- | --- |
| `src/benchmarks/plannerGlobalPhase2C26B2B1.ts` | 計算: initial context、Target ↔ current Entry、K0 / K1 / K2列挙、validity、Production reservation、reservation group、Target context。oracle / B2-A RESULTを読まない |
| `src/benchmarks/plannerGlobalPhase2C26B2B1Analysis.ts` | post-hoc: B2-A authority parser、snapshot整合、B2-A K1 / reachability parity、oracle reachability（B2-A helper再利用）、held union / non-blocking held union、集計、decision |
| `src/benchmarks/plannerGlobalPhase2C26B2B1.test.ts` | 14 tests |
| `scripts/run-planner-global-phase2c26b2b1.mjs` | snapshot runner（Exportのみ読む） |
| `scripts/analyze-planner-global-phase2c26b2b1.mjs` | post-hoc analyzer（B2-A RESULT・oracle RESULT・manifestを読む） |
| `docs/PLANNER_GLOBAL_PHASE2C26B2B1_RESULT.json` | formal RESULT |
| `docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_PHASE2C26B2B1.md` | 本文書 |

Production source（`src/domain` / `src/services` / `src/workers` / UI / db）の変更なし。新しいProduction seamも無い。ProductionからB2-B1 moduleを
importしない（testで確認）。

## 16. 検証

- focused: `npx vitest run src/benchmarks/plannerGlobalPhase2C26B2B1.test.ts`（14 pass）、既存の `plannerGlobalPhase2C26B2A.test.ts` /
  oracle隔離test `plannerGlobalOracle1657.test.ts` / `plannerGlobalLowerBound.test.ts`
- `npm run lint`、`npx tsc -b --force`、`npm test`、`npm run build`、`git diff --check`

## 17. 再現

```bash
node --max-old-space-size=8192 scripts/run-planner-global-phase2c26b2b1.mjs --export <gogma-artian-planner-backup_20260927015837.json> --output .local/PLANNER_GLOBAL_PHASE2C26B2B1_RAW.json.local
```

```bash
node scripts/analyze-planner-global-phase2c26b2b1.mjs --snapshot .local/PLANNER_GLOBAL_PHASE2C26B2B1_RAW.json.local --b2a-result docs/PLANNER_GLOBAL_PHASE2C26B2A_RESULT.json --oracle docs/PLANNER_GLOBAL_1657_ORACLE_RESULT.json --manifest src/benchmarks/plannerGlobalOracle1657Manifest.ts --output docs/PLANNER_GLOBAL_PHASE2C26B2B1_RESULT.json
```

raw snapshot（`.local/`、Git管理外、SHA-256 `2e0a8620be3862fa1c682b3dc233713ab9a50400df8e76c79391e555deff4986`）: 約3.7秒
（Node / Vite SSR、AMD Ryzen 7 9700X）。

## 18. formal測定の経緯（再測定）

1. `3b5dac2`（計算module・runner・analyzer・事前登録decision rule・testsのclean HEAD）で初回formal snapshotを取得し
   （raw SHA-256 `33cdc674…eb811d`）、formal RESULTを生成した。
2. その結果、unreached 3件のうち711f7d15が「全current Routeのheld unionでは必要positionを覆える」（K≥3の余地が残る）と出たため、
   より強い必要条件として **non-blocking held union**（§9）をpost-hoc解析だけに追加した（`9f22764`）。計算module・runner・
   decision ruleは無変更。
3. commit前の編集でB2-B1のsource 5 fileにCRLF改行が混入していたため、内容を変えずLFへ正規化した（`b7d04bb`、
   `git diff --ignore-cr-at-eol` で差分0）。計算moduleの改行も変わり `calculationCodeChangedSinceMeasuredHead` が空でなくなるため、
   このHEADでformal snapshotを **再測定** した。
4. 再測定のsnapshot本体（`snapshot`・CalculationContext・Research maxPlanSteps）は初回と **完全一致**（benchmark code SHA-256のみ
   `05a8d9ff…` → `99d0542d…`）。同じanalyzerで初回rawを再解析した結果とも、`analyzedAt`・`sources`・`provenance` 以外の全fieldが一致した。
   docsのRESULTは再測定（measured = analysis = `b7d04bb`、`formal = true`）のものである。
