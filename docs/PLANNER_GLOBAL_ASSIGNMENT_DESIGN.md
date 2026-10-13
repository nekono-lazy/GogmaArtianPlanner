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
  「計画対象なし」として `unsupported_input`（reason `no_planning_target`）で止める）。`validatePlannerInput()` がissueを返した入力は
  validとして続行せず、`unsupported_input`（reason `invalid_planner_input`）で止める（Phase A実装の `createGlobalAssignmentContext()`）
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

Phase B-1（§14）はこの `Assignment` を、C1 / C2だけで確定した **resource assignment**（実装型 `ResourceAssignmentCandidate`、
`kind: 'resource_assignment'`、`src/benchmarks/globalAssignment/assignmentTypes.ts`）として返す。`StructuralCandidate` は、Phase Cがそれに
被覆pre-check・materialization順序・`ExpectedRouteShape` を付けた後の型であり、B-1の出力はProductionで実行可能な候補でも `verified` でもない。
B-1の実装は `chosen` をplanning Target順に持ち、加えて割当順（そのbranchのMRV順）、使用済みsource（`sourceResourceKey()`）、stream別の
required位置集合（NormalはCounter ID別）、全streamの終端、objective、決定的なordinal（生成順の診断値。identityではない）を保持する。
C3（被覆）・materialization・Production検証の意味論は変えない。

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
  /** Production SearchのpolicyがSearch前に返さないと分かる形（§19.3 G1。D-0Bで追加、§9.10）。Searchを実行しない */
  | { kind: 'not_executed'; reason: 'search_policy_shape'; policyShape: SearchPolicyShape }
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
  | { status: 'unsupported_input'; detail: string;
      reason: 'invalid_planner_input' | 'no_planning_target' | 'unconfirmed_rng_state' | 'unconfirmed_counter' | 'blind_route_required' | 'checkpoint_selection' | 'prediction_unsupported' }
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
- `unsupported_input` のreasonは、どれも「実行可能解が存在しない」ではなく「この入力ではPhase Aの前提が成立しない」を表す。Phase 0 / Aの実装
  （`createGlobalAssignmentContext()` / `buildReachTable()`）が返すのは次のとおり: `invalid_planner_input`（`validatePlannerInput()` がissueを返した。
  validとして続行しない）、`no_planning_target`（valid Entryが0件）、`unconfirmed_rng_state`（Base Seed / Skill Counter / Gogma Counterのいずれかが
  確定値でなく、stream originが無い）、`unconfirmed_counter`（owned sourceが無く、確定レア8 Normal Counterも無い。blind variantはoptionにしない）、
  `blind_route_required`（owned sourceが無く、Normal Artian予測がunsupportedで、blind Routeしか残らない）、`checkpoint_selection`（§15.1）。
  `prediction_unsupported` は個別の予測についてはoption不在 + summary noticeで表し（§5.5）、入力全体の分類としては現在使っていない

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
- 所持巨戟の現在Ideal laneに `none` だけを置く上表の規則は、ゲーム上の制限ではない（ゲームではIdeal到達後もReset Skills / Reset / Keepを続けられる）。
  巨戟化の `conversion` (c, s*) はcのSkillがIdealでも列挙しており、扱いが非対称である。監査結果と後続の扱いは §19（D-0B準備監査）
- **A-2（§19.8）以降、上表はoption集合 `a1`（`global-assignment-reach-options:a1`）の規則である。** option集合 `a2` では、未保護の所持巨戟の
  現在Ideal laneに `none` の後へ継続option（Skill: `reset_skills` s*、Bonus: `reset` / `keep_from_source` / `reset_then_keep`）を同じsourceで列挙する。
  ただし現在性能が両軸Idealのsourceは `none / none` だけのまま（G4-iii）。どちらの集合かは `ReachTable.optionSet` が持ち、各Phaseはそれで規則を読む

### 5.3 必要条件と検証状態

optionは「IdealへRNG上届き得る必要条件」であり、実行可能性ではない。2段階で区別する。

| 状態 | 意味 | 判定 |
| --- | --- | --- |
| `necessary_only` | 位置集合が §5.2 の条件を満たす | 走査結果の参照だけ |
| `rng_replayed` | required unitだけを順に適用した結果が `satisfiesIdealTarget()` でIdeal、かつoptionの記述がPlannerInputと整合 | 予測前に、sourceがPlannerInputに存在し要求unitを受け付けること（保護中owned normalは変換元にしない、保護中owned gogmaは `none / none` 以外を認めない。REQUIREMENTS 21）、required位置がstream origin以上の安全な整数であること、`streamEnd` をrequired位置とoriginから **generatorとは独立に** 再導出して一致すること（Skill / Gogma終端、Normal終端のCounter IDと値、余分なキーなし）を確認する。その後、sourceの状態（owned: Export値、new normal: `predictNormalArtian`）→ 巨戟化 / Reset Skills（Skill）→ Reset / Keep（Gogma）を予測し直して確認 |
| `materialized`（Phase D） | Production Searchがその形のRouteを返し、`createPlannerRouteUnitPlans()` のrequired位置がoptionと一致 | §9 |
| `planner_verified`（Phase D'） | 全Entryのfull Planner run + Trace Replayが成立（候補全体として `verified`） | §9.5 |

`rng_replayed` は、Phase 2-A.5 Stage Aの「required-only再生」と同じ考え方（skippable unitを他Targetが消費しても結果が変わらない）を、
oracle moduleをimportせずに実装する（§11）。Phase Aではsolverへ渡す前に全optionを `rng_replayed` にする必要はない（走査結果は既にIdeal判定済み）。
再生はPhase Bが選んだoptionに対してだけ行い、一致しなければinternal invariant errorとして止める（走査とIdeal判定が同じauthorityなので不一致は実装バグ）。
RNG結果の不一致（`ideal_mismatch`）だけでなく、`streamEnd` の不一致・origin以前のrequired位置・source種別と要件の不整合（`requirement_inconsistent`）、
保護中武器への操作要求や非互換source（`source_kind_mismatch`）、unsupportedになった予測（`prediction_unsupported`）もすべて同じfail closedであり、
どれも `rng_replayed` にしない。Phase Bは `streamEnd` を目的関数・下界・枝刈りに読む（§6.1 / §10.1）ので、generator側の終端の誤りをreplayが
承認してはならない。

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
- Base Seed / Skill Counter / Gogma Counterのいずれかが確定値でなければstream originが定まらないので、走査せず `unsupported_input`（`unconfirmed_rng_state`）で止める
- required-only replay（§5.3）は、optionの `streamEnd` をrequired位置とoriginから独立に検算し（§4.3の定義: 最後のrequired位置 + 1、操作無しはorigin、
  Normalは対象Targetの確定Counterだけ）、保護中owned gogmaには `none / none` 以外の要件を認めない。いずれの不一致もinvariant errorであり `rng_replayed` にしない

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

Phase B-1の実装（`assignmentFeasibility.ts` / `assignmentLowerBound.ts` / `assignmentOrdering.ts` / `assignmentSolver.ts`）は、上記のうち
被覆pre-check（Phase C）とcoverage-driven value orderingを除く部分を、明示的なframe stackのgeneratorとして実装した（両者はPhase C-2がopt-inの入口として追加した。§8.6。`next()` は次の完全割当・
pause・終了のいずれかを返し、同じnodeの次の値から再開する）。実装上の確定事項:

- 値順序は「Σ stream終端の増分（部分割当の現在終端に対する `max(0, ·)` の和）→ owned source先 → 最終Skill位置 → 最終Gogma位置 →
  Normal forge位置 → Phase Aの列挙順に従う副位置（巨戟化は s* に近い c 先、同一 g* では `reset` → `keep_from_source` → `reset_then_keep`、
  Reset→Keepは早い g1 先）→ stable option key」。source × Skill × Bonusの直積を配列化せず、(source, Bonus stream) ごとの2次元latticeを
  min-heap frontierで併合して遅延生成する。keyが両軸で単調なので、popしたcellの右隣と `j = 0` のときの下隣だけを押せば各cellを高々1回・
  順序どおりに取り出せ、保持するのはlattice rootと取り出し済みcellの近傍だけである。使用済みsourceはlattice単位で除外する
  （そのsourceの全optionがC1違反なので正確であり、optionの間引きではない）。Normal sourceの巨戟化要件列（s* ごとの c ブロック）は
  prefix sumで添字付けし、(c, s*) 対を保持しない。`reset_then_keep` も `createResetThenKeepIndex()`（`reachOptions.ts`）のcompact indexで
  添字付けし、(g1, g*) 対を保持しない: 保持するのはlayout別・併合済みの有効Reset位置（昇順）、有効layout、先行Resetが1つ以上あるfinal Keep位置
  ごとのgroup（到達layoutの参照と開始index）だけで、`at(index)` は開始indexの二分探索でgroupを定め、group内のrankを、layoutが1つなら
  そのlayoutのReset位置配列から直接、複数なら併合Reset位置上のrank探索（各layoutの「v 以下のReset数」の和が rank を超える最小の v）で解く。
  メモリは O(Reset位置数 + Keep位置数 × layout数)、1回の `at()` は O(layout数 × log² Reset位置数) で、pair数（最悪 Reset位置数 × Keep位置数）に
  比例する配列・Map・Setを作らない。順序は従来どおり g* 昇順・同一 g* では g1 昇順（lattice軸の単調性を保つ）。Phase Aの
  `enumerateResetThenKeepRequirements()` は可読な参照実装として残し、両者のpair単位・順序の一致をtestで固定する。1 Targetにつきindexは1つで、
  値順序latticeと下界menuが共有する
- 下界の `reset_then_keep` final集合は同じindexの `finalPositions`（先行する有効Resetが1つ以上あるKeep位置、昇順）であり、pair列挙を行わない。
  g1 の空きは緩和されたまま（§10.1）で、admissibilityは変わらない
- cancelは各nodeの先頭の `shouldCancel()` に加え、node内の長いoption走査（MRV計数の歩行、値順序でのC2不適合optionの連続棄却）でも
  256 optionごとに確認し、`cancelled` として終了する。展開node数の意味・候補順序・決定性は変えず、中断されたnodeの結果（候補、dead end、
  棄却件数）は報告しない。時間上限やoption検査数上限を探索失敗条件として導入しない
- MRVの候補数はPhase Aのsource別generatorを `countUpTo(k)` で歩く（使用済みsourceはsource単位で飛ばす）。`k`（`mrvLookahead`）は
  Target選択順のための先読み上限であり、探索可能なoptionを減らさない。同数のtie-breakはpriority降順、Target ID昇順
- UBは `VerifiedUpperBound`（`physicalOperations` + literal `provenance: 'production_verified_plan'`）を返すcallbackからだけ読む。B-1の通常run
  はそれを持たない（= 枝刈りなし）。`bestAssignment`（生成済み候補の最小objective）は診断値であり、UBにはならない。§10.2のcross satisfaction
  可能ペアをfloorから外す扱いは、UBを実際に渡す段階（B-2 / D'）の呼び出し側責務として残す
- 診断は展開node数、最大深さ、生成候補数、棄却理由別件数（`source` はsource単位、位置はoption単位。値順序を歩いたnodeと、全optionを
  歩き切ったdead endで数える）、pruned数、dead end（Target別）、completeness（`running` / `exhausted` / `node_budget_reached` / `cancelled`）

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

### 8.5 Phase C-1の実装上の確定事項

Phase C-1（`coverage.ts` / `coverageTypes.ts` / `structuralCandidate.ts`）は、Phase B-1の `ResourceAssignmentCandidate` を入力とする
独立した後処理として §8.1〜§8.3 を実装した。B-1 solverの探索順序・MRV・`next()`・node budget・C1 / C2は変えていない。

- **入口と戻り値**: `buildStructuralCandidate(assignment, { table, context, engine })` は `structural_candidate` / `coverage_infeasible` /
  `invalid_input` を返す。順序は (1) ReachTableがcontextのもの（planning Target集合・順序、確定origin）か、(2) assignmentの構造検証
  （各optionがReachTable行のsourceを持つこと、source種別と要件種別、保護中owned Gogmaは `none / none` だけ、window、`streamEnd` の独立な再導出、
  C1 / C2、`usedSources` / `requiredPositions` / `streamEnd` / `objective` の集約値）、(3) 被覆判定、(4) materialization順序、(5) 全optionの
  `replayReachOptionRequiredOnly()`。`coverage_infeasible` ではreplay・予測を行わない（optionのRNG妥当性については何も言わない）。replayの不整合は
  既存の `GlobalAssignmentInvariantError` としてthrowし、被覆不成立や「Routeなし」に読み替えない。純粋な被覆判定は `checkStreamCoverage()`、
  順序は `deriveMaterializationOrder()` として単独でも呼べる（C-2用）
- **区間の端点規則**: `CoverageSegment` の `from` / `to` は両端inclusive、`from <= to`。1 streamのsegmentは昇順で、先頭がorigin、各segmentは直前の
  `to + 1` から始まり、末尾は `end - 1` で終わる（重複・欠落なし）。required位置は所有Targetの1位置segment（`kind: 'required'`）、gapは
  covererのchain segment（`kind: 'chain'`）。chain segmentは他Targetのrequired位置を含まず、required操作を重複させない。操作のないstreamは
  `end = origin`、segment 0件
- **covererの候補**: §8.1の擬似コードどおり。Normalは各Counterの最遠production targetの所有Targetだけ（originから全forge）。Gogmaは
  Bonus操作を持つTargetで最終Bonus位置 ≥ next（gapの直後のrequired所有Targetは常に該当するので、Gogmaは常に成立）。Skillは
  `reset_skills` で最終位置 ≥ next、または `conversion` で c ≤ prev かつ最終位置 ≥ next。被覆不成立になり得るのはSkillだけで、Gogma / Normalで
  coverer候補が空になった場合は内部不変条件違反（`coverage_invariant`）とする
