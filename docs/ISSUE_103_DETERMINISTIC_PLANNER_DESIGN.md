# Issue #103 決定的Planner scheduling 詳細設計

作成日: 2026-09-24。基準main: `9c48b23ecc59360769f9c608ccc2df8f0622f147`（PR #107 merge後）。

## 0. 位置づけとauthority

この文書は Issue #103「大量Build List時のPlanner探索戦略を再設計する」の
**実装時のtask-specific detailed spec（次期Planner契約）** である。PR #107の計測記録
（[ISSUE_103_PLANNER_SEARCH_INSTRUMENTATION.md](./ISSUE_103_PLANNER_SEARCH_INSTRUMENTATION.md)）
を入力とし、次の実装フェーズで採用する通常Plannerの契約を定義する。

中心契約は次の1文である。

> 同じTargetに複数Routeを永続保持してPlannerが選ぶのではなく、ユーザーが現在採用したRouteを
> Build Listに1件だけ保持し、PlannerはそのRouteをscheduleする。

```text
Phase C以前（旧Production）
  - 通常Plannerは上限付きBeam Search
  - 永続Build Listは同一Targetに複数Entryを保持し得た

現行Production（Phase 0 / Phase C実装済み）
  - 永続Build Listは1 Targetにつき最大1 Entry（Build List cardinality契約）
  - 通常Plannerは「Route commitment + 決定的scheduling」（REQUIREMENTS 19 / 20、PLANNER_SPEC 7）
  - Beam Searchはtest / benchmark / parity oracleとしてだけ残す（Phase Dで整理）
```

authorityの配置:

| 契約 | authority | 状態 |
| --- | --- | --- |
| 永続Build Listの1 Target = 最大1 Entry、Candidate追加時の置換、legacy duplicateのfail closed | [REQUIREMENTS.md](./REQUIREMENTS.md) 18、[DATA_MODEL.md](./DATA_MODEL.md) 9.4.1 | **実装済み**（Phase 0-1: Domain / Service基盤、通常Planner入力のfail closed、Import / Exportの保持。Phase 0-2: Search画面の置換確認、Build Listのlegacy duplicate案内。Phase 0-3: constrained re-search / what-if / 再計画の置換） |
| Search画面からの追加 / 置換 | [SEARCH_SPEC.md](./SEARCH_SPEC.md) 10.1、[UI_FLOW.md](./UI_FLOW.md) 9 / 10 | **実装済み**（Phase 0-1: Service結果型と置換API、Phase 0-2: 画面の置換確認Dialog / 案内） |
| constrained re-search / what-if / 再計画とBuild List cardinality | [PLANNER_SPEC.md](./PLANNER_SPEC.md) 9.2.18 | **実装済み**（Phase 0-3） |
| 決定的scheduler（Route commitment、scheduling、termination、schema境界） | 本書、[REQUIREMENTS.md](./REQUIREMENTS.md) 19 / 20、[PLANNER_SPEC.md](./PLANNER_SPEC.md) 7 | **Production実装済み**（Phase A: Domain、Phase B: parity / instrumentation / 実Browser計測・semantic fix、Phase C: Production routing切替・Calculation schema 14・正式仕様改訂）。次はPhase D（UI / legacy / Beam oracle整理） |

- 本書の追加時点で `src/**`、テスト、schema version、Worker protocol、UIは一切変更していない
- Build List cardinalityは **Build List自体の契約** であり、Plannerの都合ではない。したがって
  REQUIREMENTS / DATA_MODELを正式authorityとし、実装状態を明示した次期契約として先に記載した
  （Execution lifecycle改訂、B8-A、B9-A2と同じ「仕様先行・実装後続」の手順）。現行Productionは
  各節の「現行Production」注記どおりに動作し、Phase 0の実装PRで注記を外す
- 決定的scheduler自体は、Production routingを切り替えた実装PR（Phase C）で
  REQUIREMENTS 18 / 19 / 20、PLANNER_SPEC 7 / 7.2 / 7.2.1 / 7.3 / 7.4 / 7.6 / 10 / 14 / 15.3、UI_FLOW 10.0、
  DATA_MODEL 3.5、`AGENTS.md` の「Calculation Context」「Planner Search Strategy」を改訂して正式化した
  （本節冒頭の「本書の追加時点」の記述は、本書を追加したPR #108時点の記録である）
- 本書が変更しない既存契約（Candidate Search、Trace Replay、PlanStep / Execution、
  constrained re-searchの固定authority、checkpoint hard constraint等）は、該当する正式仕様を
  そのままauthorityとする

---

## 1. PR #107計測から分かったこと

### 1.1 観測事実（representative-35、`1000 / 200000 / 50`）

| 項目 | 値 |
| --- | --- |
| termination | `incomplete`（`max_expanded_states`）、完成 13 / 35 |
| generated successors | 200,000（1 depthあたり平均1,258、successors per expanded state 25.52） |
| semantic dedup | **0.0%** |
| progress projection merge | **99.1%**（trace-free projectionは69.0%） |
| kept beam distinct progress | depth 7以降、代表depthでほぼ **1** |
| beam trim | 96.0% |
| 時間 | `dedupAndTrim` 69.9%、`applyAction` 25.5%、`successorEvaluation` 3.2% |
| conflict unique | 12（`same_gogma_counter` 6 / `same_skill_counter` 6） |
| shared physical action | 0件（各Entryが別の所持Gogmaを使うため） |
| silent fast-forward | 1 successorあたり約12 unit |
| trim境界 | depth 7以降の150 / 152 depthでkept beam全件が同score。境界はtie-breakで決まる |

実データ（Issue #103コメント、本Repositoryに含まない）は `8 / 35`、合成fixtureは `13 / 35` である。

### 1.2 解釈（観測事実と一般化可能な判断の区別）

一般化してよい判断:

- 現行Beam Searchは、**意味のある選択よりも交換可能な操作順の保持に大部分の計算を使っている
  可能性が高い**。successor数は競合数ではなく「未完了で実行可能なEntry-lane数 × beam」に比例し
  （観測事実3 / 6）、conflictが12件しか無いのに毎depth約1,000〜2,000 successorを生成した
- 既存semantic keyはtrace projectionを含むため、実行順だけが違うsuccessorを1件も合流させない
  （dedup 0%）。その結果、beam 50件は同じ進捗をもつ順序違いで埋まり、trimは同点tie-breakで決まる
- この「操作順branch爆発」は探索構造そのものの性質であり、fixture固有の比率に依存しない

一般化してはいけない事項:

- progress projectionの99.1%は **診断用射影** であり、semantic equivalenceの証明ではない。
  「99.1%をそのままdedupして安全」とは言えない。どのweaponが実際に操作されたか、
  source mutation version、in-flight、weapon switch、preferred source、improvement preferenceが
  将来の実行可能性やPlan品質に影響しないことは射影からは示せない
- fixtureの完成数・時間・比率を実データへ一般化しない。実データの完成数はfixtureより低く、
  Entry構成も異なる
- 「conflictが少ない」はfixtureの観測である。実データのconflict数は未計測である

### 1.3 Beamの微調整ではなく責務再設計を選ぶ理由

| 案 | 判断 |
| --- | --- |
| beamWidth / maxExpandedStates を上げる | 観測上、状態数はdepthに比例して線形に消費され、完成数もdepthにほぼ比例する。予算を増やしても1 stepあたり約1,000 successorの浪費は変わらない。不採用 |
| semantic keyからtraceを外す | 1.2のとおり安全性の証明が無い。weapon switch / preferred source / improvement preferenceの値がtraceの純関数であるという現行dedupの前提（PLANNER_SPEC 7.3 / 7.4 / 7.6）も崩れる。単独では不採用（11章） |
| scoring / tie-break調整 | trimで完成数の多いstateが落ちたdepthは0。scoringは原因ではない。不採用 |
| dedup / sortの高速化（計測の候補G） | 定数倍の改善にとどまり、branch数自体は減らない。本設計採用後は通常経路で不要になる |
| **Build List cardinality + Route commitment + 決定的scheduling** | Candidate Routeは既に具体的なCounter位置まで確定しており、Build Listが1 Targetにつき1 Routeなら、残る自由度の大半は「交換可能な操作順」である。これを探索せずcanonicalに決める。**採用** |

---

## 2. 責務分離

### 2.1 Candidate SearchとBuild List

Candidate Searchは「1 Targetを現在状態から作るcanonical Ideal Route」を求める
（[SEARCH_SPEC.md](./SEARCH_SPEC.md) 5.6 / 5.7）。BuildListEntryへ追加された時点で次が確定している。

- source OwnedWeapon（またはnull source / blind forge）
- Normal forge（`count`、Counter位置）
- conversion（Skill Counter位置）
- Reset Bonuses / Keep Bonuses（Gogma Counter位置）
- Reset Skills（Skill Counter位置）
- selected compromise checkpoint（`intermediateStateSelection`）
- final Ideal（Candidate Snapshotの最終結果）

**Build Listは、Targetごとに「ユーザーが現在採用したRoute」を最大1件だけ保持する**
（DATA_MODEL 9.4.1）。別Candidateを採用したい場合は、Entryを並べて保持するのではなく、
確認のうえ既存Entryを新Candidateで置換する（SEARCH_SPEC 10.1）。どのRouteを使うかは
ユーザーの選択であり、Plannerの選択ではない。

### 2.2 Planner

Plannerの主責務を次とする。

```text
複数TargetのBuildRoute（各Target 1本）を、
共有Counter / Inventory / physical weapon制約のもとで
同時に成立させる実行順を作る
```

通常Plannerは **Route探索でもRoute選択でもなく、Route scheduling** を中心責務とする。
Plannerが決めるのは次の2つだけである。

- **Route commitment**（6章）: 真に両立しないRoute同士（競合）について、そのrunでどれを実行し
  どれを実行しないか。同一Targetの複数Entryから選ぶ処理は通常経路に存在しない
- **scheduling**（7章）: commitしたRouteの操作をどの順に実行するか

### 2.3 constrained re-search / what-if

選択済みRoute同士が真に両立せず、ユーザーが競合の優先側を明示選択した場合だけ、失う側Targetの
代替Ideal Routeを探す責務を既存constrained re-search（PLANNER_SPEC 9.2）へ残す。what-if（9.2.4）も
同じである。通常Plannerは代替Route探索を内包しない。代替Routeが採用された場合、失う側Targetの
永続Entryはその生成Entryで置換され、Build Listは再び1 Targetにつき1件になる（PLANNER_SPEC 9.2.18）。
#101（constrained searchの探索範囲）は本書で変更しない。

---

## 3. 構造的前提

本設計は、既存仕様から導かれる次の構造に依拠する。3.1〜3.3は本書で新しく定めるものではない。

### 3.1 Route unitの位置は絶対値である

`PlannerRouteUnit` は保存済み `RouteOperation` から `counterStream`、`counterBefore`、
`counterAfter` を持ち（`createPlannerRouteUnitPlans()`）、counter preconditionは
`current === counterBefore` の完全一致である（`counter_before_current` / `counter_unavailable`）。
Counterは単調増加しかしない。blind forgeだけがCounter位置を持たない（PLANNER_SPEC 7.0.2
「Counter位置を持たないRoute unit」）。設計記録
[CANDIDATE_SEARCH_REDESIGN.md](./CANDIDATE_SEARCH_REDESIGN.md) 1.5 も
「BuildRouteは位置固定であり、Plannerが再タイミングすることはできない」と記録している。

### 3.2 Routeは各streamで起点から連続する

- Skill列は `skillCounterBefore + i` の各位置で1回ずつ使う（SEARCH_SPEC 5.5.2）。conversionは
  起点位置 `skillAt[0]` で行い、Reset Skillsは以後の連続位置である
- Bonus列のdepth `d` は Gogma位置 `gogmaCounterBefore + d - 1` で行う（SEARCH_SPEC 5.5.3）。
  したがってBonus laneは起点から結果位置まで毎位置1操作を持つ
- predicted forgeは `normalCounterBefore ... normalCounterAfter - 1` の各位置を持つ（SEARCH_SPEC 6.1）
- 1 Target用のRouteは単独で物理実行可能でなければならないため、途中位置を他Routeに頼らない
- Planner入力のvalid Entryは `searchStateHash` 一致を要求される（stale判定）。constrained
  re-searchの生成Entryも Planner開始時点の起点から作る（PLANNER_SPEC 9.2.1）。よって同じrunの
  valid Entryは同じstream起点を共有する

帰結として、**あるstreamの現在位置 `c` に、そのstreamをまだ使い終えていない各Entryのunitが
ちょうど1つずつ存在する**。

### 3.3 各stream位置はちょうど1回だけ物理的に消費される

現在位置 `c` の物理操作は1回だけであり、その操作を受けるunit（共有可能ならその集合）以外の
`c` 上のunitは、skip可能ならsilent fast-forwardされ、skip不可なら以後実行できなくなる
（PLANNER_SPEC 7.0.2）。したがって実行順の自由度は次の2種類だけである。

1. skip可能unitしかない位置で、**どのEntryの武器でその位置を消費するか**（executor選択）
2. **stream間のinterleave**（Gogma / Skill / 武器種別Normal / blind forge）

どちらも、commitしたEntry集合が同じならCounter進行、各RouteのCandidate結果、Target完成集合、
物理操作数を変えない（7.9）。変わるのはStep順、weapon switch、improvement preference違反数、
in-flight期間だけである。現行Beam Searchが大量に生成していたのは主にこの2種類のbranchである。

### 3.4 Build List cardinality（次期契約）

通常Planner入力は永続Build Listをそのまま継承するため、**1 planning Targetにつきvalid Entryは
0..1件** である（DATA_MODEL 9.4.1）。同一Targetの複数Entryはconstrained re-search / what-ifの
temporary augmented inputにだけ現れ、その扱いは6.4で別に定める。

### 3.5 前提が崩れた場合

3.2は仕様から導かれるが、schedulerはそれを **正しさの前提にしない**。frontierは常に実際の
`counterBefore` で判定し、あるstreamの現在位置にcommit済みunitが1つも無いのに後方位置の
unitが残る（gap）場合は7.8のstall処理でfail closedする。3.2は性能見積もり（静的操作数）と
説明にだけ使う。3.4は通常Planner入力validationで検証し（6.2）、違反はfail closedする。

---

## 4. 新しい全体フロー

