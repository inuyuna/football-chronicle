# REFACTOR_PLAN — 9,166行を分割するための順序

最終更新: 2026-11-19

## この順序を守る理由

分割そのものは難しくない。**順序を間違えると原因不明のバグが出る**ので、そこだけ厳密にする。

鉄則は3つ。

1. **純粋関数の切り出しは安全。先にやる。**
   データ層（30–2,054）とユーティリティ（2,057–2,598）は `App()` の外にある。
   そのまま別ファイルへ移すだけで動く。
2. **`advanceOneMonth` の分割と `useReducer` 化の前に、必ずミューテーションを潰す。**
   エンジンは state を直接書き換えていて、不変性を支えているのは
   メインループが手書きで並べた22個の浅いコピーだけ。
   この状態で分割すると、どこで state が汚染されたか追えなくなる。
3. **RNG 注入はテストの前提。** `Math.random()` が11箇所に直書きされている限り、
   同じ入力から同じ結果を再現できない = 回帰テストもバランス検証も書けない。

```
Phase 0  安全網（CI・型ゲート・テスト基盤）
   ↓
Phase 1  データ層とユーティリティの切り出し      ← リスク最小・効果大
   ↓
Phase 2  重複の解消（価格・逓減計算・フォーマッタ）
   ↓
Phase 3  決定論化（RNG 注入）                    ← ここから自動検証が効く
   ↓
Phase 4  ミューテーション潰し                    ← 分割の前提
   ↓
Phase 5  UI コンポーネント分割
   ↓
Phase 6  useReducer / useMemo
   ↓
Phase 7  Tailwind ビルド化・アクセシビリティ
```

---

## Phase 0: 安全網

詳細は [AUTOMATION.md](AUTOMATION.md)。先にこれを立てないと、以降の全フェーズで壊れたことに気づけない。

- [x] `tsconfig.check.json`（`allowJs` + `checkJs`）で `TS2304 Cannot find name` を検出できるようにする
- [ ] `npm run check` に統合（型ゲート + lint + build）
- [ ] GitHub Actions で PR ごとに実行
- [ ] Vitest 導入
- [ ] 現状の挙動を固定するスナップショットテスト

---

## Phase 1: データ層とユーティリティの切り出し

**効果**: App.jsx が 9,166 → 約 6,550行。リスクはほぼゼロ。

### 1-1. ファイル構成

```
src/data/
  saveKeys.js      SAVE_KEY, LEGACY_SAVE_KEYS, CURRENT_TUTORIAL_VERSION
  positions.js     POSITIONS, POSITION_IDS, POSITION_TRAITS_DEF, POS_MILESTONE_EVENTS
  bodyTypes.js     BODY_TYPES
  tactics.js       TACTICAL_STYLES
  categories.js    CATEGORIES
  euro.js          EURO_COUNTRIES
  rivals.js        RIVAL_TIERS
  drills.js        DRILLS_DEF, ALL_DRILL_IDS
  genomes.js       BASE_GENOME_DEF, FUSED_GENOME_DEF, SECRET_GENOME_DEF
  synergies.js     SYNERGY_COMBOS_DEF
  shop.js          UPGRADES_DEF, BREAKTHROUGHS_DEF
  rebirth.js       LEGACY_UPGRADES_DEF, ASCENSION_UPGRADES_DEF
  life.js          PARTNER_TYPES, HOBBIES_DEF, CHARMS_DEF, PROTEGE_ARCHETYPES
  localClub.js     LOCAL_CLUB_MATES, LOCAL_CLUB_FACILITIES
  progression.js   ENDINGS_DEF, CHALLENGES_DEF, ENDGAME_TRIALS_DEF

src/lib/
  format.js        formatYen, formatNum
  purchase.js      calcBulkPurchase, calcBulkSingleResource         （依存ゼロ）
  mastery.js       getHabitMilestoneMult                            （依存ゼロ）
  lifecycle.js     getCareerStageInfo, getDynamicHeight             （依存ゼロ）
  ranks.js         getUnrivaledRank, getFanRankInfo, getSquadRoleInfo → data/categories
  synergy.js       getActiveSynergies                               → data/synergies
  slots.js         computeMaxCharmSlots, computeMaxTraitSlots, clampEquippedLists
  stats.js         getTotalRating, getEffectiveMaxResources,
                   computeIndividualStatCaps, applyStatGrowth       → data/{positions,bodyTypes,life}
  training.js      getDrillEffectiveStats, computeOptimalAutoList   → data/* + lib/*

src/components/MiniBar.jsx                                          → lib/format
```

