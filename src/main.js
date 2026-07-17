/** 시간표 생성기 웹 UI */
import * as XLSX from 'xlsx';
import CpSat from 'or-tools-wasm/cp-sat';
import { DAYS, PERIODS, parseData, Scheduler, computeClassTotalHours, computeTeacherTotalHours } from './engine.js';
import { solveCpsatIterated } from './solver.js';
import { buildExcel, bundleColorMap } from './xlsx_out.js';
import { buildTemplate } from './template_gen.js';

// 워커 브리지: 솔버를 워커에서 돌려 화면이 멈추지 않게
try { CpSat.setWorkerBridgeEnabled(true); } catch { /* node/미지원 환경 */ }

const $ = (id) => document.getElementById(id);

// ───────── 규칙 정의 (재넘버링: 하드1~7, 소프트1~5) ─────────
const RULES = [
  { key: 'classConflict', cat: 'hard', num: 1, name: '학급 중복 금지', locked: true,
    desc: '한 학급은 같은 요일·같은 교시에 두 개의 수업을 들을 수 없습니다.\n시간표가 성립하기 위한 가장 기본적인 조건이라 끌 수 없습니다.' },
  { key: 'teacherConflict', cat: 'hard', num: 2, name: '교사 중복 금지', locked: true,
    desc: '한 교사는 같은 요일·같은 교시에 두 곳에서 수업할 수 없습니다.\n물리적으로 불가능한 배치이므로 끌 수 없습니다.' },
  { key: 'nonclass', cat: 'hard', num: 3, name: '비수업 시간 준수',
    desc: "'비수업 시간'으로 지정한 (학년·요일·교시)에는 그 학년의 수업이 배정되지 않습니다.\n예: 매주 월요일 1교시가 전 학년 창의적 체험활동이면 그 칸을 비웁니다.\n\n끄면 비수업 지정을 무시하고 그 칸에도 수업을 넣습니다." },
  { key: 'unavail', cat: 'hard', num: 4, name: '교사 불가시간 준수',
    desc: "교사별로 '불가'로 지정한 시간(요일·교시, 학년별 지정 가능)에는 그 교사의 수업이 배정되지 않습니다.\n출장·겸임·개인 사정 등에 사용합니다.\n\n끄면 불가시간 지정을 무시합니다." },
  { key: 'bundleDay', cat: 'hard', num: 5, name: '묶음수업 요일 분산',
    desc: '같은 묶음수업(여러 학급이 함께 듣는 합반·이동수업 등)의 여러 시간은 서로 다른 요일에 나뉘어 배치됩니다.\n예: 3시간짜리 탐구 묶음은 월·수·금처럼 흩어집니다.\n\n끄면 같은 요일에 여러 번 배치될 수 있습니다.' },
  { key: 'sameSubjectDay', cat: 'hard', num: 6, name: '같은 과목 같은 날 금지',
    desc: '한 학급에서 같은 과목이 하루에 몰리지 않도록, 주당 시수를 요일에 고르게 나눕니다.\n단, 주 5시간을 넘는 과목은 어쩔 수 없이 하루 2회가 허용됩니다(비둘기집 원리).\n\n끄면 같은 과목을 하루에 몰아 배치할 수 있습니다.' },
  { key: 'twoHourAdjDay', cat: 'hard', num: 7, name: '2시간 과목 연속 요일 금지',
    desc: '주 2시간짜리 과목이 붙어 있는 요일(예: 월·화)에 놓이지 않도록 하루 이상 간격을 둡니다.\n\n끄면 2시간 과목이 이어진 요일에 배치될 수 있습니다.' },
  { key: 'teacherConsec', cat: 'soft', num: 1, name: '교사 연속수업 제한', score: '50점 / 초과 교시',
    desc: "한 교사가 설정에서 정한 '교사 최대 연속' 교시를 넘겨 내리 수업하지 않도록 유도합니다.\n예: 최대 2로 두면 3연속부터 벌점이 붙습니다.\n\n교사의 연속 수업 피로를 줄이는 규칙입니다." },
  { key: 'teacherDaily', cat: 'soft', num: 2, name: '교사 하루 시수 과다', score: '10점 / 초과 시간',
    desc: '한 교사의 수업이 특정 요일에 지나치게 몰리지 않도록, 하루 평균 시수에 맞춰 고르게 분산합니다.\n묶음수업이 있는 날은 한 시간까지 여유를 둡니다.' },
  { key: 'pairing', cat: 'soft', num: 3, name: '연강 묶기', score: '25점',
    desc: '한 교사가 하루 3시간 이상 수업하는 날, 그중 최소 두 시간은 연강(붙은 수업)이 되도록 유도합니다.\n수업이 2·4·6교시처럼 뿔뿔이 흩어지는 것을 막습니다.' },
  { key: 'similarDay', cat: 'soft', num: 4, name: '유사과목 같은 날 회피', score: '5점',
    desc: "'유사과목 그룹'으로 묶은 과목들이 한 학급에서 같은 날 겹치지 않도록 유도합니다.\n유사과목 그룹을 지정하지 않으면 영향이 없습니다." },
  { key: 'lunch', cat: 'soft', num: 5, name: '점심 전후 연속 방지', score: '40점',
    desc: "한 교사가 점심 직전 교시와 직후 교시를 연달아 맡지 않도록 합니다.\n설정에서 '점심 직전 교시'를 지정할 수 있습니다.\n\n기본은 꺼져 있습니다." },
];
const DEFAULT_RULE_FLAGS = Object.fromEntries(RULES.map(r => [r.key, r.key !== 'lunch']));

