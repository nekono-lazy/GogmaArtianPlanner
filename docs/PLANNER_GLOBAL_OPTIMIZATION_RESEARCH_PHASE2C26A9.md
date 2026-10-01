# Global Planner Research Phase 2-C2.6-A9（frontier_reduction_sort hotspotへの最初のProduction optimization）

Refs #154。A8 formal RESULT（Case S、`S_stable_serialization_dominant`）で確定したhotspot
（`generateReservedDepth` → `compareReservedRepresentative` → `stableStringify` → `serializeStable`）に対して、
**1 hotspotに1 optimization**だけをProductionへ入れ、A8 primaryと同条件で効果をformalに再計測した。

- Production変更: `src/domain/search/bonusStream.ts` の held-aware `compareReservedRepresentative()` のみ（§2）
- measured HEAD: `a89b388`（Production変更・計測基盤・事前登録decision ruleを含むclean HEAD）
- analysis HEAD: `5f487cf`（analyzerのsummary表示だけをpost-hoc修正。分類・validity・decision rule・比較対象setは不変。§9）
- RESULT: [`docs/PLANNER_GLOBAL_PHASE2C26A9_RESULT.json`](PLANNER_GLOBAL_PHASE2C26A9_RESULT.json)（`provenance.formal = true`）

## 1. 結論

**事前登録rule（§6）の判定: Case O（`O_optimization_adopted`）。**

- semantic parity: primary 3件すべてで、A8 formal raw（SHA-256一致を確認）との共通prefixが一致（completed work、
  held-aware depth、lifecycle event、direct timing prefix）。mismatch 0件。
- A8でprofile validだった2件（c6-p1、c14-p0）で、`representative_stable_serialization` shareが65.9% / 67.7% → **0.06% / 0.01%**。
- 同じ2件で、共通prefixの`frontier_reduction_sort`直接時間 / representative比較回数が **0.132倍 / 0.143倍**（約7〜7.6倍速）。
- A9のCPU profileはnegative timeDelta 0件で3件ともprofile valid（A8でinvalidだったc13-p1を含む）。
- c6-p1とc14-p0は30分budget内でSearchとkernelが完走した（A8では3件ともtimeout）。完走した2件はいずれも
  `search_completed`（deliveredCandidates 0、`stoppedByExtent: true`）→ `target_completed: stopped_by_search_extent_bound`。

→ optimizationを採用する。次は54 orientation再評価へ進む候補（§8）。

### 1.1 stable serialization share（frontier_reduction_sort interval内sampleに対する割合）

| orientation | A8 profile | A8 share（before） | A9 profile | A9 share（after） | A9 negative timeDelta | A9 frontier sample |
| --- | --- | ---: | --- | ---: | ---: | ---: |
| c6-p1 | valid | 65.9% | valid | **0.06%** | 0 | 7,927 |
| c13-p1 | **invalid**（negative timeDelta 1） | —（正式なbeforeとして使わない） | valid | 0.03%（A9単独のafter値） | 0 | 7,196 |
| c14-p0 | valid | 67.7% | valid | **0.01%** | 0 | 8,080 |

c13-p1のA8 profile share（66.0%）はinvalid profileの記述値で、RESULTでも`a8InvalidProfileDescriptive`として分離し、
before / after比較・decisionには入れていない。

A9 frontier interval内sampleの構成（A8分類ruleのまま）:

| orientation | stable serialization | representative compare / inlined | frontier sort | reduction loop / inlined | gc | other |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| c6-p1 | 0.06% | 2.4% | 1.4% | **85.5%** | 7.4% | 3.4% |
| c13-p1 | 0.03% | 1.8% | 1.6% | **88.0%** | 6.2% | 2.3% |
| c14-p0 | 0.01% | 2.3% | 1.5% | **88.2%** | 6.2% | 1.8% |

frontier interval自体がprofile全体に占める割合も、A8の43〜51%からA9では12〜14%へ下がった（sample shareは構成比であり、
速度向上率ではない。速度は§1.2の直接時間で見る）。

### 1.2 frontier_reduction_sort 直接時間（A8 / A9の共通prefix、同一work）

共通prefix = 両runで identity（Target / stream / start / depth / exhausted / counts）が一致する先頭の held-aware depth record。
A9はA8より先へ進んだため、共通prefixは事実上A8の30分run全体のworkに等しい。

