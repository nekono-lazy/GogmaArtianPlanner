# Global Planner Research Phase 2-C1（Planner-start originからの独立canonical Search）

Refs #154。Researchであり、Global Planner本実装・Production仕様変更はしていない。

## 結論（Case B）

**逐次射影（sequential projection）を外し、全pending Targetを同じPlanner-start originからcanonical 1件ずつ検索すると、
Candidate位置の積み上げは完全に消えるが、得られるBuild Listは元ExportのBuild Listそのものに戻り、
元のConflict 21件がそのまま再出現する。43/43にはならない。**

- C1のpending 23 Targetは23件ともbase extentでfound（fallback 0回）。**23/23が元ExportのEntryと同一のCandidate semantics**
  （Route・最終weapon・estimate・`searchStateHash`・`referencedOwnedWeaponsHash` まで一致。IDだけが異なる）。
  つまり元Exportのpending Entryは、もともとPlanner-start originのcanonical Idealだった。
- final Production Planner: **22/43 completed、selected 22、Conflict 21（same_gogma_counter 15 / same_skill_counter 3 /
  same_owned_weapon_consumed 2 / same_normal_counter 1）、rejected 21（全件 resource_conflict）、Plan 1,465 steps、
  expandedStates 1,487、Trace Replay passed、warnings 0、termination exhausted**。
- 元Build ListのままのProduction Planner（baseline）と **Target単位のConflict集合は21件すべて一致**（`sameConflictSignatures = true`）。
  違いはRoute commitmentのprovisional winnerだけ（baseline 20 completed、C1 22 completed。Plan長はどちらも1,465）で、
  Entry IDが違うためranking最後のEntry ID tie-breakが変わったことによる。
- frontier stacking: control **37/37** がfrontier以降から開始 → C1 **0/36**（全区間がfrontierより前、すべてstream originから開始）。
- C1のRoute集合のstatic stream envelope（required位置の最大+1の和）は **1,758**。controlの8,534、1,657に対し、
  **Skill 1,424（1,657と同一）/ Gogma 431（1,657は290）/ チャアク207（同一）/ スラアク1（同一）/ 双剣406（1,657は475）/
  大剣184（1,657は156）/ 片手剣13（1,657は12）**。ただしこれはConflictを無視したRoute集合のvirtual stream envelopeで、
  実行可能Production Planのstep数ではない（21 Conflictで実行できない）。1,657に近いことは、近い位置に候補が存在する可能性の
  示唆に留まり、1,758から1,657へ実際に到達できることを示すものではない。
- 共存失敗はcanonical 1件/Targetの **位置・sourceの重複そのもの**: required位置の重複はGogma 15位置 / Skill 3位置 / Normal 1位置、
  source重複2武器（4 Target）で、Planner Conflictのkind別件数（15 / 3 / 1 / 2）と一致した。Skill 341（stream origin）には
  10 Targetのrequired unitが集中している（生成新規Normal 8件のconversionを含む）。

したがって **今回比較したcanonical 1件/Targetの2 variantでは、sequential projection側だけが43/43を成立させた**。
その代償としてshared streamのRoute位置が後方へ積み上がり、Planは8,534 stepsになった。Planner-start originへ戻すだけでは
21件のresource conflictが再出現した。C2では、逐次射影による衝突回避に依存せず、Targetごとに複数Candidate
（別Gogma / Skill位置・別source・別Normal位置・held Route）を持ち、その中から共存可能な組合せを選ぶ能力
（Candidate portfolio + global assignment）を、次に検証するgeneric能力として扱う。これで1,657へ到達することはまだ示していない。

## 1. 開始状態・authority・変更境界

- 開始時: branch `main`、`main` = `origin/main` = `977e3b95c005744e8e095f76d3f2e1a15839820f`（PR #167 / Phase 2-B merge済み）、
  Working Tree clean。Issue #154 Open。作業branch `research/global-planner-phase2c1-origin-search`。
