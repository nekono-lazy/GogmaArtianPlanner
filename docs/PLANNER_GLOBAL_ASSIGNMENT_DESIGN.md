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

1. 全planning Targetの共存Route集合を、oracleを実行入力に使わずに自動構成する能力を **維持** する（incumbent 8,534を下回らない結果を「改善」と呼ばない）
2. 1,657の構成原理（**先にRNG位置と資源を割り当て、後からRouteを構成する**）を、任意のPlannerInputへ適用できる一般アルゴリズムとして設計する
3. 物理操作数・時間・メモリを、C2 / D2系列のOOM / timeoutを繰り返さない構造で改善できる道筋を示す
4. Production契約変更が必要な範囲を明確に分離する（§16）

### 1.4 用語

| 用語 | 意味 |
| --- | --- |
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
| D2-G-A | K3 L2 OOMの主因候補はSkill held-aware streamの全depth保持（conversion位置306 × depth × 約300 state、モデル6,081万state）。**Search規模（conversion位置数、Skill保持state、Gogma held幅）はreservationとextentだけからSearch前に計算できる** | materialization前にSearch規模を事前計算しgateにする（§9.6）。reservationを狭く（mold）する動機 |
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
| `src/domain/planner/productionPlanGeneration.ts` / `plannerTraceReplay.ts` / `plannerValidation.ts` | `createProductionPlanWithObserver()`、`replayPlannerSearchTrace()`、`validatePlannerInput()` | 最終authority（§9.4） |
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
- Production deterministic schedulerは、stream位置にcommitted unitが無いのに後方のpending unitがある状態をstall、holding unitがreadyでなく循環待ちになる状態を
  deadlockとして、順位関数最下位のEntryを落とす（ISSUE_103設計 7.8）。holding unitがreadyでない場合は **待つ**（stallではない、7.3）

## 3. 新しいアルゴリズムの全体構成

### 3.1 基本原則

従来の「既存Routeの一部を固定し、競合したTargetだけ再検索し、改善したら次へ進む」（Phase 0の逐次射影、D2系列の局所context）を全体最適化の中心にしない。
代わりに、1,657再構成と同じ順序で考える。

```text
(A) 到達option生成     Production RNGから、各TargetがIdealへ届き得る source × required位置 の必要条件を列挙する
(B) Global Assignment  全Targetへoptionを1件ずつ同時に割り当てる（source排他、required位置排他）。目的関数はΣ stream終端
(C) Counter被覆        割当が決めたrequired位置の間を、どのTargetのskippable chainで埋めるかを決め、各Targetの操作位置集合を確定する
(D) Materialization    操作位置集合をspeculative reservation / 射影起点としてProduction Searchへ渡し、正規のCandidate / Entryを得る
(D') Planner検証        全Entryで通常Production Planner + Trace Replayを1回実行する。これが唯一の成立authority
(E) 評価・改善         成立した集合の物理操作数（= Σ stream終端）を下限と比較し、budget内で改善を続ける
```

最初から完成済みRouteを大量に列挙しない。(A)〜(C)は軽量な位置集合だけを扱い、Route本体は(D)で必要なTarget・必要な形だけをdemand-drivenに
materializeする。

### 3.2 データフロー

```text
PlannerInput（validated, Planner-start origin）+ ProductionRngEngine + Master
        │
        ▼
[Phase A] ReachTable ── per Target: SkillReach / BonusReach / NormalReach（memo付き位置走査、window W）
        │                 per source: SourceCandidate（owned gogma / owned normal / new normal position）
        ▼
[Phase B] Assignment solver（deterministic backtracking + MRV + branch-and-bound）
        │   入力: ReachTable、排他制約、objective = Σ(終端 − origin)、root lower bound（applicableのとき）
        │   出力: incumbent Assignment（Target → ChosenOption）+ 探索診断
        ▼
[Phase C] Coverage ── stream別のrequired位置列から gapを求め、covererを決め、
        │             Target別の ownOperationPositions（required ∪ chain）と RouteShape を確定
        ▼
[Phase D] Materialization ── Target別に speculative reservation（mold）と extent を作り
        │   visitPlannerAlternativeCandidates() / searchCandidates() → createPlannerRouteUnitPlans() で形を照合
        │   → deterministic materializer → BuildListEntry（Planner-start origin）
        ▼
[Phase D'] createProductionPlanWithObserver()（全43 Entry、conflictResolutions = []、Research maxPlanSteps）
        │   + replayPlannerSearchTrace() + summarizePlanPhysical() + 別processのfresh ordinary Planner
        ▼
GlobalAssignmentResult（typed status、incumbent、下限、Phase別診断）── post-hoc analyzerだけがoracleと比較
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
    materializationDeliveryCap: number            // 1 Targetのmaterializationで受け取るCandidate上限
    researchMaxPlanSteps: number                  // Phase D' のPlannerInput.options（Research条件。Production defaultではない、G12）
  }
}
interface ReachWindow { normal: number; gogma: number; skill: number }
```

