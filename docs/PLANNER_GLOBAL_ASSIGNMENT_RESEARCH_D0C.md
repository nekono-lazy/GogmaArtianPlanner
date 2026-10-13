# Global Planner Global Assignment Phase D-0C（登録条件による正式materialization計測）

Refs #154。Research-only・**formal measurement**。基準main: PR #251 merged `3f6717968da0b29fe8e1e7feda44833d29af0678`
（作業開始時に `main` / `origin/main` / HEADの一致、Working Tree clean、stash / 追加worktreeなしを確認）。
branch: `research/global-assignment-phase-d0c`。**measurement HEAD**: `851e2f689c26aa969937db10457ee48314aac2d4`。
公開RESULT: [`PLANNER_GLOBAL_ASSIGNMENT_D0C_RESULT.json`](PLANNER_GLOBAL_ASSIGNMENT_D0C_RESULT.json)。

**結果: `formalValidity.status = valid`。** D-0B-2で事前登録した条件（W0、規則 `d0a2-v2`、option集合 `a2`、最初のstructural candidate）で、
2つの独立した子processがsemantic recordの一致する計測を完了し、最初のstructural candidate（objective 1,766）の **43 / 43 planning Targetが
`materialized`**（`all_materialized`）だった。`all_materialized` はPlanではなく、Production Planner・Trace Replay・fresh Plannerによる検証（D-1）は行っていない。

## 1. 目的・authority

正式仕様の順位は `AGENTS.md` のとおり `docs/REQUIREMENTS.md` → タスク固有の詳細仕様（`docs/PLANNER_SPEC.md` / `docs/SEARCH_SPEC.md`）→ その他の正式仕様 →
最新mainの実装 → test → 過去の記録である。本書はResearch記録であり、正式仕様でもDomain仕様でもない。
[Global Assignment設計](PLANNER_GLOBAL_ASSIGNMENT_DESIGN.md)（以下「設計」）§9 / §10.3 / §10.4 / §11 / §12 / §14 / §19.7、
[D-0A-2設計](PLANNER_GLOBAL_ASSIGNMENT_D0A2_DESIGN.md)（以下「D0A2」）§9〜§12、[D-0B-2記録](PLANNER_GLOBAL_ASSIGNMENT_RESEARCH_D0B2.md)（以下「D-0B-2」）
§2 / §11 / §12 / §14、[B-2A記録](PLANNER_GLOBAL_ASSIGNMENT_RESEARCH_B2A.md) / [B-2B記録](PLANNER_GLOBAL_ASSIGNMENT_RESEARCH_B2B.md)（formal運用の先例）に従う。

| やること | やらないこと |
| --- | --- |
| D-0B-2の登録条件を変えずに、materialization runnerの `--mode formal` を実装する（start gate、子processの独立gate、formal validity） | 登録値の変更、W0以外のwindow、2件目以降のstructural candidate |
| 登録HEADからの計算関連コードの差分監査 | Production RNG / Search / Planner、Phase A〜Dの計算・方式選択・照合・独立Route検証の変更 |
| measurement HEAD（clean）で登録条件の正式計測（子process 2本） | D-1のProduction Planner・Trace Replay・fresh Planner検証 |
| 公開RESULT（集計とprovenance）と本書の作成 | 実Export・raw record・Target別データのRepository追加 |

### この結果が意味すること・しないこと

| 本書の語 | 意味 | 意味しないこと |
| --- | --- | --- |
| `formalValidity = valid` | 登録条件・provenance・再現性（2 run一致）がすべて成立した正式計測 | 全Targetがmaterializeされたこと（それは別に判定する。§12） |
| `materialized` / `all_materialized` | 期待Route形に一致するEntryを作り、形状制約の22件は独立Route検証（D0A2 §9.3）を通した | Production Plannerで実行可能（`verified`）、Planが成立する、全Targetが完成する |
| structural objective 1,766 | Σ（stream終端 − origin）。必要条件の割当の値 | 物理操作数・実行可能Planの操作数・証明済みの最短 |

## 2. 登録条件

`MATERIALIZATION_D0C_PREREGISTRATION`（`src/benchmarks/globalAssignment/materializationProtocol.ts`、D-0B-2 §12）。formal modeは `registeredD0cConditions()` から
条件を取り、CLIからは何も取らない。`materializationD0cRegistrationIssues()` は空（20項目すべて登録済み、各項目 `oracleInformed: false`）。

