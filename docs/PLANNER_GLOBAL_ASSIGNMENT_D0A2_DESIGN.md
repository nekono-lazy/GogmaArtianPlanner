# Global Assignment Phase D-0A-2 設計（形状制約付きmaterialization）

Refs #154。**docs-only**（Research設計）。基準main: PR #246 merged `502f40d`（作業開始時に `main` / `origin/main` / HEADの一致、
Working Tree clean、stash / 追加worktreeなしを確認）。branch: `docs/global-assignment-d0a2-shape-constrained-materialization`。

本書は [Global Assignment設計](PLANNER_GLOBAL_ASSIGNMENT_DESIGN.md)（以下「設計」）§14 の **D-0A-2（形状制約付きmaterialization）** の詳細設計である。
入力は [D-0B準備監査](PLANNER_GLOBAL_ASSIGNMENT_IDEAL_CONTINUATION_AUDIT.md)（以下「監査」）と [D-0B記録](PLANNER_GLOBAL_ASSIGNMENT_RESEARCH_D0B.md)
（以下「D-0B記録」）である。

Production（Search / Planner / RNG / Worker / UI / Persistence / schema / version）、Research実装、test、計測コード、実Export、既存formal RESULTは
変更していない。Search実行・実Export run・計測は行っていない（Production changed files = `[]`）。本書のコード上の事実は基準mainのsourceを読んで
確認したものであり、行番号は基準mainのものである。記述の確度を次の語で区別する。

| 語 | 意味 |
| --- | --- |
| 確認済み（コード読取） | 基準mainのsourceで、該当する処理・型・呼出し経路を読んで確認した |
| 推定（コード読取、未固定） | sourceの処理から導いたが、testで固定していない |
| 未検証 | 実装・計測・testのいずれも無い。本書の設計上の主張 |
| 提案 | 実装Phaseで綴りを変えてよいが、意味と不変条件は本書に従う名前・型 |

## 0. 位置づけとauthority

正式仕様の順位は `AGENTS.md` のとおり `docs/REQUIREMENTS.md` → タスク別詳細仕様（本書では `docs/SEARCH_SPEC.md` 5.5 / 5.6.1 / 5.6.8、
`docs/PLANNER_SPEC.md` 7.0.2 / 9.2.13 / 9.2.19）→ その他正式文書 → 実装 → test → Research文書である。本書はResearch設計であり、正式仕様を変更しない。
正式仕様に追記が必要になり得る箇所は §14 に変更案として挙げるだけである。

本書が新設するのは、設計 §9.4（設計 §9.1 / §9.2 の経路の契約）とは **別の** Research専用materialization経路の契約（§5）である。§9.4の本文は変えず、
設計書には本書への参照だけを足す（監査 §10の方針どおり）。

表記: 「設計 §n」「監査 §n」「D-0B記録 §n」はそれぞれの文書の節、接頭辞の無い「§n」は本書の節である。

## 1. 結論

| # | 事項 | 決定 |
| --- | --- | --- |
| 1 | 主方式 | **B-ii**（Search DomainのResearch専用seam）。Search Domainに、Production callerが一切使わない **形状制約付きRoute探索** を設け、Research側の新materialization方式 `shape_constrained` から呼ぶ。形状制約はRoute base生成の前に、primitiveの選択 → source / Counter / production target → 巨戟化位置の順で適用し、`addBase()` は最終admissionだけを行う（§3.9 / §5.3）。Production fileの変更を伴うので、**実装PR（2a）の開始前にオーナー承認が必要**（§13） |
| 2 | B-i | **主方式にしない**。base取得・Skill lane・`keep_from_source` のBonus laneは公開APIだけで構成できる（§4.1）が、`reset` / `reset_then_keep` のBonus laneについて、held skip × family layoutによるstate数の増加（§3.6）とG3（frontier代表化、§3.7）を外側から抑える手段が無い。D-0Bの最初のstructural candidateでは43 Target中24 Target（`reset_then_keep` 23 + `reset` 1。D-0Bで未解決となった順序7のTargetを含む）がこれに当たる |
| 3 | G1 / G2 | 新方式が唯一の方式。lane開始状態がIdealでも、形が要求するlaneだけを開く（§6）。新方式を含まない方式規則（`d0a-v1`、D-0Bの再現用）では、G1を引き続き `not_executed(search_policy_shape)` とする。両軸Ideal sourceを自分で操作するG4-iiiのoption生成はA-2で決め、本方式はそれに従う |
| 4 | G3 | 新方式のBonus操作種別policy（Keep-only / Reset-only / g1のResetの後だけKeep）で、上側（D-0Bのsyntheticで確認済み）と下側（本書の推定、§3.7）の両方を代表化の対象外にする。同値なrequired位置集合の受理は採らない。G3専用の別PRは作らず、2a（policy）と2b（利用）で扱う（§7） |
| 5 | materialization順序 | **変更しない**（Phase Cの `deriveMaterializationOrder()` を維持）。Gogmaだけを操作するTargetの先行配置は依存関係上は常に安全だが、新方式の成否は順序に依存しない（§5.5の補題）ので必要が無い。再検討の条件と、採用する場合の変更範囲・test計画を §8に残す |
| 6 | 方式選択 | 規則 `d0a2-v2`（§11）: 継続形 → `shape_constrained` のみ、連続形 → 射影起点Candidate Search → `shape_constrained`、非連続形 → `shape_constrained`。設計 §9.1（Planner Alternative Search）は `d0a-v1`（D-0B再現）とparity testに残す |
| 7 | identity | 新algorithm token `global-assignment-d0a2-shape-constrained-materialization-v1`、Candidate ID prefix `candidate.research.global-assignment.shape.`（提案）。D-0Aのtoken・prefix・Candidate IDは変えない。Entry IDは既存deterministic materializerの規則のままで、同じ意味のRouteなら方式に依らず同じEntry IDになる（§3.8 / §9.1） |
| 8 | outcome | `materialized` / `unconfirmed(shape_search_budget_reached)` / `not_executed(search_scale_gate)` / `unsupported(required_prediction_unsupported)` / `unmeasured`。Bonus laneのsupportは、形が許す操作だけを、その操作を行うstage・stateでだけ評価し、形が禁止する操作のunsupportedは評価も報告もせず分類に使わない。形が必要とする予測のunsupportedは、Phase Aが同じ問いをsupportedと判定済みならfail closed（`prediction_support_inconsistent`）、判定が無ければ `unsupported`。base到達後に一致を返さず、必要な予測のunsupportedも無い終了は補題（§5.5）の前提違反としてfail closedし、`shape_mismatch` にしない（§10） |
| 9 | 正当性 | 全operation（chainを含む）の独立再予測、Counter進行と連続性、Keep入力layout、正式reservationとcoverage、Candidate / Entry validation、unit planのrequired位置照合を新方式の採用条件にする。継続形では必須、その他でも既定で実行する（§9.3）。parity testはPlanner Alternative Searchが返す形にだけ使う（§9.2） |
| 10 | PR分割 | 2a（Search Domain seam。Production file。要承認）→ 2b（Research方式・方式選択 `d0a2-v2`・独立検証器・parity）→ A-2 → D-0B-2 → D-0C → D-1（§12）。materialization順序の変更は計画しない |

## 2. D-0Bから引き継ぐ事実と、本書の前提

D-0B記録 §5 / §6 / §8 / §9の非formal smoke（W0、最初のstructural candidate、objective 1,766）の事実:

- materialization順序の先頭7 Targetがmaterializeされた（いずれも最初の配送、または射影起点のcanonical Idealで一致）。8番目（順序7、所持巨戟、
  `reset_skills(422)` + `reset_then_keep(208, 502)`）が `unconfirmed(delivery_cap_reached)`。delivery cap 500でも探索的な5,000でも期待形は配送されず、
  配送の大半（490 / 500、4,874 / 5,000）は同じ種別・属性の別sourceのIdeal Routeだった
- 順序7はPhase Cの予測では自分に帰属するGogma位置が75だが（`ownPositionCount`、他covererが揃う前提）、materialize時点のreservation
  （先行7 Entry: Gogma held 153 / blocked 11）では、期待形はGogma 55〜502の非held位置（448 − 153 = 295位置）をすべて自分で操作するRouteになる。
  Planner Alternative Searchの6キー順序の第1キーはown operation数なので、より安いIdeal Routeが先に配送される
- G1 0件、G4 0件、G3 静的risk 3件（実Exportでは未観測）。G3の機構はsynthetic testで確認済み
- 順序6 / 7のGogma held-aware streamの生成state数は1,758万 / 7,308万で、予測規模（Gogma幅）とは比例しない

次は **証明されていない** ので、本書の前提にしない。

- 順序7の期待形が、そのreservationのもとでSearchの空間に存在すること（§5.5の補題はこれを主張するが、補題自体は未検証である）
- materialization順序が順序7の未解決の唯一の原因であること
- 上記の数値の一般性。これらの数値はformal acceptance条件・性能目標・gate / budgetの登録値に流用しない（登録はD-0B-2の再smokeから行う）

## 3. コード確認: Search Domainのデータフローと拡張点

### 3.1 `visitPlannerAlternativeCandidates()` の構成（確認済み）

`src/domain/search/alternative/plannerAlternativeSearch.ts:120-300`。

1. 入力検証（`assertPlannerAlternativeSearchInput()`、`plannerAlternativeValidation.ts:205`）と、Engine versionとCalculationContextの照合（129-136）
2. `RouteSearchContext` の構成（138-198）: execution context、prediction support、stream別の `CounterReservation`、排他OwnedWeapon、
   `conversionSkillPositionLimit`、Target、originの入力、held-aware Skill / Bonus stream。**この構成を返すexportされたfactoryは無く**、関数内のlocal処理である
3. composition handler付きの `TargetSearchScheduler` を作る（202-212）。handlerは `createPlannerAlternativeCandidate()` でCandidateを作り、同じcostのものを
   bufferする
4. Route search primitive 3つを順に呼ぶ（218-229）。primitiveの `RouteSearchResult`（searched / skipped / notice）は捨てる
5. delivery loop（238-283）: 次のworkのlower boundがbuffer costを超えたら、6キー順（`compareConstrainedCandidates()`）でflushし、`candidateStableKey` で
   重複除去と除外を行ってconsumerへ渡す。そうでなければ `scheduler.step()` で1 workを確定する
6. 終了（287-299）: consumer stop、`stoppedByExtent`（schedulerの記録）、`exhausted`

### 3.2 Route baseの登録経路（確認済み）

Route baseはprimitiveの戻り値ではなく、`scheduler.addBase()` の呼出しとしてだけ現れる。同期に登録されるのは所持巨戟だけで、他はqueueを回して初めて登録される。

| primitive | 登録のタイミング | reservationの適用 | support / skipの判定 |
| --- | --- | --- | --- |
| `searchExistingGogmaRoutes()`（`existingGogmaRouteSearch.ts:57-205`） | 関数内で同期に `addBase()`（111-141）。保護武器は `startSkillCounter` / `bonusBase` をnullにする（120-128） | 排他OwnedWeaponをsourceにしない（24-27） | Skill / Gogma capabilityとinput supportから `canSkill` / `canAmend` |
| `searchOwnedNormalArtianRoutes()`（`ownedNormalArtianRouteSearch.ts:16-108`） | `conversionSkillPositions()` を待ってから、sourceごとに `lowerBound: 1` のworkをenqueue（68-78）。settle時に巨戟化位置ごとに `addBase()`（81-107） | 排他武器を除外。巨戟化位置はoriginから連続するheld区間の直後まで（`conversionSkillPositions()`、`routeSearchShared.ts:188-201`） | Skill input support、Gogma Reset support |
| `searchNormalArtianRoutes()`（`normalArtianRouteSearch.ts:182-481`） | 予測variant: Counterごとのoffset cursorを `lowerBound: forgeCount + 1` でenqueue（412-479）。settle時にNormal予測（memo）→ 巨戟化位置ごとに `addBase()` → 次offsetをenqueue。blind variantは `lowerBound: 3` のwork（310-353） | blockedのproduction targetを飛ばし（426）、held prefixのcanonical作成（419、`heldPrefixNormalCreation()`） | Normal / Skill / Gogma support。offsetがextentを超えると `noteExtentReached()`（413-417） |

### 3.3 `TargetSearchScheduler.addBase()` とcomposition（確認済み）

`src/domain/search/targetSearchScheduler.ts`。

- `addBase()`（213-297）はbaseの操作0の解（zero Skill / zero Bonus）をcrossへ入れ、**操作0の解がIdealでないときだけ** そのlaneのstream channelを購読する
  （Skill 278、Bonus 288）。これがlane開始Ideal規則（SEARCH_SPEC 5.6.1 / 5.6.8）の実装である
- channelはSkillが開始Counter、Bonusが `bonusStreamBaseKey()` で共有され、depthごとに `lowerBound = baseCost + depth` のworkになる（299-388 / 390-505）。
  Planner Alternative policyではIdealの解だけを公開する（324-326 / 433-435）
- Lazy Ideal Crossは非Idealの解を捨てる（`lazyIdealCross.ts:128` / `:134`）。したがって操作0の解がIdealならcompositionに入る
- Routeの組立ては `composeScheduledRoute()`（96-112）で、**module非公開** である。RouteKindの解決、amendment operationのsource binding、
  base operation → Bonus operation → Skill operationの連結を行う
- `addBase()`、`queue`、`step()`、`noteExtentReached()` はexportされたclassのpublic memberである

### 3.4 held-aware Skill stream（確認済み）

`src/domain/search/skillStream.ts:346-397`。stateは「最後のown operationの直後の位置」で、depth（own operation数）ごとに位置をkeyにして1つだけ持つ
（昇順の先行stateで最初に到達したもの）。過去のdepthはすべて保持する（`set.depths`）。Reset Skillsは置き換える前のSkillを読まないので、
状態にfamily layoutのような因子は無い。1 depthのstate数は窓内の位置数で抑えられる。

### 3.5 held-aware Bonus stream（確認済み）

`src/domain/search/bonusStream.ts:812-917`（`generateReservedDepth()`）。

- 各frontier stateの合法位置（`nextOperationPositions()`: `[from, 最初の非held位置] \ blocked`、`counterReservation.ts:63-76`）を集める
- Resetは **位置ごとに1つ** 生成する（849-861。親は1つ前のdepthのReset chain state）
- Keepは **frontier stateごと・その窓の位置ごと** に生成する（862-870）
- 生成した全stateを解として公開してから、frontierを (位置, ordered family layout) ごとに1つへまとめる（894-900）。代表は `lastResetDepth` 最大、
  同点は5枠のstable key（711-716）。frontierの並びは位置 → layout key（718-721）
- streamは `bonusStreamBaseKey()`（= 開始Gogma位置、`amendmentPolicy`、layout、1102-1111）ごとのsingle-pass cursorである（959-977）
- `BonusStreamBase.amendmentPolicy: 'keep_only'`（131-145）はheld-aware読取りでもResetを止める（833、778）。ただしProductionでこの値を渡すのは
  初回Candidate Searchのordinary読取りだけで（`normalArtianRouteSearch.ts:469`）、held-aware読取りとの組合せを固定するtestは無い（`keep_only` を含む
  test fileは無い）
- **support評価**: 各depthで、Resetのsupport（`predictionSupport.gogmaReset()`）を `keep_only` でも問い合わせ、unsupportedなら `reset_bonuses` の
  unsupportedとして記録する（832-834）。Keepのsupportは、窓が空でないfrontier stateごとに `gogmaKeep(state.bonuses)` で問い合わせて記録する（835-841）。
  extent到達の判定もReset / Keepのsupportを読む（777-782）。記録したunsupportedは `readReservedDepth()` の `unsupportedPredictions` として返り、schedulerの
  Bonus channelがnoticeとしてRoute baseへ流す（`targetSearchScheduler.ts:425`）。したがって操作種別を制限するpolicyを足すだけでは、形が使わない操作の
  unsupportedも報告される
- **primitive側のBonus stream base生成条件**: 新規Normal・所持通常のprimitiveは、Gogma入力が確定しEngineがGogma予測をsupportしていても、Resetの
  input supportが無いとBonus stream baseを作らない（`normalArtianRouteSearch.ts:388-401`、`ownedNormalArtianRouteSearch.ts:51-62`）。所持巨戟のprimitiveは
  Resetのsupportを条件にしない（`existingGogmaRouteSearch.ts:102-105`）

### 3.6 費用の構造（推定、コード読取）

depth d のBonus生成state数は `R_d + K_d` で、`R_d` ≤ 合法位置数（Resetは位置ごとに1つ）、`K_d` = Σ（frontier state）|そのstateの窓| である。
frontierは位置数 × family layout数まで、窓は長さHのheld runの中で最大 H + 1 になる。したがって `K_d` は「位置数 × layout数 × 窓」の積で増える。

- Route baseを1つに固定すると、読むstreamの本数（D-0Bの順序7では6本）は減るが、1本のstreamの1 depthあたりの項は減らない
- layout数の因子が消えるのは、Keepの入力layoutが1つに固定される場合（Keepだけ、または特定のResetの後だけKeep）だけである
- Skill streamにはlayoutの因子が無く、1 depthのstate数は位置数で抑えられる

D-0Bの観測（順序6: Gogma幅131で1,758万、順序7: 437で7,308万）が幅に比例しないことは、この構造（held分布と到達layoutへの依存）と矛盾しない。
矛盾しないことだけを述べ、構造の正しさの証明には使わない。

### 3.7 G3: Bonus frontier代表化の2つの変種

**上側（監査 §3.3のG3。D-0Bのsynthetic testで確認済み）。** `keep_from_source` g*、または `reset_then_keep` (g1, g*) のKeep chainの範囲に、
heldでない位置 q があり、Reset(q) のlayoutがchainのlayoutと一致する。qはheldでないのでどのRouteもqで操作し、qでのKeep stateとReset@q stateが
同じ (depth, q, layout) にまとまって、`lastResetDepth` の大きいReset@qが代表になる。以後の継続はrequired {q, g*} の履歴だけになる。
qがheldなら、qで操作しない最小depthのKeep-only履歴が残る（qで操作する履歴とはdepthが1つ異なり、同じkeyにまとまらない）ので、この変種は起きない。

**下側（本書の推定。コード読取、未固定）。** `reset_then_keep` (g1, g*) で、q < g1 の位置のReset(q) のlayoutがReset(g1) のlayoutと一致し、
q はblockedでなく、q から次の非held位置 r（g1 < r < g*）の手前まで（q と g1 を含む）がすべてheldである（つまり q と g1 は先行Routeのchain位置）。このとき:

1. Reset@q とReset@g1 は同じdepthで生成され得る（例: origin〜g1がすべてheldなら、どちらもdepth 1）
2. 両者からの r でのKeep stateは同じ (depth, r, layout) にあり、Keep結果は (位置, layout) だけで決まるので5枠も同一で、代表規則
   （`lastResetDepth`、5枠のstable key）が同点になる
3. 同点では先に生成された方が残る（894-900の `compareReservedRepresentative(state, current) < 0` のときだけ置換）。生成はfrontier順（位置昇順）なので、
   位置の小さいReset@q側の履歴が代表になり、以後の継続はrequired {q, g*} の履歴だけになる

