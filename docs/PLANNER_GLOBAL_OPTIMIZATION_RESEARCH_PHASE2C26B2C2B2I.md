# Global Planner Research Phase 2-C2.6-B2-C2B2I（predictKeep composite cache key最適化と正式before / after効果確認）

Refs #154。B2-C2B2H（`B2C2B2H_MIXED`、≥ 0.20のhotspotは `keep_prediction` 31.33 %のみ）で特定した `predictKeep()` memo hotpathに対し、
**Production optimizationを1つだけ**入れ、B2-C2B2Hと同一Search inputでformal before / after効果確認を行ったPhase。

- measurement HEAD: `8f34b9772937c13c36102106722eab23094a9cb7`（Production optimization + regression test + 計測コード + 事前登録decision ruleをformal run前にcommit）
- analysis HEAD: `8f34b9772937c13c36102106722eab23094a9cb7`（measurement HEADと同一。`calculationCodeChangedSinceMeasuredHead = []`）
- RESULT: [`docs/PLANNER_GLOBAL_PHASE2C26B2C2B2I_RESULT.json`](PLANNER_GLOBAL_PHASE2C26B2C2B2I_RESULT.json)（**`provenance.formal = true`**、`evidenceGrade = formal`、
  decision **`B2C2B2I_ADOPTED`**、invalid reason 0、after profile quality issue 0）
- before authority: B2-C2B2H RESULT `e03fa2bb7065906e26fb05cd74e755977edbdfb67ada5cacaea380a6ab9aff6b`（formal、measured HEAD `435fe0b`）

## 0. 位置づけとlimitation

- 変更したProduction calculation sourceは `src/domain/search/bonusStream.ts` の `predictKeep()` memo表現だけ（optimization ID
  `predict_keep_nested_counter_family_cache_v1`）。frontier reduction側の `${state.position}\u0000${state.familyLayoutKey}`、`keepFamilyLayoutKey()`、
  `reservedGeneratedState()`、`solution_materialization`、Reset memo、checkpoint / yield頻度、Search algorithm、extent、context、P1、Planner、RNG、UI、
  schema、persistenceは変更していない。新しいProduction instrumentation seamもない。
- Search inputはB2-C2B2Hと同一のoracle-guided diagnostic入力（t02、B2-C1 first compatible context × tight extent）。Production scheduler / extent selection
  のevidenceではない。Route exact / Candidate有無はdecisionに使わない（`routeExactJudged = false`）。
- 速度の正式根拠は「semantic-identicalな共通held-aware depth prefixの `state_generation` section時間」の直接比較だけ。CPU sample shareはhotspot消失の確認であり、
  速度向上率としては扱わない。whole-run progress（depth数、生成state数）は記述値。
- before / afterとも各1 run（ばらつき未評価）。Node / Vite SSRでの計測で、Browser Workerの計測ではない。

## 1. 結論

| 軸 | 値 |
| --- | --- |
| decision | **`B2C2B2I_ADOPTED`**（Case O：semantic parity valid、両profile valid、keepPredictionShareRatio ≤ 0.75、stateGenerationDirectRatio ≤ 0.90） |
| semantic parity | B2-C2B2H formal runのheld-aware depth record **411件全て**とB2-C2B2I runの先頭411件が完全一致（first mismatchなし）。Search input / excluded Route identityも一致 |
| **stateGenerationDirectRatio** | **0.7372**（共通411 depth、生成state 738,616,871：B2-C2B2H 969,911 ms → B2-C2B2I 715,055 ms、**−26.3 %**） |
| ns / generated state（記述） | 1,313.1 ns → 968.1 ns |
| **keepPredictionShareRatio** | **0.4555**（keep_prediction active share 31.33 % → 14.27 %） |
| predictKeep self line ticks | 旧：key生成 2,411 + `Map.get(composite)` 7,609 → 新：outer `get(gogmaCounter)` 18 + inner `get(familyLayoutKey)` 3,846（合計 10,102 → 3,926） |
| outcome | 両runとも30分budgetでtimeout（正常outcome）。B2-C2B2H 411 depth / 7.39億state → B2-C2B2I 480 depth / 8.43億state（記述値） |
| memory | peak heap 7.50 GB → 7.52 GB、peak RSS 8.11 GB → 8.13 GB（記述値、ratio 1.002 / 1.003） |
| recommendation | **optimizationを採用**。残るhotspot（`(program)`、GC、generation owner、state construction）は別Phaseで1つずつ扱う |

## 2. Production optimization

