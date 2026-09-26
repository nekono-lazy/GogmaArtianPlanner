# Planner競合repair設計（Issue #136 / #101 / B9「比較する」）

作成日: 2026-09-26

Refs #136 / #101 / #122

## Status

```text
正式仕様への反映:        完了（本文書を追加したdocs-onlyの設計PR #138。下記のnormative節。以後の各Phaseで状態を同期）
runtime実装:             Phase 2まで実装（Phase 1-A: #139、Phase 1-B: #140、Phase 1-C: #141、Phase 2: reservation導出、
                         held / blocked traversal、排他OwnedWeapon、held-aware到達量、新kernelのmaterializer、full Planner trialと
                         found判定（route commitmentの暫定帰結evidenceによる9.2.19.6の完全判定）、Issue #101のDomain
                         acceptance）。探索のlazy性はoperation cost層単位（same-cost closure。SEARCH_SPEC 5.6.8）で
                         確定している。Phase 3（benchmark harness #144、real Browser Worker測定 #145、Production default確定
                         Phase 3-C: extent 4 / 235 / 4、試行上限 2 / 8。PLANNER_SPEC 9.2.19.12）も完了した。Phase 4は
                         4-A / 4-Bに分割し、Phase 4-A（docs-only。scenario compositionのrun再利用規則、request-globalな
                         maxPlannerReruns、excludedByRepairLineageCount、adoptedInScenarioの未評価状態。PLANNER_SPEC
                         9.2.19.8.1 / 9.2.19.12 / 9.2.19.13）で正式仕様を確定した。Phase 4-B（what-ifのruntime接続:
                         Planner Alternative What-if Calculation、scenario composition、request-globalなrerun budget、
                         typed result / Route summary、新Worker request kind、Production Worker adapter、
                         PlannerWorkerClient.createPlannerAlternativeComparison()）も実装した。Phase 5は5-A / 5-Bに分割し、
                         Phase 5-A（actual repairとrepair lineageのPure Domain計算、what-if / actual repair共通のscenario core、
                         lineage outcome `rejected_by_scenario_composition` の正式仕様補完）を実装した。Phase 5-B以降
                         （lineage永続化とmigration、Persistence、Worker / Client、Production routing切替、version更新）は未実装
Production behavior:     変更していない（画面経路はlegacyのB8 / B9のまま。新Client APIはUIから呼ばれない。actual repairは
                         Domain APIだけであり、Worker・Client・画面から呼ばれない）
schema / version:        変更していない（10章）
```

この文書はtask-specificな **設計記録** である。背景、方式選定の理由、後続PRの分割を記録する。
normativeな契約は次の正式仕様にだけ置き、この文書はそれを上書きしない。矛盾した場合は正式仕様が優先する。

| 内容 | 正式仕様 |
| --- | --- |
| 製品要件（決定の単位、1段repair、Conflict再生成、循環防止） | [REQUIREMENTS.md](./REQUIREMENTS.md) 23章 |
| Planner側契約（fixed Route集合、reservation、what-if、actual repair、lineage、version） | [PLANNER_SPEC.md](./PLANNER_SPEC.md) 9.2.19 |
| Search Domain側契約（Planner Alternative Search、hold、extent、再利用 / 非再利用） | [SEARCH_SPEC.md](./SEARCH_SPEC.md) 5.6.8 |
| 永続shape（`ProductionPlan.conflictRepairLineage`、Routeの非連続Counter位置） | [DATA_MODEL.md](./DATA_MODEL.md) 9.2 / 11.1 |
| 表示契約（#122へ渡す情報） | [UI_FLOW.md](./UI_FLOW.md) 11.4.1 |

---

## 1. 目的と範囲

- Issue #136: 競合で優先Targetを選んだら、負けた側の旧Routeに由来する後続競合を残さず、代替Routeを探す
- Issue #101: 単体Candidate Searchなら届く範囲にある代替Ideal Routeを、Plannerの競合再検索でも扱えるようにする
- B9 what-if「比較する」: 上記と同じ探索semanticsで、1段先までをpreviewする
- Issue #122: 後続のPresentation改善へ渡すtyped dataを先に定義する

本文書は複数Phaseを通して更新する設計記録である。本文書を追加した設計PR（#138）と、scenario compositionの規則を
確定したPhase 4-A（#147）はdocs-onlyであり、コード、Worker protocol、UI、永続化、migration、benchmark、version値を
変更しなかった。Phase 4-Bではwhat-ifのruntime経路（Domain calculation、Worker protocol、Production Worker adapter、
PlannerWorkerClient API）を実装したが、Production UI routing、永続化、schema / version値は変更していない。

---

## 2. 背景（PR #137の事実）

[ISSUE_101_CONSTRAINED_RESEARCH_BENCHMARK.md](./ISSUE_101_CONSTRAINED_RESEARCH_BENCHMARK.md)（計測記録）より。

