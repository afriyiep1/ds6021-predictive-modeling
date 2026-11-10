/* Same-hour weather classification for DS 6021.
   Pure browser/CommonJS implementation; no data access, DOM, or dependencies.
   Target codes: https://open-meteo.com/en/docs#weather_variable_documentation
   Multinomial objective: mean log loss + lambda/2 * sum(all class slopes^2).
   Intercepts are unpenalized. The last active intercept is fixed during fitting
   to identify the model; displayed intercepts are centered afterward. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WeatherSupervised = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const CLASS_NAMES = Object.freeze(['Clear / mainly clear', 'Partly cloudy', 'Overcast', 'Fog / precipitation']);
  const FEATURES_2D = Object.freeze(['cloud_cover', 'relative_humidity_2m']);
  const FEATURES_3D = Object.freeze([...FEATURES_2D, 'precipitation']);
  const WET_CODES = new Set([45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 97, 99]);
  const LOG_LOSS_EPSILON = 1e-15;

  function classForWeatherCode(code) {
    if (!Number.isInteger(code)) return null;
    if (code === 0 || code === 1) return 0;
    if (code === 2) return 1;
    if (code === 3) return 2;
    return WET_CODES.has(code) ? 3 : null;
  }

  function support(y) {
    const counts = [0, 0, 0, 0];
    y.forEach(label => counts[label]++);
    return counts;
  }

  function transform(rawMatrix, scaler) {
    return rawMatrix.map(row => row.map((value, j) => scaler.standardize ? (value - scaler.mean[j]) / scaler.scale[j] : value));
  }

  function inverseTransform(matrix, scaler) {
    return matrix.map(row => row.map((value, j) => scaler.standardize ? value * scaler.scale[j] + scaler.mean[j] : value));
  }

  function prepareData(rows, options = {}) {
    if (!Array.isArray(rows) || !rows.length) throw new Error('There are no weather hours to classify.');
    const dimensions = options.dimensions === undefined ? 2 : Number(options.dimensions);
    if (![2, 3].includes(dimensions)) throw new Error('Choose two or three predictors.');
    const features = [...(dimensions === 2 ? FEATURES_2D : FEATURES_3D)];
    const standardize = options.standardize !== false;
    const testFraction = options.testFraction === undefined ? 0.2 : Number(options.testFraction);
    if (!(testFraction > 0 && testFraction < 1)) throw new Error('The test fraction must be between zero and one.');
    const omissions = { unknownCodeRows: 0, invalidFeatureRows: 0, invalidTimeRows: 0, duplicateTimeRows: 0, incompleteDayRows: 0, incompleteDays: 0 };
    const unknownCodes = new Set();
    const usable = [];
    rows.forEach((row, index) => {
      const label = classForWeatherCode(row.weather_code);
      if (label === null) { omissions.unknownCodeRows++; unknownCodes.add(row.weather_code == null ? 'missing' : String(row.weather_code)); return; }
      if (!features.every(key => Number.isFinite(row[key]))) { omissions.invalidFeatureRows++; return; }
      if (!Number.isInteger(row.time) || row.time % 3600 !== 0) { omissions.invalidTimeRows++; return; }
      usable.push({ row, index, label });
    });
    usable.sort((a, b) => a.row.time - b.row.time || a.index - b.index);
    const seen = new Set();
    const days = new Map();
    usable.forEach(item => {
      if (seen.has(item.row.time)) { omissions.duplicateTimeRows++; return; }
      seen.add(item.row.time);
      const day = Math.floor(item.row.time / 86400);
      if (!days.has(day)) days.set(day, []);
      days.get(day).push(item);
    });
    const completeDays = [...days.keys()].filter(day => {
      const complete = days.get(day).length === 24;
      if (!complete) { omissions.incompleteDays++; omissions.incompleteDayRows += days.get(day).length; }
      return complete;
    }).sort((a, b) => a - b);
    if (completeDays.length < 2) throw new Error('At least two complete UTC days with known weather codes and usable predictors are needed for a chronological train/test split.');
    const nTrainDays = Math.max(1, Math.min(completeDays.length - 1, Math.floor(completeDays.length * (1 - testFraction))));
    const trainItems = completeDays.slice(0, nTrainDays).flatMap(day => days.get(day));
    const testItems = completeDays.slice(nTrainDays).flatMap(day => days.get(day));
    const rawTrain = trainItems.map(item => features.map(key => item.row[key]));
    const mean = features.map((_, j) => rawTrain.reduce((sum, row) => sum + row[j], 0) / rawTrain.length);
    const deviations = mean.map((average, j) => Math.sqrt(rawTrain.reduce((sum, row) => sum + (row[j] - average) ** 2, 0) / rawTrain.length));
    const scaler = { mean, scale: deviations.map(value => value > 0 ? value : 1), standardize, fittedOn: 'training hours only' };
    const makePart = items => {
      const rawX = items.map(item => features.map(key => item.row[key]));
      const y = items.map(item => item.label);
      return { rows: items.map(item => item.row), indices: items.map(item => item.index), rawX, X: transform(rawX, scaler), y, support: support(y) };
    };
    const train = makePart(trainItems), test = makePart(testItems);
    const missingTrainClasses = train.support.flatMap((count, i) => count === 0 ? [i] : []);
    const missingTestClasses = test.support.flatMap((count, i) => count === 0 ? [i] : []);
    const warnings = [];
    if (omissions.unknownCodeRows) warnings.push(`${omissions.unknownCodeRows} hour(s) omitted because the provider code is unknown or missing: ${[...unknownCodes].join(', ')}.`);
    if (omissions.invalidFeatureRows) warnings.push(`${omissions.invalidFeatureRows} hour(s) omitted because selected predictors are missing or nonfinite.`);
    if (omissions.invalidTimeRows) warnings.push(`${omissions.invalidTimeRows} row(s) omitted because timestamps are not exact UTC hours.`);
    if (omissions.duplicateTimeRows) warnings.push(`${omissions.duplicateTimeRows} duplicate timestamp(s) omitted; the first record was retained.`);
    if (omissions.incompleteDays) warnings.push(`${omissions.incompleteDays} incomplete UTC day(s) omitted, removing ${omissions.incompleteDayRows} additional otherwise usable hour(s).`);
    if (missingTrainClasses.length) warnings.push(`Training has no ${missingTrainClasses.map(i => CLASS_NAMES[i]).join(', ')} examples. These classes cannot be learned and receive probability zero.`);
    if (missingTestClasses.length) warnings.push(`Test has no ${missingTestClasses.map(i => CLASS_NAMES[i]).join(', ')} examples. Balanced accuracy averages only classes present in the evaluated split; macro F1 still includes all four classes.`);
    const constantFeatures = features.filter((_, j) => deviations[j] === 0);
    if (constantFeatures.length) warnings.push(`Constant training predictor(s): ${constantFeatures.join(', ')}; their scale is set to one.`);
    return { train, test, scaler, features, classNames: [...CLASS_NAMES], warnings, metadata: {
      split: 'chronological complete UTC days', testFraction, actualTestFraction: test.rows.length / (train.rows.length + test.rows.length),
      totalDays: completeDays.length, trainDays: nTrainDays, testDays: completeDays.length - nTrainDays,
      trainCount: train.rows.length, testCount: test.rows.length,
      trainStart: train.rows[0].time, trainEnd: train.rows.at(-1).time, testStart: test.rows[0].time, testEnd: test.rows.at(-1).time,
      inputRows: rows.length, usedRows: train.rows.length + test.rows.length,
      droppedRows: rows.length - train.rows.length - test.rows.length, omissions, unknownCodes: [...unknownCodes],
      missingTrainClasses, missingTestClasses, constantFeatures,
      target: 'Same-hour provider weather category; not a future-weather forecast.',
      targetSource: 'Open-Meteo WMO weather codes', targetSourceUrl: 'https://open-meteo.com/en/docs'
    } };
  }

  function validateTraining(X, y) {
    if (!Array.isArray(X) || !X.length || !Array.isArray(y) || X.length !== y.length) throw new Error('Aligned nonempty training predictors and labels are required.');
    const p = X[0].length;
    if (!p || !X.every(row => Array.isArray(row) && row.length === p && row.every(Number.isFinite))) throw new Error('Training predictors must be finite and have consistent dimensions.');
    if (!y.every(label => Number.isInteger(label) && label >= 0 && label < CLASS_NAMES.length)) throw new Error('Training labels must be class IDs 0 through 3.');
    return { p, classes: [...new Set(y)].sort((a, b) => a - b) };
  }

  function fitKNN(X, y, options = {}) {
    const { p, classes } = validateTraining(X, y);
    const k = options.k === undefined ? 15 : Number(options.k);
    if (!Number.isInteger(k) || k < 1 || k > X.length) throw new Error(`Choose a neighbor count from 1 to ${X.length}.`);
    return { kind: 'knn', X: X.map(row => row.slice()), y: y.slice(), k, classes, dimensions: p, trainingCount: X.length,
      tieRule: 'Equal distances: earlier training row; equal votes: lowest class ID.',
      trainingMetric: 'Resubstitution: a training query is included among the candidate neighbors.' };
  }

  // Keep only the k best candidates in a max heap. Exact distance ties use the
  // earlier chronological training row, so results do not depend on sort quirks.
  function nearestNeighbors(model, point) {
    const heap = [];
    const worse = (a, b) => a.distance2 > b.distance2 || (a.distance2 === b.distance2 && a.index > b.index);
    for (let i = 0; i < model.X.length; i++) {
      let distance2 = 0;
      for (let j = 0; j < point.length; j++) distance2 += (point[j] - model.X[i][j]) ** 2;
      const candidate = { index: i, distance2, label: model.y[i] };
      if (heap.length < model.k) {
        heap.push(candidate);
        let pos = heap.length - 1;
        while (pos > 0) {
          const parent = Math.floor((pos - 1) / 2);
          if (!worse(heap[pos], heap[parent])) break;
          [heap[pos], heap[parent]] = [heap[parent], heap[pos]]; pos = parent;
        }
      } else if (worse(heap[0], candidate)) {
        heap[0] = candidate;
        let pos = 0;
        while (true) {
          const left = 2 * pos + 1, right = left + 1;
          let next = pos;
          if (left < heap.length && worse(heap[left], heap[next])) next = left;
          if (right < heap.length && worse(heap[right], heap[next])) next = right;
          if (next === pos) break;
          [heap[pos], heap[next]] = [heap[next], heap[pos]]; pos = next;
        }
      }
    }
    return heap.sort((a, b) => a.distance2 - b.distance2 || a.index - b.index);
  }

  function softmax(scores) {
    const largest = Math.max(...scores);
    const exp = scores.map(score => Math.exp(score - largest));
    const total = exp.reduce((sum, value) => sum + value, 0);
    return exp.map(value => value / total);
  }

  // Gaussian elimination with partial pivoting for the small Newton system
  // (at most 15 parameters with four classes and three predictors).
  function solveLinear(A, b) {
    const n = b.length;
    const a = A.map((row, i) => [...row, b[i]]);
    for (let j = 0; j < n; j++) {
      let pivot = j;
      for (let i = j + 1; i < n; i++) if (Math.abs(a[i][j]) > Math.abs(a[pivot][j])) pivot = i;
      if (Math.abs(a[pivot][j]) < 1e-18) return null;
      [a[j], a[pivot]] = [a[pivot], a[j]];
      for (let i = j + 1; i < n; i++) {
        const factor = a[i][j] / a[j][j];
        for (let k = j; k <= n; k++) a[i][k] -= factor * a[j][k];
      }
    }
    const x = Array(n).fill(0);
    for (let i = n - 1; i >= 0; i--) {
      let value = a[i][n];
      for (let j = i + 1; j < n; j++) value -= a[i][j] * x[j];
      x[i] = value / a[i][i];
    }
    return x.every(Number.isFinite) ? x : null;
  }

  function fitSoftmax(X, y, options = {}) {
    const { p, classes } = validateTraining(X, y);
    const lambda = options.lambda === undefined ? 0.01 : Number(options.lambda);
    const tolerance = options.tolerance === undefined ? 1e-8 : Number(options.tolerance);
    const maxIterations = options.maxIterations === undefined ? 100 : Number(options.maxIterations);
    if (!(lambda > 0 && Number.isFinite(lambda))) throw new Error('The L2 strength lambda must be positive.');
    if (!(tolerance > 0 && Number.isFinite(tolerance))) throw new Error('The optimizer tolerance must be positive.');
    if (!Number.isInteger(maxIterations) || maxIterations < 0 || maxIterations > 500) throw new Error('Choose an iteration limit from 0 to 500.');
    const n = X.length, C = classes.length, size = C * p + C - 1;
    const localY = y.map(label => classes.indexOf(label));
    const design = X.map(row => [...row, 1]);
    const descriptors = [];
    for (let c = 0; c < C; c++) for (let j = 0; j < p; j++) descriptors.push({ c, j });
    for (let c = 0; c < C - 1; c++) descriptors.push({ c, j: p });
    let theta = Array(size).fill(0);
    // Begin at the observed training class proportions, with zero slopes.
    const counts = classes.map(label => y.filter(value => value === label).length);
    for (let c = 0; c < C - 1; c++) theta[C * p + c] = Math.log(counts[c] / counts[C - 1]);

    function state(parameters, derivatives) {
      const gradient = derivatives ? Array(size).fill(0) : null;
      const hessian = derivatives ? Array.from({ length: size }, () => Array(size).fill(0)) : null;
      let logLoss = 0, penalty = 0;
      for (let i = 0; i < n; i++) {
        const scores = Array(C).fill(0);
        for (let c = 0; c < C; c++) {
          for (let j = 0; j < p; j++) scores[c] += parameters[c * p + j] * X[i][j];
          if (c < C - 1) scores[c] += parameters[C * p + c];
        }
        const largest = Math.max(...scores);
        const exponentials = scores.map(score => Math.exp(score - largest));
        const total = exponentials.reduce((sum, value) => sum + value, 0);
        const probability = exponentials.map(value => value / total);
        // Log-sum-exp avoids clipping in the fitted objective.
        logLoss += largest + Math.log(total) - scores[localY[i]];
        if (!derivatives) continue;
        for (let a = 0; a < size; a++) {
          const da = descriptors[a], xa = design[i][da.j];
          gradient[a] += (probability[da.c] - (localY[i] === da.c ? 1 : 0)) * xa;
          for (let b = 0; b <= a; b++) {
            const db = descriptors[b];
            hessian[a][b] += probability[da.c] * ((da.c === db.c ? 1 : 0) - probability[db.c]) * xa * design[i][db.j];
          }
        }
      }
      logLoss /= n;
      for (let a = 0; a < size; a++) {
        const slope = a < C * p;
        if (slope) penalty += lambda * parameters[a] ** 2 / 2;
        if (!derivatives) continue;
        gradient[a] = gradient[a] / n + (slope ? lambda * parameters[a] : 0);
        for (let b = 0; b <= a; b++) {
          hessian[a][b] /= n;
          if (a === b && slope) hessian[a][b] += lambda;
          hessian[b][a] = hessian[a][b];
        }
      }
      return { objective: logLoss + penalty, logLoss, penalty, gradient, hessian,
        gradientNorm: derivatives ? Math.max(0, ...gradient.map(Math.abs)) : null };
    }

    let current = state(theta, true), iterations = 0;
    const history = [{ iteration: 0, objective: current.objective, logLoss: current.logLoss, gradientNorm: current.gradientNorm }];
    let converged = current.gradientNorm <= tolerance;
    let reason = converged ? (C === 1 ? 'single training class' : 'gradient tolerance') : 'iteration limit';
    while (!converged && iterations < maxIterations) {
      let direction = null;
      for (const damping of [0, 1e-12, 1e-9, 1e-6]) {
        const h = current.hessian.map((row, i) => row.map((value, j) => value + (i === j ? damping : 0)));
        direction = solveLinear(h, current.gradient);
        if (direction && direction.reduce((sum, value, j) => sum + value * current.gradient[j], 0) > 0) break;
        direction = null;
      }
      if (!direction) { reason = 'Newton system could not be solved'; break; }
      const decrement = direction.reduce((sum, value, j) => sum + value * current.gradient[j], 0);
      let step = 1, candidate = null, accepted = false;
      for (let trial = 0; trial < 40; trial++) {
        candidate = theta.map((value, j) => value - step * direction[j]);
        const next = state(candidate, false);
        if (Number.isFinite(next.objective) && next.objective <= current.objective - 1e-4 * step * decrement + 1e-15) { accepted = true; break; }
        step /= 2;
      }
      if (!accepted) { reason = 'line search could not lower the objective'; break; }
      theta = candidate; iterations++;
      current = state(theta, true);
      history.push({ iteration: iterations, objective: current.objective, logLoss: current.logLoss, gradientNorm: current.gradientNorm, step });
      converged = current.gradientNorm <= tolerance;
      if (converged) reason = 'gradient tolerance';
    }
    const coefficients = Array.from({ length: CLASS_NAMES.length }, () => Array(p).fill(null));
    const intercepts = Array(CLASS_NAMES.length).fill(null);
    const activeIntercepts = classes.map((_, c) => c < C - 1 ? theta[C * p + c] : 0);
    const meanIntercept = activeIntercepts.reduce((sum, value) => sum + value, 0) / C;
    classes.forEach((label, c) => {
      coefficients[label] = theta.slice(c * p, (c + 1) * p);
      intercepts[label] = activeIntercepts[c] - meanIntercept;
    });
    return { kind: 'softmax', coefficients, intercepts, classes, dimensions: p, trainingCount: n,
      lambda, tolerance, maxIterations, iterations, converged, reason, history,
      objective: current.objective, logLoss: current.logLoss, gradientNorm: current.gradientNorm,
      regularization: 'mean multinomial log loss + lambda/2 * sum of squared slopes; intercepts unpenalized',
      sklearnEquivalentC: 1 / (lambda * n) };
  }

  function predictProba(model, X) {
    if (!Array.isArray(X) || !X.every(row => Array.isArray(row) && row.length === model.dimensions && row.every(Number.isFinite))) throw new Error('Prediction rows must contain finite values in the fitted feature coordinates.');
    return X.map(point => {
      const probabilities = [0, 0, 0, 0];
      if (model.kind === 'knn') {
        nearestNeighbors(model, point).forEach(neighbor => probabilities[neighbor.label] += 1 / model.k);
      } else if (model.kind === 'softmax') {
        const scores = model.classes.map(label => model.intercepts[label] + model.coefficients[label].reduce((sum, beta, j) => sum + beta * point[j], 0));
        const active = softmax(scores);
        model.classes.forEach((label, j) => probabilities[label] = active[j]);
      } else throw new Error('Unknown model kind.');
      return probabilities;
    });
  }

  function predict(model, X) { return predictProba(model, X).map(argmax); }

  function argmax(values) {
    let best = 0;
    for (let i = 1; i < values.length; i++) if (values[i] > values[best]) best = i;
    return best;
  }

  function evaluate(y, probabilities) {
    if (!Array.isArray(y) || !Array.isArray(probabilities) || y.length !== probabilities.length) throw new Error('Evaluation labels and probability rows must align.');
    if (!y.every(label => Number.isInteger(label) && label >= 0 && label < CLASS_NAMES.length)) throw new Error('Evaluation labels must be class IDs 0 through 3.');
    if (!probabilities.every(row => Array.isArray(row) && row.length === CLASS_NAMES.length && row.every(value => Number.isFinite(value) && value >= 0 && value <= 1 + 1e-12) && Math.abs(row.reduce((sum, value) => sum + value, 0) - 1) < 1e-8)) throw new Error('Each evaluation probability row must contain four nonnegative probabilities summing to one.');
    const predictions = probabilities.map(argmax);
    const confusion = Array.from({ length: CLASS_NAMES.length }, () => Array(CLASS_NAMES.length).fill(0));
    let correct = 0, loss = 0, clippedTrueProbabilities = 0;
    y.forEach((actual, i) => {
      confusion[predictions[i]][actual]++;
      if (predictions[i] === actual) correct++;
      if (probabilities[i][actual] < LOG_LOSS_EPSILON) clippedTrueProbabilities++;
      const clipped = probabilities[i].map(value => Math.min(1 - LOG_LOSS_EPSILON, Math.max(LOG_LOSS_EPSILON, value)));
      const total = clipped.reduce((sum, value) => sum + value, 0);
      loss -= Math.log(clipped[actual] / total);
    });
    const actualSupport = support(y), predictedSupport = support(predictions);
    const perClass = CLASS_NAMES.map((name, c) => {
      const tp = confusion[c][c];
      const precision = predictedSupport[c] ? tp / predictedSupport[c] : null;
      const recall = actualSupport[c] ? tp / actualSupport[c] : null;
      const denominator = actualSupport[c] + predictedSupport[c];
      return { classId: c, name, actualSupport: actualSupport[c], predictedSupport: predictedSupport[c], truePositive: tp, precision, recall, f1: denominator ? 2 * tp / denominator : 0 };
    });
    const represented = perClass.filter(item => item.actualSupport > 0);
    const n = y.length;
    const accuracy = n ? correct / n : null;
    return { n, correct, errors: n - correct, accuracy, error: n ? 1 - accuracy : null, errorRate: n ? 1 - accuracy : null,
      balancedAccuracy: represented.length ? represented.reduce((sum, item) => sum + item.recall, 0) / represented.length : null,
      macroF1: n ? perClass.reduce((sum, item) => sum + item.f1, 0) / CLASS_NAMES.length : null,
      logLoss: n ? loss / n : null, predictions, confusion, perClass, support: actualSupport, predictedSupport,
      representedClasses: represented.map(item => item.classId), macroF1ClassCount: CLASS_NAMES.length,
      confusionOrientation: 'predicted rows, actual columns', logLossEpsilon: LOG_LOSS_EPSILON, clippedTrueProbabilities,
      balancedAccuracyConvention: 'Mean recall across actual classes present in this split.',
      macroF1Convention: 'Mean F1 across all four target classes; undefined class F1 is zero.' };
  }

  return { CLASS_NAMES, FEATURES_2D, FEATURES_3D, LOG_LOSS_EPSILON, classForWeatherCode, prepareData,
    transform, inverseTransform, fitKNN, nearestNeighbors, fitSoftmax, predictProba, predict, evaluate, argmax };
});
