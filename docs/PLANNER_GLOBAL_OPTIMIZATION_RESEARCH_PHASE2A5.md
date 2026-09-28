# Global Planner Research Phase 2-A.5（1,657-step oracleのProduction実証とlower-bound監査）

Refs #154。Researchであり、Production仕様・Production codeは変更していない。

## 結論

**今回のExport・現在のProduction semanticsに対する minimum physical operation count = 1,657**（下記7章の前提の下）。

- 1,657 physical operationsのRoute集合を再構成し、Production RNG（`production-rng:c5-e7`）での独立再生（Stage A）、
  Production Search Domainからのmaterialize（Stage B、43 / 43）、Production Planner + Trace Replay（Stage C）を通した。
  Production Plannerは **completed、43 / 43、selected 43、Conflict 0、rejected 0（resource_conflict 0）、warnings 0、
  ProductionPlan.steps 1,657、expandedStates 1,700、Trace Replay passed** を返した（Node、約8.1秒、`maxPlanSteps = 5000`）。
- 物理操作数の下限を、Counter閾値に対する緩和問題としてProduction RNGから網羅計算し、**下限 = 1,657** を得た。
  実行可能な1,657解が存在するので、1,657はこのExportに対する最小値である。
- 下限は「各Targetに別々のsourceが要る」（distinct source）ことを使う。これは **Production一般の制約ではない**
  （Production Plannerにはcross satisfactionがある）。今回のExportでは、1つの武器状態で2つのplanning TargetのIdealを
  同時に満たせるTargetペアが **0件** であることをProductionの評価関数で機械検証したので（7.0.1）、このExportに限って適用できる。
- ただし内訳（Skill 1,083 / Gogma 235 / Normal 339）の **単純加算は証明ではない**。Skill 1,083は単独で強制されるが、
  Gogma 235とNormal 339は単独では強制されない（単一stream下限はGogma 170、Normal 208）。1,657は3 streamを
  **同時に最小化した緩和問題の最小値** として証明される（7.4）。

「最小」はこのExport（SHA-256 `cc35fb5b…e1e6b`）の43 planning Target・OwnedWeapon集合・RNG state、
現在のProduction RNG / Route / Planner semantics、目的関数 = physical operation数に限る。distinct sourceの前提も
このExportで検証したものであり、任意のPlannerInputへ無条件には適用できない。ゲーム全体の最短、
別Export、Production RNGのgame-verified範囲外の実機挙動の保証へ一般化しない。

| 比較 | ProductionPlan steps | 1,657との差 |
| --- | ---: | ---: |
| Phase 2-A autonomous Research（original Exportのみから） | 8,534 | 6,877 |
| historical validated oracle（Issue #154、2,982） | 2,982 | 1,325 |
| **今回のoracle（proven minimum）** | **1,657** | — |

## 1. 開始状態・authority・変更境界

- 開始時: branch `main`、`main` = `origin/main` = HEAD = `9ee8e8f4c37aee20e14386af2a7fd15988472609`（PR #165）、Working Tree clean、
  untrackedなし。作業branch `research/global-planner-1657-oracle`。
- 参照authority: REQUIREMENTS、PLANNER_SPEC、SEARCH_SPEC（5.6.8 Planner Alternative Searchを含む）、RNG_SPEC、
  ISSUE_103_DETERMINISTIC_PLANNER_DESIGN（3章・7章のscheduler規則）、Phase 1-E / 2-A Research文書、AGENTS.md、
  AI_DEVELOPMENT_WORKFLOW。Issue #154のコメントと外部調査の1,657情報はProduction authorityではなく、比較対象としてだけ扱った。
- **Production変更なし**: Candidate Search / Planner / deterministic scheduler / Planner Alternative / Conflict / ranking /
  default extent・trial bound / `maxPlanSteps` policy（default 1000）/ Worker protocol・Client / UI / Persistence・Dexie /
  Export schema / CalculationContext（17）/ RNG semantics・version / Target・Candidate・BuildListEntry schema。
  追加はすべて `src/benchmarks/` と `scripts/` のResearch専用code、文書、証跡である。
- oracle情報の隔離: manifest（Target ID・OwnedWeapon ID・Counter位置）は `plannerGlobalOracle1657Manifest.ts` にだけあり、
  Production module、Candidate Search、Planner、既存のGlobal Research（Phase 0〜2-A）、他scriptからはimportされない。
  テストでimportとID・Export hashの出現を検査している（9章）。下限監査moduleはoracleを読まない（入力とEngineだけ）。
  「チャアク火ならN0」のような規則をどこにも追加していない。

## 2. Export