解は代表化の前に公開されるので、r = g* なら期待形は配送される。影響するのは r < g* の場合だけである。D-0Bの静的risk診断（D-0B記録 §3.4）は
`reset_then_keep` について g1 + 1 〜 g* − 1 だけを走査するので、この変種を数えない（§14でD-0B記録へ注記する。観測値は変えない）。

どちらの変種も、Keepの入力履歴を「指定したResetの後だけ」に限るpolicyでは起きない（§7）。

### 3.8 Candidate / Entry identity（確認済み）

`src/domain/planner/replacement/plannerDeterministicMaterializer.ts`。

- Candidate ID = prefix + hash(search identity, Candidateのmeaning fingerprint)（68-78）。`searchRunId` はsearch identity
- Entry ID = `build-list.constrained.` + hash(meaning fingerprint, Target定義hash, `searchStateHash`, `referencedOwnedWeaponsHash`, CalculationContext)
  （94-112）。**search identityを含まない**
- meaning fingerprintはTarget、Route、最終5枠（多重集合）、scope、Series / Group Skillだけを読み（`buildListEntry.ts:85-96`）、ID・`searchRunId`・
  `createdAt`・観測traceを含まない

したがって同じ意味のRouteは、D-0Aの方式でも新方式でも同じEntry IDになり、Candidate ID・`searchRunId`・`BuildListEntry.candidateId` だけが方式で異なる。

### 3.9 `addBase()` より前に起きる処理と、制約を適用できる位置（確認済み）

Planner Alternative Searchでは、`addBase()` に届く前に次の処理が起きる（無制約の現行経路）。`addBase()` でbaseを選ぶだけでは、Candidateの配送は
減らせても、これらの処理は減らない。

| 段階 | 所持巨戟（`searchExistingGogmaRoutes()`） | 所持通常（`searchOwnedNormalArtianRoutes()`） | 新規Normal（`searchNormalArtianRoutes()`） |
| --- | --- | --- | --- |
| primitiveの起動 | 3種類すべてを順に起動する（`plannerAlternativeSearch.ts:218-229`） | 同左 | 同左 |
| support / capabilityの問合せ | Skill support（72-80） | Skill support（45-49）、Reset support（51-62） | Normal support（36-64）、Skill support（67-89）、Reset support（388-401） |
| sourceの列挙 | 互換・非排他の全所持巨戟（24-27） | 互換・変換可能・非排他の全所持通常（24-27） | 確定した全レア8 Counter（387） |
| 巨戟化位置の列挙 | — | `conversionSkillPositions()`（66）。originからheld区間を歩き、跨いだheld位置ごとにcheckpoint（`routeSearchShared.ts:188-201`、`counterReservation.ts:63-76`） | 同左（215） |
| queue work | なし（同期登録） | sourceごとに1 work（68-78） | Counterごとのoffset cursor。offsetごとに1 work（412-479）。blind variantは1 work（310-353） |
| 予測 | なし | 巨戟化位置ごとの `skillStream.predictAt()`（86） | offsetごとの `predictNormalArtian()`（431-435、memo）と、offsetごとに全巨戟化位置の `predictAt()`（430） |
| base登録 | sourceごとに1 base（111-141） | source × 巨戟化位置 | offset × 巨戟化位置 |

制約を適用できる位置は、早い順に次のとおりである（§5.3で契約にする）。

1. **primitiveの選択**（runner）: 形のbase種類に対応するprimitiveだけを起動する
2. **source / Counter / production targetの制限**（primitive内のsource・Counter・offsetの列挙）: 列挙に形の値の条件を加える。新規Normalではoffsetを
   p − origin の1つだけにし、他のoffsetのNormal予測とqueue workを作らない
3. **巨戟化位置の制限**（`conversionSkillPositions()`）: 正式な合法位置の判定（held区間の歩行）はそのまま行い、結果を c との共通部分に絞る。
   巨戟化Skillの予測は c だけになる
4. **最終admission**（`addBase()`）: 上記で残ったbaseが形と一致することを確かめ、laneを決める

1〜3を行っても、primitive 1つの起動、必要なsupportの問合せ、巨戟化位置の合法判定の歩行（予測なし）、新規NormalのNormal予測1回、巨戟化Skillの予測1回、
base登録のqueue work 1つ（所持巨戟は同期登録）は残る。D-0Bでは、base登録までの費用をSkill / Bonus streamの費用と分けて計測していない（instrumentationの
`onWorkSettled` はbase登録のworkも数え、予測呼出し回数は種類別に記録していない）。

### 3.10 Phase Aのsupport判定（確認済み）

`src/benchmarks/globalAssignment/reachTable.ts`。Phase AはTargetの種別 × 属性ごとにSkill / Reset / Normalのsupportを問い合わせて記録し
（`TargetReach.support`、unsupportedはsummaryへ）、Keepのsupportを **具体的な5枠の入力ごと** に問い合わせる（所持武器の5枠、新規Normalの予測5枠、
関心layoutのReset結果。276-310）。Keep supportはlayoutごとに記録し、同じlayoutの2つの入力でsupportが食い違えば「family-only Keep契約」の違反として
`engine_contract_violation` でfail closedする（240-256）。`keep_from_source` は `source.keepSupported`、`reset_then_keep` はsupportされたlayoutだけから
生成される（`reachOptions.ts:79` / `:206`）。

現行Production EngineのKeep supportは、weapon type / element、Master、各bonus typeのfamily読取り可能性だけで決まり、tierを読まない
（`productionRngEngine.ts:130-146`）。family-only契約はこの性質をResearch側の前提として固定したものであり、ゲーム規則ではない。

## 4. B-i / B-iiの実現性と方式の決定

### 4.1 B-i（Research側consumer、Production file変更なし）

公開APIだけで組むと、データフローは次になる。

```text
Research（B-i）
  1. context = visitPlannerAlternativeCandidates() の setup（3.1の2）と同じ部品で組み直す（複製）
  2. capture = TargetSearchScheduler の subclass。addBase() を上書きして base を記録し、channel を購読しない
  3. await searchExistingGogmaRoutes(context, capture)       // 同期に addBase → 記録
     await searchOwnedNormalArtianRoutes(context, capture)   // 巨戟化位置を待ってから queue へ
     await searchNormalArtianRoutes(context, capture)        // offset cursor を queue へ
  4. while (await capture.step()) {}                          // base 登録 work だけを消化（Normal 予測はここで起きる）
  5. base = 記録した base のうち形（source、巨戟化位置 c、production target p）に一致するもの
  6. Skill: context.skillStream.readReservedDepth(start, d), d = 1, 2, …  （s* で終わる解を選ぶ）
     Bonus: context.bonusStream.readReservedDepth(bonusBase', d), d = 1, 2, …（single-pass。g* と g1 で選ぶ）
  7. composeScheduledRoute() 相当を再実装 → createPlannerAlternativeCandidate()
```

| 部品 | 根拠の種類 | 評価 |
| --- | --- | --- |
| `TargetSearchScheduler` の `addBase()` / `queue` / `step()` / `noteExtentReached()` | exportされたclassのpublic member（型で保証） | 使える |
| primitiveがbaseを `addBase()` と `queue.enqueue()` だけで登録すること | 現行実装の振る舞い。文書化された契約ではない（ただしprimitiveはschedulerのpublic memberしか呼べないので、比較的安定） | 依存する |
| 遅延登録の順序（Normal offset cursor、所持Normalの `lowerBound: 1`） | 内部実装 | 依存する |
| contextの構成 | 関数内のlocal処理（3.1の2）。factoryが無い | 約60行の複製。乖離はparity testでしか検出できない |
| `composeScheduledRoute()` | module非公開 | 再実装（約15行） |
| `readReservedDepth()`（Skill / Bonus） | 公開interface。Bonusのsingle-pass consumer contractはSEARCH_SPEC 5.6.8に明文化 | 使える |
| `amendmentPolicy: 'keep_only'` × held-aware読取り | 型は公開、コードは対応（3.5）。Productionでは未使用・未test | `keep_from_source` にだけ使えるが、未使用の組合せに依存する |
| `reset` / `reset_then_keep` のBonus操作種別の制限 | **存在しない**（`'all'` しか無い） | 実現できない |

結論（確認済みの依存関係からの判断）:

- **実現できる**: base取得（1〜5）、Skill lane（lane開始Idealを含むどの形も。Skill streamはbaseのIdeal判定と無関係に読める）、Bonus laneが `none` または
  `keep_from_source` の形、composition（7、再実装）
- **実現できない**: `reset` / `reset_then_keep` のBonus laneで、layout因子とheld窓による生成state数（3.6）を抑えること。G3の両変種（代表化はstream内部で
  起き、consumerからは代表から落ちた履歴を取り出せない）。base登録前の費用（§3.9）を減らすこと（capture方式は3種類のprimitiveを起動し、全offsetの
  Normal予測と全巨戟化位置のSkill予測を経たbaseを捕捉してから選ぶ）
- D-0Bの最初の候補ではBonus要件が `keep_from_source` 19 / `reset_then_keep` 23 / `reset` 1で、D-0Bの未解決Target（順序7）は `reset_then_keep` である。
  監査 §7.2の見込み（Route baseを1つにすればD2-G-Aの爆発要因 = 巨戟化位置数 × depth × Skill stateを持たない）はSkill側については成り立つが、
  D-0Bで費用を支配したBonus held-aware streamの「layout数 × held窓」の項はRoute baseを固定しても残り、B-iはBonus laneの過半でそれを抑えられない
  （監査の当該記述へ §14のとおり注記する）
- したがってB-iは **部分的に実現可能** だが、D-0Bで明らかになった配送・費用の問題を解かないので主方式にしない。内部手順（遅延登録・context構成）への
  依存も、B-iiでは不要になる

### 4.2 B-ii（Search DomainのResearch専用seam）

Production callerの既存の経路は変えず、Research callerだけが形状制約を渡せる入口と、そのために必要な最小の任意引数をSearch Domainに加える。

| file | 変更（2a、提案） | Production caller（無指定）の挙動 |
| --- | --- | --- |
| `src/domain/search/routeSearchShared.ts` | `RouteSearchContext` に任意field `routeBaseConstraint`（Research専用、§5.3）。`conversionSkillPositions()` は指定時、正式な合法位置の判定（歩行）を行ったうえで結果を c との共通部分に絞り、`beyondExtent` を立てない | 未指定ならcode path・合法位置・checkpoint・`beyondExtent` は不変 |
| `src/domain/search/existingGogmaRouteSearch.ts` | 指定時、sourceの列挙に「形のOwnedWeapon IDであること」を加え、laneが `zero` の側のstream base（`startSkillCounter` / `bonusBase`）を作らない | 未指定なら不変 |
| `src/domain/search/ownedNormalArtianRouteSearch.ts` | 指定時、sourceを形のOwnedWeapon IDに限る。巨戟化位置は上記の共通部分。Bonus stream baseの生成条件は形のBonus laneが使う操作のsupportだけにする（§5.3の8） | 未指定なら不変（Reset supportの条件を含む） |
| `src/domain/search/normalArtianRouteSearch.ts` | 指定時、Counterを形のCounter IDに、offsetを p − origin の1つに限る（他のoffsetを予測もenqueueもしない）。blind variantを登録しない。巨戟化位置は共通部分。Bonus stream baseの生成条件は所持通常と同じ | 未指定なら不変（全offset、#104の規則、blind variant、Reset supportの条件を含む） |
| `src/domain/search/bonusStream.ts` | `BonusStreamBase` に任意field `shapePolicy`（§5.3）。held-aware読取り（`readReservedDepth()`）だけが解釈し、形が許す操作だけを生成し、そのsupportだけを、その操作を行うstage・stateでだけ評価・記録する。ordinaryの `readDepth()` / `solve()` は指定されたbaseを拒否する（throw）。`bonusStreamBaseKey()` は指定時だけ要素を足す | 未指定ならcode path、support評価とunsupported記録、stream key文字列、prediction、state、frontier、順序、single-pass cursorは不変 |
| `src/domain/search/targetSearchScheduler.ts` | constructorの任意の第4引数 `shapeFilter`（§5.3）。`addBase()` で最終admission（形に一致しないbaseを登録しない）、形が要求するlaneだけを（lane開始Idealでも）開く、形の最終位置で終わる解だけをcrossへ渡す、admitしたbaseのBonus noticeを `shapeFilter` へも渡す | 未指定なら現行どおり（`shapeFilter === undefined` の分岐だけ） |
| `src/domain/search/alternative/plannerAlternativeSearch.ts` | setup・登録・delivery loopを内部関数（例: `runPlannerAlternativeFrontier()`）へ抽出する。内部関数は起動するprimitiveの列を引数に取り、`visitPlannerAlternativeCandidates()` は従来の3種類を `shapeFilter` / `routeBaseConstraint` 無しで渡す（挙動不変のrefactor） | 入出力、配送順、summary、prediction回数、instrumentation / runtime observerの境界は不変 |
| 新規 `src/domain/search/research/`（名前は提案） | `visitShapeConstrainedRouteCandidates()`、型、入力検証、base到達の診断、route policy token。`src/domain/search/index.ts` から再exportしない | Productionから到達しない（isolation test） |

既定時不変の根拠と確認方法:

- 追加はすべて任意引数・任意fieldで、未指定時は既存の分岐をそのまま通る。抽出refactorは処理順を変えない
- 2aでは、変更の **前に** 現行コードに対するgolden test（既存fixtureでのPlanner Alternative Searchの配送 `candidateStableKey` 列・summary・
  種類別の予測呼出し回数、起動したprimitiveと登録したbase、通常Candidate Searchの結果、Bonus streamの `readDepth()` / `readReservedDepth()` の生成state列と
  support問合せ・unsupported通知）を追加し、変更後も同じであることを固定する。既存testは変更しない
- search identity（`createPlannerAlternativeSearchIdentity()`、`PLANNER_ALTERNATIVE_ROUTE_POLICY_VERSION`）、Candidate factory、Planner、永続形状は変えない。
  同じPlannerInputに対するProduction出力が変わらないので、`CURRENT_CALCULATION_APP_SCHEMA_VERSION` 17、`DATABASE_SCHEMA_VERSION` 10、
  `ExportRoot.schemaVersion` 13、`production-rng:c5-e7`、Master `dataVersion` 4はいずれも動かない（2aでisolation / version testに含める）
- 正式仕様: Production契約は変えないが、Search DomainにProduction非使用のResearch専用APIが入るので、SEARCH_SPECへの注記を提案する（§14、オーナー判断）

G1 / G2 / G3と費用:

- G1 / G2: lane開始Idealでも、形が要求するlaneのchannelを開く（§6）
- G3: Bonusの操作種別policyでKeepの入力履歴を1つに固定するので、両変種とも代表化が起きない（§7）
- 費用（base登録前）: 起動するprimitiveは1つ、sourceは1つ、新規NormalのoffsetはpだけでNormal予測は1回、巨戟化Skillの予測はcの1回、base登録の
  queue workは1つになる。巨戟化位置の合法判定の歩行（予測なし）とsupportの問合せは残る（§3.9 / §10.3）
- 費用（stream）: Keepの入力layoutが1つに固定されるので、frontierは位置数まで、1 depthの生成stateは「位置数 × 窓」までに抑えられ、layout数の因子が消える
  （推定。実測は2b以降・D-0B-2）。読むSkill / Bonus streamは各1本である。D-0Bで費用を支配したのはこのstreamの側であり、base登録前の費用とは分けて扱う

実装量の目安（実装前の概算であり確定値ではない）: 2aはProduction 7 file（各数十行。primitive 3つへの制約分岐、`routeSearchShared.ts`、`bonusStream.ts`、
`targetSearchScheduler.ts`、`plannerAlternativeSearch.ts` の抽出）と新規module（約200〜300行）、test（数百行）。B-iはResearchだけで同程度の行数を要し、
うち約75行がProductionの複製・再実装になる。B-iiは複製を持たない。

### 4.3 比較

| 観点 | B-i | B-ii |
| --- | --- | --- |
| Production file変更 | なし | あり（任意引数・任意fieldと抽出refactor、新規Research module）。**要オーナー承認** |
| Production挙動・計算版数 | 変わらない | 変わらない（golden testで固定） |
| base取得 | subclassで捕捉。primitiveの登録振る舞いと遅延登録の順序に依存。base登録前の予測・queue workは減らない | primitive選択・source / Counter / offset・巨戟化位置をbase生成前に制限し、`addBase()` で最終admission。内部手順への外部依存なし |
| context構成・composition | 複製・再実装（約75行） | 既存のものを共有 |
| G1 / G2 | 可能 | 可能 |
| `keep_from_source` | 可能（`keep_only` × held-aware読取りという未使用の組合せに依存） | 可能（policyとして明示し、2aでtest） |
| `reset` / `reset_then_keep` の費用 | 抑えられない（layout因子・held窓） | 抑えられる（layout因子が消える） |
| G3（上側 / 下側） | 解けない | 解ける |
| `matchExpectedShape()` との一致 | 選択時の条件と照合の二重化が必要 | stream段階で形の解だけを渡す。照合は検証として残す |
| 「見つからない」の意味 | Research側で新たに定義が要る。代表化があるので「無い」とは言えない | 補題（§5.5）により前提違反として扱える |
| 実装リスク | 合成の複製、内部手順への依存、未使用の組合せ | Production fileへの変更（既定時不変の証明が要る） |

### 4.4 決定

1. **主方式: B-ii。** 根拠は、B-iの不足（§4.1）がD-0Bの未解決Target（`reset_then_keep`、長いchain、別sourceの先行配送）とG3そのものであること、
   B-iiがそれらをbase生成前の早期制約、stream内部の操作種別policy、base admissionで解き、composition・context・Candidate factoryを共有して複製を
   持たないこと、未指定時の不変性を任意引数とgolden testで示せることである
2. **必要な変更**: §4.2の表（Production 7 file + 新規Research module）と、Research側の新方式（§5.4、2b）
3. **不採用方式（B-i）の理由**: §4.1の「実現できない」2点と、内部手順への依存
4. **主方式が成立しなかったときのfallback**（B-iiが承認されない、または2aで既定時不変を示せない場合）:
   - **F1（B-i限定）**: Research側consumerで、Bonus laneが `none` / `keep_from_source` の形（Skill laneは継続形を含む）だけを形状制約付きでmaterializeし、
     他は設計 §9.1 / §9.2。`keep_only` × held-aware読取りをResearch側testで固定し、Productionで未使用の組合せに依存することを記録する。
     `reset` / `reset_then_keep` の長いchainとG3は未確認のまま残り、D-0Cで全Target materializeは期待できない。必要ならmaterialization順序の変更（§8）を
     別PRで併用する
   - **F2（案C）**: D-0Aの方式のまま。G1は `not_executed(search_policy_shape)`、G2は未列挙
5. **実装前に承認が必要な事項**: §13

## 5. 形状制約付きmaterializationの契約（Research専用経路）

### 5.1 位置づけ

- 本経路は設計 §9.4の契約（§9.1 / §9.2の経路: Production Search APIの配送物を採用する）の **外** にある、Global Assignment Research専用の
  materialization経路である。Candidateは、Productionと同じRoute search primitive・stream・scheduler・Candidate factoryが、**Research専用のSearch policy**
  （形状制約）のもとで生成したものであり、Production Search APIの結果ではない
