# Global Planner Research Phase 2-C2（Conflict orientationからのCandidate portfolio）

Refs #154。Researchであり、global assignment・Global Planner本実装・Production仕様変更はしていない。

## 結論（Case C）

**元ExportのConflict 21件から作った54 orientationのうち、現行Production Planner Alternative kernel（default extent N4 / G235 / S4、
trial 2 / rerun 8）が完走したのは11件だけで、43件はPlanner Alternative Searchが8 GB heapを使い切ってOOMで停止した。
完走したcontextではTargetあたり最大8件のIdeal Candidateが得られ、source / Counter位置 / held Routeの多様性も観測できたが、
portfolioが2件以上になったConflict participantは34 Target中12 Target（35%）に留まり、1,657 oracleのRouteは43件中0件しか
portfolioに含まれなかった。**

- baseline（元ExportのBuild ListにそのままProduction Planner）: planning Target 43、completed 20/43、Conflict 21
  （same_gogma_counter 15 / same_skill_counter 3 / same_owned_weapon_consumed 2 / same_normal_counter 1）、Plan 1,465 steps。
  Phase 2-C1のoriginal baselineとplan steps・completed・termination・kind別件数・Target単位Conflict signature 21件・selected Targetが全て一致。
- orientation 54（2 participant 16件 ×2 + 3 participant 4件 ×3 + 10 participant 1件 ×10、§5）。kernel完走 **11 / 54**、**OOM 43 / 54**
  （Gogma 27/33、Skill 13/15、owned weapon 3/4、Normal 0/2）。timeout・その他のprocess failureは0件。
- 完走kernelのTarget outcome（27件）: **found 5**、stopped_by_candidate_trial_bound 2、**stopped_by_search_extent_bound 20**、
  not_found_within_search_extent 0、stopped_by_planner_rerun_bound 0、blocked_by_selected_checkpoint 0。trial rejectedは10件で全件
  `explicit_decision_not_selected`。
- default extentのportfolio Search context 27件: consumer stop（8件到達）7、stoppedByExtent 20、exhausted 0。delivered 62件。
  Research probe 70 context: consumer stop 9、stoppedByExtent 61、exhausted 0、delivered 92件。Normal 40のprobe 2件がOOM。
- portfolio: 43 Target、unique Candidate 132（original 43 + alternative 89）。size分布 {1: 31, 2: 1, 9: 11}。
  **portfolio > 1: 12 Target（全員Conflict participant）**、source alternative 9、Counter位置alternative 11、held Routeを持つTarget 10
  （held alternative 52件、default extent内29件 / 5 Target、probeでのみ得たもの23件）。probeで新たに得たalternativeは38件。
- **Conflict participant 34のうち19 Targetは、自分が非fixed側となる全orientationのkernelがOOMしたため一度も探索されていない。**
  探索された15 participantでは12 Target（80%）でportfolio > 1。
- **1,657 oracle coverage: exact 0 / partial comparable 0 / not comparable 0 / uncovered 43**。originalだけでcoverage 0、
  C2 alternativeで追加coverage 0。1,657のRouteは43件中42件でGogma stream originより後から始まる1〜3操作のRoute
  （他Routeの被覆に乗る共有coverage Route）で、1 Entryだけをfixedとするreservationでは生成条件を満たさない（§12）。

判定規則（§14、結果を見る前に固定）により **Case C**: 現行Planner Alternative Searchのままではportfolio自体がほとんど増えない。
主因は (1) default extentでのSearchのメモリ増加（OOM 43/54）と、(2) 1つのConflict decisionだけをreservationに反映する
context生成では、1,657が使う「他Route全体の被覆に乗るRoute」を表現できないこと、の2点である。global assignment（C3）より前に、
Search frontierのメモリ特性とportfolio用context（reservation）生成を再設計する必要がある。

## 1. 目的

