# Global Planner Research D2-A（K0先行候補探索と集合評価の事前登録）

Refs #154。**docs-only**。基準main: PR #224 merged `3b86d89aa1728ed0197fd7e0edb2ebf9eaf76a7c`（作業開始時に `main` / `origin/main` / HEADの一致、
Working Tree clean、stashなし、worktreeは1件だけ、実行中のResearch processなしを確認）。

本書は [Phase 2-C2.7-B follow-up](PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_PHASE2C27B_FOLLOWUP.md) §9.2で提案された **D2（Candidateの発見とGlobal採用を
分離したpolicyの小規模比較）** の最初の実行条件を、実装・計測より前に確定する事前登録である。本書ではResearch項目名を **D2**、本書による事前登録を
**D2-A**、実装と正式計測を **D2-B** と呼ぶ。D1（[D1-A](PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_D1_SPEC.md) / [D1-B](PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_D1B.md)）
とPhase 2-C2.7-C（Phase A §10.2のProduction compatible architecture設計）とは別のResearch項目であり、名称を混同しない。

本PRで変更していないもの: Production source、Search / Planner / RNG、Worker、UI、Persistence、schema / version、Production default / bounds、
既存formal RESULT、Phase A / Phase B / follow-up / D1-A / D1-B文書、既存Research runner / analyzer / module、正式仕様の意味論。新規Search run、
Candidate delivery、full Planner run、formal measurement、RESULT JSON生成、oracle読み取りは行っていない（§1の値は既存committed RESULT、既存
`.local` record、既存文書のSHA-256照合と読み取り・数え上げだけで得た）。

本書の各節は次の4種類のどれかであり、見出しに明記する。

| 種類 | 意味 | 節 |
| --- | --- | --- |
| **事実** | 既存のformal RESULT・record・文書から読み取った値（本書で新しく計算・計測していない） | §1 |
| **事前登録条件** | D2-Bが変えてはならない実行条件・判定規則 | §2〜§11、§14、§15 |
| **既存API** | D2-Bが使う既存の部品（Production変更なし） | §12 |
| **未決事項** | D2の結果を受けて、または別の事前登録で決めること | §13 |

## 0. 位置づけとauthority

本書はResearch文書であり、正式仕様ではない。authorityは `AGENTS.md` の順位どおり `docs/REQUIREMENTS.md`（23 / 23.1）→ `docs/PLANNER_SPEC.md`
（9.2.3.1、9.2.18、9.2.19）/ `docs/SEARCH_SPEC.md`（5.6.8）→ その他の正式文書 → 実装 → test → Research文書である。D2はResearch-onlyであり、
REQUIREMENTS 23（明示的な選択が無い競合について自動で再検索しない）、Planner Alternative（9.2.19.1〜9.2.19.16）、RNG、Search、UI、Persistenceの
意味論を変更しない。D2の集合評価はResearch harnessの中だけで複数Routeを置換するものであり、Productionの動作ではない。

Research authorityの順位（D2の中で矛盾があれば上を優先し、矛盾は報告してD2-Bを止める）:

1. 本書（D2-A事前登録）
2. D1-A（§4 評価runの共通手順、§4.4 R5、§4.5 support依存検査、§6.2 評価status、§9.4 決定性）。本書が変更・追加した点は §14 に列挙する
3. follow-up（§4.3 R0〜R6・`evaluatedAgainst`、§5 support、§6 発見と採用の分離、§9.2 D2、§9.3 G13〜G18）
4. Phase A（§2 G1〜G12、§5 ladder、§6.3 typed outcome、§7 budget）、Phase B（§1.3 trial harness）

D2-Bは本書の規則だけで判定でき、実装時に意味論を追加決定しなくて済むことを目標とする。実装名（module / 関数 / fieldの綴り）はD2-Bで決めてよいが、
§10のRESULT必須fieldの意味と§9の判定順序を変えてはならない。変える必要が生じた場合は、D2-Bの正式計測前に本書を更新する（docs PR）。

## 1. 事実（D1 / Phase Bから確認されたこと。本書で再計算していない）

### 1.1 D1の結果（`docs/PLANNER_GLOBAL_D1_RESULT.json`、`D1_FOUND_R_SET_PARTIAL`）

| 項目 | 値 | 出典（D1 RESULT） |
| --- | --- | --- |
| decision | `D1_FOUND_R_SET_PARTIAL`（invalid 0、unmeasured 0、bound-limited 0、決定性cross-check 9組一致） | `decision` |
| baseline（B0） | completed 20 / 43、Conflict 21、steps 1465、`inputDigest fnv1a32:6f151dc3`、`resultDigest fnv1a32:880bbb52` | `evaluations[B0]` |
| D1 incumbent（最大共存集合） | `{t01, t07, t08, t09}`。completed 22 / 43、Conflict 21、steps 1465（`A-b` / `A-c-10`、`inputDigest fnv1a32:e38da50a`、`resultDigest fnv1a32:b61ef1dc`） | `evaluations[A-b]`、`aggregates.aCFinalAccepted = [1, 7, 8, 9]` |
| D1 incumbentの構成 | t01 / t07 / t08はK0 Candidate、**t09はK1 Candidate**（Phase B P1 rank 10、support `build-list.fnv1a32-e396d352`、Target `820831d0…`） | D1-A §1.3 |
| A-a（11件全部） | R5不成立。completed 19 / 43、Conflict 22、steps 723 | `evaluations[A-a]` |
| A-cの合成列 | t00不受理（20 / 21）→ t01受理（21 / 22）→ t02〜t06不受理 → t07受理（22 / 21）→ t08受理（22 / 21）→ t09受理（22 / 21）→ t10不受理（21 / 21） | `evaluations[A-c-*]` |
| 受理段のcompleted | 21 → 22 → 22 → 22（受理段でcompletedが減ったことは無い） | 同上 |
| PでR5成立した組 | `{t01,t07}` 22 / 21、`{t01,t08}` 21 / 22、`{t01,t09}` 21 / 22、`{t07,t08}` 21 / 20、`{t07,t09}` 21 / 20、`{t08,t09}` 20 / 21（completed / Conflict） | `evaluations[P-*]` |
| 実行コスト | 評価80件すべて `fullRunsStarted = 1`、評価wall 6.9〜14.0 s（合計944.5 s）、R（Search再delivery）11件合計295.7 s、child heap最大2.04 GB | `aggregates.timing` / `memory` |
| provenance | measurement HEAD `74886ef596ef774b6540b6516913a27074781d00`、start attestation SHA-256 `8be3b9bb…5455` | `provenance` |

D1で採用されなかった7 Target（以下 **dropped 7**: t00 / t02 / t03 / t04 / t05 / t06 / t10）について、S（11件）・P（55件）・A-aのうち当該 `G_t` を含む12評価を
集計した（D1 RESULT `routeCommitment` / `conflicts` の数え上げだけ）。

| t | `G_t` がselectedだった評価 | `G_t` を外した勝者（provisional outcome、12 / 12評価で同一） | 勝者はB0でselected | `G_t` と同じConflictに入ったEntry（kind、B0 selectedのもの） |
| --- | ---: | --- | --- | --- |
| t00 | 0 / 12 | `build-list.fnv1a32-e396d352`（Target `820831d0…`、E1外） | true | `same_skill_counter`（10 Entryの群。B0 selectedは `e396d352` のみ） |
| t02 | 0 / 12 | `build-list.fnv1a32-e396d352` | true | `same_skill_counter`（同上の群）、`same_gogma_counter`（`e396d352` ほか） |
| t03 | 0 / 12 | `build-list.fnv1a32-92d87b90`（Target `cbdf9d8f…`、E1外） | true | `same_gogma_counter`（`92d87b90`）、`same_skill_counter`（`54dd2b4e`、`e396d352` ほか）、`same_normal_counter` |
| t04 | 0 / 12 | `build-list.fnv1a32-92d87b90` | true | `same_gogma_counter`（`92d87b90`、B0非selectedの2 Entry） |
| t05 | 0 / 12 | `build-list.fnv1a32-61066e62`（Target `1f121742…`、E1外） | true | `same_owned_weapon_consumed`（`61066e62`）、`same_gogma_counter`（`462a2dfa`） |
| t06 | 0 / 12 | `build-list.fnv1a32-85dc00cc`（Target `aa4e67d8…`、E1外） | true | `same_owned_weapon_consumed`（`85dc00cc`） |
| t10 | 0 / 12 | `build-list.fnv1a32-e396d352` | true | `same_skill_counter`（同上の群）、`same_gogma_counter` |

- 勝者は4種類のEntryで、すべてE1外かつB0でselectedだった。`e396d352` はt00 / t02 / t10の勝者であり、同時にD1 incumbentのt09 K1 Candidateのsupportである
- t05 / t06の `G` は、勝者と同じOwnedWeaponを消費する（`same_owned_weapon_consumed`）。K0はreservationを持たないので、Searchは他EntryのOwnedWeaponを
  exclusiveとして扱わない（Phase A §2.2のreservation定義どおり）
- dropped 7のうちt02 / t04 / t10は、元Route `O_t` がB0でselectedだった（D1で13評価ずつ `target_regressed_R`）

### 1.2 Phase BのK0 unit（`docs/PLANNER_GLOBAL_PHASE2C27B_RESULT.json` の `units[]` のうち `contextRank === 1`）

Phase Bは各Targetで、P1 rank 1（K0、empty reservation `fnv1a32:5ac88909`）を含む全contextをrung-majorで実行した。K0 unitは24件である。

| t | L0 | L1 | L2 | K0が最初にdeliverしたrung | 最初のdeliveryの `keySha256`（先頭8桁）/ cost |
| --- | --- | --- | --- | --- | --- |
| t00 | extent bound（0件） | found_R（1件、excluded 1） | 未実行 | L1 | `c77ec708` / 179 |
| t01 | extent bound（0件） | found_R（1件、excluded 1） | 未実行 | L1 | `0441099a` / 92 |
| t02 | extent bound（0件） | extent bound（0件） | found_R（1件、excluded 0） | L2 | `8ce3577c` / 600 |
| t03 | extent bound（0件） | extent bound（0件） | found_R（1件、excluded 1） | L2 | `2cb15341` / 335 |
| t04 | extent bound（0件） | extent bound（0件） | found_R（1件、excluded 1） | L2 | `11098a7b` / 1142 |
| t05 | found_R（1件、excluded 1） | 未実行 | 未実行 | L0 | `83381c4b` / 97 |
| t06 | found_R（1件、excluded 1） | 未実行 | 未実行 | L0 | `78736739` / 162 |
| t07 | extent bound（0件） | found_R（1件、excluded 1） | 未実行 | L1 | `97c8f24a` / 255 |
| t08 | extent bound（0件） | extent bound（0件） | found_R（1件、excluded 1） | L2 | `d070f1a2` / 551 |
| t09 | extent bound（0件） | extent bound（0件、excluded 1） | **未実行**（t09はK1 rank 10で停止） | — | — |
| t10 | extent bound（0件） | found_R（1件、excluded 1） | 未実行 | L1 | `c722f8a6` / 51 |

