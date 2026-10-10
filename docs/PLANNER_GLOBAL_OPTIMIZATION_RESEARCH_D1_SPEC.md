# Global Planner Research D1-A（Phase B `found_R` 11 Candidate共存診断の事前登録）

Refs #154。**docs-only**。基準main: PR #221 merged `3ffd37800ba9ef11d53bd811887c043e3db07990`（作業開始時に `main` / `origin/main` / HEADの一致、
Working Tree clean、stashなしを確認）。

本書は [Phase 2-C2.7-B follow-up](PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_PHASE2C27B_FOLLOWUP.md) §9.1で提案された **D1（Phase B `found_R` Route集合の
共存診断）** の実行条件を、実装・計測より前に確定する事前登録である。D1は「Phase 2-C2.7-C」（Phase A §10.2のProduction compatible architecture設計）
とは別のResearch項目であり、名称を混同しない。本書ではResearch項目名を **D1**、本書による事前登録を **D1-A**、実装と正式計測を **D1-B** と呼ぶ。

本PRで変更していないもの: Production source、Search / Planner / RNG、Worker、UI、Persistence、schema / version、Production default / bounds、
既存formal RESULT、Phase A / Phase B / follow-up文書、既存Research runner / analyzer、正式仕様の意味論。新規Search run、Candidateの再delivery、
full Planner run、formal measurement、RESULT JSON生成、oracle読み取りは行っていない（§1.2の値は既存recordのSHA-256照合と読み取りだけで得た）。

## 0. 位置づけとauthority

本書はResearch文書であり、正式仕様ではない。authorityは `AGENTS.md` の順位どおり `docs/REQUIREMENTS.md`（23 / 23.1）→ `docs/PLANNER_SPEC.md`
（9.2.3.1、9.2.18、9.2.19）/ `docs/SEARCH_SPEC.md`（5.6.8）→ その他の正式文書 → 実装 → test → Research文書である。本書は現行Production semanticsを変更しない。

Research authorityの順位（D1の中で矛盾があれば上を優先し、矛盾は報告してD1-Bを止める）:

1. 本書（D1-A事前登録）
2. follow-up（§4.3 R0〜R6、§5 support、§9.1 D1案、§9.3 G13〜G18）。本書が変更した点は §11 に列挙する
3. Phase A（§2 G1、§6.4 `found_R`）、Phase B（§1.3 trial harness）

D1-Bは本書の規則だけで判定でき、実装時に意味論を追加決定しなくて済むことを目標とする。実装名（module / 関数 / fieldの綴り）はD1-Bで決めてよいが、
§8のRESULT必須fieldの意味と§7の判定順序を変えてはならない。変える必要が生じた場合は、D1-Bの正式計測前に本書を更新する（docs PR）。

## 1. 目的・スコープ・入力

### 1.1 目的とスコープ

Phase Bで停止した11 Candidate（各E1 Targetの停止時 `found_R` Candidate 1件）が、**集合として共存できるか** を診断する。

| 項目 | D1の値 |
| --- | --- |
| 対象Target | Phase BのE1 11 Target（Phase B RESULTの `found_R` unit 11件から機械導出。§1.3） |
| 置換するCandidate | 各Targetの停止時 `found_R` Candidate 1件（以下 `G_t`。元Route `O_t` を置換する） |
| その他32 Target | 元Route（Export上のEntry）のまま。置換しない |
| Export / RNG / CalculationContext | Phase Bと同じ（Export `cc35fb5b…1e6b`、`production-rng:c5-e7`、`{ gameVersion: 'unknown-initial', masterDataVersion: 4, rngEngineVersion: 'production-rng:c5-e7', appSchemaVersion: 17 }`） |
| Plan step bound | Research `researchMaxPlanSteps = 20000`（Phase A §1のC。Production A / Bと混同しない、G12） |
| conflict resolution / fixed constraint | すべての評価runで `conflictResolutions = []`、preflightのfixed constraint `[]`（G1） |

D1の対象外:

- 新しいCandidateを発見すること、Candidateを選び直すこと、最適化すること（Searchは§3の再deliveryだけで、記録済みdelivery indexで止める）
- oracle exactとの比較。oracle（RESULT `PLANNER_GLOBAL_1657_ORACLE_RESULT.json`、manifest、module）は **実行入力にも診断入力にも使わない**。post-hocにも読まない
- Phase Bのformal RESULT、`found_R`、`B2C27B_INCOMPLETE`、per-Target class（`found_non_oracle` 11）の書き換え。D1の結果をPhase Bのdecision inputへ戻さない（G16）
- 43 / 43、Conflict 0、Issue #154のacceptance（R6）の判定。E1以外のTargetは元Routeのままなので、D1はR6を主張しない

### 1.2 入力とprovenance（登録digest）

D1が読む入力は次に限る。いずれもRepositoryへ追加しない（commit済みのものを除く）。`.local` 配下のpathはRepository rootからの相対pathである。

| 入力 | 場所 | bytes | SHA-256 |
| --- | --- | ---: | --- |
| Phase B formal RESULT（committed） | `docs/PLANNER_GLOBAL_PHASE2C27B_RESULT.json` | — | `d79ea0ded7824f8ba1828d1cffd897ed74dd68681a5759cbb194da80aa79b8e4` |
| Phase B raw（commitしない） | `.local/PLANNER_GLOBAL_PHASE2C27B_RAW.json.local` | 2,567,122 | `f8c16d9f8a420bad139cd26c71574ff3c3517c8321faa5c2ab26a83f514c3bed` |
| Phase B start attestation | `.local/c27b-formal.run/start-attestation.json` | 5,799 | `d76ebc4d7c9f7ce85404af147c2ea45c54511293b17cef52eaf0c6d0525f5c31` |
| Phase B tasks record | `.local/c27b-formal.run/tasks.record.json` | 159,706 | `7c4a7d98d60857e459b743894d899785db042cc9eefa6633c47128e064d7026d` |
| Phase B population manifest | `.local/PLANNER_GLOBAL_PHASE2C27B_FORMAL_TARGETS.json.local` | 967 | `d4486ba399cb8c0f9272e2c3335e543c8727955f8d9686481fc2975d7874d9de` |
| Export（commitしない） | `gogma-artian-planner-backup_20260927015837.json`（外部path、引数で渡す） | 19,424,064 | `cc35fb5bd85acb417b2ce0229cd79441b48c642ac8af70bbc2dfdfc8c89e1e6b` |
| found_R unit record 11件 / unit task 11件 | `.local/c27b-formal.run/<unitId>.record.json` / `<unitId>.task.json` | §1.3 | §1.3 |
| Phase 2-C2 RESULT（committed、`baseline.summary` のみ） | `docs/PLANNER_GLOBAL_PHASE2C2_RESULT.json` | — | `afb70e9745bc56c264c8892075e6adbb8886b82cec1491177aa75d265f1833a4` |
| Phase A文書 | `docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_PHASE2C27A.md` | — | `b45daa271258a2501a94547449cabc019e01477a770957dd831a27a127054147` |
| Phase B文書 | `docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_PHASE2C27B.md` | — | `e05eea56d3c9c8cdeae1f086e9ca6b2a4fa326fd1e9de87914e120a4488dff9c` |
| follow-up文書 | `docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_PHASE2C27B_FOLLOWUP.md` | — | `335a6710d49bcdc1a9ef05a822a9931f40610c714561ae665ac008e82b987083` |
| 本書 | `docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_D1_SPEC.md` | — | D1-Bのmeasurement HEADでgit objectから計算し、start attestationへ記録する |

Phase B provenance（照合用、RESULT記載値）: measurement HEAD `b24bf5dc7d98cb8341a24d27fabbd1a36843a004`、benchmark code SHA-256
`53480b3dbe9fd1a08bc6824c9c33c197fbd8ad61a6a3437c46155baa6585cadf`、`provenance.formal = true`、`runStatus = completed`、decision `B2C27B_INCOMPLETE`。

**Phase B RESULTの読み取り範囲（allowlist）**。Phase B RESULTにはpost-hocのoracle由来field（`targets[]` のcovering rung・oracle意味照合・class、
`oracleMaterialization`、`hashChain` のoracle項目、`aggregates.classCounts` / `exactRecovered` 等）が含まれる。D1はこれらを読まない。読んでよいのは次だけである。

- `sources`（`run` / `runDir` / `attestation` / `tasksRecord` / `targets` / `export` / `unitRecords`。`oracle` / `oracleManifest` / `oracleModule` のentryは
  開かず、digest照合にも使わない）
