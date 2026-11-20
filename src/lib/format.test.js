import { describe, expect, it } from 'vitest';
import { formatNum, formatYen } from './format.js';

// 方針: 小数点は使わず、上位2単位までの複合表記にする（1億2345万）。
// 桁が増えたら 兆 → 京 → 垓 → 𥝱 と単位を伸ばす。

describe('formatNum', () => {
  it('1万未満はカンマ区切りの整数', () => {
    expect(formatNum(0)).toBe('0');
    expect(formatNum(999)).toBe('999');
    expect(formatNum(1234)).toBe('1,234');
    expect(formatNum(9999)).toBe('9,999');
  });

  it('1万以上は端数まで出す（小数点は使わない）', () => {
    expect(formatNum(10000)).toBe('1万');
    expect(formatNum(15000)).toBe('1万5000');
    expect(formatNum(98765)).toBe('9万8765');
  });

  it('億以上は上位2単位まで', () => {
    expect(formatNum(1e8)).toBe('1億');
    expect(formatNum(123456789)).toBe('1億2345万');
  });

  it('兆・京・垓まで伸びる', () => {
    expect(formatNum(1.5e12)).toBe('1兆5000億');
    expect(formatNum(1.5e16)).toBe('1京5000兆');
    expect(formatNum(3.2e20)).toBe('3垓2000京');
  });

  it('負数は符号を保つ', () => {
    expect(formatNum(-50000)).toBe('-5万');
  });

  it('小数は切り捨てる', () => {
    expect(formatNum(1234.9)).toBe('1,234');
  });

  it('decimals は1万未満でだけ効く（総合力の表示用）', () => {
    expect(formatNum(18.7, 1)).toBe('18.7');
    expect(formatNum(1234.56, 1)).toBe('1,234.6');
    // 1万を超えたら単位表記が優先される
    expect(formatNum(98765, 2)).toBe('9万8765');
  });

  it('不正値は 0', () => {
    expect(formatNum(undefined)).toBe('0');
    expect(formatNum(NaN)).toBe('0');
    expect(formatNum(Infinity)).toBe('0');
  });
});

describe('formatYen', () => {
  it('同じ表記に「円」が付く', () => {
    expect(formatYen(0)).toBe('0円');
    expect(formatYen(9999)).toBe('9,999円');
    expect(formatYen(15000)).toBe('1万5000円');
    expect(formatYen(123456789)).toBe('1億2345万円');
    expect(formatYen(1.5e12)).toBe('1兆5000億円');
  });

  it('負数と不正値', () => {
    expect(formatYen(-50000)).toBe('-5万円');
    expect(formatYen(undefined)).toBe('0円');
    expect(formatYen(NaN)).toBe('0円');
  });
});