`plannerInput.targetWeapons` のうち `isTargetWeaponPlanningEligible()` を満たすTargetだけを対象にする。`preferredOwnedWeaponId`、`priority`、
`buildListEntries` の既存RouteはPhase A〜Cの入力にしない（priorityは§6.4のtie-breakにだけ使う。既存Entryは分母維持のためPhase D'で未成立Targetに残す）。

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
  objective: number   // Σ (streamEnd − origin)
}
```

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

interface RouteShape {
  targetWeaponId: TargetWeaponId
  option: ReachOption
  /** stream別の自分の操作位置（required ∪ chain）。昇順・重複なし */
  ownPositions: { skill: number[]; gogma: number[]; normal: number[] }
  /** chain部分の操作種別はoptionから一意に決まる（§8.3） */
}
```

### 4.5 Phase Dの中間データ（materialization）

```ts
interface MaterializationRequest {
  targetWeaponId: TargetWeaponId
  shape: RouteShape
  method: 'planner_alternative_mold' | 'candidate_search_projected'   // §9.1 / §9.2
  reservation: PlannerAlternativeReservation   // method = mold のとき。speculative、永続・記録しない
  extent: PlannerAlternativeSearchExtent | CandidateSearchSettings
  predictedSearchScale: { conversionPositions: number; gogmaFreeWidth: number; skillFreeWidth: number; normalFreeWidth: number }  // §9.6 gate
}

interface MaterializedTarget {
  targetWeaponId: TargetWeaponId
  entry: BuildListEntry                          // Planner-start originのEntry（deterministic materializer）
  plannerRequired: { skill: number[]; gogma: number[]; normal: number | null }   // createPlannerRouteUnitPlans() から
  deliveredBeforeMatch: number
  verification: 'materialized'
}
```

### 4.6 出力

```ts
type GlobalAssignmentResult =
  | { status: 'verified'; plan: PlannerResultSummary; assignment: Assignment; lowerBound: LowerBoundReport; proof: 'proven_minimum' | 'best_found' }
  | { status: 'assignment_found_unverified'; assignment: Assignment; reason: 'materialization_mismatch' | 'planner_rejected' | 'coverage_infeasible'; detail: PhaseDiagnostics }
  | { status: 'assignment_incomplete'; incumbent: Assignment | null; reason: 'node_budget' | 'cancelled'; explored: number }
  | { status: 'no_assignment_within_window'; window: ReachWindow; targetsWithoutOption: TargetWeaponId[] }
  | { status: 'unsupported_input'; reason: 'unconfirmed_counter' | 'checkpoint_selection' | 'prediction_unsupported' | 'blind_route_required'; detail: string }
  | { status: 'unmeasured'; reason: 'timeout' | 'out_of_memory' | 'process_failure' }
```

- `verified` だけが「成立」である。`proven_minimum` は `provenLowerBoundTotal()` がPlanのphysical stepsと一致した場合に限る
- `no_assignment_within_window` は「この窓では見つからなかった」であり「実行可能解が存在しない」ではない
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
| `planner_verified`（Phase D'） | 全Entryのfull Planner run + Trace Replayが成立 | §9.4 |

`rng_replayed` は、Phase 2-A.5 Stage Aの「required-only再生」と同じ考え方（skippable unitを他Targetが消費しても結果が変わらない）を、
oracle moduleをimportせずに実装する（§11）。Phase Aではsolverへ渡す前に全optionを `rng_replayed` にする必要はない（走査結果は既にIdeal判定済み）。
再生はPhase Bが選んだoptionに対してだけ行い、一致しなければinternal invariant errorとして止める（走査とIdeal判定が同じauthorityなので不一致は実装バグ）。

### 5.4 疑似コード

