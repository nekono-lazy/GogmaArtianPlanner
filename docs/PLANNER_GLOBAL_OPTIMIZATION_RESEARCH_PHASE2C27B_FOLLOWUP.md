# Global Planner Research Phase 2-C2.7-B follow-up（計測結果に基づくGlobal候補選択方針の再整理）

Refs #154。**docs-only**。基準main: PR #218 merged `545d6ed3b6fe4fa4a5f94ccea904b4f6ba3dd28c`（作業開始時に `main` / `origin/main` / HEADの一致、
Working Tree clean、stashなし、open PRなしを確認）。

Production source、Search / Planner / RNG、Worker、UI、Persistence、schema / version、Production default / bounds、既存formal RESULT、既存Research
runner / analyzer、正式仕様の意味論は変更していない。新規Search run、formal measurement、full Planner run、Candidate生成も行っていない。

## 0. 位置づけとauthority

本書はResearch文書であり、正式仕様ではない。authorityは `AGENTS.md` の順位どおり `docs/REQUIREMENTS.md`（23 / 23.1）→ `docs/PLANNER_SPEC.md`
（9.2.18、9.2.19）/ `docs/SEARCH_SPEC.md`（5.6.8）→ その他の正式文書 → 実装 → test → 過去Researchである。本書は現行Production semantics
（REQUIREMENTS 23 / 23.1、PLANNER_SPEC 9.2.19.1〜9.2.19.16）を変更しない。

読んだResearch evidence（すべて読み取りのみ。SHA-256を照合した）:

| 資料 | SHA-256 | 扱い |
| --- | --- | --- |
| `docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_PHASE2C27A.md`（Phase A、事前登録） | `b45daa27…4147` | 変更しない |
| `docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_PHASE2C27B.md`（Phase B） | `e05eea56…ff9c` | 変更しない |
| `docs/PLANNER_GLOBAL_PHASE2C27B_RESULT.json`（Phase B formal RESULT） | `d79ea0de…b8e4` | 変更しない |
| `.local/PLANNER_GLOBAL_PHASE2C27B_RAW.json.local`（commitしない） | `f8c16d9f…3bed`（RESULT記載値と一致） | 読み取りのみ |
| `.local/c27b-formal.run/` のstart attestation / tasks record / found_R unit record 11件 | attestation `d76ebc4d…5c31`、tasks `7c4a7d98…026d`、unit recordはRESULTの `sources.unitRecords` と一致 | 読み取りのみ |
| `docs/PLANNER_GLOBAL_PHASE2C2_RESULT.json` の `baseline.summary` | 既存committed RESULT | baselineのselected Target集合の参照 |
| Export `gogma-artian-planner-backup_20260927015837.json`（commitしない） | `cc35fb5b…1e6b`（Phase B記載値と一致） | Entry ID → Target IDの対応だけを参照 |

§2.2の追加集計は上記recordの **読み取りと数え上げだけ** であり、新しいcalculation、oracle読み取り、Search / Planner実行は含まない。
Phase Bのdecision（`B2C27B_INCOMPLETE`）、per-Target class（`found_non_oracle` 11）、`found_R` の定義、exact 0 / 11（下限）を書き換えない。
過去の計測結果に新しい意味を後付けしないため、本書の新しい用語（§4.3）は次Phase以降の記録にだけ使い、Phase Bの記録へ遡って付与しない。

## 1. Phase Bの確定結果（再掲、変更しない）

| 項目 | 値 |
| --- | --- |
| decision | `B2C27B_INCOMPLETE`（invalid 0、unmeasured 8 = すべてtimeout） |
| exact recovered | 0 / 11（下限） |
| per-Target class | `found_non_oracle` 11 |
| 停止 | 11 / 11が `found_R`。うち10件がP1 rank 1のK0、1件（`t09`）がK1 rank 10 |
| `G` selected | 4 / 11（`t01`、`t07`、`t08`、`t09`）。7件はsupport集合外Entryとの暫定帰結で外れたまま `found_R` |
| unit | 575（L0 389 / L1 182 / L2 4）、trial 25、full Planner run 25 |
| 時間 | wall 267,868 s（約74.4時間）、Search（trial除く）234,119 s、trial 413 s、timeout分28,800 s |
| memory | child heap peak 9.26 GB、RSS peak 10.60 GB、OOM 0 |

Phase B §6の「言えないこと」（oracle非依存policyの不存在、`found_R` Route集合の43 Target共存、E2 / residual 3、Production default・runtimeとしての
許容、`found_non_oracle` Routeが共存可能な別解であること）は本書でもそのまま言えない。

## 2. 観測事実と推論の区別

### 2.1 事実（Phase B RESULT / 文書に記録済み）

- F1: K0（empty reservation）は各rungでdeliver 0ならextent boundで次rungへ進み、K0が初めてdeliverしたrungの最初のCandidateが1回目のtrialで
  `found_R` になった（10 / 10）
- F2: trial runはすべて `termination = exhausted`、Target 43件中completed 19〜21、Conflict 20〜22件
- F3: `t09` のK1 rank 2〜8の14 trialは、すべて `G` 自体はselectedだったがsupport Entryがselectedにならず（条件2）不採用。rank 9はtimeout、
  rank 10でsupport EntryもselectedになりK1の `found_R`
- F4: unit wallの約87 %がSearch、trialは413 s。timeoutはrank 8 / 9 / 11に集中
- F5: B2-C1（Phase A §4.2）でE1のK0 compatible件数は0。K0ではoracle Route（held位置を跨ぐRoute）はdeliverされ得ない

### 2.2 事実（既存recordの追加読取、本書で初めて集計）

#### 2.2.1 cost分解

unitを（rung、cardinality、outcome、deliver件数）で分けた合計（Phase B RESULT `units[]` のwallMs / `search.searchOnlyMs` / `search.deliveredCandidates`）。

