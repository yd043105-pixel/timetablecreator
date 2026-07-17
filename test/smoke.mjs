// or-tools-wasm CP-SAT smoke test (Node)
import { CpModel, CpSolver } from 'or-tools-wasm/cp-sat';

const t0 = Date.now();
const model = new CpModel();
// tiny scheduling-like model: 4 items, 3 slots, each item exactly one slot, slot capacity 2
const N = 4, S = 3;
const x = [];
for (let i = 0; i < N; i++) {
  x.push([]);
  for (let s = 0; s < S; s++) x[i].push(model.newBoolVar(`x_${i}_${s}`));
}
for (let i = 0; i < N; i++) model.addExactlyOne(x[i]);
for (let s = 0; s < S; s++) model.addAtMostOne ? model.addAtMostOne(x.map(r => r[s]).slice(0, 2)) : null;
// objective: prefer early slots
let obj = null;
const terms = [];
for (let i = 0; i < N; i++) for (let s = 0; s < S; s++) terms.push(x[i][s].times(s));
obj = terms.reduce((a, b) => (a ? a.plus(b) : b), null);
model.minimize(obj);

const solver = new CpSolver();
solver.parameters.maxTimeInSeconds = 10;
solver.parameters.numSearchWorkers = 4;
let solutions = 0;
const status = await solver.solve(model, null, {
  onSolution(resp) { solutions++; console.log('  cb solution obj=', resp.objectiveValue); },
});
console.log('status:', status, 'objective:', solver.objectiveValue(), 'solutions:', solutions);
for (let i = 0; i < N; i++) {
  for (let s = 0; s < S; s++) {
    if (solver.booleanValue(x[i][s])) console.log(`item ${i} -> slot ${s}`);
  }
}
console.log('elapsed ms:', Date.now() - t0);
