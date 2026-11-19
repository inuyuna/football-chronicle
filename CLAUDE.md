# CLAUDE.md — Football Chronicle 開発ルール

このファイルは Claude が毎セッション最初に読む。**ここに書いていないことは docs/ を見る。**

---

## このプロジェクトは何か

サッカー選手を5歳から育てる放置系・周回系の育成ゲーム。
React 19 + Vite の単一ページアプリ。サーバーもDBもない。セーブは `localStorage` だけ。

- 本番: https://football-chronicle.vercel.app/
- リポジトリ: https://github.com/inuyuna/football-chronicle

---

## 🔴 作業を始める前に必ず読む

| 知りたいこと | 読むファイル |
|---|---|
| コードがどこに何があるか | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| ゲームのルール・計算式 | [docs/GAME_SPEC.md](docs/GAME_SPEC.md) |
| どういう順序で直すか | [docs/REFACTOR_PLAN.md](docs/REFACTOR_PLAN.md) |
| テスト・CI・シミュレーション | [docs/AUTOMATION.md](docs/AUTOMATION.md) |

**`src/App.jsx` は 9,100行ある。全部読もうとしないこと。**
ARCHITECTURE.md の行範囲表を見て、必要な場所だけ読む。

---

## 絶対に守ること

### 1. `npm run check` が通らないままコミットしない

```powershell
npm run check
```

lint → 未定義識別子 → テスト → ビルド の順に走る。

### 2. ファイルを削除しない

消す必要があると思ったら、必ず沼田に確認を取る。
コード行の削除（リファクタ）は対象外。ファイル単位の削除の話。

### 3. バグを見つけたら、直す前にテストで現状を固定する

特にゲームバランスに関わるもの。
「明らかに間違っている」ものでも、周回バランス全体が崩れる可能性がある。
**現状を固定 → 数字で影響を見る → 直す** の順。

### 4. 行番号がずれたら `docs/` を更新する

docs/ の行番号は Claude 自身が次のセッションで使う地図。
嘘になった瞬間に事故る。変更したら必ず直す。

### 5. リファクタと機能変更を同じコミットに混ぜない

---

## 環境の罠

### Vite 8 (rolldown) は使えない

このマシン（ARM64 Windows）では Windows の Application Control ポリシーが
**未署名の `.node` の DLL ロードをブロック**する。
rolldown はネイティブバインディングを `.node` で読むのでビルドが落ちる。

**`vite@^7` / `@vitejs/plugin-react@^5` に固定すること。上げない。**

WASM 版（`@rolldown/binding-wasm32-wasi`）でも回避を試みたが、
WASI が Windows パスを解決できず失敗した。この道は閉じている。

### 開発サーバー

`Desktop\Claud\.claude\launch.json` の `football-chronicle` を使う。
`npm run dev --prefix <path>` では cwd が変わらず `vite.config.ts` を解決できない。

### セーブデータ

- キー: `football_chronicle_v0_12_save`
- **沼田のセーブを消す作業をするときは必ず先にバックアップを取る**

---

## 実装の手順

```
1. docs/ARCHITECTURE.md で場所を特定する
2. git checkout -b <branch>
3. 変更する
4. npm run check
5. 画面に出る変更なら開発サーバーで実際に動かして確認する
6. コミット
7. 行番号がずれたら docs/ を更新
```

### 画面の変更は必ず実機で確認する

「ビルドが通った」では足りない。
**未定義の関数を呼んでいても Vite のビルドは通る**（実際に3件すり抜けた）。

進路選択モーダルのように「特定の年齢まで進めないと出ない画面」は、
開発サーバーで実際にその年齢まで進めて確認する。
7歳の進路選択なら、新規スタートから約24秒で到達する。

---

## コミットメッセージ

日本語。1行目は `<type>: <何をしたか>`。

```
fix: 進路選択とタイムリープのモーダルが一度も開かない問題を修正

<なぜそうなっていたか>
<何を変えたか>
<どう検証したか>

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

type: `feat` / `fix` / `refactor` / `test` / `build` / `docs` / `chore`

**「なぜ」を必ず書く。** 次に読むのは数ヶ月後の自分か Claude で、
そのときコードだけ見ても理由は分からない。

---

## いま分かっている重大な問題

優先度順。詳細は docs/ の該当箇所へ。

| # | 問題 | 場所 |
|---|---|---|
| 1 | エンジンが state を直接ミューテートする。不変性を支えているのは手書き22個のクローンリストだけ | REFACTOR_PLAN Phase 4 |
| 2 | `Math.random()` が11箇所に直書き。テストもシミュレーションも書けない | REFACTOR_PLAN Phase 3 |
| 3 | 進路ゲノムの成長倍率に Lv5 クランプが掛かっていない（9箇所）。周回を重ねるほど壊れる | GAME_SPEC §5 🐞 |
| 4 | `applyStatGrowth` がチャレンジ中のブレイクスルー封印を見ていない。UIと実挙動が食い違う | GAME_SPEC §2-3 🐞 |
| 5 | 価格計算が JSX とハンドラで二重に書かれている（5項目）。表示と課金が静かにズレる | REFACTOR_PLAN Phase 2-1 |
| 6 | Tailwind が Play CDN。CDN が落ちたら本番のスタイルが消える | REFACTOR_PLAN Phase 7-1 |
| 7 | `useMemo` ゼロ。派生値60個が毎ティック全部再計算 | REFACTOR_PLAN Phase 6-2 |
| 8 | JSX 2,500行に `aria-*` / `role` / `onKeyDown` が0件 | REFACTOR_PLAN Phase 7-2 |