`gogma-artian-planner-backup_20260927015837.json`、19,424,064 bytes、SHA-256
`cc35fb5bd85acb417b2ce0229cd79441b48c642ac8af70bbc2dfdfc8c89e1e6b`（実ファイルで一致を確認。runnerは不一致なら拒否する）。
schemaVersion 13、Target 43（全件planning対象）、BuildListEntry 43、OwnedWeapon 40（全件未保護のGogma）。
origin: Base Seed確定、Skill Counter 341、Gogma Counter 55、Normal Counter（今回使う種別）: チャアク 0、双剣 349、片手剣 7、
スラアク 0。Export本体はcommitしていない。

## 3. 1,657 oracleの再構成方法

Issue #154の外部調査が報告した1,657構成は数値の要約（stream別操作数、Counter範囲、Normal内訳、source内訳、チャアク火 / 龍の
非対称化）だけで、Route manifestはRepository・Issueに無い。そのため本Phaseで再構成した。

1. **到達表**: 各Targetについて、Production RNGで「理想Skillの初出位置」「位置ごとのReset結果」「Idealのfamily layoutの
   全順列に対するKeep結果」「各Normal位置の5枠」を計算した。
2. **下限の閾値**: 7章の緩和問題を解き、最小閾値 Skill 1424 / Gogma 290 / チャアク207・双剣475・片手剣12・スラアク1（Normal終端）を得た。
3. **排他割当**: 閾値の内側で、各Targetのsource（所持武器 / 新規Normal位置）と、PlannerがFast-forwardできないrequired unitの
   Counter位置（最終Bonus操作、Keepが読むReset、巨戟化、最終Reset Skills、production target forge）がstreamごとに重複しない
   割当をbacktracking（MRV + 乱数restart、新規Normal数に上限）で探した。既存所持武器を優先し、**所持35 / 新規Normal 8** の
   割当を得た（外部調査と同じ構成比。所持起点の理論上限は、Gogma位置の排他を無視したマッチングで37）。
4. **Route形の決定**: required unitの間はskip可能unit（Reset→Reset、Keep→Reset、Keep→Keep、Reset Skills→Reset Skills、
   Counter進行用forge）で埋まればよい。schedulerは「streamの現在位置にunitが1つも無い」とstallするので、各streamを
   originから終端まで被覆するRouteを1本ずつ持たせた:
   - Gogma 55〜289: **チャアク火**（新規N0 → S399巨戟化 → G55〜289のReset連鎖、required G289のみ）
   - Skill 341〜1423: **a367c177**（大剣龍、所持a801b133、S341〜1423のReset Skills連鎖、required S1423のみ）
   - Normal: 種別ごとに最大production targetのRoute（チャアク龍 N0〜206、双剣 070a1222 N349〜474、片手剣 02876df4 N7〜11、スラアク N0）
5. **Route本体はProduction Search Domainから取る**（Stage B）。manifestはその結果を区間表記で固定したものである。

scratchで使った割当探索ツールはcommitしていない（最終authorityはmanifestとverifier）。探索はoracle構成のためだけに使い、
Production・他Researchへ持ち込んでいない。

### 連続Routeだけでは1,657を作れない

最初に全Routeを通常Candidate Search（originまたは射影起点からの連続Route）だけで作ろうとした。Searchは射影起点から
最も早い理想へ到達するので、`a367c177`・`be881717`（大剣龍）・`e96249b4`（ハンマー麻痺）の3 Targetがいずれも
**Gogma 113でしか完成できず**、required位置が衝突して1,657の割当が存在しなかった。1,657には「Resetした武器を保持し、
他Targetが途中のGogma位置を使った後でKeepする」Route（例: be881717 = G67 Reset → G269 Keep）が必要である。

これは現行Productionで表現可能である: **Planner Alternative Search**（`visitPlannerAlternativeCandidates()`、SEARCH_SPEC 5.6.8）は
held / blocked reservationでheld位置を跨ぐRouteを生成し、Route shapeは絶対Counter位置の非連続列として永続化できる
（DATA_MODEL 9.2）。そこで18 TargetはPlanner Alternative Searchでmaterializeした（Stage B）。

## 4. Stage A: Production RNGでの独立再生

`verifyOracleRng()`（Search / Plannerを使わない）。各Routeについて、sourceの状態（所持武器はExportの5枠・scope・Skill、
新規Normalは `predictNormalArtian` の5枠）からRoute全操作を再生し、さらに **required unitだけ** を再生して、両方がIdealかつ
同一の最終武器になることを確認した（skip可能unitを他Targetが消費しても結果が変わらないことの確認）。

- 43 / 43 Ideal（Bonus: `gogma_artian` scopeで完全一致、Skill条件一致）。required-only再生も43 / 43一致。
- 各Route内の各streamの位置は狭義単調増加。required unitはmanifestと独立導出（PLANNER_SPEC 7.0.2 / Issue #129の規則）で一致。
- source: 所持35（すべて未保護・種別 / 属性一致・Exportに存在、同一武器の重複なし）、新規Normal 8（production targetの重複なし）。
- stream被覆: 下表のとおり全位置にunitがあり（gap 0）、required位置の重複0。

