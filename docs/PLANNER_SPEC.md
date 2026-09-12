# モンハンワイルズ 巨戟アーティア厳選Planner
## PLANNER_SPEC.md

## 1. この文書の目的

この文書は、作成リストのBuildListEntryをもとに、複数目標を横断したProductionPlanを生成するPlannerの仕様を定義する。

PlannerはUIやIndexedDBに依存せず、入力からProductionPlanを返す純粋な計算モジュールとして実装する。

---

## 2. 基本方針

Plannerの基本優先順位。

1. 未所持の実用品を早く揃える
2. 共有RNG進行中に他の目標武器も効率よく取得する
3. 実用品確保後に理想品へ更新する
4. 同程度の場合は武器消費や操作量を抑える

初期版で実装しないこと。

- ユーザーによる作成順の完全固定
- 高度な任意スコアリング
- アイテム素材の所持数による作成不能判定
- 複数キャラクター横断計画

---

## 3. 配置

```text
src/domain/planner/
  plannerTypes.ts
  createProductionPlan.ts
  scoreCandidate.ts
  inventorySimulation.ts
  conflictDetection.ts
  planInvalidation.ts
  planStepFactory.ts

src/workers/
  planner.worker.ts
```

---

## 4. 入力

```ts
export interface PlannerInput {
  rngState: RngState;
  normalCounters: NormalArtianCounter[];
  ownedWeapons: OwnedWeapon[];
  targetWeapons: TargetWeapon[];
  buildListEntries: BuildListEntry[];
  calculationContext: CalculationContext;
  options: PlannerOptions;
  master: PlannerMasterSubset;
  conflictResolutions: PlannerConflictResolution[];
}

export interface PlannerOptions {
  maxPlanSteps: number;
  beamWidth: number;
  maxExpandedStates: number;
}

export interface PlannerConflictResolution {
  conflictKey: string;
  selectedBuildListEntryId: BuildListEntryId;
}

export interface PlannerMasterSubset {
  weaponBonusDefinitions: WeaponBonusDefinition[];
  weaponTypes: WeaponTypeMaster[];
  elements: ElementMaster[];
  bonusTypes: BonusTypeMaster[];
  materialCosts: MaterialCostMaster[];
  bonusRanks: BonusRankMaster[];
  lotteries: LotteryMaster[];
}
```

初期値。

```ts
const defaultPlannerOptions = {
  maxPlanSteps: 300,
  beamWidth: 50,
  maxExpandedStates: 10000,
};
```

`PlannerInput` はstructured clone可能なデータだけを保持する。`RngEngine` instance、
Engine method、`RngEngineCapabilities` の複製、ID generator、Clockを含めない。

Plannerの実行時dependencyは次の非永続境界から注入する。

```ts
export interface PlannerDependencies {
  rngEngine: RngEngine;
  idFactory: PlannerIdFactory;
  clock: PlannerClock;
}

export interface PlannerIdFactory {
  productionPlanId(): ProductionPlanId;
  planStepId(): PlanStepId;
  ownedWeaponId(): OwnedWeaponId;
}

export interface PlannerClock {
  now(): ISODateTimeString;
}
```

本番adapterは `crypto.randomUUID()` と現在UTC時刻をラップしてよい。Planner計算内で
直接呼び出さない。テストは連番IDと固定時刻を注入する。

制約。

- 保存済みの `isStale` / `staleReasons` だけでは採否を決めない。Planner実行時に
  現在状態から再validationし、実行可能なBuildListEntryだけを使用する
- PlannerはBuildListEntryの `candidateSnapshot` を入力候補として使う
- Planner入力validationでTarget定義Hash、searchStateHash、referencedOwnedWeaponsHash、CalculationContextを現在値から再確認し、保存済み `isStale` だけを信用しない
- RngState全体の確定は要求しない
- `deriveRngCapabilities(rngState, normalCounters, requiredOperations, engineCapabilities)` で、各BuildListEntryの全RouteOperationに必要なKnownValueと現在Engineのsupportが揃うか確認する
- conversionだけのEntryはSkill Prediction、確定Base Seed / Skill Counter、concrete semantic input supportを要求し、persisted Counter Gate、Gogma Prediction、Gogma Counterを要求しない
- Reset / Keepを含むEntryだけがGogma Prediction、確定Base Seed / Gogma Counter、concrete semantic input / Master supportを要求し、Keepを含む場合はKeep Prediction supportも要求する。persisted Counter Gateは要求しない
- Normal Counterは `create_normal_artian` operationを含むEntryだけに要求する。Normal Counterが未確定でも、Gogma-only Entry、existing Gogma Entry、適合するowned Normalからのconversion Entryを個別にvalidationしてPlannerへ残す
- capability確認後、Predictionが必要な各operationのsemantic inputを
  `getPredictionSupport()` で確認する。Normalはweapon/element/rarity、conversionと
  Reset SkillsはSkillのweapon/element、Resetはcaller-supplied Masterを含む
  `gogma_reset`、Keepはその時点のordered 5slotを含む `gogma_keep` を使う
- `supported: false` は既知unsupportedとして該当BuildListEntryだけを除外する。
  他のsupported EntryはBeam Searchへ残す。support queryの例外と
  support確認後のPrediction例外は除外へ変換せずPlanner error経路へ伝播する
- Reset / Keepが連続する場合、後続Keepのsupport inputはRoute開始時のbonusではなく、
  直前のReset / Keep Prediction結果を持つdeterministic preflight/replay stateから作る
- concrete inputがsupported:falseの場合のwarningは、RNG状態不足を表す
  rng_state_missingではなくrng_prediction_unsupportedを使用する
- RNG値不足とEngine capability不足を別warning reasonとして扱う。該当BuildListEntryだけを除外し、無関係なEntryを一括無効化しない
- `targetWeapons` は `isEnabled = true` のみ対象
- `maxPlanSteps`、`beamWidth`、`maxExpandedStates` は1以上
- 実用品を先に確保する優先順位はv1固定であり、`preferPracticalBeforeIdeal` のような切替Optionを持たない
- Active Planの有無はPlanner pure calculationの入力に含めない。PlannerはDraft Planを計算し、Active Plan単一制約、置換、破棄、再計算の制御はApplication / Persistence層で行う

---

## 5. 出力

Plannerは `ProductionPlan` を返す。

```ts
export interface PlannerResult {
  plan: ProductionPlan | null;
  conflicts: PlanConflict[];
  warnings: PlannerWarning[];
  termination: PlannerSearchTermination;
}

export interface PlannerWarning {
  kind:
    | "no_build_list_entries"
    | "rng_state_missing"
    | "rng_prediction_unsupported"
    | "rng_engine_capability_missing"
    | "protected_weapon_required"
    | "build_list_entry_stale"
    | "calculation_context_incompatible"
    | "all_targets_already_satisfied"
    | "invalid_conflict_resolution"
    | "max_steps_reached"
    | "max_expanded_states_reached";
  message: string;
}
```

`max_steps_reached` は `maxPlanSteps`、`max_expanded_states_reached` は
`maxExpandedStates` に到達した場合だけ使用する。両方へ到達した場合は両方を返してよい。
探索途中のbest Stateが存在する場合、上限warningと `plan != null` を同時に返せる。

これらのwarningは診断情報であり、UI制御authorityではない。探索が完了したかどうかは
`PlannerResult.termination` でtypedに判断する（7.2.1）。上限へ到達して完成Planを
得られなかった `status === "incomplete"` のresultは、`plan != null` であっても
実行可能なProductionPlanとして永続化しない。

---

## 6. 目標充足判定

Planner実行前に、OwnedWeaponで各TargetWeaponが満たされているか判定する。

```ts
export interface TargetSatisfaction {
  targetWeaponId: TargetWeaponId;
  hasPractical: boolean;
  hasIdeal: boolean;
  practicalOwnedWeaponIds: OwnedWeaponId[];
  idealOwnedWeaponIds: OwnedWeaponId[];
}

export interface PlannerTargetSatisfaction {
  hasPractical: boolean;
  hasIdeal: boolean;
}
```

判定。

- `hasPractical`: `kind = "gogma"` のOwnedWeaponがTargetの実用条件を満たす
- `hasIdeal`: `kind = "gogma"` のOwnedWeaponがTargetの理想条件を満たす

制約。

- `status` だけで判定しない。実際のボーナス・スキル条件で判定する
- `restorationBonusScope` に対応する実際のBonus Type / Rankを評価し、normal-tierをgogma-tierへ暗黙変換したりTarget条件を緩和したりしない
- `status` はユーザー管理ラベルとして扱う
- `hasPractical`、`hasIdeal`、`practicalOwnedWeaponIds`、`idealOwnedWeaponIds` はすべてOwnedGogmaArtianWeaponだけから導出する
- OwnedNormalArtianWeaponはInventory資源・巨戟化元であり、Target充足武器として評価しない
- 既に理想品があるTargetは原則Planner対象から外す
- 既に実用品があるTargetでは、理想候補を優先度に応じて後回しにする
- PlannerSearchStateの初期 `targetSatisfaction` はTargetSatisfactionから生成する
- `hasIdeal = true` の場合は常に `hasPractical = true` とする

---

## 7. Beam Searchと評価関数

初期版Plannerは上限付きBeam Searchを使用する。Candidate Scoreだけの単純ソートでは採用順を確定しない。

```ts
export interface PlannerSearchState {
  currentRngState: RngState;
  currentNormalCounters: NormalArtianCounter[];
  simulatedInventory: SimulatedInventory;
  targetSatisfaction: Record<
    TargetWeaponId,
    PlannerTargetSatisfaction
  >;
  selectedBuildListEntryIds: BuildListEntryId[];
  routeProgressByEntryId: Record<BuildListEntryId, number>;
  routeRuntimeByEntryId: Record<BuildListEntryId, PlannerRouteRuntimeState>;
  sourceMutationVersionByOwnedWeaponId: Record<OwnedWeaponId, number>;
  candidateReadySourceVersionByEntryId: Record<BuildListEntryId, number>;
  routeSourceVersionByEntryId: Record<BuildListEntryId, number>;
  inFlightExistingSourceByOwnedWeaponId: Record<OwnedWeaponId, true>;
  securedOwnedWeaponIdByEntryId: Record<BuildListEntryId, OwnedWeaponId>;
  trace: PlannerSearchAction[];
  /**
   * 各BuildListEntryが実際に到達済みのcompromise checkpoint opportunity ID。
   * 選択したcheckpointをすべて到達していないEntryはreserveできない（7.5.3）。
   */
  reachedCheckpointOpportunityIdsByEntryId: Record<BuildListEntryId, string[]>;
  totalCost: number;
  evaluationScore: number;
}
```

`practicalFirstProgressTargetIds` は存在しない。Practicalは独立した到達目標では
なくなったため、Practical優先の進行記録も、それを使う評価項目も廃止した。
```

探索手順。

1. 現在RNG状態と在庫から初期Stateを作成する
2. 未充足Targetに対する実行可能なBuildListEntryを列挙する
3. 各Entryの `BuildRoute.operations` から、現在の共有RNG状態と在庫で実行可能な次操作を列挙する
4. 同じ共有RNG遷移を要求する複数Entryがあれば、1回の遷移で各Entryのroute progressを進める
5. `count` を持つ操作は実行ナビ用の1操作単位へ分割し、現在Counterまで正常に通過済みのprefixを重複生成しない
6. 別Entryの実操作でcurrent Counterが通過したRoute prefixのうち、実行しなくても後続Route
   semanticsを維持できるunitはsilentにroute progressだけ進める（7.0.2）
   同じCounter位置に実行可能な必須unitがある場合、その位置を先に消費して必須unitを失わせる
   skip可能unitはsuccessor展開対象から除外する（7.0.2）
7. 操作前提が現在Stateより過去にあり、skipできない、または副作用・必要資源が満たされていない
   Entryは実行不能とする
8. 実行可能な操作を適用し、共有RNGと在庫を進めた次Stateへ展開する
9. Satisfaction、Route progress、Inventory変化後の現在Stateで、未実行のcurrent / future
   Route unitだけを対象にConflictを再評価する。通過済みRoute prefixを再Conflict化しない
   ConflictResolutionは探索中に同じstable Conflict IDが再検出され、selected Entryがその
   Stateで有効なparticipantである場合だけ適用する
10. 実用品確保、理想品更新、操作数、武器消費、現在Stateで意味のある競合を評価する
11. 同じ深さで評価値の高い上位 `beamWidth` 件だけを残す
12. `maxExpandedStates` または `maxPlanSteps` 到達時に打ち切る
13. 完了Stateのうち最良、完了Stateがなければ最も充足度の高いStateからPlanを生成する

### 7.0 physical action sharing

共有Counter streamで同じRNG遷移を要求することは、1回の物理操作を複数Entryで共有する
ための必要条件ではあるが、十分条件ではない。`physicalActionKey` はRNG transition identity
に加えて、その操作を実際に受けるphysical weapon subject identityを含める。

- concrete OwnedWeaponを対象とするReset Bonuses、Keep Bonuses、Reset Skillsは、同じ非nullの
  `sourceOwnedWeaponId`、同じoperation type、同じCounter before / afterを持つ場合だけ
  cross-Entryでshareableとする
- `sourceOwnedWeaponId = null` のReset Bonuses、Keep Bonuses、Reset Skillsは、その
  BuildListEntryの同一Routeで直前に生成したEntry-local transient Gogmaだけを対象とする。
  別BuildListEntryのnull sourceは別physical weaponであり、Counter before / afterが同じでも
  1回の物理操作として共有しない
- transient physical subjectのPlanner内部identityにはBuildListEntry IDを使用してよい。
  これはroute runtime用の非永続identityであり、fake OwnedWeapon ID、route-local永続ID、
  ProductionPlan field、DB schemaを追加しない
- create Normal、conversion、およびnull sourceの操作はcross-Entryでshareableにしない
- blind create Normal([SEARCH_SPEC.md](./SEARCH_SPEC.md) 6.1.1)も同様にEntry-localである。
  Counter位置を持たず、同じ「Normal Artianを1本作成する」操作に見えても、Entryごとに
  別の物理武器を作るため1回の物理操作として共有しない
- `PlannerSearchAction.progressedBuildListEntryIds` は、その1回の物理操作で実際にRoute progressが
  進んだEntryだけを保持する。Counter位置が一致するだけのEntryを追加しない
- Trace Replayは同じphysical action identityを再検証し、shareableでない複数Entryへ同じ
  transient outputを複製してはならない
- `PlanStep.progressedTargetWeaponIds` は正当な `progressedBuildListEntryIds` からだけ導出する。
  同じCounter位置にいたという理由だけで複数Targetを記録しない

同一concrete OwnedWeaponのshared actionでは、既存のsource mutation / version契約を維持し、
同じ操作で進んだEntryを操作後の同一versionへ更新してよい。異なるOwnedWeapon IDまたは異なる
Entry-local transient subject間では、このversion共有を行わない。

#### 7.0.1 Calculation compatibility

このphysical action sharing修正はProductionPlanの計算semanticsを変更するため、
`CURRENT_CALCULATION_APP_SCHEMA_VERSION` を2から3へ更新する。version 2 ProductionPlanは、
別々のEntry-local transient Gogmaに対するReset / Keepを誤共有した可能性を保存済みStepだけから
安全に否定できないため、version 3で互換とみなしてはならない。

- Planと `baseSnapshot.calculationContext` の両方をcurrent CalculationContextと4項目完全一致で
  比較する
- いずれかが非互換なら `calculation_context_changed` としてfail-closedにし、Worker preparation、
  what-if、競合選択、実行へ進めず再計算を要求する
- exact persisted表示のため、読取時に保存済みPlanのstatus、recalculationReasons、Step、
  expected resultを補正または再生成しない
- version 2のBuildCandidate / BuildListEntryはSearchおよびsnapshot semanticsが変わっていない。
  他のCalculationContext 3項目が同じ場合に限りversion 3で明示的に再利用可能とし、既存の
  BuildList stale再判定から除外しない
- このBuild artifact互換例外をversion 2 ProductionPlanへ適用しない

このsilent fast-forward修正もProductionPlanの計算semanticsを変更するため、
`CURRENT_CALCULATION_APP_SCHEMA_VERSION` を3から4へ更新する（7.0.2）。version 3
ProductionPlanは、共有Counter位置を競合として保存し、通過済みprefixを持つEntryを
`counter_before_current` としてPlanから除外している可能性がある。保存済みStepは物理的に
実行可能なままだが、その `conflicts` と `rejectedBuildListEntries` はcurrent calculationが
生成しない判断であるため、version 4で互換とみなしてはならない。上記のfail-closed比較と
exact persisted表示のルールをそのまま適用する。

version 2と3のBuildCandidate / BuildListEntryは、Searchおよびsnapshot semanticsが
変わっていないため、他のCalculationContext 3項目が同じ場合に限りversion 4で明示的に
再利用可能とする。このBuild artifact互換例外をversion 2 / 3 ProductionPlanへ適用しない。

DB schema、AppSettings schema、Production RNG Engine version、ProductionPlan persisted shapeは
変更しない。

#### 7.0.2 Counter進行とRoute prefixのsilent fast-forward

Counter streamの進行とphysical action sharingは別概念である。

共有Counter streamは排他資源ではない。あるEntryの実操作でcurrent Counterがある位置を
通過した場合、別EntryのRoute unitのうち「その位置で物理的に実行しなくても後続Route
semanticsを維持できるもの」は、実行せずに通過済みとして扱ってよい。これをsilent
fast-forwardと呼ぶ。

fast-forwardはphysical action sharingではない。別Entryの武器へ操作したのではなく、
そのunitを実行する必要がなくなっただけである。したがってfast-forwardしたunitは次を
一切生成しない。

- `PlannerSearchAction`
- Search Trace項目
- `progressedBuildListEntryIds`
- `PlanStep.progressedTargetWeaponIds`
- inventory効果 / route runtime output
- expected result
- source mutation version更新

Route progressだけをsilentに前進させる。

##### skip可能条件

Planner内部のRoute unit属性 `canSkipWhenCounterPassed` は、保存済みRoute semanticsから
導出する。永続fieldではなく、`RouteOperation`、`BuildRoute`、`BuildCandidate`、
`ProductionPlan`、DB schemaへ追加しない。

条件は「直後のRoute操作が、このunitのsemantic outputを一切読まずに全面的に上書きする」
ことだけとする。この狭い条件により、最終Candidate結果だけでなく、各Stepのexpected result
表示もskipの有無で変化しない。

| unit | 直後の操作 | skip |
| --- | --- | --- |
| `reset_bonuses` | `reset_bonuses` | 可 |
| `keep_bonuses` | `reset_bonuses` | 可 |
| `keep_bonuses` | `keep_bonuses` | 可 |
| `reset_bonuses` | `keep_bonuses` | 不可 |
| `reset_skills` | `reset_skills` | 可 |
| 上記以外 | — | 不可 |

根拠。

- Reset Bonusesは直前の5slotを読まず、Gogma Counter位置とWeapon/Elementだけから
  5slotを完全再抽選する（[RNG_SPEC.md](./RNG_SPEC.md) 5.3）。したがって直後がReset
  Bonusesであるbonus操作は、誰にも観測されない
- Keep Bonusesは各slotのfamilyだけを入力として読み、そのfamilyをslot位置ごとに保持して
  tierのみ再抽選する。Keep連鎖はfamily layoutを不変に保つため、途中のKeepをskipしても
  次のKeepの入力familyは変わらず、結果も変わらない
- Reset直後のKeepはそのResetのfamilyを読むため、そのResetはskip不可
- Reset SkillsはSeries / Group Skillだけを書き、Skill Counter位置から位置的に予測する。
  直後がReset Skillsなら、前のReset Skillsの結果はどの操作の入力にもならない
- Route末尾の操作はCandidate結果そのものを形成するため常に必須
- `create_normal_artian`、`convert_normal_to_gogma`、`reserve_weapon`、在庫変化を伴う
  操作は物理副作用を持つため常に必須

Route末尾のunitは常にskip不可なので、Route全体がfast-forwardされることはない。Candidate
結果を形成する最後の操作は必ず実行され、`reserve_weapon` の前提となるroute outputも必ず
生成される。skipしたunitのoutputを `routeRuntimeByEntryId` などへ複製してはならない。

##### 適用位置とfail closed

Beam Searchは、実操作でCounterを進めた直後のstateに対してRoute progressを正規化し、
current Counterより過去になったskip可能unitだけを順に通過させる。skip不可unitに到達した
時点で停止する。初期stateにも同じ正規化を適用し、初期competition検出が通過済みprefixを
含まないようにする。

したがって過去unitの扱いは次の2種類だけである。

```text
past + skip可能 -> route progressだけ前進（silent fast-forward）
past + skip不可 -> 従来どおり counter_before_current などでfail closed
```

`current > unit.counterBefore` を一律にrejectしない。逆に、skip不可unitのfail closedは
弱めない。

##### Counter位置を持たないRoute unit

blind create Normal([SEARCH_SPEC.md](./SEARCH_SPEC.md) 6.1.1)は
`counterStream = null`、`counterBefore = counterAfter = null` を持つ。

これは「このRouteのCandidate結果が特定のabsolute Normal Counter位置へ依存しない」という
**Routeの性質**であり、「実行しても物理的にCounterが進まない」という**runtimeの主張ではない**。
プレイヤーは実際に通常アーティアを1本作成し、ゲーム内Counterは1進む。
2つを同一視してはならない。

Routeの性質として次を維持する。

- 絶対Normal Counter preconditionを要求しない。`counter_unavailable` の対象にしない
- どのCounter位置も占有しないため、Counter位置競合のparticipantにならない
- `counter_before_current` 等のCounter位置rejectの対象にしない
- `canSkipWhenCounterPassed = false` である。必ず1 PlanStepとして実行する
- predicted variantのcreate Normalは従来どおりNormal Counter streamに属し、確定Counterが
  無ければ `counter_unavailable` などでrejectされる。全 `create_normal_artian` から
  Counter確認を外してはならない

runtimeの物理効果として次を行う。

- action適用時に `${weaponTypeId}:${rarity}` のNormalArtianCounterを現在stateから探す
- `isConfirmed === true && counter !== null` の場合だけ、既存 `advanceNormalCounter()`
  authorityへ `operation.count` を渡して進める。`counter + 1` を直接書かない
- unconfirmed、`counter = null`、recordなしの場合は現在stateを変更しない。
  未確定値は権威ではないため進めず、架空のCounter recordも作らない
- この更新はBeam SearchとTrace Replayで同一のauthorityを使う。片方だけ直してはならない

結果として、blind createが確定Counterを進めたことにより、同じNormal Counter位置を必要と
するpredicted Route unitが `counter_before_current` でrejectされることがある。これは
物理的に正しい。blind unitはCounter位置競合のparticipantではないため、この実行順は
conflict resolutionではなくBeam Searchの探索が決める。

##### Conflict判定と実行順序の支配関係

同じCounter位置に複数Entryのunitがあるだけでは競合ではない。skip可能unitはその位置を
排他的に必要としないため、競合participantにもならず、conflict resolutionによる
blockingの対象にもならない。

```text
必須unit vs 必須unit（同一physical actionとしてshare不可）
  -> 競合

必須unit vs skip可能unit
  -> 競合ではない
  -> 必須unitがそのCounter位置を優先して実行される
  -> skip可能側はCounter通過後にsilent fast-forward

skip可能unit vs skip可能unit
  -> 競合ではない
  -> どちらを先に実行してもよい（実行されなかった側はfast-forward）
