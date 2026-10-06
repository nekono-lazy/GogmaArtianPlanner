# Global Planner Research Phase 2-C2.6-B2-C2B2H（B2-C2B2G STATE_GENERATION dominant Targetの `state_generation` 内部CPU attribution）

Refs #154。Research only・profiling only。Production source（`src/domain` / `services` / `workers` / `pages` / `components` / `db`）、Search semantics /
ordering / comparator、Candidate materializer、C4C capture、safety cap、extent、context、P1、termination、yield semanticsは変更していない。
Production optimization、新しいProduction instrumentation seam、per-state timer / callback、no-inlining diagnostic、heap allocation profiler、heap snapshot、
16 GB heap、60分以上のrun、retry / fallback、E2、K2、residual 3、global assignment、full Planner、UI、`solution_materialization` のoptimization、
A3〜A9 / B2-C2B2E / B2-C2B2F / B2-C2B2G RESULTの再生成は行っていない。

- measurement HEAD: `435fe0b53f56fed74ace9e16cf42281996c68514`（runnerがchild起動前にstart attestationで記録）
- analysis HEAD: `435fe0b53f56fed74ace9e16cf42281996c68514`（measurement HEADと同一。`calculationCodeChangedSinceMeasuredHead = []`）
- RESULT: [`docs/PLANNER_GLOBAL_PHASE2C26B2C2B2H_RESULT.json`](PLANNER_GLOBAL_PHASE2C26B2C2B2H_RESULT.json)（**`provenance.formal = true`**、`evidenceGrade = formal`、
  decision **`B2C2B2H_MIXED`**、invalid reason 0、insufficient reason 0）

## 0. 位置づけとlimitation

- B2-C2B2G（`B2C2B2G_STATE_GENERATION_DOMINANT`、`state_generation` が `bonus_depth_read` の64.3 %）を受けたPhase。問いは「**`state_generation` の
  CPU時間が、現行mainでどの処理に使われているか**」だけで、optimizationはしない。
- Search inputはB2-C2B2Gと同一のoracle-guided diagnostic入力（t02、B2-C1 first compatible context × tight extent）。Production scheduler / extent selection /
  runtimeのevidenceではない。Route exact / Candidate有無は判定しない（`routeExactJudged = false`）。
- B2-C2B2Gとの差はV8 sampling CPU profilerだけ。**B2-C2B2Gとの絶対runtime比較（wall、depth/s、generated states/s、yields/s、heap）はしない**
  （`absoluteRuntimeComparedWithB2C2B2G = false`）。根拠は本run内のsample shareだけ。
- `state_generation` のwall timeの一部はResearch yield（setImmediate）待ちで、CPU sampleとは別に扱う（5.4）。yield待ちをcheckpoint CPUとはみなさない。
- A5 / A8 / A9はimplementation referenceのみ（profiler方式・clock alignment・interval再構築）。Search childはそれらの結果を一切受け取らない。

## 1. 結論

| 軸 | 値 |
| --- | --- |
| decision | **`B2C2B2H_MIXED`**（dominantなし。hotspot category ≥ 0.20 は `keep_prediction` **31.33 %** のみ → 次Phase候補 = `keep_prediction`） |
| evidence | `formal = true`（start attestation verified、Working Tree clean、smoke null）、invalid 0、insufficient 0 |
| profile window | Search開始 + 121.13 s 〜 + 720.48 s（requested 120 s / 720 s、actual 599.3 s）、stopped by window、clock alignment valid、**negative timeDelta 0** |
| samples | profile全体 57,271 / `state_generation` interval内 **32,810** / idle 563（1.72 %）/ **active 32,247** |
| `state_generation` interval | profile内133 interval（partial 2）、345.3 s（profileの57.5 %）、生成state 2.62億 |
| program / GC | `(program)` **27.49 %** of active（Repository CPUへ再分類しない）、GC **11.12 %** |
| yield wall | profile window内 `state_generation` 347.2 sのうちyield待ち 43.9 s（**12.65 %**）、whole run 15.89 % |
| semantic parity | B2-C2B2G formal runのheld-aware depth record 403件と本runの先頭403件が完全一致（counts・stream・depth・exhaustion） |
| outcome | 30分budgetでtimeout（正常なprofiling outcome。Candidate 0扱いしない）。delivery 0 |