- **covererの選択**: §8.2の1〜2に加え、最終位置の同点はowned source先、Target ID昇順。C2を満たす入力では同一streamの最終位置は互いに異なるので、
  この2キーは決定性のための防御的な全順序である
- **`coverage_infeasible`**: 未被覆gapをstream順・位置順にすべて返し（`firstUncovered = uncovered[0]`）、各gapに前後のrequired位置、
  reason `no_skill_holder_across_gap`、gap終端まで届くが巨戟化がgap開始より後のTarget（診断）を持たせる。このassignmentが静的必要条件を
  満たさないという意味であり、「実行可能Planが存在しない」ではない
- **materialization順序の依存**: §8.2の擬似コードは巨戟化位置 c より前のSkill gapのcovererを先行させるが、その根拠は「c より前のSkill位置が
  すべてheld」であるため、c より前の **required位置の所有Target** も先行させる（該当し得るのは依存を持たない既存Gogmaの `reset_skills` Targetだけ。
  隣接するrequired位置の直後にReset Skillsを持ち、自分ではgapを被覆しない場合）。意味（依存はSkill被覆だけ、非循環）は変えない。
  導出後に「planning Targetの順列であること」「各巨戟化Targetの c より前の全Skill位置が先行Targetに帰属すること」を自己検査し、
  違反は `coverage_invariant` でfail closedする。`materializationDependencies` に各巨戟化Targetの先行Targetを記録する
- **`ExpectedRouteShape`**: `match` はsourceのOwnedWeapon ID（new_normalはnull）、`requiredPositionsOf()` のstream別required位置（Normalは
  Counter IDつき）、required-only replayの最終武器。`predicted` は自分がcovererのchain segment（stream・区間・操作種別: Normalは
  `create_normal_artian`、Skillは `reset_skills`、Gogmaは `reset` → Reset、`keep_from_source` → Keep、`reset_then_keep` → g1より前はReset・後はKeep）と、
  stream別に自分へ帰属する位置数（全Targetの和は各streamの `end − origin`）。materialize後のRoute operation数（Normal forgeのheld prefix、
  実際のchain長）はmaterialization順序に依存するので予測しない。chainはmatch条件に入れず、reservationへも書かない
- **C-2へ残すもの**: solver内部でのcoverage rejection、coverage-driven value ordering、被覆不成立後の探索継続の統合、`coverage_infeasible` を含む
  window移行判定、実Export runner・計測（前4つはC-2で実装した。§8.6）

### 8.6 Phase C-2の実装上の確定事項

Phase C-2（`coverageSearch.ts` / `coverageSearchTypes.ts` / `structuralSearch.ts` / `structuralWindowPolicy.ts` と、`assignmentOrdering.ts` /
`assignmentSolver.ts` へのopt-in拡張）は、§6.3 / §6.4の `structuralCandidates` generatorのうちPhase D / D'を除く部分を、B-1 solverとC-1 moduleの
統合として実装した。

- **経路の分離**: 被覆判定付きの探索は新しい入口だけで動く。`createCoverageSearch()` / `collectCoverageFeasibleAssignments()`（ReachTableとplanning Target
  だけを読む。Engine不要）と、その上に `buildStructuralCandidate()` を重ねる `createStructuralCandidateSearch()` / `collectStructuralCandidates()` である。
  B-1の `createResourceAssignmentSearch()` / `collectResourceAssignments()`、B-2A / B-2B runner、`decideWindowTransition()`、B-2Bの事前登録値・正式RESULTは
  変更しない。B-1 solverへの追加は任意field `readPriorityConversionPosition` だけで、無指定ならframe enumeratorは従来の `createOrderedOptionEnumerator()`
  であり値順序・候補列・`diagnostics` はB-1と同一。順序付けの計数は `diagnostics` に加えず、別getter `priorityOrdering` に置く
- **被覆gate**: solverが完全資源割当を返すたびに `checkStreamCoverage()` を実行する。`coverage_infeasible` はstructural candidateとして返さず、
  最も低い未被覆Skill位置（`firstUncovered`）・初回棄却・位置別棄却件数を記録してsolverの `next()` を続ける（同じnodeの次の値から再開し、nodeも
  完全割当も再訪しない）。`feasible` だけを `buildStructuralCandidate()` へ渡す。solverが生成した割当にpre-checkが `invalid_input` を返すこと、
  gateが通した割当がbuilderで `structural_candidate` にならないこと、replay不整合は `GlobalAssignmentInvariantError` としてthrowし、
  棄却や「候補なし」に読み替えない。`ResourceAssignmentCandidate` 自体は変更しない
- **coverage-driven value ordering**（`coverageDrivenOrdering: true` で明示的に選ぶ。既定値なし）: 棄却のたびにその最低未被覆位置 x を
  priority conversion positionとし、各nodeは値を1つ渡す前にそれを読む。x が変わると、そのnodeのTargetの未配送optionのうち巨戟化位置 c = x のもの
  （c = s* と c < s* の両方）を、それ自身の値順序で先に渡す（`createPrioritizedOptionEnumerator()`）。B-1のbase frontier（compact index + min-heap）は
  再keyせずそのまま使い、priorityはSkill軸を c = x に制限したもう1本のlattice併合（`createConversionPriorityEnumerator()` / `indexedConversionsAt()`、
  s* 昇順の部分列なのでlatticeの単調性を保つ）で供給する。両者とも値順序keyが狭義単調増加なので、配送済み判定は区間で行える: phaseを開いた時点の
  baseの最終keyを `cutoff`、そのphaseが最後に渡したkeyを `last` とすると、そのphaseが渡したのは c = x かつkeyが `(cutoff, last]`（枯渇後は
  `(cutoff, +∞)`）のoptionちょうどである。phaseは `cutoff` 以下（baseが渡し済み）と過去phaseの区間内を飛ばし、baseはphase区間内を飛ばす。
  したがって任意のpriority列に対して各optionをちょうど1回渡し（欠落・重複なし）、順序はpriority列の純関数であり、同一入力で決定的である。
  priorityは配送のたびに読むので、棄却より前に作られた既存frameも次の値から反応する。x が変わると活性phaseは閉じ（区間だけ残る）、同じ x に戻れば
  新しいphaseを開く。メモリはbase frontier + 活性phaseのfrontier + 閉じたphaseごとにO(1)で、source × Skill × Bonusの直積をmaterializeしない。
  C1 / C2、MRV、branch-and-boundの意味は変えない（順序の変更であり、候補集合の削減や制約の緩和ではない）
- **結果分類**（§4.6）: `candidates_found`（`exhausted` / `candidate_limit_reached`）、`no_structural_candidate`（探索木を使い切ったときだけ。reasonは
  Target単位のoption不在なら `target_without_option`、UB枝刈りがあれば `upper_bound_pruning`、完全資源割当を1件以上検査していれば
  `coverage_infeasible`、それ以外は `resource_exclusivity`）、`search_incomplete`（`node_budget_reached` / `cancelled`。それまでの検査がすべて棄却でも
  被覆不成立と結論しない）、`invalid_input`。window移行は §10.3 に従う別判定 `decideStructuralWindowTransition()` で行い、3つのno-candidate reasonは拡大、
  `upper_bound_pruning`・budget・cancel・候補上限・未計測・unsupported・invalidは保持する。structural candidateがある窓の拡大はPhase D / D'の
  結果で決まる（§10.3の `structural_only` 行）ので、C-2では保持とする
- **診断**: 完全資源割当の検査件数、被覆棄却件数、被覆成立件数（= structural candidate件数）、初回棄却とその未被覆gap、最低未被覆位置、
  位置別棄却件数、最初の被覆成立までの割当数、orderingの適用状況（有効か、現在の優先位置、変更回数、phase開始数、priority配送数、skip数）、
  B-1の展開node数・完全割当数・completeness、`bestStructural`（structural candidateの最小objective）とreplayの予測回数。`bestStructural` は
  B-1の `resource.bestAssignment`（棄却されたものを含む全完全割当の最小）と別fieldで、どちらも `VerifiedUpperBound` ではなく枝刈りに使わない
- **設計との差異（明示）**: 現行Phase Aは各 s* について巨戟化位置 c ∈ [origin, s*] をすべてoptionにする（§5.2）。完全資源割当の最も低い未被覆
  Skill位置を p とすると、p より後ろのrequired位置を持つTargetは c > p の巨戟化Targetに限られる（既存Gogmaの `reset_skills` と c < p の巨戟化は
  §8.1の表どおり p を被覆する）。その c を p へ下げた割当もC1 / C2を満たし（p はrequired位置でない）、p を被覆し、p 未満の被覆と全streamの終端
  （objective）を変えない。これを繰り返すと被覆可能な割当に到達するので、**整合したReachTableでは、完全資源割当が1つでもあれば同じ最小objectiveの
  被覆可能な完全割当が存在し、探索木を使い切った `coverage_infeasible` は生じない**。§8.2の3と§10.3の `coverage_infeasible` 行の例（より後方の
  Reset Skills位置）は、この意味で現行option集合では到達しない場合の規定である。C-2は分類とwindow判定を設計どおり実装し（scripted searchで分類を
  固定）、到達しないことはseed付きrandom table 60件の総当たりで確認した。規則・設計の意味は変えていない（変更・削除するかは別判断）
- **D-0B準備監査での強化**（§19.4、docs-only・証明のみでtest未追加）: c を下げた結果、巨戟化位置のSkillがIdealのまま c < s* になる形（lane開始Ideal継続、
  Production Searchが返さない形）が生じても、(c, c) への置換と上記の引き下げを繰り返せば、同じsource・objective以下で継続optionを含まない
  被覆可能な完全割当に至る（定理T）。所持巨戟の継続optionをoption集合へ加えても、この補題とその強化は成立する
- **test**: solverと独立した総当たり（C1 / C2の直積 + §8.1を位置単位で書いた被覆述語）との被覆可能集合一致（ordering有無で同一、重複なし。手組み表と
  random表40件）、棄却割当の非配送と探索継続、c = x の優先と早い到達、`next(maxNodes)` のpause / resume一致、決定性、node budget / cancel / 候補上限で
  不成立を断定しないこと、分類とwindow判定、B-1経路の不変（provider無しとnullを返すproviderで同一event列・同一診断、診断keyの不変、ordering offの
  gateがB-1の候補列をそのまま検査）、chain位置を排他資源にしないこと、Invariant Errorの伝播（solverが受理しC-1検証が拒否する負のorigin、
  Ideal不一致のreplay）、prioritized列挙の単体（任意のpriority列200通りで欠落・重複なし、c = x の残りがbaseの位置から値順序で先行、
  2,000 Ideal Skill位置 × 1,500 sourceのhuge rowでfrontierがlattice根 + 数cell）
- **非formal smoke（参考。formal measurementではない）**: 登録済みExportとB-2Bの登録条件（W0、node budget・MRV lookahead・候補上限1,000）で、
  commitしない一時scriptから `collectStructuralCandidates()` をordering有無の両方で実行した。どちらも先頭1,000件の完全資源割当（1,043 node、
  objective 1,766。B-2Bと同じ割当列）がすべて被覆pre-checkを通過し（棄却0件、orderingは一度も発動しない）、structural candidate 1,000件と
  診断はordering有無で一致した。最初の候補は巨戟化TargetのSkill依存5件、予測chain segment 74件。ReachTable約14 s、探索約57〜68 s
  （replay込み）、RSS約1.0 GB。この観測は「W0の先頭1,000件では被覆が制約になっていない」ことだけを示し、structural candidateの成立
  （Phase D / D'）については何も言わない
- **D-0へ残すもの**: 実Exportでの被覆gate付き探索の正式な条件登録・計測、Search規模gate・delivery cap・方式選択（§9）、incremental coverage pruningや
  LDS等の追加最適化（Phase E）。runnerへの組込みも行っていない（D-0Aで方式選択・Search規模予測・gate・delivery capの機構を実装した。値の登録と
  実Export計測はD-0B / D-0C。§9.9）

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

D-0A-2（[D-0A-2設計](PLANNER_GLOBAL_ASSIGNMENT_D0A2_DESIGN.md) §11）は、上表（D-0Aの実装規則、§9.9）を規則 `d0a-v1` として残し、形状制約付き
materialization（方式 `shape_constrained`、同 §5）を含む規則 `d0a2-v2` を定めた: 継続形（§19.3のG1、A-2後のG2）→ `shape_constrained` のみ、連続形 →
射影起点（§9.2）→ `shape_constrained`、非連続形 → `shape_constrained`。§9.1はv2の既定の方式順に入らず、`d0a-v1` とparity testに残る。v2は
D-0A-2の実装（2a / 2b）の後に使え、2a（Search DomainのResearch専用seam）のオーナー承認を前提とする。

### 9.4 identityと決定性

- Candidate / Entry IDはdeterministic materializer（PLANNER_SPEC 9.2.13）が、search identity + Candidate semantic meaningから決める。
  search identityには `normalizePlannerSearchOrigin(origin, target)`、正規化したreservation（§9.1の正式導出値）、extent、本設計のalgorithm token、
  CalculationContextを含め、random UUID / Clock / request UUID / enumeration ordinalを含めない