- 記録上は方式 `shape_constrained` とalgorithm token（§9.1）で区別し、Production Searchの結果として扱わない
- 生成EntryとreservationはResearch上のspeculativeな値であり（設計 §16、Phase 2-C2.7-A G1）、永続化せず、user-fixed Route・`PlannerConflictResolution`・
  repair lineageとして扱わない
- 成立の最終authorityはPhase D'（Production Planner + Trace Replay + fresh process）であり、本経路のmaterializedは `verified` ではない

### 5.2 入力

| 入力 | 内容 | 由来 |
| --- | --- | --- |
| Planner-start origin | `createPlannerStartSearchOrigin(plannerInput)` | Phase 0のPlannerInput |
| Target / ExpectedRouteShape | Phase Cの `expectedShapes`（`option`、`match`、`predicted`） | structural candidate（D-0Aの再導出検査を通ったもの） |
| source | 所持巨戟 / 所持通常のOwnedWeapon ID、または新規NormalのCounter IDとproduction target p | `option.source` |
| 巨戟化位置 | `conversion (c, s*)` の c（所持巨戟は無し） | `option.skillRequired` |
| required位置 | Skill: c（巨戟化）と s*（`c < s*` または `reset_skills` のとき）、Gogma: g*、`reset_then_keep` では g1、Normal: p | `shape.match.required` |
| 正式reservation | 先にmaterializeしたEntryから `derivePlannerAlternativeReservation()`（無ければ空）。**改変しない** | D-0Aと同じ |
| extent | 設計 §9.1の `extentFor(shape)`（Planner-start originから各streamの最後のrequired位置まで） | `shapeSearchExtent()` |
| Engine / CalculationContext | Production RNG Engine、PlannerInputのCalculationContext（Engine versionと一致すること） | Phase 0 |
| 規模gate / budget | §10.3 / §10.4。呼出し側が明示し、既定値を持たない | D-0B-2で登録 |
| cancel / yield | 既存Research seam（`shouldCancel()` / `yieldControl()`）。budget停止もこの経路で行う | runner |

### 5.3 Search Domain seam（2a）の契約

型は提案である（綴りは2aで変えてよい）。

```ts
// src/domain/search/research/shapeConstrainedTypes.ts（提案）
export const SHAPE_CONSTRAINED_ROUTE_POLICY_VERSION = 'research-shape-constrained-route-policy:v1'

export type ShapeConstrainedRouteBase =
  | { kind: 'owned_gogma'; ownedWeaponId: OwnedWeaponId }
  | { kind: 'owned_normal'; ownedWeaponId: OwnedWeaponId; conversionSkillPosition: number }
  | { kind: 'new_normal'; counterId: NormalArtianCounterId; productionTargetPosition: number; conversionSkillPosition: number }

/** zero: 操作0のSkill（所持巨戟の現在Skill、または巨戟化 c のSkill。c = s*）。reset_skills: 最後のReset Skillsが finalPosition */
export type ShapeConstrainedSkillLane = { kind: 'zero' } | { kind: 'reset_skills'; finalPosition: number }

/** zero: 所持巨戟の現在5枠（gogma_artian）。他は最後のBonus操作が finalPosition */
export type ShapeConstrainedBonusLane =
  | { kind: 'zero' }
  | { kind: 'reset'; finalPosition: number }
  | { kind: 'keep'; finalPosition: number }
  | { kind: 'reset_then_keep'; resetPosition: number; finalPosition: number }

export interface RouteShapeConstraint { base: ShapeConstrainedRouteBase; skill: ShapeConstrainedSkillLane; bonus: ShapeConstrainedBonusLane }

export interface ShapeConstrainedSearchInput {
  origin: ConstrainedSearchOrigin
  targetWeaponId: TargetWeaponId
  extent: PlannerAlternativeSearchExtent
  reservation: PlannerAlternativeReservation   // 検証・正規化はPlanner Alternative Searchと同じ
  shape: RouteShapeConstraint
}

/**
 * Research専用。`RouteSearchContext` の任意field `routeBaseConstraint`（Production contextは持たない）。
 * shape.base とlaneの必要操作から作り、Route search primitiveがbase生成前に読む。
 */
export type RouteBaseConstraint = { lanes: RouteBaseLaneNeeds } & (
  | { kind: 'owned_gogma'; ownedWeaponId: OwnedWeaponId }
  | { kind: 'owned_normal'; ownedWeaponId: OwnedWeaponId; conversionSkillPosition: number }
  | { kind: 'new_normal'; counterId: NormalArtianCounterId; productionTargetPosition: number; conversionSkillPosition: number }
)
/** 形のlaneが使う操作。primitiveのstream base生成条件と、問い合わせるsupportを決める */
export interface RouteBaseLaneNeeds { skillStream: boolean; bonusOperations: 'none' | 'reset' | 'keep' | 'reset_then_keep' }

/** baseに到達できない理由。prediction support以外の前提違反と、support・capabilityの不足を分ける */
export type ShapeBaseUnavailableReason =
  | { kind: 'source_not_found' | 'source_incompatible' | 'source_exclusive' | 'source_protected' | 'source_not_convertible' }
  | { kind: 'normal_counter_unavailable' }                                  // 形のCounterがTargetの種別・レア8・確定でない
  | { kind: 'production_target_blocked' | 'production_target_outside_extent' }
  | { kind: 'conversion_position_not_legal'; legalPositions: number[] }    // conversionSkillPositions() の結果に c が無い
  | { kind: 'capability_unavailable'; capability: 'normal_artian' | 'skill' | 'gogma' | 'keep_bonuses' }
  | { kind: 'prediction_unsupported'; prediction: 'normal_artian' | 'skill' | 'gogma_reset' | 'gogma_keep'; reason: RngPredictionUnsupportedReason }

export interface ShapeConstrainedSearchExecution {
  targetWeaponId: TargetWeaponId
  summary: { deliveredCandidates: number; exhausted: boolean; stoppedByExtent: boolean }
  stoppedByConsumer: boolean
  /** base到達の結果。admitted = false のとき、下記3の診断で最初に該当した理由 */
  base: { admitted: boolean; unavailable: ShapeBaseUnavailableReason | null }
  /** 形が必要とするBonus操作について、admitしたbaseのBonus streamが報告したunsupported */
  requiredUnsupportedPredictions: UnsupportedAmendmentPrediction[]
  /** 形が禁止する操作のunsupported notice数。禁止操作のsupportは評価しないので契約上は常に0（2aのtestで固定）。分類には使わない */
  forbiddenOperationNotices: number
}

export function visitShapeConstrainedRouteCandidates(
  input: ShapeConstrainedSearchInput, engine: RngEngine,
  onCandidate: PlannerAlternativeCandidateVisitor, options?: PlannerAlternativeSearchExecutionOptions,
): Promise<ShapeConstrainedSearchExecution>
```

**処理順**（既存のqueue構造に合わせた具体形。§3.9の制約位置1〜4に対応する）:

```text
visitShapeConstrainedRouteCandidates(input, engine, onCandidate, options)
  a. 入力・reservation・shapeの検証（予測なし）                              違反 → invalid_input / invalid_shape（throw）
  b. context = 共有のcontext構成（§3.1の2）+ routeBaseConstraint            予測なし
  c. base到達の診断（下記3）: primitiveと同じhelperを同じ順で評価する          不可 → primitiveを起動せず base.unavailable を返して終了
  d. RouteKind選択（下記2）: shape.base.kind のprimitiveだけを起動する
  e. 制約付きprimitive（下記4〜6）: 形のbaseだけを生成する
       所持巨戟:   形のsourceだけを同期に addBase（queue workなし、予測なし）
       所持通常:   conversionSkillPositions()（正式な歩行・checkpoint）→ [c]
                   → 1 work（lowerBound 1）→ settle: predictAt(c) → addBase
       新規Normal: conversionSkillPositions() → [c] → offset p − origin の1 work（lowerBound forgeCount + 1）
                   → settle: predictNormalArtian(p)（memo）→ predictAt(c) → addBase
  f. addBase(base): shapeFilter.admit(base) による最終admission → lane → channel購読と解の制限（下記7）
  g. scheduler.step(): Skill / Bonus streamのdepth読取り（下記8 / 9）、Lazy Ideal Cross、composition（下記11）
  h. 共有のdelivery loop（cost層単位のbuffer、6キー順）→ consumer（下記12）
```

base登録のworkとstreamのworkは同じ `SearchWorkQueue` に入る。streamのworkは `addBase()` で初めてenqueueされるので、base登録のworkが先に確定する。
cancel / budget（Research側の `shouldCancel`、§10.4）は、巨戟化位置の歩行で跨ぐheld位置ごとのcheckpoint、`scheduler.step()` ごとのcheckpoint、
primitive内のloopのcheckpointで、base登録前の処理にも作用する。所持巨戟の同期登録にはcheckpointが無いが、予測もqueue workも伴わない。

意味:

1. **入力検証**: Planner Alternative Searchと同じorigin / extent / reservationの検証に加え、shapeの構造（位置が非負整数、`resetPosition < finalPosition`、
   baseの種類とlaneの組合せ: 巨戟化baseはBonus lane `zero` を持たない、巨戟化baseのSkill lane `reset_skills` は `finalPosition > conversionSkillPosition`、
   各位置がextentの窓内）を検査し、違反は `invalid_input` / `invalid_shape` でthrowする
2. **RouteKind選択**: `owned_gogma` → `searchExistingGogmaRoutes()`、`owned_normal` → `searchOwnedNormalArtianRoutes()`、`new_normal` →
   `searchNormalArtianRoutes()`（predicted variantだけ）だけを起動する。形と無関係なprimitiveは起動しない。共有の内部関数は起動するprimitiveの列を
   引数に取り、Planner Alternative Searchは従来どおり3種類を渡す
3. **base到達の診断**: 下記4〜6と同じhelper（`selectCompatibleOwnedGogmaWeapons()` / `selectConvertibleOwnedNormalArtianWeapons()`、
   `isAvailableRouteSource()`、`selectSearchableNormalCounters()`、reservationの `isBlocked()`、`conversionSkillPositions()`、Engine capability、
   `predictionSupport.*`）を、source → Counter / production target → 巨戟化位置 → capability → laneが使う操作のsupport の順に評価し、最初に該当した
   理由を `ShapeBaseUnavailableReason` で返す。supportはNormal / Skill / Resetをweapon type × elementで、Keepは `keep` laneのときだけbaseの5枠で問い合わせる
   （`reset_then_keep` のKeep入力はg1のReset結果であり、予測前には無いので、streamの中でだけ評価する）。形が使わない操作のsupportは問い合わせない。
   予測は行わない（supportの問合せと位置計算だけ）。診断はadmissionを決めない（決めるのは4〜7）。
   診断が通ったのにbaseが登録されない場合はseamの契約違反である
4. **sourceの制限**: 3種類の制限を区別し、互いに代用しない
   - 正式reservationの排他source: 既存の `isAvailableRouteSource()`（変えない）
   - 保護武器の操作禁止: 既存の規則（保護中の所持巨戟はstream baseがnull、保護中の所持通常は変換元でない。変えない）
   - Research専用の期待source: `routeBaseConstraint.ownedWeaponId` との一致を、primitiveのsource列挙に加える。**reservationを編集して実現しない**
5. **Counter / production targetの制限**（新規Normal）: Counterは `routeBaseConstraint.counterId` のもの（`selectSearchableNormalCounters()` を通ること）だけ。
   offsetは p − origin の1つだけをenqueueし、それ以外のoffsetのNormal予測・queue workを作らない。p < origin、p − origin ≥ `maxNormalAdvance`、
   blockedのpは登録しない（診断で `production_target_*` になる）。作成は既存の `heldPrefixNormalCreation(reservation, origin, p)` のまま、
   lowerBoundは `forgeCount + 1`、Normal予測は既存memo経由のp 1回である。blind variantは登録しない（Global Assignmentはblindをoptionにしない）
6. **巨戟化位置の制限**: `conversionSkillPositions()` は、正式な合法位置の判定（originから `[from, 最初の非held位置] \ blocked` を
   `conversionSkillPositionLimit` まで歩く。§3.9）をそのまま行い、指定時は結果を `[c] ∩ 合法位置` に絞って、`beyondExtent` を立てない（c以外の位置は
   形の外であり、未読のworkではない）。巨戟化Skillの予測（`predictAt()`）はcの1回だけになる。cが合法位置に無ければbaseは生成されない
   （診断で `conversion_position_not_legal`）
7. **stream baseの生成条件・最終admission・lane**: 指定時、primitiveはlaneが使う操作のsupportだけを条件にstream baseを作る
   - Skill: laneが `reset_skills`、または巨戟化base（巨戟化自体がSkill予測）なら、既存と同じSkill capability / supportを要求する。所持巨戟でlaneが `zero` なら
     `startSkillCounter` を作らない
   - Bonus: laneが `zero` なら `bonusBase` を作らない。streamのlaneなら、Gogma入力の確定とGogma予測capabilityに加え、laneがResetを使う
     （`reset` / `reset_then_keep`）ときだけReset supportを、Keepを使う（`keep` / `reset_then_keep`）ときだけKeep capabilityを要求する。新規Normal・所持通常の
     既存の「Reset supportが無ければBonus stream baseを作らない」条件は、無指定時だけに残る。Keepの入力ごとのsupportはstreamが評価する（下記8）

   `addBase()` は `shapeFilter.admit(base)` で、`sourceOwnedWeaponId`、巨戟化の `skillCounterBefore = c`、新規Normalの `normalCounterAfter − 1 = p` と
   blind作成でないこと、形が要求するlaneのstream baseが非nullであることを確かめる（4〜6の後なので通常は一致する。不一致はseamの契約違反）。
   `zero` のlaneは操作0の解だけをcrossへ入れ、channelを購読しない。streamのlaneは **操作0の解をcrossへ入れず**、lane開始状態のIdeal判定に関係なく
   channelを購読する（G1 / G2）
8. **Bonus lane（`shapePolicy`）の生成規則とsupport契約**: primitiveのstream base（開始Gogma位置、5枠、scope）に `shapePolicy` を付けたbaseでheld-aware
   Bonus streamを読む。各stateは最後のResetの位置を内部fieldとして持つ（Reset stateは自分の位置、Keep stateは親から継承）。形が許す操作だけを生成し、
   その操作のsupportだけを、その操作を置けるstage・stateでだけ問い合わせる。形が禁止する操作のsupportは問い合わせず、unsupportedも記録しない

   | policy | 生成する操作 | 問い合わせるsupport | 問い合わせないsupport |
   | --- | --- | --- | --- |
   | `reset` | 窓の各位置でReset（`finalPosition` 以下） | `gogmaReset()`（そのdepthにResetを置ける位置が1つ以上あるとき） | Keep（`gogmaKeep()` を呼ばない） |
   | `keep` | 各frontier stateから、窓の各位置でKeep（入力は常にbaseのlayout） | `gogmaKeep(state.bonuses)`（窓にKeepを置ける位置があるstateだけ） | Reset（`gogmaReset()` を呼ばない） |
   | `reset_then_keep` | Reset段階: `resetPosition` 以下の位置でReset。Keep段階: 最後のResetが `resetPosition` にあるstateから、`resetPosition` より後の位置でKeep | Reset段階の位置があるdepthだけ `gogmaReset()`。Keep段階のstateだけ `gogmaKeep(state.bonuses)` | Reset段階のstateのKeep support、Keep段階のReset support |

   - 共通: `finalPosition` より後に自分の操作を置かず、窓をそこで切ってextent到達を記録しない（`reservedWindow()` のsupport読取りによるextent判定も
     行わない）。Reset chainの親の不変条件（`bonusStream.ts:849-861`）はResetを置ける位置だけに適用する。予測memo、held窓の規則、frontierの代表規則
     （(位置, layout) ごと、`lastResetDepth` 最大 → 5枠のstable key）、single-pass cursorは既存のまま
   - `reset_then_keep` のKeep段階は、g1のReset結果のlayoutを親のlayoutとして引き継ぎ（Keepはfamilyを保つ）、Resetを生成しない
   - `shapePolicy` は既存の `amendmentPolicy`（`keep_only`）と併用しない（併用はthrow）
   - crossへ渡すのは、最後のown operationの位置が `finalPosition` の解だけである
9. **Skill lane**: baseの開始Counter（所持巨戟はorigin、巨戟化は c + 1）から、既存のheld-aware Skill streamをそのまま読む。crossへ渡すのは、最後のown operationの
   位置（最後のstepの `skillCounterBefore`）が `finalPosition` の解だけである
10. **unsupportedの通知**: admitしたbaseのBonus streamが報告したunsupportedは、8の契約により形が必要とする操作のものだけであり、`requiredUnsupportedPredictions`
    に入れる。形が禁止する操作の種類のnoticeが現れた場合は `forbiddenOperationNotices` に数えるだけで、`requiredUnsupportedPredictions` に入れない。
    primitiveが自分の `RouteSearchResult` に積むwarning / skipped（Planner Alternative Searchと同じく捨てる）は分類に使わない
11. **composition / Candidate**: Lazy Ideal Cross、`composeScheduledRoute()`、`createPlannerAlternativeCandidate()`（最終状態のIdeal判定、`validateBuildRoute()`、
    origin基準の到達量、両hash、観測trace）をそのまま使う。Search DomainはCandidate ID・timestamp・identityを作らない
12. **配送と終了**: Planner Alternative Searchと同じcost層単位のbufferと6キー順。`excludedRouteKeys` は持たない（常に空）。終了はconsumer stop、
    `exhausted` / `stoppedByExtent`、cancel（`CandidateSearchError('cancelled')`）。shapePolicyのBonus streamは `finalPosition` で窓を切りextent到達を
    記録しないが、Skill streamには自然な終わりが無いので `stoppedByExtent` が立ち得る。summaryは両者を区別しないので、Research側は未配送の終了を
    `exhausted` / `stoppedByExtent` で分けない（§10.1）

**無指定時の不変性**: `routeBaseConstraint` / `shapeFilter` / `shapePolicy` のどれも渡さない経路（Production callerのすべて）では、起動するprimitive（3種類）、
source / Counter / offset / 巨戟化位置の列挙、support・capabilityの問合せとunsupportedの記録・notice、stream base生成条件、Bonus streamの生成state・frontier・
memo・single-pass、予測回数、Candidateの内容と順序、summaryを変えない（§15のgolden test）。

Seamが行わないこと: reservationの追加・改変、新しいprediction・RNG規則、新しいrequired / skippable・共有規則、Candidateの手組み、Planner判断（Counter
precondition、physical action identity、inventory）、形が禁止する操作のsupport評価。

### 5.4 Research側の手順（2b）

