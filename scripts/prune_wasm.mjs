// cp-sat만 사용하므로 나머지 솔버의 대형 WASM을 빌드 결과에서 제거 (150MB → 약 22MB).
// npm run build에 포함되어 어느 호스팅에서 빌드해도 배포 용량이 맞춰진다.
// (Cloudflare Pages는 파일당 25MiB 제한 — mp_solver 33MB·mathopt 29MB가 걸린다)
import { readdirSync, unlinkSync, statSync } from 'node:fs';
import { join } from 'node:path';

const dir = 'dist/assets';
let freed = 0, kept = 0;
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.wasm')) continue;
  const p = join(dir, f);
  if (f.startsWith('cp_sat')) { kept += statSync(p).size; continue; }
  freed += statSync(p).size;
  unlinkSync(p);
}
console.log(`prune-wasm: ${(freed / 1e6).toFixed(0)}MB 제거, cp_sat ${(kept / 1e6).toFixed(0)}MB 유지`);
