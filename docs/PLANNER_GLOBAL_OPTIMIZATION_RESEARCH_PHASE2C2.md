# Global Planner Research Phase 2-C2（Conflict orientationからのCandidate portfolio）

Refs #154。Researchであり、global assignment・Global Planner本実装・Production仕様変更はしていない。

## 結論（C3 readiness: inconclusive / 測定不完全）

**元ExportのConflict 21件から作った54 orientationについて、formal Node run（child heap上限8 GB）では43 orientationのkernel child processがOOMで
停止した。その結果、Conflict participant 34 Target中19 Targetは一度もSearch contextまで到達できず、未探索（未測定）である。
探索できた15 participantでは12 Target（80%）で複数Candidateが得られたため、portfolio diversity自体が不足しているとはまだ言えない。
C3 readinessは、未探索participantが残る間はA / B / Cへ分類しない規則により **inconclusive（incomplete measurement）** とした。**

- baseline（元ExportのBuild ListにそのままProduction Planner）: planning Target 43、completed 20/43、Conflict 21
  （same_gogma_counter 15 / same_skill_counter 3 / same_owned_weapon_consumed 2 / same_normal_counter 1）、Plan 1,465 steps。
  Phase 2-C1のoriginal baselineとplan steps・completed・termination・kind別件数・Target単位Conflict signature 21件・selected Targetが全て一致。
- orientation 54（2 participant 16件 ×2 + 3 participant 4件 ×3 + 10 participant 1件 ×10、§5）。kernel child process完走 **11 / 54**、
  **8 GB heap上限でのOOM 43 / 54**（Gogma 27/33、Skill 13/15、owned weapon 3/4、Normal 0/2）。timeout・その他のprocess failureは0件。
  OOMの発生箇所・原因はformal runでは局所化していない（非formal診断は§6で分離して記載）。
- 完走kernelのTarget outcome（27件）: **found 5**、stopped_by_candidate_trial_bound 2、**stopped_by_search_extent_bound 20**、
  not_found_within_search_extent 0、stopped_by_planner_rerun_bound 0、blocked_by_selected_checkpoint 0。trial rejectedは10件で全件
  `explicit_decision_not_selected`。
- default extentのportfolio Search context 27件: consumer stop（8件到達）7、stoppedByExtent 20、exhausted 0。delivered 62件。
  Research probe 70 context: consumer stop 9、stoppedByExtent 61、exhausted 0、delivered 92件。Normal 40のprobe 2件がOOM。
- portfolio: 43 Target、unique Candidate 132（original 43 + alternative 89）。size分布 {1: 31, 2: 1, 9: 11}。
  portfolio > 1は12 Target（全員Conflict participant）、source alternative 9、Counter位置alternative 11、held Routeを持つTarget 10
  （held alternative 52件、default extent内29件 / 5 Target、probeでのみ得たもの23件）。probeで新たに得たalternativeは38件。
- **Conflict participant: total 34 / explored 15 / unexplored 19**。portfolio > 1の割合は
  **explored-only 12 / 15（80%）**（実際に探索できたparticipantに限った観測値）と、**overall lower bound 12 / 34（35%）**
  （未探索19件を0件とみなした実測下限であり、真のportfolio diversity率ではない）を区別して記録した。
- **1,657 oracle coverage: exact 0 / partial comparable 0 / not comparable 0 / uncovered 43**（originalでもC2 alternativeでも0）。
  有力な説明の1つとして、1,657 Routeの多く（43件中42件）が他Routeによるstream coverageを利用してGogma originより後から開始する一方、
  C2では1つのfixed winner由来のreservationしか使用していないことがある。ただしOOMによる未探索19 participant、extent bound・capture bound・
  probe grid上限による未確認範囲も残るため、C2だけでは未coverageの原因を一意には特定できない（§12）。

