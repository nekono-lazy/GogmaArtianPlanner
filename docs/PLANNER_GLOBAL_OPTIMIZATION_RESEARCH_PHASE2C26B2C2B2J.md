# Global Planner Research Phase 2-C2.6-B2-C2B2J（held-aware Keep family layout key再利用と正式before / after効果確認）

Refs #154。B2-C2B2I（`B2C2B2I_ADOPTED`）のafter profileでregistered inclusive 7.86 %を占めた `keepFamilyLayoutKey()` に対し、
**Production optimizationを1つだけ**入れ、B2-C2B2Iと同一Search inputでformal before / after効果確認を行ったPhase。

- 起点main: PR #209 merged `9ae3f2af2d11844a13aa30e96df0a788a0a2ad12`（Planner Alternative系fake KeepのRNG_SPEC 6.1準拠化、test / fixtureのみ）
- measurement HEAD: `4ed9fb9ff93490f04178c50844b9eb5e2e95fb8e`（Production optimization + regression test + 計測コード + 事前登録decision ruleをformal run前にcommit）
- analysis HEAD: `4ed9fb9ff93490f04178c50844b9eb5e2e95fb8e`（measurement HEADと同一。`calculationCodeChangedSinceMeasuredHead = []`）
- RESULT: [`docs/PLANNER_GLOBAL_PHASE2C26B2C2B2J_RESULT.json`](PLANNER_GLOBAL_PHASE2C26B2C2B2J_RESULT.json)（**`provenance.formal = true`**、`evidenceGrade = formal`、
  decision **`B2C2B2J_ADOPTED`**、invalid reason 0、after profile quality issue 0）
- before authority: B2-C2B2I RESULT `ad877e1efd53b893ee48f9b9bc3747f51d4a278890a0dd7f96530d4bb4a1e4d4`（formal、`B2C2B2I_ADOPTED`、measured HEAD `8f34b97`）

## 0. 位置づけとlimitation

- 変更したProduction calculation sourceは `src/domain/search/bonusStream.ts` の `reservedGeneratedState()` signatureと、その2つのcall site（Reset / Keep）だけ
  （optimization ID `reserved_keep_family_layout_key_reuse_v1`）。`predictKeep()` nested memo（B2-C2B2I）、frontier reduction側の
  `${state.position}\u0000${state.familyLayoutKey}`、`compareReservedRepresentative()`、`reservedBonusStableKey()`、`keepFamilyLayoutKey()` /
  `keepFamilyLayout()` / `keepFamilyOfBonus()`、ordinary streamの `toState()`、`solution_materialization`、checkpoint / yield頻度、Search algorithm、extent、
  context、P1、Planner、RNG、UI、schema、persistence、fixture、frozen JSONは変更していない。新しいProduction instrumentation seamもない。
- Search inputはB2-C2B2I（= B2-C2B2H）と同一のoracle-guided diagnostic入力（t02、B2-C1 first compatible context × tight extent）。Production scheduler /
  extent selectionのevidenceではない。Route exact / Candidate有無はdecisionに使わない（`routeExactJudged = false`）。
- 速度の正式根拠は「semantic-identicalな共通held-aware depth prefixの `state_generation` section時間」の直接比較だけ。CPU sample shareはtarget関数の
  消失確認であり、速度向上率としては扱わない。GC / heap / RSS / whole-run progressは記述値。
- before / afterとも各1 run（ばらつき未評価）。Node / Vite SSRでの計測で、Browser Workerの計測ではない。

## 1. 結論

