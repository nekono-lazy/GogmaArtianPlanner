# Global Planner Global Assignment Phase D-0B-2（実Export再smokeとD-0C正式計測条件の事前登録）

Refs #154。Research-only・**非formal**。基準main: PR #250 merged `0c6758ad9e8fe28f61bc367c613dcc7d3b498c93`
（作業開始時に `main` / `origin/main` / HEADの一致、Working Tree clean、stash / 追加worktreeなしを確認）。
branch: `research/global-assignment-phase-d0b2`。**計測HEAD**: `b4ed7998dfa4adb61fc757ca9605364c331050a1`（登録とrunner観測を含むcommit。§3）。

本書は [Global Assignment設計](PLANNER_GLOBAL_ASSIGNMENT_DESIGN.md)（以下「設計」）§14 / §19.7 の **D-0B-2**（確定したoption集合 `a2` と
materialization規則 `d0a2-v2` での実Export非formal再smoke、D-0Cの正式計測条件の事前登録）を記録する。formal run（D-0C）、Production Planner・
Trace Replay・fresh Plannerによる検証（D-1）は行っていない。

## 0. 位置づけとauthority

正式仕様の順位は `AGENTS.md` のとおり `docs/REQUIREMENTS.md` → タスク固有の詳細仕様 → その他の正式仕様 → 最新mainの実装 → test → 過去の記録である。
本書はResearch記録であり、正式仕様でもDomain仕様でもない。設計 §9 / §10.3 / §10.4 / §11 / §12 / §19.7 / §19.8、
[D-0A-2設計](PLANNER_GLOBAL_ASSIGNMENT_D0A2_DESIGN.md)（以下「D0A2」）§5 / §9〜§12 / §19.8 / §20、[D-0B記録](PLANNER_GLOBAL_ASSIGNMENT_RESEARCH_D0B.md)
§3〜§6 / §10、[D-0B準備監査](PLANNER_GLOBAL_ASSIGNMENT_IDEAL_CONTINUATION_AUDIT.md)（以下「監査」）§9 に従う。

### この結果が意味すること・しないこと

| 本書の語 | 意味 | 意味しないこと |
| --- | --- | --- |
| `materialized` | 期待Route形に一致するEntryを1つ作り、独立Route検証（D0A2 §9.3の1〜6）を通した | Production Plannerで実行可能（`verified`）であること |
| `all_materialized` | 最初のstructural candidateの全planning TargetにそのEntryがある | Planが成立すること、全Targetが完成すること（D-1で判定） |
| structural objective 1,766 | Σ（stream終端 − origin）。必要条件の割当の値 | 物理操作数・実行可能Planの操作数・証明済みの最短 |
| 1,657 oracle | 本書のrunでは入力にも比較にも使っていない | 本書の探索結果 |

## 1. 目的・範囲

| やること | やらないこと |
| --- | --- |
| 主方式（option集合 `a2`、規則 `d0a2-v2`、G1 / G2の継続形、`shape_constrained`、Reset / Keep / Reset→Keepの形状policy、全形状制約materializationの独立Route検証、Phase Cの順序、Production Engine）で実Exportを非formal再smoke | formal run（D-0C）、`--mode formal` の拒否の解除 |
| 旧D-0B（a1 + `d0a-v1`）との比較（option集合・方式・gate / budget・順序とreservation・費用を分ける） | D-1のPlanner検証、Production Search / Planner / RNG / UI / Worker / Persistence / schemaの変更 |
| D-0Cの正式計測条件の事前登録（`MATERIALIZATION_D0A2B_REGISTRATION_ITEMS` の全項目と追加項目、値・単位・根拠・根拠run・oracleInformed・観測範囲・未確認範囲） | Phase Aのoption集合、Phase B、Phase Cの順序、Research Search seamの意味論の変更 |
| 再smokeに必要な観測の追加（Target別memory、形状制約SearchとRoute検証の時間の分離） | 旧D-0BのRESULT・記録の書き換え |

## 2. 入力

登録Export（D-0Cが照合する値。B-2Bの登録Export、D-0Bと同一。Repositoryには含めない）:

```text
registered-export-file: gogma-artian-planner-backup_20260927015837.json
registered-export-bytes: 19424064
registered-export-sha256: cc35fb5bd85acb417b2ce0229cd79441b48c642ac8af70bbc2dfdfc8c89e1e6b
```

- 各runは親processがExportを読む前に `--expected-export-sha256` で上記hashと照合し（`cliMatched: true`）、子processもbytes / SHA-256を再確認した。
  計測HEADのrunは、さらに本書の上のblockと名前・bytes・hashが一致することを記録した（`formalRegistration.d0cRegistration.registeredExport.matches: true`）
- Production RNG Engine `production-rng:c5-e7`。CalculationContext: gameVersion `unknown-initial`、masterDataVersion 4、rngEngineVersion `production-rng:c5-e7`、
  appSchemaVersion 17（全runの子processが記録した値）
- planning Target数（Phase 0で確定）: **43**。origin Skill 341 / Gogma 55、確定Normal Counter 7本（D-0Bと同じ）

**Oracle isolation**: 1,657 stepのoracle、oracle manifest、過去RESULTのTarget別Route・成功source・Counter位置・成功順序、過去チャットで検算したRouteは
どのrunの入力にも使っていない（`oracleFreeExecution: true`）。本設計自体はoracleの構造にinformedである（`oracleInformedDesign: true`、設計 §11.2）。
旧D-0Bのrecord（`.local` に残る非formal smokeの生成物）は、本書のrunが終わった後の比較（§8）にだけ読んだ。登録値はどれもoracleや過去RESULTの
Target別位置から導いていない（各項目 `oracleInformed: false`）。

## 3. 実装した変更（計測HEAD `b4ed799`）

| file | 変更 |
| --- | --- |
| `src/benchmarks/globalAssignment/materializationProtocol.ts` | D-0Cの正式計測条件 `MATERIALIZATION_D0C_PREREGISTRATION`（§12）。各項目に値・単位・根拠・根拠run・`oracleInformed`・観測範囲・未確認範囲を持つ。網羅性と妥当性の検査 `materializationD0cRegistrationIssues()`、条件の取出し `registeredD0cConditions()`、runの条件との差分 `differencesFromD0cRegistration()`、本書のExport identity blockの読取り `readD0cRegisteredExportIdentity()`（B-2Bと同じparser）。`formalRun.enabled` は false。formal runの拒否文を登録後の状態に合わせた（拒否そのものは不変） |
| `scripts/run-planner-global-assignment-d0b.mjs` | `d0a2-v2` runのprovenanceに、登録条件との差分・一致と、本書のidentity blockとのExport照合を記録（`formalRegistration.d0cRegistration`）。子processはTarget別の開始・確定時のmemoryとその間の標本最大値を記録（`memory.targets`、observedだけ） |
| `src/benchmarks/globalAssignment/materializationRunner.ts` | `d0a2-v2` runのobservedに、Target開始から射影起点Candidate Searchのcanonical Ideal検査、形状制約の最初の配送の検査（Entry化と照合の後、独立Route検証の前）までの時間（`shapeTimeline`）を追加。semantic recordは変えない |
| test 3 file | 登録の網羅性・W0上界との一致・CalculationContext・formal拒否・差分・Export identity（`materializationProtocol.test.ts`）、時系列がobservedだけに入り `d0a-v1` に無いこと（`shapeMaterializationRunner.test.ts`）、runnerの記録と登録値そのままのrun（`scripts/run-planner-global-assignment-d0b.test.ts`） |

