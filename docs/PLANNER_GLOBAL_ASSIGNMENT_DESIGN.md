# Global Planner Global Assignment設計（oracle非依存の全Target資源割当）

Refs #154。**docs-only**。基準main: PR #236 merged `e444f5033b70fe695d90f8610fcb68b4ef0091dd`（作業開始時に
`main` / `origin/main` / HEADの一致、Working Tree clean、stash / worktreeなしを確認）。

本書は、Phase 2-A.5で検証された1,657-step最短解の構成原理を一般化し、oracleに依存せず全planning Targetの資源
（source OwnedWeapon、新規Normal位置、Skill / Gogmaの必須Counter位置）を同時に割り当てる **Global Assignment**
アルゴリズムのResearch設計である。Search実行、アルゴリズム実装、formal measurement、Production変更は行っていない
（本PRのProduction changed files = `[]`。変更はdocs 2 fileのみ）。

## 0. 位置づけとauthority

本書はResearch設計文書であり、正式仕様ではない。authorityは `AGENTS.md` の順位どおり
`docs/REQUIREMENTS.md`（19 / 20 / 23 / 23.1）→ `docs/PLANNER_SPEC.md`（4.1、7.0 / 7.0.2 / 7.0.4、9.2.19）→
`docs/SEARCH_SPEC.md`（3.1、5.6.3、5.6.8）→ `docs/RNG_SPEC.md` → `docs/DATA_MODEL.md`（9.2、9.4.1）→ その他正式文書 →
現行実装・test → Research文書である。本書の記述が正式仕様と食い違って見える場合は正式仕様が優先し、本書は現行Production semantics
（REQUIREMENTS 19 / 23の「明示的な選択が無い競合は自動で再検索しない」契約、PLANNER_SPEC 7のRoute commitment + 決定的scheduler、
9.2.19の1段repair）を一切変更しない。

Research authorityの順位（本設計の中で矛盾があれば上を優先する）:

1. 本書
2. [Phase 2-C2.7-A](PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_PHASE2C27A.md) のguardrail G1〜G12（speculative contextとuser-fixed Routeの区別、
   oracle-free execution、budget概念の分離、timeout / OOMをnot-foundに読み替えない）
3. [Phase 2-A.5](PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_PHASE2A5.md)（1,657 oracleの再構成手順と下限監査）、
   [Phase 2-B](PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_PHASE2B.md)（8,534と1,657の差の分解）、
   [P0R](PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_P0R.md)（Phase 0未完成Targetの原因）

本書で **確認済み** として挙げる関数名・型名は、2026-10-12時点の基準main `e444f50` のsourceで存在と署名を確認したものである
（§2.6）。新規に提案するデータ構造・関数名は **提案** であり、実装Phaseで綴りを変えてよいが、§4〜§9の意味と不変条件を変えてはならない。
変える必要が生じた場合は、そのPhaseの実装前に本書を更新する（docs PR）。

## 1. 背景・目的・達成済み事項

### 1.1 達成済み事項（既存formal RESULT、再計算していない）

同じ実Export（`gogma-artian-planner-backup_20260927015837.json`、SHA-256 `cc35fb5b…e1e6b`、43 planning Target / 43 Entry /
40 OwnedWeapon、origin Skill 341 / Gogma 55）に対して、次が検証済みである。

| 項目 | 自動構成（Phase 1-E / 2-A、P0Rで現行main再現） | 既知の最短解（Phase 2-A.5 oracle） |
| --- | --- | --- |
| completed / planning Target | **43 / 43** | **43 / 43** |
| Conflict / rejected（resource_conflict） | 0 / 0 | 0 / 0 |
| termination | completed | completed |
| Trace Replay | passed | passed |
| ProductionPlan.steps（= physical operations） | **8,534** | **1,657** |
| oracle Routeを探索入力に使用 | しない | （oracle自体。Route本体はProduction Searchから取得） |
| 最短性 | 主張しない | **このExport・現行Production semanticsで証明済み**（下限1,657 = 実行可能解） |
| Normal 2倍fallback | 1回（813fb479、N849） | なし |

両者の差 **6,877** はPhase 2-Bで機械的に完全分解されている（§1.2）。歴史的な比較対象として2,982（Issue #154記載、Route詳細はRepositoryに無い）がある。

### 1.2 6,877の解釈（Phase 2-Bの事実）

8,534と1,657はいずれも **physical operation数** であり、両Planで `physical operations = Σ_stream (終端 − origin)` が恒等的に成立する
（Phase 2-A.5 7.4 / Phase 2-B 6.4。1物理操作はちょうど1つのCounterをちょうど1進める）。差6,877は **stream終端の差** に等しい:
Skill +2,933（1,424 → 4,357）、Gogma +2,875（290 → 3,165）、Normal +1,069（チャアク +643、スラアク +241、大剣 +121、双剣 +51、片手剣 +13）。
Route operationの単純和の差（11,072 − 1,745 = 9,327）はphysical差ではない（Route operationには他Routeがsilent fast-forwardする
skip可能unitが含まれる）。

構造要因（Phase 2-B 6.6 / 7 / 11、P0R 2.4）:

| 要因 | 内容 |
| --- | --- |
| sequential projection | retained 20 Routeの後、残り23 Targetを1件ずつ「直前までのPlanを適用した射影状態」から検索し、生成Routeの全37 stream区間がfrontier以降から始まった（37 / 37） |
| source選択 | 17 TargetでsourceがOracleと異なる（所持 ↔ 新規Normal、別の所持武器、別のNormal位置） |
| Normal位置 | Normal超過1,069はほぼ新規Normal位置の選択で決まる（チャアクN849 vs N0 / N206、スラアクN241 vs N0） |
| held位置を跨ぐRoute | 1,657の18 RouteはReset→保持→Keepなど非連続Route（Planner Alternative Searchでmaterialize） |
| stream被覆の共有 | 1,657では42 Gogma Route / 23 Skill Routeがstream originより後から始まり、他Routeの被覆に依存する |
| 複数Targetの同時割当 | Skill超過は14 Target、Gogma超過は24 Targetに分散し、1件ずつの置換では縮まない（静的peel） |
| Normal排他資源 | 同条件2 Target（チャアク火 / 龍）が族構成一致Normal位置206を奪い合う（P0R）。oracleは火をN0 → G289 Reset連鎖、龍をN206 → G230 Keepとして両立させた |

### 1.3 目的

1. 全planning Targetの共存Route集合を、oracleを実行入力に使わずに自動構成する能力を **維持** する（既存incumbent 8,534 stepsに対し、8,534未満だけを
   操作数改善、同数を同等、超を劣ると呼ぶ。§13.2）
2. 1,657の構成原理（**先にRNG位置と資源を割り当て、後からRouteを構成する**）を、任意のPlannerInputへ適用できる一般アルゴリズムとして設計する
3. 物理操作数・時間・メモリを、C2 / D2系列のOOM / timeoutを繰り返さない構造で改善できる道筋を示す
4. Production契約変更が必要な範囲を明確に分離する（§16）

### 1.4 用語

| 用語 | 意味 |
| --- | --- |
| planning Target | Productionと同じ規則（PLANNER_SPEC 4.1）で決まる計画対象Target: `validatePlannerInput().validBuildListEntries` を持つ `isTargetWeaponPlanningEligible()` なTarget（`derivePlannerPlanningTargets()`）。本設計の完成数の分母はこの集合であり、active Target全体ではない（§4.1） |
| physical operation | Counterをちょうど1進めるProductionPlanのStep。`confirm_owned_ideal` は含まない |
| stream | Skill Counter、Gogma Counter、武器種別ごとのレア8 Normal Counter（`<weaponTypeId>:8`） |
| stream終端 | そのstreamで最後に消費した位置 + 1。Planの物理操作数 = Σ（終端 − origin） |
| required unit | `canSkipWhenCounterPassed = false` のRoute unit（PLANNER_SPEC 7.0.2）。他Entryの操作で代替できない |
| skippable unit | `canSkipWhenCounterPassed = true` のunit（Reset→Reset、Keep→Reset、Keep→Keep、Reset Skills→Reset Skills、Normalの進行用forge） |
| held / blocked | Planner Alternative Searchのreservation（PLANNER_SPEC 9.2.19.3）。heldは他Routeの操作で進む位置、blockedは必須かつ共有不可の位置 |
| reach option（到達option） | 1 Targetについて「このsourceと、これらのrequired位置でIdealへ届く」という必要条件の記録（§5）。Routeではない |
| assignment（割当） | 全planning Targetへ1件ずつoptionを対応させ、排他制約を満たすもの（§6） |
| coverage（被覆） | 各streamのoriginから終端までの全位置に、割り当てたRoute集合のunitが1つ以上存在すること（§8） |
| coverer | ある区間を自分のskippable unit連鎖（chain）で被覆するTarget |
| speculative reservation | Research上の仮割当から導出したreservation。user-fixed Routeではない（Phase 2-C2.7-A G1） |

## 2. 既存研究の整理

### 2.1 Phase 2-A.5（1,657 oracleの再構成と下限）

再構成の手順はそのまま本設計の原型である。

1. **到達表**: 各Targetについて、Production RNGで理想Skillの初出位置、位置ごとのReset結果、Idealのfamily layout全順列に対するKeep結果、
   各Normal位置の5枠を計算した
2. **閾値**: 緩和問題（§2.6の `solveLowerBoundRelaxation()`）を解き、Skill 1424 / Gogma 290 / Normal終端（チャアク207、双剣475、片手剣12、スラアク1）を得た
3. **排他割当**: 閾値の内側で、各Targetのsourceとrequired位置がstreamごとに重複しない割当をbacktracking（MRV + 乱数restart、新規Normal数に上限、
   所持武器優先）で探した（所持35 / 新規Normal 8）
4. **Route形**: required unitの間をskippable unitで埋め、各streamをoriginから終端まで被覆するRouteを1本ずつ持たせた
   （Gogma 55〜289 = チャアク火のReset連鎖、Skill 341〜1423 = a367c177のReset Skills連鎖、Normalは種別ごとに最大production targetのRoute）
5. **materialize**: Route本体は常にProduction Search Domainの出力（Candidate Search 25件、Planner Alternative Search 18件）。manifestは結果の区間表記

手順3のscratch toolはRepositoryに無い。本書はそれを「再現済みの一般アルゴリズム」とは扱わず、§6で改めて設計する（乱数restartは採用しない）。

下限監査の重要な限定: 「各Targetに別々のsourceが要る」（distinct source）はProduction一般の制約ではなく、`auditCrossSatisfaction()` が
可能ペア0件を確認したPlannerInputに限って適用できる（7.0.1）。単一stream下限（Skill 1,083 / Gogma 170 / Normal 208）の加算は証明ではない。

### 2.2 Phase 2-B（差の分解と必要能力）

Phase 2-Bが整理した必要能力は本設計の要件表である（11章の1〜7）: Planner-start originから他Targetの位置予約を考慮して候補を作る、held位置を跨ぐRoute、
Targetごとに複数候補を同時に持って全体で割り当てる、stream終端の和でRouteを選ぶ、stream被覆を前提にした評価、多Targetに分散した終端の同時最適化、
performance。

### 2.3 Phase 2-C1 / 2-C2 / D1 / D2系列

| Phase | 事実 | 本設計への含意 |
| --- | --- | --- |
| 2-C1 | sequential projectionを外しPlanner-start originからcanonical 1件 / Targetで検索すると元Build Listへ戻り、Conflict 21（Gogma 15 / Skill 3 / owned 2 / Normal 1）が再出現。required位置の静的重複件数とConflict件数が一致 | canonical 1件は共有streamの早い位置へ集中する。共存にはTargetごとの複数optionと排他割当が要る |
| 2-C2 | Conflict orientationごとにPlanner Alternative kernelでportfolioを作る方式は、54 orientation中43がheap 8 GBでOOM。探索できた範囲ではportfolio > 1が80% | full Routeを先に列挙するportfolio方式はSearch規模で破綻し得る |
| D1 / D2-B〜F | 1 fixed winner reservation・K1 / K2 / K3 support contextでの局所探索。最良incumbent 24 / 43・Conflict 19。K3 L2はOOM | 局所的な共存評価の積み重ねでは43 / 43へ届かず、contextの形でSearch規模が爆発する |
| D2-G-A | K3 L2 OOMの主因候補はSkill held-aware streamの全depth保持（conversion位置306 × depth × 約300 state、モデル6,081万state）。**Search規模（conversion位置数、Skill保持state、Gogma held幅）はreservationとextentだけからSearch前に計算できる** | materialization前にSearch規模を事前計算しgateにする（§9.7）。巨戟化位置候補の少ない方式を先に試す動機（§9.3） |
| P0R | 813fb479未完成の原因は、同条件の火Targetが族構成一致Normal 206を先に消費し、龍の投影窓207〜556に次の一致位置849が無いこと。N849は43 / 43の一般的な必要条件ではない | 同じ資源を要求する複数Targetの割当は、順序ではなく排他制約として同時に決める |

### 2.4 Phase 2-C2.7-A（guardrail）

本設計はPhase 2-C2.7-AのG1〜G12を継承する。特に:

- **G1**: Research上の仮割当（speculative reservation）をuser-fixed Route、`PlannerConflictResolution`、explicit resolution、repair lineage、
  PlanConflictの `selectedBuildListEntryId` へ書かない
- **G2 / 2.4**: oracle情報（Target別Route、source ID、Normal / Skill / Gogma位置、Candidate / Entry ID、Target順序、Target個別extent、manifestの割当）を
  scheduler / Search / solverの実行入力にしない。post-hoc analyzerだけが読む
- **G5 / G12**: Search extent、node budget、Planner rerun budget、wall-clock envelope、`maxPlanSteps`（Domain default 1000 / Planner Alternative runtime導出 /
  Research 20000）を別概念として扱う
- **G6 / G7**: timeout / OOM / process failure / 未実行をCandidate 0、not found、「解が存在しない」へ読み替えない

### 2.5 既存実装資産と責務

| module | 責務（確認済み） | 本設計での扱い |
| --- | --- | --- |
| `src/benchmarks/plannerGlobalLowerBound.ts` | `auditCrossSatisfaction()`（distinct source前提の監査）、`collectLowerBoundProblem()`（Target別の閾値option: `owned:<id>` / `normal:<type>:<pos>` resourceと `skillThreshold` / `gogmaThreshold` / `normalThreshold`）、`solveLowerBoundRelaxation()`（閾値ベクトルの最小化 + 二部マッチング、`found` / `none_below_budget` / `not_applicable`）、`provenLowerBoundTotal()`、`singleStreamLowerBounds()`。**実行可能Route集合を返すsolverではない**: 同一位置の排他、stream間順序、Route形、被覆を捨てた緩和である | §10の下限authority。Phase Aの到達表は同じ走査を位置集合へ一般化する（§5.7） |
| `src/benchmarks/plannerGlobalOracle1657Manifest.ts` / `plannerGlobalOracle1657.ts` | 1,657 oracleのmanifest（Target ID / OwnedWeapon ID / 位置をhard-code）とStage A / B / C verifier | **実行時に一切読まない**。post-hoc analyzerの比較対象だけ（§11） |
| `src/benchmarks/plannerGlobalOptimizationResearch.ts` | Phase 0 prototype。`materializeGlobalResearchCandidate()`（射影起点のCandidateをorigin reachでPlanner-start originのEntryへ再構築）、`globalResearchInputFromExport()`、`runGlobalPlannerResearch()` | 入力構築とCandidate Search経由materializationの既存adapterを再利用（§9.2） |
| `src/benchmarks/plannerGlobalPhase0Missing.ts` | `mapGlobalResearchTargetResources()`（必要条件の位置一覧: 族構成一致Normal、族構成一致 / Ideal Reset、Ideal Skill）、`verifyGlobalResearchFreshPlan()`（別processのfresh ordinary Planner検証） | Phase Aの前身。fresh検証はPhase Dの成功条件(b)に再利用 |
| `src/benchmarks/plannerGlobalPhase2BPlan.ts` | `summarizePlanPhysical()`（Planのphysical operation / stream advance、恒等式のassert） | Phase Dの目的関数検算 |
| `src/domain/planner/plannerRouteProgress.ts` | `createPlannerRouteUnitPlans()`（`PlannerRouteUnit`: `counterStream` / `counterId` / `counterBefore` / `counterAfter` / `physicalActionKey` / `shareable` / `exclusiveConsumedOwnedWeaponId` / `canSkipWhenCounterPassed`）、`fastForwardPlannerRouteProgress()`、`arePlannerRouteUnitsShareable()` | required / skippableと共有可否の唯一のauthority（§7） |
| `src/domain/planner/alternative/plannerAlternativeReservation.ts` | `derivePlannerAlternativeReservation(fixedEntries, engine)`: held = fixed unitの位置、blocked = 必須かつ共有不可、排他OwnedWeapon = 参照・排他消費 | materialize済みEntryからのreservation再導出に使う（§7 / §9） |
| `src/domain/search/alternative/` | `visitPlannerAlternativeCandidates()`、`PlannerAlternativeReservation`（`normal[]` / `skill` / `gogma` の `held` / `blocked`、`exclusiveOwnedWeaponIds`）、`PlannerAlternativeSearchExtent`、`normalizePlannerAlternativeReservation()` | 非連続Route・chain Routeのmaterialization（§9.1） |
| `src/domain/search/candidateSearch.ts` / `constrained/constrainedCandidateFactory.ts` | `searchCandidates()`、`createConstrainedCandidate(target, origin, prediction, 'origin_reach')` | 連続Routeのmaterialization（§9.2） |
| `src/domain/planner/replacement/` | `createPlannerStartSearchOrigin()`、`normalizePlannerSearchOrigin()`、`createDeterministicMaterializer()` | 決定的なCandidate / Entry identity（§9.3） |
| `src/domain/planner/productionPlanGeneration.ts` / `plannerTraceReplay.ts` / `plannerValidation.ts` | `createProductionPlanWithObserver()`、`replayPlannerSearchTrace()`、`validatePlannerInput()` | 最終authority（§9.5） |
| `src/domain/rng/gogmaBonusFamily.ts` | `keepFamilyLayout()` / `keepFamilyLayoutKey()`（順序付きlayout）/ `keepFamilyMultisetKey()`（順序なし） | Keep到達の必要条件（§5） |
| `src/domain/target/` | `satisfiesIdealBonuses()`、`satisfiesIdealTarget()`、`evaluateSkillCondition()`、`evaluateTargetSkillMatch()` | Ideal判定の唯一のauthority |
| `RngEngine` | `predictNormalArtian()` / `predictSkills()` / `predictGogmaBonus()` / `getPredictionSupport()` / `advance*Counter()` | 到達表の唯一の予測authority |