```

「競合ではない」ことと「どちらを先に実行してもよい」ことは同じではない。必須unitと
skip可能unitの間には実行順序の支配関係がある。

```text
必須A @C を先に実行 -> Counter C+1 -> skip可能B @C はfast-forward -> 両Route継続可能
skip可能B @C を先に実行 -> Counter C+1 -> 必須A @C は past + skip不可 -> A Route不能
```

したがって、あるCounter位置に実行可能な必須unitが存在する場合、その位置を先に消費して
必須unitを不可逆に失わせるskip可能unitは、Beam Searchのsuccessor展開対象にしない。これは
execution eligibility（semantic pruning）であり、evaluationScoreによる優遇ではない。
scoreだけではbeamWidthやtie-break次第で無効branchが残り、無効な状態爆発を防げない。

この順序はPlanner自身が一意に決定できるため、ユーザー選択の競合ではない。
`required vs skippable` をConflictへ戻さず、Conflict Resolution UIへも出さない。

判定は次の条件で行う。

- 対象は同じstream・同じCounter位置のunitだけである。別streamや別位置のunitは干渉しない
- 必須unitが現在stateで実際に実行可能な場合だけ支配が成立する。source version、counter
  precondition、inventory / protection、conflict resolutionによるblockingは、通常の展開と
  同じ判定authorityで確認する。必須unitが実行不能なら支配は発生せず、skip可能unitの展開を
  妨げない
- 必須unitとskip可能unitが同一physical actionとしてshareableな場合は代替関係ではない。
  既存のphysical action sharing契約（7.0）が1操作で両Entryを進めるため、この除外を適用しない
- 除外された展開はrejectionとして記録しない。Entryが実行不能になったわけではなく、同じ
  Counter位置を別Entryが消費した後にfast-forwardするだけである

通過済みRoute prefixはConflict対象へ戻さない。

`same_owned_weapon_consumed` は別の排他資源であり、この除外を適用しない。1つのRouteが
あるOwnedWeaponを起点として使う場合、そのRouteには必ず必須unitが残るため、既存の
排他使用semanticsはそのまま維持される。PR #4で定めたphysical action identity判定
（7.0）も弱めない。


候補確保時の状態遷移。

- Candidate reserveや所持通常アーティアの変換消費など、SimulatedInventoryの意味的変更後は、
  enabled Target全体のTargetSatisfactionを現在InventoryのOwnedGogmaだけから再導出する。
  statusだけで判定せず、Idealは常にPracticalも満たす。1武器が複数Targetを満たす場合は
  すべてへ反映し、削除・更新で満たさなくなったTargetはtrueを保持しない。
- 既存Gogmaのreset_bonuses、keep_bonuses、またはsourceを持つreset_skillsを実行したら、
  そのsourceのmutation versionを進め、Candidate reserveまでin-flightとして
  TargetSatisfaction評価から除外する。EntryのRoute完了時にそのsource versionを記録し、
  reserveは記録versionと現在versionが一致するときだけ許可する。後続操作でsourceが
  変更された古いCandidateはreserveできない。同一physical actionを共有して同時に
  完了したEntryは同じversionを記録してよい。
- 既存Gogma Routeは開始時にsource version 0を前提とし、Route全体で前提versionと
  現在source versionの一致を要求する。共有physical actionで進行したEntryは操作後の
  versionへ同時に更新する。共有prefix後に別Entryがsourceを変更した場合、古いversionの
  Routeは後続操作・reserveとも実行しない。
- reserve後の再導出は、Entry自身のTargetだけでなく、確保した武器が満たす他の
  未所持Targetにも反映する。複数Targetを満たす1武器は、そのすべてのTargetの
  TargetSatisfactionへ反映する。
- 現在在庫がPractical条件だけを満たすTargetもIdeal未所持であり、探索対象に残す

### 7.1 Planner Search Action / Trace

Beam SearchはCandidate Snapshotの `BuildRoute.operations` を変更せず、実際に採用した
操作を非永続のPlanner Search Action / Traceとして別に保持する。

- `RouteOperation`、Planner Search Action、`PlanStep` は別の型・責務である
- Search Actionは元RouteOperation、主対象BuildListEntry、同じ物理操作で進んだEntry、
  route progress位置、OwnedWeapon ID、RNG Before / After、Inventory効果、Target充足効果を保持する
- `count > 1` のRouteOperationは元Snapshotを変更せず、Trace上で1操作単位に分割する
- Candidateを確保するSearch ActionはPlanner-onlyであり、RouteOperationではない。第9Cで
  `reserve_weapon` PlanStepへ変換する
- Search Traceは非永続で、PlanStep IDまたは日時を生成しない

### 7.2 expandedStates

`expandedStates` は次の定義で数える。

- 初期Stateは数えない
- 実行前提を満たさずsuccessor生成前にrejectした展開は数えない
- successor PlannerSearchStateを実際に構築し、評価対象にした時点で1増やす
- beamWidthによる枝刈り前でも、構築・評価したsuccessorは数える
- `maxExpandedStates = N` の場合はN件まで許可し、N+1件目を構築しない
- N件へ到達した場合だけ `max_expanded_states_reached` warningを返す

`maxPlanSteps = 300`、`beamWidth = 50`、`maxExpandedStates = 10000` は
`defaultPlannerOptions` の初期値であり、Application callerがBuildList画面の詳細設定で
上書きできる。完全最適解は保証せず、実用的な時間内で十分良いPlanを返す。

### 7.2.1 探索上限設定と typed termination

#### PlannerOptions authority

`PlannerInput.options` はBeam Search boundの唯一のauthorityとする。

- 初期値authorityは `defaultPlannerOptions` だけとする
- BuildList画面の詳細設定でユーザーが `maxPlanSteps` / `beamWidth` /
  `maxExpandedStates` を変更できる
- Application callerが選択値を `PlannerInput.options` へ明示的に反映する
- Worker Client、Worker controller、Domain moduleは既定値を補わない
- 3項目とも1以上の整数だけを受け付け、NaN・0・負数・小数・空欄はPlannerへ渡さない
- 推測による固定最大値は設けない。長時間化はWorker実行と既存Cancelで扱う
- 設定値はBuildList画面のruntime UI stateであり、AppSettingsやIndexedDBへ永続化しない

`PlannerOptions` はB8 orchestration bounds
（`maxCandidateTrialsPerConflict` / `maxGeneratedBuildListEntries` /
`maxPlannerReruns`）およびB8 `ConstrainedEnumerationBounds`、B9 `PlannerWhatIfBounds`
とは別物であり、混同しない。今回の詳細設定はこの3項目だけを公開する。

#### typed termination

Beam Searchの終了状態は `PlannerSearchTermination` としてtypedに返す。

```ts
export type PlannerSearchLimitKind =
  | "max_expanded_states"
  | "max_plan_steps";

export type PlannerSearchTerminationStatus =
  | "completed"
  | "incomplete"
  | "exhausted"
  | "cancelled";

export interface PlannerSearchTermination {
  status: PlannerSearchTerminationStatus;
  reachedLimits: PlannerSearchLimitKind[];
  limits: PlannerOptions;
  expandedStates: number;
  completedTargetCount: number;
  totalTargetCount: number;
}
```

statusの決定順序は次のとおりとする。

1. `cancelled`: ユーザーが探索をキャンセルした
2. `completed`: 全enabled TargetがIdealへ到達した
3. `incomplete`: それ以前に `PlannerOptions` boundが探索を打ち切った
4. `exhausted`: boundに到達せず探索が自然終了し、全Target完成Planが無かった

`PlannerBeamSearchResult.termination` と `PlannerResult.termination` が保持する。
`PlannerOrchestrationResult` は `PlannerResult` を継承するため同じ値を引き継ぐ。
複数回full Beam Searchが走った場合は、結果として採用したrunのterminationとする。

`termination` はruntime result metadataであり、`ProductionPlan`、`PlanStep`、
`BuildListEntry`、DB schemaへ永続化しない。structured-clone可能なplain dataとして
Worker境界をそのまま通し、Worker側でwarningから再構築しない。

#### warningとの役割分担

`max_steps_reached` / `max_expanded_states_reached` PlannerWarningは診断情報として残す。

- UI / Application / PersistenceはUI制御authorityとして `termination` だけを読む
- warning messageを文字列解析して可用性を判断してはいけない
- `reachedLimits` はwarning一覧のコピーではない。`completed` な探索でもboundへ到達した
  場合は `reachedLimits` が非空になり、warningと矛盾しない
- Beam Searchへ到達しなかったrun（入力invalid、orchestration bound）は
  `reachedLimits` を空にする。停止理由はそれぞれのwarningが報告する

#### incomplete resultの扱い

`status === "incomplete"` のresultは、探索途中のpartial Beam Search artifactであり、
完成したProduction Planではない。

- `PlannerResult.plan` はnullにせず、partial Planをそのまま保持してよい
- B8 constrained orchestration内部の `isConstrainedTrialAdoptable()` は従来どおり
  partial Planを利用してよい。この内部契約は変更しない
- 一方、Persistenceは `planner_result_invalid` としてfail closedし、
  実行可能なDraft ProductionPlanとして保存しない
- 生成BuildListEntriesも単独では保存しない
- UIは `/plans/{id}` へnavigateしない
- UIは到達したbound、設定値、探索状態数、完成Target数、設定見直し案内を表示する

`status === "exhausted"` は「探索未完了」ではない。入力・Conflict・resourceにより
complete Planが無かった通常の結果として、従来どおりの意味と挙動を維持する。

#### Calculation compatibility

この変更はBeam Searchの展開、評価、Conflict検出、Trace Replay、PlanStep生成、
`ProductionPlan` 永続形状のいずれも変更しない。同じ `PlannerInput` に対する計算結果は
従来と同一であり、変わったのは保存時のartifact受け入れ判定だけである。

それでもこれはCalculation schema境界であり、
`CURRENT_CALCULATION_APP_SCHEMA_VERSION` を4から **5** へ更新する。

version 4以前のruntimeでは、`maxExpandedStates` などで探索が打ち切られても
`bestComplete ?? bestPartial` からpartial ProductionPlanが通常のDraftとして保存され得た。
永続化された `ProductionPlan` は `PlannerSearchTermination` を保持せず、ProductionPlan
互換判定はCalculationContextの完全一致であるため、保存済みversion 4 Planが
complete search由来かpartial search由来かをcurrent runtimeから判別できない。判別できない
以上、安全側として旧schema 4 ProductionPlanは一括でstaleとする。

- version 4以前のProductionPlanはversion 5 runtimeで `calculation_context_changed` とし、
  Worker preparation、conflict interaction、what-if、実行準備、実行へ進めない
- 保存済みStep、status、conflicts、rejectedBuildListEntriesをread migrationで書き換えず、
  exact persisted表示は維持する
- ProductionPlan互換判定は従来どおりexact CalculationContext matchのままとし、
  build-result例外を適用しない
- Candidate Search semanticsは変更していないため、version 2 / 3 / 4の
  BuildCandidate / BuildListEntryは、他のCalculationContext authorityが一致する
  version 5 runtimeで明示的に互換とする。version 1は引き続き非互換とする

旧artifactへのfail closedと、新しく計算されたresultへのfail closedは別の防御であり、
両方を維持する。

```text
version 5                     旧schema 4 ProductionPlanへのfail closed
termination.status incomplete 新規計算resultへのfail closed
```

`PlannerResultPersistenceService` の `termination.status === "incomplete"` 拒否は
schema versionを上げても削除しない。

Calculation semantics / artifact validity境界とDexie schemaは別概念であるため、
`DATABASE_SCHEMA_VERSION = 1`、`AppSettings.schemaVersion = 1`、
`PRODUCTION_RNG_ENGINE_VERSION = production-rng:c5-e2` は変更しない。

Planner内部ではBeam Searchの状態評価用にCandidate Scoreを計算する。

```ts
export interface CandidateScore {
  targetPriorityScore: number;
  satisfactionScore: number;
  distancePenalty: number;
  conflictPenalty: number;
  total: number;
}
```

推奨重み。

```ts
targetPriorityScore = target.priority * 10000
satisfactionScore =
  state.targetSatisfaction[target.id].hasIdeal ? 0 : 50000
distancePenalty = estimatedOperationCount * 100
conflictPenalty = conflictCount * 5000
```

`categoryScore` は存在しない。BuildListEntryのCandidateは常に理想品なので、
categoryで重み付けする対象がない。妥協checkpointはscoreへ加算も減算もしない
hard constraintであり、7.5で扱う。

制約。

- scoreはBeam Search内の状態比較用であり、単独で採用候補を確定しない
- scoreはPlanner内部の比較用であり、初期版UIで高度なユーザー調整は提供しない
- Debug Modeではscore内訳を表示してよい
- Practical優先(practical-first)の評価項目は存在しない。Plannerが追う到達目標は
  Targetの理想品だけである
- `hasPractical` は6章の充足判定として残るが、Beam Searchの目標にはしない
- 選択済みcheckpointはscoreではなくhard constraintとして扱う(7.5)
- `isProtected = true` の武器に対するReset Bonuses・Keep Bonuses・Reset Skillsはpenaltyではなく実行不能な展開として除外する
- `status` はユーザー管理ラベルであり、score項目にしない。未分類武器の本数はPlanner scoreへ影響しない

### 7.3 Plan quality preference: 武器切替の最小化

correctness / feasibilityより下位のPlan quality preferenceを1つ定義する。

同等にcorrectで、既存評価も同点のPlanner state / Planが複数ある場合、
実際のゲーム操作で対象武器を持ち替える回数が少ない方を優先する。

これはcorrectness ruleではない。武器切替が多いPlanも正しく実行可能なPlanである。

#### 優先順位

```text
correctness / feasibility
  -> 選択済みcheckpointの充足（hard constraint、7.5）
  -> Target satisfaction
  -> 既存evaluationScore（Target priority、satisfaction、resource cost、action count、conflict）
  -> preferred source match（7.4）
  -> weaponSwitchCount 昇順
  -> 既存semantic stable tie-break
  -> 既存trace stable tie-break
```

`weaponSwitchCount` をTarget satisfactionや既存costより上位へ置かない。
`evaluationScore` へ大きなweightとして混ぜ込まない。切替1回・操作200回のPlanが
切替2回・操作100回のPlanより優先されてはならない。

#### metric対象Operation

Gogma武器を選択して継続操作する次の3操作だけを対象とする。

```text
reset_bonuses
keep_bonuses
reset_skills
```

`create_normal_artian` と `convert_normal_to_gogma` は
「継続して操作している復元対象武器」というsubjectを持たない。v1ではこれらを
metric対象にせず、subjectとしても記録しない。曖昧な定義を広げないための
意図的な限定であり、後から必要になればformal specを更新して拡張する。

`reserve_weapon` はPlanner-only actionであり、ゲーム上の操作ではない。
switch countを増やさず、直前subjectも変更しない。したがって

```text
水 Keep -> reserve -> 火 Reset
```

は `水 -> 火` の1 switchである。

#### weapon subject identity

`physicalActionKey` をweapon subject keyとして流用してはならない。同キーは
operation typeとCounter before / afterを含むため、同じ武器を連続操作しても
actionごとに変わり、「同じ武器か」の判定に使えない。

subject identityは操作対象の武器だけで決める。

- concrete OwnedWeapon: `sourceOwnedWeaponId` を持つ操作は、どのBuildListEntryが
  駆動しても同一subject
- transient Gogma: `sourceOwnedWeaponId = null` の操作は7.0のEntry-local physical
  subject契約に従い、BuildListEntryごとに別subject

#### 数え方

- 直前のmetric対象操作と同じsubjectなら +0
- 直前subjectが `null`（branch最初のmetric対象操作）なら +0
- 直前subjectと異なるsubjectなら +1
- metric対象外操作はcountも直前subjectも変更しない
- physical action sharingで1回の物理操作が複数Entryを進めた場合、
  実際の物理操作は1回なのでswitch判定も1回だけ行う
- silent fast-forward（7.0.2）は実物理操作ではないため数えず、直前subjectも変えない

#### Planner runtime state

`PlannerSearchState` はこのmetricをincremental runtime stateとして保持する。

```ts
weaponSwitchCount: number;
lastWeaponOperationSubjectKey: string | null;
```

初期値は `0` と `null` である。state比較のたびにTrace全体を走査して
O(trace length)で再計算してはならない。

いずれも非永続のPlanner runtime stateであり、`RouteOperation`、`BuildRoute`、
`BuildCandidate`、`ProductionPlan`、PlanStep、DB schemaへ追加しない。

`createPlannerSearchStateSemanticKey()` へは追加しない。両fieldは既にsemantic keyへ
含まれるtrace projectionの純粋な関数であり、各actionの `primaryBuildListEntryId` と
`progressedRoutePositions` が保存済み `RouteOperation`、したがってweapon subjectを
一意に決める。同じsemantic keyを持つstateは常に同じ両値を持つため、dedup identity、
以後のswitch計算、決定的tie-breakのいずれも整合する。

#### Beam Searchへの影響

これはranking preferenceであり、7.0.2のrequired / skippable execution eligibilityのような
semantic pruningではない。

- 武器切替が増えるbranchを実行不能として削除しない
- rejectionを記録しない
- conflictを生成しない
- physical action sharing、silent fast-forward、conflict semantics、Trace Replay
  semanticsを変更しない

上限付きBeam Searchであるため、武器切替回数の絶対最小は保証しない。
同じ入力・同じEngine fixture・同じ定数に対する決定性は従来どおり維持する。

#### Calculation compatibility

この変更は実行可能なPlanの意味を変えず、同等にcorrectな複数Planからどれを優先するかだけを
変える。既存のversion 4 ProductionPlanは武器切替が現行Plannerより多くても物理的・意味的に
実行可能なままである。したがって `CURRENT_CALCULATION_APP_SCHEMA_VERSION` を更新せず、
`DATABASE_SCHEMA_VERSION`、`AppSettings.schemaVersion`、
`PRODUCTION_RNG_ENGINE_VERSION` も変更しない。

### 7.4 Plan preference: Targetの優先起点

`TargetWeapon.preferredOwnedWeaponId`（[DATA_MODEL.md](./DATA_MODEL.md) 8.5）は、Plannerでも
hard constraintにしない。correctness、選択済みcheckpointの充足、Target satisfaction、
Target priority、operation / resource / conflict cost、実行可能性はすべてpreferredより上位
である。preferred起点は、それらが同等の場合のPlan preferenceとする。

#### 優先順位

```text
選択済みcheckpointの充足
  -> 既存evaluationScore / correctness / cost
  -> preferred source match
  -> weaponSwitchCount
  -> semantic stable tie-break
  -> trace stable tie-break
```

preferredをweighted scoreへ混ぜ込まない。1操作以上遠いRouteをpreferredという理由だけで
逆転させてはならない。同時に、同評価のbranchがstable keyだけを理由にpreferred Routeより
先に残ることがないよう、Beam Searchの途中stateでもこのpreferenceを適用する。

#### preferred判定

```ts
entry.candidateSnapshot.route.sourceOwnedWeaponId === target.preferredOwnedWeaponId
```

- 所持Normal Routeはsource IDで判定できる
- 既存Gogma Routeはsource IDで判定できる
- 新規Normal Routeはsourceが `null` のためpreferredにならない。Targetのpreferredが `null` の
  場合もpreference自体が無効であり、`null` source同士を一致とみなさない

#### Planner runtime state

`PlannerSearchState` はこのpreferenceをincremental runtime stateとして保持する。

```ts
preferredSourceProgressCount: number;
```

初期値は `0` である。1つのSearch Actionが進めたBuildListEntryのうち、preferred判定を満たす
ものの数だけ加算する。physical action sharingで1回の物理操作が複数Entryを進めた場合は、
その物理操作が進めたpreferred Entryだけを数える。silent fast-forward（7.0.2）はEntryを進めた
記録を持たないため加算しない。

非永続のPlanner runtime stateであり、`RouteOperation`、`BuildRoute`、`BuildCandidate`、
`ProductionPlan`、PlanStep、DB schemaへ追加しない。`createPlannerSearchStateSemanticKey()`
へも追加しない。`weaponSwitchCount` と同様に、semantic keyが既に保持するtrace projection
（各actionの `primaryBuildListEntryId` と `progressedBuildListEntryIds`）の純粋な関数だからである。

#### Beam Searchへの影響

7.3と同じくranking preferenceであり、semantic pruningではない。

- preferred以外のRouteを実行不能として削除しない
- rejectionを記録しない
- conflictを生成しない
- physical action sharing、silent fast-forward、Counter fast-forward、conflict semantics、
  weapon switch semantics、Trace Replay semanticsを変更しない

#### 自動変更の禁止

`reserve_weapon` は `TargetWeapon.preferredOwnedWeaponId` を自動変更してはいけない。
Practicalを確保した、Idealを確保した、新規Gogmaを登録した、既存Gogmaを更新したという理由
だけで優先起点を自動設定・付け替えしない。優先起点はユーザーがTarget Weapons画面から設定する
計画入力である。

#### Target Satisfaction

Target Satisfactionは従来どおり武器種、属性、実際のボーナス、実際のスキル、Target条件から
判定する。`preferredOwnedWeaponId` を見てTarget Satisfactionを制限してはいけない。
Target AがWeapon Xを優先起点にしていても、条件を満たすWeapon YによってTarget Aが
Ideal satisfiedになってよい。

### 7.5 選択済みcompromise checkpointの扱い

`BuildListEntry.selectedCheckpointOpportunityIds`（[DATA_MODEL.md](./DATA_MODEL.md) 9.4）は
**hard constraint** である。Plannerはこれを無視・解除・別opportunityへの読み替えの
いずれも行わない。できるのは「それを満たすPlanを作れない」と報告することだけである。

#### 7.5.1 選択済みcheckpoint終端はfast-forwardしない

選択したcheckpointが終わるRoute unitは、7.0.2のsilent fast-forward対象から外す。
`canSkipWhenCounterPassed = false` とする。ユーザーはその瞬間に実際にその妥協武器を
手に持つのだから、その状態は「直後に上書きされる未観測な中間状態」ではない。

選択されていないcheckpoint相当の中間unitは従来どおりskip可能である。
選択したcheckpointより手前にあり、次の操作が出力全体を書き換えるprefix unitも
従来どおりskip可能である。skipしてもcheckpoint状態そのものは変わらないためである。

#### 7.5.2 checkpointはCounter競合の当事者になりうる

7.0.2の通り、skip可能unitはCounter位置の競合参加者にならない。選択によって
`canSkipWhenCounterPassed = false` になったunitは、通常の必須unitと同じく
`same_gogma_counter` / `same_skill_counter` の当事者になる。

したがって2武器が同じCounter位置で別々のcheckpointを選択し、その2 unitが
1つの共有物理actionにならない場合、競合として報告する。ユーザーは作成リストで
どちらかのcheckpointを別opportunityへ変更するか解除することで解消できる。

1つの共有物理actionが複数Entryのcheckpointを同時に達成できる場合は、
7.0の共有契約どおり1回だけ実行し、重複操作しない。

#### 7.5.3 未到達のcheckpointはreserveを止める

`reserve_weapon` の展開条件に、そのEntryの選択済みcheckpointをすべて実際に
到達済みであることを加える。満たさない場合は
`selected_checkpoint_not_reached` として拒否する。

到達記録は `PlannerSearchState.reachedCheckpointOpportunityIdsByEntryId` が持つ。
記録されるのは実際に実行されたunitだけである。checkpoint終端はfast-forwardされない
ので、silent fast-forwardで到達済みになることはない。

同一groupの別opportunityへ到達しても、選択したopportunityの到達にはならない。
Plannerが選択を勝手に読み替えないという契約はここで具体化される。

#### 7.5.4 PlanStepはmilestoneを持つが、checkpoint専用Stepは作らない

checkpointは新しい `PlanStepOperationType` ではない。到達を生む物理Step
（Reset Bonusesなど）に `PlanStep.checkpointMilestones` を付ける。

```ts
export interface PlanStepCheckpointMilestone {
  buildListEntryId: BuildListEntryId;
  targetWeaponId: TargetWeaponId;
  checkpointGroupId: CompromiseCheckpointGroupId;
  checkpointOpportunityId: CompromiseCheckpointOpportunityId;
  remainingOperationCount: number;
}
```

- checkpoint到達でOwnedWeaponをreserveしない
- checkpoint到達でstatusも保護も変更しない
- checkpoint到達でPlanは止まらない。`remainingOperationCount` 分の後続Stepが必ず残る
- 従来のreserve semantics（`status = "ideal"`、新規武器は保護あり）は、最終的に
  理想品が完成したときだけ適用する
- 1つの共有Stepが複数Entryのcheckpointを達成した場合、milestoneはEntryごとに
  1件ずつ並ぶ。Stepを複製しない

Trace Replayは、milestoneを出す前に、そのRoute位置でreplayした状態が選択された
opportunityの `restorationBonuses`（slot順まで）、`restorationBonusScope`、
`seriesSkillId`、`groupSkillId` と一致することを検証する。一致しない場合は
`checkpoint_state_mismatch` としてfail closeする。

#### 7.5.5 選択変更とPlanのstale

checkpoint選択はPlanの `PlanningInputSnapshot.buildListEntriesHash` に含める。
選択を変えるとhashが変わるので、既存Planは通常のBuild List変更と同じく
再計算対象になる。一方でBuildListEntry自体はstaleにならない
（[DATA_MODEL.md](./DATA_MODEL.md) 9.4）。

---

## 8. 在庫シミュレーション

Plannerは所持レア8通常アーティアと所持巨戟アーティアの両方を有限のOwnedWeapon資源として扱う。レア6・7通常アーティアはv1 Inventoryへ含めない。

```ts
export interface SimulatedInventory {
  ownedWeapons: OwnedWeapon[];
  consumedWeaponIds: OwnedWeaponId[];
  reservedWeaponIds: OwnedWeaponId[];
  createdWeaponIds: OwnedWeaponId[];
}
```

武器状態の扱い。

- レア8通常アーティアかつ保護OFF: `owned_normal_artian_to_gogma` の変換元として使用可能
- 通常アーティアかつ保護ON: 変換元として使用しない
- 巨戟アーティアかつ保護OFF: Reset Bonuses / Keep Bonuses / Reset Skillsの起点として使用可能
- `isProtected = true`: Reset Bonuses・Keep Bonuses・Reset Skillsへ使用しない
- `status` は使用可否の判定に一切使用しない。未分類 / 実用 / 理想はユーザー管理ラベルである
- 所持レア8通常アーティアを巨戟化したStateでは元通常アーティアをInventoryから除き、同じ通常アーティアを二重使用しない
- `owned_normal_artian_to_gogma` ではconvert_normal_to_gogma適用時に元NormalをInventoryから削除し、変換後GogmaはまだOwnedWeaponとして追加しない。以後そのNormal IDは別Routeへ利用できない
- 通常アーティアはstatusを持たない

### 8.1 所持武器を素材として消費するモデルは存在しない

所持している巨戟アーティア武器そのものを消耗品として消費するv1 Planner仕様は撤去した。
Plannerは次の概念を一切持たない。

```text
use_weapon_as_material        RouteOperation
canUseAsMaterial              Domain rule
canConsumeMaterialWeapon      SimulatedInventory
consumeMaterialWeapon         SimulatedInventory
consumedMaterialWeaponCount   PlannerSearchState
PlannerMaterialRequirement    Planner-only DTO
PlannerMaterialAssignment     Planner-only DTO
material_weapon_shortage      PlannerWarningKind
create_material_gogma         PlanStepOperationType
change_owned_weapon_status    PlanStepOperationType
```

したがってPlannerは次を行わない。

- 素材用巨戟の不足を判定する
- 素材用巨戟を補充するRoute / Stepを生成する
- 素材補充だけを目的にNormal / Gogma / Skill Counterを進める
- 旧PracticalをMaterialへ変える確認付きStepを予定する
- statusだけを変更する専用Stepを予定する
- 素材武器の消費本数をscoreへ加算する

`SimulatedInventory.consumedWeaponIds` は維持する。所持通常アーティアの巨戟化で元武器を
在庫から消費し、同じsourceを二重利用しないためのsemanticsであり、素材消費とは別概念である。

statusを書き換える経路は次の2つだけである。

```text
任意のユーザー管理ラベル変更
→ Owned Weapons画面の通常CRUD

