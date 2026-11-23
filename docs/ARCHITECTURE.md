# ARCHITECTURE — Football Chronicle の現在地

最終更新: 2026-11-23 / 対象: `src/App.jsx` 10,118行

このファイルは「いまコードがどうなっているか」の地図。
「どう直すか」は [REFACTOR_PLAN.md](REFACTOR_PLAN.md)、「ゲームのルール」は [GAME_SPEC.md](GAME_SPEC.md) に分けてある。

---

## 1. ひとことで言うと

**アプリの大半が `src/App.jsx` 1ファイルに入っている。**
`src/lib/` への切り出しが始まったところ（Phase 1 の最初の一歩）。

| ファイル | 役割 | 行数 |
|---|---|---|
| `src/App.jsx` | データ定義・ゲームエンジン・UI の全部 | **10,118** |
| `src/lib/format.js` | `formatYen` / `formatNum`（テスト済み） | 28 |
| `src/lib/purchase.js` | `calcBulkPurchase` / `calcBulkSingleResource`（テスト済み） | 43 |
| `src/main.tsx` | `StrictMode` でマウントするだけ | 11 |
| `src/App.css` / `src/index.css` | Vite スターターの残骸。App.jsx は一切参照していない | — |
| `index.html` | Tailwind を **Play CDN** で読み込んでいる（後述の注意点） | 18 |

React のフック使用状況（App.jsx 全体）:

| フック | 個数 |
|---|---|
| `useState` | 20 |
| `useCallback` | 10 |
| `useEffect` | 4 |
| `useRef` | 2 |
| **`useMemo`** | **0** |
| **`useReducer`** | **0**（import すらされていない） |

---

## 2. 層の地図（行範囲つき）

> ⚠️ 行番号は変更のたびにずれる。**関数名・定数名で grep するのが確実。**
> ここの数字は「だいたいこのへん」の目安として使う。

```
src/App.jsx  (10,118行)
├─ 1–40        import（React + lucide-react + ./lib/* + ./data/*）
│               ※ lib: format / purchase / growth / softcap
│               ※ data: romanceEvents / flavorText / generationUnlocks
│
├─ 42–2,250    【データ層】定数
│               ※ モジュールスコープ。App の外にある = そのまま切り出せる
│               ※ LOCAL_CLUB_REQ_CAT / MAX_LEGACY_LV_SUM を追加（v0.35）
│
├─ 2,255–2,673 【純粋ユーティリティ】
│   ├─ 2,255  computeIndividualStatCaps（位置引数19個 / ageCapMult 込み）
│   ├─ 2,480  applyStatGrowth
│   └─ 2,511  getDrillEffectiveStats（UI予測。実挙動と同じ式を二重に持つ）
│
├─ 2,675      MiniBar（唯一のサブコンポーネント）
│
└─ 2,726–10,118  export default function App()
   ├─ 2,728      createInitialState
   ├─ 3,459      addZoneCharge
   ├─ 3,488      calculateLegacyGain
   ├─ 3,568      checkGenomeAwakening（ED達成で pendingEnding を立てる）
   ├─ 3,734      executeDrillInternal（成長倍率にソフトキャップ）
   ├─ 3,993      simulateAutoMatch（試合戦力にソフトキャップ / 1周目×0.42）
   ├─ 4,497      triggerRandomLifeEvent
   ├─ 4,542–     advanceOneMonth（自動購入・加齢・引退判定）
   ├─             メインゲームループ（setInterval）
   ├─             UIハンドラ（doRomanceEvent / selectProtege / upgradeLocalClubTier …）
   ├─             派生値（毎レンダー再計算 / useMemo なし）
   └─             JSX（タブ・モーダル6種）
```

### データ層（30–2,054）の内訳

定数 30個。代表的なもの:

| 定数 | 件数 | 中身 |
|---|---|---|
| `BASE_GENOME_DEF` | **45** | 通常23 / 体格4 / 進路18。`getStatVal(s)` ÷ `step` で Lv が決まる自動解放型 |
| `CATEGORIES` | 19 | 所属カテゴリ（キッズスクール→J1→欧州→W杯→宇宙評議会） |
| `LEGACY_UPGRADES_DEF` | 13 | 第1段階転生（継承結晶） |
| `FUSED_GENOME_DEF` | 12 | 融合ゲノム |
| `UPGRADES_DEF` | 9 | 道具・自己投資 |
| `CHALLENGES_DEF` / `ASCENSION_UPGRADES_DEF` / `SYNERGY_COMBOS_DEF` | 各8 | 縛り / 上位転生 / 共鳴コンボ |
| `ENDINGS_DEF` / `POSITION_TRAITS_DEF` / `BREAKTHROUGHS_DEF` | 各7 | ED / ハイブリッド特性 / ブレイクスルー |

