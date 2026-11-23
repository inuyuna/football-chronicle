// 乗算で積み上がる倍率を、対数で圧縮する。
//
// なぜ必要か（実測 2026-11-23 / docs/BALANCE_LOG.md ⑮）:
//   成長倍率も試合戦力も、要素ごとの倍率を素直に掛け算している。
//   ゲノム・融合・特性・道具・弟子・恋人・クラブ・趣味・ED・チャレンジ、
//   どれも「+2%」「×1.16」という小さな値だが、30個も掛かると指数で爆発する。
//
//   その結果、同じ実装が二つの顔を持っていた:
//     - 要素を揃えていない状態（計測）: 3周かけても地元中学止まり。遅すぎる
//     - 要素を全部揃えた状態（実プレイ）: 3周でフットボールの創世神。速すぎる
//
//   どちらかの係数をいじっても、もう片方が壊れる。
//   「素のときはそのまま、積み上がったときだけ効率が落ちる」形が要る。
//
// 本人の方針（2026-11-19）:
//   「上は行けるが極端に効率が落ちる」
//
// 性質:
//   - threshold 以下は一切変えない（序盤・素の状態に影響しない）
//   - threshold を超えると対数で伸びる。上限はない（積めば必ず強くはなる）
//   - 10倍積んでも2倍ぶんにしかならない、という領域に入る

/**
 * @param {number} value     圧縮したい倍率（1.0 が等倍）
 * @param {number} threshold ここまでは素通し
 * @param {number} strength  小さいほど強く圧縮する（0.4〜1.0 を想定）
 */
export function softcap(value, threshold, strength = 0.6) {
  if (!Number.isFinite(value) || value <= threshold) return value;
  if (threshold <= 0) return value;
  const over = value / threshold - 1;
  return threshold * (1 + Math.log(1 + over * strength) / strength);
}

/** 練習の成長倍率に使う閾値 */
export const GROWTH_SOFTCAP = { threshold: 6, strength: 0.6 };

/** 試合の戦力倍率に使う閾値。試合は勝敗が離散なので、成長より少し緩める */
export const POWER_SOFTCAP = { threshold: 8, strength: 0.7 };
