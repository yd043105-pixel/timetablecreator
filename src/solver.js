/**
 * CP-SAT 시간표 솔버 (cpsat_solver.py 포팅, or-tools-wasm 기반)
 * H2/H3/H8 + H5/H11(하드), 나머지 소프트 최소화 + 반복 개선 루프.
 */
import { CpModel, CpSolver, LinearExpr } from 'or-tools-wasm/cp-sat';
import { DAYS, DAY_IDX, PEN, State } from './engine.js';

const sid = (d, p) => DAY_IDX[d] * 7 + (p - 1);

function sumOf(model, vars) {
  return LinearExpr.sum(vars);
}

/** 하드충족(충돌 없는 배치)만 빠르게 풀어 힌트 값을 얻는다. INFEASIBLE이면 null. */
async function feasibleHint(sch, workers, timeLimit = 30) {
  const m = new CpModel();
  const hp = new Map(); // `${u}|${s}` -> BoolVar
  for (let u = 0; u < sch.nUnits; u++) {
    const vs = [];
    for (const [d, p] of sch.unitCandidateSlots[u]) {
      const b = m.newBoolVar(`h${u}_${sid(d, p)}`);
      hp.set(`${u}|${sid(d, p)}`, b);
      vs.push(b);
    }
    m.addExactlyOne(vs);
  }
  const cu = new Map(), tu = new Map();
  for (let u = 0; u < sch.nUnits; u++) {
    for (const [cid, tch] of sch.units[u].cells) {
      if (!cu.has(cid)) cu.set(cid, new Set());
      cu.get(cid).add(u);
      if (!tu.has(tch)) tu.set(tch, new Set());
      tu.get(tch).add(u);
    }
  }
  for (const us of [...cu.values(), ...tu.values()]) {
    for (let s = 0; s < 35; s++) {
      const vs = [];
      for (const u of us) {
        const b = hp.get(`${u}|${s}`);
        if (b) vs.push(b);
      }
      if (vs.length > 1) m.addAtMostOne(vs);
    }
  }
  if (sch.ruleOn('bundleDay')) for (const sibs of sch.bundleSibling.values()) {
    for (let day = 0; day < 5; day++) {
      const vs = [];
      for (const u of sibs) for (let p = 0; p < 7; p++) {
        const b = hp.get(`${u}|${day * 7 + p}`);
        if (b) vs.push(b);
      }
      if (vs.length > 1) m.addAtMostOne(vs);
    }
  }
  // H5·H11도 본 모델에서 하드이므로 힌트 역시 이를 만족해야 한다.
  // (안 그러면 힌트가 위반투성이라 본 탐색이 첫 해조차 못 찾는다)
  const csubjH = new Map(); // `${cid}|${subj}` -> Set(u)
  for (let u = 0; u < sch.nUnits; u++) {
    for (const [cid, , subj] of sch.units[u].cells) {
      const k = `${cid}|${subj}`;
      if (!csubjH.has(k)) csubjH.set(k, new Set());
      csubjH.get(k).add(u);
    }
  }
  if (sch.ruleOn('sameSubjectDay')) for (const [k, us] of csubjH) {
    const cap = sch.subjDayCap.get(k) ?? 1;
    for (let day = 0; day < 5; day++) {
      const vs = [];
      for (const u of us) for (let p = 0; p < 7; p++) {
        const b = hp.get(`${u}|${day * 7 + p}`);
        if (b) vs.push(b);
      }
      if (vs.length > cap) m.addLinearConstraint(LinearExpr.sum(vs), 0, cap);
    }
  }
  if (sch.ruleOn('twoHourAdjDay')) for (const [k, us] of csubjH) {
    const i = k.indexOf('|');
    const cid = k.slice(0, i), subj = k.slice(i + 1);
    let hrs = 0;
    for (const u of us) for (const cell of sch.units[u].cells) {
      if (cell[0] === cid && cell[2] === subj) hrs++;
    }
    if (hrs !== 2) continue;
    for (let di = 0; di < 4; di++) {
      const vs = [];
      for (const u of us) for (let p = 0; p < 7; p++) {
        const b1 = hp.get(`${u}|${di * 7 + p}`);
        if (b1) vs.push(b1);
        const b2 = hp.get(`${u}|${(di + 1) * 7 + p}`);
        if (b2) vs.push(b2);
      }
      if (vs.length > 1) m.addLinearConstraint(LinearExpr.sum(vs), 0, 1);
    }
  }
  const solver = new CpSolver();
  solver.parameters.maxTimeInSeconds = timeLimit;
  solver.parameters.numSearchWorkers = workers;
  const status = await solver.solve(m);
  const name = solver.statusName(status);
  if (name === 'OPTIMAL' || name === 'FEASIBLE') {
    const values = new Map();
    for (const [key, v] of hp) values.set(key, solver.booleanValue(v) ? 1 : 0);
    return { status: name, values };
  }
  return { status: name, values: null };
}