| 軸 | 値 |
| --- | --- |
| decision | **`B2C2B2J_ADOPTED`**（semantic parity valid、両profile valid、keepFamilyLayoutKeyShareRatio ≤ 0.50、stateGenerationDirectRatio ≤ 0.95） |
| PR #209 regression gate | B2J変更込みで9 files / 201 tests全pass（以前の27 failureは再発せず）。fixture / frozen JSONは無変更 |
| semantic parity | B2-C2B2I formal runのheld-aware depth record **480件全て**とB2-C2B2J runの先頭480件が完全一致（first mismatchなし）。Search input / excluded Route identityも一致 |
| **stateGenerationDirectRatio** | **0.5713**（共通480 depth、生成state 842,597,754：B2-C2B2I 811,888 ms → B2-C2B2J 463,867 ms、**−42.9 %**） |
| ns / generated state（記述） | 963.6 ns → 550.5 ns |
| **keepFamilyLayoutKeyShareRatio** | **0.0025**（registered inclusive active share 7.857 % → 0.020 %、2,162 → 4 samples。残りはReset pathの計算） |
| GC（記述） | 5,991 samples / 21.77 % → 4,079 samples / 20.17 %（単一run、改善とは断定しない） |
| outcome | 両runとも30分budgetでtimeout（正常outcome、Candidate 0扱いしない）。B2-C2B2I 480 depth / 8.43億state → B2-C2B2J 624 depth / 10.29億state（記述値） |
| memory | peak heap 7.52 GB → 7.53 GB、peak RSS 8.13 GB → 8.20 GB（記述値、ratio 1.001 / 1.008） |
| recommendation | **optimizationを採用**。追加micro-optimizationの前にIssue #154本筋へ戻る（§8） |

## 2. Production optimization

```text
src/domain/search/bonusStream.ts  generateReservedDepth() / reservedGeneratedState()
  old  reservedGeneratedState(depth, lastResetDepth, bonuses, previous, position, counterAfter)
         familyLayoutKey: keepFamilyLayoutKey(bonuses, input.master)   ← Reset / Keep 全generated stateで毎回計算
  new  reservedGeneratedState(depth, lastResetDepth, bonuses, familyLayoutKey, previous, position, counterAfter)
         Reset:  keepFamilyLayoutKey(resetResult, input.master) をcall siteで計算して渡す
         Keep:   親 state.familyLayoutKey をそのまま渡す（predictKeep() に渡したものと同じkey）
```

- 根拠は `docs/RNG_SPEC.md` 6.1：Keepはordered five slotsのfamilyをslotごとに保持し、同family内のtierだけを再抽選する。したがって
  `keepFamilyLayoutKey(keepResult) === keepFamilyLayoutKey(currentBonuses) === 親familyLayoutKey`。値は同一で、再計算だけがなくなる。
- Keep prediction入力・結果、key定義（ordered、Normal-side typeはMaster mappingで正規化）、slot order、rank、Reset挙動、Production RNG / RNG version、
  Search ordering、frontier grouping、representative、result history、Candidate semanticsは不変。
- held-aware pathだけを変更。ordinary streamの `toState()` は対象外（変更していない）。

## 3. semantic parity（performanceより先に判定）

| 項目 | 方法 | 結果 |
| --- | --- | --- |
| 1. PR #209 regression gate | `reservedBonusStreamSinglePass` / `reservedBonusStreamRepresentative` / Planner Alternative `IdealOnlyPublication` / `IdealPublication` / `Frontier` / `Reservation` / `Search` / `predictKeepNestedCache` / `bonusStreamIndependence` をB2J変更込みで実行 | 9 files / 201 tests pass |
| 2. B2-C2B2Iとのcommon depth prefix | B2-C2B2G collectorで両runのdepth recordを収集し、stream / start counter / depth / exhausted / frontier before / legal positions / generated / frontier after / window memoを比較 | 480 / 480一致 |
| 3. held-aware solutions / Engine call / Candidate order / termination / RNG output | PR #209で再記録したfrozen record（pre-D2-d single-pass、Planner Alternative publication）とB2-C2B2I frozen record（predictKeep cache）との完全一致 | pass |
| 4. frontier count / order | frozen recordのobserver count（frontier before / after、family layouts）＋ §3.1 E | 一致 |
| 5. Search input / excluded Route | child-attested identity（task / Target / digest / extent / group / reservation / excluded Route key）を再導出・B2-C2B2Iと照合 | 全11項目一致 |
| 6. fixture不変 | PR #209 main → measurement HEADで `src/test` 差分なし（analyzerが確認） | 差分なし |

### 3.1 B2J固有semantic test（`src/domain/search/reservedKeepFamilyLayoutKeyReuse.test.ts`、10件）

- **A**：Production Engineの実Keep結果（game-verified Keep vectorのweapon / element、Long Sword Fireのnormal-scope表記・Gogma-scope表記、Counter 0..119、Keepの連鎖2段）
  720件で `keepFamilyLayoutKey(result) === keepFamilyLayoutKey(current)`。held-aware stream（held位置なし / あり、blind / known base）でも全Keep stateのlayoutが親と一致。
