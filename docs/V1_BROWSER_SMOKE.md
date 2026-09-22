# v1 375px実ブラウザ確認 + GitHub Pages実配信smoke

本文書は `docs/V1_ACCEPTANCE_AUDIT.md` が残課題としたREQUIREMENTS 36 / 37の
「実ブラウザでの375px操作」「GitHub Pages実配信smoke」を、実際のPages本番URLと
実ブラウザ（375x812 viewport）で確認した記録である。製品仕様・Domain仕様を
変更する文書ではない。

## 実施条件

| 項目 | 値 |
| --- | --- |
| 実施日 | 2026-09-22 |
| 対象main SHA | `9ac5bafc42e800d03feff8c1aa336fa73f64f5b7`（PR #66 merge済み） |
| GitHub Pages deployment | Actions run `35713314968`（`Deploy to GitHub Pages`, `main` push, `conclusion: success`） |
| Pages deployment headSha | `9ac5bafc42e800d03feff8c1aa336fa73f64f5b7`（対象main SHAと一致） |
| Pages配信URL | `https://nekono-lazy.github.io/GogmaArtianPlanner/`（`gh api repos/nekono-lazy/GogmaArtianPlanner/pages` の `html_url`） |
| browser | Claude Code built-in browser pane（Chromiumベース） |
| viewport | 375 x 812（`resize_window` mobile preset） |

本smokeはこの作業ブランチ（`test/v1-browser-pages-smoke`）自体をdeployするものではない。
このブランチはdocsのみを変更し、実配信されているmain（PR #66時点）を検証対象とする。

## Pages deployment確認

`.github/workflows/deploy.yml` は変更していない（`main` push / `workflow_dispatch`、
`npm ci` → `lint` → `test` → `build` → `configure-pages` → `upload-pages-artifact` →
`deploy-pages`）。

```text
gh run list --workflow=deploy.yml --limit 5
completed  success  v1必須のDebug情報を画面へ接続 (#66)  main  push  35713314968  5m47s
```

`gh run view 35713314968 --json headSha,conclusion` は `headSha` が対象main SHAと一致し
`conclusion: success` であることを確認した。全ステップ（Lint / Test / Build / Setup Pages /
Upload artifact / Deploy to GitHub Pages）が成功している。

## 主要画面smoke結果

判定は `pass` / `pass_after_fix` / `not_applicable` / `blocked` / `follow_up_required` のいずれか。