| stream | 範囲 | advance（physical） |
| --- | --- | ---: |
| Skill | 341 → 1424 | 1,083 |
| Gogma | 55 → 290 | 235 |
| Normal チャアク | 0 → 207 | 207 |
| Normal 双剣 | 349 → 475 | 126 |
| Normal 片手剣 | 7 → 12 | 5 |
| Normal スラアク | 0 → 1 | 1 |
| **合計** | | **1,657** |

Route operationの単純和は1,745で、1,657との差88は複数Routeが同じ位置にskip可能unitを持つ重なり（Planner実行時に
silent fast-forwardされる分）である。**physical operation数とRoute operation数・PlanStep数を混同しない**。

### 4.1 source内訳とNormal

- 所持起点35（大剣7、片手剣4、双剣21、ヘビィ2、ハンマー1、うち `existing_gogma_keep_bonuses` 8 / `existing_gogma_mixed` 27）
- 新規Normal起点8: 片手剣火 N11、双剣水 N474・N367、双剣火 N470、双剣氷 N413、スラアク麻痺 N0、チャアク火 N0、チャアク龍 N206
- Normal physical creation 339 = チャアク207 + 双剣126 + 片手剣5 + スラアク1。production targetは8件で、残り331回は
  Counter進行用forge（Issue #129で共有Counter進行として扱い、他Targetのproduction targetと衝突しない）。

チャアクは外部調査と同じく非対称: **龍 = N206 → S478巨戟化 → G230 Keep**、**火 = N0 → S399巨戟化 → G55〜289 Reset連鎖（G289 Reset）**。
龍のKeepは外部調査のG55ではなくG230に置いた（G55は被覆・割当の都合で他が使わなくてよい。どちらもrequired位置が
他と重ならない有効な位置である）。

### 4.2 Gogma resource

Gogma 55〜289の235位置すべてにunitがあり（`gogmaUsage`、295 unit。位置・Target・操作・requiredの全一覧は結果JSON）、
required位置は重複しない。Target別のrequired位置は6.1の表（2つあるものはReset位置とKeep位置、つまり保持してKeep）。
Plan実行時の内訳はKeep 42回・Reset 193回。Reset 193回の大半はチャアク火の連鎖が他Targetのrequired位置の
間を埋めたものである。

### 4.3 Skill resource

Skill 341〜1423の1,083位置すべてにunitがあり、required位置は25（巨戟化8 + 最終Reset Skills 17）。所持起点のうち
18 TargetはSkillが既にIdealで、Skill操作を持たない。残りはa367c177の連鎖（S341〜1423）が被覆する。
大剣龍 a367c177 の理想Skill（verified_24 + apex）はS341以降で **S1423が初出** であり、これがSkill終端を決める（7.1）。

## 5. Stage B: Production Searchからのmaterialize

`materializeOracleRoutes()`。oracleは「source、射影起点、extent、reservation」の指定にだけ使い、Route本体は常にSearchの出力である。
Candidate Snapshotを手で作っていない。

- **Candidate Search 25件**: `searchCandidates()` を、sourceだけの在庫・該当Targetだけ（preferredはsource）・
  射影起点（各streamの最初の操作位置）・最小extentで実行し、canonical Idealを既存Phase 0 adapter
  （`materializeGlobalResearchCandidate()`: `createConstrainedCandidate(..., 'origin_reach')` + deterministic materializer。
  SearchStateHashの書換えはしない）でPlanner-start originのBuildListEntryにした。
- **Planner Alternative Search 18件**: originはPlanner-start snapshot、reservationは held = originからstream終端まで、
  blocked = 他42 Routeのrequired位置、排他OwnedWeapon = source以外の全所持武器、extent = そのRouteの到達量。
  Candidateを順に受け取り、manifestと操作列が一致したものをPlanner Alternativeと同じdeterministic materializerで
  Entryにした。一致までの配信数は1件が13 Target、2件が3、3件が1、4件が1（それ以前の配信は同じcostの別Route）。
- 43 / 43で、操作列（種類・絶対位置・forge範囲）、RouteKind、source、estimatedOperationCount / Normal / Gogma / Skill advance、
  最終Bonus・Skill（Stage Aと一致）、Plannerのrequired unit（`createPlannerRouteUnitPlans()`）が一致した。

## 6. Stage C: Production Planner と Trace Replay

43 EntryをExportのPlanner originの正式なPlannerInputに入れ（Conflict resolutionなし、`validatePlannerInput()` の除外0）、
`createProductionPlanWithObserver()`（Production deterministic scheduler、unsupported retry、Trace Replay、execution projection）を実行した。
Research用 `maxPlanSteps = 5000`（Production default 1000とは別。1,657はdefaultを超える）。