// ───────── 앱 상태 ─────────
const app = {
  rows: null,       // 업로드한 시수표 원본 (2차원 배열) — 세션 저장용
  data: null,       // parseData 결과
  nonclass: [],     // [{grade, day, period, label}]
  unavail: [],      // [{teacher, day, period, grade}]
  similar: [],      // [{name, subjects: []}]
  ruleFlags: { ...DEFAULT_RULE_FLAGS },
  gradeCount: 3,    // 학교급: 중등 3 / 초등 6
  tplSpecials: [],  // 양식 생성용 특별실 이름 목록
  running: false,
  stopFlag: false,
  lastState: null,  // 마지막 결과 State
  lastSol: null,
  lastSch: null,
  editHistory: [],  // 편집 취소용 스냅샷 스택
};

// ───────── 초기 UI 구성 ─────────
for (const d of DAYS) $('ncDay').insertAdjacentHTML('beforeend', `<option value="${d}">${d}요일</option>`);
for (const p of PERIODS) $('ncPeriod').insertAdjacentHTML('beforeend', `<option value="${p}">${p}교시</option>`);

// ───────── 테마 (라이트/다크) ─────────
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  $('btnTheme').textContent = t === 'dark' ? '☀️' : '🌙';
  try { localStorage.setItem('tt-theme', t); } catch { /* ignore */ }
}
applyTheme((() => {
  try { const s = localStorage.getItem('tt-theme'); if (s) return s; } catch { /* ignore */ }
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
})());
$('btnTheme').onclick = () =>
  applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');

// ───────── 학년 관련 셀렉트/입력 ─────────
function gradeOptions(withAll) {
  let html = withAll ? `<option value="0">${withAll}</option>` : '';
  for (let g = 1; g <= app.gradeCount; g++) html += `<option value="${g}">${g}학년${withAll ? '만' : ''}</option>`;
  return html;
}
function rebuildGradeSelects() {
  $('ncGrade').innerHTML = '<option value="0">전체학년</option>' +
    Array.from({ length: app.gradeCount }, (_, i) => `<option value="${i + 1}">${i + 1}학년</option>`).join('');
  $('uaGrade').innerHTML = '<option value="0">전체학년</option>' +
    Array.from({ length: app.gradeCount }, (_, i) => `<option value="${i + 1}">${i + 1}학년만</option>`).join('');
}
function renderTplGrades() {
  $('tplGrades').innerHTML = Array.from({ length: app.gradeCount }, (_, i) =>
    `<label class="field">${i + 1}학년<input type="number" class="tpl-g" data-g="${i + 1}" value="6" min="0" max="20" />반</label>`
  ).join('');
}
// 학교급 세그먼트
document.querySelectorAll('#levelSeg .seg-btn').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('#levelSeg .seg-btn').forEach(b => b.classList.toggle('active', b === btn));
    app.gradeCount = parseInt(btn.dataset.level, 10);
    rebuildGradeSelects();
    renderTplGrades();
  };
});
rebuildGradeSelects();
renderTplGrades();

// 교사불가 격자 (요일 행 × 교시 열 + '전체' 열)
function buildUaGrid() {
  const t = $('uaGrid');
  let html = '<tr><th></th>' + PERIODS.map(p => `<th>${p}교시</th>`).join('') + '<th>전체</th></tr>';
  for (const d of DAYS) {
    html += `<tr><th>${d}</th>`;
    for (const p of PERIODS) html += `<td><input type="checkbox" data-d="${d}" data-p="${p}"></td>`;
    html += `<td><input type="checkbox" data-all="${d}"></td></tr>`;
  }
  t.innerHTML = html;
  let guard = false;
  t.addEventListener('change', (e) => {
    if (guard) return;
    guard = true;
    const el = e.target;
    if (el.dataset.all) {
      const d = el.dataset.all;
      t.querySelectorAll(`input[data-d="${d}"]`).forEach(c => { c.checked = el.checked; });
    } else if (el.dataset.d) {
      const d = el.dataset.d;
      const cells = [...t.querySelectorAll(`input[data-d="${d}"]`)];
      const allBox = t.querySelector(`input[data-all="${d}"]`);
      allBox.checked = cells.every(c => c.checked);
    }
    guard = false;
  });
}
buildUaGrid();

function uaGridSet(pairs) { // pairs: Set("d|p")
  const t = $('uaGrid');
  t.querySelectorAll('input[data-d]').forEach(c => { c.checked = pairs.has(`${c.dataset.d}|${c.dataset.p}`); });
  for (const d of DAYS) {
    const cells = [...t.querySelectorAll(`input[data-d="${d}"]`)];
    t.querySelector(`input[data-all="${d}"]`).checked = cells.every(c => c.checked);
  }
}
function uaGridGet() {
  const out = [];
  $('uaGrid').querySelectorAll('input[data-d]').forEach(c => {
    if (c.checked) out.push([c.dataset.d, parseInt(c.dataset.p, 10)]);
  });
  return out;
}

// ───────── 파일 로드 ─────────
$('btnOpenFile').onclick = () => $('fileInput').click();
$('fileInput').onchange = async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  const buf = await f.arrayBuffer();
  loadWorkbook(buf, f.name);
  e.target.value = '';
};

function loadWorkbook(buf, name) {
  try {
    const wb = XLSX.read(buf, { type: 'array' });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null });
    const data = parseData(rows);
    const nCls = [...data.classes_per_grade.values()].reduce((a, b) => a + b.length, 0);
    if (!nCls || !data.teachers.length) {
      alert('시수표 형식을 인식하지 못했습니다. 양식 파일을 확인해 주세요.');
      return;
    }
    app.rows = rows;
    app.data = data;
    afterDataLoaded(name);
  } catch (err) {
    alert('파일을 읽는 중 오류: ' + err.message);
  }
}