```text
Base Seed      51231782
Skill Counter  341
Gogma Counter  55
Charge Blade Normal Counter 0

火 / 龍とも単体Candidate Search:
  Normal 207本（production target = Normal 206）-> Skill 341で巨戟化 -> Gogma 55でKeep

Issue #129後の初期競合:
  same_normal_counter : Normal 206
  same_skill_counter  : Skill 341
  same_gogma_counter  : Gogma 55
```

- 火側には「Normal 1本 → 巨戟化 → Reset Bonuses ×235（Gogma約290まで）」という別Ideal Routeがある
- 旧constrained enumeration（B8）はGogma 235まで広げると約20〜30秒、250で約35秒、350で約86〜157秒かかる
- time to first Candidateがほぼfull enumeration時間と等しい（全Route baseのstreamを先にsolveするため）
- 旧enumeratorは巨戟化を常にorigin Skill Counter（341）で組み立てる（`constrainedRouteBases.ts` の
  `conversionSkill()`）。龍も341で巨戟化するので、boundをいくら広げても `same_skill_counter` が残り採用されない

したがって「旧B8 constrained enumerationのboundを単純拡大する」方針は採らない（PR #137 7.2のパターンC）。

Issue #136の症状（Normal 206で龍を選んでも、Skill 341 / Gogma 55の競合がpendingのまま残る）は、現行の
「この候補を優先」が **Conflict 1件単位のresolution** であり、負けた側のRoute全体が成立しなくなることを
表現していないことに由来する。

---

## 3. 採らない方式

### 3.1 「A完了後のProjected Stateから検索する」方式

```text
Aを完全に実行 → A完了後の単一Projected State → そこからBを検索
```

を採らない。Issue #101の例では成立しない。

- 火のNormal作成（Normal 0）は、龍がNormal 206まで進む **前** に行う必要がある。A完了後のStateでは
  Normal Counterが207まで進んでいて、火は207以降でしか作れない（Normal 1本で済むRouteを失う）
- 一方Skill / Gogmaでは「龍が341 / 55を使う → 火はその後ろの342 / 56以降」というinterleaveが必要になる
- つまり必要なのは、streamごと・位置ごとに「fixed Routeが使う位置」と「空いている位置」を区別したうえで、
  Planner-start originからBのRouteを組むことである。1つの将来Stateへ畳むと、fixed Routeより前にある
  空き位置（火のNormal 0）と、fixed Routeの後ろに続く位置（Skill 342、Gogma 56）の両方を同時には表現できない

そこで代替検索は **Planner-start baseline + fixed Routeのresource reservation** として定義する
（[PLANNER_SPEC.md](./PLANNER_SPEC.md) 9.2.19.3）。

### 3.2 旧constrained enumerationのbound拡大

2章のとおり、速度（upfront solve、G²に近い増加、solve中のevent loop停止）と表現（巨戟化Skill位置の固定）の
両方で解決しない。旧 `ConstrainedEnumerationBounds` の4値を新機能のauthorityにしない。

### 3.3 Issue #104のNormal Route base削減の流用

`normalArtianRouteSearch.ts` の削減は **"Incremental initial-Search dominance ... This is NOT Planner
pruning."** と明記された初回Search専用のdominanceである（[SEARCH_SPEC.md](./SEARCH_SPEC.md) 6.1.2）。

reservation下ではその前提（「offset 0のbaseが後方offsetと同じ未来へ同costで到達する」）が崩れ得る。
例えばoffset 0のproduction target位置がfixed Routeにblockされていれば、後方offsetは劣後しない。
したがって設計PR（#138）では流用を仕様化しなかった（Phase 4-Bまでの実装も流用していない）。安全なdominanceが
証明できる場合だけ、後続PRで証明とbenchmarkを添えて別途採用する。

---

## 4. 採用する方式の概要

### 4.1 Route単位の決定

「この候補を優先」でparticipant Aを選ぶことは、そのConflictの **Counter位置1か所をpinする** のではなく、
「このConflictの非固定participantの現在Routeは、AのRouteと同時には実行しない」という **Route単位の決定** である
（[PLANNER_SPEC.md](./PLANNER_SPEC.md) 9.2.19.2）。Aと競合する位置を1つでも持つRouteは、Aを優先した時点で
Routeとして成立しないからである。

### 4.2 resource-aware alternative Ideal search

非固定Target Bについて、次の制約下でIdeal Routeを探す（Search Domain側は
[SEARCH_SPEC.md](./SEARCH_SPEC.md) 5.6.8）。

```text
blocked位置 : fixed Routeの必須physical unitが使う位置。Bの互換性のないunitは置けない
held位置    : fixed Routeのunitが実行する位置。Bはここで何もせず武器状態を保持してよい
             （Counterはfixed Route側の操作で進む）
それ以外    : Bが自分で操作しない限り誰もCounterを進めない位置
```

