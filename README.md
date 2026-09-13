# GogmaArtianPlanner

GogmaArtianPlannerは、『MONSTER HUNTER WILDS』のアーティア武器厳選を支援する
静的Webアプリケーションです。RNG状態を管理し、目標武器の候補検索から複数武器の
生産計画作成までをブラウザ内で行います。

## 主な機能

- Base Seed、Skill Counter、Gogma Counter、通常アーティアCounterの設定・管理
- 実ゲームの連続観測からBase Seedと開始Counterを特定するIdentification Wizard
- 通常／巨戟アーティア所持武器と目標武器の管理
- 通常アーティア経由および所持巨戟アーティア経由のCandidate Search
- 候補のBuild List登録と、共有RNG進行を考慮した生産計画の作成・確認
- IndexedDBを使用したブラウザ内へのデータ保存

仕様の詳細は[要件](docs/REQUIREMENTS.md)および
[RNG仕様](docs/RNG_SPEC.md)を参照してください。

## 使い方 / GitHub Pages

GitHub Pages版は次のURLから利用できます。

<https://nekono-lazy.github.io/GogmaArtianPlanner/>

入力したデータはブラウザ内に保存されます。バックエンドサーバー、ユーザーアカウント、
クラウド同期は使用しません。

## 開発

依存関係をinstallします。

```sh
npm ci
```

利用できる主なcommandは次のとおりです。

```sh
npm run dev
npm run lint
npm test
npm run test:watch
npm run build
npm run preview
```

Production buildは`dist/`へ出力され、bundleされたdependencyのlicense inventoryを
`dist/licenses.md`へ生成します。

## RNG Reference / Acknowledgements

RNG挙動の検証と互換実装では、WiseHorror氏のGogma Artian Roll Planner v0.9.4
（`GARP.lua`）を外部Reference Implementationとして使用しています。固定version、commit、
file hash等の詳細は[Third-Party Notices](THIRD_PARTY_NOTICES.md)および
[Production RNG Engine参照実装監査](docs/RNG_REFERENCE_AUDIT.md)を参照してください。

## License

Project-owned source code is licensed under the MIT License. See [LICENSE](LICENSE).

Third-party materials and dependencies are subject to their respective terms and
notices. See [Third-Party Notices](THIRD_PARTY_NOTICES.md).
Production buildでは、bundleされたdependencyのlicense inventoryも`licenses.md`として
配布されます。

## Disclaimer

本ツールは『モンスターハンターワイルズ』の非公式ファンメイドツールです。
『モンスターハンターワイルズ』および関連する名称・ゲーム内容の権利は、
それぞれの権利者に帰属します。本ProjectはCAPCOMとの提携・承認・後援関係にはありません。