| 項目 | 登録値（本計測で使用） |
| --- | --- |
| window | Normal 350 / Gogma 500 / Skill 1,500（W0） |
| nodeBudget / mrvLookahead / coverageDrivenOrdering / structuralCandidateLimit | 2,000 / 8 / true / 1 |
| optionSetVersion / methodSelectionRule | `global-assignment-reach-options:a2` / `d0a2-v2` |
| continuationShapeRule | `lane_start_ideal_skill_continuation`（G1）、`lane_start_ideal_owned_gogma_continuation`（G2） |
| projectedSearchScaleGate | 巨戟化位置32 / Gogma幅500 / Skill幅1,501 / forge 350 |
| shapeSearchScaleGate | depth 2,000 / Gogma生成上界 502,000,000 / forge 350 / 歩行1,501 |
| shapeSearchBudget | Gogma生成state 50,000,000 / Skill state 2,250,000 / settled work 100,000 / 予測 Normal 350・Skill 1,501・Reset 500・Keep 500 |
| routeVerification / materializationOrderRule | `every_shape_constrained_materialization` / `phase-c-design-8.2` |
| envelope | child wall 1,800,000 ms（30分）/ heap 4,096 MB / repeat 2 / concurrency 1 / retry なし |
| CalculationContext / protocol | `unknown-initial` / 4 / `production-rng:c5-e7` / 17、`global-assignment-d0a2b:1` |
| Export identity / repositoryRule | D-0B-2 §2の `registered-export-*` block / `clean_head_no_uncommitted_code_calculation_diff_audited` |

登録条件のSHA-256（`JSON.stringify(registeredD0cConditions())`）: `aedb84bae51b22953913f308240acd4446eb9250149a3b3b63b4df8088971424`。
登録値を固定するtest（`materializationProtocol.test.ts`）が上の全値をliteralで保持する。

## 3. formal有効化commit（= measurement HEAD）

| 区分 | commit | 内容 |
| --- | --- | --- |
| formal実装・有効化 = **measurement HEAD** | `851e2f689c26aa969937db10457ee48314aac2d4` | 下表。`formalRun.enabled = true`（`enabledBy` にPhase D-0Cを記録、`startsIn: 'D-0C'`）。登録値は不変 |
| formal run | measurement HEADで実行（2026-10-13 07:01:01Z〜07:02:10Z） | 登録条件どおり、CLI overrideなし |
| 計測後commit（本書・公開RESULT・設計へのリンク） | 後続（docs-only） | §14 |

| file | 変更 |
| --- | --- |
| `materializationProtocol.ts` | `formalRun.enabled = true`。登録gate `d0cRegistrationGate()` / `d0cRegistrationGateIssues()` を追加し、`materializationD0cRegistrationIssues()` / `registeredD0cConditions()` / `materializationFormalRunIssues()` が任意の登録object（既定は実登録）を受けるようにした（無効・登録不足のsynthetic登録を拒否し続けるため）。登録値・分類・条件検証は不変 |
| `materializationFormal.ts`（新規） | start gate `d0cFormalStartIssues()`、子processの独立gate `d0cFormalChildGateIssues()` / `d0cFormalChildCalculationIssues()`、計算コード監査 `readCalculationCodeAudit()`、child recordの読取り `inspectMaterializationRecord()`、`judgeD0cFormalValidity()`、validityと分けたoutcome `summarizeD0cMaterializationOutcome()`、登録HEAD・formal基盤ファイル一覧・formal CLI一覧 |
| `materializationFormalResult.ts`（新規） | 公開RESULTの導出 `deriveD0cPublicResult()`、再導出・hash対応・最小化の検査 `d0cPublicResultIssues()` |
| `scripts/run-planner-global-assignment-d0b.mjs` | `--mode formal`（登録値だけを使う。§5）。smoke経路の条件解析・メッセージ・記録は従来どおり（RESULTに `formalValidity: not_applicable` と `materializationOutcome` を追加） |
| `scripts/derive-planner-global-assignment-d0c-result.mjs`（新規） | raw出力から公開RESULTを導出（排他書込み）、`--check` で再導出比較 |
| test（6 file、うち新規4）と `materializationFormalTestFixture.ts`（新規） | §15 |

## 4. 登録HEADとの差分監査

登録HEAD `3f67179`（PR #251のsquash merge。`gh pr view 251` の `mergeCommit` で確認）からmeasurement HEAD `851e2f6` までの差分。
`git merge-base --is-ancestor` は成立。`git diff --name-only 3f67179..851e2f6` の **全変更は12 file** で、`src` / `scripts` 以外
（`package*.json`、`vite*.config.ts`、`vitest.config.ts`、`tsconfig*.json`、`eslint.config.js`、`index.html`、`benchmark.html`、`docs/`）の変更は0件。

