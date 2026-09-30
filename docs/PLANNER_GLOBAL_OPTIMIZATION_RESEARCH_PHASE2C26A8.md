# Global Planner Research Phase 2-C2.6-A8（frontier_reduction_sort内部CPU hotspotの正式局所化）

Refs #154。**Research only。Production計算変更は0件**（A7 measured HEAD `b1319d0` 以降、`src` のProduction calculation sourceは
一切変わっていない。runnerとanalyzerの両方でfail-closedに確認）。`src/domain/search/bonusStream.ts`（frontier reduction algorithm、
frontier key、Map、`compareReservedRepresentative()`、`compareReservedFrontier()`、sort、state generation）、`stableStringify()`、
`compareStableKeys()`、Candidate semantics、Search ordering、extent、bounds、Planner、RNG、schema / version、Persistence、UIは変更して
いない。新しいProduction observer seamも追加していない（A7の既存2 observerをそのまま使い、CPU profilerは子プロセスの外部観測）。
optimization（stableStringify cache、bonus semantic key cache、Map key表現変更、sort削除、representative rule変更等）は一切行っていない。

## 1. 結論: `frontier_reduction_sort` 内部のどこへCPU sampleが集まったか

**Production-like（jit_default）条件で、有効primary 2件（c6-p1、c14-p0）の `frontier_reduction_sort` interval内CPU sampleの
66〜68%（pooled 66.8%）が、`compareReservedRepresentative()` から呼ばれたstable serialization（`stableStringify()` →
`serializeStable()` とその `map` callback）に集まった。** reduction loop / key / Map / inline部分（`reduction_loop_or_inlined`）は
17〜20%、representative比較のserialization以外は約5%、GCは約6%、`compareReservedFrontier` によるfrontier sortは0.3%だった。

A7のprimary 3 orientation（A7 RESULTのselectionから導出: c6-p1、c13-p1、c14-p0）を、A7と同条件（jit_default、8 GB、concurrency 1、
30分、A7の2 section observer）でV8 sampling CPU profiler（`node:inspector` `Profiler`、要求間隔10,000 µs）を加えて各1回実行した
（retryなし）。profile windowはSearch開始後120〜720秒（600秒）。3件ともtimeout（Search中、30分）、OOM 0、process failure 0。

**c13-p1のCPU profileにはnegative `timeDelta` が1件含まれていたため、事前登録rule（§8）どおりprofile全体をinvalidとし、
decision inputから除外した。** 有効primaryは2件（c6-p1、c14-p0）で、事前登録のmajority 2を満たす。

### Primary: jit_default（Production-like）

`frontier_reduction_sort` interval内sample（A3 held-aware streamから再構成した区間に時刻が入るsampleだけ）を分母とする割合。

| orientation | negative timeDelta | profile quality | frontier interval sample | **representative_stable_serialization** | representative_compare_or_inlined | frontier_sort | reduction_loop_or_inlined | gc | other_frontier |
| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| c6-p1 | 0 | **valid** | 29,200 | **65.9%** | 4.7% | 0.3% | 16.7% | 5.4% | 7.0% |
| c13-p1 | **1** | **invalid**（decision外） | （24,865） | （66.0%） | （4.9%） | （0.3%） | （19.5%） | （8.3%） | （1.0%） |
| c14-p0 | 0 | **valid** | 27,441 | **67.7%** | 4.6% | 0.3% | 20.3% | 5.8% | 1.2% |
| pooled（有効2件、sample加重） | | | 56,641 | **66.8%** | 4.7% | 0.3% | 18.4% | 5.6% | 4.2% |

（c13-p1の括弧内はinvalid profileの記述値で、decisionにもpooledにも入れていない。invalid理由: `CPU profile contains negative timeDeltas: 1`。）

**事前登録rule（§8）の判定: Case S（`S_stable_serialization_dominant`）**。有効2件（c6-p1、c14-p0）とも `representative_stable_serialization`
が唯一の最大categoryかつ ≥ 0.25（0.659 / 0.677）で、majority 2を満たした。

### Diagnostic: no_inlining（Production-likeではない、decisionに使わない）

A7 evidenceから機械的に選んだ代表1件（c6-p1）を `--no-turbo-inlining --no-maglev-inlining` で同じwindowだけprofileした補助資料。
**以下の割合はProduction-likeの割合ではなく、Primary表と平均・合算しない。** negative `timeDelta` は0件。

| orientation | frontier interval sample | stable_serialization | representative_compare | frontier_sort | reduction_loop | gc | other |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| c6-p1（no_inlining） | 25,679 | 70.8% | 6.3% | 0.3% | 16.3% | 5.9% | 0.4% |

inlineを止めても構成はjit_defaultと大きく変わらず、Production-likeで関数境界がinlineにより大きく失われている兆候はなかった（参考値）。

