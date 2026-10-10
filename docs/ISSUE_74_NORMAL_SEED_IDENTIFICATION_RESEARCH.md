# Issue #74 Phase 1：通常アーティア観測からのBase Seed特定 調査記録

実施日: 2026-10-10

対象Issue: [#74 BaseSeedの特定について、通常アーティアからも特定できるようにしたい](https://github.com/nekono-lazy/GogmaArtianPlanner/issues/74)

## Status

- Phase 1（探索方式の成立性・性能調査）: completed
- この文書は**調査記録（design record）であり、仕様authorityではない**。`docs/REQUIREMENTS.md`、`docs/RNG_SPEC.md`（特に9.7 / 9.12）、`docs/UI_FLOW.md` 5.4 / 6は変更していない。RNG_SPEC 9.1の「Seed候補を汎用的に検索する契約はcurrent specificationに存在しない。Base Seedの特定は9.7のSkill Identificationだけが行う」は引き続き現行仕様である
- 追加したのはResearch専用コード `src/research/issue74/` だけである。Production実行経路（app / components / db / domain / services / stores / workers / pages / presentation / data）はこれを一切importしない（`normalSeedIdentificationResearch.test.ts` のisolation testで固定）
- Production RNG semantics、`PRODUCTION_RNG_ENGINE_VERSION`（`production-rng:c5-e7`）、`CURRENT_CALCULATION_APP_SCHEMA_VERSION`、`DATABASE_SCHEMA_VERSION`、`ExportRoot.schemaVersion`、既存Normal Counter Identification kernel（`identifyNormalArtianCounter()`）は変更していない
- Production向けSeed Identification API、Worker、UI、Persistence更新は実装していない

## 1. 結論（要約）

1. **全域探索は実用範囲に入る見込みが高い。** 既存Production primitive（Normal seed導出・100回初期化・10-step block・pool step）だけを使い、観測を「slotごとの `raw % poolLength === observedIndex` 制約」へ**厳密に**変換した方式B（3.2）は、Base Seed `0..99,999,999` × 開始Counter `0..500` を**単一スレッド約18分（外挿）**で完全探索できる計算量になった。4 Worker並列なら約4.5〜6分（さらに外挿、6章）。Counter `0..100` なら単一スレッド約4分、`0..0` なら約22秒（いずれも外挿）
2. **方式A（既存kernelをSeedごとに呼ぶ単純拡張）は実用的でない。** 0..500で単一スレッド約4.5〜5.4時間（外挿）。ただしPhase 1では正しさのbaselineとして使い、方式Bと完全一致することを確認した
3. **候補数は観測の情報量だけで決まり、一様乱数モデルの期待値と実測が一致した**（5章）。0..500の全域で一意性を期待するには、通常アーティアの観測が概ね**近接Table A系で4〜5本、Table B / ボウガン / 弓Table A系で5〜6本、弓Table Bで8〜9本**必要になる。Base Seed既知の現行Counter特定（2観測程度で一意）より観測本数がかなり多い
4. **正しさ:** 方式Bは候補を推測で削らない完全探索であり、Production `predictNormalArtian()`、既存Counter kernel、Production PRNG / 初期化 / seed導出 / pool stepのそれぞれとbit単位・結果単位で一致することをテストで固定した（4章）
5. **Production化の主要課題はアルゴリズムではなく、観測本数の多さ（UX）、1観測時の巨大な候補集合（メモリ上限）、Base Seed変更時の既存確定値との整合（仕様判断）である**（7・8章）

## 2. 現在の通常Counter Identificationの構造

`src/domain/rng/identification/normalArtianCounterIdentification.ts`（RNG_SPEC 9.12）。

| 段階 | 処理 | Base Seed依存 |
|---|---|---|
| validation | canonical Seed、rarity 8、Counter range、観測5枠、`maxMatches` | 入力のみ |
| support判定 | `engine.capabilities.supportsNormalArtianPrediction` と `getPredictionSupport()`（table classごと） | なし |
| 観測compile | `referenceNormalIdFromRestorationBonus()` でreference lottery IDへ変換、`requireProducibleByPool()` でpool membership / `maximumOccurrences` を検査 | なし |
| PRNG位置決め | `deriveNormalArtianSeed(B, W, 8)` → `initializeReferencePrng()` → `compileReferencePrngJump(start * 10)` → `applyReferencePrngJump()` | **あり** |
| walk | Counterごとに `rawForgeValues()`（5 step）→ `selectReferenceNormalLotteryIdsFromRawValues()` → 観測と比較、`advance(10)` | **あり** |

性質。

- Normal seedは `toUint32(toUint32(B + 1000·W + 7) ^ 0x00ac9365)`（`seedDerivation.ts`、Wはreference weapon type、7は内部rarity）。**属性は入らない**。武器種固定なら `B ↦ seed` は単射であり、Base Seedの異なる2候補が同じNormal streamになることはない
- 1 Counter = 10-step block。1回のforgeはblockの先頭5 wordだけを使う
- Table A / Bはpoolの選択だけであり、Counter streamを分けない（観測 `i` は常に `C + i`）
- PRNG（xorshift系）はGF(2)線形、初期化（100回のseed mixing、`MIX_CONSTANT >>> (s & 3)` を含む）は**Seedに対して非線形**

## 3. 検討したアルゴリズムと計算量

記号: `S` = Seed候補数（全域1億）、`R` = 開始Counter候補数（0..500なら501）、`k` = 観測数。

### 3.1 方式A：既存kernelの直接拡張（baseline）

`identifyNormalSeedAndCounterWithCounterKernel()`。既存 `identifyNormalArtianCounter()` を**無変更のまま**Seed候補ごとに呼ぶ。

- 計算量 `O(S × (V + J + R × 15))`。`V` はSeedごとに繰り返されるvalidation / compile、`J` はCounter開始位置のjump compile（開始Counterが0以外ならSeedごとに128×128のGF(2)行列合成を繰り返す）、Counterごとに15 step（5 step + 10 step）とobject allocation付きのpool step
- 実装は最も単純で、正しさのbaselineとして使える
- Seedごとに `await` するasync呼び出しになる

### 3.2 方式B：compiled slot制約 + 非allocation walk（採用候補）

`identifyNormalSeedAndCounterCompiled()`。Production primitiveの意味を変えずに、次の4点だけを最適化した。

1. **観測の厳密compile（早期除外の基礎）。** 1つの観測について、各slotで「そのslotが観測どおりのcandidateを引いた」という前提を置くと、次slotのpool状態（残りcandidateと長さ）は観測prefixだけから一意に決まる（pool内のreference IDは一意）。したがって「pool stepの結果が観測と一致する」⇔「全slotで `raw_k % len_k === idx_k`」が成り立つ。これはheuristicではなく同値変換であり、pool membership / `maximumOccurrences` 違反の観測はどこかのslotでidxが定義できず `invalid_input` になる（既存 `requireProducibleByPool()` と同じ2条件）。同値性はProduction `selectReferenceNormalLotteryIdsFromRawValues()` との差分testで全14武器種 × 2 table classについて確認した
2. **観測1をwalkの10 stepに融合。** 各Counterのblockを1回だけstepし、その途中の5 wordで観測1の5 slotを判定する（最初の不一致以降は剰余計算を省略）。観測1が5 slotとも一致した（Counter数の約1/243〜1/1024、弓Table Bは約1/32）ときだけ、次blockの状態から観測2..kを私的コピーで判定する。**判定のために同じblockを2度stepしない**
3. **非allocation int32 walk。** PRNG状態をint32 localで保持し、1 stepごとのobject生成をなくした。Production `nextReferencePrngState()` と同一の式であることを差分testで確認した
4. **Seedごとの固定費の削減。** Normal seed導出は `derive(B) = (B + term) ^ salt` であり、`term` をProduction関数自身から `derive(0) ^ salt` として読み出す（再encodeしない）。100回初期化はint32 localで行う。いずれもProduction関数とbit一致を確認した。開始Counterのjump行列は1回だけcompileし、Seedごとには適用（`applyReferencePrngJump()`、約0.3µs）だけを行う

計算量 `O(S × (I + J_apply + 10R))`（`I` は100回初期化）。PRNG step数の下限は「各Seedで最後の開始Counterの観測1 blockまで進む」`≈ 10R` であり、方式Bは逐次walkとしてこの下限にほぼ到達している。観測数 `k` は計算時間にほぼ影響しない（6.2）。

### 3.3 検討したが採用しなかった方式

| 方式 | 内容 | 判断 |
|---|---|---|
| 観測から内部状態を逆算 | pool長4（近接Table A、Switch Axe）や2（弓Table B）のslotは `w` の下位bitでありPRNG状態に対してGF(2)線形だが、長さ3のpool（ボウガン、近接Table B、弓Table A）は `w mod 3` で非線形。またpool removal後は長さが変わる。仮に線形制約で128-bit状態を絞れても、状態→Seedは非線形な100回初期化の逆像問題になり、結局Seedを列挙して初期化する必要がある | 不採用。全域列挙より安くなる経路が見つからない |
| Counterごとの線形汎関数で判定 | `w_{10C+1}` の下位2bitを `T^(10C+1)` の行と初期状態の内積で直接計算 | 不採用。2bitの内積（128bit AND + popcount × 2）は10 stepと同程度以上のコストで、長さ3のpoolには使えない |
| jumpで5 stepを飛ばす | block後半5 stepをjump演算子で飛ばす | 不採用。jump適用（約0.3µs）は5 step（約10ns）より遥かに高価 |
| bit-slicing / WASM SIMD | 32 Seed分を1 wordで並列step、またはu32x4で4 Seed並列 | Phase 1では未実装。剰余3の判定がbit-slicingと相性が悪い。WASM SIMDは2〜4倍の余地があり得るが、build構成の追加を伴う。次Phaseで必要になった場合の選択肢として残す |
| 開始Counterを0と仮定 | 探索空間を1/501にする | 不採用（ユーザーが保証しない限り）。0..0は**ユーザーが明示指定した場合だけ**の高速経路として扱う（3.4） |
| 実機未検証の仮定による候補削除 | 未確認のRNG仕様でSeed / Counterを除外 | 不採用。方式Bは指定範囲の全(Seed, Counter)を評価する |

### 3.4 探索空間の縮小（Counter範囲の比較）

方式Bのコストは `I + J + 10R` にほぼ比例する（6.2の実測）。

| Counter範囲 | R | 単一スレッド全域（外挿） | 全域の(Seed, Counter)組 |
|---|---:|---:|---:|
| 0..0 | 1 | 約22秒 | 1.0億 |
| 0..10 | 11 | 約42秒 | 11億 |
| 0..100 | 101 | 約3.8分 | 101億 |
| 0..500 | 501 | 約18分 | 501億 |
| 0..1000 | 1001 | 約36分 | 1001億 |

- Counterが既知（例: その武器種の通常アーティアを1本も作成していないと**ユーザーが保証できる**）なら `0..0` を指定でき、探索は数十秒・必要観測数も少なくなる。保証できない場合に勝手に0として扱ってはならない
- 開始Counterが0以外の狭い範囲（例 400..500）はjump適用の固定費が加わるだけで、0..100とほぼ同じコストだった（6.2）

## 4. 小規模の正しさ検証

すべて `src/research/issue74/normalSeedIdentificationResearch.test.ts`（通常の `npm test` / CIで実行される、合計約0.5秒）。

### 4.1 使用したgame-verified fixture

`src/test/fixtures/gameVerifiedNormalVectors.ts`、Base Seed `51231782`。

| 用途 | fixture | 性質 |
|---|---|---|
| 非0開始Counter、観測数、観測順序 | Heavy Bowgun Fire Counter 4 / 5 / 6 | 実機の連続forge（同一セッション） |
| Table A → B の実連続 | Switch Axe Fire Counter 0 → none Counter 1 | 実機でreloadなしに連続forge（14.16） |
| 弓Table A / B混在 | 弓 Fire C0 / none C1 / Fire C2 | **各行は実機観測だが、3行は別セッションで観測した行の合成**（各Counter位置の結果は決定的なので連続観測列として有効だが、1回の連続forgeそのものではない） |
| 2観測、近接pool | Long Sword Fire C0..C2 | 実機観測 |

### 4.2 確認した観点

| 観点 | 結果 |
|---|---|
| 既知Seed + 既知Counterが結果に含まれる | HBG 3観測、Seed `51231782 ± 2000`、Counter 0..20で `(51231782, 4)` が**唯一**の結果（unique, non-truncated） |
| 開始Counterが0以外 | 上記（Counter 4）。Counter range `3..9` でも方式A / Bが一致 |
| 観測数による絞り込み | 同条件で観測1 → 2 → 3と候補が単調に減少し（後の結果は前の結果の部分集合）、3観測で1件 |
| 観測順序 | HBGの3観測を逆順にすると `(51231782, 4)` は一致しない |
| Table A / B混在 | Switch Axe実連続ペア、弓合成列の両方で `(51231782, 0)` を含む。Counterは1本として扱う |
| 0件 / 範囲外の区別 | Counter range `5..20` は既知組を含まない。既知Seedを含まないSeed rangeは `zero` / non-truncated |
| 打ち切り | `maxMatches = 1` で打ち切ると `isTruncated = true`・`searchedSeedRange` は完了prefixで、classificationは `incomplete`（`unique` と扱わない） |
| Production Predictionとの一致 | 方式Bの全候補について、全観測を `ProductionRngEngine.predictNormalArtian()`（Table A = Fire、Table B = noneを代表に使用）で再予測し一致 |
| 既存kernelとの一致 | 5ケース（HBG 1観測 / 3観測・非0開始 / 弓Table B 1観測の多数候補 / Switch Axe A→B / Long Sword 2観測）で方式A（無変更の既存kernel）と方式Bの結果（候補・順序・range・truncation）が完全一致。早期除外ON / OFF、chunk sizeを変えても一致 |
| primitiveの同値性 | int32 1-step = `nextReferencePrngState()`（2000状態）、seed導出term + int32初期化 = `deriveNormalArtianSeed()` + `initializeReferencePrng()`（14武器種 × 54 Seed）、compiled制約 ⇔ `selectReferenceNormalLotteryIdsFromRawValues()`（14武器種 × 2 table × 400 sample） |
| invalid / unsupported | 近接Table BのElement、Seed range上限超え、rarity 7を検索前に `invalid_input` |

既存Normal Counter Identification kernelは変更していないため、その回帰テスト（`normalArtianCounterIdentification.test.ts`）はそのまま通過している。

一意性の判定は既存Wizardと同じく「指定範囲を完全に評価し、打ち切りがなく、候補がexactly one」のときだけとし、部分探索で1件だった結果を一意とは扱わない（`classifyNormalSeedResearchResult()`）。

## 5. 観測数・Counter範囲による候補数

### 5.1 実測（100,001 Seed window）と一様乱数モデル

Seed window `51,181,782..51,281,782`（100,001 Seed）、方式Bで完全探索。`期待誤一致` は「各観測のslot剰余が一様」という**解析上の仮定**による `組数 × ∏(1/len_k)`。実測件数には真の1件を含む。全行で既知組を含んだ。

| 観測列 | 観測数 | Counter | 実測件数 | window期待誤一致 | 全域期待誤一致 |
|---|---:|---|---:|---:|---:|
| HBG Fire C4-6 | 1 | 0..500 | 206,511 | 206,175 | 2.06億 |
| HBG Fire C4-6 | 2 | 0..500 | 1,323 | 1,273 | 127万 |
| HBG Fire C4-6 | 3 | 0..10 | 1 | 0.17 | 172 |
| HBG Fire C4-6 | 3 | 0..100 | 6 | 1.6 | 1,580 |
| HBG Fire C4-6 | 3 | 0..500 | 11 | 7.9 | 7,860 |
| Long Sword Fire C0-2 | 1 | 0..500 | 48,862 | 48,926 | 4,890万 |
| Long Sword Fire C0-2 | 2 | 0..0 | 1 | 0.13 | 127 |
| Long Sword Fire C0-2 | 2 | 0..500 | 70 | 63.7 | 63,700 |
| Long Sword Fire C0-2 | 3 | 0..500 | 1 | 0.06 | 62 |
| Switch Axe Fire C0 → none C1 | 2 | 0..0 | 3 | 0.23 | 226 |
| Switch Axe Fire C0 → none C1 | 2 | 0..500 | 119 | 113 | 113,000 |
| 弓 Fire C0 / none C1 / Fire C2 | 3 | 0..0 | 1 | 0.05 | 53 |
| 弓 Fire C0 / none C1 / Fire C2 | 3 | 0..500 | 27 | 26.5 | 26,500 |
| 弓 none C0-2（Table Bのみ） | 1 | 0..500 | 1,567,569 | 1,565,641 | 15.7億 |
| 弓 none C0-2（Table Bのみ） | 3 | 0..0 | 7 | 3.1 | 3,050 |
| 弓 none C0-2（Table Bのみ） | 3 | 0..500 | 1,553 | 1,529 | 153万 |

（全行は計測test出力。抜粋。）実測は一様乱数モデルとよく一致しており、このモデルを**観測本数の事前見積もり**に使える見込みがある。ただしモデルは一意性判定の根拠にはせず、判定は常に完全探索の結果で行う。

### 5.2 1観測あたりの情報量と必要観測数の目安

1観測の情報量は、そのtable classのpool長で決まる（removal後は短くなり減る）。

| pool | 例 | 1観測の典型確率 | 情報量 |
|---|---|---|---|
| 長さ4 `[6,4,7,8]` | 近接Table A、Switch Axe | ≈ 1/1024 | ≈ 10 bit（斬れ味2本でremovalが起きると減る） |
| 長さ3 `[6,7,8]` / `[6,4,8]` | 近接Table B、ボウガン、弓Table A | ≈ 1/243 | ≈ 7.9 bit |
| 長さ2 `[6,8]` | 弓Table B | ≈ 1/32 以下 | ≤ 5 bit（会心3本で残りslotは長さ1になり情報0） |

全域（1億Seed）で必要な観測数の目安（同じpoolの観測が続く典型ケース、一様モデルによる見積もり）。

| Counter範囲 | 長さ4 pool | 長さ3 pool | 長さ2 pool（弓B） |
|---|---|---|---|
| 0..0（期待誤一致 < 1 / < 0.01） | 3 / 4 | 4 / 5 | 6 / 7 |
| 0..100 | 4 / 4 | 5 / 6 | 7 / 8 |
| 0..500 | 4 / 5 | 5 / 6 | 8 / 9 |

参考: Base Seed既知の現行Counter特定（0..5000）では、HBGは1観測19候補、2観測で一意である（RNG_SPEC 9.12 golden）。Base Seed不明では約26.6 bit（1億）を追加で特定する必要があるため、**3観測前後の追加が必要**になる。Table A / Bは混在してよく、弓ならTable A（属性あり系）で作成する方が1本あたりの情報量が大きい。

## 6. 性能・メモリ

### 6.1 測定環境と制約

- CPU: AMD Ryzen 7 9700X（8 core / 16 logical）、RAM 31 GB、Windows 11
- Runtime: Node.js v24.19.0（V8）、Vitest 4.1.11（jsdom環境）。**Browser Worker計測ではない**（C5-E2C8と同様、Node計測をBrowser計測として扱わない）
- 同じPCでGlobal Planner Researchの長時間計測（Node 1プロセス、約6 GB）が稼働中だったため、**単一スレッド・bounded Seed window（最大20万Seed）だけ**を測定した。全域探索、並列Worker benchmarkは実行していない。測定値にはこの同時負荷の影響が含まれ得る
- 「全域」の値はすべて `µs/Seed × 1億` の**外挿値**であり、実測ではない
- 計測は `src/research/issue74/normalSeedIdentificationMeasurement.test.ts`。`VITE_ISSUE74_MEASURE=1` を指定したときだけ実行され、通常の `npm test` / CIではskipされる

```bash
VITE_ISSUE74_MEASURE=1 npx vitest run src/research/issue74/normalSeedIdentificationMeasurement.test.ts --silent=false
```

計測上の注意（artifact）。Vitestのmodule runnerでは、importした定数（`REFERENCE_RNG_BLOCK_SIZE`）をhot loop内で参照するとmodule namespaceのgetter経由になり、walkが約4倍遅くなった。Browser向けbundleではこの間接参照は生じない。方式Bはmodule内local定数へ束縛し直して回避した。**方式A（既存kernel）はこのartifactを含んだままの値**であり、Browserでは表より速い可能性がある。

### 6.2 測定値（HBG観測列、単一スレッド、3回中央値）

方式A / B比較（Seed windowは既知Seedを中心に配置）。

| Counter | 方式A µs/Seed（Seed数） | 方式B µs/Seed（Seed数） | 比 | 方式A 全域（外挿） | 方式B 全域（外挿） |
|---|---:|---:|---:|---:|---:|
| 0..0 | 16〜19（2,000） | 0.21（200,000） | 約80倍 | 約27〜32分 | 約21秒 |
| 0..100 | 56〜66（300） | 2.3（20,000） | 約25倍 | 約1.6〜1.8時間 | 約3.8分 |
| 0..500 | 158〜194（300） | 10.6（20,000） | 約15〜18倍 | 約4.4〜5.4時間 | 約18分 |

方式BのCounter範囲・観測数別（µs/Seed、括弧内は(Seed, Counter)組あたり）。

| Counter | 観測1本 | 観測3本 | 観測1の5 slot全一致率 |
|---|---:|---:|---:|
| 0..0 | 0.217 | 0.209 | 0.43% |
| 0..10 | 0.423（38 ns） | 0.415 | 0.41% |
| 0..100 | 2.29（23 ns） | 2.26 | 0.42% |
| 0..500 | 10.7（21 ns） | 10.6 | 0.41% |
| 400..500 | 2.67（26 ns） | 2.47 | 0.42% |
| 0..1000 | 21.7（22 ns） | 21.0 | 0.41% |

- Seedごとの固定費（初期化）は約0.2µs、Counterごとの費用は約21ns（10 step + 判定）で、Counter範囲に対してほぼ線形
- **観測数は計算時間にほぼ影響しない**（観測2以降を判定するのは観測1が全一致した約0.4%だけ）
- 開始Counterが0以外のときのjump適用は約0.3µs/Seed
- 早期除外の効果（0..500、3観測）: ON 10.7µs / OFF（観測1の5 slotを常に全評価）25.0µs/Seed。step数は同じで、剰余計算の削減だけで約2.3倍
- メモリ: walkはSeed / Counterごとのallocationを持たない。heap増加は候補objectの保持分だけで、1観測・2万Seed × 0..500（41,193件）で約5.4 MiBだった。**メモリは候補数に比例する**ため、少観測で全域を探索すると候補数が億単位（5.1）になり、全件保持は不可能である（7.4で上限設計を提案）

### 6.3 実用時間内での探索実現性

| Counter範囲 | 単一スレッド（外挿） | 4 Worker（外挿・仮定） |
|---|---:|---:|
| 0..0 | 約22秒 | 約6〜8秒 |
| 0..100 | 約3.8分 | 約1〜1.3分 |
| 0..500 | 約18分 | 約4.5〜6分 |

- 4 Workerの値は、C5-E2C8のSkill Identification実Browser Worker計測（50,001 Seedのgolden range）で1 → 4 Workerが約3.2倍だったことから、3〜4倍のscalingを**仮定として流用**した外挿である。Normal用kernelの並列計測はしていない
- スマートフォン・低core端末での値は未測定である。PC Browserの数倍になる可能性があり、0..500全域は端末によっては数十分規模になり得る（推測）
- 既存Skill Identification（C5-E2C8: 4 Worker・Skill Counter 11候補で約67万Seed/秒、全域約2.5分の外挿）と比べ、0..500のNormal全域はその約2倍前後の時間になる見込みである

判断: **Counter 0..500の全域探索は、PC Browser + 4 Workerで数分規模に収まる見込みがあり、アルゴリズム上は実現可能**。ただし実Browser Workerでの確認（8章）と、スマートフォンでの所要時間確認が必要である。

## 7. Production化する場合の設計案（次Phase、未実装）

以下はすべて提案であり、採用には仕様化（RNG_SPEC 9章への新契約追加、UI_FLOW 5 / 6、DATA_MODEL 6の改訂）とプロジェクトオーナーの判断が必要である。

### 7.1 Domain kernel / Worker

- 新しい専用契約（例: `NormalArtianSeedIdentification`）として、9.7 / 9.12と同じkernel / Worker protocol / Worker Client構造を持たせる。既存9.12 kernelは変更しない
- kernelは方式B（compiled matcher）とし、Skill Identificationと同様に「Production Prediction authorityとdifferential parityを維持する高速化kernel」と位置づける。Phase 1のparity test群（4.2）をそのまま契約testへ昇格できる
- Worker並列化は既存Skill multi-worker orchestration（9.11: Seed rangeのcontiguous / non-overlapping chunk、deterministic merge、global progress、全Worker cancel、Worker failureのfail closed）をそのまま流用できる。1 chunk 1,000 Seedは0..500で約10msであり、cancel応答性も十分
- 入力: 武器種、rarity 8、観測（`NormalArtianCounterObservation` をそのまま再利用）、Seed range（初期値canonical全域）、開始Normal Counter range（初期値0..500、変更可能）
- Counter Gate、Skill Counter、Gogma Counterは入力・探索・結果に含めない

### 7.2 候補数上限と「一意 / 複数 / 不足」の判定

- 全域で観測が少ないと候補は億単位になる。Workerは候補を上限（例: 1万件）まで保持し、上限を超えた時点で「候補が多すぎる（観測不足）」として**打ち切ってよい**。2件以上見つかった時点で「一意ではない」ことは確定するため、打ち切りは一意性判定を損なわない
- 一意の判定は、上限内で全範囲を完全探索し、打ち切りなし・exactly oneのときだけ（既存Wizardと同じ）
- 上限内で全範囲を完全探索できた場合は候補集合が完全なので、**追加観測はその候補集合を再予測で絞るだけで済み、全域の再探索が不要**になる（数ミリ秒）。上限超過で打ち切った場合は追加観測後に全域を再探索する
- 一様乱数モデルによる「この観測数・範囲での期待誤一致数」を**検索前の案内**に使い、明らかに観測不足なら検索前に追加観測を促せる（判定authorityにはしない）

### 7.3 UI・導線

- **観測UIの共用:** Normal Counter Setupの観測入力（table class 2択 + ordered 5枠、`normalArtianCounterObservationBonusOptions()` によるProduction pool由来の選択肢、Table切替時の未入力化、縦1列の5枠表示）はそのまま共用できる。差分はSeed range / Counter range入力と、必要観測本数が多いことの案内
- **導線:** RNG Setupの「値が分からない場合」に、既存Skill-first Wizardと並ぶ2つ目の入口（例: 「通常アーティアからBase Seedを特定」）を置く案と、Normal Counter SetupでBase Seed未確定時の案内（現在は「RNG Setupで先にBase Seedを確定」）から入る案がある。Base Seedを扱う以上RNG Setup側が自然だと考えるが、判断はUI仕様化時に行う
- **Skill-first Wizardとの組み合わせ:** 通常アーティアでBase Seedが一意になった後、既存Wizard STEP 1をSeed range `{B, B}`（既存UIで指定可能なbounded range）で実行すれば、Skill Counterの特定はSeed 1候補の高速検索になる。新しいSkill kernelは不要
- **PC / スマートフォン:** 観測本数が4〜9本と多いため、スマートフォンでは観測cardの縦積み、入力済み観測の折りたたみ、観測番号の明示（「N本目の作成結果」）が重要になる。検索中はindeterminateではなく `searchedSeeds / totalSeeds` の進捗とcancelを表示できる（Seed range分割のためtotalが確定している）

### 7.4 採用処理

- 一意結果は `Base Seed + 開始Normal Counter（観測した武器種）` の組であり、**同時に確定する**のが自然である。Normal Counterだけを確定してBase Seedを捨てる理由はなく、Base Seedだけを確定するとCounter情報を再取得させることになる
- 採用値は調査前状態のもの（`counter = startNormalCounter`、観測数を加算しない）。採用前に調査前のゲーム状態へ戻したことを確認させる運用は5.4 / 6と同じ
- Skill Counter / Gogma Counterは未確定のまま維持できる。RngStateの各値は独立した `KnownValue` であり、capability derivationは必要値だけを要求するため、Base Seed + Normal Counterだけで「その武器種の通常アーティアroute」の検索条件の一部が揃う（巨戟化以降にはSkill / Gogma Counterが別途必要）
- **既存確定値との整合（仕様判断が必要）:** 既にBase Seed / Skill / Gogma Counterや他武器種のNormal Counterが確定済みのときに、異なるBase Seedを採用した場合の扱い（それらを未確定へ戻すか、拒否するか、警告して維持するか）は現行仕様に定めがない。Counter値自体はゲーム側の位置だが、それを特定した根拠のSeedが変わるため、推測で決めず次Phaseで仕様化する
- **Identification provenance（仕様判断が必要）:** `RngState.lastIdentifiedAt` は現在「Base Seed / Skill / Gogma の3値一体採用」だけが書く（RNG_SPEC 9.9、DATA_MODEL 6.1）。通常アーティア経由でBase Seedだけを採用する場合にこれを書くか、書かないかは、16.15の再特定reminderの解決判定に影響するため要判断。`NormalArtianCounter.lastIdentifiedAt` は既存Counter確定経路と同様に書けると考える
- **永続化の原子性:** RngState（Base Seed）とNormalArtianCounterを**1 transaction**で更新する必要がある。既存の `IdentificationAdoptionService.adopt()` と `adoptNormalArtianCounterIdentification()` は別経路なので、両者を合わせた新しいadoptionを1つの `PlanGuardedMutation` として設計する
- **Active Planがある場合:** Base Seed変更とNormal Counter変更はどちらもPlan-breaking guardの対象（`rng_state_changed` / `normal_counter_changed`）なので、既存 `PlanBreakingChangeGuard` / `usePlanBreakingChangeApproval()` をそのまま通し、16.10のsave point選択も既存どおりとする

## 8. 未検証事項と追加調査事項

未検証（Phase 1で確認していない）。

- 実Browser Workerでの方式Bの処理時間（Node / Vitest計測の外挿のみ）。特にBrowser bundleでのstep費用、4 Worker並列のscaling、main thread応答性
- スマートフォン・低core端末での所要時間
- 全域（1億Seed）の実探索。Global Planner Researchへの影響を避けるため実行していない
- 全域で実際に一意になる観測本数（5.2は一様モデルによる見積もりであり、全域の実測ではない）
- 通常アーティア観測からBase Seedを特定する手順全体の実機検証（観測 → 全域探索 → 一意 → 採用 → 予測がゲームと一致）。Base Seed `51231782` のfixtureは各Counter位置の結果を証明するものであり、この特定手順そのものを実機で通したものではない
- Normal由来のBase Seedが、Skill / Gogma streamのBase Seedと同一であること。これはreference-verifiedのseed導出（同じ `B` に武器種・項を加える）と、Base Seed `51231782` でNormal / Skill / Gogmaのgame-verified fixtureが共存していることによる裏付けに留まり、Normal経由で特定したSeedからSkill / Gogma予測を実機確認したものではない

RNGのverification statusについて。Phase 1はProduction Normal pool（RNG_SPEC 6.3.1）を前提にしており、そのprovenance（directly game-verifiedとcategory-level Production adoptionの区別、弓Table A / B、Switch Axe single pool、`maximumOccurrences` の根拠）は変わらない。category-level adoptionの武器種・属性でBase Seed特定に使う場合、pool仮定の誤りは「正しいSeedが0件になる」か「誤ったSeedが一致する」形で現れ得る。

## 9. 次Phaseへ進めるための判断条件

次Phase（仕様化・Production実装）へ進む前に、次を満たすことを提案する。

1. **実Browser Worker計測:** benchmark entry（C5-E2C8と同じ隔離構成）で方式Bを1 / 2 / 4 Worker計測し、Counter 0..500の全域（または十分大きいbounded range）が4 Workerで概ね10分以内に収まること。Global Planner Researchが停止しているときに実施する
2. **スマートフォン計測:** 代表的なスマートフォンでbounded rangeを計測し、全域0..500の所要時間を外挿して、UXとして許容できるか（あるいはスマートフォンでは狭いCounter範囲を推奨するか）を判断できること
3. **仕様判断:** 7.4の「既存確定値との整合」「`RngState.lastIdentifiedAt` の扱い」「導線の位置」についてプロジェクトオーナーの決定があること
4. **観測本数のUX判断:** 全域0..500で4〜9本の通常アーティア作成を要求することが、Skill-first Wizard（巨戟化素材が必要）に対して利点があるかの判断。Counter既知（0..0）を明示選択できる経路を設けるかも含む
5. **実機end-to-end確認（推奨）:** Base Seed既知のセーブで、通常アーティア観測だけからSeed + Counterを全域探索し、既知値と一致することを1件以上確認すること
6. **仕様の正式化:** RNG_SPEC 9章に新契約（9.13等）を追加し、9.1の「Base Seedの特定は9.7だけが行う」を改訂すること。採用処理（7.4）をDATA_MODEL / UI_FLOWへ反映すること

## 10. 追加したファイル

| ファイル | 内容 |
|---|---|
| `src/research/issue74/normalSeedIdentificationResearch.ts` | 方式A / 方式B、観測compile、分類、parity用の公開helper（Research専用） |
| `src/research/issue74/normalSeedIdentificationResearch.test.ts` | 正しさ・parity・isolation test（CIで実行） |
| `src/research/issue74/normalSeedIdentificationMeasurement.test.ts` | bounded・単一スレッドの計測（`VITE_ISSUE74_MEASURE=1` のときだけ実行） |
| `docs/ISSUE_74_NORMAL_SEED_IDENTIFICATION_RESEARCH.md` | 本文書 |