| 項目 | 値 |
| --- | --- |
| termination | `completed`、reachedLimits なし |
| completedTargetCount | 43 / 43 |
| selected BuildListEntry | 43 / 43 |
| Conflict / rejected / resource_conflict | 0 / 0 / 0 |
| warnings | なし |
| **ProductionPlan.steps** | **1,657**（reset_skills 1,075、convert 8、create 339、reset_bonuses 193、keep_bonuses 42、confirm_owned_ideal 0） |
| expandedStates | 1,700 |
| full Planner run | 1 |
| Trace Replay（独立に `replayPlannerSearchTrace()`） | valid、issue 0、draft 1,700 |
| Planner elapsed（Node） | 8.07秒 |

**PlanStepsとphysical operationの関係**: 1,657 steps = 1,657 physical operationsで一致した。trace / expandedStatesの1,700は
これに43回のPlanner-only `reserve_weapon`（Target完成。PlanStepにならず最後の物理Stepへ効果として載る）を加えたもの。
`confirm_owned_ideal`（Counterを進めない）は0件。silent fast-forwardされたunitはStepにならない。

Production Plan generationはinvalid Trace ReplayでPlanを返さない契約であり（`PlannerPlanGenerationError`）、Planが返ったこと自体が
Replay成功を意味するが、本Phaseでは別途 `replayPlannerSearchTrace()` の結果をplain evidenceとして記録した。

### 6.1 Target別Route（Target・OwnedWeaponは先頭8文字。完全IDは結果JSON）

CS = Candidate Search、PA (n) = Planner Alternative Search（n件目で一致）。Route opsはRoute operation数（held位置を数えない）。

| Target | 種別 / 属性 | source | Gogma | Skill | Route ops | materialize |
| --- | --- | --- | --- | --- | ---: | --- |
| 02876df4 | sword_and_shield / fire | 新規N11 (7–11) | G173 (1操作, required 173) | S363 (1操作, required 363) | 7 | CS |
| 05e6b206 | sword_and_shield / water | 所持 f78a71f2 | G63–100 (2操作, required 63/100) | S386 (1操作, required 386) | 3 | PA (1) |
| 070a1222 | dual_blades / water | 新規N474 (349–474) | G77 (1操作, required 77) | S791 (1操作, required 791) | 128 | CS |
| 0d98b225 | dual_blades / dragon | 所持 8bac3ee0 | G201 (1操作, required 201) | — | 1 | CS |
| 155a6831 | dual_blades / dragon | 所持 533b92bb | G117 (1操作, required 117) | — | 1 | CS |
| 15829bfe | dual_blades / water | 所持 4e80c02d | G106–212 (2操作, required 106/212) | — | 2 | PA (1) |
| 188571a7 | dual_blades / ice | 所持 e3a29191 | G71 (1操作, required 71) | S786 (1操作, required 786) | 2 | CS |
| 1d916ff0 | heavy_bowgun / thunder | 所持 c09a85a3 | G73–84 (2操作, required 73/84) | — | 2 | PA (1) |
| 1efa01c6 | great_sword / paralysis | 所持 95a1b045 | G137 (1操作, required 137) | S757 (1操作, required 757) | 2 | CS |
| 1f121742 | dual_blades / fire | 所持 d508b91b | G107–144 (2操作, required 107/144) | S854 (1操作, required 854) | 3 | PA (2) |
| 2123eaa6 | great_sword / fire | 所持 f86e1dac | G74 (1操作, required 74) | — | 1 | CS |
| 2378d3e0 | dual_blades / water | 所持 541efaa0 | G287 (1操作, required 287) | S892 (1操作, required 892) | 2 | CS |
| 27ac3237 | dual_blades / thunder | 所持 870c1051 | G149–247 (2操作, required 149/247) | — | 2 | PA (1) |
| 2e26c0b1 | dual_blades / fire | 新規N470 | G98 (1操作, required 98) | S422 (1操作, required 422) | 3 | CS |
| 45b13c06 | dual_blades / ice | 所持 192573eb | G235–277 (2操作, required 235/277) | S708 (1操作, required 708) | 3 | PA (1) |
| 46bf2c78 | great_sword / fire | 所持 8e57b313 | G101–288 (2操作, required 101/288) | — | 2 | PA (1) |
| 57126a5e | great_sword / paralysis | 所持 4340b7e3 | G219 (1操作, required 219) | — | 1 | CS |
| 6c65c924 | switch_axe / paralysis | 新規N0 | G72–267 (2操作, required 72/267) | S410 (1操作, required 410) | 4 | PA (1) |
| 711f7d15 | charge_blade / fire | 新規N0 | G55–289 (235操作, required 289) | S399 (1操作, required 399) | 237 | CS |
| 813fb479 | charge_blade / dragon | 新規N206 (0–206) | G230 (1操作, required 230) | S478 (1操作, required 478) | 209 | CS |
| 820831d0 | sword_and_shield / ice | 所持 246cc02e | G198–253 (2操作, required 198/253) | S343 (1操作, required 343) | 3 | PA (4) |
| 86439c85 | dual_blades / ice | 所持 c03a0d0e | G133–193 (2操作, required 133/193) | S740 (1操作, required 740) | 3 | PA (2) |
| 8d233d8b | sword_and_shield / thunder | 所持 2230977f | G210 (1操作, required 210) | S341 (1操作, required 341) | 2 | CS |
| 9733b090 | heavy_bowgun / water | 所持 7b347758 | G146–165 (2操作, required 146/165) | — | 2 | PA (3) |
| 9d817a9b | dual_blades / ice | 所持 da8d7cf3 | G125 (1操作, required 125) | S648 (1操作, required 648) | 2 | CS |
| a26f6bcf | dual_blades / thunder | 所持 0d13daed | G216 (1操作, required 216) | — | 1 | CS |
| a367c177 | great_sword / dragon | 所持 a801b133 | G113 (1操作, required 113) | S341–1423 (1083操作, required 1423) | 1084 | CS |
| a6c17e25 | dual_blades / fire | 所持 5749b7fb | G116–161 (2操作, required 116/161) | S588 (1操作, required 588) | 3 | PA (2) |
| a830a376 | dual_blades / water | 新規N367 | G130 (1操作, required 130) | S396 (1操作, required 396) | 3 | CS |
| aa4e67d8 | dual_blades / thunder | 所持 346dfc0f | G170 (1操作, required 170) | — | 1 | CS |
| b27e57a7 | dual_blades / thunder | 所持 701736da | G153 (1操作, required 153) | S566 (1操作, required 566) | 2 | CS |
| b4f252cd | dual_blades / dragon | 所持 31f07927 | G242 (1操作, required 242) | — | 1 | CS |
| b6780f04 | dual_blades / fire | 所持 dc4f742c | G164 (1操作, required 164) | S485 (1操作, required 485) | 2 | CS |
| be881717 | great_sword / dragon | 所持 1fef53b8 | G67–269 (2操作, required 67/269) | — | 2 | PA (1) |
| c140578c | dual_blades / thunder | 所持 40bea7a9 | G70–168 (2操作, required 70/168) | — | 2 | PA (1) |
| cbdf9d8f | dual_blades / ice | 新規N413 | G88 (1操作, required 88) | S378 (1操作, required 378) | 3 | CS |
| d453ca34 | dual_blades / dragon | 所持 eb7e92b9 | G76 (1操作, required 76) | S887 (1操作, required 887) | 2 | CS |
| d45a7d4e | dual_blades / fire | 所持 a754e5bd | G194–202 (2操作, required 194/202) | — | 2 | PA (1) |
| e4147de7 | great_sword / blast | 所持 b17b1c2a | G179 (1操作, required 179) | S508 (1操作, required 508) | 2 | CS |
| e523209e | sword_and_shield / dragon | 所持 99a69d14 | G69–96 (2操作, required 69/96) | S348 (1操作, required 348) | 3 | PA (1) |
| e96249b4 | hammer / paralysis | 所持 f3189ef9 | G94–211 (2操作, required 94/211) | — | 2 | PA (1) |
| f5d20af4 | dual_blades / dragon | 所持 ac3a59f5 | G85 (1操作, required 85) | — | 1 | CS |
| fea60316 | dual_blades / dragon | 所持 d787f5b6 | G159–224 (2操作, required 159/224) | — | 2 | PA (1) |