## 2. A7との関係

A7はouter `bonus_depth_read` と `readReservedDepth()` 内部6 sectionを同一run・同一clockで直接計時し、`frontier_reduction_sort` が
3件とも最大inner section（`bonus_depth_read` の53〜59%、Search wallの48〜54%）であることを示した（Case F）。A7はsection全体の
時間であり、内部のどの処理かは測っていない。A8はそのsection境界（A3 held-aware stream）をそのまま使い、区間内のCPU sampleが
どこへ集まったかを見た。

A8ではCPU profilerが加わるため、A7とのabsolute wall time・30分進行量は比較しない（両者ともtimeout・Candidate 0・OOM 0は記述的に一致）。
参考として、有効profile内でfrontier interval sampleが全sampleに占める割合は47.4〜50.6%で、同じwindow内のfrontier interval時間 /
profile時間（47.7〜50.9%）とほぼ一致した（sample比は時間比の推定として整合）。

## 3. authorityと位置付け

- selection / hotspot authority: `docs/PLANNER_GLOBAL_PHASE2C26A7_RESULT.json`（formal、Case F、section `frontier_reduction_sort`、
  3 primary、timeout 3、OOM 0、process failure 0、semantic failure 0、contract violation 0、3件ともdominant section
  `frontier_reduction_sort` かつ innerCoverageOfBonusDepthRead ≥ 0.90）。`parsePhase2C26A7ResultAuthority()` でfail-closedに検証。
  source中にorientation IDは固定していない
- SHA chain: runnerとanalyzerがC2.6-A〜A7 RESULTとExportの実fileを読み、A7が記録したC2.6-A〜A6のSHA（provenance、runner記録、
  `authorityShaChain` のA6 → A5 → A4の入れ子chain、sources、A6 raw SHA）が実fileと一致することを検証

| file | SHA-256 |
| --- | --- |
| C2.6-A RESULT | `dab2f27a1ca94e5db38279e3848f76d033710c38d6e838da227e36e78c67b171` |
| C2.6-A2 RESULT | `4bde9a5bcd84cc5e29d5dcf666f9eafb6bbb64d5f49aace1b15f36cf913fadc2` |
| C2.6-A3 RESULT | `b5562342585899163c8d554bbc25ef6654bab12479ec403cf5d474f799beb3a2` |
| C2.6-A4 RESULT | `15e415990fc48a77f2f890a52dd74e13f1ac349622cd266fc6cfe69b87e9d529` |
| C2.6-A5 RESULT | `9d025a20cad23955adcb19fdee92d7c2e70eeb4b2429e875ddf5fb7bbdcd84c3` |
| C2.6-A6 RESULT | `a1b38a99ab08a99f536cdc675b75705e512622a27a555de38929839ddd81bf96` |
| **C2.6-A7 RESULT** | `4c4fddc0b2a769364e9674cad7b6e331566a4a2ba697c27d1a3492f539511922` |
| A7 formal raw（commitしない） | `1aac5a87da532bf2dcaa7a65f351825bb2efdf2dc1a131224112b94aaa87fd48`（A7 RESULTの `sources.run` と一致） |
| Export（commitしない） | `cc35fb5bd85acb417b2ce0229cd79441b48c642ac8af70bbc2dfdfc8c89e1e6b` |
| A8 raw（commitしない） | `b5154ff18c88e06687ed016ed2ee9713d4f7878857d0ee609bf8890bd8d4b393` |
| profile c6-p1 / c13-p1 / c14-p0 / diagnostic c6-p1（commitしない） | `e2e56964…` / `b6273edb…` / `2bafe6d5…` / `79b7f37e…`（全SHAはRESULTのraw capture記録と一致） |

- **formal measured HEAD / analysis HEAD: `32c582cdebc354f7dbeecaf6caedd6c4d02eaec4`**（negative `timeDelta` のfail-closed rule・decision rule・
  testをformal run前にcommit。計測後のcalculation / measurement / classification / decision rule変更なし、profile / script tableの
  SHA不一致なし、`formal = true`、formal series failure 0）
- baseline parity（54 orientation、ordered ID、identity、metadata）、condition parity（A7条件 + A7自身のA6 / A5 / A4 / A3 / C2.6-A / A2
  parity chain）、selection parity（missing / duplicate / foreign / non-primary / metadata mismatchなし）はすべてvalid

### 3.1 取り下げたformal run（measured HEAD `6623c08`）