| orientation | common depths | representative比較回数 | A8 frontier ms | A9 frontier ms | A8 ns / 比較 | A9 ns / 比較 | ratio |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| c6-p1 | 765 | 346,454,898 | 959,509 | 126,275 | 2,769.5 | 364.5 | **0.132** |
| c13-p1 | 313 | 419,635,231 | 880,449 | 129,735 | 2,098.1 | 309.2 | 0.147（記述） |
| c14-p0 | 589 | 386,429,131 | 930,623 | 133,262 | 2,408.3 | 344.9 | **0.143** |

他のheld-aware section（window_collection、support_evaluation、state_generation、solution_materialization、exhaustion_scan）の
共通prefix比は0.93〜1.17で、変化は`frontier_reduction_sort`に限られる。

Search側（A6 work prefix、共通prefix）:

| orientation | bonus_depth_read A8 → A9 | ratio | ns / raw solution A8 → A9 | 共通prefixのspan ratio |
| --- | --- | ---: | --- | ---: |
| c6-p1 | 1,662,477 ms → 826,270 ms | 0.497 | 4,615 → 2,294 | 0.535 |
| c13-p1 | 1,629,980 ms → 911,579 ms | 0.559 | 3,818 → 2,135 | 0.598 |
| c14-p0 | 1,647,351 ms → 843,339 ms | 0.512 | 4,148 → 2,123 | 0.552 |

### 1.3 進行量・child outcome・memory

| orientation | child outcome A8 → A9 | completed depths A8 → A9 | generated states A8 → A9 | 比較回数 A8 → A9 | 最大heapUsed A8 → A9 |
| --- | --- | ---: | ---: | ---: | ---: |
| c6-p1 | timeout → **completed**（1,243.7 s） | 765 → 1,872 | 360.2 M → 411.5 M | 346.5 M → 384.6 M | 4.55 GB → 4.50 GB |
| c13-p1 | timeout → timeout | 313 → 572 | 426.9 M → 669.1 M | 419.6 M → 656.4 M | 5.12 GB → 5.15 GB |
| c14-p0 | timeout → **completed**（1,799.6 s） | 589 → 2,097 | 397.2 M → 602.5 M | 386.4 M → 571.2 M | 4.82 GB → 4.88 GB |

OOM 0、process failure 0、contract violation 0。deliveredCandidates / trialsStarted / fullPlannerRunsStartedは3件とも0。
完走した2件は、extent（Gogma 235）内でAlternative Candidateが見つからずSearchがextentで止まったという結果で、
route qualityの改善はこのPhaseの対象外（§7）。

## 2. Production変更

対象は `createTargetBonusStream()` 内の held-aware `compareReservedRepresentative()` だけ。

```ts
const reservedBonusStableKeys = new WeakMap<RestorationBonusSet, string>()

function reservedBonusStableKey(bonuses: RestorationBonusSet | null): string {
  if (bonuses === null) return stableStringify(null)
  const cached = reservedBonusStableKeys.get(bonuses)
  if (cached !== undefined) return cached
  const key = stableStringify(bonuses)
  reservedBonusStableKeys.set(bonuses, key)
  return key
}

function compareReservedRepresentative(left: ReservedBonusState, right: ReservedBonusState): number {
  return (
    right.lastResetDepth - left.lastResetDepth ||
    compareStableKeys(reservedBonusStableKey(left.bonuses), reservedBonusStableKey(right.bonuses))
  )
}
```

- cacheの寿命: `createTargetBonusStream()` instance-local。globalにしない。`WeakMap`なのでBonus set objectの寿命を延ばさない
- key: `RestorationBonusSet` object identity
- value: 従来の `stableStringify(bonuses)` 文字列そのもの（hash / short keyにしない）
- lazy: `lastResetDepth` が同値で文字列比較が必要になった時だけ計算。state生成時のeager serializationやstate fieldの追加はしない
- cache hit時は再serializationしない。`stableStringify()` 本体は不変
- ordinary streamの `compareRepresentative()` は変更していない（効果を分離するため）

### 2.1 object identity cacheで良い根拠（実コード確認）

- `predictReset()` はGogma Counter単位、`predictKeep()` は `(position, familyLayoutKey)` 単位でprediction結果をMapにmemoし、
  hit時は同じobjectを返す
- held-aware generated state（`reservedGeneratedState()`）の `bonuses` は、そのprediction結果objectを直接参照する
- Search / Plannerのsrcにprediction結果のBonus setを書き換えるcodeは無い（in-place `sort` / 代入 / `splice` 等をgrepで確認。
  該当はtest fixture作成時の新規配列と、別配列への`map(...).sort()`のみ）

したがって同一objectのserializationは常に同じ文字列で、cacheは比較結果を変えない。

### 2.2 不変のsemantic