| 区分 | file | 計測結果への影響 |
| --- | --- | --- |
| formal guard | `materializationFormal.ts`、`run-planner-global-assignment-d0b.mjs`（formal経路） | なし（計算開始前の可否判定。子processはgate通過後に従来と同じ `runMaterializationSmoke()` を呼ぶ） |
| registration / provenance | `materializationProtocol.ts`（`formalRun` とgate関数）、runnerのprovenance・task・record追加field | なし（登録値・条件検証・分類・journalは不変。§2のdiffで確認） |
| RESULTの集約 | `materializationFormalResult.ts`、`derive-planner-global-assignment-d0c-result.mjs`、runnerの `formalValidity` / `materializationOutcome` | なし（計測後のrecord読取りだけ） |
| test | `materializationFormal.test.ts`、`materializationFormalResult.test.ts`、`materializationFormalTestFixture.ts`、`derive-…-d0c-result.test.ts`、`materializationProtocol.test.ts`、`run-…-d0b.test.ts`、`isolation.test.ts` | なし |
| materialization計算処理 | — | **変更0件**（Production RNG / Search / Planner、Phase A〜D: ReachTable・option集合・structural search・被覆・順序・方式選択・形状制約Search・照合・独立Route検証） |

機械的な確認:

- start gateと各子processのgateは、`git diff --name-only <登録HEAD>..HEAD -- src scripts package.json package-lock.json vite.config.ts vitest.config.ts tsconfig*.json`
  がD-0Cのformal基盤ファイル（`MATERIALIZATION_D0C_FORMAL_INFRASTRUCTURE_FILES`）の外を含めばformal runを拒否する。本計測では12 fileすべてが基盤内（`outsideFormalInfrastructure: []`）
- 計測前の非formal確認: measurement HEADと同じ計算コード（commit前、`--allow-uncommitted`）で、登録値のsmoke（`--repeat 2`）を実Exportで実行し、
  semantic SHA-256 `6f790d33…` が2 runとも D-0B-2 の登録値run（`d0b2-reg`、計測HEAD `b4ed799`）と**完全一致**した。formal runのsemanticも同じ値である（§10）。
  非formal確認の出力は `.local/d0c-precheck-smoke.*`（git-ignored）に残し、formal計測の代わりにはしていない

## 5. formal mode（実装した正式計測の規則）

- **CLI**: 許すのは `--mode formal`、`--export`、`--expected-export-sha256`、`--run-dir`、`--output` だけ。他の指定（`--rule`、`--option-set`、条件・envelope、子process用option）は
  登録値と同じ値でもoverrideとして拒否し、`--allow-uncommitted` も拒否する
- **start gate（親、何も書く前）**: formalRunが有効・登録が完全、Working Tree clean・未commitの計算関連コードなし、override・`--allow-uncommitted` なし、
  `git show HEAD:docs/PLANNER_GLOBAL_ASSIGNMENT_RESEARCH_D0B2.md` の登録Export identityが読め、`--expected-export-sha256` がその登録hashで、実Exportの名前・bytes・hashが一致、
  `--run-dir` / `--output` が未使用かつgit-ignored、Exportを出力で上書きしない、計算コード監査（§4）、登録CalculationContextが現行のMaster manifest・Engine・計算版数と一致、
  登録条件のprotocolが登録値と一致。拒否時は子processを起動せず、run dir / outputを作らない（実spawnのtestで確認）
- **子processの独立gate（計算前）**: task.modeがformal、登録gate、taskのprotocol・conditions・envelope・登録HEADが登録値と一致、taskのmeasurement HEADと自分のHEADが一致、
  自分の観測でclean・未commitコードなし・計算コード監査が成立、自分で `git show HEAD:` から読んだ登録Export identityとtaskの記載・自分でhashした実Exportが一致、
  `process.execArgv` に登録heap envelope（`--max-old-space-size=4096`）がある。Export読込み後、計算開始前に、入力のCalculationContextとEngine versionが登録値と一致。
  手書きのformal taskを `--role materialize` で直接与えても、計算を始めずrecordを書かない（実spawnのtestで確認）
- **formal validity**: `judgeD0cFormalValidity()`。smokeは `not_applicable`。formalは、provenance（登録gate、完全な登録、start gate、measurement HEAD・benchmark code hashの記録、
  clean tree、overrideなし、登録条件との差分なし、登録Export一致、計算コード監査、全子processのgateとCalculationContext）、再現性（登録数2のrunが全部measured、recordが完全で親と整合、
  run自身のintegrity issueなし、semantic SHA-256一致、`determinism.identical === true`）、集約 `integrityIssues` が空のすべてで `valid`、それ以外は `invalid`（記録を残して非0 exit）