```text
src/domain/search/bonusStream.ts  predictKeep()
  old  const keepPredictions = new Map<string, RestorationBonusSet>()
       key = `${gogmaCounter}\u0000${familyLayoutKey}` をlookupのたびに生成 → keepPredictions.get(key)
  new  const keepPredictions = new Map<number, Map<string, RestorationBonusSet>>()
       keepPredictions.get(gogmaCounter)?.get(familyLayoutKey)
       miss時だけ engine.predictGogmaBonus() を呼び、成功後に inner Map（なければ新規 inner Map）へ登録
```

- 識別するpairは旧keyと同じ `(gogmaCounter, familyLayoutKey)`。gogmaCounterは整数で十進表記に `\u0000` を含まないため、旧composite keyはこのpairと単射対応しており、
  2段Mapはそれを構造化しただけ。
- prediction入力（missを最初に起こしたstateの5 slotsが `currentBonuses`）、`familyLayoutKey` の定義、slot order、family normalization、tier違い同family layoutの
  prediction共有、lazy prediction、cache scope / lifetime（`createTargetBonusStream()` instance-local、global cache / WeakMap / persistenceなし）は不変。
- prediction成功前にentryもinner Mapも登録しない（旧実装と同じく成功後にだけset）。
- ordinary stream（`readDepth()` / `solve()`）とheld-aware stream（`readReservedDepth()`）の双方が同じ `predictKeep()` を使うため、両方のcache表現が変わる。
  formal performance evidenceはB2-C2B2H Targetのheld-aware pathのみ。

## 3. semantic parity（performanceより先に判定）

| 項目 | 方法 | 結果 |
| --- | --- | --- |
| 1. B2-C2B2Hとのcommon depth prefix | B2-C2B2G collectorで両runのdepth recordを収集し、stream / start counter / depth / exhausted / frontier before / legal positions / generated / frontier after / window memoを比較 | 411 / 411一致 |
| 2. bounded Search record parity | `predictKeepNestedCache.test.ts`：main 4007ef1（composite key）で一度だけ生成したfrozen record（`predictKeepCachePreB2I.json`）と完全一致 | pass |
| 3. ordinary stream regression | 同frozen record（blind / known base、全depthのsolutions・unsupported・exhausted・Engine call）＋既存 `bonusStreamIndependence.test.ts` | pass |
| 4. held-aware stream regression | 同frozen record（raw solutions、absolute steps、history chain、observer count、Engine call）＋既存 `reservedBonusStreamSinglePass.test.ts`（pre-D2-d frozen） | pass |
| 5. Candidate ordering / termination | frozen recordのbounded ordinary Candidate Search結果全体とPlanner Alternative Searchのdelivery順・execution | pass |
| 6. RNG prediction outputs | frozen recordの全Engine call（counter、family layout、Keep入力5 slots）と出力 | pass |
| 7. excluded Route / Search input | child-attested identity（task / Target / digest / extent / group / reservation / excluded Route key）を再導出・B2-C2B2Hと照合 | 全一致 |

pair semantics（`predictKeepNestedCache.test.ts`）：同counter + 同layout + tier違いはEngine call 1回で同一prediction objectを共有（held-aware：held 10..12でReset 10/11/12の3 stateが
Counter 13でKeep、ordinary：2 known baseがCounter 10でKeep）、入力は最初のstateの5 slots。同counter別layout、別counter同layoutはそれぞれ別prediction。
stream instanceごとのmemo。mutation（inner keyを無視 / prediction後に登録しない）で検出できることを確認した。

## 4. 計測方式

- **before authority**：B2-C2B2H formal RESULTをfail-close parse（registered SHA、formal、partialRun false、invalid / insufficient 0、`B2C2B2H_MIXED`、
  nextPhaseCategories `[keep_prediction]`、keep share ≥ 0.20、B2-C2B2Hの登録条件、hash chain / child identity / population / task rebuild / excluded Route /
  B2-C2B2G semantic parity all valid、raw / profile / sections / cpuProfile / capture / scriptsのfile record）。B2-C2B2Hは再計測していない。
- **before evidence**：local B2-C2B2H raw filesのSHA-256がRESULT記録値と完全一致することを、runner parent（formal run開始前）とanalyzerの双方で確認
  （不一致ならformal runを開始しない / INVALID）。
- **population**：B2-C2B2H RESULTのTarget / probe / identity / excluded Routeを、B2-C2B2H自身の導出（`phase2c26b2c2b2hPopulation()`）がB2-C2B2G / F / E
  RESULTから再導出したものと照合（chain 8項目all true）。Target / task / rank / extentはsourceに書いていない。