### 1.1 category（active CPU denominator、事前登録のstack-aware分類）

| category | samples | share of active | share of all interval samples |
| --- | ---: | ---: | ---: |
| **`keep_prediction`** | **10,102** | **31.33 %** | 30.79 % |
| `program`（unattributed） | 8,865 | 27.49 % | 27.02 % |
| `generation_owner_or_inlined` | 4,936 | 15.31 % | 15.04 % |
| `state_construction_family_layout` | 4,440 | 13.77 % | 13.53 % |
| `gc` | 3,585 | 11.12 % | 10.93 % |
| `observer_overhead`（unattributed） | 177 | 0.55 % | 0.54 % |
| `checkpoint_cpu` | 110 | 0.34 % | 0.34 % |
| `counter_advance` | 19 | 0.06 % | 0.06 % |
| `other_state_generation`（unattributed） | 8 | 0.02 % | 0.02 % |
| `reset_prediction` | 5 | 0.02 % | 0.02 % |
| `gogma_prediction_shared` | 0 | 0 % | 0 % |
| `idle`（denominator外） | 563 | — | 1.72 % |

- unattributed（program + observer + other）= 28.06 % of active（< 0.50、quality OK）。idle + program = 28.74 % of all interval samples。
- hotspot categoryのうち ≥ 0.50 はなく、≥ 0.20 は `keep_prediction` だけ。`program` は27.5 %だが登録上hotspot categoryではない（decisionの対象外、5.2）。

## 2. 方針（B2-C2B2Gとの差）

```text
B2-C2B2G RESULT（ff163148…、formal、B2C2B2G_STATE_GENERATION_DOMINANT / dominant state_generation / nextPhaseSections [state_generation]、invalid 0）
  -> parsePhase2C26B2C2B2HB2C2B2GAuthority(): formal / launch provenance / not partial / decision / Stage 1 / 2 observer / CPU profilerなし /
       condition checks・hash chain・population parity・child identity all true / task rebuild / identity / excluded Route（3者一致）/ profile fileを fail-close確認
  -> phase2c26b2c2b2hPopulation(): B2-C2B2Gのprofiling対象Target（1件）、probe、期待identityを、
       B2-C2B2F / B2-C2B2E RESULTからB2-C2B2G自身の導出関数（phase2c26b2c2b2gPopulation）で再導出したTarget / probe / identity / excluded Route key / Exportと照合
  -> probe manifest（probe + Search input identityのみ）-> .local/PLANNER_GLOBAL_PHASE2C26B2C2B2H_PROBES.json.local（90da013f…）
runner（Export + manifestのみ読む）
  -> start attestation（wx・read-only・read-back verify）-> probe child（Profiler受理・clock alignment・source map・span・frame解決）
  -> tasks child: buildPhase2C26B2C2B2HTasks() = B2-C2B2Gのconstruction（identity全field一致gate）-> 1 task
  -> Search child（fresh、12,288 MB、JIT default、30分）: Debuggerはmodule load中だけ有効（script table）、検索前にSearch identityをdurableに記録
       -> runPhase2C26B2C2B2HTask === runPhase2C26B2C2B2GTask（同一関数）+ B2-C2B2Gと同じ2 observer
       -> B2-C2B2Gのprofiler + durable section stream（境界ごとに1件、計5,768件）+ Search開始anchor
       -> A5のprofile controller: Search開始+120 sでProfiler.start、+720 sでstop、cpuprofile / capture / script tableを書き出し、Searchは30分まで継続
analyzer（run終了後のみ、oracle / A5〜A9 RESULTは読まない。spanとblockはmeasured HEADのsource textから導出）
```