`d0a-v1` のrunの条件・既定値・記録・protocol version（`global-assignment-d0b:1`）は変えていない。§4のcmp-v1は、計測HEADで `d0a-v1` を再実行し、
旧D-0B final run（`b7b7b00`）とsemantic SHA-256が一致することを確かめた。

## 4. 非formal run

machine: AMD Ryzen 7 9700X（16 logical）、33.4 GB RAM、Windows 10.0.26200、Node v24.19.0。すべて非formal、1 runにつき子process 1本、concurrency 1、
自動retryなし、出力はgit-ignoredな `.local/` に排他作成した。

| run id | HEAD | 条件 | 結果 | child wall | RESULT SHA-256 | semantic SHA-256 |
| --- | --- | --- | --- | ---: | --- | --- |
| `d0b2-s1`（経路確認） | `0c6758a` | `d0a2-v2`、`a2`、window 20 / 20 / 20 | `no_structural_candidate`（窓が狭くoptionの無いTargetがある。D-0Bのs1と同じ） | 2.7 s | `67c4d8cc4899df7c4a1cea5ce9682acbfd4f896e336d8d18983fc29812cba0ac` | — |
| `d0b2-r1`（探索的） | `0c6758a` | `d0a2-v2`、`a2`、W0、探索用gate / budget / envelope（§10.1） | `all_materialized` 43 / 43 | 34.1 s | `825fa70ba762af1cb5e457ea9d1bf31561182ff4dfe8b94f462ce3ab43b48e25` | `35752397eb8e…` |
| **`d0b2-reg`**（登録値そのまま） | `b4ed799` | §12の登録値（`differencesFromRegistration: []`）、`--repeat 2` | `all_materialized` 43 / 43、2 run一致 | 34.0 s / 33.7 s | `b65540df99d3311fe931a77d85d2f4f728dbd1f94e347717c923164f956e0083` | `6f790d33839ce9dcae2bd030b2e0b92c0dd1c5e7c4850de9cbd54dc4ab4cb18f`（2 run） |
| `d0b2-cmp-a1`（比較） | `b4ed799` | 登録値のうちoption集合だけ `a1` | `all_materialized` 43 / 43 | 60.0 s | `6a2bc0d81241f6cf3d387948893057cb7891f757bb3cf9810b1921712cf589a0` | `ed79d93da9c8…` |
| `d0b2-cmp-v1`（比較・旧方式の再実行） | `b4ed799` | `d0a-v1`、`a1`、D-0Bのsmoke既定値（delivery cap 500） | `unconfirmed_delivery_cap` 7 / 43 | 195.1 s | `e2947b884ff0f11951609e1e914995d356a5d8a4cb83d8eead0bfd05fedf49fc` | `53b1b77c30f6…`（旧D-0B finalと同一） |

- `d0b2-r1` と `d0b2-reg` のsemantic recordの差は条件（shape gate / budgetの値）だけで、Search・照合・分類・計数はすべて同一だった。探索用の値も登録値も
  どの成分でも拘束しなかったためである
- 主条件の決定性: `d0b2-reg` の2 runはsemantic recordが同一（`determinism.identical: true`）。semanticには時間・memoryを含まない
- すべてのrunでintegrity issue 0件、fail closed 0件、timeout / OOM / process failure / cancel 0件（unmeasuredなし）

## 5. 最初のstructural candidate（Phase 0 / A / C、`d0b2-reg`）

| 項目 | 値 |
| --- | --- |
| planning Target数 | 43 |
| option集合 | `global-assignment-reach-options:a2` |
| ReachTable予測回数 | Skill 30,020 / Gogma Reset 10,000 / Gogma Keep 299,500 / Normal 7,000（unsupported 0。a1と同一: option集合は走査を変えない） |
| ReachTable時間 | 11.5〜11.6 s |
| structural search | 展開44 node、被覆棄却0件、coverage-driven orderingは発動せず、最初の候補で停止（`candidate_limit_reached`。未探索部分あり、候補不存在とは言わない） |
| completeness | `structural_candidates_found` / `candidate_limit_reached` |
| 最初のstructural candidateのobjective | **1,766**（stream終端 Skill 1,424 / Gogma 503） |
| materialization順序 | Phase C（`deriveMaterializationOrder()`、設計 §8.2）。Skill依存5件: 巨戟化位置 363 / 378 / 399 / 410 / 478 の順序4 / 5 / 8 / 9 / 11が、それぞれ順序0〜3、0〜4、0〜7、0〜8、0〜10を先行させる |
| source種類 | 所持巨戟38 / 所持通常0 / 新規Normal 5 |
| Skill要件 | none 21 / `reset_skills` 17 / `conversion` 5（すべて c = s*） |
| Bonus要件 | none 0 / `reset` 1 / `keep_from_source` 19 / `reset_then_keep` 23 |
| G1 / G2継続option（候補が選んだもの） | 0 / 0（`countContinuationOptions()`: S1型0、所持巨戟継続0） |
| G3静的risk | 上側: 適用option 42のうち3件（順序7: q = 216、順序24: q = 79 / 203、順序29: q = 101）。下側: 適用option 23のうち0件 |
| G4 | Planner開始時にIdeal武器を持つplanning Target 0件（zero-operation / G4-i / G4-ii / G4-iii いずれも0） |

a1（`d0b2-cmp-a1`、旧D-0B）との比較は§8。

## 6. Materialization（`d0b2-reg` run 1）

### 6.1 要約

- **43 / 43 Targetが `materialized`**（`all_materialized`。Planner未検証）。射影起点Candidate Search 21件（連続形。すべて射影起点で一致し、形状制約へのfallbackは0件）、
  形状制約 `shape_constrained` 22件（非連続形。すべて最初の配送を受理）。継続形0件
- 形状制約22件はすべて独立Route検証を通過（issue 0、検証した操作の合計787）。前提違反0、`forbiddenOperationNotices` 0、`requiredUnsupportedPredictions` 0、
  停止はすべて受理による `consumer` stop（budget超過成分なし）
- gate未実行0件（射影起点gate・shape gateとも）、budget到達0件、unsupported 0件、fail closed 0件
- materialization全体 1.96〜2.01 s（Target合計1.99 s）

### 6.2 Target別