次Phaseの優先順位（§14）: 第一に、未探索19 participantを測定可能にする（kernel OOMの正式な局所化・改善、またはResearch-onlyでSearch contextを
完走できる方法の検証）。第二に、それができた後、single fixed winner reservationだけでportfolio生成能力が十分かを再評価し、oracle Route coverageや
held / late-start Routeが依然不足するなら、複数Route coverageをreservationへ含めるcontext生成を検証する。十分なportfolioが得られた時点でC3
global assignmentへ進む。2つの要因を現時点で同程度に「原因確定」とは扱わない。

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

- **formal結果**: formal Node runでは54 orientation中43 orientationのkernel child processが8 GB heap上限でOOMした（開始後50〜141秒、
  中央値約110秒、V8 `Ineffective mark-compacts near heap limit`）。formal runはkernel child process単位で失敗を記録しており、
  kernel内のどの処理（Planner Alternative Search / full Planner trial など）でheapが尽きたかは局所化していない。
- **非formal診断（formal evidenceではない）**: 開発中のsmoke runとcommitしていないscratch scriptによる診断では、OOMはPlanner Alternative Search中かつ
  最初のCandidate delivery前に発生し、held-aware Gogma探索の進行とともにheapが増加する挙動が観測された。heap 24 GBでも、1 context
  （c0-p0の非fixed側）はGogma深さ約169（extent 235）でOOMし完走しなかった。これはformal evidenceではなく、次Phaseで正式instrumentation
  （既存の `PlannerAlternativeSearchExecutionOptions.instrumentation` 等）とBrowser Worker測定によって局所化する必要がある。
  Browser Workerでの挙動は未測定。
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
portfolio > 1のTarget数はk = 1から増えない。これは、探索できたcontextの数（kernel child process OOMで19 participantが未探索）と、
default extentで0件だったcontextに制約された観測であり、portfolio diversityの上限を示すものではない。

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

- 54 orientation中43件でkernel child processが8 GB heap上限でOOMし、非fixed側のparticipantのうち19 Targetは「代替がない」のではなく **未確認**。
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

観測事実: 1,657のRouteは43件中42件でGogma stream origin（55）より後から始まり、多くは1〜3操作（例: 0d98b225はG201のKeep 1回、02876df4は
N7〜11 + S363 + G173の7操作）で、held Routeは18件ある。C2のcontextは1つのfixed winner（1 Entry）由来のreservationだけを使用した。

C2 portfolioでは1,657 oracle Routeを0 / 43しかcoverageできなかった。有力な説明の1つとして、1,657 Routeの多くが他Routeによる
stream coverageを利用して遅い位置から開始する一方、C2では1つのfixed winner由来のreservationしか使用していないことがある
（Planner Alternative Searchは、Route開始位置より前の位置がheldでなければ遅い位置から始まるRouteを返さない）。C2で観測した
「fixed Routeの被覆直後から始まる短いRoute」（a26f6bcf 2操作、a6c17e25 2操作）はこの方向と整合する。

ただし、この説明で全43 Routeの未coverageを断定することはできない:

- 19 participantはkernel child process OOMで未探索
- 多数のcontextがstoppedByExtentで終わり、capture bound 8、probe grid上限、Normal probeのOOMがある
- oracle Route × 各C2 reservationについて、そのRouteが生成条件を満たすかを網羅的には監査していない

したがってOOM・extent bound・capture boundによる未探索も残り、C2だけでは未coverageの原因を一意には特定できない。

## 13. 未確認事項

- kernel OOM 43 orientationの非fixed側19 participantの代替: 未探索（「代替なし」ではない）。
- default extentでstoppedByExtentだったcontextの範囲外、Normal 40 / 80、Gogma 350超、Skill 64超。
- Browser Worker / スマートフォンでの時間・memory（本Phaseの全測定はNode、heap上限8 GB）。24 GB heapの診断は非formal。
- kernel OOMの発生箇所（非formal診断ではPlanner Alternative Search中と観測したが、formalには未局所化）。
- 1,657 oracle Route未coverageの原因（single fixed winner reservationの制約か、未探索・extent・capture boundによるものか）。
- 複数Conflict decisionを同時に反映したreservation、Plan全体の被覆をheldとするcontextでのportfolio。
- portfolioの組合せでの共存可能性（C3の範囲）。別Export・別武器種。
- 既存のreference-verified / game-verified / unverifiedの境界は拡張しない。

