# Global Planner Research Phase 1-A

Refs #154。基準 main / origin/main / remote main は
`a5e9557721432f1203cda8817c97fd9413d31b21`（Phase 0: PR #159）。開始時のWorking Treeはclean。

## 目的と変更境界

Phase 0の42/43の最後の未発見と、Route discovery 586.839秒の内訳を測り、Phase 1-Bの小さな
実験対象を選ぶ。2,982 stepsの既知43/43解は比較基準だけであり、保持集合、順序、Counter、
RouteKind、Candidate IDの入力には使わない。2,982はglobal optimumの証明でもない。

Production behavior、通常Searchのcanonical ordering / Candidate identity、Planner routing、Worker
protocol、UI、永続化、Dexie / Export / CalculationContext、RNG、preferredOwnedWeaponId、
Production default boundを変更しない。正式仕様とPhase 0文書・既存result JSONも変更しない。
自動Route再検索、portfolio / top-K API、Issue #157は本研究の実装対象ではない。

参照したauthority: REQUIREMENTS 14 / 19 / 23、SEARCH_SPEC 3.1 / 5.5 / 5.6 / 6.1.2、
PLANNER_SPEC 7 / 9.2 / 11、DATA_MODEL 9、RNG_SPEC 6、MASTER_DATA、
PLANNER_CONFLICT_REPAIR_DESIGN、PLANNER_GLOBAL_OPTIMIZATION_RESEARCH、AI_DEVELOPMENT_WORKFLOW。

## 計測設計

追加コードは`src/benchmarks/plannerGlobalOptimization{Profile,Focus}.ts`と既存Research harness / runner。
Domain observer、Production API、Worker protocolは追加しない。既存execution seamだけを使う。

- RNG wrapperは同じinput参照を同じEngine methodへちょうど1回渡し、同じ戻り値参照または例外を返す。
  予測の追加・省略・結果変更をしない。Engineの呼び出しを挟む時刻差をprediction elapsedとして積算する。
- exact input keyはaxis、Engine version、prediction inputの全field（Keepのordered slots・rankも含む）、
  Masterの全内容を表す。Masterだけを完全なstable serializationでinternし、短い整数tokenを使う。
  hashを同一性判定に使わない。Masterのobject memoはSearch内限定で、Search間は内容で照合する。
  Productionが現在無視するfieldも含む保守的なexact-input計測であり、意味同値による最大再利用率ではない。
- key集計はEngine実行の外側。key生成・Set / Map集計の時間も別に記録する。
- `onProgress`の`finalizing.processedWorkItems`が完了時のexact settled work数。
  cancel / timeout時は最後の進捗値という下界であり、`settledCountExact = false`を付ける。
- `shouldCancel`呼び出し回数からyield後の追加checkを引いたものがcheckpoint数。
  cancelを検出したcheckpoint呼び出しも含む。yieldの呼び出し数・待ち時間も計測する。checkpoint間隔50は変更しない。
- `createCandidateId`の既存defaultと同じIDを返し、呼び出し回数だけ数える。
  これはCandidate identity生成到達数であり、すべての内部composition数ではない。
- canonical costは戻ったCandidateの`estimatedOperationCount`と各advanceを記録する。
  scheduler内部の最初のIdeal時刻、同cost drain数、全composition数、cache hit数、終了時queue量は未測定。
  Target内のNormal memo、Skill共有、Bonus Reset / Keep共有は既存実装にある。
- 観測値はSearchに返さず、Search decisionから参照されない。例外は通常Search同様に明示的な失敗であり、
  observer例外を候補なしへ変換しない。Production callerからResearch codeへのimportはテストで拒否する。

elapsedにはclock読取り、key集計、instrumentationの実行・GCへの影響が含まれる。厳密なCPU profilerではない。
実時間deadline / 外部cancelで打ち切る場合、overheadによって停止位置が変わり得る。未打ち切りSearchの
結果同値性と、同じ実時間で到達するwork量の同一性は別であり、後者を保証しない。
`Search elapsed = prediction elapsed + その他`を分解し、その他からyield待ち・key集計を追加で分ける。
残差はscheduler / stream / retention / composition / Candidate生成 / validation / GC等の合計であり、
scheduler単独CPU時間とは呼ばない。prediction elapsedにもその呼び出し中のGC等が入りうる。

