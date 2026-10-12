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
| 1 | 主方式 | **B-ii**（Search DomainのResearch専用seam）。Search Domainに、Production callerが一切使わない **形状制約付きRoute探索** を設け、Research側の新materialization方式 `shape_constrained` から呼ぶ。Production fileの変更を伴うので、**実装PR（2a）の開始前にオーナー承認が必要**（§13） |
| 2 | B-i | **主方式にしない**。base取得・Skill lane・`keep_from_source` のBonus laneは公開APIだけで構成できる（§4.1）が、`reset` / `reset_then_keep` のBonus laneについて、held skip × family layoutによるstate数の増加（§3.6）とG3（frontier代表化、§3.7）を外側から抑える手段が無い。D-0Bの最初のstructural candidateでは43 Target中24 Target（`reset_then_keep` 23 + `reset` 1。D-0Bで未解決となった順序7のTargetを含む）がこれに当たる |
| 3 | G1 / G2 | 新方式が唯一の方式。lane開始状態がIdealでも、形が要求するlaneだけを開く（§6）。新方式を含まない方式規則（`d0a-v1`、D-0Bの再現用）では、G1を引き続き `not_executed(search_policy_shape)` とする。両軸Ideal sourceを自分で操作するG4-iiiのoption生成はA-2で決め、本方式はそれに従う |
| 4 | G3 | 新方式のBonus操作種別policy（Keep-only / Reset-only / g1のResetの後だけKeep）で、上側（D-0Bのsyntheticで確認済み）と下側（本書の推定、§3.7）の両方を代表化の対象外にする。同値なrequired位置集合の受理は採らない。G3専用の別PRは作らず、2a（policy）と2b（利用）で扱う（§7） |
| 5 | materialization順序 | **変更しない**（Phase Cの `deriveMaterializationOrder()` を維持）。Gogmaだけを操作するTargetの先行配置は依存関係上は常に安全だが、新方式の成否は順序に依存しない（§5.5の補題）ので必要が無い。再検討の条件と、採用する場合の変更範囲・test計画を §8に残す |
| 6 | 方式選択 | 規則 `d0a2-v2`（§11）: 継続形 → `shape_constrained` のみ、連続形 → 射影起点Candidate Search → `shape_constrained`、非連続形 → `shape_constrained`。設計 §9.1（Planner Alternative Search）は `d0a-v1`（D-0B再現）とparity testに残す |
| 7 | identity | 新algorithm token `global-assignment-d0a2-shape-constrained-materialization-v1`、Candidate ID prefix `candidate.research.global-assignment.shape.`（提案）。D-0Aのtoken・prefix・Candidate IDは変えない。Entry IDは既存deterministic materializerの規則のままで、同じ意味のRouteなら方式に依らず同じEntry IDになる（§3.8 / §9.1） |
| 8 | outcome | `materialized` / `unconfirmed(shape_search_budget_reached)` / `not_executed(search_scale_gate)` / `unmeasured`。新方式が探索を終えて一致を返さないことは補題（§5.5）の前提違反であり、`shape_mismatch` にせずfail closedする（§10） |
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
  起き、consumerからは代表から落ちた履歴を取り出せない）
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
| `src/domain/search/bonusStream.ts` | `BonusStreamBase` に任意field `shapePolicy`（§5.3）。held-aware読取り（`readReservedDepth()`）だけが解釈し、ordinaryの `readDepth()` / `solve()` は指定されたbaseを拒否する（throw）。`bonusStreamBaseKey()` は指定時だけ要素を足す | 未指定ならcode path、stream key文字列、prediction、state、順序、single-pass cursorは不変 |
| `src/domain/search/targetSearchScheduler.ts` | constructorの任意の第4引数 `shapeFilter`（§5.3）。`addBase()` で、形に一致しないbaseを登録しない、形が要求するlaneだけを（lane開始Idealでも）開く、形の最終位置で終わる解だけをcrossへ渡す | 未指定なら現行どおり（`shapeFilter === undefined` の分岐だけ） |
| `src/domain/search/alternative/plannerAlternativeSearch.ts` | setup・登録・delivery loopを内部関数（例: `runPlannerAlternativeFrontier()`）へ抽出し、`visitPlannerAlternativeCandidates()` はそれを `shapeFilter` 無しで呼ぶ（挙動不変のrefactor） | 入出力、配送順、summary、prediction回数、instrumentation / runtime observerの境界は不変 |
| 新規 `src/domain/search/research/`（名前は提案） | `visitShapeConstrainedRouteCandidates()`、型、入力検証、route policy token。`src/domain/search/index.ts` から再exportしない | Productionから到達しない（isolation test） |

