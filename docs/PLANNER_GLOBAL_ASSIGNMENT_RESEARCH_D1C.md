# Global Planner Global Assignment Phase D-1C（Production Planner統合acceptanceの正式計測）

Refs #154。Research-only・**formal measurement**。基準main: PR #254 merged `d15ea9b0277b417b2681305486b6fb03dda57054`
（作業開始時に `main` / `origin/main` / HEADの一致、Working Tree clean、stash / 追加worktreeなし、PR #254のmerge済みを確認）。branch: `research/global-assignment-phase-d1c`。

| 項目 | 値 |
| --- | --- |
| **登録HEAD** | `d15ea9b0277b417b2681305486b6fb03dda57054`（PR #254 = D-1Bのmerge commit。D-1Bの登録 `PLANNER_VERIFICATION_D1C_PREREGISTRATION` とfingerprint blockを含むことをローカルGitで確認） |
| **現行のmeasurement HEAD** | `68a1ac8696560ba8eab61e3bfc887cb3f13f5898`（正式計測2。PR #255 Required fixのtest修正をcommitしたclean HEAD。以降のcommitはdocs-only） |
| 置き換えた正式計測1のmeasurement HEAD | `636616d6764f6bb4ac4a206aa39afec789b1b5c6`（§0。結果は正式計測2と同一） |
| 公開RESULT | [`PLANNER_GLOBAL_ASSIGNMENT_D1C_RESULT.json`](PLANNER_GLOBAL_ASSIGNMENT_D1C_RESULT.json)（正式計測2、54,965 bytes、SHA-256 `9e9e33d77e99c45b24fbb52ac27248fc1fbaa8fc210bba72af164daa4431fb46`）、[`PLANNER_GLOBAL_ASSIGNMENT_D1C_RESULT_RUN1.json`](PLANNER_GLOBAL_ASSIGNMENT_D1C_RESULT_RUN1.json)（正式計測1、置き換え済み・内容不変、54,964 bytes、SHA-256 `68cb07122694d8f84d1a8dff1c2206f4f900da714d981ac697dd19cc5bb8e4bd`） |
| 結果 | **`formalValidity = valid`、候補outcome `verified`、正式acceptance `accepted`**（正式計測1・2とも）。物理操作数1,766（incumbent 8,534より少ない = 操作数改善）。最小性は `best_found`（`proven_minimum` ではない） |

以下の §3〜§14 の値は、断りがない限り現行の正式計測2のものである。semantic recordの値（hash、Planner・Trace Replay・物理操作数、validity、outcome）は正式計測1と同一で、
異なるのは時刻・時間・memory・HEADを含むfileのhashだけである（§0.2）。

## 0. 正式計測の置き換え（PR #255 Required fix）

| 区分 | commit | 内容 |
| --- | --- | --- |
| 正式計測1のmeasurement HEAD | `636616d6764f6bb4ac4a206aa39afec789b1b5c6` | formal基盤の実装・`formalRun` 有効化。正式計測1（2026-10-13 13:29:14Z〜13:30:45Z）は valid / verified / accepted |
| 正式計測1の記録 | `139b92557cbbd4cc8ba698b2e0fde5755306222d` | docs-only（本書の初版と公開RESULT。公開RESULTは現在 `…_D1C_RESULT_RUN1.json` に改名して内容は不変） |
| testの修正 = **現行のmeasurement HEAD** | `68a1ac8696560ba8eab61e3bfc887cb3f13f5898` | `scripts/run-planner-global-assignment-d1c.test.ts` だけを変更（§0.1） |
| 正式計測2 | 現行のmeasurement HEADで実行（2026-10-13 14:02:51Z〜14:04:25Z） | 登録条件は1つも変えずに再実行。valid / verified / accepted、semantic recordは正式計測1と同一 |
| 正式計測2の記録 | 後続（docs-only） | 本書の更新、公開RESULTの再導出、RUN1の改名、設計 §9.16 / §14、PR本文 |

**置き換えの理由**: `139b925` のGitHub Actions（run 38406526620、Test shard 1/3）で、formal child gateの拒否test
（`a child refuses a hand-written task from its own observations before it computes anything, and writes no record`、`scripts/run-planner-global-assignment-d1c.test.ts:160`）が失敗した。
修正は計算に関係しないtest fileの変更だが、正式計測1のmeasurement HEAD以降を「docs-only」とした記録はそのままでは成り立たなくなるので、修正をcommitしたclean HEADを
新しいmeasurement HEADとして、登録条件のまま正式計測をやり直した（D-0C §0と同じ扱い）。正式計測1は削除も上書きもしていない（raw recordは `.local/ga-d1c-formal-r1.*` に
不変で残り、SHA-256は計測直後の値と一致する（§14.2）。公開RESULTも内容不変のまま改名し、`--check` を通る）。正式計測1は当時のHEADでの有効な正式計測であり、
置き換えはPR headとmeasurement HEADの対応を保つためである。

### 0.1 CI失敗の原因と修正

- **直接原因**: CIのcheckoutはshallow（depth 1）で、登録HEAD `d15ea9b` が履歴に無い。formal child gateは登録HEADのD-1B記録を読めず、
  `The registered fingerprint block at the registration HEAD could not be read …`、`The calculation code audit could not run: git diff failed …`、
  `The registration HEAD … is not an ancestor of the measured HEAD.`、`The child could not read the registered D-0C identity: …` で拒否した。これはformal runを
  fail closedさせる正しい挙動である。一方testは、D-0C identityを改変したtaskについて、登録identityとの値比較の拒否理由
  `The task D-0C identity is not the registered one read from HEAD.` を環境によらず要求していた。登録identityを読めなければ値比較は行えないので、shallow checkoutでは
  この理由は出ない。formal guardの不良ではなく、testがgit履歴の有無による拒否理由の違いを扱っていなかった
- **修正（test only）**: formal guardが使うgit操作を、guardと同じコマンドで1つずつ調べるtest専用helper（`registrationHistory()`: 登録commitの存在、登録HEADと現HEADの
  D-1B記録の読取り、祖先関係、登録HEADからの差分）を追加した。commitの存在確認（`git cat-file -e`）だけでは、文書の読取り・祖先関係・差分監査の成功を保証しないためである。
  履歴に依存する拒否理由（監査不能、祖先でない、登録fingerprint blockの読取り不能）は、そのgit操作が答えられない環境では必ず含まれ、答えられる環境では含まれないことを確認する。
  D-0C identity改変の検査は、登録identityを読める環境では値比較の拒否を、読めない環境では「登録D-0C identityを読めない」ことによるfail closedを確認する（値比較の理由が出ないことも確認）。
  全環境で、非0 exit、formal child gateの拒否、record・Entry集合を作らないこと、journalにmaterialization・D-0C identity・Phase D'（Planner）の段階が無いことを確認する。
  start gateの拒否testも同じhelperで確認するよう変え、probeがrunnerのgitコマンドそのものであることをrunner sourceから確認するtestを1件追加した
