// 우클릭 연쇄 재배치(relocPlanTo) 검증 — CP-SAT 없이 즉시 계산되는지, 하드가 유지되는지
import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import { parseData, Scheduler, DAYS, PERIODS } from '../src/engine.js';
import { solveCpsatIterated } from '../src/solver.js';

const wb = XLSX.read(readFileSync('./test/real_sample.xlsx'), { type: 'buffer' });
const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null });
const data = parseData(rows);
const s = JSON.parse(readFileSync('./test/real_settings.json', 'utf8'));
const { lunch, ...rules } = s.ruleFlags;
const params = {
  max_consecutive: s.params.max_consecutive, daily_n: s.params.daily_n,
  lunch_split: !!lunch, lunch_period: s.params.lunch_period, semester: s.semester, rules,
};
const sch = new Scheduler(data, s.nonclass, s.unavail, s.similar, params);

const timeLimit = parseInt(process.argv[2] || '40', 10);
const { state } = await solveCpsatIterated(sch, { timeLimit, workers: 8, maxRounds: 1 });
if (!state) { console.log('해 없음 — 테스트 불가'); process.exit(1); }
const baseHard = state.hardCount();
const basePen = state.penalty;
console.log('기준 해 — penalty:', basePen, 'hard:', baseHard);

// 배치된 unit 전수 대상으로 임의 목표 칸 재배치 시도
let tried = 0, found = 0, chain2 = 0, maxMs = 0, fail = 0;
const snapAll = state.snapshot();
for (let uid = 0; uid < sch.units.length && tried < 200; uid++) {
  if (!state.pos[uid]) continue;
  const [cd, cp] = state.pos[uid];
  // 현재 위치에서 두 칸씩 건너뛴 목표를 골라 다양한 케이스 확보
  const d = DAYS[(DAYS.indexOf(cd) + 2) % DAYS.length];
  const p = PERIODS[(cp + 2) % PERIODS.length];
  tried++;
  const t0 = performance.now();
  const plan = state.relocPlanTo(uid, d, p);
  const ms = performance.now() - t0;
  maxMs = Math.max(maxMs, ms);

  // 탐색 후 상태가 원복됐는지 (스냅샷·페널티 일치)
  if (state.penalty !== basePen) { console.log(`❌ uid ${uid}: 탐색 후 penalty 훼손`); fail++; break; }

  if (!plan) continue;
  found++;
  if (plan.moves.length > 1) chain2++;
  // 계획 적용 → 하드 유지 확인 → 원복
  for (const m of plan.moves) state.move(m.uid, m.to[0], m.to[1]);
  if (state.hardCount() > baseHard) { console.log(`❌ uid ${uid} → ${d}${p}: 적용 후 하드 증가`); fail++; }
  if (state.penalty !== plan.penaltyAfter) { console.log(`❌ uid ${uid}: penaltyAfter 불일치`); fail++; }
  if (state.pos[uid][0] !== d || state.pos[uid][1] !== p) { console.log(`❌ uid ${uid}: 목표 칸 미도달`); fail++; }
  state.restore(snapAll);
  if (state.penalty !== basePen) { console.log(`❌ uid ${uid}: 원복 후 penalty 불일치`); fail++; break; }
}
console.log(`시도 ${tried} · 계획 발견 ${found} (연쇄 2개 이상 ${chain2}) · 최대 계산시간 ${maxMs.toFixed(1)}ms`);
console.log(fail === 0 ? '✅ relocPlanTo 검증 통과' : `❌ 실패 ${fail}건`);
process.exit(fail === 0 ? 0 : 1);
