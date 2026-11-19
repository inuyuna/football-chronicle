import { describe, expect, it } from 'vitest';
import { createRng, createSeed, nextRandom } from './rng.js';

describe('nextRandom', () => {
  it('0 以上 1 未満を返す', () => {
    const s = { rngState: 1 };
    for (let i = 0; i < 10000; i++) {
      const v = nextRandom(s);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('呼ぶたびに state の種が変わる', () => {
    const s = { rngState: 1 };
    const before = s.rngState;
    nextRandom(s);
    expect(s.rngState).not.toBe(before);
  });

  it('rngState を持たないオブジェクトは自動で初期化される（古いセーブ対策）', () => {
    const s = {};
    const v = nextRandom(s);
    expect(typeof s.rngState).toBe('number');
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThan(1);
  });

  it('rngState が壊れていても復旧する', () => {
    for (const broken of [undefined, null, NaN, 'abc', Infinity]) {
      const s = { rngState: broken };
      const v = nextRandom(s);
      expect(Number.isFinite(s.rngState)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('createRng', () => {
  it('同じ種からは完全に同じ列が出る（決定論性）', () => {
    const a = createRng(12345);
    const b = createRng(12345);
    const seqA = Array.from({ length: 500 }, a);
    const seqB = Array.from({ length: 500 }, b);
    expect(seqA).toEqual(seqB);
  });

  it('種が違えば列も違う', () => {
    const a = Array.from({ length: 50 }, createRng(1));
    const b = Array.from({ length: 50 }, createRng(2));
    expect(a).not.toEqual(b);
  });

  it('既知の種に対する出力を固定する（アルゴリズムを変えたら気づけるように）', () => {
    const r = createRng(42);
    const got = Array.from({ length: 5 }, r).map((v) => Number(v.toFixed(6)));
    expect(got).toEqual([0.601104, 0.448291, 0.852466, 0.669734, 0.174814]);
  });

  it('getState で途中の種を取り出せる', () => {
    const r = createRng(7);
    r();
    const mid = r.getState();
    const rest = Array.from({ length: 10 }, r);

    // 取り出した種から再開すると同じ続きになる
    const resumed = createRng(mid);
    // createRng は種をそのまま入れるので、1回進めた状態からの続きと一致する
    const holder = { rngState: mid };
    const again = Array.from({ length: 10 }, () => nextRandom(holder));
    expect(again).toEqual(rest);
    expect(typeof resumed).toBe('function');
  });

  it('分布がおおよそ一様（平均が 0.5 付近）', () => {
    const r = createRng(99);
    const n = 100000;
    let sum = 0;
    for (let i = 0; i < n; i++) sum += r();
    expect(sum / n).toBeGreaterThan(0.49);
    expect(sum / n).toBeLessThan(0.51);
  });

  it('10分割したヒストグラムが極端に偏らない', () => {
    const r = createRng(2024);
    const buckets = new Array(10).fill(0);
    const n = 100000;
    for (let i = 0; i < n; i++) buckets[Math.floor(r() * 10)] += 1;
    for (const b of buckets) {
      expect(b).toBeGreaterThan(n / 10 - n / 50);
      expect(b).toBeLessThan(n / 10 + n / 50);
    }
  });
});

describe('createSeed', () => {
  it('32bit の符号なし整数を返す', () => {
    for (let i = 0; i < 200; i++) {
      const seed = createSeed();
      expect(Number.isInteger(seed)).toBe(true);
      expect(seed).toBeGreaterThanOrEqual(0);
      expect(seed).toBeLessThan(0x100000000);
    }
  });
});
