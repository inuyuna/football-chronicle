// jsdom 上でゲームを画面なしに動かすための共通ヘルパー。
//
// 統合テスト（App.integration.test.jsx）と
// 周回カーブの計測（measure/progression.measure.jsx）の両方から使う。
//
// 前提:
//   - テスト側で vi.useFakeTimers() を有効にしてあること
//   - @vitest-environment jsdom

import { act, render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import App from '../App.jsx';

export const SAVE_KEY = 'football_chronicle_v0_12_save';

/** 現在のセーブデータを読む */
export function readSave() {
  const raw = localStorage.getItem(SAVE_KEY);
  return raw ? JSON.parse(raw) : null;
}

/** 1ヶ月(=1ティック)ずつ時間を進める */
export async function advanceMonths(months) {
  for (let i = 0; i < months; i++) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
  }
}

/**
 * モーダルの誤爆防止ガードを超えるまで待つ。
 * handleSelectCareerPath / handleProceedFromTruckModal は、モーダルが開いてから
 * 850ms 経つまでクリックを無視する（連打で意図せず選んでしまうのを防ぐため）。
 */
export async function passModalGuard() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(900);
  });
}

/** チュートリアルが出ていれば閉じる。開いている間はゲームループが止まる */
export async function closeTutorialIfOpen() {
  const tutorial = screen.queryByRole('button', { name: /理解してプレイ開始/ });
  if (tutorial) {
    await act(async () => {
      tutorial.click();
    });
  }
}

/** モーダルを抜けてゲームを開始する */
export async function startNewCareer() {
  await act(async () => {
    render(<App />);
  });

  // セーブがない状態では選手クリエイトモーダルが先に出る
  // （チュートリアルは creatorModal が閉じてから表示される）
  await act(async () => {
    screen.getByRole('button', { name: /キャリアを開始する/ }).click();
  });

  await closeTutorialIfOpen();
}

/**
 * 進路選択モーダルが出ていたら選ぶ。
 * @param {(options: any[]) => any} pick 選択肢から1つ選ぶ関数。既定は「選べる最初のもの」
 * @returns {Promise<boolean>} 選んだら true
 */
export async function resolveCareerModalIfOpen(pick) {
  const save = readSave();
  if (save?.pendingModal?.type !== 'career') return false;

  const options = save.pendingModal.modal.options;
  const chooser = pick || ((opts) => opts.find((o) => o.unlocked));
  const option = chooser(options) || options.find((o) => o.unlocked);
  if (!option) return false;

  await passModalGuard();
  const button = screen.getAllByRole('button').find((b) => b.textContent.includes(option.title));
  if (!button) return false;

  await act(async () => {
    button.click();
  });
  return true;
}

/**
 * 進路選択を自動で捌きながら、引退（truck）が出るまで時間を進める。
 * @returns {Promise<boolean>} 引退に到達したら true
 */
export async function advanceUntilRetirement(maxMonths, pick, onYear) {
  for (let i = 0; i < maxMonths; i++) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    if (readSave()?.pendingModal?.type === 'truck') return 'retired';
    await resolveCareerModalIfOpen(pick);

    // 1年に1度だけフックを呼ぶ。
    // 第2転生（Ascension）は「引退してから」ではなく「高いカテゴリに
    // 居るあいだ」に行うもの。タイムリープすると categoryId が0に戻るため、
    // 引退後に試しても条件を満たせない。
    if (onYear && i % 12 === 11) {
      const interrupted = await onYear(i);
      if (interrupted) return 'ascended';
    }
  }
  return false;
}

/**
 * 引退モーダルからタイムリープして次の周回を開始する。
 * 転生アップグレードは買わない（素の成長カーブを見るため）。
 */
export async function doTimeLeap() {
  await passModalGuard();
  await act(async () => {
    screen.getByRole('button', { name: /5歳の春へタイムリープする/ }).click();
  });
  await act(async () => {
    screen.getByRole('button', { name: /キャリアを開始する/ }).click();
  });
  await closeTutorialIfOpen();
}

/**
 * タイムリープタブを開いて、継承結晶アップグレードを優先順に買えるだけ買う。
 *
 * 実プレイと同じく UI 経由で買う（state を直接書き換えない）ので、
 * 購入ハンドラ側の上限再計算もそのまま通る。
 *
 * @param {string[]} namePatterns アップグレード名の部分文字列を優先順に
 * @returns {Promise<{opened: boolean, bought: Record<string, number>}>}
 */
