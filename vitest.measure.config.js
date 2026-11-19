import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// 実測用（npm run measure）。通常のテストとは分けている。
// *.measure.jsx は「壊れていないか」ではなく「いまどうなっているか」を見るためのもの。
export default defineConfig({
  plugins: [react()],
  test: {
    include: ['**/*.measure.jsx'],
    testTimeout: 1800000,
    hookTimeout: 60000
  }
});