- 同じ入力・同じmaterialization順序からは同じEntry IDが出る。PlannerInputに既に存在するIDとの衝突（内容が異なる）はfail closed（既存materializerのcollision規則）
- 観測trace（`bonusAmendmentTrace` / `skillAmendmentTrace` / `conversionSkillTrace`）はSearch出力のものを引き継ぎ、再抽選しない
- intermediate groupsはmaterializerが抽出する（追加予測なし）。本設計は選択（pin）を一切置かない
- `validateBuildCandidate()` / `validateBuildListEntry()` を通す。unsupported predictionを含むRouteは生成されない（Searchの契約）
- Candidate / Entryは常に正規のProduction Search結果から作る。期待形をもとにRouteOperation列を手で組み立ててEntryにすることはしない
- 本項は §9.1 / §9.2 の経路（Production Search APIの配送物を採用する経路）の契約である。D-0A-2の形状制約付き経路（方式 `shape_constrained`）は
  この契約の外にあるResearch専用経路であり、[D-0A-2設計](PLANNER_GLOBAL_ASSIGNMENT_D0A2_DESIGN.md) §5 / §9.1の別の契約に従う

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
| Production Searchのpolicyが返さない形（§19.3 G1。ReachTableだけでSearch前に判定、§9.10） | `not_executed(search_policy_shape)` | `materialization_unconfirmed`（D-0Bの分類は `not_executed_search_policy`） | しない | 次の候補へ。window・delivery cap・gate・envelopeの見直し根拠にしない。方式（§19.5 案B、D-0A-2）の課題として記録する |
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
- D-0A-2の形状制約付き経路のTarget outcomeと候補分類は [D-0A-2設計](PLANNER_GLOBAL_ASSIGNMENT_D0A2_DESIGN.md) §10 に従う（`materialized` /
  `unconfirmed(shape_search_budget_reached)` / `not_executed(search_scale_gate)` / `unsupported` / `unmeasured`。必要な予測のunsupportedはPhase Aの判定の有無で
  fail closed（`prediction_support_inconsistent`）か `unsupported` に分け、形が禁止する操作のunsupportedは分類に使わない。baseに到達し、必要な予測のunsupportedも
  無いのに一致を配送しないことは同 §5.5の補題の前提違反としてfail closedし、`shape_mismatch` にしない）

### 9.7 Search規模のgate

D2-G-Aの知見どおり、Planner Alternative Searchの規模はreservationとextentからSearch前に計算できる。§9.1の方式では

- conversion Skill位置数 = Skill reservationのoriginから連続するheld区間（+ 直後の非held位置）のうちblockedでない位置の数（`nextOperationPositions()` の規則）
- Gogmaの合法位置幅 = Gogma extent内の非blocked位置数、Skillの合法位置幅 = 同じくSkill
- Normalのforge数 = held prefixの直後からproduction targetまでの位置数

を `predictedSearchScale` として記録し、事前登録した上限を超えるrequestは実行せず `not_executed(search_scale_gate)` にする（§9.6）。
上限値は未計測なので本書では決めず、Phase D-0（§9.8）の事前登録項目とする（D-0Bは非formal smokeの暫定値だけを使い、登録はD-0B-2で行う。§9.10 / §19.7）。D2-G-AのK3 L2のように、巨戟化位置の候補数がSkill streamの保持量を
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

### 9.9 Phase D-0Aの実装上の確定事項

Phase D-0（§9.8）は、materialization本体とsynthetic検証の **D-0A**、実Export用runner・非formal smoke・計測条件の事前登録の **D-0B**、
事前登録条件でのformal measurementの **D-0C** に分ける（§14）。D-0Aは `materialize.ts` / `materializationShape.ts` / `materializationScale.ts` /
`materializationTypes.ts`（`src/benchmarks/globalAssignment/`）とsynthetic testだけを追加した。実Export run、条件登録、RESULT出力、Production Planner実行、
Trace Replay、Phase B / Cのsolver変更、Search Domainへの形状制約付きAPIの追加は行っていない。§9.0〜§9.8の意味は変えていない。

- **入口と入力検査**: `materializeStructuralCandidate(candidate, inputs)`。Searchの前に、(1) settings（delivery capは正の整数、Search規模gateの各上限は
  非負整数。どちらも呼び出し側が明示し、既定値を持たない）、(2) ReachTableがcontextのものであること（`checkTableBelongsToContext()`）、(3) candidateが
  その割当からPhase Cが導出したものであること（`buildStructuralCandidate()` で再導出し、ordinal・coverage・materialization順序と依存・`expectedShapes`・
  replay予測回数が一致）を確かめ、違えば `invalid_input` で止める。これにより順序や形状を書き換えた候補を受け付けない。以後Phase Cの順序で
  `materializeTarget()` を呼び、最初の `materialized` でないTargetで止める。結果は、試行した各Targetの記録（方式選択・試行列・Target別outcome）、
  materialize済みEntry（後続Targetのreservationの唯一の導出元）とその数、stage outcome（`all_materialized` / `materialization_failed`（`shape_mismatch`）/
  `materialization_unconfirmed`（`unconfirmed` / `not_executed` / `unmeasured`））、未試行Targetを持つ。`all_materialized` はPlanner未検証であり
  `verified` ではない（§3.1）
- **§9.1（`planner_alternative_reservation`）**: Planner-start originは `createPlannerStartSearchOrigin()`。先行Entryが無ければ
  `emptyPlannerAlternativeReservation`、あれば `derivePlannerAlternativeReservation(materialize済みEntry)` の値をそのまま渡す（未materialize Targetの位置を
  先取りせず、held / blocked / 排他OwnedWeaponを編集しない。導出の拒否はfail closed）。`excludedRouteKeys = []`、extentは§9.1の `extentFor`。
  配送されたCandidateごとに、deterministic materializer（search identity = Productionの `createPlannerAlternativeSearchIdentity()`（正規化origin・
  CalculationContext・extent・正規化reservation・route policy）にalgorithm token `global-assignment-d0a-materialization-v1` を加えたもの、Candidate ID prefix
  `candidate.research.global-assignment.`、固定Clock）で一時Entryを作って照合し、一致したCandidateだけを `materializeBuildListEntry(candidate, PlannerInputのEntry)`
  （既存のID衝突・同一意味再利用規則）→ `validateBuildListEntry()` → 再照合を経て採用する。分類は、一致 → `materialized`（一致がdelivery cap到達と
  同時でも一致を優先）、consumer stop → `unconfirmed(delivery_cap_reached)`、`summary.exhausted` → `shape_mismatch`、`summary.stoppedByExtent` →
  `unconfirmed(stopped_by_extent)`（期待required位置がextent内でも）、`CandidateSearchError('cancelled')` → `unmeasured(cancelled)`。どれにも当たらない
  完了報告はfail closedとする
- **照合 `matchExpectedShape()`**: Target、`BuildRoute.sourceOwnedWeaponId`、`createPlannerRouteUnitPlans([entry])` が `canSkipWhenCounterPassed = false`
  とするunitの `counterBefore`（stream別。NormalはCounter ID付きでproduction targetは1つ）、最終武器（`areRestorationBonusSetsEqual()` による多重集合、
  scope、Series / Group Skill）だけを比べる。chain位置・Route operation数・RouteKind・最終5枠の並び・予測chainと実chainの一致は照合しない。unit planが
  拒否されたRoute、Counter位置を持たないrequired unit（blind作成）は不一致とする
- **§9.2（`candidate_search_projected`）**: 連続形（各streamで、shapeの自分の位置 = required位置 + 予測chainが1つの連続区間）だけが対象。射影は、各streamの
  最初の自分の位置（操作の無いstreamはPlanner-start Counter）、在庫はsourceの武器だけ（新規Normalは無し）、`routeFilter` は所持巨戟 `existing_gogma` /
  Normal source `normal_artian`、Targetは当該Targetだけで、`preferredOwnedWeaponId` はsourceを指すときだけ保持しそれ以外はnull（制限在庫の外を指す選好は
  Production validationが拒否するため。新たに選好を設定しない）、extentは射影起点からの `extentFor`。`searchCandidates()` のcanonical Idealを照合し、
  一致したときだけ `materializeGlobalResearchCandidate()`（`createConstrainedCandidate(..., 'origin_reach')` によるorigin再構築。searchStateHashを書き換えない）
  でEntryにする。canonicalの不一致・候補なし・gate未実行はこの方式の限界であり、Target別outcomeを決めない
- **§9.3の方式選択（決定的）**: 非連続 → §9.1のみ。連続の巨戟化Target → §9.2、一致しなければ §9.1を1回。連続の所持巨戟 → §9.1の予測規模が §9.2の
  それをPareto支配する（全成分で以下かつ1成分で真に小さい）ときだけ §9.1先、同点・比較不能は §9.2先（成分は別のSearch次元なので、重み付けや
  成分の優先順位を新たに作らない。設計の「同点なら射影起点」をそのまま比較不能へ延長した）。§9.2先で一致しなければ §9.1を1回、§9.1先では
  `shape_mismatch` のときだけ §9.2を1回（`unconfirmed` / `not_executed` / `unmeasured` では切り替えない）。Target別outcomeは、§9.2が一致した場合を
  除き常に §9.1の結果。cancelでは切り替えず `unmeasured(cancelled)`
- **§9.7のSearch規模予測とgate**: Productionの `createCounterReservation()` / `nextOperationPositions()` / `heldPrefixNormalCreation()` をそのまま使う。
  conversionPositions = `nextOperationPositions(Skill reservation, origin, origin + M + 1)` の位置数（`conversionSkillPositions()` と同じ歩き方。所持巨戟は0）、
  skillLegalWidth = Skill窓（既存巨戟 `origin .. origin + M − 1`、巨戟化Route `origin .. origin + M`）の非blocked位置数、gogmaLegalWidth =
  `origin .. origin + N − 1` の非blocked位置数、normalForgeCount = held prefix canonical作成の自分のforge数（所持sourceは0）。§9.2はempty reservationと
  射影起点で同じ関数を使う。requestは予測値と内訳（窓、巨戟化位置列、`beyondLimit`、Normal作成）を持ち、試行は実行時の観測（配送数、`exhausted` /
  `stoppedByExtent` / consumer stop、配送Candidateの巨戟化位置、Searchのexecution-only instrumentationの集計）を持つので、D-0Bは予測と観測を同じ記録で
  比べられる。予測は独立に書いた位置走査との一致（random 400件）と、実Searchが使った位置との一致をsynthetic testで固定した。gateはどれか1成分でも
  上限を超えるrequestについてSearch APIを呼ばず `not_executed(search_scale_gate)`（超過成分を記録）とする。上限値はD-0Aでは決めない（G8: 予測値は
  Research診断でありformalなSearch work unitではない）
- **決定性・identity・fail closed**: Clock・乱数・enumeration ordinalを意味に入れず、同じ入力から同じrequest・Entry ID・結果が出る。Entry IDは既存
  materializerの `build-list.constrained.*`（Candidateの意味・各hash・CalculationContext）、Candidateの観測traceはSearch出力のまま引き継ぎ、中間状態Groupは
  materializerの正式抽出結果、選択（pin）は置かない。照合とmaterializationはRNG予測を行わない。公開APIの `executeMaterializationRequest()` は渡された
  requestを再導出と比較し、reservation・extent・射影・identity・予測規模・導出元Entryのいずれかが違えば `request_mismatch` でSearch前に止める。ほかに
  shape不整合（`invalid_shape`）、reservation導出の拒否、Searchの入力拒否（`search_refused`）、完了報告の契約違反、materializer / 射影adapterの拒否
  （非同一内容のID衝突を含む。`entry_materialization_refused`）、採用後の再照合不一致がfail closedであり、いずれも `GlobalAssignmentMaterializationError` として
  投げ、outcomeにも「Routeなし」にも読み替えない。生成EntryとreservationはResearch上のspeculativeな値で、永続化せず、user-fixed Route・
  `PlannerConflictResolution`・lineageとして扱わない（G1）
- **process-level outcome**: D-0Aが観測できる `unmeasured` は `cancelled` だけである。timeout / out of memory / process failureは同期・非同期APIの内側から
  観測できないので推測で分類せず、processを所有するD-0B runnerが判定する（型としては残す）
- **現行Search APIで期待形が返らない形（報告）**: Phase Aは各 s* について巨戟化位置 c ∈ [origin, s*] をすべてoptionにする（§5.2）が、Production Searchは
  巨戟化Skill（既存巨戟ならsourceの現在Skill）が既にIdealのRoute baseにReset Skills channelを接続しない（`targetSearchScheduler.ts`）。したがって巨戟化位置
  cのSkillが既にIdealな `conversion (c < s*)` optionの形は §9.1 / §9.2のどちらでも返らず、`unconfirmed(stopped_by_extent)`（またはdelivery cap）として残る
  （synthetic testで固定）。D-0Aは照合条件・option生成・Searchを変えず、この形を推測で `shape_mismatch` にもしない。§8.6の補題（被覆不成立は c を
  下げると解消する）が作る c はこの形になり得る。structural candidateの先頭にこの形が現れるかはD-0Bの非formal smokeで確かめ、option生成側で除外する
  設計変更（docs PR）とするか、未確認のまま扱うかは別に判断する。→ D-0B準備監査（§19）で、option生成側では除外せず、D-0BでSearch前の
  専用の未実行分類とし、D-0Cの前に形状制約付きmaterialization（案B）で扱う方針を提案した。所持巨戟側の同種の形（現在Ideal後の継続）は
  現行Phase Aが列挙していないことも併せて記録した（§19.3 G2）
- **D-0Bへ残すもの**: 実Export用runner（materialize-only mode、別process、envelope、RESULT）、非formal smoke、delivery cap・Search規模gate・envelopeの
  事前登録、最初のstructural candidateに対する計測と §9.8の判定、上記の形の扱い。D-0Cはその登録条件でのformal measurementである。
  → D-0Bはrunner・非formal smoke・診断・上記の形の分類を実装した（§9.10）。事前登録は §19.7のとおりD-0B-2へ移した