/**
 * CP-SAT 1회 풀이. 반환 {state, status}.
 * opts: {timeLimit, workers, progress(msg), shouldStop(), warmUnits}
 */
export async function solveCpsat(sch, opts = {}) {
  const timeLimit = opts.timeLimit ?? 90;
  const workers = opts.workers ?? 4;
  const progress = opts.progress || (() => {});
  const shouldStop = opts.shouldStop || (() => false);
  const warmUnits = opts.warmUnits ?? null;
  const mc = sch.maxConsecutive;

  const m = new CpModel();
  const place = new Map(); // `${u}|${s}` -> BoolVar
  for (let u = 0; u < sch.nUnits; u++) {
    const vs = [];
    for (const [d, p] of sch.unitCandidateSlots[u]) {
      const b = m.newBoolVar(`x${u}_${sid(d, p)}`);
      place.set(`${u}|${sid(d, p)}`, b);
      vs.push(b);
    }
    m.addExactlyOne(vs);
  }
  const pget = (u, d, p) => place.get(`${u}|${sid(d, p)}`);

  const classUnits = new Map(), teacherUnits = new Map();
  const usubj = new Map();   // cid -> Map(subj -> Set(u))
  const csubj = new Map();   // `${cid}|${subj}` -> Set(u)
  const cdGroup = new Map(); // cid -> Map(grp -> Set(u))
  let stress = new Map();
  try { stress = sch.computeTeacherStress(); } catch { /* ignore */ }
  const sget = (t) => stress.get(t) ?? 1.0;
  const on = (k) => sch.ruleOn(k);

  for (let u = 0; u < sch.nUnits; u++) {
    for (const [cid, tch, subj] of sch.units[u].cells) {
      if (!classUnits.has(cid)) classUnits.set(cid, new Set());
      classUnits.get(cid).add(u);
      if (!teacherUnits.has(tch)) teacherUnits.set(tch, new Set());
      teacherUnits.get(tch).add(u);
      if (!usubj.has(cid)) usubj.set(cid, new Map());
      if (!usubj.get(cid).has(subj)) usubj.get(cid).set(subj, new Set());
      usubj.get(cid).get(subj).add(u);
      const ck = `${cid}|${subj}`;
      if (!csubj.has(ck)) csubj.set(ck, new Set());
      csubj.get(ck).add(u);
      const grp = sch.subjectToGroup.get(subj);
      if (grp) {
        if (!cdGroup.has(cid)) cdGroup.set(cid, new Map());
        if (!cdGroup.get(cid).has(grp)) cdGroup.get(cid).set(grp, new Set());
        cdGroup.get(cid).get(grp).add(u);
      }
    }
  }

  // ── 하드: H2 / H3 / H8 ──
  for (const us of [...classUnits.values(), ...teacherUnits.values()]) {
    for (let s = 0; s < 35; s++) {
      const vs = [];
      for (const u of us) {
        const b = place.get(`${u}|${s}`);
        if (b) vs.push(b);
      }
      if (vs.length > 1) m.addAtMostOne(vs);
    }
  }
  if (on('bundleDay')) for (const sibs of sch.bundleSibling.values()) {
    for (let day = 0; day < 5; day++) {
      const vs = [];
      for (const u of sibs) for (let p = 0; p < 7; p++) {
        const b = place.get(`${u}|${day * 7 + p}`);
        if (b) vs.push(b);
      }
      if (vs.length > 1) m.addAtMostOne(vs);
    }
  }

  const obj = []; // LinearExpr terms

  // H5: 같은 학급·같은 과목 하루 cap 이하 (하드)
  if (on('sameSubjectDay')) for (const [cid, sm] of usubj) {
    for (const [subj, us] of sm) {
      const cap = sch.subjDayCap.get(`${cid}|${subj}`) ?? 1;
      for (const d of DAYS) {
        const vs = [];
        for (const u of us) for (let p = 1; p <= 7; p++) {
          const b = pget(u, d, p);
          if (b) vs.push(b);
        }
        if (!vs.length) continue;
        m.addLinearConstraint(sumOf(m, vs), 0, cap);
      }
    }
  }

  // teach 불리언
  const tb = new Map(); // `${t}|${d}|${p}` -> BoolVar | null
  for (const [t, us] of teacherUnits) {
    for (const d of DAYS) {
      for (let p = 1; p <= 7; p++) {
        const vs = [];
        for (const u of us) {
          const b = pget(u, d, p);
          if (b) vs.push(b);
        }
        if (vs.length) {
          const b = m.newBoolVar(`tb_${t}_${d}_${p}`);
          m.addEquality(b, sumOf(m, vs));
          tb.set(`${t}|${d}|${p}`, b);
        } else {
          tb.set(`${t}|${d}|${p}`, null);
        }
      }
    }
  }
  const tget = (t, d, p) => tb.get(`${t}|${d}|${p}`) || null;

  // H7: (mc+1) 연속 초과 (소프트, 가중 강화)
  if (on('teacherConsec')) for (const t of teacherUnits.keys()) {
    for (const d of DAYS) {
      for (let p = 1; p <= 7 - mc; p++) {
        const win = [];
        for (let q = p; q <= p + mc; q++) {
          const b = tget(t, d, q);
          if (b) win.push(b);
        }
        if (win.length < mc + 1) continue;
        const ov = m.newIntVar(0, mc + 1, `h7_${t}_${d}_${p}`);
        // ov >= sum(win) - mc  ⟺  sum(win) - ov <= mc
        m.addLinearConstraint(sumOf(m, win).minus(ov), -(mc + 1) * 10, mc);
        obj.push(LinearExpr.term(ov, Math.round(4 * PEN.CONSEC * sget(t))));
      }
    }
  }

  // S8: 하루 시수 초과 (소프트, 묶음 있는 날은 4까지 면제)
  const bundleUnitsOf = new Map();
  for (const [t, us] of teacherUnits) {
    for (const u of us) {
      if (sch.units[u].bundle_key) {
        if (!bundleUnitsOf.has(t)) bundleUnitsOf.set(t, new Set());
        bundleUnitsOf.get(t).add(u);
      }
    }
  }
  if (on('teacherDaily')) for (const [t] of teacherUnits) {
    const avg = sch.teacherAvgDaily.get(t) ?? 5;
    const bus = bundleUnitsOf.get(t) || new Set();
    for (const d of DAYS) {
      const vs = [];
      for (let p = 1; p <= 7; p++) {
        const b = tget(t, d, p);
        if (b) vs.push(b);
      }
      if (!vs.length) continue;
      const ex = m.newIntVar(0, 7, `s8_${t}_${d}`);
      const bvars = [];
      for (const u of bus) for (let p = 1; p <= 7; p++) {
        const b = pget(u, d, p);
        if (b) bvars.push(b);
      }
      const relaxed = Math.max(avg, 4);
      if (bvars.length && relaxed > avg) {
        const hb = m.newBoolVar(`s8hb_${t}_${d}`);
        m.addMaxEquality(hb, bvars);
        // ex >= sum(vs) - avg - (relaxed-avg)*hb
        // ⟺ sum(vs) - ex - (relaxed-avg)*hb <= avg
        m.addLinearConstraint(
          sumOf(m, vs).minus(ex).minus(LinearExpr.term(hb, relaxed - avg)),
          -100, avg);
      } else {
        m.addLinearConstraint(sumOf(m, vs).minus(ex), -100, avg);
      }
      obj.push(LinearExpr.term(ex, Math.round(PEN.TEACHER_DAILY * sget(t))));
    }
  }

  // H11: 2시간 과목 인접요일 금지 (하드)
  if (on('twoHourAdjDay')) for (const [ck, us] of csubj) {
    const i = ck.indexOf('|');
    const cid = ck.slice(0, i), subj = ck.slice(i + 1);
    let hrs = 0;
    for (const u of us) for (const cell of sch.units[u].cells) {
      if (cell[0] === cid && cell[2] === subj) hrs++;
    }
    if (hrs !== 2) continue;
    for (let di = 0; di < 4; di++) {
      const d1 = DAYS[di], d2 = DAYS[di + 1];
      const v1 = [], v2 = [];
      for (const u of us) for (let p = 1; p <= 7; p++) {
        const b1 = pget(u, d1, p);
        if (b1) v1.push(b1);
        const b2 = pget(u, d2, p);
        if (b2) v2.push(b2);
      }
      if (v1.length && v2.length) {
        m.addLinearConstraint(sumOf(m, [...v1, ...v2]), 0, 1);
      }
    }
  }

  // S9: 유사과목 같은 날 (소프트)
  if (on('similarDay')) for (const [cid, groups] of cdGroup) {
    for (const [grp, us] of groups) {
      for (const d of DAYS) {
        const vs = [];
        for (const u of us) for (let p = 1; p <= 7; p++) {
          const b = pget(u, d, p);
          if (b) vs.push(b);
        }
        if (vs.length > 1) {
          const ex = m.newIntVar(0, 7, `s9_${cid}_${grp}_${d}`);
          m.addLinearConstraint(sumOf(m, vs).minus(ex), -100, 1);
          obj.push(LinearExpr.term(ex, PEN.SIMILAR_SAME_DAY));
        }
      }
    }
  }

  // 묶기: 하루 3시수↑인데 연강 한 쌍도 없으면 벌점
  if (on('pairing')) for (const t of teacherUnits.keys()) {
    for (const d of DAYS) {
      const tbs = [];
      for (let p = 1; p <= 7; p++) {
        const b = tget(t, d, p);
        if (b) tbs.push(b);
      }
      if (tbs.length < 3) continue;
      const nday = m.newIntVar(0, 7, `n_${t}_${d}`);
      m.addEquality(nday, sumOf(m, tbs));
      const ge3 = m.newBoolVar(`ge3_${t}_${d}`);
      m.addLinearConstraint(nday, 3, 7).onlyEnforceIf(ge3);
      m.addLinearConstraint(nday, 0, 2).onlyEnforceIf(ge3.not());
      const pairs = [];
      for (let p = 1; p <= 6; p++) {
        const a = tget(t, d, p), b = tget(t, d, p + 1);
        if (!a || !b) continue;
        const y = m.newBoolVar(`pr_${t}_${d}_${p}`);
        // y <= a, y <= b, y >= a + b - 1
        m.addLinearConstraint(LinearExpr.sum([y]).minus(a), -10, 0);
        m.addLinearConstraint(LinearExpr.sum([y]).minus(b), -10, 0);
        m.addLinearConstraint(LinearExpr.sum([a, b]).minus(y), -10, 1);
        pairs.push(y);
      }
      if (!pairs.length) continue;
      const frag = m.newBoolVar(`frag_${t}_${d}`);
      // frag >= ge3 - sum(pairs)  ⟺  ge3 - sum(pairs) - frag <= 0
      m.addLinearConstraint(LinearExpr.sum([ge3]).minus(sumOf(m, pairs)).minus(frag), -100, 0);
      obj.push(LinearExpr.term(frag, Math.round(PEN.FRAGMENT * sget(t))));
    }
  }

  // 점심 전후 연속 (선택, 소프트)
  if (sch.lunchSplit) {
    const lp = sch.lunchPeriod;
    for (const t of teacherUnits.keys()) {
      for (const d of DAYS) {
        const a = tget(t, d, lp), b = tget(t, d, lp + 1);
        if (!a || !b) continue;
        const lb = m.newBoolVar(`lunch_${t}_${d}`);
        m.addLinearConstraint(LinearExpr.sum([a, b]).minus(lb), -10, 1);
        obj.push(LinearExpr.term(lb, PEN.LUNCH_CROSS));
      }
    }
  }

  // 역할: 홍보담당
  const afternoonFlag = (t, d) => {
    const aps = [];
    for (let p = 5; p <= 7; p++) {
      const b = tget(t, d, p);
      if (b) aps.push(b);
    }
    if (!aps.length) return null;
    const af = m.newBoolVar(`pm_af_${t}_${d}`);
    for (const a of aps) m.addImplication(a, af);
    m.addLinearConstraint(LinearExpr.sum([af]).minus(sumOf(m, aps)), -10, 0);
    return af;
  };
  const promo1 = [...(sch.promo1Teachers || [])].filter(t => teacherUnits.has(t));
  const promo2 = [...(sch.promo2Teachers || [])].filter(t => teacherUnits.has(t));
  const PEN_PROMO1_DAY = 120;
  for (const t of promo1) {
    for (const d of DAYS) {
      const af = afternoonFlag(t, d);
      if (af) obj.push(LinearExpr.term(af, PEN_PROMO1_DAY));
    }
  }
  const PEN_PROMO2_NODAY = 400;
  for (const t of promo2) {
    const flags = [];
    let alreadyFree = false;
    for (const d of DAYS) {
      const af = afternoonFlag(t, d);
      if (af === null) { alreadyFree = true; break; }
      flags.push(af);
    }
    if (alreadyFree || !flags.length) continue;
    const allBusy = m.newBoolVar(`pm2_allbusy_${t}`);
    // allBusy >= sum(flags) - (len-1)
    m.addLinearConstraint(sumOf(m, flags).minus(allBusy), -100, flags.length - 1);
    obj.push(LinearExpr.term(allBusy, PEN_PROMO2_NODAY));
  }
  // 역할: 교무부장·학년부장 → 1교시 회피 (가장 후순위 소프트)
  const PEN_FIRST = 3;
  for (const t of (sch.firstAvoidTeachers || new Set())) {
    if (!teacherUnits.has(t)) continue;
    for (const d of DAYS) {
      const b = tget(t, d, 1);
      if (b) obj.push(LinearExpr.term(b, PEN_FIRST));
    }
  }

  m.minimize(LinearExpr.sum(obj.length ? obj : [m.newConstant(0)]));

  // 워밍스타트
  if (warmUnits !== null) {
    progress('이전 시간표에서 이어서 시작...');
    for (let u = 0; u < warmUnits.length; u++) {
      const dp = warmUnits[u];
      if (!dp) continue;
      const b = place.get(`${u}|${sid(dp[0], dp[1])}`);
      if (b) m.addHint(b, 1);
    }
  } else {
    progress('기본 배치 가능 여부 확인 중...');
    const feas = await feasibleHint(sch, workers, Math.max(30, Math.min(90, timeLimit * 0.3)));
    if (feas.status === 'INFEASIBLE') return { state: null, status: 'INFEASIBLE' };
    progress(`기본 배치 확인: ${feas.status}${feas.values ? ' — 힌트 적용' : ''}`);
    if (feas.values) {
      for (const [key, val] of feas.values) {
        const b = place.get(key);
        if (b) m.addHint(b, val === 1);
      }
    }
  }

  const solver = new CpSolver();
  solver.parameters.maxTimeInSeconds = timeLimit;
  solver.parameters.numSearchWorkers = workers;
  progress('CP-SAT 최적화 중...');

  let nSol = 0;
  let stopRequested = false;
  const cbState = { lastPen: null };
  const status = await solver.solve(m, null, {
    onSolution: (resp) => {
      try {
        nSol++;
        // resp.solution: 전체 변수값 배열 — place 변수 인덱스로 읽는다
        if (resp && resp.solution) {
          const st = new State(sch);
          for (let u = 0; u < sch.nUnits; u++) {
            for (const [d, p] of sch.unitCandidateSlots[u]) {
              const b = place.get(`${u}|${sid(d, p)}`);
              if (b && Number(resp.solution[b.index]) === 1) {
                st._place(u, d, p);
                break;
              }
            }
          }
          const pen = st.getSolution().penalty;
          cbState.lastPen = pen;
          progress(`개선 중 — 현재 페널티 ${pen} (해 ${nSol}개 발견, 중단 가능)`);
        }
        if (shouldStop() && !stopRequested) {
          stopRequested = true;
          import('or-tools-wasm/cp-sat').then(mod => mod.default.cancelSolve()).catch(() => {});
        }
      } catch { /* 콜백 예외 차단 */ }
    },
  });
  const name = solver.statusName(status);
  if (name === 'OPTIMAL' || name === 'FEASIBLE') {
    const st = new State(sch);
    for (let u = 0; u < sch.nUnits; u++) {
      for (const [d, p] of sch.unitCandidateSlots[u]) {
        const b = place.get(`${u}|${sid(d, p)}`);
        if (b && solver.booleanValue(b)) {
          st._place(u, d, p);
          break;
        }
      }
    }
    return { state: st, status: name };
  }
  return { state: null, status: name };
}

