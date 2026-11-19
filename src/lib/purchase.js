// 一括購入計算（1x / 10x / MAX 全項目統一）
// App.jsx から切り出した純粋関数。副作用なし。
//
// 注意: calcBulkPurchase の availG / availPt は「資金 / 戦術Pt」という名前だが、
// 呼び出し側によっては別のリソース（ファン数 / 資金）を流用している箇所がある。
// 詳細は docs/REFACTOR_PLAN.md の Phase 2-4 を参照。

export const calcBulkPurchase = (curLv, maxLv, buyAmount, availG, availPt, baseG, basePt, growth) => {
  const limit = buyAmount === 'max' ? maxLv - curLv : Math.min(buyAmount, maxLv - curLv);
  let count = 0;
  let totalG = 0;
  let totalPt = 0;
  for (let i = 0; i < limit; i++) {
    const lv = curLv + i;
    const cG = Math.floor(baseG * Math.pow(growth, lv));
    const cPt = Math.floor(basePt * Math.pow(growth, lv));
    if (availG >= totalG + cG && availPt >= totalPt + cPt) {
      totalG += cG;
      totalPt += cPt;
      count += 1;
    } else {
      break;
    }
  }
  return { count, totalG, totalPt, nextLv: curLv + count };
};

export const calcBulkSingleResource = (curLv, maxLv, buyAmount, availRes, baseCost, growth) => {
  const limit = buyAmount === 'max' ? maxLv - curLv : Math.min(buyAmount, maxLv - curLv);
  let count = 0;
  let totalCost = 0;
  for (let i = 0; i < limit; i++) {
    const c = Math.floor(baseCost * Math.pow(growth, curLv + i));
    if (availRes >= totalCost + c) {
      totalCost += c;
      count += 1;
    } else {
      break;
    }
  }
  return { count, totalCost, nextLv: curLv + count };
};