- `provenance.formal` / `measuredHead` / `runStatus` / `benchmarkCodeSha256` / `calculationCodeChangedSinceMeasuredHead`
- `decision.case`
- `units[]` のうち `result === 'found_R'` のentry全体（`unitId` / `result` / `process` / `deliveries` / `trials` 等。oracle由来fieldを含まない）と、
  全entryの `unitId` / `result`（found_R件数の照合だけに使う）

Phase 2-C2 RESULTは `baseline.summary` だけを読む（`oracleCoverage` 等は読まない）。ExportはPlannerInput構築と、Entry ID → Target IDの対応にだけ使う。

**入力検証の失敗は黙って代替しない**。ファイル不足、SHA-256不一致、record間の不整合（§9.1）があれば、別ファイル・再計算値・近い値で代替せず、
D1-Bのrunnerはchildを1つも起動せずに終了し、analyzerは `D1_INVALID`（reason category `input_evidence`）を出す（§7）。

### 1.3 found_R 11件（登録値）

Target indexはPhase B manifest順（Target ID昇順）である。D1-Bはこの表の値を **Phase B RESULTの `units[]` と各recordから機械導出** し、本表と一致することを
analyzerで確認する（D1-B sourceにTarget ID / Entry ID / stable keyを書かない。file名と下表のSHA-256は登録値としてsourceに置いてよい。いずれもoracle情報ではない）。

| t | TargetWeapon ID | unit | context | rung / extent | support Entry | reservationDigest | `O_t`（current Entry） | `G_t`（generated Entry） | delivery index | `route.operations` 件数 / kind |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | ---: | --- |
| t00 | `02876df4-cd56-4c95-add9-9e3e9cc90801` | `t00-r01-L1` | P1 rank 1（K0） | L1 `{8, 235, 256}` | なし | `fnv1a32:5ac88909` | `build-list.fnv1a32-bb36c5ca` | `build-list.constrained.fnv1a32-7d4b2409` | 0 | 175 / `normal_artian_to_gogma` |
| t01 | `05e6b206-21d4-447d-86dd-f5a62ff8479e` | `t01-r01-L1` | rank 1（K0） | L1 | なし | `fnv1a32:5ac88909` | `build-list.fnv1a32-c1fe111c` | `build-list.constrained.fnv1a32-174be6b1` | 0 | 92 / `existing_gogma_mixed` |
| t02 | `070a1222-5e31-4c9f-a035-c557bfa7be73` | `t02-r01-L2` | rank 1（K0） | L2 `{128, 235, 1500}` | なし | `fnv1a32:5ac88909` | `build-list.fnv1a32-32e817d9` | `build-list.constrained.fnv1a32-dbf1db6f` | 0 | 475 / `normal_artian_to_gogma` |
| t03 | `188571a7-b480-4085-a8f5-59666c0e4cc5` | `t03-r01-L2` | rank 1（K0） | L2 | なし | `fnv1a32:5ac88909` | `build-list.fnv1a32-dd79ecce` | `build-list.constrained.fnv1a32-4da2d9be` | 0 | 326 / `normal_artian_to_gogma` |
| t04 | `a367c177-a0c2-4986-995e-4efcf4131b5c` | `t04-r01-L2` | rank 1（K0） | L2 | なし | `fnv1a32:5ac88909` | `build-list.fnv1a32-a3d6817e` | `build-list.constrained.fnv1a32-a96f6a3f` | 0 | 1142 / `existing_gogma_mixed` |
| t05 | `a6c17e25-bd3a-42e1-b86a-c813b78acde0` | `t05-r01-L0` | rank 1（K0） | L0 `{4, 235, 4}` | なし | `fnv1a32:5ac88909` | `build-list.fnv1a32-df40f28f` | `build-list.constrained.fnv1a32-280640d7` | 0 | 97 / `existing_gogma_mixed` |
| t06 | `b27e57a7-4a80-41a8-8d8d-17bc44f868a7` | `t06-r01-L0` | rank 1（K0） | L0 | なし | `fnv1a32:5ac88909` | `build-list.fnv1a32-5923e1d5` | `build-list.constrained.fnv1a32-3a6f271d` | 0 | 162 / `existing_gogma_mixed` |
| t07 | `b6780f04-da21-42b0-af8c-88f09a192e17` | `t07-r01-L1` | rank 1（K0） | L1 | なし | `fnv1a32:5ac88909` | `build-list.fnv1a32-fd6caf7b` | `build-list.constrained.fnv1a32-0f0b9ba2` | 0 | 255 / `existing_gogma_mixed` |
| t08 | `d453ca34-a142-4241-9dce-8551c96cb887` | `t08-r01-L2` | rank 1（K0） | L2 | なし | `fnv1a32:5ac88909` | `build-list.fnv1a32-7df2bbec` | `build-list.constrained.fnv1a32-39482235` | 0 | 551 / `existing_gogma_mixed` |
| t09 | `e4147de7-587c-4106-a47d-b09f8796464d` | `t09-r10-L1` | rank 10（K1） | L1 | `build-list.fnv1a32-e396d352`（Target `820831d0-edd9-4005-a4a2-c8025cdad2c2`） | `fnv1a32:240e4673` | `build-list.fnv1a32-a1d13672` | `build-list.constrained.fnv1a32-fa630184` | 0 | 267 / `existing_gogma_mixed` |
| t10 | `e523209e-57e8-4316-a7f0-329f64fd0b00` | `t10-r01-L1` | rank 1（K0） | L1 | なし | `fnv1a32:5ac88909` | `build-list.fnv1a32-66c25e3d` | `build-list.constrained.fnv1a32-d72e971a` | 0 | 51 / `normal_artian_to_gogma` |

- 11件とも開始時ladder stateは初期値（`candidateTrialsUsed = 0`、`plannerRerunsUsed = 0`、`previouslyRejectedCandidateStableKeys = []`）、trial 1件・delivery 1件、
  `found.trialOrdinal = 0`。再deliveryの規則（§3）はdelivery index一般について定めるが、登録値ではすべて0である
- `route.operations` 件数はoperation要素数で、Phase B §4.2の「推定操作数」（`estimatedOperationCount`）とは別の量である
- support Entry `build-list.fnv1a32-e396d352` のTarget `820831d0…` はE1外なので、D1のどの置換集合でも置換されない

record / taskのdigest（record SHA-256はPhase B RESULT `sources.unitRecords` の値。task SHA-256は本書作成時に `.local/c27b-formal.run/` のファイルから計算した値）:

| unit | record bytes | record SHA-256 | task SHA-256 |
| --- | ---: | --- | --- |
| `t00-r01-L1` | 98,903 | `ed94cce4cbb19736c4db65db0ec5237da464d54c46dee23444d1e1a0078630bc` | `0ee64040137b8d2dd8c1dd37fdd7487ce3fb3fefdda1020de112ddfc85f01615` |
| `t01-r01-L1` | 73,825 | `382c1235fca239160030c3b71b9d2def42e514e7823d0734d547229dd7ace292` | `107451849e11ae50ae9a10078e36bae0b0299f18c68db8c0cd1f76cd6f6460b0` |
| `t02-r01-L2` | 267,503 | `0f02586bbf78f1da6738c09874c44148e5ce408a738fd4b3bb06ab2f07845dc5` | `1260b39d69bf5c7e33b2eac54685bab7a5b75b519ea562b3cfbaa7a63f81658c` |
| `t03-r01-L2` | 195,821 | `97aff925036b65a201b22345c2d0b3df4b98ede3598559a49af3f3355ebcb92f` | `f8109f037c3af290284b795591b8bd2b894584b32ed167b01407ec40325e93ee` |
| `t04-r01-L2` | 831,918 | `3b5ba758838f76b0f7cc09a130259640a269d164f350cbf75829faf9202a9fcb` | `04025f86523d075547f6a6c5c643be8cfc9648ff12097f27be146edf53a56aac` |
| `t05-r01-L0` | 76,565 | `57a9dfc34a25fce82b2afe26fc0e362646906a2ad29b973eb9eb06a0370ab051` | `fe3c82cbd837554877fd14ef8249255541dfa9337490e1b752fe47d8940c8b12` |
| `t06-r01-L0` | 124,440 | `726c78dccf6e7562c36b9a28f16fabbe6b072c73094daa3bf18c23f2cb679d03` | `671672ed0621ce09fc61c08ffb320cdf9d261be887c7f4feebf12f891436ce65` |
| `t07-r01-L1` | 177,405 | `96ac0928f4edcefd6dcd63a2a1693585875962258d7bf286a7bd693290a171b4` | `d69f0d16bf84e9b4674dbe78b3460c305f283f3b7695e29a2e6f7b8d65a8129d` |
| `t08-r01-L2` | 403,338 | `91231ae09dfad973ca841e07e38cf08d42aeb2b5ca6688eeb619a92eddfb7b6a` | `0755b2c328a00c5d91d7a04ef5831ef2f57d6df3f88cc0b8f4c126dda9e70ff3` |
| `t09-r10-L1` | 203,547 | `4de5f215bcd2d752c336ce1c92968880be9512c0df30c857f75469edd3bc7214` | `273c35ac7a3c549b311d03ee900fc2ea79f2333a724dd1d8bb362501f1a6dd52` |
| `t10-r01-L1` | 37,360 | `c9d927eff709de978df01275afb08db5ac7599b3774423b6011ab0ddf3186906` | `e4f6ed5a4f0886a4c8f8bbd9622f2811d174a62fc5a80b2c2913969dfb501099` |

