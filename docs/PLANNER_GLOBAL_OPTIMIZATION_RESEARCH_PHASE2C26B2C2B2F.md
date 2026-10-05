# Global Planner Research Phase 2-C2.6-B2-C2B2F（B2-C2B2E time-bound Target専用 Planner Alternative Search outer runtime profiling）

Refs #154。Research only・profiling only。Production source（`src/domain` / `services` / `workers` / `pages` / `components` / `db`）、Search semantics /
ordering / comparator、Candidate materializer、capture、extent、context、P1は変更していない。Production optimization、新しいProduction
instrumentation seam、V8 CPU profiler、16 GB heap、60分以上のrun、自動retry / fallback、E2、K2、residual 3、global assignment、full Planner、UI、
A3〜A9 RESULTの再生成は行っていない。

- measurement HEAD: `dd41061d492d91c0ebc9a2ecdc13ebc0a857f280`（runnerがchild起動前にstart attestationで記録）
- analysis HEAD: `dd41061d492d91c0ebc9a2ecdc13ebc0a857f280`（measurement HEADと同一。`calculationCodeChangedSinceMeasuredHead = []`）
- RESULT: [`docs/PLANNER_GLOBAL_PHASE2C26B2C2B2F_RESULT.json`](PLANNER_GLOBAL_PHASE2C26B2C2B2F_RESULT.json)（**`provenance.formal = true`**、`evidenceGrade = formal`、
  decision **`B2C2B2F_BONUS_DOMINANT`**、invalid reason 0）

## 0. 位置づけとlimitation

- B2-C2B2Eのnext branch C（「heap_growth型のt00は回収、time_bound型のt02は時間計算量問題、次はt02専用profiling」）を受けたPhase。
  問いは「**t02のSearch wallを、現行main上でどのSearch runtime sectionが支配しているか**」だけで、Route exact / Candidate有無は判定しない（`routeExactJudged = false`）。
- Search inputはB2-C2B2Eと同一のoracle-guided diagnostic入力（B2-C1 first compatible context × tight extent）。Production scheduler / extent selection / runtimeのevidenceではない。
- section shareの分母は**本profiling run自身のSearch wall**（`search_runtime` inclusive）。onSearchRuntime observerが付くため、B2-C2B2E 60分runとのthroughput / wall /
  yields/secの絶対比較から性能結論は出さない（B2-C2B2Eのtrajectoryは背景資料）。
- A3〜A9は別populationのResearch authority。数値は合算せず、本結果を「A9のBonus代表比較optimizationが効いていない」とは解釈しない（現行main上のt02固有のSearch構成として扱う）。

## 1. 結論

| 軸 | 値 |
| --- | --- |
| profiling decision | **`B2C2B2F_BONUS_DOMINANT`**（dominant = BONUS、secondary なし、invalid 0） |
| evidence | `formal = true`（start attestation verified、Working Tree clean、smoke null） |
| outcome | 30分budgetでtimeout（正常なprofiling outcome。Candidate 0扱いしない）。Search wall 1,789.8 s、最終snapshot後の未観測tail 4.4 s |
| coverage | **0.999999**（UNACCOUNTED 0.0001 %未満）、section nesting違反 0、categoryはSearch wallの分割として一致 |
| BONUS / SKILL / COMPOSITION / SCHEDULER / DELIVERY / REG+SETUP | **99.9974 %** / 0.0007 % / 0 % / 0.0016 % / 0 % / 0.0002 % |
| window（0–10 / 10–20 / 20–30分） | BONUS 99.997 / 99.998 / 99.998 %。dominant categoryは前半・後半で変わらない |
| Candidate delivery | delivery flush 0回、consumer呼び出し 0回：**最初のCandidateをdeliverする前に30分を使い切った** |

問いへの答え：