既定時不変の根拠と確認方法:

- 追加はすべて任意引数・任意fieldで、未指定時は既存の分岐をそのまま通る。抽出refactorは処理順を変えない
- 2aでは、変更の **前に** 現行コードに対するgolden test（既存fixtureでのPlanner Alternative Searchの配送 `candidateStableKey` 列・summary・
  prediction呼出し回数、通常Candidate Searchの結果、Bonus streamの `readDepth()` / `readReservedDepth()` の生成state列）を追加し、変更後も同じであることを
  固定する。既存testは変更しない
- search identity（`createPlannerAlternativeSearchIdentity()`、`PLANNER_ALTERNATIVE_ROUTE_POLICY_VERSION`）、Candidate factory、Planner、永続形状は変えない。
  同じPlannerInputに対するProduction出力が変わらないので、`CURRENT_CALCULATION_APP_SCHEMA_VERSION` 17、`DATABASE_SCHEMA_VERSION` 10、
  `ExportRoot.schemaVersion` 13、`production-rng:c5-e7`、Master `dataVersion` 4はいずれも動かない（2aでisolation / version testに含める）
- 正式仕様: Production契約は変えないが、Search DomainにProduction非使用のResearch専用APIが入るので、SEARCH_SPECへの注記を提案する（§14、オーナー判断）

G1 / G2 / G3と費用:

- G1 / G2: lane開始Idealでも、形が要求するlaneのchannelを開く（§6）
- G3: Bonusの操作種別policyでKeepの入力履歴を1つに固定するので、両変種とも代表化が起きない（§7）
- 費用: Keepの入力layoutが1つに固定されるので、frontierは位置数まで、1 depthの生成stateは「位置数 × 窓」までに抑えられ、layout数の因子が消える
  （推定。実測は2b以降・D-0B-2）。baseは1つだけ登録され、読むSkill / Bonus streamは各1本である

実装量の目安（実装前の概算であり確定値ではない）: 2aはProduction 3 file（各数十行）と新規module（約200〜300行）、test（数百行）。B-iはResearchだけで
同程度の行数を要し、うち約75行がProductionの複製・再実装になる。B-iiは複製を持たない。

### 4.3 比較

| 観点 | B-i | B-ii |
| --- | --- | --- |
| Production file変更 | なし | あり（任意引数・任意fieldと抽出refactor、新規Research module）。**要オーナー承認** |
| Production挙動・計算版数 | 変わらない | 変わらない（golden testで固定） |
| base取得 | subclassで捕捉。primitiveの登録振る舞いと遅延登録の順序に依存 | Search Domain内のadmissionで選ぶ。内部手順への外部依存なし |
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
   B-iiがそれらをstream内部の操作種別policyとbase admissionで解き、composition・context・Candidate factoryを共有して複製を持たないこと、
   未指定時の不変性を任意引数とgolden testで示せることである
2. **必要な変更**: §4.2の表（Production 3 file + 新規Research module）と、Research側の新方式（§5.4、2b）
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

export interface ShapeConstrainedSearchExecution {
  targetWeaponId: TargetWeaponId
  summary: { deliveredCandidates: number; exhausted: boolean; stoppedByExtent: boolean }
  stoppedByConsumer: boolean
  /** baseの到達状況（fail closedの理由づけ用の診断） */
  base: { admitted: boolean; registeredBases: number; skipped: { route: RouteKind; reason: SkippedRouteReason }[] }
  /** admitしたbaseのBonus streamが報告したunsupported予測 */
  unsupportedPredictions: UnsupportedAmendmentPrediction[]
}