Candidateを reserve_weapon で確保
→ 理想品ラベルを設定する
   新規生成武器 → status = ideal、保護あり
   既存Gogma更新 → status = ideal、保存済み保護値を維持する

妥協checkpointへ到達しただけではstatusも保護も変更しない（7.5.4）。
```

`reserve_weapon` の設定は新規生成Candidateでも既存Gogma Candidateの確保でも同じであり
([DATA_MODEL.md](./DATA_MODEL.md) 11.3)、既存Gogmaの保護状態は従来契約どおり維持する。この場合もstatusはnon-semanticの
ままで、Search eligibility、Plannerのoperation可否、Target Satisfaction、semantic hashを
決めない。Material化のためのstatus変更と `change_owned_weapon_status` PlanStepは廃止した。

### 8.2 ゲーム内アイテム素材

復元強化やスキル再抽選が消費するゲーム内アイテム素材は別概念であり、
`MaterialRequirement`、`MaterialCostMaster`、`PlannerMasterSubset.materialCosts`、
`ProductionPlan.requiredMaterials`、`InventoryChange.materialRequirements` として維持する。

制約。

- 初期版ではアイテム素材の所持数不足をPlan不可理由にしない
- 必要数を表示するだけで、所持数管理や不足判定を行わない
- protected武器へのReset Bonuses・Keep Bonuses・Reset Skillsが必要な探索展開は生成せず、該当BuildListEntryを不採用として理由を残す
- Search後に起点武器がprotectedへ変わった場合、Bonus / Skill amendmentを必要とするEntryはPlanner入力validationで実行不能とする
- PlannerはCandidate Route内の具体的な起点OwnedWeapon IDを別武器へ差し替えず、reserveはBuildRouteを書き換えずPlanner-only Stepとして追加する

---

## 9. 競合検出

同じRNG位置または同じ資源を同時に必要とする候補を競合として扱う。

競合種別は `DATA_MODEL.md` の `ConflictKind` を使用する。

検出条件。

- 同じGogma Counter位置で同時取得できない候補
- 同じSkill Counter位置で同時取得できない候補
- 同じ通常アーティアCounter位置で同時取得できない候補
- 同じOwnedWeaponを起点として排他的に使用・消費する候補

Counter位置の競合対象は、その位置で物理的に実行する必要があるunitだけである。
`canSkipWhenCounterPassed` なunitはその位置を排他的に必要としないため、competition
participantにもconflict resolutionのblocking対象にもならない（7.0.2）。同一physical
actionとしてshareできる場合も従来どおり競合ではない。`same_owned_weapon_consumed` には
この除外を適用しない。

選択済みcheckpointの終端unitは `canSkipWhenCounterPassed = false` になるため、
通常の必須unitと同じく競合当事者になりうる（7.5.2）。

ただし競合でないことと実行順序が自由であることは別である。必須unitとskip可能unitが同じ
Counter位置にある場合、必須unitを先に実行する順序をPlanner自身が一意に決める（7.0.2）。
ユーザー選択の競合ではないため、Conflict Resolution UIへ出さない。

解決方針。

1. Target priorityが高い候補
2. 見送った場合の次候補までの距離が遠い候補
3. 武器消費が少ない候補
4. 操作量が少ない候補

ユーザー選択が必要な場合。

- score差が小さい
- どちらも高優先度Targetの候補

### 9.5 checkpointが関係する競合

競合の当事者が選択済みcheckpointの終端unitである場合、`PlanConflict` へ
typed metadataとしてそれを記録する。

```ts
export interface PlanConflictCheckpointParticipant {
  buildListEntryId: BuildListEntryId;
  checkpointGroupId: CompromiseCheckpointGroupId;
  checkpointOpportunityId: CompromiseCheckpointOpportunityId;
}
```

`PlanConflict.checkpointParticipants` は、その競合のどのEntryが「自分で選んだ
checkpointのために」その位置を必要としているかを示す。UIはこれを使って
「この競合には選択済みcheckpointが関係しています。作成リストでcheckpointを変更
または解除してください。」と案内できる。

- `PlanConflict.id` の生成規則には含めない。既存のConflictKind + kind固有position +
  sorted participant Entry IDのままである
- 新しい `ConflictKind` を追加しない
- Plannerがこのmetadataを見て選択を自動変更することはない

#### 9.5.1 checkpoint競合は勝者選択で解決できない

`checkpointParticipants` が1件以上ある競合は、汎用の `PlannerConflictResolution`
では解決できない。どちらのEntryを優先しても、もう一方の選択済みcheckpointを
Plannerが落とすことになるためである。保守的に、参加者の一方だけがcheckpointで
あっても、その競合全体を「この候補を優先」の対象外とする。

この拒否はDomain authorityであり、UIだけの無効化ではない。

- 判定は `conflictResolutionRefusalReason()` の1箇所に置く。競合が見つからない、
  選択Entryが参加者でない、選択済みcheckpointが関係する、のいずれかで拒否する
- 初期conflict detectionは拒否したresolutionを適用せず
  `selectedBuildListEntryId = null` のままにする。半適用はしない
- Beam Searchは `invalid_conflict_resolution` warningを返し、Application / UIは
  既存のfail closed(11.4)でPlanを保存しない
- constrained re-searchの `preparePlannerFixedConflictConstraints()` は
  `checkpoint_conflict` で失敗し(all-or-nothing)、再検索を開始しない。
  preflightの再対応付け(9.2.3.1)も、対応先の競合がcheckpoint競合なら
  `checkpoint_conflict` で失敗する
- Plan UIは、その競合の全participantを `checkpoint_conflict` として利用不可にし、
  「比較する」「この候補を優先」を無効化して作成リストへの導線を示す
  ([UI_FLOW.md](./UI_FLOW.md) 11.1)

解決手段は作成リストでcheckpointを変更または解除することだけである。
同じ武器の同じ操作が複数Entryのcheckpointへ同時に到達する場合は、従来どおり
1つの共有physical actionであり競合ではない(7.5.2)。

#### 9.5.2 選択済みcheckpointを持つTargetは再検索対象外

constrained re-search(9.2)とwhat-if(9.2.4)は、participant Entryが
`selectedCheckpointOpportunityIds.length > 0` を持つTargetのRouteを置き換えない。

- 選択済みcheckpointを別のopportunityへ自動的に移さない
- 「同じ性能へ到達する別Route」へ差し替えない
- 選択を空にして再検索しない

orchestrationは該当Targetの `PlannerConflictWork` を
`blockedBySelectedCheckpoint = true` とし、enumeration・materialize・trialを一切
行わずに競合をそのまま返す。warning kindは
`selected_checkpoint_blocks_constrained_search`、what-ifの `outcome.status` は
`blocked_by_selected_checkpoint` とする。選択を持たないTargetの再検索は従来どおりである。

競合をユーザーが選択した場合は、現在入力へ `PlannerConflictResolution` を追加して
Plannerを再実行する。`conflictKey` は検出された `PlanConflict.id` と対応し、その競合では
選択Entryを優先して相反Entryを採用しない。これは局所的な競合解決であり、全Planの
作成順固定ではない。

`PlanConflict.id` はrandom IDではなく、ConflictKind、kind別の競合位置、sort済みの
BuildListEntry IDsからstable hashで生成する。same_gogma_counterはGogma Counter、
same_skill_counterはSkill Counter、same_normal_counterはNormalArtianCounter IDと位置、
same_owned_weapon_consumedはOwnedWeapon IDを位置情報として使う。Candidate IDと
PlannerIdFactoryは使用しない。

第9の適用時には、再検出された競合のIDがconflictKeyと一致し、選択Entryがその競合の
参加BuildListEntryに含まれる場合だけresolutionを適用する。

選択Entryが削除済み、stale、Target無効、Capability不足、または保護状態変更により
実行不能ならresolutionを適用せず `invalid_conflict_resolution` warningを返し、再選択を促す。

protected武器へのReset Bonuses・Keep Bonuses・Reset Skillsは競合として解決せず、常に実行不能として `requires_protected_weapon` の不採用理由を付ける。

RouteOperation別のRNG位置は実際に消費するstreamで判定する。`convert_normal_to_gogma` は `same_skill_counter` の競合対象であり、`same_gogma_counter` として扱わない。Reset SkillsもSkill、Reset / KeepだけがGogma、forgeだけが該当Normal Counter位置を競合資源とする。

## 9.1 Candidate SearchとPlannerの責務分離

```text
Candidate Search
  このTarget単体を現在のRNG状態から作るなら、
  近い位置にどの実用品・理想品があるかを高速に求める

Planner
  複数Targetを同時に作る場合に、Counter操作をどう両立させるかを決める
```

Candidate Searchは、Plannerで将来競合する可能性があるという理由だけで、2個目以降の
同一Ideal、遠いCounter位置の代替Ideal、Bonus代替 × Skill代替のCartesian productを
初回検索で先読みしない。初回検索はcanonical Idealを1件確定した時点で終了し、
そのRoute上のcheckpointを記録済みtraceから抽出する
([SEARCH_SPEC.md](./SEARCH_SPEC.md) 5.6 / 5.8参照)。

複数Target間でCounter競合が実際に発生した場合にだけ、Plannerが必要に応じて次を調べる。

- 競合したTargetの再検索
- 一方を優先した場合の他方の次に実行可能なIdeal Route
- どちらを優先するとどの程度遠くなるか

ただし選択済みcheckpointを持つTargetは再検索の対象外である(9.5.2)。

## 9.2 Planner-driven constrained re-search

B8-Aで正式契約を確定した。実装はB8-B1以降で行う。

- 9.2.1〜9.2.5はB0で固定した責務と禁止事項であり、B8-AでもB9-A2でも変更しない
- 9.2.6以降がB8-Aで追加した正式契約である
- 9.2.4のwhat-if比較はB9、競合UIはB10であり、B8では実装しない
- 9.2.4.1〜9.2.4.13はB9-A2で確定したwhat-if比較の正式契約である。B8の契約
  (9.2.1〜9.2.3.1、9.2.5〜9.2.17)とB0固定契約は変更していない

B8 architecture自体はProduction RNG semantics、RouteOperationの意味、ProductionPlanの
永続shape、PlanStepの意味、既存BuildListEntryのshapeを変更しない(9.2.17)。

### 9.2.1 開始位置を後方固定しない

再検索の開始位置を次のような単純な後方検索へ固定してはならない。

```text
禁止 : startCounter = conflictingCounter + 1
```

`Ideal +10` が競合していても、`Practical +4` や `Practical +6` のように競合位置より
前に利用可能な実用品が存在し得る。再検索は元のSearch / RNG起点を基準に再評価し、
Plannerが固定しているCandidateとconflict contextを制約として渡して、その制約下で
実行可能かどうかを判定する。

ここでいう「元のSearch / RNG起点」は次を指す。

```text
正 : Planner計算開始時のcurrent validated Search / RNG snapshot
誤 : 過去のUI Candidate Search request
```

過去のUI requestは永続化されておらず、BuildListEntryは `searchStateHash` /
`referencedOwnedWeaponsHash` というhashしか保持しないため、Planner / BuildListから
復元できない。したがってenumeratorへ渡す起点はPlanner計算開始時の現在状態から構成する
([SEARCH_SPEC.md](./SEARCH_SPEC.md) 5.6.7)。「競合位置より後ろへ後方固定しない」という
本節の禁止事項は変わらない。

### 9.2.2 Counter位置だけで除外しない

同一Counter位置でもPlanner上shareableなoperationが存在するため、次のような
単純除外を行ってはならない。

```text
禁止 : Counter 351を使っている -> Counter 351を使うCandidateはすべて禁止
```

判定は本書の既存契約に基づく。

- counter precondition(runtime counterと `counterBefore` の一致)
- action identity
- shareable operation

Candidate Search側にこれらのPlannerロジックを複製してはならない。
望ましい責務分担は次である。

```text
Candidate Search
  -> Candidateを順次提示

Planner / constrained search orchestration
  -> 固定Candidateと共存可能か評価

実行不能 -> 次のCandidate探索を継続
実行可能 -> 次のIdeal Routeとして採用
```

### 9.2.3 Planner conflict context

再検索へ渡す競合文脈は、B8 orchestration専用の非永続transient DTOとする。
既存の `PlanConflict` と `PlannerConflictResolution` を変更・置換しない。
永続化せず、`ProductionPlan` へ埋め込まない。

保持する情報は少なくとも次とする。

| 項目 | 粒度 | 内容 |
| --- | --- | --- |
| `PlanConflict.id` | 競合 | 検出時点のstable conflict key |
| ConflictKind | 競合 | 既存の `ConflictKind` |
| 競合資源identity | 競合 | 下記の競合資源identity |
| counter stream | 競合 | Skill / Gogma / Normal。`same_owned_weapon_consumed` では null |
| Normal Counter ID | 競合 | `same_normal_counter` の場合のNormalArtianCounter ID |
| `counterBefore` | 競合 | 競合しているCounter位置 |
| 競合対象OwnedWeapon ID | 競合 | `same_owned_weapon_consumed` の場合の排他消費OwnedWeapon ID |
| `counterAfter` | participant | participantごとの操作後Counter位置 |
| operation type | participant | `RouteOperation` の種別 |
| `sourceOwnedWeaponId` | participant | 必要な場合の起点武器 |
| `physicalActionKey` | participant | 既存 `PlannerRouteUnit.physicalActionKey` |
| BuildListEntry ID | participant | 競合参加Entry |
| TargetWeapon ID | participant | 競合参加Target |
| Candidate semantic fingerprint | participant | 9.2.12のsemantic identity |
| 固定制約 | 競合 | 固定して残すBuildListEntry / TargetWeapon |

`counterAfter`、operation type、`sourceOwnedWeaponId`、`physicalActionKey` は
競合単位ではなくparticipant単位で保持する。参加者ごとに異なり得るためである。

#### 競合資源identity

競合資源identityはConflictKindごとに次で構成する。participant BuildListEntry集合を
含めない。これは9.2.3.1の再対応付けで、participant集合が変わっても同じ物理競合を
同定するための鍵だからである。

| ConflictKind | 競合資源identity |
| --- | --- |
| `same_gogma_counter` | ConflictKind、Gogma Counter位置 |
| `same_skill_counter` | ConflictKind、Skill Counter位置 |
| `same_normal_counter` | ConflictKind、NormalArtianCounter ID、Normal Counter位置 |
| `same_owned_weapon_consumed` | ConflictKind、排他消費されるOwnedWeapon ID |

`same_owned_weapon_consumed` の競合対象OwnedWeapon IDは、conflict context DTOへ
明示的な独立fieldとして保持する。participantの `sourceOwnedWeaponId` で代用しては
ならない。両者は別concernのfieldであり、participant単位のfieldから競合資源を
復元する実装にしない。

これは `PlanConflict.id` の生成規則([DATA_MODEL.md](./DATA_MODEL.md) 11.8)を
変更するものではない。`PlanConflict.id` は従来どおりConflictKind、kind別の競合位置、
sort済みBuildListEntry IDsから生成する。競合資源identityは、そのうち
BuildListEntry IDsを除いた部分をorchestrationが個別に保持するtransient値である。

`PlanConflict.id` は既存契約どおりstable conflict keyであり、conflict contextは
その周辺情報を補う位置づけである。既存の `PlannerConflictResolution` を置き換えない。
このDTOをSearch Domainへ渡してはならない(9.2.9)。

### 9.2.3.1 conflict preflightとConflict Resolution再対応付け

`PlanConflict.id` はparticipant BuildListEntry集合を含む。したがってgenerated Entryを
加えたaugmented PlannerInputでは、**同じ物理競合でもIDが変わり得る。**

```text
元のPlan            : same_gogma_counter, position 351, entries { E1, E2 }     -> id X
generated Entry追加後 : same_gogma_counter, position 351, entries { E1, E2, G1 } -> id Y
```

元の `conflictKey` をそのまま再利用してはならない。IDが変わった場合、その
`PlannerConflictResolution` は再検出された競合と一致せず、既存の適用規則により
無視されて `invalid_conflict_resolution` になるためである。

再対応付けをfull Beam Search実行**後**に行う設計にしてはならない。次は循環である。

```text
禁止 : Beam Search完全再実行 -> Conflict取得 -> resolution再構築 -> もう一度完全再実行
```

resolutionが無いまま実行したBeam Searchの結果は、ユーザーの固定意図を反映していない。
その出力からresolutionを組み立てて再実行するのでは、full Beam Searchが必ず2回以上必要に
なり、`maxPlannerReruns` の意味も曖昧になる。

正式順序は次とする。再対応付けはfull Beam Searchの前に、既存Planner authorityによる
**initial conflict preflight** で行う。

```text
temporary generated Entryを含むaugmented PlannerInputを作成
  ↓
preflight用に、staleな旧conflictKeyを適用しない入力を作成
  ↓
validatePlannerInput
  ↓
validation.validBuildListEntries
  ↓
createInitialPlannerSearchState
  ↓
通常Plannerと同じinitial relevant-entry selection
  ↓
createPlannerRouteUnitPlans
  ↓
detectPlannerConflicts
  ↓
元の全fixed constraintを現在のConflict群へ一意に再対応付け
  ↓
現在の PlanConflict.id で PlannerConflictResolution[] を再構築
  ↓
その完全なresolution配列を持つaugmented PlannerInputで
Beam Searchを初期Stateから完全再実行
  ↓
Planner / Trace Replayを最終coexistence authorityとする
```

#### preflightのvalidation authority

preflightは通常Beam Searchとまったく同じvalidation authorityを使う。
raw `BuildListEntry` から直接preflightしてはならない。

理由。`createInitialPlannerSearchState()` は `ValidatedBuildListEntry[]` を要求し、
通常のBeam Searchは `validatePlannerInput()` が返す `validBuildListEntries` だけを
使う。preflightだけraw Entryを使うと、staleness、capability、prediction support、
protection、CalculationContext互換性の判定が通常Plannerと乖離する。

契約。

1. preflight入力は、staleな旧 `conflictKey` を持つ `conflictResolutions` を
   適用しない状態で作る。旧keyはこの時点で一致しないため、適用すると
   `invalid_conflict_resolution` を誤って発生させる
2. `validatePlannerInput()` を通し、`validation.validBuildListEntries` を得る
3. `createInitialPlannerSearchState(input, validation.validBuildListEntries)` で
   初期Stateを作る
4. 通常Plannerと同じinitial relevant-entry selectionを適用する。Route unit planを
   持つEntryへの絞り込み、安定sort、初期Stateに対するentry relevance判定を
   通常経路と一致させる
5. `createPlannerRouteUnitPlans()` でRoute unit planを作る
6. `detectPlannerConflicts()` で `PlanConflict` を検出する。
   B8専用の `usedCounters` 等の簡易競合判定を追加してはならない(9.2.11)

fail closed規則。

```text
generated Entry が validation で除外された  -> そのCandidate trialを採用しない
fixed Entry が validation で除外された      -> そのCandidate trialを採用しない
```

除外されたまま先へ進んではならない。除外理由は既存の
`excludedBuildListEntries` / warning契約をそのまま使う。

#### 二重実装の禁止

B8-Cでこの経路を独自に再実装し、通常Plannerと乖離させてはならない。

推奨契約は次である。

```text
現行 runPlannerBeamSearch のinitial conflict detection経路を
shared pure helperへ抽出し、
通常PlannerとB8 preflightの双方が同じhelperを使用する。
```

helperの具体的な名称と分割単位はB8-Cで決めてよい。ただし次の意味を二重実装しない。

```text
validation
validBuildListEntries
initial state
entry relevance
route unit plans
conflict detection
```

preflightは引き続きBeam Searchではなく、`maxPlannerReruns` に数えない(9.2.16)。

#### 全explicit resolutionの再対応付け

B8 orchestrationは、再検索対象となった競合のresolutionだけを保持してはならない。
`PlannerInput` には複数の `PlannerConflictResolution` が存在し得る。generated Entryの
追加でparticipant集合が変われば、**今回の再検索対象ではない別Conflictの
`PlanConflict.id` も変わり得る。**

```text
元のvalidated PlannerInput
  ↓
