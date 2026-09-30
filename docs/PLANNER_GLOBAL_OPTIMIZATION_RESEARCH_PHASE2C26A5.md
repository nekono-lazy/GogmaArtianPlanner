# Global Planner Research Phase 2-C2.6-A5（Bonus Ideal filter internal runtime localization）

Refs #154。Research only。Productionコード、`docs/SEARCH_SPEC.md`、Production semantics、defaults、schema / version、Persistence、UIは
変更していない。Search instrumentationはA4の `onSearchRuntime`（section境界observer）だけで、CPU profilerはResearch childの外部観測である。
optimization（rank lookup構造の変更、Ideal側rank assertionのhoist、`areRestorationBonusSetsEqual` / `bonusKey` / Map allocationの変更、
filterのmanual loop化、prepared Ideal key等）は一切行っていない。

## 1. 結論: `bonus_ideal_filter` 内部のどこへCPU sampleが集まったか

**Production-like（jit_default）条件で、`bonus_ideal_filter` interval内のCPU sampleの73〜77%が multiset equality
（`areRestorationBonusSetsEqual()` → `countBonuses()` → `bonusKey()`）に集まった。** rank reference validationは約3%、GCは2〜3%、
`satisfiesIdealBonuses()` 自身（inline分を含む）は約1.3%、filter call site（filter callback / `settle` をleafとするsample）は16〜19%、
その他は1%未満だった。

A4のprimary 3 orientation（A4 RESULTのselectionから導出: c6-p1、c13-p1、c14-p0）を、A4と同条件（jit_default、8 GB、concurrency 1、
30分、A4のsection境界observerのみ）で、V8 sampling CPU profiler（`node:inspector` `Profiler`、要求間隔10,000 µs）を加えて各1回実行した。
profile windowはSearch開始後120〜720秒（600秒）。3件ともtimeout（Search中、30分）、OOM 0、failure 0。

### Primary: jit_default（Production-like、decisionの根拠）

filter interval内sample（`bonus_ideal_filter` section区間に時刻が入るsampleだけ）を分母とする割合。

| orientation | filter interval sample | rank_reference_validation | **multiset_equality** | predicate_self_or_inlined | filter_or_inlined_predicate | gc | other_unresolved | unresolved合計 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| c6-p1 | 17,656 | 3.1% | **76.9%** | 1.3% | 16.2% | 2.0% | 0.5% | 18.0% |
| c13-p1 | 19,461 | 3.1% | **73.1%** | 1.3% | 19.0% | 2.8% | 0.7% | 21.0% |
| c14-p0 | 18,612 | 3.0% | **73.9%** | 1.3% | 19.2% | 1.8% | 0.8% | 21.3% |
| pooled（3件、sample加重） | 55,729 | 3.1% | **74.6%** | 1.3% | 18.2% | 2.2% | 0.7% | 20.2% |

（unresolved合計 = predicate_self_or_inlined + filter_or_inlined_predicate + other_unresolved。）

**事前登録rule（§8）の判定: Case MULTISET（`MULTISET_multiset_equality`）**。3件とも有効（clock整合・interval整合・filter interval sample
≥ 5,000）、unresolved合計は3件とも0.35未満（18.0〜21.3%）でU1ではない。GCは3件とも0.20未満、rank_reference_validationは3件とも0.35未満、
multiset_equalityは3件とも0.35以上。

### Diagnostic: no_inlining（Production-likeではない、decisionに使わない）

A4 evidenceから機械的に選んだ代表1件（c14-p0）を `--no-turbo-inlining --no-maglev-inlining` で同じwindowだけprofileした補助資料。
**以下の割合はProduction-likeの割合ではなく、Primary表と平均・合算しない。**

| orientation | filter interval sample | rank_reference_validation | multiset_equality | predicate_self_or_inlined | filter_or_inlined_predicate | gc | other_unresolved |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| c14-p0（no_inlining） | 21,032 | 19.1% | 74.1% | 1.8% | 2.2% | 2.3% | 0.6% |

inlineを止めると `requireById` / `getBonusRank` / `Array.prototype.find` callback等のrank validation frameが名前付きで現れ（19.1%）、
filter call site側（jit_defaultで16〜19%）は2.2%まで縮む。multiset equalityは両条件とも約74%だった。

## 2. A4との関係

A4はSearch wallの26.1〜29.4%が `bonus_ideal_filter` section全体（raw solution全件の `Array.prototype.filter()` と、各solutionでの
`satisfiesIdealBonuses()` 評価）であることを直接計時した。A4の約1.5 µs / raw solutionはsection全体の時間であり、関数単体の時間ではない。
A5はそのsection境界をそのまま使い、区間内のCPU sampleがどこへ集まったかを見た。

