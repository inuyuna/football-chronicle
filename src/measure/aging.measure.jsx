// @vitest-environment jsdom
//
// 加齢カーブの実測。
//
// なぜ要るか:
//   「30歳以降は加速度的に衰えて、契約が切れたら引退」という設計なのに、
//   実測で 58歳・63歳まで現役が続き、本人のプレイでは 80歳まで続いた。
//   周回カーブの計測（progression.measure.jsx）では
//   「引退したかどうか」しか見えず、どこで止まっているのかが分からない。
//
//   ここでは1人ぶんのキャリアを1年ずつ追って、
//   年齢・能力上限・能力値・カテゴリを並べる。
//
// 使い方:
//   npm run measure -- aging

import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, it, vi } from 'vitest';
import {
  advanceUntilRetirement,
  doTimeLeap,
  readSave,
  startNewCareer
} from '../test-helpers/gameHarness.jsx';

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ shouldAdvanceTime: false });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  localStorage.clear();
});

describe('加齢カーブの実測', () => {
  it('2周目のキャリアを1年ずつ追う', async () => {
    await startNewCareer();

    // 1周目は22歳で強制タイムリープ。素通りさせる
    const first = await advanceUntilRetirement(260);
    // eslint-disable-next-line no-console
    console.log('1周目の結末:', first);
    await doTimeLeap();

    const rows = [];
    const outcome = await advanceUntilRetirement(840, undefined, (i) => {
      const s = readSave();
      if (!s) return false;
      const r = (s.stats.tec || 0) + (s.stats.phy || 0) + (s.stats.iq || 0) + (s.stats.sht || 0);
      const c =
        (s.statCaps?.tec || 0) +
        (s.statCaps?.phy || 0) +
        (s.statCaps?.iq || 0) +
        (s.statCaps?.sht || 0);
      if (s.age >= 26 || i % 48 === 47) {
        rows.push({
          年齢: s.age,
          総合力: Number(r.toFixed(1)),
          上限計: Number(c.toFixed(1)),
          cat: s.categoryId,
          phy: Number((s.stats.phy || 0).toFixed(1)),
          phy上限: s.statCaps?.phy || 0
        });
      }
      return false;
    });

    // eslint-disable-next-line no-console
    console.log('===== 2周目の加齢カーブ =====');
    // eslint-disable-next-line no-console
    console.table(rows);
    // eslint-disable-next-line no-console
    console.log('結末:', outcome, '/ 最終:', JSON.stringify({
      age: readSave()?.age,
      cat: readSave()?.categoryId,
      retired: readSave()?.isRetired
    }));
  });
});