Global assignmentを始める前に、現在のgeneric Planner Alternative machineryだけで、各Targetに選択肢として使える複数の
Ideal Routeをどこまで作れるかを証拠付きで明らかにする。global assignment・組合せ探索・oracle-guided選択は行わない。

## 2. authority

- `docs/REQUIREMENTS.md`、`docs/SEARCH_SPEC.md` 5.6.3（canonical Ideal）/ 5.6.4（後続Counter位置）/ 5.6.8（Planner Alternative Search）、
  `docs/PLANNER_SPEC.md` 9.2.19（Planner Alternative: reservation 9.2.19.3、trial 9.2.19.6、bounds 9.2.19.12、outcome 9.2.19.13）。
- Phase 2-B / 2-C1文書と `PLANNER_GLOBAL_PHASE2C1_RESULT.json`。
- 実装: `plannerAlternativeSearch.ts` / `plannerAlternativeTypes.ts`（`visitPlannerAlternativeCandidates()`、`defaultPlannerAlternativeSearchExtent`）、
  `plannerAlternativeKernel.ts` / `plannerAlternativeReservation.ts` / `plannerAlternativeMaterializer.ts` / `plannerAlternativeTrial.ts`
  （`derivePlannerAlternativeReservation()`、`defaultPlannerAlternativeTrialBounds`）。
- 確認した契約: Searchはcanonical Idealで止まらず6キー順にIdeal Candidateを順次返す。held / blocked / exclusive OwnedWeaponは
  Plannerがfixed Route setから導出し、SearchはPlanner Conflict semanticsを再実装しない。Search CandidateはIdealとreservationを満たす
  semantic resultで、実行可能性のauthorityはfull Planner（kernelのtrial）である。Production default: extent `{ N 4, G 235, S 4 }`、
  bounds `{ trials 2, reruns 8 }`。

## 3. 変更境界

- **Production behavior変更なし**（Production sourceの変更0件）: Planner / Planner Alternative Search / kernel / Candidate ordering /
  reservation / trial judgement / RNG、Worker protocol、schema・version（CalculationContext 17、DB 10、Export 13、`production-rng:c5-e7`）、
  default値、UI、Persistence、Export。既存Domain APIをそのまま呼ぶResearch harnessのみ。
- 追加ファイル:

| 役割 | ファイル |
| --- | --- |
| orientation生成・kernel実行・post-hoc portfolio Search・Route要約・portfolio / diversity・probe判定・child終了分類 | `src/benchmarks/plannerGlobalPhase2C2.ts` |
| C1 parity・1,657 coverage・Case判定（evidenceは引数） | `src/benchmarks/plannerGlobalPhase2C2Analysis.ts` |
| テスト | `src/benchmarks/plannerGlobalPhase2C2.test.ts` |
| Node runner（child process分離）/ post-hoc analyzer | `scripts/run-planner-global-phase2c2.mjs` / `scripts/analyze-planner-global-phase2c2.mjs` |

- 計算側（module / runner）はoracle・lower bound・Phase 2-C1 evidenceを読まない。analyzerだけが `--c1` / `--optimum` を全run終了後に読む。

## 4. baseline

元ExportのBuild List（43 Entry、`conflictResolutions = []`）に通常Production Planner（`createProductionPlan()`、Research `maxPlanSteps` 20,000、
Phase 2-C1と同一）を1回実行し、そのresultをauthorityとした。数値はalgorithmに入れず、run自身が導出した。

| 項目 | C2 baseline | Phase 2-C1 original baseline | 一致 |
| --- | --- | --- | --- |
| planning Target / completed | 43 / 20 | 20 | ✓ |
| termination | exhausted | exhausted | ✓ |
| Conflict | 21（G 15 / S 3 / owned 2 / N 1） | 同 | ✓ |
| Target単位Conflict signature | 21 | 21 | ✓（完全一致） |
| selected Target | 20 | 20 | ✓（完全一致） |
| Plan steps | 1,465 | 1,465 | ✓ |

C1 evidenceとの比較はanalyzerだけが行い、計算はC1 JSONを入力にしていない。

