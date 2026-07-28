// 8교시 토글 검증 — setPeriodCount()로 교시 수를 바꿔도 엔진·솔버가 올바로 반영되는지 확인.
// (a) 8교시 활성화 후 CP-SAT로 풀었을 때 하드 위반 0으로 해가 나오는지
// (b) 배치 결과에 8교시가 실제로 사용되는지
// (c) 다시 7교시로 되돌렸을 때 8교시가 안 나오는지 (그리고 7교시 용량 한계로 되돌아가는지)
import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import { DAYS, PERIODS, Scheduler, setPeriodCount, parseData } from '../src/engine.js';
import { solveCpsat, solveCpsatIterated } from '../src/solver.js';

let fail = 0;
const check = (cond, msg) => {
  console.log((cond ? '✅ ' : '❌ ') + msg);
  if (!cond) fail++;
};

// ── 합성 데이터: 교사 1명 · 학급 1개 · 과목 1개, 주 40시간 ──
// 7교시(주 35칸)로는 절대 못 들어가고 8교시(주 40칸)로는 정확히 꽉 채워야 들어간다.
// → "교시 수가 실제로 용량에 반영되는지"를 결정적으로(운에 기대지 않고) 검증할 수 있다.
function makeSyntheticData(hours) {
  return {
    year: 2026, semester: 1,
    grades: [1],
    classes_per_grade: new Map([[1, ['1-1']]]),
    special_rooms: [],
    fixed_assignments: [{ teacher: 'T1', subject: '테스트', class_id: '1-1', hours }],
    bundle_groups: [],
    teachers: ['T1'], subjects: ['테스트'],
  };
}

console.log('=== (1) 합성 데이터: 주 40시간 — 7교시 용량 초과 확인 ===');
setPeriodCount(7);
check(PERIODS.length === 7 && PERIODS[PERIODS.length - 1] === 7, 'PERIODS가 [1..7]로 설정됨');
{
  const sch7 = new Scheduler(makeSyntheticData(40), [], [], [], {});
  const probs = sch7.feasibilityReport();
  check(probs.length > 0, `7교시(주 35칸)에서 40시간 배치 불가 사전진단 감지 — ${probs[0] || ''}`);
}

console.log('\n=== (2) setPeriodCount(8) 후 CP-SAT로 정확히 채워지는지 ===');
setPeriodCount(8);
check(PERIODS.length === 8 && PERIODS[PERIODS.length - 1] === 8, 'PERIODS가 [1..8]로 설정됨');
{
  const sch8 = new Scheduler(makeSyntheticData(40), [], [], [], {});
  const probs = sch8.feasibilityReport();
  check(probs.length === 0, '8교시(주 40칸)에서는 40시간 배치 용량 문제 없음');

  const { state, status } = await solveCpsat(sch8, { timeLimit: 20, workers: 4 });
  check(state !== null, `(a) CP-SAT 해를 찾음 (status=${status})`);
  if (state) {
    const hard = state.hardCount();
    check(hard === 0, `(a) 하드 위반 0 (실제 ${hard})`);
    const usesP8 = state.pos.some(dp => dp && dp[1] === 8);
    check(usesP8, '(b) 배치 결과에 8교시가 실제로 사용됨');
    const allSlotsUsed = DAYS.length * PERIODS.length;
    const placed = state.pos.filter(Boolean).length;
    check(placed === allSlotsUsed && placed === 40, `모든 유닛(40개)이 40칸에 정확히 배치됨 (실제 ${placed})`);
  }
}

console.log('\n=== (3) 다시 setPeriodCount(7)로 되돌리기 ===');
setPeriodCount(7);
check(PERIODS.length === 7 && PERIODS[PERIODS.length - 1] === 7, 'PERIODS가 다시 [1..7]로 되돌아감');
{
  const sch7b = new Scheduler(makeSyntheticData(40), [], [], [], {});
  const cand8 = sch7b.unitCandidateSlots.some(cands => cands.some(([, p]) => p === 8));
  check(!cand8, '(c) 7교시로 되돌리면 후보 슬롯에 8교시가 전혀 없음');
  const probs = sch7b.feasibilityReport();
  check(probs.length > 0, '(c) 7교시 복귀 후 다시 용량 초과 진단(=8교시 여유가 사라짐)');
}

console.log('\n=== (4) 실사용 데이터(real_sample.xlsx)로 8교시 통합 스모크 테스트 ===');
setPeriodCount(8);
{
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
  const probs = sch.feasibilityReport();
  console.log('  사전 진단:', probs.length ? probs.slice(0, 3) : '문제 없음');
  const { state, status } = await solveCpsatIterated(sch, { timeLimit: 35, workers: 8 });
  check(state !== null, `실사용 데이터 8교시 CP-SAT 해를 찾음 (status=${status})`);
  if (state) {
    const hard = state.hardCount();
    check(hard === 0, `실사용 데이터 8교시 하드 위반 0 (실제 ${hard})`);
    const p8Count = state.pos.filter(dp => dp && dp[1] === 8).length;
    console.log(`  8교시 사용 칸 수: ${p8Count} (배치 시간 예산이 짧아 0일 수도 있음 — 참고용)`);
  }
}
setPeriodCount(7); // 원상복구

console.log(fail === 0 ? '\n✅ 전체 통과' : `\n❌ 실패 ${fail}건`);
process.exit(fail === 0 ? 0 : 1);
