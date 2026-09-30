# Global Planner Research Phase 2-C2.6-A4（Planner Alternative Search outer runtime localization）

Refs #154。Research only。Production semantics、defaults、schema / version、Persistence、UIは変更していない。Production sourceへの変更は
Planner Alternative Search / `TargetSearchScheduler` への任意の観測用section境界seam（default undefined、Production callerは指定しない）
のみ。optimization、Candidate portfolio再構築（C2.6-B）、extent変更、trial / rerun変更、Global Planner scheduling変更は行っていない。

## 1. 結論: A3で未計測だった約30%は何だったか

**A3の未計測約30%は、ほぼ全部が `readReservedDepth()` 直後のBonus Ideal filter（raw solution全件への `satisfiesIdealBonuses()`）で、
残りの小部分がroute kind notice走査だった。** scheduler、Lazy Ideal Cross、Skill、composition、delivery、Route registrationは、
3件とも合計で1秒未満（Search wallの0.01%未満）だった。

A3のprimary 3 orientation（A3 RESULTのselectionから導出: c6-p1、c13-p1、c14-p0）を、A3と同条件で、Search全体のsection境界observer
だけを付けて各1回profileした。3件ともtimeout（Search中、30分）、OOM 0、failure 0。

| orientation | Search wall（観測点） | `bonus_depth_read` | `bonus_ideal_filter` | `bonus_notice_scan` | その他の全section | unattributed | coverage |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| c6-p1 | 1,794.4 s | 1,285.0 s（**71.6%**） | 468.6 s（**26.1%**） | 40.6 s（2.3%） | 0.17 s | 3.0 ms | 0.999998 |
| c13-p1 | 1,789.7 s | 1,215.0 s（**67.9%**） | 525.7 s（**29.4%**） | 48.9 s（2.7%） | 0.08 s | 1.3 ms | 0.999999 |
| c14-p0 | 1,796.6 s | 1,247.9 s（**69.5%**） | 503.1 s（**28.0%**） | 45.3 s（2.5%） | 0.16 s | 2.3 ms | 0.999999 |
| 3件合計 | 5,380.7 s | 3,748.0 s（69.7%） | 1,497.4 s（27.8%） | 134.9 s（2.5%） | 0.4 s | 6.7 ms | 0.999999 |

（% はSearch wallに対する割合。Search wallはA3と同じ定義: kernelの `search_started` から観測点まで、trial時間を除く。観測点は各childの
最後のheartbeat。以降の未観測tailは1.0〜7.9秒。）

**事前登録rule（§8）の判定: Case O（outer bottleneck identified）**。3件ともcoverage ≥ 0.90で、`bonus_depth_read` 以外のouter
categoryとして `bonus_ideal_filter` が3件ともSearch wallの10%以上（26.1% / 29.4% / 28.0%）。`bonus_notice_scan` は3件とも10%未満
（2.3〜2.7%）のため候補ではない。

直接計時で確定した事実:

- 3件とも、30分間のほぼ全時間がBonus depth work（`bonus_depth_work` inclusiveがSearch wallの99.99%超）に費やされた。
- Bonus depth work内は **read（約70%）+ Ideal filter（約28%）+ notice scan（約2.5%）** でほぼ尽きる。
- 各primaryはTarget 1件のSearchで3.1〜3.6億のraw solution（全Bonus depth workの合計）を受け取り、**Ideal solutionは3件とも0件**だった。
  したがってroute materialization、evaluate / sort、channel publication、Lazy Cross、composition、deliveryには処理対象が無く、
  いずれも実質0だった（Candidate 0件、composition work 0件、delivery 0回）。
- Ideal filterの時間はraw solution数にほぼ比例する（Bonus depth work単位の相関 0.995〜0.999、raw solution 1件あたり中央値 約1.48〜1.50 µs）。
  notice scanも同様に比例する（相関 0.94〜0.99、1件あたり中央値 約130〜138 ns）。