- **変えていないもの**: formal guard・runner・登録条件・formal validity規則（git履歴が読めない場合は引き続きformal runを拒否する）。skip・assertion削除・mock置換・
  CIの `fetch-depth` 変更は行っていない
- **確認**: `git clone --depth 1` のshallow clone（登録commitなし、node_modulesはjunction）で、修正前のtestが同じ箇所（160行）で失敗し、修正後のtestがD-1C / D-1B / D-1A / D-0C
  関連の8 file・76 testとともに通ることを確認した。完全な履歴のcheckoutでも全testが通る

### 0.2 正式計測1と2の比較

| 値 | 正式計測1（`636616d`） | 正式計測2（`68a1ac8`） |
| --- | --- | --- |
| formalValidity / 候補outcome / acceptance | valid / verified / accepted | 同じ |
| verification semantic SHA-256（4 process） | `0a56da0f…33dd4` | 同じ |
| materialization semantic SHA-256 / Entry fingerprint | `6f790d33…cb18f` / `fnv1a32:ed959cc4` | 同じ |
| Plan hash / Step semantic hash / 実行位置hash | `903e4274` / `8d28811e` / `3cf477e7` | 同じ |
| 物理操作数 / Plan steps / objective | 1,766 / 1,766 / 1,766 | 同じ |
| 計算コード監査 | 許可12件、許可外0、Production 0 | 同じ（同じ12件。2つのHEADの差はtest file 1件とdocsだけ） |
| benchmark code SHA-256 | `f8e89554…a3cd` | `7dfc5701…cbe2`（test fileの変更による） |
| Entry集合fileのSHA-256 | `358182a3…229993` | `dfb99aa5…3ca8a1`（fileに書込み時のHEADを含むため。Entry fingerprintは同じ） |
| 親の合計wall | 91.4 s | 93.8 s |

公開RESULTで比較した `formalValidity`・`candidateOutcome`・`acceptance`・`determinism`・`plannerIntegration`・`postHoc`・`integrityIssues` はすべて同一だった。

本書は [Global Assignment設計](PLANNER_GLOBAL_ASSIGNMENT_DESIGN.md)（以下「設計」）§14 の **D-1C** を記録する。D-1B（[記録](PLANNER_GLOBAL_ASSIGNMENT_RESEARCH_D1B.md) §8〜§16）で
事前登録した条件を変えずに、formal guard・RESULT導出を実装し、登録HEADからの計算コード差分監査の下で、Production Planner統合acceptanceを正式計測した。
Phase Eの最適化・Production化には進まない。

## 1. 目的

| やること | やらないこと |
| --- | --- |
| D-1Bの登録条件だけで動くformal runner（親のstart gate、子processの独立gate）、formal validity・候補outcome・acceptanceの判定、公開RESULT導出（§4） | 登録条件（window・option集合・規則・候補数・verification budget・maxPlanSteps・envelope・repeat・同一性の取得元・計算コード監査・formal validity規則）の変更 |
| 登録HEADからの計算コード差分監査の下での正式計測（2 complete runs、§6〜§8） | Production RNG / Search / Planner / Trace Replay、`verify.ts`、`verificationProtocol.ts`、materialization、D-0Cの登録・RESULT、D-0Bのchild process envelopeの変更 |
| formal validityと候補outcomeを分けた記録、incumbentとのpost-hoc比較、`best_found` / `proven_minimum` の区別（§9〜§13） | 2件目以降のstructural candidate、W0以外のwindow、Phase Eの最適化、Production化 |

## 2. 仕様authority

正式仕様の順位は `AGENTS.md` のとおり `docs/REQUIREMENTS.md` → `docs/PLANNER_SPEC.md` / `docs/SEARCH_SPEC.md` → その他の正式仕様 → 最新mainの実装 → test → 過去の記録。
本書はResearch記録であり、正式仕様でもDomain仕様でもない。

| 根拠 | 内容 |
| --- | --- |
| 設計 §4.3 / §4.6 / §10.2 | `verified` / `best_found` / `proven_minimum` の意味、root下界の適用条件 |
| 設計 §9.5 / §9.6 / §9.15 | Phase D'の成立条件（D-1Bの条件11 = 3つの完全一致）、outcome分類、D-1Bの確定事項 |
| 設計 §11 / §12 / §13.2 / §14 / §16 | oracle isolation、決定性、統合acceptance、Phase分割、Production契約との境界 |
| [D-1B記録](PLANNER_GLOBAL_ASSIGNMENT_RESEARCH_D1B.md) §8〜§16 | 事前登録条件、formal validity規則（provenance 15 / reproducibility 9 / candidate outcome 6）、計算コード監査方針、D-1Cへの引き継ぎ |
| [D-0C記録](PLANNER_GLOBAL_ASSIGNMENT_RESEARCH_D0C.md) / [D-1A記録](PLANNER_GLOBAL_ASSIGNMENT_RESEARCH_D1A.md) | formal guard・RESULT導出の先例、Phase D'の実装と非formal確認 |

正式仕様と実装の矛盾は見つからなかった。D-1Bの登録で解釈を要した点（`planner_conditions_evaluated_in_both_processes`）は §9.3 に書く。

## 3. 登録HEADと登録条件

### 3.1 登録HEAD

PR #254のmerge commit `d15ea9b0277b417b2681305486b6fb03dda57054` を40桁の定数 `PLANNER_VERIFICATION_D1C_REGISTRATION_HEAD`（`verificationFormal.ts`）として記録した
（D-0Cが `MATERIALIZATION_D0C_REGISTRATION_HEAD` を記録したのと同じ）。現在のmain HEADを読み替えていない（作業開始時のmainがこのcommitだった）。
formal gateは、それがmeasurement HEADの祖先であること（`git merge-base --is-ancestor`）と、そのcommitの D-1B記録の `registered-d1c-registration-fingerprint` が
measurement HEADの同じblockと一致することを確認する。

### 3.2 登録条件（変更なし）