- 参照authority: REQUIREMENTS、SEARCH_SPEC（5.5 stream解集合、5.6.0 Candidate SearchとPlannerの責務分離、5.6.2 / 5.6.3 canonical Ideal、
  5.6.8 Planner Alternative Search、5.7 canonical Ideal 1件、3.1 originから連続するRoute）、PLANNER_SPEC（7 Route commitment /
  deterministic scheduler、9.2.19 Planner Alternative）、Phase 1-E / 2-A / 2-A.5 / 2-B文書と `PLANNER_GLOBAL_PHASE2B_RESULTS.json`、
  `plannerGlobalOptimizationResearch.ts`、Phase 1-E retry / fallback / projection、`plannerAlternativeSearch.ts`、Production deterministic Planner。
  確認した前提: 通常Candidate Searchは1 Targetにcanonical Ideal 1件以下、その通常Routeは各streamでoriginから連続、held位置を跨ぐRouteは
  Planner Alternative Searchだけが生成、複数TargetのCounter操作を両立させるauthorityはPlanner、Phase 2-Bで8,534の主要構造要因として
  sequential projectionが観測済み。
- **Production behavior変更なし**: Production Planner / Candidate Search / canonical selection / Planner Alternative Search / RNG semantics、
  Worker protocol、schema・version（CalculationContext 17、DB 10、Export 13、`production-rng:c5-e7`）、default値（`maxPlanSteps` 1000、
  Search推奨値）、UI、Persistence、Export、`ProductionPlanGenerationObserver`（Phase 2-Bのobserver seamも含め）は変更していない。
  Production sourceの変更は0件。

## 2. 実装（Research only）

| 役割 | ファイル |
| --- | --- |
| 任意option `searchOrigin`（既定 `sequential_projection` = 従来と同一） | `src/benchmarks/plannerGlobalOptimizationResearch.ts` |
| 2 variant定義・実行・post-hoc集計（Candidate位置、envelope、collision、stacking、元Build List比較） | `src/benchmarks/plannerGlobalPhase2C1.ts` |
| 1,657との比較（evidenceは引数） | `src/benchmarks/plannerGlobalPhase2C1Analysis.ts` |
| 未発見pending Targetの元Entryを `pending_original_kept` として要約可能にした（従来は例外になる経路のみ） | `src/benchmarks/plannerGlobalPhase2BPlan.ts` |
| Node runner（1 process = 1 variant） / post-hoc analyzer | `scripts/run-planner-global-phase2c1.mjs` / `scripts/analyze-planner-global-phase2c1.mjs` |

`searchOrigin: 'planner_start'` のとき `runGlobalPlannerResearch()` は次だけを変える:

1. baseline Plannerとretained prefix Plannerは **controlと同じコードで実行・検証** する（retained集合はcontrolと同じ導出。hard-codeしない）。
2. pending Searchの状態を、retained prefixの射影ではなく **original inputそのもの**（original `rngState` / `normalCounters` /
   `ownedWeapons` / Target定義 / CalculationContext / master）に固定し、以後更新しない。
3. 単体Candidate application Planner・射影を実行しない。Candidateはそのまま通常materializerでBuildListEntryにする
   （Search identityの `algorithm` だけを `phase2c1-planner-start-origin-v1` にする）。
4. 全Candidateが揃った後、retained original Entries + 生成Entries で通常のProduction Plannerを1回実行し、それをauthorityとする。

Target順（ordinary Planner priority）、extent（N350 / G500 / S1500）、normal ×2 fallback（episode上限3、fallback 180秒、attempt 900秒）、
raw block cache（per-search）、materializer、Research `maxPlanSteps` 20,000はcontrolと同一。Candidate同士の衝突を後から加工・回避しない。
Planner Alternative Search（`visitPlannerAlternativeCandidates()`）はCandidate生成に使っていない。

## 3. 測定環境・provenance

