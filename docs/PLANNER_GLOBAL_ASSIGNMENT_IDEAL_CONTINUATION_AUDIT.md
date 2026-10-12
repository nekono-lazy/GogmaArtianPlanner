# Global Assignment D-0B準備監査（Ideal到達後のSkill / Bonus操作とGlobal Assignmentの完全性）

Refs #154。**docs-only**（設計監査）。基準main: PR #244 merged `eb1c29942e437b0b9f37c862c6fa6302c7de804d`
（作業開始時に `main` / `origin/main` / HEADの一致、Working Tree clean、stash / 追加worktreeなしを確認）。
branch: `research/global-assignment-ideal-continuation-audit`。

本書は、Skill / 復元ボーナスがIdeal条件を満たした後もゲーム上は操作を継続できるという直接観測（§1）と、Production Search・
Global Assignment Phase A〜D-0Aの候補列挙方針との整合を監査し、Phase D-0B / D-0Cの前に必要な設計判断を整理する。
要約と設計書側の参照点は [Global Assignment設計](PLANNER_GLOBAL_ASSIGNMENT_DESIGN.md)（以下「設計」）§19 にある。

Production（Search / Planner / RNG / Worker / UI / Persistence / schema / version）、Research実装（Phase A〜D-0A、runner）、test、
計測コード、既存formal RESULTは変更していない。Search実行・実Export run・計測も行っていない（Production changed files = `[]`）。
本書のコード上の事実は、すべて基準mainのsource・testを読んで確認したものである（§2 / §3。行番号は基準mainのもの）。
ただし §3.3 のG3だけはコード読取からの推定で、testで固定していない（§9.3で固定を計画する）。

## 0. 位置づけとauthority

正式仕様の順位は `AGENTS.md` のとおり `docs/REQUIREMENTS.md` → タスク別の詳細仕様（本監査では `docs/SEARCH_SPEC.md` 5.5 / 5.6 / 5.8、
`docs/PLANNER_SPEC.md` 4 / 7.0 / 9.2.5 / 9.2.19 / 16.3）→ その他正式文書 → 実装 → test → Research文書である。本書はResearch記録であり、
正式仕様でもDomain仕様でもない。本書は正式仕様の契約を変更せず、変更が必要になり得る箇所は §10 に候補として列挙するだけである。

設計の §5（Phase A）、§6（Phase B）、§8（Phase C、特に §8.6 の被覆補題）、§9（Phase D、特に §9.0 / §9.6 / §9.9）、§10.3（window移行）、
§14（Phase分割）と、[Phase 2-C2.7-A](PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_PHASE2C27A.md) のguardrail G1〜G12に従う。

表記: 本書の節は §1〜§12 である。設計書の節は原則「設計 §n」と書く。§9.1〜§9.3は本書にも設計書にもあるので、接頭辞の無い §9.1〜§9.3は
本書の節を指す。本書に存在しない番号（§8.3 / §8.6 / §9.4 / §9.6 / §10.3 など）を「§n」とだけ書いた箇所は設計書の節を指す。

本書の対象Exportでの発生頻度（43 planning Targetの実Exportで当該ケースが現れるか）は調べていない。発生頻度と設計上の対応要否は切り離し、
入力に依存しない一般論として扱う（§7.5 / §9）。

## 1. 今回確認されたゲーム挙動と、その意味の範囲

### 1.1 直接観測（2026-10-12、プロジェクトオーナー確認）

**Skill**

- ゲームにはアプリ上の「Ideal Skill」という概念は無い。Ideal Skillはユーザーが登録した目標条件である
- 巨戟化時点でIdeal SkillになってもReset Skillsを続けられる
- Reset SkillsでIdealになった後も、さらにReset Skillsを続けられる
- 後続のSkill Counter位置で再びIdealになる場合もある
- ユーザーが通常そこで操作を終えるのは目的を達成したと判断したためであり、ゲーム上の制限ではない

**復元ボーナス**

- ゲームにはアプリ上の「Ideal Bonus」という概念は無い。Ideal Bonusはユーザーが登録した目標条件である
- 巨戟化済みであれば、復元ボーナスがIdealになった後もReset / Keepを続けられる
- ResetでIdealになった後にさらにReset / Keepでき、KeepでIdealになった後もさらにReset / Keepできる
- 後続の復元ボーナスカウンター位置で再びIdealになる場合もある
- Ideal到達は操作を禁止する条件ではない

### 1.2 この観測が意味しないこと

この観測は「Idealは操作の終了条件ではない」ことだけを述べる。任意の状態からあらゆる操作が無条件に可能になったわけではなく、
次の既存のゲーム・Domain制約はそのまま維持する。

| 制約 | authority | 本監査での扱い |
| --- | --- | --- |
| 保護武器はReset Bonuses / Keep Bonuses / Reset Skillsの対象にしない | REQUIREMENTS 21、`AGENTS.md` Owned Weapon Rules | 維持。保護中の所持巨戟は現在性能が両軸Idealのときの操作0 optionだけ（設計 §5.2） |
| Keep Bonusesは現在5枠のfamily layoutを保ってtierだけ再抽選し、slot選択は無い | RNG_SPEC 6.1、`AGENTS.md` RNG Rules | 維持 |
| Keepの予測可否（Production family availability外のfamilyを含む入力、Engine support） | `getPredictionSupport()`、SEARCH_SPEC 5.9 | 維持。supportの無いlayoutからKeep optionを作らない（ReachTableの `keepSupported` / `keepUnsupportedLayouts`） |
| normal scopeの5枠はラベルが一致してもBonus Idealではない | SEARCH_SPEC 5.1 / 5.6.1、`satisfiesIdealBonuses()` | 維持。巨戟化Routeのlane開始Bonusは常に非Ideal（§2.2） |
| blind Normalの5枠は未知で、最初のResetより前にKeepしない | SEARCH_SPEC 6.1.1 | 維持（Global Assignmentはそもそもblind variantをoptionにしない。設計 §5.2） |
| 各操作のCounter進行（Reset Skills: Skill +1、Reset / Keep: Gogma +1、巨戟化: Skill +1） | `AGENTS.md` RNG Rules | 変更なし。Ideal後の操作も同じ進行である |
| 予測capability・確定Counter | `AGENTS.md` Partial RNG State and Capabilities | 維持 |

新しいRNG挙動は何も追加されない。Ideal後の操作の結果は、これまでどおりProduction RNG Engineの予測そのものである。

### 1.3 4つの層の区別

SEARCH_SPEC 5.9（normal scope Keepのgame legality / prediction support / Product挙動）と同じ考え方で、層を分けて扱う。

| 層 | 内容 | 結論 |
| --- | --- | --- |
| L1 ゲーム操作の可否 | Ideal到達後にReset Skills / Reset / Keepを続けられるか | **続けられる**（§1.1の直接観測） |
| L2 正式Domainでの表現 | そのRouteを `BuildRoute` / `RouteOperation`・Candidate・Entry・Plannerで表現・検証できるか | **表現できる**（§2.4の8。Route validation、Candidate factory、Planner unit semanticsのいずれもIdealを操作の終了条件にしていない。SEARCH_SPEC 5.8.1は `match = "ideal"` の途中位置を明示的に許容する） |
| L3 Search policy | Production Searchがそのrouteを列挙するか | **lane開始状態がIdealならそのlaneを開かない**（§2）。単一Targetの品質を根拠とする探索policyであり、L1 / L2の制約ではない。ただしSEARCH_SPEC 5.6.1 / 5.6.8に明記された正式な契約である |
| L4 Global Assignmentのoption集合 | Phase Aがどの必要条件をoptionにするか | Research設計。本書で監査する（§3） |

設計原則として、**L1 / L2で合法なRouteを、L3のpolicyだけを理由にL4から排除しない**。逆に、L3を変更してL4へ合わせることも、
正式仕様の変更を経ずには行わない（§7）。

### 1.4 正式仕様との関係

正式文書のどこにも「Ideal到達後の操作は禁止される」というゲーム規則は書かれていない。関連する記述は次のとおりで、いずれもSearch policyである。

- SEARCH_SPEC 5.6.1「現在状態別の探索継続規則」: 現在状態がIdeal条件を満たすstreamは「不要。探索を終了してよい」。根拠は
  Ideal ⇒ Practical包含により「そのstreamについて将来探索で得られるより良い状態は存在しない」こと（単一Targetの品質）
- SEARCH_SPEC 5.6.8「探索の継続」: Planner Alternative Searchでも「lane開始状態（操作0の解）がすでにIdealなら、同じIdealを後方位置で
  再取得するためだけの後続operationは要求しない（そのlaneのstreamは開かない。5.6.1と同じ）」と明示する
- PLANNER_SPEC 9.2.5: Planner再検索で永久除外にしてはならない初回Search pruningを列挙するが、5.6.1のlane開始Ideal規則は含まれない
  （含まれるのはcanonical Ideal終了、同一結果retention、Practical dominance、horizon、Cross-only）
- `AGENTS.md` Candidate Search Stream Separation: 「現在SkillがIdeal Skill条件を満たすならReset Skillsを探索しない」「現在Bonusが
  gogma_artian scopeでIdealならBonus amendmentを探索しない」

したがって今回の直接観測は正式仕様と矛盾しない。矛盾ではなく、「Search policyが列挙しないRoute形がGlobal Assignmentでは必要になり得るか」が
監査の対象である。L1の直接観測を正式文書へ記録するかどうかはオーナー判断とし、候補を §10 に挙げる。

## 2. 監査A: Production Searchの早期Ideal終了

### 2.1 該当箇所と正確な条件

早期終了は `TargetSearchScheduler.addBase()`（`src/domain/search/targetSearchScheduler.ts:272-296`）の2条件である。

```ts
const bonus = base.zeroBonus === null ? null : buildBonusSolutionSet(target, input, [base.zeroBonus])[0]
const skill = buildSkillSolutionSet(target, [base.zeroSkill])[0]
if (bonus) cross.addBonus(bonus)
cross.addSkill(skill)
if (!skill.idealMatch && base.startSkillCounter !== null) {   // Skill channelを購読するのは操作0のSkillが非Idealのときだけ
  ...
}
if (!bonus?.idealMatch && base.bonusBase !== null) {          // Bonus channelを購読するのは操作0のBonusが非Idealのときだけ
  ...
}
```

- 判定対象は **Route baseの操作0の解（lane開始状態）だけ** である。`skill.idealMatch` は `evaluateSkillCondition()`、`bonus.idealMatch` は
  `satisfiesIdealBonuses()`（`gogma_artian` scope必須）で決まる（`streamSolutions.ts:120` / `:144`）
- 条件が真のとき、そのRoute baseはそのlaneのstream channelを購読しない。そのlaneの軸は操作0の解1件だけになり、Cross / Lazy Ideal Crossは
  「操作0 × 他laneのIdeal解」だけを合成する
- streamそのもの（`TargetSkillStream` / `TargetBonusStream`）はIdealで止まらない。購読しないのはschedulerである。
  したがって同じstreamを購読した **別の** Route base（lane開始が非Ideal）からは、Ideal位置の後方まで解が読まれる
- `zeroBonus === null`（blind Normal）は操作0のBonus解が無いので、Bonus channelは常に購読される（`bonusBase` 必須）

### 2.2 Route base別のlane開始状態

| Route base | Skill lane開始（k = 0） | Bonus lane開始（d = 0） | 早期終了が起こり得るlane |
| --- | --- | --- | --- |
| 新規Normal（predicted）、巨戟化位置 c | 巨戟化がSkill Counter c で付与するSkill | 継承したnormal scope 5枠（常に非Ideal） | Skillだけ |
| 新規Normal（blind、6.1.1） | 同上 | なし（`zeroBonus = null`） | Skillだけ（Global Assignmentは使わない） |
| 所持通常アーティア | 同上 | 継承したnormal scope 5枠（常に非Ideal） | Skillだけ |
| 所持巨戟 | 現在のSeries / Group Skill | 現在の5枠・scope（`gogma_artian` のときだけIdealになり得る） | Skill / Bonusの両方 |