## 5. Conflict orientation生成規則

- baseline resultの `conflicts` を返された順に読み、各Conflictの `buildListEntryIds` の各participantをそれぞれfixed winnerとする
  orientationを作る（N participant → N orientation、id `c<conflict>-p<participant>`）。Target ID / Entry ID / Counter位置はhard-codeしない。
- kernel requestは `decision = { conflictKey: conflict.id, selectedBuildListEntryId: participant }`、`priorFixedBuildListEntryIds = []`、
  `priorExcludedRoutes = []`、extent / boundsはProduction定数のspread copy、`plannerInput` は元Exportの入力そのもの。
- participant数: 2 participant 16件、3 participant 4件、10 participant 1件（Skill 341、Phase 2-C1で観測した集中） → **54 orientation**。
  kernelの非fixed Targetがbaseline Conflictの他participantと一致することをrunごとにassertした（54件中完走11件で全て一致）。

## 6. kernel観測

各orientationを新しいNode process（heap上限8 GB）で実行した。kernelが失敗しても他のrecordを失わないよう、kernel、post-hoc Search、
probeは別processである。

| Conflict kind | orientation | kernel完走 | OOM |
| --- | ---: | ---: | ---: |
| same_gogma_counter | 33 | 6 | 27 |
| same_skill_counter | 15 | 2 | 13 |
| same_owned_weapon_consumed | 4 | 1 | 3 |
| same_normal_counter | 2 | 2 | 0 |
| **計** | **54** | **11** | **43** |

- OOMは開始後50〜141秒（中央値約110秒）、V8 `Ineffective mark-compacts near heap limit`。smoke診断（非formal）では、OOMの発生箇所は
  kernel内のPlanner Alternative Search（最初のCandidateが届く前）で、Gogma held-aware streamの深さとともにheapが増え続けた。
  同じcontextをheap 24 GBで実行してもGogma深さ約169（extent 235）でOOMし、Candidateは1件も届かなかった（非formal診断、
  commitしていないscratch scriptによる。formal evidenceはheap 8 GBのrunのみ）。すなわちOOMはheap上限の問題ではなく、
  default extentでのSearch frontierのメモリ増加である。Browser Workerのheap上限は通常これより小さいが、Browser Workerでの挙動は未測定。
- 完走kernel 11件のTarget outcome（計27件）:

| outcome | 件数 | 内容 |
| --- | ---: | --- |
| found | 5 | a26f6bcf（owned weapon）、1d916ff0 / cbdf9d8f / 9733b090 / a6c17e25（Gogma）。全て1件目のtrialでfound、`generatedSelected = true`。うちheld Route 2件（a26f6bcf: G79–153の2操作、a6c17e25: G116–161の2操作） |
| stopped_by_candidate_trial_bound | 2 | 820831d0（10 participant Skill Conflictの2 orientation）。2 trialとも `explicit_decision_not_selected` |
| stopped_by_search_extent_bound | 20 | Normal Conflict 2（711f7d15 / 813fb479: N4で0件）、Gogma Conflict（チャアク2件）2（G235で0件）、10 participant Skill Conflict 16（S4で多くが0件） |
| その他 | 0 | not_found_within_search_extent / planner_rerun_bound / blocked_by_selected_checkpoint はいずれも0 |

- found trialのPlan（1 replacementだけのtrial run）は completed 19〜22 / 43、Conflict 20〜21。kernelのfoundは「そのfixed Route setと
  共存する」判定であり、Plan全体のConflict解消ではない（仕様どおり）。
- planner rerun使用: found系1回、10 participant Skill Conflictで5回、Search-only停止で0回。rerun bound 8には達していない。
- 完走kernelのpeak sampled heap 1.2〜6.0 GB。

## 7. portfolio Search