```text
buildReachTable(input, engine, window):
  assert every planning Target's weapon type has a confirmed rarity-8 Normal Counter, or no new_normal source is needed (else unsupported_input)
  for each (weaponTypeId, elementId) group of planning Targets:
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
| Branch-and-bound | 部分割当の下界で目的関数的に無駄な枝を切る。incumbentを常に持つ | 下界の質に依存。cross satisfactionがある入力では距離の根拠が弱い | **採用**（安全な下界だけ、§10） |
| Lower-bound guided search（root緩和の閾値で値順序を決める） | 1,657再構成で有効だった。閾値内側から探す | 緩和解が実行可能とは限らない。閾値を硬い制約にすると解を失う | 値順序のheuristicとしてだけ採用。硬い制約にしない |
| 段階的なCandidate portfolio拡張（C2 / D2方式） | 既存Planner Alternative kernelをそのまま使える | full Routeを先に列挙する。Search規模（OOM / timeout）と1 fixed winner contextの制限（C2 / D2） | 中心にしない。materializationのdemand-driven生成として位置づける |
| 乱数restart（1,657 scratch） | 局所解からの脱出 | 非決定性。再現・事前登録・中断再開と相性が悪い | 採用しない。決定的なdiscrepancy探索（Phase E）で代替 |
| 外部solver（ILP / SAT） | 最適性証明が得やすい | 依存追加、Browser Worker実行の見通し、決定性の保証、Research範囲を超える | 採用しない（§15） |

### 6.3 採用方式: 決定的backtracking + MRV + branch-and-bound

最初のResearch実装（Phase B）は次とする。

- 深さ優先のbacktracking。各nodeで未割当Targetから **MRV**（現在の部分割当のもとで実行可能なoption数が最少。同数ならpriority降順、Target ID昇順）を選ぶ
- 値順序は **Σ stream終端の増分が小さいoption** から。同点はowned sourceを新規Normalより先、Skill / Gogmaのrequired位置が小さい方、stable key
- **branch-and-bound**: 部分割当の下界 `LB(partial)`（§10.1）がincumbent以上なら枝を切る。incumbentは最良の **完全割当かつ被覆可能**（§8）な割当
- 完全割当に到達したら §8 の被覆pre-checkを行う。Skill被覆不成立なら、最も低い未被覆Skill位置 x を記録して棄却し、値順序に
  「conversion c = x を持つoption」（§4.3の `c < s*` 型）を優先的に試す（**coverage-driven value ordering**）。これは順序の変更であり制約の緩和ではない
- node budget（§10.4）を消費し尽くしたら `assignment_incomplete` としてincumbentを返す。乱数restartはしない
- root下界（`solveLowerBoundRelaxation()`、applicableのとき）とincumbentが一致した時点で探索を終了してよい（最小性の証明が得られたため）

### 6.4 疑似コード

```text
solve(reach, bounds):
  root = lowerBoundRoot(reach)                    // §10.2: applicable なら relaxation minimum、否なら null
  incumbent = null
  nodes = 0
  assign = empty partial assignment (streamEnd = origins, usedSources = ∅, usedPositions = ∅ per stream)

  search(assign):
    if nodes >= bounds.nodeBudget: raise NodeBudgetReached
    nodes += 1
    if all Targets assigned:
      if not coverageFeasible(assign):            // §8.1, Skill のみ不成立になり得る
        recordUncoveredSkillPosition(assign)      // 値順序へ反映（coverage-driven）
        return
      if incumbent == null or assign.objective < incumbent.objective: incumbent = assign
      return
    t = argmin_{unassigned} |feasibleOptions(t, assign)|   // MRV; tie: priority desc, id asc
    if |feasibleOptions(t, assign)| == 0: return   // dead end（この部分割当では t に option が無い）
    for option in orderedOptions(t, assign):       // Σ終端増分 asc → owned first → 位置 asc → stable key; uncovered Skill position があれば c = x を先に
      child = assign + (t, option)
      if LB(child) >= (incumbent?.objective ?? +∞): continue        // branch-and-bound（admissible な下界だけ）
      search(child)
      if incumbent != null and root != null and incumbent.objective == root: raise ProvenOptimal

  try search(assign) catch ProvenOptimal / NodeBudgetReached
  return { incumbent, nodes, proof: incumbent && root == incumbent.objective ? proven_minimum : best_found }

feasibleOptions(t, assign):
  { o ∈ enumerateOptions(t) | o.source ∉ assign.usedSources
                             ∧ o.required positions ∩ assign.usedPositions(stream) = ∅  (per stream)
                             ∧ LB(assign + o) < incumbent.objective (if any) }