- **B**：Reset結果objectが受ける `keepFamilyLayoutKey()` 呼び出し数 = 生成Reset state数。
- **C / D**：Keep結果objectに対する `keepFamilyLayoutKey()` 呼び出しは0回。`reservedGeneratedState()` はkeyを引数で受け、family helperを呼ばない（source shape）。
- **E**：各depthのobserver `familyLayouts` / `frontierStates` が、全solutionのkeyを再計算した `(position, layout)` groupingと一致。frontier reduction keyはsource上1回・不変。
- **F**：nested predictKeep memo宣言・lookup、Reset memoが不変。
- mutation（`reservedGeneratedState()` 内でkeyを再計算）でB / C / D の4件がfailすることを確認した（空振りしない）。

## 4. 計測方式

- **before authority**：B2-C2B2I formal RESULTをfail-close parse（registered SHA、formal、launch provenance verified、partialRun false、invalid 0、
  `B2C2B2I_ADOPTED` / adopt、`predict_keep_nested_counter_family_cache_v1`、semantic parity / direct comparison valid、両profile valid・before再現、
  after profile quality issue 0・registered line mismatch 0、Production change登録・source check valid、登録条件、hash chain / child identity / population /
  task rebuild / excluded Route all valid、raw / profile / sections / cpuProfile / capture / scriptsのfile record）。B2-C2B2Iは再計測していない。
- **before evidence**：local B2-C2B2I raw filesのSHA-256がRESULT記録値と完全一致することを、formal run直前のrunner parentとanalyzerの双方で再確認
  （raw `d064262e…` / profile `284c5bb2…` / sections `2a6ac8f2…` / cpuprofile `b0caa89a…` / capture `a3b4bdfc…` / scripts `9437b855…`）。
- **PR #209の扱い**：B2-C2B2I measured HEAD `8f34b97` は PR #208 head `f8cd709` の祖先で、`f8cd709` のtreeはsquash merge後のmain `f482811` と同一。
  `f482811` → PR #209 `9ae3f2a` の差分はtest / fixtureだけで、`8f34b97` → `9ae3f2a` のProduction calculation source差分は空（runner attestationとanalyzerが
  `git diff` で独立に確認）。したがってB2-C2B2Iのafter evidenceは、PR #209後mainのProduction計算そのもののbeforeとして使える。
- **population**：B2-C2B2I RESULTのTarget / probe / identity / excluded Routeを、B2-C2B2I自身の導出（`phase2c26b2c2b2iPopulation()`）がB2-C2B2H / G / F / E
  RESULTから再導出したものと照合（chain 9項目all true）。生成したprobe manifestのprobe / identityはB2-C2B2Iのmanifestと完全一致。Target / task / rank / extentはsourceに書いていない。
- **Production change registration**：B2-C2B2I measured HEAD → measurement HEADのProduction差分が `bonusStream.ts` だけ、PR #209 mainがmeasured HEADの祖先、
  sourceが「`reservedGeneratedState()`（JSDoc含む）・Reset call・Keep call（直上comment含む）以外は完全一致、関数内でkeyを計算しない、
  `familyLayoutKey: string` 引数、Resetは結果から計算、Keepは親key、predictKeep / frontier key / Reset memo不変」であることを `git show` で確認。
- **条件**：B2-C2B2Iと同一（30分 / 12,288 MB / concurrency 1 / retry・fallbackなし / setImmediate / 250 ms sampling / 5 s heartbeat / 2 observer
  `onSearchRuntime` + `onGogmaReservedRuntime` / durable section stream / CPU profiler 10,000 us、Search開始 + 120 s〜+ 720 s、JIT default、heap flagのみ）。
  B2-C2B2Iとの差は `production_optimization:reserved_keep_family_layout_key_reuse_v1` だけ（condition checks 17項目all true）。
- **direct comparison**：B2-C2B2Iの比較関数をそのまま使用（depth recordの `phaseMs.state_generation`、Research yield waitを両runとも含む）。
- **CPU target metric**：B2-C2B2Hのclassification / registry / quality ruleを再利用し、`src/domain/rng/gogmaBonusFamily.ts#keepFamilyLayoutKey` の
  registered inclusive active shareを比較。before shareはB2-C2B2I RESULTのafter profile記録値を機械的に読み、B2-C2B2I cpuprofileをB2-C2B2I measured HEADの
  sourceで再解析して完全再現（0.07857246692833261）することをINVALID条件として確認。数値はsourceにhard-codeしていない。