**定数どうしの実依存は 1本だけ**: `BASE_GENOME_DEF` → `POSITIONS`
（`total_player_dna` の `getStatVal` が `Object.keys(POSITIONS)` を使う）。
他はすべて「id を文字列で持つ」間接参照なので、分割しても import は増えない。

### 純粋ユーティリティ

**切り出し済み（`src/lib/` / テストあり）**

| 関数 | 場所 | 備考 |
|---|---|---|
| `formatYen` / `formatNum` | `src/lib/format.js` | 兆・億・万の分岐が丸ごと重複している。統合は Phase 2-4 |
| `calcBulkPurchase` | `src/lib/purchase.js` | 二重通貨（資金+戦術Pt）の 1x/10x/MAX 一括購入 |
| `calcBulkSingleResource` | `src/lib/purchase.js` | 単一通貨版。`calcBulkPurchase` とループ構造が同一 |

**App.jsx に残っているもの（2,060–2,537）**

| 関数 | 行 | 備考 |
|---|---|---|
| `getCareerStageInfo` | 2,060 | ライフステージ（衰え期の成長減衰込み） |
| `getDynamicHeight` | 2,074 | 年齢連動の身長 |
| `getSquadRoleInfo` | 2,082 | **`CATEGORIES[categoryId]` と添字アクセス**（id と index の一致前提） |
| `getHabitMilestoneMult` | 2,093 | 習慣熟練のマイルストーン倍率 |
| `getTotalRating` | 2,105 | tec+phy+iq+sht |
| `getEffectiveMaxResources` | 2,111 | オーバーチャージ適用後の体力・精神上限 |
| `getActiveSynergies` | 2,120 | **try/catch で例外を握りつぶしている** |
| `computeMaxCharmSlots` | 2,131 | お守り枠（最大5） |
| `computeMaxTraitSlots` | 2,139 | 特性枠（最大6） |
| `clampEquippedLists` | 2,155 | **引数 `s` を直接ミューテート** |
| `computeIndividualStatCaps` | 2,169 | **位置引数 17個**。能力上限算出の中核（175行） |
| `applyStatGrowth` | 2,347 | **引数 `s.stats[key]` を直接ミューテート** |
| `getDrillEffectiveStats` | 2,379 | 140行。乗算の塊。予想成長量の算出 |
| `computeOptimalAutoList` | 2,521 | AUTO枠の最適練習リスト |

（モジュール先頭寄りに `getUnrivaledRank` / `getFanRankInfo` もあるが、
定数定義の間に挟まっている。詳細は [GAME_SPEC.md](GAME_SPEC.md)）

---

## 3. データフロー

```
setInterval (tickMs = max(125, 1000/gameSpeed))
  │
  └─ setGameState(prev => {
       if (prev.isRetired) return prev
       if (prev.pendingModal) return prev        ← モーダル待ちの間は時間を止める
       next = { ...prev, <22個のネストを手書きで浅くコピー> }
       const requested = advanceOneMonth(next)   ← next を直接ミューテートする
       if (requested) next.pendingModal = requested   ← null で上書きしない
       return next
     })
       │
       ├─ advanceOneMonth が内部で呼ぶもの:
       │    executeDrillInternal / simulateAutoMatch /
       │    triggerRandomLifeEvent / checkGenomeAwakening /
       │    applyStatGrowth / computeIndividualStatCaps …
       │
       └─ 戻り値 = { type:'career'|'truck', modal:{...} } または null
            │
            └─ useEffect([gameState.pendingModal])  ← 開くだけ。ここでは消さない
                 └─ setCareerChoiceModal / setTruckEventModal
                      │
                      └─ 選択・確定したハンドラが pendingModal を null にする
                         （handleSelectCareerPath / handleProceedFromTruckModal）
```

### この経路が3回壊れていた（2026-11-19 に修正）

1. **戻り値が常に捨てられていた**
   `setGameState` の updater 内でローカル変数に代入し、直後に読んでいた。
   React 18 以降 updater は非同期に実行されるため読む時点では必ず `null`。
   **進路選択と引退が一度も発火しなかった** = 周回要素がゲーム内から到達不能だった。