## 再現と実験の隔離

外部Export: `gogma-artian-planner-backup_20260927015837.json`。
SHA-256はPhase 0と一致:
`cc35fb5bd85acb417b2ce0229cd79441b48c642ac8af70bbc2dfdfc8c89e1e6b`。
Export自体と投影状態はcommitしない。Research boundはmaxPlanSteps 20000、基準extentは350 / 500 / 1500。

Phase 0 algorithmのまま全23 Searchをprofileする。Search直前のinputをdeep copyして任意の
`--capture-inputs`へJSONLで記録し、focused実験はその同じsnapshotを毎回deep copyして実行する。
captureはアプリの永続化ではなく、外部ExportのSHAを持つローカル研究証跡である。
routeFilter / extentはcopyにだけ適用し、次の実験にCounter進行やCandidateを渡さない。

`failed-first`は`--observed-report`の`not_found_within_extent`だけから失敗Target集合を作り、
ordinary Planner由来の保持集合を変えず、残りを失敗Target先頭・他はPhase 0順に安定partitionする。
Target IDの埋め込みもoracleの順序の利用もない。timeout / cancelを失敗Targetとして採用しない。

focused実験のdeadlineは既存checkpointで確認する。`time_budget_reached`、`cancelled`、
`not_found_within_extent`、`unavailable`、`search_error`を分ける。boundaryは実際に予測された端の位置で、
全経路の完全探索やIdeal不存在の証明ではない。Skillのconversion窓はM+1位置となる。

すべてNode単独計測であり、test / buildを並行実行しない。Browser Worker benchmarkは未測定。
環境はNode v24.19.0 / Windows x64、AMD Ryzen 7 9700X（16 logical CPUs）、物理memory約31GiB。
Phase 0の`setTimeout(0)` yieldと、Production Browser WorkerのMessageChannel yieldを同一視しない。
timer待ちの寄与が大きかったため、追加のNode診断として`--yield-mode immediate`を用意した。
これはNodeの`setImmediate`によるmacrotaskで、checkpoint位置・間隔・cancel checkは変えない。
既定はPhase 0と同じtimer。Production WorkerはすでにMessageChannelを使うので、このNode差分を
Production改善効果として計上しない。focused比較では同じyield mode同士を比較する。
memoryはVite loader、Export parse、snapshot capture、profile key集合を含むNode process全体のmaxRSS。

output / capture / progressは既存ファイルを拒否し、progress / captureはexclusive create、最終outputはwx。
読み取りinputと各出力の重複も拒否する。Phase 0 defaultは従来どおり。

## 実行例

```powershell
node scripts/run-planner-global-research.mjs --export '<external Export>' --output docs/PLANNER_GLOBAL_PHASE1_PROFILE.json --profile --capture-inputs phase1-projected-inputs.local
node scripts/run-planner-global-research.mjs --export '<external Export>' --output '<new focused result>' --focus-inputs phase1-projected-inputs.local --focus-target '<full Target ID>' --route-filter normal_artian --time-budget-ms 180000 --yield-mode immediate
node scripts/run-planner-global-research.mjs --export '<external Export>' --output '<new bound result>' --focus-inputs phase1-projected-inputs.local --focus-target '<full Target ID>' --normal 700 --time-budget-ms 180000 --yield-mode immediate
node scripts/run-planner-global-research.mjs --export '<external Export>' --output '<new order result>' --profile --strategy failed-first --observed-report docs/PLANNER_GLOBAL_PHASE1_PROFILE.json --yield-mode immediate
```

出力名は例。一度作ったpathは上書きせず、再実行には新しいpathを使う。

未発見Target直前の再構築snapshotはNormal（charge_blade:8）207、Gogma3153、Skill3184。
武器種・属性が一致するOwnedWeaponは0（Normal / Gogmaとも0）だった。これはPhase 0の実行から
得た値で、oracleから選んだCounterではない。routeFilterはまずallのまま検証する。

## Phase 0再現profile（timer）

raw: [PROFILE](PLANNER_GLOBAL_PHASE1_PROFILE.json)。全23件のTarget順、保持ID、generated Candidate / Entry ID、status、Route、cost、advance、prediction到達量、boundary、searched / skipped RoutesがPhase 0の記録と一致した。完全な生成Plan bodyのPhase 0比較は旧reportが保持していないため未測定。synthetic fixtureではPlan / generated Entryの完全一致を検証した。