- kill時点の最後のdurable section開始は c6-p1 = `bonus_depth_read`、c13-p1 = `bonus_ideal_filter`、c14-p0 = `bonus_depth_read`。

## 2. A3との関係

| Phase | 粒度 | 計時したもの |
| --- | --- | --- |
| A3 | `readReservedDepth()` 内部 | held-aware Gogma streamの6 section（window / support / generation / materialization / frontier reduction・sort / exhaustion scan） |
| A4 | Search全体のouter hierarchy | `readReservedDepth()` を1 leaf（`bonus_depth_read`）として含む、Search root以下の全section |

A3とA4は競合するevidenceではなく、異なる粒度の補完的な計測である。A4はA3のsection observerを付けていない（instrumentation構成が
異なる）ため、A3 / A4のabsolute wall timeは比較・加算しない。比較できるのは各run内の構成比だけである。

構成比としては整合している: A3で6 sectionが説明した割合（67.1〜71.5%）と、A4で `bonus_depth_read` が占めた割合（67.9〜71.6%）は
ほぼ同じで、A3のunattributed（28.5〜32.9%）はA4の `bonus_ideal_filter` + `bonus_notice_scan`（28.4〜32.1%）に対応する。

`bonus_depth_read` の内部については、A3の同primary evidence（別authority）を参照できる: 3件とも `frontier_reduction_sort` が最大
（A3 measured内の52〜58%）、次が `state_generation`（31〜37%）。

## 3. authorityと位置付け

参照: `docs/REQUIREMENTS.md`、`docs/SEARCH_SPEC.md` 5.6.8、`docs/PLANNER_SPEC.md` 9.2.19、
`PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_PHASE2C26A.md`、`…PHASE2C26A2.md`、`…PHASE2C26A3.md`。

| authority | ファイル | SHA-256 | 用途 |
| --- | --- | --- | --- |
| C2.6-A RESULT | `docs/PLANNER_GLOBAL_PHASE2C26A_RESULT.json` | `dab2f27a1ca94e5db38279e3848f76d033710c38d6e838da227e36e78c67b171` | baseline / condition parity |
| C2.6-A2 RESULT | `docs/PLANNER_GLOBAL_PHASE2C26A2_RESULT.json` | `4bde9a5bcd84cc5e29d5dcf666f9eafb6bbb64d5f49aace1b15f36cf913fadc2` | A2 primary rule |
| C2.6-A3 RESULT | `docs/PLANNER_GLOBAL_PHASE2C26A3_RESULT.json` | `b5562342585899163c8d554bbc25ef6654bab12479ec403cf5d474f799beb3a2` | primary selection、条件、inner evidence参照 |
| Export | `gogma-artian-planner-backup_20260927015837.json`（commitしない） | `cc35fb5bd85acb417b2ce0229cd79441b48c642ac8af70bbc2dfdfc8c89e1e6b` | calculation input |

A3 RESULTはfail-closedで検証した（`parsePhase2C26A3ResultAuthority()`）: `provenance.formal`、`formalSeriesValidation.valid`、
`selectionValidation.valid`、orientations 3、timeout 3 / OOM 0 / failure 0 / completed 0、`summary.decision.case = R_gogma_does_not_explain`。
SHA chainとして、A3が記録するC2.6-A RESULT SHA（provenance / runner記録 / A2経由の記録 / sources）とA2 RESULT SHA（provenance /
runner記録 / sources）が実際に読んだファイルのSHAと一致すること、A3のExport SHAがC2.6-Aの条件と一致することを確認した。A2 RESULTも
A3と同じ `parsePhase2C26A2ResultAuthority()` で検証した（A2が記録するC2.6-A SHAの一致を含む）。どのRESULTもSearch / Planner inputには
使っていない。

## 4. 変更境界