### 9.10 Phase D-0Bの確定事項と記録

D-0B（[記録](PLANNER_GLOBAL_ASSIGNMENT_RESEARCH_D0B.md)）は、実Export用runner（Phase 0 → A → C-2 → 診断 → D-0A、別process、envelope、progress journal、RESULT）、
非formal smoke、G1 / G3 / G4診断を実装した。Production・Phase A〜Cの規則・D-0Aの照合と方式選択は変えていない。事前登録は行っていない（§19.7）。

- **G1の分類（確定）**: §19.3 G1の形（`conversion (c, s*)`、`c < s*`、cがIdeal Skill位置）を、ReachTableだけでSearch前に判定し、Target別
  `not_executed(search_policy_shape)`、候補分類 `not_executed_search_policy` とする（D-0Aのopt-in `searchPolicyPrecheck`。無指定ならD-0Aの挙動のまま）。
  §10.3では拡大の根拠にもcap / gate / envelope見直しの根拠にもせず、方式（§19.5 案B）の課題として数える
- **G3 / G4**: G3は静的risk・request上の条件（正式reservationでのheld / blocked）・実測（同じ最終位置で、他方のrequired位置がrisk位置の配送 =
  collapse署名）を分けて記録し、Search前に分類しない。合成入力では監査 §3.3の推定どおりの代表化をPlanner Alternative Searchで確認した。
  G4は `deriveTargetSatisfaction()` による開始時Idealの場合分け（zero-operation / G4-i / G4-ii / G4-iii）を記録するだけで、候補を不成立にしない。
  G4-iiは、他TargetのRouteがそのTargetのIdeal武器を **すべて実際に操作する**（in-flightにし得る）場合だけで、ゼロ操作Routeのsourceとして参照されるだけの武器や
  操作されない武器が1つでも残る場合はG4-iとする（PR #246レビューで修正。監査 §3.6）
- **非formal smoke（W0、最初のstructural candidate、objective 1,766）**: materialization順序の先頭7 Targetがmaterializeされ（いずれも最初の配送で一致）、
  8番目（`reset_skills(422)` + `reset_then_keep(208, 502)` の所持巨戟）が `unconfirmed(delivery_cap_reached)`。delivery cap 5,000でも期待形は配送されず、
  配送の大半は別sourceと早い位置で終わるIdeal Routeだった。そのTargetは巨戟化位置399のTargetのSkill被覆の前提として、Gogmaだけを操作する21 Targetより先に
  materializeされるので、その時点のreservationでは期待形がGogma 55〜502の非held 295位置をすべて自分で操作するRouteになり、own operation数を第1キーとする
  配送順序で後方になる（Phase Cの予測 `ownPositionCount` は他covererが揃う前提の75位置）。G1 / G4の対象は0件、G3の静的riskは3件（実測では未観測）。
  2 runのsemantic recordは一致した
- **D-0A-2への入力**: §9.8の (b) materialization順序（Gogma streamには存在制約が無いので、Gogmaだけを操作するTargetを長いchainを持つTargetより先にする案）と
  (c) 形状制約付き探索（source・巨戟化位置・最終位置の拘束）の両方の根拠を得た。採否・方式はD-0A-2で決める（記録 §9）

### 9.11 Phase D-0A-2の設計判断（要約）

D-0A-2の詳細設計は [D-0A-2設計](PLANNER_GLOBAL_ASSIGNMENT_D0A2_DESIGN.md)（docs-only）にある。§9.8の (c) を選び、(b) は採らなかった。

- **方式**: B-ii（Search DomainのResearch専用seam。Production callerが使わない形状制約付きRoute探索）を主方式とし、Research側の新方式 `shape_constrained` から
  呼ぶ。B-iは、base取得・Skill lane・`keep_from_source` のBonus laneを公開APIで構成できるが、`reset` / `reset_then_keep` のBonus laneで、held-aware
  Bonus streamの「family layout数 × held窓」によるstate数の増加とG3を外側から抑えられないので主方式にしない（同 §3 / §4）
- **§3.4との関係**: B-iiはProduction source（Search Domain）の変更を伴うので、§3.4の「Production sourceの変更を行わない」の例外であり、2aの開始前に
  オーナー承認を要する。変更は任意引数・任意field・挙動不変の抽出refactor・Production非使用のResearch moduleに限り、無指定時のProduction挙動、
  search identity、計算版数を変えない（golden testで固定する）
- **契約**: §9.4とは別のResearch専用経路（同 §5）。形状制約はRoute base生成の前に、primitiveの選択 → source / Counter / production target →
  巨戟化位置（正式な合法位置との共通部分）の順で適用し、`addBase()` は最終admissionだけを行う。Skill / Bonus laneは形が要求するものだけを（lane開始Idealでも）
  開き、Bonusは操作種別policy（Keep-only / Reset-only / g1のResetの後だけKeep）で読み、許す操作のsupportだけを評価する（禁止操作のunsupportedは分類に
  使わない）。最小Route存在補題（同 §5.5、未検証）により、前提が成り立てば形は最初に配送される
- **G1 / G2 / G3**: G1 / G2は新方式だけで扱う。G3は上側（D-0Bで確認済み）と下側（D-0A-2設計で推定した、q < g1 の同layout Resetとfrontier順の同点による変種）の
  両方を、操作種別policyで代表化の対象外にする。同値なrequired位置集合の受理は採らない
- **順序**: Phase Cの順序を維持する（同 §8。再検討条件と変更範囲を記録）
- **identity**: 新algorithm token `global-assignment-d0a2-shape-constrained-materialization-v1`。D-0Aのtoken・Candidate IDは不変。Entry IDは既存materializerの
  規則のまま（同 §9.1）
- **PR**: 2a（Search Domain seam、要承認）→ 2b（Research方式・方式選択 `d0a2-v2`・独立検証器・parity）→ A-2 → D-0B-2 → D-0C → D-1（同 §12）
- **実装**: 2aの記録は D-0A-2設計 §18、2b（方式 `shape_constrained`、規則 `d0a2-v2`、独立検証器、補題のproperty test、parity）の記録は同 §19。
  2bのparityで、`reset(g*)` の形に対しPlanner Alternative Searchが同じ位置・同じ最終多重集合のKeep chainを最初の一致として返す「操作種別の別解」が見つかった
  （同 §19.5。D-0A-2設計 §9.2の見込みとの差異。補題には影響しない）

### 9.12 Phase D-0B-2の結果（要約）

[D-0B-2記録](PLANNER_GLOBAL_ASSIGNMENT_RESEARCH_D0B2.md)（非formal、formal runなし）。option集合 `a2`・規則 `d0a2-v2` で実Exportを再smokeし、D-0Cの正式計測条件を
`MATERIALIZATION_D0C_PREREGISTRATION`（`materializationProtocol.ts`）に事前登録した（`formalRun.enabled` は false、`--mode formal` の拒否は維持）。

- 最初のstructural candidateはa2でもa1と同一（objective 1,766）。`d0a2-v2` で43 / 43 Targetが `materialized`（射影起点21、形状制約22、独立Route検証はすべて通過）。
  `all_materialized` はPlanではなく、Planner検証はD-1で行う
- 形状制約Searchの予測上界は実測の4.5〜470倍で費用の予測値にならないので、shape gateはW0内で拒否しない値とし、費用は実行時budgetで抑える形で登録した
- `d0a-v1` は計測HEADで再実行して旧D-0Bとsemantic SHA-256が一致した（記録は不変）

### 9.13 Phase D-0Cの結果（要約）

[D-0C記録](PLANNER_GLOBAL_ASSIGNMENT_RESEARCH_D0C.md)・[公開RESULT](PLANNER_GLOBAL_ASSIGNMENT_D0C_RESULT.json)（formal measurement）。D-0B-2の登録条件を変えずに
`--mode formal` を実装・有効化し（`formalRun.enabled = true`）、measurement HEAD `8ff0e18` で正式計測した（正式計測2。`851e2f6` での正式計測1は、
CIのshallow checkoutで失敗したtest assertionを直したcommitの後に登録条件のまま再計測して置き換えた。記録 §0。結果は同一）。

- `formalValidity = valid`（登録条件・clean HEAD・登録Export・登録HEADからの計算コード監査・子processの独立gate・2 runのsemantic一致）
- 最初のstructural candidate（objective 1,766）の43 / 43 Targetが `materialized`（射影起点21、形状制約22、独立Route検証22件すべて通過、gate / budget / unsupported / fail closed 0件）。
  semantic SHA-256はD-0B-2の登録値run（非formal）と同一。`all_materialized` はPlanではなく、Planner検証はD-1で行う

### 9.14 Phase D-1Aの結果（要約）

[D-1A記録](PLANNER_GLOBAL_ASSIGNMENT_RESEARCH_D1A.md)（**非formal**、事前登録・formal runなし）。D-1をD-1A（Phase D'の統合と非formal確認）・D-1B（正式条件の事前登録）・
D-1C（formal run）に分けた（§14）。

- **実装**: materialization runnerのexecution-only seam（`onMaterializedEntries`。同じmaterializationのEntry本体をprocess内で渡し、semantic recordは不変）、
  `verify.ts`（§9.5の1 process分: handoff検査、Productionのreplacement authorityによるfinal input、planning Target集合の一致、`createProductionPlanWithObserver()`、
  独立Trace Replayとその対応、`summarizePlanPhysical()`、条件1〜12と型付きoutcome）、`verificationProtocol.ts`（非formal条件、D-0C同一性照合、fresh用Entry集合、
  2 processの判定 = 条件13）、Research runner（first / fresh子process）
- **実Export（非formal、HEAD `933546e`）**: D-0Cの登録条件で再実行したmaterializationのsemantic SHA-256とEntry fingerprintがD-0Cと一致。最初のstructural candidateの43 Entryで、
  first / freshの両processが §9.5の全条件を満たし（43 / 43 completed、Conflict / rejected / warning 0、Trace Replay valid、Plan steps = 物理操作数 = objective = 1,766）、
  verification semantic recordが一致した。記録用分類 `nonformal_planner_verified`（正式な `VerifiedPlanRecord` / `bestVerified` ではなく、`proven_minimum` も主張しない）
- **注意**: §9.5の `physical.total === plan.steps.length` は、Counterを進めない `confirm_owned_ideal` Stepを含むPlanでは成り立たない（このExportの候補では非物理step 0）。
  D-1Bの前に扱いを決める（D-1A記録 §12）

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
  のどちらかを選ぶ。対象Export（43 eligible / 43 valid Entry）では両集合が一致する。Phase B-2A（`assignmentRootBound.ts`）は (a) を選び、
  不一致なら `not_applicable`（reason `planning_target_set_mismatch`）として下界を主張しない（[B-2A記録](PLANNER_GLOBAL_ASSIGNMENT_RESEARCH_B2A.md) §3.4）
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
| `no_structural_candidate` / `coverage_infeasible` | 完全割当はあるがCounter被覆が成立しない（探索木を使い切った） | **拡大する**（例: より後方のReset Skills位置が既存Gogmaの被覆を伸ばす）。現行option集合（c ∈ [origin, s*] を全列挙）では、探索木を使い切ってこの結果になることはない（§8.6） |
| `structural_only`、completeness = `exhausted`、候補の不成立がすべて `materialization_failed` / `planner_rejected` | 構造的候補はあったがどれも成立せず、未確認は無い | **拡大する**（別の位置・sourceの候補が成立し得る。事前登録した上限rungまで） |
| `structural_only`、completeness = `exhausted`、`materialization_unconfirmed` が1件以上 | 成立しなかった原因に未確認（cap / gate / envelope）が含まれる | **拡大しない**。先にcap / gate / envelopeの事前登録値を見直す（windowの問題と断定しない） |
| `search_incomplete`（node budget / verification budget / cancel） | 未探索枝が残る | **拡大しない**。「window内に完全割当が存在しない」と結論しない。node / verification budgetの見直しが先 |
| `verified` | 成立 | Phase Bとしては拡大しない。Phase Eの最適化として、`bestVerified` のいずれかのstream終端がwindow末端に接しているときに別rungを試してよい（より広いwindowはstream間のtrade-offで別の組合せを許し得るが、保証はしない） |
| `unmeasured` | 未計測 | 拡大しない。envelopeの見直しが先 |

- 拡大は全Target共通のrungで行い、Target個別のwindowを持たない
- 上限rungに達しても `no_structural_candidate` のままなら、結果は「事前登録したladderの範囲では構造的候補が無い」であり、実行可能解の不存在ではない
- Production Searchのpolicyが返さない形（§19.3 G1: lane開始Ideal継続）による未実行は、D-0Bで `not_executed(search_policy_shape)`
  （候補分類 `not_executed_search_policy`）として確定した（§9.10）。上表のどの行の根拠にもしない（window拡大にも、cap / gate / envelopeの
  見直しにも使わない）。次に見直すのは方式（§19.5 案B、D-0A-2）であり、「未確認」の件数とは別に数える
- G3（§19.3。Bonus family-layout frontierの代表化）で期待形が返らない場合、現行の分類では `unconfirmed(stopped_by_extent)` / delivery cap /
  `shape_mismatch` のどれにもなり得る（D-0Bのsynthetic testでは `stopped_by_extent`）。G3はSearch前に確定できない（リスク条件は発生の証明ではない）ので
  D-0Bは事前分類しない。その未確認をcap / gate / envelopeの問題と断定せず、D-0Bの診断（静的risk、request上のheld / blocked、collapse署名）を併記して判断する
