/* Reproducible multi-start KMeans fits and exact Euclidean silhouette scores.
   These comparisons use the already prepared coordinates supplied by the app. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./kmeans.js'));
  else root.KMeansSelection = factory(root.KMeansCore);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Core) {
  'use strict';

  function validatePoints(points) {
    if (!Array.isArray(points) || !points.length || !Array.isArray(points[0]) || !points[0].length) {
      throw new Error('Provide at least one observation with numeric feature coordinates.');
    }
    const dimensions = points[0].length;
    if (points.some(point => !Array.isArray(point) || point.length !== dimensions || !point.every(Number.isFinite))) {
      throw new Error('Every observation must have the same number of finite coordinates.');
    }
    return dimensions;
  }

  function positiveInteger(value, name, maximum) {
    if (!Number.isInteger(value) || value < 1 || value > maximum) {
      throw new Error(`${name} must be an integer between 1 and ${maximum}.`);
    }
    return value;
  }

  function distance2(a, b) {
    let total = 0;
    for (let j = 0; j < a.length; j++) total += (a[j] - b[j]) ** 2;
    return total;
  }

  function assign(points, centers) {
    return points.map(point => {
      let label = 0;
      let nearest = distance2(point, centers[0]);
      for (let k = 1; k < centers.length; k++) {
        const candidate = distance2(point, centers[k]);
        if (candidate < nearest) { label = k; nearest = candidate; }
      }
      return label;
    });
  }

  // Fit without retaining animation frames; the comparison may need over 100 fits.
  function fit(points, initialCenters, maxIterations = 300) {
    const dimensions = validatePoints(points);
    positiveInteger(maxIterations, 'Maximum iterations', 10000);
    if (!Array.isArray(initialCenters) || !initialCenters.length || initialCenters.some(center =>
      !Array.isArray(center) || center.length !== dimensions || !center.every(Number.isFinite))) {
      throw new Error('Starting centers must have the same finite coordinates as the observations.');
    }
    let centers = initialCenters.map(center => center.slice());
    let labels = assign(points, centers);
    let converged = false;
    let iterations = 0;
    for (let iteration = 0; iteration < maxIterations; iteration++) {
      const counts = Array(centers.length).fill(0);
      const sums = centers.map(() => Array(dimensions).fill(0));
      for (let i = 0; i < points.length; i++) {
        counts[labels[i]]++;
        for (let j = 0; j < dimensions; j++) sums[labels[i]][j] += points[i][j];
      }
      centers = sums.map((sum, k) => counts[k] ? sum.map(value => value / counts[k]) : centers[k].slice());
      const nextLabels = assign(points, centers);
      iterations = iteration + 1;
      converged = nextLabels.every((label, i) => label === labels[i]);
      labels = nextLabels;
      if (converged) break;
    }
    const counts = Array(centers.length).fill(0);
    let sse = 0;
    for (let i = 0; i < points.length; i++) {
      counts[labels[i]]++;
      sse += distance2(points[i], centers[labels[i]]);
    }
    if (!Number.isFinite(sse)) throw new Error('The feature values are too large to calculate a finite WCSSE.');
    const empty = counts.flatMap((count, k) => count === 0 ? [k] : []);
    return { k: centers.length, centers, labels, counts, sse, converged, iterations,
      actualK: centers.length - empty.length, empty, limited: !converged };
  }

  function pairwiseDistances(points) {
    validatePoints(points);
    const n = points.length;
    const distances = new Float64Array(n * n);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const value = Math.sqrt(distance2(points[i], points[j]));
        if (!Number.isFinite(value)) throw new Error('The feature values are too large to calculate finite distances.');
        distances[i * n + j] = value;
        distances[j * n + i] = value;
      }
    }
    return distances;
  }

  function silhouette(points, labels, distanceMatrix) {
    validatePoints(points);
    const n = points.length;
    if ((!Array.isArray(labels) && !ArrayBuffer.isView(labels)) || labels.length !== n ||
        Array.from(labels).some(label => !Number.isInteger(label) || label < 0 || label >= n)) {
      throw new Error('Supply one integer cluster label from 0 to n − 1 for each observation.');
    }
    const clusterLabels = Array.from(new Set(labels)).sort((a, b) => a - b);
    if (clusterLabels.length < 2 || clusterLabels.length >= n) return null;
    const compact = new Map(clusterLabels.map((label, i) => [label, i]));
    const group = Array.from(labels, label => compact.get(label));
    const counts = Array(clusterLabels.length).fill(0);
    group.forEach(label => counts[label]++);
    const distances = distanceMatrix === undefined ? pairwiseDistances(points) : distanceMatrix;
    if ((!Array.isArray(distances) && !ArrayBuffer.isView(distances)) || distances.length !== n * n) {
      throw new Error('The pairwise distance matrix must contain n × n distances.');
    }
    const values = Array(n).fill(0);
    const clusterTotals = Array(clusterLabels.length).fill(0);
    let total = 0;
    let negativeCount = 0;
    for (let i = 0; i < n; i++) {
      const own = group[i];
      // A singleton has silhouette zero by convention, not one.
      if (counts[own] === 1) continue;
      const sums = Array(clusterLabels.length).fill(0);
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const value = distances[i * n + j];
        if (!Number.isFinite(value) || value < 0) throw new Error('Pairwise distances must be finite and nonnegative.');
        sums[group[j]] += value;
      }
      const a = sums[own] / (counts[own] - 1);
      let b = Infinity;
      for (let k = 0; k < counts.length; k++) if (k !== own) b = Math.min(b, sums[k] / counts[k]);
      const scale = Math.max(a, b);
      const value = scale === 0 ? 0 : (b - a) / scale;
      values[i] = value;
      total += value;
      clusterTotals[own] += value;
      if (value < 0) negativeCount++;
    }
    const clusterMeans = Array(clusterLabels[clusterLabels.length - 1] + 1).fill(null);
    clusterLabels.forEach((label, k) => { clusterMeans[label] = clusterTotals[k] / counts[k]; });
    return { values, mean: total / n, clusterMeans, negativeCount, clusterLabels };
  }

  function analyze(points, options = {}) {
    validatePoints(points);
    if (!Core) throw new Error('The KMeans numerical core has not loaded.');
    const requestedK = positiveInteger(options.maxK === undefined ? 10 : options.maxK, 'Maximum K', 100);
    const nInit = positiveInteger(options.nInit === undefined ? 10 : options.nInit, 'Number of starts', 100);
    const maxIterations = positiveInteger(options.maxIterations === undefined ? 300 : options.maxIterations, 'Maximum iterations', 10000);
    const seed = options.seed === undefined ? 6021 : options.seed;
    if (!Number.isInteger(seed) || seed < 0 || seed > 4294967295) throw new Error('The seed must be an integer from 0 to 4294967295.');
    const unique = [];
    const seen = new Set();
    points.forEach((point, i) => {
      const key = JSON.stringify(point);
      if (!seen.has(key)) { seen.add(key); unique.push(i); }
    });
    const maxK = Math.min(requestedK, unique.length);
    const distances = maxK >= 2 && points.length > 2 ? pairwiseDistances(points) : null;
    const results = [];
    for (let k = 1; k <= maxK; k++) {
      let best = null;
      let starts = 0;
      const consider = centers => {
        const result = fit(points, centers, maxIterations);
        starts++;
        if (!best || result.sse < best.sse || (result.sse === best.sse && result.converged && !best.converged)) best = result;
      };
      for (let start = 0; start < nInit; start++) {
        // Each K/start pair gets a fixed, reproducible stream independent of timing.
        const startSeed = (seed ^ Math.imul(k, 0x9E3779B1) ^ Math.imul(start + 1, 0x85EBCA77)) >>> 0;
        consider(Core.initialize(points, unique, k, startSeed, 'kmeans++'));
      }
      if (k > 1) {
        const previous = results[results.length - 1];
        let farthest = 0;
        let largestDistance = -1;
        for (let i = 0; i < points.length; i++) {
          let nearest = Infinity;
          for (const center of previous.centers) nearest = Math.min(nearest, distance2(points[i], center));
          if (nearest > largestDistance) { farthest = i; largestDistance = nearest; }
        }
        // Reusing all previous centers plus one observation gives a feasible
        // refinement. Its genuine fitted SSE makes the elbow non-increasing;
        // no plotted values are clipped or otherwise modified.
        consider(previous.centers.concat([points[farthest]]));
      }
      best.starts = starts;
      best.silhouette = silhouette(points, best.labels, distances === null ? undefined : distances);
      results.push(best);
      if (typeof options.onProgress === 'function') options.onProgress({ k, maxK });
    }
    return { results, n: points.length, maxK, nInit };
  }

  return { analyze, fit, silhouette, pairwiseDistances };
});