| 項目 | 値 |
| --- | --- |
| 実施日 | 2026-09-28（control 20:09〜20:12 JST、C1 20:12〜20:13 JST、各々新しいNode process） |
| **measured commit** | `5e33c176de90a15cfe5bce78d8be52c7b9e426f9`（benchmark-affecting codeをcommit後、clean HEADで測定。runnerが未commit codeを拒否） |
| benchmark code SHA-256 | `065bfaeac8f12179fc77a79c24822f1af84094f5621ca74c3122bd9bedcd9414`、`uncommittedBenchmarkCode = false` |
| 測定後のcommit | 文書・証跡（`docs/`）のみ。benchmark behaviorは変更していない |
| runtime | Node v24.19.0（Vite SSR loader、Browser Workerではない）、`--max-old-space-size=8192`、yield `setImmediate` |
| OS / CPU / memory | Windows 10.0.26200 x64 / AMD Ryzen 7 9700X（16 logical）/ 33,377,591,296 bytes |
| Export | `gogma-artian-planner-backup_20260927015837.json`、19,424,064 bytes、SHA-256 `cc35fb5b…e1e6b`（計測値。commitしない） |
| RNG Engine / Calculation schema | `production-rng:c5-e7` / 17 |

## 4. control（Phase 1-E normal-2x winner）の再現

| 項目 | 値 |
| --- | --- |
| completed / Conflict / rejected | **43/43 / 0 / 0**（resource_conflict 0） |
| physical steps / expandedStates | **8,534 / 8,577** |
| Trace Replay | passed |
| semantic SHA-256 | **`b8ac8bdf…a9f8`**（Phase 1-E reproduction / Phase 2-A / Phase 2-Bと一致） |
| retained / pending | 20 / 23（run自身が導出） |
| Search | 23（base found 22、base no-match 1 → normal fallbackでfound 1） |
| frontier stacking | **37/37**（Gogma 23/23、Skill 14/14）。Phase 2-Bの値と一致 |

analyzerはsemantic SHA・stacking・physical数のいずれかがPhase 2-A / 2-Bと一致しなければfail closedする。

## 5. C1 Candidate discovery

retained 20 / pending 23はcontrolと同一（retained Entry集合・pending順とも一致）。23 Searchすべてが同一のPlanner-start origin状態から開始した
（Search input状態fingerprint 23/23一致、distinct 1。controlは23/23が異なる射影状態）。

