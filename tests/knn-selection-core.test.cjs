/* Run: node tests/knn-selection-core.test.cjs
   Independent hand cases and equality with the existing classifier for every k. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const S = require('../docs/kmeans/supervised-core.js');
const K = require('../docs/kmeans/knn-selection-core.js');

function close(actual, expected, tolerance = 1e-12) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
}

// Four majority observations and one minority observation: ordinary accuracy
// is 80%, while averaging the two class recalls gives balanced accuracy 50%.
const imbalanced = K.analyze([[0], [1], [2]], [0, 0, 0], [[0], [1], [2], [3], [4]], [0, 0, 0, 0, 1]);
assert.equal(imbalanced.maxK, 3);
assert.deepEqual(imbalanced.testSupport, [4, 1, 0, 0]);
assert.deepEqual(imbalanced.representedClasses, [0, 1]);
imbalanced.results.forEach(result => {
  close(result.accuracy, .8);
  close(result.balancedAccuracy, .5);
  assert.deepEqual(result.recall, [1, 0, null, null]);
  assert.deepEqual(result.correctByClass, [4, 0, 0, 0]);
});
close(imbalanced.baselineBalancedAccuracy, .5);

// Class recall denominators include only classes present in the test split.
// One neighbor uses earlier training row on a distance tie; two neighbors
// use the lowest class ID on a voting tie.
const ties = K.analyze([[-1], [1]], [1, 0], [[0]], [1], { maxK: 99 });
assert.equal(ties.maxK, 2);
close(ties.results[0].balancedAccuracy, 1);
close(ties.results[1].balancedAccuracy, 0);
assert.equal(ties.baselineClass, 0);
close(ties.baselineBalancedAccuracy, 0);
const duplicates = K.analyze([[0], [0], [1]], [2, 1, 0], [[0]], [2]);
assert.deepEqual(duplicates.results.map(result => result.balancedAccuracy), [1, 0, 0]);
const absentTraining = K.analyze([[0], [1]], [0, 0], [[0], [1]], [3, 3]);
absentTraining.results.forEach(result => {
  close(result.balancedAccuracy, 0);
  assert.deepEqual(result.recall, [null, null, null, 0]);
});

// All training observations contribute when k=n_train. Equal class counts
// predict class zero, yielding 1/3 balanced accuracy and 3/5 accuracy here.
const threeClasses = K.analyze([[0], [10], [20]], [0, 1, 2], [[0], [.1], [.2], [10], [20]], [0, 0, 0, 1, 2]);
close(threeClasses.results[0].balancedAccuracy, 1);
close(threeClasses.results[2].balancedAccuracy, 1 / 3);
close(threeClasses.results[2].accuracy, 3 / 5);

const progress = [];
const one = K.analyze([[0]], [2], [[0]], [2], { maxK: 1, onProgress: value => progress.push(value) });
assert.equal(one.results.length, 1);
close(one.results[0].balancedAccuracy, 1);
assert.deepEqual(progress, [{ completed: 0, total: 1 }, { completed: 1, total: 1 }]);
[0, -1, 1.5, NaN, Infinity, '3', true].forEach(maxK => {
  assert.throws(() => K.analyze([[0]], [0], [[0]], [0], { maxK }));
});
assert.throws(() => K.analyze([], [], [[0]], [0]));
assert.throws(() => K.analyze([[0]], [0], [], []));
assert.throws(() => K.analyze([[0]], [0], [[0, 1]], [0]));
assert.throws(() => K.analyze([[NaN]], [0], [[0]], [0]));
assert.throws(() => K.analyze([[0]], [0], [[Infinity]], [0]));
assert.throws(() => K.analyze([[0]], [4], [[0]], [0]));
assert.throws(() => K.analyze([[0]], [0], [[0]], [-1]));
assert.throws(() => K.analyze([[0]], [0], [[0]], [0, 1]));

// Compare with the unchanged classifier for all candidate neighbor counts,
// on the exact train/test split and train-fitted scaling used by the app.
const snapshot = JSON.parse(fs.readFileSync(path.join(__dirname, '../docs/kmeans/weather-snapshot.json'), 'utf8'));
const references = [];
for (const standardize of [false, true]) {
  for (const dimensions of [2, 3]) {
    const data = S.prepareData(snapshot.rows, { dimensions, standardize, testFraction: .2 });
    const result = K.analyze(data.train.X, data.train.y, data.test.X, data.test.y, { maxK: 50 });
    assert.equal(result.trainCount, 1152);
    assert.equal(result.testCount, 288);
    assert.deepEqual(result.testSupport, [224, 13, 44, 7]);
    assert.equal(result.results.length, 50);
    close(result.baselineBalancedAccuracy, .25);
    for (const candidate of result.results) {
      const model = S.fitKNN(data.train.X, data.train.y, { k: candidate.k });
      const expected = S.evaluate(data.test.y, S.predictProba(model, data.test.X));
      close(candidate.balancedAccuracy, expected.balancedAccuracy);
      close(candidate.accuracy, expected.accuracy);
      assert.deepEqual(candidate.recall, expected.perClass.map(item => item.recall));
      assert.deepEqual(candidate.correctByClass, expected.perClass.map(item => item.truePositive));
    }
    const best = result.results.reduce((a, b) => b.balancedAccuracy > a.balancedAccuracy ? b : a);
    references.push({ dimensions, standardize, k15: result.results[14].balancedAccuracy, bestK: best.k, bestBalancedAccuracy: best.balancedAccuracy });
  }
}
console.log('Passed hand balanced-accuracy, exact distance/vote ties, absent classes, k limits, progress, invalid inputs, and all 200 weather comparisons against the existing classifier.');
console.log(JSON.stringify(references));
