import * as XLSX from 'xlsx';
import { buildTemplate } from '../src/template_gen.js';
import { parseData } from '../src/engine.js';

const blob = await buildTemplate({ counts: [8, 9, 7], specials: ['음악실', '도서관'] });
const buf = Buffer.from(await blob.arrayBuffer());
const wb = XLSX.read(buf, { type: 'buffer' });
console.log('sheets:', wb.SheetNames);
const rows = XLSX.utils.sheet_to_json(wb.Sheets['교사별시수표'], { header: 1, defval: null });
console.log('row0:', JSON.stringify(rows[0]));
console.log('row1:', JSON.stringify(rows[1]));
const data = parseData(rows);
const cpg = [...data.classes_per_grade].map(([g, c]) => `${g}학년:${c.length}`);
console.log('parsed classes:', cpg.join(' '), '| special:', data.special_rooms.map(s => `${s.grade}-${s.code}`).join(','));
const ok = data.classes_per_grade.get(1).length === 8 && data.classes_per_grade.get(2).length === 9 &&
  data.classes_per_grade.get(3).length === 7 && data.special_rooms.length === 2;
console.log(ok ? '✅ 구조 일치' : '❌ 불일치');