export function visitShapeConstrainedRouteCandidates(
  input: ShapeConstrainedSearchInput, engine: RngEngine,
  onCandidate: PlannerAlternativeCandidateVisitor, options?: PlannerAlternativeSearchExecutionOptions,
): Promise<ShapeConstrainedSearchExecution>
```

意味:

1. **入力検証**: Planner Alternative Searchと同じorigin / extent / reservationの検証に加え、shapeの構造（位置が非負整数、`resetPosition < finalPosition`、
   baseの種類とlaneの組合せ: 巨戟化baseはBonus lane `zero` を持たない、巨戟化baseのSkill lane `reset_skills` は `finalPosition > conversionSkillPosition`、
   各位置がextentの窓内）を検査し、違反は `invalid_input` / `invalid_shape` でthrowする
2. **base admission**: setup・Route search primitive・登録順・queue駆動はPlanner Alternative Searchと同じ（§3.1 / §3.2、共有の内部関数）。schedulerは
   `shapeFilter.admit(base)` が受け入れたbaseだけを登録する。受理条件は、`sourceOwnedWeaponId` の一致、巨戟化baseでは `convert_normal_to_gogma` の
   `skillCounterBefore = c`、新規Normalでは `create_normal_artian` の `normalCounterAfter − 1 = p` かつblind作成でないこと、そして形が要求するlaneの
   stream baseがprimitive側で非null（保護武器・support不足でないこと）である。受理したbase数と、primitiveのskip理由を `base` に記録する
3. **lane**: `zero` のlaneは操作0の解だけをcrossへ入れ、channelを購読しない。streamのlane（`reset_skills` / `reset` / `keep` / `reset_then_keep`）は、
   **操作0の解をcrossへ入れず**、lane開始状態のIdeal判定に関係なくchannelを購読する（G1 / G2）
4. **Skill lane**: baseの開始Counter（所持巨戟はorigin、巨戟化は c + 1）から、既存のheld-aware Skill streamをそのまま読む。crossへ渡すのは、最後のown operationの
   位置（最後のstepの `skillCounterBefore`）が `finalPosition` の解だけである
5. **Bonus lane**: primitiveのstream base（開始Gogma位置、5枠、scope）に `shapePolicy` を付けたbaseでheld-aware Bonus streamを読む。`shapePolicy` の生成規則:
   - 共通: `finalPosition` より後に自分の操作を置かない（窓をそこで切り、extent到達を記録しない）。予測memo、support判定、held窓の規則、
     frontierの代表規則、single-pass cursorは既存のまま。`shapePolicy` は既存の `amendmentPolicy`（`keep_only`）と併用しない（併用はthrow）
   - `reset`: Resetだけを生成する（Keepを生成しない）
   - `keep`: Keepだけを生成する（Resetを生成しない。Keepの入力は常にbaseのlayout）
   - `reset_then_keep`: Resetは `resetPosition` 以下の位置だけ、Keepは `resetPosition` より後の位置だけで、かつ最後のResetが `resetPosition` にあるstateからだけ生成する
   - crossへ渡すのは、最後のown operationの位置が `finalPosition` の解だけである
6. **composition / Candidate**: Lazy Ideal Cross、`composeScheduledRoute()`、`createPlannerAlternativeCandidate()`（最終状態のIdeal判定、`validateBuildRoute()`、
   origin基準の到達量、両hash、観測trace）をそのまま使う。Search DomainはCandidate ID・timestamp・identityを作らない
7. **配送と終了**: Planner Alternative Searchと同じcost層単位のbufferと6キー順。`excludedRouteKeys` は持たない（常に空）。終了はconsumer stop、
   `exhausted` / `stoppedByExtent`、cancel（`CandidateSearchError('cancelled')`）。shapePolicyのBonus streamは `finalPosition` で窓を切りextent到達を
   記録しないが、Skill streamには自然な終わりが無いので `stoppedByExtent` が立ち得る。summaryは両者を区別しないので、Research側は未配送の終了を
   `exhausted` / `stoppedByExtent` で分けず、どちらも前提違反として扱う（§10.1）

Seamが行わないこと: reservationの追加・改変、新しいprediction・RNG規則、新しいrequired / skippable・共有規則、Candidateの手組み、Planner判断（Counter
precondition、physical action identity、inventory）。

### 5.4 Research側の手順（2b）

```text
materializeShapeConstrained(shape, materializedEntries, inputs):
  1. reservation = materializedEntries が空 ? 空 : derivePlannerAlternativeReservation(materializedEntries)   // D-0Aと同じ。改変しない
  2. extent      = shapeSearchExtent(shape, plannerStartOrigins(shape, table))
  3. routeShape  = toRouteShapeConstraint(shape.option)                       // §5.2の対応。option以外を読まない
  4. predicted   = predictShapeSearchScale(reservation, extent, routeShape)   // §10.3。予測しない・Searchしない
     premise     = checkMinimalRoutePremises(reservation, extent, routeShape) // §5.5の証明が使う位置条件（c が合法、p と required 位置が
                                                                              // blockedでない、sourceが排他でない、required 位置がextent内）を位置計算だけで検査
     premise 違反 → fail closed（shape_base_unavailable）。gate 超過 → not_executed(search_scale_gate)
  5. identity    = shapeConstrainedSearchIdentity(...)                       // §9.1
  6. execution   = visitShapeConstrainedRouteCandidates({ origin, targetWeaponId, extent, reservation, shape: routeShape }, engine,
                     candidate => {
                       entry = deterministic materializer（identity、prefix）.materializeBuildListEntry(candidate, PlannerInputのEntry).entry
                       validateBuildListEntry(entry)、matchExpectedShape(entry, shape)            // 不一致 → fail closed（match_inconsistent）
                       verifyShapeConstrainedRoute(entry, request, context, engine)            // §9.3。失敗 → fail closed
                       accept(entry); return 'stop'
                     },
                     { shouldCancel: () => userCancel() || budgetExceeded(), yieldControl, instrumentation: budget counters })
  7. 分類（§10.1）: accept → materialized。budget による停止 → unconfirmed(shape_search_budget_reached)。cancel → unmeasured(cancelled)。
     exhausted / stoppedByExtent かつ未配送 → fail closed（shape_constrained_unreachable）。unsupported 予測の報告 → fail closed（prediction_support_inconsistent）