- K0 unitのwall（child全体、trial込み）は7.9〜85.8 s、合計約550 s。Search時間（trial除く）は0.1〜60.9 s（最大はt04 L2）。K0のunitに
  `exhausted`（extent外にもworkが無い）は1件も無く、0件のunitはすべて `stoppedByExtent`
- found unitの「excluded 1」は、`G` より前に当該Targetの現在Route（`excludedRouteKeys`）がdeliver順に現れて除外されたことを示す
- K0のfound unitはすべて最初のdelivery（delivery index 0）で消費者が停止している（Phase Bのpolicy）。**その後のK0 deliveryは計測されていない**
- t09のK0 L2はPhase Bで実行されておらず、D2で初めて実行される（§2.2）
- Phase Bの最初のK0 deliveryは、D1 R（再delivery）で復元されたD1の `G_t` と同じCandidateである（t09を除く10件。D1-A §1.3 / §3）

### 1.3 推論（測定していない。D2-Bのparity検査で確認する）

- I-D2-1: Searchは決定的であり（Phase A §6.2、D1 Rの11 / 11一致）、consumerの停止位置はdelivery順を変えない（`visitPlannerAlternativeCandidates()` は
  cost lower boundの順にflushし、consumerの判定はflush後に読む）。したがってD2のK0 discoveryで、t09以外の10 Targetの最初の新規CandidateはD1の `G_t` と
  一致するはずである。D2-Bはこれを推定として使わず、§7.3のparityとして検査する
- I-D2-2: deliveryはcost順なので、K0の2件目・3件目のCandidateは1件目と近いcostのRouteで、同じCounter位置・同じOwnedWeaponを使い、1件目と同じ勝者に
  負ける可能性がある。これは結果の予想であり、D2の判定規則には使わない（§11.2）

## 2. 事前登録条件: 目的・population・discovery

### 2.1 目的とスコープ

| 項目 | D2の値 |
| --- | --- |
| 目的 | Phase Bの `found_R` をTarget探索の停止条件として使わず、K0の複数Candidateを発見し（discovery）、R1でadmissionし、Global採用を集合評価（R5）で決める policy（follow-up X3 = 選択肢4 + C1）を、E1 11 Targetについて小規模に評価する |
| population | E1 11 Target（Phase B manifest `.local/PLANNER_GLOBAL_PHASE2C27B_FORMAL_TARGETS.json.local`、SHA-256 `d4486ba3…d9de`。D1と同じ11件、Target ID昇順にt00〜t10）。Targetを追加・削除しない |
| context | **K0（empty reservation）のみ**。K1 / K2 contextでのSearchは行わない（§2.4） |
| extent | Phase Bの登録ladder L0 `{4, 235, 4}` / L1 `{8, 235, 256}` / L2 `{128, 235, 1500}`（Normal / Gogma / Skill） |
| その他32 Target | 元Route（Export上のEntry）のまま。置換しない |
| Export / RNG / CalculationContext | D1と同じ（Export `cc35fb5b…1e6b`、`production-rng:c5-e7`、`{ gameVersion: 'unknown-initial', masterDataVersion: 4, rngEngineVersion: 'production-rng:c5-e7', appSchemaVersion: 17 }`） |
| Plan step bound | Research `researchMaxPlanSteps = 20000`（Phase A §1のC。Production A / Bと混同しない、G12） |
| conflict resolution / fixed constraint | すべての評価runで `conflictResolutions = []`、preflightのfixed constraint `[]`（G1） |

D2の対象外:

- K1 / K2 contextのSearch（限定K1探索は§13の別登録）、E2 / residual 3、43 Target全体、baseline未完成23 Targetへの拡大
- oracle exactとの比較。oracle（RESULT `PLANNER_GLOBAL_1657_ORACLE_RESULT.json`、manifest、module）は実行入力・診断入力・分析のいずれにも使わない。post-hocにも読まない
- Phase B / D1のformal RESULT、`found_R`、`B2C27B_INCOMPLETE`、`D1_FOUND_R_SET_PARTIAL` の書き換え。D2の結果をPhase B / D1のdecision inputへ戻さない
- Production化、REQUIREMENTS 23の契約変更、Production defaultの変更

### 2.2 population

- `oracleGuidedTargetPopulation = true`: E1はPhase A §2.3のとおりoracle-informedに選ばれたpopulationである。manifestはTarget IDだけを持ち、D2のpolicyは
  11 Targetすべてに **同一の規則** を適用する（Target IDで分岐しない）。policy自体はoracle-freeである
- extent ladder（L1 / L2）はoracle-informed Research ladder（Phase A §5.1）を引き継ぐ（`inheritsOracleInformedExtentLadder = true`）
- D2の結果からE1以外への一般化、Production default extentとしての妥当性は主張しない（§11）

### 2.3 discovery（Candidate発見）

各Targetについて、K0 contextをL0 → L1 → L2の順に実行する。**execution unitは (Target, rung)** で、unitごとに新しいchild processを使う。

```text
pool(t) = []                      // そのTargetのunique Candidate（discovery順、最大 POOL_CAP = 3）
for rung in [L0, L1, L2]:
    unit DSC-<t>-<rung>:
        searchInput = { origin, targetWeaponId: t, extent: rung, reservation: K0（empty）, excludedRouteKeys: [t の現在Routeのkey] }
        visitPlannerAlternativeCandidates(searchInput, engine, consumer)       // capture policyなし、既存orderingのまま
        consumer(candidate):
            key = candidateStableKey(candidate)
            key ∈ pool(t)のkey   -> action = duplicate_of_lower_rung、continue（poolに数えない、materializeしない）
            それ以外              -> materializer.materializeBuildListEntry(candidate, baseline.buildListEntries)
                                     G store へbody全体を書く（SHA-256を記録）、pool(t)へ追加、action = pooled
                                     |pool(t)| = POOL_CAP -> stop
                                     それ以外              -> continue
    unitの結果（typed outcome、上から判定）:
        consumerがstopした                       -> discovery_cap_reached        : Targetのdiscovery終了
        summary.exhausted                        -> discovery_exhausted          : Targetのdiscovery終了（extentを広げても増えない）
        summary.stoppedByExtent                  -> stopped_by_search_extent_bound : 次rungへ（L2なら ladder_exhausted で終了）
        timeout / OOM / process failure / interrupted -> unmeasured             : Targetのdiscovery終了（上位rungへ進めない、G6 / G11）
        typed calculation error                  -> discovery_calculation_error  : unmeasured扱い（§6.2）、Targetのdiscovery終了
```

- **上位rungへ進む条件** は、unitが `stopped_by_search_extent_bound` で終わり、かつpoolが3件未満であることだけである（Phase A G11と同じ。trial / bound /
  unmeasuredはextent不足の証拠ではない）
- **unitごとのdelivery上限**: consumerが受け取るdeliveryは、新規（pooled）が `POOL_CAP − |pool(t)|開始時` 件以下、重複（duplicate_of_lower_rung）が
  `|pool(t)|開始時` 件以下である。Searchは1 run内で同じ `candidateStableKey` を2回deliverしない（`visitPlannerAlternativeCandidates()` の `seen`）ので、
  1 unitが受け取るdeliveryは3件以下である
- **Targetあたりのunit上限**: 3（L0 / L1 / L2）。全体33
- **Targetあたりのunique Candidate上限**: `POOL_CAP = 3`。全体33
- poolの順序（**discovery ordinal**、1始まり）は (rung昇順, unit内delivery順) である。これはSearchの既存ordering（`compareConstrainedCandidates()` の
  6-key順、Target preferenceを含む）そのものであり、D2は並べ替えない
- `excludedRouteKeys` はPhase B / D1と同じく当該Targetの現在Route（`O_t`）のkeyだけ。D1の `G_t` は除外しない（D2は発見をやり直す）
- `found_R` にならなかったこと、`G` がselectedにならなかったこと、`target_regressed_R` を理由に、Candidateをpoolから除外しない（G14）
- materializeは既存materializer（`createPlannerAlternativeMaterializer()`）だけで行い、Route・`route.operations` からBuildListEntryを組み立てない
- 各pooled Candidateについて記録する: unit ID、rung、unit内delivery index、discovery ordinal、`candidateStableKey()` 全文とSHA-256、cost
  （`estimatedOperationCount`）、Route kind、`route.operations` 件数、R0のreservation check（Phase Bと同じ `summarizePhase2C2Entry()` /
  `respectsPhase2C2Reservation()`。K0では常に成立するはずで、不成立は不変条件違反）、Search identity（`createPlannerAlternativeSearchIdentity()`）、
  generated Entry ID、`reusedExisting`、G store fileとSHA-256、`resolveBuildListEntryReplacement()` の結果（`ready` かつ `replacedBuildListEntryId === O_t`）
- unitごとに記録する: Search summary（`deliveredCandidates` / `excludedCandidates` / `exhausted` / `stoppedByExtent` / `stoppedByConsumer` /
  `skippedExcludedRouteKeys` 件数）、consumerが受け取った全deliveryのkey SHA-256とaction、searchOnlyMs、materializeMs、wall、heap / RSS peak
- K0 context（origin、empty reservation、`excludedRouteKeys`）はPhase Bと同じ方法で再導出し（§12）、reservationの `hashStableValue()` が
  `fnv1a32:5ac88909`、現在Entryが `O_t`（D1-A §1.3の登録値）と一致しなければ不変条件違反とする

### 2.4 support context（今回は無効）

D2-Aの新規SearchはK0に限定する。D1のpairwise / A-aで観測した勝者・同時participant（§1.1）は、次の限定K1探索（C2）の **入力設計のための診断情報** として
§13.2に整理するだけで、D2のSearch入力・reservation・context・orderingには一切使わない。D2-BのdiscoveryにK1 support Entryを混入させない。

## 3. 事前登録条件: admission（R1）

pooled Candidateごとに、admission評価を1件行う。

| 項目 | 値 |
| --- | --- |
| 評価ID | `ADM-<t>-c<ordinal>`（例 `ADM-t00-c2`） |
| 入力 | `T = { t }`、`G = 当該Candidate`（G storeのbody）。D1-A §4.1と同じ手順（baseline + `G` を末尾に追加、9.2.18 replacement、preflight、full runner） |
| `evaluatedAgainst` | `baseline` |
| 実行順 | Target ID昇順、Target内はdiscovery ordinal昇順 |
| 上限 | Targetあたり `|pool(t)|`（≤ 3）件、全体33件 |

R1（`candidate_admissible_R`、follow-up §4.3）の成立条件（すべて必須）:

1. discoveryのmaterializationで `reusedExisting === false`。`true` の場合はadmission評価を実行せず（`not_run_reused_existing`、measured）、R1偽
2. `resolveBuildListEntryReplacement()` が `ready` で `replacedBuildListEntryId === O_t`
3. preflight `ready`
4. 評価statusが `evaluated`（full runがPlannerResultを返し、Plan生成とTrace Replayが例外なく完了）
5. `plan !== null` かつ `termination.status ∈ { 'completed', 'exhausted' }`

- **admitted** ⇔ R1成立。R1が偽でもmeasuredであれば（`preflight_refused`、`planner_rerun_bound_reached`、`plan === null`、`incomplete`）、そのCandidateは
  admittedでないだけで、Targetのdiscoveryや他Candidateには影響しない
- R2（`support_consistent_R`、K0は常に `support_vacuous`）、R3（`generated_selected_R`）、R4（`joint_selected_R`）、`target_regressed_R`
  （`O_t` がB0でselected、かつ `G` がselectedでない）、Phase B / D1と同じ `found_R` 判定（`judgePlannerAlternativeTrial()`、support `[]`。literalは `found_R`）、
  `G` を外した勝者Entry、`G` を含むConflictの他participantを **診断として記録する**。これらはadmissionにも集合評価の受理にも使わない
- admission評価の結果（R1〜R4）をR5として流用しない（G20）

## 4. 事前登録条件: 集合評価（主軸 CMP、K0のみ）

### 4.1 手順

```text
accepted   = []                         // Target ID昇順の置換集合（各Target高々1件）
reference  = B0の結果                    // 受理判定の比較基準
for t in Target ID昇順（t00 → t10）:
    tのdiscoveryがunmeasured / not_executedで終わった、またはtのADMに1件でもunmeasured / not_executedがある
               -> CMP評価を起動せず stepOutcome = step_unmeasured（stepNotEvaluatedReason = dependency_unmeasured）、
                  accepted / referenceは維持、以後の段に afterUnmeasuredStep = true、次のTargetへ
    cands = pool(t)のうちadmittedなもの（discovery ordinal昇順）
    cands が空 -> stepOutcome = not_replaced_no_admitted、次のTargetへ
    for c in cands:                                  // 早期打ち切りなし。cands全件を評価する
        proposed = accepted ∪ { t: c }               // Target ID昇順
        評価 CMP-<t>-c<ordinal>: proposed を evaluatedAgainst = replacement_set として1 runで評価
        eligible(c) = 評価statusが evaluated
                      ∧ proposed全体がR5（D1-A §4.4）の5条件を満たす
                      ∧ completed(proposed) ≥ completed(reference)        // 非後退gate（§4.2）
    いずれかの評価がunmeasured / not_executed -> stepOutcome = step_unmeasured、accepted / referenceは維持、以後の段に afterUnmeasuredStep = true
    eligibleが空                               -> stepOutcome = not_replaced_no_eligible、accepted / referenceは維持
    それ以外 -> best = eligibleのうち選択順（§4.3）で最初のもの
               accepted = accepted ∪ { t: best }、reference = bestの評価結果、stepOutcome = accepted
final = accepted、finalResult = 最後に受理した評価の結果（受理が無ければB0）
```

- 1回のPlannerInputには各Target高々1件の置換（`-O_t + G`）だけを入れる（G15）。同一Targetの複数Candidateを同じPlannerInputへ入れない
- R5の再確認は追加した1件だけでなく、受理済みの全 `G` のselected、support依存（主軸では全Candidateが `requiresSupport = []` で `support_vacuous`）、
  集合内Conflict（participantに `M = S_G ∪ S_sup` の要素を2件以上含むConflictが無い）、Plan + Trace Replayに及ぶ（D1-A §4.4をproposed全体へ適用）
- 一度不受理になったTargetを、後のTargetの受理後に再評価しない（単一pass）。これは事前登録した有界な手順であり、未評価の組合せについて何も主張しない（§11）
- 最終結果のために追加の評価runを行わない。`finalResult` は最後に受理した評価runの結果そのものである
- 評価上限: `Σ_t |admitted(t)| ≤ 33`

### 4.2 非後退gate

受理条件に `completed(proposed) ≥ completed(reference)` を加える。`completed` は `termination.completedTargetCount`（43 planning Target中）である。

- 目的: R5は集合外Targetの完成を要求しない（D1-A §4.4）ので、R5だけでは集合外Targetを失う置換も受理し得る。Global完成（Issue #154）へ向かう
  合成として、受理によって全体のcompletedが減ることを許さない
- `target_regressed_R`（admission評価のbaseline-relativeな診断）とは別物である。集合評価で受理されるCandidateは必ずselected（R5(1)）なので、受理集合の
  Target自身が後退することは無い。gateはCandidateをcloseしない（同じCandidateが後のpassで再評価されることは今回の登録に無いが、poolからは除かない）
- D1のA-c合成列では受理段のcompletedが21 → 22 → 22 → 22で一度も減っていない（§1.1）ので、gateを入れてもD1のA-cと同じ規則の範囲にある
- gate不成立でR5成立の評価は `r5OnlyEligible = true` として記録する（診断。受理には使わない）

### 4.3 Candidate選択順（eligibleが複数あるとき、上から比較）

| 順 | key | 向き | 理由 |
| --- | --- | --- | --- |
| 1 | `completed(proposed)`（`termination.completedTargetCount`） | 大きい方 | Issue #154の最終目標（全Target完成）に直接対応する |
| 2 | 未解決Conflict件数（`result.conflicts.length`） | 少ない方 | Issue #154 acceptanceのConflict 0に対応する |
| 3 | Plan step数（`plan.steps.length`） | 少ない方 | 同じ完成・Conflictなら操作が少ないPlanを選ぶ（弱い品質信号なので3番目） |
| 4 | discovery ordinal | 小さい方 | Searchの既存ordering（cost等の6-key順）。全順序なので必ず決まる |

- 選択順はeligibleの中だけで使う。R5不成立・gate不成立のCandidateを、completed等が大きいことを理由に受理しない
- 比較値はすべて当該評価runの結果から読み、admission評価（`evaluatedAgainst = baseline`）の値を使わない

## 5. 事前登録条件: D1 incumbent seeded axis（独立した評価軸 Z）

主軸（CMP）はK0-onlyであり、D1 incumbentのt09（K1 Candidate）を含められない。そこで「D1 incumbentに、D2で発見したK0 Candidateを追加できるか」を、
**主軸とは独立した評価軸 Z** として登録する。Zの結果は主軸のdecisionに使わず、Z専用のdecision（§9.3）を持つ。

| 項目 | 値 |
| --- | --- |
| seed | D1の最終受理集合 `{t01, t07, t08, t09}`。各 `G_t` はD1 G store（`.local/d1-formal2.run/<unitId>.generated-entry.json`）のbodyで、SHA-256はD1 RESULT `sources.d1.generatedEntries` と一致すること。t09は **K1 Candidate**（`requiresSupport = ['build-list.fnv1a32-e396d352']`、reservation `fnv1a32:240e4673`）であることを `seededAxisIncludesK1Candidate = true` として記録する |
| Z0 | seedを `replacement_set` として1 runで評価する。`inputDigest` はD1 `A-b` と同じ定義・同じ値（`fnv1a32:e38da50a`）になり、`resultDigest` はD1記録値 `fnv1a32:b61ef1dc` と一致しなければならない（§7.3）。R5成立も要求する（正常に計測されて不成立ならD1 parity `mismatched`）。Z0が未計測ならparityは `not_checked` で、Z軸だけが `D2A_Z_INCOMPLETE` になる（§7.3.3） |
| 対象Target | seed外のdropped 7（t00 / t02 / t03 / t04 / t05 / t06 / t10）を **Target ID昇順** |
| 候補 | 各Targetの **D2 admitted K0 Candidate**（§3）。discovery ordinal昇順。seed内Target（t01 / t07 / t08 / t09）のD2 Candidateは使わない（seedを置き換えない） |
| 手順 | §4.1と同じ（`accepted = seed`、`reference = Z0の結果` から開始）。評価IDは `Z-<t>-c<ordinal>` |
| R5 | D1-A §4.4をproposed全体へ適用。`S_sup = { build-list.fnv1a32-e396d352 }`（t09由来）。t09のsupport依存はD1-A §4.5のS1〜S5で検査し、動的check（S1〜S3）不成立は `support_expired_R`（R5偽、measured）、静的check（S4 / S5）不成立は `D2A_INVALID` |
| gate・選択順 | §4.2 / §4.3と同じ |
| 上限 | Z0 1件 + `Σ_{t ∈ dropped 7} |admitted(t)|`（≤ 21）= 22件以下 |

- Zはsupport Entry `e396d352` を通常のEntryのまま扱う（G1）。dropped 7のうちt00 / t02 / t10の勝者が `e396d352` であることは§1.1の事実であり、
  ZでK0 Candidateがそれに勝てばt09のsupportが外れてR5が成立しない。これはZの規則どおりの帰結であり、救済しない
- 置換後のRouteがsupportの前提を満たすとは扱わない（alternative-to-alternative supportは定義しない、G18）
- D1 incumbentはまず読み取り専用の比較基準（§9.1の比較値）であり、Zはそれを初期集合として使う **別評価** である。Zの受理結果を主軸の受理集合へ混ぜない

## 6. 事前登録条件: 評価runの共通手順・status・budget

### 6.1 評価runの共通手順

B0 / ADM / CMP / Zの評価runは、D1-A §4.1（入力構成）、§4.2（記録項目）、§4.3（Conflict resource identity）、§4.4（R5）、§4.5（support依存、Zのt09だけ）
をそのまま使う。B0はD1-A §5.1と同じ（置換なし、`{ kind: 'persisted' }`、Phase 2-C2 baseline summaryとのparity）。D2で追加して記録する項目:

| 項目 | 内容 |
| --- | --- |
| `rejectedBuildListEntries` | `plan.rejectedBuildListEntries` の各要素の `buildListEntryId` / `reason`（ID昇順）。`resource_conflict` 件数を別fieldにする |
| selected Target集合 | `plan.selectedBuildListEntryIds` のEntryのTarget ID集合（昇順） |
| reference差分 | CMP / Zの各評価について、その段の `reference`（直前の受理結果、またはB0 / Z0）との差: completed、Conflict件数、steps、selected Targetの追加（`targetsGained`）/ 削除（`targetsLost`） |
| R6 | §6.4のR6判定（`replacement_set` の評価だけ） |
| 診断 | 各 `G` のcommitment status・勝者、`G` を含むConflictの他participant（§13.2の将来入力） |

### 6.2 status

評価statusはD1-A §6.2と同じ（`evaluated` / `preflight_refused` / `planner_rerun_bound_reached` はmeasured、`timeout` / `out_of_memory` /
`process_failure` / `interrupted` / `calculation_error`（ADM / CMP / Z）/ `not_executed` はunmeasured）。D2で追加・明確化する点:

| 対象 | status / outcome | measured | 扱い |
| --- | --- | --- | --- |
| discovery unit | `discovery_cap_reached` / `stopped_by_search_extent_bound` / `discovery_exhausted` / `ladder_exhausted`（L2がextent bound） | yes | §2.3 |
| discovery unit | `timeout` / `out_of_memory` / `process_failure` / `interrupted` / `discovery_calculation_error`（`discovery_calculation_error` はPhase Bに比較相手のunitが無い場合だけ。比較相手があるunitの型付きerrorは、Phase Bが同じ入力を正常に処理しているのでparity `mismatched`、§7.3.3） | **no** | そのTargetのdiscoveryを終了。そのunitで受け取ったdeliveryは使わない（unitのrecordが無い、または不完全）。それより前のunitでpoolしたCandidateは使う。poolを `discoveryIncompleteAfterUnmeasured = true` とする |
| discovery unit | `not_executed`（`run_envelope_reached` / `aborted_after_invalid`） | **no** | 同上 |
| ADM | `not_run_reused_existing` | yes | R1偽 |
| B0 / ADM / CMP / Z | `calculation_error` | B0 / Z0: childは正常に終了して型付きerrorを記録したので比較可能な結果であり、D1の記録（`evaluated`）と異なる = parity `mismatched`（`D2A_INVALID`、§7.3）。ADM / CMP / Z（Z0以外）: **no**（ただし同じ `inputDigest` の比較相手があれば§7.3.2で `mismatched`） | ADMで当該Candidateがadmittedか不明になる。CMP / Zではその段が `step_unmeasured` |
| Z0 | `timeout` / `out_of_memory` / `process_failure` / `interrupted` / `not_executed` | **no** | Z0 parityは `not_checked`（§7.3.3）。Zの後続評価（`Z-*`）は起動せず `not_executed`（`notExecutedReason = z0_unmeasured`）とし、`seededAxis.case = D2A_Z_INCOMPLETE`。主軸の測定済み結果とdecisionには影響しない（§9.2） |
| ADM | unmeasured | **no** | 当該Candidateはadmitted扱いにしない（`admission_unmeasured`）。CMP / Zの当該Targetの段は評価を起動せず `step_unmeasured`（admitted集合が確定しないため、§4.1） |
| discovery unit（再掲） | unmeasured / `not_executed` | **no** | poolが確定しないので、CMP / Zの当該Targetの段は評価を起動せず `step_unmeasured`（§4.1）。ADMはpool済みCandidateについて実行し記録する（診断） |

- `plan_bound_truncated`（`termination.status === 'incomplete'`）と `planner_rerun_bound_reached` は **bound-limited** として一覧に残し、通常の非共存と区別する
  （D1-A §6.2と同じ）
- wall-clock timeout・OOMをnot-found・非共存・extent不足のいずれへも読み替えない（G6 / G7）
- unmeasured（timeout / OOM / process failure / interrupted / not_executed）かどうかは、runner（親）が記録したprocess outcomeとnot_executed記録だけで決まる。
  「completedと記録されたのにrecordが無い」等の証拠の欠損・破損は未計測に読み替えず、§8.5で `D2A_INVALID` とする

### 6.3 budget（それぞれ独立。Production boundへ流用・合算しない、G5）

| budget | 値 | 根拠（Phase B / D1の実測） |
| --- | --- | --- |
| Search extent | L0 `{4, 235, 4}` / L1 `{8, 235, 256}` / L2 `{128, 235, 1500}` | Phase B登録ladderと同じ（比較可能性）。oracle-informed（§2.2） |
| context | K0のみ、Targetあたり1 | §2.4 |
| discovery unit（context × rung） | Targetあたり3以下、全体33以下 | Phase BのK0 unitは24件で合計約550 s |
| unique Candidate（pool） | Targetあたり3（`POOL_CAP`）、全体33以下 | D1でdropped 7の1件目は一度もselectedにならなかった（§1.1）。2件目・3件目の発見を最小限の追加で測る。値3はoracle由来ではない |
| unitごとのdelivery | 3以下（§2.3） | Search内の重複排除と `POOL_CAP` から導出 |
| admission評価 | Targetあたり `|pool(t)|` 以下、全体33以下 | 全pooled Candidateを評価する（発見したCandidateを未評価のまま捨てない） |
| 集合評価（CMP） | `Σ |admitted(t)|` 以下、全体33以下 | D1の評価1件6.9〜14.0 s |
| 集合評価（Z） | 1 + `Σ_{dropped 7} |admitted(t)|` 以下、全体22以下 | 同上 |
| B0 | 1 | D1-A §5.1 |
| 評価リクエスト合計 | B0 1 + ADM ≤ 33 + CMP ≤ 33 + Z ≤ 22 = **89以下** | |
| 評価ごとのfull Planner起動上限 | 8（runtime-unsupported retryを含む。`createPlannerAlternativeFullRunBudget()` と同じ形のResearch budget、評価ごとに新規） | D1-A §6.3と同じ。D1は全80評価で1回 |
| `researchMaxPlanSteps` | 20000 | D1・Phase Bと同じ。D1のPlanは723〜1465 steps |

### 6.4 R5 / R6

- R5（`set_coexistent_R`）: D1-A §4.4の5条件そのまま。`evaluatedAgainst = replacement_set` の評価（CMP / Z）だけで判定する。B0 / ADMでは判定しない
- R6（`global_complete_R`、follow-up §4.3）: `replacement_set` の評価について、次をすべて満たすこと
  1. 評価statusが `evaluated`、`plan !== null`、Trace Replay成功（`evaluated` に含まれる）
  2. `termination.status === 'completed'` かつ `completedTargetCount === totalTargetCount === 43`
  3. `result.conflicts.length === 0`
  4. `plan.rejectedBuildListEntries` に `reason === 'resource_conflict'` の要素が無い
  5. R5成立
- R6はIssue #154のacceptance（計算時間・memoryを除く）に当たる。R5成立・completed増加・Conflict減少だけではR6を主張しない

## 7. 事前登録条件: 実行順序・execution envelope・決定性

### 7.1 実行順序（固定）

```text
V     入力検証（親。childを起動しない、§8.1）
DSC   t00 → t10、各Target内はL0 → L1 → L2（§2.3の規則で打ち切る）
B0
ADM   Target ID昇順、Target内はdiscovery ordinal昇順
CMP   t00 → t10（各段は前段の受理結果に依存）
Z     Z0 → dropped 7をTarget ID昇順（各段は前段の受理結果に依存）
```

- 主軸（DSC / B0 / ADM / CMP）をZより先に実行する。Zの未計測は主軸のdecisionに影響しない（§9）
- 登録された評価をすべて実行する。同じ `inputDigest` の評価が既にあっても結果を流用せず、別のchild processで実行する（§7.3の照合に使う）

### 7.2 execution envelope

| 項目 | 値 | 根拠 |
| --- | --- | --- |
| discovery unitごとのwall上限 | 60分（親が判定、超過はtimeout = unmeasured） | Phase B / D1 Rと同じ（`inheritsOracleInformedExecutionEnvelope = true`）。Phase BのK0 unitは最大85.8 s。1件目より後のK0 deliveryは未計測なので余裕を残す |
| 評価ごとのwall上限 | 30分（preflight、full run、retry、Trace Replayを含むchild全体） | D1-A §6.1と同じ。D1は最大14.0 s |
| **run全体のwall上限** | **12時間**。到達後は新しいchildを起動せず、未起動の登録unit / 評価を `not_executed`（`run_envelope_reached`）として記録する（実行中のchildは各上限まで待つ） | 74時間級のrunを繰り返さないための上限。見積もり（§7.4）の4倍以上 |
| child heap上限 | 12,288 MB（`--max-old-space-size`） | Phase B / D1と同じ。Phase B K1のpeak 9.26 GB、D1は2.04 GB |
| concurrency | 1 | Phase B / D1と同じ |
| retry / fallback | なし / なし（timeout・OOM・failureでも条件を変えて再実行しない） | G6 |
| child process | discovery unit・評価ごとに新しいchild。Node yieldは `setImmediate`、memory sample間隔250 ms | Phase B / D1と同じ |

wall-clock上限はexecution envelopeであり、意味論的なnot-found・非共存・extent不足の判定に使わない（G7）。

### 7.3 決定性・parity（`mismatched` なら `D2A_INVALID`、`not_checked` は該当する軸の `INCOMPLETE`）

`inputDigest` / `resultDigest` はD1-A §9.4と **同じ定義・同じ関数** で計算する（`inputDigest = hashStableValue({ T（Target ID昇順）, G_TのEntry ID, G_TのG store
SHA-256, Export SHA-256, researchMaxPlanSteps, conflictResolutions: [] })`）。

#### 7.3.1 parity状態

各parity検査は、次のいずれか1つの状態を持つ。状態はanalyzerがrecordから独立に再計算し、runner / childの自己申告をそのまま使わない。

| 状態 | 意味 | decisionへの影響 |
| --- | --- | --- |
| `matched` | 必要な比較対象がすべて **正常に計測され**（§7.3.2の「比較可能な結果」を持ち）、期待値と一致した | なし |
| `mismatched` | 必要な比較対象が正常に計測され、実際に期待値と異なった、または正常完了した計測の中で期待された要素（delivery、Candidate、終了状態）が欠けていた | `D2A_INVALID`（formal validity違反、§9.2）。主軸・Z軸のどちらで起きても全体のdecisionを `D2A_INVALID` にする |
| `not_checked` | 必要な比較対象の少なくとも1つが未計測（timeout / OOM / process failure / interrupted / `not_executed`（`run_envelope_reached` / `dependency_unmeasured` / `z0_unmeasured` 等））で、一致・不一致を判定できない | 不一致とは扱わない。原因の未計測unit / 評価が属する軸の `INCOMPLETE`（主軸 `D2A_INCOMPLETE`、Z軸 `D2A_Z_INCOMPLETE`）で扱う |
| `not_applicable` | 比較対象が登録上存在しない（Phase Bに対応unitが無いrung、t09のD1 G、pool 2件目・3件目のD1 G、同じ `inputDigest` の評価が1件だけ） | なし |

- `not_checked` の検査には、未確認の理由を必ず記録する: 依存するunit / 評価ID、それぞれのstatus、`unmeasuredReason`、`notExecutedReason`
- 1件でも `mismatched` があれば、同じ検査や他の検査に `not_checked` があっても `D2A_INVALID` である（§9.2の判定順）
- `not_checked` は「検査を省略した」ことではない。比較対象が後から得られることは無く（retry / 再実行なし）、parity未確認のまま下限evidenceとして扱う
- 未計測のchildが途中まで出力した情報（進捗等）から観測できたprefixは、`observedPrefixDiagnostic` として一致・不一致とも記録してよいが、診断に限る。
  検査の状態は `not_checked` のままで、`matched` にも `mismatched` にもしない

#### 7.3.2 比較可能な結果

ある評価・unitが「正常に計測された」（比較可能な結果を持つ）とは、runnerのprocess outcomeがcompleted（exit 0）で、SHA-256が一致する完全なrecordがあることをいう
（§8.5）。statusでは次のとおり。