2. **モーダル表示中にタブを閉じると消えていた**
   `pendingModal` をオートセーブから除外していたため、
   `triggeredEvents` のフラグだけ立って進路選択が永久に失われた。
   → **`pendingModal` も永続化する。** 放置ゲームなのでタブを閉じるのは普通の操作。

3. **次のティックが `null` で上書きしていた**
   モーダルを開く useEffect が走るまでの1ティック分で次の月が進み、
   積んだ `pendingModal` が消えることがあった（タイミング依存。15歳の進路が実際に飛んだ）。
   → **updater の先頭で `prev.pendingModal` をガードし、代入も「返ってきたときだけ」にする。**

いずれも `git log` の `8f68da8` 以降を参照。
**この3つは「ゲームの根幹が動いていなかった」という同じ一点に収束する。**
7歳から22歳の強制タイムリープ → 第2周目開始までを実機で通して確認済み。

---

## 4. 構造上の弱点（リファクタの根拠）

優先度順。詳細な対処は [REFACTOR_PLAN.md](REFACTOR_PLAN.md)。

### 🔴 P0: エンジンが state を直接ミューテートする

`advanceOneMonth` と配下のエンジン関数群は、受け取った `newState` を書き換えていく。
不変性を保っているのは、メインループが手書きで並べた **22個のネストオブジェクトの浅いコピーだけ**。
このリストに載っていないネストが増えた瞬間、前の state が汚染される。

→ **`advanceOneMonth` の分割や useReducer 化より先に、ここを潰す必要がある。**
順序を間違えると、分割後に原因不明の state 汚染が出る。

### 🔴 P0: `Math.random()` がエンジン内に 7箇所直書き

試合結果・人生イベント・宿敵決闘などが直接 `Math.random()` を呼ぶ。
**同じ入力から同じ結果を再現できない = テストもバランスシミュレーションも書けない。**

→ RNG を引数で注入する形に変える。これが自動化の前提条件。

### 🔴 P0: 未定義識別子を通す網が二重に空いている

- `_oxlintrc.json` に `no-undef` がない
- `tsconfig.app.json` に `allowJs` がないので `.jsx` は `tsc -b` の対象外

実際にこれで 3件の未定義識別子（うち1件はゲームを落とすもの）が本番まで素通りしていた。
`tsconfig.check.json` を追加して検出できるようにしたが、CI に組み込むまでが対策。

### 🟠 P1: 価格計算が JSX とハンドラで二重に書かれている

「表示する値段」と「実際に引かれる値段」が別の場所に同じ数字で書かれている。
片方だけ動かすと**表示と課金が静かにズレる**。

| 項目 | JSX側 | ハンドラ側 | 重複している定数 |
|---|---|---|---|
| 未来予知・競馬記憶 | 7,989付近 | 5,296 | `22000, 120, 1.82`, maxLv `20` |
| 蒼空FCクラブ昇格 | 7,857付近 | 5,432付近 | `35000, 140, 2.25`, maxLv `7` |
| スクール巡業 | 8,015付近 | 5,317付近 | `400`(ファン), `15000`(円) |
| シグネチャーブランド | 8,032付近 | 5,346付近 | `1500, 35000, 1.65`, maxLv `30` |
| 青空FC財団3種 | **定義が JSX にしかない** | 5,458付近 | 成長率 `1.38` |

### 🟠 P1: `useMemo` がゼロ

派生値 約60個（6,497–6,657）が毎レンダー全部走る。
さらに JSX 内で `calcBulkPurchase` をカード1枚ごとに呼んでいる（MAX購入時は内部でループ）。
ゲームループが毎ティック `setGameState` するので、**実質毎ティック全件再計算**。

### 🟠 P1: Tailwind が Play CDN

`index.html` が `<script src="https://cdn.tailwindcss.com">` を読んでいる。
`package.json` に tailwindcss の依存はない。
つまり**ビルド成果物に CSS が含まれず、本番でも実行時に CDN の JIT が動いている**。
CDN が落ちたらスタイルが全部消える。

### 🟠 P1: `createInitialState` の位置引数 22〜26個 / `computeIndividualStatCaps` の位置引数 17個

呼び出し側が 4箇所にコピペされている。引数の順番を間違えても誰も気づかない。

### 🟡 P2: オートセーブが毎ティック同期書き込み

