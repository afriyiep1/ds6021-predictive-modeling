/* Run: node tests/supervised-core.test.cjs
   Independent hand checks and a scikit-learn multinomial reference fixture.
   The reference fixture uses sklearn 1.8.0 LogisticRegression(solver='lbfgs',
   C=1/(12*.07), tol=1e-12, max_iter=2000), not one-vs-rest classifiers. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const S = require('../docs/kmeans/supervised-core.js');

function close(actual, expected, tolerance = 1e-9) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
}
function closeMatrix(a, b, tolerance = 1e-9) {
  assert.equal(a.length, b.length);
  a.forEach((row, i) => { assert.equal(row.length, b[i].length); row.forEach((value, j) => close(value, b[i][j], tolerance)); });
}

// The target is provider-defined, with an explicit whitelist rather than
// assuming every numeric code above a threshold means precipitation.
[0, 1].forEach(code => assert.equal(S.classForWeatherCode(code), 0));
assert.equal(S.classForWeatherCode(2), 1);
assert.equal(S.classForWeatherCode(3), 2);
[45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 97, 99].forEach(code => assert.equal(S.classForWeatherCode(code), 3));
[4, 50, 100, 999, null, undefined, NaN, '0'].forEach(code => assert.equal(S.classForWeatherCode(code), null));

// Hand confusion matrix: predicted rows, actual columns. Class imbalance
// measures use their documented denominators, and probability-zero loss is
// finite only because of explicit numerical clipping.
const truth = [0, 0, 1, 1, 2, 3];
const labels = [0, 1, 1, 2, 2, 0];
const probabilities = labels.map(label => [0, 1, 2, 3].map(c => c === label ? 1 : 0));
const metrics = S.evaluate(truth, probabilities);
assert.deepEqual(metrics.confusion, [[1, 0, 0, 1], [1, 1, 0, 0], [0, 1, 1, 0], [0, 0, 0, 0]]);
close(metrics.accuracy, .5);
close(metrics.error, .5);
close(metrics.balancedAccuracy, .5);
close(metrics.macroF1, 5 / 12);
close(metrics.logLoss, -Math.log(1e-15) / 2, 1e-12);
assert.equal(metrics.clippedTrueProbabilities, 3);
const absentTestClasses = S.evaluate([0, 0], [[1, 0, 0, 0], [1, 0, 0, 0]]);
close(absentTestClasses.balancedAccuracy, 1);
close(absentTestClasses.macroF1, .25);
assert.equal(absentTestClasses.perClass[1].recall, null);
assert.equal(S.evaluate([], []).accuracy, null);
assert.throws(() => S.evaluate([0], [[.5, .5, .5, .5]]));

// Equal-distance ties use training-row order; equal class votes use class ID.
const tied = S.fitKNN([[-1], [1]], [1, 0], { k: 1 });
assert.deepEqual(S.predict(tied, [[0]]), [1]);
const voteTie = S.fitKNN([[-1], [1]], [1, 0], { k: 2 });
closeMatrix(S.predictProba(voteTie, [[0]]), [[.5, .5, 0, 0]]);
assert.deepEqual(S.predict(voteTie, [[0]]), [0]);
const duplicates = S.fitKNN([[0], [0], [1]], [2, 1, 0], { k: 1 });
assert.deepEqual(S.predict(duplicates, [[0]]), [2]);
assert.throws(() => S.fitKNN([[0]], [0], { k: 2 }));

// Probabilities from an independently fitted four-class joint softmax model.
const exampleX = [[0, 0], [0, 1], [1, 0], [1, 1], [-1, 0], [0, -1], [-1, -1], [2, 0], [0, 2], [-2, 1], [1, -2], [2, 2]];
const exampleY = [0, 0, 1, 1, 2, 2, 2, 3, 3, 3, 0, 1];
const softmax = S.fitSoftmax(exampleX, exampleY, { lambda: .07 });
assert.equal(softmax.converged, true);
closeMatrix(S.predictProba(softmax, [[.25, -.25], [1.5, 1.5], [-1, 2]]), [
  [.3720710763820781, .15992553744953103, .26171940396961824, .2062839821987726],
  [.1110032241980967, .6075219818984536, .011559040967664013, .2699157529357857],
  [.10320456918373018, .13349064424858872, .07752237866363429, .6857824079040468]
], 2e-7);
softmax.history.slice(1).forEach((step, i) => assert.ok(step.objective <= softmax.history[i].objective + 1e-12));
close(softmax.intercepts.reduce((sum, value) => sum + value, 0), 0, 1e-12);
assert.ok(softmax.gradientNorm <= softmax.tolerance);
assert.equal(S.fitSoftmax(exampleX, exampleY, { maxIterations: 0 }).converged, false);
assert.throws(() => S.fitSoftmax(exampleX, exampleY, { lambda: 0 }));

// Absent training classes have no learned probabilities; one-class input is
// handled as a constant model, and absent-class test errors remain visible.
const missing = S.fitSoftmax([[-1], [0], [1], [2]], [0, 0, 2, 2]);
assert.equal(missing.converged, true);
S.predictProba(missing, [[0], [10]]).forEach(p => { close(p[1], 0); close(p[3], 0); close(p.reduce((a, b) => a + b, 0), 1); });
const single = S.fitSoftmax([[0], [1], [2]], [2, 2, 2]);
assert.equal(single.converged, true);
assert.deepEqual(S.predictProba(single, [[4]]), [[0, 0, 1, 0]]);
assert.equal(S.evaluate([3], S.predictProba(single, [[4]])).accuracy, 0);

const snapshot = JSON.parse(fs.readFileSync(path.join(__dirname, '../docs/kmeans/weather-snapshot.json'), 'utf8'));
const data = S.prepareData(snapshot.rows);
assert.equal(data.train.rows.length, 1152);
assert.equal(data.test.rows.length, 288);
assert.deepEqual(data.train.support, [738, 45, 320, 49]);
assert.deepEqual(data.test.support, [224, 13, 44, 7]);
assert.deepEqual(data.features, ['cloud_cover', 'relative_humidity_2m']);
assert.equal(data.metadata.trainDays, 48);
assert.equal(data.metadata.testDays, 12);
assert.equal(data.metadata.droppedRows, 0);
assert.ok(data.metadata.trainEnd < data.metadata.testStart);
assert.equal(data.metadata.trainEnd + 3600, data.metadata.testStart);
assert.equal(new Set([...data.train.indices, ...data.test.indices]).size, 1440);
assert.deepEqual(S.prepareData(snapshot.rows).train.indices, data.train.indices);
for (let j = 0; j < 2; j++) {
  close(data.train.X.reduce((sum, row) => sum + row[j], 0) / 1152, 0, 1e-12);
  close(data.train.X.reduce((sum, row) => sum + row[j] ** 2, 0) / 1152, 1, 1e-12);
}
closeMatrix(S.inverseTransform(data.train.X, data.scaler), data.train.rawX, 1e-12);

// Changing every held-out feature by a huge amount cannot alter the fitted
// scaler or any training coordinates: explicit leakage check.
const changedTest = snapshot.rows.map(row => row.time >= data.metadata.testStart ? { ...row, cloud_cover: row.cloud_cover + 1e6, relative_humidity_2m: row.relative_humidity_2m - 1e6 } : row);
const altered = S.prepareData(changedTest);
assert.deepEqual(altered.scaler, data.scaler);
assert.deepEqual(altered.train.X, data.train.X);
const unknown = snapshot.rows.map((row, i) => i === 0 ? { ...row, weather_code: 999 } : row);
const cleaned = S.prepareData(unknown);
assert.equal(cleaned.metadata.omissions.unknownCodeRows, 1);
assert.equal(cleaned.metadata.omissions.incompleteDayRows, 23);
assert.equal(cleaned.metadata.droppedRows, 24);
assert.ok(cleaned.warnings.some(text => text.includes('999')));
const duplicate = S.prepareData([...snapshot.rows, snapshot.rows[0]]);
assert.equal(duplicate.metadata.omissions.duplicateTimeRows, 1);
assert.deepEqual(duplicate.train.X, data.train.X);
assert.throws(() => S.prepareData(snapshot.rows.slice(0, 23)));

// Published-snapshot regression values were independently checked against
// sklearn on this exact split/scaling/regularization. KNN uses the explicit
// earlier-row distance tie rule, independently verified by NumPy lexsort.
const expected = {
  '2-knn': { accuracy: 277 / 288, balancedAccuracy: .6730769230769231, macroF1: .6839120125333447 },
  '2-softmax': { accuracy: 268 / 288, balancedAccuracy: .5, macroF1: .46729880865548257 },
  '3-knn': { accuracy: 279 / 288, balancedAccuracy: .7445054945054945, macroF1: .800003316060981 },
  '3-softmax': { accuracy: 269 / 288, balancedAccuracy: .5357142857142857, macroF1: .5320663823516277 }
};
for (const dimensions of [2, 3]) {
  const prepared = S.prepareData(snapshot.rows, { dimensions });
  for (const kind of ['knn', 'softmax']) {
    const model = kind === 'knn' ? S.fitKNN(prepared.train.X, prepared.train.y, { k: 15 }) : S.fitSoftmax(prepared.train.X, prepared.train.y, { lambda: .01 });
    if (kind === 'softmax') assert.equal(model.converged, true);
    const result = S.evaluate(prepared.test.y, S.predictProba(model, prepared.test.X));
    for (const [metric, value] of Object.entries(expected[`${dimensions}-${kind}`])) close(result[metric], value, 1e-12);
    assert.equal(result.confusion.flat().reduce((a, b) => a + b, 0), 288);
  }
}
console.log('Passed provider-code mapping, hand metrics/orientation, deterministic KNN ties, sklearn joint-softmax fixture, convergence/limits, absent classes, temporal split, no-leakage scaling, unknown/incomplete hours, and all four weather model fits.');
