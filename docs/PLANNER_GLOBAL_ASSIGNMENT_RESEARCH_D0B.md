# Global Planner Global Assignment Phase D-0B（materialization runner・非formal smoke・G1 / G3 / G4診断）

Refs #154。Research-only・**非formal**。基準main: PR #245 merged `531c447314de68c5e93adb7e28b0da1910f98af9`
（作業開始時に `main` / `origin/main` / HEADの一致、Working Tree clean、stash / 追加worktreeなしを確認）。
branch: `research/global-assignment-phase-d0b`。

本書は [Global Assignment設計](PLANNER_GLOBAL_ASSIGNMENT_DESIGN.md)（以下「設計」）§14 の **D-0B**（実Export用materialization runner、非formal smoke、
[D-0B準備監査](PLANNER_GLOBAL_ASSIGNMENT_IDEAL_CONTINUATION_AUDIT.md)（以下「監査」）§9.1のG1 / G3 / G4診断）を記録する。
**計測条件の事前登録は行っていない**（設計 §19.7 / 監査 §9.1の計画どおりD-0B-2へ延期）。Production Planner・Trace Replay・formal measurementは実行していない。

Production（`src/domain` / `services` / `workers` / `pages` / `components` / `db`）、UI、Persistence、RNG semantics、schema / version、
Phase A〜Cのoption集合・solver・coverage・value ordering・下界、D-0Aの照合規則、B-2A / B-2B runnerと正式RESULTは変更していない（§12）。

## 0. 位置づけとauthority

正式仕様の順位は `AGENTS.md` のとおり `docs/REQUIREMENTS.md` → `docs/PLANNER_SPEC.md` → `docs/SEARCH_SPEC.md` → `docs/RNG_SPEC.md` →
`docs/DATA_MODEL.md` → その他正式仕様 → 最新mainの実装・test → Research設計である。本書はResearch記録であり、正式仕様でもDomain仕様でもない。
設計の中では §4.5 / §4.6（outcome）、§8.2（materialization順序）、§9（materialization）、§10.3 / §10.4（window移行・budget分離）、§11（oracle isolation）、
§12（determinism / incomplete）、§19（Ideal継続監査）に従う。[Phase 2-C2.7-A](PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_PHASE2C27A.md) のguardrail
（特にG1 speculative Entryの非永続、G5 budget分離、G6 / G7 timeout / OOMをnot-foundへ読み替えない、G9 run前の条件確定）を守る。

### D-0Bの結果が意味すること・しないこと

D-0Bが返すのは、Phase C-2の **structural candidate**（必要条件の割当 + 被覆pre-check + 期待Route形）を、D-0AのmaterializationでProduction Searchへ
渡した結果（Target別の `MaterializationOutcome`）である。`all_materialized` もPlanではなく、Production Plannerで検証していない。本書・RESULT・コードの
どこでも `verified` / `best_found` / `proven_minimum` / 「43 / 43完成」を結果分類として使わない。materializeできなかったTargetについても
「Routeが存在しない」「実行不能」とは書かない。

## 1. 目的・範囲

| やること | やらないこと |
| --- | --- |
| 実ExportからPhase 0 → A → C-2 → 診断 → D-0Aを、別のNode子process・wall-clock / heap envelope付きで実行するrunner | Production Planner / Trace Replay / fresh Planner検証（D-1） |
| 最初のstructural candidate（既定1件）のmaterializationと、Search規模・時間・メモリ・配送の観測 | 多数のstructural candidateの大量materialization（上限10のguard） |
| G1（Search policyが返さない形）のSearch前判定と専用の未実行分類 | G1形のmaterialization（D-0A-2、監査 案B） |
| G3（Bonus frontier代表化）のリスク・request上の条件・実測の区別、G4（Planner開始時Ideal）の場合分け | G3 / G4を理由に候補を棄却・恒久除外すること、Phase A / Cの規則変更 |
| 非formal smokeの暫定条件（根拠つき）と、`--mode formal` の拒否 | delivery cap・Search規模gate・envelope等の事前登録（D-0B-2）、formal run（D-0C） |

## 2. 入力

- Export: `gogma-artian-planner-backup_20260927015837.json`、19,424,064 bytes、SHA-256
  `cc35fb5bd85acb417b2ce0229cd79441b48c642ac8af70bbc2dfdfc8c89e1e6b`（B-2Bの登録Exportと同一。Repositoryには含めない。`--export` で外部pathを渡し、
  smokeでは `--expected-export-sha256` でこの値と照合した）
- Production RNG Engine `production-rng:c5-e7`、CalculationContext（gameVersion `unknown-initial`、masterDataVersion 4、rngEngineVersion
  `production-rng:c5-e7`、appSchemaVersion 17）
- planning Target数（Phase 0で確定、runnerには固定値として持たない）: **43**。origin Skill 341 / Gogma 55、確定Normal Counter 7本

oracle manifest / verifier / 過去RESULT / 1,657の値 / 既存BuildListEntryのRoute内容はPhase A〜Cの探索誘導に使っていない（設計 §4.1 / §11）。
既存EntryはPhase 0のplanning Target集合の決定と、D-0Aのdeterministic materializerのID衝突規則（設計 §9.4）にだけ読まれる。

## 3. Runnerの構成

### 3.1 module（すべてResearch専用。Productionからimportされない）

