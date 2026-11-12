import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

export default defineConfig({
  base: './',
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(version) },
  build: {
    chunkSizeWarningLimit: 900,
    // 큰 라이브러리를 나눠 두면 프로그램을 고쳐 배포할 때 바뀐 부분만 새로 받는다
    rollupOptions: { output: { manualChunks: { pdf: ['pdf-lib', '@pdf-lib/fontkit'], react: ['react', 'react-dom', 'zustand'] } } },
  },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
} as any);
