# C5-E2C10 Production Identification Activation

実施日: 2026-09-05

## Status

- C5-E2C7 Wizard UI: completed
- C5-E2C8 real Browser Worker benchmark: completed
  （[C5_E2C8_BROWSER_WORKER_BENCHMARK.md](./C5_E2C8_BROWSER_WORKER_BENCHMARK.md)）
- C5-E2C9 Skill live-game verification: completed
  （[C5_E2C9_SKILL_LIVE_GAME_VERIFICATION.md](./C5_E2C9_SKILL_LIVE_GAME_VERIFICATION.md)）
- C5-E2C10 Production Identification activation: completed

このactivationは以下を変更していない。

```text
PRODUCTION_RNG_ENGINE_VERSION = production-rng:c5-e2
supportsSeedSearch            = false
```

新しいfeature flag、RngEngine capability flag、adapter、抽象化、再配線、
Production RNG semantics、Wizardの Seed range default を追加していない。
Counter Gateは引き続きIdentificationのinput、observation、search dimension、
result、review、adopted fieldのいずれでもない。

「activation completed」はSkill-first Identification Wizardのdefault runtime経路が
Production Worker / Coordinator / Adoptionへ接続され、C8 / C9のblockerが解消済みで、
integrated regressionとbrowser smokeを通過したことを意味する。legacy generic Seed
Search capabilityを有効化したという意味ではない。

## Baseline

```text
branch: main
HEAD:   f2fef71 C5-E2C9 Skill実機検証を追加
Working Tree: clean（引き継ぎ変更なし）
```

## Activation audit

監査結果は **Case A — runtimeはすでにProduction経路へ完全接続済み** である。

C10開始時点で、RNG Setup → Production Coordinator → Production Skill multi-worker /
Gogma Counter Worker → Adoption Service というdefault runtime経路はすでに成立して
いた。behavioral gate、feature flag、development / debug / test限定の分岐、
non-Production adapterへのfallbackはいずれも存在せず、恒久runtime wiringの変更は
不要だった。

一方、Wizard UIにはpre-activation時代の古いstatus文言が2箇所残っていたため、C10
statusに合わせて表示文言のみ更新した。これらはbehavioral gateではない。

| 対象 | 実ファイル / symbol | 結果 |
| --- | --- | --- |
| RNG Setup導線 | `src/pages/RngSetupPage.tsx` `defaultDependencies.createIdentificationCoordinator` | Production。`development` / `debug` / `test` gatingなし。`!masterResult.ok` と未保存フォームのみが開始条件 |
| Route到達性 | `src/App.tsx` `<Route path="rng">`、`src/components/AppLayout.tsx` `/rng` | 通常ナビゲーションから到達可能 |
| Coordinator factory | `createProductionIdentificationWizardCoordinator()` | Production |
| Skill STEP 1 | `createProductionMultiWorkerSkillIdentificationClient()` → `createProductionSkillIdentificationWorkerClient()` → `src/workers/skillIdentification.worker.entry.ts` → `createProductionSkillIdentificationRngEngine()` → `ProductionRngEngine` | Production。Fake / reference-only adapter / `UnavailableRngEngine` へ落ちない |
| Gogma STEP 2 | `createProductionGogmaCounterIdentificationWorkerClient()` → `src/workers/gogmaCounterIdentification.worker.entry.ts` → `ProductionRngEngine` | Production |
| Adoption | `identificationAdoptionService` → `rngStateRepository`（Dexie） | Production |
| Production build | `dist/assets/skillIdentification.worker.entry-*.js` / `dist/assets/gogmaCounterIdentification.worker.entry-*.js` | 生成される。`benchmark.html` は通常buildへ含まれない |

### 残っていたpre-activation表記（behavioral gateではない）

| file | 内容 | 対応 |
| --- | --- | --- |
| `src/components/rng/IdentificationWizardDialog.tsx` | 「このWizardはC7 UI実装段階です。実Browser Worker benchmarkと独立したSkill実機検証は未完了で、Production Identificationは正式activation前です。」 | activation済みstatusと、実機検証済み範囲の限定を述べる文へ置換 |
| `src/components/rng/IdentificationWizardDialog.tsx` | Seed range補足の「C8の実Browser Worker benchmarkで実用defaultを決定するまでは空欄です。」 | C8はdefaultを決定しないと明記済みのため、「Production defaultは設定しません」へ置換。空欄default、明示bounded range入力、自動拡張なしの挙動は不変 |

いずれも表示文言のみで、挙動・契約・依存関係の変更はない。

## Implementation changes

| file | 目的 |
| --- | --- |
| `src/components/rng/IdentificationWizardDialog.tsx` | 上記2件のstatus文言更新（表示のみ） |
| `src/services/rngIdentification/productionIdentificationActivation.test.ts` | 新規。composed Production Identification chainのintegrated regression |
| `AGENTS.md` / `docs/REQUIREMENTS.md` / `docs/RNG_SPEC.md` / `docs/RNG_REFERENCE_AUDIT.md` / `docs/UI_FLOW.md` / C8 / C9記録 | C10 statusの最小更新 |

Production runtimeのwiringコードは変更していない。

## Integrated regression

`src/services/rngIdentification/productionIdentificationActivation.test.ts`。

jsdomは実Browser Workerを起動できないため、置換したのはWorker transportだけで
ある。child clientは同じProduction kernelを `ProductionRngEngine` で実行する。
それ以外は実装そのもの（実multi-worker orchestration、実Coordinator、実Adoption
Service、実Dexie database）である。