| 項目 | B2-C2B2G | B2-C2B2H |
| --- | --- | --- |
| population | B2-C2B2F BONUS dominantの1 Target | **B2-C2B2G STATE_GENERATION dominantのprofiling対象 1 Target**（同一Target・同一task） |
| CPU profiler | なし | **V8 sampling CPU profiler**（`node:inspector` Profiler、10,000 us、Search開始 + 120 s 〜 + 720 s、JIT default、heap flagのみ） |
| Search instrumentation | `onSearchRuntime` + `onGogmaReservedRuntime` | 同一（observer追加なし。同じobserverの裏でResearch側がsection streamを書くだけ） |
| 30分 / 12,288 MB / concurrency 1 / fresh child / setImmediate / 250 ms sampling / 5 s heartbeat / window / retry・fallbackなし / Target / P1 rank / group / reservation / representative / Planner-start origin / excluded current Route / tight extent / default・tight Search input digest / ordering / comparator / materializer / C4C capture / safety cap 1024 | — | 同一 |

### 2.1 probe（authorityから機械導出、sourceには値を書いていない）

| task | Target | P1 rank | tight extent | group | reservation | default / tight Search input digest | excluded current Route key SHA-256 |
| --- | --- | ---: | --- | ---: | --- | --- | --- |
| t02-r11 | `a367c177…` | 11 | `{4, 235, 1083}` | 3 | `fnv1a32:ff85a91d` | `fnv1a32:d80ff6de` / `fnv1a32:824a0ec4` | `4a875aac…` |

## 3. 計測方式

- **CPU profiler**：A5 / A8方式。`node:inspector` Sessionをchild main threadで使い、module load中だけ `Debugger.enable`（`scriptParsed` でurl + inline source
  mapを取得）→ `Debugger.disable` → `Profiler.enable / setSamplingInterval(10,000 us)`。A5の `createPhase2C26A5ProfileController()` がSearch開始
  （`search_runtime` section start、Research clock）から120 s後にstart、720 s後にstopする。timerはevent loop yield時にしか走らないため、requested / actualの
  start・stopと、各呼び出し前後の `performance.now()` / `process.hrtime` のclock pairを記録する。
- **clock alignment**（A5 rule）：4つのclock pairのoffset spread ≤ 1 ms、各pair精度 ≤ 1 ms、profile `startTime` / `endTime` がstart / stopのhrtime bracket内、
  全sampleが [startTime, endTime] 内。sampleのResearch時刻 = profile時刻 − offset。negative `timeDelta` が1件でもあればINSUFFICIENT（補正しない）。
- **durable section stream**：B2-C2B2Gと同じ `onGogmaReservedRuntime` observerの裏で、held-aware境界（depth start / 6 phaseのstart・completion / depth completion）ごとに
  1件の `gogma_boundary`（seq、Research時刻、type、phase、stream、depth、`state_generation` 完了・depth完了時のみ生成state数）を同期appendする。
  1 depthあたり14件、run全体で5,768件。**生成stateごとのeventはない**。書き込み失敗はSearchへ投げずに数える（0件）。
- **state_generation interval**：section streamの `[phase_started, phase_completed)`。seq欠番、未知record、時刻逆行、phase順序違反・重複、depth外のphase、
  開始のないcompletion、open phaseのままのdepth完了、interval重なり、profile内に始まるopen intervalはすべてfail-close。
- **population**：Research時刻がintervalに入るsampleだけ。
- **分類**（formal run前にcommit `435fe0b` で固定、`PHASE2C26B2C2B2H_CATEGORY_RULES`）：priority順に gc → idle → program（`(program)` / `(root)`）→
  observer_overhead（Research harness frameがすべてのRepository frameより深い）→ checkpoint_cpu → reset_prediction → keep_prediction → gogma_prediction_shared →
  counter_advance → state_construction_family_layout → generation_owner_or_inlined（leafが `generateReservedDepth` 自身・そのspan内のclosure、またはそれを最寄りの
  非native祖先とするnative leaf）→ other_state_generation。callee frameがJIT inlineで失われた場合はownerに入り、callerの行から「Set.hasが何%」等とは断定しない。