A5ではCPU profilerとinterval stampが加わるため、A4とのabsolute wall time・30分進行量は比較しない（両者ともtimeout・Candidate 0・
OOM 0は記述的に一致）。参考として、A5 profile内でfilter interval sampleが全sampleに占める割合は30.7〜33.8%で、同じwindow内の
filter interval時間 / profile時間（30.8〜33.8%）とほぼ一致した（sample比は時間比の推定として整合）。

## 3. authorityと位置付け

- selection authority: `docs/PLANNER_GLOBAL_PHASE2C26A4_RESULT.json`（formal、Case O、category `bonus_ideal_filter`、3 primary、timeout 3、
  各primaryのcoverage ≥ 0.90かつ `bonus_ideal_filter` share ≥ 0.10）。source中にorientation IDは固定していない
- SHA chain: runnerとanalyzerがC2.6-A / A2 / A3 / A4 RESULTとExportの実fileを読み、SHA-256を記録。A4 RESULTが記録したC2.6-A / A2 / A3の
  SHA（provenance、`authorityShaChain`、sources）が実fileと一致することをfail-closedで検証

| file | SHA-256 |
| --- | --- |
| C2.6-A RESULT | `dab2f27a1ca94e5db38279e3848f76d033710c38d6e838da227e36e78c67b171` |
| C2.6-A2 RESULT | `4bde9a5bcd84cc5e29d5dcf666f9eafb6bbb64d5f49aace1b15f36cf913fadc2` |
| C2.6-A3 RESULT | `b5562342585899163c8d554bbc25ef6654bab12479ec403cf5d474f799beb3a2` |
| C2.6-A4 RESULT | `15e415990fc48a77f2f890a52dd74e13f1ac349622cd266fc6cfe69b87e9d529` |
| Export | `cc35fb5bd85acb417b2ce0229cd79441b48c642ac8af70bbc2dfdfc8c89e1e6b` |

- formal measured HEAD / analysis HEAD: `a2e3c3ed489c0ff9bceabb2b66ff813ae8068906`（計測後の計算code変更なし、profile / script table
  のSHA不一致なし、`formal = true`）
- baseline parity（54 orientation、ordered ID、identity、metadata）、condition parity（A4条件 + A4自身のA3 / C2.6-A / A2 parity）、
  selection parity（missing / duplicate / foreign / non-primary / metadata mismatchなし）はすべてvalid

## 4. 変更境界

Productionコード変更は0件、`docs/SEARCH_SPEC.md` 変更なし。追加したのはResearch fileのみ:

- `src/benchmarks/plannerGlobalPhase2C26A5.ts`: A4 RESULT parser、条件parity、diagnostic代表の導出、filter interval tracker
  （A4の `onSearchRuntime` をwrap）、profile window controller
- `src/benchmarks/plannerGlobalPhase2C26A5Analysis.ts`: CPU profile検証、sample時刻再構成、clock整合検証、stack分類、decision rule、
  formal series検証
- `scripts/run-planner-global-phase2c26a5.mjs` / `scripts/analyze-planner-global-phase2c26a5.mjs`
- `src/benchmarks/plannerGlobalPhase2C26A5.test.ts`

filter interval trackerは、start stampをA4 trackerの処理（durable section開始記録を含む）の**後**、end stampをA4の処理の**前**に取るため、
区間はfilter呼び出しとSearch側のobserver呼び出しだけを含む。raw solution単位のtimer・event・IPCは入れていない（1区間1 record）。
wrapしたobserverがSearchのCandidate列・summary・prediction回数を変えないこと、区間数がfilter section完了数と一致することをtestで確認した。

## 5. 条件

A4と同一: Export、heap 8,192 MB、concurrency 1、30分budget、retryなし、`setImmediate` yield、extent Normal 4 / Gogma 235 / Skill 4、
bounds `maxCandidateTrialsPerTarget = 2` / `maxPlannerReruns = 8`、Research `maxPlanSteps = 20,000`、同一CalculationContext、
lineage empty、Search instrumentationは `onSearchRuntime` のみ（`onGogmaReservedRuntime` / `onGogmaReservedDepth` /
`onSkillReservedDepth` / `onWorkSettled` はfalse）。primaryのNode flagsは `--max-old-space-size=8192` のみ。

A5固有のprofiler条件（formal run前に固定）:

| 項目 | 値 |
| --- | --- |
| 方式 | `node:inspector` Session（main thread）。module読込中だけ `Debugger.enable`（`scriptParsed` でurlとinline source mapを収集）、kernel実行前に `Debugger.disable`。`Profiler.enable` / `setSamplingInterval` / `start` / `stop` |
| requested sampling interval | 10,000 µs（観測中央値 10,439〜10,507 µs） |
| window | Search開始（kernel最初の `search_runtime` section開始）後 120秒 warmup → 600秒 profile |
| 開始 / 停止 | timer callback（Searchのevent loop yield時に実行）から。実際の遅れを記録 |
| diagnostic | 代表1件、`--no-turbo-inlining --no-maglev-inlining --max-old-space-size=8192`、同じwindow、profile書き出し後に自停止 |

profiler probe（formal run前、同じNode v24.19.0 / V8 13.6.233.17）: `Profiler.enable` / `setSamplingInterval` / `start` / `stop` すべて受理、
profileに `nodes` / `samples` / `timeDeltas` / `startTime` / `endTime` あり（147 sample、中央値10,495 µs）、clock整合valid、必須5 file
（`targetEvaluator.ts`、`bonusConditionEvaluator.ts`、`masterSelectors.ts`、`domainRules.ts`、`targetSearchScheduler.ts`）すべてsource map
あり、probe frameが `satisfiesIdealBonuses` の宣言行（25行目）へ解決。silent fallbackはない（失敗時はformal runしない設計）。

実際のprofile window:

| child | 開始（Search開始後） | 停止 | 実profile長 | 開始遅れ | 停止遅れ | profile全sample |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| c6-p1（jit_default） | 120.16 s | 722.13 s | 601.97 s | 0.16 s | 2.13 s | 57,488 |
| c13-p1（jit_default） | 122.26 s | 721.14 s | 598.87 s | 2.26 s | 1.14 s | 57,533 |
| c14-p0（jit_default） | 121.32 s | 721.60 s | 600.28 s | 1.32 s | 1.60 s | 57,338 |
| c14-p0（no_inlining） | 121.00 s | 720.00 s | 599.00 s | 1.00 s | −0.97 ms | 57,205 |

（no_inliningの停止遅れ −0.97 msはNodeのtimerが要求時刻よりわずかに早く発火したもの。profile停止後もprimaryのSearchは30分budgetまで続行。）

## 6. selection

- primary: A4 RESULTの `selectionValidation.expected`（= `selectionRule.primaryOrientationIds` = A3 selection）。c6-p1、c13-p1、c14-p0
- diagnostic代表: A4 primaryを `bonus_ideal_filter` share昇順（同値はA4 selection順）に並べた中央。c6-p1 26.1% < c14-p0 28.0% <
  c13-p1 29.4% → **c14-p0**（IDはsourceに固定せずA4 evidenceから導出）

## 7. 計測方法

### 7.1 sample時刻とclock整合

V8 CPU profileの時刻（`startTime` + 累積 `timeDeltas`、µs）は `process.hrtime` と同じmonotonic clockである。childは `Profiler.start` /
`Profiler.stop` の前後で `performance.now()` と `hrtime` の組を読み（計4組）、以下をすべて満たすときだけsampleをResearch clockへ写した:

- 4組のoffset（hrtime − performance.now）のばらつき ≤ 1 ms（実測 0.015〜0.018 ms）
- 各組の精度 ≤ 1 ms（実測 ≤ 0.04 ms）
- profileの `startTime` が `Profiler.start` のhrtime bracket内、`endTime` が `Profiler.stop` のbracket内（許容1 ms）
- 全sampleが [startTime, endTime] 内

4 profileともvalid（負の `timeDeltas` 0件、`timeDeltas` 合計とprofile長の差 < 0.3 ms）。

### 7.2 population

filter intervalの [start, end) に写像後の時刻が入るsampleだけを内部分析の母集団とした。filter外sampleはどの分母にも入れていない。
filter interval数（profile window内）: c6-p1 203、c13-p1 91、c14-p0 175。interval境界 ±toleranceのsample（filter内外の合計）は28〜72件
（各filter interval sample数の0.5%未満、記述のみ）。filter interval外で登録関数frameを含むsampleは3件とも0件。

### 7.3 stack分類（事前登録）

filter interval内sampleをstack全体で、次のpriorityで一意に分類した。

1. `gc`: V8の `(garbage collector)` frame
2. `rank_reference_validation`: `assertRestorationBonusRankReferences`（`bonusConditionEvaluator.ts`）、`getBonusRank` / `requireById`
   （`masterSelectors.ts`）
3. `multiset_equality`: `areRestorationBonusSetsEqual` / `countBonuses` / `bonusKey`（`domainRules.ts`）。native `JSON.stringify` / Map操作
   もancestorにこれらがあればここ