1. **Skill stream処理は支配していない**（skill_depth_work 計12 ms、0.0007 %。97 depth work、各depthのraw solutionは1件）
2. **Bonus streamが支配している**（bonus_depth_work 99.997 %）
3. **Lazy Cross / composition / wakeは増大していない**（composition_work / cross_wake_work 0回。cross_add_bonusは61,693回あるが計0.02 s）
4. **scheduler bookkeeping / queue操作は支配していない**（scheduler_step exclusive + checkpoint + settle exclusive + post_settle 計0.03 s）
5. **30分の前半・後半でdominant categoryは変わらない**（3 windowともBONUS 99.99 %超、BONUS内部の構成比もほぼ一定）
6. **Candidate delivery前に時間を使い切っている**（delivery_flush 0回）

## 2. 方針（B2-C2B2Eとの差）

```text
B2-C2B2E RESULT（5bf6bba3…、formal、B2C2B2E_INCOMPLETE、next branch C）
  -> phase2c26b2c2b2fPopulation(): nextBranch.perTargetのうち type = time_bound かつ result = timeout（1件、fail-close）
       同TargetのB2-C2B2E Target行（type / unmeasured timeout / recovery none / paired identity・excluded Route verified）、
       task行（task ID / rank / tight extent / timeout・record null）、probe導出、start-attested probeと照合
  -> probe manifest（probe + B2-C2B2E task行のSearch input identityのみ）-> .local/PLANNER_GLOBAL_PHASE2C26B2C2B2F_PROBES.json.local（800338af…）
runner（Export + manifestのみ読む）
  -> start attestation（wx・read-only・read-back verify）-> tasks child: buildPhase2C26B2C2B2ETasks() + identity全field一致gate -> 1 task
  -> Search child（fresh、12,288 MB、30分）: child自身が検索前にSearch identity（digest / extent / excluded Route key SHA-256）をdurableに記録
       -> runPhase2C26B2C2B2FTask = B2-C2B2Dのtask / Search本体とline-for-line同一（testで固定）+ onSearchRuntime observerのみ
       -> A4 tracker（createPhase2C26A4RuntimeTracker()を再利用）の累積snapshotを5秒ごと・window境界でdurableに追記
analyzer（run終了後のみ、oracleは読まない）: authority / population / Exportからのtask再導出 / excluded Route再導出 / categories / windows / decision
```

| 項目 | B2-C2B2E | B2-C2B2F |
| --- | --- | --- |
| population | B2-C2B2D未回収2 Target | **B2-C2B2E time_bound timeout 1 Target**（t00は再実行しない） |
| budget | 60分 | **30分**（profiling budget。60分への自動延長なし） |
| Search instrumentation | なし | **onSearchRuntimeのみ**（A3 / A7 / A8 observer、depth observer、CPU profilerなし） |
| heap 12,288 MB / concurrency 1 / fresh child / setImmediate / 250 ms sampling / retry・fallbackなし / Target / P1 rank / group / reservation / representative / Planner-start origin / excluded current Route / tight extent / default・tight Search input digest / ordering / comparator / materializer / C4C capture / safety cap 1024 | 同一 | 同一 |

### 2.1 probe（authorityから機械導出、sourceには値を書いていない）

| task | Target | P1 rank | tight extent | group | reservation | default / tight Search input digest |
| --- | --- | ---: | --- | ---: | --- | --- |
| t02-r11 | `a367c177…`（owned Gogma、`existing_gogma_mixed`、1,084 ops） | 11 | `{4, 235, 1083}` | 3 | `fnv1a32:ff85a91d` | `fnv1a32:d80ff6de` / `fnv1a32:824a0ec4` |

## 3. 計測方式

- Search Domainは時刻を読まない。`visitPlannerAlternativeCandidates()` / `TargetSearchScheduler` が既存の `onSearchRuntime` でsection境界だけを同期報告し、
  Research childが `performance.now()` で時刻を付ける。observerの戻り値はSearchに読まれない（neutralityはtestで確認、§8）。
- trackerはA4の `createPhase2C26A4RuntimeTracker()` をそのまま再利用（strict nesting / registered parent検証、inclusive / exclusive、count、open stack、depth counts集計）。
  A4のdurable section-start記録は使わず、**累積snapshot**（完了section + open sectionの観測時点までの経過）を5秒ごと・window境界・完走時に1行追記する
  （section境界ごとの書き込みはしない）。budget killでも直前のsnapshotまでのaggregateとopen stackが残る。