function afterDataLoaded(name) {
  const data = app.data;
  const nCls = [...data.classes_per_grade.values()].reduce((a, b) => a + b.length, 0);
  const classTot = computeClassTotalHours(data);
  const teacherTot = computeTeacherTotalHours(data);
  const maxT = Math.max(...teacherTot.values());
  $('fileInfo').innerHTML =
    `✅ <b>${name || '시수표'}</b> — 학급 ${nCls}개 · 교사 ${data.teachers.length}명 · ` +
    `묶음 ${data.bundle_groups.length}개 · 최다 학급 시수 ${Math.max(...classTot.values())} · 최다 교사 시수 ${maxT}`;
  // 교사/과목 선택 채우기
  $('uaTeacher').innerHTML = data.teachers.map(t => `<option value="${t}">${t}</option>`).join('');
  $('subjPalette').innerHTML = data.subjects.map(s =>
    `<label><input type="checkbox" value="${s}"> ${s}</label>`).join('');
  $('fileInfo').classList.remove('empty');
  // 파일의 최대 학년에 맞춰 학교급 자동 반영 (초등 6학년 등)
  const maxGrade = Math.max(3, ...(data.grades || [3]));
  if (maxGrade > 3 && app.gradeCount < maxGrade) {
    app.gradeCount = maxGrade > 3 ? 6 : 3;
    document.querySelectorAll('#levelSeg .seg-btn').forEach(b =>
      b.classList.toggle('active', parseInt(b.dataset.level, 10) === app.gradeCount));
    rebuildGradeSelects();
    renderTplGrades();
  }
  $('btnNext').disabled = false;
  document.querySelector('.step-item[data-step="2"]').disabled = false;
  setPenalty('—', '준비됨', 'idle');
  renderAll();
  onUaTeacherChange();
}

// ───────── 비수업 ─────────
$('btnAddNc').onclick = () => {
  const g = parseInt($('ncGrade').value, 10);
  const day = $('ncDay').value;
  const period = parseInt($('ncPeriod').value, 10);
  const grades = g === 0 ? [1, 2, 3] : [g];
  for (const grade of grades) {
    if (!app.nonclass.some(s => s.grade === grade && s.day === day && s.period === period)) {
      app.nonclass.push({ grade, day, period, label: '자율' });
    }
  }
  renderNc();
};

function renderNc() {
  const cols = [];
  for (let g = 1; g <= app.gradeCount; g++) {
    const items = app.nonclass.filter(s => s.grade === g)
      .sort((a, b) => (DAYS.indexOf(a.day) - DAYS.indexOf(b.day)) || (a.period - b.period));
    const chips = items.map(s =>
      `<span class="chip">${s.day} ${s.period}교시 <span class="x" data-g="${s.grade}" data-d="${s.day}" data-p="${s.period}">✕</span></span>`
    ).join('') || '<span class="hint">없음</span>';
    cols.push(`<div class="nc-col"><span class="nc-tag">${g}학년</span><div class="chips">${chips}</div></div>`);
  }
  $('ncGrid').innerHTML = cols.join('');
  $('ncGrid').style.gridTemplateColumns = `repeat(${Math.min(app.gradeCount, 3)}, 1fr)`;
}
document.addEventListener('click', (e) => {
  const x = e.target.closest('.chip .x');
  if (!x) return;
  if (x.dataset.g !== undefined && x.dataset.d !== undefined) {
    const g = parseInt(x.dataset.g, 10), d = x.dataset.d, p = parseInt(x.dataset.p, 10);
    app.nonclass = app.nonclass.filter(s => !(s.grade === g && s.day === d && s.period === p));
    renderNc();
  } else if (x.dataset.ua !== undefined) {
    app.unavail.splice(parseInt(x.dataset.ua, 10), 1);
    renderUa();
  } else if (x.dataset.grp !== undefined) {
    app.similar.splice(parseInt(x.dataset.grp, 10), 1);
    renderGroups();
  } else if (x.dataset.special !== undefined) {
    app.tplSpecials.splice(parseInt(x.dataset.special, 10), 1);
    renderTplSpecials();
  }
});

// ───────── 교사 불가시간 ─────────
$('uaTeacher').onchange = onUaTeacherChange;
$('uaGrade').onchange = onUaTeacherChange;
function onUaTeacherChange() {
  const t = $('uaTeacher').value;
  const g = parseInt($('uaGrade').value, 10);
  const pairs = new Set(app.unavail.filter(u => u.teacher === t && (u.grade || 0) === g)
    .map(u => `${u.day}|${u.period}`));
  uaGridSet(pairs);
}
$('btnUaClear').onclick = () => uaGridSet(new Set());
$('btnUaRegister').onclick = () => {
  const t = $('uaTeacher').value;
  if (!t) return;
  const g = parseInt($('uaGrade').value, 10);
  // 이 교사+학년의 기존 항목을 격자 내용으로 동기화
  app.unavail = app.unavail.filter(u => !(u.teacher === t && (u.grade || 0) === g));
  for (const [d, p] of uaGridGet()) app.unavail.push({ teacher: t, day: d, period: p, grade: g });
  renderUa();
};
function renderUa() {
  const el = $('uaList');
  el.innerHTML = app.unavail.map((u, i) =>
    `<span class="chip">${u.teacher} ${u.day}${u.period}${u.grade ? ` (${u.grade}학년)` : ''} <span class="x" data-ua="${i}">✕</span></span>`
  ).join('') || '<span class="hint">등록된 불가시간 없음</span>';
}