- D-0A-2の形状制約付き経路では、`unconfirmed(shape_search_budget_reached)` とその規模予測による `not_executed(search_scale_gate)` は上表の「拡大しない」行に入り
  （budget / gateの見直しが先）、`unsupported`（Engineのsupport / capability）も拡大しない。補題の前提違反（fail closed）はrun errorとして移行判定の対象外である
  （[D-0A-2設計](PLANNER_GLOBAL_ASSIGNMENT_D0A2_DESIGN.md) §10.2）。
  G1 / G2を形状制約付き経路で扱う規則 `d0a2-v2` では `not_executed(search_policy_shape)` は生じない（`d0a-v1` でだけ生じる）。G3は同経路では
  操作種別policyにより代表化の対象外になるので、上記のG3の注意は §9.1を使う試行（`d0a-v1`）にだけ残る

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
そのPhaseの非formal smokeを根拠に固定し、formal run後に変えない。D-0Bのsmoke値（delivery cap 500、gate、wall-clock / heap）はすべて非formalの暫定条件であり
登録値ではない。delivery cap・gate・envelopeの登録は方式（D-0A-2）とoption集合（A-2）の後のD-0B-2で行う（§9.10 / §19.7）。

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
| Phase A | 2〜3 Target・小window（例: Skill 6 / Gogma 6 / Normal 3）で、ReachTableの各位置集合が総当たり再生と一致。ReachTableの `targets` がPhase 0の集合と同じ要素・順序で、既存EntryのRoute内容に依存しない（Entryのsource / 位置を変えてもReachTableが変わらない）。unsupported予測でoption不在。保護武器はIdeal現在性能だけ。関心layoutがIdeal multisetの順列に限られる。`collectLowerBoundProblem()` の閾値がReachTableから再導出できる。required-only replayは走査が導いた全optionを `rng_replayed` にし、`streamEnd` の不一致（Skill / Gogma / Normal終端、余分または別のCounter ID、origin以前のrequired位置）と保護中owned gogmaへの非0操作（Reset Skills / Reset / Keep / Reset→Keep）を予測前にfail closedする。Phase 0の `invalid_planner_input` と Phase Aの `unconfirmed_rng_state` / `unconfirmed_counter` / `blind_route_required` / `checkpoint_selection` が区別される |
| Phase B | 総当たりで最小目的関数が分かる小入力に対し、generatorが生成するstructural candidate列に総当たり最小の割当が含まれ、UB無しでは枝刈りが起きない（全完全割当が生成順に出る）。UB（verifiedの物理操作数を模したstub）を与えると `LB >= UB` の枝だけが切られ、UB未満の割当は失われない。C1 / C2違反の割当を返さない。同じ資源を要求する2 Targetで一方へ `reset` option、他方へ `keep_from_source` が割り当たる（火 / 龍型）。node budget到達で `search_incomplete`。決定性（2回実行で同一node列・同一候補列、yield後の再開が同じnodeの次の値から始まる）。`resourceFeasibleOptions` → `LB` → pruningの一方向依存（`LB` 計算中にpruningもoption列挙も再入しない）。Phase B-1はこのうちC3 / `coverage_infeasible` を含まない部分を、solverと独立したテスト側の総当たりenumeratorとの完全割当集合一致（`assignmentTestFixture.ts`）で固定した: C1 / C2（同一OwnedWeapon・同一Normal production target・Skill / Gogma required位置の重複を返さない、別武器種のNormal Counterは独立、skippable位置は排他にしない、`c = s*` は必須Skill位置1つ）、objective（stream共有を重複加算しない、Normal Counter別、部分割当の終端が単調）、MRV（option数 → priority → ID）、backtrackと棄却理由、決定性と `next(maxNodes)` のpause / resume、UB無しで枝刈りなし・`bestAssignment` をUBにしない・UB付きで `LB >= UB` の枝だけ切る、`LB(partial)` が全prefixで総当たり最小以下、node budget / cancel / `target_without_option` / `resource_exclusivity` / `upper_bound_pruning` / `invalid_input` の区別、Phase AのReachTableからの一致、isolation。`reset_then_keep` のcompact indexは、Phase A generatorとのpair単位・順序の完全一致（1 layoutに複数Reset、複数layoutから同じKeep位置、`g1 = g*` 不可、先行Resetの無いfinal、unsupported layout、同じmultisetで順序の異なるlayout）、dense行（500 Reset / 500 Keep位置、125,250 pair）での総数・先頭 / 中間 / 末尾index・pair数に比例しないfootprint、2 layout dense行でのrank併合、下界finalの非列挙導出、node内cancel pollで固定した |
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

Phase A → B-1 → B-2 → C → D-0 → D-1 → Eの順に依存する。1 Phase = 1 PR（必要なら事前登録docs PRと実装 / 計測PRに分ける。D1〜D2系列と同じ運用）。
Phase Bは、資源割当solverの実装とsynthetic正当性検証（B-1）と、assignment-only runner・budget事前登録・実Export formal measurement（B-2）に分ける。
B-2はさらに、runner・root下界接続・§10.3移行判定・実Exportの非formal smoke・formal条件の事前登録を行う **B-2A**
（[記録](PLANNER_GLOBAL_ASSIGNMENT_RESEARCH_B2A.md)。formal runは開始しない）と、登録条件とclean HEADでformal measurementを行う **B-2B** に分ける。
B-2Bの計測記録は [B-2B記録](PLANNER_GLOBAL_ASSIGNMENT_RESEARCH_B2B.md) と [`PLANNER_GLOBAL_ASSIGNMENT_B2B_RESULT.json`](PLANNER_GLOBAL_ASSIGNMENT_B2B_RESULT.json)。
Phase Cは、`ResourceAssignmentCandidate` を入力とする独立した被覆判定・coverer予測・materialization順序・`ExpectedRouteShape` 構築と
synthetic test（**C-1**、§8.5）と、B-1 solverとの統合（solver内部の被覆rejection、coverage-driven value ordering、被覆不成立後の探索継続、
結果分類、必要な非formal診断。**C-2**）に分ける。
B-1はC3（被覆）・materializationを扱わず、C1 / C2を満たした `ResourceAssignmentCandidate`（§4.3）を出力する段階であり、後続Phaseの正式意味論は
変えない。node budget、window ladderのW1以降、verification budgetはB-1では確定せず、B-2で非formal smokeを根拠にResearch条件として事前登録し、
formal run前に固定する。Phase Dは、materialization方式の設計検証（D-0）と統合acceptance（D-1）に分ける（§9.8）。Phase A〜Cの設計は
materialization方式に依存しないので、D-0の結果でA〜Cをやり直す必要はない。D-0はさらに、materialization本体・Search規模予測・synthetic test（**D-0A**、
§9.9）、実Export用runner・非formal smoke・計測条件の事前登録（**D-0B**）、登録条件でのformal measurement（**D-0C**）に分ける（B-2A / B-2Bと同じ運用）。

| Phase | 変更範囲 | 入力 | 出力 | acceptance | テスト | 次Phaseへの依存 | Production影響 | formal measurement |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **A 到達option生成** | `src/benchmarks/globalAssignment/context.ts`（Phase 0: `validatePlannerInput()` + `derivePlannerPlanningTargets()` による `GlobalAssignmentContext`）、`reachTable.ts`（提案）、test、走査helperの下限moduleとの共有（下限moduleの契約不変） | PlannerInput、Engine、window | `GlobalAssignmentContext`（固定したplanning Target集合）、`ReachTable`、`enumerateOptions()`、`replayOptionRequiredOnly()`、走査summary（予測回数、window到達） | §13.1 Phase 0の6ケース、synthetic一致、ReachTableが既存Entry内容に依存しないこと、下限閾値の再導出、unsupported / 保護 / 未確定Counterのfail closed、oracle isolation | §13.1 Phase 0 / Phase A | Bの入力 | なし | 不要（実Exportの走査時間・予測回数はPhase Bのrunで診断として記録） |
| **B-1 資源割当solver（generator）** | `globalAssignment/assignmentTypes.ts`、`assignmentFeasibility.ts`（C1 / C2）、`assignmentLowerBound.ts`（§10.1 `LB(partial)`）、`assignmentOrdering.ts`（lazy値順序・MRV計数）、`assignmentSolver.ts`（決定的backtracking generator、`createResourceAssignmentSearch()` / `collectResourceAssignments()`）、`reachOptions.ts` のsource別・要件別列挙APIと `reset_then_keep` のcompact index `createResetThenKeepIndex()`（出力順不変）、test。runner・root下界接続・実Export runは含まない | ReachTable、planning Target（`id` / `priority`）、node budget、MRV lookahead、（任意）`VerifiedUpperBound` を返すcallback | `ResourceAssignmentCandidate` 列（C1 / C2のみ。被覆・順序・形状なし）、`bestAssignment`（診断）、node列診断（展開node数、棄却理由別件数、dead end、pruned）、`no_resource_assignment`（`target_without_option` / `resource_exclusivity` / `upper_bound_pruning`）/ `search_incomplete`（`node_budget_reached` / `cancelled`）/ `invalid_input` | synthetic総当たりとの完全割当集合一致、C1 / C2、決定性と yield / resume、UB無しで枝刈りしない、`LB(partial)` のadmissibility、R1の一方向依存、budget / cancel / 分類の区別、oracle isolation | §13.1 Phase B（C3 / window移行を除く） | B-2 / Cの入力 | なし | 不要（B-2で行う） |
| **B-2 assignment-only runner・formal measurement** | runner（assignment-only mode。Phase D / D'は呼ばず、UBは与えない）、root下界接続（§10.2の適用条件判定）、§10.3の移行判定、node budget / MRV lookahead / window ladder W1以降の事前登録（非formal smokeを根拠に固定し、formal run後に変えない） | B-1 solver、実Export、window ladder | 先頭k件のobjective、root下界、node数、時間、完成性、§10.3の移行判定 | 事前登録条件の下での実Export run、R2の移行規則 | §13.1 Phase B（window） | Cの入力 | なし | **要**（実Exportでassignment-only run: 先頭候補のobjective、root下界、node数、時間、完成性。**43 / 43 Plan・verified・proven_minimumはB単独では報告しない**） |
| **C Counter被覆とRoute構成** | `globalAssignment/coverage.ts`、solverへのcoverage check接続、materialization順序、`ExpectedRouteShape` | structural candidate | `StreamCoverage`、materialization順序、`ExpectedRouteShape[]`、不成立位置 | synthetic被覆、coverage-driven ordering、順序のtopological性、chain再生一致 | §13.1 Phase C | D-0の入力 | なし | 不要（Bのrunへ被覆・順序診断を追加） |
| **D-0 materialization方式の設計検証** | `globalAssignment/materialize.ts`（§9.1 / §9.2 / §9.3）、Search規模予測、runner（materialize-only mode）、事前登録docs | 実ExportのPhase B / C出力（最初のstructural candidate）、Engine、Planner-start origin | Target別 `MaterializationOutcome`、`deliveredBeforeMatch`、predicted / 実測Search規模、時間、heap、§9.8の判定 | 全Targetが `materialized` ならD-1へ。残るoutcomeの内訳から (a) 事前登録値の調整 (b) 順序変更 (c) 形状制約付き探索APIのdocs-only設計 のどれが必要かを決める | §13.1 Phase D | D-1の前提 | なし | **要**（事前登録: delivery cap、Search規模gate、方式選択規則、envelope。Planner検証は行わない） |
| └ **D-0A 本体・synthetic検証**（§9.9） | `globalAssignment/materialize.ts` / `materializationShape.ts` / `materializationScale.ts` / `materializationTypes.ts`、synthetic test、isolation test | structural candidate、Phase 0 context、ReachTable、Engine、caller指定のdelivery cap / Search規模gate | Target別request（予測規模・内訳）・試行・outcome、stage outcome、materialize済みEntry | §13.1 Phase Dのsynthetic条件（empty reservation、正式reservationの非改変、held跨ぎ、照合、`exhausted` / `stoppedByExtent` / cap / gate / cancelの区別、fallback、決定性、fail closed、trace保持、順序依存、isolation） | §13.1 Phase D | D-0Bの入力 | なし | 不要（実Export・条件登録・runnerは行わない） |
| └ **D-0B runner・非formal smoke・診断**（§9.10、[記録](PLANNER_GLOBAL_ASSIGNMENT_RESEARCH_D0B.md)） | runner（materialize-only mode、別process、envelope、progress journal、RESULT）、G1 / G3 / G4診断、Research記録 | D-0Aの入口、実ExportのPhase B / C出力 | 非formal smoke記録、G1の分類規則（`not_executed(search_policy_shape)`）、G3 / G4診断、D-0A-2への入力 | runner・非formal smoke・診断の完了（事前登録はしない。formal runは開始しない） | runner / protocol / diagnostics / child process test | D-0A-2の入力 | なし | 不要（smokeは非formal） |
| └ **D-0A-2 設計（docs-only）**（[D-0A-2設計](PLANNER_GLOBAL_ASSIGNMENT_D0A2_DESIGN.md)、§9.11） | 形状制約付きmaterialization（§19.5 案B）: B-i / B-iiの最終選択（B-ii）、Research専用materialization契約（§9.4とは別）、継続Routeの独立検証、G3、materialization順序、方式選択 `d0a2-v2`、PR分割 | D-0Bの診断 | 本設計（B-iiはオーナー承認待ち） | 2aを仕様推測なしに開始できること | — | 2aの前提 | なし | 不要 |
| └ **D-0A-2a Search Domain seam** | Route search primitive 3つと `routeSearchShared.ts` へのbase生成前の制約分岐、`bonusStream.ts` / `targetSearchScheduler.ts` の任意引数、`plannerAlternativeSearch.ts` の挙動不変な抽出refactor、新規のResearch専用module（D-0A-2設計 §4.2 / §5.3） | D-0A-2設計 | 形状制約付きRoute探索（Search Domain API） | 無指定時のProduction挙動・search identity・計算版数の不変（golden test）、seam test | D-0A-2設計 §12 / §15 | 2bの前提 | **あり**（任意引数とProduction非使用のResearch module。Production挙動は不変。オーナー承認が前提） | 不要 |
| └ **D-0A-2b Research方式** | 方式 `shape_constrained`、独立検証器、方式選択 `d0a2-v2`、runnerの規則選択（D-0A-2設計 §5.4 / §9 / §10 / §11） | 2a | Target outcome・候補分類 | 補題のproperty test、PAとのparity、継続Route検証 | D-0A-2設計 §12 / §15 | A-2・D-0B-2の前提 | なし | 不要 |
| └ **A-2** | Phase Aの所持巨戟継続option（§19.6） | D-0A-2b | option集合の確定 | §19.7 | 総当たり・G4状態遷移test | D-0B-2の前提 | なし | 不要 |
| └ **D-0B-2 再smoke・事前登録**（[記録](PLANNER_GLOBAL_ASSIGNMENT_RESEARCH_D0B2.md)、§9.12） | 確定したoption集合・方式での非formal再smoke、delivery cap・Search規模gate・形状制約付き経路のbudget・envelope・option集合version・方式選択規則の事前登録 | D-0A-2b、A-2 | 事前登録値 | 事前登録の完了（formal runは開始しない） | protocol test | D-0Cの入力 | なし | 不要（smokeは非formal） |
| └ **D-0C formal measurement**（[記録](PLANNER_GLOBAL_ASSIGNMENT_RESEARCH_D0C.md)、§9.13） | 計測記録docs・RESULT | D-0B-2の登録条件、clean HEAD | 上記D-0の出力 | 上記D-0のacceptance | — | D-1の前提 | なし | **要** |
| **D-1 Planner検証（統合acceptance）** | `globalAssignment/verify.ts`、runner（full mode: B → C → D → D'のloop）、analyzer（post-hoc oracle比較） | D-0で確認した方式、verification budget | `VerifiedPlanRecord` / `GlobalAssignmentResult`、候補別outcome、RESULT JSON | 実Exportで `verified`（§13.2）。不成立なら理由別status（§4.6） | §13.1 Phase D'、isolation | Eの基準 | なし | **要**（事前登録: verification budget、Research maxPlanSteps、envelope） |
| └ **D-1A Phase D'の統合・非formal確認**（[記録](PLANNER_GLOBAL_ASSIGNMENT_RESEARCH_D1A.md)、§9.14） | `globalAssignment/verify.ts`（Phase D'の1 process分）、`verificationProtocol.ts`（非formal条件・D-0C同一性照合・fresh用Entry集合・2 processの判定）、materialization runnerのexecution-only引渡しseam、Research runner（first / fresh子process）、synthetic test | D-0Cの登録条件で再実行したmaterialization（最初のstructural candidate） | 候補1件の型付きoutcome（`verified` は `nonformal_planner_verified` として記録）、非formal実Export記録 | 実装とsynthetic test、実Exportの非formal確認（正式acceptanceではない） | §13.1 Phase D'、isolation | D-1Bの入力 | なし | 不要（非formal） |
| └ **D-1B 正式条件の事前登録** / **D-1C formal run** | D-1Aの実測を根拠にverification budget・Research maxPlanSteps・envelopeを登録（D-1B）し、登録条件でformal runを行う（D-1C） | D-1A | — | §13.2 | — | — | なし | D-1Cで **要** |
| **E 最適化・性能** | incremental coverage pruning、決定的なdiscrepancy探索、中断再開、window拡大（verified時）、メモリ内訳、Browser Worker測定 | D-1の `bestVerified` | 改善した `bestVerified`、性能記録 | 全Target完成を維持したまま物理操作数を改善（8,534未満。§13.2）。時間・メモリは別指標。退行は不受理 | 既存acceptanceの維持、Browser isolation | — | なし（Production化は§16の別PR） | **要** |

