/** Minimal unified diff. Keeps `--diff` from costing a dependency (spec §9). */
export function unifiedDiff(a, b, aLabel = 'a', bLabel = 'b', context = 3) {
  const x = a === '' ? [] : a.split('\n');
  const y = b === '' ? [] : b.split('\n');
  const ops = lcsOps(x, y);
  if (ops.every((o) => o.t === ' ')) return '';

  const hunks = [];
  let i = 0;
  while (i < ops.length) {
    if (ops[i].t === ' ') { i++; continue; }
    let start = Math.max(0, i - context);
    let end = i;
    while (end < ops.length) {
      if (ops[end].t !== ' ') { end++; continue; }
      let run = end;
      while (run < ops.length && ops[run].t === ' ') run++;
      if (run - end > context * 2 || run === ops.length) break;
      end = run;
    }
    hunks.push([start, Math.min(ops.length, end + context)]);
    i = end + context;
  }

  const out = [`--- ${aLabel}`, `+++ ${bLabel}`];
  for (const [s, e] of merge(hunks)) {
    const slice = ops.slice(s, e);
    const aLen = slice.filter((o) => o.t !== '+').length;
    const bLen = slice.filter((o) => o.t !== '-').length;
    const aStart = ops.slice(0, s).filter((o) => o.t !== '+').length + 1;
    const bStart = ops.slice(0, s).filter((o) => o.t !== '-').length + 1;
    out.push(`@@ -${aStart},${aLen} +${bStart},${bLen} @@`);
    for (const o of slice) out.push(o.t + o.line);
  }
  return out.join('\n');
}

function merge(hunks) {
  const sorted = hunks.slice().sort((p, q) => p[0] - q[0]);
  const merged = [];
  for (const h of sorted) {
    const last = merged[merged.length - 1];
    if (last && h[0] <= last[1]) last[1] = Math.max(last[1], h[1]);
    else merged.push(h.slice());
  }
  return merged;
}

function lcsOps(x, y) {
  const n = x.length;
  const m = y.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) { ops.push({ t: ' ', line: x[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push({ t: '-', line: x[i] }); i++; }
    else { ops.push({ t: '+', line: y[j] }); j++; }
  }
  while (i < n) ops.push({ t: '-', line: x[i++] });
  while (j < m) ops.push({ t: '+', line: y[j++] });
  return ops;
}