```text
Persisted Build List
  1 Target = 最大1 Entry（DATA_MODEL 9.4.1）
        ↓
ordinary Planner
  preparePlannerInitialContext()        既存（validation、planning Target、route unit / lane、
                                        checkpoint requirements、initial conflict detection）
                                        + Build List cardinalityのfail-closed検証（Phase 0）
  zero-operation confirm                既存の開始時適用（confirm_owned_ideal）
        ↓
TargetごとのRouteは既に確定（各Target 0..1本）
        ↓
Conflict / dependency解析（Route commitment、6章）
  - explicit ConflictResolutionの適用
  - 未解決競合の暫定帰結
        ↓
deterministic scheduling（7章）
  1 schedule state → canonicalな次操作1つ
  loop:
    frontier算出 → required / skippable / holding判定 → safe actionの列挙
    canonical順で1つ適用（共有progression、fast-forward）
    完成したEntryのreserve（即時・必須）
    relevance / commitment更新（動的イベント）
        ↓
既存Trace Replay → execution projection → ProductionPlan生成（変更しない）
        ↓
競合なし
  → Plan完成（completed）
競合あり
  → Conflict提示（暫定帰結つきDraft、exhausted）
  → ユーザーが優先側を選択（PlannerConflictResolution）
  → losing Targetだけconstrained re-search（既存B8）
  → temporary generated Entryで再計画（元Entry + generated Entryを一時的に保持、6.4）
  → 成立すればold Entryをgenerated Entryで置換して保存（PLANNER_SPEC 9.2.18）
  → 以後の再計画は再び1 Target = 1 Entryでdeterministic scheduling
```

原則は「1 state → 多数successor → beamWidth件保持」ではなく
「**1 schedule state → canonicalな次操作1つ**」である。

---

## 5. 用語

| 用語 | 定義 |
| --- | --- |
| stream | `gogma`、`skill`、`normal:<NormalArtianCounter ID>`。blind forgeはstreamを持たない |
| committed Entry | Route commitmentがそのrunで実行すると決めたEntry。scheduleが操作を実行するのはcommitted Entryだけ |
| pending unit | committed Entryのunitのうち未実行かつ未通過のもの |
| frontier `F(σ)` | stream `σ` の現在位置 `c_σ` を `counterBefore` にもつpending unitの集合 |
| ready | そのunitが `nextPlannerLaneUnits()` に含まれ（lane順・base先行・pin gating）、`routeUnitPreconditionRejection()` が無く、ConflictResolutionでblockされていない |
| skippable（position-passable） | `canSkipWhenCounterPassed === true`。そのCounter位置を他Entryの操作が消費してよい。pinにblockされているかどうかは問わない |
| holding | `canSkipWhenCounterPassed === false` のpending unit（`isPlannerLaneUnitHolding()`）。その位置を他の操作に消費させてはならない。選択checkpointの終端unitは常にskip不可なので（PLANNER_SPEC 7.5.1）常にholding |
| fast-forwardable now | skippableかつ、現在のlane progressでpinにblockされない（`isPlannerLaneUnitFastForwardable()`、`isPlannerLaneUnitBlockedByPin()` がfalse）。`fastForwardPlannerRouteProgress()` が通過させるのはこのunitだけ |
| safe action | 実行してもcommitted Entryのholding unitを1つも失わせないaction（7.3） |
| temporary Entry | constrained re-search / what-ifがmaterializeした、まだ永続化されていないgenerated Entry（6.4） |

holdingは既存7.0.2の「必須unit」そのものであり、**`canSkipWhenCounterPassed` だけで決まる**。
checkpoint pinの現在状態はholding判定に使わない。

pinとCounter位置の保持は別の概念である（PLANNER_SPEC 7.5.2）。

- pinはEntry自身のlane progressを制約するhard constraintである。pin-blockedのunitは実行されず、
  silent fast-forwardでもその時点ではpinを越えない
- pin-blockedのskippable unitのCounter位置は、別Entryが物理的に消費してよい。その時点ではEntry自身の
  progressはpinで止まったままで、checkpoint到達も前倒しされない
- 後でpinが解除されたとき（もう片方のlaneがpinへ到達したとき）、既に通過済みのCounter位置にある
  skippable unitは `fastForwardPlannerRouteProgress()` が過去位置としてsilent fast-forwardする
- Routeが失われるのは、そのskippable unitの後ろにあるholding unitの位置まで通過された場合だけである。
  それはholding unit自身が位置を保持して防ぐ

旧版の本書はpin-blockedのskippable unitもholdingとして扱っていた（「他Entryが位置を消費すると次回
`counter_before_current` でRouteが失われる」）。Phase Bのparity計測で、Beam Searchがその位置を他Entryの
conversionに消費させ、pin解除後にfast-forwardして両Targetを完成させる（Trace Replay有効）ことが示され、
この根拠は成り立たなかった（[Phase B記録](./ISSUE_103_SCHEDULER_PARITY_BENCHMARK.md) 3.2）。
本版は既存Beam / Trace Replayの意味に合わせて定義を改めた。

---

## 6. Route commitment

### 6.1 目的と境界

Route commitmentは、各planning Target（PLANNER_SPEC 4.1）について、そのrunでRouteを実行するか
どうかを決める。Route（RouteOperation列）は一切変更しない。

- 対象は開始時点で未完了のplanning Targetだけである（`isPlannerTargetComplete()`）。
  開始時点でIdealを持つTarget（required checkpoint Entryがある場合を除く）は従来どおり完了扱い
- commitmentは実行順を決めない。実行順は7章のschedulerが決める
- commitmentの競合判定authorityは既存 `detectPlannerConflicts()`（counter group、
  `same_owned_weapon_consumed`、shareable除外、skip可能unit除外）だけである。
  `usedCounters.has(counter)` のような簡易判定を追加しない（PLANNER_SPEC 9.2.2 / 9.2.11）

### 6.2 ordinary persisted PlannerInput: 各Targetの候補は0..1件

旧版の本書は、同一Targetの複数Entryを
`required checkpoint → explicit resolution → estimatedOperationCount → preferred source → stable ID`
の順で比較する一般規則 `L(T)` を持っていた。Build List cardinality契約（DATA_MODEL 9.4.1）により
通常Planner入力には同一Targetの複数Entryが存在しないため、**この一般規則を廃止する**。

```text
ordinary PlannerInput:
  L(T) = T のvalid persisted Entry（0..1件）
  除外:
    - 有効なConflictResolutionにより、holding unit（skip不可unit）が1つでもblockされるEntry
      （isUnitBlockedByConflictResolution() の既存semantics。そのEntryは完成できない）
    - 開始時点で既にholding unitが通過済みのEntry（counter_before_current）
    - holding unitのsource weaponが無い・保護・version不一致のEntry（既存reason）
  除外された場合、Tはこのrunで完成しない（別Routeを探さない）
```

判定対象はholding unit（`canSkipWhenCounterPassed === false`）だけである。skippable unitは、pin-blocked
かどうかにかかわらず、Counterが通過済みでも、resolutionで非選択側participantになる競合に属していても、
それだけでEntryを除外する理由にならない（`detectPlannerConflicts()` もskippable unitをCounter conflictの
participantにしない）。例えば開始時点で

```text
pin-blocked
canSkipWhenCounterPassed = true
counterBefore < currentCounter
```

のunitを持つEntryは、そのunitを理由に `counter_before_current` でも `conflict_resolution_not_selected`
でも落とさない。そのunitはpin解除後にfast-forwardされる。後ろのholding unitまで通過済みなら、そのholding
unitを理由にfail closedする。Routeの最後のunitは常にholdingで、同じRouteのunitは同じsource weaponを
操作するため、source / version / protectionの検査はholding unitだけでRoute全体を覆う。

- Plannerは `estimatedOperationCount`、preferred source、Entry IDを理由に同一Targetの別Routeへ
  差し替えない。そもそも比較対象が無い
- required checkpoint Entry（7.5.6）は、そのTargetの唯一のEntryそのものである。
  「同じTargetの他のEntryを候補から外す」処理と `selected_checkpoint_fixes_target_entry` は
  通常入力では発生しない。1 Targetにつき選択Entry最大1件（7.5.7）も通常入力では自明に満たされる。
  どちらもlegacy / malformed入力への防御として残す

**fail-closed防御（「あり得ないからvalidation不要」としない）。** ordinary PlannerInputで同一
planning Targetのvalid Entryが2件以上ある場合（Phase 0導入前のlegacy duplicate、Import、別タブ、
malformed入力）は、Planner入力validationがPlanner入力全体をfail closedする（validation issue +
専用warning。kind名はPhase 0で確定する）。どれかを選んで続行しない。これはDATA_MODEL 9.4.1の
legacy duplicate方針と同じである。

### 6.3 ConflictResolutionとの関係

- **explicit resolutionがある競合**（`PlanConflict.selectedBuildListEntryId` が既存規則で
  適用された初期競合）では、非選択participantのholding unitがblockされ、そのEntryは6.2の除外に
  より実行されない。選択Entryはそれ自身のTargetの唯一のEntryなので、特別な優先規則を持たない
- **同一Targetの異なるEntryを選択するresolution集合は、ordinary persisted PlannerInputでは
  collection invariant上成立しない**。1 Targetに1 Entryしか無いためである。旧版で指摘された
  「Conflict X → A1、Conflict Y → A2」の矛盾はBuild Listの上位契約で防止される
- それでもmalformed入力（legacy duplicate、Import、temporary augmented input）への防御として、
  有効なresolution集合が同一Targetの異なるEntryを選択している場合はPlanner入力をfail closedする
  （どちらかを推測して採らない）。ordinary入力では6.2のduplicate検証が先に失敗させる
- generated Entryはfixed側へ昇格しない（PLANNER_SPEC 9.2.3.1）ため、resolutionが選択するのは
  常にpersisted Entryである

### 6.4 temporary augmented input（constrained re-search / what-if）

constrained re-search / what-ifは、失う側Target `B` について元Entry `B1`（persisted）と
temporary Entry `B2`（generated trial）を同時に持つaugmented PlannerInputを作る。
これはBuild List cardinalityの **唯一の例外** であり、永続化されない（PLANNER_SPEC 9.2.18）。

```text
augmented input（1 Targetあたり）:
  persisted Entry 0..1件 + temporary Entry 0..1件
  それ以外（temporary 2件以上、persisted 2件以上）はfail closed

Targetの実行候補:
  temporary Entryがあれば、それだけ（B2）
  無ければ persisted Entry（通常どおり）
```

- どのEntryがtemporaryかは、orchestration（B8 / B9）がPlanner内部の非永続情報として渡す。
  BuildListEntryにprovenance fieldを追加せず、Worker public requestやUIから渡さない
- `B1` はpreflightでユーザーのfixed constraintを再対応付けするためだけに存在する
  （PLANNER_SPEC 9.2.3.1）。B8の作業は `B1` が明示resolutionで非選択になった競合からだけ生じる
  ため、`B1` は実行・progress・secureの候補にならない
- Planの計算と記録は **置換後のEntry集合**（`B1` を `B2` で置き換えた集合）に対して行う
  （PLANNER_SPEC 9.2.18）。commitment、scheduling、返す `conflicts`、`rejectedBuildListEntries`、
  `PlanningInputSnapshot` は `B1` を含まない。これにより、採用時に `B1` を削除しても保存された
  Planが削除済みEntryを参照しない
- 置換後集合での競合は通常どおり6.5で扱う。`B2` が別の競合で暫定敗者になれば `B2` はselected
  にならず、B8のadoption条件（9.2.14）を満たさないのでtrialは不採用になる
- **通常Planner用の一般的なcost rankingと、constrained trialの選択を混同しない。** trialで
  `B2` を検証対象にする根拠は「B8 orchestrationがこのTargetの代替として `B2` をmaterializeした」
  ことだけであり、`B1` との操作数比較やpreferred sourceではない

### 6.5 静的競合と暫定帰結

commit候補集合（各Targetの実行候補Entry）の中で `detectPlannerConflicts()` が競合を検出した
場合を **collision** と呼ぶ。collisionは位置が絶対値なので静的に決まる（3.1）。

**explicit resolutionが無い競合**は、ユーザー判断待ちの競合として `PlanConflict` で返しつつ、
Draftを作るために **暫定帰結（provisional outcome）** を決める（8.3で理由を述べる）。各Targetの
候補が1件なので、暫定帰結は「どのTargetのRouteをこのrunで実行しないか」の決定だけになる。

```text
順位関数 R: 既存 recommendEntry() のcomparatorを共有helperへ抽出したもの
  Target priority 降順
  → nextCandidateDistance(entry, initialRelevantEntries) 降順
     （既存の初期競合検出が recommendEntry() へ渡すEntry集合と同じ。
      通常入力では同一Targetの別Entryが無いので常に0になり、実質的に効かない）
  → estimatedOperationCount 昇順
  → BuildListEntry ID 昇順
  （各Entryのkeyはparticipant集合に依存しない。したがって暫定勝者は、
   返す競合（8.5）の推奨participantと一致する）

candidates = 各Targetの実行候補Entry（6.2 / 6.4）
decided = ∅
loop:
  C = candidatesでのcollision（detectPlannerConflicts）
  C が空なら終了
  E* = C のparticipantのうち、未decidedで R が最良のEntry
  decided に E* を加える
  E* とcollisionする各未decided Entry F を candidates から外す
    （Fのtargetはこのrunで完成しない。rejectionは8.4）
committed = candidates
```

- 停止性: 各反復でEntryを1件decidedにするか、candidatesから外す。有限である
- decidedになったEntryは以後外さない
- 同一Targetの代替Routeが無いので、旧版にあった「勝者側を代替Routeへ移す損失回避」は不要になった
- 優先度の高いTargetが先に資源を確保する。これはREQUIREMENTS 20の1「理想品未所持の目標武器の
  理想品を、優先度順に早く揃える」と、既存recommendationの第1 keyに一致する。完成Target数を
  最大化する厳密解（conflict graphの最大重み独立集合）は保証せず、Can defer（19.2）とする
- `same_owned_weapon_consumed` も同じ手続きで扱う。同じ武器を破壊的に使う2 Entryは、
  全unitが1つのshareable actionである退化ケースを除きcollisionである（既存
  `consumedWeaponGroups()`）

### 6.6 checkpointとの関係

- required checkpoint EntryはそのTargetの唯一のEntryであり、collisionで敗者になればTargetは
  このrunで完成しない。別Routeへ自動差し替えしない（7.5.6 / 9.5.2）。constrained re-searchも
  そのTargetを再検索しないので、temporary Entryも生じない
- checkpoint participantを含む競合は、既存どおりexplicit resolutionを拒否する
  （`conflictResolutionRefusalReason()`、9.5.1）。暫定帰結は6.5の手続きで決まるが、
  それは永続的な解決ではなく、解決手段はBuild Listでの選択変更だけという契約は変わらない
- checkpointを `hasIdeal` だけで完了扱いにしない（`isPlannerTargetComplete()` を使う）

### 6.7 preferred sourceの扱い

`TargetWeapon.preferredOwnedWeaponId` の既存正式semanticsと、各層に残す責務:

| 層 | 既存semantics | Target design |
| --- | --- | --- |
| Candidate Search | canonical Idealのtie-break（SEARCH_SPEC 8.1）。同等のIdealでpreferred起点を選ぶ | **維持**。ユーザーが採用するRouteはここで決まる |
| constrained enumeration | streaming delivery順のtie-break（SEARCH_SPEC 8.1） | **維持**。B8が生成する代替Routeの選び方として残る |
| Candidate表示 / Target画面 | 優先起点の表示・選択UI | **維持** |
| Build List登録 | 使わない | 使わない。どのCandidateを採用するかはユーザーが置換確認で決める |
| 通常Planner | Beam Searchのplan preference（PLANNER_SPEC 7.4、`preferredSourceProgressCount`）。同評価のbranchでpreferred起点のRouteを進めたものを優先 | **撤去**。各Targetに1 Routeしか無いため、preferredを理由に選べるRouteが存在しない。schedulerの実行順にも使わない |
| Planning input hash / Execution | `targetWeaponsHash`、Plan start effect（16.11）、完成時の解除 | **維持**（Plannerの判断とは無関係） |

- PLANNER_SPEC 7.4の「Planner側のPlan preference」を通常Plannerから撤去することは、**既存正式仕様の
  変更** である。Phase C（scheduler切替）でPLANNER_SPEC 7.4とREQUIREMENTS 9 / 18の「優先起点はPlanner実行時の
  計画入力」の記述を「Candidate Search / constrained enumerationの入力、およびplanning input hash」へ
  改訂した（**実装済み**）。Beam Search oracleの内部には `preferredSourceProgressCount` がPhase Dまで残るが、
  Production Planの決定には使われない
- 現行Beam Searchの `preferredSourceProgressCount` は、同一TargetのRoute選択に加えて「skip可能位置を
  preferred Entryの武器で消費したbranch」を残す副作用も持っていた。これはBeam固有のartifactであり、
  引き継がない
- Plannerは `preferredOwnedWeaponId` を理由に別Routeへ勝手に差し替えない（従来どおり、Planner計算は
  preferredを変更もしない）

### 6.8 動的なcommitment更新

schedule中に次が起きた場合だけ、影響Targetについてcommitmentを更新する。

| イベント | 処理 |
| --- | --- |
| committed EntryのTargetが別Entryのreserveで `hasIdeal` になった（required Entryを除く） | そのEntryを解放する（以後そのunitはholdingしない）。現行relevance（`entryIsRelevantForState()`）と同じ |
| committed Entryの実行前提が崩れた（inventory、source version、protection、holding unitの位置が通過済み） | そのEntryを失敗とし、既存rejection reasonを記録する。代替Routeは無いのでTargetはこのrunで完成しない |
| in-flight化によりplanning Targetの `hasIdeal` がfalseへ戻った | そのTargetのEntryが未commitで、現在状態で実行可能（未実行のholding unitがすべて現在位置以降、source / version / protectionが成立）かつ現在のcommitted集合とcollisionしないならcommitする。既存のcommitted Entryを押し出さない |
| 7.8のdeadlock / stallでEntryを落とした | そのTargetはこのrunで完成しない |

「holding unitの位置が通過済み」は、各laneの **frontier unit**（lane先頭から、Counterが既に通過した
skippable unitを飛ばした最初のunit）で判定する。lane先頭が過去位置のskippable unitであっても、それ自体は
失敗理由にしない。そのunitがpin-blockedでまだfast-forwardされていない間も、後ろのholding unitは
frontier unitとして見えるので、そのholding unitの位置が通過されていれば失敗とする。pin-blockedでない過去位置の
skippable unitは、既に `fastForwardPlannerRouteProgress()` が通過させている。

---

## 7. 決定的scheduling

### 7.1 State

stateは既存 `PlannerSearchState` をそのまま使う（10章）。schedulerは単一stateを前進させる
ため、Beam Searchのようにactionごとにstate全体を `structuredClone()` する必要は無い。
状態遷移は既存関数（`applyRouteAction()` / `applyReserveAction()` /
`fastForwardPlannerRouteProgress()` / precondition群）を共有helperへ抽出して再利用し、
同じ遷移authorityをBeam SearchとTrace Replayと共有する（二重実装しない）。

### 7.2 frontier

各stream `σ` について `F(σ) = { committed Entryのpending unit u | u.counterBefore === c_σ }`。
blind forgeは、そのEntryのbase lane先頭がblind `create_normal_artian` であるときfrontierに入る。

laneは連続するので、各laneで `c_σ` にあるpending unitはlaneのfrontier unit（5章、6.8）である。通常は
lane先頭だが、lane先頭がpin-blockedのskippable unitで、その位置を他Entryが既に消費した場合は、その後ろの
最初の未通過unitになる。pin-blockedのunitの後ろに隠れたholding unitも、こうしてfrontierに入り位置を保持する。

現行契約との対応:

| frontier条件 | 既存authority |
| --- | --- |
| Route内の前提unitが完了済み（base先行、lane順） | `nextPlannerLaneUnits()` |
| Counter位置がcurrent | `counterPreconditionRejection()`（`current === counterBefore`） |
| source weaponが利用可能、保護されていない | `inventoryPreconditionRejection()` |
| source versionが一致 | `entryUsesCurrentSourceVersion()` |
| selected checkpoint契約を壊さない | `isPlannerLaneUnitBlockedByPin()`、reserveの `selected_checkpoint_not_reached` |
| conflict resolutionでblockされない | `isUnitBlockedByConflictResolution()` |

Route lane semantics（PLANNER_SPEC 7.0.4）はそのまま再利用する。laneは永続化しない。

### 7.3 safe action

候補actionは次のいずれかである。

1. **holding unitの実行**: `F(σ)` にholding unitがあり、それがreadyな1つのphysical action
   （`arePlannerRouteUnitsShareable()` で共有される集合を含む）であるとき、それだけが
   `σ` の候補である
2. **executor選択**: `F(σ)` にholding unitが無いとき、`F(σ)` のreadyなskippable unitを1つ
   executorとして実行する候補が、executorごとに1つずつある
3. **blind forge**: readyかつ、そのNormal Counterが確定（`isConfirmed && counter !== null`）なら
   `normal:<その武器種>` にpending unitが1つも無いとき（未確定なら常に）

safeの条件は「実行後、`F(σ)` のうちそのactionで進まなかったunitがすべてskippable」である。
1ではholding unitが2つ以上のphysical actionに分かれることはない（6章のcommitmentがcollisionを
排除している）。holding unitがreadyでない場合、その位置は **待つ**。

pin-blockedのskippable unitは `holding = false`、`ready = false` である。

- 同じstream・同じ位置に別のready unitがあれば、それが位置を消費できる（holding unitがあれば1、無ければ2）。
  pin-blocked側のRoute progressはその時点では進まない
- その位置にpin-blockedのskippable unitしか無ければ、それ自身はreadyでないので実行しない。holdingでも
  ないが、そのstreamは一旦進まず、他streamのsafe actionを進めてpin解除を待つ。pin解除後、Counterが
  まだその位置ならunitを通常どおり実行でき、既に通過していればsilent fast-forwardされる
blind forgeの条件は、確定Normal Counterを1進めることでpredicted forgeのholding位置を失わせない
ためである（PLANNER_SPEC 7.0.2「Counter位置を持たないRoute unit」の「この実行順はBeam Searchの
探索が決める」を、決定的な待機規則へ置き換える）。

### 7.4 required unitとskippable unit

同一Counter位置で

```text
Target A: Gogma C50 required
Target B: Gogma C50 skippable
Target C: Gogma C50 skippable
```

なら、候補は「Aを実行」だけである。Aの実行でCounterがC51へ進み、B / Cは
`fastForwardPlannerRouteProgress()` でsilent fast-forwardされる。
「Bを実行するbranch」「Cを実行するbranch」は生成しない。これは既存の
「required unitが存在するCounter位置では、それを失わせるskip可能unitを展開しない」
（PLANNER_SPEC 7.0.2）をそのまま維持し、さらに **readyでないholding unitにも位置を保持させる**
点だけを強める。現行の支配判定はreadyなrequired unitだけを対象にしていたが、それは
Beam Searchが「待つbranch」を別に保持していたから成立していた。決定的schedulerは待つ規則として
これを明示する。

Bがpin-blockedでも、Counter位置の保持という意味では同じである（Bはholdingでない）。違いは、Aの実行で
CounterがC51へ進んだその瞬間にはBのprogressをfast-forwardせず、pin解除後に過去位置として通過させる
ことだけである。

### 7.5 physical action sharing

既存PLANNER_SPEC 7.0の契約を弱めない。

- 共有の判定は `physicalActionKey` と `shareable`（`arePlannerRouteUnitsShareable()`）だけで行う。
  同じCounter位置だけではshareableではない
- concrete OwnedWeaponの同一operation type・同一Counter遷移だけがshareableである。null sourceは
  Entry-local transient subjectであり、別Entryと共有しない。create Normal、conversion、blind forgeは共有しない
- shareableなら1 physical actionで、そのactionを次unitとしてもつ **committed Entry** をすべて
  progressし、`progressedBuildListEntryIds` へ記録する（`mergedProgressedEntries()` の範囲を
  committed Entryへ限定する）
- 同一concrete OwnedWeaponを使うEntry同士は、全unitが1つのshareable actionである退化ケースを
  除き `same_owned_weapon_consumed` でcollisionするため、committed集合内での共有は実際には稀である
  （PR #107でも0件）。それでも共有semanticsとsource version共有規則はそのまま保持する

### 7.6 reserve

Entryの最後のphysical unitを実行した直後、そのEntryが現在もrelevant（`entryIsRelevantForState()`）
なら、既存 `applyReserveAction()` で **即時・必須** にreserveする（PLANNER_SPEC 16.3）。
同じactionで複数Entryが完成した場合はEntry ID順とする。

- 現行Beam Searchは「reserveしないbranch」も保持していた。これは同じ武器を別Entryが続けて操作する
  場合のためだったが、その状況は `same_owned_weapon_consumed` の競合であり、commitmentが
  片方だけをcommitする。したがってschedulerはreserveを分岐にしない
- ConflictResolutionで非選択になったEntryは6.2で除外されているため、共有actionで偶然完成しても
  reserveされない。現行Beam Searchではreserve分岐が非選択側を完成させ得たが、本設計では
  resolutionを「その競合で選択Entryを採用し相反Entryを採用しない」（PLANNER_SPEC 9）に一致させる
- checkpoint未到達のreserve拒否（7.5.3）はそのまま適用する

### 7.7 canonical action ordering

safe actionが複数あるとき、次のkeyの辞書式順で1つだけ選ぶ（小さいほど優先）。

| 順 | key | 根拠 |
| --- | --- | --- |
| 1 | そのactionが進めるcommitted EntryのTarget priorityの最大値（降順） | REQUIREMENTS 20の1「理想品を優先度順に早く揃える」 |
| 2 | improvement preference違反を新たに生じるか（生じない方） | PLANNER_SPEC 7.6。違反の定義は現行 `improvementPreferenceViolationCount` と同じ |
| 3 | weapon switchを新たに生じるか（生じない方） | PLANNER_SPEC 7.3。subjectは `plannerWeaponOperationSubjectKey()`、null subjectは切替に数えない |
| 4 | executor選択時: executor Entryの次のholding unit（`canSkipWhenCounterPassed === false`。pinの現在状態は距離に含めない）が同じstream上で近い方 | 近くその武器を操作する必要があるEntryで位置を消費し、後続の切替を減らす |
| 5 | actionが進めるEntryの残りpending unit数（少ない方） | 完成に近いRouteを先に終える |
| 6 | stable: stream順（Normal（`normal:*`）/ blind forge → Skill → Gogma）、Counter位置、primary Entry ID | 決定性 |

- Target priority、improvement preference、weapon switchはいずれも **1 Target = 1 Entryでも意味を
  持つ** soft preferenceとして残す。Target priorityは複数Targetのsafe action間、improvement preference
  は1つのEntry内のBonus lane / Skill lane間、weapon switchは複数Targetのsafe action間の選択に働く。
  いずれも同一Target内の複数Entry選択とは無関係である
- 1〜3の順はPLANNER_SPEC 7.3 / 7.6の優先順位（Target / 評価 → improvement preference →
  weapon switch → stable）と同じ並びである。preferred sourceは通常Plannerで使わない（6.7）
- **同じ意味のA→B / B→Aを両方探索しない**。7.9のとおり、safe actionの順序はcommitted集合の
  完成可否を変えないので、canonical順で1つ選べば十分である
- 1つのEntryでBonus laneとSkill laneの両方がsafeな場合（シナリオG）、`skill_first` /
  `bonus_first` は2のkeyで優先laneを選ぶ。優先laneがsafeでない（他Entryのholdingや
  pinで待つ）場合は、反対laneを進めてviolationを記録する（soft preferenceであり、hard constraint
  より上位にしない）。`planner` は2で差が付かず、3〜6で決まる。6のstream順（Normal / blind forge →
  Skill → Gogma。したがって同じ条件ならSkill laneがBonus laneより先）は決定性のためのtie-breakであり、
  7.9によりfeasibilityへ影響しないので、PLANNER_SPEC 7.6の「`planner` はBonusを先に試す意味ではない」
  （branchを片側に固定してPlanを破綻させない）という趣旨と矛盾しない
- 上限付きではないが局所的な規則であるため、weapon switch数・violation数の絶対最小は保証しない
  （現行契約と同じ）

### 7.8 待機・deadlock・stall

safe actionが無いのにpending unitが残る場合:

- **deadlock**: 各holding unitがreadyでなく、その前提（base、lane順、pin）が別streamの進行を
  待ち、それが循環している。例（acceptance fixture `true-deadlock`、testで確認済み）:
  - Entry X: 所持NormalをSkill S1でconversion → Gogma C0をReset（C0はRouteの最後のunitでholding）
  - Entry Y: 所持Gogma、Bonus C1をReset、Skill S0をReset Skills（Routeの最後のunitでholding）、
    Skill lane開始状態を選択checkpoint（Skill S0はBonus laneがpinへ届くまでpin-blocked）
  - Entry Z: 所持Gogma、Skill S0〜S2をReset Skills（S0 / S1はskippable、S2がholding）

  Skill S0はYのholding unitが保持し、YはBonus C1を待ち、C1の前のC0はXのholding unitが保持し、XのC0は
  X自身のconversion（S1）を待ち、S1の前のS0はYが保持する。ZのS0はskippableなのでholding位置を消費できない。
  どの順でもX / Yの両方は成立しない（Beam Searchも完成2 / 3でYを完成させない）。順位関数 `R` で最下位の
  Y（priority 1）を落とすと、ZがS0を消費し、Xのconversion、XのC0、ZのS2が進み、X / Zが完成する
