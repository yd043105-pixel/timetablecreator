/**
 * 시수표 양식 생성 (학년별 학급 수 + 특별실 개수에 맞춰).
 * excel_parser가 읽는 구조: [교사, 과목, 타임, <1학년 반들>, <2학년>, <3학년>, <특별실>, 계]
 * 반환: Blob (xlsx)
 */
import ExcelJS from 'exceljs';

const HEAD = '1F4E78';
const SUB = 'BDD7EE';
const SPECIAL = 'C6E0B4';

function fill(cell, argb) {
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + argb } };
}

export async function buildTemplate({ counts = [6, 6, 6], specials = ['특별실'] } = {}) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('교사별시수표');

  // 열 구성
  const gCounts = counts.map(n => Math.max(0, Math.min(20, n | 0)));
  // 특별실 라벨: 이름이 숫자만이면 반 번호와 헷갈리므로 앞에 '특' 부여
  const specialLabels = specials
    .map(s => String(s).trim()).filter(Boolean)
    .map(s => (/^\d+$/.test(s) ? '특' + s : s));

  // 헤더 2줄
  const row1 = ['교사', '과목', '타임'];
  const row2 = [null, null, null];
  const gradeStartCols = [];
  let col = 3; // 0-index
  gCounts.forEach((n, gi) => {
    const gLabel = `${gi + 1}학년`;
    gradeStartCols.push([col, n, gLabel]);
    for (let i = 0; i < n; i++) { row1.push(i === 0 ? gLabel : null); row2.push(i + 1); }
    col += n;
  });
  const nSpecial = specialLabels.length;
  const specialStart = col;
  specialLabels.forEach((lbl, i) => { row1.push(i === 0 ? '특별실' : null); row2.push(lbl); col++; });
  row1.push('계'); row2.push(null);
  const totalCol = col; // 0-index of 계

  ws.addRow(row1);
  ws.addRow(row2);
  // 데이터용 빈 행 몇 개
  for (let r = 0; r < 6; r++) ws.addRow([]);

  // 스타일
  const style = (cell, { bold = false, bg = null } = {}) => {
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.font = { name: '맑은 고딕', size: 10, bold, color: { argb: bg === HEAD ? 'FFFFFFFF' : 'FF000000' } };
    if (bg) fill(cell, bg);
    cell.border = { top: { style: 'thin', color: { argb: 'FF808080' } }, bottom: { style: 'thin', color: { argb: 'FF808080' } },
      left: { style: 'thin', color: { argb: 'FF808080' } }, right: { style: 'thin', color: { argb: 'FF808080' } } };
  };
  const r1 = ws.getRow(1), r2 = ws.getRow(2);
  for (let c = 1; c <= totalCol + 1; c++) {
    style(r1.getCell(c), { bold: true, bg: HEAD });
    style(r2.getCell(c), { bold: true, bg: SUB });
  }
  // 학년 헤더 병합 (값은 좌상단에만 남아 파서 호환)
  for (const [start, n, ] of gradeStartCols) {
    if (n >= 2) ws.mergeCells(1, start + 1, 1, start + n);
  }
  if (nSpecial >= 2) ws.mergeCells(1, specialStart + 1, 1, specialStart + nSpecial);
  // 특별실 헤더색
  for (let i = 0; i < nSpecial; i++) { fill(r2.getCell(specialStart + 1 + i), SPECIAL); }

  // 열 너비
  ws.getColumn(1).width = 12; ws.getColumn(2).width = 12; ws.getColumn(3).width = 7;
  for (let c = 4; c <= totalCol + 1; c++) ws.getColumn(c).width = 5.5;

  // 안내 시트
  const info = wb.addWorksheet('작성법');
  const notes = [
    ['시수표 작성 안내'],
    [''],
    ['1. 교사/과목/타임 열에 담당 교사와 과목을 적습니다.'],
    ['2. 각 학급(반) 열에 그 반의 주당 시수를 숫자로 적습니다.'],
    ['3. 타임 열: 묶음수업(합반)이면 같은 묶음끼리 같은 문자(A, B, ...)를 적고,'],
    ['   일반 수업이면 타임 열을 비워 둡니다.'],
    ['4. 특별실 열(특1, 특2 …)은 특별실 배정 수업에 사용합니다.'],
    ['   특별실 이름을 바꿔도 되지만 숫자만으로는 적지 마세요(반 번호와 구분).'],
    ['5. "계" 열은 자동 참고용이며 비워 두어도 됩니다.'],
  ];
  notes.forEach((n, i) => {
    const cell = info.getCell(i + 1, 1);
    cell.value = n[0];
    cell.font = { name: '맑은 고딕', size: i === 0 ? 13 : 11, bold: i === 0 };
  });
  info.getColumn(1).width = 70;

  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