- **registered function**（`PHASE2C26B2C2B2H_FUNCTION_REGISTRY`、30関数・6 file）：`generateReservedDepth`、Reset専用（`predictReset`、`predictProductionGogmaReset`、
  `predictProductionGogmaResetSlotsFromRawValues`、`productionGogmaResetCandidatesForWeaponAndElement`、`buildProductionWeightedGogmaResetPool`）、Keep専用（`predictKeep`、
  `predictReferenceGogmaKeep`、`requireReferenceKeepFamily`、`hasKeepMaster`、`hasUnreadableKeepFamily`、`keepCurrentBonusFamily`、`toReferenceKeepCurrentBonus(es)`）、
  共有prediction（`predictGogmaBonus`、`getPredictionSupport`、`requireSupport`、`normalizedBaseSeed`、`referenceGogmaBlock`、`predictReferenceGogmaSlots`、
  `requireNonNegativeSafeInteger`）、counter advance（`advanceGogmaCounter`、`advanceOneCounter`、`validateCounter`）、state construction（`reservedGeneratedState`、
  `keepFamilyLayoutKey`、`keepFamilyLayout`、`keepFamilyOfBonus`、`keepFamilyBonusTypeId`）、`SearchExecutionContext.checkpoint`。spanはmeasured HEADのsource textから
  宣言種別（function / class method / property arrow）ごとに機械導出し、名前で一致したframeのsource-mapped開始行が宣言行でなければINSUFFICIENT。
- **line ticks**：登録関数の `positionTicks`（profile全体のself ticks）をsource mapで元の行へ戻し、`generateReservedDepth` の `state_generation` blockは
  marker（`runtime.phase('phase_started' / 'phase_completed', 'state_generation')` と15個のsub-block marker）から行範囲を導出してラベル付けする。**記述のみ**。
- **yield wait**：B2-C2B2Gのyield wrapperがinner sectionに帰属したwall時間（CPU sampleとは別）。

### 3.1 事前登録rule（formal run前にcommit `435fe0b` で固定）

- `B2C2B2H_INVALID`：authority / population / Search input identity / excluded Route / hash chain / provenance / registered conditionの問題、またはB2-C2B2G formal runとの
  depth record parity破綻
- `B2C2B2H_INSUFFICIENT`：capture不完全（profile / script table / required source map欠落、profiler error、registered stopでもSearch終了でもないstop）、clock alignment不正、
  negative timeDelta > 0、interval再構築不正、profile < 300 s、`state_generation` interval sample < 1,000、span導出失敗、名前一致registered frameの行不一致、
  Search / inner tracker contract violation・section stream書き込み失敗 > 0、unattributed active share ≥ 0.50
- `B2C2B2H_<CATEGORY>_DOMINANT`：hotspot category（owner / reset / keep / shared prediction / state construction / counter advance / checkpoint / gc）のactive share ≥ 0.50
- `B2C2B2H_MIXED`：上記以外。≥ 0.20のhotspot categoryを最大2つ次Phase候補とする
- denominatorはactive CPU（interval sample − `(idle)`）。全interval sample比も併記する

## 4. 実行

| 項目 | 値 |
| --- | --- |
| 環境 | Node v24.19.0（V8 13.6.233.17-node.51、Vite SSR loader、NOT a Browser Worker）、AMD Ryzen 7 9700X（16 logical）、32 GB |
| start attestation | `start-attestation.json`、SHA-256 `7d0410f9…`、createdAt 2026-10-06T00:50:03.045Z（probe child START 00:50:03.072Zより前）、HEAD `435fe0b`、uncommitted false、smoke null |
| benchmarkCodeSha256 | `f1dfb463ffa9da1487c4ad0c982a4aac2e770f8d6e934d030fa082e5d5bd757e`（analyzerがmeasured HEADのgit objectから再計算した値と一致） |
| probe child | 2.8 s、valid（149 samples、median interval 10,506 us、alignment valid、required source map 6/6、`predictGogmaBonus` → 165行目・`keepFamilyLayoutKey` → 68行目が宣言行に解決） |
| 実行 | tasks child 5.6 s（gate ok）→ Search child 00:50:11Z〜01:20:11Z、1,800.4 sでtimeout（SIGKILL、retryなし） |
| 起動前の確認 | Working Tree clean、node process 0、空き17.8 GB |
| 実行中の監視 | 60秒ごとに空き物理メモリ < 1.5 GBを監視、警告0件。peak heap 7.50 GB / RSS 8.11 GB |
| smoke | non-formal 1回（`--allow-uncommitted --smoke-budget-ms 150000 --smoke-warmup-ms 20000 --smoke-stop-ms 80000`）でrunner → analyzerを確認（profile 60 sのため
  事前登録どおりINSUFFICIENT）。smoke結果を見て条件・ruleは変えていない |