- Research側だけの追加：open-section mirrorによるResearch yield待ち時間の帰属、Bonus / Skill depth work completionに既に付くcountsからのstream別集計（追加走査なし）。
- outer categoryはsection hierarchyに沿った**Search wallの分割**（double countなし）：

```text
BONUS               bonus_depth_work inclusive
SKILL               skill_depth_work inclusive
COMPOSITION         composition_work inclusive + cross_wake_work inclusive
SCHEDULER_OVERHEAD  scheduler_step inclusive - BONUS - SKILL - COMPOSITION
DELIVERY            delivery_flush inclusive
REGISTRATION_SETUP  search_setup inclusive + route_registration inclusive
UNACCOUNTED         search_runtime exclusive
```

### 3.1 事前登録decision rule（formal run前にcommit `dd41061` で固定）

- coverage = 1 − UNACCOUNTED / Search wall、threshold **0.90**。dominant **≥ 0.50**、secondary **≥ 0.20**、Search wall下限 60 s
- `B2C2B2F_INVALID`（authority / population / identity / excluded Route / provenance / nesting違反 / 分割不一致）→ `B2C2B2F_INSUFFICIENT`（coverage不足 / snapshotなし / 短すぎるSearch）
  → `B2C2B2F_<CATEGORY>_DOMINANT` → `B2C2B2F_MIXED`。windowは記述のみでdecision inputではない

## 4. 実行

| 項目 | 値 |
| --- | --- |
| 環境 | Node v24.19.0（Vite SSR loader、NOT a Browser Worker）、AMD Ryzen 7 9700X（16 logical）、32 GB |
| start attestation | `start-attestation.json`、SHA-256 `1ecde10b…`、createdAt 2026-10-05T12:51:55.411Z（tasks child START 12:51:55.438Z より前）、HEAD `dd41061`、uncommitted false、smoke null |
| benchmarkCodeSha256 | `8bc4e399861595b289262ad23d033afd1fa14411e5970f76562b8b7b0f07f44c`（analyzerがmeasured HEADのgit objectから再計算した値と一致） |
| 実行 | tasks child 7.0 s（gate ok）→ Search child 12:52:02Z〜13:22:07Z、1,800.4 sでtimeout（SIGKILL、retryなし） |
| 起動前の待機 | 最初の確認時に動画エンコード（x265 / AmatsukazeCLI）でCPU約80 %だったため開始せず、エンコーダ0・CPU 25 %未満・空き16 GB以上・node 0が3分続いてから起動（B2-C2B2Eと同じ運用） |
| 実行中の監視 | 60秒ごとに空き物理メモリとCPU：空き10.3〜16.5 GB、エンコーダ0、1.5 GB未満の警告0件 |
| smoke | non-formal 1回（`--allow-uncommitted --smoke-budget-ms 120000`）でrunner → analyzerの経路を確認。smoke結果を見て条件は変えていない |

## 5. 結果

### 5.1 outer category（Search wall 1,789,841 ms）

| category | ms | share |
| --- | ---: | ---: |
| **BONUS** | 1,789,796 | **99.9974 %** |
| SKILL | 12.2 | 0.0007 % |
| COMPOSITION | 0 | 0 % |
| SCHEDULER_OVERHEAD | 29.0 | 0.0016 % |
| DELIVERY | 0 | 0 % |
| REGISTRATION_SETUP | 2.8 | 0.0002 % |
| UNACCOUNTED | 1.7 | 0.0001 % |

### 5.2 BONUS内部（section exclusive、Search wall比）

| section | s | share |
| --- | ---: | ---: |
| `bonus_depth_read`（held-aware `readReservedDepth()` 全体） | 1,455.4 | **81.32 %** |
| `bonus_ideal_filter` | 214.9 | **12.00 %** |
| `bonus_notice_scan` | 118.5 | **6.62 %** |
| `bonus_evaluate_sort` | 0.79 | 0.04 % |
| `bonus_route_materialization` / `bonus_channel_publication` / `cross_add_bonus` / `bonus_depth_advance` / self | < 0.2 | < 0.01 % |