Phase B trialの記録（Sのparity照合の対象。§5.2）:

| t | plan | termination | completed / 43 | steps | selected | Conflict | `G` selected | `G` commitment（`provisionalOutcomeSelectedBuildListEntryId`） | support selected | full run |
| --- | --- | --- | ---: | ---: | ---: | ---: | --- | --- | --- | ---: |
| t00 | true | exhausted | 20 | 1465 | 20 | 21 | false | dropped（`build-list.fnv1a32-e396d352`） | — | 1 |
| t01 | true | exhausted | 21 | 1465 | 21 | 22 | true | secured | — | 1 |
| t02 | true | exhausted | 19 | 1259 | 19 | 21 | false | dropped（`build-list.fnv1a32-e396d352`） | — | 1 |
| t03 | true | exhausted | 20 | 1465 | 20 | 22 | false | dropped（`build-list.fnv1a32-92d87b90`） | — | 1 |
| t04 | true | exhausted | 19 | 929 | 19 | 21 | false | dropped（`build-list.fnv1a32-92d87b90`） | — | 1 |
| t05 | true | exhausted | 20 | 1465 | 20 | 21 | false | dropped（`build-list.fnv1a32-61066e62`） | — | 1 |
| t06 | true | exhausted | 20 | 1465 | 20 | 21 | false | dropped（`build-list.fnv1a32-85dc00cc`） | — | 1 |
| t07 | true | exhausted | 21 | 1465 | 21 | 20 | true | secured | — | 1 |
| t08 | true | exhausted | 20 | 1465 | 20 | 21 | true | secured | — | 1 |
| t09 | true | exhausted | 20 | 1465 | 20 | 21 | true | secured | `build-list.fnv1a32-e396d352` selected | 1 |
| t10 | true | exhausted | 19 | 929 | 19 | 21 | false | dropped（`build-list.fnv1a32-e396d352`） | — | 1 |

dropped 7件の `rejectionReasons` はすべて `['conflict_not_committed']`、`warningKinds` は11件とも `[]`、`generatedConflictsWithSupport` は11件とも `false`、
`reachedLimits` は11件とも `[]`。

## 2. 段階と件数

| 段階 | 内容 | 件数 | `evaluatedAgainst` | 判定に使うもの |
| --- | --- | ---: | --- | --- |
| V | 入力検証（親プロセス。childを起動しない） | — | — | §9.1。失敗は `D1_INVALID` |
| R | Candidate再delivery（§3） | 11 | — | 一致しなければ `D1_INVALID` |
| B0 | baseline参照評価（§5.1） | 1 | `baseline_reference` | Phase 2-C2 baselineとのparity。差分計算の基準 |
| S | 単体parity（§5.2） | 11 | `baseline` | Phase B trialとのparity。R5は判定しない |
| P | pairwise（§5.3） | 55 | `replacement_set` | R5 |
| A(a) | 11件全部（§5.4） | 1 | `replacement_set` | R5 |
| A(b) | Phase Bで `G` securedの4件（§5.4） | 1 | `replacement_set` | R5 |
| A(c) | 決定的な単調合成（§5.4） | 11 | `replacement_set` | R5 |

- **full Planner評価リクエスト数は80**（登録評価79 = S 11 + P 55 + A 13、およびbaseline参照B0 1）。80はchild processとして起動する評価リクエストの数である
- 内部のfull Planner起動回数（runtime-unsupported retryを含む）は評価リクエスト数と混同せず、評価ごとに `fullRunsStarted` として別に計測する（§6.3）
- R 11件は評価リクエストではなく、Search再deliveryのchild processである（full Plannerを起動しない）

## 3. R: Candidate再delivery

### 3.1 目的

11件の停止Candidateを、Phase Bのtask条件から既存Searchを再実行して **忠実に復元** する。新しいCandidate選択policyの探索ではない。
`route.operations` 等からCandidateやBuildListEntryを直接組み立てない（follow-up §2.2.4 / §9.1）。

### 3.2 手順（unitごとに1 child process）

1. Exportから `globalResearchInputFromExport(Export, 20000)`（Phase B childと同じ）でbaseline PlannerInputを作り、`conflictResolutions.length === 0` と
   `options.maxPlanSteps === 20000` を確認する。dependencyはPhase B childと同じ構成（Production RNG Engine、Research用の固定ID Factory / Clock）とする
2. 記録済みtask（record内 `task`）について、Phase Bの `runPhase2C27BUnit()` と同じ検査を行う: B2-C1 scheduleの再導出、policy drift、task fieldと
   K ≤ 1 context（`groupIndex` / `reservationDigest` / `cardinality` / `representativeFixedSetId` / `supportBuildListEntryIds`）の一致、
   `phase2c27bResolveSupportContext()` によるcontext解決、Planner-start originのdigestがsnapshotのorigin digestと一致、current Entryがtaskの
   `currentBuildListEntryId` と一致、除外Route keyがsnapshotと一致、再導出reservationがgroup reservationと一致し `hashStableValue()` がtaskの
   `reservationDigest` と一致
3. 追加で、再導出したreservationと除外Route keyが、recordの `result.reservation` / `result.excludedRouteKeys` と `stableStringify()` で一致することを確認する
4. Phase Bと同じSearch入力 `{ origin, targetWeaponId, extent: task.extent, reservation, excludedRouteKeys }` で
   `createPlannerAlternativeMaterializer({ ...searchInput, clock })` を作り、`visitPlannerAlternativeCandidates()` を実行する。capture policyは付けない
5. delivered Candidate `i`（0始まり）ごとに:
   - `candidateStableKey(candidate) === record.result.deliveries[i].stableKey`、かつreservation checkの `respects` が記録と一致
   - `i < d`（`d` = 記録済み `found.deliveryIndex`）: Phase Bと同じくtrialせず次へ（登録値では `d = 0` なので該当なし）。ただしPhase Bで当該deliveryが
     `skipped_previously_rejected` / trial reject等だった場合でも、Rはtrialを再実行しない（delivery列の一致だけを確認する）
   - `i === d`: `materializer.materializeBuildListEntry(candidate, baseline.buildListEntries)` を実行し、§3.3の一致を確認してconsumerを `stop` する
6. Searchが `d` に達する前に終了（`exhausted` / extent bound）した場合は不一致である
7. 一致したら、materializerが出力した `G_t` のBuildListEntry（body全体）をD1 run dirの **G store**（`<unitId>.generated-entry.json`）へ書き、
   SHA-256をrecordに記録する。S / P / Aはこのbodyだけを使う（§4.1）

### 3.3 一致条件（すべて必須。1つでも不一致ならfail closed）

| 項目 | 比較 |
| --- | --- |
| delivery prefix | `i = 0..d` の `candidateStableKey()` が記録と完全一致 |
| `candidateStableKey()` | `candidateStableKey(candidate) === candidateStableKey(G_t.candidateSnapshot) === found.candidateStableKey` |
| generated Entry ID | `G_t.id === found.generatedBuildListEntryId`（= trial recordの `generatedBuildListEntryId`） |
| `reusedExisting` | `false`（Phase Bと同じ） |
| `route.operations` | `stableStringify(candidate.route.operations) === stableStringify(found.route.operations)`。`route.kind` / `sourceOwnedWeaponId` も一致 |
| Candidate結果 | `finalBonuses` / `restorationBonusScope` / `seriesSkillId` / `groupSkillId` / `estimatedOperationCount` が `found` と一致 |
| Search / materialization identity | Search入力（origin digest、`targetWeaponId`、`extent`、reservation digest、除外Route key）が記録と一致。generated Entry IDはこのidentityとCandidate semantic meaningから決定的に導出されるので、ID一致をidentity一致の確認とする。materializerがidentityを公開する場合はその値も記録する |
| Search summary | `deliveredCandidates === d + 1`、`stoppedByConsumer === true`（Phase Bの記録と同じ） |
| replacement | `resolveBuildListEntryReplacement(baseline.buildListEntries, G_t)` が `ready` で、`replacedBuildListEntryId === task.currentBuildListEntryId`（`O_t`） |

