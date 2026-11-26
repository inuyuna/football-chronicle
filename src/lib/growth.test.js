import { describe, expect, it } from 'vitest';
import { BASE_OVER_RATIO, LIMIT_BREAK_OVER_RATIO, overCapDiminishing, overCapRatio } from './growth.js';

describe('overCapRatio', () => {
  it('限界突破を持っていると伸び率が上がる', () => {
    expect(overCapRatio(true)).toBe(LIMIT_BREAK_OVER_RATIO);
    expect(overCapRatio(false)).toBe(BASE_OVER_RATIO);
    expect(overCapRatio(true)).toBeGreaterThan(overCapRatio(false));
  });

  it('チャレンジ倍率が掛かる', () => {
    expect(overCapRatio(false, 2.5)).toBeCloseTo(BASE_OVER_RATIO * 2.5, 10);
  });
});



describe('overCapDiminishing', () => {
  it('上限ちょうどでは減衰しない', () => {
    expect(overCapDiminishing(100, 100)).toBeCloseTo(1, 5);
  });

  it('上限と同じだけ超過すると 1/11 程度まで落ちる', () => {
    // 0.5 ^ 3.5 = 0.0884。v0.36 で 0.5^2.0 から強めた
    expect(overCapDiminishing(200, 100)).toBeCloseTo(0.0884, 3);
  });

  it('超過が進むほど加速度的にきつくなる', () => {
    const a = overCapDiminishing(200, 100);
    const b = overCapDiminishing(300, 100);
    const c = overCapDiminishing(400, 100);
    expect(b / a).toBeLessThan(0.3);
    expect(c / b).toBeLessThan(0.3);
  });

  it('ゼロにはならない（伸びは止まらない）', () => {
    expect(overCapDiminishing(1e6, 10)).toBeGreaterThan(0);
  });
});
