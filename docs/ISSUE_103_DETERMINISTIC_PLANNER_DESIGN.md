# Issue #103 決定的Planner scheduling 詳細設計

作成日: 2026-09-24。基準main: `9c48b23ecc59360769f9c608ccc2df8f0622f147`（PR #107 merge後）。

## 0. 位置づけとauthority

この文書は Issue #103「大量Build List時のPlanner探索戦略を再設計する」の
**実装時のtask-specific detailed spec（次期Planner契約）** である。PR #107の計測記録
（[ISSUE_103_PLANNER_SEARCH_INSTRUMENTATION.md](./ISSUE_103_PLANNER_SEARCH_INSTRUMENTATION.md)）
を入力とし、次の実装フェーズで採用する通常Plannerの契約を定義する。

```text
Current（現行Production）
  REQUIREMENTS 19 / PLANNER_SPEC 7 のとおり、通常Plannerは上限付きBeam Search

Target design（本書、未実装）
  #103実装後、通常Plannerは「Route commitment + 決定的scheduling」へ移行する
```

- 本書は現行Production semanticsを変更しない。本書の追加時点で `src/**`、テスト、
  schema version、Worker protocol、UIは一切変更していない
- [REQUIREMENTS.md](./REQUIREMENTS.md) 19 / 20、[PLANNER_SPEC.md](./PLANNER_SPEC.md) 7 / 7.2 /
  7.2.1 / 10 / 14 / 15.3、[UI_FLOW.md](./UI_FLOW.md) 10.0 / 10.1、`AGENTS.md` の
  「Planner Search Strategy」は、Production routingを切り替える実装PR（17章のPhase C）で
  本書に合わせて同時に改訂する。それまでは現行文書が現行Productionのauthorityである
- 仕様階層（`AGENTS.md`）上、REQUIREMENTSは本書より上位である。本書はREQUIREMENTS 19の
  「初期版の探索方式は上限付きBeam Search」を置き換える **提案** を含むため、
  Phase CでREQUIREMENTSを先に改訂してから挙動を切り替える。改訂前に挙動だけを変えない
- 本書が変更しない既存契約（Candidate Search、Trace Replay、PlanStep / Execution、
  constrained re-searchの固定authority、checkpoint hard constraint等）は、該当する正式仕様を
  そのままauthorityとする。本書はそれらを「どう再利用するか」だけを定める

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
| semantic keyからtraceを外す | 1.2のとおり安全性の証明が無い。weapon switch / preferred source / improvement preferenceの値がtraceの純関数であるという現行dedupの前提（PLANNER_SPEC 7.3 / 7.4 / 7.6）も崩れる。単独では不採用（21章） |
| scoring / tie-break調整 | trimで完成数の多いstateが落ちたdepthは0。scoringは原因ではない。不採用 |
| dedup / sortの高速化（計測の候補G） | 定数倍の改善にとどまり、branch数自体は減らない。本設計採用後は通常経路で不要になる |
| **Route commitment + 決定的scheduling** | Candidate Routeは既に具体的なCounter位置まで確定しており、残る自由度の大半は「交換可能な操作順」である。これを探索せずcanonicalに決める。**採用** |

---

## 2. 責務分離

### 2.1 Candidate Search

Candidate Searchは「1 Targetを現在状態から作るcanonical Ideal Route」を求める
（[SEARCH_SPEC.md](./SEARCH_SPEC.md) 5.6 / 5.7）。BuildListEntryへ追加された時点で次が確定している。

- source OwnedWeapon（またはnull source / blind forge）
- Normal forge（`count`、Counter位置）
- conversion（Skill Counter位置）
- Reset Bonuses / Keep Bonuses（Gogma Counter位置）
- Reset Skills（Skill Counter位置）
- selected compromise checkpoint（`intermediateStateSelection`）
- final Ideal（Candidate Snapshotの最終結果）

**Plannerは通常ケースでこのRoute自体を再探索しない。** これは現行契約
（Candidate Snapshotの `BuildRoute.operations` を変更しない、REQUIREMENTS 19）と同じである。

### 2.2 Planner

Plannerの主責務を次とする。

```text
複数の選択済みBuildRouteを、
共有Counter / Inventory / physical weapon制約のもとで
同時に成立させる実行順を作る
```

通常Plannerは **Route探索ではなくRoute scheduling** を中心責務とする。ただし「どのEntryを
採用するか（同一Targetの複数Entry、競合の暫定帰結）」だけは決める必要があり、これを
**Route commitment**（6章）として、実行順の決定（**scheduling**、7章）と分離する。

### 2.3 constrained re-search / what-if

選択済みRoute同士が真に両立せず、ユーザーが競合の優先側を明示選択した場合だけ、失う側Targetの
代替Ideal Routeを探す責務を既存constrained re-search（PLANNER_SPEC 9.2）へ残す。what-if（9.2.4）も
同じである。通常Plannerは代替Route探索を内包しない。#101（constrained searchの探索範囲）は
本書で変更しない。

---

## 3. 構造的前提

本設計は、既存仕様から導かれる次の構造に依拠する。いずれも本書で新しく定めるものではない。

### 3.1 Route unitの位置は絶対値である

`PlannerRouteUnit` は保存済み `RouteOperation` から `counterStream`、`counterBefore`、
`counterAfter` を持ち（`createPlannerRouteUnitPlans()`）、counter preconditionは
`current === counterBefore` の完全一致である（`counter_before_current` / `counter_unavailable`）。
Counterは単調増加しかしない。blind forgeだけがCounter位置を持たない（PLANNER_SPEC 7.0.2「Counter位置を持たないRoute unit」）。
設計記録 [CANDIDATE_SEARCH_REDESIGN.md](./CANDIDATE_SEARCH_REDESIGN.md) 1.5 も
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

どちらも、採用Entry集合が同じならCounter進行、各RouteのCandidate結果、Target完成集合、
物理操作数を変えない（7.9）。変わるのはStep順、weapon switch、improvement preference違反数、
in-flight期間だけである。現行Beam Searchが大量に生成していたのは主にこの2種類のbranchである。