```text
materializeShapeConstrained(shape, materializedEntries, inputs):
  1. reservation = materializedEntries が空 ? 空 : derivePlannerAlternativeReservation(materializedEntries)   // D-0Aと同じ。改変しない
  2. extent      = shapeSearchExtent(shape, plannerStartOrigins(shape, table))
  3. routeShape  = toRouteShapeConstraint(shape.option)                       // §5.2の対応。option以外を読まない
  4. predicted   = predictShapeSearchScale(reservation, extent, routeShape)   // §10.3。予測しない・Searchしない
     premise     = checkMinimalRoutePremises(reservation, extent, routeShape) // §5.5の証明が使う位置条件（c が合法、p と required 位置が
                                                                              // blockedでない、sourceが排他・保護でない、required 位置がextent内）を位置計算だけで検査
     premise 違反 → fail closed（shape_base_unavailable）。gate 超過 → not_executed(search_scale_gate)
  5. identity    = shapeConstrainedSearchIdentity(...)                       // §9.1
  6. counted     = countingEngine(engine)                                     // §10.4。Production Engineへそのまま転送し、予測呼出しを種類別に数えるだけ
     execution   = visitShapeConstrainedRouteCandidates({ origin, targetWeaponId, extent, reservation, shape: routeShape }, counted,
                     candidate => {
                       entry = deterministic materializer（identity、prefix）.materializeBuildListEntry(candidate, PlannerInputのEntry).entry
                       validateBuildListEntry(entry)、matchExpectedShape(entry, shape)            // 不一致 → fail closed（match_inconsistent）
                       verifyShapeConstrainedRoute(entry, request, context, engine)            // §9.3。失敗 → fail closed
                       accept(entry); return 'stop'
                     },
                     { shouldCancel: () => userCancel() || budgetExceeded(), yieldControl, instrumentation: budget counters })
  7. 分類（§10.1）: accept → materialized。budget による停止 → unconfirmed(shape_search_budget_reached)。cancel → unmeasured(cancelled)。
     base未到達 → 理由により shape_base_unavailable（source・Counter・位置）/ prediction_support_inconsistent または unsupported（support・capability）。
     必要な操作のunsupportedがあり未配送 → prediction_support_inconsistent（Phase A判定あり）または unsupported(required_prediction_unsupported)（判定なし）。
     base到達・必要な操作のunsupportedなし・未配送 → fail closed（shape_constrained_unreachable）。forbiddenOperationNotices は分類に使わない
```

- RouteKind・source・Counter・production target・巨戟化位置は、Search Domain側でbase生成前に制限される（§5.3の2〜6）。Research側は形から
  `RouteShapeConstraint` を作るだけで、reservationを編集しない
- Reset→Keepの切替位置は `shapePolicy.reset_then_keep.resetPosition` = g1 で固定し、Keepはg1のResetの後だけになる
- `matchExpectedShape()` の完全一致は、stream段階の形の制限（4 / 5）によって構成上成り立ち、照合は独立した確認として残す（一致しなければfail closed）

### 5.5 最小Route存在補題（設計上の主張。未検証、2bでproperty testにより固定する）

**前提**

- P1: structural candidateはPhase Cがその割当から導出したものであり（D-0Aの再導出検査）、各optionは `rng_replayed`（required-only再生でIdeal）である
- P2: 先行Targetは、Phase Cのmaterialization順序で、いずれかの方式によりそれぞれの形に一致するEntryとしてmaterializeされている
- P3: reservationはそれらのEntryから `derivePlannerAlternativeReservation()` で導出した正式な値である（held = 先行Routeの全unit位置、blocked = その必須かつ
  共有不可unitの位置、排他武器 = その参照武器）
- P4: extentは `extentFor(shape)` である
- P5: EngineはPhase Aと同じであり、R_minが必要とする各予測のsupportは、Phase Aがsupportedと判定した問いと同じ答えになる。Normal / Skill / Resetは
  weapon type × elementの問い（`TargetReach.support`）、Keepはfamily layoutの問いである。Keepについては、Phase Aが課すfamily-only Keep support契約
  （同じlayoutの入力はsupportが一致する。`reachTable.ts:240-256`、§3.10）を前提にする。現行Production EngineのKeep supportはtierを読まないので
  （`productionRngEngine.ts:130-146`）、chainの途中のKeep入力（Keep結果。sourceやg1のReset結果と同じlayout）もこの契約の範囲にある。Engine capability
  （`supportsGogmaPrediction` 等）はPhase Aが読まないので、P5にはcapabilityが真であることを含める
- P6: seamは §5.3の規則（早期制約、stream base生成条件、`shapePolicy` の生成規則とsupport契約、admission）どおりに実装されている

**主張**: このとき、対象Target t について、source・巨戟化位置・production target・stream別required位置・最終武器が形と一致するRoute R_min が
形状制約付き探索の空間にあり、最初に配送される。

**証明の概略**

- base: 所持武器はC1により先行Targetのsource（排他武器）でない。新規Normalのp はC2により先行Targetのproduction target（blocked）でない。
  巨戟化位置 c は、Phase Cの順序の自己検査（`deriveMaterializationOrder()`、`coverage.ts:397-449`）により c より前のSkill位置がすべて先行Targetに帰属し、
  先行Routeはそれぞれ自分の開始位置から最後の操作までを自分の操作かheldで埋める（coverage条件）ので、origin〜c − 1 はすべてheldであり、c はC2によりblockedでない。
  よって `conversionSkillPositions()` の合法位置は c を含み、`[c] ∩ 合法位置` = [c] である
- 早期制約はR_minのbaseを除かない: 起動するprimitiveは形のbase種類のもの、source / Counter / offsetの制限は形の値そのもの、巨戟化位置の制限は
  正式な合法位置との共通部分であり、作成（`heldPrefixNormalCreation()`）・予測（memo）・baseの内容は無制約時に同じ値で登録されるbaseと同じである。
  stream baseの生成条件はlaneが使う操作のsupport / capabilityだけで、P5によりR_minの操作はそれを満たす。よって形のbaseが登録・admitされる
- R_min: 各streamで、自分の操作を「窓内の非held位置 ∪ 自分のrequired位置」に置き、それ以外のheld位置は跨ぐ。非held位置はblockedでなく
  （blocked ⊆ held）、required位置はC2によりblockedでないので、すべて合法であり、coverage条件を満たす。操作種別は形のとおり（Skill: Reset Skills、
  Bonus: `reset` はReset、`keep` はKeep、`reset_then_keep` はg1以下でReset・g1より後でKeep）で、shapePolicyが許す
- 予測: 必要な予測（Normal p、巨戟化 c、各Reset Skills、各Reset / Keep）はP5によりsupportされる（`keep_from_source` のsource layoutと `reset_then_keep` の
  layout(Reset g1) はPhase AでKeep supportを確認済みで、chainのKeep入力はすべてそのlayoutを持つ）。形が禁止する操作のsupportは `shapePolicy` が問い合わせ
  ないので、R_minの生成を妨げない
- 最終武器: Reset Skills / Resetは位置だけ、Keepは (位置, layout) だけで結果が決まるので、R_minの最終武器はrequired-only再生の結果と同じで、P1によりIdeal
- required位置: `createPlannerRouteUnitPlans()` のskip規則（`plannerRouteProgress.ts:279-314`）で、巨戟化は常にrequired、Reset Skills連鎖・Reset / Keep連鎖は
  laneの最後だけrequired、`reset_then_keep` ではKeepが続くg1のResetがrequired、Normalはproduction targetだけがrequiredなので、形のrequired位置と一致する
- 配送順: 形に一致するRouteは「非held位置 ∪ required位置」を必ず含むので、R_minのown operation数が最小で、その集合は一意である。6キー順の第1キーで
  最初に配送され、決定的である

**帰結**: 前提が成り立つ限り、形状制約付き探索が一致を配送せずに終わることは無い。前提のどれが破れたかで分類を分け（§10.1）、どれも「形が存在しない」へ
読み替えない。

- source・Counter・位置の前提（P1〜P4）の破れは、base到達の診断で `shape_base_unavailable` になる
- support・capabilityの前提（P5）の破れは、Phase Aが同じ問いをsupportedと判定していれば `prediction_support_inconsistent`（fail closed）、判定していない
  問い（capability等）なら `unsupported` になる。いずれも「必要な予測が得られない」という事実で、形の不在ではない
- baseに到達し、必要な操作のunsupportedも無いのに未配送で終わった場合（`exhausted` / `stoppedByExtent`）だけを、補題の破れ（`shape_constrained_unreachable`）とする

補題は2bのproperty test（§15）で固定するまで未検証であり、実Exportでの成立はD-0B-2の再smokeで確かめる。P5のうちfamily-only Keep契約はPhase Aが
自分の入力について検査している（§3.10）が、chain途中のKeep入力についてはEngine実装の性質（tierを読まない）に依存するので、2aでsupportが非対称な
mock Engineを使い、契約が破れた入力で上記の分類になることを固定する。

### 5.6 不変条件

- 正式reservationのheld / blocked / 排他武器を形状制約に流用しない・追加しない・改変しない。形状制約は別の入力（`RouteShapeConstraint` と、
  それから作る `routeBaseConstraint`）である。期待sourceの制限・巨戟化位置の制限・offsetの制限はいずれもreservationの外で行う
- 未materialize Targetの位置をreservationへ先取りしない
- 巨戟化位置の合法判定は `conversionSkillPositions()` の正式な歩行を省かない。形の c はその結果との共通部分としてだけ使う
- 形が禁止する操作のsupportを評価しない。そのunsupportedを、形の不在・Searchの不成立・不変条件違反の根拠にしない
- coverage条件、silent fast-forward、required / skippable、physical action sharingの既存semanticsを変えない（Search側で判定しない）
- 予測はProduction RNG Engineの公開APIだけで行い、ゲーム挙動を推測しない。Ideal判定は `satisfiesIdealBonuses()` / `evaluateSkillCondition()`
- 保護武器を破壊的操作に使わない。保護武器のbaseはprimitiveがstream baseをnullにするので、形が操作を要求すればadmissionされない（前提違反としてfail closed）
- RouteOperation・予測結果を期待形から組み立てない。Routeは常にstreamの解からcompositionで作る
- 未確認（budget / gate / cancel）と不成立・前提違反（fail closed）を区別する
- materializedはPlanner未検証であり、`verified` / `best_found` / `proven_minimum` と呼ばない

## 6. G1 / G2 / G4-iii

### 6.1 G1（`conversion (c, s*)`、c < s*、cがIdeal Skill位置）

- 方式: `shape_constrained` だけ（§11）。制約付きprimitiveが巨戟化位置 c のbaseだけを生成し（§5.3の6。c は正式な合法位置との共通部分）、admission後、
  Skill laneを `reset_skills(s*)` として、巨戟化SkillがIdealでも c + 1 からのSkill channelを開く。Bonus laneは形どおり（巨戟化baseのBonusは常にstream）
- 分類: Target記録には常に `policyShape`（`searchPolicyShapeOf()`、§10.2）を残し、「Search policyでは返らない形を新方式で扱った」ことを数えられるようにする。
  そのうえで新方式の段階（admission、stream読取り、配送、検証）とoutcome（§10.1）を記録する
- 新方式を含まない方式規則 `d0a-v1` では、D-0Bで確定した `not_executed(search_policy_shape)`（候補分類 `not_executed_search_policy`、§10.3の役割
  `method_extension`）をそのまま使う

### 6.2 G2（所持巨戟の現在Ideal laneの継続。S2 / B1 / B2）

- option追加はA-2の責務である。本方式はA-2の継続optionを次のとおり扱える設計にする
  - S2（現在SkillがIdeal → Reset Skills s*）: Skill lane `reset_skills(s*)`。primitiveは未保護の所持巨戟に `startSkillCounter = origin` を与えるので、
    admissionはlaneを開ける
  - B1 / B2（現在Bonusが `gogma_artian` でIdeal → Reset / Keep / Reset→Keep）: Bonus lane `reset` / `keep` / `reset_then_keep`。primitiveは未保護の所持巨戟に
    `bonusBase` を与える（所持巨戟のprimitiveはReset supportを条件にしない。laneが使う操作のsupportだけをstreamが評価する。§5.3の7 / 8）
- 保護武器（Executionで理想品として確定した武器を含む）は、primitiveがstream baseをnullにするので操作できない。Phase Aは保護武器に `none / none` だけを
  与え、C-1がそれを検査する。性能上Idealでも未保護の武器は操作の対象になり得る。この区別は `isProtected` だけで決まり、`status` は読まない（AGENTS.md）
- A-2で、継続形の判定 `continuationShapeOf()`（G1と、所持巨戟の現在Ideal laneに操作を置くoption）と、`d0a-v1` 用の `SearchPolicyShape` の拡張
  （`lane_start_ideal_skill_continuation` を所持巨戟にも、`lane_start_ideal_bonus_continuation` を追加）を入れる

### 6.3 G4-iii

両軸Ideal sourceをTarget自身が操作する継続optionを生成するかはA-2で決める（監査 §3.6、前提P1〜P3）。本方式はSearchの層でそれをmaterializeできる
（未保護なら操作は合法）が、Plannerがそれを実行するかはPhase D'でだけ決まる。本方式はG4のどの場合も、候補を不成立・恒久除外に分類しない。

## 7. G3への対応

| 案 | 内容 | 評価 |
| --- | --- | --- |
| (a) B-iiで履歴を保つ | Bonus操作種別policyで、Keepの入力履歴を形の1つに固定する（§5.3の5） | 上側・下側の両変種を、照合を緩めずに解く。required位置集合・C2・被覆・source割当・objectiveは変わらない。**採用** |
| (b) 同値なrequired位置集合の受理 | 同じ最終武器なら別のrequired位置集合（例: {q, g*}）を受理する | qが他Targetのrequired位置ならC2に反し、そうでなくてもoptionが `keep_from_source` から `reset_then_keep (q, g*)` へ変わるので、割当の再構成・Phase Cの再導出・D-0Aの再導出検査・generatorの「各完全割当を1回」の扱いを設計し直す必要がある。緩和の正しさは未証明。**採らない** |
| (c) materialization順序で回避 | qを使うTarget（上側: qのrequired所有者やcoverer）を先にmaterializeしてqをheld / blockedにする | 上側の非循環な場合にだけ効く。Target同士が互いのrisk位置を持つ循環は解けず、held区間を増やすと下側の変種の条件を作り得る。完全な解決にならない。**採らない**（§8） |
| (d) 未確認として別Phaseへ | 現行方式のままG3を `unconfirmed` に残す | B-iiが承認されない場合（F1 / F2）の扱い。その場合はD-0Bと同じく、G3の未確認をcap / gate / envelopeの問題と断定せず、診断を併記する |

決定: (a)。2a（policyの実装とSearch Domainのtest）と2b（Research方式での利用とsynthetic test）で解き、G3専用のPRは作らない。formal acceptanceへの影響:
新方式でmaterializeを試みるTargetについてはG3による未確認が生じない。`d0a-v1` や設計 §9.1を使う試行では、従来どおりG3の診断（D-0Bの3段）を記録する。

## 8. materialization順序の見直し

### 8.1 調査

1. **変えてはいけないSkill依存**: 巨戟化Target t（位置 c）は、c より前のSkill位置が帰属するすべてのTarget（chain covererとrequired位置の所有者）より後に
   置く（`deriveMaterializationOrder()` の配置と自己検査、`coverage.ts:417-447`）。これは新方式の前提P2（§5.5、origin〜c − 1 がheld）そのものである
2. **Gogmaだけを操作するTargetの先行配置**: Skill要件 `none` かつNormal要件なし（現在SkillがIdealの所持巨戟）のTargetは、Skill unitを持たず、どのSkill segmentにも
   帰属しないので、どの依存にも現れない。したがって順序のどこへ前倒ししても1の自己検査を満たす。一般に、Targetを前倒しして依存が破れるのは、その
   Targetが自分の前提（prerequisite）より前に出る場合だけであり、依存の無いTargetの前倒しは常に安全である
3. **Normal**: Gogmaだけを操作するTargetはNormal unitを持たないので影響しない。一般にNormal streamには順序の制約が無い（held prefixのcanonical作成が
   先後どちらでも被覆を保つ）
4. **reservationとchainの変化**: 先にmaterializeしたRouteは自分の開始位置から最後の操作までを埋めるので、後のTargetにとってその区間はheldになる。
   streamの物理操作数の総和（Σ（終端 − origin））は順序に依らず一定で、順序は各Targetが自分で操作する区間の配分だけを変える。D-0Bの順序7は、
   Gogmaだけを操作する21 Targetより先に置かれたため、Gogma 55〜502の非held 295位置を自分で操作する期待形になった。Gogma終端の昇順に並べれば、
   各Targetの自分の区間は「直前までの最大終端より後」に縮む（Phase Cの予測に近づく）が、前に置かれたTargetの区間は逆に伸びる
5. **G3のrisk位置**: 上側の変種は、qの所有者・covererが先行すればqがheld / blockedになって起きない。一方、先行Routeが増えてheld区間が延びると、
   下側の変種の条件（q〜g1がheld）を作り得る。順序は両変種を同時には解かない
6. **決定的な順序規則（採用する場合の案）**: Skill依存のDAG（prerequisite → 巨戟化Target。`materializationDependencies` と同じ辺）上のKahn法で、
   準備のできたTargetのうち「Gogma最終位置（Gogma操作が無ければ +∞）→ 最大stream進行量 → Target ID」の昇順を選ぶ。同じ割当からは同じ順序になる

### 8.2 決定と理由

**採用しない（Phase Cの順序を維持する）。**

- 新方式の成否は順序に依存しない（§5.5の補題。前提P2はPhase Cの順序で満たされる）。順序は新方式の費用（own operation数とheld窓）にだけ影響し、
  layout因子の無い新方式では、D-0Bの順序7の形（own Gogma 295位置）も1 depthあたり「位置数 × 窓」の生成に収まる見込みである（推定）
- Planner Alternative Search（設計 §9.1）に対しては、Gogma終端昇順にするとown operation数は減るが、held区間内のIdeal位置で終わる安い別Routeが
  先に配送される構造（6キー順）は残るので、期待形の配送順位を保証しない
- 順序の変更はPhase Cの `deriveMaterializationOrder()` を変え、D-0Aの再導出検査（`structuralCandidateMismatch()`）を通るすべてのstructural candidateの
  `materializationOrder` が変わる。D-0Bの記録・RESULTとの比較が条件差になり、順序規則のversionを記録・登録する必要が生じる
- G1 / G3を解かない（§7）

### 8.3 再検討の条件と、採用する場合の範囲

- 条件: D-0B-2の非formal再smokeで、新方式の費用（生成state数・時間・heap）が、前方に置かれたTargetの長い自分の区間に支配されていると分かった場合
- PR: 方式（2a / 2b）とは **別のPR** にする（Phase C側の変更で、レビュー対象と影響範囲が異なる）
- 変更範囲: `coverage.ts` の `deriveMaterializationOrder()` に規則version（例: `materializationOrderRule: 'skill_dependency_then_max_advance'`（現行）/
  `'skill_dependency_kahn_gogma_final'`）を加え、自己検査は不変、`StructuralCandidate` に規則versionを記録し、D-0Aの再導出検査は同じversionで再導出する。
  D-0B runner / protocolで規則versionを条件として記録し、D-0B-2で登録する
- test: 順列であること、Skill依存の自己検査、依存の無いTargetの前倒しの安全性（総当たり）、決定性、stream物理操作数の総和の不変、D-0Aの再導出検査との整合、
  既存規則での既存test不変

方式変更と順序変更は同じ実装PRにまとめない。