## 5. 結果

### 5.1 profile quality

| 項目 | 値 |
| --- | --- |
| requested start / stop | Search開始 + 120,000 ms / + 720,000 ms（600,000 ms） |
| actual start / stop | + 121,131.8 ms（遅延 1,131.8 ms）/ + 720,477.3 ms（遅延 477.3 ms）、actual 599,345 ms、stoppedBy `window`、error null |
| clock alignment | valid、offset spread 0.018 ms、pair精度最大 0.036 ms、profile 600,210 ms、Σ timeDeltas 600,209.9 ms、**negative timeDelta 0** |
| observed sampling interval | median 10,505 us、mean 10,480 us |
| interval reconstruction | valid、section stream 5,768 record、`state_generation` interval 412（各phase完了412、depth完了412）、open interval なし |
| profile内interval | 133（partial 2）、345,294 ms（profileの57.5 %）、boundary近傍sample 191 |
| sample | 全体 57,271（全てprofile window内）、interval内 32,810、idle 563、active 32,247（≥ 1,000） |
| source map | required 6 file すべてあり。profile node中 `src/` frame 141（mapped 129 / unmapped 12）、registered named 11 / anonymous 5、**宣言行不一致 0** |
| contract violation | outer 0、inner 0、open `bonus_depth_read` 外のinner境界 0、section stream書き込み失敗 0 |
| alignment sanity（記述） | `reservedGeneratedState` を含むsample：interval内 4,440 / interval外 0 |

### 5.2 hotspot

top leaf（self、active比）：

| samples | share | category | leaf |
| ---: | ---: | --- | --- |
| 10,102 | 31.33 % | keep_prediction | `predictKeep`（bonusStream.ts:482） |
| 8,865 | 27.49 % | program | `(program)` |
| 4,935 | 15.30 % | generation_owner_or_inlined | `generateReservedDepth`（bonusStream.ts:808、self） |
| 3,585 | 11.12 % | gc | `(garbage collector)` |
| 2,362 | 7.32 % | state_construction | `keepFamilyLayoutKey`（gogmaBonusFamily.ts:68） |
| 2,065 | 6.40 % | state_construction | `reservedGeneratedState`（bonusStream.ts:973） |
| 110 | 0.34 % | checkpoint_cpu | `checkpoint`（searchExecution.ts:99） |
| 19 | 0.06 % | counter_advance | `advanceGogmaCounter` |
| 5 | 0.02 % | reset_prediction | `predictReset` |

top stack（末尾8 frame）：`(root) > generateReservedDepth > predictKeep` 31.33 %、`(root) > (program)` 27.49 %、`(root) > generateReservedDepth` 15.30 %、
`(root) > (garbage collector)` 11.12 %、`(root) > generateReservedDepth > reservedGeneratedState > keepFamilyLayoutKey` 7.32 %、
`(root) > generateReservedDepth > reservedGeneratedState` 6.40 %、`(root) > generateReservedDepth > checkpoint` 0.33 %。
async resumeのためstackは `generateReservedDepth` から始まる（`readReservedDepth` 以上の祖先はない）。