最初のformal run（measured HEAD `6623c08`）は、negative `timeDelta` を記録するだけでprofile validityに入れていなかった。PR #186の
レビューで「累積sample時刻が逆行するprofileは、各sampleのinterval所属をformal evidenceとして保証できない」と指摘され、
`negativeDeltas = 0` をprofile quality条件として事前登録し直した（commit `32c582c`）。旧runでも1件のprimary（c14-p0）にnegative
`timeDelta` が1件あった。旧runを新ruleでpost-hocに再解釈することはせず、旧RESULT / 文書は取り下げ、新しいmeasured HEADで同じ
条件のformal runを1回だけ（retryなし）取り直した。本文書と `docs/PLANNER_GLOBAL_PHASE2C26A8_RESULT.json` はこの新runだけに基づく。
旧runの値はどこにも転記していない。

### 3.2 Production変更guard

runner（working tree込み）とanalyzer（gitのcommit間diff）の両方で、A7 measured HEAD（`b1319d0`）→ A8 measured HEADの `src`
変更からResearch（`src/benchmarks/`）・test（`*.test.ts(x)`、`src/test/`）を除いた集合が **空** であることをfail-closedで確認した
（`validatePhase2C26A8NoProductionChange()`、登録値 `PHASE2C26A8_PRODUCTION_CHANGE = []`）。変更pathは
`src/benchmarks/plannerGlobalPhase2C26A7.test.ts`（A7 PRのpost-hoc test修正）とA8のResearch 3 fileのみ。

## 4. 変更境界

| 役割 | ファイル |
| --- | --- |
| A7 authority parse・Production変更guard・条件parity・diagnostic代表導出・Search開始anchor（A7 instrumentationのwrap） | `src/benchmarks/plannerGlobalPhase2C26A8.ts` |
| frontier interval再構成・frame解決・stack分類・profile解析・line ticks・decision rule（negative `timeDelta` fail-closed含む）・semantic parity・formal validator | `src/benchmarks/plannerGlobalPhase2C26A8Analysis.ts` |
| テスト | `src/benchmarks/plannerGlobalPhase2C26A8.test.ts` |
| runner / analyzer | `scripts/run-planner-global-phase2c26a8.mjs` / `scripts/analyze-planner-global-phase2c26a8.mjs` |

kernel childはA7のkernel progress（`createPhase2C26A7KernelProgress()`: A4 lifecycle + A4 Search section observer + A3 held-aware
section observer、durable record、heartbeat）を **変更せずに** 使い、A8の追加は各Targetの `onSearchRuntime` を包んで最初の
`search_runtime` section開始（profile windowのanchor）を1回だけ通知するwrapperだけである（wrapした側が先に全eventを受け取る）。
wrapperありなしでkernel結果が同一であることをtestで確認した。CPU profiler、clock整合、profile window controllerはA5のもの
（`createPhase2C26A5ProfileController()`、`validatePhase2C26A5ClockAlignment()`、script table / source map解決）を再利用し、A5の実装・
RESULTは変更していない。negative `timeDelta` はA5のalignment結果（`negativeDeltas`）をA8側の `phase2c26a8DecisionRow()` で追加検証する。

## 5. 条件

A7と同一: Export、heap 8,192 MB、concurrency 1、30分budget、retryなし、fresh Node child per orientation、`setImmediate` yield、
extent Normal 4 / Gogma 235 / Skill 4、bounds `maxCandidateTrialsPerTarget = 2` / `maxPlannerReruns = 8`、Research `maxPlanSteps = 20,000`、
同一CalculationContext（`unknown-initial` / master 4 / `production-rng:c5-e7` / app schema 17）、lineage empty、Search instrumentationは
`onSearchRuntime` + `onGogmaReservedRuntime`（`onGogmaReservedDepth` / `onSkillReservedDepth` / `onWorkSettled` はfalse）。primaryの
Node flagsは `--max-old-space-size=8192` のみ。**唯一の登録差分はCPU profiler。**

profiler条件（A5と同一、formal run前に固定）:

| 項目 | 値 |
| --- | --- |
| 方式 | `node:inspector` Session（main thread）。module読込中だけ `Debugger.enable`（`scriptParsed` でurlとinline source mapを収集）、kernel実行前に `Debugger.disable`。`Profiler.enable` / `setSamplingInterval` / `start` / `stop` |
| requested sampling interval | 10,000 µs（観測中央値 10,325〜10,470 µs） |
| window | Search開始（kernel最初の `search_runtime` section開始）後 120秒 warmup → 600秒 profile。Searchはその後30分budgetまで継続 |
| 開始 / 停止 | timer callback（Searchのevent loop yield時に実行）から。実際の遅れを記録 |
| diagnostic | 代表1件、`--no-turbo-inlining --no-maglev-inlining --max-old-space-size=8192`、同じwindow、profile書き出し後に自停止 |

profiler probe（formal run前、同じNode v24.19.0 / V8 13.6.233.17）: `Profiler.enable` / `setSamplingInterval` / `start` / `stop` すべて
受理、153 sample（中央値10,273 µs）、clock整合valid、必須3 file（`bonusStream.ts`、`hashing.ts`、`semanticKeys.ts`）すべてsource mapあり、
登録関数spanとfrontier blockがsourceから導出可能、probe frameが `stableStringify`（68行）/ `serializeStable`（22行）の宣言行へ解決。