Planner Alternative Searchでは、held位置を跨ぐ巨戟化位置ごとに別のRoute baseが登録される（`conversionSkillPositions()`、
`routeSearchShared.ts:188-201`）。早期終了は巨戟化位置ごとに判定され、Skillが非Idealの巨戟化位置からはReset Skills channelが開く。

### 2.3 適用範囲（3つのSearch consumer）

| consumer | lane開始Idealのlane | lane途中でIdealに到達した後の継続 |
| --- | --- | --- |
| 通常Candidate Search（`frontierPolicy = 'initial_candidate_search'`） | 開かない（`addBase()`） | streamは続くが、canonical Idealのcost層を閉じた時点でSearch全体が終わり（5.6.2）、同一結果は最初の位置だけ保持する（5.5.2 / 5.5.3）。後方のIdeal位置は返らない（初回Search policy、5.6.4で永久除外ではないと明記） |
| Planner Alternative Search（`'planner_alternative'`） | 開かない（同じ `addBase()`、5.6.8で明示） | **続く**。held-aware streamは各absolute positionを独立に生成・Ideal判定し、Idealな位置をすべてcompositionへ公開する（5.6.8） |
| constrained enumerator（5.6.7。Phase 6-B2b以降はSearch Domainのbenchmark / testだけ） | 開かない（`constrainedRouteBases.ts:141-142` / `:280-284` の `skillsSatisfyIdeal` / `bonusesSatisfyIdeal`） | 対象外（本監査では使わない） |

この規則は次のProduction testで固定されている: `skillStreamIndependence.test.ts`（308 / 341 / 433 / 457行）、`bonusStreamIndependence.test.ts:566`、
`candidateComposition.test.ts`（396 / 425行）、`candidateTermination.test.ts:301`、`intermediateStateExtraction.test.ts:68`、
`alternative/plannerAlternativeReservation.test.ts:434`（Planner Alternative Search）。

### 2.4 確認事項ごとの結論

1. **適用範囲**: lane開始状態（Route baseの操作0の解）がIdealのときだけ、そのRoute baseのそのlaneを開かない。lane途中のIdealでは止めない。
   判定はRoute baseごと（Planner Alternative Searchでは巨戟化位置ごと）
2. **通常SearchとPlanner Alternative Searchへの影響**: lane開始Ideal規則は両方に同じく効く。違いはlane途中の継続だけで、通常Searchは
   canonical Ideal終了と同一結果retentionで後方のIdeal位置を返さず、Planner Alternative Searchは返す
3. **Ideal到達後に後続のIdealを列挙できないケース**: Planner Alternative Searchで列挙できないのは「lane開始状態がIdealで、そのlaneにさらに
   操作を置くRoute」だけである。具体的には §4 のS1（巨戟化SkillがIdeal → Reset Skills）、S2（所持巨戟の現在SkillがIdeal → Reset Skills）、
   B1 / B2（所持巨戟の現在BonusがIdeal → Reset / Keep）。lane途中でIdealに達した後の継続（S3、B3〜B5）は列挙される
4. **片方だけIdeal**: もう片方のlaneは独立に探索される（5.6.1補足）。合成は「Ideal側laneの操作0 × 他laneのIdeal解」
5. **両方が最初からIdeal**: 所持巨戟だけが該当し得る（巨戟化Routeのlane開始Bonusはnormal scopeで常に非Ideal）。そのRoute baseの合成は
   操作0 × 操作0（`existing_gogma_current`、`operations = []`）だけになる
6. **操作0 Idealの扱い**: Searchは上記5のとおり。Production Plannerは、planning Targetの理想条件を現在性能で満たす所持巨戟が在庫にあれば
   Planner開始時にそのTargetを `hasIdeal` とし（`deriveTargetSatisfaction()`、`plannerInitialState.ts:62-66`）、その時点ではそのTargetのEntryを
   relevantでなくする（`entryIsRelevantForState()`、`plannerEntryRelevance.ts:30`）。ただしこれは **開始時点の状態** であり、恒久的な完成ではない。
   他のRouteがその武器を操作するとin-flightになって充足が再評価され、Entryが再commitされ得る（§3.6）。Build Listに含まれた
   `existing_gogma_current` Entryには、Counterを進めない `confirm_owned_ideal` Stepで完成を確定する（PLANNER_SPEC 16.3）。
   Global Assignmentへの含意は §3.3 のG4と §3.6
7. **一時的に非Idealになり再びIdealになるケース**: lane途中であれば、Skill streamは位置ごとの予測で、Bonus streamは
   （depth、最後のown operation位置、family layout）ごとのfrontierで続くので、Planner Alternative Searchは両方のIdeal位置を独立した解として
   公開する。lane開始がIdealの場合（Ideal → 非Ideal → Ideal）は、上記3の理由で列挙されない
8. **policyかDomain制約か**: 次の根拠から **Search policyである**（Domain制約・ゲーム規則ではない）。ただし正式仕様（SEARCH_SPEC 5.6.1 / 5.6.8、
   `AGENTS.md`）に書かれた契約であり、Production Searchで変えるには正式仕様の変更が要る

| 観点 | 根拠 | 結論 |
| --- | --- | --- |
| 正式仕様の文言 | 5.6.1「探索を終了してよい」、根拠は単一Targetの品質（より良い状態が無い）。5.6.8「同じIdealを後方位置で再取得するためだけの後続operationは要求しない」 | 探索の省略を許す規則であって、操作の禁止ではない |
| Route validation | `validateBuildRoute()`（`src/domain/models/validation.ts`）にIdeal判定は無い | Ideal後の操作を含むRouteは構造上valid |
| Candidate factory | `createCandidateFromPrediction()` / `createConstrainedCandidate()` は **最終状態** だけを `satisfiesIdealTarget()` で判定する | 途中のIdeal状態を拒否しない |
| Planner unit semantics | PLANNER_SPEC 7.0.2のskip表（`canSkipWhenCounterPassed`）はIdealを条件にしない | Reset Skills連鎖・Reset / Keep連鎖はIdealを通過しても同じ規則でrequired / skippableになる |
| Planner充足判定 | 既存sourceは操作開始で `inFlightExistingSourceByOwnedWeaponId` に入り充足判定から除かれ（`plannerStateTransitions.ts:791-797` / `:234-246`）、新規武器は `reserve_weapon` まで在庫に無い。完成はEntryの最後の物理unitの直後の `reserve_weapon` だけ | Route途中のIdeal状態でTargetが早期完成しない |
| intermediate state | SEARCH_SPEC 5.8.1が `match = "ideal"` の途中位置を許容（constrained由来の後続位置Candidateのため） | Domainのintermediate表現もIdeal通過を許す |
| 性能上の役割 | lane開始IdealのRoute baseにchannelを購読させないことで、Skill held-aware streamの保持（D2-G-Aで主要なメモリ要因と特定）とcomposition pair数を抑える | 探索量のpolicy |

### 2.5 監査Aの結論

- 早期Ideal終了は **lane開始状態がIdealのRoute base** に限られ、SkillとBonusの両軸にある（Bonusは所持巨戟でだけ発生）
- 通常SearchとPlanner Alternative Searchの両方に効く正式なSearch policyであり、ゲーム規則でもDomain制約でもない（L1 / L2では表現可能）
- lane途中でIdealに到達した後の継続は、Planner Alternative Searchが列挙する（Global AssignmentのPhase D主方式で取得できる）
- Production Searchでこの規則を変えることは、SEARCH_SPEC 5.6.1 / 5.6.8・`AGENTS.md` Search規則・固定済みProduction testの変更と、
  what-if / repairの出力変化による計算版数境界を伴う（§7.1）

## 3. 監査B: Phase AのReachOption生成と4つの集合

### 3.1 Phase Aの現行規則（コード確認）

| source | Skill要件 | Bonus要件 | コード |
| --- | --- | --- | --- |
| 所持巨戟、現在SkillがIdeal | `none` **だけ** | 下記 | `skillRequirementBlocks()`（`reachOptions.ts:41-47`） |
| 所持巨戟、現在Skillが非Ideal | `reset_skills` s*（Ideal位置すべて、`resetSkillsLimit` 以下。途中のIdeal位置より後方も含む） | 下記 | 同上 |
| 所持巨戟、現在Bonusが `gogma_artian` でIdeal | — | `none` **だけ** | `bonusRequirementIsNone()`（`reachOptions.ts:210-213`） |
| 所持巨戟（上記以外）、所持通常、新規Normal | — | `reset` g*（Ideal位置すべて）、`keep_from_source` g*（source layoutのKeep-Ideal位置、`keepSupported` のとき）、`reset_then_keep` (g1, g*)（g1 < g*、layout(Reset(g1))がg*でKeep-Ideal） | `bonusRequirements()`（`reachOptions.ts:215-220`） |
| 所持通常、新規Normal | `conversion` (c, s*): s* ∈ Ideal位置（`conversionLimit` 以下）、c ∈ [origin, s*]。**cのSkillがIdealかどうかを見ない** | 上記 | `skillRequirements()`（`reachOptions.ts:49-66`） |
| 保護中の所持巨戟 | 現在性能が両軸Idealのときだけsource（`none / none`）。それ以外はsourceにしない | — | `classifyOwnedSource()`（`reachTable.ts:110-122`） |

この規則は以後のPhaseで **検証済みの不変条件** になっている。Phase C-1の `validateOption()`（`coverage.ts:114-134`）は、所持巨戟の
Skill要件を「現在SkillがIdealなら `none`、非Idealなら `reset_skills`」、Bonus要件を「`none` ⇔ 現在BonusがIdeal」として検査し、違反を
`invalid_option` で拒否する。D-0Aの `materializeStructuralCandidate()` は候補を `buildStructuralCandidate()` で再導出するので、同じ検査を通る。
Phase B-1の値順序lattice（`indexedSkillRequirements()` / `indexedBonusStreams()`、`assignmentOrdering.ts:54-102`）と下界menu
（`createTargetStreamMenu()`、`assignmentLowerBound.ts:53-67`）も同じ `skillRequirementBlocks()` / `bonusRequirementIsNone()` を読む。

### 3.2 4つの集合

1 planning Target t について、次の集合を区別する（windowは固定）。

| 記号 | 定義 |
| --- | --- |
| **G**(t) | L1で合法かつL2で表現可能なRouteの集合。source（未保護。操作0なら保護中も可）から、Production RNGが予測可能な操作だけで構成され、`BuildRoute` の絶対位置で表現でき、最終状態がtのIdealを満たすRoute。**途中状態はIdealでも非Idealでもよい** |
| π(R) | Route Rの「option射影」: source と、`createPlannerRouteUnitPlans()` が `canSkipWhenCounterPassed = false` とするunitのstream別位置（required位置）。Phase AのReachOptionと同じ形である |
| **A**(t) | Phase Aが列挙するReachOptionの集合（§3.1） |
| **S**(t, ρ, e) | reservation ρ・extent e・配送無制限でPlanner Alternative Searchが返すRouteの集合。π(**S**) はそのoption射影 |
| **M**(K) | structural candidate K について、D-0Aがmaterializeできる（ρはK内で先にmaterializeしたEntryから導出、delivery cap・gate・extent内で、required位置が一致するCandidateが配送される）Targetの集合 |

包含関係は **M** ⊆（π(**S**) ∩ **A** に一致するoptionを持つTarget）、**A** ⊆ π(**G**) である。L1 / L2で合法でも **A** に無いoption、
**A** にあっても π(**S**) に無いoptionが「欠落」である。

### 3.3 集合間の欠落