| rung | K | outcome | deliver | unit | wall | 割合 |
| --- | --- | --- | --- | ---: | ---: | ---: |
| L0 | K0 | `stopped_by_search_extent_bound` | 0 | 9 | 0.03 h | 0.0 % |
| L0 | K0 | `found_R` | 1 | 2 | 0.02 h | 0.0 % |
| L0 | **K1** | `stopped_by_search_extent_bound` | **0** | **373** | **40.40 h** | **54.3 %** |
| L0 | K1 | timeout | — | 5 | 5.00 h | 6.7 % |
| L1 | K0 | `stopped_by_search_extent_bound` | 0 | 5 | 0.02 h | 0.0 % |
| L1 | K0 | `found_R` | 1 | 4 | 0.02 h | 0.0 % |
| L1 | **K1** | `stopped_by_search_extent_bound` | **0** | **162** | **24.99 h** | **33.6 %** |
| L1 | K1 | `stopped_by_candidate_trial_bound` | 3（×7） | 7 | 0.84 h | 1.1 % |
| L1 | K1 | `found_R` | 1 | 1 | 0.03 h | 0.0 % |
| L1 | K1 | timeout | — | 3 | 3.00 h | 4.0 % |
| L2 | K0 | `found_R` | 1 | 4 | 0.07 h | 0.1 % |
| 計 | | | | 575 | 74.41 h | |

- K1の `stopped_by_search_extent_bound` は **535 / 535 unitがdeliver 0** だった（L0 373、L1 162）。これだけでwallの87.9 %（65.4時間）
- K0 unitの合計wallは約0.17時間（全K0 unit 24件、1件あたり8〜86 s）
- K1 extent-bound unitのwall分布: p10 28 s / p50 250 s / p90 1,125 s / max 3,189 s（L0 median 200 s、L1 median 363 s）
- 停止したTargetごとの内訳: K0の合計は0.01〜0.03 h、K1の合計は0〜15.08 h。K0 L1で停止した `t00` / `t01` / `t07` / `t10` は、停止unit（15〜17 s）の前に
  K1 L0の42 unit（3.4〜5.4時間）を実行していた（rung-major規則による）

#### 2.2.2 `found_R` trialの帰結

baseline（元Build List 43 Entry、`conflictResolutions = []`、Research `maxPlanSteps = 20000`）は completed 20 / 43、Conflict 21、1,465 steps
（Phase 2-C2 RESULT `baseline.summary`、Phase 2-C1と一致）。停止trial（found unit record）と、元Route `O` / 勝者EntryのbaselineでのselectedをID照合した結果:

| Target | 停止unit | K | `O` はbaselineでselected | `G` の帰結 | `G` を外した勝者（Target ID先頭8桁） | 勝者はbaselineでselected | completed（baseline 20） | Conflict（baseline 21） |
| --- | --- | --- | --- | --- | --- | --- | ---: | ---: |
| t00 | t00-r01-L1 | K0 | false | dropped | `820831d0` | true | 20（±0） | 21 |
| t01 | t01-r01-L1 | K0 | true | secured | — | — | 21（+1） | 22 |
| t02 | t02-r01-L2 | K0 | **true** | dropped | `820831d0` | true | **19（−1）** | 21 |
| t03 | t03-r01-L2 | K0 | false | dropped | `cbdf9d8f` | true | 20（±0） | 22 |
| t04 | t04-r01-L2 | K0 | **true** | dropped | `cbdf9d8f` | true | **19（−1）** | 21 |
| t05 | t05-r01-L0 | K0 | false | dropped | `1f121742` | true | 20（±0） | 21 |
| t06 | t06-r01-L0 | K0 | false | dropped | `aa4e67d8` | true | 20（±0） | 21 |
| t07 | t07-r01-L1 | K0 | false | secured | — | — | 21（+1） | 20 |
| t08 | t08-r01-L2 | K0 | true | secured | — | — | 20（±0） | 21 |
| t09 | t09-r10-L1 | K1（support `820831d0`） | true | secured | — | — | 20（±0） | 21 |
| t10 | t10-r01-L1 | K0 | **true** | dropped | `820831d0` | true | **19（−1）** | 21 |

- E1 11件のうち6件（t01 / t02 / t04 / t08 / t09 / t10）は、元Route `O` で **baselineにおいて既にselected（完成）** だった
- `t02` / `t04` / `t10` の `found_R` は、`O` を `G` に置換したことで当該Target自身が外れ、completedがbaselineより1減った。それでも条件4（`G` がsupport集合外
  Entryとの暫定帰結だけで外れた）によって `found_R` が成立している
- dropped 7件の勝者は4種類で、すべてE1外かつbaselineでselectedのEntryだった。`820831d0` は3件（t00 / t02 / t10）で `G` に勝ち、かつ `t09` の
  found_R context（rank 10）のsupportでもある
- completedがbaselineより増えたのは2件（t01、t07）、Conflictが減ったのは1件（t07、21 → 20）だけである

#### 2.2.3 K1 support Entryとbaseline

`t09` のK1 context rank 2〜8のsupport Entry 7件は、**いずれもbaselineでselectedではなかった**（rank 2のsupportはE1 `t00` の現在Entry）。rank 10の
support（`820831d0`）はbaselineでselectedだった。trial runでsupportがselectedになったのはrank 10だけである。

#### 2.2.4 raw evidenceに残っている情報・残っていない情報

found_R unit record 11件（SHA-256はRESULT `sources.unitRecords` と一致）には次が残っている。

- 登録unit task（Target、context rank、reservation digest、support Entry ID、extent、開始時ladder state）
- 停止Candidateの `candidateStableKey()` 全文、delivery index、generated Entry ID、`route.operations`（Counter位置を含む）、final bonuses / scope / Skills、
  推定操作数、reservation check
- trial runのsummary（plan有無、termination、completed / total、step数、selected件数、Conflict件数、`G` のcommitment、勝者Entry ID、support
  selected / not selected、`G` とsupportの同時participant Conflictの有無）

残っていない（次Phaseの診断に必要だが記録されていない）もの:

- BuildCandidate snapshot全体（amendment / conversion trace、`intermediateStateGroups`、hash、必要素材）。`route.operations` から
  BuildListEntryを組み立てることは「Candidateの再構築」に当たるので行わない（§9.1で再deliveryとbyte照合に置き換える）
- trial runの `selectedBuildListEntryIds` 全体と、Conflictごとのkind / resource identity / participant（件数とboolean summaryだけが残っている）
- timeout 8 unitのrecord（unitは未計測で、record自体が無い）

### 2.3 推論（測定していない）