| 役割 | ファイル |
| --- | --- |
| section / hierarchy / event型 | `src/domain/search/searchRuntime.ts`（`SEARCH_RUNTIME_SECTIONS`、`SEARCH_RUNTIME_SECTION_PARENT`、`SearchRuntimeObserver`） |
| Production observer seam | `src/domain/search/targetSearchScheduler.ts`（任意の第3引数）、`src/domain/search/alternative/plannerAlternativeSearch.ts`（`PlannerAlternativeSearchInstrumentation.onSearchRuntime`） |
| 正式仕様 | `docs/SEARCH_SPEC.md` 5.6.8（`onSearchRuntime` contract、同じPRで同期） |
| authority parse・condition parity・hierarchical tracker・kernel progress | `src/benchmarks/plannerGlobalPhase2C26A4.ts` |
| post-hoc analysis（formal validator・reconciliation・decision rule） | `src/benchmarks/plannerGlobalPhase2C26A4Analysis.ts` |
| テスト | `src/benchmarks/plannerGlobalPhase2C26A4.test.ts` |
| runner / analyzer | `scripts/run-planner-global-phase2c26a4.mjs` / `scripts/analyze-planner-global-phase2c26a4.mjs` |
| isolation test（新seamもSearch以外のProductionから渡されないこと、通常のCandidate Searchのschedulerは受け取らないこと） | `src/benchmarks/plannerAlternativeBenchmarkIsolation.test.ts` |

### 4.1 section境界seam

既存処理の順序どおりに境界を置いただけで、stream、prediction、Ideal判定、evaluate、retention、Lazy Cross、queue、delivery順序、
終了判定のalgorithmは変えていない。コード上の変更は、境界通知のために `evaluateBonusSolutions()` / `evaluateSkillSolutions()` の戻り
配列を変数へ受ける、`composeScheduledRoute()` の結果を変数へ受ける、Lazy Crossの `onSettled` をcomposition work内へ渡す
（実行順は従来どおりcompositionの後）、`onCandidate()` の戻り値を変数へ受ける、Route registrationのloopをsection名付きの配列にする、
の5点だけである。observer未指定時は `runtime?.(…)` の短絡評価で境界の引数も評価されない。

sectionとhierarchyは `SEARCH_SPEC.md` 5.6.8の表のとおり（Search root / setup / Route registration 3種 / scheduler step
（checkpoint / settle / post-settle）/ Bonus depth work（read / notice scan / Ideal filter / route materialization / evaluate-sort /
publication（`cross_add_bonus`）/ advance）/ Skill depth work（同じ区分）/ composition work（checkpoint / compose / consumer /
`cross_open_next`）/ cross wake work / delivery flush（sort / checkpoint / key dedup / consumer））。Route search primitiveがqueueへ直接
登録するRoute base workは独自のwork sectionを持たず、`scheduler_settle` のうちwork sectionを含まないものとして `route_base_work` に
分類した。

### 4.2 semantic neutrality / contract test

- Production RNG Engineの小fixture 4種と、Candidateを配送する（composition、Lazy Cross wake、delivery flushが走る）mock engine fixture 2種
  （extentまで / consumer stop）で、instrumentationの有無によりdelivered `candidateStableKey` 列、Search summary（`stoppedByExtent`含む）、
  prediction呼び出し回数が完全一致。observerの戻り値を返しても変化しない。
- 登録済み40 sectionすべてに到達し、全eventが登録済み親の下で厳密に入れ子・対になる（depth detailはdepth work開始だけ、countsは
  held-aware depth work完了だけ、timestampなし）。cancellationで中断したsectionは完了を通知せず、以降の完了も無い。
- kernel levelで、A4 instrumentationの有無によりkernel result（Target outcome、trial結果、`plannerRerunsUsed`、Search summary）が完全一致。
- Domain（scheduler、Planner Alternative Search、searchRuntime）はclockを読まない（source検査）。
- isolation test: `onSearchRuntime` / `SearchRuntimeObserver` を使うProduction moduleは3つだけで、schedulerへ第3引数を渡すのは
  Planner Alternative Searchだけ。Worker protocol / Client / adapterには何も追加していない。