## 9. identity・parity・正当性検証

### 9.1 identity

```ts
// Research（提案）
export const GLOBAL_ASSIGNMENT_SHAPE_CONSTRAINED_ALGORITHM = 'global-assignment-d0a2-shape-constrained-materialization-v1'
const SHAPE_CANDIDATE_ID_PREFIX = 'candidate.research.global-assignment.shape.'

shapeConstrainedSearchIdentity = `research.global-assignment.shape.${hashStableValue({
  algorithm: GLOBAL_ASSIGNMENT_SHAPE_CONSTRAINED_ALGORITHM,
  routePolicy: SHAPE_CONSTRAINED_ROUTE_POLICY_VERSION,           // Search Domain側のseam semanticsのversion
  targetWeaponId,
  origin: normalizePlannerSearchOrigin(origin, target),
  calculationContext: { gameVersion, masterDataVersion, rngEngineVersion, appSchemaVersion },
  extent,
  reservation: normalizePlannerAlternativeReservation(reservation),
  shape: normalizedRouteShapeConstraint,
}).replace(':', '-')}`
```

- 同じ入力から決定的に生成し、Clock・UUID・enumeration ordinal・配送順序・試行回数を含めない
- D-0Aの `GLOBAL_ASSIGNMENT_MATERIALIZATION_ALGORITHM`（`global-assignment-d0a-materialization-v1`）、prefix `candidate.research.global-assignment.`、
  D-0Aのsearch identityとCandidate IDは変えない
- Entry IDは既存のdeterministic materializerの規則（§3.8）のままで、search identityを含まない。同じ意味のRouteなら、D-0Aの方式でも新方式でも同じEntry IDになる。
  Candidate ID・`searchRunId`・`BuildListEntry.candidateId`・`candidateSnapshot.id` は方式で異なるのが正常である
- PlannerInputの既存Entryとの同一意味再利用と、非同一内容のID衝突のfail closedは既存規則のまま

### 9.2 parity test（Planner Alternative Searchが返す形に限る）

対象: Planner Alternative Search（設計 §9.1）が、同じreservation・extentのもとで配送できる形（G1 / G2を含まず、G3の両変種の条件を満たさない入力）。
同じ条件で両方式を実行し、PA側は形に一致する最初の配送Candidateを、新方式側は最初の配送Candidateを取る。

| 比較項目 | 期待 |
| --- | --- |
| source（`route.sourceOwnedWeaponId`） | 一致 |
| RouteOperation列（種類・絶対位置・source binding）、RouteKind | 一致（§5.5の最小Routeの一意性と、両者が同じ6キー順で一致集合の最小を返すことからの見込み） |
| 最終5枠・scope・Series / Group Skill | 一致 |
| Counter進行（`estimated*Advance`、`estimatedOperationCount`） | 一致 |
| `candidateStableKey` | 一致 |
| amendment trace（Bonus / Skill / conversion） | 一致 |
| required位置（`plannerRequiredPositions()`） | 一致し、形と一致 |
| materialized Entryの意味（meaning fingerprint、`searchStateHash`、`referencedOwnedWeaponsHash`、Target定義hash、CalculationContext、中間状態Group / opportunity ID） | 一致 |
| Entry ID | 一致（semantic parity） |
| Candidate ID、`searchRunId`、`BuildListEntry.candidateId` | **異なる**（identity parityは求めない） |

semantic parityとidentity parityを混同しない。G3の条件を満たす入力では、PAが形を返さず新方式が返すこと（改善）を別のtestで固定し、parityの対象にしない。

### 9.3 継続Routeを含む独立検証（`verifyShapeConstrainedRoute()`、提案）

PA Searchが返さないG1 / G2のRouteにはparityの比較対象が無いので、次を新方式の採用条件にする（継続形では必須、それ以外でも既定で実行し、D-0B-2で
登録条件として固定する）。検証器はResearch側の独立実装であり、生成器ではない（結果をEntryへ書き戻さない）。

1. **全operationの再予測**: sourceの状態（所持武器はPlannerInputの値、新規Normalは `predictNormalArtian()` でp）から、Routeの全operation（chainを含む）を順に、
   Production RngEngineの公開APIで予測し直す（巨戟化: `predictSkills(c)`、Reset Skills: `predictSkills(位置)`、Reset: `predictGogmaBonus(reset, 位置)`、
   Keep: `predictGogmaBonus(keep, 直前の5枠, 位置)`）。各結果がCandidateの観測trace（`conversionSkillTrace` / `skillAmendmentTrace` / `bonusAmendmentTrace`）と、
   最後の状態が最終武器と一致すること。Counter進行用forgeは結果を使わないので位置だけを検査する
2. **Counter進行と連続性**: 各operationの `counterBefore` / `counterAfter` が `advance*Counter()` と一致し、stream内で位置が狭義増加すること
   （巨戟化 Skill +1、Reset Skills Skill +1、Reset / Keep Gogma +1、Normal作成は `count`）
3. **Keepの入力layout**: 各Keepの入力が、検証器が保持する直前の武器状態（`reset_then_keep` ではg1のReset結果を含む）であり、そのfamily layoutで予測した結果が
   traceと一致すること
4. **正式reservationとcoverage**: request の reservation について、各streamで origin（巨戟化RouteのSkillは c）から最後の自分の操作までの各位置が自分の操作か
   heldであること、blocked位置に自分の操作が無いこと、origin〜c − 1 のSkill位置がすべてheldであること、Normal作成がheld prefixのcanonical表現であり
   production targetがblockedでないこと、sourceが排他武器でないこと
5. **Candidate / Entry validation**: Candidate factory（最終状態のIdeal判定、`validateBuildRoute()`、estimate、hash、traceのbinder）を経たうえで、
   `validateBuildCandidate()` / `validateBuildListEntry()` を通ること
6. **unit plan**: `createPlannerRouteUnitPlans()` のrequired位置（stream別）とsourceが形の `match` と一致すること（`matchExpectedShape()`）
7. **Planner**: Phase D'（D-1）で、全EntryのProduction Planner実行とTrace Replay、別processのfresh ordinary Plannerが成立すること。Trace Replayは実行された
   operationだけを再生し、silent fast-forwardされたchain unitを再生しないので、chain unitの予測の正しさは1で別に確かめる

`validateBuildRoute()` は構造検査であり、予測結果の正しさもProduction Searchとの同等性も保証しない。その通過だけで正当とは判断しない。
1〜6の失敗はfail closed（`route_verification_failed`）であり、outcomeに読み替えない。

## 10. outcome・規模予測・gate・budget

### 10.1 Target outcome（新方式）

```ts
type ShapeConstrainedMaterializationOutcome =
  | { kind: 'materialized'; method: 'shape_constrained'; entry: BuildListEntry; plannerRequired: RequiredPositions;
      deliveredBeforeMatch: 0; observed: ShapeSearchObserved }
  /** Research所有のbudget（§10.4）でSearchを止めた。形の到達を確認できなかった（不在ではない） */
  | { kind: 'unconfirmed'; reason: 'shape_search_budget_reached'; observed: ShapeSearchObserved }
  /** 実行前の規模予測（§10.3）がgateを超えた。Search APIを呼ばない */
  | { kind: 'not_executed'; reason: 'search_scale_gate'; method: 'shape_constrained'; predicted: ShapeSearchScale; exceeded: string[] }
  /**
   * 形が必要とする予測・capabilityが得られない。Phase Aが同じ問いを判定していない場合だけ（判定していれば fail closed）。
   * 形の不在でも未確認でもなく、「このEngineでは必要な予測ができない」という事実
   */
  | { kind: 'unsupported'; reason: 'required_prediction_unsupported' | 'capability_unavailable';
      detail: ShapeBaseUnavailableReason | UnsupportedAmendmentPrediction }
  | { kind: 'unmeasured'; reason: 'cancelled' | 'timeout' | 'out_of_memory' | 'process_failure' }
```

supportの問いを次の5つに分け、混同しない。

| 区分 | 例 | 扱い |
| --- | --- | --- |
| 1. 形が必要とする操作の予測がunsupported | Reset-only形のReset、Keep-only形のKeep、Reset→Keep形のReset段階のResetとKeep段階のKeep、新規NormalのNormal、巨戟化 / Reset SkillsのSkill | Phase Aの判定の有無で、4または `unsupported` へ振り分ける（下記） |
| 2. 形が禁止する操作の予測がunsupported | Keep-only形のReset、Reset-only形のKeep、Reset→Keep形のKeep段階のReset / Reset段階のKeep | **評価しない**（§5.3の7 / 8）。noticeが現れても `forbiddenOperationNotices` に数えるだけで、分類・形の存否・不変条件の判断に使わない |
| 3. 入力全体のcapability不足 | RNG未確定、確定Counterなし、blind Routeしか無い | Phase 0 / Aの `unsupported_input`。materializationへ進まない（従来どおり） |
| 4. Phase Aのsupport判定との矛盾 | Phase Aがsupportedと記録した問い（Normal / Skill / Resetはweapon type × element、Keepはfamily layout。§3.10）に、Searchがunsupportedと答えた | fail closed `prediction_support_inconsistent`。矛盾した問い・Phase Aの記録・Searchの理由を残す |
| 5. prediction support以外の前提違反 | 期待sourceが無い・非互換・排他・保護・変換不可、Counter未確定、production targetがblocked / extent外、c が合法位置に無い | fail closed `shape_base_unavailable` |

1は、Phase Aが同じ問いをsupportedと判定していれば4、判定していなければ（Engine capabilityなど、Phase Aが読まない問い）`unsupported` である。
現行Phase Aの形では、形が必要とするsupportの問いはすべてPhase Aが判定済みなので（§3.10、§5.5のP5）、`unsupported(required_prediction_unsupported)` は
生じない見込みであり、定義上の受け皿として置く。

| 事象 | 分類 | 意味 |
| --- | --- | --- |
| 最初の配送Candidateが照合と独立検証を通る | `materialized` | 形に一致するEntry（Planner未検証）。禁止操作のnoticeや配送前のunsupportedがあっても、配送されたRouteが検証を通れば `materialized` で、それらは診断に残すだけ |
| budget到達（Research側の `shouldCancel` がbudget理由で真） | `unconfirmed(shape_search_budget_reached)` | 「指定された形に到達できなかった」。形の不在でもsupport不足でもない（同時に記録されたunsupportedは診断に残すだけ） |
| gate超過 | `not_executed(search_scale_gate)` | 未実行 |
| ユーザー / runnerのcancel、timeout、OOM、process failure | `unmeasured` | 未計測。timeout / OOM / process failureは従来どおりrunnerが判定する |
| 実行前の前提検査（`checkMinimalRoutePremises()`）の違反、またはbase到達の診断が区分5の理由 | fail closed `shape_base_unavailable` | Phase C / C1 / C2 / 先行materializationの前提違反 |
| base到達の診断、または未配送で終わったときの `requiredUnsupportedPredictions` が区分1で、Phase Aが同じ問いをsupportedと判定済み | fail closed `prediction_support_inconsistent` | Phase AとSearchのsupport判定の矛盾（区分4） |
| 同じく区分1で、Phase Aがその問いを判定していない（capabilityを含む） | `unsupported(required_prediction_unsupported / capability_unavailable)` | 必要な予測が得られない。形の不在ではない |
| baseに到達し、`requiredUnsupportedPredictions` が空で、未配送のまま `exhausted` / `stoppedByExtent` で終わる | fail closed `shape_constrained_unreachable` | 補題（§5.5）の破れ。「形が存在しない」と読まない。summaryはSkill / Bonusのどちらのextent到達かを区別しないので、両者を同じに扱う |
| 形の最終位置で終わらない解の配送、診断を通ったのにbaseが登録されない、consumer stopもcancelも無いのに `exhausted` / `stoppedByExtent` のどちらも立たない終了 | fail closed `shape_search_contract_violation` | seamの契約違反（Bonus側の `stoppedByExtent` が立たないこと、禁止操作のsupportを評価しないことは2aのseam testで固定する） |
| 照合不一致、独立検証の失敗 | fail closed `match_inconsistent` / `route_verification_failed` | 生成と検証の不一致 |

判定の優先順位: cancel / budget（途中で止めた事実）→ base到達の診断 → 配送の有無 → 未配送時の `requiredUnsupportedPredictions` → `shape_constrained_unreachable`。

- **`shape_mismatch` と断定できる条件**: 新方式には無い。形の不在を新方式だけから断定する契約を置かない（補題により、前提が成り立てば形は存在する）。
  設計 §9.1（PA）の `shape_mismatch`（`summary.exhausted` + 一致なし）は従来どおりで、`d0a-v1` でだけ現れる
- 必要な操作のunsupportedを、根拠なく `shape_constrained_unreachable` にしない（unsupportedがあれば区分4か `unsupported`）。禁止された操作のunsupportedは、
  どの分類の根拠にもしない
- 未確認（budget）・未実行（gate）・未計測・support不足（`unsupported`）と、前提違反（fail closed）を混同しない。いずれも「Routeが存在しない」
  「実行不能」とは書かない

### 10.2 候補分類と設計 §10.3での扱い

D-0Bの候補分類（D-0B記録 §3.3の表）に次を加える。

| 候補分類 | `followUp` | window拡大の根拠 | cap / gate / budget / envelope見直しの根拠 |
| --- | --- | --- | --- |
| `unconfirmed_shape_search_budget` | `settings_review` | しない | する（budget） |
| `not_executed_search_scale_gate`（既存。新方式の予測規模を含む） | `settings_review` | しない | する（gate） |
| `unsupported_shape_prediction`（新規。`unsupported(required_prediction_unsupported / capability_unavailable)`） | `support_review`（新規） | しない | しない（Engineのsupport / capabilityの問題であり、設定の問題ではない） |
| `fail_closed`（既存。新方式のcodeを含む） | `run_error` | しない | しない |

G1 / G2を新方式で扱った場合も、Target記録の `policyShape`（§6.1）で「Search policyが返さない形」を数え、`not_executed_search_policy`（`d0a-v1` だけで生じる）とは
別に集計する。設計 §10.3の移行表では、新方式の `unconfirmed` / `not_executed` / `unsupported` は「拡大しない」行に、fail closedは移行判定の対象外
（run error）に入る。`forbiddenOperationNotices` はどの候補分類にも影響しない（診断の件数として残す）。

### 10.3 規模予測とgate（実行前、位置計算だけ）

新方式では、起動するprimitive、source、巨戟化位置、production target、Route baseがそれぞれ1つに拘束される（§5.3）。費用はbase登録前とstreamの2つに分け、
混同しない。D-0Bで費用を支配したのはstream（Bonus held-aware stream）の側である（§3.6）。base登録前の費用はD-0Bで分けて計測していない（§3.9）。
Gogma幅だけでは費用を見積もれないので、次の成分を予測する（提案）。いずれも実行前の位置計算だけで求める値で、計測値ではない。

```ts
interface ShapeSearchScale {
  /** base登録前（§3.9）。早期制約の後に残る処理 */
  preBase: {
    primitive: ShapeConstrainedRouteBase['kind']   // 起動するprimitive（1つ）
    conversionWalkPositions: number                // conversionSkillPositions() の歩行で調べる位置数（巨戟化baseだけ。予測なし、跨ぐheld位置ごとにcheckpoint）
    requiredPredictions: { normalArtian: 0 | 1; skill: 0 | 1 }   // 新規NormalのNormal予測、巨戟化Skillの予測
    baseWorkItems: 0 | 1                           // base登録のqueue work（所持巨戟は同期登録で0）
    supportQueries: ('normal_artian' | 'skill' | 'gogma_reset' | 'gogma_keep')[]   // laneが使う操作のsupport問合せだけ
  }
  normalForgeCount: number                  // held prefixのcanonical作成のforge数（所持sourceは0）
  conversionLegal: boolean                  // c が nextOperationPositions() の結果に含まれる（偽なら前提違反）
  skill: { window: InclusiveRange | null; minOwnOperations: number; maxOwnOperations: number; maxHeldRun: number }
  gogma: { policy: ShapeConstrainedBonusLane['kind']; window: InclusiveRange | null; minOwnOperations: number;
           maxOwnOperations: number; maxHeldRun: number; frontierUpperBound: number; generatedStateUpperBound: number }
  /** 配送までに読み得るdepthの上界: 形に一致する最小costのcompositionまで（lower boundの単調性から、両laneの minOwnOperations の和） */
  depthUpperBound: number
}
```

- `minOwnOperations` = 窓内の非held位置数 + 窓内のheldなrequired位置数、`maxOwnOperations` = 窓内の非blocked位置数、`maxHeldRun` = 窓内の最長held run
- Bonusの `frontierUpperBound` = 窓内の非blocked位置数（policyによりlayoutが1つ）、`generatedStateUpperBound` = `depthUpperBound` × 窓内の非blocked位置数 ×
  （`maxHeldRun` + 2）（Resetが位置ごとに1つ、Keepがfrontier stateごとに窓の長さまで）
- Skillは位置keyなので、1 depthのstate数は窓内の位置数で抑えられる
- base登録前の予測は、新規Normalで高々2回（Normal p、巨戟化Skill c）、所持通常で1回（巨戟化Skill c）、所持巨戟で0回である。無制約時は、offset数 ×
  巨戟化位置数のbaseと、offsetごとのNormal予測、巨戟化位置ごとのSkill予測（memo）が生じる（§3.9）。削減量は入力に依存し、本書では見積もらない
- gateの成分（提案）: `maxDepthUpperBound`、`maxGogmaGeneratedStateUpperBound`、`maxNormalForgeCount`、`maxConversionWalkPositions`。値は決めない
  （D-0B-2で、再smokeの予測値と実測値の比較を根拠に登録する）。上界はいずれも安全側の見積もりであり、formal Search work unitではない（G8）

### 10.4 実行時budgetとenvelope

- budgetの成分（提案）: Bonus生成state数、Skill state数、確定したwork数（base登録のworkを含む）、予測呼出し回数（種類別）。前3つはSearch Domainの
  execution-only instrumentation（`onGogmaReservedDepth` / `onSkillReservedDepth` / `onWorkSettled`）で、予測呼出し回数はResearch側のcounting Engine
  （Production Engineへすべての呼出しをそのまま転送し、`predictNormalArtian()` / `predictSkills()` / `predictGogmaBonus()` の回数を数えるだけのwrapper。
  versionとcapabilityも転送する）で数え、Research側の `shouldCancel` が上限で真を返す。Search Domainはbudgetを知らない。counting Engineは
  testでの予測回数の観測（§15）にも使う
- base登録前の処理への作用: `shouldCancel` は `execution.checkpoint()` で読まれ、checkpointは巨戟化位置の歩行で跨ぐheld位置ごと、`scheduler.step()` ごと
  （base登録のworkを含む）、primitive内のloopにある（§5.3の処理順）。したがってcancelとbudgetはbase登録前の処理にも作用する。所持巨戟の同期登録には
  checkpointが無いが、予測もqueue workも伴わない
- budgetによる停止とユーザー / runnerのcancelは、Research側が自分の閉包で区別して記録する（`CandidateSearchError('cancelled')` を受けた時点で、どちらで真に
  なったかを記録済みの値から読む）
