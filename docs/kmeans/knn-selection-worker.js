/* Evaluate candidate neighbor counts without blocking the teaching controls. */
'use strict';
importScripts('supervised-core.js?v=20261117c', 'knn-selection-core.js?v=20261117c');
self.onmessage = function (event) {
  const { requestId, trainX, trainY, testX, testY, options } = event.data || {};
  try {
    const result = self.KNNSelection.analyze(trainX, trainY, testX, testY, {
      ...(options || {}),
      onProgress: ({ completed, total }) => self.postMessage({ type: 'progress', requestId, completed, total })
    });
    self.postMessage({ type: 'result', requestId, result });
  } catch (error) {
    self.postMessage({ type: 'error', requestId, message: error.message || 'The neighbor-count comparison could not be completed.' });
  }
};