| file | 責務 |
| --- | --- |
| `src/benchmarks/globalAssignment/materializationTypes.ts`（変更） | `SearchPolicyShape`（G1の形）と `MaterializationOutcome` の `not_executed(search_policy_shape)`、実行専用observer `MaterializationObserver` / `CandidateInspection` を追加 |
| `src/benchmarks/globalAssignment/materializationShape.ts`（変更） | `searchPolicyShapeOf(option, table)`: G1の判定（ReachTableだけを読む。予測・Search・reservationなし） |
| `src/benchmarks/globalAssignment/materialize.ts`（変更） | opt-in `searchPolicyPrecheck`（trueならG1 TargetをSearch前に `not_executed(search_policy_shape)`）と `observer`。**どちらも無指定ならD-0Aの挙動そのまま**（既存D-0A testは無変更で通る） |
| `src/benchmarks/globalAssignment/materializationDiagnostics.ts`（新規） | G1一覧・継続option数、G3の静的risk / request上の条件 / 実測（collapse署名）、G4の場合分け。すべて純関数で、候補を不成立に分類しない |
| `src/benchmarks/globalAssignment/materializationProtocol.ts`（新規） | protocol version、条件型と検証、envelope検証、非formal smoke既定値（値ごとの根拠・`oracleInformed: false`）、formal runの拒否、stage分類と §10.3上の役割、progress journalの型とparser |
| `src/benchmarks/globalAssignment/materializationRunner.ts`（新規） | `runMaterializationSmoke(plannerInput, dependencies, request, execution)`: Phase 0 → A → C-2 → 診断 → D-0Aを1つの計算として実行し、semantic（決定的）/ observed（時間・yield）に分けたplain data recordを返す。`summarizeMaterializationRun()`（Target IDを含まない要約） |
| `scripts/run-planner-global-assignment-d0b.mjs`（新規） | 親: 引数・HEAD・Export・条件・provenanceを確定し `start.json` を書き、child（`--repeat` 回）を **順に1本ずつ** spawnし、envelopeで監視して集約RESULTを書く。子（`--role materialize`）: Export読込 → PlannerInput復元 → `runMaterializationSmoke()` → record。progress journalを同期appendする |
| `scripts/planner-global-assignment-d0b-child-process.mjs`（新規） | D-0B専用のchild envelope（§3.5）。B-2Aのenvelope moduleは変更・再利用していない |

### 3.2 処理フロー（child）

1. Exportを読み、bytes / SHA-256が親のtaskと一致することを確認する
2. `globalResearchInputFromExport()`（既存のResearch adapter。Import service・IndexedDBなし）でPlannerInputを復元し、`ProductionRngEngine` を使う
3. Phase 0 `createGlobalAssignmentContext()`（`validatePlannerInput()` → `derivePlannerPlanningTargets()`）。以後Target集合を増減しない
4. Phase A `buildReachTable()`（window W0）
5. Phase C-2 `createStructuralCandidateSearch()`（`nodeBudget` / `mrvLookahead` / `coverageDrivenOrdering` を明示。**`readVerifiedUpperBound` は渡さない**、
   `upperBoundSupplied: false`）。`next(1)` で1 nodeずつ進め、`structuralCandidateLimit` 件で止める。node budget到達は `search_incomplete`（候補不存在と読まない）
6. 各候補について、Search前の静的診断（G1 / 継続option数 / G3静的risk / G4）を記録する
7. D-0A `materializeStructuralCandidate()` を `settings = { deliveryCap, searchScaleGate }`（呼び出し側が明示。無制限へのfallbackなし）、
   `searchPolicyPrecheck: true`、observerつきで実行する。Phase Cの `materializationOrder` を維持し、reservationはmaterialize済みEntryからだけ導出され
   （未materialize Targetの位置を先取りしない、held / blockedを改変しない）、照合は `matchExpectedShape()` のrequired位置完全一致のまま。
   未解決Targetで止まり、後続は `not_attempted`
8. Target別summary（方式選択、試行ごとの予測Search規模と実行時instrumentation、outcome、配送Candidateの照合理由の集計、G3のrequest上の条件と実測）を記録する
9. materialized Entryは識別子（Entry ID・semantic hash）だけを記録し、Build List・DB・Export・`PlannerConflictResolution`・lineageへ書かない

### 3.3 G1: Search policyによる未実行（設計 §19.3、本PRで確定）

- 判定: optionが `conversion (c, s*)`、`c < s*`、かつ `c` がそのTargetのReachTable `skill.idealPositions` に含まれる（巨戟化位置のSkillが既にIdeal）。
  Production Searchは巨戟化Skillが既にIdealなRoute baseにReset Skills channelを開かない（SEARCH_SPEC 5.6.1 / 5.6.8）ので、設計 §9.1 / §9.2のどちらも
  その形を返さない。ゲーム上合法でDomainでも表現できるRouteであり、未実行の理由はSearch policyである
- 分類: Target別 `not_executed(search_policy_shape)`（`policyShape`: `lane_start_ideal_skill_continuation`、`c`、`s*`）。request・Searchは作らない。
  候補stageはD-0Aの型どおり `materialization_unconfirmed`、D-0Bの分類は **`not_executed_search_policy`**。それより前にmaterializeしたTargetの実績は残り、
  後続Targetは未試行
- 設計 §10.3での扱い（`materializationFollowUp()`）: `method_extension`。**window拡大の根拠にも、delivery cap・gate・envelope見直しの根拠にもしない**。
  `shape_mismatch`（`materialization_failed`）・`unconfirmed`・gate未実行と混同しない。次に見直すのは方式（監査 案B、D-0A-2）
- 現行Phase Aが列挙しない所持巨戟側の継続（G2: S2 / B1 / B2）は観測できない（`ownedGogmaContinuation: 'not_generated_by_current_phase_a'`）

| 候補分類 | 意味 | `followUp` | window拡大の根拠 | cap / gate / envelope見直しの根拠 |
| --- | --- | --- | --- | --- |
| `all_materialized` | 全planning Targetに一致Entry（Planner未検証） | `planner_verification_pending` | しない | しない |
| `executed_shape_mismatch` | 設計 §9.1のSearchが `exhausted` で一致なし | `executed_mismatch` | 設計 §10.3の条件（exhaustedな窓の全候補がこれ）でのみ | しない |
| `unconfirmed_stopped_by_extent` / `unconfirmed_delivery_cap` / `not_executed_search_scale_gate` / `unmeasured_cancelled` | 未確認・未実行・中断 | `settings_review` | しない | する |
| `not_executed_search_policy` | G1（Search policy） | `method_extension` | しない | しない |
| `fail_closed` | `GlobalAssignmentMaterializationError` / `InvariantError` | `run_error` | しない | しない |

process-levelの `timeout` / `out_of_memory` / `process_failure` / `cancelled` は親が判定する（§3.5）。

### 3.4 G3 / G4の診断

**G3（Bonus family-layout frontierの代表化）**。held-aware Bonus streamは、同じdepth・同じ位置・同じ順序付きfamily layoutのstateを1つにまとめ、
`lastResetDepth` 最大（最新のReset）を代表に残す（`bonusStream.ts`）。Keep chainの途中に、chainと同じlayoutのReset結果を持つ位置 q があり、
Routeがその位置で操作しなければならない（held / blockedでない）と、Keepだけの履歴が失われ、Searchは同じ最終武器を required {q, g*} で返す。D-0Bは3段で記録する。