export async function buyLegacyUpgrades(namePatterns) {
  const tab = screen.getAllByRole('button').find((b) => b.textContent.includes('タイムリープ(+'));
  if (!tab) return { opened: false, bought: {} };

  await act(async () => {
    tab.click();
  });

  // 「結晶強化・転生」サブタブへ戻す。
  // tryAscension が「上位転生」へ切り替えたままだと結晶カードが描画されず、
  // 何も買えないのに成功したように見えてしまう（実際にこれで計測を1本無駄にした）。
  const crystalSub = screen.getAllByRole('button').find((b) => b.textContent.includes('結晶強化'));
  if (crystalSub) {
    await act(async () => {
      crystalSub.click();
    });
  }

  // MAX 一括購入モードにする
  const maxBtn = screen.getAllByRole('button').find((b) => b.textContent.trim() === 'MAX');
  if (maxBtn) {
    await act(async () => {
      maxBtn.click();
    });
  }

  const bought = {};
  for (const pattern of namePatterns) {
    // MAX でも結晶が足りなければ部分購入になるので、買えなくなるまで繰り返す
    for (let i = 0; i < 60; i++) {
      const btn = screen
        .getAllByRole('button')
        .find((b) => !b.disabled && b.textContent.includes(pattern));
      if (!btn) break;
      await act(async () => {
        btn.click();
      });
      bought[pattern] = (bought[pattern] || 0) + 1;
    }
  }

  return { opened: true, bought };
}

/** 現在の継承結晶アップグレードの取得状況を読む */
export function readLegacyUpgrades() {
  return readSave()?.legacyUpgrades || {};
}

/** タイムリープタブを開く。開けたら true */
async function openLeapTab() {
  const tab = screen.getAllByRole('button').find((b) => b.textContent.includes('タイムリープ(+'));
  if (!tab) return false;
  await act(async () => {
    tab.click();
  });
  return true;
}

/**
 * 条件を満たしていれば第2転生以降（Ascension）を実行する。
 * 引退モーダルが出ている状態からは呼べない（タブ操作ができないため）、
 * 通常の周回中に呼ぶこと。
 *
 * @returns {Promise<boolean>} 実行できたら true
 */
export async function tryAscension() {
  if (!(await openLeapTab())) return { ok: false, reason: 'タイムリープタブが出ていない' };

  const sub = screen.getAllByRole('button').find((b) => b.textContent.includes('上位転生'));
  if (!sub) return { ok: false, reason: '上位転生サブタブが出ていない' };
  await act(async () => {
    sub.click();
  });

  const allAscend = screen.getAllByRole('button').filter((b) => b.textContent.includes('高次元転生'));
  const ascendBtn = allAscend.find((b) => !b.disabled);
  if (!ascendBtn) {
    const seen = screen.getAllByRole('button').filter((b) => b.textContent.includes('条件未達')).length;
    return {
      ok: false,
      reason: `高次元転生ボタンが押せない（候補${allAscend.length}件 / 条件未達表示${seen}件）`
    };
  }
  await act(async () => {
    ascendBtn.click();
  });

  // 上位転生の確定ボタンは「聖杯獲得・転生確定」。
  // 結晶転生側の「実行確定」とは文言が違う（これで1本計測を無駄にした）。
  const confirm = screen
    .getAllByRole('button')
    .find((b) => b.textContent.trim() === '聖杯獲得・転生確定');
  if (!confirm) {
    // 確認状態のまま抜けると次回「高次元転生」ボタンが見つからなくなるので戻す
    const cancel = screen.getAllByRole('button').find((b) => b.textContent.trim() === '取消');
    if (cancel) {
      await act(async () => {
        cancel.click();
      });
    }
    return { ok: false, reason: '聖杯獲得・転生確定ボタンが出ていない' };
  }
  await act(async () => {
    confirm.click();
  });

  const startBtn = screen.queryByRole('button', { name: /キャリアを開始する/ });
  if (!startBtn) return { ok: false, reason: 'クリエイトモーダルが開かない' };
  await act(async () => {
    startBtn.click();
  });
  await closeTutorialIfOpen();
  return { ok: true, reason: '' };
}

/**
 * 聖杯（Ascension）アップグレードを優先順に買えるだけ買う。
 * @param {string[]} namePatterns
 */
export async function buyAscensionUpgrades(namePatterns) {
  if (!(await openLeapTab())) return { opened: false, bought: {} };

  const sub = screen.getAllByRole('button').find((b) => b.textContent.includes('上位転生'));
  if (!sub) return { opened: false, bought: {} };
  await act(async () => {
    sub.click();
  });

  const maxBtn = screen.getAllByRole('button').find((b) => b.textContent.trim() === 'MAX');
  if (maxBtn) {
    await act(async () => {
      maxBtn.click();
    });
  }

  const bought = {};
  for (const pattern of namePatterns) {
    for (let i = 0; i < 60; i++) {
      const btn = screen
        .getAllByRole('button')
        .find((b) => !b.disabled && b.textContent.includes(pattern));
      if (!btn) break;
      await act(async () => {
        btn.click();
      });
      bought[pattern] = (bought[pattern] || 0) + 1;
    }
  }
  return { opened: true, bought };
}

/** 第2転生以降の到達状況を読む */
export function readAscensionState() {
  const s = readSave();
  return {
    ascensionCount: s?.ascensionCount || 0,
    ascensionPoints: s?.ascensionPoints || 0,
    ascensionUpgrades: s?.ascensionUpgrades || {}
  };
}