```

- `enumerateOptions` はlazy（§5.4）。`feasibleOptions` のサイズはMRVの判定に必要な分だけ数える（上限付きの先読みでよい。同数判定が崩れても
  正しさには影響しない）
- `usedPositions` にはrequired位置だけを入れる。chain位置は入れない（排他資源ではない）
- dead end（option 0件）はwindow内での不在であり、記録して「この窓では解が無い」の根拠にする。「存在しない」とは書かない

### 6.5 決定性

solverは `Math.random`、`Date`、`crypto.randomUUID` を使わない。入力（PlannerInput、window、budget）が同じなら、同じnode列・同じincumbentを返す。
ReachTableの配列はすべて昇順、Mapは挿入順を固定する（Target ID昇順、layout key昇順）。cancelは既存Research seam（`shouldCancel()` /
`yieldControl()`）をnode単位で確認する。中断時はincumbentとnode数を返す。

## 7. held / blocked / silent fast-forwardの扱い

本設計は新しいCounter共有規則を作らない。割当・被覆・materializationのすべてで次の既存semanticsをそのまま使う。

| 概念 | authority | 本設計での使い方 |
| --- | --- | --- |
| required / skippable | `createPlannerRouteUnitPlans()` の `canSkipWhenCounterPassed`（PLANNER_SPEC 7.0.2の表） | Phase Aのoptionはrequired位置だけを持つ。Phase Cのchainはskippable unitだけで構成する。Phase Dで実際のEntryから再導出して照合する |
| silent fast-forward | `fastForwardPlannerRouteProgress()`（PLANNER_SPEC 7.0.2） | chainのunitが他Targetのrequired位置を通過するとき、required側が先に実行されchain側はfast-forwardされる（支配関係）。設計はこれを前提に、chainがrequired位置を跨いでよいとする |
| physical action sharing | `physicalActionKey` / `shareable` / `arePlannerRouteUnitsShareable()`（PLANNER_SPEC 7.0） | 共有を仮定しない。v1ではrequired unit同士の共有は生じないので、C2（required位置互いに素）で十分 |
| OwnedWeapon排他 | `collectReferencedOwnedWeaponIds()`、`exclusiveConsumedOwnedWeaponId` | C1（source排他） |
| Normalのproduction target / 進行用forge | Issue #129（PLANNER_SPEC 7.0.2）: 最終unitはrequired、中間unitはskippable。production target同士だけが `same_normal_counter` | C2のNormal部分。被覆は「最も遠いproduction targetのTargetがoriginから全部forgeする」で自動的に成立（§8.1） |
| held / blocked / 排他OwnedWeapon | PLANNER_SPEC 9.2.19.3、`derivePlannerAlternativeReservation()` | Phase Dでspeculative reservationを組む（§9.1）。意味は変えない: held = 他Targetの操作位置（required / chain）、blocked = 他Targetのrequired位置、排他OwnedWeapon = 他Targetのsource |
| held位置を跨ぐRoute | PLANNER_SPEC 9.2.19.4、DATA_MODEL 9.2（非連続な絶対位置、Normalのheld prefix canonical表現） | 非連続Routeはこの表現で保存される。永続fieldを追加しない |

Phase A〜Cが使う「位置集合による判定」は、上記authorityの **結果を予測する必要条件** である。最終的にはPhase Dが実際のEntryから
`createPlannerRouteUnitPlans()` と `derivePlannerAlternativeReservation()` で再導出し、Phase D'のPlannerが判定する。
Phase A〜Cの予測と再導出が食い違った場合はfail closedし（`materialization_mismatch`）、Phase A〜Cの規則を黙って緩めない。

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

nearest-successorはchainを短くし、materializationのSearch規模（§9.6）とRoute operation数を抑える。1,657のように1本の長いchain
（Gogma 55〜289）で全区間を被覆する形も、連続するgapを同じTargetが被覆すれば自然に現れる。どちらでも物理操作数は変わらない（§6.1）。

### 8.3 Route形の確定

Targetごとに `ownPositions` を決める。chain部分の操作種別はoptionから一意に決まる。

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
skip規則の根拠そのもの）。Phase Dは実際のCandidateの `finalBonuses` / Skillがoptionの再生結果と一致することを確認する。

### 8.4 pre-checkの限界

§8.1は必要条件である。満たしても、Plannerの実際の判断（route commitmentの暫定帰結、holding unitの待機、`reserve` による他Target充足、
runtime-unsupported、`maxPlanSteps`）で成立しないことはあり得る。成立の最終authorityはPhase D'である。満たさない場合に
Plannerへ渡しても成立しないことは、stall規則から確実に言える（渡さない）。

## 9. MaterializationとProduction Planner検証（Phase D / D'）

### 9.1 Planner Alternative Searchによるmaterialization（主方式: mold）

Target tの `RouteShape` から、Planner-start origin（`createPlannerStartSearchOrigin(plannerInput)`）に対するPlanner Alternative Searchの入力を組む。

```text
reservation(t):
  for each stream:
    held    = { positions in [origin, t.lastPosition] } \ t.ownPositions      // 自分が操作しない位置はすべてheld（他Targetの操作で進む）
    blocked = held                                                             // そこへ自分の操作を置かせない（mold）
  normal  : counterIdごと。held = origin .. p−1 のうち自分がforgeしない位置、blocked = 他Targetのproduction target
  exclusiveOwnedWeaponIds = 全owned weapon \ { t.source（ownedのとき） }
extent(t):
  maxNormalAdvance = p − origin_normal + 1（new_normal）、1（それ以外）
  maxGogmaAdvance  = lastGogma − origin_gogma + 1（Bonus操作なしは1）
  maxSkillAdvance  = lastSkill − origin_skill + (owned gogma ? 1 : 0)（SEARCH_SPEC 3.1 / 5.6.8のwindow定義。最小1）