/** 최선해에서 '옮기기 쉬운 수업' 위주로 자리를 비운 warm 배열 생성 */
export function perturbEasyUnits(sch, pos, frac = 0.25, rand = Math.random) {
  const rig = sch.computeUnitRigidity();
  const n = sch.nUnits;
  const inv = rig.map(r => 1.0 / ((1.0 + r) ** 2));
  const k = Math.max(1, Math.floor(n * frac));
  const chosen = new Set();
  let total = inv.reduce((a, b) => a + b, 0);
  for (let iter = 0; iter < k * 3; iter++) {
    if (chosen.size >= k || total <= 0) break;
    const x = rand() * total;
    let acc = 0;
    for (let u = 0; u < n; u++) {
      if (chosen.has(u)) continue;
      acc += inv[u];
      if (acc >= x) {
        chosen.add(u);
        total -= inv[u];
        break;
      }
    }
  }
  return pos.map((dp, u) => (chosen.has(u) ? null : dp));
}

/**
 * 반복 개선: 정체되면 최선해를 보관하고 쉬운 수업만 흔들어 다시 조여든다.
 * opts: {timeLimit, workers, progress, shouldStop, warmUnits, roundTime}
 */
export async function solveCpsatIterated(sch, opts = {}) {
  const timeLimit = opts.timeLimit ?? 90;
  const progress = opts.progress || (() => {});
  const shouldStop = opts.shouldStop || (() => false);
  const t0 = Date.now();

  let firstRound, laterRound;
  if (opts.roundTime) {
    firstRound = laterRound = opts.roundTime;
  } else {
    firstRound = Math.max(60, Math.min(300, timeLimit * 0.45));
    laterRound = Math.max(30, Math.min(90, timeLimit * 0.12));
    if (opts.warmUnits) firstRound = laterRound;
  }

  let bestSt = null, bestPen = null, status = 'UNKNOWN';
  let curWarm = opts.warmUnits ?? null;
  let frac = 0.10;
  let rnd = 0;
  for (;;) {
    const left = timeLimit - (Date.now() - t0) / 1000;
    if (left <= 5 || shouldStop()) break;
    rnd++;
    const tl = Math.min(rnd === 1 ? firstRound : laterRound, left);
    const bcopy = bestPen;
    const roundProgress = (msg) =>
      progress(bcopy === null ? `[${rnd}회차] ${msg}` : `[${rnd}회차] ${msg}  (최선 ${bcopy})`);

    const { state: st, status: stt } = await solveCpsat(sch, {
      ...opts, timeLimit: tl, progress: roundProgress, warmUnits: curWarm,
    });
    if (!st) {
      if (!bestSt) {
        // 조건이 모순(INFEASIBLE)이면 즉시 종료. 시간 부족(UNKNOWN)이면
        // 남은 시간 동안 더 긴 라운드로 첫 해 찾기를 재시도한다.
        if (stt === 'INFEASIBLE') return { state: null, status: stt };
        status = stt;
        progress(`[${rnd}회차] 아직 첫 해를 찾지 못함 — 남은 시간으로 계속 탐색`);
        firstRound = Math.min(firstRound * 2, 600);
        rnd = 0;                       // 다음도 '1회차'로 취급해 긴 라운드 유지
        continue;
      }
      progress(`[${rnd}회차] 해 못 찾음 — 최선 ${bestPen}에서 재시도`);
      frac = Math.max(0.10, frac - 0.05);
      curWarm = perturbEasyUnits(sch, bestSt.snapshot(), frac);
      continue;
    }
    try { sch.polishPairing(st, 6); } catch { /* ignore */ }
    const pen = st.getSolution().penalty;
    if (bestPen === null || pen < bestPen) {
      bestSt = st; bestPen = pen; status = stt;
      frac = 0.10;
      progress(`[${rnd}회차] 개선 — 최선 페널티 ${bestPen}`);
    } else {
      frac = Math.min(0.30, frac + 0.05);
      progress(`[${rnd}회차] 정체 — 최선 ${bestPen} 유지, 흔들기 ${Math.round(frac * 100)}%`);
    }
    if (bestPen === 0) break;
    curWarm = perturbEasyUnits(sch, bestSt.snapshot(), frac);
  }
  if (!bestSt) return { state: null, status };
  return { state: bestSt, status };
}