## 7. lower-bound監査

`plannerGlobalLowerBound.ts`。oracleを読まず、PlannerInput・RNG Engine・MasterのSkill ID一覧だけから計算する。

### 7.0 前提（`LOWER_BOUND_ASSUMPTIONS`）

前提3（distinct source）はProduction一般のsemanticsではなく、7.0.1の監査で対象PlannerInputごとに確認する前提である。
それ以外（1・2・4〜8）は現在のProduction semantics（RngEngine advance、RouteOperation集合、Ideal判定、source規則）から来る。

1. 物理操作はちょうど1つのCounterをちょうど1進める（create count c = c回のforge、巨戟化とReset Skills = Skill、Reset / Keep = Gogma）。
   `confirm_owned_ideal` は物理操作でない。
2. Counterは減らず物理操作でしか進まない。よって **physical operation数 = Σ stream advance**（RouteOperation / PlanStepの定義による）。
3. （対象PlannerInputで検証する前提）1つの武器状態で2つのplanning TargetのIdealを同時に満たせるペアが無い（7.0.1）。
   このとき各Targetは自分の完成武器を要する（Ideal完成は武器を保護するので、完成後に別Target向けへ変わることもない）。
   武器はそれぞれ1つのsource（種別・属性が一致する所持武器（未保護、または保護済みで既にIdealなら操作なし）か、
   その種別のNormal位置1つでforgeした新規Normalを巨戟化したもの）から来るので、sourceは互いに異なる。