// ───────── 유사과목 ─────────
$('btnAddGroup').onclick = () => {
  const name = $('grpName').value.trim();
  const subjects = [...$('subjPalette').querySelectorAll('input:checked')].map(c => c.value);
  if (!name) { alert('그룹 이름을 입력하세요.'); return; }
  if (subjects.length < 2) { alert('과목을 2개 이상 선택하세요.'); return; }
  app.similar.push({ name, subjects });
  $('grpName').value = '';
  $('subjPalette').querySelectorAll('input:checked').forEach(c => { c.checked = false; });
  renderGroups();
};
function renderGroups() {
  $('grpList').innerHTML = app.similar.map((g, i) =>
    `<span class="chip">${g.name}: ${g.subjects.join(', ')} <span class="x" data-grp="${i}">✕</span></span>`
  ).join('') || '<span class="hint">등록된 그룹 없음</span>';
}

function renderAll() { renderNc(); renderUa(); renderGroups(); renderTplSpecials(); renderRules(); }

// ───────── 시수표 양식 생성 ─────────
function renderTplSpecials() {
  $('tplSpecialList').innerHTML = app.tplSpecials.map((s, i) =>
    `<span class="chip">${s} <span class="x" data-special="${i}">✕</span></span>`
  ).join('') || '<span class="hint">특별실 없음 (이름을 입력하고 추가하세요)</span>';
}
$('btnAddSpecial').onclick = () => {
  const name = $('tplSpecialName').value.trim();
  if (!name) return;
  if (!app.tplSpecials.includes(name)) app.tplSpecials.push(name);
  $('tplSpecialName').value = '';
  renderTplSpecials();
};
$('tplSpecialName').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btnAddSpecial').click(); });

// ───────── 규칙 선택 + 설명 팝업 ─────────
function ruleRow(r) {
  const on = app.ruleFlags[r.key];
  const numLabel = (r.cat === 'hard' ? '하드' : '소프트') + r.num;
  const meta = r.cat === 'hard'
    ? (r.locked ? '<span class="rule-score">필수</span>' : '')
    : `<span class="rule-score">${r.score}</span>`;
  return `<div class="rule-row">
    <label class="rule-toggle"><input type="checkbox" data-rule="${r.key}" ${on ? 'checked' : ''} ${r.locked ? 'disabled' : ''}><span class="track"></span></label>
    <span class="rule-num">${numLabel}</span>
    <div class="rule-main"><span class="rule-name">${r.name}</span>${meta}</div>
    <button class="rule-desc-btn" data-desc="${r.key}">설명</button>
  </div>`;
}
function renderRules() {
  $('hardRules').innerHTML = RULES.filter(r => r.cat === 'hard').map(ruleRow).join('');
  $('softRules').innerHTML = RULES.filter(r => r.cat === 'soft').map(ruleRow).join('');
}
$('secRules').addEventListener('change', (e) => {
  const cb = e.target.closest('input[data-rule]');
  if (cb) app.ruleFlags[cb.dataset.rule] = cb.checked;
});
$('secRules').addEventListener('click', (e) => {
  const b = e.target.closest('[data-desc]');
  if (b) openRuleModal(b.dataset.desc);
});
function openRuleModal(key) {
  const r = RULES.find(x => x.key === key);
  $('ruleModalTitle').textContent = `${r.cat === 'hard' ? '하드' : '소프트'}${r.num}. ${r.name}`;
  const esc = r.desc.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const note = r.cat === 'soft' && r.score ? `\n\n<span class="m-score">벌점: ${r.score}</span>`
    : (r.locked ? '\n\n<span class="m-score">필수 규칙 — 끌 수 없습니다</span>' : '');
  $('ruleModalBody').innerHTML = esc + note;
  $('ruleModal').hidden = false;
}
function closeRuleModal() { $('ruleModal').hidden = true; }
$('ruleModalClose').onclick = closeRuleModal;
$('ruleModalBackdrop').onclick = closeRuleModal;
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeRuleModal(); });

$('btnTemplate').onclick = async () => {
  const counts = [...document.querySelectorAll('#tplGrades .tpl-g')].map(el => parseInt(el.value, 10) || 0);
  const specials = app.tplSpecials.slice();
  const blob = await buildTemplate({ counts, specials });
  await saveFile(blob, `시수표양식_${counts.join('-')}반_특별실${specials.length}.xlsx`, XLSX_TYPE);
};

// ───────── 파일 저장 (사용자 지정 경로) ─────────
const JSON_TYPE = { description: 'JSON 파일', mime: 'application/json', ext: '.json' };
const XLSX_TYPE = {
  description: '엑셀 파일',
  mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ext: '.xlsx',
};
/** 저장 위치를 사용자가 고르게 한다(지원 브라우저). 미지원이면 다운로드 폴백. */
async function saveFile(blob, suggestedName, type) {
  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName,
        types: [{ description: type.description, accept: { [type.mime]: [type.ext] } }],
      });
      const w = await handle.createWritable();
      await w.write(blob);
      await w.close();
      return true;
    } catch (err) {
      if (err && err.name === 'AbortError') return false;  // 사용자가 취소
      // 그 외 오류는 다운로드로 폴백
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = suggestedName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  return true;
}