- baseline: 20/43、Conflict 21、rejected 23、1,465 steps。
- 保持20、再検索23、found/generated22、未発見1。final: 42/43、Conflict2（Normal1 / Skill1）、rejected/resource_conflict1、7,330 steps、Trace Replay passed。
- Search 613.403秒、全Planner 56.251秒、final Planner 33.367秒、total 677.050秒。
- peak maxRSS 3,133,688 KiB（2.989 GiB）。
- Phase 0の586.839秒 / total657.467秒に対し、このprofileは観測overhead・snapshot capture・実行ごとのtimer / GC差を含む単発測定で、性能劣化とは断定しない。

| Search時間内訳 | 秒 | Search比 |
| --- | ---: | ---: |
| prediction | 180.566 | 29.44% |
| yield待ち | 351.163 | 57.25% |
| exact key集計 | 7.542 | 1.23% |
| その他残差 | 74.132 | 12.09% |

settled work 53,294、checkpoint 1,847,832、yield 36,946、Candidate identity生成 25。全23件ともsettled countはfinalizingまで観測したexact値。

| 軸 | calls | unique exact inputs | duplicate calls | theoretical hit率 | prediction秒 |
| --- | ---: | ---: | ---: | ---: | ---: |
| normal | 5277 | 3891 | 1386 | 26.265% | 0.279 |
| gogma | 857535 | 854651 | 2884 | 0.336% | 178.673 |
| skill | 7145 | 6912 | 233 | 3.261% | 1.614 |

全軸ともSearch内の同一exact input再呼び出しは0。表の重複はSearch間で再登場したもの。内部memoのcache hit数とは異なる。Gogmaのexact duplicate率が低いため、Phase 1-Aではcross-Target prediction cacheを実装・測定しない。cacheによるmemory増加も未測定。

### 全23 Search

IDは表示用の先頭8文字。完全IDはraw reportを正本とする。costはSearch開始時点からの操作数。

| Target | elapsed秒 | work | checkpoint | Normal calls | Gogma calls | Skill calls | prediction秒 | yield秒 | Candidate生成 | cost |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| be881717 | 6.462 | 781 | 24836 | 155 | 12330 | 155 | 0.594 | 5.090 | 1 | 156 |
| e96249b4 | 27.283 | 1763 | 105077 | 342 | 52266 | 342 | 3.318 | 19.816 | 1 | 343 |
| 9733b090 | 10.381 | 3862 | 39262 | 215 | 18694 | 1 | 1.495 | 7.682 | 1 | 216 |
| 2e26c0b1 | 11.031 | 1414 | 39556 | 138 | 10205 | 139 | 1.002 | 8.983 | 1 | 139 |
| a6c17e25 | 2.276 | 550 | 8448 | 70 | 2856 | 71 | 0.321 | 1.740 | 2 | 71 |
| c140578c | 55.621 | 4305 | 192861 | 329 | 49119 | 330 | 5.824 | 42.828 | 2 | 330 |
| 57126a5e | 20.454 | 1621 | 72161 | 221 | 24136 | 222 | 3.376 | 14.804 | 1 | 222 |
| 27ac3237 | 10.819 | 1316 | 38511 | 161 | 12926 | 162 | 1.927 | 7.794 | 1 | 162 |
| a830a376 | 99.799 | 9351 | 317327 | 350 | 106153 | 783 | 18.514 | 66.361 | 2 | 783 |
| 02876df4 | 21.471 | 2454 | 72379 | 278 | 35949 | 279 | 6.308 | 12.515 | 1 | 279 |
| 8d233d8b | 2.903 | 649 | 10545 | 97 | 5123 | 98 | 0.961 | 1.665 | 1 | 98 |
| 46bf2c78 | 15.190 | 1249 | 50758 | 233 | 25220 | 233 | 5.067 | 8.375 | 1 | 234 |
| b27e57a7 | 36.878 | 3223 | 119215 | 350 | 58617 | 363 | 12.481 | 19.572 | 1 | 363 |
| b6780f04 | 1.084 | 378 | 3810 | 56 | 1818 | 57 | 0.401 | 0.587 | 1 | 57 |
| fea60316 | 6.894 | 1235 | 24090 | 155 | 11844 | 155 | 2.541 | 3.649 | 1 | 156 |
| 2378d3e0 | 69.339 | 4461 | 209827 | 350 | 103165 | 593 | 23.851 | 34.805 | 1 | 593 |
| 45b13c06 | 10.925 | 1323 | 38532 | 137 | 9977 | 138 | 2.313 | 7.596 | 1 | 138 |
| 711f7d15 | 18.322 | 1140 | 51830 | 337 | 50352 | 337 | 11.603 | 4.441 | 1 | 338 |
| 6c65c924 | 14.261 | 1162 | 34813 | 270 | 33380 | 270 | 9.036 | 3.436 | 1 | 271 |
| 188571a7 | 16.979 | 1426 | 54014 | 193 | 17925 | 194 | 4.890 | 10.076 | 1 | 194 |
| 813fb479 | 55.888 | 2350 | 103539 | 350 | 99688 | 1501 | 29.943 | 18.851 | 0 | 未発見 |
| 1efa01c6 | 6.751 | 701 | 20136 | 140 | 9848 | 141 | 2.770 | 3.250 | 1 | 141 |
| 86439c85 | 92.392 | 6580 | 216305 | 350 | 105944 | 581 | 32.028 | 47.248 | 1 | 581 |