Issue #101の例（龍 = fixed、火 = alternative）:

```text
Normal (charge_blade:8)
  held    : 0..206（龍のCounter進行用forge 0..205 + production target 206）
  blocked : 206（龍のproduction target）
  -> 火のproduction targetは0でよい（火のforgeが先。龍の0番forgeはsilent fast-forward、Issue #129）
  -> 火の create_normal_artian は 0 / 1 / count 1（下記のheld prefix規則）

Skill
  held / blocked : 341（龍の巨戟化）
  -> 火の巨戟化は341に置けない。341は龍が進めるので、火は342で巨戟化できる

Gogma
  held / blocked : 55（龍のKeep）
  -> 火のBonus操作は56から始められる。55の間、火の武器Bonusは変化しない
```

結果として「Normal 0で1本作成 → Skill 342で巨戟化 → Gogma 56〜289でReset」のようなRouteが候補になる
（設計PR #138の時点では具体的なIdeal位置を主張せず、runtime実装で確認するとした。Phase 2のIssue #101 acceptanceで、
Normal 0 / Skill 342で巨戟化 / Gogma 56〜289のResetとなることを現行Production RNG実装での実測として確認している）。

Normalの `create_normal_artian` は1 operationで連続forge範囲を表すので、canonical表現を固定した
（[PLANNER_SPEC.md](./PLANNER_SPEC.md) 9.2.19.4、[SEARCH_SPEC.md](./SEARCH_SPEC.md) 5.6.8）。production targetより
**前** にある、originから先頭連続したheld位置だけを自分のforge不要区間として飛ばし、その直後からproduction
targetまでを自分の連続forgeとする。

```text
skippableHeldPrefix = origin .. targetPosition - 1 のうち、originから先頭連続してheldな区間
normalCounterBefore = prefixの直後（空ならorigin）
normalCounterAfter  = targetPosition + 1
count               = normalCounterAfter - normalCounterBefore

Issue #101: held 0..206、target 0   -> prefix空、0 / 1 / count 1
別例      : held 0..4、target 10   -> prefix 0..4、5 / 11 / count 6
```

初版の「originから連続するheld位置の直後（production targetを超えない）」という書き方は、Issue #101で
「held位置の直後 = 207」と「production target = 0」の関係が曖昧だったため、PR #138のレビューで上記へ改めた。
targetPosition以降のheld位置はprefixの判定に使わない。

このRouteは各RouteOperationに絶対Counter位置を持つ既存表現のままで表せる。stream内でoperation同士の
Counter位置が連続している必要はない（現行 `validateBuildRoute()` も連続性を要求していない）。Plannerは
`current < counterBefore` のunitを「未到達」として待機し、誰も進めない位置で止まれば既存のstall dropになる。
したがって永続shapeの追加なしに成立する（[DATA_MODEL.md](./DATA_MODEL.md) 9.2）。

### 4.3 共存可能性のauthority

reservationは探索を絞るための入力であり、共存可能性の最終authorityは従来どおり **full Planner rerun +
Trace Replay** である（[PLANNER_SPEC.md](./PLANNER_SPEC.md) 9.2.11）。stream間の順序依存（火の巨戟化は龍の
巨戟化を待ち、龍の巨戟化は龍のNormal 206を待つ等）や循環待ちはSearchでは判定しない。rerunで不成立なら
そのCandidateを不採用にして次のIdealへ進む。

---

## 5. modern Candidate Searchからの再利用

| 再利用する | 理由 |
| --- | --- |
| `TargetSearchScheduler` / `SearchWorkQueue` のlower-bound順work処理 | 最初のCandidateまでに全baseを先にsolveしない（PR #137の律速点の解消） |
| Bonus stream / Skill streamのprediction・memo（Resetは位置ごと1回、Keepはfamily layoutごと） | stream独立性とprediction呼出し回数契約をそのまま使う |
| Production prediction support / capability判定 | input-level supportの既存契約 |
| Route search primitives（Route base、Route組み立て） | Route表現を二重実装しない |
| Candidate factoryのestimate / material算出 | 同じRoute authority |
| `candidateStableKey` / Candidate semantic identity | 循環防止と決定的orderingのkey |
| intermediate state抽出、deterministic materializer（9.2.13） | generated Entryの形状を既存と揃える |

| 再利用しない（初回Search固有policy） | 理由 |
| --- | --- |
| canonical Ideal確定による探索終了 | 次のIdealへ進めなくなる |
| 初回Searchの同一結果最小advance retentionによる永久省略 | 後方位置が唯一の成立Routeになり得る（9.2.5） |
| Cross-onlyを最終境界とすること | 軸外pairが必要になり得る。lazyに評価する |
| #104のNormal Route base削減 | 3.3 |
| 旧B8のupfront all-base solve | PR #137の律速点 |