### 3.4 前提が崩れた場合

3.2は仕様から導かれるが、schedulerはそれを **正しさの前提にしない**。frontierは常に実際の
`counterBefore` で判定し、あるstreamの現在位置にcommit済みunitが1つも無いのに後方位置の
unitが残る（gap）場合は7.8のstall処理でfail closedする。3.2は性能見積もり（静的操作数）と
説明にだけ使う。

---

## 4. 新しい全体フロー

```text
PlannerInput
  ↓
preparePlannerInitialContext()                     既存（validation、planning Target、
  validBuildListEntries / planningTargets           route unit / lane、checkpoint requirements、
  initialState / initialConflictDetection           initial conflict detection）。変更しない
  ↓
zero-operation confirm（confirm_owned_ideal）        既存の開始時適用。変更しない
  ↓
Route commitment（6章）                              Targetごとに採用Entryを1件（または無し）決める
  - Entry優先順
  - explicit ConflictResolutionの適用
  - 未解決競合の暫定帰結
  ↓
決定的scheduling（7章）                              1 schedule state → canonicalな次操作1つ
  loop:
    frontier算出
    required / skippable / holding判定
    安全な候補actionの列挙
    canonical順で1つ選択して適用（共有progression、fast-forward）
    完成したEntryのreserve（即時・必須）
    relevance / commitment更新（動的イベント）
  ↓
PlannerBeamSearchResult互換の結果（bestState = schedule state）
  ↓
既存Trace Replay → execution projection → ProductionPlan生成（変更しない）
```

原則は「1 state → 多数successor → beamWidth件保持」ではなく
「**1 schedule state → canonicalな次操作1つ**」である。

---

## 5. 用語

| 用語 | 定義 |
| --- | --- |
| stream | `gogma`、`skill`、`normal:<NormalArtianCounter ID>`。blind forgeはstreamを持たない |
| committed Entry | Route commitmentがTargetの採用Entryとして選んだEntry。scheduleが操作を実行するのはcommitted Entryだけ |
| pending unit | committed Entryのunitのうち未実行かつ未通過のもの |
| frontier `F(σ)` | stream `σ` の現在位置 `c_σ` を `counterBefore` にもつpending unitの集合 |
| ready | そのunitが `nextPlannerLaneUnits()` に含まれ（lane順・base先行・pin gating）、`routeUnitPreconditionRejection()` が無く、ConflictResolutionでblockされていない |
| passable | `canSkipWhenCounterPassed === true` かつ、通過時点でpinにblockされない（`isPlannerLaneUnitBlockedByPin()` がfalse）。fast-forwardで安全に通過できる |
| holding | passableでないpending unit（skip不可unit、またはpin-blockedのskip可能unit）。その位置を他の操作に消費させてはならない |
| safe action | 実行してもcommitted Entryのholding unitを1つも失わせないaction（7.3） |

holdingは既存7.0.2の「必須unit」を一般化したものである。pin-blockedのskip可能unitは、他Entryが
その位置を消費すると `fastForwardPlannerRouteProgress()` がpinで止まり、次回 `counter_before_current`
でRouteが失われるため、安全性の判定では必須unitと同じに扱う（7.5.1 / 7.5.2の契約を具体化する
だけで、pinの意味は変えない）。

---

## 6. Route commitment

### 6.1 目的と境界

Route commitmentは、各planning Target（PLANNER_SPEC 4.1）について、そのrunで実行する
BuildListEntryを **最大1件** 決める。Route（RouteOperation列）は一切変更しない。

- 対象は開始時点で未完了のplanning Targetだけである（`isPlannerTargetComplete()`）。
  開始時点でIdealを持つTarget（required checkpoint Entryがある場合を除く）は従来どおり完了扱い
- commitmentは実行順を決めない。実行順は7章のschedulerが決める
- commitmentの競合判定authorityは既存 `detectPlannerConflicts()`（counter group、
  `same_owned_weapon_consumed`、shareable除外、skip可能unit除外）だけである。
  `usedCounters.has(counter)` のような簡易判定を追加しない（PLANNER_SPEC 9.2.2 / 9.2.11）

### 6.2 同一Targetの複数Entry

現行の正式semantics:

- 同一TargetのEntryが複数あっても計画対象Targetは1件（PLANNER_SPEC 4.1）。どのEntryを
  採用するかは「従来のRoute選択semantics」、すなわちBeam Searchのscoringに委ねられていた
- 複数Entryが生じる経路は、所持武器の追加後の再検索（参照武器Hashが無関係な旧Entryは
  staleにならない）、routeFilter付き検索、そして **constrained re-searchの生成Entry**
  （競合の敗者Targetへ代替Routeを追加する。B8のadoptionは生成Entryと固定Entryが同時に
  selectedであることを要求する、9.2.14）である
- 現行scoringは `distancePenalty = estimatedOperationCount * 100` と `conflictPenalty` で
  短いRouteを優先し、不採用理由 `longer_route` もこの意味である
- selected checkpointを持つEntryはTargetのrequired Entryであり、他Entryは候補から外れる
  （7.5.6）。選択を持つEntryが同一Targetに2件以上ならPlanner入力はfail closed（7.5.7）
- preferred sourceは同評価時だけのsoft preference（7.4）

これらから、Target `T` の **Entry優先順 `L(T)`** を次で確定する。「Candidate Searchの
canonicalだから常に最初のEntry」とはしない。

```text
L(T):
  1. required checkpoint Entry があれば、それだけ（7.5.6、他Entryは候補外のまま）
  2. 有効なexplicit ConflictResolutionで選択されたEntryを先に
  3. Candidate Snapshot の estimatedOperationCount 昇順
  4. preferred source一致（entry.candidateSnapshot.route.sourceOwnedWeaponId
     === target.preferredOwnedWeaponId、7.4の判定）を先に
  5. BuildListEntry ID 昇順（stable）
除外:
  - 有効なConflictResolutionにより、holding unit（skip不可unit）が1つでもblockされるEntry
    （isUnitBlockedByConflictResolution() の既存semantics。そのEntryは完成できない）
  - 開始時点で既にholding unitが通過済みのEntry（counter_before_current）
```