4. 完成武器はIdeal Bonus（`gogma_artian` scopeの完全一致）とIdeal Skill条件を満たす。
5. 最終Skillは、所持Gogmaの現在Skillのままか、最後のSkill操作（巨戟化とReset Skillsは同じ位置で同じSkillを引く）の位置pの予測。
6. 最終Bonusは、所持Gogmaの現在値のままか、最後のBonus操作の位置gで、Idealを出すReset、または読むfamily layout
   （source自身か、g1 < gのResetの結果。Keepはlayoutを保つ）からIdealを出すKeep。
7. Keepの結果はSeed・種別・属性・位置・順序付きfamily layoutだけで決まる（Production Keepはfamilyだけを読む）。
8. Engineがunsupportedを返す予測はProduction操作ではない。

緩和で捨てるもの: 同一Counter位置の排他、stream間の時間順序、Routeの連続性、shareability。前提3が成り立つPlannerInputでは、
任意のPlanの終端Counterが緩和の条件を満たすので、緩和の最小値は真の最小値以下である。前提3が成り立たない
（cross satisfaction可能ペアがある）PlannerInputでは、1本の武器で2 Targetを完成させるPlanが緩和の外にあり得るので、
`solveLowerBoundRelaxation()` は `not_applicable` を返して下限を主張しない（fail closed。単一stream下限もnullにする）。

### 7.0.1 cross satisfaction監査（distinct sourceの前提確認）

Production Plannerには **cross satisfaction** がある。あるEntryで完成した武器が別TargetのIdealも満たすと、その別Targetは
充足済み（`hasIdeal`）になり、そのEntryは実行されない（schedulerの `released`、rejectionの `candidate_already_satisfied`。
`deriveTargetSatisfaction()`、`plannerDeterministicScheduler.ts`、ISSUE_103設計 6.8 / 8.4）。したがって「各Targetに別々の
sourceが要る」はProduction一般の制約ではなく、Productionのcross satisfaction挙動も本Phaseでは一切変更していない。

`auditCrossSatisfaction()` は、対象PlannerInputのplanning Targetの全ペアについて、1つの完成武器状態で両方のIdealを満たせるかを
Productionのauthorityだけで判定する（Bonus / Skillの包含規則を再実装しない）:

- 武器がTargetを満たすのは種別・属性が一致するときだけ（`deriveTargetSatisfaction()` と同じ条件）。
- Idealの判定は `satisfiesIdealTarget()`（`satisfiesIdealBonuses()` = `gogma_artian` scopeの5枠完全一致、
  `evaluateSkillCondition()` = 指定したSeries / Group条件）。上位ランク互換のような独自規則は入れない。
- 候補のBonus状態は両Target自身のIdeal集合（`gogma_artian` scope）。現行authorityではIdealを満たす状態はそのTargetのIdeal集合
  そのものなので、これで網羅になる。候補のSkill状態は、MasterのSeries全25件・Group全17件（無効化されたものを含む）、
  両条件が名指しするID、`null` の全組合せ（今回はSeries 26 × Group 18）。

実Exportの結果（`lowerBound.crossSatisfaction`、PlannerInput / Target / Master / Production evaluatorから導出）:

| 項目 | 値 |
| --- | ---: |
| planning Target | 43 |
| 種別・属性が一致するTargetペア | 54 |
| **1つの武器状態で両方のIdealを満たせるペア（possiblePairCount）** | **0** |
| distinct sourceの前提（`distinctSourcePreconditionHolds`） | true |

54ペアはいずれも、Ideal Bonusの完全一致が成り立たないか、Skill条件を同時に満たす状態が無い。よって今回のPlannerInputでは
各Targetに別々の完成武器 = 別々のsourceが要り、distinct-source matchingによる下限をこのExportへ適用できる。
これはExport固有に検証された前提であり、可能ペアが1件でもあるPlannerInputでは同じ下限を最小性の根拠に使わない。

### 7.1 Skill下限（単独で強制）

大剣龍 `a367c177` の理想Skill（verified_24 + apex）は、S341以降で **S1423が初出**（S1997まで走査）。同じ種別・属性の所持武器
（1fef53b8: verified_21 / apex、a801b133: verified_24 / verified_02）はどちらも理想Skillを持たないので、どのsourceでも
S1423以降でSkill操作が要る。**どの有効な構成でもSkill Counterは1424以上 → Skill操作 ≥ 1,083**。これは単独で成り立つ。
巨戟化位置をずらしても、同じ位置で同じSkillを引くので回避できない。

### 7.2 Gogma下限（単独では強制されない）

単一streamの下限は **170**（双剣龍 b4f252cd がG225以上を要する）。235は単独では強制されない。

235が効くのは同時最小化の中である。チャアク龍は（budget内では）N206・N849・N886・N1150のNormalからしか理想に届かず、
その場合のKeep位置は早い（G55付近）。チャアク火はN206を龍に譲ると、G289のReset（Normalの5枠を読まない）まで待つか、
N206より後のKeep可能なNormalまでチャアクの作製を延ばすかになる。緩和の最小ではG289 Resetが最安で、G終端 = 290 になる。
G ≤ 289 の閾値では、合計1,687以下の実行可能な閾値は存在しない（`nearMinimum`）。