表記: S(s*) = `reset_skills`、C(c, s*) = `conversion`、K(g*) = `keep_from_source`、R(g*) = `reset`、RK(g1, g*) = `reset_then_keep`。
required = PlannerのrequiredなSkill / Gogma / Normal位置の個数。予測は形状制約Searchの事前規模（D0A2 §10.3、上界）、実測はSearch自身の使用量
（Gogma生成state / Skill state / settled work / 予測 Normal・Skill・Reset・Keep）。射影起点の予測は設計 §9.7の規模（巨戟化位置 / Gogma幅 / Skill幅 / forge）。
時間はTarget開始から確定まで、Searchと検証は §3の時系列による近似（検証 = 確定 − 形状制約の検査時刻。Searchの後始末を含む）。memoryはTarget確定時のheapUsed。

| 順序 | source | Skill / Bonus | 方式 | required S/G/N | 予測（depth / Gogma生成上界 / forge / 歩行） | 実測（Gogma生成 / Skill / work / 予測 N・S・R・K） | 上界 / 実測 | 独立検証（操作 / 再予測 N・S・R・K） | 時間 ms（Search / 検証） | heap MB |
| ---: | --- | --- | --- | --- | --- | --- | ---: | --- | --- | ---: |
| 0 | 所持巨戟 | S(341) / K(210) | 射影起点 | 1 / 1 / 0 | 射影 0 / 2 / 1 / 0 | canonical Ideal 1件 | — | — | 8.9 | 865 |
| 1 | 所持巨戟 | S(343) / RK(82,205) | 形状制約 | 1 / 2 / 0 | 153 / 46,206 / 0 / 0 | 151 / 2 / 154 / 0・2・28・123 | 306 | 153 / 0・2・28・123 | 20.4（13.4 / 7.0） | 886 |
| 2 | 所持巨戟 | S(348) / RK(69,96) | 形状制約 | 1 / 2 / 0 | 7 / 12,628 / 0 / 0 | 1,865 / 11 / 15 / 0・6・15・26 | 6.8 | 7 / 0・5・1・1 | 12.1（11.1 / 1.1） | 859 |
| 3 | 所持巨戟 | S(386) / RK(63,100) | 形状制約 | 1 / 2 / 0 | 40 / 82,560 / 0 / 0 | 11,374 / 237 / 82 / 0・43・9・34 | 7.3 | 40 / 0・38・1・1 | 36.0（33.9 / 2.1） | 874 |
| 4 | 新規Normal | C(363,363) / K(173) | 射影起点 | 1 / 1 / 2 | 射影 1 / 3 / 2 / 5 | canonical Ideal 1件 | — | — | 5.1 | 882 |
| 5 | 新規Normal | C(378,378) / K(157) | 射影起点 | 1 / 1 / 2 | 射影 1 / 4 / 2 / 22 | canonical Ideal 1件 | — | — | 5.7 | 839 |
| 6 | 所持巨戟 | S(396) / RK(140,192) | 形状制約 | 1 / 2 / 0 | 12 / 220,080 / 0 / 0 | 13,706 / 489 / 26 / 0・50・81・50 | 16.1 | 12 / 0・10・1・1 | 43.5（42.0 / 1.5） | 864 |
| **7** | 所持巨戟 | S(422) / RK(208,502) | 形状制約 | 1 / 2 / 0 | 321 / 21,462,381 / 0 / 0 | 45,690 / 2,525 / 397 / 0・75・144・293 | 470 | 321 / 0・26・3・292 | 437.8（420.1 / 17.6） | 866 |
| 8 | 新規Normal | C(399,399) / R(289) | 射影起点 | 1 / 1 / 2 | 射影 1 / 1 / 2 / 1 | canonical Ideal 1件 | — | — | 4.6 | 873 |
| 9 | 新規Normal | C(410,410) / RK(72,267) | 形状制約 | 1 / 2 / 2 | 2 / 86,430 / 1 / 70 | 216 / 0 / 4 / 1・1・16・185 | 400 | 4 / 1・1・1・1 | 15.8（13.5 / 2.3） | 858 |
| 10 | 所持巨戟 | S(485) / RK(116,161) | 形状制約 | 1 / 2 / 0 | 65 / 701,415 / 0 / 0 | 59,773 / 4,742 / 132 / 0・135・56・43 | 11.7 | 65 / 0・63・1・1 | 132.4（127.3 / 5.1） | 877 |
| 11 | 新規Normal | C(478,478) / K(55) | 射影起点 | 1 / 1 / 2 | 射影 1 / 1 / 2 / 206 | canonical Ideal 1件 | — | — | 8.0 | 919 |
| 12 | 所持巨戟 | none / K(74) | 射影起点 | 0 / 1 / 0 | 射影 0 / 1 / 1 / 0 | canonical Ideal 1件 | — | — | 4.7 | 927 |
| 13 | 所持巨戟 | none / RK(73,84) | 形状制約 | 0 / 2 / 0 | 2 / 1,536 / 0 / 0 | 38 / 0 / 3 / 0・0・15・9 | 40.4 | 2 / 0・0・1・1 | 9.4（6.6 / 2.8） | 881 |
| 14 | 所持巨戟 | none / K(85) | 射影起点 | 0 / 1 / 0 | 射影 0 / 1 / 1 / 0 | canonical Ideal 1件 | — | — | 5.2 | 889 |
| 15 | 所持巨戟 | none / K(117) | 射影起点 | 0 / 1 / 0 | 射影 0 / 1 / 1 / 0 | canonical Ideal 1件 | — | — | 4.7 | 897 |
| 16 | 所持巨戟 | none / RK(107,144) | 形状制約 | 0 / 2 / 0 | 2 / 13,984 / 0 / 0 | 117 / 0 / 3 / 0・0・42・34 | 120 | 2 / 0・0・1・1 | 9.2（6.5 / 2.7） | 930 |
| 17 | 所持巨戟 | none / RK(94,153) | 形状制約 | 0 / 2 / 0 | 2 / 16,766 / 0 / 0 | 113 / 0 / 3 / 0・0・31・52 | 148 | 2 / 0・0・1・1 | 11.1（8.3 / 2.7） | 902 |
| 18 | 所持巨戟 | none / RK(112,165) | 形状制約 | 0 / 2 / 0 | 2 / 20,566 / 0 / 0 | 135 / 0 / 3 / 0・0・45・46 | 152 | 2 / 0・0・1・1 | 10.3（7.6 / 2.7） | 883 |
| 19 | 所持巨戟 | none / RK(70,168) | 形状制約 | 0 / 2 / 0 | 2 / 21,344 / 0 / 0 | 104 / 0 / 3 / 0・0・13・79 | 205 | 2 / 0・0・1・1 | 9.1（6.4 / 2.7） | 922 |
| 20 | 所持巨戟 | none / K(170) | 射影起点 | 0 / 1 / 0 | 射影 0 / 2 / 1 / 0 | canonical Ideal 1件 | — | — | 5.0 | 931 |
| 21 | 所持巨戟 | none / RK(149,194) | 形状制約 | 0 / 2 / 0 | 2 / 32,092 / 0 / 0 | 188 / 0 / 3 / 0・0・76・37 | 171 | 2 / 0・0・1・1 | 12.3（9.6 / 2.6） | 920 |
| 22 | 所持巨戟 | none / K(201) | 射影起点 | 0 / 1 / 0 | 射影 0 / 7 / 1 / 0 | canonical Ideal 1件 | — | — | 8.5 | 939 |
| 23 | 所持巨戟 | none / RK(106,212) | 形状制約 | 0 / 2 / 0 | 2 / 40,000 / 0 / 0 | 163 / 0 / 3 / 0・0・39・86 | 245 | 2 / 0・0・1・1 | 13.0（10.1 / 2.8） | 931 |
| 24 | 所持巨戟 | none / K(216) | 射影起点 | 0 / 1 / 0 | 射影 0 / 4 / 1 / 0 | canonical Ideal 1件 | — | — | 6.4 | 878 |
| 25 | 所持巨戟 | none / RK(91,218) | 形状制約 | 0 / 2 / 0 | 2 / 42,496 / 0 / 0 | 154 / 0 / 3 / 0・0・27・101 | 276 | 2 / 0・0・1・1 | 11.7（9.0 / 2.7） | 885 |
| 26 | 所持巨戟 | none / K(219) | 射影起点 | 0 / 1 / 0 | 射影 0 / 1 / 1 / 0 | canonical Ideal 1件 | — | — | 4.8 | 893 |
| 27 | 所持巨戟 | S(508) / K(179) | 射影起点 | 1 / 1 / 0 | 射影 0 / 6 / 23 / 0 | canonical Ideal 1件 | — | — | 7.8 | 924 |
| 28 | 所持巨戟 | none / RK(159,224) | 形状制約 | 0 / 2 / 0 | 2 / 44,720 / 0 / 0 | 210 / 0 / 3 / 0・0・81・49 | 213 | 2 / 0・0・1・1 | 14.7（11.6 / 3.1） | 935 |
| 29 | 所持巨戟 | none / K(242) | 射影起点 | 0 / 1 / 0 | 射影 0 / 7 / 1 / 0 | canonical Ideal 1件 | — | — | 7.1 | 890 |
| 30 | 所持巨戟 | none / RK(67,269) | 形状制約 | 0 / 2 / 0 | 2 / 74,214 / 0 / 0 | 181 / 0 / 3 / 0・0・11・160 | 410 | 2 / 0・0・1・1 | 15.3（12.5 / 2.8） | 921 |
| 31 | 所持巨戟 | none / RK(235,277) | 形状制約 | 0 / 2 / 0 | 2 / 79,650 / 0 / 0 | 314 / 0 / 3 / 0・0・138・39 | 254 | 2 / 0・0・1・1 | 16.6（13.6 / 3.1） | 905 |
| 32 | 所持巨戟 | none / RK(101,288) | 形状制約 | 0 / 2 / 0 | 2 / 87,792 / 0 / 0 | 217 / 0 / 3 / 0・0・32・154 | 405 | 2 / 0・0・1・1 | 17.0（13.8 / 3.2） | 891 |
| 33 | 所持巨戟 | S(588) / K(164) | 射影起点 | 1 / 1 / 0 | 射影 0 / 3 / 22 / 0 | canonical Ideal 1件 | — | — | 6.6 | 918 |
| 34 | 所持巨戟 | S(566) / RK(274,304) | 形状制約 | 1 / 2 / 0 | 60 / 2,993,760 / 0 / 0 | 30,441 / 9,357 / 122 / 0・213・171・27 | 98.3 | 60 / 0・58・1・1 | 297.2（259.7 / 37.5） | 1,146 |
| 35 | 所持巨戟 | S(648) / K(71) | 射影起点 | 1 / 1 / 0 | 射影 0 / 1 / 60 / 0 | canonical Ideal 1件 | — | — | 26.1 | 559 |
| 36 | 所持巨戟 | none / RK(403,430) | 射影起点 | 0 / 2 / 0 | 射影 0 / 66 / 1 / 0 | canonical Ideal 1件 | — | — | 130.2 | 548 |
| 37 | 所持巨戟 | S(740) / RK(133,193) | 形状制約 | 1 / 2 / 0 | 94 / 1,365,162 / 0 / 0 | 78,285 / 27,539 / 190 / 0・384・57・46 | 17.4 | 94 / 0・92・1・1 | 239.0（230.4 / 8.5） | 582 |
| 38 | 所持巨戟 | S(757) / K(77) | 射影起点 | 1 / 1 / 0 | 射影 0 / 3 / 17 / 0 | canonical Ideal 1件 | — | — | 7.3 | 610 |
| 39 | 所持巨戟 | S(786) / K(125) | 射影起点 | 1 / 1 / 0 | 射影 0 / 8 / 29 / 0 | canonical Ideal 1件 | — | — | 11.0 | 592 |
| 40 | 所持巨戟 | S(887) / K(57) | 射影起点 | 1 / 1 / 0 | 射影 0 / 2 / 101 / 0 | canonical Ideal 1件 | — | — | 16.6 | 580 |
| 41 | 所持巨戟 | S(892) / RK(103,364) | 形状制約 | 1 / 2 / 0 | 7 / 546,000 / 0 / 0 | 121,959 / 3,693 / 16 / 0・532・30・220 | 4.5 | 7 / 0・5・1・1 | 247.5（243.1 / 4.4） | 645 |
| 42 | 所持巨戟 | S(1423) / K(113) | 射影起点 | 1 / 1 / 0 | 射影 0 / 1 / 531 / 0 | canonical Ideal 1件 | — | — | 72.5 | 684 |