### 上位ランキング

- elapsed: a830a376 (99.799)、86439c85 (92.392)、2378d3e0 (69.339)、813fb479 (55.888)、c140578c (55.621)。
- settled work: a830a376 (9351)、86439c85 (6580)、2378d3e0 (4461)、c140578c (4305)、9733b090 (3862)。
- normal prediction calls: a830a376 (350)、b27e57a7 (350)、2378d3e0 (350)、813fb479 (350)、86439c85 (350)。
- gogma prediction calls: a830a376 (106153)、86439c85 (105944)、2378d3e0 (103165)、813fb479 (99688)、b27e57a7 (58617)。
- skill prediction calls: 813fb479 (1501)、a830a376 (783)、2378d3e0 (593)、86439c85 (581)、b27e57a7 (363)。
- prediction elapsed: 86439c85 (32.028)、813fb479 (29.943)、2378d3e0 (23.851)、a830a376 (18.514)、b27e57a7 (12.481)。
- normal cross-Target duplicate calls: 2378d3e0 (340)、b27e57a7 (329)、86439c85 (193)、27ac3237 (161)、188571a7 (137)。
- gogma cross-Target duplicate calls: 86439c85 (2884)、be881717 (0)、e96249b4 (0)、9733b090 (0)、2e26c0b1 (0)。
- skill cross-Target duplicate calls: 27ac3237 (162)、a6c17e25 (71)、be881717 (0)、e96249b4 (0)、9733b090 (0)。


## Node yield診断

raw: [IMMEDIATE](PLANNER_GLOBAL_PHASE1_IMMEDIATE.json)。same Phase 0順・extentで、NodeのyieldだけをsetImmediateへ変更した。

timer / immediateのreportから時間field（末尾Ms）だけを除いた全内容が一致した。保持ID、各Searchのgenerated Candidate / Entry ID、全prediction call数・unique数・重複数、work / checkpoint / yield / Candidate生成数、boundary、全Planner集計・Replayまで同じ。

| 項目 | timer | immediate |
| --- | ---: | ---: |
| Search秒 | 613.403 | 283.521 |
| prediction秒 | 180.566 | 184.640 |
| yield待ち秒 | 351.163 | 4.579 |
| exact key集計秒 | 7.542 | 8.688 |
| その他残差秒 | 74.132 | 85.615 |
| 全Planner秒 | 56.251 | 59.819 |
| final Planner秒 | 33.367 | 30.007 |
| total秒 | 677.050 | 354.014 |
| peak maxRSS GiB | 2.989 | 3.082 |

両方42/43、Conflict2、rejected1、7,330 steps、Trace Replay passed。timer待ちの除去だけでもNode wall timeは大きく変わるが、immediateでも約354.014秒で、1〜2分級には届かない。これはBrowser高速化の実測ではない。

A / B / Cの切り分け: timer wall timeでは予測外が70.56%だが、その大半はNodeのyield待ちで、scheduler / composition CPUが支配したという解釈は誤り。immediateではpredictionがSearchの65.1%で**A（prediction計算）が主因**、残差85.615秒のBも副次的に残る。完成Candidateの生成は25回だけで、Candidate数爆発を主因とする証拠はない。Gogma streamのstate / trace / retention処理とGCを含む残差内訳は未測定。

