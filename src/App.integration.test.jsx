// @vitest-environment jsdom
//
// アプリ全体を画面なしで動かす統合テスト。
//
// なぜこれが要るか:
//   進路選択と引退が一度も発火しない状態のまま本番に出ていたことがある。
//   「ビルドが通る」「型が合う」では検出できない種類の壊れ方なので、
//   実際に時間を進めて、出るべきものが出るかを機械に確認させる。
//
// 速度について:
//   fake timer で1ティック=1ヶ月を進める。React の再レンダーが毎回走るので
//   数百ヶ月が限度。周回を重ねる規模の検証は、エンジンを App.jsx から
//   切り出したあとに scripts/simulate.mjs で行う（docs/AUTOMATION.md 2-1）。

import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App.jsx';
import {
  advanceMonths,
  advanceUntilRetirement,
  closeTutorialIfOpen,
  passModalGuard,
  readSave,
  startNewCareer
} from './test-helpers/gameHarness.jsx';

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ shouldAdvanceTime: false });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  localStorage.clear();
});

describe('ゲームが起動して時間が進む', () => {
  it('新規キャリアは5歳4月から始まる', async () => {
    await startNewCareer();

    const save = readSave();
    expect(save).not.toBeNull();
    expect(save.age).toBe(5);
    expect(save.month).toBe(4);
    expect(save.generation).toBe(1);
    expect(save.categoryId).toBe(0);
  });

  it('時間が1ティック1ヶ月で進む', async () => {
    await startNewCareer();
    await advanceMonths(10);

    const save = readSave();
    // 5歳4月 + 10ヶ月 = 6歳2月
    expect(save.age * 12 + save.month).toBe(5 * 12 + 4 + 10);
  });

  it('乱数の種が state に入っていて、進むたびに変化する', async () => {
    await startNewCareer();
    const before = readSave().rngState;
    expect(typeof before).toBe('number');

    await advanceMonths(12);
    expect(readSave().rngState).not.toBe(before);
  });
});

describe('進路選択（過去にまったく発火しなかった箇所の回帰テスト）', () => {
  it('7歳4月に進路選択モーダルが開く', async () => {
    await startNewCareer();

    // 5歳4月 -> 7歳4月 は24ヶ月
    await advanceMonths(24);

    expect(screen.getByText(/7歳・小学校入学/)).toBeTruthy();
    expect(readSave().pendingModal).toBeTruthy();
    expect(readSave().pendingModal.type).toBe('career');
  });

  it('モーダルが開いている間は時間が止まる', async () => {
    await startNewCareer();
    await advanceMonths(24);

    const atModal = readSave();
    await advanceMonths(10);
    const after = readSave();

    expect(after.age).toBe(atModal.age);
    expect(after.month).toBe(atModal.month);
  });

  it('pendingModal がセーブに残るので、閉じてしまっても復元できる', async () => {
    await startNewCareer();
    await advanceMonths(24);

    // タブを閉じて開き直した状況を再現する
    cleanup();
    await act(async () => {
      render(<App />);
    });
    await closeTutorialIfOpen();

    expect(screen.getByText(/7歳・小学校入学/)).toBeTruthy();
  });

  it('進路を選ぶと state に反映され、時間が再び進む', async () => {
    await startNewCareer();
    await advanceMonths(24);

    await passModalGuard();
    const option = screen.getByRole('button', { name: /地元ジュニア少年団へ入団/ });
    await act(async () => {
      option.click();
    });

    const save = readSave();
    expect(save.careerPath).toBe('jr_local');
    expect(save.categoryId).toBe(1);
    expect(save.clubName).toBe('蒼空FCジュニア');
    expect(save.pendingModal).toBeNull();

    const before = save.age * 12 + save.month;
    await advanceMonths(5);
    expect(readSave().age * 12 + readSave().month).toBe(before + 5);
  });

  it('12歳でも進路選択が開く（7歳だけの偶然ではない）', async () => {
    await startNewCareer();
    await advanceMonths(24);

    await passModalGuard();
    await act(async () => {
      screen.getByRole('button', { name: /地元ジュニア少年団へ入団/ }).click();
    });

    // 7歳4月 -> 12歳4月 は60ヶ月
    await advanceMonths(60);

    expect(readSave().pendingModal?.type).toBe('career');
    expect(readSave().triggeredEvents).toContain('age12');
  });
});

describe('ゲームが進行する', () => {
  it('試合が行われて記録が増える', async () => {
    await startNewCareer();
    await advanceMonths(20);

    const save = readSave();
    expect(save.matchesPlayed).toBeGreaterThan(0);
  });

  it('セーブが毎ティック書き込まれる', async () => {
    await startNewCareer();
    await advanceMonths(3);

    const first = readSave();
    await advanceMonths(3);
    const second = readSave();

    expect(second.age * 12 + second.month).toBeGreaterThan(first.age * 12 + first.month);
  });
});

describe('引退とタイムリープ（周回が到達不能だった箇所の回帰テスト）', () => {
  it('22歳4月の強制タイムリープが発火し、第2周目を開始できる', async () => {
    await startNewCareer();

    const reached = await advanceUntilRetirement(230);
    expect(reached, '引退イベントが発火しなかった').toBe(true);

    const atRetire = readSave();
    expect(atRetire.pendingModal.type).toBe('truck');
    expect(atRetire.age).toBe(22);
    expect(atRetire.month).toBe(4);

    // タイムリープ演出 -> 選手クリエイト
    await passModalGuard();
    await act(async () => {
      screen.getByRole('button', { name: /5歳の春へタイムリープする/ }).click();
    });

    await act(async () => {
      screen.getByRole('button', { name: /キャリアを開始する/ }).click();
    });
    await closeTutorialIfOpen();

    const next = readSave();
    expect(next.generation).toBe(2);
    expect(next.age).toBe(5);
    expect(next.month).toBe(4);
    expect(next.legacyPoints).toBeGreaterThan(0);
    expect(next.hallOfFame.length).toBe(1);
    expect(next.triggeredEvents).toEqual([]);
    // 新しい周回の state には pendingModal キー自体がない（undefined）
    expect(next.pendingModal).toBeFalsy();
  });

  it('第2周目でも7歳の進路選択が出る（周回をまたいでも壊れない）', async () => {
    await startNewCareer();
    await advanceUntilRetirement(230);

    await passModalGuard();
    await act(async () => {
      screen.getByRole('button', { name: /5歳の春へタイムリープする/ }).click();
    });
    await act(async () => {
      screen.getByRole('button', { name: /キャリアを開始する/ }).click();
    });
    await closeTutorialIfOpen();

    await advanceMonths(24);
    expect(readSave().pendingModal?.type).toBe('career');
  });
});
