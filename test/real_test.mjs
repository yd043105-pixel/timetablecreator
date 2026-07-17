// 실제 사용자 파일 + 설정으로 파이프라인 검증 (앞으로 기본 예시)
import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import { parseData, Scheduler } from '../src/engine.js';
import { solveCpsatIterated } from '../src/solver.js';

const wb = XLSX.read(readFileSync('./test/real_sample.xlsx'), { type: 'buffer' });
const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null });
const data = parseData(rows);
const s = JSON.parse(readFileSync('./test/real_settings.json', 'utf8'));

const nCls = [...data.classes_per_grade.values()].reduce((a, b) => a + b.length, 0);
console.log('학급:', nCls, '교사:', data.teachers.length, '묶음:', data.bundle_groups.length,
  '| 비수업:', s.nonclass.length, '교사불가:', s.unavail.length);

const { lunch, ...rules } = s.ruleFlags;
const params = {
  max_consecutive: s.params.max_consecutive, daily_n: s.params.daily_n,
  lunch_split: !!lunch, lunch_period: s.params.lunch_period, semester: s.semester, rules,
};
const sch = new Scheduler(data, s.nonclass, s.unavail, s.similar, params);
const probs = sch.feasibilityReport();
if (probs.length) { console.log('사전 진단 문제:', probs.slice(0, 3)); }

const t0 = Date.now();
const timeLimit = parseInt(process.argv[2] || '150', 10);
const workers = parseInt(process.argv[3] || '12', 10);
const { state, status } = await solveCpsatIterated(sch, {
  timeLimit, workers, progress: (m) => { if (/최선|현재 페널티|기본 배치 확인|첫 해/.test(m)) console.log('  ', m); },
});
console.log('status:', status, ((Date.now() - t0) / 1000).toFixed(1) + 's');
if (state) {
  const sol = state.getSolution();
  const hard = ['H2', 'H3', 'H4', 'H6', 'H8'].reduce((a, k) => a + (sol.violations[k] || 0), 0);
  console.log('penalty:', sol.penalty, JSON.stringify(sol.violations), hard === 0 ? '✅ HARD 0' : `❌ HARD ${hard}`);
} else console.log('해 없음');