### 2.6 本書が確認した事実（source読取）

- `PlannerRouteUnit` のfieldは上表のとおりで、`canSkipWhenCounterPassed` は保存済みRoute semanticsから導出されるPlanner内部属性である
- `derivePlannerAlternativeReservation()` は、v1ではfixed Routeの全required unitがblockedになる（代替Routeが排他OwnedWeaponを使えず、transient Gogmaは
  Entry-local、Normal作成は `shareable: false` のため `alternativeCouldShareFixedUnit()` が常にfalse）
- `judgePlannerAlternativeTrial()` のfound判定は `plan !== null`、明示決定Entryのselected、generatedとfixedを同時participantとするConflictの不在、
  generatedのselectedまたはfixed外Entryとの暫定帰結による除外（`routeCommitment` evidence）だけを読む
- `solveLowerBoundRelaxation()` は `crossSatisfaction.possiblePairCount > 0` で `not_applicable` を返し、下限を主張しない
- Productionのplanning Target集合は `derivePlannerPlanningTargets(targetWeapons, validEntries: ValidatedBuildListEntry[])`
  （`src/domain/planner/plannerPlanningTargets.ts`）が、`validatePlannerInput(input, dependencies).validBuildListEntries` の
  `entry.targetWeaponId` を持つ `isTargetWeaponPlanningEligible()` なTargetだけをTarget ID安定順で返す（PLANNER_SPEC 4.1）。
  valid Entryが0件ならplanning Targetも0件で、active Target全体にはならない。`collectLowerBoundProblem()` / `auditCrossSatisfaction()` は
  `isTargetWeaponPlanningEligible()` だけで対象を決めるので、両集合は全eligible Targetがvalid Entryを持つ入力でだけ一致する（§5.7 / §10.2）
- `PlannerAlternativeSearchSummary.exhausted` は「extent内外とも到達可能なworkが残らずに終わった」、`stoppedByExtent` は「extent内で
  frontierが尽きたが、extent値が到達可能なworkを未読のまま残した」を意味し、両方trueにはならない。consumer stopでは両方falseで、
  `PlannerAlternativeSearchExecution.stoppedByConsumer` が立つ（SEARCH_SPEC 5.6.8、`plannerAlternativeTypes.ts`）。cancelは
  `CandidateSearchError('cancelled')` でrejectされる
- Production deterministic schedulerは、stream位置にcommitted unitが無いのに後方のpending unitがある状態をstall、holding unitがreadyでなく循環待ちになる状態を
  deadlockとして、順位関数最下位のEntryを落とす（ISSUE_103設計 7.8）。holding unitがreadyでない場合は **待つ**（stallではない、7.3）

## 3. 新しいアルゴリズムの全体構成

### 3.1 基本原則

従来の「既存Routeの一部を固定し、競合したTargetだけ再検索し、改善したら次へ進む」（Phase 0の逐次射影、D2系列の局所context）を全体最適化の中心にしない。
代わりに、1,657再構成と同じ順序で考える。

```text
(A) 到達option生成     Production RNGから、各TargetがIdealへ届き得る source × required位置 の必要条件を列挙する
(B) Global Assignment  全Targetへoptionを1件ずつ同時に割り当てる（source排他、required位置排他）。目的関数はΣ stream終端。
                       得られるのは structural candidate（構造的候補）であり、Productionでの成立は未検証
(C) Counter被覆        割当のrequired位置の間を埋められるか（被覆pre-check）を判定し、materializationの順序と、
                       各Targetに期待するRoute形（source、required位置、予測されるchain区間）を確定する
(D) Materialization    Targetを順に、正式なresource reservation（materialize済みEntryから導出）または射影起点で
                       Production Searchへ渡し、返された正規のCandidateの形を照合してEntryにする
(D') Planner検証        全Entryで通常Production Planner + Trace Replayを1回実行する。これが唯一の成立authority。
                       成立した候補だけが verified（bestVerified）になる
(E) 評価・改善         verifiedの物理操作数（= Σ stream終端）を下限と比較し、budget内で改善を続ける
```

最初から完成済みRouteを大量に列挙しない。(A)〜(C)は軽量な位置集合だけを扱い、Route本体は(D)で必要なTarget・必要な形だけをdemand-drivenに
materializeする。