| # | Target | 種別/属性 | source | RouteKind | est. ops | Gogma first–required max | Skill first–required max | control est. ops | 1,657とのsource関係 | final |
| ---: | --- | --- | --- | --- | ---: | --- | --- | ---: | --- | --- |
| 0 | be881717 | great_sword/dragon | 所持 1fef53b8 | existing_gogma_mixed | 59 | 55–113 | — | 156 | same_owned_weapon | rejected |
| 1 | e96249b4 | hammer/paralysis | 所持 f3189ef9 | existing_gogma_mixed | 59 | 55–113 | — | 343 | same_owned_weapon | rejected |
| 2 | 9733b090 | heavy_bowgun/water | 所持 7b347758 | existing_gogma_mixed | 66 | 55–120 | — | 216 | same_owned_weapon | rejected |
| 3 | 2e26c0b1 | dual_blades/fire | 所持 5749b7fb | existing_gogma_mixed | 90 | 55–144 | — | 139 | owned_to_new_normal | rejected |
| 4 | a6c17e25 | dual_blades/fire | 所持 aec3d2e4 | existing_gogma_mixed | 90 | 55–144 | — | 71 | different_owned_weapon | selected |
| 5 | c140578c | dual_blades/thunder | 所持 40bea7a9 | existing_gogma_keep_bonuses | 99 | 55–153 | — | 330 | same_owned_weapon | selected |
| 6 | 57126a5e | great_sword/paralysis | 新規N183 | normal_artian_to_gogma | 103 | 55–77 | 341–392 | 222 | new_normal_to_owned | rejected |
| 7 | 27ac3237 | dual_blades/thunder | 所持 870c1051 | existing_gogma_mixed | 114 | 55–168 | — | 162 | same_owned_weapon | selected |
| 8 | a830a376 | dual_blades/water | 新規N349 | normal_artian_to_gogma | 133 | 55–130 | 341–396 | 783 | new_normal_different_position | rejected |
| 9 | 02876df4 | sword_and_shield/fire | 新規N11 | normal_artian_to_gogma | 147 | 55–173 | 341–363 | 279 | new_normal_same_position | rejected |
| 10 | 8d233d8b | sword_and_shield/thunder | 所持 2230977f | existing_gogma_mixed | 157 | 55–210 | 341 | 98 | same_owned_weapon | rejected |
| 11 | 46bf2c78 | great_sword/fire | 所持 8e57b313 | existing_gogma_keep_bonuses | 158 | 55–212 | — | 234 | same_owned_weapon | selected |
| 12 | b27e57a7 | dual_blades/thunder | 所持 0d13daed | existing_gogma_mixed | 162 | 55–216 | — | 363 | different_owned_weapon | selected |
| 13 | b6780f04 | dual_blades/fire | 所持 dc4f742c | existing_gogma_mixed | 164 | 55–73 | 341–485 | 57 | same_owned_weapon | rejected |
| 14 | fea60316 | dual_blades/dragon | 所持 d787f5b6 | existing_gogma_mixed | 170 | 55–224 | — | 156 | same_owned_weapon | selected |
| 15 | 2378d3e0 | dual_blades/water | 新規N358 | normal_artian_to_gogma | 180 | 55–168 | 341–396 | 593 | new_normal_to_owned | rejected |
| 16 | 45b13c06 | dual_blades/ice | 新規N405 | normal_artian_to_gogma | 196 | 55–155 | 341–378 | 138 | new_normal_to_owned | rejected |
| 17 | 711f7d15 | charge_blade/fire | 新規N206 | normal_artian_to_gogma | 267 | 55 | 341–399 | 338 | new_normal_different_position | rejected |
| 18 | 6c65c924 | switch_axe/paralysis | 新規N0 | normal_artian_to_gogma | 284 | 55–267 | 341–410 | 271 | new_normal_same_position | rejected |
| 19 | 188571a7 | dual_blades/ice | 所持 e3a29191 | existing_gogma_mixed | 325 | 55–71 | 341–648 | 194 | same_owned_weapon | rejected |
| 20 | 813fb479 | charge_blade/dragon | 新規N206 | normal_artian_to_gogma | 346 | 55 | 341–478 | 896 | new_normal_same_position | rejected |
| 21 | 1efa01c6 | great_sword/paralysis | 所持 95a1b045 | existing_gogma_mixed | 440 | 55–77 | 341–757 | 912 | same_owned_weapon | rejected |
| 22 | 86439c85 | dual_blades/ice | 所持 192573eb | existing_gogma_mixed | 447 | 55–193 | 341–648 | 118 | different_owned_weapon | rejected |

- found 23 / 23（base 23、normal fallback 0）。source: 所持 15 / 新規Normal 8。RouteKind: mixed 13 / keep 2 / normal_artian_to_gogma 8。
  estimated operation合計 4,256（controlの生成23件は7,069）。
- controlでbase no-match → Normal 2倍fallbackだった813fb479（index 20）は、originからならbase extentで新規N206から見つかる。
- 全Routeが各streamのorigin（Gogma 55 / Skill 341 / 各Normal Counter）から連続して始まる（通常Candidate Searchの性質どおり）。
- **23件すべてが元Exportの該当Entryと同一のCandidate semantics**（`sameCandidateAsOriginalEntry = 23`）。controlの生成Entryは0件一致。
- Target IDは観測結果として記録したもので、algorithmには入れていない。全43 Targetの詳細（routes、required位置）は結果JSONにある。