最初の実装Phase（A、B-1）は、小さなsynthetic fixtureだけで意味論を検証できる。実Exportの43 TargetはPhase B-2（assignment-only）で初めて使い、
materialization方式の実用性はD-0で、43 / 43 Planの統合acceptanceはD-1で行う。

D-0B準備監査（§19.7）は、D-0以降を「D-0B（runner・非formal smoke・診断）→ D-0A-2設計（形状制約付きmaterialization、docs-only）→ D-0A-2実装 →
A-2（Phase Aの所持巨戟継続option）→ D-0B-2（再smokeと事前登録）→ D-0C → D-1」とすることを提案した（D-0Bの事前登録をD-0B-2へ移す）。
この計画はD-0Bの依頼で採用され、上表のD-0B行を改訂してD-0A-2 / A-2 / D-0B-2の行を加えた（D-0Bは事前登録をしない）。
D-0A-2設計（[D-0A-2設計](PLANNER_GLOBAL_ASSIGNMENT_D0A2_DESIGN.md) §12）は、D-0A-2実装を2a（Search Domain seam。Production fileを変えるのでオーナー承認が前提）と
2b（Research方式）に分けた。materialization順序の変更は計画しない（同 §8）。

## 15. 未決事項・リスク・採用しなかった案

### 15.1 実装前に解決が必要なもの（docs PRまたは各Phaseの事前登録）

| 項目 | 内容 | 解決場所 |
| --- | --- | --- |
| window ladderのrungと上限 | W0 = 350 / 500 / 1500は定まるが、W1以降と上限。移行規則は§10.3で確定（全Target共通rung） | Phase A事前登録 |
| node budget / verification budget | 根拠となる計測が無い。Phase B-2の非formal smokeで決める（B-1のsolverはnode budgetとMRV lookaheadを呼び出し側が明示するpositive integerとして受け取るだけで、既定値を持たない） | Phase B-2 / D-1事前登録 |
| delivery cap / Search規模gate / 方式選択規則の閾値 | §9.3 / §9.7。D2-G-Aのモデル値をgateの根拠にするか。D-0Bのsmoke（§9.10）では、最初の未解決Targetの原因がcapの大小でなく配送順序（6キー順序のown operation数）だった | Phase D-0B-2事前登録 |
| **materialization方式の実用性**（Phase D実装前） | §9.0のとおり現行APIは期待Route形を直接強制できない。「正当なreservation + 形状照合」が実Exportのstructural candidateに対して実用的なdelivery数・Search規模で期待形を返すかは未検証。返らない場合、Research専用の形状制約付き探索APIのdocs-only設計が先に要る（§9.8。現行APIを改変して「できる」ことにしない）。→ D-0Bで順序7の期待形が配送されないことを観測し、D-0A-2設計でB-ii（Search DomainのResearch専用seam）による形状制約付き経路を主方式とした（オーナー承認待ち。§9.11） | Phase D-0 / D-0A-2 |
| materialization順序とchain長 | Phase Cのtopological順（§8.2）はSkill被覆依存だけを拘束し、残りはmax advance昇順。先行Routeのchainが長くなる順序ではSearch規模が増え得る。順序の別案（Gogma終端昇順など）はD-0の結果で判断。D-0Bのsmoke（§9.10）で、Skill被覆の前提として早く置かれたTargetのGogma chainが長くなり、期待形が配送順序の後方になる例を観測した。→ D-0A-2設計 §8で現行順序の維持を決めた（形状制約付き経路の成否は順序に依存しない）。再検討はD-0B-2の再smokeで費用が長い先行区間に支配される場合に別PRで行う | D-0A-2で決定（再検討はD-0B-2の後） |
| checkpoint selectionを持つEntry | 本設計はpinを置かない。元Entryに選択があるTargetは `unsupported_input`（`checkpoint_selection`）でfail closedする（PLANNER_SPEC 9.5.2と同じ扱い）。対象Exportでは0件 | 本書で決定（上記） |
| Normal Counter未確定 | blind variantをoptionにしない。`unconfirmed_counter` でfail closed | 本書で決定 |
| cross satisfaction可能ペア | distinct sourceで実行可能解を探し、最小性を主張しない（§10.2）。1本の武器で2 Target完成を割当に含める拡張は行わない | 本書で決定 |
| 複数Target同一武器のゼロ操作option | 保護・未保護を問わずIdeal現在性能のowned gogmaは、cross satisfactionペアで2 Targetが同じ武器を要求し得る。C1でどちらか1つに割り当てる（他方は別option）。Planner側はcross satisfactionで両方完成させ得るので、objectiveは上界になる | 本書で決定（最小性不主張と整合） |
| Ideal到達後の操作継続（lane開始Ideal） | ゲーム上はIdeal後もReset Skills / Reset / Keepを続けられるが、Production Searchはlane開始状態がIdealのlaneを開かない。Phase Aは巨戟化の継続形（S1）を列挙し所持巨戟の継続形（S2 / B1 / B2）を列挙しない。単一Targetでも、Planner開始時にIdealの所持巨戟を持つTargetは開始時点ではEntryがcommitされず、そのRouteが実行されるかはIdeal武器が他のRouteに操作されるか（in-flight化による充足の再評価と動的commit）に依存する（G4） | §19（D-0B準備監査）。D-0B / D-0A-2 / A-2で扱う |

### 15.2 後続実験で判断できるもの

- covererの予測規則（nearest-successor vs 最大終端Targetの単一chain）と、Searchが実際に返すchainの一致度・Search規模への影響
- §9.1（正当なreservation + 照合）と §9.2（射影起点Candidate Search）の時間差と `deliveredBeforeMatch` の分布
- `LB(partial)` の強化（例: 残りTargetの二部マッチング可否をnodeごとに判定）の費用対効果
- B-1 solverの性能（B-2で実Export・W0を実測してから判断）: MRV計数が最初のfeasible optionまでC2不適合optionを歩くこと（使用済み位置が多いnodeで
  1 Targetあたりの歩行が長くなる）、各nodeの順序付きenumeratorがsource数 × Bonus stream数のlattice rootを押すこと、cancel pollが
  256 option間隔であること。Normal sourceの巨戟化要件とReset→Keepはcompact indexなので、option数に比例する配列はどのnodeにも無い
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

## 19. Ideal到達後の操作継続とGlobal Assignmentの完全性（D-0B準備監査）

Refs #154。docs-only監査（基準main: PR #244 merged `eb1c299`）。詳細（コード上の根拠、集合の定義、証明、ケース表、test計画）は
[D-0B準備監査](PLANNER_GLOBAL_ASSIGNMENT_IDEAL_CONTINUATION_AUDIT.md)（以下「監査」）にあり、本節はその要約と、本書の各Phaseへの参照点である。
Production・Research実装・test・計測コードは変更していない。

### 19.1 直接観測と層の区別

2026-10-12にプロジェクトオーナーが次を直接確認した（監査 §1.1）: ゲームにIdeal Skill / Ideal Bonusという概念は無く、それはユーザーが登録した
目標条件である。巨戟化時点・Reset Skills後にSkillがIdealになってもReset Skillsを続けられ、後続のSkill位置で再びIdealになる場合がある。
巨戟化済みなら、復元ボーナスがReset / KeepでIdealになった後もReset / Keepを続けられ、後続位置で再びIdealになる場合がある。
保護武器・Keepのlayout / 予測support・RNG capability・normal scopeのBonus Ideal不成立・blind Normalの未知5枠など、既存の制約はそのまま維持する
（監査 §1.2）。

本書は次の4層を区別する（監査 §1.3）: L1ゲーム操作の可否（Ideal後も継続できる）、L2正式Domainでの表現（Route validation・Candidate factory・
Planner unit semantics・Planner充足判定・SEARCH_SPEC 5.8.1のいずれもIdealを操作の終了条件にせず、表現・実行できる）、L3 Search policy
（lane開始状態がIdealならそのlaneを開かない。SEARCH_SPEC 5.6.1 / 5.6.8の正式な契約）、L4 Global Assignmentのoption集合（本書のResearch設計）。
**L1 / L2で合法なRouteを、L3のpolicyだけを理由にL4から排除しない。** L3をL4へ合わせて変えることも、正式仕様の変更を経ずには行わない。

### 19.2 Production Searchの早期Ideal終了（Skill / Bonus両軸）

`TargetSearchScheduler.addBase()` は、Route baseの操作0の解（lane開始状態）がIdealなら、そのlaneのstream channelを購読しない
（`!skill.idealMatch` / `!bonus?.idealMatch`）。lane開始状態は、巨戟化Routeでは巨戟化時のSkill（Bonusは継承したnormal scope 5枠で常に非Ideal）、
所持巨戟では現在のSkillと現在の5枠である。この規則は通常Candidate SearchとPlanner Alternative Searchの両方に効き（後者はSEARCH_SPEC 5.6.8で明示）、
既存のProduction testで固定されている。streamそのものはIdealで止まらず、Planner Alternative Searchはlane **途中** でIdealに達した後も
各absolute positionのIdeal解をすべて公開する。したがって列挙されないのは「lane開始状態がIdealで、そのlaneにさらに操作を置くRoute」だけである。
これは単一Targetの品質を根拠とするSearch policyであり、ゲーム規則でもDomain制約でもない（監査 §2）。

### 19.3 Phase Aのoption制限と列挙漏れ

