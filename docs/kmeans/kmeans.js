/* Lloyd's algorithm, with one stored frame per assignment or mean update.
   Browser global and CommonJS export keep the teaching implementation testable. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.KMeansCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const distance2 = (a, b) => a.reduce((sum, value, j) => sum + (value - b[j]) ** 2, 0);
  const copy = centers => centers.map(center => center.slice());

  function randomGenerator(seed) {
    let state = Number(seed) >>> 0;
    return function () {
      state += 0x6D2B79F5;
      let value = state;
      value = Math.imul(value ^ value >>> 15, value | 1);
      value ^= value + Math.imul(value ^ value >>> 7, value | 61);
      return ((value ^ value >>> 14) >>> 0) / 4294967296;
    };
  }

  function prepare(rows, features, standardize) {
    if (!Array.isArray(rows) || !rows.length) throw new Error('There are no usable weather hours.');
    const clean = rows.filter(row => features.every(key => Number.isFinite(row[key])));
    if (!clean.length) throw new Error('The selected weather measurements are missing.');
    const original = clean.map(row => features.map(key => row[key]));
    const means = features.map((_, j) => original.reduce((sum, row) => sum + row[j], 0) / original.length);
    const deviations = means.map((mean, j) => Math.sqrt(original.reduce((sum, row) => sum + (row[j] - mean) ** 2, 0) / original.length));
    const scales = deviations.map(value => value > 0 ? value : 1);
    const points = original.map(row => row.map((value, j) => standardize ? (value - means[j]) / scales[j] : value));
    const unique = [];
    const seen = new Set();
    points.forEach((point, i) => {
      const key = JSON.stringify(point);
      if (!seen.has(key)) { unique.push(i); seen.add(key); }
    });
    return { rows: clean, points, original, means, scales, deviations, unique,
      dropped: rows.length - clean.length, constantFeatures: features.filter((_, j) => deviations[j] === 0),
      inverse: center => center.map((value, j) => standardize ? value * scales[j] + means[j] : value),
      transform: center => center.map((value, j) => standardize ? (value - means[j]) / scales[j] : value) };
  }

  function randomCenters(bounds, k, seed) {
    if (!Array.isArray(bounds) || !bounds.length || bounds.some(range => !Array.isArray(range) || range.length !== 2 || !range.every(Number.isFinite) || range[0] > range[1])) throw new Error('Every feature needs finite ordered bounds for random centers.');
    if (!Number.isInteger(k) || k < 1) throw new Error('Choose a positive integer number of centers.');
    if (k > 1 && bounds.every(range => range[0] === range[1])) throw new Error('These feature ranges contain only one distinct position.');
    const random = randomGenerator(seed);
    const centers = [];
    const seen = new Set();
    for (let attempts = 0; centers.length < k && attempts < 1000; attempts++) {
      const center = bounds.map(([low, high]) => low + random() * (high - low));
      const key = JSON.stringify(center);
      if (!seen.has(key)) { centers.push(center); seen.add(key); }
    }
    if (centers.length !== k) throw new Error('The visible feature ranges cannot supply enough distinct centers.');
    return centers;
  }

  function initialize(points, unique, k, seed, method, bounds = null) {
    if (!Number.isInteger(k) || k < 1 || k > unique.length) throw new Error(`Choose K between 1 and ${unique.length} distinct weather profiles.`);
    const random = randomGenerator(seed);
    if (method === 'random') {
      const indices = unique.slice();
      for (let i = indices.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [indices[i], indices[j]] = [indices[j], indices[i]];
      }
      return indices.slice(0, k).map(i => points[i].slice());
    }
    if (method === 'random-space') {
      const ranges = bounds || points[0].map((_, j) => [Math.min(...points.map(point => point[j])), Math.max(...points.map(point => point[j]))]);
      return randomCenters(ranges, k, seed);
    }
    if (method !== 'kmeans++') throw new Error('Choose random profiles, random positions, or KMeans++ initialization.');
    // Standard k-means++ samples observations with probability proportional to D².
    const centers = [points[Math.floor(random() * points.length)].slice()];
    while (centers.length < k) {
      const weights = points.map(point => Math.min(...centers.map(center => distance2(point, center))));
      const total = weights.reduce((sum, value) => sum + value, 0);
      if (!(total > 0)) throw new Error('There are too few distinct profiles for this K.');
      let threshold = random() * total;
      let selected = weights.findIndex(weight => { threshold -= weight; return threshold < 0; });
      if (selected < 0) selected = weights.findLastIndex(weight => weight > 0);
      centers.push(points[selected].slice());
    }
    return centers;
  }

  function assign(points, centers) {
    return points.map(point => {
      let best = 0;
      for (let k = 1; k < centers.length; k++) {
        // Strict comparison assigns an exact distance tie to the lowest cluster index.
        if (distance2(point, centers[k]) < distance2(point, centers[best])) best = k;
      }
      return best;
    });
  }

  function objective(points, centers, labels) {
    return points.reduce((sum, point, i) => sum + distance2(point, centers[labels[i]]), 0);
  }

  function history(points, initialCenters, maxIterations = 100) {
    if (!points.length || !initialCenters.length) throw new Error('Points and initial centers are required.');
    let centers = copy(initialCenters);
    let labels = null;
    const frames = [{ phase: 'initialize', iteration: 0, centers: copy(centers), labels: null,
      counts: Array(centers.length).fill(0), sse: null, changed: null, shift: 0, empty: [], converged: false, limited: false }];
    for (let iteration = 1; iteration <= maxIterations; iteration++) {
      const newLabels = assign(points, centers);
      const changed = labels ? newLabels.reduce((sum, label, i) => sum + (label !== labels[i]), 0) : points.length;
      const counts = Array(centers.length).fill(0);
      newLabels.forEach(label => counts[label]++);
      const converged = labels !== null && changed === 0;
      labels = newLabels;
      frames.push({ phase: 'assign', iteration, centers: copy(centers), labels: labels.slice(), counts,
        sse: objective(points, centers, labels), changed, shift: 0, empty: counts.flatMap((count, k) => count === 0 ? [k] : []), converged, limited: false });
      if (converged) break;
      const next = centers.map(() => Array(points[0].length).fill(0));
      points.forEach((point, i) => point.forEach((value, j) => next[labels[i]][j] += value));
      next.forEach((center, k) => center.forEach((_, j) => { next[k][j] = counts[k] ? next[k][j] / counts[k] : centers[k][j]; }));
      const shift = Math.sqrt(centers.reduce((sum, center, k) => sum + distance2(center, next[k]), 0));
      centers = next;
      frames.push({ phase: 'update', iteration, centers: copy(centers), labels: labels.slice(), counts: counts.slice(),
        sse: objective(points, centers, labels), changed: 0, shift,
        empty: counts.flatMap((count, k) => count === 0 ? [k] : []), converged: false, limited: iteration === maxIterations });
    }
    return frames;
  }
  return { distance2, randomGenerator, prepare, initialize, randomCenters, assign, objective, history };
});