- **outcome**: `summarizeD0cMaterializationOutcome()` はvalidityと独立に、Target別outcome・方式別件数・gate / budget / unsupported / fail closedの独立件数を数える。
  fail closedは設計上run error（D0A2 §10.2、semantic recordのintegrity issue）なのでvalidityは `invalid` になり、outcomeでは `run_error` として保持する。
  budget到達を2回測った場合は `valid` な計測で、outcomeは `not_all_materialized`（未確認であり成功ではない）。未計測runはjournalが確定したprogressだけを持ち、進行中Targetの結果を補完しない

## 6. 実行環境

| 項目 | 値 |
| --- | --- |
| machine | AMD Ryzen 7 9700X（16 logical CPU）、物理memory 31.1 GiB（起動時free 12.6 GiB）、Windows 10.0.26200 x64 |
| Node / V8 | v24.19.0 / 13.6.233.17-node.51 |
| 並行処理 | concurrency 1、子process 2本を逐次、自動retryなし。計測中に他のtest・build・計測を起動していない（常駐の小さなNode process 3本のみ） |
| 出力 | `.local/ga-d0c-formal.run/` と `.local/ga-d0c-formal.result.json`（どちらもgit-ignored、計測前に未使用を確認） |

## 7. 実Exportのidentity

| | file名 | bytes | SHA-256 |
| --- | --- | ---: | --- |
| 登録（`HEAD:` のD-0B-2 §2 block） | `gogma-artian-planner-backup_20260927015837.json` | 19,424,064 | `cc35fb5bd85acb417b2ce0229cd79441b48c642ac8af70bbc2dfdfc8c89e1e6b` |
| 実Export（親・各子processがhash） | 同上 | 同上 | 同上 |

`registeredMatched: true`、`cliMatched: true`。登録文書（`HEAD:docs/PLANNER_GLOBAL_ASSIGNMENT_RESEARCH_D0B2.md`）のSHA-256は
`e196ad7e7a5e537c6e0d79075861dfba9d8a63275c0325fb1c8cc4073cca8d39`。ExportはコピーもGit追加もしていない。

## 8. 実行コマンド

計測前（measurement HEADでclean）: `git status --short`（空）、`git rev-parse HEAD`（`851e2f6…`）、`git diff --check`、`npm run check:nul`、`npm run lint`、`npm test`、`npm run build`
すべて成功（§15）し、その後もWorking Treeはcleanだった。

```bash
node scripts/run-planner-global-assignment-d0b.mjs --mode formal --export "<local path>/gogma-artian-planner-backup_20260927015837.json" --expected-export-sha256 cc35fb5bd85acb417b2ce0229cd79441b48c642ac8af70bbc2dfdfc8c89e1e6b --run-dir .local/ga-d0c-formal.run --output .local/ga-d0c-formal.result.json
```

親processのexit code 0。`START ... clean=true uncommittedCode=false ... registeredExport=true startGate=passed`。

## 9. formal validity

`formalValidity.status = valid`、`issues = []`。

| check | 値 |
| --- | --- |
| registrationGate / completeRegistration / startGatePassed | true / true / true |
| measurementHeadRecorded / committedCleanTree / benchmarkCodeHashRecorded | true / true / true（benchmark code SHA-256 `7c808111addd4bbda98283aadf67b3f47406e4193504051302c5588dc388a7b0`） |
| noOverrides / conditionsMatchRegistration / exportRegisteredMatched | true / true（`differencesFromRegistration: []`）/ true |
| calculationCodeAudit | passed（登録HEAD `3f67179` はancestor、変更12 fileすべてformal基盤内、`outsideFormalInfrastructure: []`） |
| childGuardsPassed / calculationContextMatched | true / true（両子processの記録: 観測HEAD `851e2f6`、clean、監査issueなし、`git show HEAD:` の登録identity、`execArgv ["--max-old-space-size=4096"]`、CalculationContext・Engineが登録値） |
| reproducibility | requiredRuns 2、runs 2、measuredRuns 2、allMeasured、recordsComplete、recordsConsistent、noRunIntegrityIssues、semanticHashesEqual、identical すべてtrue |
| aggregateIntegrityIssueCount | 0 |

process: materialize-1 / materialize-2 とも `completed`（exit 0、timeoutなし、`close` でsettle）。計測中にRepositoryが変わらなかったことも親が最後に確認した。

## 10. 2 runの決定性