- Research yield待ち（setImmediate 1回の往復、他のmacrotask含む）は計147.8 s（Search wallの8.3 %）、10.40 M回のうち**99.9998 %が `bonus_depth_read` 内**。
  この時間は上表の `bonus_depth_read` に含まれる
- 最終snapshot時点のopen stack：`search_runtime > scheduler_step > scheduler_settle > bonus_depth_work（channel 3, depth 47）> bonus_depth_read`（214 ms経過）

### 5.3 Bonus / Skill depth counts（Searchが既に報告するcountsのみ）

| stream | completed works | channels | max depth | raw solutions | ideal / evaluated | subscriber publications | max retained after | exhausted |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Bonus | 281（+1 open） | 6 | 49 | **519,634,795**（1 depth最大2,011,282） | 61,693 / 61,693 | 61,693（max subscriber 1） | 12,055 | 0 |
| Skill | 97 | 2 | 49 | 97（各depth 1件） | 0 / 0 | 0（max subscriber 4） | 0 | 0 |

- Bonus depth work 1件あたり平均約6.4 s、raw solution平均約1.85 M件。Skill depth workは1件あたり約0.1 ms
- scheduler step 382、settle without work 4（計1.2 ms）

### 5.4 window（Search elapsed、記述のみ）

| window | 観測区間 | BONUS | 内 depth_read / ideal_filter / notice_scan | Bonus works | Skill works | Bonus / Skill max depth | yields |
| --- | --- | ---: | --- | ---: | ---: | --- | ---: |
| 0–10分 | 0–600.0 s | 99.997 % | 80.72 / 12.40 / 6.82 % | 103 | 37 | 19 / 19 | 3.68 M |
| 10–20分 | 600.0–1,200.0 s | 99.998 % | 81.44 / 11.91 / 6.59 % | 89 | 30 | 34 / 34 | 3.45 M |
| 20–30分（partial） | 1,200.0–1,789.8 s | 99.998 % | 81.79 / 11.70 / 6.45 % | 89 | 30 | 49 / 49 | 3.27 M |

dominant categoryも、BONUS内部の構成比もwindow間でほぼ変わらない（小差は過剰解釈しない）。max depthは10分ごとに約15ずつ進んだ。

### 5.5 outcome

| 項目 | 値 |
| --- | --- |
| process | timeout（child wall 1,800.4 s、kill at 1,800.0 s）、record null、Candidate 0扱いしない |
| delivery | delivery_flush 0、delivery_consumer 0（Candidate未delivery） |
| peak heap / RSS | 7.61 GB / 8.12 GB（observer付き、B2-C2B2Eとの絶対比較はしない） |
| yields | 10.43 M |
| profile snapshot | 271件（最終はheartbeat、Search elapsed 1,789.8 s）、未観測tail 4.4 s |

## 6. identity / provenance

| 照合 | 結果 |
| --- | --- |
| B2-C2B2E RESULT authority | registered SHA `5bf6bba3…`、formal、`B2C2B2E_INCOMPLETE`、next branch C、hash chain all true |
| population | manifest = 再導出、runner Target / probe / identity = manifest、Target 1 |
| task identity | raw task = B2-C2B2E task行のSearch input identity（11 field）、Exportから再導出したtask = raw task |
| excluded current Route | analyzerの再導出（B2-C2B2Dの `phase2c26b2c2b2dRederiveBaselineContext()`）= B2-C2B2Eの再導出値 = Search childが検索前に記録した値（`4a875aac…`）、key 1件、current Route |
| child-attested Search identity | default / tight Search input digest、extent、group、reservationがB2-C2B2E task行と一致 |
| conditions | 30分 / 12,288 MB / concurrency 1 / retry・fallbackなし / B2-C2B2Eとの差はbudgetのみ / onSearchRuntimeのみ / CPU profilerなし、すべてtrue |