```

- sourceはbase admission（Search前の登録段階）で拘束し、巨戟化位置もadmissionで固定する
- Reset→Keepの切替位置は `shapePolicy.reset_then_keep.resetPosition` = g1 で固定し、Keepはg1のResetの後だけになる
- `matchExpectedShape()` の完全一致は、stream段階の形の制限（4 / 5）によって構成上成り立ち、照合は独立した確認として残す（一致しなければfail closed）

### 5.5 最小Route存在補題（設計上の主張。未検証、2bでproperty testにより固定する）

**前提**

- P1: structural candidateはPhase Cがその割当から導出したものであり（D-0Aの再導出検査）、各optionは `rng_replayed`（required-only再生でIdeal）である
- P2: 先行Targetは、Phase Cのmaterialization順序で、いずれかの方式によりそれぞれの形に一致するEntryとしてmaterializeされている
- P3: reservationはそれらのEntryから `derivePlannerAlternativeReservation()` で導出した正式な値である（held = 先行Routeの全unit位置、blocked = その必須かつ
  共有不可unitの位置、排他武器 = その参照武器）
- P4: extentは `extentFor(shape)` である
- P5: EngineとそのsupportはPhase Aと同じである
- P6: seamは §5.3の規則どおりに実装されている

**主張**: このとき、対象Target t について、source・巨戟化位置・production target・stream別required位置・最終武器が形と一致するRoute R_min が
形状制約付き探索の空間にあり、最初に配送される。

**証明の概略**

- base: 所持武器はC1により先行Targetのsource（排他武器）でない。新規Normalのp はC2により先行Targetのproduction target（blocked）でない。
  巨戟化位置 c は、Phase Cの順序の自己検査（`deriveMaterializationOrder()`、`coverage.ts:397-449`）により c より前のSkill位置がすべて先行Targetに帰属し、
  先行Routeはそれぞれ自分の開始位置から最後の操作までを自分の操作かheldで埋める（coverage条件）ので、origin〜c − 1 はすべてheldであり、c はC2によりblockedでない。
  よって `conversionSkillPositions()` は c を返し、baseが登録される
- R_min: 各streamで、自分の操作を「窓内の非held位置 ∪ 自分のrequired位置」に置き、それ以外のheld位置は跨ぐ。非held位置はblockedでなく
  （blocked ⊆ held）、required位置はC2によりblockedでないので、すべて合法であり、coverage条件を満たす。操作種別は形のとおり（Skill: Reset Skills、
  Bonus: `reset` はReset、`keep` はKeep、`reset_then_keep` はg1以下でReset・g1より後でKeep）で、shapePolicyが許す
- 予測: 必要な予測（Normal p、巨戟化 c、各Reset Skills、各Reset / Keep）はP5によりsupportされる（`keep_from_source` のsource layoutと `reset_then_keep` の
  layout(Reset g1) はPhase AでKeep supportを確認済み）
- 最終武器: Reset Skills / Resetは位置だけ、Keepは (位置, layout) だけで結果が決まるので、R_minの最終武器はrequired-only再生の結果と同じで、P1によりIdeal
- required位置: `createPlannerRouteUnitPlans()` のskip規則（`plannerRouteProgress.ts:279-314`）で、巨戟化は常にrequired、Reset Skills連鎖・Reset / Keep連鎖は
  laneの最後だけrequired、`reset_then_keep` ではKeepが続くg1のResetがrequired、Normalはproduction targetだけがrequiredなので、形のrequired位置と一致する
- 配送順: 形に一致するRouteは「非held位置 ∪ required位置」を必ず含むので、R_minのown operation数が最小で、その集合は一意である。6キー順の第1キーで
  最初に配送され、決定的である

**帰結**: 前提が成り立つ限り、形状制約付き探索が一致を配送せずに終わることは無い。したがって未配送のままの終了（`exhausted` / `stoppedByExtent`）と、
Searchが報告するunsupported予測は、いずれも前提（Phase A / C、先行materialization、seam実装）の破れを示す。これらを「形が存在しない」へ読み替えず、
fail closedする（§10.1）。補題は2bのproperty test（§15）で固定するまで未検証であり、実Exportでの成立はD-0B-2の再smokeで確かめる。

### 5.6 不変条件

- 正式reservationのheld / blocked / 排他武器を形状制約に流用しない・追加しない・改変しない。形状制約は別の入力（`RouteShapeConstraint`）である
- 未materialize Targetの位置をreservationへ先取りしない
- coverage条件、silent fast-forward、required / skippable、physical action sharingの既存semanticsを変えない（Search側で判定しない）
- 予測はProduction RNG Engineの公開APIだけで行い、ゲーム挙動を推測しない。Ideal判定は `satisfiesIdealBonuses()` / `evaluateSkillCondition()`
- 保護武器を破壊的操作に使わない。保護武器のbaseはprimitiveがstream baseをnullにするので、形が操作を要求すればadmissionされない（前提違反としてfail closed）
- RouteOperation・予測結果を期待形から組み立てない。Routeは常にstreamの解からcompositionで作る
- 未確認（budget / gate / cancel）と不成立・前提違反（fail closed）を区別する
- materializedはPlanner未検証であり、`verified` / `best_found` / `proven_minimum` と呼ばない

## 6. G1 / G2 / G4-iii

### 6.1 G1（`conversion (c, s*)`、c < s*、cがIdeal Skill位置）

- 方式: `shape_constrained` だけ（§11）。base admissionが巨戟化位置 c のbaseを受け入れ、Skill laneを `reset_skills(s*)` として、巨戟化Skillが
  Idealでも c + 1 からのSkill channelを開く。Bonus laneは形どおり（巨戟化baseのBonusは常にstream）
- 分類: Target記録には常に `policyShape`（`searchPolicyShapeOf()`、§10.2）を残し、「Search policyでは返らない形を新方式で扱った」ことを数えられるようにする。
  そのうえで新方式の段階（admission、stream読取り、配送、検証）とoutcome（§10.1）を記録する
- 新方式を含まない方式規則 `d0a-v1` では、D-0Bで確定した `not_executed(search_policy_shape)`（候補分類 `not_executed_search_policy`、§10.3の役割
  `method_extension`）をそのまま使う

### 6.2 G2（所持巨戟の現在Ideal laneの継続。S2 / B1 / B2）

- option追加はA-2の責務である。本方式はA-2の継続optionを次のとおり扱える設計にする
  - S2（現在SkillがIdeal → Reset Skills s*）: Skill lane `reset_skills(s*)`。primitiveは未保護の所持巨戟に `startSkillCounter = origin` を与えるので、
    admissionはlaneを開ける
  - B1 / B2（現在Bonusが `gogma_artian` でIdeal → Reset / Keep / Reset→Keep）: Bonus lane `reset` / `keep` / `reset_then_keep`。primitiveは未保護の所持巨戟に
    `bonusBase` を与える
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
  | { kind: 'unmeasured'; reason: 'cancelled' | 'timeout' | 'out_of_memory' | 'process_failure' }
```