| run | status | semantic SHA-256 | record HEAD |
| --- | --- | --- | --- |
| materialize-1 | measured（完全・整合・子gate通過） | `6f790d33839ce9dcae2bd030b2e0b92c0dd1c5e7c4850de9cbd54dc4ab4cb18f` | `851e2f6` |
| materialize-2 | measured（同上） | 同上（一致） | `851e2f6` |

`determinism.identical = true`。semanticには時間・memoryを含まない。この値はD-0B-2の登録値run（`d0b2-reg`、別HEAD・別日時の非formal）と同一である（§14）。

## 11. structural search結果

| 項目 | 値 |
| --- | --- |
| planning Target数（Phase 0） | 43（Target 43、BuildListEntry 43 / valid 43、OwnedWeapon 40、Normal Counter 14 / confirmed 14、validation issue 0） |
| ReachTable（a2、W0） | origin Skill 341 / Gogma 55、Normal stream 7本。予測 Skill 30,020 / Reset 10,000 / Keep 299,500 / Normal 7,000、unsupported 0 |
| structural search | 展開44 node（max depth 43）、被覆棄却0件、coverage-driven orderingは発動せず、資源棄却 source 63 / Skill位置 35,689 / Gogma位置 513,670 / Normal位置 0、dead end 0 |
| completeness | `structural_candidates_found` / `candidate_limit_reached`（未探索の枝が残る。候補不存在とも最小とも言わない）、window判定 `hold`、`concludesInfeasibility: false` |
| 最初のstructural candidate | ordinal 0、**objective 1,766**（stream終端 Skill 1,424 / Gogma 503。前進 Skill +1,083 / Gogma +448 / Normal +235（4 stream）） |
| source / 要件 | 所持巨戟38 / 所持通常0 / 新規Normal 5、Skill none 21 / `reset_skills` 17 / `conversion` 5、Bonus none 0 / `reset` 1 / `keep_from_source` 19 / `reset_then_keep` 23 |
| Skill依存 / chain segment | 5 / 74 |
| G1 / G2継続option（候補が選んだもの） | 0 / 0 |
| G3静的risk | 上側: 適用option 42のうち3件（collapse条件がrequestで成立したもの1件、collapse署名0件）。下側: 適用option 23のうち0件 |
| G4 | Planner開始時にIdeal武器を持つplanning Target 0件 |

## 12. materialization結果

**正式計測の有効性（§9）とは別に判定した結果**: `verdict = all_materialized`、2 runで同一（`consistentAcrossMeasuredRuns: true`）。

| outcome | Target数 |
| --- | ---: |
| `materialized` | **43 / 43** |
| `shape_mismatch` | 0 |
| `unconfirmed`（`shape_search_budget_reached` を含む） | 0 |
| `not_executed(search_scale_gate)`（射影起点gate・shape gateとも） | 0 |
| `unsupported` | 0 |
| fail closed | 0 |
| 未試行 / 進行中のまま未確定 / 未計測 | 0 / 0 / 0 |

| 方式（D0A2 §11 `d0a2-v2`） | 件数 |
| --- | ---: |
| 連続形 → 射影起点Candidate Search（`continuous_projected_then_shape_constrained`、すべて射影起点で一致） | 21 |
| 非連続形 → `shape_constrained`（`non_continuous_shape_constrained_only`、すべて最初の配送を受理） | 22 |
| 継続形（G1 / G2）、射影起点から形状制約へのfallback、Planner Alternative Search | 0 / 0 / 0 |

materializeしたEntry 43件の識別のfingerprint（順序index・Entry ID・Entry本体hashの列のFNV-1a 32）は `fnv1a32:ed959cc4`（ID自体は公開しない。D-1が同じEntry集合を使うことの照合用）。

### 12.1 Search規模（予測と実測）と独立Route検証

| 成分 | 値 |
| --- | --- |
| 射影起点Search 21件の予測規模の最大 | 巨戟化位置1 / Gogma幅66 / Skill幅531 / forge 206（gate 32 / 500 / 1,501 / 350 の内側） |
| 形状制約22件の予測上界の最大 | depth 321 / Gogma生成上界 21,462,381 / forge 1 / 歩行70（gate 2,000 / 502,000,000 / 350 / 1,501 の内側）、前提違反0 |
| 形状制約22件の実測（合計 / 最大） | Gogma生成state 365,394 / 121,959、Skill state 48,595 / 27,539、settled work 1,174 / 397、予測 Normal 1 / 1・Skill 1,441 / 532・Reset 1,157 / 171・Keep 1,893 / 293、support問合せ418 / 83 |
| 停止 | 22件すべて受理による `consumer` stop、budget超過成分0（登録budget 50,000,000 / 2,250,000 / 100,000 / 350・1,501・500・500 の内側） |
| 予測上界 / 実測（Gogma生成state） | 4.48〜469.74倍（上界は費用の予測値ではない。D-0B-2 §7と同じ） |
| 独立Route検証 | 22件すべて通過（issue 0）、検証した操作 合計787 / 最大321、再予測 Normal 1 / Skill 300 / Reset 51 / Keep 435（Searchのbudgetとは別計数） |

