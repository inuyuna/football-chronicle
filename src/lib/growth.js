// 能力上限を超えたあとの伸び方。
//
// なぜ切り出したか:
//   同じ式が applyStatGrowth（実際の加算）と getDrillEffectiveStats（UIの予測表示）
//   の2箇所にコピーされていて、片方だけ直すと「表示と実挙動がズレる」事故になる。
//   実際にバランス調整で踏んだ。docs/REFACTOR_PLAN.md Phase 2-2。

/** 限界突破の極意書を持っているときの、上限超過後の伸び率 */
export const LIMIT_BREAK_OVER_RATIO = 1 / 40;

/** 何も持っていないときの、上限超過後の伸び率 */
export const BASE_OVER_RATIO = 1 / 120;

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

/**
 * 上限を超えた量に応じた追加の逓減。
 *
 * 旧式は 1/(1 + excess*7) の双曲線だったため、
 * 時間さえかければ上限の数百倍まで伸ばせた（val が sqrt(t) で増える）。
 * 本人指摘（2026-11-23）:
 *   「上限以上に能力が上がるのはいいが、減衰率をどんどんきつくしていくべき」
 *
 * 指数減衰に変える。上限と同じだけ超過したら 1/4、2倍超過で 1/16。
 * 伸びは止まらないが、超過が進むほど加速度的に無意味になる。
 *
 * @param {number} val 現在値
 * @param {number} cap 上限
 */
export function overCapDiminishing(val, cap) {
  const excessRatio = Math.max(0, (val - cap) / Math.max(8, cap));
  // v0.36 で 2.0 -> 3.5 に強めた。本人の指摘（2026-11-26）:
  //   「能力値が限界に達してからそれ以上に強くなる部分の係数をもっともっと下げろ。
  //     能力上限が意味を持たなくなっている」
  return Math.max(1e-9, Math.pow(0.5, excessRatio * 3.5));
}