| ID | 欠落 | 該当するoption（§4のケース） | 原因の層 | 現状の帰結 |
| --- | --- | --- | --- | --- |
| **G1** | **A** にあるが π(**S**) に無い | `conversion` (c, s*)、c < s*、c ∈ `skill.idealPositions`（S1） | L3（巨戟化SkillがIdealのRoute baseにReset Skills channelを購読させない） | Phase B / Cは生成し得る（設計 §8.6の補題が下げる c がIdeal位置に当たる場合を含む）。D-0Aは設計 §9.2 → §9.1 と試し、実際には `unconfirmed(stopped_by_extent)` になる（D-0A synthetic testで固定、`materialize.test.ts:339`）。ただしこの分類は当該形と無関係な要因で決まる: Bonus streamがextent外へ届けば `stopped_by_extent`、cap到達なら `delivery_cap_reached`、Searchが `exhausted` で終われば `shape_mismatch`（= `materialization_failed`）。いずれも「Search policyが返さない形」を正しく表さない |
| **G2** | π(**G**) にあるが **A** に無い | 所持巨戟の現在SkillがIdealで `reset_skills` s*（S2）、現在Bonusが `gogma_artian` Idealで `reset` / `keep_from_source` / `reset_then_keep`（B1 / B2） | L4（Phase Aの規則。L3にも無い） | 生成されない。C-1 `validateOption()` が拒否するので、外から与えても通らない |
| **G3** | **A** にあるが、ある ρ では π(**S**(ρ)) に無い（Ideal非依存） | `keep_from_source` g*、`reset_then_keep` (g1, g*) のうち、自分の操作範囲（最初の操作位置〜g*）にheldでないReset位置 q（`reset_then_keep` では g1 < q）があり、layout(Reset(q))がchainのlayoutと一致するもの（B2 / B4 / B5の一部） | L3（Bonus streamのB2 family-layout frontierが同じ（depth、位置、layout）のstateを1つにまとめ、`lastResetDepth` 最大＝最新のResetを代表に選ぶ。`bonusStream.ts:336-344` / `:711-716` / `:800-811`） | Searchは同じ最終武器を、required位置 {q, g*} のRoute（Reset q → Keep連鎖）として返す。D-0Aはrequired位置の完全一致で照合するので不一致になる。`AGENTS.md` が「Bonus reachabilityについてだけlossless。route-historyの多様性を1つの代表へ畳む既知のPlanner limitation」と明記する性質の帰結である。**コード読取からの推定で、testで固定していない** |
| **G4** | **A** にあるが、Production Plannerが割当どおりに実行するかが **Plannerの状態遷移に依存する** | planning Target t が、現在性能でtのIdealを満たす所持巨戟（以下「Ideal武器」）をPlanner開始時に持つ場合の、tのoptionのうち「Ideal武器の `none / none`」以外のもの | Planner semantics。開始時にtは `hasIdeal` でEntryはcommitされないが、他のRouteがIdeal武器を操作してin-flightにすると充足が再評価され、tのEntryは再commitされ得る（ISSUE_103設計 6.8、§3.6） | 結果は §3.6の場合分けに従う。Ideal武器が最終入力のどのRouteにも操作されない場合（G4-i）と、tのoptionがt自身の両軸Ideal sourceを操作する場合（G4-iii）は、コード上tのEntryがcommitされない。Ideal武器が他Targetのsourceになる場合（G4-ii）は、そのRouteの実行時点とtのRouteの位置に依存し、Phase D'でしか決まらない。設計 §15.1の「複数Target同一武器のゼロ操作option」はcross satisfactionの場合だけを扱っており、この帰結は未記載 |

G1 / G2 / G3はmaterializationの欠落、G4はPlanner検証時の状態遷移に依存する欠落（成立しない場合がある）である。G3 / G4はIdeal到達後の操作継続とは
独立の既存性質だが、集合間の欠落として本監査で初めて明示したので併記する。

### 3.4 ReachTableの情報量（G2への対応に新しい予測は要らない）

G2のoptionを列挙するのに、ReachTableへの追加の予測・追加のfieldは要らない。

- `skill.idealPositions`、`bonus.resetIdealPositions`、`reset_then_keep` のcompact index（`createResetThenKeepIndex()`）はTarget単位の配列で、
  sourceに依存しない
- 所持巨戟のlayoutは、現在BonusがIdealのものも含めて「関心layout」として走査済みである（`reachTable.ts` の `interestInputs`: 所持武器の
  layoutは種別・属性・保護条件を通ればIdeal multisetの順列である限り追加され、`keepIdealPositionsByLayout` が計算される）

したがってG2への対応（§7のA-2）は列挙規則の変更だけであり、Phase Aの走査・予測回数・`ReachScanSummary` は変わらない。

### 3.5 欠落ではないもの（lane途中のIdeal）

所持巨戟の現在Skillが非Idealの `reset_skills` s*、巨戟化の `conversion` (c, s*)（cのSkillが非Ideal）、`reset` g*、`keep_from_source` g*、
`reset_then_keep` (g1, g*) は、いずれも途中のIdeal位置より後方のs* / g*を含む（Phase Aは最初のIdeal位置に限定していない）。途中のIdeal位置は
skippable chainの内部にあり、optionのrequired位置に入らない。Planner Alternative Searchもlane途中のIdealで止まらないので、これらは
G3の条件に当たらない限り **A**、π(**S**)、**M** のすべてにある。射影起点Candidate Search（設計 §9.2）はcanonical Ideal＝射影起点からの
最初のIdealを返すので後方のs* / g*とは一致しないが、それは設計どおり（設計 §9.1 へ切り替える）方式の限界である。

### 3.6 G4の状態遷移（コード確認）

開始時点の `hasIdeal` は恒久的な完成ではない。現行Production Planner（決定的scheduler）では次のとおり状態遷移する。

1. **開始時**: `createInitialPlannerSearchState()` がplanning Targetの充足を、在庫の全所持巨戟（保護中を含む。in-flightは空）から導出する
   （`plannerInitialState.ts:62-66`）。Route commitmentは開始時にrelevantでないEntryを `not_needed` とし、commitしない
   （`plannerRouteCommitment.ts:375-377`）
2. **充足の再評価**: 既存sourceを変更する操作（`reset_bonuses` / `keep_bonuses` / sourceを持つ `reset_skills`）の直後と、reserveの直後にだけ行い、
   in-flightの武器を除外して在庫から再導出する（`plannerStateTransitions.ts:234-246` / `:791-797` / `:883` / `:1101-1105`。PLANNER_SPEC 7.0.2内の
   「候補確保時の状態遷移」）。既存sourceは最初の変更からreserveまでin-flightである
3. **動的commitment更新**（`refreshCommitment()`、`plannerDeterministicScheduler.ts:373-423`、ISSUE_103設計 6.8）:
   - in-flight化でplanning Targetの `hasIdeal` がfalseへ戻ると、そのTargetの未commit（`not_needed` / `released`）Entryは、現在状態で実行可能
     （`plannerRouteCommitmentRejection()`: 未実行のholding unitの位置が現在のCounterより前でない、conflict resolutionで除外されていない等）かつ
     現在のcommitted集合とcollisionしなければcommitされる（`canCommitPlannerRoute()`）。既存のcommitted Entryは押し出さない
   - committed EntryのTargetが別Entryのreserveで `hasIdeal` になると、そのEntryは解放される（Route途中でも）
4. **完成判定**: checkpoint選択が無ければ `isPlannerTargetComplete()` は `hasIdeal` だけを見る（`plannerEntryRelevance.ts:40-48`）

planning Target t のIdeal武器（現在性能でtのIdealを満たす所持巨戟）の集合を W_t とすると、G4は次の3つに分かれる。

| 場合 | 条件 | 現行Plannerで起こること | Global Assignmentでの扱い |
| --- | --- | --- | --- |
| **G4-i** | W_t のどの武器も、structural candidateの最終入力のどのRouteのsourceでもない（構造的候補から静的に判定できる） | 下記の前提P2 / P3のもとでは、W_t は変更されずin-flightにもならないので、tは最後まで `hasIdeal`。tのEntryはcommitされず実行されない | tのEntryがselectedにならず、設計 §9.5の成立条件（selected = 全Entry）を満たさない見込み。tのchainに被覆を依存するRouteがあればstall、tのrequired位置がstream終端を決めていれば物理操作数 < objectiveになる見込み。**予測であり、D-0Bでは不成立に分類しない**（判定はPhase D'） |
| **G4-ii** | W_t のある武器 w が、別のplanning Target t′ のRouteのsourceである（C1によりsourceにできるのは1 Targetだけ。t′はtと同じ武器種・属性） | t′がwを最初に操作した時点でwがin-flightになり、tに他のin-flightでないIdeal武器が無ければ `hasIdeal = false` に戻る。その時点でtのEntryが実行可能かつcollisionなしならcommitされ、実行される。tのRouteのholding unitの位置がその時点で既に通過されていればcommitされない。t′のreserveでwの新しい状態がtのIdealも満たせば、tのcommitted Entryは解放される | 実行順に依存し、構造的候補からは決まらない。**Phase D'でだけ判定する** |
| **G4-iii** | tのoptionが、t自身の両軸Ideal source w を操作する（Skill側・Bonus側のどちらか、または両方の継続option。現行Phase Aは生成しない） | 下記の前提P1〜P3のもとでは、wを操作し得るRouteはtのRouteだけで、tは開始時に `hasIdeal` なのでそのEntryはcommitされない。wはin-flightにならずtは `hasIdeal` のままなので、最後までcommitされない | tの継続Routeは実行されない見込み（コード読取からの結論。testで未固定） |

G4-iiiの結論が依存する前提（G4-iはこのうちP2 / P3に依存する）:

- **P1**: 最終入力のvalidなEntryのうち、wをsourceにするのはtのEntryだけである（Global AssignmentのC1と、planning Target 1件につき生成Entry 1件という
  設計 §9.5の最終入力の構成。materializeできなかったTargetが残る候補はPhase D'へ進まない）
- **P2**: 所持巨戟の状態とin-flightを変えるのは、その武器をsourceとするRouteの操作と、そのRouteのreserveだけである（現行の状態遷移実装を読んだ範囲。
  他に所持巨戟を変えるPlanner操作は見当たらない）
- **P3**: 未commitのEntryがcommitされるのは、開始時のRoute commitmentと、`hasIdeal` がfalseへ戻ったときの動的commitだけである（ISSUE_103設計 6.8）

P1はGlobal Assignmentの最終入力の構成から、P2 / P3は現行Production Plannerの実装と設計から読み取ったものであり、test・証明で固定したものではない。
将来のPlanner変更（例: ISSUE_103設計 19.2で後回しにした静的なcross-satisfaction省略）があればP2 / P3は再確認が要る。

「対象Targetが開始時点でIdeal」と「そのTarget自身がIdeal sourceへ追加操作する」の区別:

- **対象Targetが開始時点でIdeal**（G4-i / G4-ii）: tのRouteが実行されるかは、Ideal武器が他のRouteに操作されるかと、その時点でのtのRouteの
  実行可能性に依存する。開始時点の `hasIdeal` だけでは決まらない
- **そのTarget自身がIdeal sourceへ追加操作する**: sourceが両軸IdealならG4-iii。sourceが片軸だけIdeal（S2型だけ、またはB1 / B2型だけ）なら、
  そのsourceはtのIdeal武器ではないので、そのsourceによってtが開始時に `hasIdeal` になることはなく、tのEntryは通常どおりcommitの対象になる。
  tが別に両軸Idealの武器も持つ場合は、G4-i / G4-iiに帰着する

A-2への含意: G4-iiiは「両軸Ideal sourceの継続optionを追加しない」根拠になり得るが、P1〜P3に依存するので、本監査では除外を確定事項にせず、
A-2でtest（§9.3）とともに判断する。D-0Bへの含意: D-0BはPlannerを実行しないので、G4-i / G4-ii / G4-iiiは場合分けを診断として記録するだけで、
候補を不成立・恒久除外に分類しない。

## 4. 監査C: 代表ケース

凡例: ○ = 表現・列挙・materializeできる、△ = 条件付き、× = できない、— = 該当しない。PA = Planner Alternative Search。
a = そのstreamの最初の自分の操作位置。「初回」はcanonical Idealで終わる通常Candidate Searchで、後方のIdeal位置を返さないのは初回Search policy
（SEARCH_SPEC 5.6.2 / 5.6.4）であり、Global Assignmentは設計 §9.1（PA）を主方式とするので欠落とは数えない。