## 13. runtime / memory

| stage | materialize-1 | materialize-2 |
| --- | ---: | ---: |
| child setup（Vite SSR loader、module・Export読込、formal child gate） | 1.06 s | 1.04 s |
| Phase 0 context / Phase A ReachTable | 1.70 s / 11.62 s | 1.70 s / 11.57 s |
| structural search（最初の候補まで） | 18.35 s | 18.34 s |
| 診断 / materialization | 2 ms / 1.81 s | 2 ms / 1.82 s |
| Target時間（合計 / 最大） | 1.79 s / 435 ms | 1.80 s / 444 ms |
| 射影起点 Target（21件、合計 / 最大） | 0.34 s / 120 ms | 0.33 s / 117 ms |
| 形状制約 Search（近似、22件、合計 / 最大） | 1.36 s / 418 ms | 1.38 s / 427 ms |
| 独立Route検証（近似、22件、合計 / 最大） | 94 ms / 17 ms | 90 ms / 17 ms |
| 計算合計 / child wall（record）/ 親の観測wall | 33.52 s / 34.58 s / 34.80 s | 33.45 s / 34.50 s / 34.70 s |
| heapUsed最大 / RSS最大（250 ms標本）/ maxRSS | 0.96 GB / 1.19 GB / 1,164,328 KiB | 0.75 GB / 1.03 GB / 1,004,012 KiB |
| Target確定時のheapUsed（min〜max） | 752〜981 MB | 536〜766 MB |

heap size limit 4.50 GB（`--max-old-space-size=4096`）。親の合計wall 69.6 s。どの子processも登録envelope（30分 / 4,096 MB）の数%で終わった。
形状制約Search / 独立Route検証の時間はD-0B-2の時系列（`shapeTimeline`）による近似である。

## 14. 旧D-0B-2非formalとの比較

比較は集計値だけで行い、過去RESULTは探索入力にしていない（runnerは過去RESULTもoracleも読まない。`oracleFreeExecution: true`）。

| 項目 | D-0B-2 `d0b2-reg`（非formal、`b4ed799`） | D-0C formal（`851e2f6`） |
| --- | --- | --- |
| 条件 | 登録値そのまま（smoke、`differencesFromRegistration: []`） | 登録値（formal、CLI指定なし） |
| semantic SHA-256 | `6f790d33…`（2 run一致） | `6f790d33…`（2 run一致、**完全一致**） |
| 結果 | 43 / 43 `all_materialized`（射影起点21・形状制約22） | 同一 |
| child wall | 34.0 s / 33.7 s | 34.6 s / 34.5 s（setupは1.04〜1.06 s。formal child gateのgit確認を含む） |
| heapUsed最大 | 0.89 / 0.92 GB | 0.96 / 0.75 GB |
| ReachTable / structural search | 11.5〜11.6 s / 17.7〜17.9 s | 11.6 s / 18.3 s |

semantic recordが同一なので、Phase 0〜D-0Aの全出力（ReachTable要約、structural candidate、Target別outcome、Entry ID、Search計数、Route検証）が非formal時と同一である。
D-0Cは、その結果を登録条件・clean HEAD・再現性の下で正式に確認した。時間・memoryの差は同一machineでの通常の変動の範囲である。

## 15. 公開RESULTの作り方と検証

Repositoryは公開されているので、正式RESULT JSONは **formal出力から機械的に導出した公開用の集計・監査RESULT** とした（B-2B §8の方針）。
raw record（`start.json`、task、journal、child record、集約RESULT）は変更せず `.local/`（git-ignored）に保管した。

- 導出: `node scripts/derive-planner-global-assignment-d0c-result.mjs --result .local/ga-d0c-formal.result.json --run-dir .local/ga-d0c-formal.run --public docs/PLANNER_GLOBAL_ASSIGNMENT_D0C_RESULT.json`。
  導出関数 `deriveD0cPublicResult()` はmeasurement HEADでcommit済み（計測後にコードを足していない）。新しい計測・RNG予測・Searchは行わない