kernel完走後、各searched Targetについて別processで、kernelと同じPlanner-start origin（kernel自身のpreparation）・reservation
（記録したfixed Route setから `derivePlannerAlternativeReservation()` で再導出し、kernelの記録と一致することをassert）・excluded Route keys
（kernelの記録）で `visitPlannerAlternativeCandidates()` をpost-hocに実行し、consumer stopで最大 **8件**（Research専用capture bound、
Production defaultではない）を記録した。kernelへはフィードバックしない。

- default extent context 27件: consumer stop 7 / stoppedByExtent 20 / exhausted 0。delivered分布 {0: 16, 1: 2, 2: 2, 8: 7}、計62件。
- kernelがtrialしたCandidate keyは、27件全てでpost-hoc Searchの先頭delivered keyと一致（`kernelTrialPrefixMatches = true` 27/27）。
- delivered Candidateは全て、そのcontextのreservationのblocked位置にown unitを置かず、exclusive OwnedWeaponを使わない（違反0件）。
  これはSearch契約の観測で、Planner conflict判定の再実装ではない。
- 各Candidateは `search_delivered` / `kernel_found` / `kernel_trial_rejected` を区別して記録した。Search-onlyのCandidateを実行可能とは扱わない。

## 8. portfolio diversity

portfolio = original Candidate + 全contextのalternative、`candidateStableKey()` でTarget内dedup（Candidate ID / run ID / ordinalは使わない）、
観測contextはprovenanceとして全件保持、originalは削除しない。

| 項目 | 値 |
| --- | ---: |
| Target | 43（Conflict participant 34） |
| unique Candidate | 132（original 43 + alternative 89） |
| delivered Candidate総数（重複込み） | 154（default 62 + probe 92） |
| portfolio size分布 | 1: 31、2: 1、9: 11 |
| portfolio > 1 | **12**（全員participant） |
| source alternativeを持つparticipant | 9 |
| Counter位置（required Normal / Skill / Gogma）alternativeを持つparticipant | 11 |
| held Routeを持つparticipant | 10 |
| reservationを満たすalternativeを持つparticipant | 12 |
| kernel foundのCandidate | 5 |
| 一度も探索されていないparticipant（kernel OOM） | **19** |

default extentの先頭k件だけで作ったportfolio（同一runのprefix）:

| k | portfolio > 1のparticipant | participant Candidate合計 | held Route |
| ---: | ---: | ---: | ---: |
| 1 | 8 | 42 | 2 |
| 2 | 8 | 49 | 4 |
| 4 | 8 | 61 | 12 |
| 8 | 8 | 85 | 29 |

default extentだけでもCandidateが得られるcontextでは、kを増やすとheld Routeや別Counter位置の選択肢が増える。一方、
portfolio > 1のTarget数はk = 1で頭打ちで、増えない理由は「探索できたcontextの数」（kernel OOM）と「default extentで0件」の2つである。

観測された多様性の例（Target IDは観測結果）:

- 1d916ff0（所持 → 新規Normal N6、conversion S341〜345、held Route 3）、cbdf9d8f / a26f6bcf（別の所持武器）、2378d3e0 / 45b13c06
  （新規Normal → 所持4〜5武器）、711f7d15（新規Normal位置 N0〜3、conversion位置 S342〜399）、a830a376（conversion位置9通り）。
- 多くのalternativeはfixed Routeの被覆位置の直後（G56、G72、G74、G75、G79、G116）から始まり、fixed Routeの被覆を使って
  短くなるもの（a26f6bcf: 99操作 → 2操作、a6c17e25: 90 → 2）と、originalより長くなるもの（45b13c06: 196 → 222、711f7d15: 267 → 236〜237）がある。

## 9. held Route

held Routeは、RouteのGogmaまたはSkillのown unit位置が連続しないもの（Phase 2-B `crossesHeldPositions` と同じ定義）として、
Planner Route unit（`createPlannerRouteUnitPlans()`）のabsolute位置とown operation数から機械的に判定した（生成元では判定しない）。