`registeredD1cConditions()` の値をそのまま使った（D-1B §8）。

| 項目 | 登録値 |
| --- | --- |
| materialization | `MATERIALIZATION_D0C_PREREGISTRATION`（W0 = Normal 350 / Gogma 500 / Skill 1,500、option集合 `global-assignment-reach-options:a2`、規則 `d0a2-v2`、structural candidate 1件ほか） |
| verification budget | 1 |
| Research maxPlanSteps | 20,000 |
| first / fresh子process | 各1,800,000 ms、`--max-old-space-size=8192` |
| concurrency / 子processのretry | 1 / none |
| repeat | 2 complete runs（各run = first + fresh、正常時4子process） |
| Planner / Trace Replay | `createProductionPlanWithObserver` / `replayPlannerSearchTrace_independent` |
| fresh検証 | 別Node process必須 |
| integrity / oracle | issue 0必須 / oracle-free execution |
| CalculationContext | `unknown-initial` / Master 4 / `production-rng:c5-e7` / 計算版数 17 |
| protocol | verification `global-assignment-d1b:1`、materialization `global-assignment-d0a2b:1` |

### 3.3 登録の変更とfingerprint

`verificationRegistration.ts` で変えたのは `formalRun` だけ（`enabled: true`、`enabledBy: 'Phase D-1C'`。`startsIn: 'D-1C'` は不変）。
`d1cRegistrationFingerprint()`（`formalRun` を除く全項目の `hashStableValue`）は変更後も **`fnv1a32:2393847e`** で、measurement HEADと登録HEADのD-1B記録のblock
（`registered-d1c-registration-fingerprint: fnv1a32:2393847e`）と一致した（RESULT `registration.fingerprint`: computed / atMeasuredHead / atRegistrationHeadとも同値、matched true）。
登録の完全性検査 `plannerVerificationD1cRegistrationIssues()` と `d1cFormalRunIssues()` はどちらも `[]`。module headerのD-1B時点の説明文も変えていない。

## 4. formal基盤（実装）

| file | 内容 |
| --- | --- |
| `src/benchmarks/globalAssignment/verificationFormal.ts`（新規） | 登録HEAD定数、formal protocol `global-assignment-d1c-formal:1`、登録の観測（fingerprint・D-0C同一性・登録Exportをcommit済み文書から読む）、計算コード監査の読取り（許可14 file以外の変更・Production変更・gitが答えられない場合を分けて拒否）、CalculationContext / Engine / Masterの照合、親のstart gate（provenance 15規則のうち子process以外の14規則 + D-0C同一性の可読性・出力先）、formal task（唯一の構築関数）、子processのgate・計算gate・fresh用Entry集合の出所検査、run / RESULTのintegrity、formal validity（登録の24規則をそれぞれrecordから判定。実装した規則名が登録と一致しなければ例外でfail closed）、候補outcome、acceptance、post-hoc |
| `src/benchmarks/globalAssignment/verificationFormalResult.ts`（新規） | raw recordから観測を再構築し、結論全体（integrity・formal validity・候補outcome・acceptance）を再導出してrunnerの記録との一致を要求する公開RESULT導出、識別子の収集と最小化検査 |
| `scripts/run-planner-global-assignment-d1c.mjs`（新規） | formal専用runner（親と `--role first|fresh` の子）。D-1A runnerの実行処理（materialization、D-0C同一性照合、Entry集合、`verifyPlannerCandidate()`）を同じmoduleで再利用し、D-1A runnerは変更していない |
| `scripts/derive-planner-global-assignment-d1c-result.mjs`（新規） | 公開RESULTの導出（`--public`、排他作成）と照合（`--check`） |
| `src/benchmarks/globalAssignment/verificationRegistration.ts` | `formalRun` の有効化だけ |
| test | `verificationFormal.test.ts`（24 test）、`verificationFormalResult.test.ts`（5 test）、`verificationFormalTestFixture.ts`、`scripts/run-planner-global-assignment-d1c.test.ts`（6 test。PR #255 Required fixでgit履歴の状態に応じた検証へ変更、§0.1）、`scripts/derive-planner-global-assignment-d1c-result.test.ts`（3 test）、`isolation.test.ts`（D-1C module・scriptの隔離）、`verificationRegistration.test.ts`（formalRun有効化） |

変更fileはD-1Bの許可14 fileのうち12件（D-1A runnerとそのtestは変更しなかった）。

### 4.1 親のstart gate

子processを起動する前に、親の観測だけから1回で判定する（`d1cFormalStartGate()`）。不成立ならrun directoryもRESULTも作らず、子processも起動しない（scriptはstdoutに何も出さず
exit 1。testで確認）。判定するもの: 登録の完全性・有効化・fingerprint、CLI override（formal optionは `--mode` / `--export` / `--run-dir` / `--output` だけ。
`--allow-uncommitted`、`--first-wall-ms`、`--fresh-wall-ms`、`--heap-mb`、`--max-plan-steps`、`--repeat`、`--expected-d0c-semantic-sha256`、`--expected-d0c-entry-fingerprint`、
`--expected-export-sha256` などはすべてoverrideとして拒否。Export SHA-256やD-0C同一性をCLIで渡す経路は無い）、`--mode formal` 以外、clean committed HEAD、
登録HEADの祖先関係と計算コード監査、Production計算コード不変、登録Export（commit済みD-0B-2記録のblockと名前・bytes・SHA-256を照合）、
現行CalculationContext / Engine / Master、oracle input、登録D-0C同一性の可読性（measurement HEADと登録HEADのD-1B記録で同値）、出力先が新規かつgit-ignored。

### 4.2 子processの独立gate

各子processは計算前に、自分の観測で同じ条件を検査する（`d1cFormalChildGateIssues()`。手書きtaskをchild CLIへ直接渡しても回避できない）:
formal mode、formal protocol、role、run index / repeat、verification / materialization protocol、登録HEAD、自分で計算したregistration fingerprint、登録条件（materialization・
Planner・envelope）、task CalculationContext、自分のHEAD・clean・未commit計算コード・計算コード監査、自分で読んだ登録Export・実Exportのhash、自分で読んだ
D-0C同一性、自分の `execArgv` のheap envelope、task / record / journalが自分のrunのdirectory（`run-<k>`）にあること、firstはEntry集合を持たず、freshは登録fingerprintの
Entry集合を名指しすること、oracle input。入力を読んだ後、計算前に `d1cFormalChildCalculationIssues()`（CalculationContext・Engine・Master）。freshはさらに、
自分のrunのfirst recordを自分で読み、そのrecordが同じrun indexで同じEntry集合fileを書いたことを確認する（`d1cFreshEntrySetSourceIssues()`。他runのEntry集合の混入を拒否）。
子processは登録条件をtaskからではなく登録moduleから取り直してmaterializationとPhase D'に渡す（gateはtaskの条件が登録と一致することを確認済み）。