- **Production change registration**：B2-C2B2H measured HEAD → measurement HEADのcode path差分のうちresearch / test以外が `src/domain/search/bonusStream.ts`
  だけであること、そのsourceが「`keepPredictions` 宣言と `predictKeep()`（JSDoc含む）以外は完全一致、`predictKeep()` にcomposite keyなし、nested lookup、
  prediction後にだけ登録、frontier reduction keyとReset memo不変」であることをrunner parentとanalyzerが `git show` で確認。
- **条件**：B2-C2B2Hと同一（30分 / 12,288 MB / concurrency 1 / retry・fallbackなし / setImmediate / 250 ms sampling / 5 s heartbeat / 2 observer
  `onSearchRuntime` + `onGogmaReservedRuntime` / durable section stream / CPU profiler 10,000 us、Search開始 + 120 s〜+ 720 s、JIT default、heap flagのみ）。
  B2-C2B2Hとの差は `production_optimization:predict_keep_nested_counter_family_cache_v1` だけ（condition checks 17項目all true）。
- **direct comparison**：depth recordの `phaseMs.state_generation`（B2-C2B2G trackerのsection時間、Research yield waitを両runとも含む）を共通prefixで合計。
  checkpointのyieldは50 checkpointごとのcount-basedなので、同一workならyield回数も同一。
- **CPU hotspot**：B2-C2B2Hと同じclassification（`PHASE2C26B2C2B2H_CATEGORY_RULES`、registry、quality rule）を再利用。before shareはRESULT記録値を使い、
  B2-C2B2H cpuprofileをB2-C2B2H measured HEADのsourceで再解析して完全再現（0.3132694514218377）することをINVALID条件として確認。after shareは
  measurement HEADのsourceからspan / blockを導出して解析。

### 4.1 事前登録rule（formal run前にcommit `8f34b97` で固定）

| case | 条件 |
| --- | --- |
| `B2C2B2I_INVALID` | authority / before evidence SHA / population / identity / excluded Route / hash chain / provenance / 登録条件 / Production change登録 / source shape、またはbefore profile再解析の非再現 |
| `B2C2B2I_INSUFFICIENT` | direct comparison不成立（depth record収集invalid、共通depthなし、section時間欠落） |
| `B2C2B2I_REJECTED_SEMANTIC_MISMATCH`（Case N） | 共通depth recordの不一致、またはSearch input / excluded Route不一致。速度に関係なくreject |
| `B2C2B2I_ADOPTED`（Case O） | 両profile valid かつ keepPredictionShareRatio ≤ 0.75 かつ stateGenerationDirectRatio ≤ 0.90 |
| `B2C2B2I_REJECTED_REGRESSION`（Case N） | stateGenerationDirectRatio > 1.05 |
| `B2C2B2I_REJECTED_NO_EFFECT`（Case N） | keepPredictionShareRatio ≥ 0.95 かつ stateGenerationDirectRatio ≥ 0.95 |
| `B2C2B2I_PARTIAL`（Case P） | 上記以外（自動採用しない） |

評価順はINVALID → INSUFFICIENT → semantic mismatch → O → regression → no effect → P。結果を見てthreshold・category定義・条件は変えていない。

## 5. 実行

| 項目 | 値 |
| --- | --- |
| 環境 | Node v24.19.0（V8 13.6.233.17-node.51、Vite SSR loader）、AMD Ryzen 7 9700X、32 GB、起動時空き16.5 GB |
| start attestation | `start-attestation.json` SHA-256 `f21d889b…`、createdAt 2026-10-06T03:43:48.656Z（probe child START前）、HEAD `8f34b97`、uncommitted false、smoke null、productionChangedFiles `[bonusStream.ts]`、source check valid |
| probe child | 2.8 s、valid（149 samples、median 10,500 us、`predictGogmaBonus` → 165行目・`keepFamilyLayoutKey` → 68行目） |
| 実行 | tasks child 5.5 s（gate ok）→ Search child 03:43:57Z〜04:13:57Z、1,800.5 sでtimeout（retryなし） |
| 実行中の監視 | 60秒ごとの空き物理メモリ監視、< 1.5 GB警告0件 |
| smoke | non-formal 1回（`--allow-uncommitted --smoke-budget-ms 150000 --smoke-warmup-ms 20000 --smoke-stop-ms 80000`）でrunner → analyzerの経路を確認。
  runnerの `git show` 出力trimによるsource check誤判定を修正した（判定条件・thresholdは変えていない）。smoke結果を見て条件・ruleは変えていない |

## 6. 結果

### 6.1 direct comparison（共通held-aware depth prefix、同一work）