形状制約の各attemptのreservation（先行Entryから導出した正式reservation。改変していない）は、順序1で先行1 Entry（Skill held 1 / blocked 1、Gogma held 2 / blocked 1）から
順序41で先行41 Entry（Skill held 547 / blocked 20、Gogma held 448 / blocked 63）まで増えた。

### 6.3 旧D-0Bの最初の未解決Target（順序7）

旧D-0B（`d0a-v1`、Planner Alternative Search）では、順序7（`reset_skills(422)` + `reset_then_keep(208, 502)` の所持巨戟）が delivery cap 500（探索的に5,000）でも
期待形を配送されず `unconfirmed(delivery_cap_reached)` だった。`d0a2-v2` では、同じ順序・同じ正式reservation（先行7 Entry: Skill held 56 / blocked 7、
Gogma held 153 / blocked 11）のもとで、形状制約Searchが **最初の配送** で期待形を返し、`materialized` になった。

- 予測: Skill laneの自分の操作 26（窓 341〜422、非held + heldなrequired）、Gogma laneの自分の操作 295（窓 55〜502、非held 295位置。D-0B §5.2の推定どおり）、
  depth上界321、Gogma生成上界 21,462,381
- 実測: Gogma生成state 45,690（Gogma depth 321）、Skill state 2,525（Skill depth 75）、settled work 397、予測 Skill 75 / Reset 144 / Keep 293、support問合せ61
- required: Skill {422}、Gogma {208, 502}（期待形と一致）。独立Route検証は321操作をすべて再予測して通過（再予測 Skill 26 / Reset 3 / Keep 292）
- 時間 437.8 ms（Search 約420 ms、検証 約18 ms）。旧方式ではこのTargetだけで132.5 s / 137.2 s（旧D-0B finalの2 run）・7,308万stateを使い、なお期待形に届かなかった