Phase Aは所持巨戟の現在SkillがIdealなら `skillRequired = none` だけ、現在Bonusが `gogma_artian` でIdealなら `bonusRequired = none` だけを生成し
（`skillRequirementBlocks()` / `bonusRequirementIsNone()`）、C-1 `validateOption()` もそれを不変条件として検査する。一方、巨戟化の
`conversion (c, s*)` はcのSkillがIdealかどうかを見ずに c ∈ [origin, s*] を列挙する。lane途中のIdeal後の後方位置（`reset_skills` / `conversion` の
後方 s*、`reset` / `keep_from_source` / `reset_then_keep` の後方 g*）は、どのsourceでも列挙される（§5.2）。

集合間の欠落（監査 §3.3）:

| ID | 欠落 | 代表ケース |
| --- | --- | --- |
| G1 | Phase Aにあるが、Production Searchが返さない | S1: 巨戟化時にSkillがIdeal、その後Reset SkillsでIdeal（`conversion (c, s*)`、c < s*、cがIdeal位置）。D-0Aでは当該形と無関係な要因で `unconfirmed` か `shape_mismatch` に分類される（§9.9） |
| G2 | ゲーム上合法・表現可能だが、Phase Aに無い | S2: 所持巨戟の現在SkillがIdeal、その後Reset Skills。B1 / B2: 所持巨戟の現在BonusがIdeal、その後Reset / Keep |
| G3 | Phase Aにあるが、あるreservationではSearchが返さない（Ideal非依存、コード読取からの推定・未固定） | `keep_from_source` / `reset_then_keep` の操作範囲に、chainと同じlayoutのheldでないReset位置があると、Bonus streamのB2 frontier代表（最新のReset）が同じ最終武器を別のrequired位置集合のRouteへ畳む |
| G4 | Phase Aにあるが、Production Plannerが割当どおりに実行するかが状態遷移に依存する | Planner開始時にIdeal武器を持つTargetは開始時点では `hasIdeal` でEntryがcommitされない（`deriveTargetSatisfaction()` / `entryIsRelevantForState()`）。ただし恒久的な完成ではなく、他のRouteがIdeal武器を操作するとin-flightになって充足が再評価され、Entryは実行可能かつcollisionなしなら再commitされる（ISSUE_103設計 6.8）。監査 §3.6でG4-i（Ideal武器のうち、どのRouteにも操作されないものが残る。ゼロ操作Routeのsourceとして参照されるだけの武器を含む）/ G4-ii（Ideal武器のすべてが他TargetのRouteに操作され、充足が変化し得る。実行順に依存しPhase D'でだけ判定）/ G4-iii（t自身の両軸Ideal sourceを操作）に分けた。sourceとしての参照は操作ではない（ゼロ操作Routeは武器をin-flightにしない） |

S3（Reset Skills途中でIdeal → さらにIdeal）、B3〜B5（Reset / Keep途中でIdeal → さらにIdeal）、SB1〜SB3のlane途中部分は、Phase A・Planner Alternative
Search・D-0Aのすべてで扱える（監査 §4）。G2のoptionにReachTableの追加情報・追加予測は要らない（監査 §3.4）。

### 19.4 Phase B / Cの正当性への影響（定理T）

lane開始Ideal継続option（S1型・S2型・B1 / B2型）について、整合したReachTableの構造モデル（C1 / C2 / 被覆 / Σ stream終端）では次が成り立つ
（監査 §5）。

- 補題L1: 所持巨戟の継続optionを、継続しているlaneの要件を `none` に替えたoptionへ置換すると、C1は同じ、C2はrequired位置の部分集合、
  objectiveは増えず、被覆は §8.6の補題で同じobjectiveのまま回復できる
- 補題L2: S1型 (c, s*) を (c, c) へ置換し、被覆を §8.6の手続きで回復することを繰り返すと（Φ = Σ s* が置換ごとに減るので停止する）、
  同じsource・objective以下・被覆可能でS1型を含まない完全割当に至る
- **定理T**: 継続optionを含む被覆可能な完全割当は、継続optionを含まない被覆可能な完全割当に弱支配される。したがって構造的最適objective、
  root下界、`LB(partial)`（継続optionを加えても同じsourceの `none` が最小終端originで残るので不変・admissible）、`proven_minimum` の判定規則は
  継続optionの有無で変わらない。§8.6の被覆補題は継続optionを加えた集合でも成立し、「同じ最小objectiveの被覆可能完全割当のうち、
  継続optionを含まないものが常に存在する」へ強化される

定理Tは構造モデルについての主張であり、Planner検証（D'）での成立、G3（支配する側が返らない逆向きの欠落）、構造モデルの将来拡張については
何も言わない。本書は定理Tを **optionを削除する根拠にしない**（§5.3の必要条件原則）。D-0Bを現行option集合で先行してよい根拠、
継続optionの値順序上の位置、優先度の判断にだけ使う。

### 19.5 対応方式と推奨

| 案 | 内容 | 判定 |
| --- | --- | --- |
| 案A | Planner Alternative Searchのpolicyを変え、lane開始Ideal後もchannelを開く | **採らない**。SEARCH_SPEC 5.6.1 / 5.6.8・`AGENTS.md` のSearch規則・固定済みProduction testの変更と、what-if / repairの出力変化による計算版数境界を伴い、Skill held-aware stream（D2-G-Aの主要メモリ要因）が増える。継続Routeは6キー順序で後に配送されるのでdelivery capの範囲で一致する保証も無く、G3も解かない |
| 案B | Global Assignment専用の形状制約付きResearch Search。source・巨戟化位置・required位置を制約に、正式reservation（改変しない）のもとでProduction stream・Route search primitive・Candidate factory・materializerを使い、形に合う解を **選ぶ**（RouteOperationを期待形から組み立てない） | **D-0Cの前に方式を決めて導入する**。B-i（Research側consumer。Production file変更なし）を第一候補、B-ii（Search DomainのResearch専用seam。Production file変更のためオーナー判断）を代替とするが、**最終選択はD-0A-2のdocs-only設計PRで行い、本監査では採用を確定しない**。B-iはProduction Search APIの配送Candidateを採用する方式ではなく、§9.4の現行契約（§9.1 / §9.2の経路）の外にあるので、採用にはResearch専用materialization経路の契約を §9.4とは別に定義・承認すること、技術的実現性（Route baseの取り出し、`RouteSearchContext` の構成）の確認、継続Routeの正当性検証が前提になる（監査 §7.2.1） |
| 案C | 現行Searchを維持し、Search policyが返さない形を未確認として扱う | **D-0Bで採る（暫定）**。定理Tにより最適objectiveは失われない。ただし単独では「合法Routeを検証から漏らさない」目標を満たさない |

推奨は **段階的に案C → 案B（第一候補B-i、最終選択はD-0A-2）、Phase Aの対称化（A-2: 所持巨戟の継続option追加）を併せて行う** である
（監査 §7.5）。リスクは、B-iの合成ロジック複製（PA Searchが返す形はparity testで固定できるが、PA Searchが返さない継続Routeの正当性は示さないので、
全operationの独立予測・Counter / coverage検査・Candidate validation・unit plan・Planner / Trace Replayで別途検証する。`validateBuildRoute()` の通過だけで
同等としない）、B-iの技術的実現性が未確認であること（成立しなければB-iiか案Cへ戻る）、A-2による候補列の変化と値順序latticeの単調性の再証明
（継続 / 非継続の要件列を別streamに分けて併合する必要がある）、G3が案B（B-i）では解けないこと（D-0Bで頻度を測ってB-ii / 同値なrequired位置集合の
受理 / materialization順序から選ぶ）、G4が推奨では解決しないこと（D-0Bで場合分けを集計して別途決める）である。

§9.4は本監査では変更しない。B-iを採用する場合も §9.4の本文（既存D-0A経路 §9.1 / §9.2の契約）は書き換えず、Research専用経路の契約を別の節として
新設し、§9.4にはその節への参照だけを足す（監査 §10）。

**D-0A-2設計での決定**（[D-0A-2設計](PLANNER_GLOBAL_ASSIGNMENT_D0A2_DESIGN.md) §4、§9.11）: B-iは、base取得・Skill lane・`keep_from_source` のBonus laneを
公開APIで構成できるが、`reset` / `reset_then_keep` のBonus laneで、held-aware Bonus streamの「family layout数 × held窓」によるstate数の増加とG3を抑えられないので
主方式にせず、B-ii（Search DomainのResearch専用seam）を主方式とした（Production file変更のためオーナー承認が前提）。上記のリスクのうち「G3が案B（B-i）では
解けない」は、B-iiのBonus操作種別policyで上側・下側の変種とも扱う。Research専用経路の契約は §9.4とは別に定め（D-0A-2設計 §5）、§9.4には参照だけを足した。

### 19.6 Phase A〜Dへの変更範囲

| Phase | 変更 |
| --- | --- |
| A（A-2） | 所持巨戟の現在Ideal laneについて、`none` に加えて継続option（Skill: `reset_skills` s*、Bonus: `reset` / `keep_from_source` / `reset_then_keep`）を同じsourceで列挙する。現在性能が両軸Idealのsourceについて、そのsource自身を操作する継続optionはPlannerで実行されない見込みだが（監査 §3.6のG4-iii）、根拠は前提P1〜P3（C1と最終入力の構成、所持巨戟を変えるのはsourceのRouteとreserveだけ、再commitは `hasIdeal` がfalseへ戻ったときだけ）に依存するので、**除外するかはA-2でtestとともに判断する**（確定しない）。S1型は削除しない。ReachTable・予測回数は変えない。→ A-2で実装し、両軸Ideal sourceの継続optionはPlanner testを根拠に生成しないと決めた（option集合 `a2`。§19.8） |
| B | C1 / C2・objective・root下界・`LB(partial)` は不変（定理T）。値順序latticeは継続 / 非継続を別streamにして各optionちょうど1回・単調な配送を再証明する。MRVの計数とTarget選択順は変わり得る。→ A-2では値順序keyに成分を足さず、Skill要件列を `none` → `reset_skills` のindex列、Bonusの `none` を独立streamとし、配送1回・単調性・支配順を総当たりで確認した（§19.8） |
| C | 被覆・coverer・materialization順序・`ExpectedRouteShape` の意味は不変。C-1 `validateOption()` の「所持巨戟: `none` ⇔ 現在Ideal」を「現在Idealなら `none` または継続option、非Idealなら `none` 不可」へ改める。§8.6に定理Tによる強化を記録する。→ A-2で改訂（§19.8） |
| D | D-0B: S1型（ReachTableだけで判定できる）をSearch前に専用の未実行分類にし、`unconfirmed` / `shape_mismatch` と区別する。§10.3では、Search policy起因の未実行をwindow拡大の根拠にも、cap / gate / envelope見直しの根拠にもしない（D-0Bで `not_executed(search_policy_shape)` として確定。§9.10 / §10.3）。G4（G4-i / G4-ii / G4-iii）は診断として場合分けを記録するだけで、開始時点のIdealだけを理由に候補を不成立・恒久除外に分類しない（成否はPhase D'で判定）。D-0A-2: B-i / B-iiを最終選択し、承認された方式を §9.3の方式選択へ加える（B-iなら §9.4とは別のResearch専用materialization契約を新設し、§9.4本文は変えない）。`matchesExpectedShape()` のrequired位置完全一致は維持する（同値なrequired位置集合の受理は未決）。→ D-0A-2設計でB-iiを主方式に選び、Research専用経路の契約を §9.4とは別に定め（§9.4には参照だけを追加）、方式選択 `d0a2-v2` を §9.3へ組み込んだ。同値なrequired位置集合の受理は採らない（[D-0A-2設計](PLANNER_GLOBAL_ASSIGNMENT_D0A2_DESIGN.md) §5 / §7 / §11） |

### 19.7 D-0B / D-0Cとの依存関係と後続PR

D-0Bの非formal smokeは、現行D-0A方式で先行してよい（定理T）。制限: S1型を含む候補はmaterializeできず未実行で止まる、G2の形は観測できない、
G3では支配する側の形が一致しない、G4はPlanner検証で成立しない場合がある（D-0BはPlannerを実行しないので判定しない）、smokeの数値は現行option集合・
方式でのもので案B / A-2の後に再測定が要る。いずれも「Routeが存在しない」とは書かない。D-0Bでは、S1型のSearch前判定と専用の未実行分類、G3の危険度と
「最終武器は一致しrequired位置だけが異なる」不一致の別集計、G4の場合分け（G4-i / G4-ii / G4-iii）の集計、候補ごとの継続option数を診断として加える。
G4の集計は候補を不成立・恒久除外に分類するためには使わない。

delivery cap・Search規模gateの値は方式（案B）とoption集合（A-2）に依存するので、D-0Bは「runner・非formal smoke・診断」までとし、
計測条件の事前登録は案B / A-2の後の **D-0B-2** へ移すことを提案する（オーナーが元の計画を維持する場合は、案B / A-2の後に登録し直す。
formal run前なのでG9に反しない）。

