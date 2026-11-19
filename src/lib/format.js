// 日本円・一般数値のフォーマット（万・億・兆対応）
// App.jsx から切り出した純粋関数。副作用なし。

export const formatYen = (val) => {
  const num = Math.floor(Number(val || 0));
  if (!Number.isFinite(num)) return '0円';
  const abs = Math.abs(num);
  if (abs >= 1e12) return `${(num / 1e12).toFixed(2)}兆円`;
  if (abs >= 1e8) return `${(num / 1e8).toFixed(2)}億円`;
  if (abs >= 1e4) return `${(num / 1e4).toFixed(1)}万円`;
  return `${num.toLocaleString('ja-JP')}円`;
};

export const formatNum = (val, decimals = 0) => {
  const num = Number(val || 0);
  if (!Number.isFinite(num)) return '0';
  const abs = Math.abs(num);
  if (abs >= 1e12) return `${(num / 1e12).toFixed(2)}兆`;
  if (abs >= 1e8) return `${(num / 1e8).toFixed(2)}億`;
  if (abs >= 1e4) return `${(num / 1e4).toFixed(1)}万`;
  if (decimals > 0) {
    return num.toLocaleString('ja-JP', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });
  }
  return Math.floor(num).toLocaleString('ja-JP');
};
