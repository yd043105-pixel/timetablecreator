import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import { parseData, Scheduler } from '../src/engine.js';
import { solveCpsat } from '../src/solver.js';

const wb = XLSX.read(readFileSync('../timetable_exe_kit/timetable_exe_kit/template.xlsx'), { type: 'buffer' });
const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null });
const data = parseData(rows);
const sch = new Scheduler(data, [], [], [], { max_consecutive: 2, daily_n: 1 });
const { state } = await solveCpsat(sch, { timeLimit: 15, workers: 4 });
console.log('solved penalty:', state.getSolution().penalty, 'hardCount:', state.hardCount());

// 임의의 fixed unit 하나 골라 초록칸 계산
const uid = sch.fixedUids.find(u => state.pos[u]);
const [cid, tch] = sch.units[uid].cells[0];
console.log(`\npick unit ${uid}: ${cid} ${tch} @ ${state.pos[uid].join('')}`);
const greenClass = state.greenSlotsFor(uid, cid, 'class');
const greenTeacher = state.greenSlotsFor(uid, tch, 'teacher');
console.log('green (class view):', greenClass.size, 'slots');
console.log('green (teacher view):', greenTeacher.size, 'slots', [...greenTeacher].slice(0, 8).join(' '));

// 이동 후 하드 유지 확인 + 원복(정합성)
const before = state.snapshot();
const penBefore = state.penalty;
const target = [...greenTeacher][0].split('|');
const uB = state.teacherUnitAt(tch, target[0], parseInt(target[1], 10));
if (uB === null) state.move(uid, target[0], parseInt(target[1], 10));
else state.swap(uid, uB);
console.log('\nafter edit — hardCount:', state.hardCount(), 'penalty:', state.penalty);
state.restore(before);
console.log('after restore — penalty:', state.penalty, penBefore === state.penalty ? '✅ 원복 일치' : '❌ 불일치');

// 묶음 unit 이동 시 하드 판정
const buid = sch.bundleUids.find(u => state.pos[u]);
const bkey = sch.units[buid].bundle_key;
const btch = sch.units[buid].cells[0][1];
console.log(`\nbundle unit ${buid} (${bkey}) @ ${state.pos[buid].join('')}, green:`,
  state.greenSlotsFor(buid, btch, 'teacher').size);