- **stall**: あるstreamの現在位置にcommitted unitが無いのに後方位置のpending unitがある（3.5）

**旧版の例はdeadlockではなかった（Phase Bで判明）。** 旧版はここに「Entry XのGogma C5（required）が
X自身のconversion（Skill S10）を待ち、Skill S9はEntry Yのpin解除（Y自身のGogma C7）を待つ。どの順でも
両方は成立しない」という例（acceptance fixture `deadlock`）を挙げていた。そこでYが保持しているとされた
Skill位置のunitはpin-blockedのskippable unitであり、holdingではない（5章）。Xのconversionがその位置を
消費し、Yのprogressはpinで止まり、YのBonus laneがpinへ届いた時点でそのunitはfast-forwardされ、X / Yとも
完成する。Beam SearchはPhase Bでこれを示し、本版のschedulerも同じ結果になる
（[Phase B記録](./ISSUE_103_SCHEDULER_PARITY_BENCHMARK.md) 3.2 / 3.3）。

どちらも、関与するcommitted Entryのうち6.5の順位関数 `R` が最下位のものを1件落とし
（rejectionを記録、8.4）、継続する。落としたTargetはこのrunで完成しない。決定的である。
現行Beam Searchでは同じ状況で一方のRouteが `counter_before_current` で失われ、conflictとしては
報告されなかった。これを新しい `ConflictKind` として報告するかはCan defer（19.2）とする
（`ConflictKind` 追加は永続shapeとUIの変更を伴うため）。

### 7.9 canonical順で十分である理由

safe actionについて次が成り立つ。

- 別streamのsafe action `a`、`b` は可換である。Counterはstreamごとに独立し、lane progressは
  Entryごとに独立し、commitment後のcommitted Entryは互いに別の武器を破壊的に使う（7.5）
- readinessは単調である。actionはlane progressを増やすだけであり、pin gatingはもう片方のlaneの
  progressが増えるほど解除される。reserveによるrelevance解放はholdingを減らすだけである
- holding性はunitの静的な属性（`canSkipWhenCounterPassed`）であり、pin解除やprogressで変わらない
- したがって `a` の実行は `b` のsafetyを壊さない（`b` のstreamの `F` もholding性も変えない）
- 同じ位置のexecutor選択の違いは、Counter・lane progress・Route結果を変えず、どの武器を
  中間操作したか（source version、in-flight、trace）だけを変える

よってsafe actionだけを実行する限り、どの順でもcommitted集合の完成可否は同じであり、
safe actionが尽きてpendingが残る状態はどの順でも到達する真のdeadlockである。
例外はin-flight化による他Targetの充足喪失（6.8）で、追加commitがholdingを増やし得る。
これは所持Idealを保護せず別TargetのRoute起点にしている稀なケースであり（多くは
`confirm_owned_ideal` が開始時に保護する）、parity fixtureで挙動を固定する（16章）。

---

## 8. Conflict

### 8.1 真のCounter Conflict

```text
Route A: Gogma C100、Weapon AへKeep（required）
Route B: Gogma C100、Weapon BへReset（required）
```

両者はshareableでなく、どちらを先に行ってもCounterがC101へ進み他方を失う。順番探索では解決
できないので、commitmentの時点で `same_gogma_counter` のcollisionとして扱う。
`A→...` / `B→...` のbranchを生成しない。Skill（`same_skill_counter`、conversionを含む）、
Normal（`same_normal_counter`、predicted forge）も同じである。blind forgeはCounter位置を
持たないためparticipantにならず、7.3の待機規則で順序だけを決める（現行PLANNER_SPEC 7.0.2
「Counter位置を持たないRoute unit」と同じ区別）。

### 8.2 ConflictResolution

既存のstable Conflict ID（DATA_MODEL 11.8）と `PlannerConflictResolution` の型・適用規則を
変更しない。

```text
ConflictResolutionで選択Entryがある
  → その競合では選択Entryを採用（そのTargetの唯一のEntry）
  → 非選択participantはholding unitがblockされ、実行しない（6.2）
  → schedulerは継続
```

- `recommendedBuildListEntryId`、Planner bestState、Target priority、scoreを固定authorityに
  しない（9.2.7）。暫定帰結（6.5）は固定制約ではなく、ConflictResolutionを生成せず、
  `PlanConflict.selectedBuildListEntryId` は `null` のままである
- 選択が無効な場合（削除済み、stale、非participant、checkpoint競合）は既存どおり
  `invalid_conflict_resolution` を返す
- 同一Targetの異なるEntryを選択するresolution集合はfail closed（6.3）
- **ConflictResolutionがあっても、失ったRouteを自動で別Routeへ書き換えない。** 代替Routeが
  必要なら、ユーザーの明示選択を経て既存constrained re-search（12章）へ渡し、採用された場合だけ
  Build Listの元Entryが生成Entryで置換される（PLANNER_SPEC 9.2.18）

### 8.3 未解決Conflictに到達した場合

選択肢と判断:

| 案 | 内容 | 判断 |
| --- | --- | --- |
| A | その時点でrunを停止し、partial Plan + Conflictを返す | 不採用。複数の未解決競合があると、固定Entry / trial Entryが後方でreserveされる前に止まり、B8のadoption（9.2.14）とB9のfeasibility（9.2.4.7）が成立しない。Draftは競合より後ろの独立Targetを失う |
| B | participant以外だけ進め、両participantを止める | 不採用。3.3により、holding位置を誰も消費しないとそのstreamが止まり、後方の全Entryが止まる。止めずに第三者が消費すれば両participantを失う。現行より完成Targetが減る |
| **C** | **暫定帰結（6.5）で勝者をcommitし、全体を最後までscheduleし、競合は `PlanConflict` として返す** | **採用**。現行Beam Searchも競合の一方を（scoreにより）実行して最後まで探索し、競合を返している。挙動の意味が近く、B8 / B9 / B10の既存契約をそのまま満たす |

接続:

- **conflict UI（UI_FLOW 11.1）**: 表示する競合は8.5のとおり既存と同じIDの集合である。
  暫定勝者は6.5の順位関数が既存 `recommendEntry()` と同じcomparatorなので、
  「Planner推奨」badgeとDraftで実際に進むparticipantが一致する
- **recommendedBuildListEntryId**: 生成規則を変えない。暫定帰結はこのfieldを読まず、同じ
  comparatorを共有するだけである（固定authorityにはしない）
- **what-if / constrained orchestration**: 12章。Draftの暫定帰結はresolutionではないため、
  B8は従来どおり明示resolutionがある競合だけを再検索する

### 8.4 不採用記録（rejection）

`PlannerSearchRejection` はruntimeだけの記録であり、次のreasonを使う。永続する
`RejectedBuildListEntry.reason` のunionは変更しない。

| 状況 | PlannerSearchRejection | RejectedBuildListEntry |
| --- | --- | --- |
| explicit resolutionで非選択 | 既存 `conflict_resolution_not_selected` | `resource_conflict` |
| 暫定帰結・deadlock・stallで敗者 | 新しい内部reason（名称はPhase Aで確定。例: `conflict_not_committed`） | `resource_conflict`（変更点） |
| Targetが他の武器で充足 | 既存 `candidate_already_satisfied` | `already_satisfied` |
| 前提崩れ・保護 | 既存reason | 既存mapping |
| augmented inputでtemporary Entryに置換される元Entry | 記録しない（置換後集合に含まれない、6.4） | 記録しない |

現行 `createRejectedBuildListEntries()` は `resource_conflict` をexplicit選択がある場合だけに
付けていた。暫定帰結の敗者も `resource_conflict`（「他の候補と資源が競合しました」）として
表示するのが実態に合うため、mappingをPhase Aで変更する。これはProductionPlanの計算結果の
変更であり、15章のschema境界に含まれる。旧版にあった「同一Targetの別Entryを採用」
（`longer_route` / `dominated_by_better_candidate`）は、通常入力では生じなくなる。

### 8.5 返す `conflicts`

- 既存 `preparePlannerInitialContext().initialConflictDetection` の競合（初期relevant集合全体、
  IDは既存規則）を返す。UIのavailability判定（UI_FLOW 11.1）が同じ経路で再現するIDである。
  augmented inputでは置換後集合（6.4）で検出する
- 加えて、動的commitment更新（6.8）の時点で `detectCurrentPlannerConflicts()` と同じ関数で
  検出した競合を、IDでdedupして加える
- 現行Beam Searchは破棄されたbranchを含む全展開stateの競合を集めていた（`discoveredConflictsById`）。
  schedulerはbranchを持たないため、探索上だけ現れた競合は返さない。これにより「現在のPlanner
  入力ではこの競合を再現できない」と表示される競合が減る

---

## 9. 契約の反映場所まとめ

| 契約 | 反映場所 | 強度 |
| --- | --- | --- |
| Build List cardinality（DATA_MODEL 9.4.1） | 永続化境界、ordinary Planner入力validation（6.2） | hard（違反はfail closed） |
| temporary augmented inputの例外（PLANNER_SPEC 9.2.18） | B8 / B9 orchestration、6.4 | 非永続の例外 |
| required checkpoint Entry（7.5.6） | 唯一のEntry、完了判定 | hard |
| 1 Targetにつき選択Entry最大1件（7.5.7）、既Ideal Targetの選択（7.5.8）、壊れた選択（7.5.9） | 既存Planner入力validation（変更しない） | hard（fail closed） |
| pin gating / pin終端skip不可（7.5.1 / 7.5.2） | ready判定（pin gating）、fast-forward判定（pin gating）、holding判定（pin終端はskip不可なので常にholding。pinの現在状態はholding判定に使わない） | hard |
| checkpoint未到達のreserve拒否（7.5.3） | 既存 `applyReserveAction()` | hard |
| milestone / `checkpoint_state_mismatch`（7.5.4） | 既存Trace Replay（変更しない） | hard |
| explicit ConflictResolution | commitmentの除外 | 局所hard |
| 暫定帰結 | commitment（6.5） | Draft用の暫定 |
| preferred source（7.4） | Candidate Search / constrained enumerationだけ（6.7）。通常Plannerから撤去 | soft |
| Target priority | 暫定帰結の順位関数、canonical順key 1 | soft |
| improvement preference（7.6） | canonical順key 2 | soft |
| weapon switch（7.3） | canonical順key 3 | soft |

---

## 10. State

### 10.1 fieldの分類

| field | scheduler | 理由 |
| --- | --- | --- |
| `currentRngState` / `currentNormalCounters` | 必要 | counter precondition、`rngBefore/After`、Trace Replayの最終状態照合 |
| `simulatedInventory` | 必要 | inventory precondition、reserve、Trace Replayの最終在庫照合 |
| `targetSatisfaction` | 必要 | relevance、完了判定、動的commitment更新 |
| `selectedBuildListEntryIds` | 必要 | secured Entry、`ProductionPlan.selectedBuildListEntryIds`、B8 / B9判定 |
| `routeProgressByEntryId` | 必要 | lane progress、fast-forward、frontier |
| `routeRuntimeByEntryId` | 必要 | transient Gogmaの有無とscope |
| `sourceMutationVersionByOwnedWeaponId` / `candidateReadySourceVersionByEntryId` / `routeSourceVersionByEntryId` | 必要 | reserve時のversion一致。committed集合では通常衝突しないが、fail-closed防御として残す |
| `inFlightExistingSourceByOwnedWeaponId` | 必要 | 充足判定からの除外 |
| `securedOwnedWeaponIdByEntryId` | 必要 | 確保武器の対応 |
| `reachedCheckpointByEntryId` | 必要 | reserve gating |
| `trace` | 必要 | 出力そのもの（Trace Replay / ProductionPlanの入力） |
| `lastWeaponOperationSubjectKey` | 必要 | canonical順key 3 |
| `weaponSwitchCount` / `improvementPreferenceViolationCount` | 診断 | 決定には使わないが、parity比較とinstrumentationに使う。incrementalに維持 |
| `preferredSourceProgressCount` | 不要（Beam専用） | 6.7。Phase Cでは型互換のため残してよく、Phase Dで削除を判断 |
| `totalCost` | 不要（Beam専用） | `trace.length` と同値。Phase Dで削除を判断 |
| `evaluationScore` | 不要（Beam専用） | 11章 |

Execution / Trace Replay / conflict correctnessに必要なfieldは1つも削らない。

### 10.2 scheduler専用のruntime情報

committed Entry集合、commitment結果、非commit理由、temporary Entry集合は
**scheduler / orchestration内部のruntime情報** であり、`PlannerSearchState`、`ProductionPlan`、
`PlanStep`、`BuildListEntry`、DB schemaへ追加しない。

---

## 11. semantic keyとevaluationScore

- schedulerはbranchを持たないため、semantic dedupそのものが通常経路で不要になる。
  `createPlannerSearchStateSemanticKey()` は変更せず、Beam Search oracleとinstrumentationのために
  残す。「traceをsemantic keyから削るだけ」の変更は行わない（1.3）
- `evaluationScore` / `comparePlannerSearchStates()` / `scoreCandidate()` / progress potentialは
  通常schedulerの決定に使わない。commitmentは6章、実行順は7.7で決まる。Phase Cでは
  `evaluationScore` を最終stateに対して既存 `evaluatePlannerSearchState()` で1回だけ計算して
  診断用に保持してよい（どの判断も読まない）。削除はPhase Dで判断する
- `CandidateScore` の推奨重みは、Beam oracleが残る間は変更しない

---

## 12. constrained re-search / what-if / B10との境界

### 12.1 経路

B8 orchestration（`createProductionPlanWithConstrainedSearch()`）とB9 what-if
（`plannerWhatIfCalculation`）は、どちらも共有の `createProductionPlanWithObserver()` を通して
Plannerを完全再実行する。通常Plannerの実装を差し替えると両者も同時に差し替わる。
**通常Plannerとconstrained re-search内部で別々の探索戦略を持たない**（B8の初回runは通常runそのもの
であり、別戦略だと両者が乖離するため）。したがって「constrained re-search内部Beam Search」という
別契約は残さない。

```text
deterministic scheduling（persisted Build List、1 Target = 1 Entry）
  ↓
Conflict（PlanConflict、暫定帰結つきDraft）
  ↓
ユーザーが優先Entryを選択（PlannerConflictResolution）
  ↓
失うTargetだけ constrained re-search（既存B8、enumeratorは変更しない）
  ↓
代替Ideal Candidate → temporary generated Entry（元Entryと一時的に共存）
  ↓
initial conflict preflight（既存9.2.3.1、置換後集合での再対応付け。PLANNER_SPEC 9.2.18）
  ↓
deterministic scheduling再実行（初期stateから、置換後集合で計算）
  ↓
採用 → 元Entryを生成Entryで置換してPlanと同一transactionで保存（PLANNER_SPEC 9.2.18）
不採用 → 何も永続化しない
```

