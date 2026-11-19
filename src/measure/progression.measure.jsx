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
//   継承結晶は一切使わない（素のスケーリングだけを見るベースライン）。
//   進路は「選べる最初の選択肢」を機械的に選ぶ。
//
// 注意:
//   実プレイでは結晶で上限突破や成長率を買うので、ここの数字より必ず上に出る。
//   これは「下限」として読むこと。

import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, it, vi } from 'vitest';
import {
  advanceUntilRetirement,
  doTimeLeap,
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

// docs/GAME_DESIGN.md §4 の目標
const TARGET = {
  1: { catId: 6, label: '大学でも通用しない' },
  2: { catId: 7, label: '兆しが見える（社会人）' },
  3: { catId: 9, label: 'プロ最底辺（J3）' },
  4: { catId: 9, label: '3部の主力' },
  5: { catId: 10, label: '2部（J2）' },
  6: { catId: 10, label: '2部の主力' },
  7: { catId: 11, label: '1部下位（J1）' },
  8: { catId: 11, label: '1部の主力' },
  9: { catId: 12, label: '海外底辺（欧州中堅）' },
  10: { catId: 12, label: '海外で定着' }
};

const GENERATIONS = Number(process.env.MEASURE_GENERATIONS || 10);

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ shouldAdvanceTime: false });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  localStorage.clear();
});

describe('周回カーブの実測（結晶を使わないベースライン）', () => {
  it(`${GENERATIONS}周ぶん回して到達カテゴリを記録する`, async () => {
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

      rows.push({
        周回: gen,
        引退年齢: s.age,
        到達: `${s.categoryId} ${CATEGORY_NAMES[s.categoryId] || '?'}`,
        目標: target ? `${target.catId} ${target.label}` : '-',
        判定: target ? (s.categoryId >= target.catId ? 'OK' : `不足 -${target.catId - s.categoryId}`) : '-',
        ピーク総合力: peak,
        '結晶(累計)': s.legacyPoints || 0,
        月数: months,
        '実時間(1x)': `${Math.round(months)}秒`,
        引退到達: retired ? '' : '時間切れ'
      });

      if (gen < GENERATIONS) {
        if (!retired) break;
        await doTimeLeap();
      }
    }

    // eslint-disable-next-line no-console
    console.log('\n===== 周回カーブ実測（継承結晶を一切使わない場合）=====');
    // eslint-disable-next-line no-console
    console.table(rows);
    // eslint-disable-next-line no-console
    console.log(
      `合計 ${totalMonths} ヶ月 = 1倍速で約 ${Math.round(totalMonths / 60)} 分 ` +
        `/ 8倍速で約 ${Math.round((totalMonths * 0.125) / 60)} 分\n`
    );
  }, 900000);
});