依存の向きは **lib → data の一方向のみ**。data 同士は `genomes.js → positions.js` の1本だけ。

### 1-2. 循環参照を避けるための事前処理

分割する前にやっておくこと。順番に意味がある。

**(a) `genomes.js → positions.js` の依存を細くする**

`total_player_dna` の `getStatVal` が `Object.keys(POSITIONS)` を呼んでいる（963行）。
`POSITIONS` 全体ではなく `POSITION_IDS`（id の配列）だけを import する形にしておく。
`positions.js` 側に「このPOSを極めると生えるゲノムid」のような逆参照を足した瞬間に循環するため。

**(b) データ内の述語（`check` / `checkGoal` / `checkUnlock`）を lib から切り離したまま保つ**

現状、`ENDINGS_DEF.check` / `CHALLENGES_DEF.checkGoal` / `SYNERGY_COMBOS_DEF.check` /
`ENDGAME_TRIALS_DEF.check` / `PARTNER_TYPES.checkUnlock` は
すべて state のフィールドを直接読むだけで、ヘルパーを呼んでいない。**だから今は安全。**

しかし `lib/synergy.js` は `data/synergies.js` を import するので、
`SYNERGY_COMBOS_DEF.check` が `getTotalRating` を呼びたくなった瞬間に循環する。

→ 推奨: 述語をデータから剥がし、`src/lib/rules/` に id をキーにしたマップとして置く。
```js
export const ENDING_RULES = { ed_hometown: (s) => …, … };
```
データは文言とメタ情報だけにする。
ついでに `checkUnlock(s, r)` だけ引数が2つという不統一も解消できる。

**(c) `lib/training.js` を依存の末端に固定する**

`getDrillEffectiveStats` は `getActiveSynergies` / `getCareerStageInfo` /
`getHabitMilestoneMult` を呼ぶ。`getHabitMilestoneMult` を `mastery.js`、
`getCareerStageInfo` を `lifecycle.js` という依存ゼロの単独モジュールに置けば、
`training.js` が常に一番上になり、逆流しない。

**(d) データ内の Tailwind クラス文字列を外す**

`getUnrivaledRank` / `getSquadRoleInfo` / `DRILLS_DEF.badgeClass` が
Tailwind のクラス文字列を直接持っている。ここを「テーマ定義」として別モジュールに出すと
data → ui の依存が生まれ、ui が data を読むと循環する。

→ データ側は `tone: 'rose' | 'amber' | 'sky' | …` の**意味トークン**だけ持つ。
クラス文字列への変換はコンポーネント側で行う。

現状の暗黙の配色規則（コードのどこにも書かれていない）:

| tone | 意味 |
|---|---|
| `amber` | 永続・結晶・実績 |
| `purple` | 転生 |
| `sky` | 次世代・QoL |
| `emerald` | 成長・好調 |
| `rose` | 宿敵・危険・縛り |
| `indigo` | 戦術・欧州 |
| `pink` | 恋愛 |
| `fuchsia` / `cyan` | 高段階転生 |

**(e) `ALL_DRILL_IDS` の二重管理を解消**

`ALL_DRILL_IDS`（40行）と `DRILLS_DEF`（1,482行）が同じ情報を持っている。
分割時に別ファイルへ行くと確実に片方だけ編集される。

```js
// data/drills.js
export const ALL_DRILL_IDS = DRILLS_DEF.map((d) => d.id);
```
（App 本体で9箇所使用中）

---

## Phase 2: 重複の解消

**ここをやらずに Phase 5（UI分割）に進むと、二重管理が2ファイルに分断されてもっと見つけにくくなる。**

### 2-1. 価格のマジックナンバーを定数化（最優先）

「表示する値段」と「実際に引かれる値段」が別の場所に同じ数字で書かれている。