excludedRouteKeys = []
```

- heldの意味（他Routeの操作で進む位置）は、割当と被覆がその位置を実際に他Targetへ割り当てたことで裏付けられる。blockedの意味（自分の必須操作を置かない）
  はそのままである。「自分が操作しない位置をすべてheld + blockedにする」はreservationの意味を変えず、Search側のcoverage条件
  （originから最後の操作位置までが自分の操作かheld）により、Searchは `ownPositions` にだけ操作を置くRouteを返す
- このreservationは **speculative** である（§16、G1）。永続化せず、`PlannerConflictResolution` / lineageへ書かず、Worker protocolへ載せない
- Searchが返したCandidateを順に受け取り、`createDeterministicMaterializer()`（Planner Alternative materializerと同じcore）でEntryにし、
  `createPlannerRouteUnitPlans([entry], engine)` のrequired位置（`canSkipWhenCounterPassed = false` のunitの `counterBefore`）と
  `BuildRoute.sourceOwnedWeaponId` がoptionと一致し、最終Bonus / scope / Skillが §5.3 の再生結果と一致した最初のCandidateを採用する。
  一致しないCandidateは次へ（`materializationDeliveryCap` まで）。capに達すれば `materialization_mismatch`（「Routeが無い」ではない）
- Normal: 非covererの `create_normal_artian` はSEARCH_SPEC 5.6.8 / PLANNER_SPEC 9.2.19.4のheld prefix canonical表現で返る。covererはheld無しで
  `origin .. p` の連続forgeになる

### 9.2 Candidate Searchによるmaterialization（補助方式: 射影起点）

chain coverer（長い連続Route）は、通常Candidate Searchが射影起点から連続Routeとして返す形そのものである。Phase 2-A.5 Stage Bと同じく、
sourceだけの在庫・当該Targetだけ・各streamの最初の操作位置を起点にしたrngState / normalCounters・最小extentで `searchCandidates()` を実行し、
canonical Idealを既存adapter `materializeGlobalResearchCandidate()`（`createConstrainedCandidate(..., 'origin_reach')` + deterministic materializer。
searchStateHashの書換えではない）でPlanner-start originのEntryにする。

どちらを使うかは次で決める（決定的）。

| 条件 | 方式 |
| --- | --- |
| `ownPositions` が各streamで最初の操作位置から最後まで連続（chainが単一区間でrequired位置を跨がない） | どちらでもよい。予測Search規模（§9.6）が小さい方。同点なら射影起点Candidate Search |
| 非連続（held位置を跨ぐ） | mold |
| 射影起点Candidate Searchのcanonical Idealが形と一致しない | moldへfallback（1回だけ。それでも不一致なら `materialization_mismatch`） |

### 9.3 identityと決定性

- Candidate / Entry IDはdeterministic materializer（PLANNER_SPEC 9.2.13）が、search identity + Candidate semantic meaningから決める。
  search identityには `normalizePlannerSearchOrigin(origin, target)`、正規化したreservation、extent、本設計のalgorithm token、CalculationContextを含め、
  random UUID / Clock / request UUID / enumeration ordinalを含めない
- 同じ入力からは同じEntry IDが出る。PlannerInputに既に存在するIDとの衝突（内容が異なる）はfail closed（既存materializerのcollision規則）
- 観測trace（`bonusAmendmentTrace` / `skillAmendmentTrace` / `conversionSkillTrace`）はSearch出力のものを引き継ぎ、再抽選しない
- intermediate groupsはmaterializerが抽出する（追加予測なし）。本設計は選択（pin）を一切置かない
- `validateBuildCandidate()` / `validateBuildListEntry()` を通す。unsupported predictionを含むRouteは生成されない（Searchの契約）

### 9.4 Production Planner検証（Phase D'）

```text
finalInput = plannerInput with buildListEntries = for each planning Target:
               materialized Entry if present, else the Target's original Entry（分母維持。Phase 0と同じ規則）
             conflictResolutions = []
             options = { maxPlanSteps: researchMaxPlanSteps }   // Research条件（G12）
