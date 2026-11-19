// 決定論的な擬似乱数（mulberry32）
//
// なぜ必要か:
//   ゲームエンジンが Math.random() を直接呼んでいると、同じ入力から同じ結果を
//   再現できない。つまり回帰テストもバランスシミュレーションも書けない。
//   乱数の種を state に持たせることで、「このセーブから N ヶ月進めた結果」が
//   常に一致するようになる。
//
// 設計:
//   s.rngState を直接書き換える。エンジンが state をミューテートしていく
//   既存の流儀に合わせてある（docs/REFACTOR_PLAN.md の Phase 4 でまとめて
//   不変に直す予定）。
//   rngState を持たない古いセーブは、初回の呼び出し時にランダムな種で
//   自動的に初期化されるのでマイグレーションは不要。

/** 新しい種を作る（ゲーム開始時・転生時に使う） */
export const createSeed = () => (Math.random() * 0x100000000) >>> 0;

/**
 * state の種を1つ進めて 0 以上 1 未満の値を返す。
 * Math.random() の置き換えとしてそのまま使える。
 *
 * @param {{ rngState?: number }} s 種を保持するオブジェクト（gameState など）
 * @returns {number} 0 <= x < 1
 */
export function nextRandom(s) {
  if (typeof s.rngState !== 'number' || !Number.isFinite(s.rngState)) {
    s.rngState = createSeed();
  }
  let t = (s.rngState = (s.rngState + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), 1 | t);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/**
 * 単体の乱数生成器を作る。シミュレーションやテストで使う。
 *
 * @param {number} seed
 * @returns {(() => number) & { getState: () => number }}
 */
export function createRng(seed) {
  const holder = { rngState: seed >>> 0 };
  const fn = () => nextRandom(holder);
  fn.getState = () => holder.rngState;
  return fn;
}