| 事象 | 分類 | 意味 |
| --- | --- | --- |
| 最初の配送Candidateが照合と独立検証を通る | `materialized` | 形に一致するEntry（Planner未検証） |
| budget到達（Research側の `shouldCancel` がbudget理由で真） | `unconfirmed(shape_search_budget_reached)` | 「指定された形に到達できなかった」。形の不在ではない |
| gate超過 | `not_executed(search_scale_gate)` | 未実行 |
| ユーザー / runnerのcancel、timeout、OOM、process failure | `unmeasured` | 未計測。timeout / OOM / process failureは従来どおりrunnerが判定する |
| `exhausted` または `stoppedByExtent` で終わり、未配送 | fail closed `shape_constrained_unreachable` | 補題（§5.5）の前提違反。「形が存在しない」と読まない。summaryはSkill / Bonusのどちらのextent到達かを区別しないので、両者を同じに扱う |
| 実行前の前提検査（`checkMinimalRoutePremises()`）の違反、またはbaseがadmissionされない | fail closed `shape_base_unavailable` | Phase C / C1 / C2 / 先行materializationの前提違反 |
| Searchがadmitしたbaseについてunsupported予測を報告 | fail closed `prediction_support_inconsistent` | Phase AとSearchのsupport判定の不一致 |
| 形の最終位置で終わらない解の配送、またはconsumer stopもcancelも無いのに `exhausted` / `stoppedByExtent` のどちらも立たない終了 | fail closed `shape_search_contract_violation` | seamの契約違反（Bonus側の `stoppedByExtent` が立たないことは2aのseam testで固定する） |
| 照合不一致、独立検証の失敗 | fail closed `match_inconsistent` / `route_verification_failed` | 生成と検証の不一致 |