registered inclusive（active比）：`generateReservedDepth` 61.13 %、`predictKeep` 31.33 %、`reservedGeneratedState` 13.77 %、`keepFamilyLayoutKey` 7.33 %、
`checkpoint` 0.69 %（うち0.34 %はcheckpoint自身、残りはその下のResearch yield wrapper = observer_overhead）、`advanceGogmaCounter` 0.06 %、`predictReset` 0.02 %、
`keepFamilyLayout` 0.01 %。**`predictGogmaBonus` 以下のProduction RNG frameはinterval内に1 sampleも現れない**（Reset / Keepのmemo hitがほぼ全て）。

観察（解釈は記述のみ）：

- `keep_prediction` 31.33 %は **Keep prediction memoの経路**：`predictKeep` のself line ticksは
  ``const key = `${gogmaCounter}\u0000${familyLayoutKey}` `` 2,411 ticks と `keepPredictions.get(key)` 7,609 ticks に集中（`if (cached) return cached` 74）。
  Production Keep draw（`predictGogmaBonus` / `predictReferenceGogmaKeep`）ではない。
- `state_construction_family_layout` 13.77 %：`keepFamilyLayoutKey` の `.join('\u0000')` 行 2,361 ticks と、`reservedGeneratedState` のobject literal生成。
  `reservedGeneratedState` のticksのうち1,137は自身のspan外（inline先のunregistered行）に写る。
- `generation_owner_or_inlined` 15.31 %：owner detailはほぼ全て `self`（closure 1件 = Reset parent `find` predicate、native leafなし）。
- `(program)` 27.49 %：JS stackのないV8 / native時間（yield往復のevent loop turn、microtask処理、runtime呼び出し等が候補だが、本計測では切り分けていない）。
  Repository CPUへは再分類しない。
- Reset prediction / counter advance / checkpoint自身のCPUは合計0.4 %未満。

### 5.3 line ticks（`generateReservedDepth` self、profile全体、記述のみ）

`state_generation` block（841〜868行）のsub-block別：

| sub-block | ticks | 主な行 |
| --- | ---: | --- |
| `keep_eligibility_windows_has` | 1,677 | 859 `if (!keepSupported[index] \|\| !windows[index].has(position) \|\| …)` |
| `keep_state_construction` | 693 | 863 `generated.push(reservedGeneratedState(…))` |
| `frontier_scan` | 559 | 858 `for (const [index, state] of set.frontier.entries())` |
| `keep_checkpoint` | 472 | 860 `await execution.checkpoint()`（await / resumeの処理。yield待ち時間ではない） |
| `keep_prediction` | 149 | 861 `predictKeep(...)` 呼び出し |
| `keep_counter_advance` | 92 | 862 `engine.advanceGogmaCounter(...)` |
| `reset_parent_guard` / `reset_parent_lookup` / `sorted_position_loop` | 16 / 4 / 3 | 851 / 846 / 844 |

ownerのself ticksはprofile全体で12,600。うちblock外の行（関数先頭808: 559、window collection 820: 147、solution materialization 876: 526、
frontier reduction 890〜892: 6,524、`return solutions` 910: 931）は**他sectionの実行**で、`state_generation` のsample shareには含まれない
（line ticksはinterval別に取れないため記述のみ）。block内はposition × frontier Keep scan（858〜863行）に集中し、Reset branchはごくわずか。

### 5.4 yield wait（wall、CPU sampleとは別）

| 区間 | `state_generation` wall | yield count | yield wait | share |
| --- | ---: | ---: | ---: | ---: |
| profile window（前後のsnapshot 120.3 s〜722.4 s） | 347.2 s | 5,239,727 | 43.9 s | **12.65 %** |
| whole run（最終snapshotまで） | 971.5 s | 14,796,663 | 154.4 s | 15.89 % |

B2-C2B2Gの16.5 %との数値一致は要求しない（CPU profilerでruntime自体が変わる）。CPU側ではyieldに伴うcheckpoint CPUは0.34 %、yield wrapper等のobserver overheadは0.55 %。

### 5.5 semantic neutrality