## 5. 計算コード差分監査

`git diff --name-only d15ea9b0..68a1ac86 -- <D-1A runnerのCODE_PATHS>`（正式計測1の `d15ea9b0..636616d6` も同じ12件）（`src`、`scripts`、`package.json`、`package-lock.json`、`vite.config.ts`、`vitest.config.ts`、
`tsconfig.json`、`tsconfig.app.json`、`tsconfig.node.json`）の結果は次の12件で、すべて登録済み許可fileだった（`outsideAllowed` 0件、`productionChanged` 0件、
祖先関係true、gitは回答した。親と4子processが同じ監査を独立に行った）。

```text
scripts/derive-planner-global-assignment-d1c-result.mjs
scripts/derive-planner-global-assignment-d1c-result.test.ts
scripts/run-planner-global-assignment-d1c.mjs
scripts/run-planner-global-assignment-d1c.test.ts
src/benchmarks/globalAssignment/isolation.test.ts
src/benchmarks/globalAssignment/verificationFormal.test.ts
src/benchmarks/globalAssignment/verificationFormal.ts
src/benchmarks/globalAssignment/verificationFormalResult.test.ts
src/benchmarks/globalAssignment/verificationFormalResult.ts
src/benchmarks/globalAssignment/verificationFormalTestFixture.ts
src/benchmarks/globalAssignment/verificationRegistration.test.ts
src/benchmarks/globalAssignment/verificationRegistration.ts
```

登録HEAD以降に別PRの変更は無い（作業開始時のmain = 登録HEAD）。shallow checkout（GitHub ActionsのCI等、登録HEADが履歴に無い）ではgitが答えられず、formal gateは
「変更なし」と読まずに拒否する（D-0Cの教訓。runner testは履歴の有無のどちらでも成立するよう、拒否理由を個別に確認する）。D-0Cのformal guardは引き続きD-1A以降の変更を拒否する
（D-0Cの登録HEAD・formal infrastructure一覧・正式RESULTは変更していない）。

## 6. 実行環境・Export・コマンド

| 項目 | 値 |
| --- | --- |
| 実行 | 正式計測2: 2026-10-13 14:02:51Z〜14:04:25Z（親の合計wall 93.8 s）。正式計測1: 13:29:14Z〜13:30:45Z（91.4 s） |
| machine / Node | AMD Ryzen 7 9700X（16 logical CPU）、物理memory 31.1 GiB（起動時free 11.3 GiB。正式計測1は11.7 GiB）、Windows 10.0.26200 x64、Node v24.19.0 / V8 13.6.233.17-node.51 |
| benchmark code SHA-256 | `7dfc57011bd094de15bc5abf8bb8733ee8e2c4ffdd5ae7e5c03c3a1fd06ecbe2`（現行measurement HEADのCODE_PATHSのtracked file。正式計測1は `f8e8955486a21cdcd49b97e952bf2d7adce3630d7fd9e64676418a01f264a3cd`） |
| Export | `gogma-artian-planner-backup_20260927015837.json`、19,424,064 bytes、SHA-256 `cc35fb5bd85acb417b2ce0229cd79441b48c642ac8af70bbc2dfdfc8c89e1e6b`。commit済みD-0B-2記録の `registered-export-*` block（`HEAD:docs/PLANNER_GLOBAL_ASSIGNMENT_RESEARCH_D0B2.md`）と名前・bytes・SHA-256が一致。Export本体はRepositoryに追加していない |
| CalculationContext | `unknown-initial` / Master 4 / `production-rng:c5-e7` / 計算版数 17（登録値と一致。親の現行authorityと4子processの入力で一致） |

正式計測2（現行measurement HEAD、出力先は正式計測1とは別名）:

```bash
node scripts/run-planner-global-assignment-d1c.mjs --mode formal --export "<local path>/gogma-artian-planner-backup_20260927015837.json" --run-dir .local/ga-d1c-formal-r2.run --output .local/ga-d1c-formal-r2.result.json
```

```bash
node scripts/derive-planner-global-assignment-d1c-result.mjs --result .local/ga-d1c-formal-r2.result.json --run-dir .local/ga-d1c-formal-r2.run --public docs/PLANNER_GLOBAL_ASSIGNMENT_D1C_RESULT.json
```

```bash
node scripts/derive-planner-global-assignment-d1c-result.mjs --result .local/ga-d1c-formal-r2.result.json --run-dir .local/ga-d1c-formal-r2.run --check docs/PLANNER_GLOBAL_ASSIGNMENT_D1C_RESULT.json
```

正式計測1（`636616d`）は同じコマンドで `.local/ga-d1c-formal-r1.*` へ出力し、その公開RESULTは `PLANNER_GLOBAL_ASSIGNMENT_D1C_RESULT_RUN1.json` に改名した
（`--result .local/ga-d1c-formal-r1.result.json --run-dir .local/ga-d1c-formal-r1.run --check docs/PLANNER_GLOBAL_ASSIGNMENT_D1C_RESULT_RUN1.json` はissue 0）。
正式計測は各measurement HEADで1回ずつ実行した（どちらもexit 0）。失敗・中断はなく、結果を見て条件を変えた再実行はない（正式計測2はtest修正によるHEADの置き換え、§0）。

### 6.1 正式計測前の機構確認（非formal、証拠ではない）

measurement commitの前に、子processのコード経路（materialization・Phase D'・record・結論・公開RESULT導出）が実Exportで動くことを1回だけ確認した。
runnerのコピーを git-ignored な `.local/d1c-dev/run-d1c-dev-precheck.mjs` に置き、clean / 未commit判定だけを `true` / `false` に固定した改変版で、未commitの
Working Tree（HEAD `d15ea9b`）上で実行した（2026-10-13 13:23:51Z〜13:25:23Z、条件・Exportは登録どおり）。結論は同じ（valid / verified / accepted、1,766）だったが、
改変したrunner・未commitのコードでの実行であり、**formal measurementではなく、本書のどの判定の根拠にもしていない**。そのrecordはclean = trueと記録しているが、それは改変による
ものである。raw recordは `.local/d1c-dev/precheck.*` に残してある（公開しない）。この確認の後にコード・条件・Exportを変えて計測をやり直したことはない
（確認の後のcommitは §4のコードそのもので、正式計測1はその1回だけ。正式計測2はRequired fixのtest修正によるもので、§0のとおり）。