### 7.3 Normal下限（チャアク207とスラアク1だけが単独で強制）

単一streamの下限は チャアク207・スラアク1・他0（合計208）。

- チャアク207: 上記のとおり龍はN206（またはさらに後）でしか完成しない。**火も龍もNormal起点しかない**（チャアク所持武器なし）ので、
  「両方をNormal起点にする」以外の選択はない。火を龍より前のNormal（N0）にしても、龍のN206はチャアクCounterを207まで進める。
- スラアク1: 所持武器が無く、Normalを最低1回作る。
- 双剣126・片手剣5: 所持武器を使えばGogmaを後ろへ延ばして回避できるので単独では強制されない。双剣水 070a1222 は
  Gogma ≤ 289では新規N474でしか完成せず、双剣126を強制する。これを避けて所持武器8506a28aを使うにはG ≥ 431が必要で、
  合計は **1,672**（双剣0、Gogma 376）になり1,657より悪い。

### 7.4 加算可能性（証明の本体）

前提1・2により、どのPlanについても physical operation数 = (S終端 − 341) + (G終端 − 55) + Σ_w (N_w終端 − N_w origin) が
**恒等的に** 成り立つ（1操作が2 streamを同時に進めることはなく、巨戟化はSkillだけを進める。二重計上はない）。
ただし各項の下限を別々に取って足すことはできない（7.2・7.3のとおりGogmaとNormalはtrade-offする）。

そこで閾値ベクトル (S, G, N_w) を変数とし、「全Targetが、閾値の内側に収まるoptionを、互いに異なるsource
（所持武器 / Normal位置。種別ごとの二部マッチング）で持てる」ことを条件に、上式を最小化した（`solveLowerBoundRelaxation()`）。
今回のPlannerInputではcross satisfaction可能ペアが0件なので（7.0.1）、任意のPlanの終端Counterはこの条件を満たし、
最小値はPlanの物理操作数の下限である。

- 網羅性: 合計 < 1,658 のPlanでは各streamのadvanceも < 1,658 なので、各streamを originから1,657位置だけ走査すれば
  必要なoptionをすべて含む（Skill 341〜1997、Gogma 55〜1711、各Normal origin〜+1,657）。optionの閾値値だけを試せば十分で、
  N_wは閾値の単調性から二分探索で最小化した。
- 結果: **最小 = 1,657**（S 1424、G 290、チャアク207、双剣126、片手剣5、スラアク1、他0）。次点は1,669（G 302）、
  1,672（G 431、双剣0）。

実行可能な1,657のProductionPlan（6章）が存在するので、**1,657は下限を達成する最小値** である。この結論は
「cross satisfaction可能ペア0件（7.0.1）→ distinct source → 緩和の最小1,657 ≤ 任意のPlan → 1,657のPlanが実在」
という順で、このExportについて自己完結している。

### 7.5 証明の限定

- 前提1・2・4〜8は現在のProduction semantics（RngEngine advance、RouteOperation集合、Ideal判定、source規則）による。
  前提3（distinct source）はProduction一般の制約ではなく、このExportでcross satisfaction可能ペア0件を検証したことによる。
  別のPlannerInputでは7.0.1の監査を再実行し、可能ペアがあれば本下限を最小性の根拠にしない。
  将来Route操作・資源・Ideal判定の意味が変われば再監査が必要。
- 物理操作数だけを目的とする。Plan steps中のweapon switch、所要時間、アイテム素材 / 費用は最適化していない。
- 走査はProduction Engineそのものを使い、RNGの検証状態（reference-verified / game-verified / category-level adoption）は変えない。
  Production予測が実機と異なる条件があれば、実機での最短性は保証しない。

## 8. 実行方法・環境・証跡

```powershell
node --max-old-space-size=8192 scripts/run-planner-global-oracle-1657.mjs --export "<外部Exportの絶対path>" --output "<新規JSON>"
```

- runnerはExport SHA-256がoracleのExportと一致しなければ拒否し、outputを新規作成でのみ書く。Vite SSR loaderで既存TypeScriptを
  直接実行する（**Browser Workerではない**）。
- 正式測定: 2026-09-28、measured HEAD `90edfeb4a288e545379b68eb2b473e5359fd8a59`（cross satisfaction監査を加えたResearch codeの
  commit、未commit codeなし）、Windows 11 x64、Node v24.19.0、Ryzen 7 9700X（16 logical）。elapsed: Stage A 0.18秒、
  Stage B 49.5秒（Planner Alternative Searchを含む）、Stage C 9.0秒（Planner 8.1秒）、下限監査（cross satisfaction監査を含む）240.2秒。
  測定は1回で分布は未測定。