全てのvalid PlannerConflictResolutionを取得
  ↓
resolutionごとにtransient fixed constraintを作成
    fixed BuildListEntry ID
    fixed TargetWeapon ID
    fixed Candidate semantic fingerprint
    競合資源identity
  ↓
augmented preflight
  ↓
全fixed constraintを現在のConflict群へ再対応付け
  ↓
全て一意に対応できた場合のみ
現在の PlanConflict.id を使った PlannerConflictResolution[] を再構築
  ↓
その完全なresolution配列でBeam Searchを実行
```

対象となった1件だけを再構築し、他のユーザー明示resolutionを黙って捨ててはならない。

取得元は元のvalidated PlannerInputの `validation.validConflictResolutions` とする。
validationが既に無効と判定したresolutionを復活させない。

各fixed constraintごとの判定。

```text
一致1件                          -> current conflictKeyへ再構築
一致0件                          -> 推測しない
一致複数                          -> 推測しない
fingerprint不一致                 -> 推測しない
fixed Entryがvalidation除外       -> 推測しない
```

一致条件は次の両方である。

```text
競合資源identityが一致する
buildListEntryIds が fixed BuildListEntry ID を含む
```

再構築するresolutionの形は次とする。

```text
PlannerConflictResolution = {
  conflictKey: preflightで再検出した PlanConflict.id,
  selectedBuildListEntryId: fixed BuildListEntry ID,
}
```

既存のexplicit resolutionのうち1つでも安全に再対応付けできない場合は、そのCandidate
trialを採用せずfail closedにするか、ユーザーへConflictを返す。一部だけ再構築した
不完全なresolution配列でBeam Searchを実行してはならない。ユーザーへ再選択を求める
経路は既存の `invalid_conflict_resolution` と同じ扱いとする。

`recommendedBuildListEntryId` やPlanner bestStateから代替のfixed Entryを作らない
という9.2.7の契約は維持する。再対応付けできないことを、別Entryを固定してよい理由に
しない。

#### Beam Search実行

再構築できた完全なresolution配列を含むaugmented PlannerInputで、初期Stateから
Beam Searchを1回完全再実行する。共存可能性の最終authorityはこのBeam Searchと
Trace Replayであり、preflightではない(9.2.11)。

規則。

- preflightはConflict検出とresolution再対応付けのためだけに行う。Candidateの採否、
  共存可能性、Plan内容をpreflightの結果だけで決めない
- preflightは `maxPlannerReruns` に数えない。`maxPlannerReruns` はfull Beam Searchの
  実行回数だけを数える(9.2.16)
- fixed BuildListEntry IDは、ユーザーが選択した既存Entryである。generated Entryを
  fixed側へ昇格させない
- fixed Candidate semantic fingerprintは、fixed Entryがpreflightの時点で別Candidateへ
  すり替わっていないことの検証に使う。fingerprintが一致しない場合は再対応付けを
  成立させない
- 競合資源identityにparticipant BuildListEntry集合を含めない。含めると
  generated Entry追加によって必ず不一致になり、再対応付けが常に失敗する
- 再対応付けはorchestrationのtransient処理であり、`PlanConflict.id` の生成規則、
  `PlannerConflictResolution` の型、Beam Search内のresolution適用規則を変更しない

### 9.2.4 what-if比較

複数武器で競合した場合、ユーザーが「どちらを優先すべきか」を判断できる情報を将来提供する。

```text
Target Aを優先した場合
  Target B:
    次に実行可能なIdeal      +47

Target Bを優先した場合
  Target A:
    次に実行可能なIdeal      +12