| 段 | 内容 | 意味 |
| --- | --- | --- |
| 静的risk（候補全体） | `keep_from_source`（範囲 origin .. g*−1）/ `reset_then_keep`（g1+1 .. g*−1）について、ReachTableのReset layoutがchain layoutと一致する位置 q と、そのqを別Targetがrequired位置に持つか | **リスク条件**。発生の証明ではない |
| request上の条件（試行したTargetのみ） | 各requestの正式reservationで q が free / held / blocked のどれか。freeが1つでもあれば `collapseConditionHolds` | 代表化が起き得る条件（コード読取） |
| 実測（試行したTargetのみ） | 配送Candidateのうち、理由が `gogma_required` だけで、最後のrequired Gogma位置が期待 g* と同じもの（`sameFinalPositionMismatches`）、そのうち required = [q, g*]（q はrisk位置）のもの（`collapseSignatures`） | 実際に観測した代表化の痕跡 |

`gogma_required` だけの不一致は、同じsourceの **別のIdeal Route**（たとえば早い位置で終わる安いRoute）でも生じる（Ideal Bonusは1つの多重集合なので、
同じsourceのIdeal Routeの最終武器は一致する）。したがってG3の実測は「同じ最終位置 g*」と「q がrisk位置」の両方で絞った `collapseSignatures` で数える。

**G4（Planner開始時のIdeal）**。`deriveTargetSatisfaction()`（保護中を含む在庫、Planner開始時点）でIdeal武器を持つplanning Target t について、監査 §3.6の場合分けを
静的に記録する。

| 分類 | 条件（tのIdeal武器の集合を W_t とする） | 意味 |
| --- | --- | --- |
| `zero_operation_ideal` | tのoptionが W_t の武器の `none / none` | 通常のゼロ操作。G4ではない |
| `g4_iii` | tのoptionが W_t の武器（t自身の両軸Ideal source）を操作する | 現行Phase A / Cは生成・受理しない |
| `g4_i` | それ以外で、W_t のうち他TargetのoptionにSkill / Bonusの操作をされない武器が1つ以上ある（どのoptionのsourceでもない武器と、ゼロ操作optionのsourceとして参照されるだけの武器を含む） | その武器はin-flightにならないので、監査の前提P2 / P3のもとでtは最後まで `hasIdeal`（tのEntryはcommitされない見込み） |
| `g4_ii` | それ以外で、W_t のすべての武器が他TargetのoptionにSkill / Bonusの操作をされる | 操作でin-flightになると `hasIdeal` がfalseへ戻り得る（戻るとは限らない）。実行順に依存し、Phase D'でだけ決まる |

**sourceとして参照されることと、操作されることは区別する**。Plannerは武器を変更する操作（source付き `reset_skills`、`reset_bonuses`、`keep_bonuses`。
`sourceMutatedByOperation()`）の直後にだけその武器をin-flightにして充足を再評価する。ゼロ操作optionは武器を変更せず、そのTargetも開始時からIdealなので
Entryはcommitされない。したがってゼロ操作optionのsourceとして参照されるだけの武器は、G4-iiの条件（他Targetの操作による充足の変化）に当たらない。
複数のIdeal武器を持つTargetは、一部だけが操作されても操作されない武器でIdealのままなので `g4_i` とし、どの武器が操作されるかを
`operatedIdealWeaponIds` / `unoperatedIdealWeaponIds` と武器ごとの `sourceOf`（参照するoptionと、それが操作するか）に残す。
D-0BはPlannerを実行しないので、開始時点の `hasIdeal` を恒久的完成とみなさず、どの場合も候補を不成立・恒久除外に分類しない（判定はPhase D'）。

### 3.5 Process isolation・envelope・progress journal

- childは1 runにつき1本、concurrency 1、自動retryなし。`--max-old-space-size=<heap MB>` と wall-clock上限（超過はSIGKILL）
- envelope module（`planner-global-assignment-d0b-child-process.mjs`）の分類: 起動失敗 → `process_failure`、親のcancel（SIGINT / SIGTERM →
  AbortSignal → SIGKILL）→ `cancelled`、wall-clock → `timeout`、stderrの **V8 heap-limit署名**（`JavaScript heap out of memory` / `Reached heap limit` /
  `Ineffective mark-compacts near heap limit`）→ `out_of_memory`、exit 0かつrecordあり → `completed`、それ以外（非0 exit、signal、record無しのexit 0、
  他のFATAL ERROR）→ `process_failure`。OOMを署名なしに推測しない。promiseはどの経路でも1回だけsettleし、timer・abort listenerを解放する
- childは `started` / stage / 構造候補 / Target開始・確定 / 候補確定 / 5秒ごとのmemoryを **progress journal**（JSON lines）へ同期appendする。
  childがrecordを書かずに終わった場合、親はjournalを `parseProgressJournal()` で読み、確定済みの事実だけ（完了stage、確定Target、memory）を
  `confirmedProgress` に残す。**実行中だったTargetは `targetInProgress` として結果なしで記録し、推測で補完しない**。切れた最終行はmalformedとして数える
- 未計測（timeout / OOM / process failure / cancel）は `unmeasured` として残し、成立・不成立・候補なしへ読み替えない。親のexit codeは
  integrity issueがあれば1、未計測runがあれば2、それ以外0
- 出力（`start.json` / task / record / journal / RESULT）は排他作成（`wx`、journalは新規append）。既存output・既存run dir・Exportと同じoutputは開始前に拒否する。
  実行生成物はgit-ignoredな `.local/` に置く

### 3.6 RESULT（provenance・記録項目）

`start.json`（読み取り専用）と集約RESULTに、protocol version / phase、`mode: smoke`、**`formal: false`**、Research対象であること（`nature`）、
`oracleFreeExecution: true` / `oracleInformedDesign: true`、Repository HEAD SHA、基準main、Working Tree clean、計算関連コードの未commit有無、
benchmark code SHA-256（`git ls-files` の内容hash）、本書のSHA-256（smoke時点では未作成のためnull）、runner script、Node / V8、Exportの名前・bytes・SHA-256と
`--expected-export-sha256` との一致、条件・envelopeと条件ごとの根拠、formal登録状態（無効・延期項目・延期先）、smoke override一覧、起動時刻、machineを記録する。
child recordには、Engine version、CalculationContext、semantic record（§3.2の全項目）、observed（stage別・Target別の時間、yield数）、
memory（250 ms samplingのheapUsed / heapTotal / RSS最大値、maxRSS、heap size limit）を記録する。runごとにsemanticのSHA-256を取り、
`--repeat 2` のとき一致を `determinism.identical` に記録する（時間・メモリは含めない）。