- 再導出検査: 同じscriptの `--check` が、raw sourceから再導出したRESULTとの完全一致、各runのsemantic SHA-256 = そのrecordの `JSON.stringify(semantic)` のSHA-256、
  runnerのoutcome = recordから再計算したoutcome、正規化された直列化、データ最小化を確認し、`ok: true`（issue 0）
- データ最小化（`d0cPublicResultMinimizationIssues()`）: raw recordに現れるTarget ID・OwnedWeapon ID・Entry ID・Entry本体hash・search identityの文字列が0件、UUID形式0件、
  ローカル絶対パス0件、Target別fieldのkey（`targets`、`materializationOrder`、`skillDependencies`、`option`、`routeShape`、`plannerRequired`、`reservation`、
  `finalPosition` 等）0件、既知の集計配列（runs、processes、sources、issue一覧等）以外の配列0件。issue文中のIDは `<redacted>` に置換する（本計測ではissue 0件）
- 含めないもの: Target / OwnedWeapon / BuildListEntry ID、Candidate snapshot、Target別RouteOperation列、Target別Counter位置・要件ラベル、materialization順序・Skill依存・
  sourceとTargetの対応、Target別reservation・request、Export本体、絶対パス、process stderr。残すのはstream単位の値（origin、終端、前進）と件数・合計・最大・時間・provenance

| 公開RESULT | bytes | SHA-256 |
| --- | ---: | --- |
| `docs/PLANNER_GLOBAL_ASSIGNMENT_D0C_RESULT.json` | 26,841 | `c8fb070a4589be5276122ad65de5dc7c504d886fb9dcac4ea2b8ac5b68ddad09` |

| raw source（`.local/`） | bytes | SHA-256 |
| --- | ---: | --- |
| `ga-d0c-formal.result.json`（集約RESULT） | 225,633 | `dc2d57b455616ba2c5cb089a590a052c1bbaded9765d8429760891052125e9e1` |
| `ga-d0c-formal.run/start.json` | 7,738 | `1872d03d2963d92b1078f777d766f11a19e3302474164e8bbd4f1a8ba6a1307d` |
| `ga-d0c-formal.run/materialize-1.record.json` | 520,922 | `7746c9ddfa0f6dc9f63bc72e5da625386313c2a54f23131b629dd2459dab1889` |
| `ga-d0c-formal.run/materialize-2.record.json` | 520,938 | `9e27167c0b4da8859bd05a85b4a0bd1b49e801817d501e278ebc9b1de785af40` |
| `ga-d0c-formal.run/materialize-1.journal.jsonl` | 26,219 | `2ad26c843e30616dad8216c9da26b335f87fa49314a67664769ad880c559da1b` |
| `ga-d0c-formal.run/materialize-2.journal.jsonl` | 26,404 | `011627e4c6b69df386f61186ed9a73490abf822d5be131d46f13e927f64b157a` |
| `ga-d0c-formal.run/materialize-1.task.json` / `materialize-2.task.json` | 1,776 / 1,776 | `d7ba94a47ac43d9cba4fb2bd6a3dd4c9202fe7cee81aef787617f0ac824f519c`（同一） |

### 15.1 test・検証

| file | 内容 |
| --- | --- |
| `materializationFormal.test.ts`（新規） | 登録gate（実登録は通過、無効・登録不足・説明欠落・不正値のsynthetic登録は拒否）、計算コード監査（基盤外file・非ancestor・git失敗・別基準を拒否）、start gate（無効・不足の登録、dirty tree、未commitコード、`--allow-uncommitted`、override、Exportの名前・bytes・hash不一致、CLI hash欠落・不一致、登録文書の読込失敗、ignore外の出力、基盤外の計算コード変更、CalculationContext不一致）、child gate（HEAD不一致・欠落、dirty、未commit、条件・envelope・protocol・登録HEAD・登録Export・実Exportの改変、heap flag欠落、無効登録、smoke task）、CalculationContext / Engine不一致、record読取り（不完全・不整合・子gate失敗・別Context、smoke recordの扱い）、validity（2 run一致でvalid、1 runのみ・timeout・OOM・semantic不一致・record不整合・子gate・integrity issueでinvalid、`all_materialized` でもprovenance不正ならinvalid、smokeは `not_applicable`）、outcome（all_materialized、budget到達を2回測ってvalidかつ `not_all_materialized`、gate、fail closedを `run_error` として保持しvalidityはinvalid、未計測runはjournalだけ） |
| `materializationFormalResult.test.ts`（新規） | 導出の決定性と自己検査、ID非含有、再導出不一致・semantic hash不一致・outcome不一致の拒否、ID・Target別key・未知の配列・UUID・絶対パスの拒否、未計測run・budget停止・fail closed（issue文のID置換）の扱い |
| `derive-planner-global-assignment-d0c-result.test.ts`（新規） | 実spawnで導出・排他書込み・`--check`、改ざんRESULT・raw record変更・別run dir・option誤りの拒否 |
| `run-planner-global-assignment-d0b.test.ts`（更新） | formalのstart gate拒否（未登録Export、CLI hash不一致・欠落、override、`--rule` / `--option-set`、子process用option、`--allow-uncommitted`、ignore外の出力。いずれも何も作らない）、手書きformal taskの子process直接起動がHEAD・条件・envelope・登録Export・実Export・heap flagで拒否され、recordを書かずcontextにも進まないこと、smokeは `formalValidity: not_applicable` |
| `materializationProtocol.test.ts`（更新） | D-0B-2の「formal無効」assertを「有効かつ登録値不変」へ置換し、全登録値をliteralで固定。無効・不足の登録はsynthetic登録で引き続き拒否 |
| `isolation.test.ts`（更新） | 新module 2つと導出scriptの隔離（Production非依存、Planner / Search / 予測 / Entry読取りなし、Exportを読まない、64桁hex・UUIDなし、排他書込み） |