4. `predicate_self_or_inlined`: `satisfiesIdealBonuses`（`targetEvaluator.ts`）はあるが上記なし。scope判定単体ではない
5. `filter_or_inlined_predicate`: 上記なし、かつleaf frameが `targetSearchScheduler.ts`（filter callbackまたは `Array.prototype.filter` を
   呼ぶ `settle`）。純粋なfilter overheadではない
6. `other_unresolved`: それ以外（`(program)`、Vite SSR loaderのaccessor、Research harness等）

名前付きframeは(file, 関数名)で、匿名frame（`forEach` / `find` / `every` callback等）はsource map後の関数開始行が、measured HEADの
source textから導出した登録関数のspan内にあるときその関数へ帰属させた（spanは `function <name>` 宣言行から最初のcolumn 0の `}` まで）。

## 8. 事前登録decision rule

primary 3件、majority 2。有効 = clock整合valid・interval整合valid・filter interval sample ≥ 5,000。判定順:

1. U0 `insufficient_samples`: 有効primaryが2件未満
2. U1 `jit_attribution_insufficient`: 有効primary 2件以上でunresolved合計 ≥ 0.35
3. GC: 2件以上で `gc` ≥ 0.20
4. RANK: 2件以上で `rank_reference_validation` ≥ 0.35
5. MULTISET: 2件以上で `multiset_equality` ≥ 0.35
6. MIXED: それ以外

diagnostic（no_inlining）はdecisionに入れない。結果: 有効3件、U1 0件、GC 0件、RANK 0件、MULTISET 3件 → **Case MULTISET**。

## 9. 詳細（記述統計）

### 9.1 jit_default: leaf frame別（filter interval sampleに対する割合）

| leaf frame | category | c6-p1 | c13-p1 | c14-p0 |
| --- | --- | ---: | ---: | ---: |
| `countBonuses` の `forEach` callback（`domainRules.ts` 13行目） | multiset | 40.1% | 29.3% | 30.3% |
| `bonusKey`（`domainRules.ts` 7行目） | multiset | 35.8% | 42.4% | 42.3% |
| filter callback（`targetSearchScheduler.ts` 433行目） | filter_or_inlined | 13.1% | 15.9% | 15.9% |
| `settle`（`targetSearchScheduler.ts` 410行目） | filter_or_inlined | 3.1% | 3.1% | 3.3% |
| `assertRestorationBonusRankReferences` の `forEach` callback（`bonusConditionEvaluator.ts` 11行目） | rank | 2.9% | 2.9% | 2.8% |
| `(garbage collector)` | gc | 2.0% | 2.8% | 1.8% |
| `satisfiesIdealBonuses`（`targetEvaluator.ts` 25行目） | predicate | 1.3% | 1.3% | 1.3% |
| `countBonuses` 本体 | multiset | 0.7% | 1.0% | 1.0% |
| Vite SSR import accessor（`module-runner.js` `get`） | other | 0.3% | 0.5% | 0.5% |

`JSON.stringify` / Map操作はnative frameとして独立には現れず、呼び出し元のleaf（`bonusKey`、`forEach` callback）に帰属していた。
登録関数のinclusive sample: `satisfiesIdealBonuses` 77〜80%、`countBonuses` 73〜77%、`areRestorationBonusSetsEqual` 73〜76%、
`bonusKey` 36〜42%、`assertRestorationBonusRankReferences` 3.0〜3.1%。

leafの内訳（`bonusKey` と `forEach` callbackの配分）はrun間で入れ替わっており（c6-p1とc13-p1 / c14-p0）、どちらが主因かはleafだけでは
決めない。両者とも `countBonuses()` 内であり、multiset equalityとしての合計は3件で安定している。

### 9.2 leaf kind（filter interval sample）

Repository frame 96.3〜97.3%、GC 1.8〜2.8%、Vite SSR loader accessor（`vite_module_runner` + `vite_ssr_unmapped`）0.5〜0.8%、
`(program)` 0.1〜0.2%。Vite SSR accessorはSSR loader由来でProduction bundleには無い。

### 9.3 Search outcome

3件ともtimeout、kill時のactive sectionは `bonus_depth_read`（Search中）、Candidate delivered 0、trial 0、full Planner run 0、
boundary contract violation 0、profile停止時にopenなfilter section 0。prediction回数（最後のheartbeat）: c6-p1 Reset 254 / Keep 29,242、
c13-p1 Reset 253 / Keep 28,218、c14-p0 Reset 245 / Keep 27,411（A4とは計測負荷が異なるため進行量は比較しない）。

## 10. 言えること / まだ言えないこと

### formalに言えること