### 4.1 事前登録rule（formal run前にcommit `4ed9fb9` で固定）

| case | 条件 |
| --- | --- |
| `B2C2B2J_INVALID` | authority / before evidence SHA / population / identity / excluded Route / hash chain / provenance / 登録条件 / Production change登録 / source shape、またはbefore profile再解析の非再現 |
| `B2C2B2J_INSUFFICIENT` | direct comparison不成立、またはCPU profile pair不成立（どちらかがquality rule不合格、keepFamilyLayoutKey shareなし） |
| `B2C2B2J_REJECTED_SEMANTIC` | 共通depth recordの不一致、またはSearch input / excluded Route不一致。速度に関係なくreject |
| `B2C2B2J_ADOPTED` | 両profile valid かつ keepFamilyLayoutKeyShareRatio ≤ 0.50 かつ stateGenerationDirectRatio ≤ 0.95 |
| `B2C2B2J_REJECTED_REGRESSION` | stateGenerationDirectRatio > 1.05 |
| `B2C2B2J_REJECTED_NO_EFFECT` | keepFamilyLayoutKeyShareRatio ≥ 0.90 かつ stateGenerationDirectRatio ≥ 0.98 |
| `B2C2B2J_PARTIAL` | 上記以外（自動採用しない） |

評価順はINVALID → INSUFFICIENT → REJECTED_SEMANTIC → ADOPTED → REGRESSION → NO_EFFECT → PARTIAL。結果を見てthreshold・category定義・条件は変えていない。

## 5. 実行

| 項目 | 値 |
| --- | --- |
| 環境 | Node v24.19.0（Vite SSR loader）、AMD Ryzen 7 9700X、32 GB、起動時空き16.7 GB |
| start attestation | `start-attestation.json` SHA-256 `5259157d…`、createdAt 2026-10-06T10:22:31.622Z（probe child START前、`wx` + read-only + read-back検証）、HEAD `4ed9fb9`、uncommitted false、smoke null、baseMainIsAncestor true、productionChangedB2C2B2IToBaseMain `[]`、productionChangedFiles `[bonusStream.ts]`、source check valid |
| probe child | 2.8 s、valid（151 samples、median 10,332 us、`predictGogmaBonus` → 165行目・`keepFamilyLayoutKey` → 68行目） |
| 実行 | tasks child 5.6 s（gate ok）→ Search child 10:22:40Z〜10:52:40Z、1,800.4 sでtimeout（retryなし） |
| 実行中の監視 | 60秒ごとの空き物理メモリ監視、< 1.5 GB警告0件 |
| smoke | non-formal 1回（`--allow-uncommitted --smoke-budget-ms 150000 --smoke-warmup-ms 20000 --smoke-stop-ms 80000`）でrunner → analyzerの経路を確認。smoke結果を見て条件・ruleは変えていない |

## 6. 結果

### 6.1 direct comparison（共通held-aware depth prefix、同一work）

| 区間 | depth | 生成state | B2-C2B2I state_generation | B2-C2B2J state_generation | ratio |
| --- | ---: | ---: | ---: | ---: | ---: |
| **全体** | **480** | **842,597,754** | **811,888 ms** | **463,867 ms** | **0.5713** |
| 前1/3 | 0〜159 | 293,829,565 | 284,940 ms | 159,290 ms | 0.5590 |
| 中1/3 | 160〜319 | 294,443,193 | 285,494 ms | 166,853 ms | 0.5844 |
| 後1/3 | 320〜479 | 254,324,996 | 241,454 ms | 137,724 ms | 0.5704 |

同じprefixの他section（変更対象外、記述）：window_collection 0.966、support_evaluation 1.001、solution_materialization 0.868、frontier_reduction_sort 0.955、
exhaustion_scan 0.906。depth inclusive wall 1,480.3 s → 1,074.2 s（0.726）。

### 6.2 CPU（`state_generation` interval内、active CPU denominator、B2-C2B2Hと同一classification）

