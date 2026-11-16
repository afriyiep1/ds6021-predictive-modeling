/* Run the K comparison off the main thread so the teaching controls stay usable. */
'use strict';
importScripts('kmeans.js?v=20261115c', 'selection-core.js?v=20261115c');
self.onmessage = function (event) {
  const { requestId, points, options } = event.data || {};
  try {
    const result = self.KMeansSelection.analyze(points, {
      ...(options || {}),
      onProgress: ({ k, maxK }) => self.postMessage({ type: 'progress', requestId, k, maxK })
    });
    self.postMessage({ type: 'result', requestId, result });
  } catch (error) {
    self.postMessage({ type: 'error', requestId, message: error.message || 'The K comparison could not be completed.' });
  }
};