validatePlannerInput(finalInput)   → excluded Entry 0 を要求
result = createProductionPlanWithObserver(finalInput, deps, options, observer)   // beforePlannerRun でfull run数を数える
replay = replayPlannerSearchTrace(finalInput, bestState, engine)                   // 独立に実行してplain evidenceへ記録
physical = summarizePlanPhysical(plan, finalInput)                                 // Σ stream advance = steps を確認
```

成立条件（すべて必須）: `termination.status === 'completed'`、`completedTargetCount === planning Target数`、selected = 全Entry、Conflict 0、
rejected 0（resource_conflict 0）、warnings 0、Trace Replay valid、`physical.total === plan.steps.length`。
さらに `physical.total` がassignmentの `objective` と一致することを確認する。不一致は `objective_mismatch` として診断に残し、成立とは呼ばない
（恒等式が破れる = 本設計の前提が崩れている）。

成功条件(b)（P0Rと同じ）: 別のNode processで元Exportから入力を再構築し、生成Entryを各Targetの元Entryと置換しただけのfresh ordinary Plannerを
1回実行し（`verifyGlobalResearchFreshPlan()` と同じ経路）、同じ条件を満たすこと。

### 9.5 失敗時の扱い

| 失敗 | status | 次の動作 |
| --- | --- | --- |
| あるTargetでSearchが形と一致するCandidateを返さない | `assignment_found_unverified` / `materialization_mismatch` | そのoptionをこのrunで除外（除外はrun内に閉じ、永続しない）し、Phase Bのincumbentの次候補へ戻る（node budget内）。推測で別のRouteを作らない |
| Plannerが完成しない / Conflict / rejected / Replay invalid | `assignment_found_unverified` / `planner_rejected` | 落ちたEntry / Conflictのparticipantを記録し、関与Targetのoptionをrun内で除外して次候補へ。Conflictを `PlannerConflictResolution` で解決しようとしない |
| `maxPlanSteps` 到達（incomplete） | `planner_rejected` | Research条件の見直し項目として記録。値を自動で増やさない |
| timeout / OOM | `unmeasured` | 不成立に読み替えない |

### 9.6 Search規模のgate

D2-G-Aの知見どおり、Planner Alternative Searchの規模はreservationとextentからSearch前に計算できる。mold方式では

- conversion Skill位置数 = 自分の操作位置のうち巨戟化候補になる位置数（moldでは1）
- Gogmaの非held幅 = `ownPositions.gogma` の長さ、Skillの非held幅 = `ownPositions.skill` の長さ
- Normalの非held幅 = 自分でforgeする位置数

を `predictedSearchScale` として記録し、事前登録した上限を超えるrequestは実行せず `materialization_mismatch`（reason `search_scale_gate`）にする。
上限値は未計測なので本書では決めず、Phase Dの事前登録項目とする（§15）。chain covererのchainが長い（例: 235位置のReset連鎖）場合はSearch規模が
大きくなるが、1,657 Stage Bでは同等のRouteをCandidate Searchが射影起点から返しているので、§9.2の方式へ回す判断もこのgateで行う。

## 10. 目的関数・下界・探索budget

### 10.1 目的関数と部分割当の下界

目的関数は `Σ_streams (streamEnd − origin)`。部分割当の下界 `LB(partial)` は次で定める（admissible。実際の最小を上回らない）。

```text
LB(partial) = Σ_streams ( max( currentEnd_stream,  floor_stream(unassigned) ) − origin_stream )
floor_stream(unassigned) = max over unassigned Target t of  min over feasibleOptions(t) of option.streamEnd_stream
```

各未割当Targetはいずれかの実行可能optionを取る必要があるので、そのstream終端はそのTargetの最小終端以上になる。これは `solveLowerBoundRelaxation()` の
`skillFloor` / `gogmaFloor` と同じ考え方であり、位置排他・被覆を無視するので真の最小以下である。

### 10.2 root下界と最小性の主張

- root下界は `collectLowerBoundProblem()` + `solveLowerBoundRelaxation()` で求める。入力のcross satisfaction監査（`auditCrossSatisfaction()`）が
  可能ペア0件のときだけ `found` の値を下界として使い、`provenLowerBoundTotal()` がincumbentの物理操作数と一致すれば `proven_minimum` と呼ぶ
- 可能ペアが1件以上あるPlannerInputでは下界は `not_applicable` であり、**最小性を主張しない**。solverはC1（distinct source）のまま実行可能解を探し、
  結果は常に `best_found`。branch-and-boundの `LB(partial)` も、そのTargetペアに関しては「1本の武器で2 Targetを完成させる割当」を見ていないので
  安全な下界ではない。したがって可能ペアがある入力では、`LB(partial)` を可能ペアに属するTargetについてはfloorへ含めない（残りのTargetだけで下界を取る）。
  これで下界は再び安全になる（可能ペアのTargetが1本の武器で完成し得ても、他TargetのfloorはそのTargetに依存しない）
- `singleStreamLowerBounds()` は説明用であり加算しない
- 1,657をどのExportの下界・探索上限にも使わない。下界は常にそのPlannerInputから計算する

### 10.3 走査window ladder

Phase Aの走査windowは事前登録したladderで広げる。

- W0 = `recommendedCandidateSearchDefaults`（Normal 350 / Gogma 500 / Skill 1500、Issue #125、`src/domain/models/common.ts`）。これはCandidate Searchの
  推奨初期値として既に正式仕様（REQUIREMENTS 14.1）に根拠を持つ非oracle起源の定数であり、Phase 0 / 1-E / P0RのResearch extentでもある。
  Plannerが読むauthorityにはしない（Research入力として明示的に渡す）
- 広げる条件は「あるTargetのoption数が0」または「incumbentのいずれかのstream終端がwindow末端に接している（`windowReached`）」だけ。
  Normal 2倍（P0R V1）のような固定倍率をTarget個別に適用しない。rungの値と上限はPhase Aの事前登録で決める（§15）
- window外の位置を「存在しない」と記録しない。結果は常に `window` を併記する

### 10.4 budgetの分離（G5）

| 概念 | 単位 | 性格 |
| --- | --- | --- |
| 走査window | Counter位置数（stream別） | Phase Aの範囲。ladderで事前登録 |
| node budget | solverの展開node数（決定的） | Phase Bの範囲。到達は `assignment_incomplete` |
| materialization delivery cap | 1 Targetで受け取るCandidate数 | Phase Dの範囲。到達は `materialization_mismatch` |
| Search規模gate | 事前計算した規模（§9.6） | Phase Dの範囲 |
| full Planner run数 | `beforePlannerRun()` の回数 | Phase D'の観測値。Production `maxPlannerReruns` を流用しない |
| `maxPlanSteps` | Research 20000（Domain default 1000 / Planner Alternative runtime導出とは別、G12） | Phase D' |
| wall-clock / heap | measurement envelope | `unmeasured` の判定だけに使う。意味論的判定に使わない（G6 / G7） |

具体値（node budget、delivery cap、Search規模gate、ladder rung）は根拠となる計測が無いので本書では決めない。各Phaseの事前登録で、
そのPhaseの非formal smokeを根拠に固定し、formal run後に変えない。

### 10.5 評価の優先順位

第一（成立）: 全planning Target完成、Conflict 0、rejected / resource_conflict 0、termination completed、Trace Replay valid。
第二（品質）: 物理操作数（= Σ stream終端）、実行時間、メモリ。
部分解（完成数 < 全Target）は `assignment_found_unverified` / `assignment_incomplete` として完成数・Conflict数・未計測状態を併記し、全体最適解と混同しない。
「最短性の証明」（`proven_minimum`）と「探索で発見した最良実行可能解」（`best_found`）を区別する。

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

- **決定性**: 同じPlannerInput・同じResearch入力・同じEngine versionから、同じReachTable、同じnode列、同じincumbent、同じmaterialization request列、
  同じEntry ID、同じPlanner結果（semantic）が出る。Clock・乱数・enumeration ordinalを意味に入れない（Entryの `createdAt` は固定Clock）
- **cancel**: 既存Research seam（`shouldCancel()` / `yieldControl()`）を、Phase Aの位置走査（stream × 位置のloop）、Phase Bのnode、Phase Dの
  Search（Search内部の既存checkpoint）、Phase D'のscheduler（既存64 action毎のyield）で確認する。synchronousなTrace Replay / execution projection中の
  即時cancelは保証しない（Phase 2-Bの観測どおり）
- **中断・再開**（Phase E）: solver stateはplain data（割当stack、incumbent、node数、run内除外集合）なので保存・再開できる。再開は同じ入力hashのときだけ許し、
  再開後のnode列は中断しなかった場合と一致する
- **incomplete**: node budget到達は `assignment_incomplete`、walls / heapは `unmeasured`、window不足は `no_assignment_within_window`。
  いずれも「実行可能解が存在しない」とは書かない。per-Target診断（option数、dead endになった部分割当の最小位置、被覆不成立の位置）を併記する

## 13. Test / acceptance

### 13.1 synthetic fixture（oracle非依存）

Production RNGを使わないFake Engine / 小規模fixtureで意味論を固定する（既存の決定的Planner fixture `createDeterministicPlannerDependencies()` /
`src/test/fixtures/plannerSchedulerWorkloads.ts` と同じ系統）。

| 対象 | test |
| --- | --- |
| Phase A | 2〜3 Target・小window（例: Skill 6 / Gogma 6 / Normal 3）で、ReachTableの各位置集合が総当たり再生と一致。unsupported予測でoption不在。保護武器はIdeal現在性能だけ。関心layoutがIdeal multisetの順列に限られる。`collectLowerBoundProblem()` の閾値がReachTableから再導出できる |
| Phase B | 総当たりで最小目的関数が分かる小入力に対し、solverが同じ目的関数のincumbentを返す。C1 / C2違反の割当を返さない。同じ資源を要求する2 Targetで一方へ `reset` option、他方へ `keep_from_source` が割り当たる（火 / 龍型）。node budget到達で `assignment_incomplete` とincumbent。決定性（2回実行で同一node列） |
| Phase B（下界） | root下界 ≤ 総当たり最小。cross satisfactionペアを持つ入力で `not_applicable` と `best_found`。`LB(partial)` が総当たりの残り最小を上回らない |
| Phase C | Skill被覆不成立の入力（全Targetが巨戟化Routeで、originのSkillを誰も使わない）を検出し、coverage-driven value orderingで `c = origin` 型optionを選ぶ。Gogma / Normal被覆が常に成立。chain付きRoute形の再生がrequired-only再生と同一の最終武器 |
| Phase D | mold reservationで `visitPlannerAlternativeCandidates()` が `ownPositions` だけに操作を置くRouteを返し、`createPlannerRouteUnitPlans()` のrequired位置がoptionと一致。held prefix canonical表現。射影起点Candidate Searchとmoldが同じ形で同じ最終武器を返す。不一致Candidateはcapまで次へ |
| Phase D' | fixtureで `createProductionPlanWithObserver()` がcompleted / Conflict 0 / Replay validを返し、`summarizePlanPhysical()` の合計がassignment objectiveと一致。被覆pre-checkが不成立の集合をPlannerへ渡すとstall dropになること（pre-checkの妥当性） |
| isolation | §11.3 |

### 13.2 統合acceptance（実Export、formal measurement）

Phase D'のformal runで次を事前登録する（値はPhase Dの事前登録で確定）。

1. `verified`: 43 / 43、Conflict 0、rejected 0、completed、Trace Replay valid、別processのfresh ordinary Plannerでも同じ
2. 物理操作数をincumbent 8,534（Phase 1-E / 2-A / P0R）とpost-hocに比較する。8,534以下で初めて「改善」と呼ぶ
3. 1,657（Phase 2-A.5）との比較はpost-hoc analyzerだけが行う。一致しなくても失敗ではない（`best_found`）。下限と一致すれば `proven_minimum`
4. formal validity: measurement HEADがclean、Export SHA-256一致、Production changed files = `[]`、oracle未読（§11.3）、事前登録条件の不変

## 14. 実装Phase分割

Phase A → B → C → D → Eの順に依存する。1 Phase = 1 PR（必要なら事前登録docs PRと実装 / 計測PRに分ける。D1〜D2系列と同じ運用）。

| Phase | 変更範囲 | 入力 | 出力 | acceptance | テスト | 次Phaseへの依存 | Production影響 | formal measurement |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **A 到達option生成** | `src/benchmarks/globalAssignment/reachTable.ts`（提案）、test、走査helperの下限moduleとの共有（下限moduleの契約不変） | PlannerInput、Engine、window | `ReachTable`、`enumerateOptions()`、`replayOptionRequiredOnly()`、走査summary（予測回数、window到達） | synthetic一致、下限閾値の再導出、unsupported / 保護 / 未確定Counterのfail closed、oracle isolation | §13.1 Phase A | Bの入力 | なし | 不要（実Exportの走査時間・予測回数はPhase Bのrunで診断として記録） |
| **B 資源割当** | `globalAssignment/assignmentSolver.ts`、`lowerBound` 接続、runner（assignment-only mode） | ReachTable、node budget | `Assignment`（incumbent）、root下界、node列診断、`no_assignment_within_window` / `assignment_incomplete` | synthetic最小一致、C1 / C2、決定性、budget到達、下界の安全性 | §13.1 Phase B | Cの入力 | なし | **要**（実Exportでassignment-only run: objective、root下界、node数、時間。43 / 43 PlanはまだB単独では主張しない） |
| **C Counter被覆とRoute構成** | `globalAssignment/coverage.ts`、solverへのcoverage check接続 | Assignment | `StreamCoverage`、`RouteShape[]`、不成立位置 | synthetic被覆、coverage-driven ordering、chain再生一致 | §13.1 Phase C | Dの入力 | なし | 不要（Bのrunへ被覆診断を追加） |
| **D Materialization / Planner検証** | `globalAssignment/materialize.ts`、`verify.ts`、runner（full mode）、analyzer（post-hoc oracle比較） | RouteShape[]、Engine、Planner-start origin | `MaterializedTarget[]`、`GlobalAssignmentResult`、RESULT JSON | 実Exportで `verified`（§13.2）。不成立なら理由別status | §13.1 Phase D / D'、isolation | Eの基準 | なし | **要**（事前登録: delivery cap、Search規模gate、Research maxPlanSteps、envelope） |
| **E 最適化・性能** | incremental coverage pruning、decidedなdiscrepancy探索、中断再開、メモリ内訳、Browser Worker測定 | Dのincumbent | 改善したincumbent、性能記録 | 全Target完成を維持したまま物理操作数・時間・メモリを改善。退行は不受理 | 既存acceptanceの維持、Browser isolation | — | なし（Production化は§16の別PR） | **要** |

最初の実装Phase（A）は、小さなsynthetic fixtureだけで意味論を検証できる。実Exportの43 TargetはPhase B（assignment-only）で初めて使い、
43 / 43 Planの統合acceptanceはPhase Dで行う。

## 15. 未決事項・リスク・採用しなかった案

### 15.1 実装前に解決が必要なもの（docs PRまたは各Phaseの事前登録）

| 項目 | 内容 | 解決場所 |
| --- | --- | --- |
| window ladderのrungと上限 | W0 = 350 / 500 / 1500は定まるが、W1以降と上限、広げる条件の運用（Target個別か全体か。本書は全体） | Phase A事前登録 |
| node budget | 根拠となる計測が無い。Phase Bの非formal smokeで決める | Phase B事前登録 |
| delivery cap / Search規模gate | §9.6。D2-G-Aのモデル値をgateの根拠にするか | Phase D事前登録 |
| checkpoint selectionを持つEntry | 本設計はpinを置かない。元Entryに選択があるTargetは `unsupported_input`（`checkpoint_selection`）でfail closedする（PLANNER_SPEC 9.5.2と同じ扱い）。対象Exportでは0件 | 本書で決定（上記） |
| Normal Counter未確定 | blind variantをoptionにしない。`unconfirmed_counter` でfail closed | 本書で決定 |
| cross satisfaction可能ペア | distinct sourceで実行可能解を探し、最小性を主張しない（§10.2）。1本の武器で2 Target完成を割当に含める拡張は行わない | 本書で決定 |
| 複数Target同一武器のゼロ操作option | 保護・未保護を問わずIdeal現在性能のowned gogmaは、cross satisfactionペアで2 Targetが同じ武器を要求し得る。C1でどちらか1つに割り当てる（他方は別option）。Planner側はcross satisfactionで両方完成させ得るので、objectiveは上界になる | 本書で決定（最小性不主張と整合） |

### 15.2 後続実験で判断できるもの

- covererの選択規則（nearest-successor vs 最大終端Targetの単一chain）の、Search規模・Route operation数への影響
- mold方式と射影起点Candidate Search方式の時間差
- `LB(partial)` の強化（例: 残りTargetの二部マッチング可否をnodeごとに判定）の費用対効果
- incremental coverage pruning（完全割当を待たず、Skill origin側の被覆不成立を部分割当で検出）
- 決定的なdiscrepancy探索（LDS）の採否
- Phase D'の長いPlanにおけるTrace Replay / execution projectionのメモリ（Phase 2-Bの観測: projectionはStep数に比例）
- Browser Worker / スマートフォンでの実行可能性（Node測定をProduction runtimeの根拠にしない）

### 15.3 リスク

| リスク | 影響 | 緩和 |
| --- | --- | --- |
| Phase AのwindowにIdeal位置が無いTarget | `no_assignment_within_window` | ladderで広げる。「存在しない」とは記録しない |
| Phase Bの探索空間（1 Targetあたりoption数 × 43） | node budget到達 | MRV、branch-and-bound、lazy enumeration、coverage-driven ordering。incumbentは常に保持 |
| mold Searchの規模（長いchain） | 時間 / OOM | §9.6 gate、§9.2の射影起点Candidate Searchへの振替 |
| 被覆pre-checkが通ってもPlannerが落とす | `planner_rejected` | run内除外と再探索。原因をrejection reason別に記録し、新しい共有規則を作って回避しない |
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
| Research上の仮割当 | §6のAssignment | Research RESULTにだけ記録する。Build List / Plan / Export / Dexieへ書かない |
| provisional / speculative reservation | §9.1のmold | Search入力として一時的に使うだけ。永続化・記録しない（G1） |
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