`createdAt` 等Clock由来のdisplay fieldは比較しない（generated Entry IDとCandidate意味には入らない）。

### 3.4 Rの結果

- 一致: `redelivered`（G store書出し済み）
- 不一致（§3.3のいずれか、§3.2-2の検査失敗 = Phase Bの `context_mismatch` に当たるもの、Searchが `d` 前に終了、Search / materializationが型付きerrorを投げた）:
  `redelivery_mismatch` → `D1_INVALID`。Phase Bで同じ入力からdeliverできたので、計算errorも不一致として扱う
- timeout / OOM / process failure（recordが無い・exit code非0）/ interrupted: unmeasured。そのTargetの `G_t` は使えない（§6.4）

## 4. 評価runの共通手順

### 4.1 入力の構成（B0以外）

置換集合 `T`（Target集合。Target ID昇順に並べる）について:

```text
baseline   = globalResearchInputFromExport(Export, 20000)          // conflictResolutions = [] を確認
G_T        = T の各 t について G store の G_t（Rが書いたbody。SHA-256をRの記録と照合）
replacements = T の各 t について resolveBuildListEntryReplacement(baseline.buildListEntries, G_t)
               // ready かつ replacedBuildListEntryId === O_t でなければ不変条件違反（D1_INVALID）
augmented  = { ...baseline, buildListEntries: [...baseline.buildListEntries, ...G_T] }   // G_T はTarget ID昇順で末尾に追加
contexts   = createPlannerConflictContexts(preparePlannerInitialContext(baseline).context)
preflight  = preparePlannerReplacementConflictPreflight(augmented, replacements, [], contexts, dependencies)
  preflight.status !== 'ready'  -> 評価status = preflight_refused（§6.2）
  resolvedInput.conflictResolutions.length !== 0 -> G1違反（D1_INVALID）
budget     = Research評価budget（limit 8、各評価リクエストで新規、§6.3）
run        = createPlannerAlternativeFullRunner(budget, dependencies).run(resolvedInput, { kind: 'temporary_replacement', replacements })
  'rerun_budget_reached' -> 評価status = planner_rerun_bound_reached（§6.2）
```

これはPhase B §1.3のtrialと同じ部品・同じ順序であり、`|T| = 1` のときPhase Bのtrial入力と同じになる。複数置換は
`preparePlannerReplacementConflictPreflight()` / 9.2.18の部品（`applyBuildListEntryReplacements()` / `validateBuildListEntryReplacements()`）が
そのまま受け取る。resolution、scenario resolution、repair lineage、`selectedBuildListEntryId` を作らない（G1、G17）。support Entryは通常のEntryのままである。

full runは `createProductionPlanWithObserver()`（deterministic scheduler）+ Trace Replayであり、runtime-unsupported retryはProductionの
`generatePlanFromFullRun()` が同じrunner・同じbudgetで行う。

### 4.2 記録する項目（すべての評価で共通）

| 項目 | 内容 |
| --- | --- |
| 入力 | `evaluationId`、段階、`evaluatedAgainst`、置換Target集合 `T`、`G_T` のEntry ID、各 `G_t` のG store SHA-256、`requiresSupport`（`G_t` ごと。t09だけ `['build-list.fnv1a32-e396d352']`）、`inputDigest`（§9.4） |
| 実行 | process outcome（completed / timeout / OOM / failure / interrupted）、exit code、wall、heap / RSS peak、`fullRunsStarted`、runtime-unsupportedで除外されたEntry ID |
| preflight | status、refusalのtyped status（refused時） |
| Plan | `planPresent`、`termination`（`status` / `completedTargetCount` / `totalTargetCount` / `reachedLimits`）、step数、`selectedBuildListEntryIds` 全体（ID昇順）、warning kind |
| Conflict | `result.conflicts` の各要素: `id`、`kind`、participant（`buildListEntryIds` をID昇順）、`selectedBuildListEntryId`、`recommendedBuildListEntryId`、resource identity（§4.3）、participantに `M`（§4.4）の要素を何件含むか |
| route commitment | 各 `G_t` と各support Entryの `status`、`provisionalOutcome.selectedBuildListEntryId`、`rejectionReasons`（`PlannerRunResult.routeCommitment`） |
| Candidateごと | `G_t` selected、commitment status、`target_regressed_R`（`O_t` がB0でselected、かつ `G_t` がselectedでない）、support selected、support依存の有効性（§4.5の各checkの結果） |
| R5 | 5条件それぞれの成否、`satisfied`、failure reason（§4.4。S / B0は `judged = false`） |
| baseline差分 | B0との差: completed、Conflict件数、step数、selected Entryの追加 / 削除、Conflict（`kind` + participant集合で同定）の追加 / 削除。B0がmeasuredでない場合は差分を `null` とし、理由を記録する |
| `resultDigest` | §9.4 |

### 4.3 Conflictのresource identity（診断用）

`PlanConflict` 自体はresource位置を持たないので、最終runの入力（runtime-unsupported retry後の最終入力）について
`createPlannerConflictContexts(preparePlannerInitialContext(最終入力).context)` を作り、`conflictId === PlanConflict.id` のcontextの
`resourceIdentity`（`plannerConflictResourceKey()` で文字列化）を記録する。一致するcontextが無い場合は `resourceIdentity = null`、
`resourceIdentityMatched = false` として記録し、推測しない。resource identityは診断fieldであり、R5の判定には使わない（R5(4)はparticipantで判定する）。

### 4.4 R5（`set_coexistent_R`）の判定条件

follow-up §4.3のR5の5条件を維持し、次のとおり実装可能な粒度に確定する。R5は `evaluatedAgainst = replacement_set` の評価（P / A）だけで判定する。

記号: 置換集合 `T`、`S_G = { G_t.id | t ∈ T }`、`S_sup = ⋃_{t ∈ T} requiresSupport(G_t)`（D1ではt09を含む集合で `{ build-list.fnv1a32-e396d352 }`、
それ以外は空）、`M = S_G ∪ S_sup`、`selected = plan.selectedBuildListEntryIds`。

| 条件 | 判定 | failure reason |
| --- | --- | --- |
| (1) 集合内すべてのGがselected | `S_G ⊆ selected` | `generated_not_selected`（どの `G_t` かを列挙） |
| (2) 必要supportがselected | `S_sup ⊆ selected`（`S_sup` が空なら真、`support_vacuous` を併記） | `support_not_selected` |
| (3) support依存が有効 | `S_sup` の各Entryについて§4.5の動的checkがすべて成立 | `support_expired_R` |
| (4) 集合内Conflict | `result.conflicts` に、`|c.buildListEntryIds ∩ M| ≥ 2` となる `c` が存在しない。`c.selectedBuildListEntryId` の値によらず数える | `conflict_within_set` |
| (5) Plan + Trace Replay | 評価statusが `evaluated`、`plan !== null`、`termination.status ∈ { 'completed', 'exhausted' }`（Plan生成とTrace Replayが例外なく完了したことは `evaluated` に含まれる） | `no_plan` / `plan_bound_truncated`（`incomplete`）/ `preflight_refused` / `planner_rerun_bound_reached` |

- `R5.satisfied = (1) ∧ (2) ∧ (3) ∧ (4) ∧ (5)`。(5)が偽の場合も、計算できる条件は計算して記録する（plan無しなら(1)〜(4)は `null`）
- R5は集合外Targetの完成、未解決Conflict 0、全体completedの増加を要求しない（それらはR6や診断fieldである）
- singletonの `replacement_set`（A(c)の各段など）でR5が成立しても、示すのはその1件の `G_t` と前提supportが同じrunで成立したことだけで、複数Target間の共存ではない
- `selected` は `plan.selectedBuildListEntryIds` への包含で判定する（Phase Bの `generatedSelected` / `supportSelected` と同じ定義）。route commitmentの
  `secured` / `dropped` は診断として併記する

### 4.5 support依存の有効性検査（t09の `build-list.fnv1a32-e396d352`）

`G_t09` はsupport Entry `build-list.fnv1a32-e396d352` の **元Entry・元Route** が実行される前提でSearchされた（reservation `fnv1a32:240e4673`）。
support Entryの変更・消失を無視してR5を成立させない。`G_t09` を含む評価ごとに次を検査する。