| 新設する定数 | 現在 JSX側 | 現在ハンドラ側 | 重複している値 |
|---|---|---|---|
| `PROPHECY_DEF` | 7,989付近 | 5,296 | `22000, 120, 1.82`, maxLv `20` |
| `LOCAL_CLUB_TIER_DEF` | 7,857付近 | 5,432付近 | `35000, 140, 2.25`, maxLv `7` |
| `SCHOOL_TOUR_DEF` | 8,015付近 | 5,317付近 | `400`(ファン), `15000`(円) |
| `SIG_BRAND_DEF` | 8,032付近 | 5,346付近 | `1500, 35000, 1.65`, maxLv `30` |
| `ENDLESS_INVEST_DEF` | **定義が JSX にしかない** | 5,458付近 | 成長率 `1.38` |

`ENDLESS_INVEST_DEF`（`endless_lab` / `endless_ai` / `endless_fund`）は
`computeIndividualStatCaps`(2,290) と `getDrillEffectiveStats`(2,490) からも参照されているので、
データ分割時に取り残される。**Phase 1 より先に定数化しておく方が安全。**

### 2-2. 逓減計算の重複を1本化

`excessRatio → diminishing = 1/(1+excessRatio*7.0) → overRatio` の3行が
`applyStatGrowth`(2,431–2,433) と `getDrillEffectiveStats`(2,573–2,575) に完全重複。
**🐞 のチャレンジ封印バグはこの重複から生まれている。** 最優先で括り出す。

### 2-3. 効果の数値をデータ側に移す

`CHARMS_DEF` / `POSITION_TRAITS_DEF` / `SYNERGY_COMBOS_DEF` / `FUSED_GENOME_DEF` /
`SECRET_GENOME_DEF` / `RIVAL_TIERS` は**効果を文字列でしか持っていない**。
実際の倍率は `getDrillEffectiveStats` と `computeIndividualStatCaps` にベタ書き。

例: `trait_wg` の「技術成長+10%」→ 2,524行の `1.1` /
`charm_lover` の「練習消費-8%」→ 2,454行の `0.92`

確認した約30ペアは全部一致していたが、片方だけ直す事故が起きる構造。

→ data 側に `effects: { tecGrowth: 0.10 }` のような数値を持たせ、lib はそれを読むだけにする。
**リファクタの本命はここ。**

### 2-4. 小さい重複

- `calcBulkPurchase`（二重通貨）と `calcBulkSingleResource`（単一通貨）はループ構造が同一 → 通貨配列を取る1関数に統合
- `formatYen` と `formatNum` は兆/億/万の分岐が丸ごと同じ
- `qolToggles` を書き換えるインライン更新関数が JSX 内に4箇所コピーされている（7,601 / 7,616 / 8,119 / 8,400 付近）→ `setQolToggle(key, value)` を1本作る
- `buySignatureBrand` が `calcBulkPurchase` の「G＝お金」枠にファン数、「Pt＝戦術Pt」枠にお金を渡している → 引数名が嘘になるので専用関数に分けるか `resA` / `resB` に汎用化

---

## Phase 3: 決定論化（RNG 注入）

11箇所の `Math.random()` を置き換える（一覧は [GAME_SPEC.md](GAME_SPEC.md) §9）。

```js
// src/lib/rng.js
export function createRng(seed) { /* mulberry32 等 */ }
```

state か、エンジン関数の引数に `rng` を持たせる。
**この Phase が終わった時点で、バランスシミュレーションと試合結果の回帰テストが書けるようになる。**

同時にやること:
- `getActiveSynergies`(2,181) の try/catch を外すか、最低でも `console.warn` を入れる
  （セーブの形が変わって `check` が落ちてもコンボが黙って発火しなくなるだけで原因が追えない）

---

## Phase 4: ミューテーション潰し

**ここが最難関。Phase 5・6 の前提。**

現状:
- `advanceOneMonth` とエンジン関数群が受け取った `newState` を直接書き換える
- `applyStatGrowth`(2,408) が `s.stats[key]` を直接書き換える
- `clampEquippedLists`(2,216) が `s` の4フィールドを直接書き換える
- 不変性を支えているのはメインループの**手書き22個リスト**（5,075–5,114行）

### 進め方

