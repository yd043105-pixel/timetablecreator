import { defineConfig } from 'vite';

// GitHub Pages 하위 경로에서도 동작하도록 상대 base 사용.
// or-tools-wasm은 멀티스레드 WASM이라 COOP/COEP(교차 출처 격리)가 필요하다.
// 개발/미리보기 서버는 헤더로 직접 제공, GitHub Pages에서는 coi-serviceworker가 대신한다.
const coiHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  base: './',
  server: { headers: coiHeaders },
  preview: { headers: coiHeaders },
  build: {
    target: 'esnext',
    chunkSizeWarningLimit: 40000,
  },
  worker: { format: 'es' },
  optimizeDeps: {
    exclude: ['or-tools-wasm'],
  },
});