- bounded fixture（test）：同一world・同一taskで A：instrumentationなし、B：B2-C2B2Gの2 observer、C：B2-C2B2Hのprofiler（同じ2 observer）、D：section stream書き込みが
  常に失敗するprofilerのrecordが完全一致。Searchへ渡るinstrumentation keyはB / C / Dとも `onGogmaReservedRuntime` + `onSearchRuntime` だけ。
- formal run：B2-C2B2G formal runのheld-aware depth record（403件、生成state 725,971,613）と本runの先頭403件が、stream / start counter / depth / exhaustion /
  counts（frontier before、legal positions、generated、frontier after、window memo）で完全一致（本runは30分で411 depth完了）。

### 5.6 outcome（記録のみ、B2-C2B2Gとは比較しない）

| 項目 | 値 |
| --- | --- |
| process | timeout（child wall 1,800.4 s、kill at 1,800.0 s）、record null、Candidate 0扱いしない |
| delivery | delivery_flush 0、delivery_consumer 0 |
| B2-C2B2G式section（本run） | `state_generation` 64.05 % / `solution_materialization` 17.51 % / `frontier_reduction_sort` 14.65 % of `bonus_depth_read`（1,516.9 s）、outer sanity all true |
| profile snapshot | 339件（最終はheartbeat、Search elapsed 1,792.6 s）、未観測tail 2.4 s |

## 6. identity / provenance

| 照合 | 結果 |
| --- | --- |
| B2-C2B2G RESULT authority | registered SHA `ff163148…`、formal、`B2C2B2G_STATE_GENERATION_DOMINANT` / `state_generation` / nextPhaseSections `[state_generation]`、invalid 0、hash chain・condition checks・child identity all true、CPU profilerなし |
| B2-C2B2F / B2-C2B2E chain | B2-C2B2GはB2-C2B2F `b7b707bb…` / B2-C2B2E `5bf6bba3…` に対して作られており、B2-C2B2G自身の導出関数で再導出したTarget / probe / identity / excluded Route key / Exportと一致（chain 7項目all true） |
| population | manifest = 再導出、runner Target / probe / identity = manifest = B2-C2B2Gのprofiling対象、Target 1 |
| task identity | raw task = 期待identity（11 field）= B2-C2B2Gの `parity.identity.expected`、Exportから再導出したtask = raw task |
| excluded current Route | analyzerの再導出 = B2-C2B2Gの値 = Search childが検索前に記録した値（`4a875aac…`）、key 1件、current Route |
| hash chain | 17項目all true（B2-C2B2G formal profile file `3c0aa7d9…` がB2-C2B2G RESULTの記録と一致、を含む） |
| conditions | 30分 / 12,288 MB / concurrency 1 / retry・fallbackなし / B2-C2B2G Stage 1と同一 / 2 observerのみ / B2-C2B2Gとの差は `cpuProfiler` のみ / profiler config = registered / Node flagsはheapのみ、17項目all true |

## 7. 次Phase recommendation（本PRでは実行しない）

**MIXED → ≥ 20 %のhotspot categoryは `keep_prediction` の1つだけ → 次Phase候補は `keep_prediction`。**

- 対象はProduction Keep drawではなく、`predictKeep` のmemo経路（generated stateごとの文字列key生成 `${gogmaCounter}\u0000${familyLayoutKey}` と
  `keepPredictions` Mapのlookup）。次Phaseでは、このmemo key生成とlookupのcostをline / microbenchmark等でさらに分けることを検討する。
- 登録上hotspotではないが記録しておく項目：`(program)` 27.5 %（JS stackなし。本計測では内訳不明）、`generation_owner_or_inlined` 15.3 %（line ticksでは
  `windows[index].has` を含むKeep eligibility行とfrontier scanに集中）、`state_construction_family_layout` 13.8 %（`keepFamilyLayoutKey` の join とstate object生成）、
  GC 11.1 %。いずれも閾値0.20未満のため本Phaseの次Phase候補には入れない。
- B2-C2B2Gで後半windowほど増えていた `solution_materialization`（9.8 → 16.3 → 25.3 %）は引き続きsecondary concernとして記録する（本Phaseの対象外。
  `reservedBonusSteps()` 等のoptimizationへは広げていない）。