- **`shape_mismatch` と断定できる条件**: 新方式には無い。形の不在を新方式だけから断定する契約を置かない（補題により、前提が成り立てば形は存在する）。
  設計 §9.1（PA）の `shape_mismatch`（`summary.exhausted` + 一致なし）は従来どおりで、`d0a-v1` でだけ現れる
- **input全体のunsupported**（確定していないRNG、確定Counterが無い、blind Routeしか無い等）は、従来どおりPhase 0 / Aの `unsupported_input` で扱い、
  materializationへ進まない。materialization時点のcapability不足は、Phase Aのsupport判定と矛盾するので上表のfail closedにする
- 未確認（budget）・未実行（gate）・未計測と、前提違反（fail closed）を混同しない。いずれも「Routeが存在しない」「実行不能」とは書かない

### 10.2 候補分類と設計 §10.3での扱い

D-0Bの候補分類（D-0B記録 §3.3の表）に次を加える。

| 候補分類 | `followUp` | window拡大の根拠 | cap / gate / budget / envelope見直しの根拠 |
| --- | --- | --- | --- |
| `unconfirmed_shape_search_budget` | `settings_review` | しない | する（budget） |
| `not_executed_search_scale_gate`（既存。新方式の予測規模を含む） | `settings_review` | しない | する（gate） |
| `fail_closed`（既存。新方式のcodeを含む） | `run_error` | しない | しない |