| 対象 | 比較可能な結果（正常に計測された） | 比較不能（未計測 → `not_checked`） |
| --- | --- | --- |
| 評価（B0 / ADM / CMP / Z0 / Z） | `evaluated`、`preflight_refused`、`planner_rerun_bound_reached`、`calculation_error`（childが型付きerrorを記録して正常終了したもの） | `timeout`、`out_of_memory`、`process_failure`、`interrupted`、`not_executed` |
| discovery unit | `discovery_cap_reached`、`stopped_by_search_extent_bound`、`discovery_exhausted`、`ladder_exhausted`、型付きcalculation error（childが記録して正常終了したもの） | `timeout`、`out_of_memory`、`process_failure`、`interrupted`、`not_executed` |

比較可能な結果同士でstatusが異なれば（例: D1で `evaluated` の入力がD2で `calculation_error`、Phase Bで正常にdeliverしたunitがD2で型付きerror）、それは `mismatched` である。

#### 7.3.3 検査ごとの規則

| 検査 | 比較対象 | `matched` / `mismatched` | `not_checked` | 失敗時のcategory |
| --- | --- | --- | --- | --- |
| Phase B K0 prefix | Phase Bが実行した (Target, rung) のK0 unit 24件（§1.2）と、D2の同じunit | D2のunitが正常に計測された場合だけ判定する。Phase Bのfound unit（1件deliver後にconsumer停止）: D2のunitが受け取った1件目の `keySha256` が一致すれば `matched`、異なる・D2が1件もdeliverせず終わった（期待されたdeliveryの欠落）・型付きerrorなら `mismatched`。Phase Bで0件・`stoppedByExtent` だったunit: D2も0件・`stopped_by_search_extent_bound` なら `matched`、deliveryがあった・`discovery_exhausted` で終わった・型付きerrorなら `mismatched` | D2のunitが未計測、または上流unitの未計測で `not_executed` になった（Phase Bで0件・extent boundだったunitでも、D2が未計測なら終了状態の一致を要求しない） | `phase_b_k0_parity` |
| D1 G | t09以外の10 Targetのpool 1件目と、D1の `G_t` | pool 1件目を生むべきunit（Phase Bの最初のK0 delivery rung）とそれより前のunitが正常に計測された場合だけ判定する。pool 1件目の `candidateStableKey()` のSHA-256がPhase Bの `keySha256`、generated Entry IDがD1の `G_t`、G store bodyのSHA-256がD1 RESULT `sources.d1.generatedEntries` とすべて一致すれば `matched`、いずれかが異なる、またはpool 1件目が存在しなければ `mismatched` | 該当unitが未計測・`not_executed` | `d1_parity` |
| D1 G（2件目以降） | pool 2件目・3件目 | 比較しない（`not_applicable`）。D1の `G_t` と異なる新規Candidateであることを不一致にしない | — | — |
| B0 | D1-A §5.1のPhase 2-C2 baseline summary、D1 B0の `resultDigest` `fnv1a32:880bbb52` | B0が比較可能な結果を持つ場合、summaryと `resultDigest` を厳密に比較する。B0の `calculation_error` は `mismatched` | B0が未計測 | `baseline_parity_mismatch` / `d1_parity` |
| Z0 | D1 `A-b`（`resultDigest fnv1a32:b61ef1dc`、R5成立） | Z0が比較可能な結果を持つ場合、`resultDigest` とR5成立がともに一致すれば `matched`、いずれかが異なれば（`calculation_error`、`preflight_refused`、`planner_rerun_bound_reached` を含む）`mismatched` → `D2A_INVALID` | Z0が未計測 → `not_checked`。`seededAxis.case = D2A_Z_INCOMPLETE`、Z後続評価は `not_executed`（`z0_unmeasured`）。**主軸の測定済み結果を無効化せず、主軸のdecisionを自動的に `D2A_INCOMPLETE` にしない**（主軸は主軸の未計測・INVALIDだけで判定する、§9.2） | `d1_parity` |
| D2内の決定性 | `inputDigest` が同じD2評価の組（ADMとCMPのsingleton段など、`evaluatedAgainst` が異なってもよい） | 組のうち比較可能な結果を持つ評価が2件以上あれば、それらのstatusと `resultDigest` がすべて一致すれば `matched`、1組でも異なれば `mismatched` | 比較可能な結果を持つ評価が1件以下で、残りが未計測（全員が計測済みなら `matched` / `mismatched`、そもそも1件しか無ければ `not_applicable`） | `determinism` |
| D1との決定性 | D2評価の `inputDigest` がD1 RESULTの80評価のいずれかと一致するもの（pool 1件目のADMとD1 `S-<t>`、CMP / ZとD1 `P` / `A-c` の同一集合など） | D2評価が比較可能な結果を持てば、D1の記録（すべて `evaluated`）とstatus・`resultDigest` を比較する | D2評価が未計測 | `d1_parity` |

- 比較可能な結果を持つ評価が1件でも不一致なら、同じ組の他の評価が未計測でも `mismatched` である（未計測のメンバーは比較から除くだけで、不一致を消さない）
- 登録条件どおり、同じ `inputDigest` の評価も別のchildで実行する（§7.1）。D1の記録はparityの期待値としてだけ使い、D1の結果をD2のR5・受理・decisionへ流用しない
- 主軸のparity検査が `not_checked` になるのは、原因の主軸unit / 評価が未計測の場合であり、それ自体で `D2A_INCOMPLETE` に含まれる。決定性の組の一方がZ軸の評価で、
  Z軸側だけが未計測のために `not_checked` になった検査は、主軸のdecisionを変えない
- これらは決定性・忠実性の検査であり、D1 / Phase Bの結果をD2のR5や受理判定へ流用することではない（R5はD2の各 `replacement_set` 評価で独立に判定する）
- I-D2-1（§1.3）が正常な計測で破れた場合（Phase B K0 prefixまたはD1 Gが `mismatched`）は、計測結果を解釈せず `D2A_INVALID` とする

### 7.4 見積もり（事前登録値ではない。成功条件にしない）

| 段階 | 見積もり | 根拠 |
| --- | --- | --- |
| DSC | 約0.3〜2時間 | Phase B K0 unit 24件は合計約550 s。D2は最初のdelivery後もpool 3件またはextent終了まで続け、t09 L2を新たに実行するが、1件目より後のcostは未計測 |
| 評価 | 約89件 × 7〜15 s ≈ 10〜25分 | D1の評価80件（6.9〜14.0 s） |
| 合計 | 約0.5〜3時間 | |
| 上限 | run全体12時間（§7.2）。個別上限の積（discovery 33 × 60分 + 評価89 × 30分）はrun上限で打ち切られる | |

## 8. 事前登録条件: formal validity・provenance（いずれか違反なら `D2A_INVALID`）

### 8.1 入力（V、analyzerも独立に再検証）

D2が読む入力は次に限る。いずれもRepositoryへ追加しない（committed済みを除く）。`.local` 配下のpathはRepository rootからの相対pathである。

| 入力 | 場所 | bytes | SHA-256 | 読み取り範囲 |
| --- | --- | ---: | --- | --- |
| Export（commitしない） | 外部path（引数）`gogma-artian-planner-backup_20260927015837.json` | 19,424,064 | `cc35fb5bd85acb417b2ce0229cd79441b48c642ac8af70bbc2dfdfc8c89e1e6b` | PlannerInput構築、Entry ID → Target ID |
| Phase B population manifest | `.local/PLANNER_GLOBAL_PHASE2C27B_FORMAL_TARGETS.json.local` | 967 | `d4486ba399cb8c0f9272e2c3335e543c8727955f8d9686481fc2975d7874d9de` | Target IDだけ（`parsePhase2C27BTargetManifest()`） |
| Phase B formal RESULT（committed） | `docs/PLANNER_GLOBAL_PHASE2C27B_RESULT.json` | 808,015 | `d79ea0ded7824f8ba1828d1cffd897ed74dd68681a5759cbb194da80aa79b8e4` | allowlist（下記） |
| Phase 2-C2 RESULT（committed） | `docs/PLANNER_GLOBAL_PHASE2C2_RESULT.json` | 1,195,107 | `afb70e9745bc56c264c8892075e6adbb8886b82cec1491177aa75d265f1833a4` | `baseline.summary` だけ |
| D1 formal RESULT（committed） | `docs/PLANNER_GLOBAL_D1_RESULT.json` | 1,588,705 | `b846363fb5cfc9b9e31b8ae655faaf8b6a17f0be7d715fd42e63ed56ff35c971` | allowlist（下記） |
| D1 G store 4件（Zのseedだけ） | `.local/d1-formal2.run/t01-r01-L1.generated-entry.json` ほか | D1 RESULT `sources.d1.generatedEntries` | 同左（t01 `3c3f5cc8…8f14`、t07 `27b098e0…5e6f`、t08 `825e8a9e…44cc`、t09 `52f36e8e…48ccf`） | body全体（Zの評価入力） |
| Phase A / Phase B / follow-up / D1-A / D1-B文書 | `docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_PHASE2C27A.md` / `…_PHASE2C27B.md` / `…_PHASE2C27B_FOLLOWUP.md` / `…_D1_SPEC.md` / `…_D1B.md` | — | `b45daa27…4147` / `e05eea56…ff9c` / `335a6710…7083` / `39974cbb…359f` / `536f8cd4…fb4f` | hash照合だけ |
| 本書 | `docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_D2_SPEC.md` | — | D2-Bのmeasurement HEADでgit objectから計算し、start attestationへ記録する | — |

**Phase B RESULTの読み取りallowlist**（post-hocのoracle由来fieldを読まない。D1-A §1.2と同じ趣旨）:

- `sources` のうち `export` / `targets`（`oracle` / `oracleManifest` / `oracleModule` のentryは開かず、digest照合にも使わない）
- `provenance.formal` / `measuredHead` / `runStatus` / `calculationCodeChangedSinceMeasuredHead`、`decision.case`
- `units[]` のうち `contextRank === 1` のentryの `unitId` / `targetIndex` / `contextRank` / `rung` / `result` / `search` / `deliveries[]`（`i` / `keySha256` / `cost` /
  `action` / `respectsReservation`）

**D1 RESULTの読み取りallowlist**（D1はoracleを読んでいないが、範囲を固定する）:

- `sources`、`provenance.formal` / `measuredHead` / `runStatus` / `calculationCodeChangedSinceMeasuredHead` / `startAttestation.sha256`、`decision.case`
- `evaluations[]` の `evaluationId` / `stage` / `evaluatedAgainst` / `replacementTargets` / `generatedEntryIds` / `generatedEntrySha256s` / `status` /
  `inputDigest` / `resultDigest` / `plan.termination` / `plan.steps` / `conflicts`（件数）/ `r5.satisfied`
- `redelivery[]` の `generatedEntry`、`aggregates.aCFinalAccepted`