## 7. formal validity

**`valid`**（issue 0件）。登録24規則のそれぞれを、親のstart provenance・4子processのrecordとformal block・親のprocess entry・integrity issueから判定した（名前を列挙して真とする実装ではない）。

### 7.1 Provenance（15規則、すべて成立）

| 規則 | 根拠になった観測 |
| --- | --- |
| `registration_complete` | 親と4子processが観測した `plannerVerificationD1cRegistrationIssues()` がすべて `[]` |
| `formal_run_enabled` | 親と4子processで `formalRun.enabled = true` |
| `registration_fingerprint_equals_registered_block` | 親と4子processで computed = measurement HEADのblock = 登録HEADのblock = `fnv1a32:2393847e` |
| `run_conditions_equal_registration` | 各runのmaterialization semantic recordの条件 = D-0C登録条件、first / fresh両方のResearch maxPlanSteps 20,000、first / fresh wall 1,800,000 ms、heap 8,192 MB（親のprocess entry・子の `execArgv` の両方）、同時実行1（process区間が重ならない）、子processのretry none、verification budget 1（first recordの適用値）・検証候補数1 |
| `no_command_line_override` | 親のflagは `--mode` / `--export` / `--run-dir` / `--output` だけ、mode formal |
| `clean_committed_head` | 親: HEAD `68a1ac8…`（正式計測1は `636616d…`）・clean・未commitなし・benchmark code SHA-256記録。4子processが同じHEADのcleanを観測。各runの前後でcheckout不変 |
| `registration_head_is_ancestor` | 親と4子processの監査で祖先関係true |
| `calculation_code_audit_passed` | 親と4子processの監査で許可file以外の変更0件（§5） |
| `production_calculation_unchanged` | 親と4子processの監査でProduction変更0件 |
| `export_identity_matched` | 親: 実Exportが登録identityと一致。4子processのrecordのExportと登録identityが親と同じ |
| `calculation_context_matched` | 親の現行authority、4子processの入力CalculationContextと計算gateが登録値 |
| `rng_engine_version_matched` | 親と4子processで `production-rng:c5-e7` |
| `master_data_version_matched` | 親と4子processでMaster data version 4 |
| `oracle_not_read` | 親のoracle-free execution、親と4子processの読込み一覧（Export、commit済みのD-1B / D-0B-2記録、task、freshのEntry集合と同runのfirst record）にoracle / 下界 / RESULTなし |
| `child_gates_passed` | 4子processのrecordで、formal gate・計算gate（freshはEntry集合の出所検査も）のissueが0件 |

### 7.2 Reproducibility（9規則、すべて成立）

| 規則 | 観測 |
| --- | --- |
| `two_complete_runs` | 2 run、各runでfirst / freshとも `completed`、verification recordあり |
| `first_and_fresh_separate_processes` | 4子processのpidはすべて異なり親のpidとも異なる。各recordのpidが親の起動した子processのpidと一致 |
| `planner_conditions_evaluated_in_both_processes` | 4 processとも13条件すべてを評価・記録し、outcomeは `conditions_met`（§9.3の解釈） |
| `first_fresh_verification_semantic_equal` | 各runでfirst / freshのverification semantic SHA-256が一致、cross process identical |
| `runs_verification_semantic_equal` | 4 processのverification semantic SHA-256がすべて `0a56da0f24206f1fcde76246b5ad47a6101d7a5fc9517f24c2bcdbc894833dd4` |
| `materialization_semantic_equals_registered_d0c` | 両runのmaterialization semantic SHA-256（親が再hash）が登録値 `6f790d33…cb18f` と一致 |
| `entry_fingerprint_equals_registered_d0c` | 両runでsemantic recordから・受け取ったEntry本体から・Entry集合・freshのEntry集合のfingerprintがすべて `fnv1a32:ed959cc4` |
| `run_integrity_issues_zero` | run 1 / run 2ともintegrity issue 0件 |
| `result_integrity_issues_zero` | RESULTのintegrity issue 0件（start record一致、process区間の非重複、pidの重複なし、run間のcheckout不変） |

### 7.3 公開RESULTとraw recordの整合

導出scriptはraw RESULTと16個のraw fileからreadingを作り直し、結論全体を再導出してrunnerの記録と比較した。`derivation.consistency` は
`startRecordMatchesRaw` / `readingsMatchRaw` / `semanticSha256MatchesRecords` / `conclusionMatchesRecords` がすべて true。`--check` はissue 0件（exit 0）。
最小化検査（Target / OwnedWeapon / Entry / Candidate / Conflict / Counterの識別子、UUID、local path、per-Target配列、禁止key）もissue 0件。

## 8. 2 complete runの結果

| run | process | outcome | 親の観測wall（正式計測2 / 1） | 主な結果 |
| --- | --- | --- | ---: | --- |
| 1 | first | completed | 38.9 s / 38.2 s | D-0C同一性一致、43 Entry、Phase D' `conditions_met` |
| 1 | fresh | completed | 7.8 s / 7.7 s | 自身のPhase 0（planning Target 43）、Entry集合の出所・fingerprint一致、Phase D' `conditions_met` |
| 2 | first | completed | 38.7 s / 37.5 s | run 1と同じ（Run 1のEntry集合を使わず、materializationから再計算） |
| 2 | fresh | completed | 7.9 s / 7.7 s | run 1と同じ（run 2のEntry集合だけを読んだ） |

timeout / OOM / cancel / process failureは0件。各runの判定（D-1Aの `concludeD1aRun()`）は両runとも `verified`（physicalOperations 1,766、planSteps 1,766、objective 1,766、
planning Target 43、full Planner run first 1 / fresh 1）、cross process identical、integrity issue 0、exit 0。

### 8.1 first / freshの一致と2 run間の決定性

| 値 | run 1 first | run 1 fresh | run 2 first | run 2 fresh |
| --- | --- | --- | --- | --- |
| verification semantic SHA-256 | `0a56da0f…33dd4` | 同じ | 同じ | 同じ |
| materialization semantic SHA-256 | `6f790d33…cb18f` | — | 同じ | — |
| Entry fingerprint | `fnv1a32:ed959cc4` | 同じ | 同じ | 同じ |
| Plan hash / Step semantic hash | `fnv1a32:903e4274` / `fnv1a32:8d28811e` | 同じ | 同じ | 同じ |
| 実行位置hash（`executedHash`） | `fnv1a32:3cf477e7` | 同じ | 同じ | 同じ |

