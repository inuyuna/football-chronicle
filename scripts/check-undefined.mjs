#!/usr/bin/env node
/**
 * 未定義の識別子（TS2304 Cannot find name）を検出して CI を止める。
 *
 * 背景:
 *   src/App.jsx は .jsx なので tsconfig.app.json（allowJs なし）の型チェック対象外。
 *   oxlint も no-undef を持たない。その二重の穴を通って、実際に存在しない関数を
 *   呼ぶコードが本番まで到達したことがある（git log の 8f68da8 を参照）。
 *
 * やっていること:
 *   allowJs + checkJs を有効にした tsconfig.check.json で tsc を走らせ、
 *   出力から TS2304 だけを拾う。他の型エラー（型注釈がないことによるもの等）は
 *   現時点では大量に出るので無視する。段階的に厳しくしていく想定。
 */

import { execFileSync } from 'node:child_process';

const TARGET_CODES = ['TS2304']; // Cannot find name
const CONFIG = 'tsconfig.check.json';

function runTsc() {
  try {
    return execFileSync('npx', ['tsc', '-p', CONFIG], {
      encoding: 'utf8',
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
  } catch (err) {
    // tsc は型エラーがあると非ゼロ終了する。出力は stdout に入る
    return `${err.stdout ?? ''}${err.stderr ?? ''}`;
  }
}

const output = runTsc();
const pattern = new RegExp(`error (${TARGET_CODES.join('|')})\\b`);
const hits = output
  .split(/\r?\n/)
  .filter((line) => pattern.test(line));

if (hits.length > 0) {
  console.error(`\n未定義の識別子が ${hits.length} 件見つかりました。\n`);
  for (const hit of hits) {
    console.error(`  ${hit}`);
  }
  console.error(
    '\n呼び出し名のタイポか、リネーム時の置換漏れか、実装し忘れのいずれかです。' +
      '\nこれを放置すると、その画面を開いた瞬間に ReferenceError でアプリが落ちます。\n'
  );
  process.exit(1);
}

console.log('OK: 未定義の識別子はありません。');