実際のprofile window:

| child | 開始（Search開始後） | 停止 | 実profile長 | 開始遅れ | 停止遅れ | profile全sample | negative timeDelta | clock offset spread | pair精度max |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| c6-p1（jit_default） | 121.03 s | 720.00 s | 598.97 s | 1.03 s | −0.72 ms | 57,718 | 0 | 0.015 ms | 0.030 ms |
| c13-p1（jit_default） | 120.68 s | 723.80 s | 603.12 s | 0.68 s | 3.80 s | 57,603 | **1** | 0.014 ms | 0.029 ms |
| c14-p0（jit_default） | 120.19 s | 720.28 s | 600.08 s | 0.19 s | 0.28 s | 57,846 | 0 | 0.015 ms | 0.030 ms |
| c6-p1（no_inlining） | 120.83 s | 721.13 s | 600.30 s | 0.83 s | 1.13 s | 57,209 | 0 | 0.016 ms | 0.030 ms |

（負の停止遅れはNodeのtimerが要求時刻よりわずかに早く発火したもの。c13-p1はA5のclock整合条件をすべて満たしたが、negative
`timeDelta` 1件によりA8のprofile qualityでinvalid。profile停止後もprimaryのSearchは30分budgetまで続行。）

## 6. selection

- primary: A7 RESULTの `selectionValidation.expected`（= `selectionRule.primaryOrientationIds` = A6 / A5 / A4 / A3 selection）。
  c6-p1、c13-p1、c14-p0
- diagnostic代表: A7 primaryを `frontier_reduction_sort` の `shareOfBonusDepthRead` 降順（同値はA7 selection順）に並べた先頭。
  c6-p1 58.49% > c14-p0 57.42% > c13-p1 53.09% → **c6-p1**（IDはsourceに固定せずA7 evidenceから導出）

## 7. 計測方法

### 7.1 `frontier_reduction_sort` intervalの再構成

A3 held-aware tracker（A7で使った既存observer）は、section開始時にResearch clockを読んでから `gogma_phase_started` recordを
durable writeし、depth完了時に各sectionの排他wall（`phase_started` → `phase_completed`）を `gogma_depth.phaseMs` に記録する。
A8はこのstreamだけから区間を復元した（新しいstamp・per-state計測は入れていない）:

- 区間 = [origin + `phase_started(frontier_reduction_sort).elapsedMs`, + `phaseMs.frontier_reduction_sort`)（Research clock。originは
  `kernel_invoked.originChildProcessMs`）
- 同じdepthの次の境界（次の `phase_started` = `exhaustion_scan`、またはdepth完了）をupper boundとし、終端がそれを越えればfail closed
- fail closed: seq不連続、未知record / phase、phase順序不正、同一depth内の重複start、別depth / stream / Targetのdepth recordによる
  close（depth / stream mismatch）、startのないwall / wallのないstart（missing boundary）、負のwall・時刻逆行、depth開始前の
  phase開始、区間overlap、profile window内で始まる未完了区間
- `frontier_reduction_sort` はawaitを含まない同期区間なので、profile開始 / 停止timerやheartbeat timerはその途中で走らない

再構成結果（4件ともvalid）: c6-p1 765区間（うちwindowと重なる251）、c13-p1 313（115）、c14-p0 589（217）、diagnostic 299（221）。
window境界で部分的に切れた区間は0。区間終端から次のA3境界までの合計は5.3〜11.8 ms（30分全体）。

### 7.2 sample時刻とclock整合

A5と同一。V8 CPU profileの時刻（`startTime` + 累積 `timeDeltas`、µs）は `process.hrtime` と同じmonotonic clockであり、`Profiler.start` /
`Profiler.stop` の前後で `performance.now()` と `hrtime` の組を読み（計4組）、offsetのばらつき ≤ 1 ms、各組の精度 ≤ 1 ms、profileの
`startTime` / `endTime` が各呼び出しのhrtime bracket内、全sampleが [startTime, endTime] 内、を満たすときだけsampleをResearch clockへ
写した。4 profileともこの条件はvalid。

さらにA8では、**negative `timeDelta` を1件でも含むprofileをinvalidとする**（§8）。A5のalignmentはnegative `timeDelta` を数えるだけで
validityに入れていないが、累積時刻が逆行するとsampleがどのintervalに属するかをformal evidenceとして保証できないためである。
timestamp補正は行わず、そのprofile全体をdecision inputから除外する。今回c13-p1が該当した（1件）。

### 7.3 population