## 7. Search費用（予測上界と実測、`d0b2-reg`）

形状制約22件の合計と最大（Searchの使用量。独立検証の再予測は別に数え、budgetに入れない）:

| 成分 | 合計 | 最大（順序） | 登録budget | 予測上界の最大 |
| --- | ---: | ---: | ---: | ---: |
| Gogma生成state | 365,394 | 121,959（41） | 50,000,000 | 21,462,381（7） |
| Skill state | 48,595 | 27,539（37） | 2,250,000 | — |
| settled work | 1,174 | 397（7） | 100,000 | — |
| Normal予測 | 1 | 1（9） | 350 | — |
| Skill予測 | 1,441 | 532（41） | 1,501 | — |
| Reset予測 | 1,157 | 171（34） | 500 | — |
| Keep予測 | 1,893 | 293（7） | 500 | — |
| support問合せ | 418 | 83（41） | （budget成分なし） | — |
| depth（own operation） | — | 321（7） | gate 2,000 | — |

- **独立検証**: 22件、検証した操作の合計787、再予測 Normal 1 / Skill 300 / Reset 51 / Keep 435（support問合せ0）。時間は合計 約0.12 s（最大 約37.5 ms。順序34、GCを含むと見られる）
- **Search時間**: 形状制約 合計 約1.51 s（最大 約420 ms、順序7）、射影起点 合計 約0.31 s（最大 約127 ms、順序36）。Target合計 1.99 s
- **予測上界と実測**: Gogma生成state上界は実測の4.5〜470倍（最小: 順序41 546,000 / 121,959、最大: 順序7 21,462,381 / 45,690）。上界はどのTargetでも実測以上だった
  （上界の性質の観測であり、上界を実測値として扱わない）。比は形により大きく異なり、上界の大小は費用の順序も表さない（順序7は上界最大だが実測は5番目）。
  D-0Bの所見（予測規模は費用の予測値ではない）と同じ
- **process全体**: child wall 34.0 s / 33.7 s（setup 0.7〜0.8 s、Phase 0 1.7 s、ReachTable 11.5〜11.6 s、structural search 17.7〜17.9 s、診断 2 ms、
  materialization 1.96〜2.01 s）。heapUsed最大 0.89 / 0.92 GB、RSS最大 1.37 / 1.29 GB（`--max-old-space-size=4096`、heap size limit 約4.5 GB）
- **Target別memory**: Target確定時のheapUsedは548〜1,146 MB（最大は順序34の後。順序35でGCにより559 MBへ下がった）。materialization中のRSS最大 1,362 MB。
  Target 1件の時間が250 ms標本間隔より短いため、Target内の最大は多くの場合開始・確定の2点の大きい方である

## 8. 旧D-0B・比較runとの差

### 8.1 3つの組合せ

| 組合せ | run | 最初の候補 | 結果 | materialization時間 |
| --- | --- | --- | --- | ---: |
| a1 + `d0a-v1` | 旧D-0B final（`b7b7b00`）、`d0b2-cmp-v1`（`b4ed799`、再実行） | objective 1,766 | 7 / 43、順序7で `unconfirmed(delivery_cap_reached)` | 164〜168 s / 137.6 s |
| a1 + `d0a2-v2` | `d0b2-cmp-a1` | objective 1,766（同一） | 43 / 43 `all_materialized` | 1.81 s |
| a2 + `d0a2-v2`（主方式） | `d0b2-reg` | objective 1,766（同一） | 43 / 43 `all_materialized` | 1.96〜2.01 s |

`d0b2-cmp-v1` は旧D-0B finalとsemantic SHA-256が一致した（`53b1b77c…`）。`d0a-v1` の記録はD-0A-2a / 2b / A-2 / 本PRを通じて実Export上で不変である。

### 8.2 差の分解

1. **option集合（a1 → a2）**: 最初のstructural candidateは同一（objective、stream終端、materialization順序、全Targetのoption、Skill依存が一致）。
   `d0b2-cmp-a1` と `d0b2-reg` のsemantic recordの差は、条件の `reachOptionSet`、構造探索の資源棄却 `gogma_position` 513,664 → 513,670（+6。MRV計数中に
   a2の継続optionが位置排他で棄却された分）、継続option計数の表現（a1は `not_generated_by_current_phase_a`、a2は件数0）の3点だけで、node数・候補・
   materialization結果は同一。構造探索の時間はa2で17.7〜18.3 s、a1で43.6〜44.3 s（同じ44 node・同じ候補。原因は本PRでは調べていない）
2. **materialization方式（`d0a-v1` → `d0a2-v2`）**: 結果の差（7 / 43 → 43 / 43）はこれによる。順序0〜6は両方式でEntry IDが一致し（§8.3）、
   順序7以降は旧方式では未解決 / 未試行だった
3. **Search gate / budget**: `d0a-v1` のdelivery capは `d0a2-v2` には無い（Planner Alternative Searchを使わない）。`d0a2-v2` のshape gate / budgetは
   探索用の値（`d0b2-r1`）でも登録値（`d0b2-reg`）でもどの成分も拘束せず、結果は同一。delivery capとshape budgetは同じ意味の値ではないので対応づけない
4. **materialization順序とreservation**: 両方式とも同じPhase Cの順序で、同じ正式reservationの導出（先行Entryから。改変なし）を使う。旧方式で順序7が未解決だった原因
   （D-0B §5.2: 6キー配送順序でown operationの多い期待形が後方になる）は順序ではなく方式側で解消した。順序の変更は行っていない
5. **実際のSearch費用**: 旧方式の順序6・7（Planner Alternative Search）はGogma生成state 1,758万（30 s）/ 7,308万（133 s、未一致）を使った。新方式は同じ2 Targetで
   13,706 / 45,690 state（43.5 ms / 437.8 ms）、43 Target全体で365,394 state

### 8.3 Entryの比較（順序0〜6、旧D-0B final vs `d0b2-reg`）

