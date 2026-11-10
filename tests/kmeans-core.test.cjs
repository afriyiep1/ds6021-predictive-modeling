/* Run with: node tests/kmeans-core.test.cjs */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Core = require('../docs/kmeans/kmeans.js');

function close(actual, expected, tolerance = 1e-8) {
  assert.ok(Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)), `${actual} != ${expected}`);
}

function checkRun(points, centers) {
  const frames = Core.history(points, centers);
  assert.equal(frames[0].sse, null);
  for (let i = 2; i < frames.length; i++) {
    const previous = frames[i - 1].sse;
    assert.ok(frames[i].sse <= previous + 1e-8 * Math.max(1, previous), `Objective increased at frame ${i}`);
  }
  const last = frames.at(-1);
  assert.equal(last.converged, true);
  assert.deepEqual(last.labels, Core.assign(points, last.centers));
  last.centers.forEach((center, k) => {
    const members = points.filter((_, i) => last.labels[i] === k);
    if (members.length) center.forEach((value, j) => close(value, members.reduce((sum, p) => sum + p[j], 0) / members.length));
  });
  close(last.sse, Core.objective(points, last.centers, last.labels));
  return frames;
}

// A hand calculation where a point changes clusters on the second assignment.
const points = [[1, 1], [1, 2], [3, 1], [6, 2], [7, 1], [8, 2]];
const frames = checkRun(points, [[1, 1], [3, 1]]);
const objectives = frames.slice(1).map(frame => frame.sse);
assert.equal(objectives.length, 5);
[53, 15.5, 10.5, 6, 6].forEach((value, i) => close(objectives[i], value));
assert.notEqual(frames[1].labels[2], frames[3].labels[2]);

// Ties are deterministic; duplicated initial centers can remain empty without NaN.
assert.deepEqual(Core.assign([[1, 0]], [[0, 0], [2, 0]]), [0]);
const empty = checkRun([[0], [10]], [[0], [0], [10]]);
assert.ok(empty.at(-1).empty.includes(1));
assert.deepEqual(empty.at(-1).centers[1], [0]);

const constant = Core.prepare([{a: 2, b: 1}, {a: 2, b: 1}, {a: 2, b: 3}], ['a', 'b'], true);
assert.deepEqual(constant.constantFeatures, ['a']);
assert.ok(constant.points.every(p => p[0] === 0));
assert.equal(constant.unique.length, 2);
assert.throws(() => Core.initialize(constant.points, constant.unique, 3, 6021, 'random'));
close(constant.points.reduce((sum, p) => sum + p[1] ** 2, 0) / 3, 1);

// A limit is not incorrectly called convergence.
const limited = Core.history(points, [[1, 1], [3, 1]], 1).at(-1);
assert.equal(limited.limited, true);
assert.equal(limited.converged, false);

// Random positions need not coincide with observations; they stay in their bounds.
const bounds = [[0, 100], [20, 95], [0, 5]];
const randomPositions = Core.randomCenters(bounds, 6, 42);
assert.equal(new Set(randomPositions.map(p => JSON.stringify(p))).size, 6);
assert.deepEqual(randomPositions, Core.randomCenters(bounds, 6, 42));
assert.notDeepEqual(randomPositions, Core.randomCenters(bounds, 6, 43));
randomPositions.forEach(center => center.forEach((value, j) => assert.ok(value >= bounds[j][0] && value <= bounds[j][1])));
assert.throws(() => Core.randomCenters([[1, 1], [2, 2]], 2, 42));
assert.throws(() => Core.randomCenters([[3, 1]], 1, 42));
assert.throws(() => Core.randomCenters([[0, Infinity]], 1, 42));

const snapshotPath = path.join(__dirname, '../docs/kmeans/weather-snapshot.json');
const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
let runs = 0;
for (const standardize of [false, true]) {
  for (const dimensions of [2, 3]) {
    const features = ['cloud_cover', 'relative_humidity_2m', 'precipitation'].slice(0, dimensions);
    const data = Core.prepare(snapshot.rows, features, standardize);
    assert.equal(data.dropped, 0);
    for (const k of [1, 2, 3, 6]) {
      for (const method of ['random', 'kmeans++', 'random-space']) {
        const centers = Core.initialize(data.points, data.unique, k, 6021, method);
        assert.equal(new Set(centers.map(p => JSON.stringify(p))).size, k);
        assert.deepEqual(centers, Core.initialize(data.points, data.unique, k, 6021, method));
        checkRun(data.points, centers);
        runs++;
      }
    }
    // User-entered positions may lie outside the observed range; scaling must round-trip them.
    const rawManual = dimensions === 3 ? [[0, 0, 0], [100, 100, 15], [50, 50, 1]] : [[0, 0], [100, 100], [50, 50]];
    const fittedManual = rawManual.map(center => data.transform(center));
    fittedManual.forEach((center, k) => data.inverse(center).forEach((value, j) => close(value, rawManual[k][j])));
    checkRun(data.points, fittedManual);
    runs++;
  }
}
console.log(`Passed hand example, ties, empty centers, constant features, duplicate profiles, bounded random starts, raw/manual coordinate conversion, iteration limit, and ${runs} real-weather runs (${snapshot.rows.length} rows).`);