frontier intervalの [start, end) に写像後の時刻が入るsampleだけを内部分析の母集団とした。区間外sampleはどの分母にも入れていない。
区間整合の検証として、frontier sectionでしか実行されない `compareReservedRepresentative` / `compareReservedFrontier` を含むsampleの
区間外件数を数えた: **3件とも区間外0件**（区間内 20,702 / 17,703 / 19,930件）。interval境界 ±toleranceのsampleは46〜91件（記述のみ）。

### 7.4 stack分類（事前登録）

frontier interval内sampleをstack全体で、次のpriorityで一意に分類した（初回commit `6623c08` で固定し、`32c582c` でも変更していない）。

1. `gc`: V8の `(garbage collector)` frame
2. `other_frontier`（observer overhead）: `bonusStream.ts` frameより深いResearch harness frame（A3 observerとdurable write）
3. `representative_stable_serialization`: `compareReservedRepresentative` frameより深い位置にserialization frame（`hashing.ts` の
   `stableStringify` / `serializeStable`、名前付き、または `serializeStable` のspan内に開始行がある匿名callback）がある。
   **representative ancestorのないserialization frameはこのcategoryにしない**（別用途のstableStringifyを混ぜない）
4. `frontier_sort`: `compareReservedFrontier` frame（とその呼び出し先）がある、またはnative leaf `sort` の最も近い非native祖先が
   `generateReservedDepth`
5. `representative_compare_or_inlined`: `compareReservedRepresentative` はあるがserializationはない（`lastResetDepth` 比較、
   `compareStableKeys`、`stableStringify` へのVite SSR import accessor、inline部分）
6. `reduction_loop_or_inlined`: leafが `generateReservedDepth`（名前）、またはnative leafの最も近い非native祖先がそれ
7. `other_frontier`: それ以外（`(program)`、representative ancestorのないserialization、Vite SSR loader、native / Node internal、
   他のRepository frame）

名前付きframeは(file, 関数名)で照合し、source-mapped開始行が宣言行と一致することを全profileで確認した（不一致0件）。spanは
measured HEADのsource textから導出（入れ子関数はインデント付き `}` までのspan）。ordinaryの `compareRepresentative()` は別関数として
一致させない。

## 8. 事前登録decision rule

formal run前にcommit（`32c582c`、`PHASE2C26A8_DECISION_RULE`）。registered primary count 3、majority 2（初回から変更なし）。

有効（profile quality valid）= すべてを満たす:

- captureが完全（profile、必須source map付きscript table、windowの登録停止、errorなし）
- clock整合valid（A5 rule）、interval再構成valid（window内に始まる未完了区間なし）
- **negative `timeDelta` = 0**（`maxNegativeTimeDeltas = 0`。1件でもあればprofile全体invalid、timestamp補正なし。件数が得られない場合もinvalid）
- frontier interval sample ≥ 5,000
- 名前付き登録frameがすべて宣言行へ解決
- 区間外comparator sample ≤ 1%

invalidなprofileはdecision inputにもpooled shareにも入れない（invalid理由はRESULTの `decisionRow.invalidReasons` と
`summary.profileQuality` に記録）。各有効primaryで唯一の最大category（同率は「なし」）を取り、判定順:

1. **S** `stable_serialization_dominant`: 2件以上で `representative_stable_serialization` が唯一の最大かつ ≥ 0.25
2. **T** `frontier_sort_dominant`: 2件以上で `frontier_sort` が唯一の最大かつ ≥ 0.25
3. **R** `reduction_loop_dominant_unresolved`: 2件以上で `reduction_loop_or_inlined` が唯一の最大かつ ≥ 0.25
4. **C** `representative_compare_dominant`: 2件以上で `representative_compare_or_inlined` が唯一の最大かつ ≥ 0.25
5. **M** `mixed_or_insufficient`: それ以外（有効primary 2件未満、不一致、gc / other_frontierが最大、最大share < 0.25）

diagnostic（no_inlining）はdecisionに入れない（decision関数は登録3件以外の行数でMになることをtestで固定）。

結果: 有効2件（c6-p1、c14-p0）、invalid 1件（c13-p1: `CPU profile contains negative timeDeltas: 1`）。有効2件とも
`representative_stable_serialization` が唯一の最大（0.659 / 0.677）→ **Case S**。

## 9. 詳細（記述統計）

有効primary（c6-p1、c14-p0）を中心に示す。c13-p1はinvalid profileの記述値として括弧書きで併記する。

### 9.1 profile quality

| orientation | profile quality | profile全sample | frontier interval内 | frontier sample比 | 区間時間 / profile時間 | Repository leaf | 未帰属 / native leaf | GC |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| c6-p1 | valid | 57,718 | 29,200 | 50.6% | 50.9% | 26,668 | 943 | 1,589 |
| c13-p1 | invalid（negative timeDelta 1） | 57,603 | （24,865） | （43.2%） | （43.4%） | （22,500） | （298） | （2,067） |
| c14-p0 | valid | 57,846 | 27,441 | 47.4% | 47.7% | 25,510 | 337 | 1,594 |

