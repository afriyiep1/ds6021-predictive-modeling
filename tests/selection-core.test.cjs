/* Run with: node tests/selection-core.test.cjs */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Core = require('../docs/kmeans/kmeans.js');
const Selection = require('../docs/kmeans/selection-core.js');

function close(actual, expected, tolerance = 1e-9) {
  assert.ok(Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)), `${actual} != ${expected}`);
}

const six = [1, 2, 10, 11, 20, 21].map(x => [x]);
const labels = [0, 0, 1, 1, 2, 2];
const hand = Selection.silhouette(six, labels);
[17 / 19, 15 / 17, 15 / 17, 17 / 19, 17 / 19, 19 / 21].forEach((score, i) => close(hand.values[i], score));
close(hand.mean, 18157 / 20349);
assert.equal(hand.negativeCount, 0);
close(Selection.silhouette(six, [0, 1, 0, 1, 2, 2]).values[2], -0.5);
assert.equal(Selection.silhouette(six, [0, 0, 0, 0, 0, 0]), null);
assert.equal(Selection.silhouette(six, [0, 1, 2, 3, 4, 5]), null);
assert.equal(Selection.silhouette([[0], [1], [10]], [0, 0, 1]).values[2], 0);
assert.deepEqual(Selection.silhouette([[0], [0], [0], [0]], [0, 0, 1, 1]).values, [0, 0, 0, 0]);
assert.deepEqual(Selection.silhouette([[0], [0], [5], [5]], [0, 0, 1, 1]).values, [1, 1, 1, 1]);
assert.throws(() => Selection.silhouette(six, [0, 0]));
assert.throws(() => Selection.analyze([[NaN]], {}));
assert.throws(() => Selection.analyze(six, { maxK: 0 }));
assert.throws(() => Selection.analyze(six, { seed: -1 }));
assert.throws(() => Selection.silhouette(six, labels, []));

const progresses = [];
const toy = Selection.analyze(six, { maxK: 10, nInit: 3, seed: 6021, onProgress: progress => progresses.push(progress) });
assert.equal(toy.maxK, 6);
assert.equal(toy.results[0].silhouette, null);
assert.equal(toy.results[5].silhouette, null);
assert.equal(progresses.length, 6);
close(toy.results[2].sse, 1.5);
close(toy.results[2].silhouette.mean, hand.mean);
assert.deepEqual(toy, Selection.analyze(six, { maxK: 10, nInit: 3, seed: 6021 }));
assert.equal(toy.results[0].starts, 3);
assert.equal(toy.results[1].starts, 4);

const duplicate = Selection.analyze([[1], [1], [1]], { maxK: 10 });
assert.equal(duplicate.maxK, 1);
assert.equal(duplicate.results[0].sse, 0);
assert.equal(duplicate.results[0].silhouette, null);
assert.equal(Selection.analyze([[1]], { maxK: 10 }).maxK, 1);
const limited = Selection.fit([[1, 1], [1, 2], [3, 1], [6, 2], [7, 1], [8, 2]], [[1, 1], [3, 1]], 1);
assert.equal(limited.limited, true);
assert.equal(limited.converged, false);
assert.deepEqual(limited.labels, Core.assign([[1, 1], [1, 2], [3, 1], [6, 2], [7, 1], [8, 2]], limited.centers));

const snapshot = JSON.parse(fs.readFileSync(path.join(__dirname, '../docs/kmeans/weather-snapshot.json'), 'utf8'));
let comparisons = 0;
const observed = [];
for (const standardize of [false, true]) {
  for (const dimensions of [2, 3]) {
    const features = ['cloud_cover', 'relative_humidity_2m', 'precipitation'].slice(0, dimensions);
    const data = Core.prepare(snapshot.rows, features, standardize);
    const analysis = Selection.analyze(data.points, { maxK: 10, nInit: 10, seed: 6021 });
    assert.equal(analysis.results.length, 10);
    assert.equal(analysis.n, snapshot.rows.length);
    analysis.results.forEach((result, index) => {
      assert.equal(result.k, index + 1);
      assert.equal(result.converged, true);
      assert.equal(result.actualK, result.counts.filter(count => count > 0).length);
      assert.equal(result.counts.reduce((a, b) => a + b, 0), data.points.length);
      assert.deepEqual(result.labels, Core.assign(data.points, result.centers));
      close(result.sse, Core.objective(data.points, result.centers, result.labels));
      if (index) assert.ok(result.sse <= analysis.results[index - 1].sse + 1e-8);
      if (result.silhouette) {
        assert.equal(result.silhouette.values.length, data.points.length);
        assert.ok(result.silhouette.values.every(score => Number.isFinite(score) && score >= -1 && score <= 1));
        close(result.silhouette.mean, result.silhouette.values.reduce((a, b) => a + b, 0) / data.points.length);
      }
    });
    observed.push({ standardize, dimensions, k3SSE: analysis.results[2].sse, k3Silhouette: analysis.results[2].silhouette.mean });
    comparisons++;
  }
}
assert.notEqual(observed[0].k3SSE, observed[2].k3SSE);
assert.notEqual(observed[1].k3SSE, observed[3].k3SSE);
console.log('Passed exact hand/negative silhouettes, singleton/duplicate/all-zero conventions, undefined scores, deterministic multi-start fits, limits, and raw/standardized 2D/3D weather comparisons.');
console.log(JSON.stringify(observed));
console.log(`${comparisons} full comparisons × K=1…10 × ${snapshot.rows.length} observations.`);