## Route family比較

raw: [FOCUSED](PLANNER_GLOBAL_PHASE1_FOCUSED.json)。Phase 0 raw reportのelapsed上位4件と実際の未発見1件を選んだ。以下はすべて同一Targetの同一snapshot、Node immediate、1実験180秒budget、各実験は別process。

| Target | filter | status / canonical route | 秒 | work | prediction N / G / S | prediction秒 | cost |
| --- | --- | --- | ---: | ---: | --- | ---: | ---: |
| a830a376 | all | found / existing_gogma_mixed | 36.049 | 9351 | 350 / 106153 / 783 | 19.760 | 783 |
| a830a376 | existing_gogma | found / existing_gogma_mixed | 27.877 | 1785 | 0 / 100658 / 783 | 17.890 | 783 |
| a830a376 | normal_artian | found / normal_artian_to_gogma | 24.372 | 7570 | 350 / 105154 / 783 | 18.158 | 784 |
| 86439c85 | all | found / normal_artian_to_gogma | 37.480 | 6580 | 350 / 105944 / 581 | 26.705 | 581 |
| 86439c85 | existing_gogma | found / existing_gogma_mixed | 30.400 | 1262 | 0 / 102159 / 761 | 24.497 | 761 |
| 86439c85 | normal_artian | found / normal_artian_to_gogma | 33.091 | 5499 | 350 / 105944 / 580 | 26.752 | 581 |
| 2378d3e0 | all | found / normal_artian_to_gogma | 33.239 | 4461 | 350 / 103165 / 593 | 22.617 | 593 |
| 2378d3e0 | existing_gogma | found / existing_gogma_mixed | 27.953 | 1134 | 0 / 101127 / 633 | 22.046 | 633 |
| 2378d3e0 | normal_artian | found / normal_artian_to_gogma | 27.730 | 3368 | 350 / 102665 / 592 | 21.660 | 593 |
| c140578c | all | found / existing_gogma_mixed | 12.632 | 4305 | 329 / 49119 / 330 | 5.736 | 330 |
| c140578c | existing_gogma | found / existing_gogma_mixed | 10.824 | 1322 | 0 / 47264 / 330 | 5.560 | 330 |
| c140578c | normal_artian | found / normal_artian_to_gogma | 18.249 | 6372 | 350 / 104294 / 547 | 12.276 | 548 |
| 813fb479 | all | not_found_within_extent / — | 30.299 | 2350 | 350 / 99688 / 1501 | 24.413 | — |
| 813fb479 | existing_gogma | unavailable / — | 0.001 | 0 | 0 / 0 / 0 | 0.000 | — |
| 813fb479 | normal_artian | not_found_within_extent / — | 30.777 | 2350 | 350 / 99688 / 1501 | 24.905 | — |

allと最終採用family単独の時間差は観測できるが、差を厳密な「不採用family専用時間」とは呼べない。両familyはstreamを共有し、単独検索ではcanonical stop位置も変わるため、所要時間は加算できない。

a830a376は既存Gogma783操作 / Normal784、c140578cは既存Gogma330 / Normal548。一方86439c85はNormal581 / 既存Gogma761、2378d3e0はNormal593 / 既存Gogma633。**既存Gogmaを先に試してfoundで打ち切る方式は通常Searchのcanonical orderingを変える**。Productionへの適用には独立した仕様決定、または未探索familyがcanonicalを更新できないという下界の証明が必要。

canonicalまでの距離も効く。a830a376の採用advanceはGogma76 / Skill707、cost783で、allはGogma500まで予測する。低いBonus costだけでは全体の同cost drainを終えられない。これは「SkillをGogma状態ごとに再予測している」という意味ではなく、共有Skill streamとlower-bound queueの既存終了条件の結果である。

## 813fb479のbound sensitivity

同一snapshot（Normal207 / Gogma3153 / Skill3184、対応OwnedWeaponなし）を再利用した。baselineはallとnormal_artianの両方で未発見、existing_gogmaはunavailable。