| registered inclusive | B2-C2B2I share | B2-C2B2J share | B2-C2B2J samples |
| --- | ---: | ---: | ---: |
| **`keepFamilyLayoutKey`** | **7.857 %**（2,162） | **0.020 %** | 4 |
| `generateReservedDepth`（owner） | 45.90 % | 31.50 % | 6,370 |
| `predictKeep` | 14.27 % | 5.30 % | 1,072 |
| `reservedGeneratedState` | 13.51 % | 0.89 % | 180 |
| `checkpoint` | 0.95 % | 1.54 % | 312 |

| category | B2-C2B2I share | B2-C2B2J share | B2-C2B2J samples |
| --- | ---: | ---: | ---: |
| `program`（unattributed） | 32.06 % | 47.97 % | 9,701 |
| `generation_owner_or_inlined` | 17.12 % | 23.68 % | 4,789 |
| `gc` | 21.77 % | 20.17 % | 4,079 |
| `keep_prediction` | 14.27 % | 5.30 % | 1,072 |
| `state_construction_family_layout` | 13.51 % | 0.91 % | 184 |
| `checkpoint_cpu` / `observer_overhead`（unattributed） | 0.49 % / 0.63 % | 0.84 % / 0.93 % | 169 / 189 |
| その他（reset / counter / shared / other） | < 0.2 % | < 0.2 % | 38 |

- after profile：actual 599.6 s（+121.8 s〜+721.4 s、stopped by window）、clock alignment valid、negative timeDelta 0、section stream 8,758 record / 626 interval、
  profile内202 interval（partial 2）、interval内 21,121 sample（idle 900、active 20,221）、registered frame宣言行不一致 0、unattributed 48.95 %（< 0.50、quality valid）。
  before profile（B2-C2B2I after、再解析）：active 27,516、quality issue 0、keepFamilyLayoutKey shareは記録値を完全再現。
- `reservedGeneratedState` self line ticks（profile全体、記述）：before `familyLayoutKey: keepFamilyLayoutKey(bonuses, input.master),` 183 → after その行は存在しない
  （`familyLayoutKey,` 1）。`keepFamilyLayoutKey` 本体（`return keepFamilyLayout(bonuses, master).join('\u0000')`）2,160 → 2。
- 観察（記述のみ、検証していない仮説を含む）：target関数の消失（7.9 %）に比べ、`predictKeep` / `reservedGeneratedState` / owner のsampleも大きく減り、
  direct比は0.571まで下がった。Keepごとに新しく `join()` で作られていたkey文字列が親stateの同一文字列objectの再利用に変わったことで、`predictKeep()` の
  inner `Map.get(familyLayoutKey)` やfrontier reduction keyの連結でのhash計算・文字列比較・allocationが減った可能性があるが、本計測では切り分けていない。
  shareは相対値で、`(program)` のshareは上がっている（unattributed 48.95 %はquality ruleの上限0.50に近い）。

### 6.3 yield wait（wall、記述）

profile window内 `state_generation` 223.7 sのうちyield待ち 52.1 s（23.3 %）、whole run 561.6 s中 145.2 s（25.9 %）。direct ratioは両runともyield待ちを
含むsection時間の比較で、CPU部分だけの改善率はこれより大きい。

### 6.4 outcome / progress / memory / GC（記述）

| 項目 | B2-C2B2I | B2-C2B2J |
| --- | ---: | ---: |
| process | timeout（1,800.5 s） | timeout（1,800.4 s） |
| 完了depth | 480 | 624 |
| 生成state | 842,597,754 | 1,029,466,438 |
| delivery | 0 | 0 |
| peak heap / RSS | 7.52 GB / 8.13 GB | 7.53 GB / 8.20 GB |
| GC samples / active share | 5,991 / 21.77 % | 4,079 / 20.17 % |

Searchは30分以内に自然完走しなかった（Candidate 0扱いしない、Route exact judgementはしない）。GCは単一runの記述値で、profile window内の処理量
（B2-C2B2I 157 interval / 3.08億state、B2-C2B2J 202 interval / 3.90億state）も異なるため、GC改善とは断定しない。

## 7. identity / provenance