### 3.7 CLI optionsと検証規則

```bash
node scripts/run-planner-global-assignment-d0b.mjs --export <Export .json> --run-dir <新しいdir> --output <新しい .json> [options]
```

| option | 既定（非formal smoke） | 検証 |
| --- | --- | --- |
| `--mode` | `smoke` | `smoke` のみ実行。`formal` はExportを読む前・何も書く前に拒否（D-0Bは登録条件を持たない） |
| `--window N,G,S` | W0 = 350,500,1500 | 3つの正の整数 |
| `--node-budget N` | 2000 | 正の整数 |
| `--mrv-lookahead N` | 8 | 正の整数 |
| `--coverage-driven-ordering true\|false` | true | 明示的なboolean |
| `--structural-candidate-limit N` | 1 | 1〜10（runner guard） |
| `--delivery-cap N` | 500 | 正の整数 |
| `--gate C,G,S,N` | 32,500,1501,350 | 4つの非負整数（maxConversionPositions, maxGogmaLegalWidth, maxSkillLegalWidth, maxNormalForgeCount） |
| `--wall-ms N` | 1800000（30分） | 1000〜86400000 |
| `--heap-mb N` | 4096 | 256〜65536 |
| `--repeat N` | 1 | 1〜2 |
| `--expected-export-sha256 <hex>` | なし | 64桁hex。指定時は不一致なら開始前に拒否 |
| `--allow-uncommitted` | なし | 計算関連コードに未commit変更があるときに必須（非formal記録に残る） |

未知のoption（`--optimum` 等のpost-hoc比較引数を含む）、重複、値なしoptionは拒否する。G1のSearch前判定（`searchPolicyPrecheck`）はD-0Bの固定規則でoptionを持たない。

## 4. 非formal smoke条件（暫定・登録値ではない）

すべて `MATERIALIZATION_D0B_SMOKE_DEFAULTS`（`materializationProtocol.ts`）に値と根拠を持ち、`oracleInformed: false`。1,657 oracleや過去RESULTのTarget別位置は使っていない。

| 項目 | 値 | 根拠 |
| --- | --- | --- |
| window | W0 = 350 / 500 / 1500 | `recommendedCandidateSearchDefaults`（REQUIREMENTS 14.1）。非oracle起源、B-2Bの登録window |
| node budget / MRV lookahead | 2,000 / 8 | B-2Bの登録値（最初の完全割当はnode 43） |
| coverage-driven ordering | true | 設計 §6.3の採用方式。C-2 smokeでW0先頭1,000件はordering有無で同一 |
| structural candidate上限 | 1 | 設計 §9.8（最初のstructural candidate） |
| delivery cap | 500 | 実Exportの配送分布が未計測のための暫定値（D-0A syntheticでは一致までの配送が5件以内: 候補全体のmaterializationでは0〜1件、空reservationで単独に探索した1 Targetで4件）。配送ごとにmaterialize・照合するので1 Targetの仕事量を抑えつつ、期待形より安いIdeal Routeが先に配送される余地を残す。§5のrunのprovenanceに記録された根拠文は、この括弧内を「≤ 2」と書いていた旧文言である（`b7b7b00` 後に訂正。値・意味は不変） |
| Search規模gate | conversion 32、Gogma幅 500、Skill幅 1501、Normal forge 350 | 保持Skill held-aware streamを決める巨戟化位置数だけを絞る（D2-G-A: 255位置は完了、M=1500の306位置はモデル6,081万stateで12 GB heapでもOOM）。幅とforge数はW0窓（W0内では拘束しない）にし、費用はwall-clockで抑えて実測する |
| wall-clock / heap | 30分 / 4,096 MB | B-2A / C-2 smoke（ReachTable約14 s、最初の候補約50 s、RSS約1.1 GB）とB-2Bの登録heap |
| repeat | 1（最終smokeは `--repeat 2`） | 単一の隔離processを基本とし、決定性は2 runのsemantic hashで確認 |

## 5. 非formal smoke結果

machine: AMD Ryzen 7 9700X（16 logical）、33.4 GB RAM、Windows 10.0.26200、Node v24.19.0。すべて非formal。

| run | HEAD | 条件 | 結果 |
| --- | --- | --- | --- |
| s1（path確認） | `4f1c148` | window 20 / 20 / 20、他は既定 | 2.7 s、`no_structural_candidate`（`target_without_option`。窓が狭くoptionの無いTargetがある。実行可能解の不存在ではない） |
| w0 | `4f1c148` | 既定 | 199 s、候補 `unconfirmed_delivery_cap`、7 / 43 materialized |
| w0r2 | `01b740e` | 既定、`--repeat 2` | 196 s / 228 s、2 runのsemantic SHA-256一致（`determinism.identical = true`）、結果はw0と同じ |
| cap5000（探索的） | `01b740e` | `--delivery-cap 5000`、他は既定 | 268 s、`unconfirmed_delivery_cap`（5,000配送）、7 / 43 |
| **final**（本書の数値） | `b7b7b00` | 既定、`--repeat 2` | 235 s / 231 s、semantic SHA-256 `53b1b77c…` で2 run一致、`unconfirmed_delivery_cap`、7 / 43 |

w0 → finalの間の変更はG3実測の絞り込み（`01b740e`）と候補summaryへのTarget別option行・Skill依存の追加（`b7b7b00`）だけで、Search・照合・分類の結果は同一である。
cap5000は、delivery capの大小が最初の未解決Targetの原因かを確かめる1回だけの探索的smokeで、登録値の候補ではない（timeout / OOMではないので、値を際限なく増やす再実行には当たらない）。

### 5.1 Structural Search（Phase A / C-2）

- planning Target 43、ReachTable 12.2〜12.6 s（予測: Skill 30,020 / Gogma Reset 10,000 / Gogma Keep 299,500 / Normal 7,000、unsupported 0）
- structural search 48〜56 s、展開44 node（最大深さ43）、完全資源割当1件を検査し被覆棄却0件、coverage-driven orderingは一度も発動しない。
  最初のstructural candidate取得で停止（`candidate_limit_reached`。未探索部分あり、候補不存在とは言わない）
