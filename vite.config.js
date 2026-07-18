import { defineConfig } from 'vite';

// GitHub Pages 하위 경로에서도 동작하도록 상대 base 사용.
// or-tools-wasm은 멀티스레드 WASM이라 COOP/COEP(교차 출처 격리)가 필요하다.
// 개발/미리보기 서버는 헤더로 직접 제공, GitHub Pages에서는 coi-serviceworker가 대신한다.
const coiHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

// CSP — GitHub Pages는 응답 헤더를 못 붙이므로 meta 태그로 주입 (빌드에만; dev는 HMR과 충돌).
// script: 번들 자신 + WASM 실행. worker: or-tools-wasm이 blob 워커로 스레드를 만든다.
// style: 시간표 셀의 인라인 배경색 때문에 unsafe-inline 필요. connect: 게시판(GitHub API).
const CSP = [
  "default-src 'self'",
  // unsafe-eval: or-tools-wasm 내부(protobuf 코드 생성)가 문자열 eval을 사용 — 없으면 솔버가 멈춘다
  "script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' https://api.github.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
  "frame-src 'none'",
].join('; ');

const injectCsp = {
  name: 'inject-csp-meta',
  apply: 'build',
  transformIndexHtml(html) {
    return {
      html,
      tags: [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP }, injectTo: 'head-prepend' }],
    };
  },
};

export default defineConfig({
  base: './',
  plugins: [injectCsp],
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