## 5. 条件

A3と同一（A3 RESULTの `conditions` とfield単位で一致を検証）:

| 条件 | 値 |
| --- | --- |
| concurrency | 1 |
| child heap | 8,192 MB（`--max-old-space-size=8192`） |
| orientation budget | 30分（1,800,000 ms）、retryなし、fresh Node child |
| extent | Normal 4 / Gogma 235 / Skill 4 |
| trial bounds | trials 2 / reruns 8 |
| Research maxPlanSteps | 20,000 |
| yield | `setImmediate` |
| CalculationContext | `unknown-initial` / master 4 / `production-rng:c5-e7` / app schema 17 |
| lineage | empty |

さらにA3 RESULTの条件自体がC2.6-A / A2条件とconcurrency以外一致すること（A3のparity）も再検証した。異なるのはSearch instrumentation
だけ: A4は `onSearchRuntime` のみ（A3の `onGogmaReservedRuntime`、`onGogmaReservedDepth`、`onSkillReservedDepth`、`onWorkSettled` は付けない）。

baseline parity: baseline child（ordinary Production Planner）の54 orientation、summary、順序付きID、identity、metadataがC2.6-A
authorityと一致。

## 6. primary selection

A3 RESULTの `selectionValidation.expected`（= `selectionRule.derivedPrimaryOrientationIds` = A2 RESULTへA2 ruleを再適用した集合）を
authorityとし、sourceにIDを固定していない。現在のbaselineから再導出したorientationのうちその3件だけを、metadataがC2.6-Aの記録と
field単位で一致することを確認して各1回実行した（missing / duplicate / foreign / non-primary / metadata mismatch 0）。

## 7. 計時方法とreconciliation

- Domainはsection境界を同期通知するだけで時刻を読まない。Research childがcallback受信時に `performance.now()` でstampし、child内の
  open section stackで、sectionごとにinclusive（開始〜完了）とexclusive（inclusiveから子sectionのinclusiveを引いたもの）を集計する。
- 各sectionのexclusive時間を1つのouter categoryへ割り当てる（表は `registeredRule.sectionCategory`）。Search rootのexclusive時間
  （delivery loopのbookkeepingと境界間の隙間）だけをunattributedとして残す。これにkernel側の時間（kernelの `search_started` から
  Search root開始まで）を加えると、構成上Search wallと一致する。
- 観測点はtimeoutでは最後のheartbeat。heartbeatのsnapshotは、完了済みsectionの合計に加えて、open stackの各sectionの経過時間と部分
  exclusive時間を同じ `now()` で持つ。
- durable記録: Search / registration / Bonus・Skill depth workとそのouter phase / delivery flushのsection開始ごとに1行、Bonus・Skill
  depth work完了ごとにsummary 1行（counts、直下phaseのexclusive）、Search完了ごとにsummary 1行、5秒heartbeat（open stack付き）。
  solution / subscriber / Candidate / queue操作ごとの記録やIPCはない。runtime記録数は1件当たり約2,400〜5,500行。

strict coverage（container sectionのremainder、すなわちqueue dispatchやwork自身の時間を除いた、leaf sectionだけの合計）も
0.99995〜0.99998で、remainderに時間は残っていない。

## 8. 事前登録rule

primary 3件（majority 2）。coverage = sum(outer categories) / Search wall、category threshold 0.10、評価順:

1. **Case U**: 2件以上でcoverage < 0.90 → instrumentation gap。残りのunattributed境界を追加局所化。optimizationへ進まない。
2. **Case O**: coverage ≥ 0.90の中で2件以上が、`bonus_depth_read` 以外の同じouter categoryでSearch wallの10%以上 → outer bottleneck
   identified。次Phaseはそのcategoryを詳細化またはoptimization設計。
