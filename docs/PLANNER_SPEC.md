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
- 素材アイテム所持数による作成不能判定
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
}

export interface PlannerWarning {
  kind:
    | "no_build_list_entries"
    | "rng_state_missing"
    | "rng_prediction_unsupported"
    | "rng_engine_capability_missing"
    | "material_rng_advance_unverified"
    | "material_weapon_shortage"
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
  practicalFirstProgressTargetIds: TargetWeaponId[];
  consumedMaterialWeaponCount: number;
  totalCost: number;
  evaluationScore: number;
}
```

探索手順。

1. 現在RNG状態と在庫から初期Stateを作成する
2. 未充足Targetに対する実行可能なBuildListEntryを列挙する
3. 各Entryの `BuildRoute.operations` から、現在の共有RNG状態と在庫で実行可能な次操作を列挙する
4. 同じ共有RNG遷移を要求する複数Entryがあれば、1回の遷移で各Entryのroute progressを進める
5. `count` を持つ操作は実行ナビ用の1操作単位へ分割し、現在Counterまで正常に通過済みのprefixを重複生成しない
6. 操作前提が現在Stateより過去にあり、副作用または必要資源が満たされていないEntryは実行不能とする
7. 実行可能な操作を適用し、共有RNGと在庫を進めた次Stateへ展開する
8. Satisfaction、Route progress、Inventory変化後の現在Stateで、未実行のcurrent / future
   Route unitだけを対象にConflictを再評価する。通過済みRoute prefixを再Conflict化しない
   ConflictResolutionは探索中に同じstable Conflict IDが再検出され、selected Entryがその
   Stateで有効なparticipantである場合だけ適用する
9. 実用品確保、理想品更新、操作数、武器消費、現在Stateで意味のある競合を評価する
10. 同じ深さで評価値の高い上位 `beamWidth` 件だけを残す
11. `maxExpandedStates` または `maxPlanSteps` 到達時に打ち切る
12. 完了Stateのうち最良、完了Stateがなければ最も充足度の高いStateからPlanを生成する

候補確保時の状態遷移。

- Candidate reserveまたはMaterial Gogma消費など、SimulatedInventoryの意味的変更後は、
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
- Practical-first tierはEntry自身のTargetだけでなく、reserve後の再導出で未所持Targetが
  Practical以上になった場合も満たす。複数Targetを満たす1武器は、そのすべてのTargetを
  tier対象へ反映する。
- Practical確保済みでもIdeal未所持なら、そのTargetは理想更新候補として探索に残す

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

`beamWidth = 50`、`maxExpandedStates = 10000` は初期値であり、UI設定ではなく将来調整可能な定数とする。完全最適解は保証せず、実用的な時間内で十分良いPlanを返す。

Planner内部ではBeam Searchの状態評価用にCandidate Scoreを計算する。

```ts
export interface CandidateScore {
  targetPriorityScore: number;
  satisfactionScore: number;
  categoryScore: number;
  distancePenalty: number;
  resourcePenalty: number;
  conflictPenalty: number;
  total: number;
}
```

推奨重み。

```ts
targetPriorityScore = target.priority * 10000
satisfactionScore =
  !state.targetSatisfaction[target.id].hasPractical
    ? 50000
    : candidate.category === "ideal" &&
      !state.targetSatisfaction[target.id].hasIdeal
      ? 20000
      : 0
categoryScore =
  candidate.category === "ideal" ? 20000 :
  10000