- I1（決定性からの反事実、未測定）: K0 unitの結果は、同じ (Target, K0) のladder stateだけに依存し、他contextの結果に依存しない
  （Phase A §6.2）。したがって同じ `found_R` 規則のまま「K0だけ先にL0 → L1 → L2を走らせる」順序にしていれば、K0で停止した10 Targetは同じ
  Candidateで、K0 unitの合計約0.17時間程度で停止したと推定できる。`t09` はK0 L2が未実行なので推定できない。これは同じ弱い停止信号を
  安く得るだけで、停止の質は変わらない（§3）
- I2: K1 L0 / L1でdeliver 0が535 / 535だったのは、held位置もextentに数える（Phase A §7.1）ためheld-aware Routeがwindowに収まらない、という
  読みが可能だが、本Phaseでは原因を調べていない。E1はextent不足として選ばれたpopulationなので、L0でdeliver 0になることはpopulationの
  選び方に由来する可能性が高く、「L0は常に無駄」と一般化しない（§7.2）
- I3: E1 Targetの6 / 11はbaselineで既に完成しているので、これらに代替Routeが必要になる理由は、当該Target自身の完成ではなく、`O` が使う資源を
  他Targetへ空けることにあると読める。`found_R` は `G` 中心の判定で、`O` を外したことで他Targetが完成するかを測らない。§2.2.2でcompletedが
  増えたのは2 / 11だけで、`found_R` の成立とGlobal完成への寄与は対応していない
- I4: 3件のdropped `G` が同じ `820831d0` に負けたことは、それらの `G` が `820831d0` の現在Routeと資源を共有していることを示唆する。
  11件の `found_R` Routeを同時に入れたとき共存する見込みは低いと読めるが、これは測定で確かめる（§9.1）

## 3. K0停止問題の分析

### 3.1 問題の構造

K0の `found_R` は、Phase A §6.4の条件2・3が空になるため、実質的に「`G` を入れたfull Planner runが `plan !== null` かつTrace Replay成功で、
`G` がselectedか、どのEntryかとの暫定帰結で外れた」だけを確かめる。baselineが21件の未解決Conflictを持つ状態では、`G` が外れても
条件4が成立しやすく、§2.2.2の通り当該Target自身が外れて全体completedが減る場合でも成立する。

一方、P1は構造上K0をrank 1に置き、rung-major規則はK0の上位rungを同じrungの全K1 contextの後に置く。結果として、

- 停止の判断材料はK0のほぼ無条件な `found_R`（停止の質の問題）
- 停止に至るまでのcostの大半は、その停止に寄与しないK1のdeliver 0 Search（costの問題）

という2つの問題が重なった。K0の順序を変えるだけでは前者が残り、停止条件を厳しくするだけでは後者が悪化する。

### 3.2 選択肢の比較

| 選択肢 | 何を変えるか | Phase B evidenceから言えること | 証明できること | 問題点 |
| --- | --- | --- | --- | --- |
| 1. K0でも `G` selectedを必須にする | K0の停止条件を「`G` selected」へ強める | K0停止10件のうち7件は成立しなくなり、3件（t01 / t07 / t08）は残る。K1で停止した `t09` は影響を受けない | `G` がbaseline-relativeな暫定帰結で外れないこと | baselineには21件の未解決Conflictがあり、`G` のselectedは無関係な競合の暫定帰結に左右される。共存の必要条件でも十分条件でもない（§4.2）。停止しない7 TargetはK1のL1 / L2へ進み、costが大きく増える（§9.2） |
| 2. K0をK1の後に評価する | 同じrung内のcontext順 | L0ではK1 contextが全件deliver 0だったので、L0で見つかるCandidateは変わらない（L0 K1が未実行の `t05` / `t06` を除く）。L1以上では未測定 | なし（停止条件は同じ） | 同じ弱い停止信号のまま、K0より前にK1を全件走らせるので、costは同じか増える |
| 3. K0ではTarget探索を停止しない | K0を停止信号から外す | 停止信号がK1以上の `found_R` だけになる | K1 `found_R`（support selectedを含む）は残る | 停止しない限りK ≤ 1全context × 全rungに近い探索になり、L2 K1は未測定かつ高cost（§9.2）。K0で見つかった有効なRouteを捨てる |
| 4. K0のCandidateも候補集合へ残し、Global共存評価で採否を決める | 「発見」と「採用」を分ける | K0 Candidateは安価（K0 unit合計約0.17時間）。4件は `G` securedで、K0を排除する根拠は無い | Candidate単体の有効性と、集合としての共存を別に判定できる | 停止条件の代わりに、発見の上限・候補集合の上限・Global評価の手順とbudgetを新しく定義する必要がある（§6） |

K0を排除することも、K0の `found_R` を共存の証拠とすることも採らない。empty supportで成立するRoute（現在originから、held位置を跨がずに
到達する代替）は有効な候補であり得る。実際、§2.2.2の4件（K0の3件とK1の1件）では `G` がsecuredだった。

### 3.3 結論

選択肢4を第一候補とする。選択肢1・2・3は、それぞれ単独ではK0停止問題を解決しない。

- 選択肢1は停止の質をbaseline-relativeな基準で少し上げるだけで、共存を証明しない
- 選択肢2は結果を変えずにcostだけを動かす
- 選択肢3は停止信号を失い、costの見積もりが立たない

ただしI1から、選択肢4の **発見段階** ではK0を（rung-majorではなく）K0だけ先に全rungで走らせる順序が安価な候補集合の作り方になり得る。
これは停止条件ではなく発見順序の候補であり、次Phaseで事前登録する（§9.2）。

## 4. `found_R` の適用範囲

### 4.1 `found_R` の歴史的な意味（固定）

`found_R` はPhase A §6.4 / Phase B §1.3で定義された、9.2.19.6のfound判定をspeculative support contextへ写したResearch trialの成立であり、次の4条件の
連言である（explicit decision Entry = fixed Route Entry = support Entry）。

```text
条件1  plan !== null かつ Trace Replay成功
条件2  support Entryがすべてselected
条件3  G とsupport Entryを同時participantとするConflictが無い
条件4  G がselected、またはsupport集合外Entryとの暫定帰結だけで外れた
```