- 前回の測定（HEAD `745e761`、cross satisfaction監査なし）はこの測定で置き換えた。Stage A / B / Cの結果、manifest・Entries・Plan hash、
  下限1,657は前回と同一である。
- raw evidence: [PLANNER_GLOBAL_1657_ORACLE_RESULT.json](PLANNER_GLOBAL_1657_ORACLE_RESULT.json)。Export SHA、HEAD、RNG Engine、
  CalculationContext、Target別Route（source、Normal / Gogma / Skill位置とrequired、最終Bonus・Skill、Candidate / Entry ID、
  estimate）、Gogma全usage、Skill / Normalのrequired usage、Planner summary、Trace Replay、下限監査（前提、Target別最小閾値、
  緩和の最小と近傍、単一stream下限、`crossSatisfaction`（ペア数・可能ペア一覧（今回は空）・Skill候補数・前提成立））。
  Plan全文・Export全文は含まない。
- hash（`sha256(JSON.stringify(value))`）: manifest `ffb6db5a…73cc`、Entries `d3fcbb2e…a43e`、Plan `90fbba66…eabf`、
  result `765d4e82…04d1`（Planner summaryのelapsedを含むので測定ごとに変わる）、semantic `aa6be949…3a1e`
  （cross satisfaction監査を含む）。

## 9. テスト

- `plannerGlobalOracle1657.test.ts`: Production / 他Research / 他scriptがoracleと下限moduleをimportしないこと、43 Target ID・
  35 OwnedWeapon ID・Export hashがそれらに現れないこと、verifier / 下限moduleがoracle dataを持たないこと、runnerが
  `new ProductionRngEngine()` だけを使うこと、version / default不変、manifestのstream合計（1,083 / 235）とrequired再導出、
  区間展開、skip規則（Reset連鎖・R→K・K→R・保持Keep・巨戟化・Counter進行forge）とPlannerのroute unit authorityの一致、
  合成fixtureでのStage A（Counter連続性・source重複・required重複・gap・required不一致・予測失敗の検出）、
  Stage B（Candidate Search / Planner Alternative Search）、Stage C（Trace Replay）、verdictが下限一致のときだけ最小と呼ぶこと。
- `plannerGlobalLowerBound.test.ts`: 閾値合計、source排他（マッチング）、単一stream下限を加算しないこと、option無しの扱い、
  budget以上を最小と呼ばないこと、合成fixtureでは緩和が4 < 実際6になり **最小と判定しない** こと、未確定Normal Counterでfail closed。
  cross satisfaction: 同種別・同属性・Ideal Bonus完全一致でSkill条件に共通充足状態がある2 Target（Series S1 + Group G1 と Group G1のみ、
  Skill無条件同士）は可能ペアになる。Bonusが同じTypeでRankだけ違う（下位Targetへ上位Rankを当てない）・Typeが違う・個数が違う、
  Skill条件が交差しない、属性が違う場合は可能ペアにならない。可能ペアがあると下限は `not_applicable`・単一stream下限null・
  他が完全に検証済みでもverdictは `validated_oracle`（ペアを除けば同じ閾値で下限が出ることも確認し、前提だけが判定を分けることを固定）。
- `plannerGlobalOracle1657.test.ts` は、commitした正式evidenceが `proven_minimum`、cross satisfaction可能ペア0件（空配列）、
  前提成立、下限1,657、Stage C 1,657 steps / Conflict 0 / Trace Replay validであることも確認する。

## 10. Phase 2-Bへ引き継ぐこと

比較対象は **8,534（autonomous Research）/ 2,982（historical oracle）/ 1,657（proven minimum）**。Phase 2-Bでは
scheduler / Trace Replay / projection / tail / Browser応答性 / memoryの分解に加え、8,534と1,657の差6,877 stepsを
source・Target・RouteKind・stream・retained / generated・所持 / 新規Normalへ帰属させる。本Phaseでは最適化実装をしていない。

今回の結果から分かったgenericな論点（oracle値のhard-codeではなく、将来のalgorithmの設計論点）:

- **held位置を跨ぐRoute（Resetして保持し後でKeep）が最短解に必須**。通常Candidate Searchの連続Routeだけでは1,657に届かない。
- 単Targetで短いCandidateが全体最適とは限らない（チャアク火は単体ではN206 Keepが短いが、全体ではN0 → G289 Resetになる）。
- 所持武器を使うかNormalを作るかはGogma終端とのtrade-off（双剣126 forge vs Gogma +141）。
- schedulerの被覆条件（streamの各位置にunitが必要）を、長いskip可能連鎖を持つRouteが満たしている。
- 物理操作数の下限計算（到達表 + 閾値緩和 + マッチング）は約3.5分で、探索の評価基準・打ち切り基準として使える可能性がある。
  ただし前提の範囲外（未確定Normal Counter等）ではfail closedする。
