import { describe, expect, it } from 'vitest';
import { softcap } from './softcap.js';

describe('softcap', () => {
  it('閾値以下はそのまま返す（序盤に影響しない）', () => {
    expect(softcap(1, 6)).toBe(1);
    expect(softcap(5.9, 6)).toBe(5.9);
    expect(softcap(6, 6)).toBe(6);
  });

  it('閾値を超えると圧縮されるが、増え続ける', () => {
    const a = softcap(20, 6, 0.6);
    const b = softcap(200, 6, 0.6);
    const c = softcap(2000, 6, 0.6);

    expect(a).toBeLessThan(20);
    expect(b).toBeLessThan(200);
    expect(a).toBeLessThan(b);
    expect(b).toBeLessThan(c);
  });

  it('10倍積んでも2倍ぶんにならない領域に入る', () => {
    const x = softcap(50, 6, 0.6);
    const y = softcap(500, 6, 0.6);
    expect(y / x).toBeLessThan(2.2);
  });

  it('壊れた入力で NaN を返さない', () => {
    expect(softcap(Number.NaN, 6)).toBeNaN();
    expect(softcap(10, 0)).toBe(10);
    expect(Number.isFinite(softcap(1e9, 6, 0.6))).toBe(true);
  });
});
