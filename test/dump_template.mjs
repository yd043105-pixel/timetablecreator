import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
const wb = XLSX.read(readFileSync('../timetable_exe_kit/timetable_exe_kit/template.xlsx'), { type: 'buffer' });
const ws = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, blankrows: true });
console.log('sheet:', wb.SheetNames[0], 'rows:', rows.length);
rows.slice(0, 12).forEach((r, i) => {
  console.log(String(i).padStart(2), JSON.stringify(r));
});