- **最初のstructural candidate**: ordinal 0、**objective 1,766**（B-2B / C-2と同じ割当）。stream終端 Skill 1,424 / Gogma 503。source: 所持巨戟38 / 新規Normal 5。
  Skill要件: none 21 / `reset_skills` 17 / `conversion` 5（すべて c = s*）。Bonus要件: `keep_from_source` 19 / `reset_then_keep` 23 / `reset` 1。
  Skill依存（設計 §8.2）5件: 巨戟化位置 363 / 378 / 399 / 410 / 478 のTargetがそれぞれ順序 0〜3、0〜4、0〜7、0〜8、0〜10のTargetを先行させる

### 5.2 Materialization（D-0A、最初のstructural candidate）

materialization順序の先頭8 Targetを試行し、**7 Targetがmaterialized**、8番目（順序7）が `unconfirmed(delivery_cap_reached)`、後続35 Targetは未試行。

| 順序 | source | option | 方式（規則） | 予測規模（conv / Gogma幅 / Skill幅 / forge） | 実測（配送 / settled work / Skill state / Gogma生成state） | 結果 | 時間（final run 1） |
| ---: | --- | --- | --- | --- | --- | --- | ---: |
| 0 | 所持巨戟 | `reset_skills(341)`、`keep_from_source(210)` | §9.2先（連続・所持巨戟） | 0 / 2 / 1 / 0 | canonical Ideal 1件 | materialized（§9.2） | 11 ms |
| 1 | 所持巨戟 | `reset_skills(343)`、`reset_then_keep(82,205)` | §9.1のみ（非連続） | 0 / 151 / 2 / 0 | 1 / 309 / 4 / 21,692 | materialized、`deliveredBeforeMatch` 0 | 0.38 s |
| 2 | 所持巨戟 | `reset_skills(348)`、`reset_then_keep(69,96)` | §9.1のみ | 0 / 41 / 6 / 0 | 1 / 31 / 21 / 99,687 | materialized、0 | 0.21 s |
| 3 | 所持巨戟 | `reset_skills(386)`、`reset_then_keep(63,100)` | §9.1のみ | 0 / 43 / 43 / 0 | 1 / 351 / 845 / 563,637 | materialized、0 | 1.0 s |
| 4 | 新規Normal | `conversion(363,363)`、`keep_from_source(173)` | §9.2先（連続・巨戟化） | 1 / 3 / 2 / 5 | canonical Ideal 1件 | materialized（§9.2） | 7 ms |
| 5 | 新規Normal | `conversion(378,378)`、`keep_from_source(157)` | §9.2先 | 1 / 4 / 2 / 22 | canonical Ideal 1件 | materialized（§9.2） | 7 ms |
| 6 | 所持巨戟 | `reset_skills(396)`、`reset_then_keep(140,192)` | §9.1のみ | 0 / 131 / 50 / 0 | 1 / 489 / 8,699 / 17,582,442 | materialized、0 | 30.2 s |
| 7 | 所持巨戟 | `reset_skills(422)`、`reset_then_keep(208,502)` | §9.1のみ | 0 / 437 / 75 / 0 | 500 / 2,304 / 35,767 / 73,081,949 | **`unconfirmed(delivery_cap_reached)`** | 132.5 s |

- 最初の未解決Target（順序7）の配送500件: 一致0件。照合理由の内訳は `source` 490件（**同じ種別・属性の別source**のRoute）、`skill_required` 470件、
  `normal_required` 20件、`gogma_required` 500件。同じsourceの10件は理由が `gogma_required` だけで、required Gogma {194, 202}（Gogma 202で終わる安いIdeal Route）。
  closest mismatchは配送420番目のそれ。期待形のrequired Gogma {208, 502} と同じ最終位置502のRouteは配送されていない
- **探索的cap5000でも一致0件**: 5,000配送のうち別source 4,874件、同じsourceの `gogma_required` だけの不一致126件はいずれも最終位置が502でない。
  Gogma streamは6本の合計で202 depth分しか読まれていない（1本あたりの深さはそれ以下）。期待形は、その時点のreservation（先行7 Entry: Gogma held 153 /
  blocked 11、Skill held 56 / blocked 7）のもとでGogma 55〜502の非held位置（448 − 153 = 295位置）をすべて自分で操作するRouteであり、
  own operation数を第1キーとする配送順序（SEARCH_SPEC 5.6.8の6キー順序）
  では、より操作数の少ないIdeal Route（別source、早い位置）がすべて先に配送される。**原因はcapの大小ではなく、期待形の配送順序上の位置である**
- Search規模gate超過は0件（巨戟化位置数は0〜1、幅はW0窓内）。fail closed・integrity issueは0件

### 5.3 時間・メモリ（final run 1 / run 2）

| 項目 | run 1 | run 2 |
| --- | ---: | ---: |
| child wall-clock | 235.1 s | 231.4 s |
| setup（module load・Export読込） | 0.8 s | 0.8 s |
| Phase 0 | 1.7 s | 1.7 s |
| ReachTable | 12.6 s | 12.2 s |
| structural search（最初の候補まで） | 55.7 s | 48.3 s |
| 静的診断（G1 / G3 / G4） | 3 ms | 3 ms |
| materialization | 164.3 s | 168.4 s |
| heapUsed最大 / RSS最大 | 2.53 GB / 2.80 GB | 2.51 GB / 2.80 GB |
| heap size limit | 4.50 GB | 4.50 GB |

envelope（30分 / 4,096 MB）には達していない。時間の大半は順序6・7の設計 §9.1 Search（Gogma held-aware streamの生成state 1,758万 / 7,308万）で、
Gogma生成state数は予測規模（Gogma幅）と比例しない（順序1: 幅151で2.2万、順序6: 幅131で1,758万）。予測規模はwindowの大きさであり、費用の予測値ではない。

## 6. G1 / G3 / G4の診断結果と観測範囲