| 区間 | depth | 生成state | B2-C2B2H state_generation | B2-C2B2I state_generation | ratio |
| --- | ---: | ---: | ---: | ---: | ---: |
| **全体** | **411** | **738,616,871** | **969,911 ms** | **715,055 ms** | **0.7372** |
| 前1/3 | 0〜136 | 249,106,995 | 332,327 ms | 241,675 ms | 0.7272 |
| 中1/3 | 137〜273 | 257,983,281 | 337,236 ms | 248,596 ms | 0.7372 |
| 後1/3 | 274〜410 | 231,526,595 | 300,348 ms | 224,784 ms | 0.7484 |

同じprefixの他section（変更対象外、記述）：window_collection 0.995、support_evaluation 1.008、solution_materialization 1.047、frontier_reduction_sort 0.993、
exhaustion_scan 0.998。depth inclusive wall 1,515.1 s → 1,271.4 s（0.839）。改善は `state_generation` に局在している。

### 6.2 CPU hotspot（`state_generation` interval内、active CPU denominator、B2-C2B2Hと同一classification）

| category | B2-C2B2H share | B2-C2B2I share | B2-C2B2I samples |
| --- | ---: | ---: | ---: |
| **`keep_prediction`** | **31.33 %** | **14.27 %** | 3,926 |
| `program`（unattributed） | 27.49 % | 32.06 % | 8,821 |
| `gc` | 11.12 % | 21.77 % | 5,991 |
| `generation_owner_or_inlined` | 15.31 % | 17.12 % | 4,711 |
| `state_construction_family_layout` | 13.77 % | 13.51 % | 3,718 |
| `checkpoint_cpu` | 0.34 % | 0.49 % | 136 |
| `observer_overhead`（unattributed） | 0.55 % | 0.63 % | 172 |
| その他（reset / counter / shared / other） | < 0.1 % | < 0.2 % | 41 |

- after profile：actual 599.5 s（+120.8 s〜+720.3 s、stopped by window）、clock alignment valid、negative timeDelta 0、section stream 6,726 record / 480 interval、
  profile内157 interval（partial 2）、interval内 28,304 sample（idle 788、active 27,516）、registered frame宣言行不一致 0、unattributed 32.7 %（< 0.50）。
  before profile（B2-C2B2H、再解析）：interval内 32,810 sample（active 32,247）、quality issue 0。
- `predictKeep` self line ticks（profile全体、記述）：before `const key = …\u0000…` 2,411 / `keepPredictions.get(key)` 7,609 / `return cached` 74 →
  after `keepPredictions.get(gogmaCounter)` 18 / `byFamilyLayout?.get(familyLayoutKey)` 3,846 / `return cached` 54。composite key生成行は存在しない。
  `predictGogmaBonus` 以下のProduction RNG frameは両runともinterval内0 sample（memo hitのみ）。
- 観察（記述のみ）：shareは相対値で、keep_predictionが減った分 `(program)` とGCのshareが上がった。GCはsample数でも 3,585 → 5,991 に増えている
  （profile window内の処理量はB2-C2B2H 133 interval / 2.62億state、B2-C2B2I 157 interval / 3.08億state、かつ後半のdepthほどheapが大きい）。
  GC増加の原因（heap規模・Map object数・window位置の違い）は本計測では切り分けていない。

### 6.3 yield wait（wall、記述）

profile window内 `state_generation` 300.8 sのうちyield待ち 70.6 s（23.5 %）、whole run 811.9 s中 192.7 s（23.7 %）。B2-C2B2H（12.65 % / 15.89 %）より
比率が上がったのはCPU部分が短くなったため（yield回数はwork比例）。direct ratioは両runともyield待ちを含むsection時間の比較で、CPU部分だけの改善率はこれより大きい。

### 6.4 outcome / progress / memory（記述）

| 項目 | B2-C2B2H | B2-C2B2I |
| --- | ---: | ---: |
| process | timeout（1,800.4 s） | timeout（1,800.5 s） |
| 完了depth | 411 | 480 |
| 生成state | 738,616,871 | 842,597,754 |
| delivery | 0 | 0 |
| peak heap / RSS | 7.50 GB / 8.11 GB | 7.52 GB / 8.13 GB |

Searchは30分以内に自然完走しなかった（Candidate 0扱いしない）。nested Map化によるmemory regressionは観測されない（単一run、記述のみ）。

## 7. identity / provenance

