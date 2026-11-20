// 日本円・一般数値のフォーマット。
//
// 方針（本人指示 2026-11-20）:
//   - 小数点は使わない。「1.23億」ではなく「1億2345万」
//   - 桁が増えたら単位を伸ばす。兆 → 京 → 垓 → 𥝱
//     （放置ゲームなので天文学的な数字まで行く）

/** 大きい順。日本語の万進法 */
const UNITS = [
  { v: 1e24, label: '𥝱' },
  { v: 1e20, label: '垓' },
  { v: 1e16, label: '京' },
  { v: 1e12, label: '兆' },
  { v: 1e8, label: '億' },
  { v: 1e4, label: '万' }
];

/**
 * 上位2単位までの複合表記にする。小数点は使わない。
 *   1234        → "1,234"
 *   15000       → "1万5000"
 *   123456789   → "1億2345万"
 *   1.5e16      → "1京5000兆"
 */
function compose(num) {
  const sign = num < 0 ? '-' : '';
  let abs = Math.floor(Math.abs(num));

  if (abs < 1e4) return sign + abs.toLocaleString('ja-JP');

  const parts = [];
  for (const u of UNITS) {
    if (abs < u.v) continue;
    const q = Math.floor(abs / u.v);
    parts.push(`${q}${u.label}`);
    abs -= q * u.v;
    if (parts.length >= 2) break;
  }
  // 万未満の端数（1単位しか出せなかったとき）はそのまま付ける。1万5000 など
  if (parts.length === 1 && abs > 0) parts.push(String(abs));
  return sign + parts.join('');
}

export const formatYen = (val) => {
  const num = Number(val || 0);
  if (!Number.isFinite(num)) return '0円';
  return `${compose(num)}円`;
};

export const formatNum = (val, decimals = 0) => {
  const num = Number(val || 0);
  if (!Number.isFinite(num)) return '0';

  // 小数を見せたい場面（総合力など）だけは decimals を尊重する。
  // ただし1万以上は単位表記に切り替える。
  if (decimals > 0 && Math.abs(num) < 1e4) {
    return num.toLocaleString('ja-JP', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });
  }
  return compose(num);
};