| extent N / G / S | status | 秒 | work | prediction N / G / S | 観測reach N / G / S | boundary N / G / S-existing / S-conversion | Candidate cost / advance N・G・S |
| --- | --- | ---: | ---: | --- | --- | --- | --- |
| 350 / 500 / 1500 | not_found_within_extent | 30.299 | 2350 | 350 / 99688 / 1501 | 350 / 500 / 1501 | yes / yes / yes / yes | — / — |
| 700 / 500 / 1500 | found | 30.906 | 2562 | 700 / 100155 / 895 | 700 / 500 / 895 | yes / yes / no / no | 896 / 643・1・252 |
| 350 / 1000 / 1500 | not_found_within_extent | 121.052 | 2850 | 350 / 336141 / 1501 | 350 / 1000 / 1501 | yes / yes / yes / yes | — / — |
| 350 / 500 / 3000 | not_found_within_extent | 30.109 | 3850 | 350 / 99688 / 3001 | 350 / 500 / 3001 | yes / yes / yes / yes | — / — |

**Normal350→700だけで発見できた。** Candidateはnew Normal起点、896操作（Normal643 / Gogma1 / Skill252）。採用Normalはabsolute Counter849（207 + 643 − 1）。Gogma / Skillの設定を広げる必要はなかった。Gogma1000だけ、Skill3000だけではそれぞれextent内未発見だった。

したがって、この固定stateに対して試した範囲ではNormal extent不足が具体的な障害であり、単なるtimeoutやSkill extent不足ではない。Normal643が候補として使われたことは、643が発見可能性の最小閾値である証明ではない。Gogma1000超やさらに別の組合せに解がないとも主張しない。単軸Normal拡大で発見できたので、複数軸同時拡大・次段階の巨大extentは実施しなかった。

focused実験はCandidate Searchまでで、各拡大候補を全43 TargetのPlanに採用する実験ではない。最終共存・Trace Replayは次のorder variantのfull Plannerで別に検証する。

## memoryとcancel

focused suiteの最大process maxRSSはbound-0-gogmaの3,001,848 KiB（2.863 GiB）。全bound実験は180秒以内に終了した。メモリによる停止、OOM、強制killはなかった。

| 試行 | 設定 | 結果 | Search ms | cancel検出→return ms | settled work |
| --- | --- | --- | ---: | ---: | ---: |
| deadline | Search budget100ms | time_budget_reached | 100.183 | 0.182 | 0（下界） |
| external cancel | runner cancel-after100ms | cancelled | 94.739 | 0.113 | 0（下界） |

100ms deadlineの証跡は[DEADLINE](PLANNER_GLOBAL_PHASE1_DEADLINE.json)。未完了work数はlast progressの下界であり、どちらも候補なしとは分類しない。Browser UI / Workerのcancel応答性は未測定。

FOCUSEDの`deadline-0`はCLIでbudgetが二重指定された初期試行で、実際の記録値は180000msである。これはbaseline再試行として保持し、deadline測定には使わない。上の100ms試行を別pathで実行した。runnerは二重optionを実行前に拒否するようにし、回帰テストを追加した。


## order sensitivity

raw: [FAILED_FIRST](PLANNER_GLOBAL_PHASE1_FAILED_FIRST.json)。比較対象は同じNode immediateのPhase 0順。元PlannerInput fingerprint・保持20 Entry IDが一致し、残りは実際の未発見Targetだけを先頭へ移した順と完全一致した。

813fb479はbaseline extent内でfound。Search 11.925秒、new Normal起点1,030操作（Normal207 / Gogma1 / Skill822）。その後の22 Targetは21 found / 1 not_found_within_extentで、**未発見が711f7d15-bb2b-4113-af0c-bd1832dcfd49へ移った**。よって単一の順序変更で43/43を達成したわけではない。

| 項目 | Phase 0順 immediate | failed-first immediate |
| --- | ---: | ---: |
| retained | 20 | 20 |
| found / 23 | 22 | 22 |
| final completed | 42 / 43 | 42 / 43 |
| final Conflict / rejected | 2 / 1 | 2 / 1 |
| final steps | 7,330 | 6,214 |
| Trace Replay | passed | passed |
| Search秒 | 283.521 | 141.032 |
| prediction秒 | 184.640 | 89.853 |
| settled work | 53294 | 37176 |
| Gogma prediction calls | 857535 | 628532 |
| 全Planner秒 | 59.819 | 37.343 |
| final Planner秒 | 30.007 | 18.261 |
| total秒 | 354.014 | 184.863 |
| peak maxRSS GiB | 3.082 | 2.882 |

