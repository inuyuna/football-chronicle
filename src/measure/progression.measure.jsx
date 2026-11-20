// @vitest-environment jsdom
//
// 周回カーブの実測。テストではなく計測なので npm run measure で明示的に動かす。
//
// 目的:
//   docs/GAME_DESIGN.md の目標カーブ（1周目=大学でも通用しない、3周目=プロ最底辺、
//   5周目=J2、7周目=J1、9周目=海外）に対して、
//   いまの実装が実際どこまで到達するのかを数字で出す。
//
// 条件:
//   本線は「結晶あり」。転生するたびに UI から継承結晶を使い切る。
//   これが実際のゲームデザイン（転生 → 結晶で強化 → また転生）に対応する。
//   進路は「選べる最初の選択肢」を機械的に選ぶ。

import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, it, vi } from 'vitest';
import {
  advanceUntilRetirement,
  buyLegacyUpgrades,
  doTimeLeap,
  readLegacyUpgrades,
  readSave,
  startNewCareer
} from '../test-helpers/gameHarness.jsx';

// App.jsx の CATEGORIES と対応（表示用。import できないので写し）
const CATEGORY_NAMES = [
  'キッズスクール',
  '地域ジュニア',
  '地元中学',
  'JクラブJY',
  '県立高校',
  '名門ユース/強豪校',
  '大学',
  '社会人リーグ',
  'JFL',
  'J3（プロ）',
  'J2',
  'J1',
  '欧州中堅',
  '欧州CC強豪',
  'W杯代表',
  '銀河系XI',
  '創世神',
  '銀河評議会',
  '宇宙最高神'
];

// カテゴリに上がるのに必要な総合力（CATEGORIES.reqRating の写し）
const REQ_RATING = [0, 6.5, 13, 21, 31, 45, 58, 82, 125, 195, 310, 500, 850, 1500, 2800, 6500, 18000, 55000, 180000];

// docs/GAME_DESIGN.md §4 の目標
const TARGET = {
  1: { catId: 6, label: '大学でも通用しない' },
  2: { catId: 7, label: '兆しが見える' },
  3: { catId: 9, label: 'プロ最底辺(J3)' },
  4: { catId: 9, label: '3部の主力' },
  5: { catId: 10, label: '2部(J2)' },
  6: { catId: 10, label: '2部の主力' },
  7: { catId: 11, label: '1部下位(J1)' },
  8: { catId: 11, label: '1部の主力' },
  9: { catId: 12, label: '海外底辺' },
  10: { catId: 12, label: '海外で定着' },
  11: { catId: 13, label: '欧州CC' },
  12: { catId: 13, label: 'CC主力' }
};

// 転生直後に買う優先順。強さに直結するものから。
const BUY_PRIORITY = [
  '才能限界突破', // 全能力の成長上限 +2.0/Lv（最大120Lv）
  'タイムリープの記憶', // 全練習効率 +11%/Lv（最大60Lv）
  '明晰な戦術脳', // 精神上限と戦術Pt
  '鉄人の肉体遺伝子' // 現役寿命と初期最大体力
];

const GENERATIONS = Number(process.env.MEASURE_GENERATIONS || 12);

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ shouldAdvanceTime: false });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  localStorage.clear();
});

describe('周回カーブの実測', () => {
  it(`${GENERATIONS}周ぶん回す（転生のたびに結晶を使い切る）`, async () => {
    await startNewCareer();

    const rows = [];
    let totalMonths = 0;

    for (let gen = 1; gen <= GENERATIONS; gen++) {
      const before = readSave();
      const startMonth = before.age * 12 + before.month;

      const retired = await advanceUntilRetirement(700);
      const s = readSave();
      const months = s.age * 12 + s.month - startMonth;
      totalMonths += months;

      const target = TARGET[gen];
      const peak = Math.round(s.peakRatingReached || 0);
      const lu = readLegacyUpgrades();
      const nextReq = REQ_RATING[s.categoryId + 1];

      rows.push({
        周回: gen,
        引退: s.age,
        到達: `${s.categoryId} ${CATEGORY_NAMES[s.categoryId] || '?'}`,
        目標: target ? `${target.catId} ${target.label}` : '-',
        判定: target ? (s.categoryId >= target.catId ? 'OK' : `不足-${target.catId - s.categoryId}`) : '-',
        ピーク: peak,
        次段に必要: nextReq ?? '-',
        上限突破Lv: lu.cap_breaker || 0,
        記憶Lv: lu.growth_memory || 0,
        結晶残: s.legacyPoints || 0,
        月数: months
      });

      if (gen < GENERATIONS) {
        if (!retired) break;
        await doTimeLeap();
        await buyLegacyUpgrades(BUY_PRIORITY);
      }
    }

    /* eslint-disable no-console */
    console.log('\n===== 周回カーブ実測（転生のたびに結晶を使い切る）=====');
    console.table(rows);
    console.log(
      `合計 ${totalMonths} ヶ月 = 1倍速で約 ${Math.round(totalMonths / 60)} 分 ` +
        `/ 8倍速で約 ${Math.round((totalMonths * 0.125) / 60)} 分\n`
    );
    /* eslint-enable no-console */
  }, 1800000);
});