3. **Case I**: coverage ≥ 0.90の中で2件以上が、最大categoryが `bonus_depth_read` かつ他の全categoryが10%未満 → A3のinner evidence
   （frontier_reduction_sort / state_generation）の詳細局所化へ戻る。
4. **Case M**: それ以外（最大categoryがprimary間で異なる）→ mixed。optimizationへ進まない。

判定: **O**。coverage 0.999998 / 0.999999 / 0.999999、`bonus_ideal_filter` が3 / 3で10%以上（26.1% / 29.4% / 28.0%）。
他に10%以上のcategoryは無い（`bonus_notice_scan` 2.3〜2.7%、scheduler / Lazy Cross / composition / Skill / delivery / registrationはいずれも
0.01%未満）。最大categoryは3件とも `bonus_depth_read` で一致した。

## 9. 詳細

### 9.1 Bonus depth work

| orientation | Bonus depth works | raw solutions（合計） | 1 work最大 | Ideal solutions | subscriber publication | Skill depth works |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| c6-p1 | 600 | 311,563,140 | 642,573 | 0 | 0 | 8 |
| c13-p1 | 256 | 355,597,735 | 1,525,164 | 0 | 0 | 10 |
| c14-p0 | 484 | 337,048,805 | 788,476 | 0 | 0 | 8 |

Bonus depth work単位（完了したwork記録のみ、raw solution 1件あたり）:

| phase | c6-p1 中央値 | c13-p1 中央値 | c14-p0 中央値 | raw solution数との相関 |
| --- | ---: | ---: | ---: | ---: |
| `bonus_depth_read` | 4,416 ns | 3,626 ns | 3,929 ns | 0.05 / 0.50 / 0.35 |
| `bonus_ideal_filter` | 1,505 ns | 1,479 ns | 1,493 ns | 0.995 / 0.999 / 0.999 |
| `bonus_notice_scan` | 130 ns | 138 ns | 132 ns | 0.99 / 0.99 / 0.94 |
| route materialization / evaluate / publication / advance | < 1 ns | < 1 ns | < 1 ns | — |

Ideal filterはraw solution 1件ごとにほぼ一定の約1.5 µsで、Ideal solution数が0件でも全件に対して実行される。notice scanは1件あたり約0.13 µs。

### 9.2 scheduler / Lazy Cross / Skill / composition / delivery / registration

3件ともscheduler step 270〜612、route base work 4、composition work 0、cross wake work 0、delivery flush 0。Route registrationは
Normal 0.55 ms、Owned Normal 0.11 ms、Existing Gogma 0.8〜1.1 msで合計2 ms未満。scheduler checkpoint / queue dispatch / post-settleは
合計0.05 s未満。Skill depth workは合計0.01 s未満（raw solutionは合計8〜16件）。

### 9.3 kill時点

| orientation | 最後のdurable section開始 | kill時点までの推定経過 | 最後のheartbeatのopen stack |
| --- | --- | ---: | --- |
| c6-p1 | `bonus_depth_read` | 約0.37 s | Bonus depth work（channel 2 / depth 77）> read |
| c13-p1 | `bonus_ideal_filter` | 約1.40 s | Bonus depth work（channel 1 / depth 53）> read |
| c14-p0 | `bonus_depth_read` | 約1.11 s | Bonus depth work（channel 8 / depth 51）> read |

memory: sampled max heap 3.9〜5.1 GB、RSS 4.7〜5.5 GB。prediction呼び出し: Normal 12、Skill 4〜5、Reset 243〜254、Keep 26,996〜29,104。

## 10. 言えること / まだ言えないこと

formalに言えること:

- A3の未計測約30%は、Bonus depth workの `readReservedDepth()` 直後の2つのraw solution全件走査、すなわちIdeal filter（Search wallの
  26〜29%）とroute kind notice走査（2.3〜2.7%）でほぼ完全に説明される。