| check | 内容 | 種類 | 不成立時 |
| --- | --- | --- | --- |
| S1 | supportのTargetが置換集合 `T` に含まれない（そのEntryが `-O` で外されていない） | 動的 | R5(3)偽、`support_expired_R` |
| S2 | 最終run入力（runtime-unsupported retry後）の `buildListEntries` にsupport Entry IDが存在する | 動的 | R5(3)偽、`support_expired_R` |
| S3 | 最終run入力の初期context（`preparePlannerInitialContext(最終入力).context.entriesById`）にsupport Entryがvalid Entryとして存在する | 動的 | R5(3)偽、`support_expired_R` |
| S4 | 評価入力内のsupport Entry bodyが、ExportのEntry bodyと `stableStringify()` で一致する（同じEntry ID・同じRoute） | 静的 | 不変条件違反 → `D1_INVALID` |
| S5 | `hashStableValue(derivePlannerAlternativeReservation([support Entry], engine)) === 'fnv1a32:240e4673'`（Phase B taskの `reservationDigest`）、かつ `stableStringify()` がPhase B recordの `result.reservation` と一致 | 静的 | 不変条件違反 → `D1_INVALID` |

- S4 / S5はD1の構成（support Entryを変更しない、同じExport・同じEngine）で常に成立するはずの性質なので、不成立は通常の非共存ではなく
  harnessまたはenvironmentの異常として `D1_INVALID`（reason category `guardrail`）にする
- S1はD1の登録集合では起き得ない（support TargetはE1外）が、規則として定め、起きた場合は `support_expired_R` とする。置換後のRouteがsupportの前提
  （Counter進行・OwnedWeapon使用）を満たすとは扱わない（alternative-to-alternative supportはD1で定義しない、G18）
- support Entryを明示resolution、scenario resolution、repair lineage、fixed constraintへ変換しない（G1）
- K0の10件は `requiresSupport = []` で、S1〜S5は対象外（`support_vacuous`）

## 5. 段階ごとの規則

### 5.1 B0: baseline参照評価

- 入力: baseline PlannerInputそのもの（置換なし、43 Entry、`conflictResolutions = []`、`maxPlanSteps = 20000`）。preflightは行わず、
  §4.1と同じfull runnerを `{ kind: 'persisted' }` で1回起動する（評価budgetは§6.3）
- parity: Phase 2-C2 RESULT `baseline.summary` と次が一致すること。`planningTargetCount = 43`、`completedTargetCount = 20`、
  `termination = 'exhausted'`、`planSteps = 1465`、`selectedTargets`（selected EntryのTarget ID集合）、`conflicts = 21`、`conflictsByKind`、
  `conflictSignatures`（`<kind>:<participant Target IDを昇順にcomma連結>` の集合）
- 不一致、またはB0が型付き計算error（Trace Replay失敗を含む）で終わった場合は `baseline_parity_mismatch` → `D1_INVALID`
- B0の結果は差分計算の基準と `target_regressed_R` の判定（`O_t` がB0でselectedか）に使う。R5は判定しない

### 5.2 S: 単体parity（`evaluatedAgainst = baseline`）

各 `t` について `T = { t }` で§4.1を実行し、Phase Bのtrial（§1.3の表、found unit recordの `trials[found.trialOrdinal]`）と照合する。

Phase Bの記録と照合する項目（すべて完全一致を要求）:

| 項目 | Phase B recordのfield |
| --- | --- |
| preflight | `preflight === 'ready'`、`preflightRefusal === null` |
| resolution | `trialConflictResolutions === 0` |
| full run数 | `fullRunsStarted`（登録値は11件とも1） |
| Plan | `run.planPresent`、`run.termination`（`status` / `completedTargetCount` / `totalTargetCount` / `reachedLimits`）、`run.stepCount`、`run.selectedCount`、`run.conflictCount`、`run.warningKinds` |
| `G` | `run.generatedSelected`、`run.generatedCommitment`（`status` / `provisionalOutcomeSelectedBuildListEntryId` / `rejectionReasons`） |
| support | `run.supportSelected`、`run.supportNotSelected`、`run.generatedConflictsWithSupport` |
| verdict | `judgePlannerAlternativeTrial(run.result, { generatedBuildListEntryId: G_t.id, explicitDecisionBuildListEntryIds: support, fixedRouteBuildListEntryIds: support, routeCommitment })` が `found` で、`generatedSelected` が記録と一致（記録上の literalは `found_R`） |

今回新たに記録する項目（Phase B recordに無いもの）: §4.2の全項目（selected Entry ID全体、Conflict詳細とresource identity、route commitment全体、
baseline差分、`target_regressed_R`）と、follow-up §4.3のR1〜R4（`evaluatedAgainst = baseline`）。

| 項目 | Sでの判定 |
| --- | --- |
| R1 `candidate_admissible_R` | Rで `reusedExisting = false`、preflight `ready`、評価status `evaluated`、`plan !== null` |
| R2 `support_consistent_R` | R1 ∧ supportがすべてselected ∧ `G_t` とsupportの同時participant Conflictなし。K0は `support_vacuous` と記録 |
| R3 `generated_selected_R` | R1 ∧ `G_t` selected |
| R4 `joint_selected_R` | R2 ∧ R3 |

- 不一致、またはSが型付き計算errorで終わった場合は `phase_b_parity_mismatch` → `D1_INVALID`（Phase Bで同じ入力が成功しているため）
- **SはR5を判定しない**。SのR3 / R4はA(c)の受理やPARTIALの判定に流用しない（follow-up §4.3）

### 5.3 P: pairwise（`evaluatedAgainst = replacement_set`）

- 55組 `{i, j}`（`i < j`、Target index）を、`(i, j)` の辞書式昇順で評価する: `P-t00-t01`, `P-t00-t02`, …, `P-t09-t10`
- 各組は `T = { i, j }` で§4.1を実行し、§4.2の全項目と§4.4のR5（5条件それぞれの成否）を記録する
- **PでR5を満たした組（2件の `replacement_set`）はPARTIALの証拠に含める**（§7、follow-upからの変更 §11-1）。Pで共存を観測したのに
  「共存を観測しなかった」と報告する誤認を避けるためである

### 5.4 A: 集合評価（`evaluatedAgainst = replacement_set`）

| 評価 | 集合 | 件数 |
| --- | --- | ---: |
| `A-a` | 11件全部 `{t00, …, t10}` | 1 |
| `A-b` | Phase B trialで `G` がselectedだった4件。found unit recordの `run.generatedSelected === true` から機械導出し、登録値 `{t01, t07, t08, t09}` と一致しなければ `D1_INVALID` | 1 |
| `A-c-01` 〜 `A-c-11` | 決定的な単調合成（下記） | 11 |

A(c)の手順（Target ID昇順 = t00 → t10）:

```text
accepted = []
for k = 1..11, candidate = t(k-1):
    proposed = accepted + [candidate]            // Target ID昇順に並べる
    proposed を replacement_set として1 runで評価する（proposedがsingletonでも同じ）   // 評価ID A-c-<k 2桁>
    評価statusが evaluated かつ proposed全体がR5の5条件を満たす -> accepted = proposed
    それ以外（R5不成立、preflight_refused、bound、unmeasured、not_executed） -> candidateだけ不受理、acceptedは維持
```

- R5の再確認は追加した1件だけでなく、受理済みの全 `G` のselected、全Candidateの `requiresSupport` のselected、support依存、集合内Conflict、
  Plan + Trace Replayに及ぶ（§4.4をproposed全体へ適用する）
- singletonも明示的に評価する。Sの結果を受理判定に使わない
- A(c)の各段は `acceptedBefore`、`candidate`、`acceptedAfter`、`accepted`（true / false。評価がunmeasuredまたはnot_executedのときは `null` とし、
  acceptedは維持）を記録する
- unmeasuredの段の後も合成は続ける。その後の段には `afterUnmeasuredStep = true` を付け、全段がmeasuredだった場合と同じ集合を評価したとは主張しない
- A全体の評価は13件（`A-a` 1、`A-b` 1、`A-c` 11）である

## 6. 実行条件（execution envelope）と実行順序

### 6.1 envelope

| 項目 | 値 |
| --- | --- |
| R: unitごとのwall-clock上限 | 60分（Phase Bのunit上限と同じ。親が判定し、超過はtimeout = unmeasured） |
| 評価（B0 / S / P / A）ごとのwall-clock上限 | 30分（preflight、full run、runtime-unsupported retry、Trace Replayを含むchild process全体） |
| child heap上限 | 12,288 MB（`--max-old-space-size`） |
| concurrency | 1 |
| retry / fallback | なし / なし（timeout・OOM・failureでも条件を変えて再実行しない） |
| child process | R unit・評価ごとに新しいchild process（Phase Bと同じ）。Node yieldは `setImmediate`、memory sample間隔250 ms |
| `researchMaxPlanSteps` | 20000 |
| 評価ごとのfull Planner起動上限 | 8（§6.3） |
| provenance | `inheritsOracleInformedExecutionEnvelope = true`（Rの60分はPhase Bの、B2-C2B2K観測から選ばれた上限を引き継ぐ）。評価の30分はPhase B trialのfull run実績（1回約7〜25 s）から選んだ値で、oracle由来ではない |