| 確認 | 結果 |
| --- | --- |
| STEP 1 が C9 game-verified fixtureで `(51231782, 341)` をunique / non-truncatedに特定 | PASS |
| starting Skill Counterが観測数で加算されない | PASS |
| STEP 1がuniqueになるまでSTEP 2が実行されない（Gogma clientへrequestが届かない） | PASS |
| STEP 2がCoordinator注入のBase Seedを受け取る（UIからの再入力なし） | PASS |
| review が starting Skill / Gogma Counter を保持 | PASS |
| 復元確認前のadoptが拒否され、RngStateが変化しない | PASS |
| 復元確認後のadoptで Base Seed / Skill Counter / Gogma Counter が `source = observation` で更新 | PASS |
| Counter Gate、notes、`createdAt` が保持される | PASS |
| Normal Counter、BuildCandidate、BuildListEntry、ProductionPlanが不変 | PASS |
| child Worker failureが候補0件へ変換されず `unexpected_error` として表面化 | PASS |

STEP 2のobservationはSTEP 1のBase Seed上でProduction Engineから生成した合成入力
であり、live-game Gogma証拠ではない。Gogmaのgame-verified証拠は
`src/test/fixtures/gameVerifiedGogmaVectors.ts` と、その kernel / Worker testが
引き続きauthorityである。current fixtureは2026-09-13（Asia/Tokyo）にuserが
独立採取したBase Seed `51231782`、starting Gogma Counter `55`、Hammer /
Paralysis、six Reset observations、non-truncatedである。Worker Client testは
Fake Workerを使うprotocol testであり、live computation parityのauthorityではない。

## Browser smoke

Repositoryに既存のE2E frameworkは存在しないため、新規導入はしていない。
`npm run dev`（React StrictMode有効）と `npm run build` + `npm run preview` を
実ブラウザで操作した。

| 項目 | dev (5173) | production preview (4173) |
| --- | --- | --- |
| RNG Setup表示 | OK | OK |
| Wizard Open | OK | OK |
| Wizard Close | OK | OK |
| Wizard Reopen | OK（新Coordinator） | OK（新Coordinator） |
| StrictMode早期dispose regression | 再現なし | 対象外（build時はStrictMode二重mountなし） |
| 未保存RNGフォームでWizard開始がblockされる | OK（button disabled + 警告） | 未確認 |
| console error | なし | なし |

`Engine version: production-rng:c5-e2` と `Seed Search capability: 未対応` が
RNG Setupに表示されることも確認した。

Masterデータ利用不可時のWizard開始不可は、`!masterResult.ok` によるbutton disabled
とApp起動時のerror画面としてコード上は成立しているが、browserでは未確認である。

## Real Worker regression

Wizardを開くだけで、Production factoryが実Browser Workerを生成することを
network requestで確認した。

| 環境 | 生成されたWorker |
| --- | --- |
| dev | `src/workers/skillIdentification.worker.entry.ts` ×4、`gogmaCounterIdentification.worker.entry.ts` ×1（Reopenで新たに同数） |
| production preview | `assets/skillIdentification.worker.entry-*.js` ×4、`assets/gogmaCounterIdentification.worker.entry-*.js` ×1 |

Skill Workerは既存契約どおり最大4である。

production previewでは、C9 fixtureの4観測（操虫棍 / 氷、暗器蛸の力・革細工の滑性 /
凍峰竜の反逆・毛皮の誘惑 / 鎖刃竜の飢餓・毛皮の誘惑 / 鎧竜の守護・鱗重ねの工夫）を
Wizard UIへ入力し、Seed range `51,221,782..51,241,782`、概算Skill Counter `341` ±2
（検索範囲 `339..343`）でSTEP 1 Searchを実行した。

```text
progress: 20,001 / 20,001（一致 1件）
classification: 完全な探索で一意に特定できました。
STEP 2: 「STEP 1で一意に特定したBase Seedを内部利用します。Base Seedの再入力は不要です。」
```

Worker creation、engine version整合、request accepted、progress / result path、
STEP 2へのSeed注入が実Production bundleで成立することを確認した。cancel / dispose
pathの実Worker測定はC5-E2C8の記録をauthorityとし、再測定していない。C8の測定値は
更新していない。

## C9 fixture regression

`src/test/fixtures/gameVerifiedSkillVectors.ts` は変更していない。

- `ProductionRngEngine.predictSkills` 4/4 forward parity: PASS
- bounded Identificationで `(51231782, 341)` がunique / non-truncated: PASS
- multi-worker orchestrationで同一結果: PASS
- C10 composed regressionでも同一結果: PASS

## Known limitations

- 実機検証済みのSkill streamは操虫棍 / 氷 / Skill Counter 341-344のみである。
  全weapon、全element、全game versionを証明しない
- Gogma Reset streamのcurrent game-verified証拠は、Hammer / Paralysis、Base Seed
  `51231782`、actual Counter Gate `200`、Gogma Counter 55..60の6連続Reset
  （30 ordered slots）に限定され、全weapon / element / Counterを証明しない
- Normal streamのlive verificationは未実施である
- 実Browser Workerでのcancel / disposeはC8の記録に依存し、C10では再測定していない
- Bow Sharpness/Ammo、LBG/HBG Element、elementless Gogmaのelement bonus、
  栄光の誉れ、祝祭の巡り、Gogma rank I、Counter Gate閾値未満の永続Counter挙動、
  `use_weapon_as_material` によるRNG advancementはいずれもunverifiedのままである
- Wizardの Seed range Production default は引き続き設定しない。100M canonical
  domainは実行しておらず、automatic wideningも追加していない