distancePenalty = estimatedOperationCount * 100
resourcePenalty = consumedMaterialWeaponCount * 1000
conflictPenalty = conflictCount * 5000
```

制約。

- scoreはBeam Search内の状態比較用であり、単独で採用候補を確定しない
- scoreはPlanner内部の比較用であり、初期版UIで高度なユーザー調整は提供しない
- Debug Modeではscore内訳を表示してよい
- 実用品未所持Targetでは実用候補の価値を高くする
- 実用品未所持TargetをPractical以上へ進める評価を、実用品取得済みTargetのIdeal更新より高くする
- Practical確保後はhasPracticalを維持しつつIdeal候補を評価する
- 理想候補でも、実用品未所持Targetの遠すぎる理想は短距離実用品より後回しになることがある
- `isProtected = true` の武器に対する素材消費・Reset Bonuses・Keep Bonusesはpenaltyではなく実行不能な展開として除外する

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
- 巨戟アーティアのMaterialかつ保護OFF: 素材消費可能
- Practical: 消費しない
- Ideal: 消費しない
- `isProtected = true`: 素材消費・Reset Bonuses・Keep Bonusesへ使用しない
- 所持レア8通常アーティアを巨戟化したStateでは元通常アーティアをInventoryから除き、同じ通常アーティアを二重使用しない
- `owned_normal_artian_to_gogma` ではconvert_normal_to_gogma適用時に元NormalをInventoryから削除し、変換後GogmaはまだOwnedWeaponとして追加しない。以後そのNormal IDは別Routeへ利用できない
- 通常アーティアはstatusを持たず、旧PracticalのMaterial化規則を適用しない

素材用巨戟が不足する場合。

```text
通常アーティア作成
→ 巨戟化
→ create_material_gogma（素材用巨戟として登録）
→ 後続Stepで素材として使用
```

PlannerがCandidate Routeとは別に必要とする一般素材需要は、次のPlanner-only型で管理する。

```ts
export interface PlannerMaterialRequirement {
  id: string;
  sourceBuildListEntryId: BuildListEntryId | null;
  purpose: "route_material_requirement";
}