| ケース | ゲーム上の合法性と既存条件 | Phase A | Production Search（初回 / PA） | D-0A | required位置 / skippable chain | 他Targetとの共有・排他への影響 | 汎用対応 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **S1** 巨戟化時にSkillがIdeal、その後Reset SkillsでIdeal | 合法。未保護の通常source、Skill予測support、確定Base Seed / Skill Counter。巨戟化とReset Skillsは同じ位置で同じSkillを引く（RNG_REFERENCE_AUDIT 14.18） | ○ `conversion` (c, s*)、c < s* | × / × | ×（G1） | required {c（巨戟化）, s*（最後のReset Skills）}、chain c+1 .. s*−1（Reset Skills→Reset Skills） | 同じsourceの `conversion` (c, c) よりrequired位置が1つ多く、Skill終端も後ろ（§5 L2） | 要: 分類の是正（D-0B）、materialization（案B） |
| **S2** 所持巨戟の現在SkillがIdeal、その後Reset SkillsでIdeal | 合法。未保護、Skill予測support | ×（`none` だけ。G2） | × / × | 対象外 | required {s*}、chain a .. s*−1 | `none` よりrequired位置が1つ多い（§5 L1） | 要: A-2で追加を判断（両軸Ideal sourceの扱いは §3.6のG4-iiiを踏まえてA-2で判断）、materializationは案B |
| **S3** Reset Skills途中でIdeal、さらにReset SkillsでIdeal | 合法 | ○ `reset_skills` s* / `conversion` (c, s*)（途中のIdealはchain内） | × / ○ | ○（設計 §9.2は不一致 → §9.1） | required {s*}（巨戟化は + c）、途中のIdeal位置 s1 はskippable chain | s1を他Targetのrequired位置に譲れる（C2はrequired位置だけが排他、chainは排他資源でない） | 不要 |
| **B1** 所持巨戟の現在BonusがIdeal、その後ResetでIdeal | 合法。未保護、`gogma_artian`、Reset support | ×（`none` だけ。G2） | × / × | 対象外 | required {g*}、chain a .. g*−1（Reset→Reset） | `none` よりrequired位置が1つ多い（§5 L1） | 要: A-2 + 案B |
| **B2** 所持巨戟の現在BonusがIdeal、その後KeepでIdeal | 合法。加えて現在5枠のKeep support | ×（G2） | × / × | 対象外 | required {g*}、chain a .. g*−1（Keep→Keep） | 同上 | 要: A-2 + 案B（G3の対象にもなり得る） |
| **B3** Reset途中でIdeal、その後ResetでIdeal | 合法 | ○ `reset` g*（後方） | × / ○ | ○ | required {g*}、途中のIdeal Reset g1はchain（Reset→Reset） | 途中のIdeal位置を他Targetへ譲れる | 不要 |
| **B4** Reset途中でIdeal、その後KeepでIdeal | 合法（Keep support） | ○ `reset_then_keep` (g1, g*)（g1のReset自体がIdealでもよい。Ideal結果のlayoutはIdeal multisetの順列なので関心layoutに入る） | × / ○（G3の条件下では×） | ○（G3の条件下では×） | required {g1（Reset→Keepで必須）, g*}、chain a .. g1−1（Reset）と g1+1 .. g*−1（Keep） | g1が必須位置になる | G3の診断・対応 |
| **B5** Keep途中でIdeal、その後Reset / KeepでIdeal | 合法（Keep support） | ○ `keep_from_source` g* / `reset` g* / `reset_then_keep`（途中のKeep Idealはchain） | × / ○（G3の条件下では×） | ○（G3の条件下では×） | Keep→Keep、Keep→Resetはskippable、最後だけrequired | 途中のIdeal位置を他Targetへ譲れる | G3の診断・対応 |
| **SB1** Skillが先にIdeal、Bonusは後からIdeal | 合法 | ○（Skillは `conversion` (c, c) または所持巨戟の `none`、Bonusは後方位置） | △（canonical Idealの形だけ） / ○（Skill操作0 × Ideal Bonus） | ○ | lane独立 | — | 不要。Skillをさらに後方へ延ばす形はS1 / S2に帰着 |
| **SB2** Bonusが先にIdeal、Skillは後からIdeal | 合法 | ○（所持巨戟のBonus `none`、または巨戟化RouteのBonus後方位置） | △（canonical Idealの形だけ） / ○ | ○ | lane独立 | — | 不要。Bonusをさらに延ばす形はB1 / B2に帰着 |
| **SB3** 両方が途中でIdealになり、全体のCounter配置のため後方まで操作 | 合法 | lane途中のIdealなら○ | × / ○ | ○（G3を除く） | 各laneの最後の操作がrequired | 後方のrequired位置を選ぶことで他Targetと排他を避ける（P0R / Issue #101型） | lane途中は不要。lane開始Idealを含む部分はS1 / S2 / B1 / B2に帰着 |

全ケース共通の確認:

- Planner unit semanticsはどのケースでも既存の表（PLANNER_SPEC 7.0.2）のままで、Idealの有無はrequired / skippableに影響しない
- PlannerはRoute途中でIdeal状態になってもTargetを早期完成させない（§2.4の8、充足判定の行）。Bonus laneとSkill laneの物理順序はPlannerが決める
  （PLANNER_SPEC 7.0.4）ので、SB1〜SB3のlane間順序に新しい規則は要らない
- 保護武器・Keep support・予測capabilityの既存制約は全ケースで維持する（§1.2）。Idealを理由に操作を禁止しないことは、これらの制約を
  緩めることを意味しない

## 5. 構造的支配（Phase B / Cの正当性への影響の中核）

### 5.1 用語

**lane開始Ideal継続option**（以下「継続option」）を、次のいずれかに当たるReachOptionと定義する。

- (i) S1型: `conversion` (c, s*)、c < s*、c ∈ `skill.idealPositions`(t)
- (ii) S2型: 所持巨戟で現在SkillがIdeal、Skill要件が `reset_skills`
- (iii) B1 / B2型: 所持巨戟で現在Bonusが `gogma_artian` Ideal、Bonus要件が `none` 以外

(i)は現行Phase Aに含まれ、(ii)(iii)は含まれない。以下の補題は、整合したReachTable（設計 §8.6と同じ前提: Phase Aが各 s* について
c ∈ [origin, s*] をすべて列挙する）とC1 / C2 / 被覆（§8.1）からなる **構造モデル** についてのものである。

### 5.2 補題L1（所持巨戟の継続optionは `none` に弱支配される）

完全割当 K（C1 / C2 / 被覆を満たす）で、Target t の option o が (ii) または (iii)（両方でもよい）であるとする。o のうち継続しているlaneの要件
（(ii)ならSkill要件、(iii)ならBonus要件、両方なら両方）を `none` に替えたoption o′ はPhase Aのoptionである（現在IdealのlaneについてPhase Aは
同じsourceで `none` × 他方のlaneの要件を列挙し、両軸Idealなら `none / none` を列挙する）。K′ = K[t ↦ o′] について:

- C1: sourceは同じ
- C2: o′ のrequired位置は o のrequired位置の部分集合である
- objective: 各streamの終端は増えない（`none` の終端はorigin）ので objective(K′) ≤ objective(K)
- 被覆: Gogma streamは常に被覆できる（設計 §8.1: gapの直後のrequired位置の所有Targetがcovererになる）。Skill streamは不成立になり得るが、
  設計 §8.6の補題（最も低い未被覆位置 p より後ろにrequired位置を持つTargetは c > p の巨戟化Targetに限られ、その c を p へ下げてもC1 / C2と
  終端が変わらない）で、objectiveを変えずに被覆可能な K″ を作れる

### 5.3 補題L2（S1型は被覆を保ったまま除去できる）

被覆可能な完全割当 K から、次の手続きPで、同じsource・objective以下・被覆可能で、(i)型を含まない完全割当 K* が得られる。

```text
while K に (i) 型の option (c, s*) を持つ Target t がある:
    t の option を (c, c) に替える            // c は t の Ideal 位置なので Phase A の option。C1 同じ、C2 は部分集合、終端は増えない
    while K の Skill 被覆が不成立:
        p = 最も低い未被覆 Skill 位置
        p より後ろに required 位置を持つ巨戟化 Target の c を p へ下げる   // §8.6 の補題。C1 / C2 / 終端は不変
```

- 停止性: Φ = Σ_{巨戟化Target} s* は外側の置換のたびに真に減り（s* > c）、内側の引き下げでは変わらない。内側の各反復は最も低い未被覆位置を
  真に上げ、それはstream終端で上から押さえられる。したがってPは有限回で止まる
- 内側の引き下げが新たに (i) 型を作った場合（p がそのTargetのIdeal位置）は、外側の次の反復で (p, p) に置換される
- 停止時には被覆が成立し、(i) 型が無い。各操作はobjectiveを増やさない

### 5.4 定理Tと系

**定理T.** 整合したReachTableでは、継続optionを含む被覆可能な完全割当は、同じsourceを使い、objectiveが同じか小さく、継続optionを含まない
被覆可能な完全割当に弱支配される（L1を適用した後にL2を適用する。L1のSkill被覆修復が (i) 型を作ってもL2が除く）。

系:

1. 継続optionをoption集合に含めても除いても、**構造的最適objective（全完全割当のobjective最小値）は変わらない**。root下界
   （`collectLowerBoundProblem()` / `solveLowerBoundRelaxation()`）は閾値だけを読むので変わらず、`proven_minimum` の判定規則（設計 §10.2）も変わらない
2. Phase Aへ(ii)(iii)を追加しても `LB(partial)`（設計 §10.1）は変わらず、admissibleのままである。下界は資源実行可能optionのstream別最小終端だけを
   読み、同じsourceの `none` が終端originで残るので最小値は変わらない（追加optionの完成のobjectiveは常にその下界以上である）
3. 設計 §8.6の被覆補題（探索木を使い切った `coverage_infeasible` は生じない）は、(ii)(iii)を加えた集合でも成立する。追加されるのは
   originから被覆する `reset_skills`（§8.1の表で常にcoverer）と、常に被覆できるGogma側の要件だけだからである。さらに定理Tにより
   「同じ最小objectiveの被覆可能な完全割当のうち、継続optionを含まないものが常に存在する」へ強化できる

### 5.5 この定理が言わないこと

- 定理Tは **構造モデル**（C1 / C2 / 被覆 / Σ stream終端）についての主張である。設計 §3.3 / §8.4のとおり、Phase A〜Cは必要条件のpre-checkであり、
  成立の最終authorityはPhase D'（Production Planner + Trace Replay）である。支配する側の候補がPlanner検証で不成立になり、支配される側だけが
  成立する可能性を、構造モデルは否定しない
- 構造モデルの拡張（required unit同士の共有規則の追加、cross satisfactionを割当に含める拡張、checkpoint pin、materialization順序の制約）が
  あれば、定理Tは再証明が要る
- G3は逆向きである: 構造的に **支配する** 側（`keep_from_source`、または早い g1 の `reset_then_keep`。required位置が少ないか同数）が
  Searchから返らず、支配される側（required位置 {q, g*}）が返る。定理Tはこれを扱わない
- 本書は定理Tを **optionを削除する根拠にしない**。現行Searchの都合（L3）で合法なoptionを削らないという本監査の原則（§1.3）と、
  「optionは必要条件として列挙し、成立はPlannerが決める」という設計 §5.3の原則に従う。定理Tは、(1) D-0Bの非formal smokeを現行option集合で
  先行してよいことの根拠（最適objectiveを失わない）、(2) 継続optionの値順序上の位置（支配する側の後）、(3) 優先度の判断、にだけ使う

## 6. Global Assignment全体への影響

### 6.1 Phase A