| 順序 | 旧方式 | 新方式 | 形の一致 | required位置 | 最終武器 | RouteOperation列 | Entry ID |
| ---: | --- | --- | --- | --- | --- | --- | --- |
| 0 / 4 / 5 | 射影起点 | 射影起点 | 両方一致 | 一致 | 一致 | 一致 | 一致（Entry本体のhashも一致） |
| 1 / 2 / 3 / 6 | Planner Alternative Search（最初の配送で一致） | 形状制約（最初の配送） | 両方一致 | 一致 | 一致 | 一致 | 一致（Entry本体のhashは異なる） |

- required位置は記録の `plannerRequired` で比較した。最終武器とRouteOperation列は記録にEntry本体が無いため、Entry IDから導いた: Entry IDは
  `createBuildCandidateMeaningFingerprint()`（Target、Route（RouteKind・source・RouteOperation列）、最終5枠の多重集合、scope、Series / Group Skill）、
  Target定義hash、`searchStateHash`、`referencedOwnedWeaponsHash`、CalculationContextから決まる（D0A2 §3.8）ので、Entry IDの一致はこれらの一致を意味する
  （hashの衝突は考えない）
- 順序1 / 2 / 3 / 6でEntry本体のhash（`entrySemanticHash`）が異なるのは、方式ごとのsearch identityに由来するCandidate ID・`searchRunId`・
  `BuildListEntry.candidateId` が異なるためで（D0A2 §3.8 / §19.5）、Entryの意味の差ではない。**Entry本体のhashの違いだけで新方式の失敗とは判定しない**
- D0A2 §19.5の「操作種別の別解」（`reset(g*)` の形でPlanner Alternative SearchがKeep chainを最初に返す）は、この範囲（順序0〜6。`reset` の形は順序8で、
  旧方式では未試行）には現れなかった。順序7以降は旧方式の結果が無いので比較できない

## 9. G1 / G2 / G3 / G4

| 診断 | 最初のstructural candidate | ReachTable全体（post-hoc、§9.1） | 観測範囲と注意 |
| --- | --- | --- | --- |
| G1（巨戟化継続、`conversion (c < s*)`、cがIdeal） | 0件（巨戟化5件はすべて c = s*） | G1形の (c, s*) 組が全43 Targetにある（最大1,125,750組 / Target） | 候補が選ばないのは定理T（設計 §19.4）と値順序（継続optionは支配する非継続optionより後に配送）に整合する。実ExportでのG1形のmaterializationは未観測 |
| G2（所持巨戟の現在Ideal laneの継続） | 0件 | Skill lane（S2）の継続option 76,659件（25 Target、現在SkillだけIdealの（Target, 所持巨戟）47組）。Bonus lane（B1 / B2）0件 | 実ExportでのG2形のmaterializationは未観測（合成fixtureではD0A2 §20.2） |
| G3 上側 | 静的risk 3件（順序7 / 24 / 29）。順序7はrequest上の条件が成立（q = 216がfree）、順序24 / 29は射影起点で一致（射影起点にはreservationが無い） | — | 順序7は形状制約Searchが最初の配送で期待形（required {208, 502}）を返し、collapse署名0件。形状policyにより代表化が起きないこと（D0A2 §7）と整合。`d0a-v1` での発生 / 不発生は旧D-0B同様に未確認（配送が最終位置まで届いていない） |
| G3 下側 | 静的risk 0件（適用option 23） | — | この候補では対象なし |
| G4 | 0件（Planner開始時にIdeal武器を持つplanning Targetが無い） | Bonus Idealの所持巨戟の組0、両軸Idealの組0、保護0 | G4-i / ii / iiiの成否はPhase D'（D-1）でしか決まらない |

### 9.1 ReachTable全体の継続option（post-hoc分析）

計測runとは別に、計測HEADのResearch API（`buildReachTable()` をa2・W0で、`enumerateReachOptionsOfSource()`、`continuationShapeOf()`、
`enumerateBonusRequirements()`）でReachTableを読み、件数を数えた（読み取りのみ。scriptはRepositoryに含めない。runのRESULTには入らない）。
G2は所持巨戟sourceのoptionを列挙して継続形を数えた。G1はTargetごとの「c < s*、cがIdeal Skill位置、s*がIdeal（巨戟化上限以下）」の組数と、Normal sourceごとの
Bonus要件数の積で数えた（列挙はしていない。G1形のoption総数は約1.94 × 10^10）。いずれもoptionの存在であり、materialize可否ではない。

## 10. gate / budget / timeout / OOMの観測と調整の根拠

### 10.1 探索用の値（`d0b2-r1`、非formal暫定値）

`d0a2-v2` のshape gate / budgetには既定値も正式値も無かったので、次の根拠で探索用の値を選んだ（未計測の削減率や特定Targetの既知の位置は使っていない）。

| 成分 | 探索用の値 | 根拠 |
| --- | --- | --- |
| shape gate D / G / N / W | 2,001 / 502,251,000 / 350 / 1,501 | W0内では拘束しない値（窓の位置数から上界の式で求めた。後で厳密化した §10.2） |
| budget Gogma生成state | 100,000,000 | D-0Bで完走した最大のheld-aware Gogma Search（7,308万state、4 GB heap）より上 |
| budget Skill state | 2,253,001 | W0のSkill窓1,501位置 × depth 1,501 |
| budget settled work | 1,000,000 | D-0Bの最大観測2,304の大きな余裕 |
| budget 予測 N / S / R / K | 700 / 3,002 / 1,000 / 1,000 | W0の位置数の2倍（memo単位をコードで確認する前の余裕） |
| child wall / heap | 60分 / 8,192 MB | 43 Targetの費用が未知のため、D-0B（30分 / 4,096 MB、RSS 2.8 GB）より広くした（machine 33.4 GB） |

### 10.2 観測と、登録値への調整

| 観測（`d0b2-r1`） | 判断 |
| --- | --- |
| 全22件の形状制約Searchが最初の配送で受理され、budgetのどの成分も実測の数百倍以上の余裕があった | budgetが探索を途中で止めた事実は無い。登録値は「実測以上で、資源上安全な範囲」の値を、成分ごとの上界から選んだ（§12） |
| 予測上界は実測の4.5〜470倍で、比が形によって大きく異なる | 上界は費用の予測値として使えない。W0の最大値より小さいgateは費用の根拠なしにTargetを拒否するので、gateはW0内で拘束しない値とし、費用はbudgetで抑える |
| gateが拒否したTargetは0件（射影起点・形状制約とも） | 安全に処理できるTargetを拒否していない |
| 予測回数の最大は Normal 1 / Skill 532 / Reset 171 / Keep 293 | memoの単位（Skill: Skill Counter、巨戟化Skillも同じmemo、Reset: Gogma Counter、Keep: Gogma Counter × family layoutで形状policyによりlayoutは1つ、Normal: production targetだけ）をコードで確かめ、W0の位置数（350 / 1,501 / 500 / 500）を上界として登録した |
| child 34 s、heapUsed最大0.96 GB（8 GB limit） | envelopeはD-0B / B-2Bの30分 / 4,096 MBに戻した。登録値で実行した `d0b2-reg` でもheapUsed最大0.92 GB、34 s |
| timeout / OOMは0件 | envelopeを広げる根拠は無い |

