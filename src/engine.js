/**
 * 학교 시간표 생성기 — 웹 엔진 (Python v7.4.x 포팅)
 * excel_parser.py + scheduler.py(핵심부)의 충실한 JS 포팅.
 * 순수 JS — 브라우저/Node 양쪽에서 동작 (xlsx 파싱은 바깥에서 2차원 배열로 전달).
 */

export const DAYS = ["월", "화", "수", "목", "금"];
export const DAY_IDX = Object.fromEntries(DAYS.map((d, i) => [d, i]));
export const PERIODS = [1, 2, 3, 4, 5, 6, 7];

export const PEN = {
  CLASS_CONFLICT: 1000, TEACHER_CONFLICT: 1000, NONCLASS: 1000,
  SAME_DAY: 100, UNAVAIL: 1000, CONSEC: 50, BUNDLE_OVERLAP: 1000,
  TWO_H_CONSEC_DAY: 30, TEACHER_DAILY: 10, SIMILAR_SAME_DAY: 5,
  FRAGMENT: 25, LUNCH_CROSS: 40,
};

const ALL_SLOTS = [];
for (const d of DAYS) for (const p of PERIODS) ALL_SLOTS.push([d, p]);

// ───────────────────────── 엑셀 파서 ─────────────────────────

function norm(v) {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

function isIntLike(s) {
  return /^-?\d+$/.test(String(s).trim());
}

/**
 * rows: 시트 전체를 2차원 배열로 (SheetJS sheet_to_json({header:1, defval:null}))
 * 반환: SchoolData 상당의 객체
 */
export function parseData(rows) {
  const gradeHeader = (rows[0] || []).map(norm);
  const labelHeader = (rows[1] || []).map(norm);

  // 학년별 컬럼 범위
  const gradeCols = new Map(); // grade -> [(colIdx, label)]
  let cur = null;
  for (let i = 0; i < gradeHeader.length; i++) {
    const gh = gradeHeader[i];
    const gm = gh.match(/([1-9])\s*학년/);   // 1~9학년 (초등 6학년까지 대응)
    if (gm) cur = parseInt(gm[1], 10);
    else if (gh.includes("계")) cur = null;
    if (cur !== null && i < labelHeader.length) {
      const lbl = labelHeader[i];
      if (lbl && lbl !== "계") {
        if (!gradeCols.has(cur)) gradeCols.set(cur, []);
        gradeCols.get(cur).push([i, lbl]);
      }
    }
  }

  const classesPerGrade = new Map(); // grade -> [cid]
  const specialRooms = [];
  const colToClassId = new Map();
  for (const [grade, cols] of gradeCols) {
    for (const [colIdx, lbl] of cols) {
      const cid = `${grade}-${lbl}`;
      if (isIntLike(lbl)) {
        if (!classesPerGrade.has(grade)) classesPerGrade.set(grade, []);
        classesPerGrade.get(grade).push(cid);
      } else {
        specialRooms.push({ grade, code: lbl });
      }
      colToClassId.set(colIdx, cid);
    }
  }

  let teacherCol = null, subjectCol = null, timeCol = null;
  for (let i = 0; i < labelHeader.length; i++) {
    const lbl = labelHeader[i];
    if (lbl.includes("교사")) teacherCol = i;
    else if (lbl.includes("과목")) subjectCol = i;
    else if (lbl.includes("타임")) timeCol = i;
  }
  if (teacherCol === null) teacherCol = 0;
  if (subjectCol === null) subjectCol = 1;
  if (timeCol === null) timeCol = 2;

  const bundleRaw = new Map(); // "grade|code" -> [[teacher, subject, cid, hours]]
  const fixedAssignments = [];
  const teachersSet = new Set();
  const subjectsSet = new Set();

  for (let r = 2; r < rows.length; r++) {
    const row = rows[r] || [];
    const teacher = teacherCol < row.length ? norm(row[teacherCol]) : "";
    const subject = subjectCol < row.length ? norm(row[subjectCol]) : "";
    const timeCode = timeCol < row.length ? norm(row[timeCol]) : "";
    if (!teacher || !subject) continue;
    teachersSet.add(teacher);
    subjectsSet.add(subject);

    for (const [colIdx, cid] of colToClassId) {
      if (colIdx >= row.length) continue;
      const v = row[colIdx];
      if (v === null || v === undefined || norm(v) === "") continue;
      const hours = parseInt(v, 10);
      if (!Number.isFinite(hours) || hours <= 0) continue;
      const grade = parseInt(cid.split("-")[0], 10);
      if (timeCode) {
        const key = `${grade}|${timeCode}`;
        if (!bundleRaw.has(key)) bundleRaw.set(key, []);
        bundleRaw.get(key).push([teacher, subject, cid, hours]);
      } else {
        fixedAssignments.push({ teacher, subject, class_id: cid, hours });
      }
    }
  }

  const bundleGroups = [];
  for (const [key, rws] of bundleRaw) {
    const [gradeS, code] = key.split("|");
    const grade = parseInt(gradeS, 10);
    const classHoursSum = new Map();
    for (const [, , cid, hours] of rws) {
      classHoursSum.set(cid, (classHoursSum.get(cid) || 0) + hours);
    }
    const bgHours = classHoursSum.size ? Math.max(...classHoursSum.values()) : 0;
    const members = rws.map(([t, s, c, h]) => ({ teacher: t, subject: s, class_id: c, hours: h }));
    bundleGroups.push({ grade, code, hours: bgHours, members });
  }

  for (const [, arr] of classesPerGrade) {
    arr.sort((a, b) => parseInt(a.split("-")[1], 10) - parseInt(b.split("-")[1], 10));
  }

  const grades = [...new Set([...classesPerGrade.keys(), ...specialRooms.map(s => s.grade)])].sort((a, b) => a - b);
  return {
    year: 2026, semester: 1,
    grades: grades.length ? grades : [1, 2, 3],
    classes_per_grade: classesPerGrade,
    special_rooms: specialRooms,
    fixed_assignments: fixedAssignments,
    bundle_groups: bundleGroups,
    teachers: [...teachersSet].sort(),
    subjects: [...subjectsSet].sort(),
  };
}

export function computeClassTotalHours(data) {
  const totals = new Map();
  for (const a of data.fixed_assignments) totals.set(a.class_id, (totals.get(a.class_id) || 0) + a.hours);
  for (const bg of data.bundle_groups) for (const m of bg.members) totals.set(m.class_id, (totals.get(m.class_id) || 0) + m.hours);
  return totals;
}

export function computeTeacherTotalHours(data) {
  const totals = new Map();
  for (const a of data.fixed_assignments) totals.set(a.teacher, (totals.get(a.teacher) || 0) + a.hours);
  for (const bg of data.bundle_groups) for (const m of bg.members) totals.set(m.teacher, (totals.get(m.teacher) || 0) + m.hours);
  return totals;
}

// ───────────────────────── 스케줄러 ─────────────────────────

// Map helpers (Python defaultdict(int) 흉내: 0이 되면 삭제)
function inc(map, key, by = 1) { map.set(key, (map.get(key) || 0) + by); return map.get(key); }
function dec(map, key, by = 1) {
  const v = (map.get(key) || 0) - by;
  if (v <= 0) map.delete(key); else map.set(key, v);
  return v;
}
function get0(map, key) { return map.get(key) || 0; }

export class Scheduler {
  /**
   * data: parseData() 결과
   * nonClass: [{grade, day, period}]
   * unavail: [{teacher, day, period, grade}]  (grade 0 = 전체)
   * similar: [{name, subjects: []}]
   * params: {max_consecutive, daily_n, lunch_split, lunch_period,
   *          first_avoid_teachers, promo1_teachers, promo2_teachers,
   *          gyomu_teachers, semester}
   */
  constructor(data, nonClass, unavail, similar, params = {}) {
    this.data = data;
    this.nonClass = nonClass || [];
    this.unavail = unavail || [];
    this.similar = similar || [];
    this.params = params;
    this.maxConsecutive = params.max_consecutive ?? 2;
    this.dailyN = params.daily_n ?? 1;
    this.lunchSplit = !!params.lunch_split;
    this.lunchPeriod = params.lunch_period ?? 4;
    this.firstAvoidTeachers = new Set(params.first_avoid_teachers || []);
    this.promo1Teachers = new Set(params.promo1_teachers || []);
    this.promo2Teachers = new Set(params.promo2_teachers || []);
    this.gyomuTeachers = new Set(params.gyomu_teachers || []);
    this.semester = parseInt(params.semester ?? 1, 10);

    // 규칙 on/off (기본 전부 on). 학급/교사 중복은 항상 on(필수).
    this.rules = params.rules || {};
    // 규칙별 실효 페널티(off면 0). 배치/제거가 항상 균형을 이루도록 배수로 처리.
    const on = (k) => this.ruleOn(k);
    this.pen = {
      CLASS: PEN.CLASS_CONFLICT, TEACHER: PEN.TEACHER_CONFLICT,
      NONCLASS: on('nonclass') ? PEN.NONCLASS : 0,
      UNAVAIL: on('unavail') ? PEN.UNAVAIL : 0,
      BUNDLE: on('bundleDay') ? PEN.BUNDLE_OVERLAP : 0,
      SAME_DAY: on('sameSubjectDay') ? PEN.SAME_DAY : 0,
      TWO_H: on('twoHourAdjDay') ? PEN.TWO_H_CONSEC_DAY : 0,
      CONSEC: on('teacherConsec') ? PEN.CONSEC : 0,
      DAILY: on('teacherDaily') ? PEN.TEACHER_DAILY : 0,
      FRAG: on('pairing') ? PEN.FRAGMENT : 0,
      SIMILAR: on('similarDay') ? PEN.SIMILAR_SAME_DAY : 0,
      LUNCH: PEN.LUNCH_CROSS,
    };

    // 학급 목록 + 학년
    this.allClasses = [];
    for (const [, cls] of data.classes_per_grade) this.allClasses.push(...cls);
    for (const sr of data.special_rooms) {
      const cid = `${sr.grade}-${sr.code}`;
      if (!this.allClasses.includes(cid)) this.allClasses.push(cid);
    }
    this.allClasses = [...new Set(this.allClasses)].sort((a, b) => {
      const [ga, la] = a.split("-"); const [gb, lb] = b.split("-");
      return (parseInt(ga, 10) - parseInt(gb, 10)) || (la < lb ? -1 : la > lb ? 1 : 0);
    });
    this.classGrade = new Map(this.allClasses.map(c => [c, parseInt(c.split("-")[0], 10)]));

    this.nonclassSet = new Set(this.nonClass.map(s => `${s.grade}|${s.day}|${s.period}`));
    // 교사 불가: t -> Map("d|p" -> Set(grades))
    this.unavailMap = new Map();
    for (const u of this.unavail) {
      const g = u.grade || 0;
      if (!this.unavailMap.has(u.teacher)) this.unavailMap.set(u.teacher, new Map());
      const m = this.unavailMap.get(u.teacher);
      const k = `${u.day}|${u.period}`;
      if (!m.has(k)) m.set(k, new Set());
      m.get(k).add(g);
    }
    this.subjectToGroup = new Map();
    for (const g of this.similar) for (const s of g.subjects) this.subjectToGroup.set(s, g.name);

    const teacherTot = computeTeacherTotalHours(data);
    const dailyCap = (tot) => {
      if (tot % 5 === 0) return Math.floor(tot / 5);
      return Math.floor(tot / 5 + this.dailyN);
    };
    this.teacherAvgDaily = new Map([...teacherTot].map(([t, tot]) => [t, dailyCap(tot)]));

    // 배치 단위(unit) 구성
    this.units = [];
    let uid = 0;
    for (const a of data.fixed_assignments) {
      if (!this.classGrade.has(a.class_id)) this.classGrade.set(a.class_id, parseInt(a.class_id.split("-")[0], 10));
      for (let i = 0; i < a.hours; i++) {
        this.units.push({ uid: uid++, kind: "fixed", cells: [[a.class_id, a.teacher, a.subject]], bundle_key: "" });
      }
    }
    this.bundleKeys = [];
    for (const bg of data.bundle_groups) {
      const bkey = `${bg.grade}_${bg.code}`;
      this.bundleKeys.push(bkey);
      const classMembers = new Map(); // cid -> [[subject, teacher, hours]]
      for (const m of bg.members) {
        if (!classMembers.has(m.class_id)) classMembers.set(m.class_id, []);
        classMembers.get(m.class_id).push([m.subject, m.teacher, m.hours]);
        if (!this.classGrade.has(m.class_id)) this.classGrade.set(m.class_id, parseInt(m.class_id.split("-")[0], 10));
      }
      for (let slotIdx = 0; slotIdx < bg.hours; slotIdx++) {
        const cells = [];
        for (const [cid, mlist] of classMembers) {
          let cum = 0, chosen = null;
          for (const [subj, tch, h] of mlist) {
            if (cum <= slotIdx && slotIdx < cum + h) { chosen = [cid, tch, subj]; break; }
            cum += h;
          }
          if (chosen === null && mlist.length) {
            const [subj, tch] = mlist[mlist.length - 1];
            chosen = [cid, tch, subj];
          }
          if (chosen) cells.push(chosen);
        }
        this.units.push({ uid: uid++, kind: "bundle", cells, bundle_key: bkey });
      }
    }

    this.nUnits = this.units.length;
    this.fixedUids = [];
    this.bundleUids = [];
    for (let u = 0; u < this.nUnits; u++) {
      if (this.units[u].bundle_key) this.bundleUids.push(u); else this.fixedUids.push(u);
    }
    this.bundleSibling = new Map(); // bkey -> [uid]
    for (const u of this.bundleUids) {
      const k = this.units[u].bundle_key;
      if (!this.bundleSibling.has(k)) this.bundleSibling.set(k, []);
      this.bundleSibling.get(k).push(u);
    }
    this.teacherUnitsFixed = new Map();
    for (const u of this.fixedUids) {
      const t = this.units[u].cells[0][1];
      if (!this.teacherUnitsFixed.has(t)) this.teacherUnitsFixed.set(t, []);
      this.teacherUnitsFixed.get(t).push(u);
    }

    // (학급,과목) 하루 허용 cap = ceil(주당시수/5)
    const subjTotal = new Map();
    for (const a of data.fixed_assignments) inc(subjTotal, `${a.class_id}|${a.subject}`, a.hours);
    for (const bg of data.bundle_groups) for (const m of bg.members) inc(subjTotal, `${m.class_id}|${m.subject}`, m.hours);
    this.subjDayCap = new Map();
    for (const [k, tot] of subjTotal) this.subjDayCap.set(k, Math.max(1, Math.ceil(tot / 5)));

    // 후보 슬롯
    const gyomuPmBlock = (this.semester === 2 && this.gyomuTeachers.size > 0);
    this.unitCandidateSlots = [];
    for (const unit of this.units) {
      const cands = [];
      for (const [d, p] of ALL_SLOTS) {
        let ok = true;
        for (const [cid, tch] of unit.cells) {
          const g = this.classGrade.get(cid);
          if (this.ruleOn('nonclass') && this.nonclassSet.has(`${g}|${d}|${p}`)) { ok = false; break; }
          if (this.ruleOn('unavail') && this.unavailBlocked(tch, g, d, p)) { ok = false; break; }
          if (gyomuPmBlock && p >= 5 && this.gyomuTeachers.has(tch)) { ok = false; break; }
        }
        if (ok) cands.push([d, p]);
      }
      this.unitCandidateSlots.push(cands.length ? cands : ALL_SLOTS.slice());
    }
  }

  /** 규칙이 켜져 있는가. 학급/교사 중복은 항상 필수(on). 기본값 on. */
  ruleOn(k) {
    if (k === 'classConflict' || k === 'teacherConflict') return true;
    return this.rules[k] !== false;
  }

  unavailBlocked(tch, grade, d, p) {
    const rule = this.unavailMap.get(tch);
    if (!rule) return false;
    const gs = rule.get(`${d}|${p}`);
    if (!gs) return false;
    return gs.has(0) || gs.has(grade);
  }

  computeUnitRigidity() {
    const rig = [];
    for (let u = 0; u < this.nUnits; u++) {
      const cells = this.units[u].cells;
      const ncls = new Set(cells.map(c => c[0])).size;
      const ntch = new Set(cells.map(c => c[1])).size;
      const cand = Math.max(1, this.unitCandidateSlots[u].length);
      let score = (ncls + ntch) * (35.0 / cand);
      if (this.units[u].bundle_key) score *= 1.5;
      rig.push(score);
    }
    return rig;
  }

  computeTeacherStress() {
    const rig = this.computeUnitRigidity();
    const tsum = new Map(), tcnt = new Map();
    for (let u = 0; u < this.nUnits; u++) {
      for (const t of new Set(this.units[u].cells.map(c => c[1]))) {
        tsum.set(t, (tsum.get(t) || 0) + rig[u]);
        tcnt.set(t, (tcnt.get(t) || 0) + 1);
      }
    }
    if (!tcnt.size) return new Map();
    const avg = new Map([...tcnt].map(([t, c]) => [t, tsum.get(t) / c]));
    const order = [...avg.keys()].sort((a, b) => avg.get(b) - avg.get(a));
    const n = order.length;
    const weights = new Map();
    order.forEach((t, i) => weights.set(t, n === 1 ? 3.0 : 3.0 - 2.0 * (i / (n - 1))));
    return weights;
  }

  feasibilityReport() {
    const problems = [];
    const TOTAL = 35;
    const ncByGrade = new Map();
    for (const key of this.nonclassSet) {
      const g = parseInt(key.split("|")[0], 10);
      inc(ncByGrade, g);
    }
    const classHours = new Map();
    for (let u = 0; u < this.nUnits; u++) {
      for (const cid of new Set(this.units[u].cells.map(c => c[0]))) inc(classHours, cid);
    }
    for (const cid of [...classHours.keys()].sort()) {
      const g = this.classGrade.get(cid) || 0;
      const avail = TOTAL - (ncByGrade.get(g) || 0);
      const h = classHours.get(cid);
      if (h > avail) {
        problems.push(`[${cid}] 수업이 ${h}시간인데 넣을 수 있는 칸은 ${avail}칸뿐입니다 ` +
          `(${g}학년 비수업 ${ncByGrade.get(g) || 0}개 제외). → ${h - avail}칸 부족. 비수업을 줄이거나 시수를 낮춰야 합니다.`);
      }
    }
    const teacherHours = new Map();
    for (let u = 0; u < this.nUnits; u++) {
      for (const tch of new Set(this.units[u].cells.map(c => c[1]))) inc(teacherHours, tch);
    }
    for (const tch of [...teacherHours.keys()].sort()) {
      const rule = this.unavailMap.get(tch) || new Map();
      let uaAll = 0;
      for (const [, gs] of rule) if (gs.has(0)) uaAll++;
      const avail = TOTAL - uaAll;
      const h = teacherHours.get(tch);
      if (h > avail) {
        problems.push(`[${tch} 선생님] 수업이 ${h}시간인데 가능한 칸은 ${avail}칸뿐입니다 ` +
          `(불가시간 ${uaAll}개 제외). → ${h - avail}칸 부족.`);
      }
    }
    if (this.semester === 2) {
      for (const tch of [...this.gyomuTeachers].sort()) {
        const h = teacherHours.get(tch) || 0;
        const rule = this.unavailMap.get(tch) || new Map();
        let amBlock = 0;
        for (const [k, gs] of rule) {
          const p = parseInt(k.split("|")[1], 10);
          if (p <= 4 && gs.has(0)) amBlock++;
        }
        const amAvail = 20 - amBlock;
        if (h > amAvail) {
          problems.push(`[${tch} 교무부장] 2학기 5~7교시 금지인데 수업이 ${h}시간입니다. ` +
            `오전(1~4교시)에 넣을 수 있는 칸은 ${amAvail}칸뿐 → ${h - amAvail}칸 부족. ` +
            `교무부장 수업을 줄이거나 오전 전용을 해제해야 합니다.`);
        }
      }
    }
    return problems;
  }

  feasibilityText() {
    const probs = this.feasibilityReport();
    if (!probs.length) {
      return "자동 진단으로는 명백한 칸 부족이 없습니다. 비수업·교사불가·묶음 조건이 복합적으로 얽혀 해가 없을 수 있습니다. 비수업이나 교사불가를 조금 줄여 다시 시도해 보세요.";
    }
    return "⚠ 다음 때문에 시간표를 만들 수 없습니다 (조건이 서로 모순됩니다):\n\n" + probs.map(p => "• " + p).join("\n");
  }

  /** 교사 흩어짐(묶기 위반) 전용 하강 — 총 페널티가 줄 때만 적용 */
  polishPairing(state, rounds = 4) {
    const mc = this.maxConsecutive;
    for (let r = 0; r < rounds; r++) {
      let improved = false;
      const fragDays = [];
      for (const [key, ps] of state.teacherDayPeriods) {
        const sorted = [...ps].sort((a, b) => a - b);
        const [, frag] = state._tdayParts(sorted, mc);
        if (frag > 0) {
          const i = key.lastIndexOf("|");
          fragDays.push([key.slice(0, i), key.slice(i + 1)]);
        }
      }
      // shuffle
      for (let i = fragDays.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [fragDays[i], fragDays[j]] = [fragDays[j], fragDays[i]];
      }
      for (const [tch, d] of fragDays) {
        const psSet = state.teacherDayPeriods.get(`${tch}|${d}`);
        if (!psSet) continue;
        const ps = [...psSet].sort((a, b) => a - b);
        if (ps.length < 3) continue;
        const psHas = new Set(ps);
        const singles = ps.filter(p => !psHas.has(p - 1) && !psHas.has(p + 1));
        const blockAdj = new Set();
        for (const p of ps) {
          if (psHas.has(p - 1) || psHas.has(p + 1)) {
            if (p - 1 >= 1 && !psHas.has(p - 1)) blockAdj.add(p - 1);
            if (p + 1 <= 7 && !psHas.has(p + 1)) blockAdj.add(p + 1);
          }
        }
        for (const sp of singles) {
          let uidF = null, cid0 = null;
          for (const u of this.fixedUids) {
            const pos = state.pos[u];
            if (pos && pos[0] === d && pos[1] === sp && this.units[u].cells[0][1] === tch) {
              uidF = u; cid0 = this.units[u].cells[0][0]; break;
            }
          }
          if (uidF === null) continue;
          for (const tp of blockAdj) {
            const before = state.penalty;
            if (get0(state.classSlot, `${cid0}|${d}|${tp}`) === 0) {
              state.move(uidF, d, tp);
              if (state.penalty < before) { improved = true; break; }
              state.move(uidF, d, sp);
            } else {
              let u2 = null;
              for (const u of this.fixedUids) {
                const pos = state.pos[u];
                if (pos && pos[0] === d && pos[1] === tp && this.units[u].cells[0][0] === cid0) { u2 = u; break; }
              }
              if (u2 !== null) {
                state.swap(uidF, u2);
                if (state.penalty < before) { improved = true; break; }
                state.swap(uidF, u2);
              }
            }
          }
        }
      }
      if (!improved) break;
    }
    return state;
  }
}

// ───────────────────────── 상태(State) ─────────────────────────

export class State {
  constructor(scheduler) {
    this.sch = scheduler;
    this.pos = new Array(scheduler.units.length).fill(null);
    this.penalty = 0;
    this.classSlot = new Map();        // "cid|d|p" -> n
    this.teacherSlot = new Map();      // "tch|d|p" -> n
    this.classSubjDay = new Map();     // "cid|subj|d" -> n
    this.teacherDay = new Map();       // "tch|d" -> n
    this.teacherDayBundle = new Map(); // "tch|d" -> n (그날 묶음수업 수)
    this.classDayGroup = new Map();    // "cid|d|grp" -> n
    this.syncSlot = new Map();         // "bkey|d|p" -> n
    this.teacherDayPeriods = new Map();// "tch|d" -> Set(p)
    this.h7Pen = new Map();            // "tch|d" -> pen
    this.classSubjDp = new Map();      // "cid|subj" -> [[d,p]]
    this.h11Pen = new Map();           // "cid|subj" -> pen
    this.s8Pen = new Map();            // "tch|d" -> pen
  }

  /** 교사 하루 교시 패턴 → [H7 연속초과 페널티, 묶기 위반 페널티] */
  _tdayParts(periods, mc) {
    const n = periods.length;
    if (n === 0) return [0, 0];
    const runs = [];
    let cur = 1;
    for (let i = 1; i < n; i++) {
      if (periods[i] === periods[i - 1] + 1) cur++;
      else { runs.push(cur); cur = 1; }
    }
    runs.push(cur);
    const pen = this.sch.pen;
    let h7 = 0;
    for (const r of runs) if (r > mc) h7 += pen.CONSEC * (r - mc);
    let frag = 0;
    if (n >= 3 && !runs.some(r => r >= 2)) frag = pen.FRAG;
    return [h7, frag];
  }

  _h7(tch, d) {
    const ps = this.teacherDayPeriods.get(`${tch}|${d}`) || new Set();
    const periods = [...ps].sort((a, b) => a - b);
    const [h7, frag] = this._tdayParts(periods, this.sch.maxConsecutive);
    let lunch = 0;
    if (this.sch.lunchSplit) {
      const lp = this.sch.lunchPeriod;
      if (ps.has(lp) && ps.has(lp + 1)) lunch = this.sch.pen.LUNCH;
    }
    return h7 + frag + lunch;
  }

  _h11(cid, subj) {
    const dplist = this.classSubjDp.get(`${cid}|${subj}`) || [];
    if (dplist.length !== 2) return 0;
    const days = new Set(dplist.map(([d]) => d));
    if (days.size !== 2) return 0;
    const idxs = [...days].map(d => DAY_IDX[d]).sort((a, b) => a - b);
    return idxs[1] - idxs[0] === 1 ? this.sch.pen.TWO_H : 0;
  }

  _s8(tch, d) {
    const cnt = get0(this.teacherDay, `${tch}|${d}`);
    const avg = this.sch.teacherAvgDaily.get(tch) ?? 5;
    const cap = get0(this.teacherDayBundle, `${tch}|${d}`) > 0 ? Math.max(avg, 4) : avg;
    return cnt > cap ? this.sch.pen.DAILY * (cnt - cap) : 0;
  }

  _place(uid, d, p) {
    const unit = this.sch.units[uid];
    const pen = this.sch.pen;
    let delta = 0;
    for (const [cid, tch, subj] of unit.cells) {
      const g = this.sch.classGrade.get(cid);
      if (this.sch.nonclassSet.has(`${g}|${d}|${p}`)) delta += pen.NONCLASS;
      if (this.sch.unavailBlocked(tch, g, d, p)) delta += pen.UNAVAIL;
      const kCS = `${cid}|${d}|${p}`;
      if (get0(this.classSlot, kCS) >= 1) delta += pen.CLASS;
      inc(this.classSlot, kCS);
      const kTS = `${tch}|${d}|${p}`;
      if (get0(this.teacherSlot, kTS) >= 1) delta += pen.TEACHER;
      inc(this.teacherSlot, kTS);
      const cap = this.sch.subjDayCap.get(`${cid}|${subj}`) ?? 1;
      const kSD = `${cid}|${subj}|${d}`;
      if (get0(this.classSubjDay, kSD) >= cap) delta += pen.SAME_DAY;
      inc(this.classSubjDay, kSD);
      // H7
      const kTD = `${tch}|${d}`;
      let o = get0(this.h7Pen, kTD);
      if (!this.teacherDayPeriods.has(kTD)) this.teacherDayPeriods.set(kTD, new Set());
      this.teacherDayPeriods.get(kTD).add(p);
      let n = this._h7(tch, d);
      if (n) this.h7Pen.set(kTD, n); else this.h7Pen.delete(kTD);
      delta += n - o;
      // H11
      const kCJ = `${cid}|${subj}`;
      o = get0(this.h11Pen, kCJ);
      if (!this.classSubjDp.has(kCJ)) this.classSubjDp.set(kCJ, []);
      this.classSubjDp.get(kCJ).push([d, p]);
      n = this._h11(cid, subj);
      if (n) this.h11Pen.set(kCJ, n); else this.h11Pen.delete(kCJ);
      delta += n - o;
      // S8
      o = get0(this.s8Pen, kTD);
      inc(this.teacherDay, kTD);
      if (unit.bundle_key) inc(this.teacherDayBundle, kTD);
      n = this._s8(tch, d);
      if (n) this.s8Pen.set(kTD, n); else this.s8Pen.delete(kTD);
      delta += n - o;
      // S9
      const grp = this.sch.subjectToGroup.get(subj);
      if (grp) {
        const kG = `${cid}|${d}|${grp}`;
        if (get0(this.classDayGroup, kG) >= 1) delta += pen.SIMILAR;
        inc(this.classDayGroup, kG);
      }
    }
    if (unit.bundle_key) {
      const kB = `${unit.bundle_key}|${d}|${p}`;
      if (get0(this.syncSlot, kB) >= 1) delta += pen.BUNDLE;
      inc(this.syncSlot, kB);
    }
    this.pos[uid] = [d, p];
    this.penalty += delta;
    return delta;
  }

  _unplace(uid) {
    const dp = this.pos[uid];
    if (dp === null) return 0;
    const [d, p] = dp;
    const unit = this.sch.units[uid];
    const pen = this.sch.pen;
    let delta = 0;
    for (const [cid, tch, subj] of unit.cells) {
      const g = this.sch.classGrade.get(cid);
      if (this.sch.nonclassSet.has(`${g}|${d}|${p}`)) delta -= pen.NONCLASS;
      if (this.sch.unavailBlocked(tch, g, d, p)) delta -= pen.UNAVAIL;
      const kCS = `${cid}|${d}|${p}`;
      let c = get0(this.classSlot, kCS);
      if (c >= 2) delta -= pen.CLASS;
      dec(this.classSlot, kCS);
      const kTS = `${tch}|${d}|${p}`;
      c = get0(this.teacherSlot, kTS);
      if (c >= 2) delta -= pen.TEACHER;
      dec(this.teacherSlot, kTS);
      const cap = this.sch.subjDayCap.get(`${cid}|${subj}`) ?? 1;
      const kSD = `${cid}|${subj}|${d}`;
      c = get0(this.classSubjDay, kSD);
      if (c >= cap + 1) delta -= pen.SAME_DAY;
      dec(this.classSubjDay, kSD);
      // H7
      const kTD = `${tch}|${d}`;
      let o = get0(this.h7Pen, kTD);
      if (get0(this.teacherSlot, kTS) === 0) {
        const s = this.teacherDayPeriods.get(kTD);
        if (s) {
          s.delete(p);
          if (!s.size) this.teacherDayPeriods.delete(kTD);
        }
      }
      let n = this.teacherDayPeriods.has(kTD) ? this._h7(tch, d) : 0;
      if (n) this.h7Pen.set(kTD, n); else this.h7Pen.delete(kTD);
      delta += n - o;
      // H11
      const kCJ = `${cid}|${subj}`;
      o = get0(this.h11Pen, kCJ);
      const lst = this.classSubjDp.get(kCJ) || [];
      const idx = lst.findIndex(([dd, pp]) => dd === d && pp === p);
      if (idx >= 0) lst.splice(idx, 1);
      if (!lst.length) this.classSubjDp.delete(kCJ);
      n = this._h11(cid, subj);
      if (n) this.h11Pen.set(kCJ, n); else this.h11Pen.delete(kCJ);
      delta += n - o;
      // S8
      o = get0(this.s8Pen, kTD);
      dec(this.teacherDay, kTD);
      if (unit.bundle_key) dec(this.teacherDayBundle, kTD);
      n = this._s8(tch, d);
      if (n) this.s8Pen.set(kTD, n); else this.s8Pen.delete(kTD);
      delta += n - o;
      // S9
      const grp = this.sch.subjectToGroup.get(subj);
      if (grp) {
        const kG = `${cid}|${d}|${grp}`;
        c = get0(this.classDayGroup, kG);
        if (c >= 2) delta -= pen.SIMILAR;
        dec(this.classDayGroup, kG);
      }
    }
    if (unit.bundle_key) {
      const kB = `${unit.bundle_key}|${d}|${p}`;
      const c = get0(this.syncSlot, kB);
      if (c >= 2) delta -= pen.BUNDLE;
      dec(this.syncSlot, kB);
    }
    this.pos[uid] = null;
    this.penalty += delta;
    return delta;
  }

  move(uid, d, p) { return this._unplace(uid) + this._place(uid, d, p); }

  swap(uid1, uid2) {
    const dp1 = this.pos[uid1], dp2 = this.pos[uid2];
    if (dp1 === null || dp2 === null || (dp1[0] === dp2[0] && dp1[1] === dp2[1])) return 0;
    const before = this.penalty;
    this.move(uid1, dp2[0], dp2[1]);
    this.move(uid2, dp1[0], dp1[1]);
    return this.penalty - before;
  }

  getSolution() {
    const assignments = [];
    for (let uid = 0; uid < this.sch.units.length; uid++) {
      const dp = this.pos[uid];
      if (dp === null) continue;
      const [d, p] = dp;
      for (const [cid, tch, subj] of this.sch.units[uid].cells) {
        assignments.push([subj, tch, cid, d, p, this.sch.units[uid].bundle_key]);
      }
    }
    const v = {};
    const on = (k) => this.sch.ruleOn(k);
    const add = (k, n) => { v[k] = (v[k] || 0) + n; };
    for (const c of this.classSlot.values()) if (c > 1) add("H2", c - 1);
    for (const c of this.teacherSlot.values()) if (c > 1) add("H3", c - 1);
    if (on('sameSubjectDay')) for (const [k, c] of this.classSubjDay) {
      const i = k.lastIndexOf("|");
      const cap = this.sch.subjDayCap.get(k.slice(0, i)) ?? 1;
      if (c > cap) add("H5", c - cap);
    }
    const mc = this.sch.maxConsecutive;
    for (const [k, ps] of this.teacherDayPeriods) {
      const sorted = [...ps].sort((a, b) => a - b);
      const [h7p, fragp] = this._tdayParts(sorted, mc);
      if (h7p > 0) add("H7", 1);
      if (fragp > 0) add("Hpair", 1);
      if (this.sch.lunchSplit) {
        const lp = this.sch.lunchPeriod;
        if (ps.has(lp) && ps.has(lp + 1)) add("Lunch", 1);
      }
    }
    for (const pen of this.h11Pen.values()) if (pen > 0) add("H11", 1);
    for (const pen of this.s8Pen.values()) if (pen > 0) add("S8", 1);
    if (on('similarDay')) for (const c of this.classDayGroup.values()) if (c > 1) add("S9", c - 1);
    if (on('bundleDay')) for (const c of this.syncSlot.values()) if (c > 1) add("H8", c - 1);
    if (on('nonclass') || on('unavail')) for (let uid = 0; uid < this.sch.units.length; uid++) {
      const dp = this.pos[uid];
      if (dp === null) continue;
      const [d, p] = dp;
      for (const [cid, tch] of this.sch.units[uid].cells) {
        const g = this.sch.classGrade.get(cid);
        if (on('nonclass') && this.sch.nonclassSet.has(`${g}|${d}|${p}`)) add("H4", 1);
        if (on('unavail') && this.sch.unavailBlocked(tch, g, d, p)) add("H6", 1);
      }
    }
    return { assignments, penalty: this.penalty, violations: v };
  }

  /** 페널티에 걸린 항목을 '누가/언제/왜'로 진단 */
  diagnose() {
    const mc = this.sch.maxConsecutive;
    const tissues = new Map();
    const push = (t, msg) => {
      if (!tissues.has(t)) tissues.set(t, []);
      tissues.get(t).push(msg);
    };
    for (const [key, psSet] of this.teacherDayPeriods) {
      const i = key.lastIndexOf("|");
      const tch = key.slice(0, i), d = key.slice(i + 1);
      const periods = [...psSet].sort((a, b) => a - b);
      if (!periods.length) continue;
      const runs = [];
      let cur = [periods[0]];
      for (let j = 1; j < periods.length; j++) {
        if (periods[j] === periods[j - 1] + 1) cur.push(periods[j]);
        else { runs.push(cur); cur = [periods[j]]; }
      }
      runs.push(cur);
      for (const run of runs) {
        if (run.length > mc) {
          push(tch, `[연속수업] ${d}요일 ${run[0]}~${run[run.length - 1]}교시 연속 ${run.length}시간 (최대 ${mc}시간 초과)`);
        }
      }
      if (periods.length >= 3 && !runs.some(r => r.length >= 2)) {
        push(tch, `[연강 없음] ${d}요일 ${periods.length}시간이 모두 따로 흩어짐 (붙은 수업이 하나도 없음)`);
      }
      if (this.sch.lunchSplit) {
        const lp = this.sch.lunchPeriod;
        if (psSet.has(lp) && psSet.has(lp + 1)) push(tch, `[점심 전후] ${d}요일 ${lp}·${lp + 1}교시 연달아 수업`);
      }
    }
    for (const [key, cnt] of this.teacherDay) {
      const i = key.lastIndexOf("|");
      const tch = key.slice(0, i), d = key.slice(i + 1);
      const avg = this.sch.teacherAvgDaily.get(tch) ?? 5;
      const nb = get0(this.teacherDayBundle, key);
      const cap = nb > 0 ? Math.max(avg, 4) : avg;
      if (cnt > cap) {
        const extra = nb > 0 && cap > avg ? ` — 묶음수업 ${nb}시간 있어 4시간까지 면제` : "";
        push(tch, `[하루 과다] ${d}요일 ${cnt}시간 (허용 ${cap}시간보다 ${cnt - cap}시간 많음)${extra}`);
      }
    }
    const cissues = [];
    for (const [k, c] of this.classSubjDay) {
      const parts = k.split("|");
      const cap = this.sch.subjDayCap.get(`${parts[0]}|${parts[1]}`) ?? 1;
      if (c > cap) cissues.push(`[같은 과목 같은 날] ${parts[0]} ${parts[1]} — ${parts[2]}요일에 ${c}번`);
    }
    for (const [k, pen] of this.h11Pen) {
      if (pen > 0) {
        const [cid, subj] = k.split("|");
        cissues.push(`[2시간 과목 연속 요일] ${cid} ${subj}`);
      }
    }
    for (const [k, c] of this.classDayGroup) {
      if (c > 1) {
        const [cid, d] = k.split("|");
        cissues.push(`[유사과목 같은 날] ${cid} — ${d}요일`);
      }
    }
    const nteach = tissues.size;
    let ntotal = cissues.length;
    for (const arr of tissues.values()) ntotal += arr.length;
    const summary = ntotal
      ? `페널티에 걸린 교사 ${nteach}명, 항목 ${ntotal}개`
      : "페널티에 걸린 교사가 없습니다. 깔끔한 시간표입니다!";
    return { teachers: tissues, classes: cissues, summary };
  }

  diagnoseText() {
    const d = this.diagnose();
    const lines = [d.summary];
    if (d.teachers.size) {
      lines.push("", "● 교사별 사유");
      for (const tch of [...d.teachers.keys()].sort()) {
        lines.push(`  · ${tch} 선생님`);
        for (const r of d.teachers.get(tch)) lines.push(`      - ${r}`);
      }
    }
    if (d.classes.length) {
      lines.push("", "● 학급·과목 사유");
      for (const r of d.classes) lines.push(`  · ${r}`);
    }
    return lines.join("\n");
  }

  /**
   * 셀 단위 위반 주석: 어느 칸이 왜, 몇 점의 페널티인지.
   * 반환 Map — 키 `t|교사|요일|교시` 와 `c|학급|요일|교시` 양쪽에 [{label}] 배열.
   * 규칙이 꺼져 있으면(sch.pen == 0) 해당 위반은 제외한다.
   */
  cellIssues() {
    const pen = this.sch.pen;
    const mc = this.sch.maxConsecutive;
    const out = new Map();
    const push = (key, label) => {
      if (!out.has(key)) out.set(key, []);
      if (!out.get(key).includes(label)) out.get(key).push(label);
    };
    // 배치 점유: (d,p) 기준 unit cell 목록
    const cellsAt = [];   // [{cid,tch,subj,d,p,bundle}]
    for (let u = 0; u < this.sch.units.length; u++) {
      const dp = this.pos[u];
      if (!dp) continue;
      for (const [cid, tch, subj] of this.sch.units[u].cells) {
        cellsAt.push({ cid, tch, subj, d: dp[0], p: dp[1], bundle: this.sch.units[u].bundle_key });
      }
    }
    const both = (c, label) => { push(`t|${c.tch}|${c.d}|${c.p}`, label); push(`c|${c.cid}|${c.d}|${c.p}`, label); };

    // 하드: 학급/교사 중복, 비수업, 불가시간, 묶음 겹침
    for (const c of cellsAt) {
      if (get0(this.classSlot, `${c.cid}|${c.d}|${c.p}`) > 1) both(c, `학급 중복 — ${c.cid}에 수업 2개 (+${pen.CLASS}점)`);
      if (get0(this.teacherSlot, `${c.tch}|${c.d}|${c.p}`) > 1) both(c, `교사 중복 — ${c.tch} 동시 수업 (+${pen.TEACHER}점)`);
      const g = this.sch.classGrade.get(c.cid);
      if (pen.NONCLASS && this.sch.nonclassSet.has(`${g}|${c.d}|${c.p}`)) both(c, `비수업 시간 침범 (+${pen.NONCLASS}점)`);
      if (pen.UNAVAIL && this.sch.unavailBlocked(c.tch, g, c.d, c.p)) both(c, `${c.tch} 불가시간 침범 (+${pen.UNAVAIL}점)`);
      if (c.bundle && pen.BUNDLE && get0(this.syncSlot, `${c.bundle}|${c.d}|${c.p}`) > 1) both(c, `묶음 겹침 (+${pen.BUNDLE}점)`);
      // H5: 같은 과목 같은 날 초과
      if (pen.SAME_DAY) {
        const cap = this.sch.subjDayCap.get(`${c.cid}|${c.subj}`) ?? 1;
        const cnt = get0(this.classSubjDay, `${c.cid}|${c.subj}|${c.d}`);
        if (cnt > cap) both(c, `같은 과목 같은 날 — ${c.cid} ${c.subj} 하루 ${cnt}회 (허용 ${cap}, +${pen.SAME_DAY * (cnt - cap)}점)`);
      }
      // S9: 유사과목 같은 날
      if (pen.SIMILAR) {
        const grp = this.sch.subjectToGroup.get(c.subj);
        if (grp && get0(this.classDayGroup, `${c.cid}|${c.d}|${grp}`) > 1) {
          both(c, `유사과목 같은 날 — ${grp} (+${pen.SIMILAR}점)`);
        }
      }
    }
    // H11: 2시간 과목 연속 요일 — 해당 두 셀
    if (pen.TWO_H) {
      for (const [k, p11] of this.h11Pen) {
        if (p11 <= 0) continue;
        const [cid, subj] = [k.slice(0, k.indexOf('|')), k.slice(k.indexOf('|') + 1)];
        for (const c of cellsAt) {
          if (c.cid === cid && c.subj === subj) both(c, `2시간 과목 연속 요일 — ${subj} (+${pen.TWO_H}점)`);
        }
      }
    }
    // 교사·요일 단위: H7 연속초과 / 연강없음 / 점심 / S8
    for (const [key, psSet] of this.teacherDayPeriods) {
      const i = key.lastIndexOf('|');
      const tch = key.slice(0, i), d = key.slice(i + 1);
      const periods = [...psSet].sort((a, b) => a - b);
      const runs = [];
      let cur = [periods[0]];
      for (let j = 1; j < periods.length; j++) {
        if (periods[j] === periods[j - 1] + 1) cur.push(periods[j]);
        else { runs.push(cur); cur = [periods[j]]; }
      }
      runs.push(cur);
      if (pen.CONSEC) for (const run of runs) {
        if (run.length > mc) {
          const pt = pen.CONSEC * (run.length - mc);
          for (const p of run) push(`t|${tch}|${d}|${p}`, `연속수업 ${run.length}시간 (허용 ${mc}, +${pt}점)`);
        }
      }
      if (pen.FRAG && periods.length >= 3 && !runs.some(r => r.length >= 2)) {
        for (const p of periods) push(`t|${tch}|${d}|${p}`, `연강 없음 — 하루 ${periods.length}시간 전부 흩어짐 (+${pen.FRAG}점)`);
      }
      if (this.sch.lunchSplit && pen.LUNCH) {
        const lp = this.sch.lunchPeriod;
        if (psSet.has(lp) && psSet.has(lp + 1)) {
          push(`t|${tch}|${d}|${lp}`, `점심 전후 연속 (+${pen.LUNCH}점)`);
          push(`t|${tch}|${d}|${lp + 1}`, `점심 전후 연속 (+${pen.LUNCH}점)`);
        }
      }
      if (pen.DAILY) {
        const cnt = get0(this.teacherDay, key);
        const avg = this.sch.teacherAvgDaily.get(tch) ?? 5;
        const cap = get0(this.teacherDayBundle, key) > 0 ? Math.max(avg, 4) : avg;
        if (cnt > cap) {
          for (const p of periods) push(`t|${tch}|${d}|${p}`, `하루 ${cnt}시간 (허용 ${cap}, +${pen.DAILY * (cnt - cap)}점)`);
        }
      }
    }
    return out;
  }

  snapshot() { return this.pos.map(dp => (dp ? [dp[0], dp[1]] : null)); }

  restore(snap) {
    for (let u = 0; u < this.pos.length; u++) if (this.pos[u]) this._unplace(u);
    for (let u = 0; u < snap.length; u++) if (snap[u]) this._place(u, snap[u][0], snap[u][1]);
  }

  // ───────── 편집기 지원 (드래그앤드롭·장판지) ─────────
  /** 하드 위반 개수(학급중복·교사중복·묶음중복·비수업·교사불가). 0이면 사용 가능한 배치. */
  hardCount() {
    const on = (k) => this.sch.ruleOn(k);
    let h = 0;
    for (const c of this.classSlot.values()) if (c > 1) h += c - 1;
    for (const c of this.teacherSlot.values()) if (c > 1) h += c - 1;
    if (on('bundleDay')) for (const c of this.syncSlot.values()) if (c > 1) h += c - 1;
    if (on('nonclass') || on('unavail')) for (let uid = 0; uid < this.sch.units.length; uid++) {
      const dp = this.pos[uid];
      if (!dp) continue;
      const [d, p] = dp;
      for (const [cid, tch] of this.sch.units[uid].cells) {
        const g = this.sch.classGrade.get(cid);
        if (on('nonclass') && this.sch.nonclassSet.has(`${g}|${d}|${p}`)) h++;
        if (on('unavail') && this.sch.unavailBlocked(tch, g, d, p)) h++;
      }
    }
    return h;
  }

  /** (cid,d,p)에 배치된 unit uid (없으면 null). 겹치면 첫 번째. */
  classUnitAt(cid, d, p) {
    for (let u = 0; u < this.sch.units.length; u++) {
      const dp = this.pos[u];
      if (!dp || dp[0] !== d || dp[1] !== p) continue;
      if (this.sch.units[u].cells.some(c => c[0] === cid)) return u;
    }
    return null;
  }

  /** (tch,d,p)에 배치된 unit uid (없으면 null). */
  teacherUnitAt(tch, d, p) {
    for (let u = 0; u < this.sch.units.length; u++) {
      const dp = this.pos[u];
      if (!dp || dp[0] !== d || dp[1] !== p) continue;
      if (this.sch.units[u].cells.some(c => c[1] === tch)) return u;
    }
    return null;
  }

  /**
   * uid를 (키 기준으로) 옮겼을 때 하드 위반 0으로 남는 슬롯 집합.
   * keyType: 'class' | 'teacher'. 반환: Set("d|p").
   */
  greenSlotsFor(uid, key, keyType) {
    const green = new Set();
    const posA = this.pos[uid];
    if (!posA) return green;
    const lookup = keyType === 'class'
      ? (d, p) => this.classUnitAt(key, d, p)
      : (d, p) => this.teacherUnitAt(key, d, p);
    for (const d of DAYS) {
      for (const p of PERIODS) {
        if (d === posA[0] && p === posA[1]) continue;
        const uB = lookup(d, p);
        if (uB === uid) continue;
        let ok;
        if (uB === null || uB === undefined) {
          this.move(uid, d, p);
          ok = this.hardCount() === 0;
          this.move(uid, posA[0], posA[1]);
        } else {
          this.swap(uid, uB);
          ok = this.hardCount() === 0;
          this.swap(uid, uB);
        }
        if (ok) green.add(`${d}|${p}`);
      }
    }
    return green;
  }

  /**
   * uid를 (d,p)로 옮기는 연쇄 재배치 계획 탐색 (CP-SAT 없이 즉시 계산).
   * 목표 칸을 차지한 수업은 다른 칸으로 밀어내고, 밀려난 수업도 재귀적으로
   * 재배치한다. 하드 규칙(중복·묶음·비수업·불가시간)이 현재보다 나빠지지
   * 않는 계획만 반환. 실패 시 null.
   * 반환: { moves: [{uid, from:[d,p], to:[d,p]}], penaltyAfter }
   */
  relocPlanTo(uid, targetD, targetP, opts = {}) {
    const maxDepth = opts.maxDepth ?? 4;
    let budget = opts.budget ?? 30000;
    const sch = this.sch;
    const on = (k) => sch.ruleOn(k);
    const posA = this.pos[uid];
    if (!posA || (posA[0] === targetD && posA[1] === targetP)) return null;

    const staticOk = (u, d, p) => {
      for (const [cid, tch] of sch.units[u].cells) {
        const g = sch.classGrade.get(cid);
        if (on('nonclass') && sch.nonclassSet.has(`${g}|${d}|${p}`)) return false;
        if (on('unavail') && sch.unavailBlocked(tch, g, d, p)) return false;
      }
      return true;
    };
    const shares = (a, b) => {
      const ua = sch.units[a], ub = sch.units[b];
      if (on('bundleDay') && ua.bundle_key && ua.bundle_key === ub.bundle_key) return true;
      for (const [cidA, tchA] of ua.cells)
        for (const [cidB, tchB] of ub.cells)
          if (cidA === cidB || tchA === tchB) return true;
      return false;
    };
    const conflictsAt = (u, d, p) => {
      const out = [];
      for (let v = 0; v < sch.units.length; v++) {
        if (v === u) continue;
        const dp = this.pos[v];
        if (dp && dp[0] === d && dp[1] === p && shares(u, v)) out.push(v);
      }
      return out;
    };

    const moves = [];               // 확정된 이동 스택 {uid, from, to}
    const inChain = new Set();      // 이미 새 자리가 정해진 unit — 다시 밀어내지 않음
    const rollbackTo = (n) => {
      while (moves.length > n) {
        const m = moves.pop();
        inChain.delete(m.uid);
        this.move(m.uid, m.from[0], m.from[1]);
      }
    };

    const place = (u, d, p, depth) => {
      if (budget-- <= 0 || !staticOk(u, d, p)) return false;
      const conf = conflictsAt(u, d, p);
      if (conf.some(v => inChain.has(v))) return false;
      const from = this.pos[u];
      this.move(u, d, p);
      moves.push({ uid: u, from, to: [d, p] });
      inChain.add(u);
      if (!conf.length) return true;
      if (depth < maxDepth && relocateAll(conf, 0, depth)) return true;
      rollbackTo(moves.length - 1);
      return false;
    };

    // 밀려난 수업들을 하나씩 새 자리에 배치 (전부 성공해야 true)
    const relocateAll = (list, i, depth) => {
      if (i >= list.length) return true;
      const v = list[i];
      for (const [d, p] of candidateSlots(v, depth)) {
        const mark = moves.length;
        if (place(v, d, p, depth + 1)) {
          if (relocateAll(list, i + 1, depth)) return true;
          rollbackTo(mark);
        }
        if (budget <= 0) return false;
      }
      return false;
    };

    // v의 후보 칸 — 빈 칸(충돌 0) 우선, 마지막 단계가 아니면 충돌 1개 칸도 시도
    const candidateSlots = (v, depth) => {
      const cur = this.pos[v];
      const empty = [], occ = [];
      for (const d of DAYS) for (const p of PERIODS) {
        if (cur && cur[0] === d && cur[1] === p) continue;
        if (!staticOk(v, d, p)) continue;
        const conf = conflictsAt(v, d, p);
        if (conf.some(w => inChain.has(w))) continue;
        if (conf.length === 0) empty.push([d, p]);
        else if (conf.length === 1 && depth + 1 < maxDepth) occ.push([d, p]);
      }
      return empty.concat(occ);
    };

    const snap = this.snapshot();
    const baseHard = this.hardCount();
    const found = place(uid, targetD, targetP, 0);
    const ok = found && this.hardCount() <= baseHard;
    const plan = ok ? { moves: moves.map(m => ({ ...m })), penaltyAfter: this.penalty } : null;
    this.restore(snap);
    return plan;
  }
}