| 順 | PR | 内容 |
| --- | --- | --- |
| 1 | 本PR | docs-only監査 |
| 2 | D-0B | 実Export用runner（materialize-only mode、別process、envelope、RESULT）、非formal smoke、上記の診断。事前登録はしない（実施済み。§9.10、[記録](PLANNER_GLOBAL_ASSIGNMENT_RESEARCH_D0B.md)） |
| 3 | D-0A-2設計（docs-only） | 案Bの設計: B-i / B-iiの最終選択、B-iを選ぶ場合のResearch専用materialization契約（§9.4とは別の節）と技術的実現性の確認、継続Routeの正当性検証の手順、G3の扱い、§9.3への組込み、§10.3の未実行の扱い、Search規模予測・gate、test計画（実施。[D-0A-2設計](PLANNER_GLOBAL_ASSIGNMENT_D0A2_DESIGN.md)。B-iiを選定し、実装を2a / 2bに分割。§9.11） |
| 4 | D-0A-2実装 | 承認された方式での形状制約付きmaterialization、方式選択の拡張、synthetic test、parity test、継続Routeの正当性検証test（2a: Search DomainのResearch専用seam。オーナー承認が前提。2b: Research方式） |
| 5 | A-2 | Phase Aの継続option、両軸Ideal sourceの扱いの判断（G4-iii）、値順序latticeの別stream化、C-1検査の改訂、総当たりtest、G4の状態遷移test（4と同時でもよい。A-2を4より先に入れると継続optionがmaterializeされない）（実施。§19.8） |
| 6 | D-0B-2 | 確定したoption集合・方式での再smokeと、delivery cap・Search規模gate・envelope・option集合version・方式選択規則の事前登録（実施。§9.12、[記録](PLANNER_GLOBAL_ASSIGNMENT_RESEARCH_D0B2.md)。規則 `d0a2-v2` のgate・budgetを登録し、`d0a-v1` のdelivery capは登録しない） |
| 7 | D-0C | 登録条件でのformal measurement（実施。§9.13、[記録](PLANNER_GLOBAL_ASSIGNMENT_RESEARCH_D0C.md)。`formalValidity = valid`、43 / 43 `all_materialized`） |
| 8 | D-1 | Planner検証（統合acceptance） |

D-0Cの正式計測前に必要な条件は、option集合の確定（A-2の採否と規則。両軸Ideal sourceの扱いを含む）、materialization方式の確定（案Bを含む。
B-iならResearch専用materialization契約の承認と継続Routeの正当性検証の実装）、S1型の分類規則と §10.3での扱いの確定、その集合・方式での再smoke、
それを根拠にした事前登録、clean HEADである。test計画（synthetic、G4の状態遷移、継続Routeの正当性検証、定理Tと拡張後の下界・被覆補題・lattice配送の
総当たり、案BとPA Searchのparity、isolation）は監査 §9.3にある。正式仕様変更の候補（SEARCH_SPEC 5.6.1の層の注記など。いずれも
本PRでは変更しない）は監査 §10にある。

### 19.8 Phase A-2の確定事項（option集合 `a2`）

Refs #154。基準main `d7f6f9a`（PR #249 merged）。branch `research/global-assignment-phase-a2`。Production（Search / Planner / RNG / Worker / UI /
Persistence / schema / version / CalculationContext）、D-0A-2aのSearch seam、方式 `d0a2-v2` の契約、G3の対応方式、Phase Cのmaterialization順序、
D-0B / B-2Bの実測RESULT、formal計測条件は変更していない（Production changed files = `[]`。Production側の既存test fixture
`src/test/fixtures/plannerScheduler.ts` を変更せずに利用しただけ）。実Exportの再smoke、formal run、D-1のPlanner検証は行っていない。
G2のmaterialization結果は [D-0A-2設計](PLANNER_GLOBAL_ASSIGNMENT_D0A2_DESIGN.md) §20、G4-iiiの判断の根拠は監査 §14にも記録した。

**option集合version。** option集合を明示的な値 `ReachOptionSetVersion`（`types.ts`）として導入した。

| version | 内容 | 使う所 |
| --- | --- | --- |
| `global-assignment-reach-options:a1` | D-0A-2bまでのPhase A（所持巨戟の現在Ideal laneは `none` だけ。§5.2の表） | B-2A formal protocol（`global-assignment-b2a:1`。runnerはa1に固定）、B-2B formal RESULT、C-2 / D-0Bのsmoke、`d0a-v1` golden、`reachOptionSet` を持たないD-0B / D-0A-2bのrunner条件 |
| `global-assignment-reach-options:a2` | A-2（下表） | runnerの `--option-set a2`（条件 `reachOptionSet` として記録）。**D-0B-2が `optionSetVersion` に登録する値** |

- `buildReachTable(context, engine, window, optionSet, execution)` は既定値を持たず、値を `ReachTable.optionSet` に保持する。走査（予測・support問合せ・
  行・summary）はoption集合に依存しない（a1 / a2で同一のtableになることをtestで固定。予測回数は増えない）
- Phase A（列挙）・Phase B（値順序lattice・MRV・下界）・Phase C-1（option検証）・D-0Bの診断は、規則を `sourceLaneAdmission(source, table.optionSet)`
  の1関数からだけ読む。Phase A / B / Cで同じoptionを別の規則で判定することは無い（旧 `bonusRequirementIsNone()` は削除し、全callsiteを置き換えた）
- D-0B / D-0A-2bのrunner条件の `reachOptionSet` は任意fieldで、無い記録はa1である（A-2以前の全記録・RESULTはそのままa1と読める。byte単位で不変）。
  protocol version（`global-assignment-d0b:1` / `global-assignment-d0a2b:1`）は変えない。a1の結果をa2として扱わない

**a2のoption規則**（未保護の所持巨戟について。所持通常・新規Normalと、両軸非Idealの所持巨戟はa1と同じ）

| source（Target tから見た現在性能） | Skill要件 | Bonus要件 |
| --- | --- | --- |
| 現在SkillだけIdeal | `none` → `reset_skills` s*（s*昇順、`resetSkillsLimit` 以下のIdeal位置） | 非`none` 要件だけ（従来どおり） |
| 現在Bonusだけ `gogma_artian` でIdeal | `reset_skills` s*（従来どおり） | `none` → `reset` g* → `keep_from_source` g*（source layoutのKeep supportがあるとき）→ `reset_then_keep` (g1, g*)（compact index、g1 < g*） |
| 両軸Ideal（未保護） | `none` | `none`（G4-iii。継続optionを生成しない） |
| 保護中（両軸Idealのときだけsource） | `none` | `none`（REQUIREMENTS 21。両軸Idealとは別の条件として先に判定する） |

位置・layout・supportは従来のReachTableの値（Ideal位置、Reset Ideal位置、source layoutのKeep-Ideal位置、`reset_then_keep` のcompact index）だけを使い、
window外やunsupportedの位置を追加しない。source × Skill × Bonusの直積を配列にしない（既存generatorとindexのまま）。

**G4-iiiの判断: Target自身の両軸Ideal sourceに操作を追加するoptionは生成しない。** Production scheduler（`createPlannerDeterministicScheduleRun()`）を
1 stepずつ実行し、各stepのcommitment状態・in-flight・`hasIdeal`・武器の性能を記録する小規模fixtureのtest（`plannerStartIdealTransition.test.ts`、8件）で
次を確認した（監査 §14）。

| 場合 | 確認したこと |
| --- | --- |
| G4-i | どのRouteにも操作されないIdeal武器が残ると、Targetは全stepで `hasIdeal`、そのEntryは全stepで `not_needed` のまま実行されない。他Targetのゼロ操作Route（`existing_gogma_current`）が参照するだけでは、武器はin-flightにならず性能も変わらない（そのEntryは開始時から `secured`） |
| G4-ii | 他TargetのRouteがIdeal武器を最初に操作したstepでin-flightになり、Targetの `hasIdeal` がfalseへ戻り、次stepのcommitment更新でEntryがcommitされ実行される（completed、Trace Replay valid）。holding unitの位置を既にCounterが通過していればcommitされない（exhausted）。他のIdeal武器がin-flightでなければ `hasIdeal` を保ちcommitされない |
| G4-iii | Bonus継続・Skill継続・両方の3通りで、そのEntryは全stepで `not_needed`、どのstepも当該sourceを操作せず、in-flightにならず性能も不変。`createProductionPlanWithObserver()` のPlanにも当該Entry・sourceのStepは無い |

前提P1（最終入力でsourceを参照するEntryは1件）・P2（武器の状態とin-flightを変えるのは、その武器をsourceとするRouteの操作とreserveだけ）・
P3（未commit Entryのcommitは開始時と `hasIdeal` がfalseへ戻ったときだけ）を、これらのfixtureで観測として固定した（一般の入力についての証明ではない。
将来のPlanner変更ではtestが変化を検出する）。G4-i / G4-iiはPhase Aの静的な除外規則にしない（実行順に依存し、Phase D'でだけ判定する）。

**Phase B。** 所持巨戟のSkill要件列は `none → reset_skills（s*昇順）` のindexable sequence、Bonusは長さ1の `none` streamを既存の `reset` /
`keep_from_source` / `reset_then_keep` streamと並ぶ独立streamとして加えた（`indexedSkillRequirements()` / `indexedBonusStreams()`）。値順序keyに成分を
足していない。`none` はstream終端増分が最小で、同点でも最終位置の成分が−1なので、継続optionは同じsourceの支配する非継続option（継続laneを `none` に、
S1を (c, c) に替えたもの）より必ず後に配送される。下界menuは「laneが `none` を許すか」と「操作の最終位置」を分けて持ち（`skillNone` / `bonusNone`）、
`none` を許すlaneはorigin終端だけを読むので、`LB(partial)` はa1とa2で同じ関数である（監査 §5.4 系2）。

**Phase C。** `validateOption()` は、laneごとの許可要件を `sourceLaneAdmission()` から読み（現在Idealのlaneは `none` または継続、非Idealのlaneは `none` 不可、
両軸Ideal・保護は `none` だけ）、保護、sourceがrowのsource（全field一致）であること、window内の位置（Reset Skills / 巨戟化 / Gogma、Reset→Keepの g1 < g*）、
Keep support、Normal要件、`streamEnd` の再導出を従来どおり独立に検査する（generatorへの問い合わせはしない）。位置がIdealであることは従来どおり
required-only replay（§5.3）が検査する。C1 / C2・Counter coverage・coverer・materialization順序・`ExpectedRouteShape`・replayの予測semanticsは変更していない。
現在SkillがIdealの所持巨戟が `reset_skills` を選べば、originからのSkill covererになる（test固定）。

**Phase D。** 継続形の検出器を `CONTINUATION_SHAPE_DETECTORS = [conversionSkillContinuationShapeOf (G1), ownedGogmaContinuationShapeOf (G2)]` とし、
`searchPolicyShapeOf()` も同じ2つを問う。G2の形は `{ policy: 'lane_start_ideal_owned_gogma_continuation', ownedWeaponId, skill, bonus }` で、Skill（S2）と
Bonus（B1 / B2、`requirement` / `resetPosition` / `finalPosition`）を別々に記録する。G1の値とserializationはD-0Bのまま。`d0a2-v2` はG2を
`continuation_shape_constrained_only`（`shape_constrained` だけ）で扱い、`d0a-v1`（precheckあり）は `not_executed(search_policy_shape)` に分類する。
D-0Bの診断 `countContinuationOptions()` は、a1 tableでは従来の値（`ownedGogmaContinuation: 'not_generated_by_current_phase_a'`）を返し、a2 tableでは
`{ options, skill, bonus }` を数える。`g4iiiObservability` はa1 / a2とも事実のまま（G4-iiiはどちらの集合でも生成されない）。

**検証結果**（seed付き乱数の手組みtable、Fake / table Engine。いずれもsolver・Phase A generator・Phase C moduleから独立に書いた参照で比較した）

| 項目 | 結果 |
| --- | --- |
| Phase A列挙 = 独立参照列挙（順序・option objectまで） | 300 seed × a1 / a2で一致。a2の継続option 1,379件。a2 ⊇ a1で、差は所持巨戟の継続optionだけ（両軸Ideal・保護sourceには無い） |
| 値順序lattice | 150 seed × 部分割当（空と完全割当のprefix）で、配送列 = 参照optionの値順序全sort、各option 1回、key狭義単調。継続optionが支配する非継続optionより後に配送されることを3,326件で確認。`countUpTo(k)` は参照の資源可行数と一致 |
| `LB(partial)` のadmissibility | 300 seedの全Target順prefix 8,158件で、真の残り最小値（参照brute force）以下。a1 menuで計算した値と全件一致。root（空の部分割当）の下界もa1 = a2 |
| 定理T | 300 seedで、構造的最適objectiveが「a2全体」「a2から継続option（S1 / S2 / B）を除いた集合」「a1」で一致。継続optionを含む被覆可能完全割当8,171件のすべてを、独立実装した手続きPで同じsource・objective以下・継続optionなし・C1 / C2・被覆可能な割当へ写せた（うち1,169件はSkill被覆の修復（巨戟化位置の引き下げ）が必要だった） |
| Phase C | 200 seedのa2の全C1 / C2完全割当で、C-1検査が通り、被覆判定が独立predicateと一致（被覆不成立6,489件を含む）。coverage-gated searchの全候補 = 参照の被覆可能集合（重複なし、決定的、C1 / C2のassignmentが在れば `coverage_infeasible` で終わらない） |
| root下界段階 | 同じcontextのa1 / a2 tableで構造的最適objectiveが一致し、`measureRootLowerBound()`（table・option集合を読まない）との比較結果も同じ |
| G2 end-to-end / 補題 | D-0A-2設計 §20 |

**互換性。** `d0a-v1` golden（29ケース、`JSON.stringify` 一致）はそのまま通る。B-2Aの記録はa1に固定。a2では所持巨戟のoption数が増えるので、MRVの
計数・Target選択順・値順序・候補列はa1と異なり得る。B-2B / C-2 / D-0Bの候補列・数値との比較は「option集合の条件差」として扱い、旧記録を書き換えない。

**未確認・持ち越し**: 定理Tとlatticeの性質は小さい窓の合成fixtureで反例が無いことの確認であり、一般の証明ではない。G4のP1〜P3は小規模fixtureでの
観測であり、全入力についての証明ではない。a2での実Export上の候補列・Search規模・materialization成否はD-0B-2の再smokeで測る。G2を含む候補の
Planner成立（Trace Replay、fresh Planner）はD-1で判定する。