### 12.2 維持する契約

- 固定authorityは `PlannerConflictResolution.selectedBuildListEntryId` だけ（9.2.7）
- 生成Entryは途中stateへinjectせず初期stateから再実行（9.2.10）。schedulerは1回のrunが安価なので
  この制約はむしろ容易になる
- 共存可能性の最終authorityは完全再実行 + Trace Replay（9.2.11）。preflightは判定しない
- adoption条件（9.2.14）とfeasibility（9.2.4.7）は `plan.selectedBuildListEntryIds` を読むだけで
  あり変更しない
- `maxPlannerReruns` は「full Planner runの回数」を数える。意味（1回の `createProductionPlanWithObserver()`
  内のruntime-unsupported retryを含む）は変えず、observer hookの名称はPhase Cで意味を保ったまま
  `beforeBeamSearch` / `afterBeamSearch` から `beforePlannerRun` / `afterPlannerRun` へ改名した
  （Worker protocolには露出しない）
- orchestration bounds（2 / 1 / 4）とenumeration boundsの値は本書で変更しない。Beam runが
  高価だったために小さくした経緯があるので、再測定はCan defer（#101と合わせて扱う）

### 12.3 Build List cardinalityとの接続（Phase 0）

PLANNER_SPEC 9.2.18に正式契約を置いた。要点:

- trial中は元Entry `B1` とtemporary Entry `B2` の共存を許可する（永続化しない）
- Planの計算と記録は置換後集合で行い、置換で消える競合に対応するfixed constraintは
  「置換で充足済み」として扱う。それ以外のfixed constraintは従来どおり一意に再対応付けできなければ
  fail closedする
- 採用時は `B1` を `B2` で置換し、Planと同一transactionで保存する。trial不採用なら何も永続化しない
- 置換が `active` Planを壊す場合は既存Plan-breaking guardを迂回しない
- これらは通常Plannerの実装（Beam / scheduler）に依存しないため、scheduler切替より前のPhase 0で
  実装できる

### 12.4 what-if

what-ifのUI / Domain semantics（`scenarioResolution`、`defaultPlannerWhatIfBounds`、
`blocked_by_selected_checkpoint` 等）は変更しない。trial Entryはtemporary Entryとして
置換後集合で評価し、永続化しない。

---

## 13. Trace / ProductionPlan / Execution / Trace Replay

- schedulerが選んだaction列は既存 `PlannerSearchAction`（`route_operation` / `reserve_candidate`）
  としてtraceへ積む。形式を変えない
- 結果は `PlannerBeamSearchResult` と同じshape（`bestState`、`conflicts`、`warnings`、
  `rejections`、`expandedStates`、`completed`、`cancelled`、`termination`）で返し、
  `createProductionPlanWithObserver()` の後段（runtime-unsupported retry、Trace Replay、
  `projectProductionPlanExecution()`、PlanningInputSnapshot、checkpoint requirement defence、
  rejected / required materials）を変更しない。型名の変更（`PlannerScheduleResult` 等）はPhase C / Dの任意
- `ProductionPlan`、`PlanStep`、`executionEffects`、`ExpectedPlanState`、Execution Navigatorの
  下流契約は変更しない
- **Trace Replayを省略しない。** 決定的schedulerが生成したtraceも、physical action identity
  （`invalid_physical_action_sharing`）、RNG before / after、inventory effect、source mutation、
  checkpoint（`checkpoint_state_mismatch`）、Target completion、最終状態一致（`final_state_mismatch`）を
  従来どおり検証する。schedulerとReplayの間にsemantic差を作らない

---

## 14. PlannerOptions / termination / progress

### 14.1 PlannerOptions

| option | 通常scheduler | 移行方針 |
| --- | --- | --- |
| `maxPlanSteps` | 使う。traceの長さ（reserveを含む）の安全上限。到達で `incomplete`（`max_plan_steps`）。通常schedulerの唯一のbound | 維持。**Phase D-1で既定値を300から1000へ変更**。Build List詳細設定の唯一の項目 |
| `maxExpandedStates` | **Phase D-1以降は使わない**（Phase Cまでは構築state数の上限として停止判定に使っていた）。`expandedStates` の計測は診断として続ける | **Phase D-1でscheduler停止判定とUIから除去**。**Phase D-2aでProduction `PlannerOptions` から除去し、Beam oracle専用の `PlannerBeamSearchOptions` へ分離**（14.5） |
| `beamWidth` | 使わない | Phase CはUI文言だけ修正。**Phase D-1でUIから除去**。**Phase D-2aでProduction型から除去し、`PlannerBeamSearchOptions` へ分離**（14.5） |

- 3項目の型、`defaultPlannerOptions`、Worker protocol、UI入力検証はPhase Cでは変更しない
  （Phase D-1の変更は14.4）
- 通常schedulerの停止性は `maxPlanSteps` だけで保証される（各反復でtraceが1以上伸びるか、終了する）。
  commitmentも有限反復である
- constrained re-search / what-ifに独自のBeam用Optionは無い（12.1）
- Build Listの「詳細設定」（UI_FLOW 10.0）: Phase Cでは項目を残し、説明文を「最大探索状態数 =
  Plannerが構築する状態数の上限」「Beam幅 = 現在の通常Plannerでは使用しない」へ改める。
  Phase Dで「最大探索状態数」「Beam幅」の除去と、必要なら `maxPlanSteps` 既定値の見直しを行う
  （既定値300は大量Build Listで不足しやすい）。**Phase D-1で実施済み（14.4）**。
  当初書いた「commitment後の総step数は静的に分かる」は誤りである（14.4）

### 14.2 `expandedStates`

選択肢A / B / Cのうち **A（既存定義のまま、値の意味を保つ）** を採る。

- PLANNER_SPEC 7.2の定義は「successor PlannerSearchStateを実際に構築し評価対象にした時点で1増やす」
  である。schedulerは各stepでちょうど1つのsuccessor stateを構築するので、`expandedStates` は
  **適用したaction数（初期state・開始時confirmを除く）** になり、定義を変えずにそのまま成立する
- safe判定のために評価した候補action数はstateを構築しないので数えない（instrumentationで別に数える）
- B（常に0）は「探索状態数 0 / 200,000」表示となり誤解を招くため不採用。C（新metric名）は
  `PlannerSearchTermination` / `PlannerProgress` の型変更を伴うためPhase Dへ回す
- `PlannerProgress { expandedStates, maxExpandedStates }` もPhase Cでは同じ意味で送る。
  進捗バーの分母が実態より大きく見える問題は、commitment後に分かる総step数を分母にする型変更として
  Phase Dで扱う、としていた。**Phase D-1ではこの案を採用しない**（14.4）

### 14.3 terminationの意味

statusと決定順序（PLANNER_SPEC 7.2.1）を変更しない。新しいstatusは追加しない。

| status | 通常schedulerでの意味 |
| --- | --- |
| `cancelled` | 従来どおり |
| `completed` | 全planning Targetが完了（required checkpoint Entryのsecureを含む、既存判定） |
| `incomplete` | `maxPlanSteps` が完成前にscheduleを打ち切った（Phase Cまでは `maxExpandedStates` でも打ち切った。Phase D-1以降は打ち切らない）。Persistenceは従来どおり拒否 |
| `exhausted` | boundに達せずscheduleを終え、全Target完成に至らなかった。未解決競合の暫定敗者、resolutionの非選択、前提崩れ、deadlock、保護などで完成できないTargetがある |

未解決Conflictで一部Targetが完成しない場合は、現行と同じく `exhausted` + `plan != null` +
`conflicts` である。これは「入力・Conflict・resourceにより完成Planが無かった通常の結果」
（7.2.1）そのものなので、新status（例: `conflict`）は不要である。UIの `exhausted` 表示
（UI_FLOW 10.1「現在の入力から作成できる生産計画はありませんでした。」）は `plan === null` の
場合の表示であり、`plan != null` のexhausted resultは従来どおりDraftとして保存・表示される。
Build List cardinality違反（legacy duplicate）は探索前のvalidation失敗であり、既存の
Beam Searchへ到達しなかったrunと同じく `exhausted` / `plan = null` / 専用warningで返す。

---


### 14.4 Phase D-1の確定判断（Production設定 / 進捗Presentation）

Phase Dは2つのPRへ分割した。

```text
Phase D-1  Production向けPlanner設定 / 進捗Presentationの整理（本節）
Phase D-2  Beam oracle / legacy型 / naming / instrumentationの整理
           D-2a  Production型 / termination / Worker protocolの整理（14.5）
           D-2b  Beam oracle / instrumentation / benchmark infrastructureの縮退、Issue #103完了判断
```

Phase D-1の確定判断。

- Build List詳細設定から「Beam幅」を削除した。通常schedulerは `beamWidth` を一切読まないので、
  ユーザーが変更できる設定として残す意味が無い
- Build List詳細設定から「最大探索状態数」を削除した。schedulerは成功したactionごとに
  `trace.length` と `expandedStates` を同じだけ進めるので、`maxExpandedStates` は `maxPlanSteps` と同じ
  種類の停止条件を重複させるだけである。停止性は `maxPlanSteps` だけで保証される（14.1）
- 通常schedulerは `maxExpandedStates` を停止判定に使わない（`canApplyAction()` は `maxPlanSteps` だけを
  見る）。UIから項目を消して既定値10000をhidden boundとして残すことはしない。`maxPlanSteps = 20000`
  の計算がhiddenな `maxExpandedStates` で止まってはならないからである
- 通常schedulerは `reachedLimits` の `max_expanded_states` と `max_expanded_states_reached` warningを
  発生させない。`incomplete` は `max_plan_steps` だけで起きる。Beam oracleは従来どおり両方を使う
- 開始時のzero-operation `confirm_owned_ideal` も1 PlanStepとして `maxPlanSteps` を消費する。
  schedulerは共有helper `applyPlannerZeroOperationConfirms()` へ明示的なbound
  （`canApply` / `onWithheld`）を渡し、`maxPlanSteps` を超えてconfirmを適用しない。上限で適用されなかった
  confirmのTargetは完成扱いにせず（`incomplete` / `max_plan_steps`）、上限ちょうどで完成した場合は
  `completed` + `max_plan_steps` の診断を維持する（PLANNER_SPEC 7.2）。boundを渡さないBeam oracleは不変
- `maxPlanSteps` の既定値を300から1000へ変更した。Phase Bの実測でschedulerは
  `representative-12` に330 action、`representative-35` に398 actionを要し（Browser Worker約1.4秒で自然終了、
  [ISSUE_103_SCHEDULER_PARITY_BENCHMARK.md](./ISSUE_103_SCHEDULER_PARITY_BENCHMARK.md)）、300では不足する。
  1000はPhase Bで実際に使用・検証した値である。Node testでも既定値1000で両fixtureが上限に達しないこと、
  300では `max_plan_steps` で `incomplete` になることを固定した
- `maxPlanSteps` は引き続きユーザーが変更でき、「1以上の整数」validationを維持し、固定上限は設けない
- 通常画面（Build List、再計画Preview、Production Plan画面の再計算、what-if）は
  `expandedStates / maxExpandedStates` を完了率として表示せず、indeterminateな計算中表示と
  キャンセルを出す（UI_FLOW 10.0）。探索未完了表示の「探索状態数 x / y」も表示しない（UI_FLOW 10.1）
- `PlannerOptions` の3 field、`defaultPlannerOptions.beamWidth` / `maxExpandedStates`、
  `PlannerSearchLimitKind` の `max_expanded_states`、`PlannerSearchTermination.limits`、
  `PlannerProgress` のWorker DTO、`PlannerBeamSearchResult` の名前はPhase D-2まで維持する。
  schedulerは `expandedStates` を診断として数え続け、progress callbackも従来どおり送る
- benchmark専用画面は `beamWidth` / `maxExpandedStates` を残す（Beam oracleを計測する開発用surface）
- `CURRENT_CALCULATION_APP_SCHEMA_VERSION` は14のまま据え置く。Action選択、Route commitment、
  Plan projectionのsemanticsは変えず、`maxExpandedStates` で打ち切られた `incomplete` resultは既存の
  Persistence契約で保存されていないので、保存済みversion 14 Planの意味は変わらない。既定値の変更は、
  新しい計算で以前 `incomplete` だった入力をより長く計算できるようにするだけである
  （PLANNER_SPEC 7.2.1 Calculation compatibility（Issue #103 Phase D-1））

進捗の分母（14.1 / 14.2で検討した「commitment後の総step数」）について。

- **Phase D-1では採用しない**
- 理由: physical action sharing（1 actionが複数Entryを進める）、silent fast-forward（Route unitが
  actionにならずに消える）、cross satisfactionによる動的release / recommit、deadlock / stallによる
  Entryのdrop、runtime-unsupported rerunがあるため、Route unit数の単純合計やCandidateの
  `estimatedOperationCount` は実際のStep総数ではない（Trace Replayでも `estimatedOperationCount` は
  実Step残数のauthorityではない）。「commitment後の総step数は静的に分かる」という14.1の当初の記述は誤りである
- 正確な単一authorityを作らずに推定値をUIへ出すより、Productionが十分高速になった現状
  （representative-35でも約1.4秒）ではindeterminate表示を採る
- 数値progress自体をWorker DTOに残す必要があるかは、Phase D-2でWorker progress型を整理するときに
  再判断する。**Phase D-2aで削除と判断した（14.5）**

### 14.5 Phase D-2aの確定判断（Production型 / termination / Worker protocol）

Phase D-2を2つのPRへ分割した。

```text
Phase D-2a  Production Plannerの型・Worker契約からBeam Search由来のlegacy要素を分離する（本節）
Phase D-2b  Beam oracle / parity harness / benchmark instrumentationの縮退、Issue #103完了判断
```

Phase D-2aの確定判断と実装後の状態。

- Production `PlannerOptions` は `{ maxPlanSteps }` だけにした。`defaultPlannerOptions =
  { maxPlanSteps: 1000 }`、`validatePlannerOptions()` は `maxPlanSteps` だけを検証する。通常Worker
  request、B8、B9、再計画Previewの `PlannerInput` は `beamWidth` / `maxExpandedStates` を持たない。
  Production strategy flagは追加しない
- Beam oracle専用contractを `src/domain/planner/plannerBeamSearchTypes.ts` へ分離した:
  `PlannerBeamSearchOptions`（`PlannerOptions` + `beamWidth` / `maxExpandedStates`）、
  `defaultPlannerBeamSearchOptions`（1000 / 50 / 10000）、`validatePlannerBeamSearchOptions()`、
  `PlannerBeamSearchInput`、`PlannerBeamSearchLimitKind`、`PlannerBeamSearchTermination`、
  `PlannerBeamSearchResult`、`PlannerBeamSearchProgress`、`PlannerBeamSearchExecutionOptions`
  （`onProgress`、`searchInstrumentation`）。Production moduleはこれらをimportしない（source scan testで固定）