representative rule（`lastResetDepth`降順、同値なら従来`stableStringify`文字列の`compareStableKeys`昇順。multiset keyではない）、
slot order、`familyLayoutKey`、frontier key（position + familyLayoutKey）、Map reduction、`compareReservedFrontier`とfrontier順序、
generated stateの集合・順序、raw solution、canonical amendment history、Reset / Keep prediction semanticsとmemo key、
reservation window、Candidate semantics、Search ordering、extent、Planner bounds、RNG、schema / version、Persistence、UIは変更していない。

## 3. regression test

`src/domain/search/reservedBonusStreamRepresentative.test.ts`（実streamの挙動から検証。Production observer seamやprivate comparatorの
exportは追加していない）:

- reservationあり / なしの既存全case（`reservedBonusStreamCases`）で、depth d+1の全stateの親（result history `previous`）が、
  depth dのraw solutionから従来rule（`lastResetDepth`、同値なら`stableStringify`文字列）で求めた代表だけであること
- 同じposition（Gogma 12）・同じfamily layout・同じ`lastResetDepth`でtierだけ違う2 stateのfixtureで、stable serializationが
  小さい方が代表になり、生成順（先 / 後）に依存しないこと。2 stateともreduction前にraw solutionとしてpublishされること
- 大きい`lastResetDepth`がserializationより先に勝つこと
- 比較の向きを逆にする変異でtie-break testが失敗することを確認済み（mutation check、commitには含めない）

既存の`reservedBonusStreamSinglePass.test.ts`（pre-D2-d stream凍結record）もそのまま通過する。

## 4. 条件（A8 primaryと同一）

fresh Node child per orientation、heap 8,192 MB、concurrency 1、budget 30分、retryなし、`setImmediate` yield、
extent Normal 4 / Gogma 235 / Skill 4、bounds `maxCandidateTrialsPerTarget = 2` / `maxPlannerReruns = 8`、`maxPlanSteps = 20,000`、
Search instrumentation `onSearchRuntime = true` / `onGogmaReservedRuntime = true` / 他false、
CPU profiler 要求間隔10,000 µs、Search開始 +120 s 〜 +720 s（600 s）、JIT default。no_inlining diagnosticは実行していない。

runnerとanalyzerの両方で、A8 conditions（A7〜A2へchain）との一致をfail-closedに確認した（`conditionParity.valid = true`）。

環境: Node v24.19.0（V8 13.6.233.17）、Windows 11（10.0.26200）、AMD Ryzen 7 9700X、32 GB。

## 5. authorityとselection

- A8 formal RESULTをselection / before authorityとし、C2.6-A〜A7 RESULTとA7 rawへのSHA chainをfail-closedで検証した
- primaryはA8 `selectionValidation.expected`（= A7のselection）から機械的に導出（source内にIDは固定しない）: c6-p1、c13-p1、c14-p0
- profile shareの正式before / after比較対象はA8 `summary.decision.validPrimaries`（c6-p1、c14-p0）
- A8 formal raw（`PLANNER_GLOBAL_PHASE2C26A8_R2_RAW.json.local`）はA8 RESULTの`sources.run.sha256`と一致した場合だけ使用（一致）
- A8 measured HEAD（`32c582c`）からのProduction calculation source変更が登録済みの`src/domain/search/bonusStream.ts`ちょうど1件であること、
  measured HEADのsourceに登録したoptimizationがあることを、runner（working tree）とanalyzer（git再導出）の両方で確認した

## 6. 事前登録decision rule（measured HEAD `a89b388`で固定）

- profile validity: A8 ruleのまま（complete capture、clock alignment、interval reconstruction、**negativeDeltas = 0**（補正なし）、
  frontier sample ≥ 5,000、登録関数の宣言行一致、comparator区間外sample ≤ 1%）
- semantic parity: 全3 primaryでA6 completed-work prefix、A8 held-aware depth prefix、lifecycle prefixが有効、direct timing prefixにmismatchなし
- 判定順:
  1. N（semantic mismatch）: いずれかのprimaryでsemantic parityが不成立
  2. **O**: 比較対象set（A8-valid primary）の全件で、A9 profile validかつ serialization share ≤ **0.5 ×** A8、
     かつ共通prefixのfrontier ns / representative比較 ≤ **0.75 ×** A8
  3. N（regression）: 比較対象のいずれかでfrontier ns / 比較 > 1.0 × A8
  4. N（no effect）: serialization share低下またはdirect時間低下が比較対象に1件も無い
  5. P: それ以外

閾値0.5 / 0.75はformal run前の設計判断として登録したもので、計測後に変更していない。

## 7. 言えること / まだ言えないこと

formalに言えること:

- このoptimizationはrepresentative選択・generated state・raw solution・Search進行を変えずに（共通prefixで完全一致）、
  A8で66〜68%を占めたstable serializationをほぼ消した（0.01〜0.06%）
- `frontier_reduction_sort`の直接時間は同一workで約1/7（0.13〜0.15倍）、`bonus_depth_read`は約1/2（0.50〜0.56倍）になった
- 30分で処理できたheld-aware depthは1.8〜3.6倍（c6-p1 / c14-p0は完走、c13-p1は572 depth）に増えた
- cache helper frameを含むsampleはfrontier sampleの1.0〜1.6%で、そのうちserializationを伴う（cache miss）sampleは1〜5件だった

まだ言えないこと:

- 54 orientation全体での効果、completed orientationの割合（再評価は次Phase）
- Search完了までの総時間・route quality（完走した2件はextent内でCandidate 0件。quality改善はこのPhaseの対象外）
- Browser Worker・他device・他heap条件での効果
- run間ばらつき（各orientation 1回のみ）

## 8. 次Phase recommendation

Case Oの登録recommendationどおり、**optimizationを採用し、54 orientation再評価へ進む候補**とする。

参考（記述値、decision外）: A9後の`frontier_reduction_sort` interval内では`reduction_loop_or_inlined`（key生成・Map操作・loop・
frontier配列materialization・sort builtin・inline部分。CPU profilerでは分離できない）が85〜88%を占める。
ただし区間自体がprofileの12〜14%に縮んだため、held-aware depth全体で見ると共通prefixでは`state_generation`
（c6-p1で約491 s、`frontier_reduction_sort`の約3.9倍）が最大sectionになった。54 orientation再評価の前に次hotspotを
確認するかどうかは次Phaseで判断する。

## 9. provenance

- measured HEAD `a89b388`（Production変更・benchmark・analysis rule・testをformal run前にcommit、clean tree、smokeなし）
- formal raw: `PLANNER_GLOBAL_PHASE2C26A9_RAW.json.local`（46,806,775 bytes、SHA-256 `8e14d247…a01013`、Git管理外）、
  CPU profileとscript tableは`PLANNER_GLOBAL_PHASE2C26A9_PROFILES.local`（各child記録のSHA-256と一致を確認）
- analysis HEAD `5f487cf`: formal run後、`scripts/analyze-planner-global-phase2c26a9.mjs`だけをpost-hoc修正した。
  `summary.byPrimary.serializationShare.a8`にA8 profile invalidのprimary（c13-p1）のshareを出さない（`a8InvalidProfileDescriptive`
  へ分離）ことと、lifecycle event種類・完走kernelのsearch / target outcomeの記述値追加のみ。分類・profile validity・
  decision rule・比較対象setは不変（RESULT `provenance.analysisCodeChangedSinceMeasuredHead`に記録）
- 非formal smoke（c6-p1、budget 120 s、短縮window、未commit）はpipeline確認だけに使い、結果には使っていない
- `npm test`の初回full実行で`src/components/rng/IdentificationWizardDialog.test.tsx`が並列負荷下のtimeoutで失敗したが、
  単独実行（58件）と再度のfull実行（330 files / 5,396 tests）は全件通過した。formal runは他の負荷が無い状態で実行した

## 10. limitations

- Node child（Vite SSR loader）のみ。Browser Workerは測っていない
- 各orientation 1回のみ（retryなし）。profile windowはSearch開始後120〜720秒の1区間
- A8 / A9ともCPU profilerが同じwindowで動く。共通prefixの直接時間比較では、A9が同じworkへ早く到達するため、
  profiler区間が対応するworkは両者で一致しない（overheadは小さいが厳密に同一条件ではない）
- CPU sample shareは区間内構成比であり速度向上率ではない。速度は直接section時間で比較した
- negative timeDeltaを含むprofileはprofile-based decision inputから除外する（A9では0件）。timestamp補正はしない
- `reservedBonusStableKey`はA8の登録関数ではない。cache missのserializationは`representative_stable_serialization`、
  lookupは`representative_compare_or_inlined`に入る（A8 ruleのまま）。helper frame件数は記述的集計のみ
- WeakMap get / set等のbuiltinやJIT inlineで関数境界が失われたsampleは`*_or_inlined`に入る

## 11. 検証

- focused: `reservedBonusStreamRepresentative.test.ts`（15）、`reservedBonusStreamSinglePass.test.ts`、
  `plannerGlobalPhase2C26A9.test.ts`（17）、既存C2.6-A〜A8 Research test（152）
- `npm run lint`、`npx tsc -b --force`、`npm test`（330 files / 5,396 tests）、`npm run build`、`git diff --check`