- 2はユーザーの明示選択を採用Entryとして尊重するためである。explicit resolutionは局所競合の
  解決だが、B8のadoption / B9のfeasibilityは固定Entryがselectedであることを要求する
  （9.2.14 / 9.2.4.7）。現行Beam Searchでは、固定Entryと同じTargetの別Entryが安ければ固定Entryが
  selectedにならずtrialが採用できない場合があり得た。本規則でこれを解消する
- 4がcostより下位であることは7.4（1操作以上遠いRouteをpreferredだけで逆転させない）に従う
- `recommendedBuildListEntryId` はこの順序に使わない

### 6.3 静的競合と暫定帰結

採用候補集合 `{ tentative[T] }` の中で `detectPlannerConflicts()` が競合を検出した場合を
**collision** と呼ぶ。collisionは位置が絶対値なので静的に決まる（3.1）。

**explicit resolutionがある競合**（`PlanConflict.selectedBuildListEntryId` が既存規則で
適用された初期競合）は6.2の除外で処理済みである。非選択participantはholding unitがblockされ
`L(T)` から外れる。選択Entryは `L(T)` の先頭に来る。

**explicit resolutionが無い競合**は、ユーザー判断待ちの競合として `PlanConflict` で返しつつ、
Draftを作るために **暫定帰結（provisional outcome）** を決める（8章で理由を述べる）。
暫定帰結は次の決定的なfixed-point手続きで決める。

```text
順位関数 R: 既存 recommendEntry() のcomparatorを共有helperへ抽出したもの
  Target priority 降順
  → nextCandidateDistance(entry, initialRelevantEntries) 降順
     （既存の初期競合検出が recommendEntry() へ渡すEntry集合と同じ）
  → estimatedOperationCount 昇順
  → BuildListEntry ID 昇順
  （各Entryのkeyはparticipant集合に依存しない。したがって暫定勝者は、
   返す競合（8.5）の推奨participantがcommit候補である限りそれと一致する）

tentative[T] = L(T)[0]      （L(T) が空なら T は未commit）
decided = ∅
loop:
  C = tentative集合でのcollision（detectPlannerConflicts）
  C が空なら終了
  E* = C のparticipantのうち、未decidedで R が最良のEntry
  # 損失回避（1段lookahead）
  V = E* とcollisionし、E* とdecided集合のどちらともcollisionしない代替Entryを
      L(U) 内に持たない未decided Target U の集合
  if V ≠ ∅ かつ T(E*) の L 内に、decided集合とも V の各 tentative とも
     collisionしない後続Entry E' がある:
       tentative[T(E*)] = 最初のそのような E'   （T(E*) はまだdecidedにしない）
       continue
  decided に E* を加える（T(E*) は E* で確定）
  E* とcollisionする各未decided Target U:
       tentative[U] = L(U) 内で現在より後の、decided集合のどれともcollisionしない最初のEntry
       無ければ U は未commit（そのTargetはこのrunで完成しない）
committed = decided ∪ （collisionの無い残りtentative）
```

- 停止性: 各反復は、あるTargetの `tentative` を `L` の後方へ進めるか、Targetを1件decidedにする。
  どちらも有限回である
- decidedになったEntryは以後置き換えない
- 損失回避は「暫定勝者側に衝突しない代替Routeがあり、敗者側に無い」場合だけ勝者側を代替へ
  移す。完成Target数を減らさない方向の局所改善であり、現行scoring（完成Target 1件あたり
  `1_200_000 + priority * 120_000`、操作1件あたり `100`）がTarget数を操作数より強く重視する
  ことと整合する。全体最適（conflict componentの厳密解）は保証せず、Can deferとする（19.2）
- `same_owned_weapon_consumed` も同じ手続きで扱う。同じ武器を破壊的に使う2 Entryは、
  全unitが1つのshareable actionである退化ケースを除きcollisionである（既存
  `consumedWeaponGroups()`）

### 6.4 checkpointとの関係

- required checkpoint Entryを持つTargetの `L(T)` はそのEntryだけであり、collisionで敗者に
  なればTargetはこのrunで完成しない。別Entryへ自動差し替えしない（7.5.6 / 9.5.2）
- checkpoint participantを含む競合は、既存どおりexplicit resolutionを拒否する
  （`conflictResolutionRefusalReason()`、9.5.1）。暫定帰結は6.3の手続きで決まるが、
  それは永続的な解決ではなく、解決手段はBuild Listでの選択変更だけという契約は変わらない
- checkpointを `hasIdeal` だけで完了扱いにしない（`isPlannerTargetComplete()` を使う）

### 6.5 preferred sourceの反映位置

preferred sourceは **Route（Entry）選択のpreference** としてだけ反映する（6.2の4）。
現行Beam Searchは `preferredSourceProgressCount` を物理actionごとに数えており、skip可能位置を
preferred Entryの武器で消費したbranchが残りやすいという副作用があった。これはRoute選択とは
無関係なBeam固有のartifactであり、schedulerの実行順（7章）には使わない。

### 6.6 動的なcommitment更新

schedule中に次が起きた場合だけ、影響Targetについてcommitmentを更新する。

| イベント | 処理 |
| --- | --- |
| committed EntryのTargetが別Entryのreserveで `hasIdeal` になった（required Entryを除く） | そのEntryを解放する（以後そのunitはholdingしない）。現行relevance（`entryIsRelevantForState()`）と同じ |
| committed Entryの実行前提が崩れた（inventory、source version、protection） | そのEntryを失敗とし、既存rejection reasonを記録してTargetを再commit |
| in-flight化によりplanning Targetの `hasIdeal` がfalseへ戻った | 未commitならTargetを再commit |
| 7.8のdeadlock / stallでEntryを落とした | Targetを再commit |

再commitは6.2の `L(T)` を先頭から走査し、現在状態で実行可能（未実行のholding unitがすべて
現在位置以降、source / version / protectionが成立）かつ、現在のcommitted集合と
`detectPlannerConflicts()` でcollisionしない最初のEntryを採る。既存のcommitted Entryを
押し出さない。見つからなければTargetはこのrunで完成しない。