順序で発見可能性、探索仕事量、prediction単価、総stepsが変わる。元の失敗は固定stateではNormal bound拡大で救え、異なるProjected stateでは同じboundで救える。**「Normalの既定値を700にすればよい」「このIDを先頭にすればよい」ではなく、Global discoveryがTarget順序に敏感で単一greedy orderでは不十分、という観察である。**

両方のfinal Conflictはsame_normal_counter1 / same_skill_counter1。未発見Targetの元Entryも残したため、分母43を隠していない。全43共存解は既知oracleで存在するが、Phase 1-Aのvariantでは未達。2,982 steps oracleを今回の探索入力・順序・Counterへ利用していない。

## Phase 1-Bの推奨

**最初は、Gogma prediction内部の同一raw RNG block取得を再利用する、小さなResearch-only実験に絞る。**
cross-Targetの完成prediction cacheではない。先に1回のdiscoveryを安くし、次のordering / retryを
現実的なbudgetで比較できるようにする。Productionへcacheを追加する判断は本研究では行わない。

根拠は次のとおり。

1. timerを除いたPhase 0順でもSearch283.521秒中prediction184.640秒。timer profileでは
   Gogma predictionだけで178.673秒あり、Normal0.279秒 / Skill1.614秒より圧倒的に大きい。
2. 既存Target内memoはResetをCounterごと、KeepをCounter + ordered family layoutごとに共有する。
   これを無いものとして扱わない。その内側で、Production `gogmaPrediction.ts` は異なるKeep layoutの
   predictionにも同じ`referenceGogmaBlock()`を呼び、`referencePrng.ts`の`readReferenceRngBlock()`は
   毎回PRNGを初期化して`blockIndex * 10`回進める。例えば未発見TargetのbaselineはGogma500位置に
   99,688 prediction calls。このTarget内ではseedが一定なので、raw blockは高々500種類である。
   **これはコードとcall数からの再利用余地の推論で、raw block関数単独の所要時間は未測定**。
3. 完成predictionのexact keyはKeepのcurrent slotsなどが違うため、Gogmaのcross-Target duplicate率は
   0.336%しかない。raw blockの共有とprediction結果全体のcacheは異なる問題である。
4. order variantは元の失敗を救い、Searchを283.521→141.032秒へ減らしたが、別Targetが未発見になった。
   複数順序・retryは必要な検討対象であり、その前に同じ重いpredictionを何度も払うコストを減らす価値がある。

Phase 1-Bでまずraw block時間を分けて測定し、支配性を確認してから限定寿命・上限付きの再利用を試す。
keyはraw関数の完全な意味（Engine / core version、実際にderiveしたseed、effective block index）を
満たす必要がある。Target IDやCounterだけでは不十分。support / input validation、slot順、uint32、
Gate policy、抽選pool、draw処理、Counter進行は従来のauthorityをそのまま通す。完成結果の予測を
別algorithmで再実装せず、cacheは成功したpure raw blockだけを再利用する。
Candidate、generated Entry、Plan body、Trace Replay、例外、cancel、memoryをcache on/offで比較し、
bit-for-bit parityを確認する。これらは**次Phaseの検証計画であり、Phase 1-Aでcacheを実装したという意味ではない**。

### 各候補の評価