| 項目 | 影響 |
| --- | --- |
| ReachOption集合の完全性 | G2（S2 / B1 / B2）が欠落。G1（S1）は含まれる。Phase A内で所持巨戟と巨戟化Routeの扱いが非対称（巨戟化はlane開始Ideal後の継続を含み、所持巨戟は含まない） |
| `none` と追加optionの共存 | 所持巨戟の現在Ideal lane について、`none` と継続option（Skill: `reset_skills` s*、Bonus: `reset` / `keep_from_source` / `reset_then_keep`）を同じsourceで共存させればよい。現在性能が **両軸Ideal** のsourceについては、そのsource自身を操作する継続optionはPlannerで実行されない見込みである（§3.6のG4-iii。前提P1〜P3に依存し、testで未固定）。これはSearchの都合ではなく成立authorityであるPlannerの充足規則・動的commitmentに基づく根拠だが、**除外は確定せず、A-2でtestとともに判断する**（除外しない場合は、それらのoptionを含む候補がPhase D'で不成立になることを候補outcomeとして記録する） |
| 必要なReachTable情報 | 追加なし（§3.4） |
| lazy enumeration | 維持できる。Skillは所持巨戟の要件列を `[none] ++ reset_skills（s* 昇順）` に、Bonusはsourceのstream群に長さ1の `none` streamを加えるだけで、(c, s*) 対や (g1, g*) 対を保持しない既存のcompact indexをそのまま使える |

### 6.2 Phase B

| 項目 | 影響 |
| --- | --- |
| C1 / C2の正当性 | 変わらない。継続optionはsourceが同じで、required位置を増やすだけである |
| resource exclusivity | 継続optionは同じsourceの `none` / (c, c) よりrequired位置が多く、他Targetと競合する機会を増やすだけで減らさない（§5） |
| objectiveと下界のadmissibility | 系1 / 系2のとおり、最適objective・root下界・`LB(partial)` は変わらず、admissibleのまま |
| MRVとvalue ordering | 所持巨戟のoption数が増えるのでMRVの計数（`countUpTo(k)`）とTarget選択順が変わり得る。値順序では継続optionは同じsourceの `none` より後に出る（終端増分が同じか大きく、Skill / Bonus finalの成分で `none` = −1が先）。巨戟化のS1型は現行でも同じ s* のブロック内で c 降順に並び、同じ c の (c, c) は終端増分が小さいので先に出る。継続optionを「支配する側より後」に保証したい場合、Skill / Bonusの要件列を継続 / 非継続で別streamに分けてlatticeへ併合する必要がある（同じ s* ブロック内でIdeal-nessの成分は単調でないので、成分を1つ足すだけではlatticeの単調性が崩れる）。方式はA-2で決め、latticeの単調性・各optionちょうど1回の配送を再証明する |
| 決定性 | 新しいstreamも位置昇順・stable keyで並べれば保たれる |
| 候補列の比較可能性 | option集合を変えるとB-2B / C-2の非formal smoke / D-0Bの候補列は再現されない（B-2Bのformal RESULTは当時の条件の記録として有効なまま）。D-0Cの事前登録はoption集合を確定した後に行う（§9） |

### 6.3 Phase C

| 項目 | 影響 |
| --- | --- |
| Counter coverage | 変わらない。継続optionの `reset_skills` はoriginからのcoverer、Bonus側は常に被覆可能 |
| covererの予測 | 所持巨戟の現在Skill-Ideal sourceも `reset_skills` を選べばSkill covererになる。nearest-successor規則（設計 §8.2）は変えない |
| materialization順序 | 依存はSkill被覆だけのまま（§8.2）。S2型は依存を持たない既存巨戟の `reset_skills` と同じ扱い |
| `ExpectedRouteShape` | 形の定義は変えない。予測chain（§8.3の表）はlane開始Idealを通過しても同じ |
| §8.6の被覆補題 | 成立する（系3）。定理Tによる強化を設計 §8.6へ追記する |
| C-1 `validateOption()` | 所持巨戟の「`none` ⇔ 現在Ideal」検査は、G2に対応する場合「現在Idealなら `none` または継続option、非Idealなら `none` 不可」へ改める必要がある（A-2の変更範囲） |

### 6.4 Phase D

| 項目 | 影響 |
| --- | --- |
| `matchesExpectedShape()` の妥当性 | required位置の完全一致はC2（排他）の根拠そのものなので、照合規則としては正しい。ただしG3のように、同じ最終武器で別のrequired位置集合のRouteしか返らない場合は一致しない。照合を緩める（「他TargetのK内required位置と交わらない同値なrequired位置集合なら受理」）案は、Kのoptionを書き換えることになり、generatorの「各完全割当を1回だけ生成」と整合させる設計が要るので、本書では採らず §8の未決事項とする |
| Planner Alternative Search / 射影起点Candidate Searchの限界 | どちらもlane開始Ideal規則（L3）を持つので、G1 / G2の形を返さない。PA SearchはG3の条件下でも返さない。射影起点は加えてcanonical Ideal（最初のIdeal）しか返さないが、これは設計 §9.1へ切り替える設計どおりの限界 |
| `shape_mismatch` / `unconfirmed` / `not_executed` の分類 | G1の形は「Search policyが返さない形」なのに、現行では当該形と無関係な要因（extent外のBonus位置、cap、exhausted）で `unconfirmed` か `shape_mismatch` に分類される。後者は設計 §10.3でwindow拡大の根拠になり、前者は「cap / gate / envelopeを見直せ」という誤った信号になる。S1型はReachTableだけで判定できる（c ∈ `skill.idealPositions` かつ c < s*）ので、Searchを呼ぶ前に別の未実行分類にするのが正確である（§7.5、§9.1） |
| 形状制約付きSearchの必要性 | G1 / G2の形をmaterializeする手段は現行APIに無い（設計 §9.0の「特定のown操作位置集合を強制できない」に加え、lane開始Ideal規則がstreamを開かない）。設計 §9.8 (c) の「Research専用の形状制約付き探索」が必要になる（案B）。ただしB-iはProduction Searchの配送物を採用する現行 §9.4の契約の外にあり、別の契約の定義・承認が要る（§7.2.1） |
| delivery cap・Search規模gate | G1の形に対するSearchは一致し得ないまま配送・extent・capを消費する。D-0Bでdelivery capを非formal smokeから決めるとき、G1の試行を混ぜるとcapが過大に見積もられる。Search前に分類すればSearch時間も節約できる。G3も同様に、一致しない配送を積み上げる |

### 6.5 汎用性

G1 / G2 / G3 / G4はいずれも特定のTarget・属性・位置に依存しない構造的な性質であり、対象Exportで現れるかどうかに関わらず、汎用Global Assignment
の課題として扱う。定理Tにより、継続option（G1 / G2）は構造的最適objectiveを失わせないが、(1) 検証の完全性（Planner不成立時の代替）、
(2) 分類の正確さ、(3) 構造モデルの将来拡張への頑健性、の3点で対応が要る。G3は支配する側のoptionがmaterializeできない向きなので、
発生すれば候補の検証を直接妨げ得る（頻度は §9.1のD-0B診断で測る）。

## 7. 対応方式の比較

### 7.1 案A: Planner Alternative Searchのpolicy拡張

通常Candidate Searchの早期終了は維持し、Planner Alternative Searchだけでlane開始Ideal後もSkill / Bonus channelを開く。

- 正式仕様: SEARCH_SPEC 5.6.8の「lane開始状態がすでにIdealなら…そのlaneのstreamは開かない」を変える。`AGENTS.md` のSearch規則
  （Candidate Search Stream Separation）との関係も整理が要る。固定済みProduction test（§2.3）を書き換える
- Production挙動: Production Plannerの「比較する」（what-if）と「この候補を優先」（actual repair）が同じ入力で異なるCandidate列を受け取り、
  先頭候補がtrialで不成立のとき以降の採用候補が変わり得る。同じPlannerInputに対するPlanner出力が変わるので
  `CURRENT_CALCULATION_APP_SCHEMA_VERSION` の境界になる（`AGENTS.md` Calculation Context、Phase 5-B / 6-Aと同じ判断）
- Production上の利点: PAの1段repairでは、lane開始Idealで止めたRouteは継続Routeより資源を使わず（required位置が部分集合）、
  継続が必要になるのはbaseline Entryのheld跨ぎRouteが、無効化されたRouteのchainに被覆を依存していた場合に限られる。利点は限定的
- 計算量・メモリ: 巨戟化位置ごとのRoute base（D2-G-AのK3 L2では306位置）のうちIdealな位置すべてにSkill channelを開くことになる。
  D2-G-Aが主要なメモリ要因と特定したSkill held-aware streamの全depth保持がそのまま増える。Lazy Ideal Crossのpair数も増える
- Global Assignmentへの効果: 形が「到達可能」になるだけで、6キー順序の1番目（own operation数）により継続Routeは同じbaseの非継続Routeより
  後に配送されるので、delivery capの範囲で一致する保証は無い。G3は解決しない
- 6キー順序・Candidate identity・決定性は保てるが、extentの意味（5.6.1「`maxSkillAdvance` を消費しない」）は変わる

**採らない。** Production上の利点が小さいのに、正式仕様・計算版数・メモリのコストが大きく、Global Assignmentの欠落も効率よく解かない。

### 7.2 案B: Global Assignment専用の形状制約付きResearch Search

source、巨戟化位置、stream別のrequired位置（s* / g1 / g* / Normalのproduction target）を制約として与え、その形のRouteだけを探索する。

- 守る契約: 正式なreservation（materialize済みEntryから `derivePlannerAlternativeReservation()`、held / blockedを改変しない。設計 §9.0 / レビューB2）、
  coverage条件（originから最後の操作まで自分の操作かheld）、silent fast-forward / required / skippableの既存semantics、
  Production RNG予測、Candidate factory（`createPlannerAlternativeCandidate()` / `createConstrainedCandidate()`）、
  deterministic materializer、`matchExpectedShape()`、Phase D'のPlanner検証
- 守る原則: RouteOperationや予測結果を推測で組み立てない。「期待形からRouteOperation列を直接組み立てる」方式は採らず、Production streamが予測した
  解から形に合うものを **選ぶ** 探索として作る
- 実装の候補は次の2つで、**最終選択はD-0A-2のdocs-only設計PRで行う**（本監査では確定しない）
  - **B-i（Research側のconsumer、Production file変更なし）**: Researchモジュールが、Productionのstream・Route search primitive・Candidate factoryを
    部品として使い、形が指定するRoute base（source、巨戟化位置）についてstreamを1 depthずつ順に読み（consumer契約を守る）、最後の操作位置・
    `lastResetDepth`（Reset→Keepの g1）が形に一致する解だけを選んで、base操作 + Bonus操作 + Skill操作を合成し、`createPlannerAlternativeCandidate()` で
    Candidateにする。lane開始Ideal規則はschedulerの購読判断にあるだけでstreamには継続状態があるので、G1 / G2の形を取得できる見込みがある
    （G3の条件に当たる形を除く）
  - **B-ii（Search DomainへのResearch専用seam）**: Search Domainに、Production callerが渡さないexecution-only optionとして形状制約を加える。
    Production Searchと同じschedulerと合成を使うので合成ロジックの複製が無く、G3（B2 frontierの代表が別historyへ畳む）まで扱える可能性がある。
    Production fileの変更になるのでオーナー判断が要り、Production callerの挙動・Candidate列・prediction回数が不変であることをtestで固定する
    必要がある。SEARCH_SPECへの記載要否も判断が要る

#### 7.2.1 現行materialization契約（設計 §9.4）との関係

設計 §9.4は「Candidate / Entryは常に正規のProduction Search結果から作る。期待形をもとにRouteOperation列を手で組み立ててEntryにすることはしない」と
定める。ここでの「正規のProduction Search結果」は、設計 §9.1の `visitPlannerAlternativeCandidates()` が配送したCandidate、または設計 §9.2の
`searchCandidates()` が返したcanonical Idealであり、D-0Aの実装もこの2つだけを採用する（設計 §9.9）。

- **B-iは、Production Search APIが配送したCandidateを採用する方式ではない。** Production Searchのschedulerが合成しないRoute（lane開始Ideal継続）を、
  Research側がProductionの部品を使って合成する。期待形からRouteOperationを直接組み立てるわけではないが、§9.4の「正規のProduction Search結果」には
  当たらず、**現行 §9.4の契約の外にある**