- no-inlining diagnostic・allocation profiler・optimizationへは自動で進まない。

## 8. tests

`src/benchmarks/plannerGlobalPhase2C26B2C2B2H.test.ts`（22件）：B2-C2B2G formal RESULT authority parse（SHA / case / dominant / nextPhaseSections / Stage 1 / instrumentation /
CPU profiler / chain / identity / excluded Route / profile fileでfail-close）、population = B2-C2B2G profiling対象1件かつB2-C2B2F / B2-C2B2E再導出と一致（Target / task / rank /
extentのhard-codeなし）、manifest（probe + identityのみ）、条件（12,288 MB / 1,800,000 ms / concurrency 1 / retry・fallbackなし / 2 observer / profiler config固定 /
heapのみのNode flags）、identity gate・child計算が `runPhase2C26B2C2B2GTask` と同一、**semantics neutrality**（A / B / C / Dのrecord完全一致、section stream失敗は
Searchへ届かない）、section streamのinterval再構築とfail-close（欠番・逆行・欠落境界・順序違反・重なり・未知record・非有限時刻、kill時のopen interval）、
registered spanと `state_generation` sub-blockの導出（現行source、fail-close）、URL正規化とframe解決（名前 / span）、分類priority（gc / idle / program / observer /
checkpoint / reset / keep / shared / counter / state / owner / other）、合成profileでのclock alignment・interval membership・active denominator・idle / program / GC・
owner detail・line ticks・sub-block、alignment / interval不正時に0 sample・open interval・negative timeDelta・frame行不一致、quality rule（300 s / 1,000 sample /
contract violation / unattributed 0.50）、decision境界（0.50 / 0.20、MIXEDは最大2、非hotspotはdecision対象外）、yield wait、B2-C2B2Gとのdepth parity、start attestation、
Production import / oracle child isolation、committed RESULT固定。

## 9. 未検証事項・limitation

- 単一run・単一Target（ばらつき未評価）。Node / Vite SSRでの計測で、Browser Workerの計測ではない
- profile windowはSearch開始後2〜12分の600 sのみ。それ以降のdepth（B2-C2B2Gでは後半ほど `solution_materialization` が増加）の `state_generation` 内訳は未観測
- 10 ms samplingの統計的attribution。JIT inline・builtin foldingにより、owner categoryの内訳（`windows.has` / iteration / push等）は関数単位では分離していない。
  line ticksはprofile全体のself ticksで、interval別ではない
- `(program)` 27.5 %の内訳は不明（Repository CPUへは再分類していない）
- CPU profilerによりruntime自体が変わるため、B2-C2B2Gとのthroughput / wall比較から性能結論は出さない
- Production RNG・Search・Plannerの挙動は変更していない。新しいRNG挙動は導入していない

## 10. authority / hash chain

| authority | 値 |
| --- | --- |
| B2-C2B2G RESULT（population source / identity authority） | `ff163148a5dc32218868838d24985ba64a2b664618545033cddd9b162cd9a011`（measured HEAD `03e2f73c…`） |
| B2-C2B2F RESULT（chain先） | `b7b707bbf34a851131eba1a312f228f2948fb5c15d3a9ffad18443365279333d` |
| B2-C2B2E RESULT（chain先） | `5bf6bba389bb3c4f1089ddc9b079426930be203bd5e88f3d3f9b2032a42ecabe` |
| B2-C2B2G formal profile（semantic parity reference） | `stage1-t02-r11.profile.jsonl` `3c0aa7d9…`（.local、未commit） |
| Export | `cc35fb5bd85acb417b2ce0229cd79441b48c642ac8af70bbc2dfdfc8c89e1e6b` |
| probe manifest | `90da013fba12f0acbb21e4a7c49579a2905157801e9a1e61b9b1771d25cc8e90` |
| raw run / profile / sections / cpuprofile | `PLANNER_GLOBAL_PHASE2C26B2C2B2H_RAW.json.local` `a5728e9b…` / `a231ced3…` / `3112475b…` / `c7226676…`（.local、未commit） |