verification semantic SHA-256はD-1Bの非formal再確認（`120be4c`、D-1A runner）と同じ値、Plan hash・Step semantic hashはD-1A / D-1Bと同じ値だった。
Entry集合file（`first.entry-set.json`）は両runで同一bytes（768,648 bytes、SHA-256 `dfb99aa5…3ca8a1`。正式計測1は `358182a3…229993`。fileが書込み時のHEADを含むため異なり、Entry fingerprintは同じ）。

### 8.2 materialization同一性

両runとも、D-0Cの登録条件で再実行したmaterializationが確定した後、Phase D'の前に、commit済みのD-1B記録（measurement HEAD。登録HEADのblockと同値）から読んだ
D-0C同一性（`registered-d0c-materialization-semantic-sha256: 6f790d33…cb18f`、`registered-d0c-entry-fingerprint: fnv1a32:ed959cc4`）と照合し、semantic SHA-256・
semantic recordのEntry fingerprint・受け取ったEntry本体のfingerprintの3つが一致した（handoff 1 / 候補1、semantic integrity issue 0）。最初のstructural candidate
（objective 1,766）の43 / 43 Targetが `materialized`（射影起点21、形状制約22。gate / budget / unsupported / fail closed 0件）。D-0Cの過去のEntry本体・raw recordは読んでいない。

## 9. 候補outcomeとacceptance

### 9.1 候補outcome

**`verified`**（両runの判定が同一、`consistentAcrossRuns = true`）。formal validityとは別に、D-1Aの判定（`judgeD1aRun()` / `concludeD1aRun()`、意味論は変更なし）で求めた。
候補outcomeの優先順位は、runのintegrity不成立 → `invalid_run_integrity`、子processの停止または登録数より少ないrun → `unmeasured`、run間の不一致 → `inconsistent_across_runs`、
それ以外は両runの共通判定（`deriveD1cCandidateOutcome()`）。

各runの記録用分類（RESULT `runs[].conclusion.recordClassification`）は再利用したD-1A関数の分類文字列 `nonformal_planner_verified` のままである。これはrun単体のD-1A判定の
labelであり、D-1Cの正式な判定は `formalValidity` と `acceptance` が担う（計測後にコードを変えないため、labelは書き換えていない）。

### 9.2 正式acceptance

**`accepted`**（`formalValidity = valid` かつ候補outcome `verified`）。片方だけでは合格にしない（syntheticで確認: valid + `planner_rejected` は `not_accepted`、
invalid + `verified` も `not_accepted`）。

### 9.3 `planner_conditions_evaluated_in_both_processes` の解釈

D-1B §12.2 / §15のとおり「両processがPhase D'を完了し、全条件を評価・記録したこと」と解釈し、条件が真であることは要求しない。実装（`d1cPlannerConditionsEvaluated()`）は、
verification semantic recordが登録protocolで、13条件のkeyがすべてbooleanまたはnullで記録され、outcomeが計測済み（`unmeasured` 以外）であり、nullは設計 §9.5の先行条件が
outcomeを決めた場合（handoff / planning Target集合の段階で止まりPlannerを走らせない → 全条件null、Planが無い → 物理恒等式3つだけnull）に限ることを要求する。
`conditions_met` なら13条件すべてtrue。本計測では4 processとも13条件すべてtrueだった。

## 10. Production Planner成立条件・Trace Replay

4 processとも同じ値（RESULT `plannerIntegration`、`runs[].first|fresh.verification`）。

| 条件 | 値 |
| --- | --- |
| termination | `completed`、reachedLimits なし、maxPlanSteps 20,000、expandedStates 1,809 |
| planning Target / completed / total | 43 / 43 / 43（Phase 0とfinal inputのplanning Target集合が一致） |
| selected Entry | 43 / 43（期待集合と一致）。final inputは43件すべて置換、元Entryの残り0、source data不変、conflict resolution 0 |
| Conflict / rejected / resource_conflict / warnings | 0 / 0 / 0 / 0 |
| full Planner run | first 1 / fresh 1（両run） |
| 独立Trace Replay | valid、issue 0、draft 1,809（physical 1,766、reserve 43）、Plan物理Stepとの対応 1,766 / 1,766で不一致0、Counter位置不一致0、最終Counterが一致 |

## 11. 物理操作数

| 値 | 結果 |
| --- | --- |
| Plan steps | 1,766 |
| 非物理Step（`confirm_owned_ideal`） | 0（予期しない非物理Step 0） |
| 物理操作数 | **1,766** |
| Σ stream前進 | 1,766（前進したstream 6、structural candidateのstream別前進と9 / 9 stream一致） |
| structural objective | 1,766 |
| 恒等式 | (11a) 1,766 = 1,766 − 0、(11b) 1,766 = 1,766、(12) 1,766 = 1,766 |
| 共有物理Step | 0 |
| operation別 | `create_normal_artian` 235、`convert_normal_to_gogma` 5、`reset_skills` 1,078、`reset_bonuses` 77、`keep_bonuses` 371 |

物理操作数を1,766へ合わせる補正は行っていない（`summarizePlanPhysical()` の値をそのまま使う）。D-1Aの1,766は期待値・成功条件として扱っていない。

## 12. runtime / memory

| 値 | run 1 first | run 1 fresh | run 2 first | run 2 fresh |
| --- | ---: | ---: | ---: | ---: |
| 親の観測wall / child wall（record） | 38.9 s / 38.7 s | 7.8 s / 7.6 s | 38.7 s / 38.5 s | 7.9 s / 7.7 s |
| setup | 0.92 s | 0.90 s | 0.90 s | 0.91 s |
| materialization（context / ReachTable / structural search / 合計） | 1.73 / 11.33 / 17.72 / 32.64 s | — | 1.69 / 11.22 / 17.63 / 32.39 s | — |
| Phase D'（final input / Planner / Trace Replay / 物理 / 合計） | 0.30 / 4.22 / 0.40 / 0.003 / 4.98 s | 0.31 / 4.22 / 0.40 / 0.003 / 5.00 s | 0.31 / 4.29 / 0.40 / 0.003 / 5.06 s | 0.31 / 4.24 / 0.44 / 0.003 / 5.07 s |
| heapUsed最大（250 ms標本） | 1.37 GB | 0.65 GB | 1.42 GB | 0.65 GB |
| maxRSS | 1,559,768 KiB | 874,068 KiB | 1,614,232 KiB | 871,212 KiB |

