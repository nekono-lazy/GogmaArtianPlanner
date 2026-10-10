# Issue #142 テスト実行時間の調査記録（Phase 1）

> この文書は調査・計測の記録であり、正式仕様のauthorityではない。
> 仕様権威は `AGENTS.md` の Specification Authority に従う。

## 1. 目的

Issue #142「ローカル / PR CIのテスト実行時間を短縮する」のPhase 1として、

- 現状のCI / ローカルのテスト構成と所要時間を計測し、
- ボトルネックを分類し、
- 検証品質を下げない低リスクな改善を1件実施し、その効果を測る。

テストの削除・skip・assertion緩和・timeout短縮・retry追加による「高速化」は行わない。

## 2. 現状の構成（変更前、`origin/main` `ed21391`）

| 項目 | 内容 |
| --- | --- |
| `npm test` | `vitest run`（Vitest 4.1.11） |
| environment | 全ファイル `jsdom` |
| setup | `src/test/setup.ts`：`@testing-library/jest-dom/vitest`、`fake-indexeddb/auto`、`@testing-library/react` の `cleanup`、`window.matchMedia` stub |
| pool / isolate | Vitest既定（`forks`、`isolate: true`、ファイルごとに環境を作成） |
| worker数 | Vitest既定。`vitest run` は `availableParallelism() - 1`（`node_modules/vitest/dist/chunks/cli-api.*.js` `getDefaultThreadsCount()`）。GitHub `ubuntu-latest`（公開repo、4 vCPU）では3 worker |
| CI | `.github/workflows/ci.yml`：単一job で `npm ci` → lint → NUL check → test → build を逐次実行 |
| テストファイル | 359（`src` 357 + `scripts` 2）。`.test.ts` 301 / `.test.tsx` 58。うち `src/domain/**/*.test.ts` 146 |
| テスト数 | 5999（5996 passed / 3 skipped。skip は `src/research/issue74/normalSeedIdentificationMeasurement.test.ts` の `describe.skipIf`） |

## 3. 変更前の計測結果

### 3.1 GitHub Actions（既存ログから取得、追加実行なし）

測定元はすべて `pull_request` イベントのCI（workflow `CI`、job `Lint / Test / Build`、runner image `ubuntu-24.04` `20261004.327.1`）。
時刻はGitHub Actionsのstep開始・終了時刻。Vitest内訳はVitest summaryの値（`transform` 以降は全workerの合計時間であり、wall-clockではない）。

| PR | head SHA | run ID | job全体 | install | lint | test step | build | Vitest Duration | environment | setup | import | tests |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| #217 | `f130505` | 38024497333 | 8分18秒 | 4秒 | 25秒 | 7分22秒 | 20秒 | 440.83s | 233.31s | 42.57s | 134.86s | 847.53s |
| #216 | `58a41f0` | 38021945244 | 11分3秒 | 5秒 | 31秒 | 9分53秒 | 26秒 | 592.21s | 321.56s | 59.76s | 171.13s | 1142.10s |
| #215 | `c5d8c0c` | 38017645726 | 11分5秒 | 5秒 | 30秒 | 9分55秒 | 26秒 | 595.04s | 324.73s | 60.18s | 171.97s | 1142.79s |
| #214 | `6a08481` | 38014911960 | 11分12秒 | 7秒 | 31秒 | 9分58秒 | 26秒 | 597.54s | 323.47s | 61.17s | 172.71s | 1148.69s |
| #213 | `fd72933` | 38009209250 | 8分18秒 | 5秒 | 26秒 | 7分19秒 | 21秒 | 438.69s | 243.99s | 45.93s | 131.52s | 831.61s |

観察:

- CI時間の約89%がtest step。install・lint・buildは合計1分未満。
- 同じrunner imageでも、test時間が約440秒と約595秒の2群に分かれる。lint・build・Vitest内訳のすべての項目が同じ比率（約1.35倍）で遅いため、テスト内容ではなくrunnerホストの性能差と推定する（runnerのCPU型番はログに出ないため未確認）。**1回のCI比較で高速化を断定してはならない**。
- 全worker合計は 速い群 約1280秒 / 440秒 ≈ 2.9並列で、3 workerがほぼ埋まっている。末尾の1ファイルだけが走る待ち時間（tail）は小さい。
- テスト本体以外のオーバーヘッド（environment + setup + import + transform）は全worker合計の約34%。特に **jsdom環境の生成（environment）が233〜325秒** と、テスト本体以外で最大。
- 5回ともtimeout・retry・失敗はない。Issue登録時（PR #141：275ファイル / 4588件 / 485秒）から、ファイル数・テスト数は約1.3倍に増えている。

### 3.2 重いテストファイル（上記5 runの中央値、Vitestのファイル別時間）

| 順位 | ファイル | テスト数 | 中央値 | 分類 |
| ---: | --- | ---: | ---: | --- |
| 1 | `src/components/rng/IdentificationWizardDialog.test.tsx` | 58 | 120.8s | UI（MUI描画） |
| 2 | `src/benchmarks/plannerSchedulerParity.representative.test.ts` | 1 | 98.3s | Planner parity |
| 3 | `src/benchmarks/plannerSchedulerParity.conflicts.test.ts` | 4 | 69.5s | Planner parity |
| 4 | `src/benchmarks/plannerSchedulerParity.acceptance.test.ts` | 3 | 69.1s | Planner parity |
| 5 | `src/domain/planner/plannerSearchLimitRegression.test.ts` | 2 | 44.0s | Planner regression |
| 6 | `src/pages/OwnedWeaponsPage.test.tsx` | 36 | 34.7s | UI |
| 7 | `src/components/rng/NormalCounterIdentificationDialog.test.tsx` | 26 | 33.0s | UI |
| 8 | `src/domain/planner/plannerCounterFastForward.test.ts` | 16 | 32.0s | Planner |
| 9 | `src/pages/ProductionPlanPage.test.tsx` | 156 | 31.4s | UI |
| 10 | `src/pages/ExecutionNavigatorPage.test.tsx` | 68 | 27.8s | UI |
| 11 | `src/pages/SettingsPage.test.tsx` | 59 | 25.1s | UI |
| 12 | `src/pages/NormalCountersPage.test.tsx` | 19 | 24.7s | UI |
| 13 | `src/benchmarks/plannerSchedulerParity.test.ts` | 56 | 20.1s | Planner parity |
| 14 | `src/pages/BuildListPage.test.tsx` | 61 | 19.8s | UI |
| 15 | `src/benchmarks/plannerAlternativeBrowserBenchmark.test.ts` | 26 | 18.6s | benchmark harness |
| 16 | `src/benchmarks/plannerAlternativeBenchmarkInstrumentation.test.ts` | 7 | 16.5s | benchmark harness |
| 17 | `src/pages/TargetWeaponsPage.test.tsx` | 15 | 15.2s | UI |
| 18 | `src/domain/planner/plannerDeterministicScheduler.test.ts` | 99 | 14.4s | Planner |
| 19 | `src/benchmarks/issue101PlannerAlternativeRepair.test.ts` | 4 | 14.1s | Planner Alternative |
| 20 | `src/benchmarks/issue101PlannerAlternativeWhatIf.test.ts` | 3 | 13.3s | Planner Alternative |

ファイル別時間の合計（中央値、全worker合計）: 約1084秒。内訳は `.test.tsx` 58ファイルで約540秒、`src/benchmarks` で約387秒、`src/domain/planner` で約114秒。`src/domain` 146ファイル全体では約132秒。

## 4. 原因の分類

### A. テスト自体の処理が重い

