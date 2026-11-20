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
export async function advanceUntilRetirement(maxMonths, pick) {
  for (let i = 0; i < maxMonths; i++) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    if (readSave()?.pendingModal?.type === 'truck') return true;
    await resolveCareerModalIfOpen(pick);
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