D1 RESULTの検証条件: `provenance.formal === true`、`measuredHead === 74886ef5…1d00`、`runStatus === 'completed'`、`calculationCodeChangedSinceMeasuredHead` が空、
`decision.case === 'D1_FOUND_R_SET_PARTIAL'`、`aggregates.aCFinalAccepted` が `[1, 7, 8, 9]`、§1.1の比較値と一致。Phase B RESULTの検証条件はD1-A §9.1と同じ
（`measuredHead === b24bf5dc…a004`、`decision.case === 'B2C27B_INCOMPLETE'`）に加え、`contextRank === 1` のunitが§1.2の24件と一致すること。

**入力検証の失敗は黙って代替しない**。ファイル不足、SHA-256不一致、record間の不整合があれば、別ファイル・再計算値・近い値で代替せず、runnerはchildを
1つも起動せずに終了し、analyzerは `D2A_INVALID`（reason category `input_evidence`）を出す。

### 8.2 measurement HEAD・provenance

- D2-Bのrunner / child / analyzer / test / 本書を含むmeasurement HEADを正式計測前にcommitし、Working Tree cleanの状態で計測する
- runnerはchild起動前にstart attestation（`wx`、read-only）を書く。記録するもの: 本書のSHA-256（measurement HEADのgit object）、§8.1の全digest、
  **登録policyのSHA-256**（§10の `conditions` に入る登録条件 = `POOL_CAP`、ladder、context、手順・選択順・gate・budget・envelope・decision ruleを
  `stableStringify()` したもののSHA-256）、**calculation code digest**（measurement HEADのgit objectから再計算したD2 benchmark codeと、それが推移的に
  importするResearch計算moduleのSHA-256）、uncommitted false、Production audit（D2-B開始時のbase main以降のProduction changed files `[]`）、
  `appliedExecutionEnvelope`、CalculationContext、`PRODUCTION_RNG_ENGINE_VERSION`
- analyzerはattestationをmeasurement HEADのgit objectと照合し、measurement HEADがanalysis HEADのancestorであること、measurement HEAD以降の計算コード変更が
  `[]`、Production source changed files（`src/domain` / `services` / `workers` / `pages` / `components` / `db`）が `[]` であることを確認する
- **計算コード変更後の結果流用禁止**: measurement HEAD以降に計算コードが変わった場合、そのrunを正式結果として使わない。再計測は新しいmeasurement HEADで
  最初からやり直し、部分的なrecordの再利用・merge・継ぎ足しをしない（D1-Bの再計測と同じ）
- CalculationContextが `{ 'unknown-initial', 4, 'production-rng:c5-e7', 17 }`、`PRODUCTION_RNG_ENGINE_VERSION === 'production-rng:c5-e7'` であること。
  D2-B開始時点でこれらが動いていた場合は、D2を実行せず本書の再登録を先に行う
- smoke（非formal確認）はformal run dirと別に行い、formal evidenceにしない。smokeの結果で条件を変えない

### 8.3 guardrail検査

- G1: すべての評価runで `conflictResolutions` 0件、preflightのfixed constraint 0件。resolution / scenario resolution / repair lineage /
  `selectedBuildListEntryId` を作らない（testでも確認）
- oracle isolation: runner / child / analyzerは、oracle module（`plannerGlobalOracle1657*`）・Phase B analysis module・population-authority moduleを
  推移的にimportしない（testでimport closureを検査）。Phase B / D1 RESULTはallowlistのfieldだけを読む
- D2-B sourceにTarget ID / Entry ID / stable keyを書かない（testで検査）。§8.1のfile名・SHA-256、§7.3 / §1の登録digestは登録値として置いてよい
- K0 discoveryのSearch入力にsupport Entryが無い（reservationが `fnv1a32:5ac88909`）。Zのsupport EntryがS4 / S5を満たす
- 登録された順序（§7.1）・規則（§2.3、§4、§5）以外のunit / 評価が無い（retry、再実行、追加評価、順序違反、件数違反なし）。child process数 = 実行した
  discovery unit数 + 実行した評価数
- discovery / CMP / Zのreplay: analyzerは記録済みのunit結果・評価結果から§2.3のrung escalation・pool構成、§3のadmission、§4 / §5の合成（eligible、
  gate、選択順、受理）を再実行し、記録と一致することを確認する
- parity: analyzerは§7.3の全検査をrecordから再計算し、各検査に `matched` / `mismatched` / `not_checked` / `not_applicable` のいずれか1つを与える。
  未計測の比較対象を `matched` と数えない。`not_checked` には依存unit / 評価IDと未計測理由が揃っていること、その依存先が実際にrunnerの記録上
  未計測であることを確認する（揃っていない、または依存先がcompletedと記録されている場合は§8.5の証拠不整合）
- Phase B / D1のmoduleとformal RESULTを変更しない（D2-Bは新しいmoduleからimportして使う）

### 8.4 raw / RESULT整合

- RESULTの各unit・評価が、raw・recordのSHA-256付きファイルから再計算した値と一致する（pool、R1〜R4、R5、R6、status、parity、reference差分、合成、decision）
- unmeasured / not_executedを含め、登録・実行されたunit / 評価がRESULTに欠けなく現れる

### 8.5 未計測と証拠の欠損・破損の区別

未計測（`INCOMPLETE` / parity `not_checked`）と、証拠の欠損・破損・不整合（`D2A_INVALID`）を混同しない。

| 状況 | 扱い |
| --- | --- |
| runnerのprocess outcomeがtimeout / OOM / process failure（exit code非0）/ interruptedで、そのためにchildのrecordが無い・不完全 | 正しく未計測として記録されていれば unmeasured。parityは `not_checked`、該当する軸の `INCOMPLETE` |
| runnerが `not_executed`（`run_envelope_reached` / `dependency_unmeasured` / `z0_unmeasured` / `aborted_after_invalid`）と記録し、childを起動していない | 同上 |
| process outcomeがcompleted（exit 0）と記録されているのに、必要なrecord（unit record、評価record、G store）が存在しない | **`D2A_INVALID`**（`evidence_integrity`）。未計測に読み替えない |
| recordのSHA-256・bytesが、runnerの記録・raw・RESULTの `sources` と一致しない | **`D2A_INVALID`**（`evidence_integrity`） |
| 正常完了したrecordの必須field（status、Search summary、delivery列、`inputDigest`、`resultDigest`、Plan / Conflictの記録等）が欠けている、型が違う | **`D2A_INVALID`**（`evidence_integrity`） |
| runnerが起動した登録unit / 評価について、process outcomeの記録そのものが無い | **`D2A_INVALID`**（`evidence_integrity`） |
| rawとRESULTの内容が一致しない（§8.4） | **`D2A_INVALID`**（`raw_result_mismatch`） |

- 欠損・破損した証拠からparityを `not_checked` として救済しない。fail-closed規則（§8.1の入力検証と同じ趣旨）に従う
- `aborted_after_invalid` による `not_executed` は、先行するINVALIDの帰結であり、decisionは `D2A_INVALID` である

## 9. 事前登録条件: decision（上から順に判定）

### 9.1 比較基準（固定）

| 基準 | completed / 43 | Conflict | steps | 出典 |
| --- | ---: | ---: | ---: | --- |
| baseline（B0） | 20 | 21 | 1465 | D1 RESULT `B0`（D2のB0もparityで一致を要求） |
| D1 incumbent `{t01, t07, t08, t09}` | 22 | 21 | 1465 | D1 RESULT `A-b` / `A-c-10` |

「(a, b) が (c, d) より良い」は、completedが大きい、またはcompletedが等しくConflictが少ないことをいう（stepsは比較に使わない）。

### 9.2 主軸のdecision（`decision.case`）

| decision | 条件 |
| --- | --- |
| `D2A_INVALID` | §7.3 / §8のformal validityに1件でも違反。parityは `mismatched` の検査が1件でもあれば違反（主軸・Z軸を問わない）。reason category: `input_evidence` / `provenance` / `phase_b_k0_parity` / `d1_parity` / `baseline_parity_mismatch` / `guardrail` / `determinism` / `evidence_integrity` / `raw_result_mismatch` |
| `D2A_INCOMPLETE` | invalid 0、かつ主軸（DSC / B0 / ADM / CMP）の登録・policy-requiredなunit / 評価のいずれかがunmeasuredまたは `not_executed`。主軸のparity `not_checked` はこの未計測が原因なのでここに含まれる。**Z0 / Zの未計測、およびZ軸側の未計測だけが原因の `not_checked` は、主軸のdecisionを `D2A_INCOMPLETE` にしない** |
| `D2A_GLOBAL_COMPLETE_R` | invalid 0、unmeasured 0、`finalResult` がR6を満たす（43 / 43、Conflict 0、`resource_conflict` 0、Trace Replay成功、R5） |
| `D2A_EXCEEDS_D1_INCUMBENT` | 上記以外で、最終受理集合の大きさ ≥ 1、かつ `finalResult` が D1 incumbent（22 / 21）より良い |
| `D2A_IMPROVED_OVER_BASELINE` | 上記以外で、`finalResult` がbaseline（20 / 21）より良い。D1 incumbentと同値（22 / 21）の場合もここに入り、`equalsD1IncumbentMetrics = true` を併記する |
| `D2A_NO_IMPROVEMENT` | invalid 0、unmeasured 0、上のいずれでもない（受理0件を含む） |

- `D2A_INCOMPLETE` でも、measuredだった評価の結果、到達した受理集合、`finalResult` のcompleted / Conflict、R6到達の有無を **下限のevidence** として記録する
  （`globalCompleteObservedUnderIncomplete`、`exceedsD1ObservedUnderIncomplete`）
- decisionには修飾field `boundLimitedEvaluations`（bound-limitedだった評価IDの一覧）と `newCandidateAccepted`（受理集合のうちD1の `G_t` と異なるCandidateの件数）を
  必ず付ける
- 通常の非共存（`evaluated` でR5不成立、gate不成立、`preflight_refused`、bound-limited）はmeasuredであり、INVALIDにもINCOMPLETEにもしない
- 判定順は変えない。正常に計測された結果の不一致（parity `mismatched`）は `D2A_INVALID`、測定できなかったための未確認（parity `not_checked`）は該当する軸の
  `INCOMPLETE` であり、未確認を不一致にも一致にも読み替えない。主軸に別のINVALIDや未計測があれば、この表の順序をそのまま適用する
- Z0が未計測でも主軸が他に未計測・INVALIDを持たなければ、主軸は `D2A_GLOBAL_COMPLETE_R` 〜 `D2A_NO_IMPROVEMENT` のいずれかで確定し、Z軸だけが
  `D2A_Z_INCOMPLETE` になる

### 9.3 Z軸のdecision（`seededAxis.case`、主軸と独立）