- 配送を伴わない探索の終了条件: 前提が成り立てば最初の一致配送で止まる（§5.5）。止まらない場合の上限は、budget（Research）、`exhausted`（fail closed）、
  wall-clock / heap envelope（runner。`unmeasured(timeout / out_of_memory)`）のいずれかである
- envelopeはD-0Bのrunner（別process、wall-clock、`--max-old-space-size`、progress journal）をそのまま使う

## 11. 方式選択規則 `d0a2-v2`（設計 §9.3への組込み）

Targetごとに、Search前に、ReachTable・shape・reservationだけから決定的に決める。

| 形の分類 | 判定 | 方式順 | Target outcome |
| --- | --- | --- | --- |
| 継続形（G1、A-2後のG2） | `continuationShapeOf()`（A-2まではG1の `searchPolicyShapeOf()`）が非null | `shape_constrained` | 新方式のoutcome |
| 連続形（各streamの自分の位置が1つの連続区間） | 継続形でなく、`shapeOwnPositions().continuous` | 射影起点Candidate Search（設計 §9.2）→ 一致しなければ `shape_constrained` を1回 | 射影起点が一致すれば `materialized`、そうでなければ新方式のoutcome |
| 非連続形（held位置を跨ぐ） | 継続形でなく、`continuous` でない | `shape_constrained` | 新方式のoutcome |

- 複数sourceがあり配送順の負荷が大きい形、後方まで長いchainを要する形、G3のrisk（上側・下側）を含む形は、いずれも非連続形か連続形の分類に入り、
  新方式が担う（新方式はsourceと最終位置を拘束し、G3の代表化を起こさないので、これらの分類を別に持たない）。射影起点Candidate Searchは
  reservationを持たない連続形だけに使い、その不一致はTarget outcomeを決めない（設計 §9.2のまま）
- 設計 §9.1（Planner Alternative Search）は `d0a2-v2` の既定の方式順に入れない。`d0a-v1`（D-0Aの規則。D-0Bの再現）と、§9.2のparity testに残す
- 同じTargetで2方式を試す場合: reservationは同じ導出値（先行Entryから）、gate / budgetは試行ごとに独立、cancelは両方を止め、試行は高々2回。
  射影起点の結果（`canonical_mismatch` / `no_candidate` / gate）は新方式の試行を妨げない
- `d0a-v1` と `d0a2-v2` の区別: 規則名を記録し、runnerの条件として登録する（D-0B-2）。既存の `unconfirmed` 理由（`stopped_by_extent` / `delivery_cap_reached`）と
  新方式の `shape_search_budget_reached` は別の理由であり、互いに読み替えない。window不足や形の不一致にも読み替えない

## 12. 実装PR分割とacceptance

本設計のacceptance: 次の実装PR（2a）を、オーナーがB-iiを承認した後に、仕様を推測せずに開始できること。

| PR | 目的 | 変更範囲 | 入出力契約 | 不変条件 | test | 完了基準 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **D-0A-2a** Search Domain seam | 形状制約付きRoute探索をSearch Domainに用意する | §4.2の表（`routeSearchShared.ts`、primitive 3つ（`existingGogmaRouteSearch.ts` / `ownedNormalArtianRouteSearch.ts` / `normalArtianRouteSearch.ts`）の制約分岐、`bonusStream.ts`、`targetSearchScheduler.ts`、`plannerAlternativeSearch.ts` の抽出refactor、新規Research module）、SEARCH_SPEC注記（承認時） | §5.3（処理順、早期制約、base到達の診断、stream base生成条件、`shapePolicy` のsupport契約、notice、admission） | 無指定時のProduction挙動（起動するprimitive、列挙、support問合せとunsupported通知、予測回数、Candidate列、summary、search identity、計算版数）が不変。Research moduleはProductionから到達しない。正式reservationを形状制約に使わない | §15の「Production不変」「早期制約」「Bonus support契約」「seam単体」「G1 / G2 / G3」の各行（変更前に追加するgoldenを含む） | 既存test無変更で全通過、golden一致、新test通過、`npm run lint` / `npm test` / `npm run build` | **オーナー承認**（§13） |
| **D-0A-2b** Research方式 | `shape_constrained` をmaterializationへ組み込む | `src/benchmarks/globalAssignment/`: request構築（reservation・extent・shape変換・identity・base登録前を含む規模予測・前提検査）、counting Engine（§10.4）、実行と分類（§10。support区分1〜5を含む）、独立検証器（§9.3）、方式選択 `d0a2-v2`（§11、`d0a-v1` は不変）、D-0B runner / protocolの規則選択（既定は `d0a-v1` のまま）と候補分類の追加、G3静的risk診断への下側の変種（§3.7）の追加（`d0a-v1` の診断用。既存の数え方は別fieldで残す）、設計書の結果記録 | §5.2 / §5.4 / §10 / §11 | D-0Aの挙動・identity・既存testは不変。reservationを改変しない。materializedを `verified` と呼ばない | 補題のproperty test（seed付きrandom fixtureで、Phase C structural candidateの全Targetが新方式でmaterializeされる）、G1のend-to-end synthetic、G3両変種（設計 §9.1では未確認、新方式でmaterialized）、PAとのparity（§9.2）、独立検証器の正例と変異（trace・Counter・layout・coverage・blocked・source）、分類（budget / gate / cancel / `unsupported` / fail closed各code、support区分1〜5）、決定性、`request_mismatch`、isolation | 同上。実Export smokeはD-0B-2で行う | 2a |
| **A-2** | 所持巨戟の継続option（G2） | 監査 §9.2 / 設計 §19.6のA-2に加え、`continuationShapeOf()`、`d0a-v1` 用 `SearchPolicyShape` の拡張 | 設計 §19.6 | 定理T、下界のadmissibility、被覆補題、値順序latticeの各option1回・単調配送 | 監査 §9.3（総当たり、G4の状態遷移）、G2の新方式end-to-end | 継続optionが新方式でmaterializeされ、G4-iiiの扱いが決まる | 2b |
| （計画しない）順序v2 | §8.3 | Phase C | §8.3 | 自己検査不変 | §8.3 | — | D-0B-2で必要と判明した場合のみ、別PR |
| **D-0B-2** | 再smokeと事前登録 | 確定したoption集合と `d0a2-v2` での非formal再smoke、事前登録（gate・budget・envelope・option集合version・方式選択規則・G1 / G2の分類規則・独立検証の既定・順序規則（現行）） | D-0B記録 §10 + 本書 §10.3 / §10.4 | formal runを開始しない | protocol test | 登録の完了 | A-2 |
| **D-0C** | formal measurement | 計測記録・RESULT | — | 登録条件の不変、clean HEAD | — | 登録条件での計測 | D-0B-2 |
| **D-1** | Planner検証（統合acceptance） | 設計 §14のD-1 | 設計 §9.5 | 設計 §9.5 / §13.2 | 設計 §13.1 Phase D'、継続Routeを含むPlanner / Trace Replay | 設計 §13.2 | D-0C |

## 13. オーナー判断が必要な事項

| # | 事項 | 選択肢 | 本書の推奨 |
| --- | --- | --- | --- |
| 1 | B-ii（Search DomainのProduction fileへのResearch専用seam）の採用。対象はProduction 7 file（Route search primitive 3つと `routeSearchShared.ts` へのbase生成前の制約分岐、`bonusStream.ts` の `shapePolicy`、`targetSearchScheduler.ts` の `shapeFilter`、`plannerAlternativeSearch.ts` の抽出refactor）と新規Research module。いずれも任意引数・任意fieldで、無指定時のProduction挙動は不変 | (a) 承認して2aへ進む (b) 承認しない → F1（B-i限定 + D-0A方式。長い `reset_then_keep` とG3は未確認のまま）(c) 承認しない → F2（案C） | (a) |
| 2 | 正式仕様への記載 | (a) SEARCH_SPECにResearch専用seamの注記（Production非使用、Production契約・計算版数への影響なし、§14の案）を2aと同時に入れる (b) 2aの前にdocs-only PRで入れる (c) 入れず、Research文書とコードcommentだけにする | (a) |
| 3 | 新方式で未配送のまま `exhausted` になった場合の扱い | (a) fail closed（補題の前提違反） (b) 型付きoutcome（例: `shape_unreachable`）として記録し、run errorにしない | (a)。前提が崩れた状態で候補の判定を続けない |
| 4 | G3の対応 | (a) B-iiの操作種別policyで解く（同値なrequired位置集合の受理は採らない） (b) 受理の緩和を設計し直す | (a) |
| 5 | materialization順序 | (a) 現行のまま（必要ならD-0B-2の後に別PR） (b) 2bで順序v2を採用 | (a) |
| 6 | 方式選択 | (a) `d0a2-v2`（非連続形・継続形は新方式、連続形は射影起点→新方式。PAは既定外） (b) 非連続形でPAを先に試し、新方式をfallbackにする | (a)。PAは費用が大きく、期待形の配送順位を保証しない |
| 7 | 独立検証器の既定 | (a) 新方式の全materializationで実行（D-0B-2で登録） (b) 継続形だけで実行 | (a) |

G4-iiiの扱い（両軸Ideal sourceの継続optionの生成）は本書の判断事項ではなく、A-2で決める。

## 14. 正式仕様・既存文書への影響

### 14.1 正式仕様（本PRでは変更しない。変更案）

| 文書 | 箇所 | 変更案 | 必要性 |
| --- | --- | --- | --- |
| `docs/SEARCH_SPEC.md` | 5.6.8の後に新設（例: 5.6.9） | 「Research専用: 形状制約付きRoute探索。Global Assignment Research（Issue #154）だけが使い、Production caller（Planner、Worker、UI、Service）は呼ばない。Planner Alternative Searchと同じprimitive・stream・scheduler・Candidate factoryを使い、primitiveの選択とsource / Counter / production target / 巨戟化位置のbase生成前の制限（巨戟化位置は正式な合法位置との共通部分）、base admission、laneの開放、Bonus操作種別policy（許す操作のsupportだけを評価する）、最終位置の制限だけが異なる。予測・held / blocked / coverage・Ideal判定・Counter進行は変えない。無指定時のProduction挙動（unsupported通知を含む）・search identity・計算版数に影響しない」 | 推奨（オーナー判断 #2）。Search DomainにProduction非使用のAPIが入るため、その位置づけを正式に残す |
| `docs/SEARCH_SPEC.md` | 5.6.8「探索の継続」 | 変更しない。必要なら新設節への参照を1文足す | 任意 |
| `AGENTS.md` | Candidate Search Stream Separation / Search Route Rules | 変更しない（Production Searchの規則は変わらない）。必要ならResearch専用seamの存在を1文で参照 | 任意 |
| `docs/PLANNER_SPEC.md` / `docs/REQUIREMENTS.md` | — | 変更しない（Plannerと要求は変わらない） | 不要 |

### 14.2 Research文書（本PRで更新）

- 設計 §9.3 / §9.4 / §9.6 / §9.11（新設）/ §10.3 / §14 / §15.1 / §19.5〜§19.7: 本書への参照と決定の要約。§9.4の本文は変えない
- 監査 §7.2: 「形1つ分で爆発要因を持たない見込み」の記述に、Bonusの `'all'` streamではlayout因子とheld窓が残る旨の訂正を注記し、§13（新設）で本書の決定を記録する
- D-0B記録: §15（新設）で、G3静的risk診断の走査範囲が下側の変種（§3.7）を含まないことを注記する。観測値・RESULTは変えない

## 15. test計画（一覧）

| 区分 | 内容 | PR |
| --- | --- | --- |
| Production不変 | 変更前に追加するgolden（PA配送 `candidateStableKey` 列・summary・種類別の予測呼出し回数（counting Engine）、通常Candidate Searchの結果、Bonus streamの生成state列・frontier・unsupported通知、runtime observer境界）、既存test無変更、search identity・version不変、isolation。制約未指定のPlanner Alternative Searchが3種類のprimitiveを起動し、全source・全offset・全巨戟化位置を列挙すること、`shapePolicy` 未指定のBonus streamでReset / Keepのsupport評価とunsupported通知・生成state・frontier代表化・memo・single-passが変わらないこと | 2a |
| 早期制約（Required fix 1） | (1) `owned_gogma` でNormal / 所持通常のprimitiveを起動しない（起動をspyで観測） (2) `owned_normal` で別のOwnedWeaponのbaseを作らず、その巨戟化Skillを予測しない (3) `new_normal` で指定外のCounter・production targetのNormal予測をしない（counting Engineで `predictNormalArtian()` がp 1回だけ） (4) 指定外の巨戟化位置のbaseを生成せず、その `predictAt()` を呼ばない (5) 合法でない c（originからc − 1 までにheldでない位置がある、c がblocked、窓外）を受理せず、`conversion_position_not_legal` を返す (6) 保護source・排他source・非互換sourceを操作対象にしない（それぞれ `source_protected` / `source_exclusive` / `source_incompatible`。reservationは入力のまま） (7) 制約未指定では従来どおり全RouteKindを探索する (8) 予測回数・Candidate列・summaryがgoldenと一致する (9) cancelとbudget（`shouldCancel`）が巨戟化位置の歩行とbase登録のworkで作用し、base登録前に止まる | 2a |
| Bonus support契約（Required fix 2） | supportが非対称なmock Engine（Reset / Keepのsupportを入力ごとに切り替えるsynthetic fixture。ゲーム挙動は推測しない）で: (1) Reset supported / Keep unsupportedでReset-only形が成立する (2) Keep supported / Reset unsupportedでKeep-only形が成立する（新規Normal・所持通常でもstream baseが作られる） (3) Reset unsupportedのReset-only形はbase到達の診断で区分1になり、Phase Aの判定に応じて `prediction_support_inconsistent` / `unsupported` に分類される (4) Keep unsupportedのKeep-only形も同様に分類される (5) Reset→Keep形はResetとKeepの両方のsupportを必要とし、どちらが欠けても成立しない (6) Reset段階のstateについて `gogmaKeep()` を問い合わせない（呼出しをspyで観測） (7) Keep段階でResetを生成せず、`gogmaReset()` を問い合わせない (8) 禁止操作のunsupportedが `requiredUnsupportedPredictions` と分類に現れず、`forbiddenOperationNotices` が0 (9) `shapePolicy` 未指定のunsupported通知がgoldenと一致する (10) `shapePolicy` 指定時もsingle-pass cursor（逆行・重複・飛越しのthrow）、(位置, layout) のfrontier代表化、`finalPosition` での終了（extent到達を記録しない）が成り立つ | 2a |
| seam単体 | `shapePolicy` 3種の生成規則と `finalPosition` 後の非生成、ordinary読取りの拒否、stream keyの分離とsingle-pass、base到達の診断の各理由、admission（source / c / p / blind / 保護）、lane開放（lane開始Idealでも）、操作0の解を入れないこと、最終位置の制限、cancel、診断を通ったのにbaseが登録されない場合の契約違反 | 2a |
| G1 / G2 / G3 | G1: 巨戟化SkillがIdealでも c < s* の形が返る。G2: 所持巨戟の現在Ideal laneに操作を置く形が返る（未保護）、保護武器では返らない。G3上側・下側: PAは返さず、seamは返す（下側の変種の推定を固定する） | 2a / 2b |
| 補題 | seed付きrandom fixtureのPhase C structural candidateで、順序どおりに全Targetが新方式でmaterializeされる。前提を壊した入力（順序の入替え、reservationの欠落）で `shape_base_unavailable` / `shape_constrained_unreachable` がfail closedとして出る | 2b |
| parity | §9.2の比較項目。semantic parityとidentityの差（Candidate IDは異なり、Entry IDは一致）を分けて固定 | 2b |
| 独立検証器 | 正例と、trace・Counter・Keep入力layout・coverage・blocked・排他source・required位置の各変異で失敗すること。`validateBuildRoute()` を通る変異でも検証器が失敗すること | 2b |
| 分類 | budget（ユーザーcancelとの区別）、gate、cancel、各fail closed code、support区分1〜5の振り分け（§10.1。Phase Aの判定の有無で `prediction_support_inconsistent` と `unsupported` を分ける）、必要な操作のunsupportedを `shape_constrained_unreachable` にしないこと、budget到達とsupport不足を混同しないこと、禁止操作のnoticeが分類に影響しないこと、`d0a-v1` でのG1の `not_executed(search_policy_shape)` 不変 | 2b |
| 決定性 | 同じ入力で同じrequest・identity・Entry ID・outcome。Clock / UUID / ordinalを含まない | 2b |
| runner / 診断 | 規則選択、候補分類の追加、D-0B smoke既定値の不変、G3静的riskの下側の変種（既存の上側の数え方は不変） | 2b |
| G4 / A-2 | 監査 §9.3 | A-2 |
| Planner | 継続Routeを含むEntry集合でのPlanner完成・Trace Replay・物理操作数とobjectiveの一致 | D-1 |

## 16. 本PRの検証

- 変更はdocsだけである（本書の新規作成、設計・監査・D-0B記録への参照と注記の追記）。Production changed files = `[]`、Research実装・test・計測コード・
  実Export・既存formal RESULTの変更なし
- `git diff --check`、Markdownのリンクと文書参照の確認、設計 §8 / §9 / §10 / §14 / §19との整合、PR #245 / #246で確定したG1 / G3 / G4の意味との整合、
  正式仕様authorityとの整合を確認し、`npm run check:nul` / `npm run lint` / `npm test` / `npm run build` を実行した（結果はPR本文に記載）
- Search実行、実Export run、formal measurement、RESULT生成は行っていない

## 17. レビュー対応（PR #247、`14fb623` に対する修正）

| 区分 | 指摘 | 対応 |
| --- | --- | --- |
| Required fix 1 | source・巨戟化位置・production targetを主に `addBase()` で拘束しており、primitiveの起動、Normal Counter / offsetの列挙とNormal予測、`conversionSkillPositions()` による巨戟化位置の展開とSkill予測、遅延queue workが `addBase()` の前に残る | `addBase()` より前の処理と制約を適用できる位置を確認して §3.9に記録した。形状制約をbase生成前に、primitiveの選択 → source / Counter / production target → 巨戟化位置（正式な合法位置との共通部分）の順で適用し、`addBase()` は最終admissionだけにした（§5.3の処理順と意味2〜7）。期待source・排他source・保護の3つの制限を区別し、reservationを編集しないことを明記した。Research専用の任意field `routeBaseConstraint` をprimitive 3つと `routeSearchShared.ts` が読む（§4.2）。base到達の診断と理由の型を加えた（§5.3）。残る費用（primitive 1つの起動、support問合せ、巨戟化位置の歩行、新規NormalのNormal予測1回、巨戟化Skillの予測1回、base登録のwork 1つ）をstreamの費用と分けて規模予測とbudgetへ反映した（§10.3 / §10.4）。補題に早期制約がR_minのbaseを除かないことを加えた（§5.5）。testを追加した（§15「早期制約」） |
| Required fix 2 | `generateReservedDepth()` はResetとKeepの両方のsupportを評価・記録するので、操作種別を制限したpolicyでも禁止した操作のunsupportedが報告され、それを `prediction_support_inconsistent` へ変換すると合法なRouteをfail closedし得る | 現行のsupport評価（Resetは `keep_only` でも問い合わせる）とprimitive側のstream base生成条件（新規Normal・所持通常はReset supportが無いとBonus stream baseを作らない）を確認した（§3.5）。`shapePolicy` は許す操作だけを生成し、そのsupportだけを、その操作を置けるstage・stateでだけ問い合わせる契約にし、Reset→Keepの段階ごとの問合せを定めた（§5.3の8）。primitiveのstream base生成条件をlaneが使う操作のsupportだけにした（§5.3の7）。Phase Aのsupport判定（family-only Keep契約を含む）を確認し（§3.10）、unsupportedを5つの区分に分け、`prediction_support_inconsistent` をPhase Aが同じ問いを判定済みの場合に限り、判定の無い問いは `unsupported` とした。禁止操作のunsupportedはどの分類の根拠にもしない（§10.1 / §10.2）。補題のP5を具体化した（§5.5）。testを追加した（§15「Bonus support契約」） |