- scheduler、Lazy Cross、Skill、composition、delivery、Route registrationは3件ともSearch wallに対して無視できる（合計0.01%未満）。
- 30分間でIdeal Bonus solutionは3件とも1件も見つからず、Candidateも0件だった。
- Ideal filterの時間はraw solution数にほぼ比例し、1件あたり約1.5 µsである。
- 最大のcategoryは依然として `bonus_depth_read`（68〜72%）で、その内部はA3 evidenceでは `frontier_reduction_sort` > `state_generation`。

まだ言えないこと:

- `satisfiesIdealBonuses()` 1回（約1.5 µs）の内部内訳（multiset比較、Master rank参照、scope判定など）。
- Ideal filterやnotice scanを短縮した場合に、これらのprimaryのSearchが30分以内に終わるか、Ideal Bonus solutionへ到達するか。
  filterを完全に除いても、残り約70%（read）は残る。
- GCがどのsectionに計上されたか（GC pauseはその時openなsectionへ入る）。
- Browser Worker・他deviceでの配分、run間ばらつき（各1回）。

## 11. 次Phase recommendation

事前登録rule Oに従い、次Phaseは **`bonus_ideal_filter`（raw solution全件への `satisfiesIdealBonuses()`）を詳細化またはoptimization設計する**。
本Phaseではoptimizationしていない。

設計時の論点（本Phaseでは検証していない仮説）:

- Ideal判定の意味（`satisfiesIdealBonuses()` がIdealのauthorityであること、Master rank assertionを含むこと）は変えずに、raw solution
  全件に対する1件あたりの判定コストを下げられるか。
- 同じ処理を全件に対して行うnotice scan（2.5%）を同じ設計で扱えるか（単独では10%未満で候補ではない）。
- Ideal filterを縮めてもSearch wallの約70%は `bonus_depth_read` に残るため、A3 evidenceの `frontier_reduction_sort` / `state_generation`
  の局所化・設計も並行して必要になる可能性が高い。filter単独の改善でprimaryが30分以内に終わるとは言えない。

Candidate portfolio再構築（C2.6-B）へ進む根拠は今回も得られていない。

## 12. limitations

- Node child（Vite SSR loader）のみ。Browser Worker・他device・他heap条件は測っていない。
- Search instrumentationがA3と異なるため、A3とのabsolute wall time比較・加算はしない。比較はA4 run内の構成比だけ。
- 各orientation 1回のみ（retryなし）。run間ばらつきは測っていない。
- 観測点はtimeoutでは最後のheartbeat。以降のtail（1.0〜7.9秒）は未観測。heartbeatはevent loopがyieldしたときだけ発火するため、
  間隔は最大7.1〜8.5秒に伸びた（Ideal filterとnotice scanは1 workの間yieldしない同期処理）。kill時のactive section経過は推定値。
- section内のawait（checkpoint yield = `setImmediate`）とその間に走るtimer（250 ms memory sampler、5 s heartbeat）、およびGCは、その時
  openなsection（主に `bonus_depth_read`）へ計上される。
- `bonus_depth_read` は `readReservedDepth()` 全体を1 leafとして計時した。内部の内訳はA3 evidenceの参照だけである。
- `queue_dispatch_or_unclassified` / `route_base_work` は直接の境界に囲まれたremainderである（今回はいずれも0.05秒未満）。
- section境界の同期通知と集計、durable記録は計算を変えないが、wall timeへのoverheadはゼロではない。
- 相関・1件あたり時間は完了したBonus depth work記録のみの記述統計で、因果を示さない。

## 13. 検証

`npm run lint`、`npx tsc -b --force`、`npm test`、`npm run build`、`git diff --check`。measured HEAD `9fadd93`（clean）でformal A4を実行し、
analysis HEADも同一（測定後のcalculation code変更なし）。raw（`PLANNER_GLOBAL_PHASE2C26A4_RAW.json.local`、`PLANNER_GLOBAL_PHASE2C26A4_RUN.local/`）
はcommitしていない。