## 6. final Planner（authority）

| 項目 | control | C1 |
| --- | --- | --- |
| planning Target | 43 | 43 |
| selected / completed | 43 / 43 | **22 / 22**（retained original 16 + 生成 6） |
| termination | completed | exhausted |
| Conflict | 0 | **21**（same_gogma_counter 15 / same_skill_counter 3 / same_owned_weapon_consumed 2 / same_normal_counter 1）、参加Target 34 |
| rejected | 0 | **21**（全件 resource_conflict: 生成17 + retained original 4） |
| warnings | 0 | 0 |
| Plan steps / physical | 8,534 / 8,534 | **1,465 / 1,465**（Skill 341→1424、Gogma 55→431、片手剣 7→13） |
| expandedStates | 8,577 | 1,487 |
| Trace Replay | passed | passed |

**元Build Listとの比較（post-hoc、同じProduction Plannerを元Exportの43 Entryに対して実行）**: baselineは20 completed / 1,465 steps /
Conflict 21。C1 finalとのTarget単位のConflict signature（kind + 参加Target集合）は **21/21一致**。selected Targetの差は
baselineのみ4件（15829bfe / 1f121742 / a26f6bcf / b4f252cd）、C1のみ6件（27ac3237 / 46bf2c78 / a6c17e25 / b27e57a7 / c140578c / fea60316）で、
いずれもConflictのどちらが provisional winner になったかの違いである（Route commitment rankingの最終tie-breakがEntry IDで、
生成EntryのIDは元Entryと異なる）。Conflict構造そのものは変わっていない。

## 7. stream envelope（static）と physical steps

static envelope = そのRoute集合の各streamで **max(required unit位置) + 1**。**実行可能Production Planのstep数ではない**。
「virtual cost」はその和 − originで、Conflictなしに実行できたと仮定した場合の仮想値に過ぎない。

| stream | origin | control Plan終端 | C1 全Entry required終端 | C1 生成Entryのみ | C1 selected Entry | 1,657終端 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Skill | 341 | 4,357 | **1,424** | 758 | 1,424 | 1,424 |
| Gogma | 55 | 3,165 | **431** | 268 | 431 | 290 |
| Normal チャアク | 0 | 850 | **207** | 207 | （使用なし） | 207 |
| Normal 双剣 | 349 | 526 | **406** | 406 | （使用なし） | 475 |
| Normal 大剣 | 156 | 277 | **184** | 184 | （使用なし） | 156 |
| Normal スラアク | 0 | 242 | **1** | 1 | （使用なし） | 1 |
| Normal 片手剣 | 7 | 25 | **13** | 12 | 13 | 12 |
| **virtual cost（和）** | | 8,534（= Plan） | **1,758** | 928 | — | 1,657（= Plan） |

- controlはstatic envelopeがPlan終端と完全に一致する（Phase 2-Bの終端モデル）。
- C1の実Planは1,465 stepsだが、これは21 Targetを実行していないPlanで、43 Targetのコストではない。
- C1のSkill終端はretained original（a367c177 S1423）が決め、1,657と同じ1,424。Gogma 431はretained original 070a1222（G430）が決める
  （Phase 2-Bで1,657との差として記録済みの所持→新規N変更）。生成Entryだけならenvelopeは1,657より短い位置まで収まる。

## 8. conflict / source collision

C1のRoute集合からpost-hocで数えた重複（静的なcount。Planner判定ではない）:

| 区分 | 件数 | 内容 |
| --- | ---: | --- |
| required Gogma位置の重複 | **15位置** | G55（チャアク火・龍）、G67 / 71 / 73 / 74 / 77 / 96 / 107 / 113 / 140 / 144 / 153 / 168 / 212 / 224。13位置はretained original 1件と生成の重複（うちG77 / 113 / 144は生成2件 + retained）、G55 / 168の2位置は生成同士 |
| required Skill位置の重複 | **3位置** | **S341に10 Target**（生成新規Normal 8件すべてのconversion + 生成所持8d233d8bのReset Skills + retained 820831d0）、S396（2）、S648（3） |
| required Normal位置の重複 | **1位置** | チャアク N206（711f7d15 / 813fb479、どちらもproduction target） |
| source（所持武器）重複 | **2武器 / 4 Target** | 0d13daed（a26f6bcf retained / b27e57a7 生成）、aec3d2e4（1f121742 retained / a6c17e25 生成） |

Planner Conflictのkind別件数（Gogma 15 / Skill 3 / Normal 1 / owned weapon 2）とstatic重複の件数が一致した。
生成の新規Normal 8件はすべてSkill 341（Skill streamのorigin）でconversionし、同じSkill位置を奪い合う。通常Candidate SearchのRouteは
各streamでoriginから連続するため、Planner-start originから選ばれたcanonical Routeが共有streamの早い位置へ集中し、required Counter位置や
OwnedWeapon sourceの重複が生じた、というのが本Phaseで直接観測した事実である（canonical Candidateは既存のCandidate ranking /
canonical selectionで決まり、各stream位置を独立に最小化するものではない）。これはC2でportfolioを検証する理由の一次証拠である。

## 9. frontier stacking

Phase 2-Bと同じ定義（retained Routeの終端 → 発見順に先行生成Routeの終端でfrontierを更新し、生成Routeの各stream区間の開始位置と比較）:

| variant | 区間数 | frontier以降から開始 | frontierより前 |
| --- | ---: | ---: | ---: |
| control | 37（Gogma 23 / Skill 14） | **37** | 0 |
| C1 | 36（Gogma 23 / Skill 13） | **0** | 36 |

C1では逐次積み上げは完全に消えた（全区間がstream originから始まる）。件数はhard-codeしておらず、結果をそのまま記録した。

## 10. 8,534 / C1 / 1,657 の比較

| | Phase 1-E / control | C1 | proven minimum |
| --- | --- | --- | --- |
| Search起点 | 逐次射影（23状態） | Planner-start origin（1状態） | —（Planner Alternative含むoracle） |
| Candidate / Target | canonical 1件 | canonical 1件 | 1件（43 Route、うちheld Route 18） |
| 発見 | 23/23（fallback 1） | 23/23（fallback 0） | — |
| 生成Entryと元Entryの一致 | 0/23 | **23/23** | — |
| completed | 43/43 | **22/43** | 43/43 |
| Conflict / rejected | 0 / 0 | **21 / 21** | 0 / 0 |
| Plan steps | 8,534 | 1,465（21 Target未実行） | 1,657 |
| static envelope（virtual cost） | 8,534 | 1,758（実行不可） | 1,657 |
| frontier stacking | 37/37 | 0/36 | — |
| source重複 / Counter重複（required位置） | 0 / 0 | 2武器 / Gogma 15・Skill 3・Normal 1 | 0 / 0 |
| source（pending 23 vs 1,657） | Phase 2-B: 43中17 Targetでsource変更 | same所持 11、同じ新規N位置 3、別所持 3、新規N→所持 3、所持→新規N 1、別N位置 2（**9/23が異なる**） | 所持35 / 新規Normal 8、所持武器の重複使用0 |
| required位置が1,657と完全一致 | — | 2/23 | — |
| held Route | 0 | 0 | 18 |
| shared coverage（1,657でstream originより後から始まるRoute） | — | — | Gogma 42 / Skill 23 |

1,657の新規Normal位置: チャアク N0 / N206、双剣 N367 / 413 / 470 / 474、スラアク N0、片手剣 N11。C1（=元Build List）はチャアク2件がともにN206を取り衝突する
（Phase 2-A.5で記録されたチャアク火 N0 → Reset連鎖 / 龍 N206 → Keep の非対称は、C1のcanonical 1件/Targetには現れない）。