## 14. C3 readinessと次Phase

判定規則（analyzer `phase2c2ReadinessJudgement()` に固定）:

- **inconclusive**: Conflict participantに未探索（一度も完了したSearch contextに到達していない）Targetが1件でもある場合。A / B / Cへ分類しない
- 全participant探索済みの場合のみ:
  - **C**: portfolio > 1が半数未満
  - **A**: 半数以上、かつ1,657の全Routeがcoverage（exact またはpartial comparable）
  - **B**: 半数以上だが、1,657のRouteに未coverageがある

A / B / C規則は、各participantのportfolioが実際に測定されていることを前提にした分類である。OOM / timeout / process failureで測定できなかった
participantはno-matchではなく未測定であり（C2自身の「timeout / OOMをno-match扱いしない」原則）、portfolio size 1として数えるとA / B / Cの前提を
満たさない。そのためincomplete measurementはfail-closedでinconclusiveとする。初版のanalyzerは未探索participantもportfolio size 1として
share（12 / 34）を計算しCase Cと分類していたが、これはこの前提に反するため修正した。A / B / Cの閾値そのものは変更していない。

結果（raw runからanalyzerが再導出）:

| 項目 | 値 |
| --- | --- |
| participantsTotal | 34 |
| participantsExplored | 15 |
| participantsUnexplored | 19（全員、非fixed側となるorientationのkernel child processがすべてOOM） |
| participantsWithMultipleOverall | 12 |
| participantsWithMultipleAmongExplored | 12 |
| multipleShareOverallLowerBound | 12 / 34 = 35%（未探索を0件とみなした実測下限。真のdiversity率ではない） |
| multipleShareAmongExplored | 12 / 15 = 80%（探索できたparticipantに限った観測値） |
| oracle coverage | 0 / 43（原因は一意に特定できない、§12） |
| **C3 readiness** | **inconclusive（incomplete measurement）** |

次Phaseの優先順位（本Phaseのevidenceが直接支持する順）:

1. **第一優先: 未探索19 participantを測定可能にする。** formal runでは43 / 54 orientationのkernel child processがOOMしたため、現状では
   portfolio能力そのものを評価し切れていない。kernel OOMの正式な局所化（正式instrumentation、Browser Worker測定）・改善、または
   Research-onlyでSearch contextを完走できる方法を検証する。これはProductionの「比較する」「この候補を優先」も同じkernelを使うため、
   Production側の観測としても再現確認が必要である。
2. **第二優先: OOMを解消・回避できた後、single fixed winner reservationだけでportfolio生成能力が十分かを再評価する。** その結果、
   oracle Route coverageが依然低い、またはheld / late-start Routeが不足するなら、複数Route coverageをreservationへ含めるcontext生成
   （Planner authority `derivePlannerAlternativeReservation()` で導出したcontext）を検証する。
3. 十分なportfolioが得られた時点でC3 global assignmentへ進む。

1と2は現時点で同程度に「原因確定」とは扱わない。本Phaseで直接示したのは、測定不完全であることと、探索できた範囲では複数Candidateが得られたことまでである。

## 15. 測定環境・provenance