B-iiを主方式とする判断、2aの前にオーナー承認が要ること、G1 / G2 / G3の方針、materialization順序を変えない判断、identity、方式選択規則は変えていない。

## 18. D-0A-2a 実装記録（Search Domain seam）

Refs #154。B-iiの採用とSearch DomainのProduction fileへのResearch専用opt-in seamの追加は、本タスクでオーナー承認事項として扱った（§13の#1 (a)）。
SEARCH_SPECへの注記は2aと同時に入れた（§13の#2 (a)、`docs/SEARCH_SPEC.md` 5.6.9）。2b以降（§12）は実装していない。

### 18.1 実装した範囲

| 箇所 | 実装 | 無指定時（Production） |
| --- | --- | --- |
| `routeSearchShared.ts` | 任意field `RouteSearchContext.routeBaseConstraint`（`RouteBaseConstraint` / `RouteBaseLaneNeeds`）。`conversionSkillPositions()` は指定時に正式な歩行（`legalConversionSkillPositions()` として分離）の結果を形の c との共通部分に絞り、`beyondExtent` を立てない。Bonus laneのcapability / supportの共有helper（`constrainedBonusLaneCapabilityBlocker()` / `constrainedBonusLaneSupportBlocker()` / `constrainedBonusLaneAvailable()`）を、制約付きprimitiveとbase到達の診断が共用する | 歩行・checkpoint・`beyondExtent` は不変 |
| primitive 3つ | 指定時、形のsource / Counter / production targetのoffset 1つだけを列挙し、Bonus stream baseの生成条件をlaneが使う操作だけにし、`amendmentPolicy` を付けない。新規Normalはblind variantを登録しない。所持巨戟は操作0のlaneのstream base（`startSkillCounter` / `bonusBase`）を作らず、そのsupportを問い合わせない | 列挙・support問合せ・warning・stream base生成条件は不変 |
| `bonusStream.ts` | 任意field `BonusStreamBase.shapePolicy`（`BonusShapePolicy`）。held-aware読取りだけが解釈する（`generateShapeReservedDepth()`、§5.3の8）。ordinaryの `readDepth()` / `solve()` / `reachesBeyondExtent()` は拒否し、`amendmentPolicy` との併用（`'all'` を含む）も拒否する。stream keyは指定時だけ要素を足す | `generateReservedDepth()` を含む既存の関数本文は変えていない（dispatchとordinary APIの拒否1行だけを追加） |
| `targetSearchScheduler.ts` | contextの任意field `RouteSearchContext.routeShapeFilter`（`ScheduledRouteShapeFilter`）を読む。Planner Alternative policyでだけ受け付ける。`addBase()` は `admit()` による最終admissionの後、lane付きで登録し（`registerBase()`）、stream laneはlane開始Idealでもchannelを開き、各軸は `shapeLaneAxes()` で操作0 / 最終位置の解だけを受け取る。admitしたbaseのBonus noticeを `routeShapeFilter.onBonusNotice()` へも渡す | lane開始Ideal規則・channel購読・noticeは不変。constructorの引数も不変 |
| `plannerAlternativeSearch.ts` | setup・Route登録・delivery loopを `createPlannerAlternativeFrontier()`（`run()` は登録するprimitiveの列を引数に取る。`closeWithoutRun()`）と `PLANNER_ALTERNATIVE_ROUTE_REGISTRATIONS` に抽出し、root / setupのruntime sectionを開く `openPlannerAlternativeSearchSections()` を加えた | `visitPlannerAlternativeCandidates()` は従来の3種類を `routeBaseConstraint` / `shapeFilter` 無しで渡す。処理順・runtime section列・summaryは不変 |
| 新規 `src/domain/search/research/` | `visitShapeConstrainedRouteCandidates()`、型（`shapeConstrainedTypes.ts`）、入力検証、base到達の診断、`SHAPE_CONSTRAINED_ROUTE_POLICY_VERSION`（`research-shape-constrained-route-policy:v1`） | Production・`src/domain/search/index.ts` から到達しない（isolation test） |

### 18.2 設計（§4.2 / §5.3）との差異

いずれも意味と不変条件は §5.3に従い、綴り・配置だけを変えた（§0の「提案」）。

1. **抽出先**: 共有のfrontierは新規fileではなく `plannerAlternativeSearch.ts` の中に置いた。`alternative/` のfile一覧は既存のsource audit
   （`plannerAlternativeIdealPublication.test.ts`）が固定しているためである。Productionの公開exportに内部関数を出さないよう、`alternative/index.ts` の
   `export * from './plannerAlternativeSearch'` を、既存の公開名3つ（`visitPlannerAlternativeCandidates` と型2つ）の名前付きexportに変えた（公開名は不変）
2. **Bonus shapeの生成関数**: `generateReservedDepth()` に分岐を入れず、別関数 `generateShapeReservedDepth()` にした。`bonusStream.ts` の
   frontier block・call site・frontier key・Reset / Keep memoはIssue #154の複数のsource-shape test（A8 / A9 / B2I / B2J、
   `reservedBonusStreamRepresentative.test.ts`、`reservedKeepFamilyLayoutKeyReuse.test.ts`）が固定している。生成state constructorとfrontier比較関数は
   参照で共有し（呼出しを再度綴らない）、frontier keyの組立て（(位置, layout)）だけを同じ規則で別に書いた。Reset→Keepの段階は状態に新fieldを足さず、
   「`resetPosition` より前ならReset段階、以後（`resetPosition` のReset、またはその後のKeep）ならKeep段階」と位置から決める（Reset段階のResetは
   `resetPosition` 以下にしか置かれないので同値）
3. **schedulerのlane**: Production側のchannel購読行（`cross.addSkill` / `cross.addBonus` / `base.onBonusNotice`）はsource audit
   （`plannerAlternativeIdealPublication.test.ts`）が固定しているので、新しい購読を足さず、形のlaneは同じ購読行を通る軸の制限
   （`shapeLaneAxes()`）とnoticeを転送するbaseの写しで実現した。`shapePolicy` 付きstream baseはResearch側のfilterがprimitiveのbaseから作る
4. **`capability_unavailable` の `cause`**: RNG入力の未確定（区分3に当たる）とEngine capability flagを区別するため `cause` を加えた
5. **位置の窓外**: laneの最終位置（s*、g*、g1）が窓外なら `invalid_shape`（throw）、巨戟化位置とproduction targetの窓外は診断
   （`conversion_position_not_legal` / `production_target_outside_extent`）にした（§15の「早期制約」(5)に合わせた）
6. **契約違反**: 診断を通ったのにbaseが登録されない、形と異なるbase・2つ目のbaseのadmission、形の最終位置で終わらないRouteの配送は
   `ShapeConstrainedSearchError('shape_search_contract_violation')` でrejectする（2bの分類で `shape_search_contract_violation` へ対応させる）
7. **観測**: shape付きBonus streamのdepthは `onGogmaReservedDepth` を報告するが、runtime phase section（`onGogmaReservedRuntime` のphase）は
   報告しない（phase markerもsource-shape testの固定対象である）。§10.4のbudgetが使うのはdepth observation・Skill depth observation・work数である
8. **`shapeFilter` の渡し方**: §4.2の「constructorの任意の第4引数」ではなく、contextの任意field `RouteSearchContext.routeShapeFilter` にした。
   Planner Alternative Searchのscheduler構築が1箇所で `}, runtime)` であること、Search runtime observerを読むProduction moduleが
   `plannerAlternativeSearch.ts` だけであることを、既存のisolation test（`plannerAlternativeBenchmarkIsolation.test.ts`）が固定しているためである。
   同じ理由で、Research seamのroot / setup section開閉は `plannerAlternativeSearch.ts` のhelper（`openPlannerAlternativeSearchSections()`、
   `closeWithoutRun()`）を通す

### 18.3 Production不変の根拠（確認済み、test）

- 変更前のmain `e6da7bd` で1回だけ記録したgolden（`src/test/fixtures/shapeConstrainedSeamProductionGoldenPreD0A2A.json`、63件）を、変更後の
  実装が再現する: Planner Alternative Search 25 scenario（配送 `candidateStableKey` 列、summary、予測呼出し列と回数、support問合せ列、登録された
  Route base、base別のBonus notice、runtime observerのsection列、instrumentation、cancel / yieldのcheckpoint数。observerあり・なしの両方）、
  通常Candidate Search 19 scenario（canonical Ideal全体、searched / skipped、notice、#104のNormal削減を含む登録base）、Bonus stream
  （held-aware 11 case、ordinary 7 case、stream key）
- 既存testは変更していない。Issue #154のsource-shape test（bonusStream / scheduler / Planner Alternativeのsource audit）を含めて全件通過
- isolation test: Production（`src/domain/search/research/` 以外）はResearch moduleをimportせず、Research専用field
  （`routeBaseConstraint` / `routeShapeFilter` / `shapePolicy`）を持つのは §18.1の7 fileだけで、`visitPlannerAlternativeCandidates()` はどれも渡さない。
  `CURRENT_CALCULATION_APP_SCHEMA_VERSION` 17、`DATABASE_SCHEMA_VERSION` 10、`ExportRoot.schemaVersion` 13、`production-rng:c5-e7` は不変

### 18.4 G1 / G2 / G3（synthetic、test）

- G1: 巨戟化 c のSkillがIdealでも、`reset_skills(s*)` の形で c + 1 からのReset Skillsが配送される。Planner Alternative Searchは同じ入力でReset Skillsを
  持たないRouteだけを返す
- G2: 未保護の所持巨戟の現在SkillがIdeal（Reset Skills継続）、現在BonusがIdeal（Keep継続）でも形どおり配送される。保護武器は
  `source_protected` で、primitiveを起動しない
- G3上側: Keep chainの範囲に同じlayoutのReset位置があるとき、Planner Alternative SearchはReset側の履歴（`R10,R11,R12,K13`）だけを返し、
  `keep` の形は `K10,K11,K12,K13` を最初に返す（D-0Bのsynthetic確認と同じ機構）
- G3下側（§3.7の推定の固定）: q = 10・g1 = 11がheld、Reset(10)とReset(11)が同じlayout、r = 12、g* = 13のsyntheticで、最小depth（own operation 3）では
  g1経由の履歴（`R11,K12,K13`）がq経由（`R10,K12,K13`）へ畳まれ、Planner Alternative Searchは `R11,K12,K13` を配送しないことを確認した。
  `reset_then_keep(11, 13)` の形は `R11,K12,K13` を最初に返す。**設計の推定との差異（観測）**: 同じsyntheticで、1段深いdepthでは
  q のResetを前置した `R10,R11,K12,K13`（required位置は {11, 13}、own operationが1つ多い）がPlanner Alternative Searchから配送された。
  R(q) → R(g1) のReset chainは `lastResetDepth` が大きく代表として残るためと読めるが、これは推定（コード読取）であり一般には固定していない。
  したがって下側の変種は、この条件では「g1経由の履歴が失われる」のではなく「最小costのg1経由のRouteが失われ、同じrequired位置集合の
  Routeが1操作多いcostで後から配送される」形で現れる。§3.7の「以後の継続はrequired {q, g*} の履歴だけになる」はそのdepthについての記述として
  読む。新方式の扱い（Keep段階を `resetPosition` のResetの後に限る）とD-0B記録の観測値は変わらない

### 18.5 2bに残す範囲

§12のD-0A-2bの行のとおり（Research側の `materializeShapeConstrained()`、request構築・規模予測・前提検査、counting Engine、分類、
`verifyShapeConstrainedRoute()`、方式選択 `d0a2-v2`、D-0B runner / protocolの規則選択と候補分類、G3静的risk診断への下側の変種の追加、
補題（§5.5）のproperty test、PAとのparity）。§5.5の補題は2aでは未検証のままである。2bの実装記録は §19。

## 19. D-0A-2b 実装記録（Research方式 `shape_constrained`・方式選択 `d0a2-v2`・独立検証器）

Refs #154。基準main `4be6ec6`（PR #248 merged）。§12のD-0A-2bの行を実装した。Production（Search / Planner / RNG / Worker / UI /
Persistence / schema / version）、2aのSearch seam、Phase Aのoption集合、Phase Cのassignment・materialization順序、既存D-0BのRESULTは変更していない
（Production changed files = `[]`）。実Exportでのsmoke、formal measurement、Production Planner・Trace Replayによる検証は行っていない。

### 19.1 実装した範囲

| 箇所（`src/benchmarks/globalAssignment/`） | 実装 |
| --- | --- |
| `shapeMaterializationTypes.ts`（新規） | 規則 `MaterializationRule`（`d0a-v1` / `d0a2-v2`）、algorithm token `global-assignment-d0a2-shape-constrained-materialization-v1`、Candidate ID prefix `candidate.research.global-assignment.shape.`、request・規模（`ShapeSearchScale`）・gate・budget・outcome・観測・独立検証の報告・方式選択の型 |
| `shapeMaterializationRequest.ts`（新規） | `toRouteShapeConstraint()`（`shape.option` だけからの変換。Phase Aが作らない組合せは `invalid_shape`）、`shapeConstrainedSearchIdentity()`（§9.1の構成要素だけ）、`checkMinimalRoutePremises()`（§5.5の位置前提）、`assembleShapeConstrainedRequest()`、継続形の判定 `continuationShapeOf()` と拡張境界 `CONTINUATION_SHAPE_DETECTORS`、方式選択 `selectShapeMaterializationMethods()` |
| `shapeMaterializationScale.ts`（新規） | `predictShapeSearchScale()`（位置計算だけ。巨戟化位置の歩行と正準作成はSearchと同じ `nextOperationPositions()` / `heldPrefixNormalCreation()`）、gate / budgetの検証と超過成分 |
| `countingRngEngine.ts`（新規） | `createPredictionCountingEngine()`。Production Engineの全呼出し（version、capability、引数、返却値、例外）をそのまま転送し、予測（種類別）とsupport問合せの回数だけを数える。名前は既存のbenchmark用 `createCountingRngEngine`（Production側のWorker benchmark）と衝突しないようにした |
| `shapeRouteVerification.ts`（新規） | 独立検証器 `verifyShapeConstrainedRoute()`（§9.3の1〜6） |
| `shapeMaterializationRun.ts`（新規） | 前提検査 → gate → 2aのseam（計数Engine、instrumentation、budget付き `shouldCancel`）→ 最初の配送のdeterministic materialization → `matchExpectedShape()` → 独立検証 → §10.1の分類 |
| `materialize.ts` | 規則の入口。`ShapeMaterializationInputs`（`rule: 'd0a2-v2'`）を渡したときだけ新規則を使い、無指定は `d0a-v1`。正式reservationの導出を `formalReservation()` に1つにまとめ両規則で共有、`buildShapeConstrainedRequest()` / `executeShapeConstrainedRequest()`（再導出して `request_mismatch`）、Target単位の方式順 |
| `materializationTypes.ts` | 方式 `shape_constrained`、新outcome（budget・shape gate・unsupported）、`materialization_unsupported` stage、fail closed code（`shape_base_unavailable` / `prediction_support_inconsistent` / `shape_constrained_unreachable` / `shape_search_contract_violation` / `route_verification_failed`）、`GlobalAssignmentMaterializationError.detail`（任意。D-0Aの停止は持たない） |
| `materializationProtocol.ts` / `materializationRunner.ts` | `ShapeMaterializationResearchConditions`（独自の型）、protocol version `global-assignment-d0a2b:1`、候補分類 `unconfirmed_shape_search_budget` / `unsupported_shape_prediction`（followUp `support_review`）、runner記録への新field（`d0a2-v2` のrunだけ） |
| `materializationDiagnostics.ts` | G3下側の変種（§3.7）を上側とは別の関数・別fieldで追加（`diagnoseBonusFrontierLowerRisk()` / `bonusFrontierLowerRequestRisk()` / `measureBonusFrontierLowerCollapse()`）。上側の関数と値は不変 |
| `scripts/run-planner-global-assignment-d0b.mjs` | `--rule d0a-v1` または `--rule d0a2-v2`（既定 `d0a-v1`）、`--shape-gate D,G,N,W`、`--shape-budget G,S,W,PN,PS,PR,PK`。`d0a2-v2` ではgateとbudgetの指定が必須（既定値なし）、`--delivery-cap` は拒否、`--gate` は射影起点Candidate Searchのgate |

### 19.2 実装上の判断（設計の提案との差異を含む）

1. **規則の分離**: 新規則の入力は `ShapeMaterializationInputs`、設定は `ShapeMaterializationSettings`（射影起点Search用のD-0A gate、shape gate、shape budget）、
   runner条件は `ShapeMaterializationResearchConditions` で、いずれも `d0a-v1` の型にfieldを足したものではない。`d0a-v1` の条件は `rule` fieldを持たず
   （明示の `rule: 'd0a-v1'` も拒否）、`d0a2-v2` の条件は `deliveryCap` / `searchScaleGate` / `searchPolicyPrecheck` を持てない
2. **request**: §5.2の入力をすべて持ち、実行前に同じ入力から再導出して比較する（Target、shape、変換後の形、reservation、reservation元のEntry、origin、extent、
   identity、予測規模、前提違反）。処理順は前提検査 → gate → seamである（ユーザー指示の順序4〜6）
3. **規模予測**: §10.3の型をそのまま実装した。`conversionWalkPositions` は正式な歩行が調べる位置数（`nextOperationPositions()` のskip数 + 1）。gateの成分は
   `maxDepthUpperBound` / `maxGogmaGeneratedStateUpperBound` / `maxNormalForgeCount` / `maxConversionWalkPositions`。値は呼出し側が明示し、本PRは既定値も正式値も
   定めない（testは十分大きなtest値だけを使う）
4. **budget**: 成分はGogma生成state数・Skill state数・確定work数・予測呼出し回数（Normal / Skill / Reset / Keep）。超過は `使用量 > 上限`。Searchの予測回数は
   Searchに渡す計数Engineだけが数え、独立検証は別の計数Engineで数える（Search budgetに入らない）。停止理由は `shouldCancel` が最初に真になった時点で記録し、
   cancelとbudgetが同時なら cancel（`unmeasured(cancelled)`）とし、超過していたbudget成分を併記する。consumer stop（受理）時の記録は終了時点の使用量で、
   最後のcheckpointの後にbudgetを超えて配送された場合も受理は有効とし、超過は隠さず記録する