## 11. runtime（Node、参考値）

| | control | C1 |
| --- | ---: | ---: |
| Search（fallback込み） | 85.6秒（fallback 5.5秒） | 69.1秒（fallback 0） |
| Planner（full call数） | 65.5秒（26 call） | 17.7秒（3 call: baseline / retained prefix / final） |
| Research計算 | 162.2秒 | 90.0秒 |
| wall（process内） | 170.2秒 | 97.0秒 |
| peak sampled heapUsed（GC前を含む） | 3.27 GB | 1.29 GB |
| maxRSS | 3.34 GiB | 1.45 GiB |

post-hocの元Build List Planner比較（C1 6.9秒 / control 7.5秒）は計算時間に含めていない。Browser Worker評価・performance最適化はしていない。

## 12. 判定とC2への結論

**Case B**（Candidate位置は大幅に短くなるが、Conflict / rejectionで43/43にならない）。加えて次が判明した:

1. このExportでは、元Build Listのpending 23 Entryはすでに「Planner-start originのcanonical Ideal」だった。逐次射影を外すと
   Research発見は元Build Listへ戻るだけで、Planner側から見て新しい情報はない。
2. 今回比較したcanonical 1件/Targetの2 variantでは、sequential projection側だけが43/43を成立させた。その代償として
   shared streamのRoute位置が後方へ積み上がり（frontier stacking 37/37）、Planは8,534 stepsとなった。Planner-start originへ戻すだけでは
   21件のresource conflictが再出現した（frontier stacking 0/36）。本Phaseが比較したのはこの2 variantだけであり、逐次射影が
   共存を成立させる唯一の手段であることや、逐次射影の除去がGlobal Plannerの必要条件であることまでは示していない。
3. C1で直接観測した共存失敗は、Planner-start originから選ばれたcanonical Routeが共有streamの早い位置へ集中したことによる
   required Counter位置の重複（新規Normal 8件のconversionがすべてS341、Gogma required位置はorigin近傍の15位置で重複、
   チャアク2件がともにN206）と、OwnedWeapon sourceの重複（2武器）である。これがProduction Plannerの21 Conflictと一致した。
   static envelope 1,758はConflictを無視したvirtual値で、1,657に近いことは近い位置に候補が存在する可能性を示唆するだけであり、
   1,657へ実際に到達可能であることは示していない。

C2の方向は、C1で「Planner-start origin canonical 1件/Targetだけでは共存できない」「同じCounter位置・OwnedWeaponへCandidateが集中する」こと、
1,657ではC1と異なるsource / Normal位置が多数使われ、held Routeも18件使われていることに基づく。以下は **C2で検証すべき次のgeneric能力**
（仮説）であり、これらで1,657へ到達できることはまだ示していない（Phase 2-B 11章の1・3・4・5を、本Phaseの証拠で具体化）:

- **Candidate portfolio**: Targetごとに複数のIdeal Candidate（別Gogma / Skill位置、別の所持武器、所持 ↔ 新規Normal、別Normal位置、
  held位置を跨ぐRoute）を同じPlanner-start originから持つ。C1で衝突した19 Counter位置・2武器の各参加Targetについて、
  「衝突しない次のCandidate」がどれだけ近くにあるかが最初の測定対象になる。Planner Alternative Search（held-aware、
  排他OwnedWeapon、blocked位置）はこの生成器の候補。
- **global assignment**: portfolioから、required位置とsourceが互いに排他になるよう全Targetへ同時に割り当て、目的関数を
  stream終端の和（= physical operation数、Phase 2-Bで恒等式を確認済み）にする。controlの逐次決定は、C1でS341に10 Targetが
  集中したような衝突を後ろへずらす形で共存させ、8,534になった。
- 評価authorityは引き続き通常Production Planner（Conflict 0 / Trace Replay）で、static envelopeは実行可能性を示さない参考値
  （探索の推定）としてだけ使う。

