import { describe, expect, it } from 'vitest';
import { formatNum, formatYen } from './format.js';

describe('formatYen', () => {
  it('1万未満はカンマ区切りの円表記', () => {
    expect(formatYen(0)).toBe('0円');
    expect(formatYen(9999)).toBe('9,999円');
  });

  it('1万以上は万円（小数1桁）', () => {
    expect(formatYen(10000)).toBe('1.0万円');
    expect(formatYen(12345)).toBe('1.2万円');
  });

  it('1億以上は億円（小数2桁）', () => {
    expect(formatYen(1e8)).toBe('1.00億円');
    expect(formatYen(123456789)).toBe('1.23億円');
  });

  it('1兆以上は兆円（小数2桁）', () => {
    expect(formatYen(1.5e12)).toBe('1.50兆円');
  });

  it('負数は絶対値で桁を判定する', () => {
    expect(formatYen(-50000)).toBe('-5.0万円');
  });

  it('null / undefined / NaN は 0円', () => {
    expect(formatYen(undefined)).toBe('0円');
    expect(formatYen(null)).toBe('0円');
    expect(formatYen(NaN)).toBe('0円');
  });

  it('小数は切り捨てる', () => {
    expect(formatYen(1234.9)).toBe('1,234円');
  });
});

describe('formatNum', () => {
  it('1万未満は整数へ切り捨ててカンマ区切り', () => {
    expect(formatNum(1234.56)).toBe('1,234');
  });

  it('decimals を渡すとその桁で丸める', () => {
    expect(formatNum(1234.56, 1)).toBe('1,234.6');
  });

  it('1万以上は decimals を無視して万表記になる', () => {
    // 現状の仕様。decimals が効かないのは意図的かどうか未確認だが挙動を固定しておく
    expect(formatNum(98765)).toBe('9.9万');
    expect(formatNum(98765, 2)).toBe('9.9万');
  });

  it('億・兆', () => {
    expect(formatNum(1e8)).toBe('1.00億');
    expect(formatNum(1e12)).toBe('1.00兆');
  });

  it('不正値は 0', () => {
    expect(formatNum(undefined)).toBe('0');
    expect(formatNum(NaN)).toBe('0');
  });
});