| 画面 / 項目 | 判定 | 確認内容 |
| --- | --- | --- |
| Dashboard初回起動（実URL） | pass | HTTP 200、Dashboard表示、JS/CSS適用、Console fatal errorなし |
| asset取得 | pass | `index-*.js` / `index-*.css` が200。`search.worker.entry-*.js` / `planner.worker.entry-*.js` / `normalArtianCounterIdentification.worker.entry-*.js` がすべて `/GogmaArtianPlanner/assets/` から取得され、Worker起動・実行に成功（404なし） |
| モバイルNavigation（hamburger→Drawer） | pass | 全主要画面リンク（ダッシュボード／所持武器／目標武器／候補検索／ビルドリスト／生産計画／RNG状態設定／通常アーティアカウンター／設定）を確認。リンククリックでDrawerが自動的に閉じることを確認 |
| Hash route直接reload | pass | `#/`, `#/rng`, `#/normal-counters`, `#/owned-weapons`, `#/target-weapons`, `#/search`, `#/build-list`, `#/plans`, `#/settings` を直接navigateしてすべて正常表示（404なし、Pages側rewrite不要） |
| RNG Setup | pass | Base Seed / 巨戟カウンター / スキルカウンターへの入力、チェックボックス、保存が375pxで操作可能。保存成功メッセージ表示 |
| Normal Counter | pass | 「観測・検索」ダイアログがフルスクリーンで開き、属性区分ラジオボタン・削除・閉じるが操作可能 |
| Owned Weapons | pass | 新規登録ダイアログで長い武器名（36文字の日本語）を入力しても横overflowなし、保存後カード内でwrap表示 |
| Target Weapons | pass | 長い目標名で新規登録、既所持Ideal通知（`isOwnedIdealForTarget`）が即座に表示、「この武器で目標を完了にする」確認ダイアログが375pxで完全表示、キャンセル動作を確認 |
| Candidate Search | pass | 検索開始でSearch Worker起動、`existing_gogma_current` 零操作Candidateを表示、intermediate state（スキル候補／復元ボーナス候補）表示、改善優先ラジオボタン操作、ビルドリストへ追加成功。処理中Cancelでの停止・旧requestの結果抑止・再検索成功は、PRレビュー後の追加manual smoke（下記「Worker cancel / retry」参照）で確認済み |
| Build List | pass | 登録候補・目標武器件数の概要カード、「生産計画を作成」（Planner Worker起動）でDraft Plan生成・自動遷移を確認。処理中Cancelでの停止・再実行成功は、PRレビュー後の追加manual smoke（下記「Worker cancel / retry」参照）で確認済み |
| ProductionPlan一覧 | pass | 完了ステータスのcard表示、「詳細を見る」リンクが横overflowなく操作可能 |
| ProductionPlan詳細 | pass | 概要カード、長いPlan ID / 目標武器名のwrap、アコーディオン展開でPlanStep詳細を表示 |
| Execution Navigator | pass | Step確定（`confirm_owned_ideal`）、Plan完了、Undo（確認ダイアログ→実行→Step 1へ復帰）、ゲーム内セーブ記録ダイアログ、現在Plan破棄ダイアログをすべて375pxで確認（後者2つはキャンセルして状態を保持） |
| ProductionPlan detail / runの動的route reload | pass | `#/plans/<実ID>` と `#/plans/<実ID>/run` を直接navigateしてIndexedDBから復元・正常表示 |
| Debug Details | pass | デバッグモードON後、現在のRNG状態・Master data / calculation versions（`CURRENT_CALCULATION_APP_SCHEMA_VERSION: 13`）を表示。横overflowなし |
| PlanStep Debug（共有component） | pass | Execution Navigator上でアコーディオン展開、Base Seed / Counter delta / expectedResultをwrap表示、横overflowなし |
| Settings | pass | デバッグモードtoggle、Export、Clear確認ダイアログ、Import確認ダイアログをすべて375pxで確認 |
| Persistence（IndexedDB） | pass | `indexedDB` を直接読み出し、RNG状態・所持武器・目標武器・生産計画が保存されていることを確認。Hash route reload後も復元 |
| Export / Import | pass | 「データをエクスポート」でJSON Blob生成（schemaVersion 11）を確認。「全データを削除」で0件化を確認。同JSONを合成`File`+`DataTransfer`でファイル入力へ設定し「データをインポート」で全データを復元（所持武器1件・目標武器1件・生産計画1件・settings.debugModeを含め完全一致） |
| Console | pass | smoke全体を通じてConsole fatal error / uncaught exception / unhandled rejectionは0件 |
| Network | pass | smoke全体を通じて404 / 500 / CORS / MIME type errorは0件 |

### 横scroll / 44px操作性

すべての画面で `document.documentElement.scrollWidth === document.documentElement.clientWidth`
をJavaScript経由で確認した（横scrollなし）。主要button（RNGを設定する、保存、検索開始、
ビルドリストへ追加、生産計画を作成、作成開始、所持武器で完成を確認、Undoする等）はすべて
片手幅内で視認・操作可能だった。

### Dialog footer / focus

以下のDialogをすべて375pxでfooter（キャンセル/確定系ボタン）まで完全表示・操作可能なことを確認した。

- Target Weapons「この武器で目標を完了にする」確認Dialog
- Settings「すべてのデータを削除しますか？」確認Dialog
- Settings「バックアップからデータを復元しますか？」確認Dialog
- Execution Navigator「最後のツール上の操作を元に戻します」（Undo）確認Dialog
- Execution Navigator「現在の生産計画を破棄します」確認Dialog
- Execution Navigator「ゲーム内セーブ地点を記録します」確認Dialog

Dialogを開いた直後にaction領域（キャンセル/確定ボタン）が画面内に収まり、スクロールなしで
到達できることを確認した。個別のTab順によるfocus trap検証は今回未実施（follow-up参照）。

### Worker cancel / retry

Draft PRレビュー（PR #67、レビュー時latest head `b3d9c2b6ccf32f36557a3a5f911601fb3489b516`）で、
上記smokeがCandidate Search Worker / Planner Workerの起動・結果取得までしか確認しておらず、
PR #64監査の受入条件「検索／Plannerの開始・cancelが動くこと」のうちcancel実施記録が不足している
との指摘を受けた。これを受けて、**ユーザーが実際のGitHub Pages環境で追加のmanual smokeを実施し、
以下を確認した（Claude Code自身による確認ではない）**。