- B-iiも、Production callerの契約（SEARCH_SPEC 5.6.8）とは別のpolicyで生成される結果なので、設計 §9.1 / §9.2の配送物とは区別して扱う

B-iが設計 §9.4の現行契約（設計 §9.1 / §9.2の経路）から外れる範囲:

| 項目 | 設計 §9.1 / §9.2（現行契約の内側） | B-i |
| --- | --- | --- |
| Candidateの出所 | Production Search APIの配送物（PA Searchの配送Candidate、Candidate Searchのcanonical Ideal） | Research moduleが組み立てた `ScheduledComposition` から `createPlannerAlternativeCandidate()` で作るCandidate |
| Route baseの登録と購読判断 | `TargetSearchScheduler.addBase()`（lane開始Ideal規則を含む） | Research側が形に合うRoute baseを選び、lane開始Ideal規則を適用せずにstreamを読む |
| stream解の選択 | schedulerのchannel購読、Lazy Ideal Cross、6キー順序の配送 | Research側が最後の操作位置・`lastResetDepth` などで形に一致する解だけを選ぶ |
| Routeの合成 | `composeScheduledRoute()`（`targetSearchScheduler.ts:96`、module非公開） | Research側の再実装（連結順、source binding、RouteKind解決） |
| search identity | `createPlannerAlternativeSearchIdentity()` + D-0Aのalgorithm token | Research合成であることを区別する別のalgorithm tokenが要る |
| 「該当なし」の意味 | `summary.exhausted` / `stoppedByExtent` / consumer stop（Search APIの契約、設計 §9.6） | Research側で新たに定義が要る |
| SEARCH_SPECの位置づけ | 5.6.8のPlanner Alternative Search（Production契約） | SEARCH_SPECのどの契約でもないResearch専用の手順 |

B-iを採用する場合は、設計 §9.4を書き換えて既存のD-0A経路（設計 §9.1 / §9.2）の契約を広げるのではなく、**Global Assignment Research専用の
materialization経路の契約を §9.4とは別に定義し、承認を受ける**（D-0A-2設計PR）。既存のProduction Search / Plannerの契約と、D-0Aの設計 §9.1 / §9.2の
契約は本監査で変更しない。その新しい契約で最低限定めること:

1. 対象とする形（少なくとも継続option。ReachTableで判定できるもの）と、設計 §9.1 / §9.2との方式選択規則（設計 §9.3への組込み）
2. Productionから再利用するauthorityと、Research側で新規に実装する責務の境界（下表）
3. 合成Routeの正当性の検証義務（下記）と、それを満たさないときのfail closed
4. 記録上の区別: そのEntryがProduction Searchの配送物ではなくResearch合成であることをmethod・algorithm tokenで記録し、Production Search結果として扱わない
5. 「該当なし」「未確認」「未実行」の分類と、設計 §9.6 / §10.3での扱い
6. identity・決定性・cancel・Search規模の予測とgate

B-iで利用できるProduction authorityと、Research側に新規実装が必要な責務（基準mainのexportを確認した範囲）:

| 区分 | 内容 | 状態 |
| --- | --- | --- |
| 利用できる関数 | `createTargetSkillStream()` / `createTargetBonusStream()`（Production RNG予測・memo・held-aware stream）、`resetSkillsOperations()` / `skillAmendmentResults()` / `bonusAmendmentOperations()` / `bonusAmendmentResults()`、`createPlannerAlternativeCandidate()`（内部で `createConstrainedCandidate(..., 'origin_reach')`: 最終状態のIdeal判定、`validateBuildRoute()`、estimate、両hash、観測traceのbinder）、`conversionSkillPrediction()`、`existingGogmaRouteKind()`、`createCounterReservation()` / `nextOperationPositions()`、`createSearchExecutionContext()` / `createSearchPredictionSupport()`、`derivePlannerAlternativeReservation()`、deterministic materializer、`validateBuildListEntry()`、`createPlannerRouteUnitPlans()` | exportされている。ただし、PA Searchと同じ `RouteSearchContext` を `visitPlannerAlternativeCandidates()` の外で同一に構成できるか（同関数内部の構成の再現）は **未確認** |
| 利用に制約がある部品 | Route search primitive（`searchNormalArtianRoutes()` / `searchOwnedNormalArtianRoutes()` / `searchExistingGogmaRoutes()`）は `TargetSearchScheduler` インスタンスを受け取り、`scheduler.addBase()` と `scheduler.queue` でRoute baseを登録する | Route baseを取り出すにはschedulerのsubclassで `addBase()` を差し替えるなどの方法が考えられるが、Productionの内部手順に依存する。**実現性は未確認**。Route baseを自前で組み立てる方式は、base操作・Normal予測・巨戟化Skillの再実装になるので採らない |
| Research側の新規実装 | Route baseの選択、streamのconsumer契約（Bonus streamのsingle-pass、fail-closed）を守った読み取り、形に一致する解の選択、`composeScheduledRoute()` 相当の合成（非公開のため再実装）、`ScheduledComposition` の組み立て、「該当なし」の分類、search identity / algorithm token、cancel、Search規模の予測 | 未設計・未実装 |

合成Routeの正当性をどう検証するか（D-0A-2設計PRで具体化する確認事項）:

- **parity testで確認できる範囲**: PA Searchが返す形（lane途中のIdeal、通常の連続 / held跨ぎRoute）について、B-iの結果がPA Searchの配送Candidateと
  `candidateStableKey`・operations・観測trace・materialize後のEntry IDまで一致すること。これは合成ロジックの再実装とRoute base / streamの扱いの
  検証であり、PA Searchが返さない形の正当性は示さない
- **parity testで確認できない範囲（Production Searchが返さないIdeal継続Route）**: 比較対象が無いので、正式なauthorityで次を別途検証する
  1. RNG予測: Routeの全operation（required unitだけでなくchain unitを含む）について、Production RngEngineの公開APIで独立に予測し直した結果が、
     Candidateの観測trace（`bonusAmendmentTrace` / `skillAmendmentTrace` / `conversionSkillTrace`）と最終武器に一致すること。既存の
     `replayReachOptionRequiredOnly()` はrequired unitだけを再生するので、それだけでは足りない
  2. 状態遷移とCounter: 各operationの `counterBefore` / `counterAfter` が操作種別ごとのCounter進行（巨戟化 Skill +1、Reset Skills Skill +1、
     Reset / Keep Gogma +1）と連続性を満たし、正式reservationのcoverage条件（originから最後の操作まで自分の操作かheld、blockedに置かない）を満たすこと。
     Keepの入力layoutが直前の状態のfamily layoutであること（Reset→Keepの g1 を含む）
  3. Candidate validation: Candidate factory（最終状態Ideal判定、`validateBuildRoute()`、estimate、hash、trace binderのfail-loud検査）と
     `validateBuildCandidate()` / `validateBuildListEntry()` を通ること
  4. Planner unit semantics: `createPlannerRouteUnitPlans()` によるrequired / skippable導出が期待形と一致すること
  5. Planner: Phase D'のProduction Planner実行とTrace Replayが成立すること。Trace Replayは実際に実行されたoperation（traceに残るもの）の予測を
     再実行するが、silent fast-forwardされたchain unitは再生しないので、chain unitの予測の正しさは上記1で別に確かめる
- `validateBuildRoute()` は構造検査であり、予測結果の正しさもProduction Searchとの同等性も保証しない。**合成Routeを `validateBuildRoute()` に
  通しただけで、Production Searchの結果と同等とは判断しない**

その他:

- G3への対応: B-iはstreamのfrontier代表規則を変えられないので、G3（代表から落ちたhistory）は取得できない。B-ii、または §6.4の
  「同値なrequired位置集合の受理」のどちらで扱うか、あるいはmaterialization順序で回避するかは未決（§8）
- 計算量・メモリ: 形が source・巨戟化位置・最終位置を固定するので、Route baseは1つ、streamは必要depthまで、Lazy Ideal Crossの全pairを作らない。
  D2-G-Aの爆発要因（巨戟化位置数 × depth × state）を持たない見込みである（実測はD-0A-2以降）。Bonusのfrontierは既存のB2代表規則のまま
- 決定性: 入力（形、reservation、origin、Engine）の純関数として設計する。Candidate / Entry identityは既存のdeterministic materializerを使う
- Research isolation: B-iなら `src/benchmarks/globalAssignment/` に置き、Productionから到達しない（設計 §11.3のisolation test）。B-iiはProduction fileに触れる
- D-0Aとの統合: 採用が承認された場合、設計 §9.3の方式選択に第3の方式として加える。適用対象は少なくとも継続option（Searchを呼ぶ前にReachTableで
  判定できる）。一般の形に対して設計 §9.1 / §9.2の後の補助として使うか、継続optionだけに使うかはD-0A-2設計PRで決める

**B-i / B-iiの位置づけ**: 本監査は、Production fileとProduction Searchの意味論に影響しないという観点でB-iを第一候補とするが、**採用は確定しない**。
B-iは、§9.4の外にある新しいResearch専用materialization契約の定義・承認と、上表の技術的実現性（Route baseの取り出し、`RouteSearchContext` の構成、
streamのconsumer契約）の確認を前提とする。それらが成立しない場合はB-ii（オーナー判断）または案C（未確認として扱う）へ戻る。

### 7.3 案C: 現行Searchを維持し、未確認として扱う

- 現行materialization（設計 §9.1 / §9.2）を変えない。G1の形は未確認のまま候補outcomeに残る
- 主張できること: 定理Tにより、構造的最適objective・root下界・`proven_minimum` の判定規則は損なわれない。Phase D'で `verified` になった候補の
  物理操作数はそのまま主張できる
- 主張できないこと: 「この窓の構造的候補はすべて検証を試みた」。G1を含む候補は未確認で終わり、G2の形は列挙すらされない。G3があれば支配する側の
  候補も未確認になる。§10.3のwindow移行規則は、未確認の原因がcap / gate / envelopeではなくSearch policyである場合を区別していない
- 単独では、汎用Global Assignmentの「合法なRouteを列挙・検証から漏らさない」目標を満たさない

### 7.4 比較

| 観点 | 案A | 案B（B-i） | 案C |
| --- | --- | --- | --- |
| 正式仕様の変更 | 要（SEARCH_SPEC 5.6.1 / 5.6.8、`AGENTS.md`） | 不要（Research）。ただし設計 §9.4の外にあるResearch専用materialization契約の定義・承認が要る（§7.2.1） | 不要 |
| materialization契約（設計 §9.4） | Production Searchの配送物なので契約内（ただしProduction側の変更が前提） | 契約外（新しいResearch専用契約が要る） | 契約内 |
| 技術的実現性 | 実装は可能（Production変更） | 未確認（Route base取り出し、`RouteSearchContext` 構成、合成の再実装） | — |
| Production挙動・計算版数 | 変わる（what-if / repairの出力、版数境界） | 変わらない | 変わらない |
| G1（S1）のmaterialize | 到達可能になるが配送順で後回し | 可能 | 不可（未確認） |
| G2（S2 / B1 / B2） | Phase A変更と併せて到達可能 | Phase A変更（A-2）と併せて可能 | 不可（列挙されない） |
| G3 | 解決しない | 解決しない（B-iiまたは別案で対応） | 解決しない |
| delivery効率 | 低い（継続Routeは後に配送） | 高い（形を直接選ぶ） | — |
| メモリ・時間 | 増える（Skill channel、pair） | 形1つ分 | 変わらない |
| 決定性・6キー順序・identity | 保てる | 保てる（6キー順序は使わない。形で一意） | 保てる |
| 実装リスク | Production全経路への影響 | 合成ロジックの複製（parity testで固定）と、継続Routeの正当性の別途検証（§7.2.1） | なし |

### 7.5 推奨: 段階的に案C → 案B（第一候補B-i、最終選択はD-0A-2）、Phase Aの対称化（A-2）を併せて行う