`searchCandidates()` 自体をPlannerから呼ばない。Plannerが呼ぶのは同じ基盤上の別consumer policyである。

---

## 6. 1段repairとConflict再生成

```text
「比較する」（what-if、永続化なし）
  1. Aをこのconflictのfixed側と仮定
  2. このconflictの非固定participant Targetごとに独立にalternative search
  3. 見つかったCandidateを一時的に差し替えてfull Plannerで検証
  4. 代替Route、操作量、進行量をpreview
  5. 見つかったreplacementをactual repairと同じ規則（scenario composition、PLANNER_SPEC 9.2.19.8.1）で
     合成したscenario Planを得て、
     その実PlanStep数（scenarioOperationCount）、完成しないTarget、残る / 新しく発生するConflictをpreview
  6. 終了（新Conflictを再帰的にrepairしない）

「この候補を優先」（actual repair、保存）
  1. fixed Candidateをcommit（Route単位の決定）
  2. 直接影響を受けるTargetの旧Routeをinvalidate
  3. 同じalternative search kernel
  4. replacementを採用（Build List cardinalityの置換、9.2.18）
  5. full Planner rerun
  6. 最新のEntry集合・fixed決定・Route commitment・実際のselected RoutesからConflictを再生成
  7. 保存。新Conflictは次の通常のユーザー判断として提示する
```

### 6.1 scenario全体の手数比較

「比較する」の主要目的の1つは、「Aを優先した場合」と「Bを優先した場合」について、直接影響を受けるTargetを
1段repairした後の **scenario全体のPlan手数** を比べることである。Issue #101なら「龍を優先（龍: Normal 207本 →
巨戟化 → Keep、火: Normal 1本 → 巨戟化 → Reset多数）」と「火を優先（逆）」のどちらが全体として少ないかを示す。

- authorityは、代替を差し替えたscenario trialのfull Plannerが生成したPlanの実際のPlanStep数
  （`steps.length`）である（[PLANNER_SPEC.md](./PLANNER_SPEC.md) 9.2.19.13）
- fixed Routeと代替Routeの `estimatedOperationCount` の和にしない。共有physical action、silent fast-forward、
  Route commitment、Plannerの実行順、reserve / confirmation等で一致しないためである（Issue #101でも、火が
  Normal 0を作ると龍のNormal 0 forgeはfast-forwardされ、龍のGogma 55 Keepの位置では火のResetが動かない）
- what-ifは1段なので、この値は **1段repairを適用したtrial Planの暫定PlanStep数** であり、最終完成までの
  確定総手数ではない。新しい未解決Conflictが残る場合も値は返すが、完成しないTargetと残る / 新しいConflictと
  合わせて読む
- scenario PlanはTargetごとの独立評価とは別に、actual repairと同じ合成規則（scenario composition、
  [PLANNER_SPEC.md](./PLANNER_SPEC.md) 9.2.19.8.1）で作る。foundになったreplacementをstable orderでmonotonicに
  採用し、2件目以降は採用済み集合 + 今回のreplacementでfull Planner runを行う。最初のfound replacementの
  individual trial resultと、最後にacceptedになったadoption runの結果は再利用し、最終採用集合を評価済みのresultが
  あれば同じ入力でfinal runを追加しない（新規のscenario runが必要なのはfoundが0件のときだけ）。非固定Targetの数や
  代替が見つからないTargetの存在だけを理由にrunを追加しない
- 全full Planner run（individual trial、adoption run、必要なfinal run、runtime-unsupported retry）は1 requestで1つの
  `maxPlannerReruns` を共有する（PLANNER_SPEC 9.2.19.12）。scenario compositionの途中でbudgetが尽きた場合、採否を
  評価できなかったreplacementは「不採用」ではなく「未評価」（`adoptedInScenario = null`）として区別する
- trial / scenarioのPlanner optionsはactual repairと同じ `conflictResolutionPlannerOptions(表示中Plan)` にし、
  previewした手数と「この候補を優先」で保存される計画の条件を揃える

### 6.2 Conflict再生成

旧PlanのConflict一覧から解決済みだけを消す方式は採らない。replacement後の最新状態から再評価しない限り、
旧Routeに由来する後続Conflict（#136のSkill 341 / Gogma 55）が残るためである。

代替が見つからなかった場合は、旧RouteのEntryをBuild Listから消さず、そのTargetを未解決として理由付きで
残す。旧Routeとfixed Routeの間のConflictはすべて「fixed側を選択済み」として記録し、pendingの判断として
残さない（決定の展開、[PLANNER_SPEC.md](./PLANNER_SPEC.md) 9.2.19.9）。

---

## 7. 循環防止とrepair lineage

### 7.1 何を防ぐか