（未帰属 / native = `(program)`、Vite SSR loader、Node internal等をleafとするsample。profile failure 0。）

### 9.2 jit_default: leaf frame別（frontier interval sampleに対する割合）

| leaf frame | 主なcategory | c6-p1 | c14-p0 | （c13-p1） |
| --- | --- | ---: | ---: | ---: |
| `serializeStable`（`hashing.ts` 22行） | serialization | 48.3% | 47.0% | （45.5%） |
| `generateReservedDepth`（`bonusStream.ts` 789行） | reduction_loop | 16.7% | 20.3% | （19.5%） |
| `serializeStable` のobject key `map` callback（58行） | serialization | 16.1% | 15.6% | （15.0%） |
| `(garbage collector)` | gc | 5.4% | 5.8% | （8.3%） |
| `serializeStable` のarray `map` callback（46行） | serialization | 4.5% | 4.5% | （4.4%） |
| `compareStableKeys`（`semanticKeys.ts` 8行） | representative_compare | 3.5% | 3.4% | （3.6%） |
| `(program)` | other | 2.9% | 0.9% | （0.9%） |
| `compareReservedRepresentative`（688行） | representative_compare | 1.0% | 1.0% | （1.1%） |
| `stableStringify`（68行） | serialization | 1.0% | 0.9% | （1.1%） |

（同じleafでもstack次第でcategoryは分かれる。serialization leafのうちrepresentative ancestorを失ったものは `other_frontier` に入る。
RESULTの `topLeaves.category` は各leafで最初に見たsampleのcategoryの記述であり、category集計は `categories` が正。）

登録関数のinclusive sample（frontier interval sample比、有効2件）: `generateReservedDepth` 87.6 / 93.3%、`compareReservedRepresentative`
70.6 / 72.3%、`stableStringify` 68.0 / 67.7%、`serializeStable` 68.9 / 67.1%、`compareStableKeys` 3.5 / 3.4%、`compareReservedFrontier` 0.3 / 0.3%。

`other_frontier` の内訳: c6-p1は7.0%（serialization_without_representative 4.0%、`(program)` 2.9%）で、c14-p0（1.2%）より大きかった。
c6-p1の `other_frontier` にはstack walkでrepresentative ancestorを失ったserialization sampleが多く含まれる（保守的にSに数えていない）。
`representative_compare_or_inlined` の中にはVite SSR import accessor（`stableStringify` 呼び出し経路、Production bundleには無い）が
少数含まれる。

### 9.3 reduction loop内の行（記述的、whole-profile positionTicks）

`generateReservedDepth` を**leaf**とするsampleの行（`positionTicks`、source map後、profile全体、interval filterなし）のうち、frontier
block行（`frontier_reduction_sort` の開始境界の次の行から完了境界まで。これらの行はfrontier sectionでしか実行されない）:

| 行 | 内容 | c6-p1 | c14-p0 | （c13-p1） |
| ---: | --- | ---: | ---: | ---: |
| 870 | `for (const state of generated) {` | 119 | 132 | （142） |
| 871 | `` const key = `${state.position}\u0000${state.familyLayoutKey}` `` | 832 | 840 | （516） |
| 872 | `const current = byKey.get(key)` | 3,369 | 3,969 | （3,798） |
| 873 | `if (!current \|\| compareReservedRepresentative(state, current) < 0) byKey.set(key, state)` | 145 | 162 | （104） |
| 875 | `set.frontier = [...byKey.values()].sort(compareReservedFrontier)` | 31 | 19 | （11） |
| 合計（frontier block行） | | 4,497 | 5,122 | （4,571） |
| 参考: 区間内で `generateReservedDepth` がleafのsample | | 4,873 | 5,575 | （4,856） |

frontier block行の合計は区間内 `reduction_loop_or_inlined` sampleの約92%に当たる（残りは関数開始行789・`return` 891行等のsection
不明な行に落ちたと考えられるが、それは断定しない）。**これは記述であり、「Map.getのcost」とは言わない**: builtin（Map get / set、
spread、sort builtin loop）は呼び出し元JavaScript frameに畳まれ、最適化コードのsource positionは近似である。872行に集まった
sampleには、Map lookup、そこへinlineされたkey string処理（直前行のtemplate連結結果のhash計算等）が含まれ得る。sort / spreadの
875行は小さい（19〜31）。

### 9.4 work count（記述的）