**structural candidateとverifiedの分離（レビューB1）。** (B)〜(C)を通過した完全割当は、source / required位置の排他とCounter被覆pre-checkを
満たすだけの **structural candidate** であり、Production Searchでmaterializeされておらず、Production Plannerでも検証されていない。
(D) / (D')で成立したものだけを **verified** と呼ぶ。未検証のstructural candidateのobjectiveを、他の候補を枝刈りする上界には使わない（§6.3 / §10.1）。
(B)は候補を決定的な順序で1件ずつ生成するgeneratorとして動き、(D) / (D')が不成立のときは探索状態を保持したまま次の候補へ進む（§6.4）。

### 3.2 データフロー

```text
PlannerInput（Planner-start origin）+ ProductionRngEngine + Master
        │
        ▼
[Phase 0] validatePlannerInput() → validBuildListEntries
        │   derivePlannerPlanningTargets(targetWeapons, validBuildListEntries) = planning Target集合（Productionと同じ規則。以後固定）
        │   既存EntryのRoute内容はここで読み終わり、Phase A〜Cへ渡さない
        ▼
[Phase A] ReachTable ── per planning Target: SkillReach / BonusReach / NormalReach（memo付き位置走査、window W）
        │                 per source: SourceCandidate（owned gogma / owned normal / new normal position）
        ▼
[Phase B] Assignment solver（deterministic backtracking + MRV、generator）
        │   入力: ReachTable、排他制約、objective = Σ(終端 − origin)、root lower bound（applicableのとき）、
        │         上界 UB = bestVerified の物理操作数（存在するときだけ。未検証候補のobjectiveは上界にしない）
        │   出力: structural candidate を決定的な順序で1件ずつ（nextStructuralCandidate()）、bestStructural（診断）、探索診断
        ▼
[Phase C] Coverage ── stream別のrequired位置列から gapを求め、被覆pre-check、covererの予測、
        │             materialization順序（Skill被覆依存のtopological順）、Target別の ExpectedRouteShape を確定
        ▼
[Phase D] Materialization ── Phase Cの順序でTargetを1件ずつ:
        │   reservation = derivePlannerAlternativeReservation(materialize済みEntry)（正式な導出。形状制約には使わない）
        │   visitPlannerAlternativeCandidates() / searchCandidates()（射影起点）→ 返されたCandidateの
        │   createPlannerRouteUnitPlans() のrequired位置・source・最終武器を ExpectedRouteShape と照合
        │   → deterministic materializer → BuildListEntry（Planner-start origin）
        │   不一致 / 未確認 / 未実行は typed MaterializationOutcome で区別（§9.6）
        ▼
[Phase D'] createProductionPlanWithObserver()（全43 Entry、conflictResolutions = []、Research maxPlanSteps）
        │   + replayPlannerSearchTrace() + summarizePlanPhysical() + 別processのfresh ordinary Planner
        │   成立 → bestVerified を更新し、UBとしてPhase Bへ返す。不成立 → 候補のoutcomeを記録してPhase Bの次候補へ
        ▼
GlobalAssignmentResult（typed status、bestVerified / bestStructural、下限、候補別outcome、Phase別診断）
        ── post-hoc analyzerだけがoracleと比較
```

### 3.3 再利用するProduction authority（新しい規則を作らない）

| 判断 | authority | 本設計で再実装しないもの |
| --- | --- | --- |
| Ideal判定 | `satisfiesIdealTarget()` / `satisfiesIdealBonuses()` / `evaluateSkillCondition()` | Bonus / Skillの包含規則、上位ランク互換 |
| RNG予測 | `RngEngine` の公開API（`getPredictionSupport()` でunsupportedを除外） | 抽選重み、Counter進行、Gate |
| Keepのfamily | `keepFamilyLayout()`（順序付き）/ `keepFamilyMultisetKey()`（順序なし） | 独自のfamily表 |
| required / skippable | `createPlannerRouteUnitPlans()` の `canSkipWhenCounterPassed` | 新しいskip規則 |
| 共有可否 | `physicalActionKey` / `shareable` / `arePlannerRouteUnitsShareable()` | 「同じ位置なら共有」 |
| held / blocked / 排他OwnedWeapon | `derivePlannerAlternativeReservation()` の意味 | 新しいCounter共有規則 |
| Routeの絶対位置表現 | DATA_MODEL 9.2（非連続可、held prefixのcanonical表現） | 新しい永続field |
| 共存の最終判定 | `createProductionPlanWithObserver()` + `replayPlannerSearchTrace()` | 簡易判定（`usedCounters.has()` 等） |

Phase A〜Cの位置集合による判定（§5の必要条件、§8の被覆）はすべて **必要条件のpre-check** であり、Planner検証の代替ではない。

### 3.4 行わないこと

- oracle manifest / RESULT / Target ID / 位置 / Candidate IDの実行入力への使用（§11）
- `maxPlanSteps`、Search extent、node budgetに1,657や8,534を根拠にした値を置くこと
- Production source（Search / Planner / RNG / Worker / UI / Persistence / schema / version）の変更
- 既存Research algorithm（Phase 0 / 1-E / 2-A.5 / 2-B / C1 / C2 / D1 / D2 / P0R）の変更、既存formal RESULTの上書き
- D2-H局所探索の追加
- Research上の仮割当を `PlannerConflictResolution` / lineage / user-fixed Routeとして記録すること（§16）

## 4. 入力・出力・中間データモデル

型名・field名は提案である（§0）。すべてstructured-clone可能なplain dataとし、RngEngine instance・Clock・乱数を含めない。

### 4.1 入力

```ts
interface GlobalAssignmentInput {
  /** validatePlannerInput() を通過したPlanner-start PlannerInput（Exportから globalResearchInputFromExport() で構築） */
  plannerInput: PlannerInput
  /** 走査window ladderと探索budget（§10）。formal run前に事前登録し、run後に変更しない */
  research: {
    windowLadder: readonly ReachWindow[]          // W0, W1, ... 各stream位置数。W0は非oracle起源の既存定数（§10.3）
    nodeBudget: number                            // solverの決定的な展開node数上限
    verificationBudget: number                    // Phase D / D' へ渡す structural candidate の件数上限（1 run）
    materializationDeliveryCap: number            // 1 Targetのmaterializationで受け取るCandidate上限
    searchScaleGate: SearchScaleGate              // §9.7。超えるSearchは実行しない（未実行として区別）
    researchMaxPlanSteps: number                  // Phase D' のPlannerInput.options（Research条件。Production defaultではない、G12）
  }
}
interface ReachWindow { normal: number; gogma: number; skill: number }
/** §9.7。reservationとextentから実行前に計算する規模の上限。値はPhase D-0の事前登録で決める */
interface SearchScaleGate { maxConversionPositions: number; maxGogmaLegalWidth: number; maxSkillLegalWidth: number; maxNormalForgeCount: number }
```

**対象Target集合（planning Target）はProductionと同じ規則で確定する**（PLANNER_SPEC 4.1、REQUIREMENTS 19）。`isTargetWeaponPlanningEligible()`
だけでは不足で、そのPlanner入力の **valid BuildListEntryが1件以上あるTarget** に限る。

```ts
interface GlobalAssignmentContext {
  plannerInput: PlannerInput
  /** 元のvalidated PlannerInput。validBuildListEntries / excludedBuildListEntries をそのまま保持する */
  validation: PlannerInputValidationResult          // validatePlannerInput(plannerInput, dependencies)
  /** derivePlannerPlanningTargets(plannerInput.targetWeapons, validation.validBuildListEntries)。Target ID安定順。以後のPhaseで増減しない */
  planningTargets: readonly TargetWeapon[]
  planningTargetIds: ReadonlySet<TargetWeaponId>
}
```

- 導出は既存authority `derivePlannerPlanningTargets()`（`src/domain/planner/plannerPlanningTargets.ts`）をそのまま呼ぶ。
  raw `plannerInput.buildListEntries` やactive Target全体から再導出しない。stale / completed / disabled / unsupportedで除外されたEntryの
  Targetはplanning Targetにならず、valid Entryが0件ならplanning Targetも0件である（この場合 `no_structural_candidate` ではなく、Production と同じく
  「計画対象なし」として `unsupported_input`（reason `no_planning_target`）で止める）
- **valid BuildListEntryの存在** はplanning Target集合を決めるためだけに参照する。**既存BuildListEntryのRoute内容**（source、Counter位置、
  RouteKind、Candidate）はPhase A〜Cのsource・required位置・option選択に一切使わない。この区別により、Productionと同じ分母と、
  oracle非依存の全体再割当を両立する
- `planningTargets` はPhase 0で確定し、Phase A〜D'で増減しない。Phase D / D'が生成したEntryは分母を変えない（§9.5）。
  `targetWeapons.length` やactive Target数を完成数の分母に使わない
- `preferredOwnedWeaponId` はPhase A〜Cの入力にしない。`priority` は§6.4のtie-breakにだけ使う。既存Entryは分母維持のためPhase D'で未成立Targetに残す

### 4.2 Phase Aの中間データ（ReachTable）

```ts
interface ReachTable {
  originSkill: number
  originGogma: number
  originNormal: Record<NormalArtianCounterId, number>
  window: ReachWindow
  targets: TargetReach[]
}

interface TargetReach {
  targetWeaponId: TargetWeaponId
  weaponTypeId: WeaponTypeId
  elementId: ElementId
  normalCounterId: NormalArtianCounterId | null   // 確定レア8 Counterが無ければnull（新規Normal sourceは生成しない）
  support: { normal: boolean; skill: boolean; gogmaReset: boolean }   // getPredictionSupport()
  skill: {
    idealPositions: number[]                      // originSkill .. originSkill + W.skill - 1 のうち predictSkills() がIdeal Skill条件を満たす位置（昇順）
  }
  bonus: {
    resetIdealPositions: number[]                 // Reset(g) が gogma_artian でIdeal
    resetLayoutByPosition: Map<number, LayoutKey> // Reset(g) の順序付きfamily layout（Reset→Keep option用）
    keepIdealPositionsByLayout: Map<LayoutKey, number[]>   // Keep(layout, g) がIdeal。layoutは「関心layout集合」だけ
  }
  sources: SourceCandidate[]
}

type LayoutKey = string   // keepFamilyLayoutKey()

type SourceCandidate =
  | { kind: 'owned_gogma'; ownedWeaponId: OwnedWeaponId; layout: LayoutKey; scope: RestorationBonusScope;
      currentSkillIdeal: boolean; currentBonusIdeal: boolean; isProtected: boolean }
  | { kind: 'owned_normal'; ownedWeaponId: OwnedWeaponId; layout: LayoutKey; isProtected: boolean }
  | { kind: 'new_normal'; counterId: NormalArtianCounterId; position: number; layout: LayoutKey }
```

「関心layout集合」= Idealのfamily multisetの全順列layout（Phase 2-A.5の到達表と同じ。Keepはlayoutを保つので、Keep-onlyでIdealへ届くlayoutは
Ideal multisetの順列に限る）∪ 各source（owned / Normal位置）のlayout ∪ Reset結果のlayout（Reset→Keep用。関心layout集合に含まれるものだけKeep予測する）。
Reset結果のlayoutがIdeal multisetの順列でなければ、そこからKeepでIdealへは届かない（Keepは族を保つ）ので予測しない。これはKeepの既存semantics
（family保持、RNG_SPEC 6.1）から導かれる必要条件であり、新しいゲーム規則ではない。

### 4.3 Phase Bの中間データ（option / assignment）

```ts
/** 1 Targetの1つの到達option。必要条件であり、Routeではない */
interface ReachOption {
  targetWeaponId: TargetWeaponId
  source: SourceCandidate
  /** Skill streamの required 位置。[] = Skill操作なし（owned gogmaの現在Skillが既にIdeal） */
  skillRequired: SkillRequirement
  /** Gogma streamの required 位置。none = Bonus操作なし（owned gogmaの現在BonusがIdeal、gogma_artian scope） */
  bonusRequired: BonusRequirement
  /** new_normal のときのproduction target位置（= source.position）。他は null */
  normalRequired: { counterId: NormalArtianCounterId; position: number } | null
  /** 各streamの終端（最後のrequired位置 + 1。操作が無いstreamはorigin） */
  streamEnd: { skill: number; gogma: number; normal: Record<NormalArtianCounterId, number> }
  verification: 'necessary_only' | 'rng_replayed'   // §5.3
}

type SkillRequirement =
  | { kind: 'none' }
  | { kind: 'reset_skills'; finalPosition: number }                       // owned gogma: 最後のReset Skillsの位置 s*
  | { kind: 'conversion'; conversionPosition: number; finalPosition: number }  // new / owned normal: 巨戟化 c、最終Skill位置 s*（c = s* なら巨戟化だけ）

type BonusRequirement =
  | { kind: 'none' }
  | { kind: 'reset'; finalPosition: number }                              // Reset(g*) がIdeal
  | { kind: 'keep_from_source'; finalPosition: number }                   // Keep(source layout, g*) がIdeal
  | { kind: 'reset_then_keep'; resetPosition: number; finalPosition: number }  // Keep(layout(Reset(g1)), g*) がIdeal、g1 < g*

interface Assignment {
  chosen: Map<TargetWeaponId, ReachOption>
  streamEnd: { skill: number; gogma: number; normal: Record<NormalArtianCounterId, number> }
  objective: number   // Σ (streamEnd − origin)。verifiedになるまでは「成立すればこの物理操作数になる」という構造上の値
}

/** Phase B / Cを通過した完全割当。Productionでの成立は未検証（レビューB1） */
interface StructuralCandidate {
  kind: 'structural_candidate'
  ordinal: number                      // generatorが生成した順（決定的）
  assignment: Assignment
  coverage: StreamCoverage[]           // §4.4。被覆pre-check済み
  materializationOrder: TargetWeaponId[]
  expectedShapes: ExpectedRouteShape[]
}

/** Production検証に成功した候補。唯一の「成立」 */
interface VerifiedPlanRecord {
  kind: 'verified'
  candidate: StructuralCandidate
  entries: BuildListEntry[]            // Planner-start originのEntry（全planning Target）
  physicalOperations: number           // summarizePlanPhysical() の合計 = plan.steps.length = assignment.objective
  planner: PlannerResultSummary        // completed / 43 / Conflict 0 / rejected 0 / Trace Replay valid / fresh再検証
}
```

`bestStructural` はgeneratorが生成したstructural candidateのうちobjective最小のもの（診断・候補順序・Phase Cへの引き渡し用）、
`bestVerified` は `VerifiedPlanRecord` のうち `physicalOperations` 最小のものである。前者は実行可能解の証明ではなく、後者だけが成立である。

`SkillRequirement.conversion` の `c = s*` は「巨戟化位置のSkillがそのままIdeal」を、`c < s*` は「巨戟化後に s* でReset Skills」を表す。
巨戟化とReset Skillsは同じ位置で同じSkillを引く（RNG Rules、`docs/RNG_REFERENCE_AUDIT.md` 14.18）ので、s* の条件は両者で同一である。
`c < s*` のoptionはobjective上は `c = s*` に劣らないが優れもしない（Skill終端は同じ s* + 1）。それを持つ理由はSkill被覆（§8.2）である。

### 4.4 Phase Cの中間データ（coverage / shape）

```ts
interface StreamCoverage {
  stream: 'skill' | 'gogma' | { normal: NormalArtianCounterId }
  origin: number
  end: number                                   // assignment.streamEnd
  requiredAt: Map<number, TargetWeaponId>       // required位置 → 所有Target（排他なので高々1件）
  segments: CoverageSegment[]                   // origin .. end-1 を隙間なく分割
}
interface CoverageSegment { from: number; to: number; covererTargetWeaponId: TargetWeaponId }

/**
 * Global Assignmentが対象Targetに期待するRoute形。Research上の形状条件であり、
 * 正式なresource reservation（held / blocked / 排他OwnedWeapon）とは別概念（レビューB2、§7 / §9）
 */
interface ExpectedRouteShape {
  targetWeaponId: TargetWeaponId
  option: ReachOption
  /** 照合に使う条件: source、stream別のrequired位置、required-only再生の最終武器（§5.3） */
  match: {
    sourceOwnedWeaponId: OwnedWeaponId | null
    required: { skill: number[]; gogma: number[]; normal: number | null }
    finalBonuses: RestorationBonusSet; restorationBonusScope: RestorationBonusScope
    seriesSkillId: SeriesSkillId | null; groupSkillId: GroupSkillId | null
  }
  /** 予測に使う情報: Phase Cが被覆から導いたchain区間（照合には使わない。Search規模gateと診断用） */
  predicted: { chainSegments: CoverageSegment[]; ownPositionCount: { skill: number; gogma: number; normal: number } }
}
```

### 4.5 Phase Dの中間データ（materialization）

```ts
interface MaterializationRequest {
  targetWeaponId: TargetWeaponId
  shape: ExpectedRouteShape
  method: 'planner_alternative_reservation' | 'candidate_search_projected'   // §9.1 / §9.2
  /**
   * method = planner_alternative_reservation のとき。この時点までにmaterialize済みのEntry集合から
   * derivePlannerAlternativeReservation() が導出した正式なreservation。形状を強制する目的でheld / blockedを
   * 追加・改変しない。Research上の仮割当（speculative）であり、user-fixed Routeではない（G1）
   */
  reservation: PlannerAlternativeReservation | null
  reservationSourceEntryIds: BuildListEntryId[]  // reservationの導出元（materialize済みEntry）。空なら empty reservation
  extent: PlannerAlternativeSearchExtent | CandidateSearchSettings
  /** §9.7。reservationとextentから実行前に計算する。gateを超えるrequestは実行しない */
  predictedSearchScale: { conversionPositions: number; gogmaLegalWidth: number; skillLegalWidth: number; normalForgeCount: number }
}

type MaterializationOutcome =
  | { kind: 'materialized'; entry: BuildListEntry; plannerRequired: { skill: number[]; gogma: number[]; normal: number | null }; deliveredBeforeMatch: number }
  /**
   * Searchが `summary.exhausted = true` で終わり（extent内外とも到達可能なworkが残っていない）、一致するCandidateが無かった。
   * このreservation・origin・extentのもとで探索が完了したという、Search側の明示的な証拠に基づく唯一の「実行済み・不一致」
   */
  | { kind: 'shape_mismatch'; delivered: number; closestMismatch: string }
  /**
   * Searchを実行したが、形の一致を確認できる前に止まった（未確認。不一致ではない）。
   * `stopped_by_extent`: `summary.stoppedByExtent = true`（extentが到達可能なworkを未読のまま残した）。期待required位置がextent内にあっても
   * その形の探索が完了した保証は無いので、常に未確認とする。`delivery_cap_reached`: consumer stop
   */
  | { kind: 'unconfirmed'; reason: 'stopped_by_extent' | 'delivery_cap_reached'; delivered: number }
  /** Searchを実行しなかった（未実行。不一致でも未確認でもない） */
  | { kind: 'not_executed'; reason: 'search_scale_gate'; predictedSearchScale: MaterializationRequest['predictedSearchScale'] }
  /** timeout / OOM / process failure / cancel（未計測） */
  | { kind: 'unmeasured'; reason: 'timeout' | 'out_of_memory' | 'process_failure' | 'cancelled' }
```

`shape_mismatch` だけが「Searchを実行して形が得られなかった」事実であり、`unconfirmed` / `not_executed` / `unmeasured` は
「該当Routeなし」の根拠にならない（レビューR3、再レビューR2、§9.6）。`exhausted` と `stoppedByExtent` はSearch summaryで区別され両方trueにならない
（§2.6）。現行APIには「特定の形について探索が完了した」ことを `exhausted` 以外で保証する証拠が無いので、`stoppedByExtent` を
`shape_mismatch` に読み替える例外は設けない（fail closed）。

### 4.6 出力

```ts
/** 1件のstructural candidateがPhase D / D'でどうなったか */
type CandidateOutcome =
  | { kind: 'verified'; record: VerifiedPlanRecord }
  | { kind: 'materialization_failed'; target: TargetWeaponId; outcome: Extract<MaterializationOutcome, { kind: 'shape_mismatch' }> }   // 実行済み・不一致
  | { kind: 'materialization_unconfirmed'; target: TargetWeaponId; outcome: Extract<MaterializationOutcome, { kind: 'unconfirmed' | 'not_executed' | 'unmeasured' }> }
  | { kind: 'planner_rejected'; planner: PlannerResultSummary; reasons: PlannerSearchRejectionReason[] }   // Search成功、Planner検証で不成立
  | { kind: 'objective_mismatch'; planner: PlannerResultSummary; physical: number; objective: number }
  | { kind: 'not_attempted'; reason: 'verification_budget' }

type SearchCompleteness =
  | 'exhausted'              // node budget内で探索木を使い切った（この窓・この排他制約での完全な列挙）
  | 'node_budget_reached'    // 未探索枝が残る
  | 'verification_budget_reached'
  | 'cancelled'

type GlobalAssignmentResult =
  | { status: 'verified'; bestVerified: VerifiedPlanRecord; proof: 'proven_minimum' | 'best_found'; lowerBound: LowerBoundReport;
      completeness: SearchCompleteness; candidates: CandidateOutcome[]; window: ReachWindow }
  | { status: 'structural_only'; bestStructural: StructuralCandidate; completeness: SearchCompleteness;
      candidates: CandidateOutcome[]; window: ReachWindow }                  // 構造的候補はあるが verified なし
  | { status: 'no_structural_candidate'; completeness: 'exhausted'; window: ReachWindow;
      reason: 'target_without_option' | 'resource_exclusivity' | 'coverage_infeasible'; detail: NoCandidateDiagnostics }
  | { status: 'search_incomplete'; completeness: 'node_budget_reached' | 'cancelled'; window: ReachWindow;
      bestStructural: StructuralCandidate | null; candidates: CandidateOutcome[] }   // 窓内に候補が無いとは結論しない
  | { status: 'unsupported_input'; reason: 'unconfirmed_counter' | 'checkpoint_selection' | 'prediction_unsupported' | 'blind_route_required' | 'no_planning_target'; detail: string }
  | { status: 'unmeasured'; reason: 'timeout' | 'out_of_memory' | 'process_failure' }
```

- すべてのstatusは、Phase 0で固定したplanning Target集合（§4.1）を分母とする。`verified` の `completedTargetCount` は `planningTargets.length`
  と一致しなければならず、`targetWeapons.length` やactive Target数とは比較しない
- `verified` だけが「成立」である。`proven_minimum` は、`bestVerified.physicalOperations` が、適用可能（cross satisfaction可能ペア0件、かつ下限moduleの
  対象集合がplanning Target集合と一致、§10.2）かつ `found` で証明済みのroot下界 `provenLowerBoundTotal()` と一致した場合に限る。structural candidateの
  objectiveがroot下界と一致しても、Production検証前には何も主張しない（レビューB1）
- `structural_only` と `search_incomplete` は `bestStructural` を持ち得るが、それは診断・次Phaseへの引き渡し用であり成立ではない
- `no_structural_candidate` は、node budget内で探索木を使い切った（`completeness = 'exhausted'`）ときだけ返す。
  `reason` は「Target単位でoptionが無い」「各Targetにoptionはあるが資源排他で完全割当が無い」「完全割当はあるが被覆が成立しない」を区別する
  （レビューR2）。いずれも「この窓・この制約では見つからなかった」であり「実行可能解が存在しない」ではない
- `search_incomplete`（node budget到達・cancel）では「窓内に完全割当が存在しない」と結論しない
- `candidates[]` は試行した候補ごとに `materialization_failed`（実行済み・不一致 = Searchが `exhausted` で終わって一致なし）/
  `materialization_unconfirmed`（`stopped_by_extent` / delivery cap / gate未実行 / 未計測）/ `planner_rejected` / `objective_mismatch` を区別して残す
  （レビューR3、再レビューR2）。`materialization_unconfirmed` の候補は実行不能ではなく、枝刈り・最短性証明の根拠にも恒久除外の対象にもしない
- `unmeasured` をどの成立 / 不成立statusにも読み替えない（G6）

## 5. RNG到達optionの生成（Phase A）

### 5.1 走査windowとmemo

各streamについて `origin .. origin + W − 1` を走査する（Skillはconversion Routeの `origin .. origin + W` を含める。SEARCH_SPEC 3.1）。
予測はProduction RngEngineの公開APIだけを呼び、memoを次の単位で共有する。

| 予測 | memo key | 呼び出し回数の上限（1 window） |
| --- | --- | --- |
| `predictSkills` | (weaponTypeId, elementId, position) | 種別×属性の組ごとに W.skill + 1 |
| `predictGogmaBonus` Reset | (weaponTypeId, elementId, position) | 組ごとに W.gogma |
| `predictGogmaBonus` Keep | (weaponTypeId, elementId, position, layoutKey) | 組ごとに W.gogma × 関心layout数 |
| `predictNormalArtian` | (weaponTypeId, elementId, position) | 組ごとに W.normal |

同じ種別・属性のTargetは予測を共有する（Ideal判定だけがTargetごとに異なる）。`getPredictionSupport()` がunsupportedを返す予測は行わず、
そのstreamのoptionを生成しない（LOWER_BOUND_ASSUMPTIONS 8と同じ）。

### 5.2 option導出規則

sourceの種類ごとに、Skill側とBonus側の必要条件を独立に導出し、両者の組をoptionとする（Skill streamとGogma streamは独立。Candidate Searchの
stream separationと同じ）。

| source | Skill側 | Bonus側 |
| --- | --- | --- |
| owned gogma（現在Skill Ideal） | `none` | 下記 |
| owned gogma（現在Skill非Ideal） | `reset_skills` s* ∈ `skill.idealPositions` | 下記 |
| owned gogma（現在Bonus Ideal、`gogma_artian`） | — | `none` |
| owned gogma（それ以外） | — | `reset` g* ∈ resetIdeal ／ `keep_from_source` g* ∈ keepIdeal[source layout] ／ `reset_then_keep` (g1, g*)、layout(Reset(g1)) = L、g* ∈ keepIdeal[L]、g1 < g* |
| owned normal（未保護） | `conversion` (c, s*): s* ∈ idealPositions、c ≤ s*（c = s* または c < s*） | `keep_from_source` g* ∈ keepIdeal[normal layout]（Keepはnormal-scope 5枠から予測できる）／ `reset` ／ `reset_then_keep` |
| new normal（位置p、確定Counter） | 同上 | `keep_from_source` g* ∈ keepIdeal[layout(Normal p)] ／ `reset` ／ `reset_then_keep` |

- 保護中のowned gogmaは、現在性能がIdealの場合だけ `none / none`（操作0）optionを持つ。それ以外の保護武器はsourceにしない（REQUIREMENTS 21）
- 保護中のowned normalは変換元にしない
- `reset` / `reset_then_keep` はsource layoutを読まないので、new normalのpositionはどこでもよい（Normal終端だけに効く）。`keep_from_source` だけが
  layout一致（族構成一致）を要求する。P0Rの「族構成一致Normal 206 / 849 / 886」はこの `keep_from_source` の位置集合に相当する
- blind variant（Normal Counter未確定）はoptionにしない。確定レア8 Counterが無い種別のTargetはnew normal sourceを持たず、owned sourceも無ければ
  `unsupported_input`（`unconfirmed_counter`）でfail closedする（Phase 0の逐次射影やblind Routeへ暗黙にfallbackしない）
- `preferredOwnedWeaponId` はoption生成に使わない（Searchのtie-breakであり、割当のauthorityではない）
- `reset_then_keep` の中間Keep（g1とg*の間）、Reset連鎖、Reset Skills連鎖は **optionに含めない**。それらはskippable unitであり、§8の被覆で決まる

### 5.3 必要条件と検証状態

optionは「IdealへRNG上届き得る必要条件」であり、実行可能性ではない。2段階で区別する。

| 状態 | 意味 | 判定 |
| --- | --- | --- |
| `necessary_only` | 位置集合が §5.2 の条件を満たす | 走査結果の参照だけ |
| `rng_replayed` | required unitだけを順に適用した結果が `satisfiesIdealTarget()` でIdeal | sourceの状態（owned: Export値、new normal: `predictNormalArtian`）→ 巨戟化 / Reset Skills（Skill）→ Reset / Keep（Gogma）を予測し直して確認 |
| `materialized`（Phase D） | Production Searchがその形のRouteを返し、`createPlannerRouteUnitPlans()` のrequired位置がoptionと一致 | §9 |
| `planner_verified`（Phase D'） | 全Entryのfull Planner run + Trace Replayが成立（候補全体として `verified`） | §9.5 |

`rng_replayed` は、Phase 2-A.5 Stage Aの「required-only再生」と同じ考え方（skippable unitを他Targetが消費しても結果が変わらない）を、
oracle moduleをimportせずに実装する（§11）。Phase Aではsolverへ渡す前に全optionを `rng_replayed` にする必要はない（走査結果は既にIdeal判定済み）。
再生はPhase Bが選んだoptionに対してだけ行い、一致しなければinternal invariant errorとして止める（走査とIdeal判定が同じauthorityなので不一致は実装バグ）。

### 5.4 疑似コード

```text
buildReachTable(context, engine, window):          // context: §4.1 GlobalAssignmentContext
  planningTargets = context.planningTargets        // = derivePlannerPlanningTargets(targetWeapons, validation.validBuildListEntries)。ここで固定
  if planningTargets is empty: return unsupported_input(no_planning_target)
  assert every planning Target's weapon type has a confirmed rarity-8 Normal Counter, or no new_normal source is needed (else unsupported_input)
  for each (weaponTypeId, elementId) group of planningTargets:   // 既存 Entry の Route 内容は読まない
    skills[pos]      = predictSkills(pos)            for pos in [S0, S0 + W.skill]          (if supported)
    reset[pos]       = predictGogmaBonus(reset, pos)  for pos in [G0, G0 + W.gogma)          (if supported)
    normal[pos]      = predictNormalArtian(pos)       for pos in [N0_type, N0_type + W.normal) (if supported and counter confirmed)
    for each Target t in group:
      layoutsOfInterest(t) = permutations(layout of t.idealBonuses)
                           ∪ { layout(w) | w owned, compatible, unprotected } ∪ { layout(normal[p]) | p } ∪ { layout(reset[g]) | g }
                           ∩ (layouts whose multiset == ideal multiset of t)        // Keep preserves families
      keep[layout][pos] = predictGogmaBonus(keep, layout, pos)  (memo shared across Targets of the group)
      t.skill.idealPositions   = { pos | evaluateSkillCondition(t.idealSkillCondition, skills[pos]) }
      t.bonus.resetIdeal       = { g | satisfiesIdealBonuses(t, reset[g], gogma_artian) }
      t.bonus.resetLayout[g]   = layoutKey(reset[g])
      t.bonus.keepIdeal[L]     = { g | satisfiesIdealBonuses(t, keep[L][g], gogma_artian) }  for L in layoutsOfInterest(t)
      t.sources                = owned gogma / owned normal (same type & element; protection rules) ∪ new_normal positions
  return ReachTable

enumerateOptions(t, reach):              // lazy iterator, deterministic order
  for source in t.sources (owned first, then new_normal by position asc):
    for skillReq in skillRequirements(t, source):          // §5.2; conversion c enumerated lazily (c = s* first)
      for bonusReq in bonusRequirements(t, source):        // reset by g* asc, keep_from_source by g* asc, reset_then_keep by (g*, g1) asc
        yield option(t, source, skillReq, bonusReq)        // streamEnd computed from the required positions
```

### 5.5 不変条件とfail closed

- 全予測はEngine APIを経由し、Research側で乱数・重み・Counter進行を計算しない
- ReachTableの `targets` はPhase 0で固定したplanning Target集合（§4.1）と同じ要素・同じ順序である。active Target全体やraw Entryから作らず、
  既存EntryのRoute内容を読まない。以後のPhaseでTargetを追加・除外しない
- 走査で得た位置はwindow内に限り、window外を「無い」と記録しない（`windowReached` flagで区別）
- `t.sources` のowned weaponは種別・属性一致・未保護（保護中はIdeal現在性能だけ）。Masterへ無い参照はDomain validationどおりfail closed
- optionの `streamEnd` は `max(required) + 1`（操作無しはorigin）。Routeの連鎖長・操作数を含めない
- Keepのlayoutは `keepFamilyLayoutKey()`（順序付き）で識別し、多重集合に畳まない（Keepはslot位置ごとに族を保つ）。multisetは「関心layout」の絞り込みにだけ使う
- 予測不能（unsupported）はoption不在であり、「Idealに届かない」ではない。summaryへunsupported noticeとして残す

### 5.6 規模の見積もり（未計測）

計算量は予測回数で押さえられる（§5.1）。W0 = Normal 350 / Gogma 500 / Skill 1500（§10.3）、関心layout ≤ 数十、種別×属性の組が数十なら、
予測回数は10^5〜10^6規模である。Phase 2-A.5の下限監査（budget 1,657で3 stream走査）は240.2秒だったが、それはoption閾値の網羅と
cross satisfaction監査（Skill候補26 × 18の全組合せ）を含む1回計測であり、Phase Aの時間は **未計測** である。保持するのは位置配列と
layout別位置配列だけで、Route本体やstream stateを持たない。実測はPhase Aの正式計測で行う。

### 5.7 下限moduleとの関係

`collectLowerBoundProblem()` は同じ走査から各Targetの **閾値**（最小位置）だけを取り出し、`solveLowerBoundRelaxation()` が
閾値ベクトルを最小化する。Phase Aは位置 **集合** を保持する点だけが異なる。実装では走査部を共有helperへ抽出し、下限moduleの出力
（閾値）がReachTableから再導出できることをtestで固定する（下限moduleの契約・結果は変えない）。

対象集合の違いに注意する。下限module（`collectLowerBoundProblem()` / `auditCrossSatisfaction()`）は `isTargetWeaponPlanningEligible()` だけで
対象Targetを決めるが、本設計のplanning Target集合はそれにvalid BuildListEntryの存在を加えた集合である（§4.1）。両者は全eligible Targetが
valid Entryを持つ入力（対象Exportは43 / 43）でだけ一致する。一致しない入力でroot下界をどう扱うかは §10.2 のとおりで、下限module自体は変更しない。

## 6. sourceとrequired unitのGlobal Assignment（Phase B）

### 6.1 制約問題としての定式化

```text
変数        x_t ∈ Options(t)                     planning Target t ごとに1つのReachOption
制約 C1     source排他   owned weapon w は高々1 Target、new_normal (counterId, p) は高々1 Target
制約 C2     required位置排他（streamごと）
              Skill:  skillRequired の位置集合（conversion c、final s*）が Target間で互いに素
              Gogma:  bonusRequired の位置集合（g1、g*）が互いに素
              Normal: normalRequired.position が同じcounterIdで互いに素
制約 C3     被覆可能性（§8。Skill streamだけが不成立になり得る）
目的        minimize  Σ_streams (max required + 1 − origin)   = physical operation数（Phase 2-B 6.4の恒等式）
```

- C1は `same_owned_weapon_consumed` と「1本の鍛造Normalは1 Targetにしか変換できない」（Issue #129の残る競合）に対応する
- C2は、PLANNER_SPEC 7.0.2の「必須unit同士は競合（共有不可のとき）」に対応する。skippable unitは制約に入らない（排他資源ではない）
- C2は **十分条件寄り** である: v1では必須unit同士の共有は生じない（§2.6）ので、required位置が互いに素なら `detectPlannerConflicts()` のCounter conflictは0になる。
  将来sharingの契約が広がれば、共有可能なunit同士を同じ位置へ置けるようになるが、本設計はそれを先取りしない
- 目的関数はassignmentだけで決まり、chainの長さや操作数に依存しない。これは被覆が成立する限り成り立つ（§8）

cross satisfaction（1つの武器状態で2 TargetのIdealを同時に満たす）が可能なPlannerInputでは、distinct source（C1）の割当も **実行可能なPlanではある**
（Productionは別々の武器で完成させることを禁止しない）が、最小とは限らない。したがってC1はそのまま使い、下限・最小性の主張だけを無効化する（§10.2）。

### 6.2 アルゴリズム候補の比較

| 候補 | 利点 | 欠点 | 判定 |
| --- | --- | --- | --- |
| Constraint-based backtracking | 排他制約の自然な表現、部分割当からの早期棄却、決定性 | 探索空間は大きい。順序付けが要る | **採用（基盤）** |
| MRVによる変数選択 | 選択肢の少ないTarget（同条件の2 Targetが1つの族構成一致Normalを争う等）を先に決め、無効な割当を早く棄却 | 動的なdomain計算が要る | **採用** |
| Branch-and-bound | 部分割当の下界と **Production検証済み** の上界で目的関数的に無駄な枝を切る | 下界の質と、検証済み上界が得られるまでの時間に依存。未検証候補のobjectiveを上界にすると実行可能解を失う。cross satisfactionがある入力では距離の根拠が弱い | **採用**（安全な下界と検証済み上界だけ、§6.3 / §10） |
| Lower-bound guided search（root緩和の閾値で値順序を決める） | 1,657再構成で有効だった。閾値内側から探す | 緩和解が実行可能とは限らない。閾値を硬い制約にすると解を失う | 値順序のheuristicとしてだけ採用。硬い制約にしない |
| 段階的なCandidate portfolio拡張（C2 / D2方式） | 既存Planner Alternative kernelをそのまま使える | full Routeを先に列挙する。Search規模（OOM / timeout）と1 fixed winner contextの制限（C2 / D2） | 中心にしない。materializationのdemand-driven生成として位置づける |
| 乱数restart（1,657 scratch） | 局所解からの脱出 | 非決定性。再現・事前登録・中断再開と相性が悪い | 採用しない。決定的なdiscrepancy探索（Phase E）で代替 |
| 外部solver（ILP / SAT） | 最適性証明が得やすい | 依存追加、Browser Worker実行の見通し、決定性の保証、Research範囲を超える | 採用しない（§15） |

### 6.3 採用方式: 決定的backtracking + MRV + branch-and-bound（structural candidateのgenerator）

最初のResearch実装（Phase B）は次とする。

- 深さ優先のbacktracking。各nodeで未割当Targetから **MRV**（現在の部分割当のもとで `resourceFeasibleOptions()`（§6.4）が最少。同数なら
  priority降順、Target ID昇順）を選ぶ。MRVの候補数評価は資源条件だけで行い、下界による枝刈りと混ぜない
- 値順序は **Σ stream終端の増分が小さいoption** から。同点はowned sourceを新規Normalより先、Skill / Gogmaのrequired位置が小さい方、stable key
- solverは **structural candidateのgenerator** として動く。完全割当に到達し §8 の被覆pre-checkを通過するたびに、その候補を1件返して探索状態
  （割当stack、各nodeの値順序の位置、node数）を保持し、呼び出し側（Phase D / D'）の結果を受け取ってから **同じnodeの次の値** から再開する
  （「探索状態を維持した再開」。§6.4）。候補を見つけるたびに探索をやり直さず、過去に棄却した枝を再訪もしない
- **branch-and-boundの上界は `bestVerified.physicalOperations` だけ**（§10.1）。未検証のstructural candidateのobjectiveは上界に使わない。
  したがって `bestVerified` が無い間は目的関数による枝刈りを行わず、値順序だけで候補を並べる。`bestVerified` が得られた後は
  `LB(child) >= UB` の枝を切る。切られた枝のどの完成も、成立したとしても物理操作数がUB以上になる（§6.1の恒等式）ので、より良いverifiedを失わない
- 被覆pre-check不成立（Skill）なら、最も低い未被覆Skill位置 x を記録して棄却し、値順序に「conversion c = x を持つoption」（§4.3の `c < s*` 型）を
  優先的に試す（**coverage-driven value ordering**）。順序の変更であり制約の緩和ではない
- Phase D / D'で不成立になった候補は、候補単位のoutcome（§4.6）として記録するだけで、そのoption・部分割当を除外集合へ入れない
  （materialization失敗は実行可能解不存在ではない。レビューB1 / R3）。generatorは各完全割当を高々1回しか生成しないので、同じ候補を繰り返さない
- node budget・verification budget（§10.4）を使い尽くしたら、探索状態をcompletenessとして返す（`search_incomplete` / `structural_only`）。乱数restartはしない
- 探索木を使い切っても候補が無ければ `no_structural_candidate`（reason別、§4.6）
- `bestVerified.physicalOperations` が、適用可能で証明済みのroot下界と一致した時点で探索を終了してよい（それ以上良いverifiedは存在しない）。
  structural candidateのobjectiveがroot下界と一致しただけでは終了せず、何も主張しない

### 6.4 疑似コード

```text
solve(reach, bounds):
  root         = lowerBoundRoot(reach)               // §10.2: applicable なら relaxation minimum、否なら null
  UB           = +∞                                  // bestVerified.physicalOperations。verified が無い間は枝刈りしない
  bestVerified = null; bestStructural = null; outcomes = []
  gen          = structuralCandidates(reach, bounds, () => UB)      // 決定的 generator（下記）
  for candidate in gen:                                              // 生成順は決定的
    if outcomes.length >= bounds.verificationBudget: outcomes.push(not_attempted(candidate)); gen.completeness = verification_budget_reached; break
    bestStructural = minByObjective(bestStructural, candidate)       // 診断・引き渡し用。上界にはしない
    outcome = materializeAndVerify(candidate)                        // §9。Phase C の順序で materialize → Planner 検証
    outcomes.push(outcome)
    if outcome.kind == 'verified':
      bestVerified = minByPhysical(bestVerified, outcome.record)
      UB = bestVerified.physicalOperations                           // 以後の枝刈りはこの値だけで行う
      if root != null and UB == root: break                          // proven_minimum: verified と証明済み下界の一致
    // materialization_failed / materialization_unconfirmed / planner_rejected / objective_mismatch は記録だけ。
    // option や部分割当を除外しない。次の候補は generator の再開で決まる
  return classify(bestVerified, bestStructural, outcomes, gen.completeness, root, window)   // §4.6

structuralCandidates(reach, bounds, readUB):   // generator。yield 後は同じ node の次の値から再開する
  nodes = 0
  search(partial):
    if nodes >= bounds.nodeBudget: completeness = node_budget_reached; stop
    nodes += 1
    if all Targets assigned:
      if not coverageFeasible(partial):          // §8.1。Skill だけが不成立になり得る
        recordUncoveredSkillPosition(partial)    // coverage-driven value ordering へ反映
        return
      yield withOrderAndShapes(partial)          // §8.2 / §8.3: materialization 順序と ExpectedRouteShape を付けた structural candidate
      return
    domains = { t ↦ countUpTo(resourceFeasibleOptions(t, partial), k) | t unassigned }   // MRV 用。上限 k の先読み。LB を呼ばない
    t = argmin domains（tie: priority desc, Target ID asc）
    if domains[t] == 0: recordDeadEnd(t, partial); return
    for option in orderedOptions(resourceFeasibleOptions(t, partial), partial):
                                                 // Σ終端増分 asc → owned first → 位置 asc → stable key。
                                                 // 記録済みの未被覆 Skill 位置 x があれば conversion c = x を先に
      child = partial + (t, option)
      if readUB() < +∞ and LB(child) >= readUB(): continue     // branch-and-bound。UB は verified の物理操作数だけ
      search(child)
  search(emptyPartial(reach)); completeness = exhausted

resourceFeasibleOptions(t, partial):            // 資源条件・window・必要条件だけ。LB も UB も参照しない
  { o ∈ enumerateOptions(t) | o.source ∉ partial.usedSources
                             ∧ o.required positions ∩ partial.usedPositions(stream) = ∅  (per stream)
                             ∧ o の全 required 位置が現在の window 内 }

LB(partial):                                    // §10.1。stream 別最小終端だけを読む。枝刈りを再帰的に呼ばない
  Σ_streams ( max( partial.streamEnd_s, max_{t unassigned} minStreamEnd_s(t, partial) ) − origin_s )
minStreamEnd_s(t, partial):                     // ReachTable の位置配列から、partial で未使用の最初の位置を読む（option 列挙を要しない）
  min over resourceFeasibleOptions(t, partial) of option.streamEnd_s
```

- 依存関係は `resourceFeasibleOptions` → `LB` → pruning の一方向である。`resourceFeasibleOptions` は `LB` を読まず、`LB` は枝刈りを呼ばず、
  MRVの候補数評価は `resourceFeasibleOptions` だけを読む（レビューR1。循環参照なし）
- `enumerateOptions` はlazy（§5.4）。MRVの候補数は上限 k の先読みで数える（同数判定が崩れても正しさには影響しない）
- `minStreamEnd_s(t, partial)` は、ReachTableのstream別位置配列（昇順）を先頭から走査して `partial.usedPositions` に無い最初のrequired候補位置を
  取るだけで求まる（sourceの排他は、そのstreamの最小終端を下げないので無視してよい: 無視しても下界は小さくなるだけで安全側）
- `usedPositions` にはrequired位置だけを入れる。chain位置は入れない（排他資源ではない）
- dead end（候補0件）はwindow内・現在の部分割当での不在であり、`no_structural_candidate` のreason（`target_without_option` /
  `resource_exclusivity`）の根拠として記録する。「存在しない」とは書かない

### 6.5 決定性

solverは `Math.random`、`Date`、`crypto.randomUUID` を使わない。入力（PlannerInput、window、budget）が同じなら、同じnode列・同じstructural candidate列を
返す。generatorの再開は「yield したnodeの次の値」から行うので、Phase D / D'の結果（verified / 不成立）はUBの値を通じてだけ以後の探索に影響し、
UBが同じなら同じ候補列になる。ReachTableの配列はすべて昇順、Mapは挿入順を固定する（Target ID昇順、layout key昇順）。cancelは既存Research seam
（`shouldCancel()` / `yieldControl()`）をnode単位で確認する。中断時は探索状態・bestStructural・bestVerified・outcomesを返す。

## 7. held / blocked / silent fast-forwardの扱い

本設計は新しいCounter共有規則を作らない。割当・被覆・materializationのすべてで次の既存semanticsをそのまま使う。

| 概念 | authority | 本設計での使い方 |
| --- | --- | --- |
| required / skippable | `createPlannerRouteUnitPlans()` の `canSkipWhenCounterPassed`（PLANNER_SPEC 7.0.2の表） | Phase Aのoptionはrequired位置だけを持つ。Phase Cのchainはskippable unitだけで構成する。Phase Dで実際のEntryから再導出して照合する |
| silent fast-forward | `fastForwardPlannerRouteProgress()`（PLANNER_SPEC 7.0.2） | chainのunitが他Targetのrequired位置を通過するとき、required側が先に実行されchain側はfast-forwardされる（支配関係）。設計はこれを前提に、chainがrequired位置を跨いでよいとする |
| physical action sharing | `physicalActionKey` / `shareable` / `arePlannerRouteUnitsShareable()`（PLANNER_SPEC 7.0） | 共有を仮定しない。v1ではrequired unit同士の共有は生じないので、C2（required位置互いに素）で十分 |
| OwnedWeapon排他 | `collectReferencedOwnedWeaponIds()`、`exclusiveConsumedOwnedWeaponId` | C1（source排他） |
| Normalのproduction target / 進行用forge | Issue #129（PLANNER_SPEC 7.0.2）: 最終unitはrequired、中間unitはskippable。production target同士だけが `same_normal_counter` | C2のNormal部分。被覆は「最も遠いproduction targetのTargetがoriginから全部forgeする」で自動的に成立（§8.1） |
| held / blocked / 排他OwnedWeapon | PLANNER_SPEC 9.2.19.3、`derivePlannerAlternativeReservation()` | Phase Dで、その時点までに **materialize済みのEntry集合** から正式に導出する（§9.1）。意味は変えない: held = materialize済みRouteのunitが位置を持つ位置（required / skippableとも）、blocked = その必須かつ共有不可unitの位置、排他OwnedWeapon = その参照・排他消費武器。**期待するRoute形を強制するためにheld / blockedを追加・改変しない**（レビューB2）。割当段階の仮の位置集合を、この正式なreservationと同一視しない |
| 代替Routeの合法位置 | SEARCH_SPEC 5.6.8のcoverage条件（`nextOperationPositions()`: 合法位置 = `[from, 最初の非held位置] \ blocked`） | Searchはblocked位置へ自分の操作を置かず、最初の非held位置で必ず操作するか止まり、held位置では操作してもしなくてもよい（cost順の探索選択）。**特定のown操作位置集合を直接強制するAPIではない**。期待する形はSearch後に照合する（§9.1） |
| held位置を跨ぐRoute | PLANNER_SPEC 9.2.19.4、DATA_MODEL 9.2（非連続な絶対位置、Normalのheld prefix canonical表現） | 非連続Routeはこの表現で保存される。永続fieldを追加しない |

Phase A〜Cが使う「位置集合による判定」は、上記authorityの **結果を予測する必要条件** である。Phase Dは実際のEntryから
`createPlannerRouteUnitPlans()` と `derivePlannerAlternativeReservation()` で再導出し、Phase D'のPlannerが判定する。
Phase A〜Cの予測（期待Route形）と、Searchが返したRouteの再導出が食い違った場合は、typed outcome（`shape_mismatch`、§9.6）として記録し、
Phase A〜Cの規則を黙って緩めず、reservationを形状に合わせて改変もしない。

## 8. Counter被覆とRoute構成（Phase C）

### 8.1 被覆条件（静的・必要条件）

Production schedulerは「あるstreamの現在位置にcommitted unitが無いのに後方位置のpending unitがある」状態をstallとして扱い、Entryを落とす
（ISSUE_103設計 3.5 / 7.8）。したがって全Targetを完成させるRoute集合は、各streamの `origin .. end − 1` の全位置に少なくとも1つのunitを持たなければならない。
required位置は割当で決まり疎なので、間はskippable chainで埋める。

stream別の被覆可能性:

| stream | 被覆できるTarget | 常に被覆できるか |
| --- | --- | --- |
| Normal（種別ごと） | 最も遠いproduction target pmax を持つTargetが `origin .. pmax` を自分でforgeする（中間はskippable、pmaxがrequired）。他Targetのproduction target p < pmax はその中にrequiredとして置かれ、pmax側の同位置forgeはfast-forwardされる | **常に成立**（new_normal sourceが1つ以上あるとき） |
| Gogma | 最終Bonus位置 g* を持つ任意のTargetが `a .. g*`（a ≥ origin）をchainで被覆できる: `reset` はReset連鎖、`keep_from_source` はKeep連鎖（Keepはlayoutを保つ）、`reset_then_keep` はReset連鎖 → g1 → Keep連鎖。巨戟化前の武器（new / owned normal）も、巨戟化を待ってから実行される（待機はstallではない） | **常に成立**（Bonus操作を持つTargetが1つ以上あるとき。最大g*のTargetがoriginから全部被覆できる） |
| Skill | 既存Gogma（`reset_skills`）は `a .. s*` をReset Skills連鎖で被覆できる。巨戟化Target（`conversion`）は **c以降だけ**（c自身 + Reset Skills連鎖 `c+1 .. s*`）を被覆できる。c より前には武器がSkill streamに存在しない | **不成立になり得る**: 位置 x < 全巨戟化位置 を被覆できるのは既存GogmaのSkill chainだけ |

stream間の待機について。Gogma operationを持つ巨戟化Targetは、自分の巨戟化（Skill unit）が実行されるまでGogma unitがreadyにならず、その位置で待つ。
Skill unitはGogmaに依存せず、巨戟化はNormal forgeにだけ依存し、Normal forgeは何にも依存しない。したがってstream間の依存は
`Normal → Skill → Gogma` の一方向であり、checkpoint pin（本設計では対象外、§15）を除けば循環待ち（deadlock）は生じない。
これはISSUE_103設計 7.3「holding unitがreadyでない場合は待つ」の範囲であり、新しい規則ではない。被覆pre-checkは上表の静的条件だけを判定し、
時間順序の成立はPhase D'のPlannerに委ねる。

```text
coverageFeasible(assign):
  for each stream:
    required = sorted required positions with owner
    for each gap (prev, next) between consecutive required positions (prev = origin − 1 at start):
      coverers(gap) = Targets that can place a chain unit at every position in (prev, next):
        Normal: Target owning pmax（常に該当）
        Gogma : any Target with bonusRequired.finalPosition ≥ next
        Skill : owned-gogma Targets with reset_skills.finalPosition ≥ next
                ∪ conversion Targets with conversionPosition ≤ prev + 1 and finalPosition ≥ next
      if coverers(gap) = ∅: return infeasible(stream, lowest uncovered position = prev + 1)
  return feasible
```

### 8.2 covererの選択

各gapについてcovererを1つ決める（決定的）。

1. gapの直後のrequired位置 `next` を所有するTargetがcoverers(gap)に含まれるなら、それを選ぶ（**nearest-successor**。Routeが自分のrequired位置へ連続して届き、他Targetのrequired位置を跨がない）
2. そうでなければ、coverers(gap)のうち `finalPosition` が最小のTarget（chainを短く保つ）。同点はowned sourceを先、Target ID昇順
3. Skill gapでcoverers(gap)が空なら、§6.3のcoverage-driven value orderingへ戻る（巨戟化位置を `prev + 1` へ下げる `c < s*` 型option、または
   既存Gogma Targetの `reset_skills` をより後方のIdeal位置へ移すoptionを試す）。Plannerへ渡さない

nearest-successorはchainを短くし、materializationのSearch規模（§9.7）とRoute operation数を抑える。1,657のように1本の長いchain
（Gogma 55〜289）で全区間を被覆する形も、連続するgapを同じTargetが被覆すれば自然に現れる。どちらでも物理操作数は変わらない（§6.1）。

covererの選択は **予測** である。Phase Dでは、materialize済みEntryから正式に導出したreservationのもとでSearchが返すRouteのchainが実際の形になる
（§9.1）。予測は被覆pre-check、materialization順序（下記）、Search規模gate（§9.7）、診断に使い、Searchへの形状制約には使わない。

**materialization順序。** Phase Dは正式なreservationをmaterialize済みEntryから導出するため、あるTargetのSearchでheldとして使える位置は
先に materializeしたRouteのunit位置だけである。巨戟化Target（`conversion`）は、SEARCH_SPEC 5.6.8のcoverage条件により、巨戟化位置 c より前の
Skill位置がすべてheldでなければ c で巨戟化するRouteを返せない（巨戟化前の武器はSkill streamに存在しないので自分の操作を置けない）。
したがって順序はSkill被覆の依存関係に従うtopological順とし、決定的に導出する。

```text
materializationOrder(assign, coverage):
  order = []
  for t in conversion Targets sorted by conversionPosition asc, Target ID asc:
    for gap in Skill gaps below t.conversionPosition not yet covered by Targets in order:
      append coverer(gap) if not in order          // §8.2 の規則。owned-gogma Target、または巨戟化位置がより低い conversion Target（既に order にある）
    append t
  append remaining Targets by ascending max(Skill advance, Gogma advance, Normal advance), Target ID asc
```

- Gogma streamには存在制約が無い（巨戟化TargetもGogma originからReset / Keepを置ける。巨戟化を待つのはPlanner側の待機）。Normalも同様
  （covererを先にしても後にしても、held prefixのcanonical表現で両立する）。したがって順序を決める依存はSkill被覆だけである
- 先に materializeしたRouteは、自分の最後のrequired位置までの非held位置をすべて自分のchainで埋める（coverage条件）。後の Targetはそれらをheldとして
  跨ぐ。chainの実際の長さは順序で変わるが、物理操作数（Σ stream終端）は変わらない（§6.1）
- §8.1の被覆pre-checkが成立していれば、この順序は必ず作れる（Skill位置 x を被覆できるのは、既存Gogma、または x より低い位置で巨戟化するTargetだけ
  なので、依存は非循環）。作れない場合はpre-checkの実装不整合としてfail closedする

### 8.3 期待Route形（予測）と照合条件

Targetごとに `ExpectedRouteShape`（§4.4）を決める。**照合に使う** のはsource、stream別のrequired位置、required-only再生の最終武器であり、
chain位置は照合しない（chainはskippable unitで、Searchとmaterialization順序が決める）。chain区間の操作種別はoptionから一意に決まるので、
予測としては次のとおりになる（Search規模gateと診断用）。

| option | chain区間の操作 |
| --- | --- |
| `reset` g* | `a .. g*−1` はReset、g* はReset |
| `keep_from_source` g* | `a .. g*−1` はKeep、g* はKeep（layoutは保たれるのでg*の結果は不変） |
| `reset_then_keep` (g1, g*) | `a .. g1−1` はReset、g1 はReset、`g1+1 .. g*−1` はKeep、g* はKeep |
| `reset_skills` s* | `a .. s*` はReset Skills |
| `conversion` (c, s*) | c は巨戟化、`c+1 .. s*` はReset Skills（c = s* なら巨戟化だけ） |
| new_normal p（coverer） | `origin .. p` のforge（count = p − origin + 1） |
| new_normal p（非coverer） | held prefixのcanonical表現（PLANNER_SPEC 9.2.19.4）: `origin` から連続してheldな区間の直後からpまで |

**不変条件**: chain unitを加えても、required unitだけを適用した結果と最終武器が一致する（Reset→Reset、Keep→Reset、Keep→Keep、Reset Skills→Reset Skillsの
skip規則の根拠そのもの）。だからこそchain位置を照合せず、Phase Dは実際のCandidateの `finalBonuses` / scope / Skillと、
`createPlannerRouteUnitPlans()` が導出するrequired位置・sourceがoptionと一致することだけを確認する。

### 8.4 pre-checkの限界

§8.1は必要条件である。満たしても、Plannerの実際の判断（route commitmentの暫定帰結、holding unitの待機、`reserve` による他Target充足、
runtime-unsupported、`maxPlanSteps`）で成立しないことはあり得る。成立の最終authorityはPhase D'である。満たさない場合に
Plannerへ渡しても成立しないことは、stall規則から確実に言える（渡さない）。

## 9. MaterializationとProduction Planner検証（Phase D / D'）

### 9.0 現行Search APIで強制できることと、できないこと（レビューB2）

`visitPlannerAlternativeCandidates()` の入力は `origin` / `targetWeaponId` / `extent` / `reservation`（held / blocked / 排他OwnedWeapon）/
`excludedRouteKeys` だけである（SEARCH_SPEC 5.6.8）。sourceで確認した合法位置規則（`nextOperationPositions()`: 合法位置 = `[from, 最初の非held位置] \ blocked`）
から、現行APIで決まること・決まらないことは次のとおりである。

| 制御 | 現行APIで | 根拠 |
| --- | --- | --- |
| blocked位置に自分の操作を置かない | **できる**（hard） | blocked ⊆ heldの定義。`blocked` は他Routeの必須かつ共有不可unitの位置という意味を持つ値であり、形状制約の道具ではない |
| 最初の非held位置で必ず操作する（または止まる） | **できる**（coverage条件の帰結） | originから自分の最後の操作位置までの各位置は自分の操作かheld |
| held（非blocked）位置で操作するか跨ぐか | **決められない**（Searchがcost順で選ぶ。6キー順序の1番目はown operation数なので、同じ結果ならskipが先に出る） | 「置くかどうかは探索の選択であり、costで比較する」 |
| required位置（最終Reset / Keep、巨戟化、Reset Skillsの位置）を特定の値にする | **決められない**（extentとblockedで候補範囲を狭めるだけ。Ideal位置のうち最もcostの低いものから順に返る） | 6キー順序 |
| 特定のown操作位置集合（chain区間を含む）を1つだけ返させる | **できない** | 上記2点 |
| 排他OwnedWeaponをsourceにしない | **できる**（hard） | `isAvailableRouteSource()` |

したがって本設計は、**正当なreservationだけでSearchし、返されたCandidateの形をSearch後に照合する**（レビューB2の選択肢1）を基本とし、
reservationの導出元を **既にmaterialize済みの他Target Entry**（選択肢2）にする。初版の「自分が操作しない位置をすべてheld + blockedにするmold」は、
blockedを形状制約に流用しており、正式なreservation semantics（PLANNER_SPEC 9.2.19.3）と整合しないので **廃止** する。
Research専用の形状制約付き探索（選択肢3）は、§9.8の設計検証で正当なreservationだけでは期待する形を実用的なdelivery数・Search規模で得られないと
判明した場合に、独立した将来APIとして別途設計する（本書では設計しない。現行APIに無い能力を「ある」とは書かない）。

### 9.1 Planner Alternative Searchによるmaterialization（主方式: 正当なreservation + 形状照合）

Target tをPhase Cの順序（§8.2）で1件ずつmaterializeする。Planner-start originは `createPlannerStartSearchOrigin(plannerInput)`。

```text
materializeTarget(t, materializedEntries, shape):
  reservation = materializedEntries が空 ? emptyPlannerAlternativeReservation
              : derivePlannerAlternativeReservation(materializedEntries, engine)   // 正式な導出。held / blocked / 排他OwnedWeapon を一切改変しない
  extent      = extentFor(shape)                                                    // 下記。期待Route形の最後の required 位置までの window
  predicted   = predictSearchScale(reservation, extent, shape)                      // §9.7。gate を超えれば not_executed(search_scale_gate) を返して実行しない
  delivered   = 0
  visitPlannerAlternativeCandidates({ origin, targetWeaponId: t, extent, reservation, excludedRouteKeys: [] }, engine, candidate => {
    delivered += 1
    entry = createDeterministicMaterializer(...).materializeBuildListEntry(candidate, plannerInput.buildListEntries).entry
    if matchesExpectedShape(entry, shape): accept(entry); return 'stop'              // required 位置・source・最終武器の一致（§8.3）
    if delivered >= deliveryCap: return 'stop'                                       // unconfirmed(delivery_cap_reached)
    return 'continue'
  })
  // 一致なしで終わった場合の分類（§9.6）:
  //   execution.summary.exhausted        → shape_mismatch（探索完了の明示的証拠。実行済み・不一致）
  //   execution.summary.stoppedByExtent  → unconfirmed(stopped_by_extent)（到達可能な work が未読。期待位置が extent 内でも未確認）
  //   execution.stoppedByConsumer        → unconfirmed(delivery_cap_reached)
  //   CandidateSearchError('cancelled')  → unmeasured(cancelled)

extentFor(shape):
  maxNormalAdvance = p − origin_normal + 1（new_normal）、1（それ以外）
  maxGogmaAdvance  = lastGogma − origin_gogma + 1（Bonus 操作なしは 1）
  maxSkillAdvance  = lastSkill − origin_skill + (owned gogma ? 1 : 0)（SEARCH_SPEC 3.1 / 5.6.8 の window 定義。最小 1）
```

- reservationは「他Routeの資源利用情報」として正式に導出した値だけを渡す。Research上の仮割当が「後で他Targetが使う予定の位置」をheld / blockedへ
  **先取りして書き込むことはしない**。まだmaterializeされていないTargetのrequired位置はblockedになっていないので、Searchがそこを使うCandidateを
  返すことがあるが、形状照合（required位置の一致）が拒否する。正しさは照合とC2（required位置互いに素）で担保し、reservationは探索を狭める情報としてだけ働く
- heldがmaterialize済みEntryのunit位置だけなので、t のRouteは「先行Routeが被覆していない位置」を自分のchainで埋める（coverage条件）。
  これが§8.2の予測chainに対応する。実際にどの位置を跨ぎ、どの位置で操作するかはSearchのcost順が決め、照合しない
- extentは期待Route形の最後のrequired位置までに限る（SEARCH_SPEC 3.1 / 5.6.8のwindow意味）。それより後方のIdeal位置は探索されない。
  C2により他Targetのrequired位置は（materialize済みなら）blockedなので、照合に合うCandidateより前に返り得るのは「extent内で非blockedの、
  より低costなIdeal位置を使うRoute」だけであり、solverの値順序（終端増分 asc、位置 asc）はそれを選びにくいが、保証はしない。delivery capで打ち切る
- 期待required位置がextent内にあることは、その形の探索が完了したことを保証しない。Searchが `stoppedByExtent` で終わった場合、extent値
  （Normal forge数、Gogma位置数、Reset Skills数のいずれか）が到達可能なworkを未読のまま残しており、期待形がその未読workの中にある可能性を
  Search側の情報だけでは否定できない。したがって一致なし + `stoppedByExtent` は常に `unconfirmed(stopped_by_extent)` とし、`exhausted` で終わった
  場合だけ `shape_mismatch` とする（再レビューR2、§9.6）
- 採用判定 `matchesExpectedShape()`: `createPlannerRouteUnitPlans([entry], engine)` のrequired位置（`canSkipWhenCounterPassed = false` のunitの
  `counterBefore`、stream別）と `BuildRoute.sourceOwnedWeaponId` が `shape.match` と一致し、Candidateの `finalBonuses` / `restorationBonusScope` /
  Series / Group Skillが §5.3 の再生結果と一致すること。chain位置・Route operation数・RouteKindは照合しない
- このreservationとSearchはResearch上の **speculative** な用途である（§16、G1）: 永続化せず、`PlannerConflictResolution` / lineageへ書かず、
  Worker protocolへ載せず、user-fixed Routeとして扱わない
- Normal: 先行Routeがforgeした位置がheldになるので、後続Targetの `create_normal_artian` はSEARCH_SPEC 5.6.8 / PLANNER_SPEC 9.2.19.4の
  held prefix canonical表現で返る。先行Routeが無ければ `origin .. p` の連続forgeになる。どちらもNormal被覆を保つ（§8.1）

### 9.2 Candidate Searchによるmaterialization（補助方式: 射影起点）

各streamで「最初のown操作位置から最後のrequired位置まで連続」する期待形（chain coverer、または短い連続Route）は、通常Candidate Searchが
射影起点から連続Routeとして返す形そのものである。Phase 2-A.5 Stage Bと同じく、sourceだけの在庫・当該Targetだけ・各streamの最初の操作位置を
起点にしたrngState / normalCounters・最小extentで `searchCandidates()` を実行し、canonical Idealを既存adapter `materializeGlobalResearchCandidate()`
（`createConstrainedCandidate(..., 'origin_reach')` + deterministic materializer。searchStateHashの書換えではない）でPlanner-start originのEntryにし、
§9.1と同じ `matchesExpectedShape()` で照合する。

- canonical Idealは射影起点から最初のIdealなので、期待形のrequired位置が「射影起点からの最初のIdeal位置」であるときだけ一致する。一致しない
  （別のcanonical Idealが返る、またはextent内で見つからない）場合は、この方式の限界であって期待形の不存在ではないので、Target別outcomeを確定せず
  §9.1 へ切り替える（1回だけ）。Target別の `MaterializationOutcome` は常に §9.1 の結果で決まる。Candidate Searchは1件しか返さないので
  delivery capの概念は無い
- 非連続形（`reset_then_keep` で g1 と g* の間を跨ぐ、巨戟化Targetの c より前をheldで跨ぐ）はこの方式では表せない。§9.1だけが対象になる
- 射影起点はPlanner-start originではないが、adapterがorigin reach・両hash・Route validation・Ideal判定を再構築するので、Entryの意味は
  Planner-start originに対するものになる（Phase 0 / Phase 2-A.5で使用済みの経路）。巨戟化Targetでも、射影したSkill originで巨戟化が1位置に
  固定されるため、§9.7のSearch規模が小さい

### 9.3 方式の選択

Targetごとに決定的に決める。

| 条件 | 方式 |
| --- | --- |
| 期待形が各streamで連続（§9.2の条件）、かつ巨戟化Target | **射影起点Candidate Search** を先に試す（巨戟化位置が固定されSearch規模が小さい）。一致しなければ §9.1 を1回 |
| 期待形が各streamで連続、owned gogma | §9.7の予測規模が小さい方。同点なら射影起点Candidate Search。射影起点側で一致しなければ §9.1 を1回。§9.1 側を先に試して `shape_mismatch` なら射影起点側を1回 |
| 非連続（held位置を跨ぐ） | §9.1 のみ |
| §9.1 が `shape_mismatch`（`exhausted` + 一致なし）で、射影起点側も一致なし | 候補のoutcomeを `materialization_failed`（実行済み・不一致）として記録し、generatorの次の候補へ |
| §9.1 が `unconfirmed`（`stopped_by_extent` / delivery cap）/ `not_executed` / `unmeasured` | 候補のoutcomeを `materialization_unconfirmed` として記録し、次の候補へ。該当Routeなしとは判定しない |

### 9.4 identityと決定性

- Candidate / Entry IDはdeterministic materializer（PLANNER_SPEC 9.2.13）が、search identity + Candidate semantic meaningから決める。
  search identityには `normalizePlannerSearchOrigin(origin, target)`、正規化したreservation（§9.1の正式導出値）、extent、本設計のalgorithm token、
  CalculationContextを含め、random UUID / Clock / request UUID / enumeration ordinalを含めない
- 同じ入力・同じmaterialization順序からは同じEntry IDが出る。PlannerInputに既に存在するIDとの衝突（内容が異なる）はfail closed（既存materializerのcollision規則）
- 観測trace（`bonusAmendmentTrace` / `skillAmendmentTrace` / `conversionSkillTrace`）はSearch出力のものを引き継ぎ、再抽選しない
- intermediate groupsはmaterializerが抽出する（追加予測なし）。本設計は選択（pin）を一切置かない
- `validateBuildCandidate()` / `validateBuildListEntry()` を通す。unsupported predictionを含むRouteは生成されない（Searchの契約）
- Candidate / Entryは常に正規のProduction Search結果から作る。期待形をもとにRouteOperation列を手で組み立ててEntryにすることはしない

### 9.5 Production Planner検証（Phase D'）

```text
finalInput = plannerInput with buildListEntries =
               for each planning Target t（Phase 0で固定した集合、§4.1）:
                 materialized Entry of t if present, else t's original valid Entry（分母維持。Phase 0 / P0R と同じ規則）
               plus every original Entry whose Target is not a planning Target, unchanged（元の validation で除外された Entry もそのまま残す）
             conflictResolutions = []
             options = { maxPlanSteps: researchMaxPlanSteps }   // Research条件（G12）
finalValidation = validatePlannerInput(finalInput, deps)
  → derivePlannerPlanningTargets(finalInput.targetWeapons, finalValidation.validBuildListEntries) が Phase 0 の planning Target 集合と
    同じ ID 集合であること（違えば planning_target_set_changed として fail closed。分母を増減させない）
  → 生成 Entry は 1 件も除外されていないこと
result = createProductionPlanWithObserver(finalInput, deps, options, observer)   // beforePlannerRun でfull run数を数える
replay = replayPlannerSearchTrace(finalInput, bestState, engine)                   // 独立に実行してplain evidenceへ記録
physical = summarizePlanPhysical(plan, finalInput)                                 // Σ stream advance = steps を確認
```

成立条件（すべて必須）: `termination.status === 'completed'`、`completedTargetCount === planningTargets.length`（Phase 0で固定した集合。
`targetWeapons.length` やactive Target数ではない）、`totalTargetCount === planningTargets.length`、selected = planning Targetの全Entry、Conflict 0、
rejected 0（resource_conflict 0）、warnings 0、Trace Replay valid、`physical.total === plan.steps.length`。
さらに `physical.total` がassignmentの `objective` と一致することを確認する。不一致は `objective_mismatch` として診断に残し、成立とは呼ばない
（恒等式が破れる = 本設計の前提が崩れている）。

成功条件(b)（P0Rと同じ）: 別のNode processで元Exportから入力を再構築し、生成Entryを各planning Targetの元Entryと置換しただけのfresh ordinary Plannerを
1回実行し（`verifyGlobalResearchFreshPlan()` と同じ経路。その `planningTargetCount` もPhase 0の集合と一致すること）、同じ条件を満たすこと。
(a)(b)の両方を満たした候補だけが `VerifiedPlanRecord` になり、`bestVerified` の候補になる。

### 9.6 outcomeの分類と候補の扱い（レビューR3）

「実行しなかったこと」「実行して未確認だったこと」「実行して不成立だったこと」を同一視しない。

| 事象 | Target別 `MaterializationOutcome` | 候補別 `CandidateOutcome` | 恒久除外 | 次の動作 |
| --- | --- | --- | --- | --- |
| Searchが `summary.exhausted = true` で終わり（extent内外とも到達可能なworkが残らない。探索完了の明示的証拠）、一致なし | `shape_mismatch` | `materialization_failed` | しない（候補単位の記録のみ。generatorは同じ候補を再生成しない） | 次の候補へ。推測で別のRouteを作らない。このreservation・順序での結果であり、別の順序でも不一致とは断定しない |
| Searchが `summary.stoppedByExtent = true` で終わり、一致なし（期待required位置がextent内にあっても同じ） | `unconfirmed(stopped_by_extent)` | `materialization_unconfirmed` | しない | 次の候補へ。実行不能ではない。extent / 方式選択の見直しは事前登録したResearch条件に従う |
| delivery capでconsumer stop（`stoppedByConsumer`） | `unconfirmed(delivery_cap_reached)` | `materialization_unconfirmed` | しない | 次の候補へ。この候補は未確認として残す（capを変えた再runは別の事前登録） |
| Search規模gate超過で実行しない | `not_executed(search_scale_gate)` | `materialization_unconfirmed` | しない | 次の候補へ。実行不能とは判定しない。gate値の見直しはPhase D-0の事前登録で扱う |
| timeout / OOM / process failure / cancel | `unmeasured` | `materialization_unconfirmed` | しない | 次の候補へ（cancelはrun全体を `search_incomplete` で止める）。不成立に読み替えない |
| 全Targetがmaterializeされたが、Plannerが完成しない / Conflict / rejected / Replay invalid / `maxPlanSteps` 到達 | — | `planner_rejected`（rejection reason・Conflictを記録） | しない | 次の候補へ。Conflictを `PlannerConflictResolution` で解決しようとしない。`maxPlanSteps` は自動で増やさない |
| Planner成立だが physical ≠ objective | — | `objective_mismatch` | しない | 成立と呼ばない。前提違反として報告 |

- 候補別outcomeは、どのTargetで止まったか・そのTargetの `MaterializationOutcome`・それまでにmaterializeしたTarget数を含む
- `materialization_unconfirmed` が1件以上ある結果は、「この候補は実行不能」ではなく「この条件（extent / cap / gate / envelope）では確認できなかった」である。
  `verified` が得られないrunの最終statusでは、`materialization_failed` / `planner_rejected` の件数と `materialization_unconfirmed` の件数を別に数え、
  `no_structural_candidate`（構造的候補が無い）と混同しない
- `shape_mismatch` の例外（`exhausted` 以外で探索完了を判定すること）は設けない。現行Search APIと正式仕様に、特定の形について探索が完了したことを
  `exhausted` 以外で保証する契約が無いためである（§2.6）。将来Search側にそのような明示的証拠が追加された場合も、正式仕様の変更を経てから使う
- run内でoption・部分割当・Targetを除外集合へ入れることはしない。同じ候補の再試行は、generatorが各完全割当を1回しか生成しないことで防ぐ

### 9.7 Search規模のgate

D2-G-Aの知見どおり、Planner Alternative Searchの規模はreservationとextentからSearch前に計算できる。§9.1の方式では

- conversion Skill位置数 = Skill reservationのoriginから連続するheld区間（+ 直後の非held位置）のうちblockedでない位置の数（`nextOperationPositions()` の規則）
- Gogmaの合法位置幅 = Gogma extent内の非blocked位置数、Skillの合法位置幅 = 同じくSkill
- Normalのforge数 = held prefixの直後からproduction targetまでの位置数

を `predictedSearchScale` として記録し、事前登録した上限を超えるrequestは実行せず `not_executed(search_scale_gate)` にする（§9.6）。
上限値は未計測なので本書では決めず、Phase D-0（§9.8）の事前登録項目とする。D2-G-AのK3 L2のように、巨戟化位置の候補数がSkill streamの保持量を
決めるので、巨戟化TargetはSearch規模が小さい §9.2 の射影起点方式を先に試す（§9.3）。

### 9.8 Phase D実装前の設計検証（D-0）

§9.0のとおり、現行APIは期待Route形を直接強制できない。したがって「正当なreservation + 形状照合」が、実Exportのstructural candidateに対して
実用的なdelivery数・Search規模で期待形を返すかは **未検証** であり、Phase Dの実装前に次の設計検証タスク（**Phase D-0**、§14）で確認する。

- 入力: Phase B / Cが実Exportで生成した最初のstructural candidate（oracle非依存）。Planner検証（D'）は行わない
- 計測: Phase Cの順序でTargetごとに §9.1 / §9.2 を実行し、`deliveredBeforeMatch`、`MaterializationOutcome` の分布、predicted / 実測Search規模、時間、heap
- 判定（事前登録）: 全Targetが `materialized` → Phase D-1へ。`shape_mismatch` / `delivery_cap_reached` / `search_scale_gate` が残る場合は、
  その内訳から (a) delivery cap・gate・方式選択規則の調整（事前登録値の変更）、(b) materialization順序の変更、(c) Research専用の形状制約付き探索API
  （§9.0の選択肢3）の設計、のどれが必要かを決める。(c)はdocs-onlyの設計を先行し、現行APIを改変して「できる」ことにしない
- この検証はPhase A〜Cの設計に影響しない（Phase A〜Cの出力はrequired位置と順序であり、materialization方式に依存しない）

## 10. 目的関数・下界・探索budget

### 10.1 目的関数と部分割当の下界

目的関数は `Σ_streams (streamEnd − origin)`。部分割当の下界 `LB(partial)` は次で定める（admissible。その部分割当のどの完成の構造的objectiveも、
したがって成立した場合の物理操作数も、この値を下回らない）。

```text
LB(partial) = Σ_streams ( max( currentEnd_stream,  floor_stream(unassigned) ) − origin_stream )
floor_stream(unassigned) = max over unassigned Target t of  minStreamEnd_stream(t, partial)
minStreamEnd_stream(t, partial) = min over resourceFeasibleOptions(t, partial) of option.streamEnd_stream
```

各未割当Targetはいずれかの資源実行可能optionを取る必要があるので、そのstream終端はそのTargetの最小終端以上になる。これは `solveLowerBoundRelaxation()` の
`skillFloor` / `gogmaFloor` と同じ考え方であり、位置排他（他の未割当Target同士）・被覆を無視するので真の最小以下である。

依存関係と使い方（レビューR1）:

- `resourceFeasibleOptions` は資源条件（source排他、required位置排他、window、必要条件）だけで決まり、`LB` を読まない
- `LB` は `resourceFeasibleOptions` のstream別最小終端だけを読み、枝刈りを再帰的に呼ばない
- pruningは `LB(child) >= UB` の比較であり、**UBは `bestVerified.physicalOperations` だけ**（レビューB1）。`bestVerified` が無い間はpruningしない。
  未検証のstructural candidateのobjectiveを上界に使うと、その候補が後段で不成立になったときに、より大きいobjectiveの実行可能解を既に切っている
  可能性があるため
- MRVの候補数評価は `resourceFeasibleOptions` の件数だけで行い、`LB` による枝刈りと分離する

### 10.2 root下界と最小性の主張

- root下界は `collectLowerBoundProblem()` + `solveLowerBoundRelaxation()` で求める。入力のcross satisfaction監査（`auditCrossSatisfaction()`）が
  可能ペア0件のときだけ `found` の値を証明済み下界として使う
- 下限moduleの対象集合（`isTargetWeaponPlanningEligible()` なTarget全体）がplanning Target集合（§4.1）と一致しない入力では、root下界をそのまま
  planning Targetの下界として使わない（eligibleだがvalid Entryの無いTargetの分だけ下界が大きくなり得るため）。Phase Bの事前登録で、
  (a) 下限を主張しない、(b) `targetWeapons` をplanning Targetだけに絞ったPlannerInput copyをResearch adapterから下限moduleへ渡す（下限module自体は変更しない）、
  のどちらかを選ぶ。対象Export（43 eligible / 43 valid Entry）では両集合が一致する
- `proven_minimum` は、**Production検証済みの** `bestVerified.physicalOperations` が、適用可能で証明済みのroot下界 `provenLowerBoundTotal()` と
  一致した場合だけ許可する。structural candidateのobjectiveが下界と一致しても、検証前には何も主張しない（レビューB1）
- 可能ペアが1件以上あるPlannerInputでは下界は `not_applicable` であり、**最小性を主張しない**。solverはC1（distinct source）のまま実行可能解を探し、
  結果は常に `best_found`。branch-and-boundの `LB(partial)` も、そのTargetペアに関しては「1本の武器で2 Targetを完成させる割当」を見ていないので
  安全な下界ではない。したがって可能ペアがある入力では、`LB(partial)` を可能ペアに属するTargetについてはfloorへ含めない（残りのTargetだけで下界を取る）。
  これで下界は再び安全になる（可能ペアのTargetが1本の武器で完成し得ても、他TargetのfloorはそのTargetに依存しない）
- `singleStreamLowerBounds()` は説明用であり加算しない
- 1,657をどのExportの下界・探索上限にも使わない。下界は常にそのPlannerInputから計算する

### 10.3 走査window ladderと拡大条件（レビューR2）

Phase Aの走査windowは事前登録したladderで広げる。

- W0 = `recommendedCandidateSearchDefaults`（Normal 350 / Gogma 500 / Skill 1500、Issue #125、`src/domain/models/common.ts`）。これはCandidate Searchの
  推奨初期値として既に正式仕様（REQUIREMENTS 14.1）に根拠を持つ非oracle起源の定数であり、Phase 0 / 1-E / P0RのResearch extentでもある。
  Plannerが読むauthorityにはしない（Research入力として明示的に渡す）
- Normal 2倍（P0R V1）のような固定倍率をTarget個別に適用しない。rungの値と上限はPhase Aの事前登録で決める（§15）
- window外の位置を「存在しない」と記録しない。結果は常に `window` を併記する

次rungへの移行は、**現windowでの探索結果の種類** で決める（oracle情報に依存しない汎用規則。「incumbentが末端に接していなければ拡大不要」とはしない）。

| 現windowの結果 | 意味 | 次rung |
| --- | --- | --- |
| `no_structural_candidate` / `target_without_option` | Target単位でoptionが無い | **拡大する** |
| `no_structural_candidate` / `resource_exclusivity` | 各Targetにoptionはあるが、資源排他で完全割当が無い（探索木を使い切った） | **拡大する**（次windowの新しい位置が排他を解き得る） |
| `no_structural_candidate` / `coverage_infeasible` | 完全割当はあるがCounter被覆が成立しない（探索木を使い切った） | **拡大する**（例: より後方のReset Skills位置が既存Gogmaの被覆を伸ばす） |
| `structural_only`、completeness = `exhausted`、候補の不成立がすべて `materialization_failed` / `planner_rejected` | 構造的候補はあったがどれも成立せず、未確認は無い | **拡大する**（別の位置・sourceの候補が成立し得る。事前登録した上限rungまで） |
| `structural_only`、completeness = `exhausted`、`materialization_unconfirmed` が1件以上 | 成立しなかった原因に未確認（cap / gate / envelope）が含まれる | **拡大しない**。先にcap / gate / envelopeの事前登録値を見直す（windowの問題と断定しない） |
| `search_incomplete`（node budget / verification budget / cancel） | 未探索枝が残る | **拡大しない**。「window内に完全割当が存在しない」と結論しない。node / verification budgetの見直しが先 |
| `verified` | 成立 | Phase Bとしては拡大しない。Phase Eの最適化として、`bestVerified` のいずれかのstream終端がwindow末端に接しているときに別rungを試してよい（より広いwindowはstream間のtrade-offで別の組合せを許し得るが、保証はしない） |
| `unmeasured` | 未計測 | 拡大しない。envelopeの見直しが先 |

- 拡大は全Target共通のrungで行い、Target個別のwindowを持たない
- 上限rungに達しても `no_structural_candidate` のままなら、結果は「事前登録したladderの範囲では構造的候補が無い」であり、実行可能解の不存在ではない

### 10.4 budgetの分離（G5）

| 概念 | 単位 | 性格 |
| --- | --- | --- |
| 走査window | Counter位置数（stream別） | Phase Aの範囲。ladderで事前登録。移行規則は§10.3 |
| node budget | solverの展開node数（決定的） | Phase Bの範囲。到達は `search_incomplete`（completeness `node_budget_reached`） |
| verification budget | Phase D / D'へ渡すstructural candidateの件数（1 run） | Phase B〜D'の範囲。到達は completeness `verification_budget_reached`、未試行候補は `not_attempted` |
| materialization delivery cap | 1 Targetで受け取るCandidate数 | Phase Dの範囲。到達は `unconfirmed(delivery_cap_reached)`（未確認） |
| Search規模gate | 事前計算した規模（§9.7） | Phase Dの範囲。超過は `not_executed(search_scale_gate)`（未実行） |
| full Planner run数 | `beforePlannerRun()` の回数 | Phase D'の観測値。Production `maxPlannerReruns` を流用しない |
| `maxPlanSteps` | Research 20000（Domain default 1000 / Planner Alternative runtime導出とは別、G12） | Phase D' |
| wall-clock / heap | measurement envelope | `unmeasured` の判定だけに使う。意味論的判定に使わない（G6 / G7） |

具体値（node budget、verification budget、delivery cap、Search規模gate、ladder rung）は根拠となる計測が無いので本書では決めない。各Phaseの事前登録で、
そのPhaseの非formal smokeを根拠に固定し、formal run後に変えない。

### 10.5 評価の優先順位

第一（成立）: 全planning Target完成、Conflict 0、rejected / resource_conflict 0、termination completed、Trace Replay valid（`verified`）。
第二（品質）: 物理操作数（= Σ stream終端）、実行時間、メモリ。操作数と計算性能は別の指標として評価し、混同しない。
部分解（`structural_only` / `search_incomplete`）は、構造的候補のobjective・候補別outcomeの内訳（failed / rejected / unconfirmed）・完成Target数を
併記し、全体最適解と混同しない。「最短性の証明」（`proven_minimum`）と「探索で発見した最良実行可能解」（`best_found`）を区別する。

## 11. Oracle isolation

### 11.1 境界

| 区分 | 読むもの | 読まないもの |
| --- | --- | --- |
| oracle-free execution（Phase A〜D'、runner） | PlannerInput、ProductionRngEngine、Master、Research入力（window ladder / budget）、正式仕様の制約 | oracle manifest / verifier / RESULT JSON、oracleのTarget別Route、source OwnedWeapon ID、Normal / Skill / Gogma位置、Candidate / Entry ID、Target順序、Target個別extent、manifestから抽出した割当、既知の成功context、過去のRESULTの完成Target集合 |
| post-hoc evaluation（analyzer） | formal run終了後に `--optimum docs/PLANNER_GLOBAL_1657_ORACLE_RESULT.json` を引数で読み、Plan steps、Target別Route（source / 位置 / RouteKind）、Conflict、下限を比較する | analyzerの出力をrunへ戻さない |

「このExportでは火N0、龍N206だからそう選ぶ」というTarget・属性・位置に紐づく規則をどこにも置かない。火 / 龍の非対称は、同じ族構成一致Normal位置を
2 Targetが要求するというC1 / C2の排他制約と、`reset` optionの存在から、solverが動的に導くべきものである。

### 11.2 oracle-informed designの開示

本設計はoracleを実行時に読まないが、設計自体は1,657の構造（held Route、shared coverage、source trade-off、長いchainによる被覆）に **informed** されている
（Phase 2-C2.7-A §2.3の意味）。provenanceに `oracleInformedDesign = true` を記録し、`oracleFreeExecution = true` と区別する。window ladder W0、
node budget、delivery cap、Search規模gateを1,657の値や過去run観測から導いた場合は、その項目ごとに `oracleInformed = true` と記録する
（W0は非oracle起源、§10.3）。oracle非依存policyの存在証明は本設計からは言えない。

### 11.3 test

- source scan: Phase A〜D' module・runnerが `plannerGlobalOracle1657Manifest.ts` / `plannerGlobalOracle1657.ts` / `PLANNER_GLOBAL_1657_ORACLE_RESULT.json` /
  `PLANNER_GLOBAL_*_RESULT.json` をimport・読込しないこと、UUID / 64桁hex literal / Export SHA-256 / Target ID先頭8文字を含まないこと
  （既存isolation test `plannerGlobalOracle1657.test.ts` と同じ方式）
- runnerが `--optimum` 引数を持たず、analyzerだけが受け取ること
- Production module（`src/domain` / `services` / `workers` / `pages` / `components` / `db`）から本設計のmoduleへ到達しないこと、`dist` に識別子が無いこと

## 12. Determinism / cancel / incomplete

- **決定性**: 同じPlannerInput・同じResearch入力・同じEngine versionから、同じReachTable、同じnode列、同じstructural candidate列、同じmaterialization順序と
  request列、同じEntry ID、同じPlanner結果（semantic）が出る。Clock・乱数・enumeration ordinalを意味に入れない（Entryの `createdAt` は固定Clock）。
  Phase D / D'の結果はUB（`bestVerified.physicalOperations`）を通じてだけ以後の探索に影響する（§6.5）
- **cancel**: 既存Research seam（`shouldCancel()` / `yieldControl()`）を、Phase Aの位置走査（stream × 位置のloop）、Phase Bのnode、Phase Dの
  Search（Search内部の既存checkpoint）、Phase D'のscheduler（既存64 action毎のyield）で確認する。synchronousなTrace Replay / execution projection中の
  即時cancelは保証しない（Phase 2-Bの観測どおり）
- **中断・再開**（Phase E）: generatorの探索状態はplain data（割当stack、各nodeの値順序の位置、node数、UB、bestStructural、bestVerified、候補別outcome）なので
  保存・再開できる。再開は同じ入力hashのときだけ許し、再開後の候補列は中断しなかった場合と一致する
- **incomplete / unknown / unmeasured / rejectedの区別**: node budget・verification budget・cancelは `search_incomplete`（未探索枝が残る。窓内に候補が無いとは
  結論しない）、wall-clock / heapは `unmeasured`、探索木を使い切っての候補不在は `no_structural_candidate`（reason別）、構造的候補はあるが成立しないのは
  `structural_only`（候補別に `materialization_failed` / `planner_rejected` = 実行済み不成立と、`materialization_unconfirmed` = 未確認
  （`stopped_by_extent` / delivery cap）/ 未実行（gate）/ 未計測を分ける）。
  いずれも「実行可能解が存在しない」とは書かない。per-Target診断（option数、dead endになった部分割当の最小位置、被覆不成立の位置）を併記する。
  分母は常にPhase 0で固定したplanning Target集合である（§4.1）

## 13. Test / acceptance

### 13.1 synthetic fixture（oracle非依存）

Production RNGを使わないFake Engine / 小規模fixtureで意味論を固定する（既存の決定的Planner fixture `createDeterministicPlannerDependencies()` /
`src/test/fixtures/plannerSchedulerWorkloads.ts` と同じ系統）。

| 対象 | test |
| --- | --- |
| Phase 0（planning Target集合） | `derivePlannerPlanningTargets()` でProductionと同じ集合になること: (1) active Target + valid Entryあり → 含む、(2) active Target + Entryなし → 含まない、(3) active Target + stale / invalid Entryのみ → 含まない、(4) disabled / completed Target → 含まない、(5) valid Entry 0件 → planning Target 0件（`unsupported_input(no_planning_target)`、active Target全体にしない）、(6) Phase D / D'で生成したEntryで置換したfinalInputから再導出した集合が元と同じID集合（`planning_target_set_changed` の検出を含む）。`targetWeapons.length` / active Target数を分母に使うassertが無いこと |
| Phase A | 2〜3 Target・小window（例: Skill 6 / Gogma 6 / Normal 3）で、ReachTableの各位置集合が総当たり再生と一致。ReachTableの `targets` がPhase 0の集合と同じ要素・順序で、既存EntryのRoute内容に依存しない（Entryのsource / 位置を変えてもReachTableが変わらない）。unsupported予測でoption不在。保護武器はIdeal現在性能だけ。関心layoutがIdeal multisetの順列に限られる。`collectLowerBoundProblem()` の閾値がReachTableから再導出できる |
| Phase B | 総当たりで最小目的関数が分かる小入力に対し、generatorが生成するstructural candidate列に総当たり最小の割当が含まれ、UB無しでは枝刈りが起きない（全完全割当が生成順に出る）。UB（verifiedの物理操作数を模したstub）を与えると `LB >= UB` の枝だけが切られ、UB未満の割当は失われない。C1 / C2違反の割当を返さない。同じ資源を要求する2 Targetで一方へ `reset` option、他方へ `keep_from_source` が割り当たる（火 / 龍型）。node budget到達で `search_incomplete`。決定性（2回実行で同一node列・同一候補列、yield後の再開が同じnodeの次の値から始まる）。`resourceFeasibleOptions` → `LB` → pruningの一方向依存（`LB` 計算中にpruningもoption列挙も再入しない） |
| Phase B（下界） | root下界 ≤ 総当たり最小。cross satisfactionペアを持つ入力で `not_applicable` と `best_found`。`LB(partial)` が総当たりの残り最小を上回らない。structural candidateのobjectiveがroot下界と一致しても `proven_minimum` を返さない |
| Phase B（window） | §10.3の移行規則: `target_without_option` / `resource_exclusivity` / `coverage_infeasible` の各reasonが区別され、各Targetにoptionがあっても排他で完全割当が無い入力で次rungへ移る。node budget到達では移らない |
| Phase C | Skill被覆不成立の入力（全Targetが巨戟化Routeで、originのSkillを誰も使わない）を検出し、coverage-driven value orderingで `c = origin` 型optionを選ぶ。Gogma / Normal被覆が常に成立。materialization順序が巨戟化位置の低い順にSkill covererを先行させるtopological順になる。chain付きRoute形の再生がrequired-only再生と同一の最終武器 |
| Phase D | `derivePlannerAlternativeReservation()` でmaterialize済みEntryから導出したreservationだけを渡し、held / blockedを改変していない（入力を捕捉して比較）。空reservationの最初のTargetが連続Routeを返し、後続Targetがheld位置を跨ぐ非連続Routeを返す。`matchesExpectedShape()` がrequired位置・source・最終武器だけで判定し、chain位置が異なっても採用する。outcome分類: (1) `exhausted` + 一致なし → `shape_mismatch`、(2) `stoppedByExtent` + 一致なし → `unconfirmed(stopped_by_extent)`、(3) `stoppedByExtent` + required位置がextent内 + 一致なし → `unconfirmed(stopped_by_extent)`（`shape_mismatch` にしない）、(4) delivery cap → `unconfirmed(delivery_cap_reached)`、(5) gate超過 → `not_executed(search_scale_gate)`、(6) timeout / OOM / cancel → `unmeasured`。`unconfirmed` / `not_executed` / `unmeasured` が恒久除外にならず、枝刈り・`proven_minimum` の根拠にならない。射影起点Candidate Searchの不一致がTarget別outcomeを確定せず §9.1 へ切り替わる。射影起点Candidate Searchが連続形で同じ最終武器を返す。held prefix canonical表現 |
| Phase D' | fixtureで `createProductionPlanWithObserver()` がcompleted / Conflict 0 / Replay validを返し、`summarizePlanPhysical()` の合計がassignment objectiveと一致して `verified` になる。Plannerが落とす集合は `planner_rejected` となり、同じ候補が再生成されず、他の候補が除外されない。被覆pre-checkが不成立の集合をPlannerへ渡すとstall dropになること（pre-checkの妥当性） |
| isolation | §11.3 |

### 13.2 統合acceptance（実Export、formal measurement）

Phase D-1のformal runで次を事前登録する（値はPhase D-0 / D-1の事前登録で確定）。

1. `verified`: 43 / 43、Conflict 0、rejected 0、completed、Trace Replay valid、別processのfresh ordinary Plannerでも同じ
2. 物理操作数をincumbent 8,534（Phase 1-E / 2-A / P0R）とpost-hocに比較し、次のとおり判定する（操作数の評価）。
   計算時間・メモリの改善は別の指標として別途主張し、操作数の評価と混同しない

   | `bestVerified.physicalOperations` | 判定 |
   | --- | --- |
   | 8,534未満 | 操作数改善 |
   | 8,534 | 既存incumbentと同等 |
   | 8,534超 | 操作数では既存incumbentに劣る |
   | （`verified` が無い） | 完成数の観点で未達（43 / 43未達）。操作数は評価しない |

3. 1,657（Phase 2-A.5）との比較はpost-hoc analyzerだけが行う。一致しなくても失敗ではない（`best_found`）。Production検証済みの物理操作数が
   適用可能で証明済みの下限と一致すれば `proven_minimum`
4. formal validity: measurement HEADがclean、Export SHA-256一致、Production changed files = `[]`、oracle未読（§11.3）、事前登録条件の不変

## 14. 実装Phase分割

Phase A → B → C → D-0 → D-1 → Eの順に依存する。1 Phase = 1 PR（必要なら事前登録docs PRと実装 / 計測PRに分ける。D1〜D2系列と同じ運用）。
Phase Dは、materialization方式の設計検証（D-0）と統合acceptance（D-1）に分ける（§9.8）。Phase A〜Cの設計はmaterialization方式に依存しないので、
D-0の結果でA〜Cをやり直す必要はない。

| Phase | 変更範囲 | 入力 | 出力 | acceptance | テスト | 次Phaseへの依存 | Production影響 | formal measurement |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **A 到達option生成** | `src/benchmarks/globalAssignment/context.ts`（Phase 0: `validatePlannerInput()` + `derivePlannerPlanningTargets()` による `GlobalAssignmentContext`）、`reachTable.ts`（提案）、test、走査helperの下限moduleとの共有（下限moduleの契約不変） | PlannerInput、Engine、window | `GlobalAssignmentContext`（固定したplanning Target集合）、`ReachTable`、`enumerateOptions()`、`replayOptionRequiredOnly()`、走査summary（予測回数、window到達） | §13.1 Phase 0の6ケース、synthetic一致、ReachTableが既存Entry内容に依存しないこと、下限閾値の再導出、unsupported / 保護 / 未確定Counterのfail closed、oracle isolation | §13.1 Phase 0 / Phase A | Bの入力 | なし | 不要（実Exportの走査時間・予測回数はPhase Bのrunで診断として記録） |
| **B 資源割当（generator）** | `globalAssignment/assignmentSolver.ts`、`lowerBound` 接続、runner（assignment-only mode。Phase D / D'は呼ばず、UBは与えない） | ReachTable、node budget、window ladder | structural candidate列（先頭k件）、`bestStructural`、root下界、node列診断、`no_structural_candidate`（reason別）/ `search_incomplete`、§10.3の移行判定 | synthetic最小一致、C1 / C2、決定性と再開、UB無しで枝刈りしない、下界の安全性、R1の一方向依存、R2の移行規則 | §13.1 Phase B | Cの入力 | なし | **要**（実Exportでassignment-only run: 先頭候補のobjective、root下界、node数、時間、完成性。**43 / 43 Plan・verified・proven_minimumはB単独では報告しない**） |
| **C Counter被覆とRoute構成** | `globalAssignment/coverage.ts`、solverへのcoverage check接続、materialization順序、`ExpectedRouteShape` | structural candidate | `StreamCoverage`、materialization順序、`ExpectedRouteShape[]`、不成立位置 | synthetic被覆、coverage-driven ordering、順序のtopological性、chain再生一致 | §13.1 Phase C | D-0の入力 | なし | 不要（Bのrunへ被覆・順序診断を追加） |
| **D-0 materialization方式の設計検証** | `globalAssignment/materialize.ts`（§9.1 / §9.2 / §9.3）、Search規模予測、runner（materialize-only mode）、事前登録docs | 実ExportのPhase B / C出力（最初のstructural candidate）、Engine、Planner-start origin | Target別 `MaterializationOutcome`、`deliveredBeforeMatch`、predicted / 実測Search規模、時間、heap、§9.8の判定 | 全Targetが `materialized` ならD-1へ。残るoutcomeの内訳から (a) 事前登録値の調整 (b) 順序変更 (c) 形状制約付き探索APIのdocs-only設計 のどれが必要かを決める | §13.1 Phase D | D-1の前提 | なし | **要**（事前登録: delivery cap、Search規模gate、方式選択規則、envelope。Planner検証は行わない） |
| **D-1 Planner検証（統合acceptance）** | `globalAssignment/verify.ts`、runner（full mode: B → C → D → D'のloop）、analyzer（post-hoc oracle比較） | D-0で確認した方式、verification budget | `VerifiedPlanRecord` / `GlobalAssignmentResult`、候補別outcome、RESULT JSON | 実Exportで `verified`（§13.2）。不成立なら理由別status（§4.6） | §13.1 Phase D'、isolation | Eの基準 | なし | **要**（事前登録: verification budget、Research maxPlanSteps、envelope） |
| **E 最適化・性能** | incremental coverage pruning、決定的なdiscrepancy探索、中断再開、window拡大（verified時）、メモリ内訳、Browser Worker測定 | D-1の `bestVerified` | 改善した `bestVerified`、性能記録 | 全Target完成を維持したまま物理操作数を改善（8,534未満。§13.2）。時間・メモリは別指標。退行は不受理 | 既存acceptanceの維持、Browser isolation | — | なし（Production化は§16の別PR） | **要** |

最初の実装Phase（A）は、小さなsynthetic fixtureだけで意味論を検証できる。実Exportの43 TargetはPhase B（assignment-only）で初めて使い、
materialization方式の実用性はD-0で、43 / 43 Planの統合acceptanceはD-1で行う。

## 15. 未決事項・リスク・採用しなかった案

### 15.1 実装前に解決が必要なもの（docs PRまたは各Phaseの事前登録）

| 項目 | 内容 | 解決場所 |
| --- | --- | --- |
| window ladderのrungと上限 | W0 = 350 / 500 / 1500は定まるが、W1以降と上限。移行規則は§10.3で確定（全Target共通rung） | Phase A事前登録 |
| node budget / verification budget | 根拠となる計測が無い。Phase Bの非formal smokeで決める | Phase B / D-1事前登録 |
| delivery cap / Search規模gate / 方式選択規則の閾値 | §9.3 / §9.7。D2-G-Aのモデル値をgateの根拠にするか | Phase D-0事前登録 |
| **materialization方式の実用性**（Phase D実装前） | §9.0のとおり現行APIは期待Route形を直接強制できない。「正当なreservation + 形状照合」が実Exportのstructural candidateに対して実用的なdelivery数・Search規模で期待形を返すかは未検証。返らない場合、Research専用の形状制約付き探索APIのdocs-only設計が先に要る（§9.8。現行APIを改変して「できる」ことにしない） | Phase D-0（設計検証） |
| materialization順序とchain長 | Phase Cのtopological順（§8.2）はSkill被覆依存だけを拘束し、残りはmax advance昇順。先行Routeのchainが長くなる順序ではSearch規模が増え得る。順序の別案（Gogma終端昇順など）はD-0の結果で判断 | Phase D-0 |
| checkpoint selectionを持つEntry | 本設計はpinを置かない。元Entryに選択があるTargetは `unsupported_input`（`checkpoint_selection`）でfail closedする（PLANNER_SPEC 9.5.2と同じ扱い）。対象Exportでは0件 | 本書で決定（上記） |
| Normal Counter未確定 | blind variantをoptionにしない。`unconfirmed_counter` でfail closed | 本書で決定 |
| cross satisfaction可能ペア | distinct sourceで実行可能解を探し、最小性を主張しない（§10.2）。1本の武器で2 Target完成を割当に含める拡張は行わない | 本書で決定 |
| 複数Target同一武器のゼロ操作option | 保護・未保護を問わずIdeal現在性能のowned gogmaは、cross satisfactionペアで2 Targetが同じ武器を要求し得る。C1でどちらか1つに割り当てる（他方は別option）。Planner側はcross satisfactionで両方完成させ得るので、objectiveは上界になる | 本書で決定（最小性不主張と整合） |

### 15.2 後続実験で判断できるもの

- covererの予測規則（nearest-successor vs 最大終端Targetの単一chain）と、Searchが実際に返すchainの一致度・Search規模への影響
- §9.1（正当なreservation + 照合）と §9.2（射影起点Candidate Search）の時間差と `deliveredBeforeMatch` の分布
- `LB(partial)` の強化（例: 残りTargetの二部マッチング可否をnodeごとに判定）の費用対効果
- verified取得前の候補順序（値順序だけ）で最初の候補がどの程度良いか。verifiedが得られるまで枝刈りが無いことによるnode数の増加
- incremental coverage pruning（完全割当を待たず、Skill origin側の被覆不成立を部分割当で検出）
- 決定的なdiscrepancy探索（LDS）の採否
- Phase D'の長いPlanにおけるTrace Replay / execution projectionのメモリ（Phase 2-Bの観測: projectionはStep数に比例）
- Browser Worker / スマートフォンでの実行可能性（Node測定をProduction runtimeの根拠にしない）

### 15.3 リスク

| リスク | 影響 | 緩和 |
| --- | --- | --- |
| Phase AのwindowにIdeal位置が無いTarget、または資源排他 / 被覆で完全割当が無い | `no_structural_candidate` | §10.3の規則でladderを広げる。「存在しない」とは記録しない |
| Phase Bの探索空間（1 Targetあたりoption数 × 43）、特にverified取得前は枝刈りが無い | node budget到達（`search_incomplete`） | MRV、lazy enumeration、coverage-driven ordering、最初の候補を即座にPhase Dへ渡してUBを早く得る。bestStructural / bestVerifiedは常に保持 |
| 正当なreservationだけでは期待形が低いdelivery indexで返らない | `unconfirmed(delivery_cap_reached)` が多発 | D-0で計測し、cap・順序・方式選択を調整。必要なら形状制約付き探索APIを別途設計（§9.8） |
| 先行Routeのchainが長い / 巨戟化位置候補が多いSearchの規模 | 時間 / OOM（`not_executed` / `unmeasured`） | §9.7 gate、巨戟化Targetは§9.2を先に、順序の見直し（D-0） |
| 被覆pre-checkが通ってもPlannerが落とす | `planner_rejected` | 候補単位で記録し、generatorの次候補へ。option / 部分割当を除外しない。原因をrejection reason別に記録し、新しい共有規則を作って回避しない |
| 未検証候補のobjectiveを上界に使うことによる実行可能解の喪失 | より高いobjectiveのverifiedを切り落とす | UBは `bestVerified.physicalOperations` だけ（§6.3 / §10.1）。verifiedが無い間は枝刈りしない |
| 恒等式（physical = Σ advance）の不一致 | `objective_mismatch` | 成立と呼ばない。前提違反として報告 |
| 分母維持のため未成立Targetの元Entryを残すと、その元Entryが成立Entryと競合する | Conflict > 0 | Phase 0 / P0Rと同じ規則。未成立Targetがある時点で `verified` ではない |

### 15.4 採用しなかった案

| 案 | 理由 |
| --- | --- |
| sequential projection（Phase 0 / 1-E）を中心に据える | 8,534の主要構造要因（Phase 2-B）。incumbentの維持には使えるが改善の中心にならない |
| Conflict orientation / support contextごとのportfolio先行（C2 / D2） | full Routeを先に列挙してOOM / timeout。1 fixed winner contextの制限。局所的な共存評価では24 / 43止まり |
| Planner Alternative extentを広げる | PR #137 / Issue #101の教訓（upfront solve、Skill 341固定）。D2-F-BのK3 L2 OOM |
| 乱数restart | 非決定性。事前登録・再現・再開と相性が悪い |
| 外部ILP / SATソルバ | 依存追加、Browser実行、決定性。Research範囲を超える |
| 新しいConflictKind / 共有規則 / Counter semantics | 正式仕様の変更になる。本設計は既存authorityの範囲で成立する |
| 武器種・属性・Target IDに紐づく選択規則（例: チャアク火はN0） | oracleの一般化に見せかけた固定値。排他制約から動的に導く |
| Beam Search oracleの流用 | Production PlannerはPhase Cで決定的schedulerへ切替済み。Beamは回帰oracleであり、Production成立判定に使えない |

## 16. Production契約との境界

本設計はResearchであり、既存Productionの通常Planner・競合repairを変更しない。現在の正式仕様では、PlannerはBuild Listに登録済みのRouteを計画し、
明示的な選択の無い競合を自動で再検索しない（REQUIREMENTS 19 / 23、PLANNER_SPEC 7 / 9.2.19）。したがってGlobal Assignmentが生成した候補集合を、
そのまま既存Productionの無選択repairとして接続する設計にはしない。

| 概念 | authority | 本設計での扱い |
| --- | --- | --- |
| user-fixed Route | PLANNER_SPEC 9.2.19.3のfixed Route集合（明示選択、valid explicit resolution、有効なlineage） | 読まない・作らない |
| explicit conflict resolution | `PlannerConflictResolution`（REQUIREMENTS 23） | Phase D'は常に `conflictResolutions = []`。合成しない |
| valid repair lineage | `ProductionPlan.conflictRepairLineage`（9.2.19.11） | 読まない・書かない |
| Research上の仮割当（structural candidate） | §6のAssignment | Research RESULTにだけ記録する。Build List / Plan / Export / Dexieへ書かない。成立（verified）とは区別する |
| provisional / speculative reservation | §9.1のreservation（materialize済みのResearch生成Entryから `derivePlannerAlternativeReservation()` で導出） | Search入力として一時的に使うだけ。導出元はResearchが生成したEntryであり、ユーザーがfixedしたRouteではない。永続化・記録せず、explicit resolutionへ変換しない（G1） |
| Research上の形状条件（`ExpectedRouteShape`） | §4.4 / §8.3 | Search後の照合にだけ使う。reservationのheld / blockedへ書き込まない（レビューB2） |
| 実際に確定したBuildListEntry | Phase D'の最終入力（Research process内のPlannerInput） | ユーザーの明示決定として記録しない。Research runner外へは生成Entry（ID・snapshot）をRESULT / `.local` へ書くだけ |

Production統合に必要な事項は本設計の範囲外であり、将来の別docs-only PRとプロジェクトオーナーの決定を要する:

- REQUIREMENTS 19 / 23の契約変更（無選択の自動再構成を許す範囲、ユーザーへの提示方法）
- Global Planner用のstep bound policy（Research 20000はProduction defaultではない。G12）
- Search規模 / node budgetの正式なbound定義とBrowser Worker測定
- 生成Entryのidentity（`research.global.*` 等のResearch prefixはProduction IDではない）、Build List cardinality（DATA_MODEL 9.4.1）との整合
- 同じPlannerInputに対するPlanner出力が変わる場合の `CURRENT_CALCULATION_APP_SCHEMA_VERSION` 境界判断（AGENTS.md）

## 17. 本PRの検証

- `git diff --check`、`npm run check:nul`、`npm run lint`、`npm test`、`npm run build` を実行した（結果はPR本文に記載）。docs-onlyのため挙動変化は無い
- 長時間のformal Research run、Search実行、oracle再計算、RESULT JSON生成は行っていない
- 既存のPhase 2-A.5 / 2-B / C2 / D2 / P0Rの正式結果・RESULT JSON・Research実装は変更していない

## 18. レビュー対応（PR #237、初版 `bc7c4f4` に対する修正）

| 区分 | 指摘 | 対応 |
| --- | --- | --- |
| Blocking B1 | 未検証のAssignmentをincumbentとして枝刈りの上界・探索終了条件に使っていた | structural candidate / bestStructural / bestVerifiedを分離（§3.1 / §4.3 / §4.6）。solverをgeneratorにし、UBは `bestVerified.physicalOperations` だけ、verifiedが無い間は枝刈りしない（§6.3 / §6.4 / §10.1）。`proven_minimum` はverifiedと証明済み下界の一致だけ（§10.2）。Phase D / D'不成立時は探索状態を保持して次候補へ進み、option・部分割当を除外しない（§6.3 / §9.6）。Phase Bはverified / proven_minimumを報告しない（§14） |
| Blocking B2 | 「自分が操作しない位置をすべてheld + blocked」にするmoldが、reservationの正式意味論と整合しない | moldを廃止。sourceで確認した合法位置規則に基づき、現行APIで強制できること・できないことを明記（§9.0）。正当なreservation（materialize済みEntryからの `derivePlannerAlternativeReservation()`）だけでSearchし、形はSearch後に照合する方式へ変更（§9.1）。形状条件 `ExpectedRouteShape` をreservationから分離（§4.4 / §7 / §8.3）。materialization順序（Skill被覆依存のtopological順）と循環依存の扱いを記載（§8.2）。形状制約付き探索は将来APIとし、Phase D実装前の設計検証D-0を追加（§9.8 / §14） |
| Required R1 | `feasibleOptions` → `LB` → `feasibleOptions` の循環 | `resourceFeasibleOptions`（資源条件のみ）→ `LB`（stream別最小終端のみ）→ pruning（UB比較）の一方向に分離。MRVは `resourceFeasibleOptions` の件数だけ（§6.4 / §10.1） |
| Required R2 | window拡大条件がoption 0件と末端接触だけ | 現windowの結果種別（`target_without_option` / `resource_exclusivity` / `coverage_infeasible` / `structural_only`の内訳 / `search_incomplete` / `verified` / `unmeasured`）ごとの移行規則を定義。node budget到達では拡大せず、未確認が含まれる場合はcap / gate / envelopeの見直しを先行（§10.3 / §4.6） |
| Required R3 | Search規模gate超過の未実行を `materialization_mismatch` に分類していた | `MaterializationOutcome` を `materialized` / `shape_mismatch`（実行済み・不一致）/ `unconfirmed`（delivery cap・extent）/ `not_executed`（gate）/ `unmeasured` に分け、候補別outcomeで `materialization_failed` と `materialization_unconfirmed` と `planner_rejected` を区別。未実行・未確認は恒久除外にしない（§4.5 / §4.6 / §9.6 / §10.4 / §12） |
| Optional | 「8,534以下で改善」 | 8,534未満 = 操作数改善、8,534 = 同等、8,534超 = 劣る、verified無し = 完成数未達に統一し、時間・メモリは別指標とした（§13.2 / §10.5 / §14 Phase E） |

再レビュー（`fd82e12` に対する修正）:

| 区分 | 指摘 | 対応 |
| --- | --- | --- |
| Required R1（再） | 対象Targetを `isTargetWeaponPlanningEligible()` だけで決めており、Productionのplanning Target（valid BuildListEntryを持つTarget）と一致しない | Phase 0として `validatePlannerInput()` → `derivePlannerPlanningTargets(targetWeapons, validBuildListEntries)` でProductionと同じ規則で集合を確定し、以後のPhaseで増減させない `GlobalAssignmentContext` を定義（§3.2 / §4.1）。valid Entryの存在は集合決定にだけ使い、既存EntryのRoute内容はPhase A〜Cに渡さない（§4.1 / §5.4 / §5.5）。分母は常にこの集合で、`targetWeapons.length` / active Target数を使わない（§4.6 / §9.5）。finalInputから再導出した集合が同じでなければ `planning_target_set_changed` でfail closed、非planning TargetのEntryは元のまま残す（§9.5）。下限moduleの対象集合との差を明記（§2.6 / §5.7 / §10.2）。Phase 0のテスト6ケースを追加（§13.1 / §14） |
| Required R2（再） | `exhausted || stoppedByExtent` を一律 `shape_mismatch` にしていた | `shape_mismatch` は `summary.exhausted = true`（探索完了の明示的証拠）+ 一致なしだけ。`stoppedByExtent` + 一致なしは期待required位置がextent内でも常に `unconfirmed(stopped_by_extent)`（旧 `extent_reached_before_shape` を置換）。`exhausted` 以外で探索完了を判定する例外は設けない（§2.6 / §4.5 / §9.1 / §9.6）。射影起点Candidate Searchの不一致は方式限界としてTarget別outcomeを確定せず §9.1 へ切り替える（§9.2 / §9.3）。`unconfirmed` は枝刈り・最短性証明・恒久除外の根拠にせず、`no_structural_candidate` と混同しない（§4.6 / §9.6 / §12）。テスト7ケースを追加（§13.1） |