```text
B original -> Aとの競合でinvalidate -> B2 -> 新Conflict -> Bを再検索 -> B originalへ戻る
B original -> B2 -> B3 -> B2
```

repair chainの中で一度invalidate / supersedeされたRouteを、同じTargetの次のalternative searchで再採用しない。
keyはrun非依存の `candidateStableKey` である（絶対Counter位置を含むので、同じ結果でも位置の違うRouteは別key）。

### 7.2 persistence boundaryの選択

履歴はWorker 1 request内に閉じられない（「この候補を優先」で保存したDraftから次のConflict解決へ進んでも
引き継ぐ必要がある）。候補を比較した。

| 保持場所 | 判定 | 理由 |
| --- | --- | --- |
| Worker request内だけ | 不可 | 次のConflict解決へ引き継げない |
| `BuildListEntry` のfield | 不採用 | 禁止はCandidate自身の意味ではなく競合解決の履歴。Entryにprovenance fieldを足さない既存契約（9.2.8 / 9.4.1）にも反する。手動Candidate置換で自然に失効させにくい |
| 独立したDexie table | 不採用 | Draftの単一性・atomic置換とlifecycleを別に管理する必要があり、Draft置換で消えない履歴が残る |
| `AppSettings` | 不可 | 計算履歴を設定へ混ぜない |
| **`ProductionPlan` 側** | **採用** | B10の操作対象はDraftだけであり、新Draftは旧Draftをatomicに置換する。repairで保存したDraftが次のrepairへlineageを渡し、通常PlannerでDraftを作り直せば自然にresetされる |

field名とshapeは [DATA_MODEL.md](./DATA_MODEL.md) 11.1（`ProductionPlan.conflictRepairLineage`、Phase 5で追加）で確定した。
Targetごとの除外は、そのTargetの現在Entryがlineageの記録と一致する間だけ有効であり、ユーザーがCandidate
Searchから手動置換すれば、そのTargetの履歴は失効する。恒久的なCandidate Search禁止条件にはしない。

---

## 8. 表示情報（#122へのhandoff）

新しいDomain contractは、後続UIが少なくとも次を表示できるtyped dataを返す
（[PLANNER_SPEC.md](./PLANNER_SPEC.md) 9.2.19.13、[UI_FLOW.md](./UI_FLOW.md) 11.4.1）。

- fixed Target、alternative Target
- 代替Routeが見つかったか（found / 探索範囲内に無し / 上限で未確認 / checkpointでblock）
- 代替Routeそのものの説明（`PlannerAlternativeRouteSummary`: `BuildRoute`、最終Bonus / scope / Skill、
  通常Searchと同じ観測trace）。UIがRNGを再計算せず、Routeを推測復元せず、内部keyから再構築せずに
  「通常1本 → 巨戟化 → Reset …」を表示できる
- 代替Route自身の操作数、Normal / Skill / Gogmaの進行量（Planner-start基準の到達量）
- scenario全体の暫定Plan手数（`scenarioOperationCount`、6.1）と、このPlanで完成しないTarget
- 代替採用時に残るConflict、新しく発生するConflict（「追加競合あり / なし」の判断に使う）
- lineageにより除外した候補があった事実（件数。technical keyは通常UIへ出さない）。件数
  （`excludedByRepairLineageCount`）は、有効なprior repair lineage由来のkeyに一致して今回実際にskipしたCandidate数
  だけであり、今回の決定で無効化する現在Routeにだけ一致したCandidateや、lineageに保存されたkey数は数えない
  （PLANNER_SPEC 9.2.19.13。Search summaryのtotal除外件数 `excludedCandidates` とは別semantic）
- 代替がscenario compositionで採用されたか（採用 / 不採用 / 上限による未評価）

Phase 4-BではUIを変更していない。Phase 4-B完了時点でも、上記のtyped dataはDomain / Worker / Clientまでで返すだけであり、
Production UI routingはlegacy経路のまま（`ProductionPlanPage` の「比較する」は旧 `createWhatIfComparison()` を呼び、
新しい `createPlannerAlternativeComparison()` を呼ばない）とする。表示の切替はPhase 5、Presentation改善はPhase 7で行う。

---

## 9. 既存契約との関係

- 9.2.1（後方固定しない）、9.2.2（位置一致だけで除外しない）、9.2.3.1（preflightと全resolution再対応付け）、
  9.2.7（固定authorityはユーザーの明示選択だけ）、9.2.10（途中Stateへinjectしない）、9.2.11（共存の最終
  authorityはfull rerun + Trace Replay）、9.2.12 / 9.2.13（semantic identity、決定的ID）、9.2.18（Build List
  cardinalityの置換）、9.5（checkpoint競合の拒否、checkpoint Targetは再検索しない）は維持する