wall-clock timeoutはunmeasuredであり、意味論的なnot-found・非共存として扱わない（G6 / G7）。

### 6.2 評価status

| status | 意味 | measured | R5 |
| --- | --- | --- | --- |
| `evaluated` | full runがPlannerResultを返し、Plan生成とTrace Replayが例外なく完了した（`plan === null` を含む） | yes | 5条件で判定 |
| `preflight_refused` | `preparePlannerReplacementConflictPreflight()` が `ready` 以外を返した | yes | 偽（(5)） |
| `planner_rerun_bound_reached` | 評価budget（§6.3）がfull runの開始を拒否した | yes | 偽（(5)） |
| `timeout` / `out_of_memory` / `process_failure` / `interrupted` | envelope到達・異常終了・中断。recordが無い、exit code非0を含む | **no** | 判定しない |
| `calculation_error` | childが型付きerror（`PlannerPlanGenerationError`、Trace Replay失敗、prediction / Planner / Search不変条件error等）を記録して終了した | P / A: **no**。B0 / S / R: parity不一致（`D1_INVALID`） | 判定しない |
| `not_executed` | 登録されたが実行されなかった（依存する `G_t` のRがunmeasured、またはINVALIDによる中止） | **no** | 判定しない |

- `plan_bound_truncated`（`termination.status === 'incomplete'`）と `planner_rerun_bound_reached` は **bound-limited** としてRESULTに一覧を残す。
  通常の非共存と区別するためで、decisionには§7の修飾fieldとして反映する
- Trace Replay失敗をP / Aでunmeasuredとする扱いはPhase B §1.3（Trace Replay失敗は例外で伝播し、process failure = unmeasured）と同じである。
  共存についてPlannerが判定を返したことにはならないので、R5偽（非共存の観測）として数えない

### 6.3 full Planner起動回数の計測

- 評価リクエストごとに新しいResearch評価budget（`createPlannerAlternativeFullRunBudget()` と同じ形、limit 8）を使う。値8はProductionの
  `maxPlannerReruns` と同じ数を上限値として借りるだけで、Production budgetの意味（request-global budget、9.2.19.12）を持たない（G5）
- 開始したfull runごとに `fullRunsStarted` を数える（runtime-unsupported retryを含む）。RESULTには評価リクエスト数（80）と、full Planner起動回数の合計を
  別fieldで記録する

### 6.4 実行順序と途中失敗

実行順序は固定であり、各段階内も決定的である。

```text
V   入力検証（親）
R   t00 → t10（Target index順）
B0
S   t00 → t10
P   (i, j) 辞書式昇順の55組
A   A-a → A-b → A-c-01 → … → A-c-11（A-cは前段の結果に依存）
```

| 状況 | 扱い |
| --- | --- |
| Vの失敗 | childを起動せず終了。`D1_INVALID` |
| Rの `redelivery_mismatch`、B0 / Sのparity不一致、G1違反、S4 / S5の不成立、replacement不変条件違反 | runnerは直ちに中止し、残りを `not_executed`（`aborted_after_invalid`）として記録。`D1_INVALID` |
| Rのunmeasured | そのTargetの `G_t` を使う評価（S / P / A）は `not_executed`（`dependency_unmeasured`）。他の評価は続ける。`A-a` も `not_executed`。A(c)の該当段は `accepted = null` で合成を続ける |
| B0のunmeasured | S / P / Aは続ける。baseline差分と `target_regressed_R` は `null`（理由を記録） |
| S / P / Aのunmeasured・`calculation_error`（P / A） | その評価だけunmeasured。後続は続ける（A(c)は§5.4） |
| 決定性cross-check不一致（§9.4） | analyzerが検出し `D1_INVALID`（runnerは中止しない） |

- 中止・unmeasured・not_executedのいずれも、評価件数（80）とR件数（11）の中に必ず計上し、黙って省かない
- 実行時間は見積もり（R: Phase Bのfound unit 11件のwall合計約487 s相当、評価: 80回 × 約10〜40 s、全体で約1〜2時間）であり、成功条件にしない。
  上限はR 11 × 60分 + 評価80 × 30分 = 約51時間である

## 7. Result分類（上から順に判定）

| decision | 条件 |
| --- | --- |
| `D1_INVALID` | §9のformal validityに1件でも違反（reason category: `input_evidence` / `provenance` / `redelivery_mismatch` / `baseline_parity_mismatch` / `phase_b_parity_mismatch` / `guardrail` / `determinism` / `raw_result_mismatch`） |
| `D1_INCOMPLETE` | invalid 0、かつ登録されたR 11件・評価80件のいずれかがunmeasuredまたは `not_executed` |
| `D1_FOUND_R_SET_COEXISTS` | invalid 0、unmeasured 0、`A-a` がR5を満たす |
| `D1_FOUND_R_SET_PARTIAL` | invalid 0、unmeasured 0、`A-a` はR5を満たさず、P / `A-b` / `A-c` のうち **置換集合の大きさが2以上** の評価が1件以上R5を満たす |
| `D1_FOUND_R_SET_COEXISTENCE_NOT_OBSERVED` | invalid 0、unmeasured 0、上のいずれでもない（登録した評価集合で、2件以上の置換集合のR5成立を1件も観測しなかった） |

- 通常の非共存（`evaluated` でR5不成立、`preflight_refused`、bound-limited）は **measured** であり、`D1_INVALID` にも `D1_INCOMPLETE` にもしない
- `D1_INVALID` と `D1_INCOMPLETE` の境界: INVALIDは「D1の前提（入力evidence、Phase Bの忠実な復元、guardrail、決定性）が崩れ、どの評価結果も解釈できない」場合、
  INCOMPLETEは「前提は保たれたが、登録した評価の一部が環境要因（時間・memory・process）または依存の未測定で結果を持たない」場合である
- `D1_INCOMPLETE` でも、measuredだった評価のR5成否・観測したR5成立集合（大きさ2以上）・`A-a` の結果を **下限のevidence** として記録する。
  INCOMPLETEの中で `A-a` がR5を満たしていた場合は `coexistsObservedUnderIncomplete = true` を併記する
- decisionには修飾field `boundLimitedEvaluations`（bound-limitedだった評価IDの一覧）を必ず付ける。`D1_FOUND_R_SET_COEXISTENCE_NOT_OBSERVED` で
  これが空でない場合、非観測の一部はPlannerのboundによるものであり、boundを外した結果を主張しない

### 7.1 言えること・言えないこと

- `D1_FOUND_R_SET_COEXISTS`: Phase Bで止めた11 Candidateが、t09の前提support（`build-list.fnv1a32-e396d352`）を含めて、他32 Targetを元Routeのまま置いた状態で
  集合としてR5を満たした。43 / 43、Conflict 0、Issue #154のacceptance（R6）は言えない
- `D1_FOUND_R_SET_PARTIAL`: 評価したP / `A-b` / `A-c` の集合のうちR5を満たしたものがあることと、その集合・件数・最大の大きさまで。
  評価していない部分集合や、`A-a` で `G` だけがselectedになった件数を共存部分集合として数えない
- `D1_FOUND_R_SET_COEXISTENCE_NOT_OBSERVED`: **共存不能の証明ではない**。言えるのは「登録した68件の集合評価（P 55、`A-a` 1、`A-b` 1、`A-c` 11）のうち、
  2件以上の置換集合についてR5成立を観測しなかった」ことだけである（68件には `A-c` のsingleton段も含まれるが、singletonでのR5成立は共存の観測に数えない）。未評価の組合せ（3件以上の部分集合の大半）、他のCandidate、他のsupport context、
  別のextent・別のExportで共存できないことは言えない。Target単体の `found_R` で止める方式がGlobal共存の候補選択として不十分であることの
  evidenceにはなるが、oracle-free policyが存在しないことは言えない
- いずれの場合も、R5成立はsupportが外れた・失効した集合では主張しない（G18）。Pの勝者 / participantはD2の入力設計に使えるが、D1の中で新しいSearchは行わない

## 8. RESULT schema（D1-Bで固定する必須field）

D1-Bのanalyzerは `docs/PLANNER_GLOBAL_D1_RESULT.json`（committed）を出力する。raw（`.local`、commitしない）とrun dir（record、G store、
start attestation）はRepositoryへ追加しない。次のfieldは必須で、意味を変えない（追加fieldは可）。