現在実装では、`(position, familyLayoutKey)` keyの最初のstate以外はちょうど1回 `compareReservedRepresentative()` を呼ぶので、
`generatedStates − frontierStatesAfter` はrepresentative比較の**正確な呼び出し回数**である（上限ではない）。一方 `stableStringify()` は
`lastResetDepth` が同値のときだけ（short-circuit）2回呼ばれるため、`2 × 比較回数` をserialization呼び出し回数とはしない（実回数は
per-state counterを入れていないので不明）。

| orientation | window内区間 | generatedStates | frontierStatesAfter | representative比較回数 | 比較 / generated | 区間時間 / 比較回数 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| c6-p1 | 251 | 149,014,935 | 3,884,483 | 145,130,452 | 97.4% | 約2.1 µs |
| c14-p0 | 217 | 163,700,398 | 3,626,866 | 160,073,532 | 97.8% | 約1.8 µs |
| （c13-p1） | （115） | （170,810,779） | （2,744,629） | （168,066,150） | （98.4%） | （約1.6 µs） |

generated stateの97〜98%がrepresentative比較に到達している（work countはA3 streamのcount由来で、negative `timeDelta` とは独立）。
「区間時間 / 比較回数」はsection全体の時間を比較回数で割った記述値で、比較1回の時間の直接計測ではない。30分全体（完了depth）の
比較回数は c6-p1 3.46億、c13-p1 4.20億、c14-p0 3.86億。

### 9.5 Search outcome

3件ともtimeout、kill時のactive sectionは `bonus_depth_read` 内（held-aware sectionは3件とも `state_generation`）、Candidate delivered 0、
trial 0、full Planner run 0、outer / inner boundary contract violation 0。prediction回数（最後のheartbeat）: c6-p1 Reset 254 / Keep 29,247、
c13-p1 Reset 253 / Keep 28,218、c14-p0 Reset 253 / Keep 29,233。sampled max heap 4.55 / 5.12 / 4.82 GB（OOMなし）。

### 9.6 semantic parity（A7 formal rawとの共通prefix）

CPU profilerの有無でSearchの計算内容が変わっていないことを、A7 formal raw（SHAがA7 RESULTの `sources.run` と一致したものだけ）と
比較して確認した（profile qualityとは独立に、primary 3件すべてで要求）:

| orientation | completed work prefix（identity + counts） | held-aware depth prefix（stream / depth / exhausted / counts） |
| --- | --- | --- |
| c6-p1 | 750件で全一致 | 742件で全一致（generatedStates 3.55億） |
| c13-p1 | 323件で全一致 | 313件で全一致（4.27億） |
| c14-p0 | 597件で全一致 | 589件で全一致（3.97億） |

semantic failure 0。diagnosticも記述的に一致（work 307件、depth 299件）。

## 10. 言えること / まだ言えないこと

### formalに言えること

- Production-like（jit_default）条件で、有効primary 2件（c6-p1、c14-p0）の `frontier_reduction_sort` interval内CPU sampleの66〜68%
  （pooled 66.8%）が、`compareReservedRepresentative()` から呼ばれたstable serialization（`stableStringify()` → `serializeStable()` と
  その `map` callback）のstack上にあった。事前登録ruleはCase S
- c13-p1のprofileはnegative `timeDelta` 1件によりinvalidで、decisionに使っていない（有効2件 ≥ majority 2）
- frontier sort（`compareReservedFrontier`）は0.3%で、sortの比較関数はhotspotではない
- reduction loop / key / Map / inline部分は17〜20%、GCは約6%、representative比較のserialization以外は約5%
- generated stateの97〜98%がrepresentative比較に到達している（work countは正確値）
- 区間再構成は整合していた（frontier専用comparatorの区間外sampleは3件とも0件、区間時間比とsample比がほぼ一致）
- CPU profilerを加えてもA7 formal runと共通prefixの計算内容は完全一致した

### まだ言えないこと

- c13-p1のCPU構成（invalid profileのため。記述値は有効2件と同傾向だがformal evidenceではない）
- negative `timeDelta` が発生する原因（V8 sampler / OS clockの側の事象と考えられるが、未調査）
- `stableStringify()` の実呼び出し回数（`lastResetDepth` 同値の比較がどれだけあるか）。serializationの時間が「呼び出し回数が多い」
  ためか「1回が重い」ためかの分解
- `serializeStable()` 内部（再帰、`Object.keys().sort()`、`JSON.stringify(key)`、配列 / object `map`、`WeakSet` 操作、文字列連結）の
  どれが主因か（native処理は呼び出し元leafに畳まれる）
- `reduction_loop_or_inlined`（17〜20%）の中身。872行（`byKey.get(key)`）にline ticksが集まったが、Map lookup単独のcostとは
  言えない。sort builtin loop / spreadの分離も同様
- GCを起こしたallocationがどこか（serializationの文字列生成が候補だが未測定）
- window外（Search開始後120秒未満、720秒以降）、他orientation、Browser Worker、他deviceでの構成
- optimizationによる効果量（未実施）、primary Searchが完了するまでに必要な時間