（正式計測2の値。正式計測1: 親の観測wall 38.2 / 7.7 / 37.5 / 7.7 s、materialization 32.00 / 31.39 s、Phase D' 4.89 / 4.90 / 4.90 / 4.88 s、heapUsed最大 1.42 / 0.65 / 1.41 / 0.69 GB、
maxRSS 1,614,792 / 871,944 / 1,599,088 / 907,184 KiB、親の合計91.4 s。詳細は `PLANNER_GLOBAL_ASSIGNMENT_D1C_RESULT_RUN1.json`）

親の合計wall 93.8 s。各子processは登録envelope（30分 / 8,192 MB、heap上限 8.79 GB）の数%以内で終わった。時間・memoryは観測値であり、操作数の評価とは別の指標である
（設計 §13.2）。観測値から30分・8,192 MBまでの区間は実行していない。

## 13. incumbent比較と最小性（post-hoc）

### 13.1 incumbent 8,534との比較

正式acceptanceが成立したので比較した（設計 §13.2 2）: 物理操作数 **1,766 < 8,534 → 操作数改善**（差 6,768、incumbentの20.7%）。RESULTの
`postHoc.operationCount` は `evaluated: true`、`judgement: improvement`、`proof: not_claimed`。

### 13.2 `best_found` と `proven_minimum`

RESULTの判定は **`best_found`**（`provenMinimum: false`）。verification budget 1で検証した1件の候補そのものであり、後続候補については何も言わない
（2件目以降は `not_attempted(verification_budget)` であり「存在しない」ではない）。runnerと導出は下界を読まず、比較もしない。

post-hoc（本書だけで行い、runnerへ戻さない）: B-2Bの正式記録（[B-2B記録](PLANNER_GLOBAL_ASSIGNMENT_RESEARCH_B2B.md)）のroot下界は `found` 1,657（cross satisfaction可能ペア0件、
planning Target 43 = 下限moduleの対象集合で適用可能）である。検証済み物理操作数1,766は1,657と一致しないので、設計 §4.6 / §10.2の `proven_minimum` は成立しない（差109）。
1,657は下界であって、1,657操作のPlanがProductionで成立することを示すものではない。1,657 oracleは実行入力に使っていない（設計 §11.2のとおり設計自体はoracle-informed）。

## 14. raw recordのhash

raw record（`.local/`、git-ignored。Target ID・Entry本体・Plan全Stepを含むので公開しない。排他作成で、既存のD-0C / D-1A / D-1Bのraw record、
および正式計測1のraw recordは上書きしていない）。

### 14.1 正式計測2（現行、`68a1ac8`）

| file | bytes | SHA-256 |
| --- | ---: | --- |
| `ga-d1c-formal-r2.result.json`（親のraw RESULT） | 19,117 | `366b26db4b99a00c320605b4e09ed9f75a2c14ac548692e9528df724e5864744` |
| `ga-d1c-formal-r2.run/start.json` | 7,294 | `53633e327212bf0bd52b6da58141e8bab3575fb48c0ce5dfddc7616d925981de` |
| `ga-d1c-formal-r2.run/run-1/first.task.json` | 2,689 | `1519f5f0524626fe8cfe6b3bfd902fd7434ada7c3e7374d4d7c5b914d6dd7361` |
| `ga-d1c-formal-r2.run/run-1/first.record.json` | 650,529 | `f3e888d6eb227a6ab317a311423d0e6fd5d91ccefb49a34b1ca19b7cf9313332` |
| `ga-d1c-formal-r2.run/run-1/first.journal.jsonl` | 22,526 | `ace169da2cc56b1d50ec71c9d0a71d58f0c52bd703eb27f1153fe186f22f5d48` |
| `ga-d1c-formal-r2.run/run-1/first.entry-set.json` | 768,648 | `dfb99aa577298e04dfddab03a1a0abde5b777b7650fb084ff0e02c26743ca8a1` |
| `ga-d1c-formal-r2.run/run-1/fresh.task.json` | 2,895 | `e42302e5da1ef3a5a06ceaefd404e1c69d0da4ed59d40724a888d3289236ebb7` |
| `ga-d1c-formal-r2.run/run-1/fresh.record.json` | 35,555 | `99c2fbf55bd417418f26e4d1c76d60d3bc70916a803b3c078bbdfc727a2b6e52` |
| `ga-d1c-formal-r2.run/run-1/fresh.journal.jsonl` | 1,228 | `d29253eab99ada4025dcafdbbef6979407278a4b0923040517a243c12f4f08f7` |
| `ga-d1c-formal-r2.run/run-2/first.task.json` | 2,689 | `7525eb29fb45d47c2f2e9896e16973d6917211126745d8ac52af61d1b51f5dc0` |
| `ga-d1c-formal-r2.run/run-2/first.record.json` | 650,549 | `a38f7a8b5869225a60edfa782d457f6b0b1be1c8542bad9fc4805e3176dc76cd` |
| `ga-d1c-formal-r2.run/run-2/first.journal.jsonl` | 22,361 | `a935425076e84043f609efd5900d26beecbd95f359da2095f61182572fd7fe5c` |
| `ga-d1c-formal-r2.run/run-2/first.entry-set.json` | 768,648 | `dfb99aa577298e04dfddab03a1a0abde5b777b7650fb084ff0e02c26743ca8a1` |
| `ga-d1c-formal-r2.run/run-2/fresh.task.json` | 2,895 | `158a4da4c2231f293861ba9ff2c3434d39a134c16af6dddcbebced8ac3323afb` |
| `ga-d1c-formal-r2.run/run-2/fresh.record.json` | 35,565 | `30903aa22e5cf5b0bbfc2fe2b1e18b25df78dc13c9d28e6d80d09a941350cf1c` |
| `ga-d1c-formal-r2.run/run-2/fresh.journal.jsonl` | 1,228 | `530f1264d5bb0ff2d1a964f4984c42da3cdfdf00438c9080afac10e2aa079813` |
| `ga-d1c-formal-r2.stdout.log`（親のstdout） | 984 | `e785a534f1a6e281cdbaba52d1f0e5436a05b8abbd9c9c3bfd057de908b6fa9d` |