1. **D-0B（直ちに）: 案C + 正確な分類と診断。** 定理Tにより、継続optionを扱わなくても構造的最適objectiveは失われないので、現行D-0A方式で
   非formal smokeを先行してよい。ただしG1の形はSearch前にReachTableで判定し、`unconfirmed` / `shape_mismatch` と区別した未実行分類にする。
   G3 / G4は診断として数える（§9.1）
2. **D-0Cの事前登録より前: 案BとA-2。** 案Bで継続optionをmaterializeできるようにし、A-2でPhase Aに所持巨戟の継続option（G2）を
   加えてPhase A内の非対称を解消する。案BはB-iを第一候補とするが、B-iは設計 §9.4の外にあるResearch専用materialization契約の定義・承認と
   技術的実現性の確認を前提とし、B-i / B-iiの最終選択はD-0A-2のdocs-only設計PRで行う（§7.2.1）。案BもA-2も構造的最適objective・root下界・
   `LB(partial)` を変えないので（定理T）、Phase B / Cの正当性はtestで再確認するだけでよい（A-2は候補列と値順序latticeを変えるので、その単調性は
   再証明する。§6.2）
3. **案Aは採らない。** Production Searchの正式なpolicyはそのまま維持する

根拠: (a) 定理Tにより最適性の観点では緊急度が低く、D-0Bを止める理由が無い。(b) 一方、汎用性（合法Routeを検証から漏らさない）、
分類の正確さ（§10.3の誤った拡大・見直し判断を防ぐ）、構造モデル拡張への頑健性のために、D-0Cのacceptanceまでには必要である。
(c) 形状制約付き探索（特にB-i）は、正式仕様・Production挙動・計算版数・メモリに影響せずに、継続optionを効率よく（形1つ分のSearchで）取得できる
見込みのある方式である。ただし現行 §9.4の契約の外にあり、新しい契約と、継続Routeの正当性を正式なauthorityで検証する手順（§7.2.1）が揃うまでは
採用しない。

リスク:

- B-iは合成ロジック（base操作 + Bonus操作 + Skill操作の連結とsource binding）をResearch側に複製する。PA Searchが返す形について、B-iの結果が
  PA Searchの配送Candidateと同一（`candidateStableKey`、operations、観測trace）であることをparity testで固定する。parity testはPA Searchが返さない
  継続Routeの正当性を示さないので、継続Routeは §7.2.1の全operation独立予測・Counter / coverage検査・Candidate validation・Planner / Trace Replayで
  別途検証する
- B-iの技術的実現性（Route baseの取り出し、`RouteSearchContext` の構成）は未確認であり、成立しない場合はB-ii（オーナー判断）か案Cへ戻る
- A-2は候補列を変えるので、B-2B / C-2 / D-0Bのsmokeとの比較は条件差として記録する。値順序latticeの単調性は再証明が要る（§6.2）
- G3は案B（B-i）では解けない。発生頻度をD-0Bで測ってから、B-ii / 同値受理 / 順序変更のどれにするかを決める
- G4（Planner開始時にIdeal武器を持つTarget）は本書の推奨では解決しない。開始時点の `hasIdeal` は恒久的な完成ではなく、他のRouteがIdeal武器を
  操作すると再commitされ得る（§3.6）。D-0Bでは場合分け（G4-i / G4-ii / G4-iii）を記録するだけで不成立に分類せず、扱いは別途決める（§8）

## 8. 確定事項と未決事項

### 8.1 確定事項（本監査で確定したもの）

- Skill Ideal後もReset Skillsを継続できる。Bonus Ideal後も、巨戟化済みであればReset / Keepを継続できる（直接観測、§1.1）
- Idealはユーザー目標であり、ゲーム上の操作制限ではない（§1.3 L1）
- Ideal後の操作を含むRouteは、既存のDomain表現・Route validation・Candidate factory・Planner unit semantics・Plannerの充足判定で、
  変更なしに表現・実行できる（§2.4の8、§4）
- Production Searchの早期Ideal終了はlane開始状態がIdealのRoute baseだけに効くSearch policyであり、Planner Alternative Searchにも適用される
  正式な契約である（§2）。lane途中のIdeal後の継続はPlanner Alternative Searchが列挙する
- Global Assignmentは、合法な後続操作をIdeal到達だけを理由に排除しない。現行Phase AのS1型optionは削除しない
- 既存の保護武器・Keep layout / support・RNG capability・normal scope Ideal不成立・blind未知入力の制約は維持する（§1.2）
- 継続optionは構造的最適objective・root下界・`LB(partial)` のadmissibility・§8.6の被覆補題を損なわない（定理T、§5）
- Planner開始時点の `hasIdeal` は恒久的な完成ではない。他のRouteがIdeal武器を操作してin-flightにすると充足が再評価され、未commitのEntryは
  実行可能かつcollisionなしなら再commitされ、reserveで再び充足すればcommitted Entryは解放される（コード・ISSUE_103設計 6.8で確認、§3.6）。
  したがってG4は開始時点の状態だけでは決まらず、D-0Bでは候補を不成立に分類しない
- 案A（Production Planner Alternative Searchのpolicy変更）は採らない（§7.1）
- 案BのB-iは、Production Search APIが配送したCandidateを採用する方式ではなく、設計 §9.4の現行契約（§9.1 / §9.2の経路）の外にある。
  採用するにはResearch専用materialization経路の契約を §9.4とは別に定義し、承認を受ける必要がある（§7.2.1）。本監査は §9.4、既存の
  Production Search / Plannerの契約を変更しない

### 8.2 調査・設計で確定すべき事項（未決）

| 事項 | 内容 | 決める場所 |
| --- | --- | --- |
| G1の未実行分類の名前と §10.3の扱い | 例: `not_executed(reason: 'search_policy_shape')`。§10.3では「Search policy起因の未実行」はwindow拡大の根拠にもcap / gate / envelope見直しの根拠にもせず、方式（案B）の実装状態を見る | D-0B |
| G3の発生頻度と対応 | D-0B診断で頻度を測る。対応はB-ii / 同値なrequired位置集合の受理 / materialization順序（chain内のReset位置の所有Targetを先にmaterializeする）のいずれか | D-0B（頻度）、案Bの設計PR（方式） |
| 案Bの実装方式 | B-i / B-iiの最終選択。B-iなら設計 §9.4の外にあるResearch専用materialization契約（§7.2.1の6項目）の定義と承認、技術的実現性（Route baseの取り出し、`RouteSearchContext` の構成、streamのconsumer契約）の確認、継続Routeの正当性検証の手順。B-iiならProduction file変更の可否とSEARCH_SPECへの記載要否。共通: 適用範囲（継続optionだけか、一般の形の補助方式にもするか）、設計 §9.3の方式選択への組込み、Search規模の予測とgate | D-0A-2設計PR（docs-only） |
| A-2のoption規則 | 両軸Ideal sourceの継続optionを除外するか（§3.6のG4-iii。前提P1〜P3をtestで固定できるか、除外しない場合の候補outcomeの扱い）、値順序上の位置（継続 / 非継続の別stream化）、C-1 `validateOption()` の改訂 | A-2 |
| G4の扱い | Planner開始時にIdeal武器を持つTargetについて、G4-i（静的に予測できる非実行）を候補生成側で扱うか、診断・候補outcomeに留めるか。G4-ii（実行順に依存）はPhase D'でだけ判定し、候補生成側で除外しない。cross satisfaction（設計 §15.1）との整合 | D-0B（頻度）、A-2または別PR |
| 正式文書への記録 | §10の候補をどこまで正式仕様へ入れるか | オーナー判断 |

## 9. D-0B / D-0Cへの影響とPR分割

### 9.1 判断事項への回答

| # | 判断事項 | 回答 |
| --- | --- | --- |
| 1 | D-0Bの非formal smokeを現行D-0A方式で先行してよいか | **よい**。定理Tにより構造的最適objectiveは失われない。smokeは「最初のstructural candidateが現行方式でどこまでmaterializeできるか」「分布・Search規模」を測るのに十分である |
| 2 | 先行する場合の診断上の制限 | (a) G1の形を含む候補はmaterializeできず、未確認（未実行）で止まる。(b) G2の形は列挙されないので観測できない。(c) G3があれば支配する側の形が一致せず、未確認または `shape_mismatch` になり得る。(d) G4の候補はPlanner検証で成立しない場合がある（§3.6。D-0BはPlanner検証をしないので、開始時点のIdealだけを理由に不成立とは分類しない）。(e) smokeの数値（delivered-before-match、Search規模、時間、heap）は現行option集合・現行方式でのもので、案B / A-2の後に再測定が要る。いずれも「Routeが存在しない」「実行不能」とは書かない |
| 3 | Skill / Bonusの列挙漏れを検知できる診断の要否 | **要**。D-0Bで次を追加する: (i) Search前のG1判定（c ∈ `skill.idealPositions` かつ c < s*。ReachTableの参照だけで予測なし）と専用の未実行分類、(ii) G3の危険度（`keep_from_source` / `reset_then_keep` の操作範囲に、chain layoutと同じlayoutのReset位置があり、それがrequestのreservationでheldでないか。`resetLayoutByPosition` と正式reservationの参照だけ）と、照合不一致のうち「最終武器は一致しrequired位置だけが異なる」ものの別集計、(iii) G4の場合分け（`deriveTargetSatisfaction()` でPlanner開始時に `hasIdeal` のTarget、そのIdeal武器が候補内の他TargetのRouteのsourceか（G4-i / G4-ii）、そのTarget自身が両軸Ideal sourceを操作するか（G4-iii）、option種別）の集計。**いずれも候補を不成立・恒久除外に分類せず、materializationは通常どおり行う**（成否はPhase D'で判定）、(iv) 候補ごとの継続option数 |
| 4 | Phase Aの変更を先行する必要があるか | **ない**（定理T）。ただしA-2はD-0Cの事前登録より前に入れる。A-2単独で入れると継続optionがmaterializeされない（現行Searchは返さない）ので、案Bと同時か案Bの後に入れる |
| 5 | 形状制約付きSearch等の実装をどの順番に配置するか | D-0B（runner・smoke・診断・G1の分類）→ D-0A-2設計PR（docs-only。B-i / B-iiの最終選択、B-iを選ぶ場合のResearch専用materialization契約、継続Routeの正当性検証の手順、G3の扱いを含む）→ D-0A-2実装 → A-2 → D-0B-2（再smokeと事前登録）→ D-0C。D-0A-2設計はD-0Bの診断（G1 / G3の頻度）を入力にする |
| 6 | D-0Cの正式計測前に必要な条件 | option集合の確定（A-2の採否と規則。両軸Ideal sourceの扱いを含む）、materialization方式の確定（案Bを含む設計 §9.3。B-iならResearch専用materialization契約の承認と継続Routeの正当性検証の実装）、G1の分類規則とその §10.3での扱いの確定、確定した集合・方式での非formal再smoke、それを根拠にしたdelivery cap・Search規模gate・envelopeの事前登録、clean HEAD |
| 7 | 必要なsynthetic test・総当たり検証・Production parity test | §9.3 |

**PR分割についての提案（元の計画からの変更点）。** 元の計画ではD-0Bが「runner・非formal smoke・計測条件の事前登録」を行う。delivery cap・
Search規模gateの値は、materialization方式（案B）とoption集合（A-2）に依存するので、案B / A-2より前に登録すると登録し直しになる。
したがってD-0Bは「runner・非formal smoke・診断」までとし、事前登録は案B / A-2の後の **D-0B-2** に移すことを提案する
（B-2A / B-2Bと同じく、登録だけを独立したPRにする）。オーナーが元の計画を維持する場合は、D-0Bで登録した値を案B / A-2の後に
改めて登録し直す（formal run前の変更なのでG9に反しない）。

### 9.2 後続PR計画