```

契約。

- 一方を固定したPlanner制約下で、他方の次に実行可能なIdeal Routeまでの距離を求める
- 「競合Counter以降のIdealだけ」を探す仕様にしない。競合位置より前の位置で完成する
  Ideal Routeも、固定Candidateと共同実行可能なら候補である
- 選択済みcheckpointを持つTargetには代替Routeを求めず
  `blocked_by_selected_checkpoint` を返す(9.5.2)
- 距離の表現は既存の `estimatedGogmaAdvance` / `estimatedSkillAdvance` /
  `estimatedNormalAdvance` と `estimatedOperationCount` を用いる

what-if比較はB9で実装する。B8では実装しない。B8のorchestrationは、B9が明示的な
仮想fixed constraintを渡せる形へ将来拡張してよいが、B8でB9の機能を先取りしない。

B9-A2で正式契約を確定した。9.2.4.1〜9.2.4.13がその契約である。上記のB0固定契約
(距離表現、競合位置より前の位置も対象、後方固定の禁止)は変更しない。9.2.4.1以降は
それを具体化するものであり、9.2.1〜9.2.3.1、9.2.5〜9.2.17のB8契約も変更しない。

B9-A2は仕様文書だけを変更した。`src/**`、テスト、Worker protocol、DB schema、
schema version、Production RNG semantics、Candidate分類、Planner競合検出、
B8 orchestration、`defaultConstrainedEnumerationBounds`、
`defaultPlannerOrchestrationBounds`、`defaultCandidateSearchSettings`、
`defaultPlannerOptions` はいずれも変更していない。

#### 9.2.4.1 距離のbaseline

what-if距離のbaselineは次だけとする。

```text
正 : Planner計算開始時の ConstrainedSearchOrigin
```

これは9.2.1および[SEARCH_SPEC.md](./SEARCH_SPEC.md) 5.6.7の「元のSearch / RNG起点」と
同一であり、B8 constrained enumerationが既に使用している起点である。したがって
what-if距離は、enumeratorが返す `ConstrainedCandidate` のestimate値をそのまま用いる。

```text
estimatedOperationCount
estimatedGogmaAdvance
estimatedSkillAdvance
estimatedNormalAdvance
```

禁止。

```text
競合Counter位置からの差分
固定Candidate実行後Stateからの差分
新しいdistance尺度の新設
B9専用のscore / distance comparatorの新設
```

理由。上記4値はorigin基準のadvanceとして定義されており
([SEARCH_SPEC.md](./SEARCH_SPEC.md) 3.1)、9.2.4のB0契約が距離表現をこの4値へ固定している。
別のbaselineを採用すると、同じfield名で別の意味を持つ値が生まれる。

#### 9.2.4.2 Targetごとに1つの結果

what-ifが答えるのはTargetごとに1つである。

```text
このTargetが譲った場合、次に実行可能な理想品Candidateはどれだけ遠いか
```

constrained enumerationは理想品Candidateだけをyieldするため
([SEARCH_SPEC.md](./SEARCH_SPEC.md) 5.6.7)、category別の枠は存在しない。
`PlannerWhatIfTargetComparison` は `targetWeaponId` と1つの `outcome` を持つ。

- practical枠 / ideal枠という2枠構造を設けない
- 妥協状態をwhat-ifの代替解として提示しない。妥協は独立したRouteではなく、
  採用された理想品Routeのcheckpointとして作成リストで選ぶものである

#### 9.2.4.3 「次」のordering authority

**重要。** B9の「次に実行可能」は次で定義する。

```text
compareConstrainedCandidates() 順に最小であり、
かつscenario固定制約下のPlanner full rerun + Trace Replayによって
共存可能性が証明されたCandidate
```

禁止。

```text
visitConstrainedCandidates() で最初にdeliveryされたCandidateを
そのまま「次」と決める
```

理由。`visitConstrainedCandidates()` のincremental delivery orderはfrontierの
best-first traversal orderであり、`enumerateConstrainedCandidates()` が最後に適用する
`compareConstrainedCandidates()` のfinal sorted orderと一致するとは限らない。B9の
semantic outcomeは後者を基準に固定する。

- ordering authorityは既存の `compareConstrainedCandidates()` とする
- B9専用のcomparatorやscoreを新設しない
- 実装方式(全列挙後にsortする / 同じ順序を保証する別consumerを組む)はB9-B1で決めてよい。
  本節が固定するのはsemantic outcomeだけである
- [SEARCH_SPEC.md](./SEARCH_SPEC.md) 5.6.7のconstrained enumeration semantics
  (route policy、yield条件、boundsのauthority、決定性、軸外Cross規則)は変更しない

#### 9.2.4.4 3 participant以上と独立評価

`PlanConflict.buildListEntryIds` は2件限定ではない([DATA_MODEL.md](./DATA_MODEL.md) 11.8)。
B9は2 participantを前提にしない。

1つのscenario固定Entryに対し、**unique非固定TargetWeaponごとに独立**へwhat-ifを求める。

```text
fixed A
  -> Target B what-if (ideal)
  -> Target C what-if (ideal)
```

各Targetの評価はすべて同じ前提から開始する。

```text
Planner開始時origin
scenario固定制約
その他のexplicit conflict resolution
```

禁止。

```text
Target Bのwhat-if Candidateを採用したinputでTarget Cの距離を測る
```

Target間の評価順によって距離が変わってはならない。非固定participantの列挙とTarget単位の
dedupeは、9.2.14のconflict work規則と同じく
`participant.buildListEntryId != fixedBuildListEntryId` かつ
`participant.targetWeaponId !== fixedTargetWeaponId` を満たすものを対象とする。

#### 9.2.4.5 scenario fixed authorityとpublic request

B9のcallerに、B8のtransient DTO(`PlannerConstrainedConflictContext` /
`PlannerFixedConflictConstraint`)を組み立てさせない。public概念requestは次とする。

```ts
interface PlannerWhatIfRequest {
  plannerInput: PlannerInput;
  scenarioResolution: PlannerConflictResolution;
  bounds: PlannerWhatIfBounds;
}
```

`PlannerWhatIfRequest` へ `ConstrainedEnumerationBounds` を追加しない。Application /
Worker requestが運ぶboundsは `PlannerWhatIfBounds` だけである。Search Domainの探索範囲は
Domain calculation側の別optionsとしてcaller必須で受け取る。

```ts
interface PlannerWhatIfCalculationOptions {
  enumerationBounds: ConstrainedEnumerationBounds;
  executionOptions?: PlannerExecutionOptions;
}
```

責務分離は次とする。

```text
Application / Worker caller
  PlannerWhatIfBounds を明示的に渡す

Production Worker adapter
  defaultConstrainedEnumerationBounds = 40 / 30 / 100 / 500 を
  Domain calculation へ明示的に渡す

Domain calculation
  enumerationBounds を caller必須で受け取る。
  default substitution / fallback / clamp / field-wise completion を行わない
```

これはB8-D1 / B8-E2bと同じ責務分離である。B8でも
`PlannerConstrainedWorkerTaskInput` は `PlannerOrchestrationBounds` だけを運び、
`ConstrainedEnumerationBounds` はProduction Worker adapterがWorker境界内で明示的に
供給する。B9も同じ形にし、Application callerへSearch Domainの探索範囲を再記述させない。
9.2.4.10のenumeration bounds契約と矛盾させない。

`scenarioResolution` が唯一の仮想fixed authorityである。Domain内部でのmerge規則。

```text
plannerInput.conflictResolutions のうち
scenarioResolution.conflictKey と同じ conflictKey のもの
    -> scenarioResolution で置換する

その他のexplicit resolution
    -> そのまま保持する

scenario keyが元inputに存在しない
    -> scenarioResolution を追加する
```

merge後は既存authorityをそのまま使う。

```text
validatePlannerInput()
preparePlannerInitialContext()
conflict context生成
fixed constraint構築
```

9.2.7の固定authority契約は変更しない。次からfixed sideを推論してはならない。

```text
PlanConflict.recommendedBuildListEntryId
Planner score
Beam Search bestState
Target priority
```

`PlannerConflictResolution` の型、`PlanConflict.id` の生成規則、Beam Search内の
resolution適用規則はいずれも変更しない。

#### 9.2.4.6 `reusedExisting` のsemantics

**重要。** B8 orchestrationの次の扱いをB9へ流用してはならない。

```text
B8 : reusedExisting === true -> trial 1消費、Beam再実行なし、そのtrialは不採用
```

B8でそれが成立するのは、同一のaugmented inputに対するcurrent Planner resultを既に
保持しており、同じ入力を再実行しても結果が変わらないからである(9.2.14)。B9は
baseline Planner resultを前提にせず、scenario固定制約下の実行可能性を新たに判定する。

B9の規則。materializerが `reusedExisting === true` を返した場合。

```text
重複するBuildListEntryを追加しない
その既存semantic Entryをtrial Entryとして使用する
scenario固定制約下で preflight + full Planner rerun + Trace Replay を行う
その結果で実行可能性を判定する
```

既存Entryであることだけを理由に、what-if Candidateから除外しない。

#### 9.2.4.7 feasibility authority

Candidateがwhat-if結果として `found` になる条件は次だけとする。

```text
full Planner rerun後の ProductionPlan.selectedBuildListEntryIds が
  trial Entry ID を含む
  かつ 全fixed Entry ID を含む
```

- 共存可能性の最終authorityは9.2.11のまま、既存Plannerの完全再実行とTrace Replayである
- B9専用の簡易競合判定(`usedCounters.has(counter)` 等)を追加しない
- B9はgenerated Entryをadoptしないため、9.2.14の
  「以前adopt済みの全generated Entryがselectedであること」に相当する条件は存在しない
- `completed === true` は要求しない。bound到達によるpartial Planでも、上記のEntryが
  すべてselectedならfeasibilityを認めてよい
- 9.2.3.1のinitial conflict preflightと全explicit resolutionの再対応付けは、B9でも
  full Beam Searchの前に行う。preflightは `maxPlannerReruns` に数えない

#### 9.2.4.8 transient only

B9は永続化を行わない。

```text
BuildListEntryを永続化しない
ProductionPlanを永続化しない
what-if resultをIndexedDBへ保存しない
Application / Persistenceの保存serviceを呼ばない
```

- materializeしたEntryはPlanner trial入力専用であり、破棄する
- resultへ `ProductionPlan` を含めない
- resultへCandidate IDやgenerated BuildListEntry IDを必須fieldとして要求しない。
  B9のproduct requirementは距離比較であり、永続Candidate identityではない
- 9.2.8の「trialで不採用だったCandidateは永続化しない」、9.2.15のPersistence契約、
  および[DATA_MODEL.md](./DATA_MODEL.md) 11.1の「Candidate SnapshotをProductionPlanへ
  埋め込まない」は変更しない

#### 9.2.4.9 `PlannerWhatIfBounds`

B9専用のboundsを新設する。B8の `PlannerOrchestrationBounds` を流用しない。

```ts
interface PlannerWhatIfBounds {
  maxCandidateTrialsPerTarget: number;
  maxPlannerReruns: number;
}
```

両方とも次を満たす。

```text
finite integer
>= 1
caller必須指定
validationのみ。repair / clamp / field-wise completion を行わない
```

**B9-B2bの専用real Browser Worker benchmarkに基づき、B9-B2cでProduction defaultを
2 / 8に確定した。** 実測と選定理由の詳細は
[B9_PLANNER_WHAT_IF_BROWSER_WORKER_BENCHMARK.md](./B9_PLANNER_WHAT_IF_BROWSER_WORKER_BENCHMARK.md)
9〜11章に記録する。

```ts
export const defaultPlannerWhatIfBounds: PlannerWhatIfBounds = {
  maxCandidateTrialsPerTarget: 2,
  maxPlannerReruns: 8,
}
```

定義authorityは `src/domain/planner/constrained/plannerWhatIfBounds.ts` とする。
T=2はtwo_targets / dual_categoryで必要な代替Idealを得る最小測定値で、Tを増やしても
semantic改善は観測されなかった。R=6はthree_targetsで全4枠foundとなる最小測定値だが、
combinedでは最後の枠がrerun boundで止まる。R=8ならcombinedの全4枠がT=2の試行まで
到達するため、finalistのcombined中央値で約1.8%の追加costを許容し、各非固定Targetの
評価機会を優先した。これは測定workload内の根拠であり、任意のTarget数で全枠の試行を保証する
ものではない。combinedのfoundは0で、Candidate不存在を意味しない。

この定数はcallerが明示的に選択して渡すProduction値である。
`PlannerWhatIfRequest.bounds` は引き続きcaller-requiredで、省略可能にしない。
Domain内部fallback、invalid boundsのrepair target、field-wise completionには使わない。
Worker adapter / Worker Client / wire schemaも暗黙に注入しない。B10 Application callerが
このdefaultを選んで渡す責務を持つ。

B8の `defaultPlannerOrchestrationBounds = 2 / 1 / 4` の流用ではない。
`ConstrainedEnumerationBounds` とも独立した決定であり、そのProduction default
40 / 30 / 100 / 500と9.2.4.10のWorker境界は変更しない。

`maxCandidateTrialsPerTarget` は次の組ごとに独立して数える。

```text
(conflict scenario, targetWeaponId)
```

```text
Target B  N trials
Target C  N trials
```

一方のTargetがtrial capへ到達しても、他方のTargetのtrialを禁止しない。

1 trialの定義は次とする。

```text
対象TargetのCandidateをfeasibility判定の対象として取り上げた時点で1消費する
```

```text
1消費する
  reusedExisting のCandidate
  preflightでrejectされたCandidate
  full Planner rerunでrejectされたCandidate
  found になったCandidate

消費しない
  別TargetのCandidate
  既にfoundを確定済みのTargetのCandidate
  enumeration bound到達やcancel等でfeasibility attemptへ到達しなかったCandidate
```

`reusedExisting` のCandidateも1消費する。重複するBuildListEntryは追加しないが、B9では
9.2.4.6のとおりpreflightとfull Planner rerunを実際に行うためである。B8の
`maxCandidateTrialsPerConflict` が `reusedExisting` をno-opとして1消費する扱いとは、
根拠が異なる点に注意する。

予期しないmaterialization error、prediction error、invariant violationは、trialの
rejectionへ変換しない。既存のerror経路へそのまま伝播させる。

`maxPlannerReruns` は、1つのwhat-if request全体で開始可能なfull Beam Searchの総数である。

```text
数える
  Candidate trialのfull Beam Search
  Production Plan生成内部のruntime unsupported retryで実際に開始するBeam Search

数えない
  preflight
  validation
  conflict context生成
  Candidate enumeration
  materialization
```

B9は「initial ordinary Planner run」を必須としない。B9の目的はPlan生成ではなく
feasibility comparisonである。この点でB8-C4aの `maxPlannerReruns` とは数える対象が
異なるため、名前が同じでも既定値を流用しない。

共有 `maxPlannerReruns` の消費順を確定するため、B9-B1bで次の実行順を固定した。

```text
Target処理順   createPlannerConflictWorks() の既存stable order
Target内順     compareConstrainedCandidates()
```

`works` のstable orderをそのまま使用し、B9独自のTarget sortを追加しない。
Target内のordering authorityは9.2.4.3のとおり
`compareConstrainedCandidates()` のままである。

#### 9.2.4.10 enumeration bounds

B9は `ConstrainedEnumerationBounds` の意味とProduction defaultを変更しない。

```text
defaultConstrainedEnumerationBounds = 40 / 30 / 100 / 500
```

- B9 Domain calculationは、9.2.4.5の `PlannerWhatIfCalculationOptions.enumerationBounds`
  としてenumeration boundsをcaller必須で受け取る。default substitution、fallback、
  clamp、field-wise completionを行わない
- `PlannerWhatIfRequest`、すなわちApplication / Worker requestへ
  `ConstrainedEnumerationBounds` を追加しない。requestが運ぶboundsは
  `PlannerWhatIfBounds` だけである
- Production Worker adapterが、B8-D1 / B8-E2bと同じく
  `defaultConstrainedEnumerationBounds` をWorker境界内でDomain calculationへ明示的に
  渡す
- B9-A2で新しいenumeration defaultを作らない
- B9 benchmarkは、まずこの既存のProduction enumeration extentで測定する
- B9に必要だからという理由だけでB8-B2のdefaultを再調整しない。実測で不足が判明した
  場合は別のdecisionとして扱う

#### 9.2.4.11 result / no-result契約

概念resultは次とする。名称はB9-B1で調整してよいが、意味を変更しない。

```ts
interface PlannerWhatIfComparison {
  conflictKey: string;
  fixedBuildListEntryId: BuildListEntryId;
  fixedTargetWeaponId: TargetWeaponId;
  alternatives: PlannerWhatIfTargetComparison[];
}

interface PlannerWhatIfTargetComparison {
  targetWeaponId: TargetWeaponId;
  practical: PlannerWhatIfOutcome;
  ideal: PlannerWhatIfOutcome;
}

interface PlannerWhatIfDistance {
  estimatedOperationCount: number;
  estimatedGogmaAdvance: number;
  estimatedSkillAdvance: number;
  estimatedNormalAdvance: number | null;
}
```

`PlannerWhatIfOutcome` は最低限次を区別するtyped unionとする。

```ts
type PlannerWhatIfOutcome =
  | { status: 'found'; distance: PlannerWhatIfDistance }
  | { status: 'not_found_within_search_extent' }
  | { status: 'stopped_by_enumeration_bound' }
  | { status: 'stopped_by_candidate_trial_bound' }
  | { status: 'stopped_by_planner_rerun_bound' }
```

意味。

```text
found
  bound内のCandidateについてPlanner feasibilityが証明された

not_found_within_search_extent
  enumerationが exhausted === true で終わり、
  そのTargetにfeasibleなCandidateが無かった

stopped_by_enumeration_bound
  Candidate未発見のまま、Search extent boundによって未確認が残った

stopped_by_candidate_trial_bound
  Candidateはまだ残り得るが、そのTargetのtrial予算を使い切った

stopped_by_planner_rerun_bound
  Candidate feasibilityを判定するBeam予算を使い切った
```

規則。

- 「見つからない」と「上限で未確認」を同じ `null` へ潰さない。9.2.16の
  「bound到達を無言でexhaustionとして扱わない」をB9でも維持する
- 既に `found` を確定したTargetは、その後enumeration boundへ達したことだけを理由に
  無効化しない
- `found` の判定authorityは9.2.4.7だけであり、message文字列をcontrol authorityにしない

scenario固定制約を安全に構築できない場合は、comparison全体をtyped failureとする。

```text
invalid_fixed_resolution
planner_input_not_ready
```

正確な型名はB9-B1で調整してよい。次を守る。

```text
message parsingをcontrol authorityにしない
recommendedBuildListEntryId等から代替のfixed Entryを選ばない
```

#### 9.2.4.12 warning / cancellation契約

B9は9.2.16のB8専用 `PlannerWarningKind` を生成しない。

```text
max_candidate_trials_per_conflict_reached
max_generated_build_list_entries_reached
max_planner_reruns_reached
constrained_enumeration_bound_reached
```

これらはB8 orchestrationのbound signalであり、数える対象と発生条件がB9とは異なる
(9.2.4.9)。B9の打ち切り理由は `PlannerWhatIfOutcome` などのB9専用typed statusで表す。
ordinary Planner内部のwarningをB9のbound signalへ読み替えない。

cancellationはWorker / Client requestのcancellationとして扱う。

- `cancelled` を `PlannerWhatIfOutcome` へ含めない
- cancelされたrequestのpartial comparison resultを、正常なresultとして返さない
- 既存のtask generation / stale response / cancel semantics(B8-D1)をB9-Cで再利用する

#### 9.2.4.13 B9とB10の責務分離

```text
B9
  Domain what-if calculation
  PlannerWhatIfBounds
  Worker protocol / routing
  Production Worker adapter
  PlannerWorkerClient API
  benchmarkとProduction default決定

B10
  Conflict選択UI
  what-if距離の表示
  比較カード
  選択不可表示と理由提示
  what-if requestの起動
```

[UI_FLOW.md](./UI_FLOW.md) 11章の「将来のwhat-if比較」はB10の表示責務であり、その距離を
計算するDomain / Worker / Application APIがB9である。

#### 9.2.4.14 B10 Application / UI mapping

B10-Aで、B9のwhat-if計算をProduction Plan画面へ接続するApplication / UI契約を確定した。
B9で確定したDomain what-if semantics、`create_what_if_comparison` request / result shape、
default責務は変更しない。B10-Bはparticipant / current Conflict availability取得のために、
B10専用のtyped Planner Worker request / Client APIを追加してよい。

##### Plan表示authorityとcurrent calculation authority

Conflict UIは `/plans/:planId` のProduction Plan画面に置く。表示対象はrouteの `planId` で
`ProductionPlanRepository.getProductionPlan(planId)` から取得した保存済み
`ProductionPlan` だけである。該当Planが無い場合、Active Plan、最新Plan、その他のPlanを
推測して代替表示しない。

表示と計算のauthorityを次のとおり分離する。

```text
表示中のConflict
  persisted ProductionPlan.conflicts

what-if / Planner再計算の入力
  操作開始時点のcurrent persisted stateからcreatePlannerInput()で新規構築したPlannerInput
```

`ProductionPlan.baseSnapshot` はcompatibility / audit authorityであり、current
`PlannerInput` そのものではない。`baseSnapshot` から入力を復元せず、古いPlanner Worker
inputまたは過去のCandidate Search requestをcache / 復元して再利用しない。

##### persisted explicit resolutionの復元

`createPlannerInput()` が返す `conflictResolutions: []` へ、表示中Planのうち
`selectedBuildListEntryId !== null` のConflictだけを次の形で設定する。

```ts
plan.conflicts
  .filter((conflict) => conflict.selectedBuildListEntryId !== null)
  .map((conflict) => ({
    conflictKey: conflict.id,
    selectedBuildListEntryId: conflict.selectedBuildListEntryId,
  }))
```

これは保存済みPlanに残るユーザー明示resolutionの復元である。
`recommendedBuildListEntryId`、Planner score、Beam bestState、Target priority、
`selectedBuildListEntryIds` からresolutionを生成しない。

##### participant表示とcurrent availability

`PlanConflict.buildListEntryIds` のparticipantは原則すべて表示する。current stateで利用不能な
participantも消さず、選択不可と理由を示す。`recommendedBuildListEntryId` は「Planner推奨」
等のbadge、`selectedBuildListEntryId` は「現在選択中」等の表示だけに使う。

選択可否は、操作時点に新規構築した `PlannerInput` と既存validation / staleness authorityから
導出する。新しいDomain validity ruleを作らない。最低限、次を区別して理由表示できること。

```text
BuildListEntryがcurrent persistenceに存在しない
BuildListEntryがcurrent stateに対してstale
対応Targetが存在しない
対応Targetが無効またはdisabled
CalculationContextが非互換
validatePlannerInput()がEntryをvalidBuildListEntriesから除外した
```

Targetの構造およびIdeal ⇒ Practical包含は既存の `validateTargetWeapon()` と
`validateTargetIdealImpliesPractical()`、Entryのcurrent stale理由は
`evaluateBuildListEntryStaleness()` をauthorityとする。Planner利用可否とcurrent Conflictは、
B10-BのWorker-side current interaction preparationで判定する。

fresh PlannerInputと既存explicit resolutionを準備した後、B10-BはPlanner Workerへ専用のtyped
preparation requestを送る。Worker内でProduction Planner dependenciesを使い、既存の
`preparePlannerInitialContext()` 相当の処理として最低限次を実行する。

```text
validatePlannerInput()
current initial Planner stateの準備
current initial Conflict detection
```

UI / main threadで `ProductionRngEngine` を新たに生成してvalidationしない。内部の
`PlannerInitialContext` 自体をwireへ漏らさず、structured-clone可能なB10用projectionだけを返す。
projectionは最低限、次をUIが判定できる形とする。正確な型名とrequest名はB10-BでRepositoryの
命名規則へ合わせてよい。

```text
ready / invalid
valid BuildListEntry IDs
excluded BuildListEntry: BuildListEntry ID + 表示用reason
current initial Conflict: conflict ID + participant BuildListEntry IDs
```

表示中ConflictをB10操作対象にできるのは、そのConflict IDがWorker projectionのcurrent initial
Conflictに存在し、対象Entry IDがそのcurrent Conflictのparticipantであり、かつcurrent
persistenceに存在してvalid BuildListEntry IDsに含まれる場合だけである。current initial Conflictに
同じIDが無い場合もpersisted Conflictは表示するが、「比較する」と「この候補を優先」をdisabledにし、
現在のPlanner入力では競合を再現できない旨を示して再計算を促す。
preparationが `invalid` の場合もすべてのConflict操作をfail closedでdisabledにし、typed resultに
基づく理由と再計算導線を表示する。

Capability、concrete prediction support、保護状態等による除外もWorker projectionへ反映する。
typed ready / invalid、ID集合、Conflict membershipをcontrol authorityとし、表示用reason文字列は
そのまま表示してよいが解析して分岐しない。B9の `create_what_if_comparison` requestへvalidation
fieldを追加せず、availability取得だけのためにwhat-if calculationを実行しない。

preparation requestを追加する場合も、既存Planner WorkerのrequestId / generation / stale response
rejectionまたはignore / dispose / cancelの考え方と整合させる。古いpreparation結果でcurrent
availabilityを上書きしない。

##### what-if preview requestとlifecycle

有効なparticipantの「比較する」で、選択したparticipantだけから次を構築する。

```ts
const scenarioResolution = {
  conflictKey: conflict.id,
  selectedBuildListEntryId: participantEntry.id,
}

const request = {
  plannerInput: freshPlannerInputWithExistingExplicitResolutions,
  scenarioResolution,
  bounds: defaultPlannerWhatIfBounds,
}
```

`scenarioResolution` が今回scenarioの唯一のfixed authorityである。Application callerが
`defaultPlannerWhatIfBounds = 2 / 8` を明示的に渡す。Worker / Clientのdefault injection、
省略、B8 defaultの流用、requestへのenumeration bounds追加を行わない。

what-ifは完全にtransientなpreviewである。起動時にも完了時にもBuildListEntry、
`PlannerConflictResolution`、ProductionPlan、comparison resultを保存しない。UIは最低限
`idle` / `loading` / `completed` / `failure` を区別する。別participantの比較、別Conflictへの
移動、page離脱、Planner再計算開始では不要なrequestを `cancelPlan(requestId)` でcancelする。
既存のrequestId / generation / stale response semanticsを使い、cancelをfailure表示にせず、
partial resultを表示せず、古いresultを別participantのcardへ適用しない。

`comparison.alternatives` はDomainのstable orderのまま表示し、Application / UIでTargetを
並べ替えない。各non-fixed Targetは排他的な `practical` / `ideal` の2枠を独立表示する。
`found` は `estimatedOperationCount` を主距離とし、残り3つのestimateは絶対Counterではなく
進行量として表示してよい。次のtyped statusを「候補なし」へまとめない。

```text
not_found_within_search_extent       探索範囲内に実行可能な候補なし
stopped_by_enumeration_bound         探索範囲上限のため未確認
stopped_by_candidate_trial_bound     候補試行上限のため未確認
stopped_by_planner_rerun_bound       Planner再計算上限のため未確認
```

comparison全体の `planner_input_not_ready` / `invalid_fixed_resolution` はtyped failureとして
扱う。後者は `reason` をcontrol authorityとし、detail / message parsingで分岐しない。
別participantまたは `recommendedBuildListEntryId` へfallbackせず、再選択または再計算を促す。

##### explicit choiceとB8再計算

「比較する」と「この候補を優先」は別操作とする。what-if成功を選択のgateにせず、what-ifを
行わず有効participantを選択できる。current availabilityが選択不可のparticipantは、what-ifの
成否にかかわらず選択できない。

「この候補を優先」でだけ今回の `PlannerConflictResolution` を作る。操作開始時点に再びcurrent
persisted stateからfresh `PlannerInput` を構築し、保存済みPlanから復元した他Conflictのexplicit
resolutionを保持したうえで、同一 `conflictKey` は今回選択で置換し、無ければ追加する。

Plan生成はwhat-if resultを採用せず、B8 Production constrained Plannerの
`createConstrainedPlan()` を新規実行する。Application callerが
`defaultPlannerOrchestrationBounds = 2 / 1 / 4` を明示的に渡す。what-if trial Entryまたは
comparison resultを保存・採用しない。

`createConstrainedPlan()` の返却warningsに
`warning.kind === 'invalid_conflict_resolution'` が1件でもある場合はfail closedとする。
`plan !== null` のordinary resultを含んでいても
`plannerResultPersistenceService.savePlannerOrchestrationResult()` を呼ばず、ProductionPlanも
generated BuildListEntryも保存せず、新Planへ遷移しない。表示中の旧Planを維持し、ユーザーへ
再選択または再計算を促す。typed `PlannerWarningKind` をcontrol authorityとし、warning.messageを
解析せず、Planner推奨または別participantへfallbackせず、invalid resolutionを無視したordinary
Planを保存しない。

上記warningが無い再計算結果の保存は既存
`plannerResultPersistenceService.savePlannerOrchestrationResult()` だけを使用し、generated
BuildListEntryとProductionPlanのatomic save契約を維持する。B10専用Persistence serviceを
追加しない。新しいPlanが保存された場合は `/plans/:newPlanId` へ遷移する。`plan === null` または
保存失敗時は表示中の旧Planを置換・削除しない。B10の判断だけで旧Planを自動削除しない。

Conflict選択とwhat-ifはPlan確定前の意思決定機能であり、編集対象は原則 `status === 'draft'`
とする。`stale` は比較・固定を続けず既存の明示再計算へ誘導し、`active` / `completed` /
`abandoned` はB10操作で書き換えない。既存Plan lifecycleと矛盾が見つかった場合は推測せず
設計レビューへ戻す。

### 9.2.5 初回Search pruningを永久除外にしないこと

初回Candidate Searchは、単体Targetの探索を高速・簡潔に保つために複数のpruningを
適用する。これらはすべて**初回Search用のpolicy**であり、Planner制約下で候補を
永久に無効化する**Domain dominanceではない**。

| 初回Searchで省略される理由 | 定義 |
| --- | --- |
| 同一結果の最小advance retention | [SEARCH_SPEC.md](./SEARCH_SPEC.md) 5.5.2 / 5.5.3 |
| Practical dominance | 同 5.5.6 |
| Practical保持のhorizon (`estimatedOperationCount <= D`) | 同 5.5.6.0 |
| canonical Ideal到達による探索終了 | 同 5.6.2 / 5.6.3 |
| Cross-onlyの初回bounded policy | 同 5.5.4 |

契約。

```text
Planner-driven constrained re-searchでは、
初回Search用pruningによって省略されたCandidateを、
固定Candidateとの共存可能性に応じて再評価できなければならない。
```

例1。同一結果の後続Counter位置。

```text
Practical同一結果 earlier位置  -> 固定Candidateと競合し実行不能
Practical同一結果 later位置    -> 固定Candidateと共存可能
-> later solutionを次点として再評価・採用できる
```

例2。Practical dominanceで省略された候補。

```text
+2 攻撃III Practical
+4 攻撃II  Practical

初回Search : +2が+4を明確に上回るため+4を省略
Planner    : 固定Candidateとの競合で+2が実行不能、+4は実行可能
再検索     : +4を次点Practicalとして再評価・採用できる
```

規則。

- 使用不能なearlier same-result solutionが、実行可能なlater same-result solutionを
  恒久的に隠してはならない
- **初回SearchのPractical dominanceをそのまま再検索へ持ち込み、現在実行不能な
  dominant candidateが実行可能なdominated candidateを永久に隠してはならない**
- canonical Ideal到達による探索終了と5.5.6.0のhorizonは初回Searchの範囲であり、
  再検索の探索範囲を恒久的に制限しない
- Cross-onlyは初回boundedポリシーであり、再検索で軸外解の必要性が実際に生じた場合は
  そのTarget・その競合に限って評価できる
- あるCandidateが実行不能であることだけを理由に、その完成結果や、そこから
  派生し得る解の系列全体を除外しない

これはCartesian productの復活を意味しない。Bonus streamとSkill streamは
引き続き独立に解き、Cross-onlyの初回policyも維持する。追加で必要なのは、
省略されたCandidateを固定Candidateとの共存可能性に応じて再評価できることだけである。

本要件はB8 constrained enumerationの必須要件であり、9.2.9と
[SEARCH_SPEC.md](./SEARCH_SPEC.md) 5.6.7で具体化する。

### 9.2.6 B8 architecture

正式architectureは次とする。

```text
Candidate Search / constrained enumerator
  元のSearch / RNG起点からTarget単体のCandidateを順次提示
        ↓
Planner constrained-search orchestration
  明示的に固定したCandidateとの共存可能性をPlanner自身で評価
        ↓
必要なCandidateを一時BuildListEntryへmaterialize
        ↓
augmented PlannerInput
        ↓
元のRNG / Planner初期StateからBeam Searchを完全再実行
        ↓
最終ProductionPlan
        ↓
Application / Persistence
  generated BuildListEntries + ProductionPlanをatomic保存
```

責務分離は9.1および[SEARCH_SPEC.md](./SEARCH_SPEC.md) 5.6.0のままである。
constrained enumeratorはTarget単体のRNG近傍解を列挙するだけであり、共存可能性を
判定しない。共存可能性の最終authorityは、そのCandidateを含むaugmented PlannerInput
に対する既存Plannerの再実行である(9.2.11)。

### 9.2.7 固定Candidateのauthority

constrained re-searchで「固定する側」を決めるauthorityは次だけとする。

```text
PlannerConflictResolution.selectedBuildListEntryId
```

次を固定authorityとして使用してはならない。

```text
PlanConflict.recommendedBuildListEntryId
Planner bestStateで偶然選択されたparticipant
Target priorityからの自動決定
Candidate scoreだけによる自動決定
```

有効な明示 `PlannerConflictResolution` が無い競合については、B8 constrained
re-searchを自動実行せず、その競合を `PlanConflict` として返す。ユーザー選択を経て
`PlannerConflictResolution` が与えられた実行でだけ再検索を行う。

`recommendedBuildListEntryId` は従来どおりユーザー提示用の推奨であり、固定制約では
ない。削除済み・stale・Target無効・Capability不足・保護状態変更で実行不能な選択を
`invalid_conflict_resolution` として扱う既存規則も変更しない。

固定authorityはユーザーの選択そのもの、すなわちfixed BuildListEntry IDである。
`conflictKey` はその選択を局所競合へ結び付ける識別子にすぎない。generated Entryの
追加でPlanConflict IDが変わっても固定authorityは変わらない。したがってfull Beam
Searchの前に、9.2.3.1のinitial conflict preflightで現在の `PlanConflict.id` へ
対応付け直す。元の `conflictKey` をそのまま次の再実行へ渡してはならない。再対応付けが一意に成立しない場合は、
固定対象を推測せず、そのCandidate trialを採用しないか競合を返す。

### 9.2.8 Planner-generated BuildListEntry

BuildListEntryの生成主体を拡張する。

```text
1. ユーザーがCandidate Search結果から選択して追加する
2. Planner constrained re-searchがPlan生成に必要としてmaterializeする
```

規則。

- Planner-generated Entryも通常の `BuildListEntry` 形状をそのまま使う
- 新しい永続provenance fieldを追加しない
- `ProductionPlan` へembedded Candidate Snapshotを追加しない
- Candidate table等の新しい永続entityを追加しない
- constrained enumerationで発見した全Candidateを保存しない

Candidateはまずmaterializeしてから一時Entryとして生成し、Planner trialへ使う。

```text
ConstrainedCandidate yield        (Search Domainのtransient semantic result)
  ↓
deterministic materializer         (BuildCandidate形状へ変換。9.2.13)
  ↓
temporary BuildListEntry
  ↓
augmented PlannerInputでPlannerを完全再実行
```

enumeratorは `BuildCandidate` を直接yieldしない。`BuildCandidate` は `id` /
`searchRunId` / `createdAt` / `checkpointGroups` を必須とするが、
`ConstrainedSearchOrigin` は `searchRunId` と `settings` を持たないため、Search Domain
側では完成させられない([SEARCH_SPEC.md](./SEARCH_SPEC.md) 5.6.7)。

trialで不採用だったCandidateは永続化しない。最終augmented PlannerInputへ正式採用した
generated Entryだけを `generatedBuildListEntries` として返す(9.2.14)。

ProductionPlanが生成されない場合、generated Entryを永続化しない。
Planがpartialでも `plan != null` であり、Plan snapshotがgenerated Entryを含む場合は、
そのEntryをPlanと同一transactionで保存する(9.2.15)。

### 9.2.9 constrained Candidate enumeration境界

constrained enumerationはSearch Domain側の責務であり、通常の `searchCandidates()`
とは別のAPI境界へ置く。enumerator側の契約本文は
[SEARCH_SPEC.md](./SEARCH_SPEC.md) 5.6.7に定義する。

Planner側の要件は次である。

- Search Domain APIへ9.2.3のConflict DTOを渡さない。Plannerが渡すのは
  `ConstrainedSearchOrigin`、対象TargetWeaponId、enumeration boundsだけである
- `origin` は過去のUI Candidate Search requestではない。Planner計算開始時の
  current validated Search / RNG snapshotから構成し、`rngState` / `normalCounters` /
  `ownedWeapons` / `targetWeapons` / `master` / `calculationContext` を保持する。
  `searchRunId` / `routeFilter` / `settings` を持たせない
- constrained re-searchは過去のUI一時filterを継承しない。route scopeは現時点で
  成立する全Search routeとし、UI一時filterや `CandidateSearchSettings` を
  適用しない。探索範囲の上限は
  `ConstrainedEnumerationBounds` だけをauthorityとする
- route policyが広がっても、TargetのIdealまたはPractical条件を満たすCandidateだけを
  yieldする契約は維持する
- enumeratorがyieldするのは `BuildCandidate` ではなく、Search Domainのtransientな
  semantic result `ConstrainedCandidate` である。`BuildCandidate.id` /
  `searchRunId` / `createdAt` / random ID / Clock / enumeration ordinalを
  enumerator resultへ混ぜない。`BuildCandidate` 形状への変換は9.2.13の
  deterministic materializerが行う
- `maxCandidateTrialsPerConflict` / `maxGeneratedBuildListEntries` /
  `maxPlannerReruns` はPlanner orchestration側のboundsであり、
  `ConstrainedCandidateSearchInput` へ含めない(9.2.16)
- Candidate Search側へ次のPlannerロジックを複製しない

```text
counter precondition
physical action identity
shareability
inventory conflict
source mutation / version
PlannerConflictResolution
```

- 実行不能と判定したCandidateについては、enumeratorへ次のCandidateを要求する
- Cross規則の軸外pair(`i > 0` かつ `j > 0`)は、必要になったTarget・その競合に限って
  評価を要求してよい。full Cartesianの事前生成は要求しない

### 9.2.10 Planner再実行

constrained CandidateをBeam Search途中のStateへinjectしてはならない。

```text
Candidate発見
  ↓
一時BuildListEntry
  ↓
augmented PlannerInput作成
  ↓
createInitialPlannerSearchState から初期Stateを再生成
  ↓
Beam Searchを最初から再実行
```

理由。途中Stateでは既に次が進行済みであり、後からEntryを追加しても、過去に共有した
物理操作を正しく復元できない。

```text
routeProgressByEntryId
current counters
transient route output
sourceMutationVersionByOwnedWeaponId
candidateReadySourceVersionByEntryId
routeSourceVersionByEntryId
inFlightExistingSourceByOwnedWeaponId
```

したがってEntry集合が変わるたびに初期Stateから完全再実行する。full Beam Searchの
実行回数は `maxPlannerReruns` で有限に抑える。9.2.3.1のinitial conflict preflightは
Beam Searchを走らせないため、この回数へ含めない(9.2.16)。

再実行入力の `conflictResolutions` は、前回入力のものをそのまま流用しない。
Entry集合が変わると同じ物理競合でも `PlanConflict.id` が変わり得るため、full Beam
Searchを走らせる**前**に9.2.3.1のinitial conflict preflightで再対応付けを行い、
現在の `PlanConflict.id` を `conflictKey` とする `PlannerConflictResolution` を
組み立ててから完全再実行する。再対応付けが一意に成立しないresolutionは入力へ含めず、
その競合を未解決として扱う。

```text
元のvalidated PlannerInputの全valid resolution
  -> resolutionごとのtransient fixed constraint
       (fixed Entry ID / Target ID / fingerprint / 競合資源identity)
  -> augmented PlannerInput作成
  -> initial conflict preflight
       validatePlannerInput
       validation.validBuildListEntries
       createInitialPlannerSearchState
       通常Plannerと同じinitial relevant-entry selection
       createPlannerRouteUnitPlans
       detectPlannerConflicts
  -> 全fixed constraintについて
       競合資源identity一致かつfixed Entryを含むConflictを探す
  -> 全て一意なら現在のPlanConflict.idでresolution配列を再構築
  -> 1つでも0件・複数件・fingerprint不一致・validation除外なら
       推測せず、trial不採用またはconflict返却
  -> 完全なresolution配列でBeam Searchを初期Stateから完全再実行
```

full Beam Searchの前にpreflightを置くため、resolution無しのBeam Searchを一度走らせて
から組み直す循環は発生しない。preflightはConflict検出専用であり、共存可能性の最終
authorityは完全再実行のBeam SearchとTrace Replayである(9.2.11)。

preflightは通常Beam Searchと同じ `validatePlannerInput()` /
`validation.validBuildListEntries` / initial relevant-entry selectionを使う。
B8だけがraw `BuildListEntry` から初期Stateを作ることを禁止し、この経路は
shared pure helperとして通常Plannerと共有する(9.2.3.1)。

### 9.2.11 共存可能性のauthority

Candidateが固定Candidateと共存できるかどうかの最終authorityは、既存Plannerの
再実行結果とする。次をそのまま再利用する。

```text
createPlannerRouteUnitPlans
counter precondition
physicalActionKey
arePlannerRouteUnitsShareable
inventory precondition
protected weapon判定
source mutation / version
PlannerConflictResolution
Beam Search
Trace Replay
```

B8専用の簡易競合ロジックを追加してはならない。次のような判定を書かない。

```ts
usedCounters.has(counter)
```

Counter位置の一致だけを理由とする除外は9.2.2で既に禁止している。

### 9.2.12 Candidate semantic identityとEntry再利用

Planner-generated Candidateのsemantic identityは、run ID / Candidate ID / timestampへ
依存してはならない。少なくとも次を含める。

```text
targetWeaponId
route (kind / sourceOwnedWeaponId / operations)
finalBonuses multiset
restoration bonus scope
seriesSkillId
groupSkillId
```

**重要。** 現行の `createBuildCandidateMeaningFingerprint()` はrestoration bonus scopeを
含まない。同一ラベル5枠のnormal scope結果とgogma scope結果を同一意味とみなすため、
B8 semantic identityとしてそのまま信用してはならない。B8実装時にscopeを含むauthorityへ
修正または統合する。

既存BuildListEntryの再利用判定は、semantic fingerprintだけでは不十分である。
次をすべて確認する。

```text
candidate semantic fingerprint
targetDefinitionHash
searchStateHash
referencedOwnedWeaponsHash
CalculationContext
現在のstaleness
```

同一semantic Candidateに対応する既存Entryが存在しても、Target定義、Search状態、
OwnedWeapon参照状態、CalculationContextのいずれかが現在値と異なる場合は再利用しない。

stale Entryを上書き更新してはならない。

```text
旧stale Entry   -> 履歴としてそのまま残す
現在のCandidate -> 新しいBuildListEntryを作成する
```

理由。過去のProductionPlanが旧BuildListEntry IDとSnapshotを参照しているためである。

同じgenerated IDまたは同じcurrent semantic Entryが既に存在する場合は、current semantic
contentがすべて一致するときだけ再利用する。ID一致だが内容が異なる場合はfail closedとし、
上書きせずerrorにする。これによりretry時のidempotencyを保証する。

### 9.2.13 決定的ID生成

通常Candidate SearchのID契約は変更しない。B6-F1で行ったのはCandidate出力順の
run非依存化であり、`BuildCandidate.id` の生成規則と `semanticHash` への
`searchRunId` 包含は現行のままである。

B8 constrained search専用境界では次を用いる。

```text
deterministic constrained search identity
deterministic Candidate ID factory
deterministic generated BuildListEntry ID
```

deterministic constrained search identityは名前だけでなく構成要素を固定する。
少なくとも次から安定生成する。

```text
TargetWeapon ID
Planner開始時のSearch / RNG semantic origin
  (ConstrainedSearchOrigin の semantic 正規化値。
   Base Seed / 該当Counter群 / 参照OwnedWeapon semantic / Target定義)
CalculationContext
ConstrainedEnumerationBounds
route policy
  (route scope、filter非適用、上限authorityを表す正規化値)
```

次を含めてはならない。

```text
random UUID
Clock
request UUID
enumeration ordinal
```

`searchRunId` に相当するrun識別子をこのidentityへ含めない。通常Candidate Searchの
`BuildCandidate.id` 生成規則は上記のとおり変更しないため、constrained search側の
Candidate ID factoryは通常Searchのものを流用せず、この identity を基点にする。

#### deterministic materializer

B8-B1のenumeratorはSearch Domainのtransientな `ConstrainedCandidate` をyieldする
([SEARCH_SPEC.md](./SEARCH_SPEC.md) 5.6.7)。通常の `BuildCandidate` 形状への変換は
B8-Cのdeterministic materializerが行う。

```text
BuildCandidate.searchRunId
  = deterministic constrained search identity

BuildCandidate.id
  = deterministic constrained search identity
    + Candidate semantic meaning (9.2.12)
    から安定生成

BuildCandidate.createdAt
  = PlannerClock

BuildCandidate.checkpointGroups
  = materializeしたCandidateのRouteへcheckpoint抽出を適用した結果
    ([SEARCH_SPEC.md](./SEARCH_SPEC.md) 5.8)
```

`checkpointGroups` は作成リストの選択入力を支える表示・選択データであり、次には使用しない。

```text
Candidate yield可否
Candidate enumeration ordering
route scope
探索終了
探索範囲
off-axis評価
Planner coexistence
```

`CandidateSearchSettings` はconstrained enumerationのfilter authorityでも
extent authorityでもない(9.2.9)。

`createdAt` は `PlannerClock` 由来のためrun間で変わる。これは15.9.1で一致を要求しない
値であり、`BuildCandidate.id` と `searchRunId` はrun間で一致する。generated
BuildListEntry IDは `createdAt` を含めずsemantic contentから生成する(前掲)。

generated BuildListEntry IDは、少なくとも次から安定生成する。

```text
Candidate semantic meaning (9.2.12)
targetDefinitionHash
searchStateHash
referencedOwnedWeaponsHash
CalculationContext
```

次をEntry IDまたはsemantic tie-breakへ使用してはならない。

```text
random UUID
Clock
enumeration ordinal
request UUID
```

`createdAt` は永続表示用として `PlannerClock` から生成してよいが、ID、semantic
ordering、Planning input hashの意味へ使わない。`createdAt` をID生成へ含める既存の
`createBuildListEntry()` 既定経路をそのまま流用しない。

### 9.2.14 Orchestration結果

Core `PlannerResult` の意味を変更せず、外側のorchestration resultを追加する。

```ts
interface PlannerOrchestrationResult extends PlannerResult {
  generatedBuildListEntries: BuildListEntry[];
}
```

具体的な名称はB8-Cで決定してよいが、意味を変更しない。

- `generatedBuildListEntries` には、最終augmented PlannerInputへ正式採用したEntryだけを含む
- trial中に生成して不採用となったEntryを含めない
- `plan === null` の場合は空配列とする
- 既存の `plan` / `conflicts` / `warnings` の意味を変更しない
- `PlannerOrchestrationResult` は非永続であり、`ProductionPlan` へ埋め込まない

#### B8-C4b実装名

B8-C4bで確定した実装上の名称は次である。意味は上記から変更していない。

```ts
createProductionPlanWithConstrainedSearch(
  input: PlannerInput,
  dependencies: PlannerDependencies,
  options: PlannerConstrainedOrchestrationOptions,
): Promise<PlannerOrchestrationResult>

interface PlannerConstrainedOrchestrationOptions {
  enumerationBounds: ConstrainedEnumerationBounds
  orchestrationBounds: PlannerOrchestrationBounds
  executionOptions?: PlannerExecutionOptions
}
```

両boundsともcaller必須である。orchestration側のProduction defaultはB8-Eで決める。

#### conflict work

再検索対象は `(fixed constraint, 非固定participant Target)` の組とする。

```text
work対象にする    : participant.buildListEntryId != fixedBuildListEntryId
work対象にしない  : participant.targetWeaponId === fixedTargetWeaponId
```

同一Targetが複数RouteUnit / Entryで参加してもTarget単位に1件へdedupeする。
work順は競合資源identity / fixed BuildListEntry ID / TargetWeapon ID /
元の `PlanConflict.id` から作るstable keyの昇順とし、context配列順・participant配列順・
Map挿入順へ依存しない。

1件adoptするたびに残りworkを再評価する。current `ProductionPlan.selectedBuildListEntryIds`
が、そのworkのfixed EntryとそのTargetのEntryを両方含む場合、そのworkは充足済みとして
enumerationしない。Candidate score・`recommendedBuildListEntryId` は判定に
使わない。

#### monotonic adoption

trial採否の最終authorityは、preflightを通したaugmented inputに対する完全再実行
(`createProductionPlanWithObserver()` = full Beam Search + Trace Replay +
ProductionPlan組み立て)である。採用条件は次をすべて満たすことである。

```text
plan !== null
plan.selectedBuildListEntryIds が trial generated Entry ID を含む
plan.selectedBuildListEntryIds が 全fixed Entry ID を含む
plan.selectedBuildListEntryIds が 以前adopt済みの全generated Entry ID を含む
```

したがってadoptionはmonotonicである。新Candidateの採用によって、固定Entryまたは
以前adoptしたgenerated EntryがPlanから落ちる場合は不採用とする。`completed === true`
は要求しないため、bound到達によるpartial Planでも上記を満たせば採用してよい。

`reusedExisting: true` のmaterialize結果はcurrent inputに既に存在するため、
Entryを重複追加せず、full Planner再実行も行わず、`generatedBuildListEntries` へも
含めない。Candidate trialは1消費済みとして次Candidateへ進む。

### 9.2.15 Persistence契約

Planner Domain / WorkerはIndexedDBへ直接アクセスしない。保存はB8-DのApplication /
Persistence serviceが行う。

保存単位は次を1つのDexie read-write transactionとする。

```text
generated BuildListEntries + ProductionPlan
```

- Planだけ、またはEntryだけが残るpartial saveを禁止する
- 保存直前にcurrent stateを再読込・再validationする
- validationに失敗した場合は何も書き込まず、retry可能なerrorとして返す

保存直前に最低限確認する項目。

```text
CalculationContext
RngState
Normal Counters
OwnedWeapons
TargetWeapons
BuildListEntry set
generated Entryのstaleness
PlanningInputSnapshot.initialExecutionState
PlanningInputSnapshot.targetWeaponsHash
PlanningInputSnapshot.buildListEntriesHash
Planが参照するBuildListEntry IDs
PlanStepのcandidateIdとEntry Snapshot
```

`PlanningInputSnapshot.buildListEntriesHash` は最終augmented PlannerInput全体を表す。
したがって最終inputへ含めたgenerated Entryは、例外なく同一transaction内で保存する。

Active Plan単一制約、置換、破棄、再計算は従来どおりApplication / Persistence層の
責務であり、B8で変更しない。

### 9.2.16 bounds

B8 constrained re-searchは必ずfiniteであること。boundsは責務ごとに2つへ分離する。
片方をもう片方の境界へ渡してはならない。

#### Search enumeration bounds

constrained enumeratorが消費する上限である。契約本文は
[SEARCH_SPEC.md](./SEARCH_SPEC.md) 5.6.7にある。

```ts
interface ConstrainedEnumerationBounds {
  maxNormalForgeCount: number;
  maxGogmaAdvance: number;
  maxSkillResetCount: number;
  maxOffAxisPairEvaluations: number;
}
```

前3つは既存Candidate Search設定と同じ意味([SEARCH_SPEC.md](./SEARCH_SPEC.md) 3.1)であり、
B5の実Browser Worker実測位置をB8-B2 benchmarkの基準値として使用してよい。

```text
Normal 1000
Gogma   200
Skill  1000
```

`maxOffAxisPairEvaluations` はB8で新設する上限である。

#### Planner orchestration bounds

Planner orchestrationが消費する上限である。Search Domainへ渡さない。

```ts
interface PlannerOrchestrationBounds {
  maxCandidateTrialsPerConflict: number;
  maxGeneratedBuildListEntries: number;
  maxPlannerReruns: number;
}
```

`maxPlannerReruns` はfull Beam Searchの実行回数を数える。9.2.3.1のinitial conflict
preflight(`createInitialPlannerSearchState` / `createPlannerRouteUnitPlans` /
`detectPlannerConflicts`)はBeam Searchを走らせないため、この回数へ含めない。

B8-C4aで、数える対象を次のとおり明確化する。

`maxPlannerReruns` はB8 orchestrationから開始される `runPlannerBeamSearch()` の
全実行開始を数える。

```text
数える
  最初のordinary Planner full Beam Search
  Candidate trialのfull Beam Search
  Trace Replayでruntime unsupportedが判明したとき
  Production Plan生成内部で行うBeam再実行

数えない
  preparePlannerInitialContext()
  9.2.3.1 initial conflict preflight
  Conflict context生成
  Candidate materialization
  Candidate enumeration
```

したがってProduction Plan生成関数の呼出し回数と `maxPlannerReruns` の消費回数は
一致しない場合がある。1回のProduction Plan生成が、runtime unsupported retryにより
複数回のfull Beam Searchを開始し得るためである。

開始しなかったBeam Searchは消費へ数えない。boundへ到達した場合は打ち切りを
typed signalとして報告し、無言でexhaustionとして扱わない。

`ConstrainedCandidateSearchInput` へこの3つを含めてはならない
([SEARCH_SPEC.md](./SEARCH_SPEC.md) 5.6.7)。enumerationの探索量に影響せず、
Search DomainがPlanner側の試行回数を知る必要もないためである。

#### Production defaultの決定時期

**B8-AではどちらのProduction defaultも確定しない。** 根拠のない
`10000` / `32` / `16` / `64` などをProduction仕様として採用しない。

```text
B8-B1 : enumeration boundsをcaller必須指定とする。Production defaultを定義しない
B8-B2 : B8-B1実装後にenumerator側の実Browser Worker benchmarkを実施し、
        enumeration boundsのProduction defaultを決定する
B8-C  : orchestration boundsをcaller必須指定のまま実装する。
        orchestration実装前には実測できないため、ここでdefaultを決めない
B8-E  : B8-C / B8-D実装後にorchestration側のBrowser / Planner benchmarkを実施し、
        orchestration boundsのProduction defaultを決定する
```

`maxCandidateTrialsPerConflict` / `maxGeneratedBuildListEntries` /
`maxPlannerReruns` はPlanner再実行1回のコストと再実行回数に依存する。そのコストは
B8-C / B8-Dのorchestration実装が存在しなければ測定できない。したがってB8-B2の
enumerator benchmarkでこれらのdefaultを決めない。

implementation mapping（normativeなbounds semanticsではない）。

```text
Production default selected by B8-E2 Browser benchmark:
2 / 1 / 4
  maxCandidateTrialsPerConflict = 2
  maxGeneratedBuildListEntries  = 1
  maxPlannerReruns              = 4
実装: defaultPlannerOrchestrationBounds
      src/domain/planner/constrained/plannerOrchestrationBounds.ts
記録: docs/B8_PLANNER_ORCHESTRATION_BROWSER_WORKER_BENCHMARK.md 10-11章
```

この3値は**Domain validity ruleではない**。validityの契約は本節と実装の
`validatePlannerOrchestrationBounds()` が定めるとおり「finite integer かつ `>= 1`」の
ままであり、defaultはその範囲内でcallerが選べる1点にすぎない。boundsは引き続き
caller-supplied typeであり、invalid値をdefaultへrepair・clamp・field-wise completion
してはならない。`maxGeneratedBuildListEntries = 1` はDomain上の最大generated Entry数を
意味しない。

どちらのboundsも、到達した場合は打ち切りをenumeration summaryまたはwarningとして
明示する。bound到達を無言でexhaustionとして扱わない。

#### B8-C4b bound semantics

`maxCandidateTrialsPerConflict` は、1つの元Conflictに対してorchestrationが実際に
処理した `ConstrainedCandidate` 数を数える。同一Conflictに複数の非固定Targetがある
場合も同じbudgetを共有し、Targetごとにresetしない。preflight却下・Planner却下・
`reusedExisting` によるno-opも1消費とする。

```text
used < limit   -> used += 1、そのCandidateを処理
used >= limit  -> そのCandidateを処理せずconsumer stop、打ち切りとして報告
```

`limit` 件目を処理した直後に無条件で打ち切りとしてはならない。ちょうど `limit` 件で
enumerationが尽きた場合はtruncateされていないため、`limit + 1` 件目が実際に
deliveryされた時点で初めてtrial boundによる打ち切りとする。

`maxGeneratedBuildListEntries` は最終augmented PlannerInputへadoptした新規generated
Entry数だけを数える。materializeしただけの不採用trial、`reusedExisting` のEntry、
元のBuildListEntryは数えない。limit到達そのものではwarningを出さず、未充足workが
残っていて新規Entryをこれ以上adoptできないと判明した時点でwarningを出しglobal stopと
する。既にcapが満杯であると分かった新規Entryについては、無駄なfull Planner再実行を
行わない。

`PlannerOrchestrationLimitCode` はtyped値であり、message文字列を制御authorityに
しない。

```ts
type PlannerOrchestrationLimitCode =
  | 'max_candidate_trials_per_conflict'
  | 'max_generated_build_list_entries'
  | 'max_planner_reruns'
```

Search enumeration boundは `ConstrainedEnumerationSummary.stoppedByBound` がauthority
であり、このunionへ含めない。

#### B8 orchestration warning kind

B8 orchestrationだけが生成するPlannerWarningKindを追加する。通常の
`createProductionPlan()` 経路はこれらを生成しない。

```text
max_candidate_trials_per_conflict_reached
max_generated_build_list_entries_reached
max_planner_reruns_reached
constrained_enumeration_bound_reached
```

既存の `max_steps_reached` / `max_expanded_states_reached` は1回のBeam Searchの
`PlannerOptions` boundを表すものであり、意味が異なるため流用しない。

`constrained_enumeration_bound_reached` は、consumer stopではなく
`summary.stoppedByBound === true` でenumerationが終わり、かつそのworkでCandidateを
adoptできなかった場合だけ出す。対象workは終了するが、他Conflictのworkは継続する。

`max_planner_reruns_reached` に到達した場合、新しいCandidate trialを開始しない。
到達の検出を次の `beforeBeamSearch()` のthrowまで遅らせてはならない。full Beam Search
の実行可能回数を使い切っており、かつ未解決workが実際に残っている時点で、新しい
enumeration / materialization / preflightを一切開始せずwarningを出しglobal stopとする。

```text
work開始前   : 充足判定 -> 未解決かつbudget使い切り -> warning / global stop
trial却下後  : そのtrialで最後のBeamを消費 -> 次Candidateを要求せずwarning / global stop
trial採用後  : 即warningとしない。残りworkをcurrent Planで再評価し、
               未解決workが残る場合だけ次work開始前にwarning / global stop
```

最初のordinary Production Plan生成の内部でruntime unsupported retryが拒否された場合は、
Replay未成功のBeamからProductionPlanを組み立てず、最後に完了したBeam Searchの
conflicts / warningsと `plan: null` を返す。この観測のために
`ProductionPlanGenerationObserver` へsemantics-neutralな
`afterBeamSearch?(result)` を追加した。`beforeBeamSearch()` と同様に観測専用であり、
通常のProduction Plan生成semanticsを変更しない。

#### cancellation

通常PlannerはBeam cancellationを `beamResult.cancelled = true` から
`plan: null` の正常 `PlannerResult` として返す。orchestrationはこれをtypedな
run outcomeとして扱い、その後Search Domainへ進めてはならない。同じ `shouldCancel`
がconstrained enumeratorのcheckpointで
`CandidateSearchError('cancelled')` を送出し、処理済みのcancellationを
rejected Promiseへ変えてしまうためである。

```text
initial ordinary runがcancelled
  -> constrained enumerationを開始しない
  -> generatedBuildListEntries = []
  -> initial ordinary safe PlannerResultを返す

Candidate trialがcancelled
  -> 通常のreject扱いにして探索継続しない
  -> orchestration全体を終了し、最後にaccepted済みのcurrent PlannerResultを返す
```

cancellation専用のwarning kindは追加しない。`afterBeamSearch` の観測状態は
Production Plan生成1回ごとにresetし、過去runのBeam結果を誤参照しない。
`visitConstrainedCandidates()` 自身が検出したSearch cancellationのsemanticsは
変更しない。

### 9.2.17 B8のtask分割とCompatibility

```text
B8-A   Spec / DTO / API / persistence contract           (本節)
B8-B1  Search-domain constrained candidate enumerator          実装済み
       enumeration boundsはcaller必須指定
B8-B2  enumerator側の実Browser Worker benchmark                実装済み
       enumeration boundsのProduction default決定
B8-C   Planner conflict orchestration / deterministic materializer /
       augmented-input full rerun / Conflict Resolution再対応付け  実装済み
       orchestration boundsはcaller必須指定のまま
       C1 initial context / C2 materializer / C3 preflight /
       C4a rerun budget / C4b candidate trial / adoption orchestration
B8-D   Worker / Application / Persistence / atomic save /
       既存UIへの最小配線
       D1 Worker protocol / routing / Production adapter /
          Worker Client                                        実装済み
       D2a save-time再validation / atomic save                 実装済み
       D2b BuildListPageのconstrained経路配線                  実装済み
B8-E   orchestration側のBrowser / Planner benchmark            実装済み
       orchestration boundsのProduction default決定
       (defaultPlannerOrchestrationBounds = 2 / 1 / 4)
```

boundsのProduction defaultはB8-B2とB8-Eの2回に分けて決定する。orchestration
boundsはPlanner再実行の実コストに依存し、B8-C / B8-D実装前には測定できないためである。

B9 what-if、B10 Conflict UI、B11 normal-scope Keepは別Phaseとする。

B8 architecture自体は当時の次の値を変更しなかった。

```text
CURRENT_CALCULATION_APP_SCHEMA_VERSION = 2
DATABASE_SCHEMA_VERSION = 1
AppSettings.schemaVersion = 1
PRODUCTION_RNG_ENGINE_VERSION = production-rng:c5-e2
supportsSeedSearch = false
```

これはB8実装時の歴史的記録である。その後のphysical action sharing修正で3へ、共有Counter
prefixのsilent fast-forward修正で4へ更新されており、7.0.1のPlan失効 / Build artifact
互換契約が適用される。

理由。

- Production RNG semanticsを変更しない
- RouteOperationの意味を変更しない
- ProductionPlanの永続shapeを変更しない
- PlanStepの意味を変更しない
- 既存BuildListEntryのshapeを変更しない
- 既存Plan実行の意味を変更しない

実装時にこれらの前提を破る必要が判明した場合、勝手にversionを変更せず設計チャットへ戻す。

---

## 10. Plan生成手順

推奨アルゴリズム。

1. 入力validation
2. PlanningInputSnapshot作成
3. TargetSatisfaction作成
4. staleでないBuildListEntryをTargetごとに分類
5. 初期PlannerSearchStateを作成
6. BuildRoute.operationsを使ってBeam Searchを実行
7. 各展開で共有RNG時系列と在庫をシミュレート
8. 競合を検出し、実行不能な展開を除外
9. 最良Stateから採用BuildListEntryとRejectedBuildListEntryを決定
10. CandidateのBuildRoute.operationsを変更せずRouteOperation列からPlanStep列を生成し、Planner-only Stepを別に挿入する
11. 各PlanStepの期待状態Before / Afterを計算
12. requiredMaterials（アイテム素材）を集計
13. ProductionPlanを返す

制約。

- PlanStepの `order` は1始まりの連番
- PlanStepは実行ナビで1つずつ確認できる粒度にする
- 高速モード用のまとめStepは作らない
- Plan生成時点では実際のDBを更新しない。保存は呼び出し側Repositoryが行う
- Beam Searchの打切り時は到達した上限に応じて `max_steps_reached` / `max_expanded_states_reached` を返す
- 併せて `PlannerResult.termination` にtypedな終了状態を返す（7.2.1）
- `ProductionPlan.calculationContext` はPlannerInputと一致させる
- 同じPlannerInput、RngEngine fixture、ID Factory、Clock、Planner constantsから、採用Entry、操作列、PlanStep、score、warning、予約IDが同一になる

---

## 11. PlanStep生成

### 11.0 第9C-A: Search Trace Replay Draft

第9C-AではProductionPlanや永続PlanStepを生成しない。Beam Searchで確定した
`PlannerSearchState.trace` を、開始 `PlannerInput` から順にpureにReplayし、将来の
PlanStep変換用 `PlannerPlanStepDraft` を生成する。

- `PlannerMasterSubset` はSearchのRNG Predictionと同じ `weaponBonusDefinitions`、
  `bonusRanks` を保持する。PredictionはRngEngineのみから取得し、Lottery、
  Bonus Rank、Keep、Counter Gateを推測しない。
- `ExpectedPlanState` はProduction semantic RNG KnownValueのvalue/isConfirmed、stable sorted Normal Counter、
  OwnedWeaponのsemantic fields（kindを含む）をstable hash化する。名前、memo、日時、
  RNG source/notes、観測表示項目、legacy `counterGate` は除く。OwnedWeaponはTargetWeaponを
  参照しないため、Target関連情報も含めない。
- `ExpectedPlanState.ownedWeaponsHash` とBuild Listの`referencedOwnedWeaponsHash`は別契約である。
  前者はNormal rarityを含むが、後者は既存Search契約どおり含めない。両者ともname、memo、
  timestampsを含めない。
- 1 Search Actionは、共有されるEntry数にかかわらず1 physical operation、1 Draftである。
  Draftはprimary Entryと全progressed Entryを別々に保持する。
- silent fast-forwardしたRoute unitはtraceに存在しないため、Replayは再生成しない。
  Beam SearchのtraceだけでReplay stateが一意に決まる既存設計を維持し、Replay側で
  route progressを別途正規化しない。Beam SearchとReplayのsemantic差異を作らない。
- Replay RuntimeはRngState、Normal Counter、persistent OwnedWeapon Inventoryと、未登録の
  Normal/Gogma出力を保持する。Normal出力はEntryごとに分離し、複数作成後のconvertは
  そのEntryの最後に作成したNormalだけを使用して全Normal transientを破棄する。未登録出力へ
  永続OwnedWeapon IDを割り当てない。
- CreateNormalArtianOperationのpredicted variantは `count = forgeCount` をReplayし、`normalCounterAfter = normalCounterBefore + forgeCount` を検証する。convert対象は最後の結果であり、その位置は `candidateCounter = normalCounterBefore + forgeCount - 1` である
- blind variant([SEARCH_SPEC.md](./SEARCH_SPEC.md) 6.1.1)ではNormal Predictionを呼ばず、NormalArtianCounterをRoute preconditionとして読まない。物理的な通常アーティア1本は実在するため、Replay Runtimeは「5枠がunknownな作成結果」を保持する。unknownはruntime専用の明示的variantであり、架空の `RestorationBonusSet` を代入しない
- blind variantのReplayも7.0.3と同じauthorityでNormal Counterを更新する。runtimeに `isConfirmed === true && counter !== null` のNormalArtianCounterが存在する場合は `advanceNormalCounter()` で進め、存在しない場合は変更しない。`RngAdvance.normalCounterDelta` は前者で `1`、後者で `null` になる。Planner applyだけを直してReplayを直さない実装は禁止する
- unknown 5枠のtransientはconversionでそのまま継承され、`ExpectedResult.restorationBonuses` と `restorationBonusScope` は `null` になる。`null` は「予測しない」であり「ボーナスが存在しない」ではない
- 各Actionの`rngBefore`一致を検証し、`rngAfter`との差分からRngAdvanceを作る。複数Normal
  Counterの変化やunknown→knownの差分は現行RngAdvanceで表せないためReplay failureとする。
- create/reset/keep/reset-skillsは現在のRngEngine predictionを再実行する。KeepはReplay時点のtransientまたは起点武器の現在5slotをslot順のまま入力し、selection branchを持たない。
- Replayは各Predictionの直前にも同じsemantic inputで `getPredictionSupport()` を確認する。
  既知unsupportedがpreflight後の実stateで判明した場合は該当BuildListEntryだけを除外して
  Beam Searchを再実行する。support query例外とsupport=true後のPrediction例外は
  `prediction_failed` 等へ変換せず呼出元へ伝播する。
- convertはGogma Predictionを呼ばない。変換元Normalの `normal_artian` scope 5-slot bonusesをslot順のままtransient Gogmaへ継承し、現在Skill位置で `predictSkills` を実行して初回Series / Groupを設定する。
- convertのRNG遷移はSkill Counter `+1`、Normal / Gogma Counter `+0` とする。変換時のSkill結果を無視するRouteでも、実ゲームでconversionする限り同じSkill位置を消費する。
- Reset / Keepはtransient Gogmaのscopeとslot順を追跡する。normal scopeならv1は最初のBonus amendmentとしてResetだけを許可し、Reset結果でgogma scopeへ置き換えた後に限りKeepを許可する。これはProduction prediction supportの制限であり、ゲームルール上の制限ではない([SEARCH_SPEC.md](./SEARCH_SPEC.md) 5.7参照)。
- unknown 5枠に対してはReset Bonusesだけが実行可能である。Resetは置き換える5枠を読まないため、unknownからknownな `gogma_artian` scope 5枠へ遷移できる唯一の操作である。Reset Skillsは5枠を読まずSeries / Group Skillだけを書き換えるため、unknownをunknownのまま通過させる
- unknown 5枠を読む操作はReplay issue code `unknown_restoration_bonuses` でfail closedする。対象はKeep Bonusesの入力と、reserve時のCandidate Snapshot照合である。架空の5枠を合成してReplayを継続しない
- reserve前にEntry固有transient Gogmaのbonuses、Series Skill、Group SkillがCandidate Snapshotと
  完全一致することを検証する。不一致またはtransient不足はReplay failureであり、Candidate Snapshotで
  transientを上書きしてはならない。成功したEntryのtransientだけを破棄する。
- Predictionはvalueだけでなく、そのOperationが実際に依存するconfirmed入力を要求する。conversionとReset SkillsはBase Seed / Skill Counter、Reset / KeepはBase Seed / Gogma Counter、forgeはBase Seed / 対象Normal Counterを要求する。persisted exact GateはどのProduction Replay operationでも要求せず、Production forward runtimeと同じoperation別active representativeを使用する。Routeが使わないstreamの未確定値をReplay failureにしない。
- reset/keep/reset-skillsによるpersistent inventory更新はreserveまで行わない。所持Normalはconvertで
  削除し、new/owned-Normal reserveは予約済みIDのGogmaを追加、existing Gogma reserveは同一IDを更新する。
- Replay完了時はRNG、Normal Counter、persistent simulated inventoryがbest Search Stateと一致しなければ
  Draftを返さない。confirm_result、ProductionPlan、ID/Clock生成は第9C-Aの対象外である。


### 11.0-B 第9C-B: ProductionPlan組み立て

`createProductionPlan(input, dependencies, options)` はBeam Searchと9C-A Replayを再実装せず、
次の順でDraft ProductionPlanを組み立てる。

1. `runPlannerBeamSearch` を実行する。
2. `bestState` がnullならPlanを作らず、Beam Searchのconflicts / warningsをそのまま返す。
3. `bestState.trace` が空なら（初期状態ですべての有効TargetがIdealを満たす場合を含む）空Planを作らず `plan = null` とする。
4. `replayPlannerSearchTrace(input, bestState, dependencies.rngEngine)` を実行する。Replay failureはwarningへ変換せず、issue code / message / actionIndexを含むPlanner内部エラーとして失敗させる。
5. Replayが成功したDraftを順序を変えずにPlanStepへ1対1で変換する。
6. PlanningInputSnapshot、採用/不採用Entry、アイテム素材表示、ProductionPlanを作る。

Replay後、ProductionPlan IDを1回生成し、その後Draft順にPlanStep IDを1回ずつ生成する。
Searchで確定したreserve用OwnedWeapon IDはDraftの値をそのまま使用し、再生成しない。Clockは
Replay成功後に1回だけ呼び、その同じ値を`baseSnapshot.createdAt`、`plan.createdAt`、
`plan.updatedAt`へ設定する。PlannerはPlanを`status = "draft"`で返し、active化や保存は
Application / Persistence層の責務である。

#### PlanningInputSnapshot

`initialExecutionState` は既存の`createExpectedPlanState(input.rngState, input.normalCounters,
input.ownedWeapons)`で生成する。独自Hashを再実装しない。

`targetWeaponsHash` はTarget IDの辞書順で、各`{ id, definitionHash:
createTargetDefinitionHash(target) }`をstable hash化する。Target definitionのsemantic fieldと
nameの扱いは既存`createTargetDefinitionHash`契約を正本とし、Plannerが別契約を加えない。

`buildListEntriesHash` はEntry IDの辞書順で、実行意味を持つCandidate Snapshot、
`targetDefinitionHash`、`searchStateHash`、`referencedOwnedWeaponsHash`、
`calculationContext`をstable hash化する。Candidate ID、searchRunId、Candidate createdAt、
idealDifference、similarity表示値、BuildListEntryの`candidateId`、`isStale`、`staleReasons`、
`createdAt`は含めない。finalBonusesはbonus type/rankのmultiset、requiredMaterialsは重複を保った
  materialId/quantity順で正規化し、finalBonusScopeを含め、RouteOperationの実行順は変えない。いずれのsortにもlocale依存比較を
使わない。

#### DraftからPlanStepへの変換

1 Draftは共有されたEntry数に関係なく1 physical operation、1 PlanStepである。
`PlanStep.buildListEntryId` は`draft.primaryBuildListEntryId`だけを保存し、
`progressedBuildListEntryIds`の数だけ複製しない。Candidate IDその他のoperation、expected result、
expected state、inventory change、RngAdvance、debugはReplay Draftからstructured cloneする。
PredictionやCandidate Snapshotからの中間結果再構成は行わない。

`PlanStep.progressedTargetWeaponIds` は、1回の物理Stepが複数TargetのRouteを同時に進めた事実を
persisted ProductionPlanから判定するためのobservational metadataである。新規生成する全PlanStepへ
必ず設定し、`draft.progressedBuildListEntryIds` を唯一の権威として
`PlannerInput.buildListEntries` からTargetWeapon IDへ変換する。重複Targetは除去し、順序は
locale非依存のstable string比較で決定的にする。`progressedBuildListEntryIds` に対応する
BuildListEntryが見つからない場合は黙って除外せず、Plan生成の不整合として
`PlannerPlanGenerationError` で失敗させる。

このfieldは `targetWeaponId` / `buildListEntryId` を置き換えず、両者のprimary presentation /
primary Entry権威も意味も変えない。`targetWeaponId` が必ず含まれるという契約は追加せず、Route進行を
伴わないStepは空配列でよい。fieldはoptionalであり、`undefined` はこのfield導入前に保存された
legacy Planだけを意味する。読み取り時に `[step.targetWeaponId]` などで補完してはならない。実際には
他Targetも共有していた可能性があり誤情報になる。

`progressedTargetWeaponIds` はPlanner semantics、Search semantics、RNG semantics、PlanStep identity、
`CalculationContext` semanticsのいずれも変更せず、schema / version bumpも伴わない。

StepはReplay時系列のままorder 1から連番にし、初期状態を未完了とする。最初の
`expectedStateBefore`はbase snapshotのinitialExecutionStateと一致し、各隣接Stepの
`expectedStateAfter` / `expectedStateBefore`が連鎖しなければ内部エラーとする。今回の対象
operationはすべて`requiresUserConfirmation = true`とする。`confirm_result`を自動追加しない。

title / instructionはoperation typeと、存在する場合だけTarget名から決定的に生成する。未確認の
ゲームUI名、ボタン、座標、画面遷移を文言へ推測してはならない。

`create_normal_artian` のinstructionだけは、そのStepがblind creation
([SEARCH_SPEC.md](./SEARCH_SPEC.md) 6.1.1)かどうかで分岐する。blind creationでは
「復元ボーナス内容は問わない」ことと、後続のReset Bonusesで5枠全体が引き直されることを
明示する。これは非永続の `PlannerPlanStepDraft` が保持するpresentation情報から決定し、
永続 `PlanStep` へ新しいfieldを追加しない。生成済み文言はこれまでどおりPlanStepの
`instruction` 文字列としてそのまま保存される。

#### ProductionPlanの集約値

`selectedBuildListEntryIds`はbest Search Stateの値だけをdedupeして辞書順にする。
`conflicts`はBeam Searchが返したstable conflict IDを再生成せずstructured cloneして保存する。
`currentStepId`は最初のStep ID（Stepなしならnull）である。

Beam SearchがcancelledならReplay、Clock、Plan/Step ID生成、Plan組み立てを行わず、`plan = null`で
conflicts / warningsだけを返す。partial Stateではtraceのprimary/progressed EntryをRejectedへ入れない。
`completed = false`では、protected destructive useと、選択済みConflictによって明確に除外された
resource conflictだけをRejectedとしてよく、未決定Entryへalready_satisfied、longer_route、
dominated_by_better_candidateを付けない。

complete PlanではTraceに登場したこと自体をRejected除外理由にしない。RejectedBuildListEntryは、最終selectedでない検討可能Entryと明確なprotected destructive
rejectionだけをEntry IDごとに1件作る。理由は証明できる順に
`requires_protected_weapon`、選択済みConflictによる`resource_conflict`、
`candidate_already_satisfied`による`already_satisfied`、同一Targetで短い採用Routeが
ある`longer_route`を使う。これらを証明できない場合だけ
`dominated_by_better_candidate`を使う。stale / CalculationContext / capability等のvalidation除外は
このunionへ押し込まず、既存warning/validation結果の責務とする。

`requiredMaterials`はselected BuildListEntryの`candidateSnapshot.requiredMaterials`だけを
materialIdごとに合算し、materialId辞書順で返す。master materialCostsからの再推測はしない。
shared physical actionとCandidate別requiredMaterialsの二重計上は既知の未解決境界である。Candidate単位の
total requiredMaterialsをphysical action単位へ安全に分解する契約がないため、第9C-Bではmasterからの
再計算、Entry数での除算、補正式の追加を行わない。

上限到達時でもtraceが1件以上あるbest partial Stateは、その到達点までのDraft Planとして返して
既存warningを維持する。Execution、Invalidation、Undo、Worker契約追加、Dexie保存は
第9C-Bでは生成・実装しない。
BuildCandidateの `BuildRoute.operations` を順にPlanStepへ変換する。Route kindやCounter endpointだけから操作列を再構成しない。

基本変換。

```text
CreateNormalArtianOperation -> create_normal_artian
ConvertToGogmaOperation    -> convert_normal_to_gogma
ResetBonusesOperation      -> reset_bonuses
KeepBonusesOperation       -> keep_bonuses
ResetSkillsOperation       -> reset_skills
```

current `RouteOperation` unionはこの5種類だけである。switch文のdefaultで旧operationを
暗黙処理せず、exhaustiveに扱う。

OperationごとのExpectedResult / RngAdvance / debug before-afterは次を正式契約とする。

| Operation | ExpectedResult | RngAdvance |
| --- | --- | --- |
| create normal | そのforge結果のnormal scope 5枠 | Normal +1 / forge、Skill 0、Gogma 0 |
| convert normal to Gogma | 継承したnormal scope 5枠 + 初回Series / Group | Normal 0、Skill +1、Gogma 0 |
| reset skills | bonusとscopeを維持し、次Series / Group | Normal 0、Skill +1、Gogma 0 |
| reset bonuses | gogma scopeの次5枠 | Normal 0、Skill 0、Gogma +1 |
| keep bonuses | familyをslotごとに維持したgogma scopeの次5枠 | Normal 0、Skill 0、Gogma +1 |

PlanStepDebugInfoも同じbefore / afterを記録し、conversion StepではSkillだけが進みGogmaは同値であることを表示する。PRNG内部10 stepをRngAdvanceのCounter deltaへ記録しない。

第9C-BではReplay Traceに存在する `reserve_weapon` だけを変換し、`confirm_result`を自動追加しない。

`confirm_result` は予測結果の確認だけを表し、Target武器をInventoryへ正式確保しない。
Target候補をOwnedWeaponとして確保し、TargetSatisfactionを更新するのは
`reserve_weapon` Stepだけである。

Route別の典型例。

## 11.1 通常アーティア経由

```text
1. create_normal_artian（`candidateOffset = k` なら `forgeCount = k + 1`。先行k本は通常のまま見送る）
2. convert_normal_to_gogma
3. Gogma-tier bonusが必要なら最初に reset_bonuses
4. 最初のReset後、必要なら追加の reset_bonuses / keep_bonuses
5. conversion時のSkillが不足する場合だけ reset_skills
6. confirm_result または reserve_weapon
```

`candidateOffset = k` を採用する場合のconversion直後の合計進行はNormal `+(k + 1)`、Skill `+1`、Gogma `+0` である。`forgeCount = k + 1` の最後の1本だけを巨戟化し、先行k本を巨戟化しない。conversionは通常5枠をslot順のまま継承し、初回Series / Groupを付与する。conversion後のReset / Keep / Reset Skillsは `sourceOwnedWeaponId = null` のtransient Gogmaを対象とし、v1では最初のBonus amendmentをResetとする(prediction support上の制限)。

`reserve_weapon` はPlanner生成時に新しいOwnedWeapon IDを予約し、Candidate Snapshotの
  finalBonuses / Series Skill / Group Skillを持つ `kind = "gogma"` の武器を追加する。
その武器の `restorationBonusScope` はCandidate Snapshotの `finalBonusScope` と一致させる。
Candidateは常に理想品なので、新規登録する武器はstatus idealかつprotectedとする。
checkpointは同じRouteの途中状態であり、reserveの対象にならない(7.5.3)。
OwnedWeaponへTarget IDを追加する処理は存在せず、`TargetWeapon.preferredOwnedWeaponId` も
変更しない（7.4）。

UI実行は1操作ずつ。

## 11.2 所持通常アーティア経由

```text
1. convert_normal_to_gogma
2. Gogma-tier bonusが必要なら最初に reset_bonuses
3. 最初のReset後、必要なら追加の reset_bonuses / keep_bonuses
4. conversion時のSkillが不足する場合だけ reset_skills
5. reserve_weapon
```

変換元の所持通常アーティアはレア8かつ非保護であることを要求する。`convert_normal_to_gogma` StepのInventoryChangeで元通常アーティアを除き、その時点以降同じIDを別Routeで再利用しない。変換後GogmaはまだOwnedWeaponへ登録せず未来IDも割り当てない。通常5枠をnormal scopeのまま継承し、初回Skillを予測してSkill Counterだけを1進める。後続Reset / Keep / Reset Skillsは `sourceOwnedWeaponId = null` とし、v1では最初のBonus amendmentをResetとする(prediction support上の制限)。Bonus Type MappingからRank変換を推測しない。

`reserve_weapon` は元OwnedNormalArtianWeaponを再削除せず、別の予約IDで新しい
OwnedGogmaArtianWeaponだけを追加する。元IDをkind変更して再利用しない。追加武器のstatus、
protection、Candidate結果、Target参照は11.1と同じ契約とする。

## 11.3 既存巨戟 Reset Bonuses

```text
1. reset_bonuses
2. reset_skills または confirm_result
3. reserve_weapon
```

既存巨戟Routeの `reserve_weapon` は新しい武器を追加せず、Routeの
`sourceOwnedWeaponId` と同じOwnedGogmaArtianWeaponを更新する。Candidate結果、理想品ラベルに
対応するstatusとTarget参照を反映するが、既存武器の明示的な `isProtected` は変更せず、既存Target参照も失わない。

## 11.4 既存巨戟 Reset Skills

```text
1. reset_skills
2. confirm_result または reserve_weapon
```

起点OwnedWeaponのrestorationBonusScopeと復元ボーナス5枠を変更せず、Skill CounterとSkill Prediction結果だけを反映する。Reset SkillsはSkill性能を変更するため、起点OwnedWeaponはGogmaかつunprotectedでなければならない。

`reserve_weapon` では同じIDのseriesSkillId、groupSkillId、status、isProtected、
updatedAtを更新し、復元ボーナスとcreatedAtを維持する。Target参照は更新対象に含まない（7.4）。

## 11.5 既存巨戟 Keep Bonuses

```text
1. keep_bonuses
2. reset_skills または confirm_result
3. reserve_weapon
```

起点は `restorationBonusScope = "gogma_artian"` でなければならない。Keepはcurrent 5slotのfamilyをslotごとに保持する単一操作であり、selection別のPlanStepを生成しない。

## 11.6 撤去したPlanner-only Step

所持武器を素材として消費するモデルの廃止にともない、次のPlanner-only Stepは
current仕様から撤去した(8.1)。

```text
create_material_gogma         素材用巨戟として登録
use_weapon_as_material        素材として消費
change_owned_weapon_status    旧PracticalをMaterialへ変更
```

Plannerは素材用巨戟の補充Routeを生成せず、旧Practical武器の確認付き素材化Stepも
予定しない。statusを書き換えるのはOwned Weapons画面の通常CRUDと、`reserve_weapon` が
理想品ラベルを設定する場合だけである(8.1)。

保存済みlegacy artifactがこれらのoperationを含んでいても、current Domain operationへ
自動変換せず、CalculationContext境界でfail closeする。

すべての `reserve_weapon` Stepは上記Route別InventoryChangeを
`expectedStateBefore` / `expectedStateAfter` へ反映する。RNG操作Stepだけでは
TargetSatisfactionを更新せず、reserve完了時にPractical / Ideal充足を更新する。

---

## 12. 再計算

計画どおり進行している場合は再計算しない。

再計算はstale Planに対してユーザーが開始するUI / Planner操作であり、
`PlanStepOperationType` ではない。旧Planへ `recalculate_plan` Stepを追加しない。

Plan開始時の `baseSnapshot.initialExecutionState` と現在の可変状態を毎回比較してはならない。正常なStep実行でもRNG Counterと所持武器が変化するためである。

再計算判定は現在Stepの `expectedStateBefore` / `expectedStateAfter` を使用する。

```ts
export interface PlanRuntimeState {
  rngState: RngState;
  normalCounters: NormalArtianCounter[];
  ownedWeapons: OwnedWeapon[];
}

export function detectPlanInvalidation(
  plan: ProductionPlan,
  currentInput: PlannerInput,
  runtimeState: PlanRuntimeState,
  phase: "before_step" | "after_step"
): RecalculationReason[];
```

判定手順。

1. 現在のCalculationContext、TargetWeapon Hash、BuildListEntryの不変項目HashをPlanの不変前提と比較する。BuildListEntryの不変項目にはSnapshot、searchStateHash、referencedOwnedWeaponsHash、CalculationContextを含め、派生値のisStale / staleReasonsはHashに含めない
2. `phase = "before_step"` では実状態Hashを現在Stepの `expectedStateBefore` と比較する
3. ユーザー確認後、呼び出し側が実結果に基づくRNG更新とInventoryChangeをトランザクション内で適用する
4. `phase = "after_step"` では更新後の実状態Hashを現在Stepの `expectedStateAfter` と比較する
5. 一致した場合だけStepを完了し、次Stepへ進める
6. 一致した正常進行ではPlanをstaleにしない

再計算が必要な条件。

- RNG状態が現在Stepの期待状態と異なる
- NormalArtianCounterが現在Stepの期待状態と異なる
- TargetWeaponが変わった
- 作成リストが変わった
- OwnedWeaponが現在Stepの期待状態と異なる
- CalculationContextとの互換性が失われた。この場合は `calculation_context_changed` を記録する
- 想定結果と実結果が違った
- 予定候補を確保しなかった
- 予定とは異なる候補を確保した

制約。

- 実行に影響する項目だけを正規化した安定Hashで比較する
- Plan開始時の可変状態Hashは監査用であり、Step 1開始後のstale判定基準にしない
- Active Plan開始後、正常なRNG進行または計画どおりのOwnedWeapon変更によってBuildListEntryのsearchStateHashまたはreferencedOwnedWeaponsHashが現在値と一致しなくなっても、それだけで進行中Planをstaleにしない
- 正常なStep進行で生じるCounter / Inventory変更は `expectedStateAfter` と一致する限り差分とみなさない
- 差分がある場合、Planを `stale` にする
- 自動で新Planへ置き換えず、ユーザーに再計算を促す

---

## 13. Undo

Undo対象。

- 最後のExecutionHistoryが持つExecutionUndoSnapshot
- そのSnapshotに保存されたRngState、全NormalArtianCounter、変更対象OwnedWeapon、追加OwnedWeapon ID、削除OwnedWeapon本体、ProductionPlan

制約。

- Undoはアプリ状態だけを戻す
- ゲーム内操作が巻き戻るわけではないことをUIに表示する
- 最後のExecutionHistoryだけから、そのStep確定前のアプリ状態を正確に復元する
- UndoはExecutionHistory取消、PlanStep取消、RNG復元、NormalArtianCounter復元、Inventory復元、ProductionPlan復元を1つのDexie transactionで行う
- Undo transactionが失敗した場合は部分復元を残さず、Undo前の状態を維持する
- Snapshotどおりの復元後は、復元したProductionPlanのstatusと再計算理由をそのまま使用し、現在値との差分を新たに推測しない

---

## 14. Worker

```ts
export type PlannerWorkerRequest =
  | {
      type: "create_plan";
      requestId: string;
      input: PlannerInput;
    }
  | {
      type: "detect_invalidation";
      requestId: string;
      plan: ProductionPlan;
      input: PlannerInput;
      runtimeState: PlanRuntimeState;
      phase: "before_step" | "after_step";
    }
  | {
      type: "cancel";
      requestId: string;
    };

export type PlannerWorkerResponse =
  | {
      type: "create_plan_result";
      requestId: string;
      result: PlannerResult;
    }
  | {
      type: "invalidation_result";
      requestId: string;
      reasons: RecalculationReason[];
    }
  | {
      type: "progress";
      requestId: string;
      progress: {
        expandedStates: number;
        maxExpandedStates: number;
      };
    }
  | {
      type: "error";
      requestId: string;
      message: string;
    };
```

Worker messageはstructured clone可能なPlannerInputだけを受け取る。RngEngine instanceを
postMessageしない。Worker moduleがEngine、ID Factory、Clockを生成して
`PlannerDependencies` とし、pure Planner calculationへ注入する。PlannerInputへ
`engineCapabilities` を重複保存せず、validationは
`dependencies.rngEngine.capabilities` を `deriveRngCapabilities` へ渡す。

Planner domainとTrace ReplayはProduction RNGのinput-level support契約へ対応済みである。
本番経路はBuild List UIからProduction Planner Worker Clientを呼び、
`planner.worker.entry.ts` がWorker内部で `ProductionRngEngine`、ID Factory、Clockを
生成して `PlannerDependencies` として注入する。Engine instanceや関数をWorker messageへ
含めない。Client、Plannerのcurrent `CalculationContext`、Worker内Engineは
`PRODUCTION_RNG_ENGINE_VERSION` を共通authorityとして使用する。

C5-E2C3でactive Gate契約をPlanner validation、Trace Replay、expected-state hashへ同期済みである。exact persisted Gateはoperation preflightまたはReplay requirementではなく、expected-state hashにも含めない。Production adapterのruntime policy変更と同時に `PRODUCTION_RNG_ENGINE_VERSION`を `production-rng:c5-e2`へbumpした。これはIdentification Production UIのactivationを意味せず、`supportsSeedSearch = false`を維持する。

B8-D1でconstrained re-search用のrequest kindを追加した。ordinary `create_plan` /
`create_plan_result` は変更していない。実装名称の対応は次のとおりで、`cancel`、
`progress`、`error` は両request kindで共有する。

```text
create_constrained_plan          input: { plannerInput, orchestrationBounds }
create_constrained_plan_result   result: PlannerOrchestrationResult
```

あわせて、logical `requestId` とは別にtask instanceを識別するruntime-only
`generation` をWorker wire messageへ追加した。ordinary / constrainedのtask requestと
`cancel` はgenerationを運び、`progress`・両result・`error` はそれをechoする。Clientが
monotonicに採番し、Workerはそれをownership authorityとして使う。Clientは
requestIdとgenerationが両方一致するresponseだけを現在requestのものとして扱う。
`postMessage()` が非同期であるため、requestIdだけでは同一ID再利用時に旧task instanceの
responseを新requestのものとして誤処理しうるためである。`generation` はWorker protocol
限定のruntime primitiveであり、`PlannerInput` / `PlannerResult` /
`PlannerOrchestrationResult`、Domain entity、Persistenceへは追加しない。

`PlannerOrchestrationResult` は `domain/planner/constrained` の型であるため、この
protocolはWorker層の `src/workers/plannerWorkerContracts.ts` へ置く。Domainは
Worker moduleをimportしない。`PlannerOrchestrationBounds` はcaller必須としてWorker
messageへ含め、`ConstrainedEnumerationBounds` は含めない。Production Worker adapterが
`defaultConstrainedEnumerationBounds` をWorker境界内で明示的に渡す。

B9-Cでwhat-if比較を同じPlanner Worker境界へ接続した。実装名称の対応は次である。

```text
create_what_if_comparison          input: PlannerWhatIfRequest
create_what_if_comparison_result   result: PlannerWhatIfCalculationResult
```

ordinary / constrained / what-ifは同じ `requestId` / generation、`cancel`、`progress`、
`error` 契約を共有する。`PlannerWorkerClient.createWhatIfComparison()` は
`PlannerWhatIfRequest` をそのまま渡す。Production Worker adapterの
`createProductionPlannerWhatIfComparison()` が `defaultConstrainedEnumerationBounds` を
Domain calculationへ明示供給し、caller-requiredの `PlannerWhatIfBounds` は変更しない。
`defaultPlannerWhatIfBounds` はB9-B2cで2 / 8に確定したが、callerだけが明示選択し、
Worker adapter / Clientは暗黙適用しない（9.2.4.9）。この記述は実装mappingであり、
9.2.4.1〜9.2.4.13のnormative semanticsを変更しない。

Workerを利用できない環境ではClientのversionを `production-engine-unavailable` とし、
計画実行を明示的なunavailable errorにする。これは
`getPredictionSupport() = supported: false` のBuildListEntry単位除外とは別経路である。

---

## 15. テスト観点

## 15.1 Satisfaction Test

- 通常アーティアをTargetのPractical / Ideal所持判定に含めない
- 巨戟アーティアだけを実際のTarget条件で評価する
- statusではなく条件で実用品所持を判定する
- 理想品所持TargetをPlanner対象から外す
- 妥協品しか持たないTargetはPlanner対象に残る
- `hasPractical` はstatusではなく実際の性能から判定する
- Ideal候補確保でhasPracticalとhasIdealがtrueになる
- 開始OwnedWeaponが妥協条件を満たしていてもcheckpoint opportunityにしない

## 15.2 Score Test

- priorityが高いTargetの候補が優先される
- 理想品未所持Targetの候補が優先される
- Candidate ScoreがBeam Searchの状態評価に使われ、単純Score順でPlanが確定しない
- `categoryScore` と `practicalFirstProgressTargetIds` が存在しない
- 選択済みcheckpointの充足に差がある場合、`weaponSwitchCount` が少なくても従来の優先順位が勝つ
- `evaluationScore` に差がある場合も、`weaponSwitchCount` が少ない側ではなく高score側が勝つ
- 両者が同点の場合だけ `weaponSwitchCount` が少ないstateを優先し、それも同数なら
  従来のsemantic / trace stable tie-breakへ進む

## 15.3 Beam Search Test

- 共有Gogma / Skill Counterを進める複数候補を単独Score順より少ない操作で組み合わせられる
- 複数Routeの共有RNG prefixを重複実行せず、各Entryのroute progressが進む
- `beamWidth` を超えたStateが評価順に枝刈りされる
- `maxExpandedStates` 到達時に探索を停止してwarningを返す
- `maxPlanSteps` と `maxExpandedStates` のwarning kindを区別する
- `PlannerInput.options` の値がそのまま `termination.limits` に載り、module既定値へ
  差し替えられない
- 上限打切り時に `termination.status = "incomplete"` と `reachedLimits` を返し、
  対応するwarningと矛盾しない
- 完成した探索が上限へ到達していた場合は `status = "completed"` のまま
  `reachedLimits` が非空になり、保存とnavigationを妨げない
- キャンセルは `incomplete` ではなく `cancelled` になる
- Beam Searchへ到達しなかった入力invalid runは `exhausted` で `reachedLimits` が空になる
- typed terminationが `PlannerBeamSearchResult` からProduction Plan生成、
  orchestration結果、Worker応答、Worker Clientまで再構築されずに届く
- 同じ入力と同じ定数から決定的なPlanが生成される
- 同じEngine fixture、ID Factory、ClockでもID、時刻、予約OwnedWeapon IDを含め決定的になる
- offset kのNormal候補が `forgeCount = k + 1` だけNormalを進め、最後の1本だけのconversionでSkillを1進め、Gogmaを進めない
- create operationの `normalCounterAfter = normalCounterBefore + forgeCount` と、採用候補位置 `normalCounterBefore + forgeCount - 1` を混同しない
- 完全最適解を要求せず、探索上限内の最良Stateを返す
- 別Entryの実操作でcurrent Counterが通過したskip可能prefixがroute progressだけ前進し、
  Search Action、trace、progressedBuildListEntryIds、inventory効果、route runtime outputを
  生成しない
- 同じCounter位置に必須unitと実行可能なskip可能unitがある場合、skip可能unitを先に実行する
  successorを生成せず、不要な `counter_before_current` も記録しない
- 必須unitが現在stateで実行不能な場合はこの除外を適用しない
- skip可能unit同士だけの位置では、どちらのEntryが実行してもよい
- skip不可なpast unitは従来どおり `counter_before_current` などでfail closedになる
- Route末尾のunitはskip不可であり、Route全体がfast-forwardされない
- Reset→Reset / Keep→Reset / Keep→Keep / Reset Skills→Reset Skillsだけがskip可能で、
  Keep直前のReset、create、conversionはskip不可
- 共有Gogma Counterを別武器の操作で進めた複数Targetが、どちらのTargetも落とさずIdealまで
  完成し、必要なRoute prefixだけがPlanStepになる
- 同じOwnedWeaponの連続操作はswitchを増やさず、別武器への変更で1、元の武器へ戻ると2になる
- `reserve_weapon` はswitch countも直前subjectも変えず、同じ武器の操作列を分断しない
- silent fast-forwardされたRoute prefixはswitchを増やさない
- 同じconcrete OwnedWeaponのshareable physical actionで複数Entryが進んでも、
  switchを二重加算しない
- 同じEntryのtransient Gogma連続操作はswitchを増やさず、別Entryのtransient Gogmaは別subject
- 共有Counter位置の分割が既存評価で同点になるユーザー再現ケースで、Beam Searchが実際に
  選んだTrace / ProductionPlanのglobal execution orderが武器切替1回の順序になる

## 15.4 Inventory Test

- current `RouteOperation` に `use_weapon_as_material` が存在しない
- `canUseAsMaterial`、`canConsumeMaterialWeapon`、`consumeMaterialWeapon`、
  `consumedMaterialWeaponCount`、`PlannerMaterialRequirement`、
  `PlannerMaterialAssignment`、`material_weapon_shortage` が存在しない
- Plannerが `create_material_gogma` / `change_owned_weapon_status` を生成しない
- 素材用巨戟の補充Routeを生成しない
- 素材武器消費のpenaltyがscoreに存在せず、未分類武器の本数がscoreへ影響しない
- `isProtected = true` の武器をReset Bonuses・Keep Bonuses・Reset Skillsへ使う探索展開を生成しない
- Bonus / Skill amendmentで保護武器を必要とするEntryは `requires_protected_weapon` で不採用になる
- 所持通常アーティアの巨戟化で元のNormalがInventoryから削除される
- 同じ所持Normalを二重使用できない
- 消費済み武器を再利用しない
- `status` は使用可否の判定に使われず、未分類の巨戟でも実性能でTargetを満たせる

## 15.4.1 Checkpoint Constraint Test

- 選択済みcheckpoint終端をsilent fast-forwardしない
- 未選択のcheckpoint相当の中間unitは従来どおりsafe fast-forwardできる
- checkpointに不要な完全上書き済みprefix unitは従来どおりskipできる
- 選択済みcheckpointのexact stateがTrace Replayで検証され、不一致は
  `checkpoint_state_mismatch` になる
- 選択済みcheckpointを到達していないEntryはreserveできず、
  `selected_checkpoint_not_reached` になる
- Plannerが選択済みcheckpointを自動解除しない
- Plannerが同一groupの別opportunityへ自動変更しない
- checkpointなしのEntryでは従来のIdeal Route実行意味が変わらない
- 1つの共有物理actionが複数Entryのcheckpointを同時達成する場合、操作を重複させない
- checkpointは新しい `PlanStepOperationType` ではない
- checkpoint milestoneが該当する物理PlanStepへ載る
- milestone到達後も `remainingOperationCount` 分の後続PlanStepが存在する
- checkpoint到達でOwnedWeaponをreserveしない
- checkpoint到達でstatusも保護も変更しない
- 最終的な理想品完成時だけ従来のreserve semanticsを適用する

## 15.5 Conflict Test

- 同じRNG位置の候補を競合にする
- conversionを同じSkill Counter位置の競合にし、同じGogma Counter位置の競合にしない
- 同じOwnedWeapon消費を競合にする
- 推奨候補が優先順位どおり決まる
- ユーザー選択が必要な競合を検出できる
- PlanConflictの参照がBuildListEntry ID基準である
- RejectedBuildListEntryの参照がBuildListEntry ID基準である
- 必須unitとskip可能unitが同じCounter位置にあっても競合にせず、Conflict Resolution UIへ
  出さない（順序はPlannerがexecution eligibilityとして決める）
- skip可能unit同士を同じCounter位置だけで競合にしない
- 必須unit同士の同一Counter位置競合と `same_owned_weapon_consumed` は従来どおり検出する
- fast-forward済みのpast prefixがConflict対象へ戻らない
- 2武器の選択済みcheckpointが同じCounterで両立不能なら競合になる
- 作成リストで別opportunityへ変更すると、その競合が解消する
- 選択のない共有prefix位置は従来どおり競合にならない
- 競合へ参加した選択済みcheckpointが `PlanConflict.checkpointParticipants` に記録され、
  `PlanConflict.id` の生成規則は変わらない

Planner-driven constrained re-search実装後に追加する観点。

- 再検索の開始位置を `conflictingCounter + 1` へ固定せず、競合位置より前の解も候補になる
- 同一Counter位置でもshareableなoperationを持つCandidateを除外しない
- 固定Candidateと共存不能なCandidateを順次読み飛ばし、共存可能なものをnext Idealとして採用する
- Candidate Search側にcounter precondition / action identity判定を複製していない
- earlier same-result solutionが固定Candidateと競合して実行不能な場合に、
  later same-result solutionを再評価して採用できる
- 初回Search用の「同一結果なら最小advanceだけ保持」pruningが再検索へ持ち込まれていない
- 初回SearchのPractical dominanceで省略された候補が、dominant candidate実行不能時に
  再評価・採用できる
- canonical Ideal到達による終了とhorizonが再検索の探索範囲を恒久的に制限しない
- 再評価がCartesian productの列挙にならず、stream独立性とCross-only初回policyを保つ
- what-if比較が双方向(A優先時のB、B優先時のA)で対称に求まる

## 15.6 Plan Test

- PlanStep orderが連番になる
- requiredMaterialsが集計される
- currentStepIdが最初の未完了Stepを指す
- maxPlanSteps超過でwarningが出る
- Plan生成が入力を破壊しない
- Candidate SnapshotのBuildRoute.operationsを書き換えない
- BuildRoute.operationsと同じ順序でPlanStepが生成される
- normal scopeのtransient Gogmaに最初のReset前のkeep_bonuses PlanStepを生成しない。除外理由をprediction support不足として扱う
- 最初のReset後はnormal / owned-Normal Routeから後続keep_bonuses PlanStepを生成できる
- conversion StepのExpectedResultが継承normal bonusと初回Skillを持ち、RngAdvanceがSkill +1 / Gogma +0になる
- transient GogmaのReset / Keep / Reset Skills PlanStepがfake OwnedWeaponIdを持たない
- `existing_gogma_reset_skills` からreset_skillsと結果確認または確保Stepを生成する
- Search後にsourceがprotectedへ変わったReset Skills Routeを `requires_protected_weapon` で不採用にする
- 各PlanStepにexpectedStateBefore / Afterが設定される
- BuildListEntry IDとCalculationContextがPlanへ保存される
- Candidate由来PlanStepの主参照がBuildListEntry IDである
- `recalculate_plan` PlanStepを生成しない
- Route別reserve_weaponのadd / remove / update契約が守られる
- 上限打切りのincomplete resultから生成されたpartial Planを、実行可能なDraft
  ProductionPlanとして永続化しない
- そのとき生成BuildListEntriesも単独で永続化しない
- 探索が自然終了しただけの `exhausted` resultは従来どおり保存できる
- version 2 / 3 / 4 ProductionPlanがcurrent version 5で非互換となり、
  `calculation_context_changed` を返す
- version 5 ProductionPlanがcurrent version 5で互換となる
- version 2 / 3 / 4のBuildCandidate / BuildListEntryはcurrent version 5で互換、
  version 1は非互換であり、build-result例外がProductionPlanへ波及しない
- 実ユーザーケース（Bonus 23 / Bonus 148 + Skill 82の2 Target）が既定上限で
  `incomplete` と24 step partialになり、`maxExpandedStates` を引き上げると
  232 stepの完成Planになる

## 15.7 Invalidation Test

- 現在StepのexpectedStateBeforeと一致する状態ではstaleにならない
- 期待操作適用後にexpectedStateAfterと一致すればstaleにならない
- Plan開始時からCounterが進んでいても現在Step期待値と一致すればstaleにならない
- 現在Step期待値と異なるRngState変更でstaleになる
- TargetWeapon変更でstaleになる
- BuildListEntry変更でstaleになる
- OwnedWeapon変更でstaleになる
- ExecutionHistoryの想定外結果でstaleになる
- CalculationContext非互換で `calculation_context_changed` が記録され、staleになる
- Active Planの計画どおりの参照OwnedWeapon変更では、BuildListEntry由来の `owned_weapon_changed` だけを理由にstaleにならない
- 所持武器のstatusだけを変更してもstaleにならない

## 15.8 Worker Contract Test

- detect_invalidation requestがplan、input、runtimeState、phaseをすべて保持する
- Workerが同じ引数をdetectPlanInvalidationへ渡す
- create_plan requestはserializable PlannerInputだけを保持し、Engine instanceを持たない
- Worker module内で生成したPlannerDependenciesがPlanner計算へ渡される
- 有効、削除済み、staleな競合選択を区別し、無効選択をwarningにする

## 15.9 Constrained Re-search Test

B8-Aで固定した契約に対するテスト観点である。実装はB8-B1以降で行う。

- 明示的な `PlannerConflictResolution` が無い競合でconstrained re-searchを自動実行しない
- `recommendedBuildListEntryId` やbestStateのparticipantを固定authorityとして使わない
- 再検索の開始位置が `conflictingCounter + 1` へ後方固定されない
- enumeratorへ渡す `origin` がPlanner計算開始時のcurrent validated snapshotから
  構成され、過去のUI Candidate Search requestを要求しない
- constrained re-searchが過去のUI一時filterを継承せず、route scopeが現時点で
  成立する全Routeになり、UI一時filterや `CandidateSearchSettings` を
  適用しない
- 探索範囲の上限が `ConstrainedEnumerationBounds` だけで決まる
- deterministic constrained search identityがTargetWeapon ID、Search / RNG semantic
  origin、CalculationContext、`ConstrainedEnumerationBounds`、route policyから
  安定生成され、random UUID / Clock / request UUID / enumeration ordinalを含まない
- 競合位置より前のPracticalが再評価対象に含まれる
- 初回Searchのstream-local retentionで省略された同一結果の後続位置を再評価できる
- 初回SearchのPractical dominanceで省略された候補を再評価できる
- Counter位置の一致だけを理由にCandidateを除外しない
- 共存判定が既存Planner再実行の結果に一致し、B8専用の簡易競合判定を持たない
- constrained CandidateをBeam Search途中Stateへinjectせず、初期Stateから再実行する
- 再実行のたびにconflict resolutionを再対応付けし、元の `conflictKey` を流用しない
- 再対応付けをfull Beam Search実行後ではなくinitial conflict preflightで行い、
  resolution無しのBeam Searchを先に走らせる循環が発生しない
- preflightが `validatePlannerInput` / `validation.validBuildListEntries` /
  `createInitialPlannerSearchState` / initial relevant-entry selection /
  `createPlannerRouteUnitPlans` / `detectPlannerConflicts` の既存Plannerロジック
  だけを使い、B8専用の `usedCounters` 等の簡易判定を持たない
- preflightがraw `BuildListEntry` から初期Stateを作らず、通常Beam Searchと同じ
  validation authorityを共有する
- generated Entryまたはfixed Entryがvalidationで除外された場合にfail closedとなり、
  そのCandidate trialを採用しない
- preflight入力にstaleな旧 `conflictKey` を適用せず、誤った
  `invalid_conflict_resolution` を発生させない
- 元のvalidated PlannerInputの全valid `PlannerConflictResolution` を再対応付け対象と
  し、再検索対象以外のユーザー明示resolutionを黙って捨てない
- 全fixed constraintが一意に対応できた場合だけ完全なresolution配列を再構築し、
  1つでも0件・複数件・fingerprint不一致・validation除外があればfail closedとする
- 競合資源identityが一致しfixed Entryを含むConflictが一意なときだけ、現在の
  `PlanConflict.id` でresolutionを構築する
- 再対応付けが0件または複数件のとき、対応付けを推測せずtrial不採用または競合返却にする
- 共存可能性の最終判定がpreflightではなく完全再実行のBeam Search / Trace Replayである
- `maxPlannerReruns` がfull Beam Searchの実行回数だけを数え、preflightを含めない
- `same_owned_weapon_consumed` の競合資源が独立fieldとして保持され、
  participantの `sourceOwnedWeaponId` で代用されない
- `generatedBuildListEntries` が最終augmented PlannerInputへ採用したEntryだけを含む
- `plan === null` の場合にgenerated Entryを永続化しない
- generated BuildListEntry IDがrandom UUID / Clock / enumeration ordinalへ依存しない
- enumeratorが `ConstrainedCandidate` をyieldし、`BuildCandidate.id` /
  `searchRunId` / `createdAt` を持たない
- materializerが `searchRunId` にdeterministic constrained search identityを設定し、
  `id` をそのidentityとCandidate semantic meaningから安定生成する
- materializerが `checkpointGroups` を抽出し、その値がyield可否・ordering・
  route scope・探索終了・探索範囲・off-axis評価・coexistence判定へ影響しない
- 通常Candidate Searchの `searchRunId` 契約と `BuildCandidate` ID生成規則が
  変更されていない
- 同一入力の再実行で15.9.1のsemantic outcomeが一致し、`ExpectedPlanState` の
  hash完全一致は要求されない
- 各run内で first `expectedStateBefore` が
  `PlanningInputSnapshot.initialExecutionState` と一致し、step Nの
  `expectedStateAfter` が step N+1 の `expectedStateBefore` と一致する
- 連番ID・固定時刻のテストdependency注入時だけ、`ExpectedPlanState` 完全一致を
  追加検証する
- semantic contentが異なるID衝突でfail closedになる
- stale既存Entryを再利用も上書きもせず、新しいEntryを作成する
- Candidate semantic identityにrestoration bonus scopeが含まれる
- generated EntryとProductionPlanが同一transactionで保存され、partial saveが発生しない
- 保存直前validation失敗時に何も書き込まない
- enumeration boundsとorchestration boundsが分離され、Planner専用3 boundsが
  `ConstrainedCandidateSearchInput` へ渡らない
- どちらのboundsも、到達した場合にexhaustionではなく打ち切りとして報告する

### 15.9.1 determinismの範囲

同一入力の再実行に対して要求するのはsemantic outcomeの一致だけである。
「Plan全体が一致する」と読める契約にしてはならない。

#### 一致を要求するもの

```text
generated BuildListEntry ID
selected BuildListEntry の semantic 集合
PlanStep の semantic operation 列と順序
RNG Counter advance / transition semantics
inventory transition semantics
conflicts の semantic outcome
warnings
rejectedBuildListEntries
requiredMaterials
```

#### 一致を要求しないもの

```text
ProductionPlan.id                          (PlannerIdFactory 由来)
PlanStep.id                                (PlannerIdFactory 由来)
予約 OwnedWeapon ID                        (PlannerIdFactory 由来)
createdAt / updatedAt                      (PlannerClock 由来)
PlanningInputSnapshot.createdAt            (PlannerClock 由来)
ExpectedPlanState の hash 値そのもの        (下記)
PlanningInputSnapshot.initialExecutionState の hash 値そのもの
```

**`ExpectedPlanState` のhash完全一致を要求しない。** `ownedWeaponsHash` は
OwnedWeapon IDを含み(11.2 / [DATA_MODEL.md](./DATA_MODEL.md) 11.2)、
`reserve_weapon` の予約OwnedWeapon IDは `PlannerIdFactory` が生成する。したがって通常のProduction dependencyでは、
同じsemantic outcomeでもrunごとに `ownedWeaponsHash` が変わる。
「予約OwnedWeapon IDの一致は不要」と「expectedState hashの一致は必須」は両立しない。
要求するのは上記のinventory transition semanticsとRNG Counter advance /
transition semanticsであり、hash文字列そのものではない。

#### run内で必須のchain validity

hash完全一致をrun間で要求しない代わりに、各run内では既存のchain validityを必須とする。

```text
first expectedStateBefore == PlanningInputSnapshot.initialExecutionState
step N expectedStateAfter == step N+1 expectedStateBefore
```

これは12章の再計算不変条件と14章のExecution Transactionが依存する既存契約であり、
B8で緩めない。run間のhash一致を要求しないことと、run内のchainが閉じていることは
別の要件である。

#### 固定dependencyでの追加検証

`PlannerIdFactory` と `PlannerClock` は本書4章の既存契約どおりruntime dependencyであり、
本番adapterは `crypto.randomUUID()` と現在UTC時刻をラップする。B8はこの契約を変更しない。

連番IDと固定時刻のテストdependencyを注入した場合に限り、`ExpectedPlanState` の
完全一致、`ProductionPlan.id` / `PlanStep.id` / 予約OwnedWeapon IDの一致、
`createdAt` / `updatedAt` の一致を追加で検証してよい。これはProduction契約ではなく、
固定dependency下の追加検証である。

generated BuildListEntry IDの決定性(9.2.13)はこれとは別である。generated Entry IDは
`PlannerIdFactory` を使わず、semantic contentから安定生成するため、Production
dependencyでもrun間で一致する。