| 照合 | 結果 |
| --- | --- |
| before authority | B2-C2B2H RESULT `e03fa2bb…` registered、formal、`B2C2B2H_MIXED` / `[keep_prediction]`、keep share 0.3133、invalid / insufficient 0 |
| before evidence | raw `a5728e9b…` / profile `a231ced3…` / sections `3112475b…` / cpuprofile `c7226676…` / capture `711d4fc4…` / scripts `e1228d86…` がRESULT記録値と一致（runner・analyzer双方） |
| hash chain | 24項目all true（B2-C2B2H / G / F / E registered、相互のmade-against、manifest、Export、before files） |
| population | manifest = 再導出、runner Target / probe / identity = manifest = B2-C2B2Hのprofiling対象、Target 1 |
| task / excluded Route | raw task = 期待identity、Exportから再導出したtask = raw task、excluded Route key `4a875aac…` が再導出・B2-C2B2H・child attestationで一致 |
| Production change | B2-C2B2H measured HEAD `435fe0b` → `8f34b97` のProduction差分は `src/domain/search/bonusStream.ts` のみ、source check valid、runner attestationと一致 |
| conditions | 17項目all true（B2-C2B2Hとの差はoptimizationのみ） |

## 8. 次Phase recommendation（本PRでは実行しない）

- 本optimizationは事前登録ruleで **ADOPTED**。`predict_keep_nested_counter_family_cache_v1` をmainに入れる。
- after profileで ≥ 20 %のcategoryは `(program)` 32.1 %（JS stackなし、登録上hotspot外）とGC 21.8 %。登録hotspotでは `generation_owner_or_inlined` 17.1 %、
  `keep_prediction` 14.3 %、`state_construction_family_layout` 13.5 %。次の候補（frontier reduction側composite key、`keepFamilyLayoutKey` のjoin、
  `reservedGeneratedState`、GC / allocation）は別Phaseで1 hotspot / 1 optimizationずつ扱う。本Phaseでは着手していない。
- `solution_materialization`（B2-C2B2Gから続くsecondary concern）は本Phaseでも対象外。

## 9. tests

- `src/domain/search/predictKeepNestedCache.test.ts`（12件）：frozen pre-optimization record（4 case × ordinary / held-aware / Candidate Search / Planner Alternative
  Search）との完全一致と非空性、pair semantics A / B / C、instance-local memo、source shape（nested memo宣言、composite keyなし、prediction後の登録、frontier keyと
  Reset memo不変）。
- `src/benchmarks/plannerGlobalPhase2C26B2C2B2I.test.ts`（21件）：B2-C2B2H authority parseとfail-close、before file record、population / chain（hard-codeなし）、
  manifest、登録条件、Production changed file分類、optimization source check（CRLF、region外変更・frontier key・Reset memo・composite key・事前登録の検出）、
  child計算 / profilerがB2-C2B2Hと同一関数、direct comparison（共通prefix、first mismatch、section時間欠落）、CPU comparison（quality / 再現性）、decision境界
  （0.75 / 0.90 / 1.05 / 0.95、評価順）、memory、start attestation、Production import isolation・child isolation、committed RESULT固定。

## 10. 未検証事項・limitation

- before / afterとも単一run・単一Target。run-to-runばらつきは未評価（他sectionの比が0.99〜1.05に収まっていることは記述として記録）
- CPU profiler（10 ms sampling）は両runに同条件で有効。profile windowは時間基準なので、両runで覆うdepthが異なる
- after profileでのGC sample増加の原因は未切り分け
- Node / Vite SSRでの計測で、Browser Worker・Production schedulerのevidenceではない
- Production RNG・Search semantics・Plannerの挙動は変えていない。新しいRNG挙動は導入していない

## 11. authority / hash chain

| authority | 値 |
| --- | --- |
| B2-C2B2H RESULT（before authority） | `e03fa2bb7065906e26fb05cd74e755977edbdfb67ada5cacaea380a6ab9aff6b`（measured HEAD `435fe0b5…`） |
| B2-C2B2G / F / E RESULT | `ff163148…` / `b7b707bb…` / `5bf6bba3…` |
| Export | `cc35fb5bd85acb417b2ce0229cd79441b48c642ac8af70bbc2dfdfc8c89e1e6b` |
| probe manifest | `fb427c99ab720e32ad9e970b29395a07ad97e9b77f9e129986adeaf6a9b9e443` |
| frozen pre-optimization record | `src/test/fixtures/predictKeepCachePreB2I.json` `1556ab3a…` |
| raw run / profile / sections / cpuprofile | `PLANNER_GLOBAL_PHASE2C26B2C2B2I_RAW.json.local` `d064262e…` / `284c5bb2…` / `2a6ac8f2…` / `b0caa89a…`（.local、未commit） |
