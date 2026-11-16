/* Compare neighbor counts on one fixed, already prepared train/test split.
   Reusing each test hour's ordered neighbors preserves the main KNN tie rules. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./supervised-core.js'));
  else root.KNNSelection = factory(root.WeatherSupervised);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Core) {
  'use strict';

  function validatePart(X, y, name, dimensions) {
    if (!Array.isArray(X) || !X.length || !Array.isArray(y) || X.length !== y.length) {
      throw new Error(`Aligned, nonempty ${name} predictors and labels are required.`);
    }
    const p = dimensions === undefined && Array.isArray(X[0]) ? X[0].length : dimensions;
    if (!p || !X.every(row => Array.isArray(row) && row.length === p && row.every(Number.isFinite))) {
      throw new Error(`${name[0].toUpperCase() + name.slice(1)} predictors must have consistent finite coordinates.`);
    }
    if (!y.every(label => Number.isInteger(label) && label >= 0 && label < 4)) {
      throw new Error(`${name[0].toUpperCase() + name.slice(1)} labels must be class IDs 0 through 3.`);
    }
    return p;
  }

  function support(y) {
    const counts = [0, 0, 0, 0];
    y.forEach(label => counts[label]++);
    return counts;
  }

  function analyze(trainX, trainY, testX, testY, options = {}) {
    if (!Core) throw new Error('The KNN numerical core has not loaded.');
    const dimensions = validatePart(trainX, trainY, 'training');
    validatePart(testX, testY, 'test', dimensions);
    if (!options || typeof options !== 'object') throw new Error('Supply comparison options as an object.');
    const requestedMaxK = options.maxK === undefined ? 50 : options.maxK;
    if (!Number.isSafeInteger(requestedMaxK) || requestedMaxK < 1) {
      throw new Error('The maximum neighbor count must be a positive integer.');
    }
    const maxK = Math.min(requestedMaxK, trainX.length);
    const testSupport = support(testY);
    const representedClasses = testSupport.flatMap((count, label) => count > 0 ? [label] : []);
    const correctByK = Array.from({ length: maxK }, () => [0, 0, 0, 0]);
    const model = Core.fitKNN(trainX, trainY, { k: maxK });
    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
    if (onProgress) onProgress({ completed: 0, total: testX.length });

    for (let i = 0; i < testX.length; i++) {
      const neighbors = Core.nearestNeighbors(model, testX[i]);
      const votes = [0, 0, 0, 0];
      for (let j = 0; j < maxK; j++) {
        if (!Number.isFinite(neighbors[j].distance2)) throw new Error('The feature values are too large to calculate finite neighbor distances.');
        votes[neighbors[j].label]++;
        // Uniform vote probabilities and integer vote counts have the same
        // maximum; Core.argmax retains the lowest class ID on exact ties.
        if (Core.argmax(votes) === testY[i]) correctByK[j][testY[i]]++;
      }
      if (onProgress && ((i + 1) % 16 === 0 || i === testX.length - 1)) {
        onProgress({ completed: i + 1, total: testX.length });
      }
    }

    const results = correctByK.map((correctByClass, index) => {
      const recall = testSupport.map((count, label) => count ? correctByClass[label] / count : null);
      return { k: index + 1,
        balancedAccuracy: representedClasses.reduce((sum, label) => sum + recall[label], 0) / representedClasses.length,
        accuracy: correctByClass.reduce((sum, count) => sum + count, 0) / testX.length,
        recall, correctByClass };
    });
    const baselineClass = Core.argmax(support(trainY));
    return { results, maxK, trainCount: trainX.length, testCount: testX.length, testSupport,
      representedClasses, baselineClass,
      baselineBalancedAccuracy: testSupport[baselineClass] ? 1 / representedClasses.length : 0 };
  }

  return { analyze };
});
