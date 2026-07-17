// CP-SAT 솔버 포팅 검증: template.xlsx로 하드 0 도달 확인
import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import { parseData, Scheduler } from '../src/engine.js';
import { solveCpsat, solveCpsatIterated } from '../src/solver.js';

const path = process.argv[2] || '../timetable_exe_kit/timetable_exe_kit/template.xlsx';
const wb = XLSX.read(readFileSync(path), { type: 'buffer' });
const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null });
const data = parseData(rows);
const sch = new Scheduler(data, [], [], [], { max_consecutive: 2, daily_n: 1 });
console.log('units:', sch.nUnits);

const t0 = Date.now();
const { state, status } = await solveCpsat(sch, {
  timeLimit: 30, workers: 4,
  progress: (msg) => console.log('  [progress]', msg),
});
console.log('status:', status, 'elapsed:', ((Date.now() - t0) / 1000).toFixed(1), 's');
if (state) {
  const sol = state.getSolution();
  console.log('penalty:', sol.penalty);
  console.log('violations:', JSON.stringify(sol.violations));
  const hard = ['H2', 'H3', 'H4', 'H6', 'H8'].reduce((a, k) => a + (sol.violations[k] || 0), 0);
  console.log(hard === 0 ? '✅ HARD = 0' : `❌ HARD = ${hard}`);
} else {
  console.log('no solution');
  process.exit(1);
}

// 반복 개선 짧게 확인
console.log('\n--- iterated (40s) ---');
const t1 = Date.now();
const r2 = await solveCpsatIterated(sch, {
  timeLimit: 40, workers: 4, roundTime: 12,
  progress: (msg) => console.log('  [it]', msg),
});
console.log('status:', r2.status, 'elapsed:', ((Date.now() - t1) / 1000).toFixed(1), 's');
if (r2.state) {
  const sol = r2.state.getSolution();
  console.log('final penalty:', sol.penalty, JSON.stringify(sol.violations));
}