| 照合 | 結果 |
| --- | --- |
| before authority | B2-C2B2I RESULT `ad877e1e…` registered、formal、`B2C2B2I_ADOPTED`、keepFamilyLayoutKey inclusive 0.07857、invalid 0 |
| before evidence | raw / profile / sections / cpuprofile / capture / scriptsがB2-C2B2I RESULT記録値と一致（runner・analyzer双方） |
| hash chain | 31項目all true（B2-C2B2I / H / G / F / E registered、相互のmade-against、manifest、Export、before files） |
| population | manifest = 再導出、runner Target / probe / identity = manifest = B2-C2B2Iの対象、Target 1、chain 9項目all true |
| task / excluded Route | raw task = 期待identity、Exportから再導出したtask = raw task、excluded Route key `4a875aac…` が再導出・B2-C2B2I・child attestationで一致 |
| Production change | `8f34b97` → PR #209 main：Production差分なし。PR #209 main → `4ed9fb9`：`bonusStream.ts` のみ、source check valid、runner attestationと一致 |
| conditions | 17項目all true（B2-C2B2Iとの差はoptimizationのみ） |

## 8. 次Phase recommendation（本PRでは実行しない）

- 本optimizationは事前登録ruleで **ADOPTED**。`reserved_keep_family_layout_key_reuse_v1` をmainに入れる。
- 追加micro-optimization（frontier composite key、GC / allocation、`(program)`、generation owner等）を続ける前に、**Issue #154本筋へ戻る**：
  B2-C2B2Eで60分timeoutした **t02 / Target `a367…` / rank 11** について、B2-C2B2I + B2-C2B2Jの最適化を含む現在mainのProduction Searchで、B2-C2B2Eと同じ
  60分 / 12 GB条件を再実行し、Route recoveryできるかを確認する。
- まだtimeoutする場合のみ、GC / generation owner / state construction等を追加調査する。

## 9. tests

- `src/domain/search/reservedKeepFamilyLayoutKeyReuse.test.ts`（10件）：§3.1のA〜F。
- `src/benchmarks/plannerGlobalPhase2C26B2C2B2J.test.ts`（18件）：B2-C2B2I authority parseとfail-close、before file record、population / chain（hard-codeなし）、
  manifest、登録条件・PR #209 base main、Production changed file分類、optimization source check（CRLF、region外変更・frontier key・Reset memo・predictKeep・
  関数内key再計算・Keep再計算・Reset key欠落の検出）、CPU profile構造の導出可能性、child計算 / profilerがB2-C2B2H / Iと同一関数、CPU comparison
  （quality / 再現性 / target関数消失=0）、decision境界（0.50 / 0.95 / 1.05 / 0.90・0.98、評価順）、start attestation、Production import isolation・
  child isolation、committed RESULT固定。
- 既存：PR #209 regression gate 9 files（§3）、`plannerGlobalPhase2C26B2C2B2I.test.ts` 等は無変更でpass。

## 10. 未検証事項・limitation

- before / afterとも単一run・単一Target。run-to-runばらつきは未評価
- direct改善（−42.9 %）がtarget関数のshare（7.9 %）より大きい理由（hash cache・allocation・GCの寄与）は未切り分け
- CPU profiler（10 ms sampling）は両runに同条件で有効。profile windowは時間基準なので、両runで覆うdepthが異なる
- after profileのunattributed share 48.95 %はquality上限0.50に近い（rule内でvalid）
- Node / Vite SSRでの計測で、Browser Worker・Production schedulerのevidenceではない
- Production RNG・Search semantics・Plannerの挙動は変えていない。新しいRNG挙動は導入していない

## 11. authority / hash chain

| authority | 値 |
| --- | --- |
| B2-C2B2I RESULT（before authority） | `ad877e1efd53b893ee48f9b9bc3747f51d4a278890a0dd7f96530d4bb4a1e4d4`（measured HEAD `8f34b977…`） |
| B2-C2B2H / G / F / E RESULT | `e03fa2bb…` / `ff163148…` / `b7b707bb…` / `5bf6bba3…` |
| PR #209 merged main | `9ae3f2af2d11844a13aa30e96df0a788a0a2ad12` |
| Export | `cc35fb5bd85acb417b2ce0229cd79441b48c642ac8af70bbc2dfdfc8c89e1e6b` |
| probe manifest | `PLANNER_GLOBAL_PHASE2C26B2C2B2J_PROBES.json.local` `513b6fbb…`（.local、未commit） |
| raw run / profile / sections / cpuprofile | `PLANNER_GLOBAL_PHASE2C26B2C2B2J_RAW.json.local`（.local、未commit。SHA-256はRESULT `sources` に記録） |