- Production-like（jit_default）条件で、`bonus_ideal_filter` interval内のCPU sampleの73〜77%（pooled 74.6%）がmultiset equality
  （`areRestorationBonusSetsEqual()` → `countBonuses()` → `bonusKey()`）のstack上にあった。3件とも同じ傾向
- rank reference validationに名前付きで帰属したsampleは約3%、GCは2〜3%、`satisfiesIdealBonuses()` 自身は約1.3%
- 事前登録ruleはCase MULTISET。multiset equalityが次のoptimization設計候補
- filter interval外で登録関数（predicate / rank / multiset）を含むsampleは0件。filter区間の境界は内部分析の母集団として整合していた

### まだ言えないこと

- `bonusKey()` 内の `JSON.stringify`、`countBonuses()` の `Map` get / set、Map allocationのどれが主因か（native処理が呼び出し元leafに
  畳まれており、CPU profileでは分離できない）
- jit_defaultの `filter_or_inlined_predicate`（16〜19%）の中身。filter builtin loop、callback、callbackへinlineされたpredicate / rank
  validationを区別できない。no_inliningでは同区分が2.2%に縮みrank validationが19.1%になったが、これはinlineを止めたdiagnosticであり、
  Production-likeでrank validationが19%という意味ではない
- Ideal側（`target.idealBonuses`）とfinal側（`solution.bonuses`）のrank validationの内訳（同じ関数への2回の呼び出しで、CPU profileの
  leaf line modeでは呼び出し元の行で分けられない）。同様にmultiset equalityでも、Ideal側 `countBonuses()` とfinal側の内訳は言えない
- GCを起こしたallocationがどこか（GCは2〜3%で小さく、今回の判定には効いていない）
- window外（Search開始120秒未満、720秒以降）、他orientation、Browser Worker、他deviceでの構成
- optimizationによる効果量（未実施）

## 11. 次Phase recommendation

Case MULTISET: **multiset equalityのoptimization設計**（本Phaseでは実装しない）。検討候補（比較のみ、未決定）:

- Target側のIdeal multiset表現を事前計算する（`target.idealBonuses` の `countBonuses()` を各solutionで繰り返さない）
- 5 slot同士のallocation-free multiset比較（string key生成とMap作成を避ける）

設計時に維持する契約:

- unordered multiset・重複数を保持した等価性（ordered slot比較と混同しない。slot順は `referencedOwnedWeaponsHash` / Keepの意味であり、
  Ideal判定の意味ではない）
- unknown BonusRank参照はDomain Error、rank reference validationはscope判定より先、normal scopeでもinvalid rankはthrow
  （`satisfiesIdealBonuses()` のerror timing）
- `gogma_artian` scopeのみIdeal

filter call site側（jit_defaultで16〜19%）とrank validationは今回の判定対象ではないが、multiset最適化後に構成が変わるため、
最適化後の再profileで改めて確認する。

## 12. limitations

- Node child（Vite SSR loader）のみ。Browser Worker・他device・他heap条件は測っていない
- CPU profilerとinterval stampが加わるため、A4とのabsolute wall time・進行量は比較しない。比較はA5 profile内のsample shareだけ
- 各orientation 1回、profile windowは1区間（600秒）。run間ばらつき・window外は測っていない
- sampling profilerの統計的推定（10 ms間隔）。個々のsolution評価時間の直接計測ではない
- V8はJIT inline frameを復元するが、復元されないinline・stack walkの欠落はあり得る（outer frameのない短いstackも登録frameがあれば
  その分類）
- `filter_or_inlined_predicate` はfilter call siteをleafとするsampleで、純粋な `Array.prototype.filter` overheadではない
- Vite SSR loaderのaccessor（import getter / module preambleのexport getter）はProduction bundleには無い。leaf kindとして別記した
- no_inlining diagnosticは関数単位attributionの補助で、Production-like割合ではない
- filter interval境界はResearch側の `performance.now()` stamp。区間はfilter呼び出しとSearch側observer呼び出しを含む

## 13. 検証

- `npm run lint`、`npx tsc -b --force`、`npm test`、`npm run build`、`git diff --check`（formal前と最終commit前）
- raw artifact（`PLANNER_GLOBAL_PHASE2C26A5_RAW.json.local`、`PLANNER_GLOBAL_PHASE2C26A5_RUN.local/`、
  `PLANNER_GLOBAL_PHASE2C26A5_PROFILES.local/` の `*.cpuprofile` / `*.scripts.json` / `*.capture.json`）はcommitしていない
- committed evidence: `docs/PLANNER_GLOBAL_PHASE2C26A5_RESULT.json`