この定義とPhase Bの記録は変更しない。Productionの `found`、REQUIREMENTS 23.1の「代替として成立」とも別物のままである。

### 4.2 停止条件として使えない理由

Production 9.2.19.6のfoundは、**ユーザーが明示決定したfixed Route集合** に対し「`G` がその決定と両立する」ことを確かめる判定であり、
fixed Route集合外のEntryとの新しいConflictは「新しく発生するConflict」として報告し、再帰的には解決しない（1段repair）。この前提では、
条件4は「決定と無関係な暫定帰結で外れることは許す」という意味を持つ。

Research写像ではfixed Route集合がspeculative support（K0では空）に置き換わるため、条件4が守る対象が無くなり、

- 当該Target自身が完成しない `G`（dropped）でも成立する
- 置換によって全体のcompletedが減る場合でも成立する（§2.2.2の3件）
- baselineの21件の未解決Conflictの暫定帰結に依存する

したがって `found_R` は「そのCandidateを候補集合へ入れてよい」程度の許容判定にはなり得るが、**Target探索を自動で停止する条件としては
次Phaseで使わない**ことを推奨する。比較可能性のために、次Phaseでも同じ規則で計算した値を診断fieldとして記録するのは構わない
（その場合もliteralは `found_R` のまま、意味はPhase A §6.4のまま）。

### 4.3 区別すべき段階（Research-only typed outcomeの提案）

Productionの `found` と混同しないよう、すべて `_R` で終わるResearch-only literalとする。下の段階ほど強い。各段階は「何に対して評価したか」
（`evaluatedAgainst`）を必ず持つ。`baseline` はbaseline PlannerInputへ1 Targetの置換だけを入れた評価、`replacement_set` は複数Targetの置換集合を
同時に入れた評価である。

| 段階 | literal案 | 成立条件 | 示すこと | 示さないこと |
| --- | --- | --- | --- | --- |
| R0 | `candidate_delivered_R` | Planner Alternative SearchがIdeal Candidateをdeliverし、reservation checkが通る | Search上の存在 | materialize可能性、Planner上の実行可能性 |
| R1 | `candidate_admissible_R` | materializer成功（`reusedExisting` でない）、9.2.18 replacement、preflight `ready`、full Planner run + Trace Replay成功（`plan !== null`） | Candidate単体がIdeal Routeとして既存Planner authorityで実行可能 | `G` の採用、他Targetとの共存 |
| R2 | `support_consistent_R` | R1かつ、reservationの前提となるsupport Entryがすべてselected、`G` とsupportの同時participant Conflictなし。K0では `support_vacuous` として区別する | supportの前提が評価対象のrunで実際に成立した | supportがGlobalに残ること |
| R3 | `generated_selected_R` | R1かつ `G` がselected | 評価対象のrunで `G` が暫定帰結に負けなかった | 評価対象run外での共存 |
| R4 | `joint_selected_R` | R2かつR3（`G` とsupport Entryが同時selected） | Candidateとその前提が同じrunで同時に成立した | 他TargetのCandidateとの共存 |
| R5 | `set_coexistent_R` | `evaluatedAgainst = replacement_set` で、集合内のすべての `G` とそのsupportが同時selected、集合内の2件以上を同時participantとするConflictなし、Trace Replay成功 | 置換集合としての共存 | 集合外Targetの完成、Conflict 0 |
| R6 | `global_complete_R` | 全planning Target（このExportでは43）がcompleted、未解決Conflict 0、`resource_conflict` による脱落0、Trace Replay成功 | Issue #154のacceptance（計算時間・memoryを除く） | Production runtimeとしての許容、別Exportへの一般化 |

- Phase Bの `found_R` は概ね「R1かつ（R2の条件2・3）かつ条件4」に当たり、R3 / R4より弱い（条件4がR3を要求しない）。Phase Bの記録に
  R0〜R6を遡って付与しない
- R2の「supportがselectedでない」は、そのrunでsupportが暫定帰結に負けたことを示すだけで、supportと `G` の資源両立不能を示さない（§5.2）
- R3 / R4を `evaluatedAgainst = baseline` で満たしても、R5の証拠にはならない。baselineの暫定帰結は、他Targetを置換すると変わる
- 当該Target自身の後退（`O` がbaselineでselectedで、`G` がdropped）は `target_regressed_R` のような診断flagとして記録し、baselineとの差分
  （completed / Conflict）と一緒に残す。後退を理由にCandidateを候補集合から自動で除くかどうかは事前登録で決める（§11）

## 5. speculative support Entryの扱い

### 5.1 G1を維持する

Phase A §2.2 / G1をそのまま維持する。speculative support Entryを、user-fixed Route、`PlannerConflictResolution`、`scenarioResolution`、
explicit resolution、9.2.19.6の明示決定Entry、repair lineageの決定 / fixed Entry、`selectedBuildListEntryId` のいずれにもしない。
support Entryはfull Planner runでは通常のBuild List Entry（resolutionなし）として扱う。

### 5.2 baselineでのsupport非選択とCandidate評価の両立

§2.2.3の通り、`t09` のK1 trialで条件2を満たさなかったsupport 7件は、そもそもbaselineでselectedではなかった。reservationはそのsupportの
Route（Counter進行・OwnedWeapon使用）が実行されることを前提に作られているので、supportが実行されないrunで条件2が満たされないのは
自然な帰結である。ただし次は言えない。

- 「supportがbaselineで非selectedなら、supportと `G` は両立しない」: supportが外れた理由は、support自身の別のConflictの暫定帰結であり得る。
  そのConflictの相手を置換すれば、supportはselectedになり得る
- 「supportがbaselineでselectedなら、support contextの `G` は共存する」: 観測は `t09` rank 10の1件だけで、§2.2.2の通りcompletedは増えていない

そこでsupportを前提とするCandidateを、**supportに条件づけられたCandidate** として扱うことを提案する。

```text
ConditionalCandidate_R（Research-only、概念名）
  targetWeaponId
  candidate              BuildCandidate snapshot（materializer出力。Routeから再構築しない）
  generatedEntryId       決定的ID（materializer出力）
  requiresSupport        support Entry ID集合（K0では空）
  reservationDigest      reservationの導出元を照合するため
  evidence               R0〜R4の段階（evaluatedAgainst付き）、baseline差分、target_regressed_R等
```

