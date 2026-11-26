// Windows ARM64 で rollup のネイティブバイナリが読めない問題の回避。
//
// 症状:
//   npm run build / npm run test が
//   「Error: An Application Control policy has blocked this file.
//     ...\@rollup\rollup-win32-arm64-msvc\rollup.win32-arm64-msvc.node」
//   で落ちる。2026-11-26 に発生。それまでは動いていた。
//
// 原因:
//   このマシンの Windows Application Control ポリシーが、未署名の .node を
//   DLL としてロードするのをブロックするようになった。
//   rollup 4.x の native.js は、読めなかったときのフォールバックを持たない。
//
// なぜ overrides でなくこの形か:
//   package.json の `"overrides": { "rollup": "npm:@rollup/wasm-node@..." }` は
//   npm 11.13 で lock に反映されなかった（lock を作り直しても同じ）。
//
// やっていること:
//   node_modules/rollup を退避し、@rollup/wasm-node の中身をその場所に置く。
//   wasm-node は rollup と同じ API を出す drop-in なので、
//   vite も vitest もそのまま動く。
//
// Vercel（Linux x64）では native が普通に動くので、何もしない。

import { cpSync, existsSync, readFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const rollupDir = join(root, 'node_modules', 'rollup');
const wasmDir = join(root, 'node_modules', '@rollup', 'wasm-node');
const backupDir = join(root, 'node_modules', '.rollup-native-backup');

const isWinArm64 = process.platform === 'win32' && process.arch === 'arm64';
if (!isWinArm64) {
  console.log('[patch-rollup-wasm] Windows ARM64 ではないので何もしない');
  process.exit(0);
}
if (!existsSync(wasmDir)) {
  console.log('[patch-rollup-wasm] @rollup/wasm-node が無いのでスキップ');
  process.exit(0);
}

// すでに差し替え済みなら何もしない
try {
  const pkg = JSON.parse(readFileSync(join(rollupDir, 'package.json'), 'utf8'));
  if (pkg.name === '@rollup/wasm-node') {
    console.log('[patch-rollup-wasm] すでに WASM 版に差し替わっている');
    process.exit(0);
  }
} catch {
  // rollup が無い。何もできない
  process.exit(0);
}

if (existsSync(rollupDir) && !existsSync(backupDir)) {
  renameSync(rollupDir, backupDir);
  console.log('[patch-rollup-wasm] node_modules/rollup を .rollup-native-backup へ退避');
}
cpSync(wasmDir, rollupDir, { recursive: true });
console.log('[patch-rollup-wasm] @rollup/wasm-node を node_modules/rollup として配置');