export interface PlannerMaterialAssignment {
  requirementId: string;
  ownedWeaponId: OwnedWeaponId;
}
```

未確認の武器種、属性、Bonus、素材コスト制約をこの型へ追加しない。利用可能な
Material / unprotected Gogmaを割り当て、不足時だけ補充し、最終Planでは具体的な
`use_weapon_as_material` Stepへ変換する。

`use_weapon_as_material` 単独のRNG進行はunverifiedである。`purpose` は在庫上の素材要求だけを表し、Gogma stream進行を意味しない。現行RngAdvanceはunknown deltaを表現できないため、素材使用後の予測位置がそのRNG効果に依存するProduction Planは、進行契約がgame-verifiedになるまで生成不可とし、0または+1を推測して後続Counterを計算しない。

制約。

- 初期版では素材アイテムの所持数不足はPlan不可理由にしない
- 巨戟アーティア武器の不足はPlanに補充Stepを追加して解決する
- 補充StepでもRNG進行を伴うため、後続候補のCounterと整合させる
- RNG進行は通常アーティア作成と巨戟化の実ゲーム操作Stepで行い、`create_material_gogma` 自体はCounterを進めない
- Plannerは補充武器のOwnedWeaponIdをPlan生成時に予約し、`create_material_gogma.inventoryChange.addOwnedWeapon.id` と後続 `use_weapon_as_material` で同じIDを使ってよい
- 予約武器は `create_material_gogma` 確定前のInventoryへ追加せず、登録前に素材消費・Reset Bonuses・Keep Bonusesの起点として使わない
- Candidate Searchが生成した `UseWeaponAsMaterialOperation.ownedWeaponId` は検索時点の具体的既存武器を要求するため、Plannerは別IDへ差し替えない
- Planner-only素材需要、補充、登録、消費、旧Practical素材化、reserveはBuildRouteを書き換えず、Planner-only Stepとして追加する
- protected武器への素材消費・Reset Bonuses・Keep Bonusesが必要な探索展開は生成せず、該当BuildListEntryを不採用として理由を残す
- Search後に起点武器がprotectedへ変わった場合、素材消費・Reset Bonuses・Keep Bonusesを必要とするEntryはPlanner入力validationで実行不能とする。Reset SkillsのみのEntryは実行可能とする
- v1では、Plannerは同一TargetのIdeal武器を先に確保できる場合だけ、旧Practical武器の確認付き素材化Stepを探索へ追加してよい
- 素材化Stepを予定することは許可するが、ユーザー確認前に `isProtected` または `status` を変更しない
- 素材化Stepが確認された後のStateでのみ、その武器を後続の素材消費へ割り当てる
- 別のPractical武器を確保したことだけを理由に旧Practical武器の素材化展開を生成しない。Practical同士の優劣判定は将来仕様とする

旧実用品の素材化に必要な探索条件。

- 対象武器は現在 `status = "practical" AND isProtected = true`
- 同じTargetのIdeal武器を確保済み、または同一Plan内の先行Stepで確保する
- 素材化後も、そのTargetの `hasIdeal = true` を満たす別のOwnedWeaponが残る
- 後続Stepで素材として使う合理的な必要性がある
- `change_owned_weapon_status` Stepを素材消費Stepより前に配置する
- この素材化はCandidate Searchがprotected武器を起点に破壊的Routeを生成することを許可するものではなく、Plannerが後続の一般素材不足を解消する在庫操作として追加する

---

## 9. 競合検出

同じRNG位置または同じ資源を同時に必要とする候補を競合として扱う。

競合種別は `DATA_MODEL.md` の `ConflictKind` を使用する。

検出条件。

- 同じGogma Counter位置で同時取得できない候補
- 同じSkill Counter位置で同時取得できない候補
- 同じ通常アーティアCounter位置で同時取得できない候補
- 同じOwnedWeaponを素材または起点として排他的に消費する候補

解決方針。

1. Target priorityが高い候補
2. 実用品未所持Targetの候補
3. ideal候補
4. 見送った場合の次候補までの距離が遠い候補
5. 武器消費が少ない候補
6. 操作量が少ない候補

ユーザー選択が必要な場合。

- score差が小さい
- どちらも高優先度Targetの初回実用品

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

protected武器への素材消費・Reset Bonuses・Keep Bonusesは競合として解決せず、常に実行不能として `requires_protected_weapon` の不採用理由を付ける。確認付き素材化Stepが先行し、期待状態どおりMaterial / unprotectedへ変わった後の素材消費はこの禁止に該当しない。

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
初回検索で先読みしない。初回検索はcanonical Idealを1件確定し、その
`estimatedOperationCount = D` 以下で到達可能なPracticalの評価も確定した時点で終了する
([SEARCH_SPEC.md](./SEARCH_SPEC.md) 5.6参照)。

複数Target間でCounter競合が実際に発生した場合にだけ、Plannerが必要に応じて次を調べる。

- 競合したTargetの再検索
- 一方を優先した場合の他方の次のPractical / Ideal
- どちらを優先するとどの程度遠くなるか

## 9.2 Planner-driven constrained re-search

B8-Aで正式契約を確定した。実装はB8-B1以降で行う。

- 9.2.1〜9.2.5はB0で固定した責務と禁止事項であり、B8-Aでも変更しない
- 9.2.6以降がB8-Aで追加した正式契約である
- 9.2.4のwhat-if比較はB9、競合UIはB10であり、B8では実装しない

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
実行可能 -> next Practical / Ideal として採用
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
ならない。素材消費のOwnedWeaponは起点武器と一致するとは限らず、participantごとに
異なり得るため、participant単位のfieldから競合資源を復元できない。

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
    次に実行可能なPractical  +3
    次に実行可能なIdeal      +47

Target Bを優先した場合
  Target A:
    次に実行可能なPractical  +8
    次に実行可能なIdeal      +12
```

契約。

- 一方を固定したPlanner制約下で、他方の次に実行可能なPractical / Idealまでの距離を求める
- 「競合Counter以降のIdealだけ」を探す仕様にしない。競合位置より前のPracticalも、
  固定Candidateと共同実行可能なら候補である