| 項目 | 値 |
| --- | ---: |
| held alternativeを持つTarget | 10 |
| held alternative Candidate | 52 |
| うちdefault extentで得たもの | 29（5 Target） |
| probeでのみ得たもの | 23 |
| originalのheld Route | 0 |
| 1,657のheld Route | 18（C2 portfolioでのcoverage 0） |

## 10. Production default extentの結果

Production default（N4 / G235 / S4、trial 2 / rerun 8）で得られたのは、kernel完走11 orientationのsearched Target 27 contextだけである。
default extentのみのportfolioで > 1 となったparticipantは8 Target。default extentでは:

- 54 orientation中43件がSearchのメモリで停止し、そのparticipantは「代替がない」のではなく **未確認**。
- 完走context 27件のうち20件がstoppedByExtent（exhausted 0）。Normal Conflict（N4）、チャアク2件のGogma Conflict（G235）、
  10 participant Skill Conflict（S4）ではdefault extentで0件だった。これも「代替がない」ではなく、current Production extentの範囲外が
  未確認のまま残ったという記録である。

## 11. extent probe

既存benchmark grid `BENCHMARK_ONLY_EXTENT_GRID`（Normal 1 / 4 / 16 / 40 / 80、Gogma 30 / 60 / 120 / 180 / 220 / 235 / 240 / 300 / 350、
Skill 1 / 2 / 4 / 8 / 16 / 32 / 64）をauthorityとし、Conflict kindの軸だけを1段ずつ上げた（`same_owned_weapon_consumed` はdefaultのみ）。
対象はstoppedByExtentでdelivered < 8のcontextだけ。consumer stop（8件）・exhaustedは拡張しない。probeはSearchのみでkernel trialはしない。
失敗したcontextはそこで拡張を止める。

| probe log | 件数 |
| --- | ---: |
| 実行完了 | 70 |
| OOM | 2（Normal 40、711f7d15 / 813fb479） |
| skip: 8件到達 | 16 |
| skip: grid上限到達 | 9 |
| probe total budget（90分）で未実行 | 0 |

- Normal Conflict（チャアクN206）: N16でも0件、N40はOOM → Normal軸では未確認のまま。
- チャアク2件のGogma Conflict: G240 / 300 / 350でも0件（grid上限）。
- 10 participant Skill Conflict: S8 / 16 / 32 / 64と段階的に増え、8d233d8bはS32、2378d3e0 / 45b13c06 / 711f7d15 / a830a376はS64で8件到達。
  02876df4 / 6c65c924 / 813fb479 はS64でも0件、57126a5eは1件のまま。
- probeで新たに得たalternativeは38件（うちheld 23件）。
- probe peak sampled heap: G350で約5.4 GB、N16で約6.6 GB。

## 12. oracle post-hoc coverage

全run終了後、analyzerだけが `docs/PLANNER_GLOBAL_1657_ORACLE_RESULT.json` を引数で読み、1,657 PlanのTarget Routeがportfolioに含まれるかを
比較した（C2計算はoracle / manifestを読んでいない）。

比較field: RouteKind、source kind / OwnedWeapon、新規Normal production target位置、conversion位置、own operation数、Normal / Gogma / Skill
各streamのfirst / last / operations / required、final Bonus（順序つき5枠）・scope、final Series / Group Skill、estimated operations / advances。
oracle evidenceの `gogmaUsage`（Target別の全Gogma unit位置と種別）が揃う場合はGogma unitを完全比較し、Skill / Normalは位置が
first / last / operations / requiredから一意に決まる場合のみ完全比較した。全fieldが一致し全位置が決まれば exact、全fieldは一致するが
一部の位置がevidenceから決まらなければ partial comparable、oracle側にfieldがなければ not comparable（推測で補完しない）。

| 区分 | 件数 |
| --- | ---: |
| exact | **0**（originalで0、alternativeで0） |
| partial comparable | 0 |
| not comparable | 0 |
| uncovered | **43** |
| 1,657のheld Route 18件のcoverage | 0 |

