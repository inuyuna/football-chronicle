import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// 統合テスト（App 全体をマウントして時間を進める）は重いので
// 既定の 5 秒では足りない。
export default defineConfig({
  plugins: [react()],
  test: {
    testTimeout: 60000,
    hookTimeout: 30000
  }
});