| decision | 条件 |
| --- | --- |
| （全体が `D2A_INVALID`） | Zも解釈しない（`seededAxis.case = null`）。Z0 / Zのparity `mismatched` もここに入る（§7.3.1） |
| `D2A_Z_INCOMPLETE` | Z0（parity `not_checked`）、Zの登録評価、またはZが依存するDSC / ADM（dropped 7）のいずれかがunmeasured / `not_executed` |
| `D2A_Z_GLOBAL_COMPLETE_R` | Zの最終結果がR6を満たす |
| `D2A_Z_EXTENDS_D1_INCUMBENT` | seedに加えて1件以上を受理した（gateによりcompleted ≥ 22）。追加Target、completed / Conflictの差を併記する |
| `D2A_Z_NO_EXTENSION` | 上のいずれでもない |

Zの結果は「D1のK1 Candidate（t09）を含む既知の最良集合に、K0 Candidateを追加できるか」の診断であり、K0-only policyの評価（主軸）ではない。

## 10. 事前登録条件: RESULT schema（D2-Bで固定する必須field）

D2-Bのanalyzerは `docs/PLANNER_GLOBAL_D2_RESULT.json`（committed）を出力する。raw（`.local`、commitしない）とrun dir（record、G store、start attestation）は
Repositoryへ追加しない。次のfieldは必須で、意味を変えない（追加fieldは可）。

```text
phase                      "Issue #154 D2: K0-first candidate discovery and set evaluation (post-hoc analysis)"
analyzedAt
sources
  specDocument             { file, sha256 }                        本書（measurement HEADのgit object）
  phaseB                   { result, targetsManifest } 各 { file, bytes, sha256 }
  phase2c2Result           { file, sha256 }
  d1                       { result, generatedEntriesUsedBySeed[4] } 各 { file, bytes, sha256 }
  export                   { file, bytes, sha256, committed: false }
  documents                Phase A / Phase B / follow-up / D1-A / D1-B { file, sha256 }
  d2                       { raw, runDir, attestation, records[], generatedEntries[] } 各 { file, bytes, sha256 }
provenance
  formal, measuredHead, analysisHead, measuredHeadIsAncestor, runStatus, benchmarkCodeSha256（calculation code digest）, registeredPolicySha256,
  calculationCodeChangedSinceMeasuredHead: [], productionChangedFiles { toMeasuredHead: [], toAnalysisHead: [] },
  startAttestation { sha256, verified, issues, body },
  phaseBMeasuredHead, d1MeasuredHead,
  oracleReadByRunner: false, oracleReadByChild: false, oracleReadByAnalyzer: false,
  phaseBResultFieldsRead: [allowlist], d1ResultFieldsRead: [allowlist], phaseBResultModified: false, d1ResultModified: false,
  oracleGuidedTargetPopulation: true, inheritsOracleInformedExtentLadder: true, inheritsOracleInformedExecutionEnvelope: true,
  speculativeSupportWrittenAsResolution: false, k1SupportInDiscovery: false,
  seededAxisUsesD1Incumbent: true, seededAxisIncludesK1Candidate: true, productionSemanticsChanged: false
environment                runtime, node, v8, platform, cpu, logicalCpuCount, totalMemoryBytes, rngEngineVersion, calculationContext, appliedExecutionEnvelope, machine
conditions                 population, context: 'K0', ladder, poolCap: 3, discoveryRule（§2.3）, admissionRule（§3）, compositionRule（§4）, gate（§4.2）,
                           selectionOrder（§4.3）, seededAxis（§5）, budgets（§6.3）, order（§7.1）, executionEnvelope（§7.2）, researchMaxPlanSteps,
                           evaluationFullRunCap: 8, r5Definition, r6Definition（§6.4）, supportChecks（Zのみ）, decisionRule（§9、文字列配列）, comparisonBaselines（§9.1）, notRun
inputValidation            { passed, issues[] }
discovery
  units[]                  { unitId, targetWeaponId, label, rung, extent, status（§6.2）, unmeasuredReason, notExecutedReason, process,
                             poolSizeAtStart, poolSizeAtEnd, deliveries[] { indexInUnit, keySha256, cost, action: pooled | duplicate_of_lower_rung },
                             search { deliveredCandidates, excludedCandidates, exhausted, stoppedByExtent, stoppedByConsumer, skippedExcludedRouteKeys },
                             phaseBParity { state: matched | mismatched | not_checked | not_applicable, phaseBUnitId, mismatches[], notChecked, observedPrefixDiagnostic },
                             searchOnlyMs, materializeMs, wallMs, peakHeapBytes, peakRssBytes }
  targets[11]              { targetWeaponId, label, currentBuildListEntryId（O_t）, oTSelectedInB0, discoveryStop: discovery_cap_reached | discovery_exhausted | ladder_exhausted | unmeasured | not_executed,
                             discoveryIncompleteAfterUnmeasured,
                             pool[] { ordinal, unitId, rung, indexInUnit, candidateStableKey, keySha256, cost, routeKind, routeOperationCount,
                                      reservationCheck { respects }, searchIdentity, generatedBuildListEntryId, reusedExisting, generatedEntry { file, sha256 },
                                      replacement { status, replacedBuildListEntryId }, isD1Candidate, d1Parity { state, mismatches[], notChecked } } }
evaluations[]              D1-A §8の `evaluations[]` の全fieldに加えて
                           { stage: B0 | ADM | CMP | Z0 | Z, axis: main | seeded | none, poolOrdinal,
                             rejectedBuildListEntries[] { buildListEntryId, reason }, resourceConflictRejections, selectedTargetWeaponIds[],
                             referenceDiff { referenceEvaluationId, completedDelta, conflictDelta, stepsDelta, targetsGained[], targetsLost[] } | null,
                             gate { judged, referenceCompleted, proposedCompleted, satisfied }, r5OnlyEligible, eligible,
                             r6 { judged, conditions { evaluatedPlanAndTraceReplay, allTargetsCompleted, noUnresolvedConflict, noResourceConflictRejection, r5 }, satisfied },
                             r1r4（ADMのみ）{ R1, R1FailureReason, R2, R3, R4, supportVacuous, targetRegressedR, foundRDiagnostic, winnerBuildListEntryId, conflictCoParticipants[] },
                             d1Parity { state, matchedD1EvaluationIds[], resultDigestsEqual, notChecked } }
parityChecks[]             { checkId, kind: phase_b_k0_prefix | d1_generated_entry | baseline | z0 | determinism_d2 | determinism_d1, axis: main | seeded,
                             state: matched | mismatched | not_checked | not_applicable, subjects[]（unit / 評価ID）, expected, observed, mismatches[],
                             notChecked { dependsOn[] { id, status, unmeasuredReason, notExecutedReason } } | null（not_checked以外はnull）,
                             observedPrefixDiagnostic | null（診断のみ。stateに使わない）, category（mismatched時のinvalid category） }
composition
  main                     { steps[11] { label, acceptedBefore[], evaluatedCandidates[] (evaluationId, ordinal), eligible[], chosen | null,
                                         stepOutcome: accepted | not_replaced_no_admitted | not_replaced_no_eligible | step_unmeasured, acceptedAfter[], afterUnmeasuredStep },
                             finalAccepted[] { label, ordinal, generatedBuildListEntryId, isD1Candidate }, finalResultEvaluationId, finalMetrics { completed, conflicts, steps } }
  seeded                   { z0EvaluationId, seed[], steps[7]（mainと同じ形）, finalAccepted[], finalResultEvaluationId, finalMetrics }
comparison
  vsBaseline               { completedDelta, conflictDelta, stepsDelta }
  vsD1Incumbent            { completedDelta, conflictDelta, stepsDelta, better: boolean, equalMetrics: boolean }
  d1DroppedTargets[7]      { label, poolSize, newCandidatesFound（D1の G_t と異なるunique Candidate数）, admittedCount, newAdmittedCount,
                             mainOutcome, mainAcceptedOrdinal, mainAcceptedIsNew, seededOutcome, seededAcceptedOrdinal, seededAcceptedIsNew,
                             targetsGainedWhenAccepted[], targetsLostWhenAccepted[], winnersObserved[]（診断） }
aggregates
  discovery                { registeredUnitsMax: 33, executed, byStatus, pooledCandidates, newCandidatesVsD1, searchOnlyMs, wallMs }
  evaluations              { executed, measured, unmeasuredByReason, notExecutedByReason, byStage, byStatus }
  fullPlannerRunsStarted   合計（評価リクエスト数とは別）
  runtimeUnsupportedRetries
  r5                       { judged, satisfied, satisfiedByAxis }
  r6                       { judged, satisfied, satisfiedEvaluationIds[] }
  boundLimitedEvaluations[]
  targetRegressedR          ADM評価ごと・Targetごとの件数
  determinismCrossChecks[] { inputDigest, evaluationIds[], d1EvaluationIds[], comparableEvaluationIds[], state, resultDigestsEqual }
  parity                   { byKindAndState, mismatched[], notChecked[]（checkIdと依存先） }
  timing                   { discoveryWallMs, evaluationWallMs, runWallMs, runEnvelopeReached }
  memory                   { peakHeapBytes, peakRssBytes }
invalidReasons[]           { category, detail }
decision                   { case, reasons[], lowerBound: boolean, boundLimitedEvaluations[], newCandidateAccepted,
                             equalsD1IncumbentMetrics, globalCompleteObservedUnderIncomplete, exceedsD1ObservedUnderIncomplete }
seededAxis                 { case, reasons[], lowerBound: boolean, z0ParityState, addedTargets[], finalMetrics }
```

## 11. 事前登録条件: 言えること・言えないこと

### 11.1 decisionごと

- `D2A_GLOBAL_COMPLETE_R`: このExport・E1 11 Target・K0のみ・登録ladder・Research envelopeで、K0先行の候補探索と単調な集合評価により、43 / 43、Conflict 0、
  `resource_conflict` 0、Trace Replay成功のPlanに到達した。Production runtimeとしての許容（計算時間・memory・Browser Worker）、別Export・別populationへの一般化、
  Production semanticsとしての妥当性（REQUIREMENTS 23の契約変更が先）は言えない
- `D2A_EXCEEDS_D1_INCUMBENT`: K0-onlyのpolicyで、D1 incumbent（K1のt09を含む）より良い完成・Conflictの集合を得た。R6には達していない
- `D2A_IMPROVED_OVER_BASELINE`: baselineより改善したが、D1 incumbentを超えていない。D1と同値でも、構成Candidateが異なる場合は `newCandidateAccepted` で区別する
- `D2A_NO_IMPROVEMENT`: **K0候補で改善できないことの証明ではない**。言えるのは「登録した手順（Targetあたり3件以下のK0 Candidate、R1 admission、単一pass・Target ID昇順の
  単調合成、非後退gate）で評価した集合のうち、baselineより良いものを受理しなかった」ことだけである。未評価のCandidate（4件目以降のK0 Candidate、K1 / K2 context、
  他のextent）、未評価の組合せ（別の合成順、複数pass、同時置換）、別Exportで改善できないことは言えない