- `plannerSchedulerParity.*`（4ファイル合計 約257秒）と `plannerSearchLimitRegression.test.ts`：Beam Search oracleとdeterministic schedulerを代表workloadで実際に走らせる計算量そのもの。`AGENTS.md` が「Beam / scheduler parity tests ... stay in CI」と定めており、正しさの検証として必要。今回は触らない。
- Planner Alternative / benchmark fixture系：実workloadの計算。同上。

### B. テスト実行環境のオーバーヘッド（今回の改善対象）

- jsdom環境はファイルごとに生成される。CIの集計で environment 233〜325秒（約0.65〜0.9秒/ファイル）。
- setup（jest-dom、React Testing Library = `react-dom` の読み込み、fake-indexeddb）が42〜61秒。
- **`src/domain` の146ファイルはテスト本体が合計約132秒しかないのに、全ファイル共通でjsdomとReact setupを払っていた**。ローカル計測（下記7.1）では、軽量なdomainテスト42ファイルで「テスト本体2.7秒に対しenvironment約20〜35秒、setup約4〜8秒」とオーバーヘッドが支配的だった。

### C. 並列実行・リソース

- CIは3 workerがほぼ飽和しており、worker数の問題ではなく総作業量の問題。
- runnerの性能差（約1.35倍）が計測ノイズとして大きい。
- ローカル（Ryzen 7 9700X、16論理CPU）の既定は15 worker。Research等の常駐プロセスと競合しやすい。今回はローカル計測を `--maxWorkers=2〜4` に制限した。

### D. flaky / timeout

- 確認した5 runではtimeout・retry・失敗はない。
- `IdentificationWizardDialog.test.tsx` は遅いが、既にMUI Selectを隠しnative input経由で設定する最適化（Popover/Portalを1枠ごとに開閉しない）が入っている。それでも、STEP 2の観測4件×5枠×(種別・ランク)＝40回の入力を行うテストが1件5〜7秒、入力をほとんど行わないテストでも0.5〜1秒かかる（CI #217のテスト別時間）。1回の入力ごとにダイアログ全体が再レンダリングされるコスト（1入力あたり約120〜150ms）が主因と推定する。Production UIの構造かテスト設計の変更が必要になるため、Phase 1では変更しない。

## 5. 検討した改善案

| 案 | 判断 | 理由 |
| --- | --- | --- |
| `src/domain/**/*.test.ts` をNode環境で実行 | **採用** | Architecture上React/DOM/IndexedDBに依存しない層で、効果が大きく、変更が設定2ファイルで済む |
| `.test.ts` 全体をNode環境へ | 不採用 | Services / Worker client / stores / benchmarksに `typeof Worker` / `navigator` / `localStorage` のfeature detectionや `navigator.userAgent` の記録がある。jsdomとNodeで分岐や記録値が変わり得るため、個別確認なしに移すと検証内容が黙って変わる |
| ファイル先頭の `// @vitest-environment node` 追記 | 不採用 | 146ファイルの機械的変更になり、新規domainテストで付け忘れる |
| `isolate: false` / `pool: 'threads'` / `vmThreads` | 不採用（Phase 1） | モジュール状態・グローバル（fake-indexeddb、Dexie singleton、`vi.mock`）の漏れでテスト間干渉が起き得る。安全性の検証コストが大きい |
| worker数の変更 | 不採用 | CIは既に飽和。ローカル既定の変更は環境依存 |
| parity / regression testの別job化・除外 | 不採用（Phase 1） | `AGENTS.md` がCI維持を定めている。job分割はPhase 2で wall-clock 短縮策として検討する |
| IdentificationWizardDialogの高速化 | 保留 | 4.D参照 |

## 6. 今回実装した変更

- `vitest.config.ts`：Vitest `projects` で2つに分割。
  - `node` project：`src/domain/**/*.test.ts`、`environment: 'node'`、setup は `src/test/setup.node.ts`
  - `jsdom` project：それ以外すべて（Vitest既定のinclude から上記を除外）、`environment: 'jsdom'`、setup は従来の `src/test/setup.ts`（無変更）