// ───────── 설정 저장/불러오기 ─────────
function collectSettings() {
  return {
    year: parseInt($('year').value, 10),
    semester: parseInt($('semester').value, 10),
    gradeCount: app.gradeCount,
    nonclass: app.nonclass,
    unavail: app.unavail,
    similar: app.similar,
    tplSpecials: app.tplSpecials,
    ruleFlags: app.ruleFlags,
    params: {
      max_consecutive: parseInt($('pMaxConsec').value, 10),
      daily_n: parseInt($('pDailyN').value, 10),
      time_limit: parseInt($('pTimeLimit').value, 10),
      lunch_period: parseInt($('pLunchPeriod').value, 10),
    },
  };
}
function applySettings(s) {
  if (s.year) $('year').value = s.year;
  if (s.semester) $('semester').value = s.semester;
  if (s.gradeCount) {
    app.gradeCount = s.gradeCount;
    document.querySelectorAll('#levelSeg .seg-btn').forEach(b =>
      b.classList.toggle('active', parseInt(b.dataset.level, 10) === app.gradeCount));
    rebuildGradeSelects();
    renderTplGrades();
  }
  app.nonclass = s.nonclass || [];
  app.unavail = s.unavail || [];
  app.similar = s.similar || [];
  app.tplSpecials = s.tplSpecials || [];
  app.ruleFlags = { ...DEFAULT_RULE_FLAGS, ...(s.ruleFlags || {}) };
  const p = s.params || {};
  if (p.max_consecutive) $('pMaxConsec').value = p.max_consecutive;
  if (p.daily_n !== undefined) $('pDailyN').value = p.daily_n;
  if (p.time_limit) $('pTimeLimit').value = p.time_limit;
  if (p.lunch_period) $('pLunchPeriod').value = p.lunch_period;
  renderAll();
  if (app.data) onUaTeacherChange();
}
$('btnSaveSettings').onclick = () => {
  saveJson(collectSettings(), `시간표설정_${$('year').value}_${$('semester').value}.json`);
};
$('btnLoadSettings').onclick = () => $('settingsInput').click();
$('settingsInput').onchange = async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    applySettings(JSON.parse(await f.text()));
  } catch (err) { alert('설정 파일 오류: ' + err.message); }
  e.target.value = '';
};

function saveJson(obj, name) {
  const blob = new Blob([JSON.stringify(obj, null, 1)], { type: 'application/json' });
  return saveFile(blob, name, JSON_TYPE);
}

// ───────── 이어돌리기 세션 ─────────
$('btnSession').onclick = () => {
  if (!app.lastState || !app.rows) return;
  const session = {
    kind: 'timetable-session', version: 1,
    rows: app.rows,
    settings: collectSettings(),
    warm: app.lastState.snapshot(),
  };
  saveJson(session, `이어돌리기_${$('year').value}_${$('semester').value}.json`);
};
$('btnSessionOpen').onclick = () => $('sessionInput').click();
$('sessionInput').onchange = async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const s = JSON.parse(await f.text());
    if (s.kind !== 'timetable-session') throw new Error('이어돌리기 파일이 아닙니다.');
    app.rows = s.rows;
    app.data = parseData(s.rows);
    afterDataLoaded('(이어돌리기 세션)');
    applySettings(s.settings || {});
    app.sessionWarm = s.warm || null;
    if (app.sessionWarm) {
      $('fileInfo').innerHTML += ' — <b>이어돌리기 준비됨</b> (시간표 생성을 누르면 저장된 시간표에서 이어갑니다)';
    }
  } catch (err) { alert('세션 파일 오류: ' + err.message); }
  e.target.value = '';
};

// ───────── 실행 ─────────
function buildScheduler() {
  const s = collectSettings();
  // 규칙 플래그: 'lunch'는 엔진의 lunch_split으로 매핑, 나머지는 rules로 전달
  const { lunch, ...rules } = app.ruleFlags;
  const params = {
    max_consecutive: s.params.max_consecutive,
    daily_n: s.params.daily_n,
    lunch_split: !!lunch,
    lunch_period: s.params.lunch_period,
    semester: s.semester,
    rules,
  };
  return new Scheduler(app.data, app.nonclass, app.unavail, app.similar, params);
}

async function runSolve(warmUnits = null) {
  if (app.running || !app.data) return;
  app.running = true;
  app.stopFlag = false;
  gotoStep(2);
  $('btnRun').hidden = true;
  $('btnMore').hidden = true;
  $('btnSession').hidden = true;
  $('btnPrev').hidden = true;
  $('btnStop').hidden = false;
  $('penaltyCard').hidden = false;
  $('progressBox').hidden = false;
  $('secRun').hidden = false;
  $('runLog').textContent = '';
  setPenalty('…', '생성 중', 'run');

  const log = (msg) => {
    $('progressMsg').textContent = msg;
    const m = String(msg).match(/페널티\s*([\d,]+)/g);
    if (m) {
      const last = m[m.length - 1].match(/([\d,]+)/)[1];
      setPenalty(last, '현재 페널티', 'run');
    }
    const el = $('runLog');
    el.textContent += msg + '\n';
    el.scrollTop = el.scrollHeight;
  };

  try {
    const sch = buildScheduler();
    app.lastSch = sch;
    // 사전 진단
    const probs = sch.feasibilityReport();
    if (probs.length) {
      log('⚠ 사전 진단에서 문제 발견:');
      for (const p of probs) log('  • ' + p);
      showResultWarn(sch.feasibilityText());
      return;
    }
    const timeLimit = parseInt($('pTimeLimit').value, 10);
    const workers = Math.max(2, Math.min(navigator.hardwareConcurrency || 4, 16));
    log(`탐색 시작 — 시간 ${timeLimit}초, 워커 ${workers}개 (내 컴퓨터 CPU 사용)`);
    const { state, status } = await solveCpsatIterated(sch, {
      timeLimit, workers,
      warmUnits,
      progress: log,
      shouldStop: () => app.stopFlag,
    });
    if (!state) {
      if (status === 'INFEASIBLE') {
        showResultWarn(sch.feasibilityText());
      } else {
        showResultWarn(`해를 찾지 못했습니다 (${status}). 탐색 시간을 늘리거나 조건을 완화해 보세요.`);
      }
      return;
    }
    app.lastState = state;
    app.lastSol = state.getSolution();
    showResult();
  } catch (err) {
    console.error(err);
    showResultWarn('오류가 발생했습니다: ' + err.message);
  } finally {
    app.running = false;
    $('btnStop').hidden = true;
    $('progressBox').hidden = true;
    // 현재 단계에 맞는 버튼 구성으로 복귀
    gotoStep(app.lastState ? 3 : 2);
  }
}