| 診断 | 最初のstructural candidate（43 Target） | 観測範囲と注意 |
| --- | --- | --- |
| G1（Search-policy shape） | **0件**（巨戟化5件はすべて c = s*） | この1候補についての結果。synthetic testでは、coverage-driven orderingが最初の候補にG1形（c = 7 IdealでReset Skillsを9まで延ばし、Skill 8を被覆）を作る入力を確認し、Search前に `not_executed_search_policy` となること・後続候補が独立にmaterializeされることを固定した |
| 継続option | S1型0件。所持巨戟の継続（G2）は現行Phase Aが生成しないので観測対象外 | G2はPhase Aで未列挙なので、このExportに存在しないとは結論しない |
| G3 静的risk | 適用option 42（`keep_from_source` 19 + `reset_then_keep` 23）のうち **3件**（順序7: q = 216、順序24: q = 79 / 203、順序29: q = 101）。順序7のq = 216は順序24のTargetの、順序29のq = 101は順序32のTargetのrequired位置 | リスク条件であり発生ではない |
| G3 request上の条件 | 試行したのは順序7だけで、q = 216はそのrequestでfree（`collapseConditionHolds`） | 順序24 / 29は未試行 |
| G3 実測 | 順序7: `sameFinalPositionMismatches` 0、`collapseSignatures` 0（500配送。cap5000でも0） | 配送が期待最終位置502まで届いていないので、**実Exportでは発生も不発生も確認できていない**。synthetic test（§7）では、PA Searchが代表化によって同じ最終武器をrequired {q, g*} で返し、期待形を返さないこと（`unconfirmed(stopped_by_extent)`）を確認した |
| G4 | Planner開始時にIdeal武器を持つplanning Target **0件**（`deriveTargetSatisfaction()`。現在Bonusが `gogma_artian` でIdealの所持巨戟が無い） | このExportではG4-i / ii / iiiの対象が無い（§14のG4-ii判定修正の前のheadでの観測。対象Targetが0件なので、修正後の定義でも0件である）。G4-iiiは現行Phase A / Cが生成・受理しない（synthetic testでC-1が `invalid_option` で拒否することを確認）。G4の成否はPhase D'でしか決まらない |

### 6.1 G3は仮説として正しかったか

- **synthetic（確認済み）**: 所持巨戟のKeep chain（`keep_from_source(14)`）の範囲内に、chainと同じlayoutのReset結果を持つfreeな位置12があると、
  設計 §9.2の射影起点Candidate Searchも §9.1のPlanner Alternative Searchも、同じ最終武器をrequired {12, 14} のRoute（Reset 10〜12 → Keep 13〜14）で返し、
  期待形 {14} を返さなかった（Target outcome `unconfirmed(stopped_by_extent)`、closest mismatch `gogma_required`）。同じ位置12のReset layoutを変えた対照では
  期待形がmaterializeされた。位置12が先行Entryでblockedなら `collapseConditionHolds` はfalseになる。監査 §3.3の推定（コード読取）は、この合成入力では
  **実際のSearchの挙動として正しかった**
- **実Export（未確認）**: 静的riskは3件あり、試行した1件で条件が成り立っていたが、配送が期待最終位置まで届かなかったので、G3が起きたかどうかは観測できていない
- **分類上の帰結**: G3で期待形が返らない場合、現行の分類は `unconfirmed(stopped_by_extent)` / delivery cap / `shape_mismatch` のどれかになり、G1と同様に
  「cap / gate / envelopeの見直し」と誤読され得る（設計 §10.3に注記した）。D-0BはG3をSearch前に分類しない（リスク条件は発生の証明ではない）

### 6.2 G4に関するD-1での検証課題

このExportの最初の候補にはG4の対象が無いが、汎用には次をPhase D'（D-1）で確かめる必要がある（監査 §3.6 / §9.3）: G4-iのTargetのEntryがcommitされないこと、
G4-iiで別Targetの最初の操作によるin-flight化 → `hasIdeal` の再評価 → 実行可能かつcollisionなしならcommit（holding unitを既に通過していればcommitされない、
reserve後の再充足でcommitted Entryが解放される）、G4-iiiのP1〜P3。いずれもD-0Bの診断では候補を不成立にしない。

## 7. テスト

| file | 内容 |
| --- | --- |
| `materializationSearchPolicy.test.ts` | G1判定（c < s*でcがIdealのときだけ、c = s* / cが非Ideal / 所持巨戟は対象外）、opt-in時にSearch前で `not_executed(search_policy_shape)`・先行Targetの実績保持・後続未試行・Search API非呼出、opt-in無しでD-0Aの挙動と同一（`false` と無指定が同一、G1無しの候補はopt-in有無で同一）、observerが結果を変えず開始・照合・確定を順に通知しコピーを渡すこと |
| `materializationDiagnostics.test.ts` | G1一覧と継続option数、G3静的risk（`keep_from_source` / `reset_then_keep` の範囲）、**G3仮説の実Search確認**と対照、blocked位置で条件不成立、collapse署名と「別の安いIdeal Route」の区別、照合理由の集計、G4（ゼロ操作sourceとして参照されるだけのIdeal武器はG4-iでありG4-iiでないこと、どのoptionのsourceでもないIdeal武器はG4-i、他Targetが唯一のIdeal武器を実際に操作するとG4-ii（現行Phase Aがその操作optionを生成することも確認）、複数のIdeal武器の一部だけが操作される場合はG4-iで操作 / 非操作の武器を区別して記録、G4-iiiがC-1で拒否され分類器はG4-iiiと読むこと、Ideal武器が無い入力、診断の後も候補がmaterializeされること） |
| `materializationProtocol.test.ts` | smoke既定値の妥当性と根拠、条件・envelopeの不正値ごとの拒否（既定値で埋めない）、formal runの拒否、stage分類と §10.3上の役割（G1は `method_extension`）、journal（途中終了で実行中Targetに結果を付けない、切れた最終行、CRLF、非journal行） |
| `materializationRunner.test.ts` | Phase 0 → A → C-2 → D-0Aの接続（直接呼出しと同じ候補・同じEntry ID）、progress event順、summaryがTarget IDを含まないこと、2回実行でsemantic一致、structural candidate無し（`target_without_option`）、node budget到達（`structural_search_incomplete`）、G1でSearch前未実行と後続候補の独立、gate未実行と超過成分、cancel時の確定済みTarget保持、fail closedをoutcomeにしないこと、Phase 0停止、不正条件の拒否 |
| `scripts/planner-global-assignment-d0b-child-process.test.ts` | fake spawn（完了、timeout後のOOM署名でもtimeout、V8署名のOOM、他のFATAL ERRORはprocess failure、cancel（開始前・実行中）、起動失敗、spawn throw、1回だけsettle）と実子process（無限loopのtimeout、exit 3、模擬V8署名、record無しexit 0、AbortSignalのcancel）。**実際のOOMは起こさない** |
| `scripts/run-planner-global-assignment-d0b.test.ts` | usage・未知 / 重複 / 値なしoption・不正mode、formal runの拒否（何も書かない）、不正条件・既存output / run dir・Exportと同じoutput・不正hashの拒否、**実親process + 実子process** で不正ExportのchildがRESULTに `unmeasured(process_failure)` と journal確定分だけを残しexit 2になること、source scan（oracle・64桁hex・UUID・Planner / Trace Replay無し、`wx`、同期journal、B-2A runner / envelope非使用） |
| `isolation.test.ts`（更新） | D-0B moduleをruntime一覧へ追加、Production / 他scriptから到達しない（D-0B runnerを指定scriptに追加）、D-0B moduleがPlanner実行・Trace Replay・上界・conflict resolution・永続化・独自の予測 / Search呼出を持たないこと、runnerがD-0A経由でだけSearchし `searchPolicyPrecheck` を渡すこと、G4が `deriveTargetSatisfaction()` を使うこと |