`useEffect([gameState])` で `JSON.stringify(gameState)` を `localStorage` へ。
state は毎ティック変わるので、125ms〜1000ms ごとに全 state をシリアライズしている。

### 🟡 P2: アクセシビリティがゼロ

JSX 2,500行に `aria-*` / `role=` / `onKeyDown` が **0件**。
`title=` も 1件だけ。モーダル5枚すべてに Esc もフォーカストラップもない。
`text-[7.5px]` 級の文字が常用され、root に `select-none` が掛かっているのでコピーもできない。

---

## 5. 既知のゲームバランス上のバグ

実装と説明文が食い違っているもの。[GAME_SPEC.md](GAME_SPEC.md) に詳細。

1. **進路ゲノムの成長ボーナスに Lv5 クランプが掛かっていない**（`getDrillEffectiveStats` 内 9箇所）。
   説明文と上限ボーナス側は `Math.min(5, lv)` なのに、成長倍率側だけ素の Lv を掛けている。
   同じ関数内の `young_pro_dna` だけ正しくクランプされている = 書き忘れ。
   Lv50 なら説明の +20% ではなく +200% になる。
2. **`applyStatGrowth` だけチャレンジ中のブレイクスルー封印を見ていない**。
   UI の予想成長量は 1/18 で表示されるのに、実際の加算は 1/6 で走る。
3. **`world_acad_12_dna` / `galaxy_cantera_15_dna` の上限ボーナス表記が実値と 3倍ずれている**。

---

## 6. 開発環境の注意点

### Vite 8 (rolldown) は使えない

このマシン（ARM64 Windows）では Windows の Application Control ポリシーが
**未署名の `.node` の DLL ロードをブロック**する。rolldown はネイティブバインディングを
`.node` で読むため、`ERR_DLOPEN_FAILED` でビルドが落ちる。

Vite 7 の esbuild は `esbuild.exe` を子プロセスで起動する形なのでポリシーの対象外。
**`vite@^7` / `@vitejs/plugin-react@^5` に固定すること。**

WASM 版（`@rolldown/binding-wasm32-wasi`）も試したが、WASI が Windows パスを解決できず
`vite.config.ts` をエントリとして解決できなかった。この道は閉じている。

### `package.json` に残っている不要な依存

WASM 回避を試した名残。Vite 7 では不要:
`@napi-rs/wasm-runtime` / `@emnapi/core` / `@emnapi/runtime`

### dev サーバーの起動

`.claude/launch.json`（`Desktop\Claud` 側）に `football-chronicle` が定義済み。
`npm run dev --prefix <path>` では cwd が変わらず `vite.config.ts` を解決できないため、
`cmd /c cd /d <path> && npm run dev` の形にしてある。

---

## v0.35 で増えたもの（2026-11-23）

### `src/lib/`

| ファイル | 役割 |
|---|---|
| `softcap.js` | 乗算で積み上がる倍率の対数圧縮。**新しい倍率を足すときは必ずこの内側に入れる** |
| `growth.js` | `overCapRatio` に加えて `overCapDiminishing`（上限超過の指数減衰）|

### `src/data/`

| ファイル | 役割 |
|---|---|
| `flavorText.js` | エンディング7種 / タイムリープ（周回帯で5パターン）/ 上位転生（段階別4パターン）/ 宿敵の初対面 |
| `romanceEvents.js` | 恋愛の段階定義と、相手4人 × 節目5段階の本文 |
| `generationUnlocks.js` | 周回ごとの機能解放（v0.3）|

### state に増えたキー

| キー | 意味 |
|---|---|
| `pendingEnding` | エンディング／上位転生の本文モーダル。立っている間はゲームループが止まる |
| `lastRomanceMonth` | 恋愛の月1回制限 |
| `lastProtegeMonth` | 師弟特訓の月1回制限 |
| `patronPaid` | 15歳の支援金を受け取ったか |

### 「同じ式を二重に持っている」箇所（触るときは両方）

| 実挙動 | UI予測 |
|---|---|
| `executeDrillInternal` の `rawMult` → `softcap` | `getDrillEffectiveStats` の `rawGlobalMult` → `softcap` |
| `applyStatGrowth` の `overCapDiminishing` | `getDrillEffectiveStats` の `overCapDiminishing` |
| `doRomanceEvent` | `advanceOneMonth` 内の自動消化（秘書Lv2）|

片方だけ直すと「表示と実挙動がズレる」。実際にバランス調整で踏んでいる。