---

## 7. 決定的scheduling

### 7.1 State

stateは既存 `PlannerSearchState` をそのまま使う（20章）。schedulerは単一stateを前進させる
ため、Beam Searchのようにactionごとにstate全体を `structuredClone()` する必要は無い。
状態遷移は既存関数（`applyRouteAction()` / `applyReserveAction()` /
`fastForwardPlannerRouteProgress()` / precondition群）を共有helperへ抽出して再利用し、
同じ遷移authorityをBeam SearchとTrace Replayと共有する（二重実装しない）。

### 7.2 frontier

各stream `σ` について `F(σ) = { committed Entryのpending unit u | u.counterBefore === c_σ }`。
blind forgeは、そのEntryのbase lane先頭がblind `create_normal_artian` であるときfrontierに入る。

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
2. **executor選択**: `F(σ)` にholding unitが無いとき、`F(σ)` のreadyなpassable unitを1つ
   executorとして実行する候補が、executorごとに1つずつある
3. **blind forge**: readyかつ、そのNormal Counterが確定（`isConfirmed && counter !== null`）なら
   `normal:<その武器種>` にpending unitが1つも無いとき（未確定なら常に）

safeの条件は「実行後、`F(σ)` のうちそのactionで進まなかったunitがすべてpassable」である。
1ではholding unitが2つ以上のphysical actionに分かれることはない（6章のcommitmentがcollisionを
排除している）。holding unitがreadyでない場合、その位置は **待つ**。
blind forgeの条件は、確定Normal Counterを1進めることでpredicted forgeのholding位置を失わせない
ためである（PLANNER_SPEC 7.0.2「Counter位置を持たないRoute unit」の「この実行順はBeam Searchの探索が決める」を、決定的な待機規則へ置き換える）。

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
| 4 | executor選択時: executor Entryの次のholding unitが同じstream上で近い方 | 近くその武器を操作する必要があるEntryで位置を消費し、後続の切替を減らす |
| 5 | actionが進めるEntryの残りpending unit数（少ない方） | 完成に近いRouteを先に終える |
| 6 | stable: stream順（base / `normal:*` → skill → gogma）、Counter位置、primary Entry ID | 決定性 |

- 1〜3の順はPLANNER_SPEC 7.3 / 7.6の優先順位（Target / 評価 → improvement preference →
  weapon switch → stable）と同じ並びである。preferred sourceはRoute選択で反映済み（6.5）なので
  ここには入らない
- **同じ意味のA→B / B→Aを両方探索しない**。7.9のとおり、safe actionの順序はcommitted集合の
  完成可否を変えないので、canonical順で1つ選べば十分である
- 1つのEntryでBonus laneとSkill laneの両方がsafeな場合（シナリオG）、`skill_first` /
  `bonus_first` は2のkeyで優先laneを選ぶ。優先laneがsafeでない（他Entryのholdingや
  pinで待つ）場合は、反対laneを進めてviolationを記録する（soft preferenceであり、hard constraint
  より上位にしない）。`planner` は2で差が付かず、3〜6で決まる。6のstream順（Bonus先）は決定性
  のためのtie-breakであり、7.9によりfeasibilityへ影響しないので、PLANNER_SPEC 7.6の
  「`planner` はBonusを先に試す意味ではない」（branchを片側に固定してPlanを破綻させない）
  という趣旨と矛盾しない
- 上限付きではないが局所的な規則であるため、weapon switch数・violation数の絶対最小は保証しない
  （現行契約と同じ）

### 7.8 待機・deadlock・stall

safe actionが無いのにpending unitが残る場合:

- **deadlock**: 各holding unitがreadyでなく、その前提（base、lane順、pin）が別streamの進行を
  待ち、それが循環している。例: Entry XのGogma C5（required）がX自身のconversion（Skill S10）を待ち、
  Skill S9はEntry Yのpin解除（Y自身のGogma C7）を待つ。どの順でも両方は成立しない
- **stall**: あるstreamの現在位置にcommitted unitが無いのに後方位置のpending unitがある（3.4）

どちらも、関与するcommitted Entryのうち6.3の順位関数 `R` が最下位のものを1件落とし
（rejectionを記録、8.4）、そのTargetを再commit（6.6）して継続する。決定的である。
現行Beam Searchでは同じ状況で一方のRouteが `counter_before_current` で失われ、conflictとしては
報告されなかった。これを新しい `ConflictKind` として報告するかはCan defer（19.2）とする
（`ConflictKind` 追加は永続shapeとUIの変更を伴うため）。

### 7.9 canonical順で十分である理由

safe actionについて次が成り立つ。

- 別streamのsafe action `a`、`b` は可換である。Counterはstreamごとに独立し、lane progressは
  Entryごとに独立し、commitment後のcommitted Entryは互いに別の武器を破壊的に使う（7.5）
- readinessは単調である。actionはlane progressを増やすだけであり、pin gatingはもう片方のlaneの
  progressが増えるほど解除される。reserveによるrelevance解放はholdingを減らすだけである
- したがって `a` の実行は `b` のsafetyを壊さない（`b` のstreamの `F` もholding性も変えない）
- 同じ位置のexecutor選択の違いは、Counter・lane progress・Route結果を変えず、どの武器を
  中間操作したか（source version、in-flight、trace）だけを変える

よってsafe actionだけを実行する限り、どの順でもcommitted集合の完成可否は同じであり、
safe actionが尽きてpendingが残る状態はどの順でも到達する真のdeadlockである。
例外はin-flight化による他Targetの充足喪失（6.6）で、再commitがholdingを増やし得る。
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
持たないためparticipantにならず、7.3の待機規則で順序だけを決める（現行PLANNER_SPEC 7.0.2「Counter位置を持たないRoute unit」と同じ区別）。

### 8.2 ConflictResolution

既存のstable Conflict ID（DATA_MODEL 11.8）と `PlannerConflictResolution` の型・適用規則を
変更しない。

