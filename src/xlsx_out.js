/**
 * 엑셀 출력 (output.py 포팅, ExcelJS 기반 — 묶음별 색상 포함)
 * 브라우저에서 Blob 반환.
 */
import ExcelJS from 'exceljs';
import { DAYS, PERIODS } from './engine.js';

const COLOR_HEADER_MAIN = '1F4E78';
const COLOR_HEADER_SUB = 'BDD7EE';
const COLOR_NONCLASS = 'BFBFBF';
const COLOR_UNAVAIL = 'F4B084';
const COLOR_SPECIAL = 'C6E0B4';
const COLOR_BUNDLE = 'FFF2CC';

export const BUNDLE_PALETTE = [
  'FCE4D6', 'FFF2CC', 'E2EFDA', 'DDEBF7', 'FCE4EC', 'EDE7F6',
  'FFF9C4', 'D7F3E3', 'FBE9E7', 'E1F5FE', 'F3E5F5', 'FFF3E0',
  'E8F5E9', 'E0F7FA', 'FFEBEE', 'F1F8E9', 'E3F2FD', 'FFF8E1',
  'F9FBE7', 'EFEBE9',
];

export function bundleColorMap(sol) {
  const bkeys = [...new Set(sol.assignments.filter(a => a[5]).map(a => a[5]))].sort();
  const cmap = new Map();
  bkeys.forEach((bk, i) => cmap.set(bk, BUNDLE_PALETTE[i % BUNDLE_PALETTE.length]));
  return cmap;
}

const thin = { style: 'thin', color: { argb: 'FF808080' } };
const BORDER = { left: thin, right: thin, top: thin, bottom: thin };

function setCell(ws, row, col, value, { bold = false, fill = null, size = 10 } = {}) {
  const cell = ws.getCell(row, col);
  cell.value = value;
  cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  cell.font = {
    name: '맑은 고딕', size, bold,
    color: { argb: fill === COLOR_HEADER_MAIN ? 'FFFFFFFF' : 'FF000000' },
  };
  if (fill) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + fill } };
  cell.border = BORDER;
  return cell;
}

/**
 * sol: {assignments: [[subj,tch,cid,d,p,bk]], penalty, violations}
 * 반환: Blob (xlsx)
 */