G1 / G2を新方式で扱った場合も、Target記録の `policyShape`（§6.1）で「Search policyが返さない形」を数え、`not_executed_search_policy`（`d0a-v1` だけで生じる）とは
別に集計する。設計 §10.3の移行表では、新方式の `unconfirmed` / `not_executed` は「拡大しない」行に、fail closedは移行判定の対象外（run error）に入る。

### 10.3 規模予測とgate（実行前、位置計算だけ）

新方式では、sourceが1つ、巨戟化位置が1つ（または無し）、Route baseが1つに拘束される。費用を決めるのは、読むdepthとheld窓とfrontierの大きさである（§3.6）。
D-0Bで確かめたとおりGogma幅だけでは費用を見積もれないので、次の成分を予測する（提案）。

```ts
interface ShapeSearchScale {
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
- gateの成分（提案）: `maxDepthUpperBound`、`maxGogmaGeneratedStateUpperBound`、`maxNormalForgeCount`。値は決めない（D-0B-2で、再smokeの予測値と実測値の
  比較を根拠に登録する）。上界はいずれも安全側の見積もりであり、formal Search work unitではない（G8）

### 10.4 実行時budgetとenvelope

- budgetの成分（提案）: Bonus生成state数、Skill state数、確定したwork数。Search Domainのexecution-only instrumentation（`onGogmaReservedDepth` /
  `onSkillReservedDepth` / `onWorkSettled`）で数え、Research側の `shouldCancel` が上限で真を返す。Search Domainはbudgetを知らない
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
| **D-0A-2a** Search Domain seam | 形状制約付きRoute探索をSearch Domainに用意する | §4.2の表（`bonusStream.ts`、`targetSearchScheduler.ts`、`plannerAlternativeSearch.ts` の抽出refactor、新規Research module）、SEARCH_SPEC注記（承認時） | §5.3 | 無指定時のProduction挙動・配送順・summary・prediction回数・search identity・計算版数が不変。Research moduleはProductionから到達しない | 変更前に追加するgolden（PA配送列・summary・prediction回数、通常Search、Bonus streamの生成state列）、`shapePolicy` 3種のstream test（生成規則、`finalPosition` 後の非生成、single-pass cursorの分離、ordinary読取りの拒否）、admission（source / c / p、blind除外、保護武器）、G1 / G2（lane開始Idealでもlaneを開く、操作0の解を入れない）、G3両変種（PAは代表化で返さず、seamは返す）、`exhausted` / cancel、isolation / version | 既存test無変更で全通過、golden一致、新test通過、`npm run lint` / `npm test` / `npm run build` | **オーナー承認**（§13） |
| **D-0A-2b** Research方式 | `shape_constrained` をmaterializationへ組み込む | `src/benchmarks/globalAssignment/`: request構築（reservation・extent・shape変換・identity・規模予測・前提検査）、実行と分類（§10）、独立検証器（§9.3）、方式選択 `d0a2-v2`（§11、`d0a-v1` は不変）、D-0B runner / protocolの規則選択（既定は `d0a-v1` のまま）と候補分類の追加、G3静的risk診断への下側の変種（§3.7）の追加（`d0a-v1` の診断用。既存の数え方は別fieldで残す）、設計書の結果記録 | §5.2 / §5.4 / §10 / §11 | D-0Aの挙動・identity・既存testは不変。reservationを改変しない。materializedを `verified` と呼ばない | 補題のproperty test（seed付きrandom fixtureで、Phase C structural candidateの全Targetが新方式でmaterializeされる）、G1のend-to-end synthetic、G3両変種（設計 §9.1では未確認、新方式でmaterialized）、PAとのparity（§9.2）、独立検証器の正例と変異（trace・Counter・layout・coverage・blocked・source）、分類（budget / gate / cancel / fail closed各code）、決定性、`request_mismatch`、isolation | 同上。実Export smokeはD-0B-2で行う | 2a |
| **A-2** | 所持巨戟の継続option（G2） | 監査 §9.2 / 設計 §19.6のA-2に加え、`continuationShapeOf()`、`d0a-v1` 用 `SearchPolicyShape` の拡張 | 設計 §19.6 | 定理T、下界のadmissibility、被覆補題、値順序latticeの各option1回・単調配送 | 監査 §9.3（総当たり、G4の状態遷移）、G2の新方式end-to-end | 継続optionが新方式でmaterializeされ、G4-iiiの扱いが決まる | 2b |
| （計画しない）順序v2 | §8.3 | Phase C | §8.3 | 自己検査不変 | §8.3 | — | D-0B-2で必要と判明した場合のみ、別PR |
| **D-0B-2** | 再smokeと事前登録 | 確定したoption集合と `d0a2-v2` での非formal再smoke、事前登録（gate・budget・envelope・option集合version・方式選択規則・G1 / G2の分類規則・独立検証の既定・順序規則（現行）） | D-0B記録 §10 + 本書 §10.3 / §10.4 | formal runを開始しない | protocol test | 登録の完了 | A-2 |
| **D-0C** | formal measurement | 計測記録・RESULT | — | 登録条件の不変、clean HEAD | — | 登録条件での計測 | D-0B-2 |
| **D-1** | Planner検証（統合acceptance） | 設計 §14のD-1 | 設計 §9.5 | 設計 §9.5 / §13.2 | 設計 §13.1 Phase D'、継続Routeを含むPlanner / Trace Replay | 設計 §13.2 | D-0C |

## 13. オーナー判断が必要な事項

| # | 事項 | 選択肢 | 本書の推奨 |
| --- | --- | --- | --- |
| 1 | B-ii（Search DomainのProduction fileへのResearch専用seam）の採用 | (a) 承認して2aへ進む (b) 承認しない → F1（B-i限定 + D-0A方式。長い `reset_then_keep` とG3は未確認のまま）(c) 承認しない → F2（案C） | (a) |
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
| `docs/SEARCH_SPEC.md` | 5.6.8の後に新設（例: 5.6.9） | 「Research専用: 形状制約付きRoute探索。Global Assignment Research（Issue #154）だけが使い、Production caller（Planner、Worker、UI、Service）は呼ばない。Planner Alternative Searchと同じprimitive・stream・scheduler・Candidate factoryを使い、base admission・laneの開放・Bonus操作種別policy・最終位置の制限だけが異なる。予測・held / blocked / coverage・Ideal判定・Counter進行は変えない。無指定時のProduction挙動・search identity・計算版数に影響しない」 | 推奨（オーナー判断 #2）。Search DomainにProduction非使用のAPIが入るため、その位置づけを正式に残す |
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
| Production不変 | 変更前に追加するgolden（PA配送 `candidateStableKey` 列・summary・prediction回数、通常Candidate Searchの結果、Bonus streamの生成state列、runtime observer境界）、既存test無変更、search identity・version不変、isolation | 2a |
| seam単体 | `shapePolicy` 3種の生成規則と `finalPosition` 後の非生成、ordinary読取りの拒否、stream keyの分離とsingle-pass、admission（source / c / p / blind / 保護）、lane開放（lane開始Idealでも）、操作0の解を入れないこと、最終位置の制限、cancel | 2a |
| G1 / G2 / G3 | G1: 巨戟化SkillがIdealでも c < s* の形が返る。G2: 所持巨戟の現在Ideal laneに操作を置く形が返る（未保護）、保護武器では返らない。G3上側・下側: PAは返さず、seamは返す（下側の変種の推定を固定する） | 2a / 2b |
| 補題 | seed付きrandom fixtureのPhase C structural candidateで、順序どおりに全Targetが新方式でmaterializeされる。前提を壊した入力（順序の入替え、reservationの欠落）で `shape_base_unavailable` / `shape_constrained_unreachable` がfail closedとして出る | 2b |
| parity | §9.2の比較項目。semantic parityとidentityの差（Candidate IDは異なり、Entry IDは一致）を分けて固定 | 2b |
| 独立検証器 | 正例と、trace・Counter・Keep入力layout・coverage・blocked・排他source・required位置の各変異で失敗すること。`validateBuildRoute()` を通る変異でも検証器が失敗すること | 2b |
| 分類 | budget（ユーザーcancelとの区別）、gate、cancel、各fail closed code、`d0a-v1` でのG1の `not_executed(search_policy_shape)` 不変 | 2b |
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