- Candidate Search
  - Candidate Search開始
  - 処理中にCancel → 処理停止
  - キャンセル済みrequestの旧検索結果が後から表示されないことを確認
  - 再度Search開始 → 正常実行
  - 結果: 問題なし
- Planner（「生産計画を作成」がPlanner Workerの処理）
  - 生産計画作成開始（「生産計画を作成」ボタン、Planner Worker起動）
  - 処理中にCancel → 処理停止
  - 再度「生産計画を作成」 → 正常実行
  - 結果: 問題なし

いずれも問題は見つからず、コード修正は行っていない。この追加確認により、PR #64監査が
REQUIREMENTS 36 / 37の受入条件として挙げていた「検索／Plannerの開始・cancelが動くこと」を
実Pages環境で満たしたことを確認した。

## 発見事項

調査の過程で以下の観察があったが、いずれも**実装の不具合ではない**ことをground truthの
直接確認で切り分けた。

- Settingsのデバッグモードtoggleをクリック後、直後の `#/debug` reloadで「Debug Modeが無効」
  と表示される場面があった。原因はテスト操作側（座標クリックがtoggleに命中していなかった
  こと）であり、`input.checked` とIndexedDB `settings.debugMode` を直接読み出して確認した
  結果、正しいtoggle操作では即座に `debugMode: true` がIndexedDBへ永続化され、`#/debug` も
  正しく有効表示に切り替わることを確認した。コード修正は行っていない。
- Build List上で、Target完了によって`referencedOwnedWeaponsHash`が変化した既存Entryが
  「再検索が必要（参照している所持武器が変更されています）」と表示された。これは
  `isProtected` がIdeal完了で`true`へ変わったことによる正しい`owned_weapon_changed`判定
  （`AGENTS.md` の「isProtectedは… 全stayが semantic」規定どおり）であり、不具合ではない。

## 修正事項

なし。375px操作・Pages実配信ともにblockingする問題は見つからなかったため、
`AGENTS.md` の修正ポリシー（「smokeで問題が見つからなかった場合はProduction codeを
変更しない」）に従い、本PRはdocsのみの変更とした。

## follow-up

- Dialogの厳密なfocus trap（open時のinitial focus位置、Tab順、Escapeでの確実な復帰）の
  自動化検証は未実施。必要であれば別PRでアクセシビリティ監査として分離する。
- Search Worker自体の処理中Cancel、キャンセル済みrequestの旧結果抑止、再検索成功は
  上記「Worker cancel / retry」で確認済み。未実施なのは、複数Target環境で「長い第2Targetへ
  切替→検索→cancel」という特定のUI組み合わせのみであり、今回の登録済みTarget数（1件）の
  都合で実施していない。このパターン固有の確認は別smokeで補完可能で、REQUIREMENTS 36 / 37の
  covered判定を妨げるものではない。
- Production RNGの実機能（Reset/Keep結果の実ゲーム一致）は本smokeの対象外（`AGENTS.md`
  のRNG検証区分に従い、対象外のまま）。

## 未確認事項

- ブラウザプロセス終了やOSレベルのIndexedDB evictionへの耐性（既存監査記録どおり対象外）。
- タブレット幅（768px）や物理デバイスでの実機確認（今回はビューポートエミュレーションのみ）。

## 最終判定

REQUIREMENTS 36（スマートフォン幅で主要操作が行える）、37（レスポンシブ表示と統合テスト、
GitHub Pages配信パスでの起動・画面遷移）は、実ブラウザ375px操作と実GitHub Pages配信URLでの
確認、および上記「Worker cancel / retry」で確認したSearch Worker / Planner Workerの
処理中Cancel・旧結果抑止・再実行成功（PR #64監査が挙げていた「検索／Plannerの開始・cancelが
動くこと」の受入条件）により **covered** とする。`docs/V1_ACCEPTANCE_AUDIT.md` の当該記録を
本文書へ差分追記した（下記PR #67 follow-up節）。

バージョン不変: `DATABASE_SCHEMA_VERSION = 8`、`EXPORT_SCHEMA_VERSION = 11`、
`CURRENT_CALCULATION_APP_SCHEMA_VERSION = 13`、`RngState.schemaVersion = 2`、
`AppSettings.schemaVersion = 1`、`PRODUCTION_RNG_ENGINE_VERSION = production-rng:c5-e7`、
Master `dataVersion` 不変。本PRはdocsのみを変更し、persisted shape / Production semanticsを
変更しない。