既存のD-0A test（`materialize.test.ts` 等）とB-2A / B-2B test・scriptは変更していない。

## 8. smokeから言えること・言えないこと

言えること（このExport・W0・最初のstructural candidate・現行方式・非formal条件で）:

- runnerは実Exportを隔離processで最後まで処理し、2 runのsemantic recordが一致した
- 最初のstructural candidate（objective 1,766）の materialization順序の先頭7 Targetは、正式reservationと形状照合で、すべて最初の配送（または射影起点の
  canonical Ideal）で一致した
- 8番目のTarget（順序7）は、delivery cap 500でも5,000でも期待形が配送されなかった。配送されたのは別source（97〜98%）と、より早い位置で終わる同じsourceの
  Ideal Routeだった
- G1 / G4の対象はこの候補・このExportには無く、G3の静的riskは3件あった

言えないこと:

- Production Plannerでの成立（`verified`）・物理操作数・最短性。`all_materialized` にも達していない
- 順序7のTargetの期待形がSearchで得られない（不存在）こと。配送は期待形のown operation数に届く前にcapで止まっており、`shape_mismatch`（exhausted）ではない
- G3が実Exportで起きた / 起きないこと（配送が最終位置まで届いていない）
- G1 / G2 / G4が他の候補・他の入力で起きないこと（G2は列挙されていない）
- 後続35 Targetのmaterialize可否（未試行）
- 時間・メモリの一般性（1台のNode測定。Browser Workerでの実行可能性は別）

## 9. D-0A-2設計へ渡す入力

1. **配送順序と長いown chain**: 設計 §9.1の「正当なreservation + 形状照合」は、期待形のown operation数が多いとき実用的なdelivery数で期待形に届かない。
   順序7では、Phase Cの予測（`ownPositionCount` Gogma 75。被覆の他covererが揃う前提）と、materialize時点のreservation（先行7 Entryだけ）で期待形が実際に要する
   own operation（Gogma 55〜502の非held位置）が大きく乖離した。設計 §9.8 の (b)（materialization順序）と (c)（形状制約付き探索、監査 案B）の両方の根拠になる
2. **materialization順序**: 順序7は、巨戟化位置399のTargetのSkill被覆（設計 §8.2）の前提として、Gogmaだけを操作する21 Target（Skill要件 `none`）より先に
   置かれた。Gogma streamには存在制約が無い（§8.2）ので、Gogmaだけを操作するTargetを先にmaterializeすれば、そのrequired / chain位置がheld（required位置はblocked）に
   なり、順序7のown operationとG3 risk（q = 216は順序24のrequired位置）がともに減る見込みがある（未検証。順序規則の変更は設計判断）
3. **sourceの拘束**: Planner Alternative Searchはsourceを入力に取らない（materialize済みEntryの排他武器だけを避ける）ので、配送の大半が別sourceだった。
   形状制約付き探索ではsource（と巨戟化位置・最終位置）を拘束条件にすることが効く
4. **G3**: syntheticで機構を確認、実Exportでは未観測（静的risk 3件）。対応（B-ii、同値なrequired位置集合の受理、owner先行の順序）はD-0A-2で決める
5. **Search費用**: Gogma held-aware streamの生成stateが時間を支配した（1,758万 state 30 s、7,308万 state 133 s）。予測規模（窓幅）は費用と比例しない。
   gateをGogma幅で設定するなら、別の費用指標（own operation数の下限など）を検討する
6. **G1**: 分類規則は確定（§3.3）。この候補では0件だが、syntheticで最初の候補に現れる入力があるので、案BでG1形をmaterializeする経路は必要

## 10. D-0B-2で事前登録すべき項目

方式（D-0A-2）とoption集合（A-2）を確定した後の再smokeを根拠に、次を登録する（`MATERIALIZATION_D0B2_REGISTRATION_ITEMS`）:
delivery cap（D-0Bの500は暫定。最初の未解決はcapの大小でなかった）、Search規模gate（巨戟化位置数32は未拘束、幅はW0、費用指標の見直しを含む）、
child wall-clock / heap（D-0Bの観測: 約235 s、RSS 2.8 GB）、node budget（最初の候補に44 node）、structural candidate件数、option集合version（A-2）、
方式選択規則（D-0A-2の第3方式を含む）、G1の分類規則（本PRで確定した内容の固定）、materialization順序規則（変更する場合）。D-0B-2もformal runは開始しない。

## 11. validation

本PRで実行したもの（結果はPR本文に記載）: `git diff --check`、`npm run check:nul`、`npm run lint`、`npm test`、`npm run build`、
D-0B関連testの個別実行、実Export非formal smoke（§5）。

## 12. 変更していないもの

- Production（`src/domain` / `services` / `workers` / `pages` / `components` / `db`）、UI、Persistence、Worker protocol、RNG semantics、schema / version
  （`CURRENT_CALCULATION_APP_SCHEMA_VERSION` 17、`DATABASE_SCHEMA_VERSION` 10、`ExportRoot.schemaVersion` 13、`production-rng:c5-e7`。isolation testで固定）