$('btnRun').onclick = () => runSolve(app.sessionWarm || null);
$('btnMore').onclick = () => runSolve(app.lastState ? app.lastState.snapshot() : app.sessionWarm);
$('btnStop').onclick = () => {
  app.stopFlag = true;
  $('progressMsg').textContent = '중단 요청됨 — 현재 회차 마무리 중…';
  try { CpSat.cancelSolve(); } catch { /* ignore */ }
};

function showResultWarn(text) {
  const el = $('resultSummary');
  el.className = 'result-summary warn';
  el.textContent = text;
  $('ttPreview').innerHTML = '';
  $('diagText').textContent = '';
  setPenalty('해 없음', '조건 확인 필요', 'warn');
  document.querySelector('.step-item[data-step="3"]').disabled = false;
  gotoStep(3);
}

function updateResultSummary() {
  const sol = app.lastSol;
  const el = $('resultSummary');
  const hard = ['H2', 'H3', 'H4', 'H6', 'H8'].reduce((a, k) => a + (sol.violations[k] || 0), 0);
  const vtext = Object.entries(sol.violations).sort().map(([k, v]) => `${k}:${v}`).join(' · ') || '없음';
  const ok = hard === 0;
  el.className = 'result-summary' + (ok ? '' : ' warn');
  el.innerHTML = `<b>총 페널티 ${sol.penalty}</b> — 하드 위반 ${ok ? '없음 ✓' : hard + '건 ⚠'}<br>` +
    `<span style="color:var(--muted);font-size:13px">위반 내역: ${vtext}</span>`;
  $('diagText').textContent = app.lastState.diagnoseText();
  setPenalty(sol.penalty, ok ? (sol.penalty === 0 ? '완성 · 페널티 0' : '최종 페널티') : '하드 위반 있음', ok ? 'done' : 'warn');
}

function showResult() {
  app.editHistory = [];       // 새 결과 → 편집 취소 이력 초기화
  updateUndoBtn();
  updateResultSummary();
  // 생성 완료 → 3단계로 자동 전환, 장판지 보기로
  document.querySelector('.step-item[data-step="3"]').disabled = false;
  setView('board');
  gotoStep(3);
}

// 편집 후: 결과 재계산 + 보드 다시 그리기
function afterEdit() {
  app.lastSol = app.lastState.getSolution();
  updateResultSummary();
  renderPreview();
}
function updateUndoBtn() {
  $('btnUndo').disabled = app.editHistory.length === 0;
  $('btnUndo').textContent = app.editHistory.length ? `편집 취소 (${app.editHistory.length})` : '편집 취소';
}
$('btnUndo').onclick = () => {
  if (!app.editHistory.length) return;
  app.lastState.restore(app.editHistory.pop());
  updateUndoBtn();
  afterEdit();
};

// ───────── 미리보기 · 편집 보드 ─────────
$('viewMode').onchange = () => { updateViewTargets(); renderPreview(); };
$('viewTarget').onchange = renderPreview;

function setView(view) {
  document.querySelectorAll('#viewSeg .seg-btn').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  $('viewMode').value = view;
  updateViewTargets();
  renderPreview();
}
document.querySelectorAll('#viewSeg .seg-btn').forEach(btn => {
  btn.onclick = () => setView(btn.dataset.view);
});

function updateViewTargets() {
  if (!app.lastSol) return;
  const mode = $('viewMode').value;
  const sel = $('viewTarget');
  if (mode === 'board') { sel.hidden = true; return; }
  sel.hidden = false;
  let items;
  if (mode === 'class') {
    items = [...new Set(app.lastSol.assignments.map(a => a[2]))].sort((a, b) => {
      const [ga, la] = a.split('-'); const [gb, lb] = b.split('-');
      return (parseInt(ga, 10) - parseInt(gb, 10)) || (la < lb ? -1 : la > lb ? 1 : 0);
    });
  } else {
    items = [...new Set(app.lastSol.assignments.map(a => a[1]))].sort();
  }
  sel.innerHTML = items.map(i => `<option value="${i}">${i}</option>`).join('');
}

const bcode = (bk) => (bk ? bk.split('_').slice(1).join('_') : '');

// 특정 키(학급/교사) 기준으로 슬롯별 배치 단위 목록
function occupantsBySlot(key, keyType) {
  const st = app.lastState, m = new Map();
  for (let u = 0; u < st.sch.units.length; u++) {
    const dp = st.pos[u];
    if (!dp) continue;
    const cells = st.sch.units[u].cells.filter(c => keyType === 'class' ? c[0] === key : c[1] === key);
    if (!cells.length) continue;
    const kk = `${dp[0]}|${dp[1]}`;
    if (!m.has(kk)) m.set(kk, []);
    m.get(kk).push({ uid: u, subj: cells[0][2], tch: cells[0][1],
      cids: cells.map(c => c[0]).join(','), bk: st.sch.units[u].bundle_key });
  }
  return m;
}