```text
ConflictResolutionで選択Entryがある
  → その競合では選択Entryを採用（6.2の2で当該TargetのL先頭）
  → 非選択participantはholding unitがblockされ、そのTargetのLから外れる（6.2）
  → schedulerは継続
```

- `recommendedBuildListEntryId`、Planner bestState、Target priority、scoreを固定authorityに
  しない（9.2.7）。暫定帰結（6.3）は固定制約ではなく、ConflictResolutionを生成せず、
  `PlanConflict.selectedBuildListEntryId` は `null` のままである
- 選択が無効な場合（削除済み、stale、非participant、checkpoint競合）は既存どおり
  `invalid_conflict_resolution` を返す
- **ConflictResolutionがあっても、失ったRouteを自動で別Routeへ書き換えない。** 代替Routeが
  必要なら、ユーザーの明示選択を経て既存constrained re-search（12章）へ渡す

### 8.3 未解決Conflictに到達した場合

選択肢と判断:

| 案 | 内容 | 判断 |
| --- | --- | --- |
| A | その時点でrunを停止し、partial Plan + Conflictを返す | 不採用。複数の未解決競合があると、固定Entry / trial Entryが後方でreserveされる前に止まり、B8のadoption（9.2.14）とB9のfeasibility（9.2.4.7）が成立しない。Draftは競合より後ろの独立Targetを失う |
| B | participant以外だけ進め、両participantを止める | 不採用。3.3により、holding位置を誰も消費しないとそのstreamが止まり、後方の全Entryが止まる。止めずに第三者が消費すれば両participantを失う。現行より完成Targetが減る |
| **C** | **暫定帰結（6.3）で勝者をcommitし、全体を最後までscheduleし、競合は `PlanConflict` として返す** | **採用**。現行Beam Searchも競合の一方を（scoreにより）実行して最後まで探索し、競合を返している。挙動の意味が近く、B8 / B9 / B10の既存契約をそのまま満たす |

接続:

- **conflict UI（UI_FLOW 11.1）**: 表示する競合は8.5のとおり既存と同じIDの集合である。
  暫定勝者は6.3の順位関数が既存 `recommendEntry()` と同じcomparatorなので、full-set推奨
  participantがcommit候補である限り「Planner推奨」badgeとDraftで実際に進むparticipantが一致する
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
| 同一Targetの別Entryを採用 | 記録なし（従来どおり） | `longer_route` / `dominated_by_better_candidate`（従来どおり） |
| Targetが他の武器で充足 | 既存 `candidate_already_satisfied` | `already_satisfied` |
| 前提崩れ・保護 | 既存reason | 既存mapping |

現行 `createRejectedBuildListEntries()` は `resource_conflict` をexplicit選択がある場合だけに
付けていた。暫定帰結の敗者も `resource_conflict`（「他の候補と資源が競合しました」）として
表示するのが実態に合うため、mappingをPhase Aで変更する。これはProductionPlanの計算結果の
変更であり、14章のschema境界に含まれる。

### 8.5 返す `conflicts`

- 既存 `preparePlannerInitialContext().initialConflictDetection` の競合（初期relevant集合全体、
  IDは既存規則）を返す。UIのavailability判定（UI_FLOW 11.1）が同じ経路で再現するIDである
- 加えて、動的commitment更新（6.6）の時点で `detectCurrentPlannerConflicts()` と同じ関数で
  検出した競合を、IDでdedupして加える
- 現行Beam Searchは破棄されたbranchを含む全展開stateの競合を集めていた（`discoveredConflictsById`）。
  schedulerはbranchを持たないため、探索上だけ現れた競合は返さない。これにより「現在のPlanner
  入力ではこの競合を再現できない」と表示される競合が減る

---

## 9. 同一Target複数Entry・checkpoint・preferencesのまとめ

| 契約 | 反映場所 | 強度 |
| --- | --- | --- |
| required checkpoint Entry（7.5.6） | commitmentの `L(T)`（唯一の候補）、完了判定 | hard |
| 1 Targetにつき選択Entry最大1件（7.5.7）、既Ideal Targetの選択（7.5.8）、壊れた選択（7.5.9） | 既存Planner入力validation（変更しない） | hard（fail closed） |
| pin gating / pin終端skip不可（7.5.1 / 7.5.2） | ready判定、holding判定 | hard |
| checkpoint未到達のreserve拒否（7.5.3） | 既存 `applyReserveAction()` | hard |
| milestone / `checkpoint_state_mismatch`（7.5.4） | 既存Trace Replay（変更しない） | hard |
| explicit ConflictResolution | commitmentの除外と `L(T)` 先頭 | 局所hard |
| 暫定帰結 | commitmentのfixed point | Draft用の暫定 |
| preferred source（7.4） | commitmentの `L(T)`（cost下位） | soft |
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
| `preferredSourceProgressCount` | 不要（Beam専用） | 6.5。Phase Cでは型互換のため0以外でも可、Phase Dで削除を判断 |
| `totalCost` | 不要（Beam専用） | `trace.length` と同値。Phase Dで削除を判断 |
| `evaluationScore` | 不要（Beam専用） | 11章 |

Execution / Trace Replay / conflict correctnessに必要なfieldは1つも削らない。

### 10.2 scheduler専用のruntime情報

committed Entry集合、`L(T)` の位置、commitment結果、非commit理由は **scheduler内部のruntime情報**
であり、`PlannerSearchState`、`ProductionPlan`、`PlanStep`、DB schemaへ追加しない。

---

## 11. semantic keyとevaluationScore

- schedulerはbranchを持たないため、semantic dedupそのものが通常経路で不要になる。
  `createPlannerSearchStateSemanticKey()` は変更せず、Beam Search oracleとinstrumentationのために
  残す。「traceをsemantic keyから削るだけ」の変更は行わない（1.3）
- `evaluationScore` / `comparePlannerSearchStates()` / `scoreCandidate()` / progress potentialは
  通常schedulerの決定に使わない。commitmentの判断は6章の `L(T)` と順位関数 `R`、実行順は7.7で決まる。
  Phase Cでは `evaluationScore` を最終stateに対して既存 `evaluatePlannerSearchState()` で1回だけ
  計算して診断用に保持してよい（どの判断も読まない）。削除はPhase Dで判断する
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
deterministic scheduling
  ↓