## 7. 次Phase recommendation（本PRでは実行しない）

**BONUS_DOMINANT → Bonus内部の現行hotspot再局所化。** まず既存のA7 / A8 instrumentation（`onGogmaReservedRuntime` によるheld-aware Bonus stream readの内部section）で足りるか確認する。
本Phaseで分かった範囲：

- 時間の81 %は `bonus_depth_read`（held-aware `readReservedDepth()`）の中、12 %がIdeal filter、7 %がnotice scan。Skill / composition / scheduler / deliveryは無視できる
- Bonus depth 1件あたりraw solutionが平均約1.85 M件と大きく、Ideal solutionは計61,693件（raw比約0.012 %）。stream readとfilterのどちらも「raw solution数」に比例している可能性があるが、
  本Phaseはouter sectionまでで、`readReservedDepth()` 内部（prediction / frontier / held skip / retention等）は切っていない
- Skill required 1,083に対し、30分で到達したSkill depthは49（Bonusと同じ深さで進む）。Skill側が遅いのではなく、Bonus depth readが進行を律速していると読める（記述的観察）

16 GB heap、60分超のretry、CPU profilerへは自動で進まない。CPU profileはBonus内部sectionを既存instrumentationで絞った後に検討する。

## 8. tests

`src/benchmarks/plannerGlobalPhase2C26B2C2B2F.test.ts`（19件）：population = B2-C2B2E time_bound timeout 1件（Target / task / rank / extentのhard-codeなし、fail-close）、
manifest（probe + identityのみ、oracle / outcome / bottleneck fieldなし）、条件（12,288 MB / 1,800,000 ms / concurrency 1 / retry・fallbackなし / onSearchRuntimeのみ / CPU profilerなし）、
identity gate、B2-C2B2D task / Search本体とのline-for-line同一性、**Search semantics neutrality**（同一world・同一taskでprofilerあり / なし / B2-C2B2D無計測のrecordが完全一致：
Candidate stable key・順序・summary・stoppedByConsumer / stoppedByExtent・excluded Route、Searchへ渡るinstrumentationはonSearchRuntimeのみ）、strict nesting /
inclusive・exclusive整合 / timeout時open stack保持 / yield帰属、categoryの分割とdouble countなし、coverage、decision境界（0.90 / 0.50 / 0.20 / 60 s）、window、start attestation、
Production import / oracle child isolation、committed RESULT固定。A4のSearch-level neutrality test（`plannerGlobalPhase2C26A4.test.ts`）はそのまま有効。

## 9. 未検証事項・limitation

- 単一run（ばらつき未評価）。Node / Vite SSRでの計測で、Browser Workerの計測ではない
- 30分でtimeoutしたため、Search全体（4 cost cohort drainまで）のprofileではなく最初の約30分のprofile。Route exact、Candidate有無は不明のまま（E1 10 / 11は変わらない）
- `bonus_depth_read` はleafとして計測しており、内部の内訳は未計測
- yield待ち時間にはsetImmediate 1往復中に走る他のmacrotask（memory sampling、heartbeat書き込み）が含まれる
- Production RNG・Search・Plannerの挙動は変更していない。新しいRNG挙動は導入していない

## 10. authority / hash chain

| authority | 値 |
| --- | --- |
| B2-C2B2E RESULT（population source / identity authority） | `5bf6bba389bb3c4f1089ddc9b079426930be203bd5e88f3d3f9b2032a42ecabe`（measured HEAD `e69a94ea…`） |
| Export | `cc35fb5bd85acb417b2ce0229cd79441b48c642ac8af70bbc2dfdfc8c89e1e6b` |
| probe manifest | `800338afa09205c2b6b0abf653cf6f9b5fdaa4447f8dd942d52a7e6046f5b216` |
| raw run / profile | `PLANNER_GLOBAL_PHASE2C26B2C2B2F_RAW.json.local` `f27ea3aa…` / `stage1-t02-r11.profile.jsonl` `d9af9d64…`（.local、未commit） |