- Phase A〜Cのoption集合・solver・coverage・value ordering・下界、D-0Aの照合規則・方式選択・Search規模予測（opt-inとobserverの追加のみ）
- B-2A / B-2B runner・envelope module・registration・正式RESULT、既存D-0A test
- 実Export本体・runの生成物はRepositoryへ追加していない（`.local/` はgit-ignored）。本書は集計値と順序indexだけを記録し、Target ID / OwnedWeapon ID / Candidate snapshotを載せない

## 13. 設計文書との関係

- 設計 §9.9 の「D-0Bへ残すもの」のうち、runner・非formal smoke・G1の扱いは本PRで実装した（設計 §9.10）。事前登録は §19.7のとおりD-0B-2へ移した
- 設計 §4.5 / §9.6 に `not_executed(search_policy_shape)` を、§10.3 にG1の確定規則とG3の分類上の注意を追記した
- 設計 §10.4 に、D-0Bのsmoke値が非formalの暫定条件であることを追記した
- 設計 §14 の表のD-0B行を改訂し、D-0A-2 / A-2 / D-0B-2の行を加えた（監査 §9.2の計画の採用）。§15.1の該当行を更新した
- 設計 §19.6 / §19.7 に、G1の分類名の確定とD-0Bの実施を追記した

## 14. レビュー対応（PR #246、`d9f6244` に対する修正）

| 区分 | 指摘 | 対応 |
| --- | --- | --- |
| Required fix | `diagnosePlannerStartIdeal()` が、別TargetがIdeal武器をsourceとして **参照するだけ**（ゼロ操作option）でもG4-iiに分類していた。G4-iiは別Targetがその武器を実際に操作し、in-flight化で充足が変わり得る場合である | Production Plannerの状態遷移を確認した（in-flight化は `sourceMutatedByOperation()` が返す変更操作の直後だけ、充足の再評価はin-flightでない在庫からの `deriveTargetSatisfaction()`、開始時に `hasIdeal` のTargetのEntryは `entryIsRelevantForState()` によりcommitされない、reserveはそのRoute自身の結果だけを書く）。G4-iiの必要条件を「他Targetのoptionが **操作する**（`operatesSource()`）」に改め、G4-iを「W_t のうち他Targetに操作されない武器が1つ以上残る」に整理した（§3.4の表）。ゼロ操作sourceの参照だけのケースはG4-iになる。複数のIdeal武器は、一部だけ操作される場合をG4-iとし、操作 / 非操作の武器を `operatedIdealWeaponIds` / `unoperatedIdealWeaponIds` に記録する。監査 §3.6 / §3.3 / §9.1 / §9.3と設計 §9.10 / §19.3を同じ定義へ揃えた |

影響の範囲:

- 変更したのは `materializationDiagnostics.ts` のG4分類とTarget行の2 field（`operatedIdealWeaponIds` / `unoperatedIdealWeaponIds`）、その test、文書だけである。
  分類名（`zero_operation_ideal` / `g4_i` / `g4_ii` / `g4_iii`）と件数のkey、`materializationRunner.ts` の集計・`summarizeMaterializationRun()`、
  `materializationProtocol.ts` は変わらない。semantic recordのG4 Target行には上記2 fieldが加わる
- G1 / G3診断、materializationの方式選択・照合・outcome、child process処理、delivery cap / gate、Production（changed files = `[]`）は変更していない
- §5 / §6の実Export smokeは修正前のhead（`4f1c148` / `01b740e` / `b7b7b00`）での観測であり、再測定していない。そのsmokeではPlanner開始時にIdeal武器を持つ
  planning Targetが0件だったので、G4の件数は修正前後のどちらの定義でも0件である（新しい2 fieldは当時のrecordには無い）。7 / 43 materialized・objective 1,766・
  G1 / G3の値はG4分類と独立である

## 15. D-0A-2設計からの注記（追記）

[D-0A-2設計](PLANNER_GLOBAL_ASSIGNMENT_D0A2_DESIGN.md)（docs-only）で次を記録した。§5 / §6の観測値・RESULT・runnerの挙動は変えていない。

- **G3の静的risk診断の範囲**: §3.4の静的riskは `keep_from_source` の origin 〜 g* − 1 と `reset_then_keep` の g1 + 1 〜 g* − 1 だけを走査する。D-0A-2設計 §3.7は、
  コード読取から、`reset_then_keep` で q < g1 のReset(q) がReset(g1) と同じlayoutを持ち、q 〜 g1 がheld（先行Routeのchain位置）のとき、frontier順の同点で
  q 側の履歴が代表になる下側の変種を推定した（未固定）。この変種は本PRの静的risk 3件の数え方に含まれない。数え方の拡張は、設計 §9.1（Planner Alternative Search）を
  使う規則 `d0a-v1` の診断としてD-0A-2bで扱う
- **D-0A-2への入力（§9）の扱い**: 1（配送順序と長いown chain）・3（sourceの拘束）・4（G3）・6（G1）は、B-ii（Search DomainのResearch専用seam）による形状制約付き経路で
  扱う（オーナー承認待ち）。2（materialization順序）は採らず、Phase Cの順序を維持する（D-0A-2設計 §8）。5（Search費用）は、同設計 §10.3の規模予測
  （depth、held窓、frontier上界）とbudgetで扱い、値はD-0B-2で登録する

## 16. D-0B-2（追記）

[D-0B-2記録](PLANNER_GLOBAL_ASSIGNMENT_RESEARCH_D0B2.md) で、option集合 `a2`・規則 `d0a2-v2` による実Exportの非formal再smokeと、D-0Cの正式計測条件の事前登録
（`MATERIALIZATION_D0C_PREREGISTRATION`）を行った。本書 §5 / §6の観測値・RESULT・runnerの `d0a-v1` の挙動は変えていない。

- 最初のstructural candidateはa2でも本書と同一（objective 1,766）で、`d0a2-v2` では43 / 43 Targetが `materialized`（Planner未検証）。本書の最初の未解決Target
  （順序7）は形状制約Searchの最初の配送で期待形になった（D-0B-2記録 §6.3）
- 計測HEADで `d0a-v1`（本書の既定値）を再実行し、semantic SHA-256が本書のfinal run（`53b1b77c…`）と一致した（D-0B-2記録 §8.1）
- 本書 §10の登録項目のうち `deliveryCap` / `searchScaleGate` / `searchPolicyShapeRule` は `d0a-v1` の項目であり、D-0Cの登録（規則 `d0a2-v2`）には含めない。
  `d0a-v1` は旧結果の再現と比較のために残す