export async function buildExcel(sol, data, nonClass, unavail, year, semester) {
  const wb = new ExcelJS.Workbook();
  const bundleColors = bundleColorMap(sol);

  // ── 1. 요약 ──
  {
    const ws = wb.addWorksheet('요약');
    setCell(ws, 1, 1, `${year}학년도 ${semester}학기 시간표 (웹판)`, { bold: true, fill: COLOR_HEADER_MAIN, size: 14 });
    ws.mergeCells(1, 1, 1, 4);
    const rows = [
      ['생성 시각', new Date().toLocaleString('ko-KR')],
      ['최종 페널티', sol.penalty],
      ['배치된 수업 수', sol.assignments.length],
    ];
    rows.forEach(([k, v], i) => {
      setCell(ws, i + 2, 1, k, { bold: true, fill: COLOR_HEADER_SUB });
      setCell(ws, i + 2, 2, v);
      ws.mergeCells(i + 2, 2, i + 2, 4);
    });
    let r = rows.length + 3;
    setCell(ws, r, 1, '위반 통계', { bold: true, fill: COLOR_HEADER_SUB });
    ws.mergeCells(r, 1, r, 4);
    r++;
    for (const [k, v] of Object.entries(sol.violations).sort()) {
      setCell(ws, r, 1, k);
      setCell(ws, r, 2, v);
      ws.mergeCells(r, 2, r, 4);
      r++;
    }
    for (let c = 1; c <= 4; c++) ws.getColumn(c).width = 18;
  }

  const allClasses = [...new Set(sol.assignments.map(a => a[2]))].sort((a, b) => {
    const [ga, la] = a.split('-'); const [gb, lb] = b.split('-');
    return (parseInt(ga, 10) - parseInt(gb, 10)) || (la < lb ? -1 : la > lb ? 1 : 0);
  });
  const allTeachers = [...new Set(sol.assignments.map(a => a[1]))].sort();

  const classTable = new Map();   // cid -> Map("d|p" -> [subj, tch, bk])
  const teacherTable = new Map(); // tch -> Map("d|p" -> [subj, cids, bk])
  for (const [subj, tch, cid, d, p, bk] of sol.assignments) {
    if (!classTable.has(cid)) classTable.set(cid, new Map());
    classTable.get(cid).set(`${d}|${p}`, [subj, tch, bk]);
    if (!teacherTable.has(tch)) teacherTable.set(tch, new Map());
    const tt = teacherTable.get(tch);
    const key = `${d}|${p}`;
    if (tt.has(key)) {
      const prev = tt.get(key);
      tt.set(key, [subj, cid + ',' + prev[1], bk]);
    } else {
      tt.set(key, [subj, cid, bk]);
    }
  }

  const nonclassSet = new Set(nonClass.map(s => `${s.grade}|${s.day}|${s.period}`));
  const ncLabel = new Map(nonClass.map(s => [`${s.grade}|${s.day}|${s.period}`, s.label || '자율']));
  const unavailAll = new Map();
  for (const u of unavail) {
    if ((u.grade || 0) === 0) {
      if (!unavailAll.has(u.teacher)) unavailAll.set(u.teacher, new Set());
      unavailAll.get(u.teacher).add(`${u.day}|${u.period}`);
    }
  }
  const specialSet = new Set((data.special_rooms || []).map(sr => `${sr.grade}-${sr.code}`));

  // ── 2. 학교_전체시간표 ──
  {
    const ws = wb.addWorksheet('학교_전체시간표');
    let row = 1;
    setCell(ws, row, 1, `${year}학년도 ${semester}학기 학교 전체 시간표`, { bold: true, fill: COLOR_HEADER_MAIN, size: 14 });
    ws.mergeCells(row, 1, row, 10);
    row += 2;
    const byGrade = new Map();
    for (const cid of allClasses) {
      const g = parseInt(cid.split('-')[0], 10);
      if (!byGrade.has(g)) byGrade.set(g, []);
      byGrade.get(g).push(cid);
    }
    for (const grade of [...byGrade.keys()].sort()) {
      const clsList = byGrade.get(grade);
      setCell(ws, row, 1, `${grade}학년 전체 시간표`, { bold: true, fill: COLOR_HEADER_MAIN, size: 12 });
      ws.mergeCells(row, 1, row, 1 + clsList.length * 5);
      row++;
      setCell(ws, row, 1, '교시', { bold: true, fill: COLOR_HEADER_SUB });
      let col = 2;
      for (const cid of clsList) {
        const isSpecial = specialSet.has(cid);
        setCell(ws, row, col, cid + (isSpecial ? '★' : ''), { bold: true, fill: isSpecial ? COLOR_SPECIAL : COLOR_HEADER_SUB });
        ws.mergeCells(row, col, row, col + 4);
        col += 5;
      }
      row++;
      setCell(ws, row, 1, '', { fill: COLOR_HEADER_SUB });
      col = 2;
      for (const _cid of clsList) {
        for (const d of DAYS) setCell(ws, row, col++, d, { bold: true, fill: COLOR_HEADER_SUB, size: 9 });
      }
      row++;
      for (const p of PERIODS) {
        setCell(ws, row, 1, String(p), { bold: true, fill: COLOR_HEADER_SUB });
        col = 2;
        for (const cid of clsList) {
          for (const d of DAYS) {
            const ncKey = `${grade}|${d}|${p}`;
            const ct = classTable.get(cid);
            if (nonclassSet.has(ncKey)) {
              setCell(ws, row, col, ncLabel.get(ncKey) || '비', { fill: COLOR_NONCLASS, size: 9 });
            } else if (ct && ct.has(`${d}|${p}`)) {
              const [subj, tch, bk] = ct.get(`${d}|${p}`);
              const fill = bk ? (bundleColors.get(bk) || COLOR_BUNDLE) : null;
              setCell(ws, row, col, `${subj}\n(${tch})`, { fill, size: 9 });
            } else {
              setCell(ws, row, col, '', { size: 9 });
            }
            col++;
          }
        }
        row++;
      }
      row++;
    }
    ws.getColumn(1).width = 6;
    for (let c = 2; c <= ws.columnCount; c++) ws.getColumn(c).width = 10;
  }

  // ── 3. 교사_전체시간표 ──
  {
    const ws = wb.addWorksheet('교사_전체시간표');
    let row = 1;
    setCell(ws, row, 1, `${year}학년도 ${semester}학기 교사 전체 시간표`, { bold: true, fill: COLOR_HEADER_MAIN, size: 14 });
    ws.mergeCells(row, 1, row, 40);
    row += 2;
    setCell(ws, row, 1, '', { fill: COLOR_HEADER_SUB });
    let col = 2;
    for (const d of DAYS) {
      setCell(ws, row, col, d, { bold: true, fill: COLOR_HEADER_SUB });
      ws.mergeCells(row, col, row, col + 6);
      col += 7;
    }
    setCell(ws, row, col, '시수', { bold: true, fill: COLOR_HEADER_SUB });
    setCell(ws, row, col + 1, '교사', { bold: true, fill: COLOR_HEADER_SUB });
    row++;
    setCell(ws, row, 1, '교사', { bold: true, fill: COLOR_HEADER_SUB });
    col = 2;
    for (const _d of DAYS) for (const p of PERIODS) setCell(ws, row, col++, String(p), { bold: true, fill: COLOR_HEADER_SUB, size: 9 });
    setCell(ws, row, col, '', { fill: COLOR_HEADER_SUB });
    setCell(ws, row, col + 1, '', { fill: COLOR_HEADER_SUB });
    row++;
    for (const tch of allTeachers) {
      setCell(ws, row, 1, tch, { bold: true, size: 9 });
      let totalHours = 0;
      col = 2;
      const tt = teacherTable.get(tch) || new Map();
      const ua = unavailAll.get(tch) || new Set();
      for (const d of DAYS) {
        for (const p of PERIODS) {
          const key = `${d}|${p}`;
          if (tt.has(key)) {
            const [, cids, bk] = tt.get(key);
            const parts = cids.split(',').map(cid => {
              const [g, cnum] = cid.split('-');
              return bk ? `${g}${bk.split('_')[1].toLowerCase()}${cnum}` : `${g}${cnum}`;
            });
            const fill = bk ? (bundleColors.get(bk) || COLOR_BUNDLE) : null;
            setCell(ws, row, col, parts.join('/'), { fill, size: 8 });
            totalHours++;
          } else if (ua.has(key)) {
            setCell(ws, row, col, '불가', { fill: COLOR_UNAVAIL, size: 8 });
          } else {
            setCell(ws, row, col, '', { size: 8 });
          }
          col++;
        }
      }
      setCell(ws, row, col, totalHours, { bold: true, fill: COLOR_HEADER_SUB });
      setCell(ws, row, col + 1, tch, { bold: true, fill: COLOR_HEADER_SUB, size: 9 });
      row++;
    }
    setCell(ws, row, 1, '계', { bold: true, fill: COLOR_HEADER_SUB });
    col = 2;
    let grandTotal = 0;
    for (const d of DAYS) {
      for (const p of PERIODS) {
        let cnt = 0;
        for (const tch of allTeachers) {
          const tt = teacherTable.get(tch);
          if (tt && tt.has(`${d}|${p}`)) cnt++;
        }
        setCell(ws, row, col++, cnt, { bold: true, fill: COLOR_HEADER_SUB, size: 9 });
        grandTotal += cnt;
      }
    }
    setCell(ws, row, col, grandTotal, { bold: true, fill: COLOR_HEADER_SUB });
    setCell(ws, row, col + 1, '', { fill: COLOR_HEADER_SUB });
    ws.getColumn(1).width = 10;
    for (let c = 2; c <= ws.columnCount; c++) ws.getColumn(c).width = 6;
  }

  // ── 4. 학급별 개별 시트 ──
  const usedNames = new Set(['요약', '학교_전체시간표', '교사_전체시간표']);
  for (const cid of allClasses) {
    let name = cid.replace(/\//g, '_').slice(0, 31);
    if (usedNames.has(name)) name += '_C';
    usedNames.add(name);
    const ws = wb.addWorksheet(name);
    const isSpecial = specialSet.has(cid);
    setCell(ws, 1, 1, `${cid} 시간표${isSpecial ? ' (특별실)' : ''}`, { bold: true, fill: COLOR_HEADER_MAIN, size: 14 });
    ws.mergeCells(1, 1, 1, 6);
    setCell(ws, 2, 1, '교시', { bold: true, fill: COLOR_HEADER_SUB });
    DAYS.forEach((d, i) => setCell(ws, 2, i + 2, d, { bold: true, fill: COLOR_HEADER_SUB }));
    const grade = parseInt(cid.split('-')[0], 10);
    const ct = classTable.get(cid) || new Map();
    for (const p of PERIODS) {
      setCell(ws, p + 2, 1, String(p), { bold: true, fill: COLOR_HEADER_SUB });
      DAYS.forEach((d, i) => {
        const ncKey = `${grade}|${d}|${p}`;
        if (nonclassSet.has(ncKey)) {
          setCell(ws, p + 2, i + 2, ncLabel.get(ncKey) || '비', { fill: COLOR_NONCLASS });
        } else if (ct.has(`${d}|${p}`)) {
          const [subj, tch, bk] = ct.get(`${d}|${p}`);
          const fill = bk ? (bundleColors.get(bk) || COLOR_BUNDLE) : null;
          setCell(ws, p + 2, i + 2, `${subj}\n(${tch})`, { fill });
        } else {
          setCell(ws, p + 2, i + 2, '');
        }
      });
    }
    for (let c = 1; c <= 6; c++) ws.getColumn(c).width = 14;
  }

  // ── 5. 교사별 개별 시트 ──
  for (const tch of allTeachers) {
    let name = tch.replace(/\//g, '_').slice(0, 31);
    if (usedNames.has(name)) name += '_T';
    usedNames.add(name);
    const ws = wb.addWorksheet(name);
    setCell(ws, 1, 1, `${tch} 시간표`, { bold: true, fill: COLOR_HEADER_MAIN, size: 14 });
    ws.mergeCells(1, 1, 1, 6);
    setCell(ws, 2, 1, '교시', { bold: true, fill: COLOR_HEADER_SUB });
    DAYS.forEach((d, i) => setCell(ws, 2, i + 2, d, { bold: true, fill: COLOR_HEADER_SUB }));
    const tt = teacherTable.get(tch) || new Map();
    const ua = unavailAll.get(tch) || new Set();
    for (const p of PERIODS) {
      setCell(ws, p + 2, 1, String(p), { bold: true, fill: COLOR_HEADER_SUB });
      DAYS.forEach((d, i) => {
        const key = `${d}|${p}`;
        if (tt.has(key)) {
          const [subj, cids, bk] = tt.get(key);
          const fill = bk ? (bundleColors.get(bk) || COLOR_BUNDLE) : null;
          setCell(ws, p + 2, i + 2, `${subj}\n(${cids})`, { fill });
        } else if (ua.has(key)) {
          setCell(ws, p + 2, i + 2, '불가', { fill: COLOR_UNAVAIL });
        } else {
          setCell(ws, p + 2, i + 2, '');
        }
      });
    }
    for (let c = 1; c <= 6; c++) ws.getColumn(c).width = 14;
  }

  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