- `requiresSupport` は「このCandidateはこれらのEntryのRouteが実行される前提でSearchされた」という **依存関係の記録** であり、resolutionではない
- Global評価（§6）で `requiresSupport` のEntryが別Routeへ置換された、または集合から外れた場合、そのCandidateは失効（`support_expired_R`）
  とし、新しいsupport集合からreservationを導出し直してSearchし直す（自動で別support上の結果として読み替えない）
- support Entryがbaselineで非selectedであることは、contextの優先順位づけ（どのcontextを先に試すか）の材料には使ってよいが、contextや
  Candidateをcloseする理由にはしない。closeしてよいのは既存typed outcome（`not_found_within_search_extent`）だけである

### 5.3 support選択の源

Phase BはP1 rankの順にK1 contextを試した。§2.2.2 / §2.2.3は、trial runの暫定帰結に **具体的な勝者Entry**（`G` を外したEntry）が記録されることを
示している。これは「どの現在Routeが `G` を妨げているか」を、oracleなしで、既存Planner authorityの出力から得る情報である。次Phase以降では、
P1のような静的orderingの代わりに、**評価runで観測した阻害Entry（勝者、同時participant）をsupport候補にする** という導出を候補にできる。
これはProductionの9.2.19.3（ユーザーが優先したfixed Routeのreservation）と形が近いが、根拠がユーザー決定ではない点で同じくspeculativeであり、
G1の対象である。導出規則とその上限は事前登録する（§9.2）。

## 6. Candidate発見とGlobal採用の分離案

### 6.1 評価する構成（検討仮説）

```text
1. 発見      Target × support context × extentでSearchし、R0 Candidateを得る
2. 単体評価  R1（materialize、replacement、preflight、full Planner run + Trace Replay）。support contextではR2を記録
3. 候補集合  R1以上のCandidateをConditionalCandidate_Rとして保持（Targetあたり上限あり）
4. 集合評価  候補集合から各Target高々1件を選んだ置換集合を作り、full Planner run + Trace ReplayでR5を判定
5. 採用      最終の置換集合をordinary full Planner + Trace Replayで評価し、R6（または到達できた段階）を記録
```

この5段階は本書の検討仮説であり、確定した正式仕様ではない。

### 6.2 メリット

- 停止信号（Target単体のbaseline-relativeな判定）と目的（全Target共存）の不一致（§4.2）を、構成上解消できる
- 既存authorityだけで組める。単体評価は9.2.19.6と同じ部品（materializer、9.2.18 replacement、9.2.3.1 preflight、full Planner run + Trace Replay）、
  集合評価は `applyBuildListEntryReplacements()` / `validateBuildListEntryReplacements()` / `preparePlannerReplacementConflictPreflight()` が
  複数置換を受け取れるので、9.2.19.8.1のscenario compositionと同じ形（受理済み集合 + 1件）で組める
- costの非対称を利用できる。Phase Bではfull Planner runが1回約7〜25 s（25回で413 s）、Searchは1 unit数分〜60分超だった。Searchで得たCandidateを
  集合評価で何度も再利用すれば、高価な発見を繰り返さずに組合せを試せる。Phase 0 prototype（Search約89 %）とも整合する
- K0 Candidateを捨てずに済む（§3.2）

### 6.3 問題点

| 問題 | 内容 |
| --- | --- |
| 組合せ数 | 43 Target × Targetあたりk件の候補で、置換集合は最大 (k+1)^43。全列挙は不可能。full Planner run 1回約10 sでも、集合評価は単調合成（9.2.19.8.1型）、Conflict graphに沿った局所探索など、有界な手順に限る必要がある |
| 条件づけの連鎖 | support上で見つかったCandidateは、supportが置換されると失効する。alternative Routeがさらに別Targetのsupportになる（alternative-to-alternative）と依存がDAG化し、失効の伝播と循環防止（9.2.19.10と同種）が必要になる |
| 発見の停止 | `found_R` で止めないなら、Targetごとの発見をいつ止めるかを別に決める必要がある。deterministicなSearch work unitは存在しない（Phase A §7.5）ので、delivered件数・context件数・rungなどのsemanticな上限で表し、wall-clockはenvelopeとしてだけ使う |
| baseline依存の残存 | 単体評価（R1〜R4）は依然baseline-relativeで、候補集合へのadmissionをbaselineの暫定帰結に依存させると、§4.2の問題が形を変えて残る。admission条件はR1までにし、R3 / R4は優先順位づけに使うのが安全 |
| 置換のcardinality | 9.2.18 / Build List cardinalityにより、1回のrunで1 Targetにtemporary Entryは高々1件（`-O + G`）。候補集合はPlannerInputの外に保持し、runごとに各Target高々1件だけを入れる |
| Plan長 | Phase 0 prototypeは7,330 steps。集合評価でもResearch `maxPlanSteps = 20000` を使うことになり、Production A / B（Phase A §1）とは別物である |
| Production semantics | 自動で複数Routeを置換する集合評価は、REQUIREMENTS 23「明示的な選択が無い競合については自動で再検索を行わない」と両立しない。Research限定であり、Production化には契約変更が先に必要（§10） |

### 6.4 不足しているseam

| seam | 現状 | 必要なもの |
| --- | --- | --- |
| trial runの詳細記録 | Phase B recordはselected件数とboolean summaryだけ | Research recorderで `selectedBuildListEntryIds` とConflict（kind、resource identity、participant、暫定帰結）を記録する。Production型（`PlannerRunResult`）は既にこれらを持つので、Production変更は不要 |
| Candidate snapshotの保持 | Phase Bは停止CandidateのRouteとkeyだけを保存 | materializer出力（BuildCandidate snapshot、generated Entry）をResearch storeへSHA-256付きで保存する |
| 集合評価runner | 無い（Phase BはTarget単位のtrialだけ） | 複数置換の集合を1 runで評価するResearch harness。既存replacement / preflight / full runnerの組合せで表し、resolutionを合成しない |
| 条件づけCandidate型 | 無い | §5.2の `ConditionalCandidate_R`（Research-only） |
| 候補由来のreservation | `derivePlannerAlternativeReservation()` は `BuildListEntry[]` を受け取るので、generated Entryを渡すことは型上可能 | alternative Routeをsupportにする場合の導出・失効・循環の規則（docs） |
| 集合の選び方 | Production schedulerは割当を探索しない。Phase 0はprojected stateからの逐次探索 | 有界な集合構成規則（単調合成、Conflict graph由来の置換対象選択等）の事前登録 |
| user-fixed Routeとの区別 | Productionはuser-fixed Route（9.2.19.3）だけを持つ | user-fixed Route（resolution / lineage由来、authorityあり）と、Research集合評価で選んだRoute（authorityなし）を型と記録で分ける。後者をresolution / lineageへ書かない |