## 13. テスト

`src/benchmarks/plannerGlobalPhase2C1.test.ts`（11件）:

- C1ではpending Search inputの状態（RNG / Normal Counter / OwnedWeapon / Target）が毎回original inputと同一、controlは射影状態（Gogma 11 → 12）
- 先行Candidateのprojectionが次Search inputへ入らない、application Plannerを実行しない（full run 3回 vs control 5回）
- retained集合・Target順・extent・fallback設定・baseline / retained summaryがcontrolと同一
- 生成Candidateは同じinputに対する通常 `searchCandidates()` のcanonical Candidateと同一Route・同一最終weapon（ranking不変）
- Candidate同士の衝突を加工しない: 3 Targetが同じ位置を要求したまま、final結果が同じinputの `createProductionPlan()` と一致しConflictを返す
- 既定pathは `searchOrigin` 未指定と `sequential_projection` 指定で完全一致、Phase 0 fixture parity SHA `9ae56d7e…` 不変、不正originを拒否、
  materializerの既定identity不変
- 2 variantはSearch origin以外のworkloadが同一、C1は元Build ListとConflict signatureが一致
- static envelopeはrequired位置の最大（skippable tailではない）で、Plan stepsとは別field
- collision / stacking / source関係は合成Routeだけで計算しID非依存
- isolation: 計算側（Research / Phase 2-C1 / Phase 2-B Plan要約 / runner）はoracle名・lower bound・分析module・Planner Alternative Search・
  UUID・64桁hex・ファイル読込を含まない。analyzerだけが `--optimum` を引数で受け取り、Search / Plannerを実行しない。
  ProductionからPhase 2-C1へ到達しない。Production default・schema・version不変

| 確認 | 結果 |
| --- | --- |
| `npm run lint` | passed |
| `npx tsc -b --force` | passed |
| `npm test` | 306 files / 4,874 tests passed |
| `npm run build` | passed（既存の500 kB超chunk warningのみ）。`dist` にPhase 2-C1 / Research識別子なし |
| `git diff --check` | passed |

## 14. 証跡

- [PLANNER_GLOBAL_PHASE2C1_RESULT.json](PLANNER_GLOBAL_PHASE2C1_RESULT.json): provenance（measured commit、code SHA、Export SHA、環境）、
  variant定義、control parity、control summary、C1のCandidate 23件・final summary・Conflict / rejected詳細・selected差分・
  envelope・collision・stacking・元Build List比較・全43 Route、1,657との比較、比較表。Export・Plan全文は含まない。
- raw（commitしない、`.local`）: `PLANNER_GLOBAL_PHASE2C1_CONTROL.json.local`（SHA-256 `415076bb…12f9`）、
  `PLANNER_GLOBAL_PHASE2C1_ORIGIN.json.local`（`66448d37…75fa`）と各log。ファイル名・bytes・SHA-256は結果JSONの `sources` に記録。
- 再生成:

```powershell
node --max-old-space-size=8192 scripts/run-planner-global-phase2c1.mjs --export <Export.json> --variant control --output <control.json>
node --max-old-space-size=8192 scripts/run-planner-global-phase2c1.mjs --export <Export.json> --variant origin-independent-canonical --output <origin.json>
node scripts/analyze-planner-global-phase2c1.mjs --control <control.json> --origin <origin.json> --phase2b docs/PLANNER_GLOBAL_PHASE2B_RESULTS.json --optimum docs/PLANNER_GLOBAL_1657_ORACLE_RESULT.json --output <new.json>
```

## 15. 未確認事項

別Export・別武器種、Browser Worker / スマートフォンでの時間・memory、複数回の性能分布、portfolioを持った場合の実行可能性（static envelope 1,758の
実現可能性を含む）、C1でrejectedとなったTargetに衝突しない次Candidateがどこにあるか。既存のreference-verified / game-verified / unverifiedの
境界は拡張しない。
