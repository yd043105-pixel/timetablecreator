// 파서/스케줄러 포팅 검증: template.xlsx를 파싱해 파이썬과 동일한 구조가 나오는지
import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import { parseData, Scheduler, State, computeClassTotalHours, computeTeacherTotalHours } from '../src/engine.js';

const path = process.argv[2] || '../timetable_exe_kit/timetable_exe_kit/template.xlsx';
const wb = XLSX.read(readFileSync(path), { type: 'buffer' });
const ws = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

const data = parseData(rows);
const nClasses = [...data.classes_per_grade.values()].reduce((a, b) => a + b.length, 0);
console.log('classes:', nClasses, JSON.stringify([...data.classes_per_grade].map(([g, c]) => [g, c.length])));
console.log('special_rooms:', data.special_rooms.length);
console.log('teachers:', data.teachers.length);
console.log('subjects:', data.subjects.length);
console.log('fixed_assignments:', data.fixed_assignments.length);
console.log('bundle_groups:', data.bundle_groups.length);

const sch = new Scheduler(data, [], [], [], { max_consecutive: 2, daily_n: 1 });
console.log('n_units:', sch.nUnits, 'fixed:', sch.fixedUids.length, 'bundle:', sch.bundleUids.length);

const classTot = computeClassTotalHours(data);
const teacherTot = computeTeacherTotalHours(data);
console.log('class total hours sum:', [...classTot.values()].reduce((a, b) => a + b, 0));
console.log('teacher total hours sum:', [...teacherTot.values()].reduce((a, b) => a + b, 0));

// State 증분 평가 정합성: 무작위 배치 1000회 move 후 penalty를 재계산과 비교
const st = new State(sch);
for (let u = 0; u < sch.nUnits; u++) {
  const cands = sch.unitCandidateSlots[u];
  const [d, p] = cands[Math.floor(Math.random() * cands.length)];
  st._place(u, d, p);
}
for (let i = 0; i < 1000; i++) {
  const u = Math.floor(Math.random() * sch.nUnits);
  const cands = sch.unitCandidateSlots[u];
  const [d, p] = cands[Math.floor(Math.random() * cands.length)];
  st.move(u, d, p);
}
// 재계산: 같은 pos로 새 State 구성
const st2 = new State(sch);
for (let u = 0; u < sch.nUnits; u++) {
  const dp = st.pos[u];
  if (dp) st2._place(u, dp[0], dp[1]);
}
console.log('incremental penalty:', st.penalty, 'recomputed:', st2.penalty,
  st.penalty === st2.penalty ? '✅ MATCH' : '❌ MISMATCH');
const sol = st.getSolution();
console.log('violations:', JSON.stringify(sol.violations));