- 距離の表現は既存の `estimatedGogmaAdvance` / `estimatedSkillAdvance` /
  `estimatedNormalAdvance` と `estimatedOperationCount` を用いる

what-if比較はB9で実装する。B8では実装しない。B8のorchestrationは、B9が明示的な
仮想fixed constraintを渡せる形へ将来拡張してよいが、B8でB9の機能を先取りしない。

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
`searchRunId` / `createdAt` / `isSimilarToIdeal` を必須とするが、
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
  `searchRunId` / `routeFilter` / `resultFilter` / `settings` を持たせない
- constrained re-searchは過去のUI一時filterを継承しない。route scopeは現時点で
  成立する全Search routeとし、`resultFilter`、similar filter、
  `maxCandidatesPerTarget` を適用しない。探索範囲の上限は
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

similarityScore
  = 既存Similarity計算式 ([SEARCH_SPEC.md](./SEARCH_SPEC.md) 5.3)

isSimilarToIdeal
  = 現行B6既定similarity threshold 0.6 を使って算出
```

`0.6` は表示メタデータ `isSimilarToIdeal` を埋めるためだけに使う。次には使用しない。

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

どちらのboundsも、到達した場合は打ち切りをenumeration summaryまたはwarningとして
明示する。bound到達を無言でexhaustionとして扱わない。

### 9.2.17 B8のtask分割とCompatibility

```text
B8-A   Spec / DTO / API / persistence contract           (本節)
B8-B1  Search-domain constrained candidate enumerator
       enumeration boundsはcaller必須指定
B8-B2  enumerator側の実Browser Worker benchmark
       enumeration boundsのProduction default決定
B8-C   Planner conflict orchestration / deterministic materializer /
       augmented-input full rerun / Conflict Resolution再対応付け
       orchestration boundsはcaller必須指定のまま
B8-D   Worker / Application / Persistence / atomic save /
       既存UIへの最小配線
B8-E   orchestration側のBrowser / Planner benchmark
       orchestration boundsのProduction default決定