- 置き換えるのは、代替Candidateの **生成器**（B8 constrained enumeration → Planner Alternative Search）、
  決定の **単位**（Conflict 1件 → Route単位）、what-ifのfound判定とresultの **情報量**、
  B8 orchestrationの **反復方式**（全explicit resolutionごとのwork → 今回決定したConflictの直接participantだけ）である
- 旧B8 constrained enumeration / orchestrationは削除せず、Phase 5のProduction routing切替までlegacy
  implementationとして残る。切替後はPhase 6で削除またはtest oracle化を判断する

---

## 10. version方針

設計PR（#138）、Phase 1〜4（4-A / 4-Bを含む）とPhase 5-Aではversionを変更しない。Phase 5-A完了時点の値は次のとおりである。
version更新はPhase 5-Bのlineage永続化・Production routing切替と合わせて行う。

```text
CURRENT_CALCULATION_APP_SCHEMA_VERSION  15
DATABASE_SCHEMA_VERSION                 9
ExportRoot.schemaVersion                12
AppSettings.schemaVersion               2
RngState.schemaVersion                  2
PRODUCTION_RNG_ENGINE_VERSION           production-rng:c5-e7
Master dataVersion                      4
```

後続runtimeでのversion境界は [PLANNER_SPEC.md](./PLANNER_SPEC.md) 9.2.19.15 に固定した。要点:

- Phase 1〜4（Search Domain API、reservation、benchmark、what-if Domain / Worker contract）は永続shapeも
  Production Plan生成も変えないのでversionを動かさない
- Phase 5-A（actual repairとlineageのPure Domain計算）もversionを動かさない
- Phase 5-B（lineage永続化 + Production routing切替）で
  `CURRENT_CALCULATION_APP_SCHEMA_VERSION` 15 → 16（build-result互換例外 `16 -> [12, 13, 14, 15]`）、
  `DATABASE_SCHEMA_VERSION` 9 → 10、`ExportRoot.schemaVersion` 12 → 13

---

## 11. 後続PR分割

依存関係を確認し、依頼案の6 Phaseを次の7 Phase（Phase 4は4-A / 4-Bの2 subphase）へ調整した。調整点は2つである
（Phase 4の4-A / 4-B分割は後から加えた。下記3）。

1. **benchmarkをProduction接続の前へ移す**（依頼案Phase 5 → Phase 3）。Production routingへ接続する時点で
   extentと試行上限のdefaultに実測根拠が必要なため。B8では接続後にdefaultを決めた結果、Issue #101の
   範囲不足がProductionへ出た
2. **what-ifとactual repairのProduction routing切替を同じPRにする**（Phase 5）。what-ifだけが新kernelで
   previewし、「この候補を優先」が旧B8で別の結果を保存する期間を作らないため
3. **Phase 4を4-A（docs-only）と4-B（runtime接続）に分ける**。runtime実装の前に、scenario composition時の
   full Planner run規則（individual trial / adoption runの結果を再利用し、同じ入力でfinal runを重ねない）、
   request-globalな `maxPlannerReruns` の消費規則、`excludedByRepairLineageCount` の正確な意味、budget停止時の
   `adoptedInScenario` の未評価状態が正式仕様上で曖昧だったため、先に仕様だけを確定する
   （[PLANNER_SPEC.md](./PLANNER_SPEC.md) 9.2.19.8.1 / 9.2.19.12 / 9.2.19.13）

| Phase | 内容 | 依存 | Production影響 / version |
| --- | --- | --- | --- |
| 1 | Planner Alternative SearchのSearch Domain API（modern scheduler上の別consumer policy、継続探索、extent、除外key、cancel / yield、決定的ordering）。reservation無し（空reservation）で通常Searchとの関係をテスト | なし | なし / なし |
| 2 | Planner側のfixed Route集合・reservation導出（既存route unit plan authority）、hold付きstream探索、OwnedWeapon排他、trial full rerunのfound判定。Issue #101 fixtureで「火が342で巨戟化」する代替のfull rerun成立をテスト | 1 | なし / なし |
| 3 | 実Browser Worker benchmark（Issue #101実ケース、no-Ideal worst case、長いheld run、cancel / responsiveness、time to first Candidate、same-cost closureでsettleしたwork数、held run長に対するコスト、Skill / Gogmaのheld state数とfamily layout数、prediction呼び出し数、Candidate trial数、full Planner rerun数）。extent defaultとwhat-if / repairの試行上限default決定 | 2 | Production behaviorなし（benchmark基盤と、Search / Planner DomainのProduction default定数。routing未接続）/ なし |
| 4-A | docs-onlyの正式仕様明確化（scenario compositionのmonotonic adoption run規則、trial / adoption / final resultの再利用規則、request-globalな `maxPlannerReruns`、`excludedByRepairLineageCount`、`adoptedInScenario` の未評価semantic）。runtime code・Worker・routing・schema・UIは変えない | 3 | なし / なし |
| 4-B | B9 what-if「比較する」のPlanner Alternative Kernel runtime接続（Planner Alternative What-if Calculation、scenario compositionと `scenarioOperationCount`、`PlannerAlternativeRouteSummary` を含むtyped result、shared rerun budget接続、Worker protocol、Production adapter、PlannerWorkerClient API、Domain / Worker / Client test）。Production UI routingはまだ旧経路 | 4-A | なし / なし |
| 5-A | 「この候補を優先」のactual repairのPure Domain計算（Route単位の決定、what-ifと共通のscenario core、決定の展開を保存可能Planへ反映、accepted replacement / lineageを含むPersistence用artifact）、repair lineageのPure Domain計算、lineage outcome `rejected_by_scenario_composition` の正式仕様補完 | 4-B | なし / なし |
| 5-B | lineage永続化とmigration、Persistence（artifactの保存時再validation、Plan-breaking guard）、Worker / Client、what-if / repair両方のProduction routing切替 | 5-A | あり / calc 16、DB 10、Export 13 |
| 6 | legacy constrained path（B8 enumeration / orchestration、関連bounds・warning・benchmark page）の削除またはtest oracle化 | 5 | なし / なし（永続shapeに触れる場合は別途判断） |
| 7 | #122 Presentation改善（Conflict / what-if / repair結果の表示） | 5（4-Bのtyped dataを使う） | UIのみ / なし |