// 장판지: 집은 수업을 '다른 선생님의 수업'과 맞교환했을 때(또는 본인 빈 시간으로 이동)
// 하드 위반이 생기지 않는 칸을 모두 초록으로. 반환: Set("교사|요일|교시").
function boardGreen(st, uid) {
  const green = new Set();
  const posA = st.pos[uid];
  if (!posA) return green;
  const aTeachers = new Set(st.sch.units[uid].cells.map(c => c[1]));
  // (교사,요일,교시) → 그 칸을 차지한 unit 점유맵
  const occ = new Map();
  for (let u = 0; u < st.sch.units.length; u++) {
    const dp = st.pos[u];
    if (!dp) continue;
    for (const [, t] of st.sch.units[u].cells) occ.set(`${t}|${dp[0]}|${dp[1]}`, u);
  }
  const teachers = [...new Set(app.lastSol.assignments.map(a => a[1]))];
  for (const t of teachers) {
    for (const d of DAYS) {
      for (const p of PERIODS) {
        if (d === posA[0] && p === posA[1]) continue;   // 같은 시간끼리는 맞교환이 무의미(no-op)
        const uB = occ.get(`${t}|${d}|${p}`);
        if (uB === uid) continue;
        if (uB === undefined && !aTeachers.has(t)) continue;   // 빈 칸(내 행 아님)은 제외
        let ok;
        if (uB === undefined) {                 // 본인의 빈 시간으로 이동
          st.move(uid, d, p); ok = st.hardCount() === 0; st.move(uid, posA[0], posA[1]);
        } else {                                // 그 칸 수업과 맞교환
          st.swap(uid, uB); ok = st.hardCount() === 0; st.swap(uid, uB);
        }
        if (ok) green.add(`${t}|${d}|${p}`);
      }
    }
  }
  return green;
}

function cellInner(occ, cmap) {
  const o = occ[0];
  const bg = o.bk ? `background:#${cmap.get(o.bk) || 'FFF2CC'};` : '';
  const badge = o.bk ? `<span class="bmark">${bcode(o.bk)}</span>` : '';
  return { bg, badge };
}

function renderPreview() {
  if (!app.lastSol) return;
  const st = app.lastState;
  const mode = $('viewMode').value;
  const cmap = bundleColorMap(app.lastSol);
  const ncSet = new Set(app.nonclass.map(s => `${s.grade}|${s.day}|${s.period}`));
  const board = $('ttPreview');
  board.classList.toggle('board-mode', mode === 'board');

  if (mode === 'board') { renderMasterBoard(st, cmap); return; }

  const target = $('viewTarget').value;
  if (!target) { board.innerHTML = ''; return; }
  const keyType = mode === 'class' ? 'class' : 'teacher';
  const occ = occupantsBySlot(target, keyType);
  const grade = mode === 'class' ? parseInt(target.split('-')[0], 10) : 0;
  const uaSet = new Set(app.unavail.filter(u => u.teacher === target && (u.grade || 0) === 0)
    .map(u => `${u.day}|${u.period}`));

  let html = '<tr><th>교시</th>' + DAYS.map(d => `<th>${d}</th>`).join('') + '</tr>';
  for (const p of PERIODS) {
    html += `<tr><th>${p}</th>`;
    for (const d of DAYS) {
      const kk = `${d}|${p}`;
      const list = occ.get(kk);
      const da = `data-d="${d}" data-p="${p}" data-key="${target}" data-keytype="${keyType}"`;
      const nc = mode === 'class' && ncSet.has(`${grade}|${d}|${p}`);
      if (list && list.length) {
        const { bg, badge } = cellInner(list, cmap);
        const conflict = list.length > 1 || nc || (mode === 'teacher' && uaSet.has(kk));
        const sub = mode === 'class' ? list[0].tch : list[0].cids;
        const extra = list.length > 1 ? ` <span class="who">+${list.length - 1}</span>` : '';
        html += `<td ${da} draggable="true" data-uid="${list[0].uid}" class="${conflict ? 'conflict' : ''}" style="${bg}">` +
          `<div class="subj">${list[0].subj}${badge}</div><div class="who">${sub}${extra}</div></td>`;
      } else if (nc) {
        html += `<td ${da} class="nc">자율</td>`;
      } else if (mode === 'teacher' && uaSet.has(kk)) {
        html += `<td ${da} class="ua">불가</td>`;
      } else {
        html += `<td ${da}></td>`;
      }
    }
    html += '</tr>';
  }
  board.innerHTML = html;
}

// 장판지: 교사 × (요일·교시) 전체 격자
function renderMasterBoard(st, cmap) {
  const teachers = [...new Set(app.lastSol.assignments.map(a => a[1]))].sort();
  const occByTeacher = new Map(teachers.map(t => [t, occupantsBySlot(t, 'teacher')]));
  const uaByTeacher = new Map();
  for (const u of app.unavail) if ((u.grade || 0) === 0) {
    if (!uaByTeacher.has(u.teacher)) uaByTeacher.set(u.teacher, new Set());
    uaByTeacher.get(u.teacher).add(`${u.day}|${u.period}`);
  }
  let head1 = '<tr><th class="row-head">교사 \\ 요일</th>';
  for (const d of DAYS) head1 += `<th class="daygrp daysep" colspan="7">${d}</th>`;
  head1 += '</tr>';
  let head2 = '<tr><th class="row-head"></th>';
  for (const d of DAYS) for (const p of PERIODS) head2 += `<th class="${p === 1 ? 'daysep' : ''}">${p}</th>`;
  head2 += '</tr>';

  let body = '';
  for (const t of teachers) {
    const occ = occByTeacher.get(t);
    const ua = uaByTeacher.get(t) || new Set();
    body += `<tr><th class="row-head">${t}</th>`;
    for (const d of DAYS) {
      for (const p of PERIODS) {
        const kk = `${d}|${p}`;
        const sep = p === 1 ? 'daysep' : '';
        const da = `data-d="${d}" data-p="${p}" data-key="${t}" data-keytype="teacher"`;
        const list = occ.get(kk);
        if (list && list.length) {
          const { bg, badge } = cellInner(list, cmap);
          const conflict = list.length > 1;
          body += `<td ${da} draggable="true" data-uid="${list[0].uid}" class="${sep} ${conflict ? 'conflict' : ''}" style="${bg}">` +
            `<div class="subj">${list[0].cids}${badge}</div></td>`;
        } else if (ua.has(kk)) {
          body += `<td ${da} class="ua ${sep}">×</td>`;
        } else {
          body += `<td ${da} class="${sep}"></td>`;
        }
      }
    }
    body += '</tr>';
  }
  $('ttPreview').innerHTML = `<thead>${head1}${head2}</thead><tbody>${body}</tbody>`;
}