不一致の内訳（各Targetで最も近いCandidateとの差分field、延べ）: gogma first 42、gogma operations 42、own operation数 42、estimated operations 42、
estimated advances 23、gogma last 17、gogma required 17、final Bonus 16、skill first 13、skill operations 12 など。

1,657のRouteは43件中42件でGogma stream origin（55）より後から始まり、多くは1〜3操作（例: 0d98b225はG201のKeep 1回、02876df4は
N7〜11 + S363 + G173の7操作）。これは「originから自Route開始位置まで、他のRoute群がstreamを被覆する」ことを前提にしたRouteで、
Planner Alternative Searchでは開始位置より前の全位置がheldでなければ生成できない。C2のcontextはreservationが1つのfixed winner
（1 Entry）だけなので、held位置はそのRouteの被覆範囲に限られ、1,657のRouteを生成する条件（複数Routeの被覆の合成）を満たさない。
C2で観測した「fixed Routeの被覆直後から始まる短いRoute」（a26f6bcf 2操作、a6c17e25 2操作）はその小さな一例である。

## 13. 未確認事項

- kernel OOM 43 orientationの非fixed側19 participantの代替: 未探索（「代替なし」ではない）。
- default extentでstoppedByExtentだったcontextの範囲外、Normal 40 / 80、Gogma 350超、Skill 64超。
- Browser Worker / スマートフォンでの時間・memory（本Phaseの全測定はNode、heap上限8 GB）。24 GB heapの診断は非formal。
- 複数Conflict decisionを同時に反映したreservation、Plan全体の被覆をheldとするcontextでのportfolio。
- portfolioの組合せでの共存可能性（C3の範囲）。別Export・別武器種。
- 既存のreference-verified / game-verified / unverifiedの境界は拡張しない。

## 14. C3へ進む条件

判定規則（analyzerに固定、結果に合わせて調整しない）:

- **C**: Conflict participantのうちportfolio > 1が半数未満
- **A**: 半数以上、かつ1,657の全Routeがcoverage（exact またはpartial comparable）
- **B**: 半数以上だが、1,657のRouteに未coverageがある

結果: participant 34中12（35%）、oracle coverage 0 / 43 → **Case C**。

C3（global assignment）へ進む前に必要と考えられるもの（次に検証する仮説であり、本Phaseで効果は示していない）:

1. **Planner Alternative Search frontierのメモリ特性**: default extent（G235）で43 / 54 orientationがOOMし、24 GB heapでも完走しない
   context がある。Gogma held-aware streamのfrontier / 公開状態の保持量を測定・再設計し、Production default extentで完走できることを先に確認する
   （これはProductionの「比較する」「この候補を優先」にも関わる観測で、Browser Workerでの再現確認が必要）。
2. **portfolio用context（reservation）生成**: 1 Conflict decision = 1 fixed winnerのreservationでは、1,657が使う「複数Routeの被覆に乗るRoute」を
   生成できない。Plan全体（または部分集合）の被覆をheldとするcontextを、Planner authority（`derivePlannerAlternativeReservation()`）で
   導出してSearchに渡すportfolio生成が候補になる。
3. 上記2点で、Conflict participantの大半にportfolio > 1が得られ、1,657のRouteがportfolioに入るかを再測定してからC3へ進む。

## 15. 測定環境・provenance