各PhaseのPRは設計レビューで確認し、実測や実装で仕様不足が見つかった場合は推測で埋めずに仕様を先に更新する。

---

## 12. 後続runtime PRへの未決事項

仕様上の意味は固定したが、実装で具体化する事項。いずれも決めるときに推測でsemanticsを変えない。

1. Search Domain APIとreservation DTOの具体的な型名・field名（Phase 1 / 2）
2. hold付きBonus streamのstate search実装方式と、lower boundの定義（own operation数はheld位置で増えない）
3. 軸外pairのlazy評価で追加の安全上限が必要か。**確定済み（Phase 3-C）**: 軸外pair専用の追加安全上限は設けない。
   operation cost層単位のlazy探索とextent・試行上限（4）をProduction authorityとする。同じcost層のheld位置・state数による
   time-to-firstの実コストはPhase 3-Bで測定済みである
   （[PLANNER_ALTERNATIVE_BROWSER_WORKER_BENCHMARK.md](./PLANNER_ALTERNATIVE_BROWSER_WORKER_BENCHMARK.md) 12章）。
   探索のlazy性がoperation cost層単位（same-cost closure）であること自体はPhase 2で確定しており（SEARCH_SPEC 5.6.8）、
   6キー順序と `candidateStableKey` は変えない
4. extent / 試行上限のProduction default（Phase 3）。**確定済み（Phase 3-C）**: `defaultPlannerAlternativeSearchExtent = 4 / 235 / 4`、
   `defaultPlannerAlternativeTrialBounds = 2 / 8`（[SEARCH_SPEC.md](./SEARCH_SPEC.md) 5.6.8、[PLANNER_SPEC.md](./PLANNER_SPEC.md)
   9.2.19.12）
5. 外部進行に依存するgenerated Entry（fixed Routeが先に進めることを前提にしたRoute）を、fixed Entryが
   Build Listから消えた後に通常Plannerがstall dropしたときの表示（Phase 5または#122）。Domain上は既存の
   stall drop / `rejectedBuildListEntries` で扱い、新しいstale理由を作らない
6. repair結果とlineageの保存を既存 `savePlannerOrchestrationResult()` へ載せる具体的なresult型（Phase 5）。
   **Phase 5-Aで決めたDomain側の形**: `createPlannerAlternativeRepair()` は `comparison`（what-ifと同じtyped comparison）と
   `persistence`（`persistable` のとき `PlannerAlternativeRepairArtifact`、そうでなければtypedな `not_persistable` 理由）を返す。
   artifactは決定を展開したfinal `PlannerResult`（`plan` 非null）、accepted replacementのgenerated Entryと
   `BuildListEntryReplacement`、次のrepair lineageを持つ。旧B8の `PlannerOrchestrationResult` の「generated Entryはfinal Planで
   selected」という契約はPlanner Alternativeへ流用しない（accepted replacementがfinal Planでnon-selectedになり得るため。
   PLANNER_SPEC 9.2.19.6）。Persistence側でこのartifactをどう検証・保存するかはPhase 5-Bで決める