すべての成分が拘束しなかったので、結果に合わせて上限を上げ下げした値は無い。43 / 43に届かないことを理由にした調整も無い（届いた）。

### 10.3 停止時の分類（このsmokeでの発生件数）

| outcome | 件数 |
| --- | ---: |
| `materialized` | 43 |
| `not_executed(search_scale_gate)` | 0 |
| `unconfirmed(shape_search_budget_reached)` | 0 |
| `unsupported` | 0 |
| `unmeasured(timeout)` / `unmeasured(out_of_memory)` | 0 |
| `fail_closed`（`shape_constrained_unreachable`、`prediction_support_inconsistent`、`route_verification_failed` 等） | 0 |

補題（D0A2 §5.5）の反例は、この実Exportの最初の候補では見つからなかった（前提違反0、未配送での終了0）。補題の一般の証明ではない。

## 11. 決定性

- `d0b2-reg`（登録値、`--repeat 2`）: 2 runのsemantic SHA-256が一致（`6f790d33…`）。時間・memoryはsemanticに含めない
- `d0b2-r1` と `d0b2-reg` は条件以外のsemanticが一致、`d0b2-cmp-v1` は旧D-0B finalと一致（別HEAD・別日時）
- 同じmachine・同じNodeでの確認であり、他のmachine・Node versionでの決定性は未確認

## 12. D-0Cの正式計測条件（事前登録）

`MATERIALIZATION_D0C_PREREGISTRATION`（`src/benchmarks/globalAssignment/materializationProtocol.ts`）。D-0A-2bの登録項目
（`MATERIALIZATION_D0A2B_REGISTRATION_ITEMS`）と追加項目（`MATERIALIZATION_D0C_EXTRA_REGISTRATION_ITEMS`）を網羅する（`materializationD0cRegistrationIssues()` が空であることをtestで固定）。
根拠runの識別子は§4、RESULTのSHA-256は§4の表。すべて `oracleInformed: false`。

| # | 項目 | 値 | 単位 | 根拠 | 根拠run | 観測できた範囲 / 未確認範囲 |
| ---: | --- | --- | --- | --- | --- | --- |
| 1 | window | Normal 350 / Gogma 500 / Skill 1,500（W0） | Counter位置数 | `recommendedCandidateSearchDefaults`（REQUIREMENTS 14.1、非oracle起源）、B-2B / D-0Bのwindow。W0で `all_materialized` なので設計 §10.3は拡大を求めない | r1、reg、cmp-a1、B-2B | W0のみ / 他のrung（W1以降は未登録のまま） |
| 2 | nodeBudget | 2,000 | 構造探索の展開node数 | B-2Bの登録値。最初の候補は44 node（a1 / a2とも） | r1、reg、cmp-a1、B-2B | 44 node / 2件目以降 |
| 3 | mrvLookahead | 8 | 設計 §6.4のk | B-2Bの登録値 | 同上 | k = 8のみ / 他のk |
| 4 | coverageDrivenOrdering | true | boolean | 設計 §6.3。被覆棄却0件で発動しない | r1、reg、cmp-a1 | 発動なし / 発動する入力 |
| 5 | structuralCandidateLimit | 1 | 1 runの候補数 | 設計 §9.8（D-0は最初の候補を測る）。最初の候補が `all_materialized` | 同上 | ordinal 0 / 2件目以降のmaterialization |
| 6 | optionSetVersion | `global-assignment-reach-options:a2` | option集合version | A-2。a2でも最初の候補はa1と同一 | 同上 | 継続optionは選ばれない / 実ExportでのG1 / G2形のmaterialization |
| 7 | methodSelectionRule | `d0a2-v2` | 規則 | D0A2 §11 | 同上 | 連続形21（射影起点）・非連続形22（形状制約） / 射影起点から形状制約へのfallback、継続形 |
| 8 | continuationShapeRule | `lane_start_ideal_skill_continuation`、`lane_start_ideal_owned_gogma_continuation` | `CONTINUATION_SHAPE_DETECTORS` のpolicy（G1、G2） | D0A2 §6.1 / §6.2 / §20.1。`d0a2-v2` では形状制約だけで扱う | r1、reg | 0件 / 実Exportの継続形 |
| 9 | projectedSearchScaleGate | 巨戟化位置32 / Gogma幅500 / Skill幅1,501 / forge 350 | 設計 §9.7の予測規模 | D-0Bのgate（巨戟化位置はD2-G-A、幅とforgeはW0）。21件で最大 1 / 66 / 531 / 206、拒否0 | r1、reg、D-0B既定値 | 上記最大 / W0の幅に近い射影起点Search |
| 10 | shapeSearchScaleGate | depth 2,000 / Gogma生成上界 502,000,000 / forge 350 / 歩行1,501 | D0A2 §10.3の予測上界 | 各成分のW0最大値（depth ≤ Skill lane 1,500 + Gogma lane 500、生成上界 ≤ depth × 500 × (held run 500 + 2)、forge ≤ 350、歩行 ≤ 1,501）。上界は実測の4.5〜470倍で費用の根拠にならないので、W0内で拒否しない値とする | r1、reg | 最大 depth 321 / 上界 21,462,381 / forge 1 / 歩行70、拒否0 / W0最大に近い上界のSearch（費用はbudgetが抑える） |
| 11 | shapeSearchBudget | Gogma生成state 50,000,000 / Skill state 2,250,000 / settled work 100,000 / 予測 Normal 350・Skill 1,501・Reset 500・Keep 500 | 1 Searchの使用量 | Gogma: 実測最大121,959、D-0Bで完走した73.08 M state（133 s、heapUsed 2.53 GB、4 GB heap）の内側。Skill: W0上界（depth ≤ 1,500 × 窓 ≤ 1,500位置、D2-G-Aで2.8 M完走）。work: work / depth ≤ 2.3でW0 depth上界なら約4,600、100,000は暴走だけを止める。予測: memo単位によるW0の位置数 | r1、reg、D-0B、D2-G-A | 実測最大 121,959 / 27,539 / 397 / 1・532・171・293、停止0 / 121,959 stateを超える形状制約Searchの時間・memory（50 Mまでは外挿） |
| 12 | routeVerification | `every_shape_constrained_materialization` | 独立Route検証の適用範囲 | D0A2 §13 #7 | r1、reg | 22件すべて通過 / Planner・Trace Replay（D-1）。通過は `verified` ではない |
| 13 | materializationOrderRule | `phase-c-design-8.2` | `deriveMaterializationOrder()` の規則 | D0A2 §8（Phase Cの順序を維持） | r1、reg | Skill依存5件の順序 / 他の順序（順序v2は計画しない） |
| 14 | childWallMs | 1,800,000（30分） | 1 child processのwall-clock | 子process 34 sの約50倍、旧方式の子process（235 s）も含む | r1、reg | 約34 s / budget上限近くのSearchが続く最悪ケース |
| 15 | childHeapMb | 4,096 | `--max-old-space-size` | heapUsed最大0.96 GB（8 GB limit）・0.92 GB（4 GB limit、reg）。B-2B / D-0Bの値 | r1、reg、B-2B | 約1 GB / budget上限近くの形状制約Searchのmemory |
| 16 | repeat | 2 | 1 runの子process数（semantic SHA-256の一致が必要） | 設計 §12の決定性 | reg | 2 run一致 / 他machine・Node |
| 17 | exportIdentity | 本書 §2のblock | 名前・bytes・SHA-256 | B-2B / D-0Bと同じExport | r1、reg、cmp-a1 | このExportのみ / 他のExport |
| 18 | calculationContext（Engine versionを含む） | `unknown-initial` / 4 / `production-rng:c5-e7` / 17 | CalculationContext | 全runの子processの記録。testで現行のMaster manifest・Engine・計算版数と一致を固定 | r1、reg、cmp-a1 | この版のみ / 他の版（版の変更は再登録） |
| 19 | researchProtocolVersion | `global-assignment-d0a2b:1` | runner protocol | `d0a2-v2` のrunの記録 | r1、reg、cmp-a1 | — |
| 20 | repositoryRule | `clean_head_no_uncommitted_code_calculation_diff_audited` | formal runの開始規則 | clean Working Tree・未commitの計算関連コードなし、HEADとbenchmark code SHA-256（src / scripts / build設定のgit ls-files内容）を記録し、登録HEADからの計算関連コード差分をD-0Cが報告する。差分があれば登録値と計測コードの整合を再確認する | reg | 本PRのrunはすべてclean |