- `D2A_INCOMPLETE`: measuredな範囲の結果は下限であり、「unmeasuredが無ければ同じ結果だった」とは主張しない（unmeasuredな評価が受理されていれば後続の合成が変わる）

### 11.2 共通

- 結果が改善しなかった場合も、**未評価のCandidateが存在しないとは主張しない**
- R5成立は、置換集合としての共存（`G` とその前提supportの同時selected、集合内Conflictなし）だけを示し、集合外Targetの完成やConflict 0を示さない
- admission（R1）とGlobal採用（R5 + gate）を混同しない。admittedであることは採用の証拠ではない
- `found_R` / R3 / R4 / `target_regressed_R`（`evaluatedAgainst = baseline`）は診断であり、Global共存の証拠にも非共存の証拠にもしない
- Zの結果を主軸のK0-only policyの成果として報告しない。Zはt09のK1 Candidateを含む
- I-D2-2（2件目・3件目が同じ勝者に負けるかもしれない）は予想であり、結果がそうなってもならなくても、K0一般やK1の有効性へ一般化しない

## 12. 既存API（D2-Bで使う部品。Production変更なし）

| 用途 | 既存の部品（module） |
| --- | --- |
| baseline PlannerInputとResearch依存（固定ID Factory、定数Clock） | `globalResearchInputFromExport(Export, 20000)` / `globalResearchDependencies(engine)`（`src/benchmarks/plannerGlobalOptimizationResearch.ts`） |
| population manifest | `parsePhase2C27BTargetManifest()`（`plannerGlobalPhase2C27B.ts`） |
| K0 contextの準備（origin、reservation、`excludedRouteKeys`） | `derivePhase2C26B2C1Schedule()`（`plannerGlobalPhase2C26B2C1.ts`）+ `phase2c27bResolveSupportContext(input, dependencies, targetWeaponId, [])`（Phase BのK0と同じ経路。support Entryは空） |
| Search | `visitPlannerAlternativeCandidates()`（`src/domain/search/alternative/plannerAlternativeSearch.ts`）。capture policy・instrumentationは渡さない |
| Candidate identity | `candidateStableKey()`、`createPlannerAlternativeSearchIdentity()` |
| materialization | `createPlannerAlternativeMaterializer({ ...searchInput, clock })`（`src/domain/planner/alternative/plannerAlternativeMaterializer.ts`） |
| R0 reservation check | `summarizePhase2C2Entry()` / `respectsPhase2C2Reservation()`（`plannerGlobalPhase2C2.ts`、Phase Bと同じ） |
| replacement / preflight | `resolveBuildListEntryReplacement()`、`preparePlannerInitialContext()`、`createPlannerConflictContexts()`、`preparePlannerReplacementConflictPreflight()` |
| full run | `createPlannerAlternativeFullRunner()` + `createPlannerAlternativeFullRunBudget()` と同じ形のResearch budget（limit 8）。内部は `createProductionPlanWithObserver()` + Trace Replay |
| 診断の `found_R` | `judgePlannerAlternativeTrial()`（explicit decision = fixed Route = support = `[]`） |
| support依存（Zのt09） | `derivePlannerAlternativeReservation()`（S5） |
| D1の評価部品（import only、変更しない） | `runD1Evaluation()`、`judgeD1R5()`、`d1InputDigest()`、`d1ResultDigest()`、`d1B0Parity()`、`d1TrialRunSummary()`、`d1RuntimeUnsupportedRemoved()`、`isD1BoundLimited()`（`plannerGlobalD1.ts`）。D2で必要な追加記録（`rejectedBuildListEntries` 等）はD2のmoduleで同じ `PlannerResult` から読む |
| hash | `hashStableValue()`、`stableStringify()` |

- 実装名の推奨（D2-Bで変えてよい）: `src/benchmarks/plannerGlobalD2.ts`、`src/benchmarks/plannerGlobalD2Analysis.ts`、`scripts/run-planner-global-d2.mjs`、
  `scripts/analyze-planner-global-d2.mjs`
- 既存部品で本書の規則を表現できないことが分かった場合は、別の判定を発明せず、本書の更新（docs）を先に行う

## 13. 未決事項（D2の外、またはD2-B以降）

D2-Aの判定に必要な意味論は本書で確定した。次はD2-Aの外の事項である。

### 13.1 一覧

1. D2-Bの実装名（module / script / field綴り）。§10の必須fieldの意味と§9の判定順序は変えない
2. D2の結果を受けた限定K1探索（C2）の登録: support候補の導出規則と上限（§13.2）。D2-Bの結果（主軸で受理されなかったTargetと、そのADM / CMP評価で観測した阻害Entry）を
   見てから別途事前登録する
3. 合成の複数pass（不受理Targetを後の受理後に再評価する）、合成順序の変更、同時置換の探索。今回は単一pass・Target ID昇順に固定した
4. `POOL_CAP` の拡大（4件目以降のK0 Candidate）。D2で1件目より後のK0 deliveryのcostが計測されてから判断する
5. population拡大（baseline未完成23 Target、43全体）、E2（K2 context breadth）、residual 3（alternative-to-alternative support）
6. execution envelopeの変更（concurrency、上限時間）。変える場合は別axisとして事前登録する
7. Phase 0 projected-state方式（42 / 43）との比較（follow-up X4 / X5）
8. Production化に伴うREQUIREMENTS 23の契約変更の要否（follow-up §10）

### 13.2 将来のC2（限定K1探索）の設計候補（今回は無効）

§1.1の事実から、次の設計候補を記録する。**いずれもD2-Aの実行条件ではなく、D2-BのSearch入力へ混入させない**。

| 項目 | 設計候補 | 注意 |
| --- | --- | --- |
| 阻害Entryの抽出規則 | `G_t` がselectedでなかった評価runについて、(a) `routeCommitment` のprovisional outcome勝者（`provisionalOutcome.selectedBuildListEntryId`）、(b) `G_t` をparticipantに含むConflictの他participant。(a)を優先し、(b)はConflict kindと出現回数を併記する | 勝者はPlanner出力なのでoracle-free。D1ではdropped 7の勝者は4種類（`e396d352` ×3 Target、`92d87b90` ×2、`61066e62`、`85dc00cc`） |
| 重複排除 | Entry ID単位。同じEntryが複数評価で勝者なら1件にまとめ、観測回数を記録する | |
| baselineでのselected状態 | 候補EntryのB0でのselectedを記録する。D1の勝者4件はすべてB0 selectedだった | follow-up §5.2: B0非selectedを理由にcontextをcloseしない。優先順位づけにだけ使う |
| Targetごとのsupport候補上限 | (a)の勝者を最大2件（観測回数降順、Entry ID昇順）。K1 context（support 1件）だけ。K2は別登録 | Phase BのK1全件走査（42 context × rung）を繰り返さない |
| reservationの再導出 | support Entryの現在Routeから `derivePlannerAlternativeReservation([support])` で導出し、digestを記録する。support EntryのOwnedWeaponはexclusiveになる（t05 / t06の `same_owned_weapon_consumed` の回避に関係し得る） | |
| support失効 | follow-up §5.2 / D1-A §4.5と同じ（supportのTargetが置換された、Entryが評価集合から外れた → `support_expired_R`、R5偽）。失効したCandidateを別support上の結果として読み替えない | |
| alternative-to-alternative依存・循環 | 阻害Entryが集合内の他Targetの `G` である場合はC2の最初の登録では対象外とする（依存がDAG化し、失効の伝播と循環防止規則が先に必要）。D1ではdropped 7のConflict participantに他の `G`（t00 / t02 / t03 / t10の相互）が現れている | 9.2.19.10と同種の循環防止を別途定義する |

## 14. follow-up §9.2 / D1-Aからの変更・追加点

| # | 元の案 | 本書で正式に採用する条件 | 理由 |
| --- | --- | --- | --- |
| 1 | follow-up §9.2「Targetあたり候補上限」 | `POOL_CAP = 3`（unique、rung跨ぎ）。unitごとのdelivery上限と上位rungへ進む条件を§2.3で固定 | 停止規則を決定的にするため |
| 2 | follow-up §6.1の段階4「集合評価」 | 単一pass・Target ID昇順の単調合成。各Targetでadmitted全件を評価し、eligibleから選択順で1件を受理 | 試行順と選択基準を実装者の裁量にしないため。D1 A-cと同じ形に、同一TargetのCandidate比較を加えた |
| 3 | R5だけで受理（D1 A-c） | R5 + 非後退gate（completed ≥ reference） | R5は集合外Targetの完成を要求しないため。D1のA-c受理列は全段でgateを満たしている |
| 4 | D1-A §5.2 SのR1（`plan !== null`） | R1に `termination.status ∈ { completed, exhausted }` と `reusedExisting === false` を含める | bound-truncatedなpartial Planを、集合評価の候補と同じ基準で除くため（R5(5)と揃える） |
| 5 | D1 incumbentの扱い未定 | 読み取り専用の比較基準（§9.1）と、独立した評価軸Z（§5）に分ける | K0-onlyの主軸にK1 Candidateを黙って混入させないため |
| 6 | 記載なし | Phase B K0 prefix parity・D1 parity（§7.3） | D2の発見がPhase B / D1と同じSearch・materializationの上にあることを確認するため |
| 7 | 記載なし | run全体のwall上限12時間（§7.2） | 74時間級のrunを繰り返さないため。上限到達は `not_executed` = INCOMPLETE |
| 8 | R6の定義のみ | R6をRESULT fieldと主軸decisionの最上位成功条件にする（§6.4、§9.2） | Issue #154のacceptanceと、R5成立・改善を区別するため |

## 15. guardrail（follow-up G13〜G18、D1-A G19〜G22に追加）

| ID | guardrail |
| --- | --- |
| G23 | D2のdiscoveryはK0だけで行う。K1 / K2 support Entry、D1 / Phase BのK1 Candidate（t09）を主軸のSearch入力・pool・合成に入れない。t09のK1 CandidateはZ軸のseedとしてだけ使う |
| G24 | D2のG store（discoveryが書いたBuildListEntry body）はResearch evidenceであり、Build List、Persistence、Production入力、他PhaseのCandidate poolへ書かない |
| G25 | admission（R1）とGlobal採用（R5 + gate）を混同しない。ADM（`evaluatedAgainst = baseline`）の結果をR5・受理・decisionに流用しない |
| G26 | `found_R` / R3 / `target_regressed_R` / 勝者情報を理由にCandidateをpool・admissionから除外しない（G14の具体化） |
| G27 | Zの結果を主軸のdecisionに使わない。D1 incumbentを主軸の初期集合にしない |
| G28 | Phase B / D1のRESULT・module・recordを変更しない。D2の結果をPhase B / D1のdecision inputへ戻さない |

Issue #154はCloseしない。

## 16. validation

- `git diff --check`
- `npm run check:nul`、`npm run lint`、`npm test`、`npm run build`（docs-onlyのため挙動変化は無い。結果はPRに記載）