| 項目 | 値 |
| --- | --- |
| 開始時 | branch `main`、`main` = `origin/main` = `8e9e591c`（PR #168 merge済み）、Working Tree clean、Issue #154 Open |
| 作業branch | `research/global-planner-phase2c2-portfolio` |
| **measured HEAD** | `3db8197fa5b256de080b810985f333c44a524ccb`（Research codeをcommit後、clean HEADで測定。runnerは未commit codeを拒否） |
| benchmark code SHA-256 | `0002540835f59b4d1c170ff643d18a011e7b46b4a91a8318dbe3f1935dc034b8` |
| 測定後のcommit | analyzer（post-hoc、次項）・文書・証跡のみ。計算側（module / runner）は変更していない |
| 実施 | 2026-09-28 21:25〜22:00 JST（wall 2,097秒） |
| runtime | Node v24.19.0（Vite SSR loader、1 task = 1 child process、Browser Workerではない）、child heap上限 8,192 MB、concurrency 3、yield `setImmediate` |
| budget | kernel / baseline 30分、portfolio / probe 10分、probe合計90分（timeoutは0件） |
| OS / CPU / memory | Windows 10.0.26200 x64 / AMD Ryzen 7 9700X（16 logical）/ 33,377,591,296 bytes |
| Export | `gogma-artian-planner-backup_20260927015837.json`、19,424,064 bytes、SHA-256 `cc35fb5b…e1e6b`（計測値。commitしない） |
| RNG Engine / Calculation schema | `production-rng:c5-e7` / 17、Research `maxPlanSteps` 20,000 |

- 測定済みrunnerはraw recordの `defaultContexts[].process` を未設定のまま書いた（変数参照の誤り）。計算結果には影響せず、同じchild情報は
  `processes` にidで記録されているため、analyzerがidから復元する（analyzerの変更は測定後、post-hocのみ）。

## 16. テスト・検証

`src/benchmarks/plannerGlobalPhase2C2.test.ts`（15件）: orientationをConflictからID hard-codeなしで全生成（N participant → N）、kernel requestが
Conflict key / participantから構築されprior fixed / exclusionなし・Production defaultのspread copy、kernelとpost-hoc Searchが同一の
origin / reservation / excluded keys / extentで呼ばれる（Search入力を捕捉して比較）、reservationを再導出しkernel記録との不一致を拒否、
first 8のconsumer stop、exhausted / stoppedByExtent / consumer stopの区別、`candidateStableKey` dedupとprovenance保持、original保持、
held Routeがunit位置から導出、Search-deliveredとkernel-foundの区別、probeがConflict kindの軸だけを段階拡張、timeout / OOMをno-matchにしない、
C1 parity比較、oracle coverageの4区分、isolation（計算側はoracle / C1 evidenceを読まない、analyzerだけが引数で読む）、
ProductionからC2へ到達しない、Production default / schema / version不変。

| 確認 | 結果 |
| --- | --- |
| `npm run lint` | passed |
| `npx tsc -b --force` | passed |
| `npm test` | 307 files / 4,889 tests passed |
| `npm run build` | passed（既存の500 kB超chunk warningのみ）。`dist` にPhase 2-C2識別子なし |
| `git diff --check` | passed |

## 17. 証跡

- [PLANNER_GLOBAL_PHASE2C2_RESULT.json](PLANNER_GLOBAL_PHASE2C2_RESULT.json): provenance、baseline、C1 parity、Conflict / orientation一覧、
  kernel結果（reservationはrange圧縮、Route keyはSHA-256）、Search実行summary、default / probe context、Target portfolio（Candidate要約・provenance）、
  diversity、held Route、extent / bound、process failure、1,657 coverage、C3 readiness。
- raw（commitしない、`.local`）: `PLANNER_GLOBAL_PHASE2C2_RAW.json.local`（11,907,501 bytes、SHA-256 `c81edfbc…4d07`、stable key原文を含む）、
  `PLANNER_GLOBAL_PHASE2C2_RUN.local/`（child task / record）、`PLANNER_GLOBAL_PHASE2C2_RUN.log.local`。
- 再生成:

```powershell
node scripts/run-planner-global-phase2c2.mjs --export <Export.json> --out-dir <new dir> --output <raw.json.local> --concurrency 3
node scripts/analyze-planner-global-phase2c2.mjs --run <raw.json.local> --c1 docs/PLANNER_GLOBAL_PHASE2C1_RESULT.json --optimum docs/PLANNER_GLOBAL_1657_ORACLE_RESULT.json --output <new.json>
```