```text
phase                      "Issue #154 D1: Phase B found_R set coexistence diagnostic (post-hoc analysis)"
analyzedAt
sources
  specDocument             { file, sha256 }                         本書（measurement HEADのgit object）
  phaseB                   { result, raw, attestation, tasksRecord, targetsManifest } 各 { file, bytes, sha256 }
  phase2c2Result           { file, sha256 }
  export                   { file, bytes, sha256, committed: false }
  foundUnitRecords[11]     { unitId, file, bytes, sha256 }
  foundUnitTasks[11]       { unitId, file, bytes, sha256 }
  d1                       { raw, runDir, attestation, records[], generatedEntries[11] } 各 { file, bytes, sha256 }
provenance
  formal, measuredHead, analysisHead, measuredHeadIsAncestor, runStatus, benchmarkCodeSha256,
  calculationCodeChangedSinceMeasuredHead: [], productionChangedFiles { toMeasuredHead: [], toAnalysisHead: [] },
  startAttestation { sha256, verified, issues, body },
  phaseBMeasuredHead: "b24bf5dc7d98cb8341a24d27fabbd1a36843a004",
  oracleReadByRunner: false, oracleReadByChild: false, oracleReadByAnalyzer: false,
  phaseBResultFieldsRead: [allowlist], phaseBResultModified: false,
  speculativeSupportWrittenAsResolution: false, oracleGuidedTargetPopulation: true,
  inheritsOracleInformedExecutionEnvelope: true, productionSemanticsChanged: false
environment                runtime, node, v8, platform, cpu, logicalCpuCount, totalMemoryBytes, rngEngineVersion, calculationContext, appliedExecutionEnvelope, machine
conditions                 stages（§2）、order（§6.4）、executionEnvelope（§6.1）、researchMaxPlanSteps、evaluationFullRunCap: 8、
                           r5Definition（§4.4）、supportChecks（§4.5）、decisionRule（§7、文字列配列）、notRun
inputValidation            { passed, issues[] }
redelivery[11]             { unitId, targetWeaponId, status: redelivered | redelivery_mismatch | <unmeasured reason>,
                             process, matches { deliveryPrefix, candidateStableKey, generatedBuildListEntryId, reusedExistingFalse,
                             routeOperations, candidateResult, searchIdentity, searchSummary, replacement, reservation, excludedRouteKeys, originDigest },
                             mismatches[], generatedEntry { file, sha256 }, searchOnlyMs, wallMs, peakHeapBytes, peakRssBytes }
evaluations[80]            { evaluationId, stage: B0 | S | P | A-a | A-b | A-c, ordinal, evaluatedAgainst: baseline_reference | baseline | replacement_set,
                             replacementTargets[], generatedEntryIds[], requiresSupport, status（§6.2）, unmeasuredReason, notExecutedReason,
                             process, inputDigest, resultDigest, fullRunsStarted, runtimeUnsupportedRemoved[],
                             preflight { status, refusal }, plan { present, termination, steps, selectedBuildListEntryIds[], warningKinds[] },
                             conflicts[] { id, kind, participants[], selectedBuildListEntryId, recommendedBuildListEntryId, resourceIdentity, resourceIdentityMatched, membersOfM },
                             routeCommitment[] { buildListEntryId, role: generated | support, status, provisionalOutcomeSelectedBuildListEntryId, rejectionReasons[] },
                             candidates[] { targetWeaponId, generatedBuildListEntryId, selected, commitmentStatus, targetRegressedR,
                                            requiresSupport[], supportSelected[], supportChecks { S1..S5 }, supportValidity: valid | vacuous | expired },
                             r5 { judged, conditions { allGeneratedSelected, allSupportSelected, supportDependenciesValid, noConflictWithinSet, planAndTraceReplayOk },
                                  satisfied, failureReasons[] },
                             r1r4（Sのみ）{ R1, R2, R3, R4, supportVacuous },
                             parity（B0 / Sのみ）{ compared[], matched, mismatches[] },
                             baselineDiff { completedDelta, conflictDelta, stepsDelta, selectedAdded[], selectedRemoved[], conflictsAdded[], conflictsRemoved[] } | null,
                             composition（A-cのみ）{ acceptedBefore[], candidate, acceptedAfter[], accepted: true | false | null, afterUnmeasuredStep },
                             wallMs, peakHeapBytes, peakRssBytes }
aggregates
  redelivery               { registered: 11, redelivered, mismatched, unmeasuredByReason }
  evaluations              { registered: 80, measured, unmeasuredByReason, notExecutedByReason, byStatus }
  fullPlannerRunsStarted   合計（評価リクエスト数とは別）
  runtimeUnsupportedRetries
  r5                       { judged, satisfied, satisfiedByStage, satisfiedSetsOfSizeAtLeast2[] (evaluationId, targets), maxObservedSatisfiedSetSize }
  aAGeneratedSelectedCount 診断（R5を満たした部分集合の件数とは別field。PARTIALの判定に使わない）
  aCFinalAccepted[]
  boundLimitedEvaluations[]
  targetRegressedR          評価ごと・Targetごとの件数
  determinismCrossChecks[] { inputDigest, evaluationIds[], resultDigestsEqual }
  timing, memory
invalidReasons[]           { category, detail }
decision                   { case, reasons[], lowerBound: boolean, boundLimitedEvaluations[], coexistsObservedUnderIncomplete }
```

## 9. formal validity（D1-Bで検証する条件。いずれか違反なら `D1_INVALID`）

### 9.1 入力・authority chain（V、analyzerも独立に再検証）

- §1.2のすべての入力が存在し、SHA-256（とbytesを記載したものはbytes）が一致する
- Phase B RESULT: `provenance.formal === true`、`measuredHead === b24bf5dc…`、`runStatus === 'completed'`、`calculationCodeChangedSinceMeasuredHead` が空、
  `decision.case === 'B2C27B_INCOMPLETE'`、`units[]` のうち `result === 'found_R'` がちょうど11件で、そのunit IDが§1.3と一致
- found unit 11件それぞれについて:
  - record fileのSHA-256・bytesが `sources.unitRecords` の値と一致し、Phase B rawの `units[]` 該当entryの `recordFile` とも一致する
  - `record.task`、`record.result.task`、task fileの内容が `stableStringify()` で一致し、Phase B rawの `units[]` 該当entry（`unitId` / `targetWeaponId` /
    `targetIndex` / `contextRank` / `rung` / `ladderStateAtStart`）と、Phase B rawの `plans[targetIndex].contexts` の該当context（`groupIndex` /
    `reservationDigest` / `cardinality` / `representativeFixedSetId` / `supportBuildListEntryIds`）と一致する
  - `record.result.outcome === 'found_R'`、`found.deliveryIndex` / `found.trialOrdinal` が `deliveries` / `trials` の該当要素を指し、その要素の
    `stableKey` / `candidateStableKey` / `generatedBuildListEntryId` が `found` と一致し、trial verdictが `found_R`
  - Phase B RESULT `units[]` 該当entryの `deliveries[d].keySha256 === sha256(found.candidateStableKey)`、trial summaryがrecordのtrial summaryと一致する
  - recordの `calculationContext`・`rngEngineVersion`・`researchMaxPlanSteps` が§1.1の値と一致し、`ladderStateAtStart` が初期値である
- Phase B rawの `status === 'completed'`、Phase B start attestationのbody（`policyAuthority.sha256`、`exportSha256`、`targetManifestSha256`、
  `researchMaxPlanSteps`）が§1.2の値と一致する
- Phase 2-C2 RESULTの `baseline.summary` が存在し、§5.1で比較する全fieldを持つ

### 9.2 measurement HEAD・provenance

- D1-Bのrunner / child / analyzer / test / 本書を含むmeasurement HEADをformal run前にcommitし、runnerはchild起動前にstart attestation（`wx`、read-only）を書く。
  attestationには本書のSHA-256、§1.2のdigest、登録条件（§2、§4.4、§4.5、§6、§7）、benchmark code SHA-256（measurement HEADのgit objectから再計算）、
  uncommitted false、Production audit（D1-B開始時のbase main以降のProduction changed files `[]`）を記録する
- analyzerはattestationをmeasurement HEADのgit objectと照合し、measurement HEADがanalysis HEADのancestorであること、measurement HEAD以降の計算コード変更が
  `[]` であること、Production source changed files（`src/domain` / `services` / `workers` / `pages` / `components` / `db`）が `[]` であることを確認する
- **計算コード変更後の結果流用禁止**: measurement HEAD以降に計算コード（Production source、D1 / Phase B / Phase 2-C2のResearch計算module、それらが推移的にimportする
  module）が変わった場合、そのrunの結果を正式結果として使わない。再計測は新しいmeasurement HEADで最初からやり直し、部分的なrecordの再利用・merge・継ぎ足しをしない
