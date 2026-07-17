import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import { parseData, Scheduler, State } from '../src/engine.js';
import { solveCpsat } from '../src/solver.js';

const wb = XLSX.read(readFileSync('../timetable_exe_kit/timetable_exe_kit/template.xlsx'), { type: 'buffer' });
const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null });
const data = parseData(rows);

// 기본(전부 on)
let sch = new Scheduler(data, [], [], [], { max_consecutive: 2, daily_n: 1 });
let r = await solveCpsat(sch, { timeLimit: 12, workers: 4 });
console.log('all rules on — penalty:', r.state.getSolution().penalty, 'hard:', r.state.hardCount());

// teacherDaily(소프트) off → State가 S8을 세지 않음
sch = new Scheduler(data, [], [], [], { max_consecutive: 2, daily_n: 1, rules: { teacherDaily: false } });
console.log('teacherDaily off — pen.DAILY =', sch.pen.DAILY, '(0이어야)');

// bundleDay off → 묶음 요일분산 제약 없음
sch = new Scheduler(data, [], [], [], { max_consecutive: 2, rules: { bundleDay: false } });
r = await solveCpsat(sch, { timeLimit: 12, workers: 4 });
const st = r.state;
// 묶음 형제를 억지로 같은 요일에 놓아도 hardCount가 0인지(=규칙 off 반영)
const bkey = [...sch.bundleSibling.keys()][0];
const sibs = sch.bundleSibling.get(bkey);
if (sibs.length >= 2) {
  st.move(sibs[1], st.pos[sibs[0]][0], 7);  // 형제를 같은 요일 7교시로
  console.log('bundleDay off — 같은요일 강제 후 hardCount:', st.hardCount(), '(0이어야: 규칙 off)');
}

// sameSubjectDay off vs on: pen 값
const schOff = new Scheduler(data, [], [], [], { rules: { sameSubjectDay: false } });
const schOn = new Scheduler(data, [], [], [], {});
console.log('sameSubjectDay pen — off:', schOff.pen.SAME_DAY, 'on:', schOn.pen.SAME_DAY);
console.log('ruleOn 필수(classConflict) 무시 여부:', schOff.ruleOn('classConflict'), '(항상 true)');