7. **Phase 4-Bで確定した実装上の読み方**（**確定済み**。normativeな記述は [PLANNER_SPEC.md](./PLANNER_SPEC.md) にあり、
   本項はその経緯の記録である。矛盾した場合は正式仕様が優先する）。
   - `unplannedTargetWeaponIds`: final scenario Planのどの `PlanStep.executionEffects.targetCompletions` にも現れない
     planning Target（`PlannerInitialContext.planningTargetIds`）。Production Plan画面の完成予定数と同じauthority
     （正式仕様: PLANNER_SPEC 9.2.19.13「`unplannedTargetWeaponIds` の意味」）
   - 決定の展開はcheckpoint Conflict（`checkpointParticipants` が空でない、または `undefined`）へ適用しない。9.5.1への例外を
     作らず、そのConflictは未解決Conflictとして分類に残る（正式仕様: PLANNER_SPEC 9.2.19.9 / 9.2.19.13）
   - found replacementが0件のscenario run（ケースA）のpreflight失敗は、typed outcomeを推測せずinvariant violationとして
     throwする（正式仕様: PLANNER_SPEC 9.2.19.8.1）
8. **Phase 5-Aで補完した仕様と判断**（**確定済み**。normativeな記述は [PLANNER_SPEC.md](./PLANNER_SPEC.md) 9.2.19.11と
   [DATA_MODEL.md](./DATA_MODEL.md) 11.1.1にあり、本項はその経緯の記録である）。
   - Phase 4-A / 4-Bで「individual trialではfound、scenario compositionでは `adoptedInScenario = false`」が正式に存在するように
     なったが、lineageの `PlannerConflictRepairOutcomeStatus` にはそれを表すstatusが無かった。既存statusへ押し込まず、
     `rejected_by_scenario_composition`（`replacementBuildListEntryId = null`）を追加し、individual outcome / scenario採否から
     lineage outcomeへの写像を表で固定した。preflight・再対応付け失敗によるrejectとaccepted判定不成立によるrejectは細分化しない。
     `adoptedInScenario = null` はscenarioが `stopped_by_planner_rerun_bound` のときだけ起こり、そのとき何も保存しないので
     lineageにも写さない
   - Target単位の失効で記録を落とした結果、有効なTarget記録が無く、fixed Entryも有効でない決定は、fixed Route集合にも除外集合にも
     寄与しないので決定ごと落とす（fixed Entryが有効なら、記録が空でも決定を残す）
   - 「後の決定で以前のfixed Entryが負けた場合は最新の決定が優先する」の「後の決定」には今回の決定も含むので、今回の決定が
     無効化するEntryはlineage由来のprior fixed Entryであってもfixed Route集合へ入れない。Kernel
     （`runPreparedPlannerAlternativeKernel()`）がこれを行い、what-ifとactual repairで共通になる
   - PR #149のレビューで、上記だけでは不十分と判明した。以前のfixed decisionは、表示中DraftのConflictから復元された
     explicit resolution（例: `X -> D`）としても `PlannerInput.conflictResolutions` に残り、what-ifの準備がそれをfixed
     constraint・明示決定Entryにするため、今回の決定でDを負けさせてもDの代替D2がreplacement preflightでrejectされ得た。
     そこで「active lineageのprior fixed Entry ∩ 今回の無効化Entry」を選択する復元済みresolutionを、今回の決定のmergeの前に
     実効入力から外す（superseded prior fixed resolution。正式仕様: PLANNER_SPEC 9.2.19.11）。無関係なresolution、
     失効したlineageの決定、今回の決定と同じ `conflictKey` のresolution（mergeで置換）は対象にしない

---

## 13. Phase 5-Aで変更していないもの

Phase 4-BはDomain calculation、Search executionのneutralなskip記録、Worker protocol、Production Worker adapter、
PlannerWorkerClient APIとそのtestを変更した。Phase 5-Aはwhat-if / actual repair共通のscenario core、actual repairと
repair lineageのPure Domain計算、repair lineageのDomain型、Kernelの無効化Route key返却と「今回の決定が無効化するprior fixed
Entryをfixed Route集合から外す」処理、それらのDomain testと正式仕様（lineage outcome `rejected_by_scenario_composition`）を
変更した。次は変更していない。

```text
Production UI routing（ProductionPlanPageの「比較する」はlegacy B9のwhat-if経路のまま）
「この候補を優先」のProduction経路（legacy B8経路のまま。新actual repairはDomain APIだけ）
Worker request / response protocol、PlannerWorkerClient、Production Worker adapter
savePlannerOrchestrationResult()、Persistence repository
repair lineageの永続化（ProductionPlan.conflictRepairLineageは未追加。validator / migrationへ接続しない）
Dexie schema、migration、Export / Import schema、各version値（10章）
defaultConstrainedEnumerationBounds     40 / 30 / 100 / 500
defaultPlannerOrchestrationBounds       2 / 1 / 4
defaultPlannerWhatIfBounds              2 / 8
defaultCandidateSearchSettings          （recommendedCandidateSearchDefaults 350 / 500 / 1500）
defaultPlannerOptions                   maxPlanSteps 1000
旧constrained enumeration / B8 orchestrationの実装（削除していない）
Issue #101 / #136 / #122（Closeしない）
```