親のstderrは空（0 bytes）。公開RESULT（`PLANNER_GLOBAL_ASSIGNMENT_D1C_RESULT.json`）の `derivation.sources` は親のstdoutを除く上の16 fileを同じbytes・SHA-256で列挙する（導出scriptが照合する）。

### 14.2 正式計測1（置き換え済み、`636616d`。正式計測2の後に再確認したSHA-256も同じ）

| file | bytes | SHA-256 |
| --- | ---: | --- |
| `ga-d1c-formal-r1.result.json`（親のraw RESULT） | 19,101 | `481769286646ef68fc330f0f917473c93d1d218587b7d174a307bd0755b48682` |
| `ga-d1c-formal-r1.run/start.json` | 7,295 | `3512b6a80b74b562e88d5e30883ef3dc906aa56c1350eaa5ef3000413f2e8e2f` |
| `ga-d1c-formal-r1.run/run-1/first.task.json` | 2,689 | `2f2095df97454a65f1c85b29010b1d9fa1a6c32589b1cf813fa6e6137b5e3d00` |
| `ga-d1c-formal-r1.run/run-1/first.record.json` | 650,570 | `f814690927d71d35d4083b91273b61d795d684310688c101d3c1cdec59a5638d` |
| `ga-d1c-formal-r1.run/run-1/first.journal.jsonl` | 22,483 | `212d4511542f9660e01ace8171d5aa931a40e1b65ae4022f29e47918f8381768` |
| `ga-d1c-formal-r1.run/run-1/first.entry-set.json` | 768,648 | `358182a3da0491bb295487fe7ac308f7da36ee57dbe4dc3342ea48a596229993` |
| `ga-d1c-formal-r1.run/run-1/fresh.task.json` | 2,895 | `07adc4a3efa04bc564708915db45c14657dc2d661f1b7005f543f5fb3e3a5c75` |
| `ga-d1c-formal-r1.run/run-1/fresh.record.json` | 35,599 | `c411d2b3ca739d08497972f30cb763afa84b8d025a9157d85fc98ad178424d87` |
| `ga-d1c-formal-r1.run/run-1/fresh.journal.jsonl` | 1,237 | `314f1ba923b83f3cb19b28964efb74b52edc26375a06a25de57018df3e3b31f6` |
| `ga-d1c-formal-r1.run/run-2/first.task.json` | 2,689 | `5c14e252491877b15a90665a78361b50dd44f310452620fd7ead3252a809a5a6` |
| `ga-d1c-formal-r1.run/run-2/first.record.json` | 650,559 | `49ef09562ef41f05cca734f392aa6d61ae601d21362ec2538e0456819d591907` |
| `ga-d1c-formal-r1.run/run-2/first.journal.jsonl` | 22,320 | `7f823fb3110e4d71e949d218a44cbb13ec905c0978aa86313a74b522f57c4c8c` |
| `ga-d1c-formal-r1.run/run-2/first.entry-set.json` | 768,648 | `358182a3da0491bb295487fe7ac308f7da36ee57dbe4dc3342ea48a596229993` |
| `ga-d1c-formal-r1.run/run-2/fresh.task.json` | 2,895 | `e3275a12523f98f3b868525230b3e9afec315bd4565593673c03f402db60558c` |
| `ga-d1c-formal-r1.run/run-2/fresh.record.json` | 35,562 | `34706a80888985ff2335ebf616f9320c8d703289c126212906b4580dddb3cf8c` |
| `ga-d1c-formal-r1.run/run-2/fresh.journal.jsonl` | 1,218 | `e491543fda46f2fb2176871f6d58d74ecbff714b21ed02e073d0e7753d6d7962` |
| `ga-d1c-formal-r1.stdout.log`（親のstdout） | 984 | `aee4cddede5a9e25659955b52ffe0b733a5600831ef089856674e5f1b5790a19` |

親のstderrは空（0 bytes）。公開RESULT `PLANNER_GLOBAL_ASSIGNMENT_D1C_RESULT_RUN1.json`（内容は初版から不変）の `derivation.sources` は親のstdoutを除く上の16 fileを列挙する。

## 15. 未確認事項

- **2件目以降のstructural candidate**: verification budget 1なので未検証（materializeもしていない）。それらにより少ない物理操作数の候補があるかは未確認
- **W0以外のwindow、別のoption集合・規則・Export**: 未確認
- **他のmachine / Node version / Browser Workerでの決定性**: 未確認（同一machine・同一Nodeで2 run・4 processが一致した）
- **非物理Step・Production runtime-unsupported retryを含む実Exportの候補**: この候補は非物理Step 0、retryなし。改訂規則のその部分はsyntheticでのみ確認
- **envelopeの観測値より上の区間**: 30分・8,192 MBまでは実行していない
- **`proven_minimum`**: 成立しない（§13.2）。下界1,657と1,766の差109を埋めるPlanの存在・非存在はどちらも示していない
- **CIでのformal gate**: GitHub Actionsのshallow checkoutには登録HEADが無いので、formal gateは常にfail closedになる（意図どおり）。testはguardと同じgitコマンドで
  履歴の状態を個別に調べ、完全な履歴とshallow checkoutの両方で拒否理由を確認する（§0.1）。登録commitはあるが文書だけ読めない、祖先関係だけ確認できない、といった
  中間の状態は、testの分岐としては扱っているが、実際の環境では作っていない

## 16. Phase Eへの引き継ぎ

1. 基準: 正式acceptance済みの最初のstructural candidate（物理操作数1,766、`best_found`）。Phase Eの改善は、全planning Target完成を維持したまま1,766未満（incumbent 8,534に対しては
   既に改善）を示すこと。時間・memoryは別指標
2. 2件目以降のstructural candidateの検証にはverification budgetの変更が要り、新しい事前登録が要る（D-1Cの登録値は変えない）
3. root下界1,657との差109の扱い（incremental coverage pruning、決定的discrepancy探索、window拡大）は設計 §14のPhase Eの範囲
4. D-1Cのformal runnerはD-1Bの登録だけを読む。条件を変える計測は新しい登録・新しい登録HEAD・新しいformal infrastructure一覧を要する
5. run単体の分類label（`nonformal_planner_verified`）は再利用したD-1A関数のものである（§9.1）。正式な判定は `formalValidity` と `acceptance`。labelを変える場合はformal基盤の変更として監査する
6. Production化は設計 §16の別PRで扱う（本PhaseはProductionを変更していない）
