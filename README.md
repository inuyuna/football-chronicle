# Football Chronicle

サッカー選手を5歳から育てる放置系・周回系の育成ゲーム。

- 本番: https://football-chronicle.vercel.app/
- スタック: React 19 + Vite 7（サーバーなし / セーブは `localStorage`）

---

## 使うコマンド

```powershell
npm install        # 初回のみ
npm run dev        # 開発サーバー（http://localhost:5173）
npm run check      # lint → 未定義識別子 → テスト → ビルド
npm run test:watch # テストを監視実行
```

`npm run check` が通らないままコミットしない。

---

## ドキュメント

| 知りたいこと | 読むファイル |
|---|---|
| 開発のルール | [CLAUDE.md](CLAUDE.md) |
| コードの地図 | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| ゲームのルール・計算式 | [docs/GAME_SPEC.md](docs/GAME_SPEC.md) |
| リファクタの順序 | [docs/REFACTOR_PLAN.md](docs/REFACTOR_PLAN.md) |
| テスト・CI・シミュレーション | [docs/AUTOMATION.md](docs/AUTOMATION.md) |
| ゲームデザインの決定と理由 | [docs/GAME_DESIGN.md](docs/GAME_DESIGN.md) |
| バランス調整の実測ログ | [docs/BALANCE_LOG.md](docs/BALANCE_LOG.md) |
| 次に何をやるか | [roadmap.html](roadmap.html) |

---

## 計測

```powershell
npm run measure    # 周回カーブ（8周ぶん / 約1分）
npx vitest run --config vitest.measure.config.js src/measure/aging.measure.jsx
                   # 加齢カーブ（1年ごとの上限・能力値・カテゴリ）
```

`MEASURE_GENERATIONS` で周回数、`MEASURE_ASC_STRATEGY` で結晶の買い方
（`cap` / `growth` / `life` / `harvest`）を変えられる。

> ⚠️ いまの計測は結晶強化を4種類しか買わないので、**実プレイの「要素を全部
> 揃えた状態」を再現できない**。ソフトキャップが効いているかはこれでは分からない。

---

## 注意

### Vite 8 (rolldown) へ上げない

ARM64 Windows では Application Control ポリシーが未署名の `.node` を
DLL ロードできずビルドが落ちる。`vite@^7` / `@vitejs/plugin-react@^5` に固定している。
詳細は [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) の §6。

### Tailwind は現在 Play CDN

`index.html` が `https://cdn.tailwindcss.com` を読んでいる。
ビルド成果物に CSS が含まれないので、**CDN が落ちたら本番のスタイルが消える**。
解消は [docs/REFACTOR_PLAN.md](docs/REFACTOR_PLAN.md) の Phase 7-1。