- Beamの入力validationは共有 `validatePlannerInput()` / `preparePlannerInitialContext()` へ
  `validatePlannerBeamSearchOptions()` の結果をoptions validationとして渡す。Productionのvalidationだけを
  通って不正なoracle boundを見逃すことはなく、schedulerはoracle fieldを要求しない
- 結果型を中立化した。共通baseは `PlannerRunResultOf<TTermination>`、Productionは `PlannerRunResult`
  （scheduler、`createProductionPlanWithObserver()`、`PlannerFullSearchRunner`、
  `ProductionPlanGenerationObserver.afterPlannerRun()`、B8 / B9）。Beamは `PlannerBeamSearchResult` を維持する
- terminationを分離した。共通は `PlannerTerminationOf<TLimitKind, TLimits>`、Productionは
  `PlannerRunTermination`（`reachedLimits: PlannerRunLimitKind[]` = `max_plan_steps` だけ、
  `limits: PlannerOptions`）。Production terminationが `max_expanded_states` を持てないことを
  compile-time（`@ts-expect-error` test）とruntime（stray fieldを読まず `limits` へ反映しない）で固定した。
  status（`PlannerRunTerminationStatus`）と決定順序は不変で、導出は `createPlannerTermination()` 1つ、
  Production用は `createPlannerRunTermination()`。旧 `PlannerSearchTermination` /
  `PlannerSearchLimitKind` は削除した
- `expandedStates` はrenameせず診断値として残す（schedulerでは適用action数、zero-operation confirmは含まない）
- Production Planner Workerの `type: "progress"` responseと `PlannerProgress` を削除した。
  `PlannerWorkerClient` の `onProgress` callback（`createPlan` / `createConstrainedPlan` /
  `createWhatIfComparison`）も削除した。Workerがcalculationへ渡すのは `shouldCancel` / `yieldControl` だけで、
  cancelは `cancelPlan()`、generation、`shouldCancel`、`yieldControl` で維持する（通常Planner、B8、B9、
  再計画Previewの全経路）
- Production `PlannerExecutionOptions` は `shouldCancel` / `yieldControl` だけにした（onProgressをbenchmark専用型へ移す方式）。
  scheduler benchmark用の `onProgress({ expandedStates })` と `schedulerInstrumentation` はscheduler専用の
  `PlannerScheduleExecutionOptions` へ、Beamの `onProgress` / `searchInstrumentation` は
  `PlannerBeamSearchExecutionOptions` へ移した。D-2bでinstrumentationを整理するときに境界が明確になる
- planner orchestration / what-if Browser benchmarkの `progressEvents` metricは削除した（偽のprogressを
  生成しない）。Issue #103 benchmark Workerは独自のbenchmark protocolでscheduler進捗を報告し続ける
- Production表示helper（`plannerSearchLimitPresentation.ts`）から `max_expanded_states` 分岐を除去した。
  Persistenceのincompleteエラー文言を中立化した（拒否判断は不変）
- parity harnessはBeam / schedulerの入力・結果型をそれぞれ明示する。Beam terminationをProduction
  terminationへ偽変換しない（当初のharness側adapterは、Beamの `max_expanded_states` 打切りを
  `incomplete` + 空の `reachedLimits` というProductionでは成立しない `PlannerRunTermination` にしていた
  ため、PR #118のreviewで除去した）。共通tailをtermination型にgenericな `generatePlanFromFullRun<T>()` へ
  分離し、parity harnessはBeam結果を `PlannerBeamSearchTermination` のまま通す（runtime-unsupported
  retryでもBeamを再実行）。Productionの `createProductionPlanWithSearchRunner()` /
  `PlannerFullSearchRunner` / `ProductionPlanGenerationObserver` / `PlannerResult` は
  `PlannerRunTermination` 固定のまま。Production terminationは `incomplete` なら必ず
  `reachedLimits = ['max_plan_steps']` であることをhelperと実scheduler結果のtestで固定した。
  acceptance catalogue、sanity-3、representative-12のparityは維持
- `max_expanded_states_reached` warning kindはBeam oracleが使うため残す（Production scheduler / UIからは
  到達不能）。warning型の分離はD-2bへ回す
- UIの見た目はD-1から変更しない
- `CURRENT_CALCULATION_APP_SCHEMA_VERSION` は14のまま。`PlannerOptions` は `PlanningInputSnapshot` に
  保存されておらず、`ProductionPlan` / `PlanStep` / `PlanningInputSnapshot` / `CalculationContext` /
  DB / Exportのshapeもscheduler action semanticsも変えていない。Worker protocolはアプリ内部のruntime境界で
  ある。DB 8、Export 11、`RngState` 2、`AppSettings` 1、`production-rng:c5-e7`、Master `dataVersion` 4も不変

## 15. Version境界

### 15.1 Phase 0（Build List cardinality）

既存version policyに照らして、**どのversionも変更しない**。

| version | 判断 |
| --- | --- |
| `DATABASE_SCHEMA_VERSION`（8） | table / index / 永続shapeが変わらない。legacy duplicateを自動削除・自動選択しない（DATA_MODEL 9.4.1）ためmigrationも無い |
| `ExportRoot.schemaVersion`（11） | Export shapeが変わらない。Importはlegacy duplicateを含むrootを拒否せずそのまま復元する（backupを取り戻せなくしない）。v10→v11のDraft削除のようなmigrationを伴わない |
| `CURRENT_CALCULATION_APP_SCHEMA_VERSION`（13） | 有効な（1 Target 1 Entryの）入力に対する計算semanticsは変わらない。duplicateを持つ入力はfail closedへ変わるが、既存のProductionPlan / BuildCandidate / BuildListEntryは自身の記録のまま有効であり、current runtimeが誤読する永続artifactは生じない |
| `RngState.schemaVersion`、`AppSettings.schemaVersion`、`PRODUCTION_RNG_ENGINE_VERSION`、Master `dataVersion` | 無関係 |

- B8採用時の置換後集合での計算（PLANNER_SPEC 9.2.18）は、新しく保存するPlanの `conflicts` /
  `rejectedBuildListEntries` / `buildListEntriesHash`（監査用）の内容を変えるが、既存Planの互換性を
  壊さない。既存version 13 Draftの `conflicts` が既に存在しない元Entryを参照していても、Draftは
  lifecycle-aware reference integrity（DATA_MODEL 15.2）の対象外であり、B10でその競合を再現できない
  場合は既存の `invalid_conflict_resolution` fail closedと再計算導線で扱われる
- Build List collection invariantはCalculationContextに入らない。永続collectionの契約変更を
  CalculationContextのversion境界で代用しない（CalculationContextは計算artifactの互換性だけを表す）

### 15.2 Phase C（scheduler切替）: ProductionPlan

Phase Cで `CURRENT_CALCULATION_APP_SCHEMA_VERSION` を **13 → 14** へ上げた（**実装済み**。本書を追加した
PR #108では値を変更していない）。

理由:

- 同じ `PlannerInput` に対して、未解決競合の帰結（6.5）、返す `conflicts`（8.5）、
  `rejectedBuildListEntries` のmapping（8.4）、Step順が変わる。explicit resolutionの非選択側が
  共有actionで完成するケース（7.6）も変わり、preferred sourceのPlanner側preferenceも撤去される（6.7）
- 永続 `ProductionPlan` は生成戦略を記録しないため、version 13のDraftの `conflicts` /
  `rejectedBuildListEntries` がBeam由来かscheduler由来かを判別できない（version 5境界と同じ論理）
- PLANNER_SPEC 7.3の武器切替preferenceは「同等にcorrectなPlanのうちどれを選ぶか」だけの変更として
  versionを上げなかった。本変更は選ぶPlanだけでなく競合の帰結と記録の意味を変えるため、その先例には当たらない

扱い:

- version 1〜13のProductionPlanはversion 14で `calculation_context_changed` としてfail closedし、
  Worker preparation、conflict操作、what-if、実行準備、実行へ進めない。exact persisted表示は維持し、
  read migrationで書き換えない。Plan互換判定は従来どおり4項目完全一致で、Plan向けの例外を作らない
- **影響**: 実行中（`active`）のversion 13 Planも `stale` になり、現在地点からの再計画（16.8）が必要になる。
  version 13境界でも同じ扱いをした先例がある。Step / ExpectedPlanStateの契約自体は変わらないため
  実行上の危険は無いが、fail-closedを優先する

### 15.3 Phase C: BuildCandidate / BuildListEntry

Candidate Search semantics、Candidate Snapshot、BuildListEntry shape、staleness、constrained
enumeratorは変わらない。したがって明示的なbuild-result例外を `14 -> [12, 13]` とし、
gameVersion / masterDataVersion / rngEngineVersionが一致し通常のstale判定に当たらない限り、
version 12 / 13のBuildCandidate / BuildListEntryをversion 14で再利用可能とする。
version 1〜11は従来どおり非互換、例外をProductionPlanへ適用しない。

### 15.4 変更しないversion

Phase Cでも `DATABASE_SCHEMA_VERSION`（8）、`ExportRoot.schemaVersion`（11）、
`RngState.schemaVersion`（2）、`AppSettings.schemaVersion`（1）、`PRODUCTION_RNG_ENGINE_VERSION`、
Master `dataVersion` は変更しない（永続shape、RNG、Masterのいずれも変わらないため）。

---

## 16. 必須acceptance scenarios

各scenarioはPhase 0 / AのDomain / Service testとPhase Bのparity fixtureに入れる。「branchを作らない」は、
1 stepあたり構築するstateが1つであること（`expandedStates` 増分が1）と、候補actionを
canonical順で1つだけ適用したことを検証する。

### 16.1 scheduler

| # | 入力 | 期待動作 |
| --- | --- | --- |
| A | Target A: Gogma laneだけ（C50で完成）、Target B: Skill laneだけ（C100で完成） | 競合なし。Gogma C0〜C50はAの武器、Skill C0〜C100はBの武器が消費する。canonical順（priority → switch）で一方のrunをまとめて行い、両方完成（`completed`）。branchなし |
| B | A / B / Cの最終unit（required）の `counterBefore` がそれぞれGogma C50 / C80 / C120（全Route起点C0） | Gogma streamはC0から昇順に消費。C50でA、C80でB、C120でCのrequired unitが実行され、各直後にreserve。他の位置はskippableで、executorは7.7で決まる。物理Gogma操作数は121 |
| C | A: C50 required、B: C50 skippable | 候補は「Aを実行」だけ。Bはfast-forward。Bを実行するbranchもrejectionも作らない |
| D | A: C50 Weapon A Keep required、B: C50 Weapon B Reset required | commitmentで `same_gogma_counter` のcollision。resolutionが無ければ6.5の暫定帰結で一方だけcommitし、競合を `PlanConflict` で返す（`selectedBuildListEntryId = null`）。順序探索をしない。敗者は `resource_conflict` |
| E | 2 Entryが同じconcrete source weaponの同じphysical action（同type・同Counter遷移）を次unitにもつ（両者の全unitが1 actionの退化ケース） | 1 actionで両Entryをprogressし、`progressedBuildListEntryIds` に両方を記録。version共有も既存どおり。Trace Replayがidentityを再検証 |
| F | 別EntryのEntry-local transient Gogma（null source）が同じGogma位置 | shareableでない。両方requiredならcollision、両方skip可能なら一方がexecutorで他方fast-forward。1 actionで両Entryを進めない |
| G | 1 TargetのBonus laneとSkill laneが同時にsafe | `bonus_first` / `skill_first` は優先laneを選ぶ。優先laneが待ちなら反対laneを進めviolationを記録。`planner` はweapon switch → 残り数 → stable順。両branchを保持しない |
| H | selected checkpointを持つEntry | そのEntryがTargetの唯一の候補。pin gatingで片laneがpinを越えない。checkpoint到達前にreserveしない（`selected_checkpoint_not_reached`）。milestoneはpin終端Stepに載り、Trace Replayが検証。`hasIdeal` だけでcompleteにしない。pin終端unitはholdingで、別Entryにその位置を消費させない |
| H2 | Entry YのSkill unit S7がskippableでpin-blocked、別Entry XがS7をrequired action（conversion）で消費する | Xの実行は許される（Yのunitはholdingでない）。X適用直後はSkill Counter S8、YのSkill progressはpinを越えず、checkpoint未到達。YのBonus laneがpinへ届いたactionの中で、S7は過去位置としてfast-forwardされ、Yは後続のSkill unitを実行し、X / Yとも完成する（Trace Replay / projection有効） |
| I | TargetのEntryがpreferred起点ではない（別のpreferred起点の所持武器がある） | Plannerはpreferredを理由にRouteを差し替えず、そのEntryのRouteをscheduleする（6.7）。preferredはCandidate Searchのtie-breakとしてだけ働く |
| J | 2 Routeが同じOwnedWeaponを破壊的に使用 | `same_owned_weapon_consumed` のcollision。片方だけcommit。source version / in-flight / 保護の既存semanticsを維持 |
| K | 新規Normal（predicted forge 2本）→ conversion → Reset / Reset Skills | Normal Counter位置でforge（required）、Skill起点でconversion（required、Skill +1、Gogma +0）、base完了までGogma laneのholding位置は待つ。transient subjectはEntry-local。blind variantではforgeがCounter位置を持たず、確定Counterなら同武器種のpredicted forgeが残る間は待ってから1進める |
| L | ConflictResolutionで一方を選択 | 選択EntryをTargetのRouteとして実行、非選択participantは実行しない（`conflict_resolution_not_selected`）。scheduleを継続。非選択Routeを別Routeへ変換しない。resolution以外の競合は暫定帰結 |
| M | constrained re-searchで敗者Target `B` に生成Entry `B2` を追加 | trial入力では元Entry `B1` と `B2` が共存し、preflightで再対応付けした後、置換後集合（`B1` → `B2`）で初期stateから再実行する。`B1` は実行・記録されない。adoptionは既存条件で判定 |

### 16.2 Build List cardinality