既存test（`d0a-v1` golden、PR #248 Production Search golden、a1 / a2、G1〜G4、property / parity、独立Route検証、D-0B smoke）は削除・skip・緩和していない。

| コマンド（measurement HEAD、計測前） | 結果 |
| --- | --- |
| `git diff --check` / `npm run check:nul`（1,485 files） | pass |
| `npm run lint` | pass |
| `npm test` | pass（417 files / 6,846 tests、1 file・3 tests skipped（既存）、約140 s） |
| `npm run build` | pass（既存の500 kB chunk warningのみ。`dist/` にResearch識別子なし） |

最終PR headでの再検証結果はPR本文に記録する。

## 16. 計測後の変更・未確認事項・D-1への引き継ぎ

### 16.1 measurement HEADから最終PR headまでの変更

計測後に追加したのは `docs/PLANNER_GLOBAL_ASSIGNMENT_D0C_RESULT.json`（新規）、本書（新規）、`docs/PLANNER_GLOBAL_ASSIGNMENT_DESIGN.md`（§9.13の要約、§14 / §19.7への
リンク）だけである。`git diff 851e2f6..<PR head> -- src scripts package.json package-lock.json vite.config.ts vitest.config.ts tsconfig*.json` は空であり、
計算関連コード・登録条件・登録文書（D-0B-2記録）は計測後に変わっていない。

### 16.2 未確認事項

- Production Planner・Trace Replay・fresh Plannerによる検証（D-1）。`all_materialized` はPlanでも `verified` でもない
- 2件目以降のstructural candidate、W0以外のwindow（未登録）
- 実ExportでのG1 / G2継続形、射影起点から形状制約へのfallback、`reset(g*)` の形での「操作種別の別解」（本計測の候補では対象0件）
- 121,959 stateを超える形状制約Searchの時間・memory（登録budget 50 Mまでは外挿）
- G4-i / ii / iiiの成否（このExportでは対象0件）
- 他のmachine・Node versionでの決定性・時間
- 構造探索時間のa1 / a2差（D-0B-2 §8.2の1）の原因

### 16.3 D-1への引き継ぎ

1. D-1は、本計測の最初のstructural candidate（objective 1,766）の43 Entryを入力にPhase D'（Production Plannerの決定的scheduler、Trace Replay、fresh Planner検証）を行う。
   raw record（`.local/ga-d0c-formal.run/materialize-1.record.json`。SHA-256 §15）が持つのはTarget別のEntry IDとEntry本体hashだけで、Entry本体は含まない
   （runnerはEntryをResearch dataとしてprocess内にだけ持つ）。D-1は同じ入力・条件でmaterializationを再実行してEntryを得て、semantic SHA-256 `6f790d33…`、
   Target別のEntry ID / 本体hash（raw record）、Entry fingerprint `fnv1a32:ed959cc4` の一致で同じEntry集合であることを確認する
2. D-1の判定（`verified` / `planner_rejected` 等）は設計 §9.5 / §13.2の事前登録で行い、本書の `all_materialized` を成功の根拠にしない
3. 計算版数・Engine version・Master data・Phase A〜Dの計算コードが変われば、本計測の結果は再登録・再計測なしには引き継がない（formal gateの計算コード監査は、
   D-0Cのformal基盤以外の変更でformal runを拒否する）