5. **分類**（§10.1）: seamの `ShapeBaseUnavailableReason` のうちsource / Counter / production target / 巨戟化位置と、`capability_unavailable` の
   `cause: 'rng_input_unconfirmed'`（区分3。Phase 0 / Aが確定値を要求したので前提違反）は `shape_base_unavailable`。Engine capability flag
   （`engine_capability_unavailable`。Phase Aは読まない）は `unsupported(capability_unavailable)`。`prediction_unsupported` とstreamの
   `requiredUnsupportedPredictions` は、Phase Aの同じ問い（Normal / Skill / Resetは種別 × 属性の `TargetReach.support`、Keepはfamily layout）で判定し、
   Phase Aがsupportedと判定済みなら `prediction_support_inconsistent`、それ以外は `unsupported(required_prediction_unsupported)`。Keepの問いのlayoutは、
   `keep` laneではsourceの、`reset_then_keep` laneではg1のResetのlayout（形の操作種別policyによりlaneのKeep入力は常にこのlayoutで、family-only Keep契約
   （P5）の範囲）。禁止操作のnoticeは分類に使わない。配送が無く必要な予測のunsupportedも無い `exhausted` / `stoppedByExtent` は `shape_constrained_unreachable`、
   どちらも立たない終了やconsumer stopで受理が無い終了は `shape_search_contract_violation`
6. **候補の受理**: 最初の配送だけを扱い、materializerの拒否は `entry_materialization_refused`、照合不一致は `match_inconsistent`、独立検証の失敗
   （`validateBuildCandidate()` / `validateBuildListEntry()` を含む）は `route_verification_failed` で、次のCandidateを試さない
7. **既存テストとの互換のための綴り**: `ShapeMethodSelection.predictedSearchScale`、shape attempt要約の `predictedSearchScale`、`ShapeSearchObserved.deliveredCandidates`、
   budget停止outcomeの `delivered: 0` / `closestMismatch: null` は、既存testが和型のfieldとして読む名前に揃えた（意味は §10.1 / §10.3 のまま）
8. **G3下側の記録**: `d0a-v1` の記録（runnerのsemantic recordとsummary）はD-0Bと完全に同じserializationに保つ（ユーザー指示 §4）ため、下側の変種は
   `d0a2-v2` のrunの記録にだけ別field（`diagnostics.bonusFrontierLower`、Targetごとの `bonusFrontierLower`、summaryの `shapeConstrained.bonusFrontierLower`）として
   入れた。§12の「`d0a-v1` の診断用」については、診断関数（静的・request・measured）は `d0a-v1` のPlanner Alternative attemptにもそのまま使え（test済み）、
   `d0a-v1` のrun記録へ出すかはD-0B-2の判断に残す（オーナー判断事項）
9. **継続形の境界**: `CONTINUATION_SHAPE_DETECTORS`（現在は `searchPolicyShapeOf` だけ）と `ContinuationShape`（現在は `SearchPolicyShape`）。A-2はG2の検出器と型を
   ここに足す。Phase AのG2 optionは追加していない
10. **2aとの契約不整合**: 見つからなかった。2aのSearch seamは変更していない

### 19.3 `d0a-v1` 不変の根拠

- 変更の **前に**、main `4be6ec6` で `d0a-v1` のgolden（`src/test/fixtures/globalAssignmentMaterializationV1GoldenPreD0A2B.json`、29ケース: D-0Aの4 scenario
  （precheck有無）、gate、delivery cap、request単体、G1、G3上側、各candidateの診断、D-0B runnerの4 run（semantic recordとsummary））を1回だけ記録し、
  変更後の実装が `JSON.stringify`（key順を含む。runnerの `semanticSha256` と同じ）で完全一致することを固定した（`materializationV1Golden.test.ts`）
- 既存のResearch testは変更していない。isolation testは新moduleの一覧追加と、2b moduleの検査（Planner非実行、手組みreservationなし、予測は計数Engineと
  独立検証器だけ、seamは `research` の公開moduleからだけ、検証器はSearch内部を読まない）の追加だけである
- D-0B smoke defaults、`MATERIALIZATION_D0B_PROTOCOL_VERSION`（`global-assignment-d0b:1`）、`MATERIALIZATION_D0B2_REGISTRATION_ITEMS`、formal runの拒否は不変

### 19.4 補題（§5.5）のproperty test

`shapeMaterializationLemma.test.ts`。seed付きの決定的な合成fixture（`randomShapeScenarioSpec()`。Target 2〜3、所持巨戟・所持通常、Ideal Skill / Reset /
Keep / 予測Normalの位置をseedから生成。table Engineはゲーム規則を推測しない）を、実際のPhase A ReachTableとPhase C-2のstructural candidate searchに通し、
Phase Cの正式なassignment・expectedShapes・materializationOrder・dependencies・coverageをそのまま使う（期待形を手で編集しない）。各candidateを順序どおりに
形状制約付き方式だけでmaterializeし、正式reservation（先行Entryからの導出）、前提違反なし、最初の配送の受理、独立検証の通過、required位置と形の一致、
決定性、規則 `d0a2-v2` 全体での `all_materialized` を確認した。

| seed範囲 | 結果 |
| --- | --- |
| 1〜300（commitしたtest） | 144 seedでstructural candidateあり（155は無し、1はnode budget停止で0件）。432 candidate（うちTarget 3つが90）、954 Target、反例0。base: 所持巨戟269 / 所持通常127 / 新規Normal558。Skill lane: zero 577 / Reset Skills 377。Bonus lane: Reset 439 / Keep 335 / Reset→Keep 98 / zero 82。非連続形130、held有り516、G1継続36 |
| 301〜2000（一回限りの確認。commitしていない） | 2,570 candidate（うちTarget 3つが660）、5,800 Target、反例0 |

負例: 順序の入替え（先行Entryの欠落）→ `conversion_position_not_legal`、同じTargetの再materialize → 排他source・blockedのproduction target / required位置、
extent不足（前提検査そのもの）、Phase Aと異なる予測を返すEngine（P1 / P5の破れ）→ base admitted・必要なunsupportedなし・未配送で
`shape_constrained_unreachable`。いずれもfail closedで、「Routeが存在しない」とは扱わない。

**未確認として残る範囲**: 補題はこの合成fixture（小さな窓、table Engine）で反例が無いことを示しただけで、一般には証明されていない。P5のfamily-only Keep契約は
Engineの性質（tierを読まない）に依存する。実Export（Production RNG）での成立はD-0B-2の再smokeで確かめる。

### 19.5 parity（§9.2）と、設計の見込みとの差異

`shapeMaterializationParity.test.ts`。同じ正式reservation・extentで、Planner Alternative Search（`d0a-v1` の方式、delivery cap 5,000）の最初の一致と、
形状制約付き方式の最初の配送を比較した。

| 入力 | parity | 操作種別の別解 | G1 | G3 risk |
| --- | --- | --- | --- | --- |
| D-0Aの4 scenario | 8 | 0 | 0 | 0 |
| 合成fixture seed 1〜300 | 744 | 64 | 36 | 110 |

- parityの対象では、Route（RouteKind・source・RouteOperation列）、最終5枠・scope・Skill、advance、`candidateStableKey`、3種のtrace、required位置、Entryの意味
  （meaning fingerprint、両hash、Target定義hash、CalculationContext、中間状態Group）、Entry IDが一致し、Candidate ID・`searchRunId`・`BuildListEntry.candidateId`
  は異なる（PlannerInputに同じ現行内容のEntryがあれば、両方式とも既存Entryを再利用する）
- G1はPlanner Alternative Searchが配送しない（全件 `materialized` 以外）。G3 riskの入力は改善として別扱いし、新方式のown operation数がPAの一致以下であることだけを確認した
- **見込みとの差異（新たに見つかった区分）**: §9.2は「RouteOperation列が一致する見込み」としていたが、`reset(g*)` の形で、Keep chainの終端 `Keep(g*)` も同じ最終
  多重集合に到達する入力では、Planner Alternative Searchの最初の一致がKeep chain（同じ位置・同じown operation数・同じsource・同じrequired位置 `{g*}`・同じ最終多重集合）
  になる場合がある（64件、すべて `reset` の形）。`matchExpectedShape()` は操作種別を比べないので両方とも一致し、Entry IDは異なる。§5.5の一意性は形状制約付き
  探索の空間（操作種別がlaneのpolicyで固定）での主張で、Planner Alternative Searchの一致集合（操作種別を問わない）では最小が一意でない。補題の存在・最初の配送の
  主張には影響しない。この区分はparityの対象から外し、その特徴（上記の各一致と、PAのBonus操作がすべてKeep）をtestで固定した。D-0B-2で `d0a-v1` と `d0a2-v2` の
  Entry IDを比べるときは、この区分を差として数える

### 19.6 G1 / G3 / G4（end to end、合成）

- G1: `conversion(7, 9)`（巨戟化SkillがIdeal）を `d0a-v1` は `not_executed(search_policy_shape)` とし、`d0a2-v2` は `n1@4,c7,R10,R11,S8,S9` をmaterializeする
  （方式選択 `continuation_shape_constrained_only`、記録に `policyShape` を残す）
- G3上側: `keep_from_source(14)` で12に同layoutのReset。`d0a-v1` は `unconfirmed(stopped_by_extent)`、`d0a2-v2` は射影起点の不一致の後に `K10..K14`（required `{14}`）
- G3下側: aが10〜12を被覆した後のcの `reset_then_keep(11, 14)`。Planner Alternative Searchの最初の一致は1操作多い `R10,R11,K13,K14`（その前に `R10,K13,K14` を配送）、
  `d0a2-v2` は最小の `R11,K13,K14`。下側の静的risk `[10]`、request上の条件成立、measuredの署名 `[10, 14]` を確認した
- G4: 保護されたIdeal sourceは `zero / zero` の形でmaterializeされ（操作0）、操作を伴う形は前提検査で `shape_base_unavailable`（`source_protected`）になる

### 19.7 検証

`git diff --check`、`npm run check:nul`、`npm run lint`、`npm test`、`npm run build` を実行した（結果はPR本文に記載）。2aのProduction golden 63件、D-0A / D-0Bの
既存test、`d0a-v1` golden、新規testがすべて通過した。

### 19.8 A-2 / D-0B-2へ引き継ぐ事項

- A-2: G2の継続optionをPhase Aに足し、`CONTINUATION_SHAPE_DETECTORS` / `ContinuationShape` に検出器を足す。G4-iiiの扱いはA-2で決める（実施。§20）
- D-0B-2: 実Exportでの `--rule d0a2-v2` 再smoke、shape gate・shape budget・envelope・方式選択規則・独立検証の既定（`every_shape_constrained_materialization`）の
  事前登録（`MATERIALIZATION_D0A2B_REGISTRATION_ITEMS`）。予測規模（上界）と実測（生成state数・work数・予測回数）の比較から値を決める
- D-0B-2: G3下側の変種を `d0a-v1` のrun記録にも出すか（19.2の8）、操作種別の別解（19.5）を `d0a-v1` / `d0a2-v2` の比較でどう数えるか
- D-1: materializedはPlanner未検証であり、Production PlannerとTrace Replay、fresh processのordinary Plannerによる確認が残る（§9.3の7）

## 20. A-2 実装記録（G2の継続形と、その形状制約付きmaterialization）

Refs #154。基準main `d7f6f9a`（PR #249 merged）。option集合 `a2`（所持巨戟の現在Ideal laneの継続option、G2）の追加と、それに伴うPhase Dの継続形判定を実装した。
option規則・G4-iiiの判断・Phase B / Cの変更と総当たりの結果は [設計](PLANNER_GLOBAL_ASSIGNMENT_DESIGN.md) §19.8、監査側の整理は監査 §14にある。
2aのSearch seam、方式 `d0a2-v2` の契約（§5 / §10 / §11）、独立検証器、G3の扱い、materialization順序、D-0Bの実測RESULTは変更していない
（Production changed files = `[]`）。実Exportの再smoke、formal run、D-1のPlanner検証は行っていない。

### 20.1 継続形の判定（§6.2 / §11）

| 判定 | 関数 | 条件 | 値 |
| --- | --- | --- | --- |
| G1 | `conversionSkillContinuationShapeOf()`（旧 `searchPolicyShapeOf()` の本体） | `conversion (c, s*)`、c < s*、cがIdeal Skill位置 | `{ policy: 'lane_start_ideal_skill_continuation', stream: 'skill', conversionPosition, finalPosition }`（D-0Bと同じ値・serialization） |
| G2 | `ownedGogmaContinuationShapeOf()`（新規） | 所持巨戟で、`currentSkillIdeal` かつ `skillRequired = reset_skills`（S2）、または `currentBonusIdeal` かつ `bonusRequired ≠ none`（B1 / B2） | `{ policy: 'lane_start_ideal_owned_gogma_continuation', ownedWeaponId, skill: { finalPosition } \| null, bonus: { requirement, resetPosition, finalPosition } \| null }`（継続したlaneを別々に記録） |

- `CONTINUATION_SHAPE_DETECTORS = [conversionSkillContinuationShapeOf, ownedGogmaContinuationShapeOf]`、`ContinuationShape = SearchPolicyShape`（両者の和型）。
  1つのoptionは高々一方に当たる（G1はNormal source、G2は所持巨戟）
- `d0a2-v2`: G2も継続形として `continuation_shape_constrained_only`（`shape_constrained` だけ）。射影起点Candidate Searchへ先に回さない。Target記録の
  `continuation` / `policyShape` にG2の値が残る
- `d0a-v1`: `searchPolicyShapeOf()` が同じ2つを問うので、precheckありのrunでG2は `not_executed(search_policy_shape)`（候補分類 `not_executed_search_policy`、
  §10.3の役割 `method_extension`）。G1の分類・identity・serializationは変わらない。a1 tableにはG2のoptionが無いので、A-2以前の入力の `d0a-v1` 記録は不変
  （golden一致）。a2の入力では候補列がa1と異なり得るので、旧D-0Bと同じ候補列になるとは限らない（旧D-0Bの実測記録は書き換えない）

### 20.2 G2 end-to-end（`g2ContinuationMaterialization.test.ts`、合成fixture・table Engine）

各ケースで、a2のPhase Aがoptionを列挙し（a1は列挙しない）、Phase C（C-1検査とrequired-only replay）が `ExpectedRouteShape` を作り（a1では `invalid_option`）、
`d0a2-v2` が `shape_constrained` だけで最初の配送をmaterializeし、`matchExpectedShape()` が一致し、`verifyShapeConstrainedRoute()` が全operation（chainを含む）を
再予測して通り、required位置が形と一致し、正式reservationがseamへ改変なく渡り、2回の実行が同じ結果になり、`d0a-v1` が `not_executed(search_policy_shape)` に
分類することを確認した。

| ケース | option | materializeしたRoute | required |
| --- | --- | --- | --- |
| S2（Skill Ideal → Reset Skills継続） | `reset_skills(9)` + `reset(12)` | `R10,R11,R12,S7,S8,S9` | Skill {9}、Gogma {12} |
| B1（Bonus Ideal → Reset継続） | `reset_skills(8)` + `reset(12)` | `R10,R11,R12,S7,S8` | {8}、{12} |
| B2（Bonus Ideal → Keep継続） | `reset_skills(8)` + `keep_from_source(13)` | `K10,K11,K12,K13,S7,S8` | {8}、{13} |
| B2（Bonus Ideal → Reset→Keep継続） | `reset_skills(8)` + `reset_then_keep(11, 14)` | `R10,R11,K12,K13,K14,S7,S8` | {8}、{11, 14} |
| 複合（Skill Ideal、Bonus非Ideal） | `reset_skills(9)` + `keep_from_source(13)` | `K10,K11,K12,K13,S7,S8,S9` | {9}、{13} |
| 複合（Bonus Ideal、Skill非Ideal） | `reset_skills(9)` + `reset_then_keep(10, 12)` | `R10,K11,K12,S7,S8,S9` | {9}、{10, 12} |
| held位置を跨ぐ継続Route | 先行Target aの `reset(12)` の後、別属性Target bの `reset_skills(8)` + `reset_then_keep(11, 14)`（Bonus Ideal） | bはaのrequired位置12を操作せずに跨ぐ（非連続形） | {8}、{11, 14} |
| 保護済み両軸Ideal source | Phase Aは `none / none` だけ。継続optionはC-1が拒否（保護） | 操作0（`operations = []`）。操作する形は前提検査で `source_protected` | — |
| 未保護の両軸Ideal source | Phase Aは `none / none` だけ（G4-iii）。継続optionはC-1が拒否 | 操作0 | — |
| 必要なsupportが無い | Keep supportが無いlayoutからはKeep継続optionを列挙しない。Phase A後にEngineのSkill capabilityを落とすと、S2の形は `unsupported(capability_unavailable)` | — | — |

S2・B1・held跨ぎの3ケースは、materializeしたEntryだけをBuild ListにしてProduction scheduler（`runPlannerDeterministicSchedule()`）、Trace Replay、
`createProductionPlanWithObserver()` を小規模fixtureで実行し、completed・Conflict 0・Trace Replay validであること、継続Routeの全operationがStepになる
（Route途中でIdeal状態を通過してもTargetを早期完成させない）ことを確認した。**これはこのfixtureでの観測であり、D-1のPlanner検証済みではない。**

なお held跨ぎケースは、初めに同じIdeal条件のTarget a / c で組んだところ、一方のreserveで両方が充足するcross satisfaction（設計 §15.1）により片方のEntryだけが
選ばれた。G2とは無関係なので、別属性のTarget bへ替えた（Skill / Gogma Counterは全武器で共有なので、held跨ぎの条件は同じ）。

### 20.3 補題（§5.5）のa2 property test（`shapeMaterializationLemma.test.ts`）

`randomShapeScenarioSpec()` の300 seedをa2で走査し、Phase C-2のstructural candidate（各seed最大60件）のうちG2 optionを含むものを最大3件と、そのseedの先頭候補を、
形状制約付き方式だけで順にmaterializeした。G2を含む候補97件（G2のTarget 97件）を含むすべてで、正式reservation、前提違反なし、最初の配送の受理、独立検証の通過、
required位置の一致、決定性、規則 `d0a2-v2` 全体での `all_materialized` を確認し、G2のTargetはすべて `continuation_shape_constrained_only` だった。a1での
既存のproperty test（§19.4）は変更せずに通る。補題は依然として合成fixtureで反例が無いことの確認であり、一般の証明ではない。

### 20.4 D-0B-2へ引き継ぐ事項

- option集合version: `global-assignment-reach-options:a2` を `optionSetVersion` に登録する（runnerは `--option-set a2`。条件 `reachOptionSet` として記録され、
  無い記録はa1）。a1との比較は条件差として扱う
- a2での実Export再smokeでは、G2を含む候補の頻度、`countContinuationOptions()` の `{ options, skill, bonus }`、形状制約付き方式の予測規模と実測を記録し、
  gate / budgetの登録根拠にする（本PRは値を決めない）
- G4-i / G4-iiはD-0Bと同じく診断だけで、成否はPhase D'（D-1）で判定する。G4-iiiはa2でも生成されない（`g4iiiObservability` はそのまま事実）
- 本PRのPlanner実行は小規模fixtureの観測であり、G2を含む実候補のPlanner成立はD-1で確認する