加えて concurrency 1、retry なし、`formalRun.enabled: false`（`startsIn: 'D-0C (a separate task)'`）。登録値と `d0a-v1` のsmoke既定値（delivery cap 500等）は別物で、
`d0a-v1` の既定値は変えていない。

### 12.1 smoke条件と登録条件の区別

`d0a2-v2` のsmokeは、runの条件・envelopeと登録値の差分を `formalRegistration.d0cRegistration.differencesFromRegistration` に記録する。`d0b2-reg` は差分なし
（`conditionsMatchRegistration: true`）、`d0b2-cmp-a1` は `reachOptionSet` と `repeat`、`d0b2-r1` は登録前のrunなので記録を持たない。smokeは登録値で走っても
smokeであり（`mode: smoke`、`formal: false`）、formal runの代わりにはならない。

## 13. 登録できなかった条件・未確認事項

- **登録できなかった条件**: 無い（全項目に値と根拠がある）
- **未確認**:
  - formal run（D-0C）とPlanner検証（D-1）。`all_materialized` はPlanではない
  - 2件目以降のstructural candidate、W0以外のwindow
  - 実ExportでのG1 / G2継続形、射影起点から形状制約へのfallback、`reset(g*)` の形での「操作種別の別解」（旧方式の順序8以降は未試行）
  - 121,959 stateを超える形状制約Searchの時間・memory（登録budget 50 Mまでは外挿）
  - G4-i / ii / iiiの成否（このExportでは対象0件）
  - 構造探索時間のa1 / a2差（§8.2の1）の原因
  - 他のmachine・Node versionでの決定性・時間

## 14. D-0Cへの引き継ぎ

1. D-0Cは別PR・別タスクで、`d0a2-v2` のformal modeをrunnerに実装する（現在は `--mode formal` を拒否する）。B-2Bと同じく、登録の網羅性
   （`materializationD0cRegistrationIssues()`）、`formalRun.enabled`、clean HEAD・未commitコードなし、committed HEADの本書のidentity block（`git show HEAD:<doc>`）
   とExportの照合、子processでの再確認、登録値以外のoverrideの拒否、2 runのsemantic一致を `formalValidity` として判定すること
2. 有効化の前に、登録HEAD（本PRのmerge）からD-0CのHEADまでの計算関連コード（`src` / `scripts` / build設定）の差分を報告し、差分があれば登録値と計測コードの整合を
   再確認する（必要なら再smoke）。登録値は変えない
3. 計算版数・Engine version・Master dataの変更は再登録を要する
4. formal runの結果も `all_materialized` 以上の主張をしない（Planner検証はD-1）

## 15. test・検証

| file | 内容 |
| --- | --- |
| `materializationProtocol.test.ts`（追加） | 登録の網羅性（D-0A-2b項目 + 追加項目、各項目の値・単位・根拠・根拠run・`oracleInformed: false`・範囲、1,657 / 64桁hex / UUIDを含まない）、規則 `d0a2-v2`・option集合a2・独立検証・継続形の検出器とpolicy・Phase C順序・protocol version、shape gateと予測budgetがW0上界の式と一致し実測最大より上、CalculationContextが現行のMaster manifest・Engine・計算版数と一致、formal拒否と `formalRun.enabled: false`、`d0a-v1` 既定値と登録の区別、差分（a1、envelope、budget、`d0a-v1`）、本書のidentity blockがB-2Bの登録Exportと一致 |
| `shapeMaterializationRunner.test.ts`（追加） | `d0a2-v2` のobservedにだけ `shapeTimeline` が入り（形状制約のTargetで検査時刻 < 確定、射影起点の後）、semanticに時間が入らず、`d0a-v1` のobservedに無い |
| `scripts/run-planner-global-assignment-d0b.test.ts`（追加） | `d0a2-v2` runが登録との差分・一致・Export照合を記録し、formal modeが無効のまま。登録値そのまま（repeat 1）のrunで差分が `repeat` だけ |

既存のtest（v1 golden、PR #248 Production golden、PR #249 `d0a-v1` golden、PR #250のa1 / a2 test、G1 / G2 / G3 / G4、property / parity、isolation）は変更していない。
検証コマンドの結果はPR本文に記載する。

## 16. 変更していないもの

- Production（`src/domain` / `services` / `workers` / `pages` / `components` / `db`）、UI、Persistence、Worker protocol、RNG semantics、schema / version
  （`CURRENT_CALCULATION_APP_SCHEMA_VERSION` 17、`DATABASE_SCHEMA_VERSION` 10、`ExportRoot.schemaVersion` 13、`production-rng:c5-e7`）
- Phase Aのoption集合、Phase Bの値順序・下界、Phase Cの被覆・materialization順序、Research Search seam（D-0A-2a）の意味論、`d0a2-v2` の方式・照合・分類
- `d0a-v1` の条件・既定値・記録・protocol version、B-2A / B-2B runnerと正式RESULT、旧D-0BのRESULT・記録の測定値
- 実Export・runの生成物はRepositoryへ追加していない（`.local/` はgit-ignored）。本書は集計値と順序indexだけを記録し、Target ID / OwnedWeapon ID / Entry内容を載せない