| 項目 | 値 |
| --- | --- |
| 開始時 | branch `main`、`main` = `origin/main` = `8e9e591c`（PR #168 merge済み）、Working Tree clean、Issue #154 Open |
| 作業branch | `research/global-planner-phase2c2-portfolio` |
| **measured HEAD** | `3db8197fa5b256de080b810985f333c44a524ccb`（Research codeをcommit後、clean HEADで測定。runnerは未commit codeを拒否） |
| benchmark code SHA-256 | `0002540835f59b4d1c170ff643d18a011e7b46b4a91a8318dbe3f1935dc034b8` |
| 測定後のcommit | post-hoc analyzer（`plannerGlobalPhase2C2Analysis.ts` / `analyze-planner-global-phase2c2.mjs`）・テスト・文書・証跡のみ。計算側（`plannerGlobalPhase2C2.ts` / runner）は変更していない |
| **latest analysis commit** | `924cf27c5c331a5af66985b43b8f777e00115767`（readiness判定のfail-closed化。evidence JSONの `provenance.analysisHead`） |
| analysis provenance | analyzerはmeasured HEAD以降に変更されたcodeを列挙し、post-hoc analysis以外の変更があれば停止する。今回の `calculationCodeChangedSinceMeasuredHead` は空。raw runは再測定していない |
| 実施 | 2026-09-28 21:25〜22:00 JST（wall 2,097秒） |
| runtime | Node v24.19.0（Vite SSR loader、1 task = 1 child process、Browser Workerではない）、child heap上限 8,192 MB、concurrency 3、yield `setImmediate` |
| budget | kernel / baseline 30分、portfolio / probe 10分、probe合計90分（timeoutは0件） |
| OS / CPU / memory | Windows 10.0.26200 x64 / AMD Ryzen 7 9700X（16 logical）/ 33,377,591,296 bytes |
| Export | `gogma-artian-planner-backup_20260927015837.json`、19,424,064 bytes、SHA-256 `cc35fb5b…e1e6b`（計測値。commitしない） |
| RNG Engine / Calculation schema | `production-rng:c5-e7` / 17、Research `maxPlanSteps` 20,000 |

- 測定済みrunnerはraw recordの `defaultContexts[].process` を未設定のまま書いた（変数参照の誤り）。計算結果には影響せず、同じchild情報は
  `processes` にidで記録されているため、analyzerがidから復元する（analyzerの変更は測定後、post-hocのみ）。
- PR headとmeasured HEADが異なるのは、測定後にpost-hoc analyzer・テスト・文書・証跡だけをcommitしたためである。evidence JSONは既存のraw run
  （`PLANNER_GLOBAL_PHASE2C2_RAW.json.local`）からlatest analysis commitのanalyzerで再生成した。

## 16. テスト・検証

`src/benchmarks/plannerGlobalPhase2C2.test.ts`（18件）: orientationをConflictからID hard-codeなしで全生成（N participant → N）、kernel requestが
Conflict key / participantから構築されprior fixed / exclusionなし・Production defaultのspread copy、kernelとpost-hoc Searchが同一の
origin / reservation / excluded keys / extentで呼ばれる（Search入力を捕捉して比較）、reservationを再導出しkernel記録との不一致を拒否、
first 8のconsumer stop、exhausted / stoppedByExtent / consumer stopの区別、`candidateStableKey` dedupとprovenance保持、original保持、
held Routeがunit位置から導出、Search-deliveredとkernel-foundの区別、probeがConflict kindの軸だけを段階拡張、timeout / OOMをno-matchにしない、
C1 parity比較、oracle coverageの4区分、C3 readiness（未探索participantがあればinconclusiveで、未探索をportfolio size 1として数えない、
explored-only shareとoverall lower boundを別fieldで記録、全participant探索済みのときだけA / B / Cへ分類、oracle coverage 0でも未探索があればB / Cへ
早期分類しない、不整合なcountを拒否）、isolation（計算側はoracle / C1 evidenceを読まない、analyzerだけが引数で読む）、
ProductionからC2へ到達しない、Production default / schema / version不変。

| 確認 | 結果 |
| --- | --- |
| `npm run lint` | passed |
| `npx tsc -b --force` | passed |
| `npm test` | 307 files / 4,892 tests passed（readiness修正後） |
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
