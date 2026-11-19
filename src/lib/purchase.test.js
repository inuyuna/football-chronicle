import { describe, expect, it } from 'vitest';
import { calcBulkPurchase, calcBulkSingleResource } from './purchase.js';

// 価格式: cost(lv) = floor(base * growth^lv)
// base=1000 / growth=1.5 のとき Lv0..: 1000, 1500, 2250, 3375, 5062, ...

describe('calcBulkPurchase（資金 + 戦術Pt の二重通貨）', () => {
  it('1x は1レベルだけ買う', () => {
    expect(calcBulkPurchase(0, 10, 1, 1e9, 1e9, 1000, 10, 1.5)).toEqual({
      count: 1,
      totalG: 1000,
      totalPt: 10,
      nextLv: 1
    });
  });

  it('10x と max は maxLv で頭打ちになる（maxLv=10, curLv=0 なので同値）', () => {
    const tenX = calcBulkPurchase(0, 10, 10, 1e9, 1e9, 1000, 10, 1.5);
    const maxX = calcBulkPurchase(0, 10, 'max', 1e9, 1e9, 1000, 10, 1.5);
    expect(tenX).toEqual(maxX);
    expect(maxX).toEqual({ count: 10, totalG: 113326, totalPt: 1128, nextLv: 10 });
  });

  it('資金ちょうどで止まる（1000 + 1500 = 2500、次の2250が買えない）', () => {
    expect(calcBulkPurchase(0, 10, 'max', 2500, 1e9, 1000, 10, 1.5)).toEqual({
      count: 2,
      totalG: 2500,
      totalPt: 25,
      nextLv: 2
    });
  });

  it('戦術Ptが1レベル分に足りなければ0個', () => {
    expect(calcBulkPurchase(0, 10, 'max', 1e9, 5, 1000, 10, 1.5)).toEqual({
      count: 0,
      totalG: 0,
      totalPt: 0,
      nextLv: 0
    });
  });

  it('maxLv に到達済みなら何も買わず nextLv は現状維持', () => {
    expect(calcBulkPurchase(10, 10, 'max', 1e9, 1e9, 1000, 10, 1.5)).toEqual({
      count: 0,
      totalG: 0,
      totalPt: 0,
      nextLv: 10
    });
  });

  it('途中Lvからでも価格は現在Lvを基準に計算される', () => {
    // Lv5 の価格 = floor(1000 * 1.5^5) = 7593
    expect(calcBulkPurchase(5, 10, 1, 1e9, 1e9, 1000, 10, 1.5)).toEqual({
      count: 1,
      totalG: 7593,
      totalPt: 75,
      nextLv: 6
    });
  });

  it('buyAmount が残りLvを超えても残りLvで止まる', () => {
    const r = calcBulkPurchase(8, 10, 10, 1e9, 1e9, 1000, 10, 1.5);
    expect(r.count).toBe(2);
    expect(r.nextLv).toBe(10);
  });
});

describe('calcBulkSingleResource（単一通貨）', () => {
  it('max で maxLv まで買う', () => {
    // base=100 / growth=2 → 100, 200, 400, 800, 1600 = 3100
    expect(calcBulkSingleResource(0, 5, 'max', 1e9, 100, 2)).toEqual({
      count: 5,
      totalCost: 3100,
      nextLv: 5
    });
  });

  it('所持量ちょうどで止まる（100 + 200 = 300）', () => {
    expect(calcBulkSingleResource(0, 5, 'max', 300, 100, 2)).toEqual({
      count: 2,
      totalCost: 300,
      nextLv: 2
    });
  });

  it('1レベル分にも足りなければ0個', () => {
    expect(calcBulkSingleResource(0, 5, 'max', 99, 100, 2)).toEqual({
      count: 0,
      totalCost: 0,
      nextLv: 0
    });
  });

  it('maxLv 到達済みなら0個', () => {
    expect(calcBulkSingleResource(5, 5, 'max', 1e9, 100, 2)).toEqual({
      count: 0,
      totalCost: 0,
      nextLv: 5
    });
  });
});