- `src/test/setup.node.ts`：`fake-indexeddb/auto` のみ。jsdom側と同じIndexedDB globalを維持し、DOM関連は入れない。

テストコード、Productionコード、CI workflow、timeout、retry、テスト対象範囲は変更していない。

### 6.1 Node環境へ移しても検証内容が変わらない根拠

- `src/domain` のProductionコードに `typeof window` / `document` / `navigator` / `Worker` 等のfeature detectionはない（`grep` で確認。該当は `src/app`、`src/services`、`src/components`、`src/workers`、`src/benchmarks` のみ）。
- domainテストにDOM API・Testing Library・jest-dom matcherの使用はない（`operationCountRecovery.test.ts` の `window` はRecovery Windowを表すローカル変数）。
- domainテストが読み込むServices（`createPlannerInput` 等）・`db/AppDatabase`（定数参照のみ）にもfeature detectionはない。
- 仮にDOM APIやjest-dom matcherに依存していれば、Node環境では「黙って別経路を通る」のではなく例外で失敗する。
- `vitest list` で、変更前後のテスト一覧（ファイル＋テスト名、5996件）が完全一致することを確認した。各ファイルはどちらか一方のprojectにだけ属する（node 146 / jsdom 213、重複0、欠落0）。

## 7. 検証結果

### 7.1 ローカル（Windows 11、Ryzen 7 9700X、Node v24.19.0。別作業のResearchプロセスが常駐していたため参考値）

| 対象 | 条件 | 変更前 | 変更後 |
| --- | --- | --- | --- |
| 軽量domain 42ファイル / 742件 | `--maxWorkers=2`、交互に2回 | 17.34s / 16.78s（environment 約19.6s、setup 約4.3s） | 5.40s / 5.57s（environment 0.002s、setup 約0.8s） |
| `src/domain` 146ファイル / 2461件 | `--maxWorkers=3`、各1回 | 59.01s（environment 72.54s、setup 15.96s、tests 56.11s） | 35.90s（environment 0.008s、setup 2.79s、tests 55.07s） |
| 全体 359ファイル | `--maxWorkers=4`、変更後のみ1回 | 未計測 | 320.12s、358 passed / 1 skipped、5996 passed / 3 skipped |

- `tests`（テスト本体）はほぼ同じで、短縮はenvironment / setupの削減による。テスト本体の計算量は変わっていない。
- ローカル全体の変更前計測は、Researchへの負荷を避けるため実施していない。

### 7.2 GitHub Actions（変更後）

PR #219（このPR）のCI。runner image は変更前と同じ `ubuntu-24.04` `20261004.327.1`。

| 回 | head SHA | run ID | job全体 | test step | Vitest Duration | environment | setup | import | tests | 結果 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `cead982` | 38031186053 | 8分47秒 | 7分42秒 | 461.10s | 159.49s | 33.33s | 155.40s | 973.18s | 358 passed / 1 skipped、5996 passed / 3 skipped |
| 2 | `1b649ef` | 38031785554 | 7分36秒 | 6分37秒 | 395.63s | 144.47s | 30.38s | 132.90s | 828.66s | 358 passed / 1 skipped、5996 passed / 3 skipped |

（2回目は文書追加のcommitで、テスト設定・テストコードは1回目と同一。）

#### 同じ速さのrunner同士の比較

変更後2回目は `tests`（テスト本体の全worker合計）が828.66秒で、変更前の速い群（#217 847.53秒、#213 831.61秒）と同等のrunnerだった。

| 指標 | 変更前（#217 / #213） | 変更後2回目 | 差 |
| --- | --- | --- | --- |
| job全体 | 8分18秒 / 8分18秒 | 7分36秒 | −42秒（約−8%） |
| test step | 7分22秒 / 7分19秒 | 6分37秒 | −42〜−45秒（約−10%） |
| Vitest Duration | 440.83s / 438.69s | 395.63s | −43〜−45秒（約−10%） |
| environment（合計） | 233.31s / 243.99s | 144.47s | −89〜−100秒 |
| setup（合計） | 42.57s / 45.93s | 30.38s | −12〜−16秒 |