1. まず Phase 3 の RNG 注入を済ませる（でないと変更前後の同一性を検証できない）
2. 「同じ seed・同じ初期 state から N ヶ月進めた結果が完全一致する」テストを先に書く
3. そのテストを緑に保ったまま、エンジン関数を1つずつ「新しいオブジェクトを返す」形に変える
4. 全部終わったらメインループの手書きクローンを削除する

### 位置引数の解消もここで

- `createInitialState`: 位置引数 22〜26個・呼び出し4箇所にコピペ
- `computeIndividualStatCaps`: 位置引数 17個

どちらもオブジェクト1個を受ける形に変える。**リファクタの効果が一番大きい箇所。**

---

## Phase 5: UI コンポーネント分割

JSX 2,500行（6,659–9,166）を切り出す。

### 5-1. 先に共通部品を作る（ここで一番行数が減る）

JSX 内に `<button>` が60個、`className` が424箇所。パターンは明確。

| 部品 | 出現 | 用途 |
|---|---:|---|
| **`PurchaseCard`** | **8箇所** | 左上=名前 / 右上=Lv.n/m / 中段=効果 / 下段=価格 or MAX or 🔒 |
| **`SelectableCard`** | **6箇所** | 選択中 / 解放済 / 未解放 の3〜4配色 |
| `ProgressBar` | 4箇所 | 範囲内の `style={{}}` はこの4つが全部 |
| `SubTabBar` | 3箇所 | 投資 / ゲノム / タイムリープ |
| `ConfirmButton` | 3箇所 | 押す→「実行確定/取消」に化ける2段階確認 |
| `CodexCard` | 3箇所 | 達成は色付き / 未達成は「？？？」「🔒」でマスク |
| `BuyAmountSelector` | 2箇所 | 1x/10x/MAX（**完全な重複コード**） |
| `HideCompletedToggle` | 2箇所 | 「未コンプのみ」（**完全な重複**） |

**`PurchaseCard` と `SelectableCard` の2つを作るだけで、JSX 下部の約1,400行が半分以下になる。**
状態→配色のマッピングが今は各所にベタ書きの三項演算子3〜4段なので、
Phase 1-2(d) で決めた `tone` enum をここで使う。

### 5-2. 切り出す順

**第1陣（state依存が浅い・壊れにくい）**

| 部品 | 元の行 | props |
|---|---|---|
| `ToastStack` | 8,846付近 | `toasts` |
| `ChronicleDrawer` | 8,813付近 | `log`, `onClose` |
| `TutorialModal` | 8,862付近 | `open`, `onClose` |
| `HelpSaveModal` | 9,063付近 | ※ JSX内の `localStorage.removeItem` を先にハンドラへ出す |
| `HallTab` | 8,748付近 | `unlockedEndings`, `hallOfFame` |
| `MatchRecordStrip` | 7,161付近 | 成績6値 |
| `LastMatchReport` | 7,258付近 | `report`, `highlightLines` |

**第2陣（タブ単位）**

`MatchesTab` / `SocialTab` / `UpgradesTab` / `GenomesTab` / `ReincarnateTab` /
`BottomTabPanel` / `TrainingPanel`

**第3陣（モーダル）**

`PlayerCreatorModal` / `CareerChoiceModal` / `RetirementModal`

### 5-3. props 爆発を抑える

`gameState` が巨大（約120キー）なので、14個のコンポーネントすべてに個別 props を書くと
宣言行だけで数百行になる。

→ **Context 1本**（`GameContext` に `gameState` / `setGameState` / ハンドラ群 / 派生値）を置き、
タブ単位コンポーネントはそこから取る。
個別 props にこだわるのは第1陣の純表示部品だけでいい。

### 5-4. 先にハンドラへ出しておくもの

- 9,096–9,114付近: 「本当に完全消去する」の onClick に
  `localStorage.removeItem(SAVE_KEY)` と `LEGACY_SAVE_KEYS` のループ、try/catch、
  `creatorModal` の初期値オブジェクトが丸ごと直書きされている（**JSX内に永続化処理がある唯一の箇所**）
- 8,534–8,540付近: 第2〜第5段階転生の**名称決定ロジックが三項演算子4段で JSX に直書き**。
  `stageBadges` 配列（6,573付近）と同じ概念が2箇所に分かれている