Conflict（PlanConflict、暫定帰結つきDraft）
  ↓
ユーザーが優先Entryを選択（PlannerConflictResolution）
  ↓
失うTargetだけ constrained re-search（既存B8、enumeratorは変更しない）
  ↓
代替Ideal Candidate → temporary / generated BuildListEntry
  ↓
initial conflict preflight（既存9.2.3.1、shared helperのまま）
  ↓
deterministic scheduling再実行（初期stateから）
```

### 12.2 維持する契約

- 固定authorityは `PlannerConflictResolution.selectedBuildListEntryId` だけ（9.2.7）
- 生成Entryは途中stateへinjectせず初期stateから再実行（9.2.10）。schedulerは1回のrunが安価なので
  この制約はむしろ容易になる
- 共存可能性の最終authorityは完全再実行 + Trace Replay（9.2.11）。preflightは判定しない
- adoption条件（9.2.14）とfeasibility（9.2.4.7）は `plan.selectedBuildListEntryIds` を読むだけで
  あり変更しない。6.2の2により固定Entryは固定Targetの採用Entryになる
- 生成Entryは敗者Targetの `L(T)` に入る。元Entryはresolutionでblockされ除外される（6.2）
- `maxPlannerReruns` は「full Planner runの回数」を数える。意味（1回の `createProductionPlanWithObserver()`
  内のruntime-unsupported retryを含む）は変えず、observer hookの名称（`beforeBeamSearch` 等）は
  Phase Cで意味を保ったまま改名してよい
- orchestration bounds（2 / 1 / 4）とenumeration boundsの値は本書で変更しない。Beam runが
  高価だったために小さくした経緯があるので、再測定はCan defer（#101と合わせて扱う）

### 12.3 what-if

what-ifのUI / Domain semantics（`scenarioResolution`、`defaultPlannerWhatIfBounds`、
`blocked_by_selected_checkpoint` 等）は変更しない。ConflictResolution + trial Entry + Planner rerunの
構造はそのまま動作する。

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
| `maxPlanSteps` | 使う。traceの長さ（reserveを含む）の安全上限。到達で `incomplete`（`max_plan_steps`） | 維持 |
| `maxExpandedStates` | 使う。構築したstate数（14.2）の上限。到達で `incomplete`（`max_expanded_states`）。構築state数は適用action数でありtrace長以下なので、`maxExpandedStates >= maxPlanSteps` なら `maxPlanSteps` が先に効く | Phase Cは意味を保って維持。Phase DでUIからの除去を判断 |
| `beamWidth` | 使わない（検証の「1以上の整数」は型互換のため維持） | Phase CはUI文言だけ修正。Phase DでUIと型から除去を判断 |

- 3項目の型、`defaultPlannerOptions`、Worker protocol、UI入力検証はPhase Cでは変更しない
- 通常schedulerの停止性は `maxPlanSteps` だけで保証される（各反復でtraceが1以上伸びるか、終了する）。
  commitmentも有限反復である
- constrained re-search / what-ifに独自のBeam用Optionは無い（12.1）
- Build Listの「詳細設定」（UI_FLOW 10.0）: Phase Cでは項目を残し、説明文を「最大探索状態数 =
  Plannerが構築する状態数の上限」「Beam幅 = 現在の通常Plannerでは使用しない」へ改める。
  Phase Dで「最大探索状態数」「Beam幅」の除去と、必要なら `maxPlanSteps` 既定値の見直しを行う
  （既定値300は大量Build Listで不足しやすい。commitment後の総step数は静的に分かるので根拠を持って
  決められる）

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
  Phase Dで扱う

### 14.3 terminationの意味

statusと決定順序（PLANNER_SPEC 7.2.1）を変更しない。新しいstatusは追加しない。

| status | 通常schedulerでの意味 |
| --- | --- |
| `cancelled` | 従来どおり |
| `completed` | 全planning Targetが完了（required checkpoint Entryのsecureを含む、既存判定） |
| `incomplete` | `maxPlanSteps` または `maxExpandedStates` が完成前にscheduleを打ち切った。Persistenceは従来どおり拒否 |
| `exhausted` | boundに達せずscheduleを終え、全Target完成に至らなかった。未解決競合の暫定敗者、resolutionの非選択、前提崩れ、deadlock、保護などで完成できないTargetがある |

未解決Conflictで一部Targetが完成しない場合は、現行と同じく `exhausted` + `plan != null` +
`conflicts` である。これは「入力・Conflict・resourceにより完成Planが無かった通常の結果」
（7.2.1）そのものなので、新status（例: `conflict`）は不要である。UIの `exhausted` 表示
（UI_FLOW 10.1「現在の入力から作成できる生産計画はありませんでした。」）は `plan === null` の
場合の表示であり、`plan != null` のexhausted resultは従来どおりDraftとして保存・表示される。

---

## 15. Calculation schema境界

### 15.1 ProductionPlan

Phase Cで `CURRENT_CALCULATION_APP_SCHEMA_VERSION` を **13 → 14** へ上げる（本書では値を変更しない）。

理由:

- 同じ `PlannerInput` に対して、採用Entry（6.2）、未解決競合の帰結（6.3）、返す `conflicts`（8.5）、
  `rejectedBuildListEntries` のmapping（8.4）、Step順が変わる。explicit resolutionの非選択側が
  共有actionで完成するケース（7.6）も変わる
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

### 15.2 BuildCandidate / BuildListEntry

Candidate Search semantics、Candidate Snapshot、BuildListEntry shape、staleness、constrained
enumeratorは変わらない。したがって明示的なbuild-result例外を `14 -> [12, 13]` とし、
gameVersion / masterDataVersion / rngEngineVersionが一致し通常のstale判定に当たらない限り、
version 12 / 13のBuildCandidate / BuildListEntryをversion 14で再利用可能とする。
version 1〜11は従来どおり非互換、例外をProductionPlanへ適用しない。

### 15.3 変更しないversion

`DATABASE_SCHEMA_VERSION`（8）、`ExportRoot.schemaVersion`（11）、`RngState.schemaVersion`（2）、
`AppSettings.schemaVersion`（1）、`PRODUCTION_RNG_ENGINE_VERSION`、Master `dataVersion` は変更しない
（永続shape、RNG、Masterのいずれも変わらないため）。

---

## 16. 必須acceptance scenarios

各scenarioはPhase AのDomain testとPhase Bのparity fixtureに入れる。「branchを作らない」は、
1 stepあたり構築するstateが1つであること（`expandedStates` 増分が1）と、候補actionを
canonical順で1つだけ適用したことを検証する。

| # | 入力 | 期待動作 |
| --- | --- | --- |
| A | Target A: Gogma laneだけ（C50で完成）、Target B: Skill laneだけ（C100で完成） | 競合なし。Gogma C0〜C50はAの武器、Skill C0〜C100はBの武器が消費する。canonical順（priority → switch）で一方のrunをまとめて行い、両方完成（`completed`）。branchなし |
| B | A / B / Cの最終unit（required）の `counterBefore` がそれぞれGogma C50 / C80 / C120（全Route起点C0） | Gogma streamはC0から昇順に消費。C50でA、C80でB、C120でCのrequired unitが実行され、各直後にreserve。他の位置はpassableで、executorは7.7で決まる。物理Gogma操作数は121 |
| C | A: C50 required、B: C50 skippable | 候補は「Aを実行」だけ。Bはfast-forward。Bを実行するbranchもrejectionも作らない |
| D | A: C50 Weapon A Keep required、B: C50 Weapon B Reset required | commitmentで `same_gogma_counter` のcollision。resolutionが無ければ6.3の暫定帰結で一方だけcommitし、競合を `PlanConflict` で返す（`selectedBuildListEntryId = null`）。順序探索をしない。敗者は `resource_conflict` |
| E | 2 Entryが同じconcrete source weaponの同じphysical action（同type・同Counter遷移）を次unitにもつ（両者の全unitが1 actionの退化ケース） | 1 actionで両Entryをprogressし、`progressedBuildListEntryIds` に両方を記録。version共有も既存どおり。Trace Replayがidentityを再検証 |
| F | 別EntryのEntry-local transient Gogma（null source）が同じGogma位置 | shareableでない。両方requiredならcollision、両方skip可能なら一方がexecutorで他方fast-forward。1 actionで両Entryを進めない |
| G | 1 TargetのBonus laneとSkill laneが同時にsafe | `bonus_first` / `skill_first` は優先laneを選ぶ。優先laneが待ちなら反対laneを進めviolationを記録。`planner` はweapon switch → 残り数 → stable順。両branchを保持しない |
| H | selected checkpointを持つEntry | そのEntryだけが `L(T)`。pin gatingで片laneがpinを越えない。checkpoint到達前にreserveしない（`selected_checkpoint_not_reached`）。milestoneはpin終端Stepに載り、Trace Replayが検証。`hasIdeal` だけでcompleteにしない |
| I | 同一Targetに2 Entry（costが同じで片方がpreferred source / preferredが1操作遠い） | 同costならpreferredをcommit。preferredが遠ければ短い方をcommit（逆転しない） |
| J | 2 Routeが同じOwnedWeaponを破壊的に使用 | `same_owned_weapon_consumed` のcollision。片方だけcommit。source version / in-flight / 保護の既存semanticsを維持 |
| K | 新規Normal（predicted forge 2本）→ conversion → Reset / Reset Skills | Normal Counter位置でforge（required）、Skill起点でconversion（required、Skill +1、Gogma +0）、base完了までGogma laneのholding位置は待つ。transient subjectはEntry-local。blind variantではforgeがCounter位置を持たず、確定Counterなら同武器種のpredicted forgeが残る間は待ってから1進める |
| L | ConflictResolutionで一方を選択 | 選択EntryがそのTargetの採用Entry、非選択participantは除外（`conflict_resolution_not_selected`）。scheduleを継続。非選択Routeを別Routeへ変換しない。resolution以外の競合は暫定帰結 |
| M | constrained re-searchで敗者Targetへ生成Entryを追加 | preflightでresolutionを再対応付け後、初期stateから再実行。生成Entryは敗者Targetの `L(T)` に入り、元Entryはblockされ除外。adoptionは既存条件で判定 |

追加で固定するscenario:

- zero-operation `existing_gogma_current` の `confirm_owned_ideal` が開始時に適用され、その武器を
  起点にする他Routeが保護で実行不能になる
- deadlock（7.8の例）で `R` 最下位のEntryが落ち、代替があれば再commitされる
- reserveした武器が別planning TargetのIdealも満たし、そのTargetのcommitted Entryが解放される
- `maxPlanSteps` 到達で `incomplete`、partial Planは保存されない
- cancelで `cancelled`
- 同じ入力・同じEngine fixture・同じID factory / clockで結果が完全一致する（決定性）

---

## 17. 実装フェーズ

依存関係: 状態遷移の共有化 → scheduler Domain → parity / benchmark → Production切替
（B8 / B9も同時に切り替わる）→ UI / legacy整理。

### Phase A0: 状態遷移helperの抽出（純リファクタ）

- `plannerBeamSearch.ts` から、precondition群、`applyRouteAction`、`applyReserveAction`、
  `mergedProgressedEntries`、required / skippable判定を共有moduleへ抽出する。単一stateへのin-place適用を
  選べるようにする（Beamはclone、schedulerはin-place）
- Beam Searchの結果は完全一致（既存test、PR #107 instrumentationのdigest）。semantics変更なし、
  schema変更なし

### Phase A: 決定的scheduler Domain（Production未接続）

- `src/domain/planner/` にcommitment（6章）とscheduler（7章）を追加。React / IndexedDB / Workerに依存しない
- `runPlannerDeterministicSchedule(input, dependencies, executionOptions)` が
  `PlannerBeamSearchResult` 互換の結果を返す。`recommendEntry()` のcomparatorを共有helperへ抽出
- 内部rejection reasonの追加、`createRejectedBuildListEntries()` の暫定敗者mapping（8.4）は
  schedulerの結果にだけ効くよう準備し、Production経路は変えない
- 16章のscenario A〜M + 追加scenarioをDomain testで固定。scheduler出力が既存Trace Replayを通ることを検証
- Production UI / Worker / schema version は変更しない

### Phase B: parityとbenchmark

- parity harness: 既存Planner testの入力、PR #107の `sanity-3` / `representative-12` /
  `representative-35`、16章のscenarioでBeamとschedulerを比較する
  - 必ず一致: Trace Replay有効、完了判定の意味、checkpoint milestone、PlanStep / executionEffectsの契約
  - 劣化として扱う: 完成Target数がBeamより少ない（理由を分類し、6.3の損失回避で直すか、
    意図した差（暫定帰結がpriority優先）として記録）
  - 許容する差: Step順、skip可能位置のexecutor、weapon switch数、violation数、返す `conflicts` から
    探索上だけの競合が消えること、`rejectedBuildListEntries` のmapping
- scheduler用instrumentation（commitment反復、collision、暫定帰結、再commit、deadlock、step数、
  safe候補数、待機回数）を追加し、PR #107と同じ実Browser Workerでrepresentative-35を計測して
  記録文書を追加する
- 本Phaseでも、B8 / B9のtestをtest専用の戦略注入でschedulerに対して実行し、adoption / feasibility契約が
  成立することを確認する（Production経路は変えない）

### Phase C: Production routing切替

- `createProductionPlanWithObserver()` をschedulerへ切り替える。通常Planner、B8 orchestration、
  B9 what-if、再計画Previewが同時に切り替わる（12.1）。Productionに戦略切替flagは置かない
- `CURRENT_CALCULATION_APP_SCHEMA_VERSION` 14、build-result例外 `14 -> [12, 13]`、旧Planのfail-closed test
- termination / progressは14章のとおり型を変えずに意味を定義。Worker protocolは変更しない
- 仕様改訂を同じPRで行う: REQUIREMENTS 19 / 20、PLANNER_SPEC 7 / 7.2 / 7.2.1 / 10 / 14 / 15.3、
  UI_FLOW 10.0の説明文、DATA_MODEL（version記述）、AGENTS.md（Calculation Context、Planner Search Strategy）
- Beam Searchはtest / benchmark用oracleとしてだけ残す

### Phase D: UI / legacy整理

- Build List詳細設定から「Beam幅」「最大探索状態数」を除去するか判断し、`PlannerOptions` /
  `PlannerSearchTermination.limits` / `PlannerProgress` の型移行（進捗の分母をcommitment後の総step数に）
- `maxPlanSteps` 既定値の見直し（Phase Bの計測を根拠とする）
- Beam oracle、`comparePlannerSearchStates()`、semantic key、`evaluationScore` / `totalCost` /
  `preferredSourceProgressCount`、PR #107 Beam instrumentationの削除または縮退
- UI変更を含む場合はUI_FLOWを同じPRで改訂する

---

## 18. Scope外

本書および本書のPRでは次を変更しない。

```text
src/**、テスト、package.json
schema version（数値）
RNG semantics、Production RNG Engine
Candidate Search、constrained enumerator
Planner Beam Search実装
Worker protocol
ProductionPlan / PlanStep / Execution
Persistence / Export / Import
UI
#101 constrained search bounds
#100 multiple Ideal
```

---

## 19. Open questions

### 19.1 Blocking before implementation

**なし。** Phase A（およびA0、B）の着手を妨げる未決事項は無い。調査中に挙がった次の論点は本書で確定した。

| 論点 | 確定内容 |
| --- | --- |
| 未解決Conflictの扱い（A / B） | どちらでもなく案C（8.3） |
| 同一Target複数Entryの選択規則 | 6.2の `L(T)` |
| preferred sourceの反映位置 | Route選択のみ（6.5） |
| `expandedStates` の意味 | 既存定義のまま「構築したstate数」（14.2） |
| 新terminationの要否 | 不要（14.3） |
| constrained re-search内部の別Beam | 持たない（12.1） |
| schema境界 | ProductionPlanは14でfail closed、build resultは `14 -> [12, 13]`（15章） |
| reserveを分岐にするか | しない（7.6） |

Phase CのPull Requestでは、15.1の影響（実行中のversion 13 Planがstaleになり再計画が必要になること）を
プロジェクトオーナーへ明示する。これは決定済み事項の周知であり、Phase A / Bを止めない。

### 19.2 Can defer

| 論点 | 判断時期 | 暫定 |
| --- | --- | --- |
| conflict componentの厳密最適化（6.3の損失回避を超える） | Phase Bのparityで完成数劣化が出た場合 | 1段lookahead付きgreedy |
| 静的なcross-satisfaction省略（あるTargetの確保武器が別TargetのIdealも満たすと事前に分かる場合、後者のEntryをcommitしない） | Phase B以降 | 動的解放（6.6）だけ |
| deadlock / stallを新しい `ConflictKind` などでユーザーへ示すか | Phase B以降（schema / UI変更を伴う） | rejectionを `resource_conflict` として記録 |
| 同一Targetの別Entry同士の「競合」を `conflicts` から除くか | UI改善として別途 | 既存detectionのまま返す |
| canonical順でweapon switchと完成の早さのどちらを上位にするか | Phase Bの実データ計測後 | 7.7（priority → violation → switch → 完成近さ） |
| in-flight化による他Targetの充足喪失（7.9の例外）の扱いの強化 | Phase Bのfixture結果次第 | 動的再commit |
| Build List詳細設定、`PlannerOptions` / `PlannerProgress` の型移行、`maxPlanSteps` 既定値 | Phase D | Phase Cは型不変 |
| B8 orchestration bounds / what-if boundsの再測定 | #101と合わせて | 現行値のまま |
| Beam oracleとBeam専用stateの削除時期 | Phase D | test / benchmark用に残す |
| scheduler結果型の改名（`PlannerBeamSearchResult` → 中立名） | Phase C / D | 型互換のまま |