| 候補 | 期待効果・今回の根拠 | correctness risk | memory risk | Production contractへの影響 | 優先度 |
| --- | --- | --- | --- | --- | --- |
| cross-Target exact prediction memo | Normal26.265%だが全Normal予測0.279秒、Gogma0.336%・Skill3.261%。最大の律速には効きにくい | input全体・Engine/Masterを欠くkey、mutable result再利用 | 全keyを保持すると大きい。profileだけでもpeak約3GiB | parityが成立すれば意味変更不要、寿命設計が必要 | 今回cache実験なし、後回し |
| Route family staged Search | allと採用family単独に差。ただし86439c85は既存761よりNormal581が安い | first-found終了でcanonicalを変える。共有streamと同cost tieを維持する証明が必要 | 分離runで同じstreamを重複保持し得る | staged打切りなら正式契約に影響。現行順序を維持する下界最適化とは区別 | そのまま採用しない |
| queue / composition / stream処理最適化 | 53,294 workに対し1,847,832 checkpoints。Candidate生成25回。immediate残差85.615秒 | frontier代表、retention、trace、tie drainを壊す可能性 | prefix / trace配列削減には余地、実測内訳は未測定 | 結果同値なら意味変更不要 | 次のCPU / allocation profile候補 |
| Target ordering / bounded retry | 元失敗を救済、別Targetが失敗。Search半減、steps7,330→6,214 | 単一greedy不十分。循環・budget消費・固定ID化を避ける | 複数snapshot / Planの同時保持を制限 | Productionの自動discoveryには正式契約が必要 | 予測高速化後の次のResearch候補 |
| 複数Candidate / top-K portfolio | canonical1件・単一順序の制約はあるが、Kの効果は未測定 | canonical API変更、候補identity・共存判定の拡張 | K倍のRoute / trace保持 | 現行通常Searchは1件。新contractが必要 | 未測定、先行実装しない |
| Search + Planner dynamic discovery | 前段の空きCounterを使えないPhase 0制限を解ける可能性。今回の比較実験なし | reservation / sharing / trace / termination全体に及ぶ | 探索状態の組合せ増大 | 大きな正式設計が必要 | 今回の次の小実験にはしない |
| 上記を一括実装 | 個々の寄与を分離できなくなる | 複数contractが同時に変わる | 複合して増える | 大規模変更になる | 採用しない |
| **同一raw block再利用** | **Gogma predictionが最大の計算時間、同じ500 blocksに99,688 calls**。内部時間の直接計測は次Phase | seed / effective block / uint32 / validationの同値性が必須 | Target / runに寿命を限定し、読み取ったblock数で上限化できる。実測は未実施 | bit-for-bit同値を条件とし、RNG意味・Counter・Search APIを変更しない | **Phase 1-B最初のResearch実験** |

### 1〜2分級の見通し

現状の実測はPhase 0順immediateで354.014秒、failed-firstで184.863秒であり、どちらも42/43。
仮にprediction時間をすべて0にするという非現実的な引き算でも、前者は約169.374秒、後者は約95.010秒
残る。これは実装後の性能予測ではなく、他のコストも無視できないことを示す上限効果の目安である。
failed-firstのような順序改善とpredictionの改善で近づく可能性を調べる価値はあるが、43/43を得るまでの
retry回数・追加Search・Browser Worker性能が未測定なので、**全43完成のGlobal discovery + final Plannerが
1〜2分で実現可能とはまだ断定しない**。Node timer除去だけの数字をProduction高速化として約束しない。

## 未確認事項

- Browser Workerの実測、複数回の分布、ゲーム実機の追加検証。
- raw block取得時間単独、Gogma draw / support判定 / state処理 / GCそれぞれのCPU・allocation内訳。
- 内部cache hit、queue終了量、全composition数、最初のIdeal発見時点と同cost drain量。
- 全43の自動発見、global optimum、Normal643の最小閾値、複数axis同時拡大、別のordering / retry。
- focused拡大で得た896操作Candidateを含む全43 Planの作成。
- cache実装とそのparity・メモリ効果。Phase 1-Aではcacheを実装していない。
- 同期Planner Replay / projection中のcancel、Browser UI応答性。

「extent内未発見」「time budget内で未確認」「利用不可」「計算例外」は同一視しない。
今回のfocused実験でNormal拡大が成功したことも、Production defaultや自動拡大policyの決定ではない。

## 検証

- `npm run lint`: passed。
- `npm test`: 292 files / 4,744 tests passed。
- `npm run build`: passed。既存の大きいbundleに対するVite chunk size warningあり。
- `npx tsc -b --force`: passed。
- Phase 1 focused Vitest: 3 files / 18 tests passed。
- `git diff --check`: passed。

syntheticではPhase 0 defaultとprofile付きのreport（観測値を除く）・generated Entries・final Planが
完全一致する。Candidate Searchの結果・interleaved prediction call sequence・input / return参照・例外、
exact keyの決定性、route / boundのsnapshot隔離、cancel分類、観測された失敗だけによるstable ordering、
ProductionからResearchへのimport禁止、出力pathの衝突・上書き拒否を回帰テストで検証した。