- D1 childのCalculationContextが `{ 'unknown-initial', 4, 'production-rng:c5-e7', 17 }`、`PRODUCTION_RNG_ENGINE_VERSION === 'production-rng:c5-e7'`。
  D1-B開始時点でこれらが動いていた場合は、D1を実行せず本書の再登録を先に行う
- smoke（非formal確認）はformal run dirと別に行い、formal evidenceにしない。smokeの結果で条件を変えない

### 9.3 guardrail

- G1: すべての評価runで `conflictResolutions` 0件、preflightのfixed constraint 0件。resolution / scenario resolution / repair lineage /
  `selectedBuildListEntryId` を作らない（testでも確認）
- oracle isolation: runner / child / analyzerは、oracle module（`plannerGlobalOracle1657*`）・Phase B analysis module・population-authority moduleを
  推移的にimportしない（testでimport closureを検査）。Phase B RESULTはallowlist（§1.2）のfieldだけを読む
- D1-B sourceにTarget ID / Entry ID / stable keyを書かない（testで検査）。§1.2 / §1.3のfile名・SHA-256は登録値として置いてよい
- support Entry（S4 / S5）が変更されていない。replacement不変条件（§4.1）が成立する
- 登録された順序（§6.4）と集合（§5）以外の評価が無い（retry、再実行、追加評価、順序違反、件数違反なし）。child process数 = R 11 + 実行した評価数 で、
  `not_executed` を除き登録評価と1対1に対応する
- A(c)のreplay: analyzerは記録済みの評価結果からA(c)の合成を再実行し、各段の `proposed` / `accepted` / `acceptedAfter` が記録と一致することを確認する

### 9.4 決定性

- `inputDigest = hashStableValue({ T（Target ID昇順）, G_TのEntry ID, G_TのG store SHA-256, baselineのExport SHA-256, researchMaxPlanSteps, conflictResolutions: [] })`
  （B0は `T = []`）
- `resultDigest = hashStableValue(` 次の射影 `)`: `planPresent`、`termination`、`selectedBuildListEntryIds`（ID昇順）、`warningKinds`（昇順）、
  `conflicts`（`id` / `kind` / participant昇順 / `selectedBuildListEntryId` / `recommendedBuildListEntryId` を `id` 昇順）、`steps.length`、
  各PlanStepの `order` / `operationType` / `targetWeaponId` / `buildListEntryId` / `progressedTargetWeaponIds` / `rngAdvance`
  （`id` / `title` / `instruction` / `candidateId` / Clock由来fieldは含めない）、`fullRunsStarted`、runtime-unsupportedで除外されたEntry ID
- `inputDigest` が同じ評価（S `t` と `A-c` のsingleton段、P `{i, j}` と同じ集合になった `A-c` の段、`A-b` と同じ集合になった `A-c` の段、`A-a` と
  同じ集合になった `A-c` の段など）は、`evaluatedAgainst` が異なっても `resultDigest` が一致しなければならない。不一致は `determinism` →
  `D1_INVALID`。これは決定性の検査であり、Sの結果をR5として流用することではない（R5は各 `replacement_set` 評価で独立に判定する）

### 9.5 raw / RESULT整合

- RESULTの各評価・R unitが、raw・recordのSHA-256付きファイルから再計算した値と一致する（R5条件、status、parity、baseline差分、A(c)の合成、decision）
- unmeasured / not_executedを含め、R 11件・評価80件がRESULTに欠けなく現れる

## 10. guardrail（follow-up G13〜G18に追加）

| ID | guardrail |
| --- | --- |
| G19 | D1のG store（Rが書いた `G_t` のBuildListEntry body）はD1のResearch evidenceであり、Build List、Persistence、Production入力、他PhaseのCandidate poolへ書かない |
| G20 | S（`evaluatedAgainst = baseline`）の結果をR5・A(c)の受理・decisionに流用しない。同一入力の結果一致は決定性の検査（§9.4）にだけ使う |
| G21 | Phase B RESULTのoracle由来fieldを、実行入力・診断入力・decisionのいずれにも使わない（§1.2 allowlist） |
| G22 | bound-limited・unmeasured・`calculation_error` を非共存の観測として数えない |

## 11. follow-up §9.1案からの変更点

| # | follow-up §9.1の案 | 本書で正式に採用する条件 | 理由 |
| --- | --- | --- | --- |
| 1 | Pは診断。PARTIALは(b) / (c)だけで判定 | Pも `evaluatedAgainst = replacement_set` とし、R5の5条件をすべて判定する。PでR5を満たした組をPARTIALの証拠に含める | Pで2件の共存を観測したのに「共存を観測しなかった」と報告する誤認を避ける。Pと(c)は同じR5規則で判定するので、扱いを分ける理由が無い |
| 2 | 最後のdecision名 `D1_FOUND_R_SET_NOT_COEXISTENT` | `D1_FOUND_R_SET_COEXISTENCE_NOT_OBSERVED` | 登録した評価集合で観測しなかったことしか示せず、未評価の組合せについて共存不能を証明したと読まれないため |
| 3 | full run 79回（S 11 + P 55 + A 13） | baseline参照評価B0を1件追加し、評価リクエストは80件（登録評価79 + B0 1） | baseline差分と `target_regressed_R` を、D1と同じmeasurement HEAD・同じharnessで得たbaselineに対して計算するため。B0はPhase 2-C2 baseline summaryとのparityも確認する。R5の判定には使わない |
| 4 | 再deliveryとS以降の関係は未記載 | RのmaterializerがG storeへ書いた `G_t` のbodyだけをS / P / Aで使う（SHA-256照合） | 評価ごとに高価なSearchを繰り返さず、かつRouteからEntryを再構築しない（follow-up §6.4のCandidate snapshot保持seam） |
| 5 | R5(3)の有効性は「同じEntry ID・同じRoute・reservation再導出一致」 | §4.5のS1〜S5に分け、動的check（S1〜S3）の不成立は `support_expired_R`（R5偽、measured）、静的check（S4 / S5）の不成立は `D1_INVALID` | D1の構成で必ず成立する性質の破れを、通常の非共存と混同しないため |
| 6 | R5(5)「Planが存在しTrace Replay成功」 | `evaluated` かつ `plan !== null` かつ `termination.status ∈ { completed, exhausted }`。Trace Replay失敗は `calculation_error`（P / Aはunmeasured、B0 / S / Rはparity不一致） | Phase B §1.3と同じ扱い。`incomplete` のpartial Planは集合全体を評価していない |
| 7 | 記載なし | 決定性cross-check（§9.4）を追加 | 同一入力の評価が異なる結果を返す場合、どの評価結果も解釈できない |
| 8 | 記載なし | 評価ごとのfull Planner起動上限8（Research値）と `planner_rerun_bound_reached` / bound-limitedの扱い | runtime-unsupported retryの上限を事前に決め、bound由来の非観測を通常の非共存と区別する |
| 9 | INVALID / INCOMPLETEの境界の詳細なし | §6.2・§6.4・§7で、段階ごとの計算error・timeout・依存未測定の扱いを確定 | 通常の非共存をINVALIDへ、環境要因をNOT_OBSERVEDへ分類しないため |
| 10 | Phase B RESULTを入力にする | 読み取りをallowlist（§1.2）に限定 | Phase B RESULTはpost-hocのoracle由来fieldを含むため（D1はoracleを診断入力にも使わない） |
| 11 | A(c)の途中unmeasuredの扱いなし | unmeasured / not_executedの段は `accepted = null`、acceptedは維持して合成を続け、後続段に `afterUnmeasuredStep` を付ける | 下限evidenceを残しつつ、全段measuredの場合と同じ集合を評価したとは主張しない |

follow-up §9.1のそれ以外（入力、R、S、A(a) / (b) / (c)の構成、envelope、言えること・言えないこと、G13〜G18）はそのまま採用する。

## 12. 未決定事項（D1の外、またはD1-B以降）

D1の判定に必要な意味論は本書で確定した。次はD1の外の事項である。

1. D1-Bの実装名（module / script / field綴り）。§8の必須fieldの意味と§7の判定順序は変えない
2. D1の結果を受けたD2（follow-up §9.2）のpolicy・population・budget。D1の結果を見てから別途事前登録する
3. Pの勝者 / participant（阻害Entry）をsupport候補の導出（follow-up §5.3 / C2）に使う規則とその上限
4. alternative-to-alternative supportの依存・失効・循環規則（D1では定義しない）
5. execution envelopeの変更（concurrency、上限時間）。変える場合は別axisとして事前登録する
6. Production化に伴うREQUIREMENTS 23の契約変更の要否（follow-up §10）

Issue #154はCloseしない。

## 13. validation

- `git diff --check`
- `npm run check:nul`、`npm run lint`、`npm test`、`npm run build`（docs-onlyのため挙動変化は無い。結果はPRに記載）