## 7. Search cost対策

### 7.1 Phase Bのcost構造（§2.2.1）

- deliver 0のK1 extent-bound Searchがwallの87.9 %。trial（full Planner run）は0.15 %
- deliver 0のunitは、extent内に何も無いことをSearchが確かめ終えるまで止まらない（中央値250 s、最大3,189 s）。早く止めるには新しい
  semanticな上限が必要で、wall-clockでは止めない（G7）
- timeout 8件（8時間）はrank 8 / 9 / 11に集中し、再実行していない（unmeasured）

### 7.2 対策候補

| 候補 | 内容 | 効果の根拠 | 注意 |
| --- | --- | --- | --- |
| C1. 発見順序をK0先行にする | 各Targetで、K0をL0 → L1 → L2まで先に走らせてからK1へ進む（context-majorはK0だけ） | I1。Phase BのK0停止10件は約0.17時間相当 | 停止条件ではなく発見順序。§6の候補集合と組み合わせて初めて意味がある |
| C2. 静的なK1全件走査をやめる | P1 rank順のK1全件ではなく、集合評価runで観測した阻害Entryをsupport候補にする（§5.3） | §2.2.2で勝者Entryが記録されている。K1 L0 / L1の535 unitは全件deliver 0 | 導出規則・上限は事前登録。oracleを使わない（勝者はPlanner出力） |
| C3. L0を飛ばす | E1ではK1 L0が全件deliver 0 | — | **採らない**。E1はextent不足として（oracle-informedに）選ばれたpopulationで、L0でdeliver 0になるのはpopulationの選び方による可能性が高い（I2）。Production default extentを先に試すladderの意味を、このevidenceで捨てない |
| C4. budgetの分離 | 発見（Search）、候補admission（trial）、集合評価（full Planner run）、envelope（wall / heap）をそれぞれ別のbudgetにする | Phase A §7.1の6概念に、候補集合上限と集合評価run上限を足す | どれもProduction boundではない。`maxCandidateTrialsPerTarget` / `maxPlannerReruns` へ合算・流用しない |
| C5. timeout / OOMの扱い | unmeasuredのまま記録し、条件を変えた再実行は別axisとして事前登録する | Phase A §6.2 / G6 | wall-clock timeoutをnot-found扱いしない |
| C6. 並列度 | concurrency 1、heap peak 9.26 GB、機械は32 GB / 16 logical CPU | wallだけを短縮する | semanticsは変えないが、memory競合でOOMが増え得る。envelopeとして事前登録する |

### 7.3 Search work unitについて

Phase A §7.5の結論（Production契約として使える安定work counterは存在しない）を変えない。本書でも架空のwork unitを定義しない。
次Phaseで発見を止める上限は、delivered Candidate件数、試したcontext件数、rungなど **Searchの意味論で数えられる量** で表し、
計算時間はexecution envelope（unmeasuredの判定）にだけ使う。

## 8. 選択肢の比較と推奨案

| 方針 | 概要 | 長所 | 短所 |
| --- | --- | --- | --- |
| X1. Phase A policy + K0で `G` selected必須 | §3.2の選択肢1でPhase Bを再実行 | 変更が小さい | 共存を証明しない。L2 K1へ進むためcostが大きい（§9.2の見積もりで少なくとも約20時間、上限は数百時間） |
| X2. K0の順序変更だけ | 選択肢2 / C1を単独で適用 | costが下がる（I1） | 停止の質が同じ。結果はPhase Bと同じ `found_non_oracle` 型になる見込み |
| **X3. 発見と採用の分離（推奨）** | 選択肢4 + §6の5段階。K0先行発見（C1）、候補集合、集合評価、阻害Entry由来のsupport（C2） | 停止条件と目的を一致させられる。高価なSearchを再利用できる。既存authorityで組める | 集合構成規則・失効・上限の設計が新しく必要。Production化には契約変更が必要 |
| X4. Phase 0 projected-state逐次探索の延長 | Phase 0（42 / 43、約657 s）を伸ばす | oracle-freeで既に42 / 43。速い | 前段区間内の空きCounterを使えない（Phase A §8）。現在originのreservation探索と別構成 |
| X5. X3 + X4 | X3で解けないTargetだけprojected stateへ回す | 両者の長所 | 2方式の組合せの意味論（Plan全体の一貫性）を別途整理する必要がある |

**推奨**: X3を次の研究方向とする。ただしいきなり新しいpolicyのformal runを行わず、まずPhase Bの既存 `found_R` 11件だけを使った低costの
共存診断（§9.1）で、「Target単体のtrialで止めたCandidate集合が、そのまま集合として共存するか」を測る。その結果を見てから、X3の発見・集合評価
policyを事前登録する（§9.2）。X4 / X5は、X3の集合評価が成立した後の比較対象（oracle-freeな到達水準42 / 43）として扱う。

## 9. 次の小規模Research仕様案

### 9.1 D1: Phase B `found_R` Route集合の共存診断（既存evidence再利用、最初に行う）

位置づけ: **診断** であり、新しいoracle-free formal executionではない。context・extent・Candidateを新しく選ばず、Phase Bが停止した11 Candidateだけを
使う。結果はPhase BのRESULT・decision・classを変更しない。oracle（RESULT、manifest、module）は読まない（post-hocでも読まない）。