// ───────── 드래그앤드롭 편집 ─────────
(() => {
  const board = $('ttPreview');
  let picked = null;
  const clearMarks = () => board.querySelectorAll('.drag-src,.swap-ok,.drop-hover')
    .forEach(c => c.classList.remove('drag-src', 'swap-ok', 'drop-hover'));

  board.addEventListener('dragstart', (e) => {
    const td = e.target.closest('td[draggable="true"]');
    if (!td) { e.preventDefault(); return; }
    picked = { uid: +td.dataset.uid, key: td.dataset.key, keyType: td.dataset.keytype };
    td.classList.add('drag-src');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(picked.uid));
    if ($('viewMode').value === 'board') {
      // 장판지: 다른 선생님 수업까지 포함해 맞교환 가능한 칸을 표시 (출장 대체 등)
      const green = boardGreen(app.lastState, picked.uid);
      board.querySelectorAll('td[data-d]').forEach(c => {
        if (green.has(`${c.dataset.key}|${c.dataset.d}|${c.dataset.p}`)) c.classList.add('swap-ok');
      });
    } else {
      const green = app.lastState.greenSlotsFor(picked.uid, picked.key, picked.keyType);
      board.querySelectorAll('td[data-d]').forEach(c => {
        if (c.dataset.key === picked.key && green.has(`${c.dataset.d}|${c.dataset.p}`)) c.classList.add('swap-ok');
      });
    }
  });
  board.addEventListener('dragend', () => { clearMarks(); picked = null; });
  board.addEventListener('dragover', (e) => {
    if (!picked) return;
    const td = e.target.closest('td[data-d]');
    if (!td) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  });
  board.addEventListener('drop', (e) => {
    if (!picked) return;
    const td = e.target.closest('td[data-d]');
    if (!td) return;
    e.preventDefault();
    const d = td.dataset.d, p = +td.dataset.p;
    const st = app.lastState;
    const posA = st.pos[picked.uid];
    const same = posA && posA[0] === d && posA[1] === p;
    // 놓는 칸의 키(장판지에서는 그 칸이 속한 '다른 선생님')로 상대 수업을 찾아 맞교환한다
    const dropKey = td.dataset.key, dropType = td.dataset.keytype;
    const uB = dropType === 'class' ? st.classUnitAt(dropKey, d, p) : st.teacherUnitAt(dropKey, d, p);
    const pk = picked; picked = null; clearMarks();
    if (same || uB === pk.uid) return;
    app.editHistory.push(st.snapshot());   // 편집 취소용 이전 상태 저장
    if (app.editHistory.length > 100) app.editHistory.shift();
    updateUndoBtn();
    if (uB === null || uB === undefined) st.move(pk.uid, d, p);
    else st.swap(pk.uid, uB);
    afterEdit();
  });
})();

// ───────── 엑셀 다운로드 ─────────
$('btnDownload').onclick = async () => {
  if (!app.lastSol) return;
  const blob = await buildExcel(app.lastSol, app.data, app.nonclass, app.unavail,
    parseInt($('year').value, 10), parseInt($('semester').value, 10));
  const ts = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '');
  await saveFile(blob, `시간표_${$('year').value}_${$('semester').value}_${ts}.xlsx`, XLSX_TYPE);
};

// ───────── 레일: 페널티 표시 ─────────
function setPenalty(value, label, state) {
  $('penaltyLive').textContent = value;
  $('penaltyLabel').textContent = label;
  $('penaltyCard').dataset.state = state;
}

// ───────── 단계 전환 ─────────
let curStep = 1;
function gotoStep(n) {
  curStep = n;
  for (const i of [1, 2, 3]) $(`step${i}`).hidden = (i !== n);
  document.querySelectorAll('.step-item').forEach(b => {
    const s = parseInt(b.dataset.step, 10);
    b.classList.toggle('active', s === n);
    b.classList.toggle('done', s < n);
  });
  // 레일 하단 버튼 구성 (생성 중에는 runSolve가 별도로 관리)
  if (!app.running) {
    $('btnNext').hidden = (n !== 1);
    $('btnRun').hidden = (n !== 2);
    $('btnPrev').hidden = (n === 1);
    $('btnPrev').textContent = n === 3 ? '← 규칙 · 설정으로' : '← 기본 입력으로';
    $('btnMore').hidden = !(n === 3 && app.lastState);
    $('btnSession').hidden = !(n === 3 && app.lastState);
    $('penaltyCard').hidden = (n === 1);
  }
  window.scrollTo({ top: 0 });
}
document.querySelectorAll('.step-item').forEach(b => {
  b.onclick = () => { if (!b.disabled) gotoStep(parseInt(b.dataset.step, 10)); };
});
$('btnNext').onclick = () => gotoStep(2);
$('btnPrev').onclick = () => gotoStep(curStep === 3 ? 2 : 1);

// 초기 렌더
renderRules();
renderTplSpecials();
gotoStep(1);
