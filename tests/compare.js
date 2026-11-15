const [a, b] = process.argv.slice(2).map(f => JSON.parse(require('fs').readFileSync(f, 'utf8')));
let diffs = 0;
const walk = (x, y, path) => {
  if (typeof x === 'number' && typeof y === 'number') { if (Math.abs(x - y) > 1e-6) { diffs++; if (diffs < 15) console.log('DIFERENCIA', path, x, y); } return; }
  if (x === null || y === null || typeof x !== 'object') { if (JSON.stringify(x) !== JSON.stringify(y)) { diffs++; if (diffs < 15) console.log('DIFERENCIA', path, JSON.stringify(x), JSON.stringify(y)); } return; }
  const keys = new Set([...Object.keys(x), ...Object.keys(y)]);
  for (const k of keys) walk(x[k], y[k], path + '.' + k);
};
walk(a, b, '');
let n = 0; const count = o => { if (o && typeof o === 'object') Object.values(o).forEach(count); else n++; }; count(a);
console.log(diffs ? `${diffs} diferencias` : `IDÉNTICOS: ${n} valores comparados`);
process.exit(diffs ? 1 : 0);