| 項目 | 案 |
| --- | --- |
| 入力 | Export（`cc35fb5b…`）、Phase B RESULT（`d79ea0de…`）、raw（`f8c16d9f…`）、found_R unit record 11件（RESULT `sources.unitRecords` のSHA-256と一致するものだけ）、対応するunit task |
| R: 再delivery | 各found unitについて、記録済みtask（context、extent、開始時ladder state、excluded Route key）からExportだけでSearch入力を再導出し、`visitPlannerAlternativeCandidates()` を記録済みdelivery indexまで実行して `createPlannerAlternativeMaterializer()` でmaterializeする。`candidateStableKey()`・generated Entry ID・`route.operations` が記録とbyte一致しなければfail closed。Routeから直接BuildListEntryを組み立てない |
| S: 単体parity | 各 `G_i` についてPhase Bと同じtrial（`-O_i + G_i`、`conflictResolutions = []`、fixed constraint `[]`、`researchMaxPlanSteps = 20000`）を実行し、記録済みsummary（plan有無、termination、completed、step数、selected件数、Conflict件数、`G` のcommitmentと勝者）と一致することを確認する。同時に、記録に無かったselected Entry ID全体とConflict詳細（kind、resource identity、participant、暫定帰結）を記録する |
| P: pairwise | 55組 `{i, j}` について `-O_i -O_j + G_i + G_j` を1 runで評価し、各 `G` のselected、`G_i` と `G_j` の同時participant Conflict、completed / Conflictのbaseline差分を記録する（診断） |
| A: 集合 | 事前登録した集合だけを評価する。(a) 11件全部、(b) 単体で `G` securedだった4件（t01 / t07 / t08 / t09）、(c) Pの結果から決定的規則（Target ID昇順の単調合成: 受理済み集合 + 1件のrunで全 `G` selectedかつ集合内Conflict無しなら受理）で作った集合。(c)のrun数は高々11 |
| authority | 判定はordinary full Planner run（`createProductionPlanWithObserver()`）+ Trace Replayだけ。置換は9.2.18の部品、preflightは9.2.3.1。support / `G` のresolution、lineage、`selectedBuildListEntryId` を作らない（G1）。`t09` のsupport `820831d0` は通常Entryのまま |
| decision案 | `D1_INVALID`（再delivery / parity不一致、入力hash不一致、resolution 0件違反）→ `D1_INCOMPLETE`（登録runにunmeasured）→ `D1_FOUND_R_SET_COEXISTS`（(a)で11件すべての `G` がselected、集合内2件以上の同時participant Conflict無し、Trace Replay成功）→ `D1_FOUND_R_SET_PARTIAL`（(a)でselected 1〜10件、または(c)が2件以上）→ `D1_FOUND_R_SET_NOT_COEXISTENT`（それ以外） |
| 併記 | 各runのcompleted / 43、Conflict件数、baseline（20 / 21）との差、`target_regressed_R`、R3 / R5の該当 |
| envelope案 | 再deliveryはunitごと60分（Phase Bと同じ）、full runごと30分、child heap 12,288 MB、concurrency 1、retry / fallbackなし |
| 計測量の見積もり | 再delivery: Phase Bのfound unit wall合計約487 s（trial込み）。full run: S 11 + P 55 + A 高々13 = 約79回。Phase Bのfull run実績7〜25 s / 回から約10〜35分。全体で約1時間程度（見積もりであり、事前登録値ではない） |

言えること・言えないこと:

- `D1_FOUND_R_SET_COEXISTS` でも、言えるのは「Phase Bで止めた11 Candidateが、他32 Targetを元Routeのまま置いた状態で集合として共存した」ことまでで、
  43 / 43、Conflict 0、Issue #154のacceptanceは言えない（E1以外のTargetは元Routeのまま）
- `D1_FOUND_R_SET_NOT_COEXISTENT` は、Target単体の `found_R` で止める方式がGlobal共存の候補選択として不十分であることの直接evidenceになる。
  ただし、oracle-free policyが存在しないことは言えない
- Pの勝者 / participantは、§5.3の阻害Entry由来support導出（D2）の入力設計に使えるが、D1の中で新しいSearchは行わない

### 9.2 D2: 発見と採用を分離したpolicyの小規模比較（D1の後、事前登録してから行う）

D1の結果を見てから、X3のpolicyを事前登録する。登録時に必ず固定する項目:

| 項目 | 固定する内容の例 |
| --- | --- |
| policy | 発見順序（K0先行の有無）、候補集合へのadmission条件（R1まで推奨）、Targetあたり候補上限、集合構成規則（単調合成 / 阻害Entry由来support）、support失効規則、`target_regressed_R` の扱い |
| population | E1 11（Phase Bと比較可能）を最初に使う。baseline未完成23 Targetや43全体へ広げる場合は別登録。`oracleGuidedTargetPopulation` を記録 |
| extent | Phase Bと同じL0 / L1 / L2（比較可能性のため）。変える場合はoracle-informedかどうかを記録 |
| budget | 発見（delivered件数 / context件数 / rung）、admission trial、集合評価full run数、それぞれ別に。Production boundへ流用しない |
| decision rule | R5 / R6の到達件数、baseline比のcompleted / Conflict、unmeasuredの扱い（INCOMPLETEを先に判定） |
| execution envelope | unit / runごとのwall上限、heap、concurrency、retryなし |

K0早期停止を回避するpolicy候補ごとの計測量の見積もり（Phase B実績からの概算。いずれも見積もりで、事前登録値ではない）:

| 候補 | 新たに必要なunit | 概算 |
| --- | --- | --- |
| 選択肢1（K0で `G` selected必須、他はPhase A policyのまま） | 停止しない7 Target（t00 / t02 / t03 / t04 / t05 / t06 / t10）のK0継続（安価）、`t00` / `t10` のK1 L1（42 unit × 中央値363 s ≈ 各4.2時間）、`t05` / `t06` のK1 L0 + L1（≈ 各6.5時間）、escalationしたK1 contextのL2（Phase Bでは0 unit、未測定） | L2を除いても約20時間。K1 L2の実績は無い。参考としてB2-C2B2C（共通L2、10分上限、capture policyが異なるので直接比較はできない）では128 task中108がtimeoutで、60分上限ならTargetあたり最大約42時間（42 context × 60分）。上限は数百時間 |
| 選択肢2（K0をK1の後） | L0 K1が未実行の `t05` / `t06`（≈ 各2.3時間）、L1 K1が未実行の `t00` / `t01` / `t07` / `t10`（≈ 各4.2時間）、L2 K1（未測定） | 約20時間 + L2。停止の質は変わらない |
| 選択肢3（K0で停止しない） | K ≤ 1全context × 全rungに近い | 11 × 42 × (L0 + L1 + L2) で数百時間規模 |
| 選択肢4 + C1（K0先行で候補集合を作る） | 11 TargetのK0 L0〜L2（既計測24 unitは1件8〜86 s）、K0で追加Candidateをdeliverさせる場合はその分 | 1時間未満の見込み。K1は集合評価の結果から対象を絞って登録する（C2） |