## 11. 次Phase recommendation

Case S: **representative比較用のstable key / prepared representation / serialization回避の最小optimization設計**へ進む（本Phaseでは
実装しない）。検討候補（比較のみ、未決定）:

- generated stateごとのrepresentative比較でbonusesのserializationを毎回行わない形（例: state生成時に一度だけ比較用keyを用意する、
  またはserializationを経ない5-slot bonusesの直接比較）
- 比較対象の片側（現在のrepresentative `current`）のkeyを再利用する形

設計時に維持する契約:

- representative ruleの意味を変えない: `lastResetDepth` 降順、同値なら `stableStringify(bonuses)` の文字列順（`compareStableKeys`）で
  小さい方。代替表現は現在のserialization文字列順と**同じ全順序**を与えることを証明・testする必要がある（slot順・rank / type ID・
  scopeを含むserializationの意味をそのまま保つ）
- frontier key（`position` + `familyLayoutKey`）、frontier順序（`compareReservedFrontier`）、Map構造、generation、Candidate semantics、
  Search ordering、extent、boundsは変えない
- semantic parity（completed work / held-aware depth prefix、Candidate列）で最適化前後の一致を確認する

`reduction_loop_or_inlined`（約18%）とGC（約6%）はserialization最適化後に構成が変わるため、最適化後の再profileで改めて確認する
（その際もnegative `timeDelta` のfail-closedを維持する）。最終ゴールはbenchmark高速化そのものではなく、Issue #154の「良いglobal
Route集合を実用時間で探索する」ことである。

## 12. limitations

- Node child（Vite SSR loader）のみ。Browser Worker・他device・他heap条件は測っていない
- CPU profilerが加わるため、A7とのabsolute wall time・進行量は比較しない。比較はA8 profile内のsample shareだけ
- 各orientation 1回（retryなし）、profile windowは1区間（600秒）。run間ばらつき・window外は測っていない。negative `timeDelta` を
  含むprofileは再計測せずinvalidとして扱った（有効2件で判定）
- sampling profilerの統計的推定（10 ms間隔）。個々のgenerated state・比較の時間の直接計測ではない
- V8はbuiltin（Map get / set、Array sort loop、spread、JSON.stringify等）を独立frameとして出さず、呼び出し元JavaScript frameに
  帰属させる。`reduction_loop_or_inlined` はkey生成・Map操作・loop・materialization・sort builtin loop・inline部分を分離しない
- JIT inlineで関数境界が失われたsampleは `*_or_inlined` に入る。ancestorを失ったserialization sampleはrepresentative serializationに
  数えない（保守的）。no_inlining diagnosticは関数単位attributionの補助で、Production-like割合ではない
- line ticks（`positionTicks`）はprofile全体の記述集計でinterval filterしていない。最適化コードのsource positionは近似
- interval境界はA3 trackerのResearch側 `performance.now()` stamp。区間はA3 observerのsection開始時durable write（writeSync + IPC）を
  含み、そのsampleはobserver overhead（other_frontier）として分離した（各数件以下）
- Vite SSR loaderのimport accessorはProduction bundleには無い（leafKindとして別記）
- RESULTの `topLeaves` / `topStacks` の `category` は各keyで最初に見たsampleのcategory（記述）。category集計は `categories` が正

## 13. 検証

- `npm run lint`、`npx tsc -b --force`、`npm test`（328 files / 5,364 tests pass、formal run前）、`npm run build`、`git diff --check`
- negative `timeDelta` のfail-closed rule・decision rule・test（`negativeDeltas = 0` → valid、`> 0` → invalid、invalid profileが
  majority投票に入らない、有効2 / 3でCase S、有効1 / 3以下でCase M）をcommit（`32c582c`）し、そのclean HEADでformal runを1回実行
  （retryなし）
- formal run: measured HEAD `32c582c`（clean）で `scripts/run-planner-global-phase2c26a8.mjs` を実行し、同じHEADで
  `scripts/analyze-planner-global-phase2c26a8.mjs` によりRESULTを生成（`formal = true`、formal series failure 0）
- raw artifact（`PLANNER_GLOBAL_PHASE2C26A8_R2_RAW.json.local`、`PLANNER_GLOBAL_PHASE2C26A8_R2_RUN.local/`、
  `PLANNER_GLOBAL_PHASE2C26A8_R2_PROFILES.local/` の `*.cpuprofile` / `*.scripts.json` / `*.capture.json`、
  `PLANNER_GLOBAL_PHASE2C26A8_R2_LOG.local`）はcommitしていない。取り下げた旧run（`6623c08`）のraw artifactもcommitしていない
- committed evidence: `docs/PLANNER_GLOBAL_PHASE2C26A8_RESULT.json`