| # | 入力 | 期待動作 |
| --- | --- | --- |
| N | Target A → Entry A1が既存。Search結果の別Candidate A2を追加 | A1 / A2を並存させない。現在の候補と新しい候補、旧候補の途中採用設定・改善優先が引き継がれないことを示す確認を経て、承認時だけA1をA2へatomicに置換する。A2の選択状態はSearch画面で指定したものだけ |
| O | 既存Entry A1と同一semanticのCandidateを再追加 | duplicate扱い。何も書かず、A1の途中採用設定・改善優先を上書きしない（既存の再追加規則） |
| P | Nの置換確認をキャンセル | A1を維持し、A2を保存しない。Planにも影響しない |
| Q | 置換されるA1がactive PlanのPlan依存Entry | 置換全体を1つのguarded mutationとして既存Plan-breaking guardで判定し、`build_list_changed` の警告と16.10の選択を経る。未承認なら何も変更しない。承認時はA1→A2置換とPlanの `abandoned`（`breaking_change_approved`）を同一transactionで行う。A1がDraftだけの参照ならguard対象外（既存のEntry削除と同じ） |
| R | Target B → B1。constrained re-searchのtrial generated B2 | trial中はtemporary augmented inputとしてB1 / B2共存可。不採用なら何も永続化しない。採用ならB1をB2へ置換し、Planと同一transactionで保存。永続Build ListのTarget Bは最終的に1件 |
| S | legacy duplicate: 永続Target Aに A1 / A2 | 自動選択・自動削除しない。ordinary Planner入力はfail closed（専用warning）。Build ListはTarget Aに「使用する候補を1件にしてください」相当の案内を出し、ユーザーが既存の削除操作（guarded）で整理する。Search画面からの追加 / 置換は、どちらを置換するか推測できないため拒否して整理を案内する。Import / Exportはそのまま保持する |

### 16.3 追加で固定するscenario

- zero-operation `existing_gogma_current` の `confirm_owned_ideal` が開始時に適用され、その武器を
  起点にする他Routeが保護で実行不能になる
- deadlock（7.8の例、fixture `true-deadlock`）で `R` 最下位のEntryが落ち、そのTargetは完成しない。
  残りのEntryは継続して完成する
- 旧7.8の例（fixture `deadlock`）はdeadlockではなく、16.1 H2のとおり両Targetが完成する
- pin-blockedのskippable unitの位置が開始時点で通過済みでも、それだけではEntryを落とさない（fixture
  `pinned-past`）。その後ろのholding unitまで通過済みなら `counter_before_current` で落とす
  （fixture `pinned-past-lost-holding`）
- reserveした武器が別planning TargetのIdealも満たし、そのTargetのcommitted Entryが解放される
- `maxPlanSteps` 到達で `incomplete`、partial Planは保存されない
- cancelで `cancelled`
- 同じ入力・同じEngine fixture・同じID factory / clockで結果が完全一致する（決定性）
- ordinary入力で同一Targetの異なるEntryを選択する2つのresolutionを与えたmalformed入力がfail closedする

---

## 17. 実装フェーズ

依存関係:

```text
Phase 0（Build List cardinality）──────────────┐
Phase A0 → Phase A → Phase B ──────────────────┴→ Phase C → Phase D
```

Phase 0はPlanner schedulerとは独立に実装でき、Phase A0 / A / Bと並行してよい。
**Phase C（Production切替）の前にPhase 0がmerge済みであること** を必須とする。schedulerの通常経路は
1 Target = 1 Entryを前提にし、違反をfail closedするためである。

### Phase 0: 永続Build Listを1 Target = 1 Entryへ整理（#103とは別PR群）

仕様は本PR（#108）でDATA_MODEL 9.4.1 / SEARCH_SPEC 10.1 / UI_FLOW 9 / 10 / PLANNER_SPEC 9.2.18 /
REQUIREMENTS 18へ記載済み。実装は次の順で小さく分ける。

- **0-1 Domain / Service**: collection invariant判定helper、ordinary Planner入力validationの
  duplicate fail closed（warning kindとlabel）、`replace BuildListEntry for Target` のguarded mutation
  （旧Entryの確認付き削除 + 新Entry追加を1 transaction、置換後集合のcollection invariant検証）、
  Search追加APIの結果型（追加 / duplicate / 置換確認が必要 / legacy duplicateのため不可）、
  Import / Exportがlegacy duplicateを保持することのtest。UIは変えない
- **0-2 UI**: Search画面の置換確認Dialog（`ui-ux-pro-max` でPresentationを確定し、UI_FLOWを同じPRで
  具体化）、Build Listのlegacy duplicate案内、既存Plan-breaking警告Dialogとの接続
- **0-3 Planner / Persistence**: temporary augmented inputの扱い（置換後集合での計算と記録、
  置換で充足したfixed constraintの扱い、temporary 2件以上のfail closed）、
  `savePlannerOrchestrationResult()` と再計画採用での元Entry置換、active Planを壊す置換の
  guard接続。現行Beam Searchのまま実装する

0-1が先行し、0-2と0-3は並行してよい。いずれもversionを変更しない（15.1）。

0-1の実装状態（実装済み）:

- collection invariantの判定authorityは `findBuildListTargetDuplicates()` / `validateBuildListCardinality()` /
  `classifyBuildListCandidateAddition()`（`src/domain/buildList/buildListCardinality.ts`）
- 通常Planner入力のwarning kindは `duplicate_build_list_entries_for_target`。planning Target（valid Entryを
  1件以上持つTarget）のEntryを、stale等で除外されたものも含めて数える（PLANNER_SPEC 4.1）
- 通常入力とtrial入力の区別はDomainの呼び出し文脈で表す（Phase 0-1時点では `PlannerBuildListCardinality`
  = `persisted` / `temporary_augmented` で、trial入力にcardinality検証を行わなかった。0-3で
  `PlannerBuildListContext` へ置き換えた、下記）
- Search追加APIの結果型は `AddBuildListCandidateResult`（`added` / `duplicate` / `replacement_required` /
  `legacy_duplicate`）。置換は `BuildListService.replaceCandidate()` / `inspectCandidateReplacement()`
  （`buildListEntryReplacementMutation()` を1つの `PlanGuardedMutation` として `PlanBreakingChangeGuard` で判定）
- 0-2までの暫定（0-2で解消）: Search画面は `toSearchScreenAddition()` で既存の `{ entry, added }` 契約を保ち、
  `replacement_required` / `legacy_duplicate` を何も書かずに追加失敗として報告していた。0-2でこのadapterと
  error code `replacement_confirmation_unavailable` を削除した
- 0-3までの暫定（0-3で解消）: constrained re-searchの採用はgenerated Entryを元Entryに追加して保存していたため、
  永続Build Listにlegacy duplicateが生じ、以後の通常Planner入力はfail closedしていた

0-2の実装状態（実装済み）:

- Search画面の依存は `addCandidate()`（`AddBuildListCandidateResult` をそのまま返す）、
  `inspectCandidateReplacement()`、`replaceCandidate()`。`replacement_required` で置換確認Dialog
  （`BuildListReplacementDialog`）を出し、承認後に共通の `usePlanBreakingChangeApproval()` へ
  inspect / applyとして渡す（`useBuildListCandidateReplacement()`）。独自のPlan-breaking state machineは持たない
- 置換成功後は画面内の作成リスト状態から旧Entryを除き新Entryを加える。Serviceの型付き拒否は推測で再試行せず、
  作成リスト状態を読み直して案内する
- Build Listは `findBuildListTargetDuplicates()` の結果でlegacy duplicateのTargetに「要整理」chipとwarningを出し、
  既存のguarded Entry削除（`inspectEntryDelete()` / `deleteEntry()`）で整理させる。Planner操作は無効化せず、
  通常Planner入力のfail closedに委ねる
- 具体的なPresentationと文言はUI_FLOW 9 / 10に記載した。versionは変更しない

0-3の実装状態（実装済み）:

- 置換の共通Domain authorityは `src/domain/buildList/buildListEntryReplacement.ts`（`BuildListEntryReplacement`、
  元Entryの特定 `resolveBuildListEntryReplacement()`、置換後集合 `applyBuildListEntryReplacements()`、
  temporary cardinality `validateBuildListEntryReplacements()`、結果のpairing
  `validateGeneratedBuildListEntryReplacements()`、保存後集合 `validateReplacedBuildListCardinality()`）
- 呼び出し文脈は `PlannerBuildListContext`（`persisted` / `temporary_augmented` / `temporary_replacement`、
  後2者はruntime-onlyの `replacements` を持つ）。temporary側は6.4の「persisted 0..1 + temporary 0..1」を
  検証し、temporary 2件以上、persisted 2件以上、Target不一致、置換対象が一意でない場合はfail closedする。
  full Planner runは型の上で `temporary_augmented` を受け付けない
- B8 / B9のtrialは `preparePlannerReplacementConflictPreflight()` で、`O + G` のaugmented inputに対する
  preflight（9.2.3.1の再対応付け）と、置換後集合 `-O + G` に対する再対応付け（「置換で充足済み」を含む、
  PLANNER_SPEC 9.2.18）の2段階を行い、full Planner runは置換後集合だけで行う。B8の
  `currentAugmentedInput` は採用済みの置換を適用した置換後集合を保持し、同じTargetにtemporary Entryを
  重ねない（採用済みTargetのworkは `isPlannerConflictWorkSatisfied()` で先に充足済みになる）
- 採用結果は `PlannerOrchestrationResult.generatedBuildListEntryReplacements` で「generated Entry → 置換対象の
  元Entry」をWorker境界越しに保存まで運ぶ（serializableなplain data、Worker protocolの型のみ追加）
- 通常Draft保存（`PlannerResultPersistenceService`）と再計画採用は、transaction内で元Entryが今もその
  Targetの唯一の永続Entryであることを確認してから、元Entry削除 + generated Entry追加を行う。通常Draft保存は
  保存全体を1つのguarded mutationとして既存 `PlanBreakingChangeGuard` に通し
  （`inspectPlannerOrchestrationResultSave()` / `savePlannerOrchestrationResult(..., approval?)`）、
  B10の再計算保存を既存の警告Dialogへ接続した。再計画採用は旧実行中Planを `replan_adopted` で終了するため
  追加の警告を出さない
- 通常Draft保存の承認で「最後のゲーム内セーブ地点へ戻す」を選んだ場合は、セーブ地点復元だけを行い、復元前に計算した
  Planner resultは保存しない（generated Entry / Entry置換 / Draft置換なし、Planは破棄しない）。結果は
  `save_point_restored_recalculation_required` のtyped outcomeで返し、B10画面は復元完了と再計算の必要を示す
  （PLANNER_SPEC 9.2.18 / 16.10）。snapshot検証は弱めず、通常のPlan-breaking変更の 復元 -> 変更 -> Plan破棄 は変えない
- versionは変更しない（15.1）

### Phase A0: 状態遷移helperの抽出（純リファクタ）

- `plannerBeamSearch.ts` から、precondition群、`applyRouteAction`、`applyReserveAction`、
  `mergedProgressedEntries`、required / skippable判定を共有moduleへ抽出する。単一stateへのin-place適用を
  選べるようにする（Beamはclone、schedulerはin-place）
- Beam Searchの結果は完全一致（既存test、PR #107 instrumentationのdigest）。semantics変更なし、
  schema変更なし
- **実装済み**: 共有moduleは `src/domain/planner/plannerStateTransitions.ts`。
  `applyPlannerRouteAction()` / `applyPlannerReserveAction()` は呼出側が
  `mode: 'clone' | 'in_place'` を明示し、Beam Searchは `clone` だけを使う

### Phase A: 決定的scheduler Domain（Production未接続）

- `src/domain/planner/` にcommitment（6章）とscheduler（7章）を追加。React / IndexedDB / Workerに依存しない
- `runPlannerDeterministicSchedule(input, dependencies, executionOptions)` が
  `PlannerBeamSearchResult` 互換の結果を返す。`recommendEntry()` のcomparatorを共有helperへ抽出
- 通常入力は1 Target = 1 Entryを前提とし、違反はfail closed（6.2）。temporary augmented inputは
  6.4のとおり置換後集合で扱う
- 内部rejection reasonの追加、`createRejectedBuildListEntries()` の暫定敗者mapping（8.4）は
  schedulerの結果にだけ効くよう準備し、Production経路は変えない
- 16章のscenario A〜M + 追加scenarioをDomain testで固定。scheduler出力が既存Trace Replayを通ることを検証
- Production UI / Worker / schema version は変更しない
- **実装済み（Production未接続）**: 入口は `runPlannerDeterministicSchedule()`
  （`src/domain/planner/plannerDeterministicScheduler.ts`、段階実行用の `createPlannerDeterministicScheduleRun()`）。
  Route commitmentは `plannerRouteCommitment.ts`、canonical順は `plannerSchedulerOrdering.ts`、
  順位関数 `R` は `detectPlannerConflicts()` と共有する `plannerEntryPriority.ts`、
  Beam Searchと共有する探索補助（`detectCurrentPlannerConflicts()`、即時reserve対象、開始時zero-operation confirm等）は
  `plannerSearchShared.ts` へ抽出した。暫定帰結・deadlock / stallの内部rejection reasonは
  `conflict_not_committed`（`createRejectedBuildListEntries()` で `resource_conflict`）。
  `createProductionPlanWithObserver()`、Planner Worker、B8 / B9、再計画Previewは引き続きBeam Searchを使う。
  acceptance testは `plannerDeterministicScheduler.test.ts`

### Phase B: parityとbenchmark

- parity harness: 既存Planner testの入力、PR #107の `sanity-3` / `representative-12` /
  `representative-35`、16章のscenarioでBeamとschedulerを比較する。Build List cardinality導入後の
  入力（1 Target 1 Entry）で比較する
  - 必ず一致: Trace Replay有効、完了判定の意味、checkpoint milestone、PlanStep / executionEffectsの契約
  - 劣化として扱う: 完成Target数がBeamより少ない（理由を分類し、意図した差（暫定帰結がpriority優先）
    として記録するか、19.2の厳密最適化を検討する）
  - 許容する差: Step順、skip可能位置のexecutor、weapon switch数、violation数、返す `conflicts` から
    探索上だけの競合が消えること、`rejectedBuildListEntries` のmapping、preferred sourceのPlanner側
    preference撤去
- scheduler用instrumentation（commitment反復、collision、暫定帰結、動的commit、deadlock、step数、
  safe候補数、待機回数）を追加し、PR #107と同じ実Browser Workerでrepresentative-35を計測して
  記録文書を追加する
- 本Phaseでも、B8 / B9のtestをtest専用の戦略注入でschedulerに対して実行し、adoption / feasibility契約が
  成立することを確認する（Production経路は変えない）
