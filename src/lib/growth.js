// 能力上限を超えたあとの伸び方。
//
// なぜ切り出したか:
//   同じ式が applyStatGrowth（実際の加算）と getDrillEffectiveStats（UIの予測表示）
//   の2箇所にコピーされていて、片方だけ直すと「表示と実挙動がズレる」事故になる。
//   実際にバランス調整で踏んだ。docs/REFACTOR_PLAN.md Phase 2-2。

/** 限界突破の極意書を持っているときの、上限超過後の伸び率 */
export const LIMIT_BREAK_OVER_RATIO = 1 / 15;

/** 何も持っていないときの、上限超過後の伸び率 */
export const BASE_OVER_RATIO = 1 / 45;

/**
 * 上限を超えたあとに、その成長量のうち何割が実際に乗るか。
 *
 * ここが大きいと「能力上限を上げる」意味が薄れ、
 * 才能限界突破（cap_breaker）が死にアップグレードになる。
 * 実測では上限より成長率を買う方が46%強かった（docs/BALANCE_LOG.md ⑦）。
 *
 * @param {boolean} hasLimitBreak 限界突破の極意書を持っているか
 * @param {number} challengeMult 縛りチャレンジによる倍率（通常1.0）
 */
export function overCapRatio(hasLimitBreak, challengeMult = 1) {
  return (hasLimitBreak ? LIMIT_BREAK_OVER_RATIO : BASE_OVER_RATIO) * challengeMult;
}