| PR | 内容 | Production影響 | 依存 |
| --- | --- | --- | --- |
| 本PR | docs-only監査（本書と設計 §19） | なし | — |
| **D-0B** | 実Export用runner（materialize-only mode、別process、envelope、RESULT）、非formal smoke、§9.1の診断（G1のSearch前判定と専用の未実行分類、G3 / G4の集計、継続option数）。事前登録はしない | なし | 本PR |
| **D-0A-2設計**（docs-only） | 案Bの設計: B-i / B-iiの最終選択、B-iを選ぶ場合のResearch専用materialization契約（設計 §9.4とは別の節として定義し承認を受ける。§7.2.1）と技術的実現性の確認、継続Routeの正当性検証の手順、G3の扱い、設計 §9.3への組込み、§10.3のSearch policy起因の未実行の扱い、Search規模予測・gate、test計画 | なし | D-0Bの診断 |
| **D-0A-2実装** | 承認された方式での形状制約付きmaterialization（B-iならResearchのみ）、設計 §9.3の方式選択の拡張、synthetic test、parity test、継続Routeの正当性検証test | なし（B-iiならSearch Domainのseamをオーナー判断で追加） | D-0A-2設計 |
| **A-2** | Phase Aの所持巨戟継続option（G2）、両軸Ideal sourceの扱いの判断（§3.6のG4-iii）、値順序latticeの継続 / 非継続stream化、`LB(partial)` / root下界の不変確認、C-1 `validateOption()` の改訂、replayの確認、総当たりtest | なし | D-0A-2実装（同時でもよい） |
| **D-0B-2** | 確定したoption集合・方式での実Export非formal再smoke、delivery cap・Search規模gate・envelope・option集合version・方式選択規則の事前登録 | なし | A-2、D-0A-2実装 |
| **D-0C** | 登録条件でのformal measurement | なし | D-0B-2 |
| **D-1** | Planner検証（統合acceptance） | なし | D-0C |

G4の扱いはD-0Bの集計を見て、A-2に含めるか別のPRにするかを決める。

### 9.3 test計画

**synthetic（Fake Engine / 小規模fixture、oracle非依存）**

- 現行Searchの挙動の固定（Production testは既にある。Research側では観測として固定）: S1 / S2 / B1 / B2の形をPA Searchが返さないこと、
  lane途中のS3 / B3 / B4 / B5の形は返すこと
- D-0B: G1の形がSearch前に専用の未実行分類になり、Search APIが呼ばれないこと。`unconfirmed` / `shape_mismatch` / `materialization_failed`
  にならないこと。§10.3の扱い（拡大しない・cap / gate / envelopeの見直し対象にもしない）
- G3: chain layoutと同じlayoutのReset位置がheldでない入力で、PA Searchが同じ最終武器をrequired位置 {q, g*} で返し、`keep_from_source` の形とは
  一致しないこと（本書の推定の固定）。同じReset位置がheld / blockedの入力では `keep_from_source` の形が返ること
- 案B（採用方式がD-0A-2で承認された後）: S1 / S2 / B1 / B2の各形が形状制約付き探索でmaterializeされ、`matchExpectedShape()` に一致し、
  `validateBuildCandidate()` / `validateBuildListEntry()` を通ること。正式reservationを改変しないこと（入力の捕捉比較）。blocked位置に操作を置かないこと。
  決定性。cancel
- 継続Routeの正当性（parity testの対象外。§7.2.1）: 全operation（chain unitを含む）をProduction RngEngineで独立に予測し直した結果が観測traceと
  最終武器に一致すること、Counter進行・連続性・coverage条件・Keep入力layoutの検査、`createPlannerRouteUnitPlans()` のrequired / skippable導出、
  Phase D'相当のPlanner実行とTrace Replay。`validateBuildRoute()` の通過だけを合格条件にしないこと
- Planner（Phase D'相当の小fixture）: 継続optionのRouteを含むEntry集合で `createProductionPlanWithObserver()` がcompleted / Conflict 0 / Trace Replay validを
  返し、Route途中のIdeal状態でTargetが早期完成しないこと、物理操作数がobjectiveと一致すること
- G4（Planner小fixture。現行の状態遷移の固定であり、扱いを決めた後はその規則のtestを加える）:
  - G4-i: tのIdeal武器を最終入力のどのRouteも操作しない場合、tのEntryが最後までcommitされず実行されないこと
  - G4-ii（開始時のIdeal充足が別Targetの操作で変化するケース）: tのIdeal武器 w を別Target t′ のRouteがsourceとして操作すると、t′の最初の操作で
    wがin-flightになってtの `hasIdeal` がfalseへ戻り、(a) その時点でtのRouteが実行可能かつcollisionなしならtのEntryがcommitされて完成すること、
    (b) tのRouteのholding unitの位置が既に通過されていればcommitされないこと、(c) t′のreserveでwの新しい状態がtのIdealも満たすとtのcommitted Entryが
    解放されること、(d) tが別にin-flightでないIdeal武器を持てば `hasIdeal` のままであること
  - G4-iii: t自身の両軸Ideal sourceを操作するRouteを持つEntryが最後までcommitされないこと（A-2の除外判断の根拠。前提P1〜P3の固定）
  - いずれも、D-0B相当の診断が候補を不成立・恒久除外に分類しないこと

**総当たり（solverと独立したenumerator、seed付きrandom表。C-2と同じ方式）**

- 定理T: 継続optionを含む全option集合と含まない集合とで、被覆可能な完全割当のobjective最小値が一致すること。継続optionを含む各被覆可能完全割当に
  対し、同じsource・objective以下・継続option無しの被覆可能完全割当が存在すること（L1 / L2の手続きPを独立実装して確認）
- A-2: 拡張した集合での `LB(partial)` が全prefixで総当たりの残り最小以下（admissible）、root下界の不変、被覆補題（探索木を使い切った
  `coverage_infeasible` が生じない）、値順序latticeが各optionをちょうど1回・単調に配送すること、C1 / C2の不変

**Production parity**

- 案B（B-iを採る場合）: PA Searchが返す形（lane途中Ideal、通常の連続 / held跨ぎRoute）について、形状制約付き探索の結果がPA Searchの配送Candidateと
  `candidateStableKey`・operations・観測trace・materialize後のEntry IDまで一致すること（合成ロジック複製の検証）。これはPA Searchが返さない継続Routeの
  正当性を示さないので、上記の継続Route検証と併せて行う
- B-iiを採る場合: Production callerの配送 `candidateStableKey` 列・summary・prediction回数がseamの有無で不変であること
- isolation: Researchモジュールが `src/domain` / `services` / `workers` / `pages` / `components` / `db` から到達されないこと（設計 §11.3）

## 10. 正式仕様変更の候補（本PRでは変更しない）

| 対象文書 | 箇所 | 変更案 | 理由 | 必要性 |
| --- | --- | --- | --- | --- |
| `docs/SEARCH_SPEC.md` | 5.6.1 | 「Ideal条件を満たす現在状態でそのstreamの探索を終了してよい」は単一Targetの品質に基づくSearch policyであり、ゲーム上はIdeal到達後もReset Skills / Reset / Keepを継続できる（2026-10-12、オーナーの直接観測）ことを、5.9と同じ層の区別で注記する | 将来、早期終了をゲーム規則やDomain制約と誤読しないため | 任意（オーナー判断）。Researchの進行には不要 |
| `docs/SEARCH_SPEC.md` | 5.6.8「探索の継続」 | 変更しない（Production policyを維持する）。必要なら「Global Assignment ResearchはこのpolicyでなくResearch側の形状制約付き探索で継続Routeを取得する」と参照を足す | Production挙動と計算版数を変えないため | 任意 |
| `docs/REQUIREMENTS.md` | 用語（理想品・理想条件） | 理想条件はユーザーが登録した目標であり、ゲーム側の操作を制限しないことを1文で明記する | 同上 | 任意 |
| `docs/PLANNER_SPEC.md` | 9.2.5 | 変更しない（Planner再検索の対象はProduction policyとして現状のまま） | 案Aを採らないため | 不要 |
| `docs/SEARCH_SPEC.md` / `docs/PLANNER_SPEC.md` | 新設 | 案BをB-iiで実装する場合、Search DomainのResearch専用seam（Production callerが使わないexecution-only option）であることと、Production挙動を変えない契約 | Production fileに触れるため | B-iiを選ぶ場合だけ（案Bの設計PRで判断） |
| `AGENTS.md` | Candidate Search Stream Separation | 変更しない | Search規則は維持するため | 不要 |

Global Assignmentを将来Productionへ統合する場合の正式仕様変更（設計 §16）は、本監査の範囲外である。

Research設計文書（正式仕様ではない）の変更候補:

| 対象 | 箇所 | 変更案 | 決める場所 |
| --- | --- | --- | --- |
| `docs/PLANNER_GLOBAL_ASSIGNMENT_DESIGN.md` | §9.4 | 本文は変更しない（既存D-0A経路 設計 §9.1 / §9.2の契約のまま）。B-iを採用する場合は、Research専用materialization経路の契約を §9.4とは別の節として新設し、§9.4には「本項は §9.1 / §9.2の経路の契約であり、Research専用経路は別節の契約に従う」という参照だけを足す。両経路の契約を1つの文に混ぜない | D-0A-2設計PR |
| 同上 | 設計 §9.3 / §9.6 / §10.3 | 承認された方式を第3の方式として方式選択・outcome分類・window移行判定へ組み込む | D-0A-2設計PR |

## 11. 本PRの検証

- 変更はdocs 2 file（本書の新規作成、設計の §19追加と参照点の追記）だけである。Production changed files = `[]`、Research実装・test・計測コードの変更なし
- `git diff --check`、Markdownリンクと文書参照の確認、変更差分の確認、正式仕様との整合確認を行った（結果はPR本文に記載）
- Search実行、実Export run、formal measurement、RESULT生成は行っていない

## 12. レビュー対応（PR #245、初版 `fdd29c8` に対する修正）

| 区分 | 指摘 | 対応 |
| --- | --- | --- |
| Required fix 1 | G4を、開始時点の `hasIdeal` だけで「別Routeは実行されない」と断定していた。Plannerはsource操作でin-flight化した武器を除いて充足を再評価し、未commitのEntryを再commitし得る | 現行Plannerの状態遷移（開始時の充足、変更操作・reserve後の再評価、in-flight、動的commit / 解放、完成判定）をコードとISSUE_103設計 6.8で確認し、§3.6を新設した。G4をG4-i（Ideal武器が操作されない）/ G4-ii（他Targetの操作で充足が変化し、実行順に依存）/ G4-iii（t自身の両軸Ideal sourceを操作）に分け、「対象Targetが開始時点でIdeal」と「そのTarget自身がIdeal sourceへ追加操作する」を区別した（§3.3 / §3.6）。A-2の両軸Ideal source除外は前提P1〜P3に依存するので確定事項から外し、A-2の判断事項とした（§6.1 / §8.2 / §9.2）。G4のtest計画に状態遷移ケース（G4-iiの(a)〜(d)）を追加し（§9.3）、D-0B診断は開始時点のIdealだけを理由に候補を不成立・恒久除外に分類しないとした（§9.1 / §8.1） |
| Required fix 2 | 推奨のB-iが、Candidate / Entryを正規のProduction Search結果から作るという設計 §9.4の契約と整合するように読めた | B-iはProduction Search APIの配送Candidateを採用する方式ではなく、§9.4の現行契約の外にあることを明記し、外れる範囲を表にした（§7.2.1）。採用するにはResearch専用materialization経路の契約を §9.4とは別に定義・承認する必要があること、その契約の最低限の項目、利用できるProduction authorityとResearch側の新規責務と未確認の実現性、parity testで確認できる範囲と継続Routeを別途検証する手順（全operationの独立予測、Counter / coverage検査、Candidate validation、unit plan、Planner / Trace Replay。`validateBuildRoute()` の通過だけで同等としない）を整理した（§7.2.1 / §9.3）。B-iは第一候補に留めて採用を確定せず、B-i / B-iiの最終選択をD-0A-2設計PRへ委ねた（§7.5 / §8 / §9）。§9.4本文は変更せず、変更する場合の整理を §10に置いた |

定理T、Phase B / Cの証明、G1〜G3の内容、案A / 案Cの評価は変更していない。