- **実装済み（Production未接続）**。実Browser Worker計測は2026-09-25（UTC 2026-09-24）。記録は
  [ISSUE_103_SCHEDULER_PARITY_BENCHMARK.md](./ISSUE_103_SCHEDULER_PARITY_BENCHMARK.md)
  - parity harnessは `src/benchmarks/plannerSchedulerParity.ts`（`runPlannerSchedulerParity()`、
    `summarizePlannerStrategyRun()`、`comparePlannerStrategyRuns()`）。必ず一致（Trace Replay、planning Target、
    完了 / terminationの意味、required checkpoint、milestone、Production projection、fail-closed入力validation）、
    completion regression（原因分類つき、自動で許容しない）、許容差（記録のみ）の3分類で比較する
  - scheduler instrumentationは `src/domain/planner/plannerSchedulerInstrumentation.ts`
    （`PlannerExecutionOptions.schedulerInstrumentation`、semantics-neutral、Beam depth modelを流用しない）
  - 戦略注入は `createProductionPlanWithSearchRunner()`（`productionPlanGeneration.ts`）。full searchだけを
    差し替え、後段（runtime-unsupported retry、Trace Replay、projection、snapshot、checkpoint defence、
    rejected / materials、observer）は共有する。Productionの `createProductionPlanWithObserver()` は
    `runPlannerBeamSearch` 固定で、Worker / `PlannerInput` / UI / 設定に戦略は無い。B8 / B9のscheduler testは
    test moduleの差し替えでだけこれを使う
  - Browser Workerは既存Issue #103 benchmark Workerを拡張した（benchmark requestだけの `strategy`、
    `issue103Benchmark.run({ strategy })` / `issue103Benchmark.compare()`）
  - Phase B初回（PR #114）の判定は **Phase C readiness: NOT READY** だった。acceptance fixture「deadlock」
    （旧7.8の例）でBeam Searchが両Targetを完成させ（Trace Replay有効）、schedulerはdeadlockとして1件落とした。
    Beamは、pin-blockedのskip可能unitが通過されてもpin解除後に `fastForwardPlannerRouteProgress()` で
    通過できることを示しており、旧5章の「pin-blockedのskip可能unitはholding」と旧7.8「どの順でも両方は
    成立しない」がこの例では成り立たなかった
- **Phase B semantic fix（Phase C前、Production未接続）**。holdingを `canSkipWhenCounterPassed === false`
  だけで決め、pin gatingとCounter位置保持を分離した（5章、PLANNER_SPEC 7.5.2）
  - helper: `isPlannerLaneUnitHolding(unit)`（holding）と `isPlannerLaneUnitFastForwardable(unit, progress, pin)`
    （fast-forwardable now）に分けた。旧 `isPlannerLaneUnitPassable()` は廃止し、
    `fastForwardPlannerRouteProgress()` の判定（pin-blocked中は通過しない）は名前だけ変えて維持した
  - Route commitment（6.2）、動的commitmentのlane frontier判定（6.8）、scheduler frontier（7.2 / 7.3）、
    canonical順のnext-holding距離（7.7 key 4）が新しいholding定義を使う。deadlock / stallの規則と順位、
    canonical順のkey、Beam Search、Trace Replayは変えていない
  - 旧7.8の例は両Target完成、真のdeadlock（fixture `true-deadlock`）は従来どおりdropされる（7.8、16.3）
  - 再検証とPhase C readinessの再判定は [ISSUE_103_SCHEDULER_PARITY_BENCHMARK.md](./ISSUE_103_SCHEDULER_PARITY_BENCHMARK.md) 11章

### Phase C: Production routing切替

- 前提: Phase 0がmerge済み
- `createProductionPlanWithObserver()` をschedulerへ切り替える。通常Planner、B8 orchestration、
  B9 what-if、再計画Previewが同時に切り替わる（12.1）。Productionに戦略切替flagは置かない
- `CURRENT_CALCULATION_APP_SCHEMA_VERSION` 14、build-result例外 `14 -> [12, 13]`、旧Planのfail-closed test
- termination / progressは14章のとおり型を変えずに意味を定義。Worker protocolは変更しない
- 仕様改訂を同じPRで行う: REQUIREMENTS 18（優先起点の記述）/ 19 / 20、PLANNER_SPEC 7 / 7.2 / 7.2.1 /
  7.4 / 10 / 14 / 15.3、UI_FLOW 10.0の説明文、DATA_MODEL（version記述）、AGENTS.md（Calculation Context、
  Planner Search Strategy）
- Beam Searchはtest / benchmark用oracleとしてだけ残す
- **実装済み（Production switched、Calculation schema 14）**
  - `createProductionPlanWithObserver()` は `createProductionPlanWithSearchRunner(runPlannerDeterministicSchedule, ...)`
    を呼ぶ。後段（runtime-unsupported retry、Trace Replay、projection、snapshot、checkpoint defence、rejected /
    materials、termination）は変更していない。Beam Searchは `createProductionPlanWithSearchRunner()` への注入か
    直接呼び出しでだけ到達する（parity harness、Issue #103 benchmark Workerの `strategy`、oracle test）
  - observer hookを `beforePlannerRun` / `afterPlannerRun` へ改名した（12.2、rerun budgetの数え方は不変）
  - `CURRENT_CALCULATION_APP_SCHEMA_VERSION = 14`、`COMPATIBLE_BUILD_RESULT_APP_SCHEMA_VERSIONS` に `14 -> [12, 13]`。
    ProductionPlanは従来どおり4項目完全一致で、version 1〜13のPlan（draft / activeとも）は
    `calculation_context_changed` でfail closedする（read migrationなし、exact persisted表示は維持、active Planは
    現在地点からの再計画）
  - `PlannerOptions`（`beamWidth` を含む）、`defaultPlannerOptions`、`PlannerProgress`、`PlannerSearchTermination`、
    Worker protocolは不変。Build List詳細設定は説明文だけを改めた（UI_FLOW 10.0）
  - `rejectedBuildListEntries` のdetail文言のうちBeam Searchを名指ししていた2つを中立化した（reason / mappingは不変）
  - Phase B semantic fix後のscheduler semanticsは変更していない（acceptance catalogue、sanity-3、representative-12の
    parity testを維持）
- 次はPhase D

### Phase D: UI / legacy整理

Phase Dは2つのPRへ分割する（14.4）。

#### Phase D-1: Production設定 / 進捗Presentation（実装済み）

- Build List詳細設定から「Beam幅」「最大探索状態数」を除去し、「最大計画ステップ数」だけを残した
- 通常schedulerの停止判定から `maxExpandedStates` を外した（`maxPlanSteps` だけ）。
  `max_expanded_states` / `max_expanded_states_reached` は通常schedulerから発生しない
- `maxPlanSteps` 既定値を300から1000へ変更した（Phase Bの計測を根拠とする）
- 通常画面の進捗を `expandedStates / maxExpandedStates` の比率からindeterminate表示へ変えた。
  commitment後の総step数を分母にする案は採用しない（14.4）
- `plannerSearchLimitPresentation.ts`（termination文言）とProduction設定 / 計算中文言
  （`productionPlannerSettingsPresentation.ts`）を分離した
- `CURRENT_CALCULATION_APP_SCHEMA_VERSION` 14、DB 8、Export 11、`RngState` 2、`AppSettings` 1、
  `production-rng:c5-e7`、Master `dataVersion` はいずれも不変。Worker protocol、`PlannerOptions` /
  `PlannerSearchTermination` / `PlannerProgress` の型、`PlannerBeamSearchResult` の名前も不変（D-1時点）
- 仕様改訂: REQUIREMENTS 20、PLANNER_SPEC 7 / 7.2 / 7.2.1 / 15、UI_FLOW 10.0 / 10.1 / 11.2（what-if）/ 16.4、
  AGENTS.md（Planner Search Strategy）

#### Phase D-2a: Production型 / termination / Worker protocol整理（実装済み）

- Production `PlannerOptions` を `maxPlanSteps` だけにし、`beamWidth` / `maxExpandedStates` を
  Beam oracle専用 `PlannerBeamSearchOptions`（既定値・validationも専用）へ分離した
- Production結果型を中立名 `PlannerRunResult` とし、Production termination（`PlannerRunTermination`）は
  `max_plan_steps` だけを取り得る。Beamは `PlannerBeamSearchResult` / `PlannerBeamSearchTermination`
- Production Workerの `progress` responseと `PlannerProgress`、Worker Clientの `onProgress` callbackを削除した。
  cancel / generationは維持
- B8 / B9のPhase C以前の名残（`PlannerFullBeamBudget`、`lastCompletedBeam` など）を中立名へ改めた
- `CURRENT_CALCULATION_APP_SCHEMA_VERSION` 14ほか全versionは不変（14.5）
- 仕様改訂: DATA_MODEL 11（PlannerOptions）/ 11.8 / テスト観点、PLANNER_SPEC 3 / 4 / 5 / 7 / 7.2 / 7.2.1 /
  7.2.2 / 14 / 15、UI_FLOW 10.0 / 10.1 / 11.2、AGENTS.md
- 詳細は14.5

#### Phase D-2b: Beam oracle / instrumentation / benchmark縮退（未着手）

- Beam oracle、`comparePlannerSearchStates()`、semantic key、`evaluationScore` / `totalCost` /
  `preferredSourceProgressCount`、PR #107 Beam instrumentation、scheduler instrumentation、parity harness、
  benchmark page / benchmark Worker、representative fixtureの削除または縮退の判断
- `max_expanded_states_reached` などBeam専用warning kindの型分離
- Issue #103完了判断
- UI変更を含む場合はUI_FLOWを同じPRで改訂する

---

## 18. Scope外

本書および本書のPRでは次を変更しない。

```text
src/**、テスト、package.json
DB migration
schema version（数値）
RNG semantics、Production RNG Engine
Candidate Search algorithm、constrained enumerator
Planner Beam Search実装、Planner実装
Worker protocol
ProductionPlan / PlanStep / Execution
Persistence / Export / Import の実装
UI実装
#101 constrained search bounds
#100 multiple Ideal
```

---

## 19. Open questions

### 19.1 Blocking before implementation

**なし。** Phase 0 / A0 / A / B の着手を妨げる未決事項は無い。調査中に挙がった論点は次のとおり確定した。

| 論点 | 確定内容 |
| --- | --- |
| 通常の永続Build Listで同一Targetの複数EntryをPlannerがどう選ぶか | **選ばない。** 永続Build Listで1 Target = 1 Entryにする（DATA_MODEL 9.4.1）。違反はfail closed（6.2） |
| 同Targetの別Candidateの登録 | 確認のうえatomicに置換。途中採用設定・改善優先は引き継がない（DATA_MODEL 9.4.1、SEARCH_SPEC 10.1） |
| 置換とPlan | 置換全体を1つのguarded mutationとして既存Plan-breaking guardで判定（DATA_MODEL 9.4.1） |
| constrained re-searchの複数Entry | temporary augmented inputだけの例外。採用時に元Entryを置換（PLANNER_SPEC 9.2.18） |
| 採用後に保存Planが削除済みEntryを参照する問題 | 置換後集合で計算・記録する（PLANNER_SPEC 9.2.18、6.4） |
| legacy duplicate | 自動選択・自動削除しない。Planner入力はfail closed、ユーザーが整理（DATA_MODEL 9.4.1） |
| Phase 0のversion | 変更しない（15.1） |
| 同一Targetの複数ConflictResolution | ordinary入力では成立しない。malformed / legacy / augmentedはfail closed（6.3） |
| preferred sourceの責務 | Candidate Search / constrained enumerationに残し、通常Plannerから撤去（6.7、Phase Cで正式改訂） |
| 未解決Conflictの扱い（A / B） | どちらでもなく案C（8.3） |
| `expandedStates` の意味 | 既存定義のまま「構築したstate数」（14.2） |
| 新terminationの要否 | 不要（14.3） |
| constrained re-search内部の別Beam | 持たない（12.1） |
| schedulerのschema境界 | ProductionPlanは14でfail closed、build resultは `14 -> [12, 13]`（15.2 / 15.3） |
| reserveを分岐にするか | しない（7.6） |

Phase CのPull Requestでは、15.2の影響（実行中のversion 13 Planがstaleになり再計画が必要になること）を
プロジェクトオーナーへ明示する。これは決定済み事項の周知であり、Phase 0 / A / Bを止めない
（Phase CのPRで周知済み）。

**Phase Bで判明したPhase C前の判断事項（決定済み）。** pin-blockedのskip可能unitをholdingとして扱う
旧5章 / 7.4の規則と、それに基づく6.8のlane-head判定・commitment判定・7.8のdeadlock判定は、Phase Bのparityで
Beam Searchに反証された（acceptance fixture「deadlock」でBeamが両Targetを完成、Trace Replay有効）。
プロジェクトオーナーの決定により **規則を改めた**: holdingは `canSkipWhenCounterPassed === false` だけで
決まり、checkpoint pinはEntry自身のlane progressを止めるがskippable unitのCounter位置を予約しない
（5章、PLANNER_SPEC 7.5.2）。schedulerは既存Beam / Trace Replayの意味に合わせて修正した（17章 Phase B、
[ISSUE_103_SCHEDULER_PARITY_BENCHMARK.md](./ISSUE_103_SCHEDULER_PARITY_BENCHMARK.md) 11章）。

### 19.2 Can defer

| 論点 | 判断時期 | 暫定 |
| --- | --- | --- |
| 暫定帰結の厳密最適化（完成Target数を最大化するconflict graphの独立集合） | Phase Bのparityで完成数劣化が出た場合 | priority優先のgreedy（6.5） |
| 静的なcross-satisfaction省略（あるTargetの確保武器が別TargetのIdealも満たすと事前に分かる場合、後者のEntryをcommitしない） | Phase B以降 | 動的解放（6.8）だけ |
| deadlock / stallを新しい `ConflictKind` などでユーザーへ示すか | Phase B以降（schema / UI変更を伴う） | rejectionを `resource_conflict` として記録 |
| canonical順でweapon switchと完成の早さのどちらを上位にするか | Phase Bの実データ計測後 | 7.7（priority → violation → switch → 完成近さ） |
| in-flight化による他Targetの充足喪失（7.9の例外）の扱いの強化 | Phase Bのfixture結果次第 | 動的commit（6.8） |
| 置換確認Dialog / legacy duplicate案内の具体的なPresentationと文言 | Phase 0-2（`ui-ux-pro-max`） | **確定済み**（UI_FLOW 9 / 10） |
| Phase 0のPlanner warning kind名、Search追加APIの結果型名 | Phase 0-1 | 意味論だけ確定 |
| Build List詳細設定、`maxPlanSteps` 既定値 | Phase D-1 | **確定済み**（14.4） |
| `PlannerOptions` / `PlannerProgress` の型移行 | Phase D-2a | **確定済み**（14.5） |
| B8 orchestration bounds / what-if boundsの再測定 | #101と合わせて | 現行値のまま |
| Beam oracleとBeam専用stateの削除時期 | Phase D-2b | test / benchmark用に残す |
| scheduler結果型の改名（`PlannerBeamSearchResult` → 中立名） | Phase D-2a | **確定済み**（`PlannerRunResult`、14.5） |