#### runner差を除いた正規化比率

全worker合計の `tests`（今回の変更では計算量が変わらない）を基準にした比率。

| 指標 | 変更前5 run | 変更後1回目 | 変更後2回目 |
| --- | --- | --- | --- |
| `Duration / tests` | 0.519〜0.528（中央値0.520） | 0.474 | 0.477 |
| `(environment + setup) / tests` | 0.326〜0.349（中央値0.335） | 0.198 | 0.211 |

- 変更後1回目のrunnerは `tests` 973秒で、変更前の速い群（約840秒）と遅い群（約1145秒）の中間のため、wall-clockを直接比べていない。
- `Duration / tests` は変更前5 runで0.519〜0.528とほぼ一定、変更後2回とも0.474〜0.477。同じテスト本体量あたりのwall-clockは約8〜9%短い。
- **実測**：同等runner同士で Vitest Duration 約−44秒、test step 約−43秒。**推定**：遅いrunnerでは同じ比率で約−50秒前後。変更後のサンプルは2回のみで、変動の幅は十分に把握できていない。
- `environment` の残り約145〜160秒は、jsdomのまま残る213ファイル分である。
- テスト件数・pass / skip件数は変更前と同一。timeout・retry・失敗はない。

## 8. 実装しなかった案と理由

5章の表を参照。いずれも「検証内容が変わらないこと」をPhase 1の範囲で示せないか、効果に対して変更範囲・リスクが大きい。

## 9. CI 5分以内に向けた段階的計画（提案）

現状（速いrunner）でtest step約7分20秒、遅いrunnerで約10分。今回の変更による短縮は同等runner同士の実測で約45秒（約10%）であり、5分以内には追加施策が必要。

1. **Phase 2：jsdom対象の追加精査**  
   `src/services`、`src/db`、`src/presentation`、`src/workers`、`src/benchmarks` の `.test.ts` をファイル単位で確認し、feature detectionや記録値に影響しないものから `node` projectへ移す（約150ファイル、期待短縮は今回と同程度）。
2. **Phase 2：CI job分割（wall-clock短縮）**  
   lint / build と test を並列jobにし、testは `vitest --shard` で2〜3 job に分割する。全テストは引き続き毎PR実行し、検出能力は変えない。jobごとの `npm ci`（約5秒＋setup）が増えるため、shard数は実測で決める。
3. **Phase 3：UIテストの個別高速化**  
   `IdentificationWizardDialog.test.tsx`（約120秒）など、入力回数の多いMUIダイアログテスト。再レンダリング範囲の調査、またはFakeCoordinatorの状態seedで入力を省けるテストの整理。Production UIを変える場合は別途判断が必要。
4. **Phase 3以降：isolation設定**  
   `isolate: false` 等は、状態漏れを検出する仕組みとセットでのみ検討する。

## 10. 今後の計測方法

- CIのrunner性能差が約1.35倍あるため、比較は複数runの中央値で行い、Vitest summaryの `environment` / `setup` / `import` / `tests`（全worker合計）を併記する。これらはテスト構成の変化を wall-clock よりも直接示す。
- 必要ならCIに `nproc` / CPU型番を出力するstepを加え、runnerの種類を記録してから比較する（今回は未実施）。
- ファイル別時間はCIログの `✓ <file> (<n> tests) <ms>` 行から集計できる（`gh run view <run-id> --log`）。projects導入後は `✓  jsdom  <file>` のようにproject名が入る。
- テスト件数の一致は `npx vitest list --json=<file>` の比較で確認する（標準出力にはテストのconsole出力が混ざるため、ファイル出力を使う）。
- ローカルで他の重い処理が動いているときは `--maxWorkers` を制限し、全件の反復計測は避ける。
