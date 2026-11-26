// @vitest-environment jsdom
//
// 周回カーブの実測。テストではなく計測なので npm run measure で明示的に動かす。
//
// 目的:
//   docs/GAME_DESIGN.md の目標カーブに対して、いまの実装が実際どこまで
//   到達するのかを数字で出す。
//
// 条件:
//   実プレイと同じ流れを機械的に繰り返す。
//     引退 → タイムリープ → 条件を満たせば第2転生以降 → 聖杯/結晶を使い切る
//   進路は「選べる最初の選択肢」を機械的に選ぶ。
//   速度アップと自動化は買わない（強さに効くものだけを見る）。

import { writeFileSync } from 'node:fs';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, it, vi } from 'vitest';
import {
  advanceUntilRetirement,
  buyAscensionUpgrades,
  buyLegacyUpgrades,
  doTimeLeap,
  readAscensionState,
  readLegacyUpgrades,
  readSave,
  startNewCareer,
  tryAscension
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

const REQ_RATING = [
  0, 6.5, 13, 21, 31, 45, 58, 82, 125, 195, 310, 500, 850, 1500, 2800, 6500, 18000, 55000, 180000
];

// docs/GAME_DESIGN.md §4 の目標（v0.4 で引き直した）
//
// 才能ゼロの人間が人生を繰り返したときに、どこまで行けるか。
// 本人の言葉（2026-11-28）:
//   「人生を何周かしたくらいでは、全く活躍できないし、技術も本当にひどい」
//   「ほんの少しずつ強くなっていく」
const TARGET = {
  1: { catId: 1, label: '何もできない' },
  2: { catId: 2, label: '地元の中学で補欠' },
  3: { catId: 3, label: 'Jクラブの下部に拾われる' },
  4: { catId: 4, label: '県立高校でベンチ' },
  5: { catId: 5, label: '強豪校に届く' },
  6: { catId: 5, label: '強豪校で出番が増える' },
  7: { catId: 6, label: '大学で試合に出る' },
  8: { catId: 6, label: '大学の主力' },
  9: { catId: 7, label: '社会人リーグ' },
  10: { catId: 8, label: 'JFL' },
  11: { catId: 9, label: 'プロ最底辺(J3)' },
  12: { catId: 10, label: 'J2' },
  13: { catId: 10, label: 'J2の主力' },
  14: { catId: 11, label: 'J1' },
  15: { catId: 12, label: '海外へ' },
  16: { catId: 12, label: '海外で定着' },
  17: { catId: 13, label: '欧州CC' },
  18: { catId: 14, label: 'W杯・現実のピーク' }
};

// 継承結晶（毎周）で買う優先順
// 継承結晶（毎周）で買う優先順。MEASURE_ASC_STRATEGY と同じ名前で切り替わる。
//
// 全戦略の先頭に自動化を入れている。
// 入れずに測っていたときは AUTO枠が1のままで、練習が1種類しか回らず、
// 29歳で能力上限の3割しか使えていなかった（実測 2026-11-23）。
// 実プレイでは誰でも最初にここを買うので、入れないと実態を代表しない。
const AUTOMATION_FIRST = ['自動化の極意', 'AI練習メニュー自動切替'];

const LEGACY_STRATEGIES = {
  // 能力上限を先に伸ばす
  cap: [...AUTOMATION_FIRST, '才能限界突破', 'タイムリープの記憶', '明晰な戦術脳', '鉄人の肉体遺伝子'],
  // 成長率を先に伸ばす
  growth: [...AUTOMATION_FIRST, 'タイムリープの記憶', '才能限界突破', '明晰な戦術脳', '鉄人の肉体遺伝子'],
  // 現役年数を先に伸ばす（30歳以降の鈍化を、年数で押し切る戦略）
  life: [...AUTOMATION_FIRST, '鉄人の肉体遺伝子', 'タイムリープの記憶', '才能限界突破', '明晰な戦術脳'],
  harvest: [...AUTOMATION_FIRST, '明晰な戦術脳', 'タイムリープの記憶', '才能限界突破', '鉄人の肉体遺伝子']
};

// 聖杯（第2転生以降）で買う優先順。乗算で効くものから
const ASC_STRATEGIES = {
  // 能力上限を先に伸ばす
  cap: ['神域・才能器倍率', '天賦の学習速度', '輪廻結晶の錬成炉', '神速タイムフロー'],
  // 成長率を先に伸ばす（上限だけ上げても33年で育てきれない、という仮説の検証用）
  growth: ['天賦の学習速度', '神域・才能器倍率', '輪廻結晶の錬成炉', '神速タイムフロー'],
  // 結晶の獲得量を先に伸ばす
  harvest: ['輪廻結晶の錬成炉', '天賦の学習速度', '神域・才能器倍率', '神速タイムフロー'],
  life: ['天賦の学習速度', '神域・才能器倍率', '輪廻結晶の錬成炉', '神速タイムフロー']
};
const ASC_STRATEGY = process.env.MEASURE_ASC_STRATEGY || 'cap';
const ASCENSION_PRIORITY = ASC_STRATEGIES[ASC_STRATEGY] || ASC_STRATEGIES.cap;
const LEGACY_PRIORITY = LEGACY_STRATEGIES[ASC_STRATEGY] || LEGACY_STRATEGIES.cap;

const GENERATIONS = Number(process.env.MEASURE_GENERATIONS || 20);

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
  it(`${GENERATIONS}周ぶん回す（結晶・聖杯を使い切り、条件を満たせば第2転生）`, async () => {
    await startNewCareer();

    const rows = [];
    const ascensionEvents = [];
    let totalMonths = 0;

    for (let gen = 1; gen <= GENERATIONS; gen++) {
      const before = readSave();
      const startMonth = before.age * 12 + before.month;

      // 高いカテゴリに居るあいだに第2転生の条件を満たしたら、その場で転生する
      let ascendedMidRun = false;
      const outcome = await advanceUntilRetirement(700, undefined, async () => {
        const cur = readSave();
        if (!cur) return false;
        const lv = Object.values(cur.legacyUpgrades || {}).reduce((a, b) => a + b, 0);
        const ac = cur.ascensionCount || 0;
        if (lv < 28 + ac * 12) return false;
        if (cur.categoryId < Math.min(18, 11 + ac)) return false;

        const res = await tryAscension();
        const ok = res.ok;
        if (!ok) {
          // eslint-disable-next-line no-console
          console.log(`  [第${ac + 2}段階転生に失敗] 周回${gen} ${cur.age}歳 Lv${lv} cat${cur.categoryId}: ${res.reason}`);
        }
        if (ok) {
          const after = readAscensionState();
          ascensionEvents.push(
            `周回${gen}の途中（${cur.age}歳 / ${CATEGORY_NAMES[cur.categoryId]}）で` +
              `第${after.ascensionCount + 1}段階転生（聖杯 +${after.ascensionPoints}）`
          );
          await buyAscensionUpgrades(ASCENSION_PRIORITY);
          ascendedMidRun = true;
        }
        return ok;
      });
      const retired = outcome === 'retired';
      const s = readSave();
      const months = s.age * 12 + s.month - startMonth;
      totalMonths += months;

      const target = TARGET[gen];
      const lu = readLegacyUpgrades();
      const legLvSum = Object.values(lu).reduce((a, b) => a + b, 0);
      const asc = readAscensionState();
      const reqLv = 28 + asc.ascensionCount * 12;
      const reqCat = Math.min(18, 11 + asc.ascensionCount);

      rows.push({
        周回: gen,
        転生段階: asc.ascensionCount,
        引退: s.age,
        到達: `${s.categoryId} ${CATEGORY_NAMES[s.categoryId] || '?'}`,
        目標: target ? `${target.catId} ${target.label}` : '-',
        判定: target ? (s.categoryId >= target.catId ? 'OK' : `不足-${target.catId - s.categoryId}`) : '-',
        ピーク: Math.round(s.peakRatingReached || 0),
        次段: REQ_RATING[s.categoryId + 1] ?? '-',
        強化計Lv: legLvSum,
        聖杯: asc.ascensionPoints,
        '次の転生条件': `Lv${legLvSum}/${reqLv} cat${s.categoryId}/${reqCat}`,
        月数: months
      });

      if (gen >= GENERATIONS) break;

      if (ascendedMidRun) {
        // 上位転生で既に新しい周回が始まっているのでタイムリープは不要
        await buyLegacyUpgrades(LEGACY_PRIORITY);
        continue;
      }
      if (!retired) break;

      await doTimeLeap();
      await buyLegacyUpgrades(LEGACY_PRIORITY);
    }

    // グラフ化できるように生データを残す
    writeFileSync(
      `measure-result-${ASC_STRATEGY}.json`,
      JSON.stringify({ strategy: ASC_STRATEGY, generations: GENERATIONS, rows, ascensionEvents, totalMonths }, null, 2),
      'utf8'
    );

    /* eslint-disable no-console */
    console.log('\n===== 周回カーブ実測 =====');
    console.table(rows);
    if (ascensionEvents.length > 0) {
      console.log('■ 上位転生の発生:');
      for (const e of ascensionEvents) console.log(`  - ${e}`);
    } else {
      console.log('■ 上位転生は一度も発生しなかった');
    }
    console.log(
      `合計 ${totalMonths} ヶ月 = 1倍速で約 ${Math.round(totalMonths / 60)} 分 ` +
        `/ 8倍速で約 ${Math.round((totalMonths * 0.125) / 60)} 分\n`
    );
    /* eslint-enable no-console */
  }, 3600000);
});