```

boundsのProduction defaultはB8-B2とB8-Eの2回に分けて決定する。orchestration
boundsはPlanner再実行の実コストに依存し、B8-C / B8-D実装前には測定できないためである。

B9 what-if、B10 Conflict UI、B11 normal-scope Keepは別Phaseとする。

B8 architecture自体は次を変更しない。

```text
CURRENT_CALCULATION_APP_SCHEMA_VERSION = 2
DATABASE_SCHEMA_VERSION = 1
AppSettings.schemaVersion = 1
PRODUCTION_RNG_ENGINE_VERSION = production-rng:c5-e2
supportsSeedSearch = false
```

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
10. 必要に応じて素材用巨戟補充Stepを追加
11. CandidateのBuildRoute.operationsを変更せずRouteOperation列からPlanStep列を生成し、Planner-only Stepを別に挿入する
12. 各PlanStepの期待状態Before / Afterを計算
13. requiredMaterialsを集計
14. ProductionPlanを返す

制約。

- PlanStepの `order` は1始まりの連番
- PlanStepは実行ナビで1つずつ確認できる粒度にする
- 高速モード用のまとめStepは作らない
- Plan生成時点では実際のDBを更新しない。保存は呼び出し側Repositoryが行う
- Beam Searchの打切り時は到達した上限に応じて `max_steps_reached` / `max_expanded_states_reached` を返す
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
  RNG source/notes、観測表示項目、legacy `counterGate` は除く。関連Target IDはsort/dedupeする。
- `ExpectedPlanState.ownedWeaponsHash` とBuild Listの`referencedOwnedWeaponsHash`は別契約である。
  前者はNormal rarityとrelatedTargetWeaponIdsを含むが、後者は既存Search契約どおり両方を
  含めない。両者ともname、memo、timestampsを含めない。
- 1 Search Actionは、共有されるEntry数にかかわらず1 physical operation、1 Draftである。
  Draftはprimary Entryと全progressed Entryを別々に保持する。
- Replay RuntimeはRngState、Normal Counter、persistent OwnedWeapon Inventoryと、未登録の
  Normal/Gogma出力を保持する。Normal出力はEntryごとに分離し、複数作成後のconvertは
  そのEntryの最後に作成したNormalだけを使用して全Normal transientを破棄する。未登録出力へ
  永続OwnedWeapon IDを割り当てない。
- CreateNormalArtianOperationは `count = forgeCount` をReplayし、`normalCounterAfter = normalCounterBefore + forgeCount` を検証する。convert対象は最後の結果であり、その位置は `candidateCounter = normalCounterBefore + forgeCount - 1` である
- 各Actionの`rngBefore`一致を検証し、`rngAfter`との差分からRngAdvanceを作る。複数Normal
  Counterの変化やunknown→knownの差分は現行RngAdvanceで表せないためReplay failureとする。
- create/reset/keep/reset-skillsは現在のRngEngine predictionを再実行する。KeepはReplay時点のtransientまたは起点武器の現在5slotをslot順のまま入力し、selection branchを持たない。
- Replayは各Predictionの直前にも同じsemantic inputで `getPredictionSupport()` を確認する。
  既知unsupportedがpreflight後の実stateで判明した場合は該当BuildListEntryだけを除外して
  Beam Searchを再実行する。support query例外とsupport=true後のPrediction例外は
  `prediction_failed` 等へ変換せず呼出元へ伝播する。
- convertはGogma Predictionを呼ばない。変換元Normalの `normal_artian` scope 5-slot bonusesをslot順のままtransient Gogmaへ継承し、現在Skill位置で `predictSkills` を実行して初回Series / Groupを設定する。
- convertのRNG遷移はSkill Counter `+1`、Normal / Gogma Counter `+0` とする。変換時のSkill結果を無視するRouteや素材補充でも、実ゲームでconversionする限り同じSkill位置を消費する。
- Reset / Keepはtransient Gogmaのscopeとslot順を追跡する。normal scopeならv1は最初のBonus amendmentとしてResetだけを許可し、Reset結果でgogma scopeへ置き換えた後に限りKeepを許可する。これはProduction prediction supportの制限であり、ゲームルール上の制限ではない([SEARCH_SPEC.md](./SEARCH_SPEC.md) 5.7参照)。
- reserve前にEntry固有transient Gogmaのbonuses、Series Skill、Group SkillがCandidate Snapshotと
  完全一致することを検証する。不一致またはtransient不足はReplay failureであり、Candidate Snapshotで
  transientを上書きしてはならない。成功したEntryのtransientだけを破棄する。
- Predictionはvalueだけでなく、そのOperationが実際に依存するconfirmed入力を要求する。conversionとReset SkillsはBase Seed / Skill Counter、Reset / KeepはBase Seed / Gogma Counter、forgeはBase Seed / 対象Normal Counterを要求する。persisted exact GateはどのProduction Replay operationでも要求せず、Production forward runtimeと同じoperation別active representativeを使用する。Routeが使わないstreamの未確定値をReplay failureにしない。
- reset/keep/reset-skillsによるpersistent inventory更新はreserveまで行わない。所持Normalはconvertで
  削除し、new/owned-Normal reserveは予約済みIDのGogmaを追加、existing Gogma reserveは同一IDを更新する。
- Replay完了時はRNG、Normal Counter、persistent simulated inventoryがbest Search Stateと一致しなければ
  Draftを返さない。confirm_result、一般素材Gogma補充、create_material_gogma、ProductionPlan、ID/Clock生成は第9C-Aの対象外である。


### 11.0-B 第9C-B: ProductionPlan組み立て

`createProductionPlan(input, dependencies, options)` はBeam Searchと9C-A Replayを再実装せず、
次の順でDraft ProductionPlanを組み立てる。

1. `runPlannerBeamSearch` を実行する。
2. `bestState` がnullならPlanを作らず、Beam Searchのconflicts / warningsをそのまま返す。
3. `bestState.trace` が空なら（初期状態ですべての有効TargetがIdealを満たす場合を含む）空Planを作らず `plan = null` とする。
4. `replayPlannerSearchTrace(input, bestState, dependencies.rngEngine)` を実行する。Replay failureはwarningへ変換せず、issue code / message / actionIndexを含むPlanner内部エラーとして失敗させる。
5. Replayが成功したDraftを順序を変えずにPlanStepへ1対1で変換する。
6. PlanningInputSnapshot、採用/不採用Entry、素材表示、ProductionPlanを作る。

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

StepはReplay時系列のままorder 1から連番にし、初期状態を未完了とする。最初の
`expectedStateBefore`はbase snapshotのinitialExecutionStateと一致し、各隣接Stepの
`expectedStateAfter` / `expectedStateBefore`が連鎖しなければ内部エラーとする。今回の対象
operationはすべて`requiresUserConfirmation = true`とする。`confirm_result`を自動追加しない。

title / instructionはoperation typeと、存在する場合だけTarget名から決定的に生成する。未確認の
ゲームUI名、ボタン、座標、画面遷移を文言へ推測してはならない。

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
`candidate_already_satisfied`による`already_satisfied`、同一Target・同一categoryで短い採用Routeが
ある`longer_route`を使う。これらを証明できない場合だけ
`dominated_by_better_candidate`を使う。stale / CalculationContext / capability等のvalidation除外は
このunionへ押し込まず、既存warning/validation結果の責務とする。

`requiredMaterials`はselected BuildListEntryの`candidateSnapshot.requiredMaterials`だけを
materialIdごとに合算し、materialId辞書順で返す。master materialCostsからの再推測はしない。
shared physical actionとCandidate別requiredMaterialsの二重計上は既知の未解決境界である。Candidate単位の
total requiredMaterialsをphysical action単位へ安全に分解する契約がないため、第9C-Bではmasterからの
再計算、Entry数での除算、補正式の追加を行わない。

上限到達時でもtraceが1件以上あるbest partial Stateは、その到達点までのDraft Planとして返して
既存warningを維持する。一般素材Gogma補充、`create_material_gogma`、
`change_owned_weapon_status`、Execution、Invalidation、Undo、Worker契約追加、Dexie保存は
第9C-Bでは生成・実装しない。
BuildCandidateの `BuildRoute.operations` を順にPlanStepへ変換する。Route kindやCounter endpointだけから操作列を再構成しない。

基本変換。

```text
CreateNormalArtianOperation -> create_normal_artian
ConvertToGogmaOperation    -> convert_normal_to_gogma
ResetBonusesOperation      -> reset_bonuses
KeepBonusesOperation       -> keep_bonuses
ResetSkillsOperation       -> reset_skills
UseWeaponAsMaterialOperation -> use_weapon_as_material
```

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
Ideal候補はstatus Ideal、Practical候補はstatus Practicalとし、いずれもprotectedとする。
`relatedTargetWeaponIds` へTarget IDを重複なく追加する。

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
`sourceOwnedWeaponId` と同じOwnedGogmaArtianWeaponを更新する。Candidate結果、categoryに
対応するstatus、`isProtected = true`、Target参照を反映し、既存Target参照は失わない。

## 11.4 既存巨戟 Reset Skills

```text
1. reset_skills
2. confirm_result または reserve_weapon
```

起点OwnedWeaponのrestorationBonusScopeと復元ボーナス5枠を変更せず、Skill CounterとSkill Prediction結果だけを反映する。Reset Skillsは非破壊操作として扱うため、protectedなPractical / Ideal武器も起点にできる。

`reserve_weapon` では同じIDのseriesSkillId、groupSkillId、status、isProtected、
relatedTargetWeaponIds、updatedAtを更新し、復元ボーナスとcreatedAtを維持する。

## 11.5 既存巨戟 Keep Bonuses

```text
1. keep_bonuses
2. reset_skills または confirm_result
3. reserve_weapon
```

起点は `restorationBonusScope = "gogma_artian"` でなければならない。Keepはcurrent 5slotのfamilyをslotごとに保持する単一操作であり、selection別のPlanStepを生成しない。

## 11.6 素材補充

```text
1. create_normal_artian
2. convert_normal_to_gogma
3. create_material_gogma
4. 必要になった位置で use_weapon_as_material
```

素材補充でもconversionは実ゲーム操作であるため、通常5枠を継承して初回Skillを予測し、Normalは必要forge数、Skillは1、Gogmaは0進める。素材用途でSkill結果を評価対象にしない場合でもSkill Counter消費を省略しない。

`create_material_gogma` は作成済み巨戟をツールのOwnedWeapon Inventoryへ登録するPlanner-only PlanStepであり、RouteOperationまたは追加の巨戟化ではない。

- `targetWeaponId = null`
- `buildListEntryId = null`
- `candidateId = null`
- `ownedWeaponId` はPlan生成時に予約した追加予定Material OwnedWeapon ID
- `requiresUserConfirmation = true`
- `inventoryChange.addOwnedWeapon` は同じIDの `kind = "gogma"`、`status = "material"`、`isProtected = false` の武器
- 復元ボーナス、Series Skill、Group Skillは直前の予測／実結果を保持する
- `rngAdvance` はGogma / Skill / Normalすべて0
- `expectedStateBefore` では予約武器は未登録、`expectedStateAfter.ownedWeaponsHash` では登録済み

`ExpectedResult` を保持する場合は、直前結果の復元ボーナスとSkillを設定し、`candidateCategory = null`、`isSimilarToIdeal = false`、`shouldSecure = true` とする。Target候補として扱わない。

`create_material_gogma` は、既存PracticalをMaterial / unprotectedへ変更する `change_owned_weapon_status` と、TargetのPractical / Ideal候補を確保する `reserve_weapon` のどちらにも流用しない。予約IDはBuildRoute内の未来武器参照ではなく、ProductionPlan内で登録Stepと後続消費Stepを結ぶためだけに使う。

## 11.7 旧実用品の素材化

同一TargetのIdeal武器の確保後に旧Practical武器を後続素材へ使うPlanでは、次のStepを生成できる。

```text
1. reserve_weapon（同一TargetのIdeal武器）
2. change_owned_weapon_status（旧実用品）
3. use_weapon_as_material（変更後の旧実用品）
```

`change_owned_weapon_status` Stepの契約。

- `requiresUserConfirmation = true`
- expectedStateBefore: 旧実用品がPractical / protected
- 予定どおり「素材用に変更」: Material / unprotectedへ更新し、expectedStateAfter一致としてPlanを継続
- 「保管」: 状態を変更せず、expectedStateAfter不一致としてPlanをstaleにする
- ユーザー操作前に状態変更を適用しない
- 確認結果をExecutionHistoryへ保存する

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
- 予定された素材化に対して「保管」を選び、`planned_status_change_declined` が記録された

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
- 実用品所持Targetでは理想候補が後回しになる
- Practical候補確保でhasPracticalだけがtrueになる
- Ideal候補確保でhasPracticalとhasIdealがtrueになる
- Practical確保後もIdeal未所持Targetが理想更新候補として残る

## 15.2 Score Test

- priorityが高いTargetの候補が優先される
- 実用品未所持Targetの実用候補が優先される
- 遠すぎる理想より近い実用品が優先される
- Candidate ScoreがBeam Searchの状態評価に使われ、単純Score順でPlanが確定しない

## 15.3 Beam Search Test

- 共有Gogma / Skill Counterを進める複数候補を単独Score順より少ない操作で組み合わせられる
- 複数Routeの共有RNG prefixを重複実行せず、各Entryのroute progressが進む
- `beamWidth` を超えたStateが評価順に枝刈りされる
- `maxExpandedStates` 到達時に探索を停止してwarningを返す
- `maxPlanSteps` と `maxExpandedStates` のwarning kindを区別する
- 同じ入力と同じ定数から決定的なPlanが生成される
- 同じEngine fixture、ID Factory、ClockでもID、時刻、予約素材IDを含め決定的になる
- offset kのNormal候補が `forgeCount = k + 1` だけNormalを進め、最後の1本だけのconversionでSkillを1進め、Gogmaを進めない
- create operationの `normalCounterAfter = normalCounterBefore + forgeCount` と、採用候補位置 `normalCounterBefore + forgeCount - 1` を混同しない
- 完全最適解を要求せず、探索上限内の最良Stateを返す

## 15.4 Inventory Test

- Material武器を消費できる
- Practical / Ideal武器を消費しない
- `isProtected = true` の武器を素材消費・Reset Bonuses・Keep Bonusesへ使う探索展開を生成しない
- `isProtected = true` のPractical / Ideal武器でもReset Skillsのみの探索展開を生成できる
- 素材消費・Reset Bonuses・Keep Bonusesで保護武器を必要とするEntryは `requires_protected_weapon` で不採用になる
- 素材用巨戟不足時に補充Stepが追加される
- `create_material_gogma` が予約IDと同じunprotected Material Gogmaを追加し、RNGを進めない
- 予約素材武器を登録Step前に使用せず、登録後も二重消費しない
- 消費済み武器を再利用しない
- 同一TargetのIdeal確保後に確認必須のchange_owned_weapon_status Stepを生成できる
- 別のPractical確保だけを理由にchange_owned_weapon_status Stepを生成しない
- 素材化確認後だけ旧実用品を後続素材へ使用できる

## 15.5 Conflict Test

- 同じRNG位置の候補を競合にする
- conversionを同じSkill Counter位置の競合にし、同じGogma Counter位置の競合にしない
- 同じOwnedWeapon消費を競合にする
- 推奨候補が優先順位どおり決まる
- ユーザー選択が必要な競合を検出できる
- PlanConflictの参照がBuildListEntry ID基準である
- RejectedBuildListEntryの参照がBuildListEntry ID基準である

Planner-driven constrained re-search実装後に追加する観点。

- 再検索の開始位置を `conflictingCounter + 1` へ固定せず、競合位置より前のPracticalも候補になる
- 同一Counter位置でもshareableなoperationを持つCandidateを除外しない
- 固定Candidateと共存不能なCandidateを順次読み飛ばし、共存可能なものをnext Practical / Idealとして採用する
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
- protected武器のReset Skills Routeを `requires_protected_weapon` として誤って不採用にしない
- 各PlanStepにexpectedStateBefore / Afterが設定される
- BuildListEntry IDとCalculationContextがPlanへ保存される
- Candidate由来PlanStepの主参照がBuildListEntry IDである
- `recalculate_plan` PlanStepを生成しない
- Route別reserve_weaponのadd / remove / update契約が守られる
- Planner-only未来素材IDが登録前に使われず、BuildRouteへ入らない

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
- 予定どおり素材化してexpectedStateAfterと一致する場合はstaleにならない
- 素材化予定に対して「保管」を選ぶとstaleになる

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
  成立する全Routeになり、`resultFilter` / similar filter /
  `maxCandidatesPerTarget` を適用しない
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
- `isSimilarToIdeal` がthreshold 0.6で算出され、その値がyield可否・ordering・
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
`reserve_weapon` と `create_material_gogma` の予約OwnedWeapon IDは
`PlannerIdFactory` が生成する。したがって通常のProduction dependencyでは、
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
