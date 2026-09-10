## 変更概要

<!-- 何を、なぜ変更したかを簡潔に記載する。対象外とした範囲も明記する。 -->

## 参照した仕様・設計

<!--
`AGENTS.md` の Specification Authority に従い、参照した文書を列挙する。
例:
- docs/REQUIREMENTS.md
- docs/SEARCH_SPEC.md 5.6
- docs/AI_DEVELOPMENT_WORKFLOW.md
-->

## 実行した確認コマンド

<!-- 実際に実行したコマンドのみを記載する。未実行のコマンドは「未実行」とその理由を書く。 -->

```bash
npm run lint
npm test
npm run build
git diff --check
git status --short
```

## lint / test / build 結果

| コマンド | 結果 | 備考 |
| --- | --- | --- |
| `npm run lint` | pass / fail / 未実行 | |
| `npm test` | pass / fail / 未実行 | |
| `npm run build` | pass / fail / 未実行 | |
| `git diff --check` | pass / fail / 未実行 | |

<!-- 実行していないコマンドを「成功した」と報告しない。 -->

## 残課題

<!-- このPRで対応しなかった作業、後続タスクへ引き継ぐ事項。なければ「なし」。 -->

## 未検証事項

<!--
game-verified でないRNG挙動、Keep予測、Lottery データなど、
このPRで検証できていない前提を明記する。なければ「なし」。
-->

## チェックリスト

- [ ] 依頼範囲のみを変更し、無関係なリファクタリングを含めていない
- [ ] Domain contract を暗黙に変更していない（変更した場合は仕様文書も更新済み）
- [ ] 変更したロジックに対応するテストを追加・更新した
- [ ] 未確認のゲーム挙動を推測で実装していない

<!-- merge の可否はプロジェクトオーナーが判断する。 -->