---

## Phase 6: useReducer / useMemo

### 6-1. state のグループ分け

現状 `useState` 20個。4グループに分ける:

| reducer | 対象 |
|---|---|
| `gameReducer` | `gameState`（ゲーム本体） |
| `uiNavReducer` | `bottomTab`, `investSubTab`, `genomeSubTab`, `leapSubTab`, `buyAmount`, `showLogDrawer` 等 |
| `modalReducer` | `creatorModal`, `careerChoiceModal`, `truckEventModal`, `tutorialModalOpen`, `confirmReincarnate`, `confirmAscend` |
| `useToasts` | トースト（カスタムフック） |

> **Phase 4 を終えるまで `gameReducer` 化はしない。** ミューテーションが残ったまま
> reducer にすると、React の開発時二重実行で state が二重適用される。

### 6-2. `useMemo` の導入

派生値 約60個（6,497–6,657）が毎レンダー走り、
さらに JSX 内で `calcBulkPurchase` をカード1枚ごとに呼んでいる（MAX時は内部でループ）。
ゲームループが毎ティック `setGameState` するので実質毎ティック全件再計算。

同時に:
- `top3ClosestGenomes`（6,607付近）と JSX（8,200付近）が**同じ計算を2回している**
- 融合ゲノムの親Lv表示で `BASE_GENOME_DEF.find()` をレンダー内で線形探索（8,272付近）

### 6-3. `pushToast` の貫通を解消

`pushToast` がエンジン全階層に渡っていて、`suppressToast` がシグネチャを汚染している。
エンジンは「起きた出来事」を返すだけにして、トースト化は UI 層でやる。

---

## Phase 7: 仕上げ

### 7-1. Tailwind を Play CDN からビルドへ

`index.html` の `<script src="https://cdn.tailwindcss.com">` を外し、
`@tailwindcss/vite` を入れる。**現状は CDN が落ちたら本番のスタイルが全部消える。**

移行時の注意:
- 任意値クラスが多用されている（`text-[7.5px]`, `min-h-[78px]`, `leading-[13px]` 等）。全部効くか要確認
- **`py-0.2`（6,660付近）は Tailwind に存在しないスケール値**。無効クラスとして黙って落ちている
- `src/App.css` / `src/index.css` は Vite スターターの残骸で App.jsx は参照していない

### 7-2. アクセシビリティ

JSX 2,500行に `aria-*` / `role=` / `onKeyDown` が **0件**。効果の大きい順:

1. **hover 限定の情報チャネル**（5箇所）: `onMouseEnter` でインスペクタに説明を出すが
   対応する `onFocus` がない。**`onFocus` を足すだけで直る**
2. **モーダル5枚に Esc もフォーカストラップもない**。`role="dialog"` `aria-modal` も無し
3. **トーストが `pointer-events-none`** で手動で閉じられない
4. **文字が `text-[7.5px]` 級**。しかも root に `select-none` が掛かっていてコピーもできない
5. `disabled` の理由が視覚だけ（`aria-describedby` で紐付いていない）

### 7-3. プロジェクトの体裁

- `package.json` の `name` が `vite-react-typescript-starter` のまま
- `index.html` の `<title>` が `Vite + React + TS` のまま
- README がテンプレートのまま
- WASM 回避の名残の依存（`@napi-rs/wasm-runtime` / `@emnapi/core` / `@emnapi/runtime`）が残っている
- 古いリモートブランチ `inuyuna/footballchronicle`（v0.1 で停止、main が先行）の扱いを決める

---

## 各フェーズの想定効果

| Phase | App.jsx の行数 | 主な効果 |
|---|---|---|
| 現在 | 9,166 | — |
| Phase 1 後 | 約 6,550 | データ・ユーティリティが独立。テストが書ける |
| Phase 2 後 | 約 6,400 | 表示と課金のズレが構造的に起きなくなる |
| Phase 3 後 | 約 6,400 | **バランスシミュレーションが可能になる** |
| Phase 4 後 | 約 6,200 | state 汚染が起きなくなる |
| Phase 5 後 | 約 2,500 | UI が部品単位でレビューできる |
| Phase 6 後 | 約 1,500 | 毎ティック全件再計算がなくなる |