このため、D2の最初の登録は「選択肢4 + C1でK0候補集合を作り、D1と同じ集合評価で共存を測る」小規模なものにし、K1（特にL2）を含むpolicyは、
集合評価の結果から阻害Entryと残Targetを確認した後に、範囲を限定して別登録することを推奨する。いずれも74時間級のformal runを最初から繰り返さない。

### 9.3 D1 / D2で守るguardrail（Phase AのG1〜G12に追加）

| ID | guardrail |
| --- | --- |
| G13 | Research typed outcome（§4.3）にProductionの `found` を使わない。`found_R` の意味（Phase A §6.4）を変えない |
| G14 | baseline-relativeな評価（R1〜R4）の結果だけで、context・Candidateをcloseしない。closeは既存typed outcomeに限る |
| G15 | 候補集合はPlannerInputの外に保持し、1 runでは各Target高々1件の置換（`-O + G`）だけを入れる |
| G16 | D1はPhase B evidenceの診断であり、Phase BのRESULT・decision・classを変更しない。D1の結果をPhase Bのdecision inputへ戻さない |
| G17 | Research集合評価で選んだRouteを、user-fixed Route、resolution、lineage、`selectedBuildListEntryId` として記録しない |

## 10. Phase 2-C2.8 / Production復帰の前提条件

Phase A §10.3（いずれも未充足）に加え、次が必要である。

Phase 2-C2.8（Global Planner段階）へ進む前提:

- D1の結果（Target単体の停止Candidate集合が集合として共存するかのevidence）
- §4.3のResearch typed outcome（R0〜R6）と `evaluatedAgainst` の確定（docs）
- §5.2の条件づけCandidateと失効規則、alternative-to-alternative supportの依存・循環規則（docs）
- 集合構成規則の事前登録と、そのrun budget（Production boundとは別）
- E2 9 Target（K2 context breadth）とresidual 3 Target（alternative-to-alternative support）の扱い（Phase A §10.4）
- Phase 0 projected-state方式（42 / 43）との比較基準

Production復帰の前提（Phase A §10.3の再確認と追加）:

- REQUIREMENTS 23の契約変更（明示的な選択が無い競合で自動再検索しない、を変えるかどうか）。プロジェクトオーナーの決定とdocs-only PRが先
- 現行9.2.19の1段repair（what-if / actual repairのfound判定、scenario composition、lineage、保存API）を変えない。Global候補選択は既存what-if /
  actual repairの中で暗黙に行わず、別の入口として設計する
- Research集合評価のRoute（authorityなし）とuser-fixed Route（authorityあり）の型・記録の分離（G17）
- context budget、候補集合上限、集合評価run budget、Search execution budgetの正式なbound定義（既存boundへ流用しない）。Search work unitの
  semantic authority（Phase A §7.5、未確定）
- Global PlanのPlan step bound（Phase 0 7,330 steps、Phase B trial 929〜1,465 steps）とProduction A / B（Phase A §1）の関係
- Browser Workerでの実測（Node / Vite SSRの値をProduction runtimeの根拠にしない）
- 同じPlannerInputに対するPlanner出力が変わる場合の `CURRENT_CALCULATION_APP_SCHEMA_VERSION` 境界の判断
- E1以外の集団・別Exportでの評価

## 11. 未決定事項

プロジェクトオーナーの判断、または次Phaseの事前登録で決める。

1. D1を次Phaseとして実施するか、その名称（本書では仮に「D1」。Phase A §10.2の「2-C2.7-C」はProduction compatible architecture設計を指すので、
   名称を混同しない）
2. D1の集合(c)の構成規則（Target ID昇順の単調合成で良いか、別の決定的順序にするか）と、decision名
3. R0〜R6のliteral名、`evaluatedAgainst` の値、`target_regressed_R` の扱い（候補集合から自動除外するか、記録だけにするか）
4. 候補集合へのadmission条件をR1にするか、R3（`G` selected）まで要求するか
5. Targetあたりの候補上限、発見の上限（delivered件数 / context件数 / rung）の値
6. support候補の源を、P1 rankの静的orderingのまま使うか、集合評価で観測した阻害Entryから導出するか（C2 / §5.3）
7. support失効時の扱い（再Searchを自動で行うか、候補を捨てるか）とalternative-to-alternative supportの循環防止規則
8. D2のpopulation（E1 11のままか、baseline未完成23 Targetか、43全体か）
9. execution envelope（concurrencyを1から上げるか、wall / heap上限）
10. X4 / X5（Phase 0 projected-state方式との組合せ）をいつ比較対象に入れるか
11. Production化を目指す場合のREQUIREMENTS 23契約変更の要否と時期

Issue #154はCloseしない。

## 12. 本Phaseで変更していないもの

Production source、Search algorithm / ordering / comparator、Planner scheduler、Planner Alternative kernel、Worker protocol、UI、Persistence、
schema / version（`CURRENT_CALCULATION_APP_SCHEMA_VERSION` 17、`DATABASE_SCHEMA_VERSION` 10、`ExportRoot.schemaVersion` 13）、RNG
（`production-rng:c5-e7`）、`defaultPlannerAlternativeSearchExtent`、Candidate Search default、`maxCandidateTrialsPerTarget`、`maxPlannerReruns`、
`defaultPlannerOptions`、`conflictResolutionPlannerOptions`、既存RESULT JSON、Phase A / Phase B文書、既存Research runner / analyzer、正式仕様。
新規Search run、formal measurement、full Planner run、Candidate生成、oracle読み取りは行っていない。

## 13. validation

- `git diff --check`
- `npm run check:nul`、`npm run lint`、`npm test`、`npm run build`（docs-onlyのため挙動変化は無い。結果はPRに記載）
