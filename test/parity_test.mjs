// 파이썬과 결정적 페널티 교차 검증
import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import { parseData, Scheduler, State, DAYS } from '../src/engine.js';

const path = process.argv[2] || '../timetable_exe_kit/timetable_exe_kit/template.xlsx';
const wb = XLSX.read(readFileSync(path), { type: 'buffer' });
const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null });
const data = parseData(rows);
const sch = new Scheduler(data, [], [], [], { max_consecutive: 2, daily_n: 1 });
const st = new State(sch);
const slots = [];
for (const d of DAYS) for (let p = 1; p <= 7; p++) slots.push([d, p]);
for (let u = 0; u < sch.nUnits; u++) {
  const [d, p] = slots[(u * 7) % 35];
  st._place(u, d, p);
}
const sol = st.getSolution();
console.log('penalty:', st.penalty);
console.log('violations:', JSON.stringify(Object.fromEntries(Object.entries(sol.violations).sort())));
for (let u = 1; u < sch.nUnits; u += 2) {
  const [d, p] = slots[(u * 11 + 3) % 35];
  st.move(u, d, p);
}
console.log('after moves penalty:', st.penalty);
console.log('after violations:', JSON.stringify(Object.fromEntries(Object.entries(st.getSolution().violations).sort())));
