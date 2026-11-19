# AUTOMATION — 「指示するだけで開発が進む」ための仕組み

最終更新: 2026-11-19

目標は **沼田が指示を出すだけで、Claude が安全に実装を進められる状態**。
そのために必要なのは「Claude が賢くなること」ではなく、
**壊れたときに機械が気づいて止める仕組み**。

---

## 1. いま動いているもの

### 1-1. ローカルの検証コマンド

```powershell
npm run check
```

これ1本で以下が順に走る。どれかが落ちたら止まる。

| 順 | コマンド | 何を見るか |
|---|---|---|
| 1 | `npm run lint` | oxlint（react/rules-of-hooks 等） |
| 2 | `npm run check:undef` | **未定義の識別子**（TS2304） |
| 3 | `npm run test` | Vitest |
| 4 | `npm run build` | `tsc -b` + `vite build` |

個別に走らせる場合:

```powershell
npm run test:watch
```

### 1-2. 未定義識別子チェック（`scripts/check-undefined.mjs`）

**これが今回いちばん重要な追加。**

`src/App.jsx` は `.jsx` なので `tsconfig.app.json`（`allowJs` なし）の型チェック対象外。
oxlint も `no-undef` を持たない。この**二重の穴**を通って、
実際に存在しない関数を呼ぶコードが本番まで到達していた。

- `applyCareerChoice` → 実体は `handleSelectCareerPath`（リネーム時の置換漏れ）
- `openReincarnateCreator` → 実体は `handleProceedFromTruckModal`（同上）
- `renderGenomeTag` → そもそも未実装

進路選択モーダルが開いた瞬間に `ReferenceError` で画面が落ちる状態だった。

仕組み:
`tsconfig.check.json`（`allowJs` + `checkJs`）で `tsc` を走らせ、
出力から **TS2304 だけ**を拾う。他の型エラー（型注釈がないことによるもの等）は
現時点で 400件以上出るので今は無視している。段階的に厳しくしていく。

### 1-3. GitHub Actions（`.github/workflows/ci.yml`）

`main` への push と、すべての PR で `npm run check` 相当を実行する。
PR のときはビルド成果物（`dist/`）を7日間アーティファクトとして残す。

### 1-4. テスト（Vitest）

```
src/lib/format.test.js     12 tests
src/lib/purchase.test.js   11 tests
```

**方針: 実装を読んで期待値を書くのではなく、実際に実行した値を固定する。**
リファクタ中に挙動が変わったことを検出するのが目的なので、
「現状が正しいかどうか」とは切り離して、まず現状を固定する。

`formatNum` の `decimals` が1万以上で無視される件のように、
**仕様かバグか判断がつかないものも、判断がつくまでは現状の挙動として固定**しておく
（テストにコメントで明記する）。

---

## 2. これから作るもの

### 2-1. バランスシミュレーション（Phase 3 の後）

**前提: `Math.random()` の11箇所を RNG 注入に置き換えること**
（[GAME_SPEC.md](GAME_SPEC.md) §9 / [REFACTOR_PLAN.md](REFACTOR_PLAN.md) Phase 3）。

これが終わると、ブラウザを使わずにゲームを N 周回ぶん回せるようになる。

```
scripts/simulate.mjs
  --seed <n>        乱数シード
  --generations <n> 回す周回数
  --strategy <name> AUTO任せ / 技術特化 / 転生優先 など
  --out <path>      CSV 出力
```

見たい指標:

| 指標 | なぜ見るか |
|---|---|
| 各周回の到達カテゴリ・ピーク総合力 | 進行が詰まる地点 |
| 引退年齢の分布 | `maxRetireAge` と衰え減衰のバランス |
| 継承結晶の獲得量の推移 | 周回ごとの伸びが指数か線形か |
| 進路ゲノムの Lv 分布 | 🐞 Lv5クランプ漏れの影響度を数字で見る |
| 各アップグレードの購入タイミング | 死んでいる（誰も買わない）要素の検出 |
| 第2〜第5段階転生への到達周回数 | エンドコンテンツが遠すぎないか |

**最初に測るべきは「進路ゲノムの Lv5 クランプ漏れを直したとき、何周目で何%バランスが変わるか」。**
直すべきバグだと分かっていても、周回バランス全体が崩れる可能性があるので、
数字を見てから直す。

### 2-2. スモークテスト（ヘッドレス）

RNG 注入後、`advanceOneMonth` を直接叩いて確認する:

- 同じ seed・同じ初期 state から N ヶ月進めた結果が**完全一致**する（決定論性）
- 7 / 12 / 15 / 18歳の4月に `pendingModal` が返る（**今回の回帰**）
- 22歳4月の強制タイムリープが発火する
- 引退条件（`age >= maxRetireAge` と `isDeclineRetired` の両方）で `isRetired` が立つ
- セーブ → ロード → セーブ で内容が一致する（マイグレーション込み）

### 2-3. ブラウザ E2E（優先度は低い）

現状は Claude が開発サーバーを直接操作して確認している（今回の検証もその方法）。
Playwright を入れるのは、UI 分割（Phase 5）が終わって
コンポーネント単位でテストできるようになってからでいい。

### 2-4. デプロイ

Vercel が GitHub リポジトリに接続されている（`vercel.com/inuyuna/football-chronicle`）。
`main` への push で自動デプロイされる想定。

> ⚠️ **未確認**: Vercel 側のビルド設定が Vite 8 前提になっていないか。
> ローカルでは ARM64 Windows の制約で Vite 7 に固定したが、
> Vercel（Linux x64）では rolldown も動く。設定が食い違っていないか一度見ておくこと。

---

## 3. Claude が実装を進めるときの手順

**沼田が「◯◯を直して」と言ったとき、Claude が毎回やること。**
詳細は リポジトリ直下の [CLAUDE.md](../CLAUDE.md) に書いてある（Claude が毎セッション読む）。

```
1. docs/ を読む（ARCHITECTURE → 該当Phase の REFACTOR_PLAN）
2. ブランチを切る
3. 変更する
4. npm run check が通ることを確認
5. 画面で見える変更なら開発サーバーで実際に確認する
6. コミット（何を・なぜ・どう検証したかを本文に書く）
7. 行番号がずれたら docs/ を更新する
```

### 守ること

- **`docs/` の行番号は変更のたびに更新する。** 地図が嘘になると次のセッションが事故る
- **バグを見つけたら、直す前にテストで現状を固定する。** 特にゲームバランスに関わるもの
- **`npm run check` が落ちたままコミットしない**
- **リファクタと機能変更を同じコミットに混ぜない**

---

## 4. 既知の課題

| 課題 | 状態 |
|---|---|
| `npm audit` で critical 2件 / moderate 1件 | 未対応。内容を確認して判断する |
| `tsconfig.check.json` の型エラー 400件超 | TS2304 以外は未対応。段階的に減らす |
| Vercel のビルド設定が Vite 8 前提かどうか | **未確認** |
| 古いリモートブランチ `inuyuna/footballchronicle` | v0.1 で停止。main が先行。扱いを決める |
| Tailwind が Play CDN | 本番が CDN 依存。Phase 7 で解消 |
