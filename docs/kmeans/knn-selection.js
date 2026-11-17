/* Compare neighbor counts on the exact prepared split used by the KNN tab. */
(function () {
  'use strict';
  const scriptURL = document.currentScript && document.currentScript.src || location.href;
  const workerURL = new URL('knn-selection-worker.js?v=20261117c', scriptURL).href;
  const names = { cloud_cover: 'cloud cover', relative_humidity_2m: 'humidity', precipitation: 'precipitation', temperature_2m: 'temperature' };
  const percent = value => Number.isFinite(value) ? `${(100 * value).toFixed(1)}%` : '—';
  const state = { mount: null, active: false, context: null, signature: null, result: null,
    requestedMax: 50, mainK: 15, inspectedK: 15, requestId: 0, worker: null, timer: null,
    busy: false, error: null, renderQueue: Promise.resolve(), renderVersion: 0, listening: false };
  const el = id => state.mount && state.mount.querySelector(`#${id}`);

  function ensureMount() {
    const mount = document.getElementById('knn-k-selection');
    if (!mount) return false;
    if (state.mount === mount) return true;
    stopWorker();
    state.mount = mount;
    mount.innerHTML = `
      <section class="knn-selection" aria-labelledby="knn-selection-heading">
        <div class="knn-selection-heading"><h2 id="knn-selection-heading">Compare the number of neighbors</h2><span>Balanced accuracy versus k</span></div>
        <p class="knn-selection-intro">Compare how well different neighborhood sizes recognize each weather category on the same held-out hours.</p>
        <div class="knn-selection-context" id="knn-curve-context">Waiting for the KNN model…</div>
        <div class="knn-range-controls"><label for="knn-curve-max">Compare k = 1 through<input id="knn-curve-max" type="number" min="1" step="1" value="50" disabled></label><button id="knn-curve-compare" class="button secondary" type="button" disabled>Compare values</button><span id="knn-curve-range-hint">Every integer k is evaluated, including even values.</span></div>
        <p id="knn-curve-status" class="knn-curve-status" role="status" aria-live="polite">The comparison uses the predictors and scaling selected above.</p>
        <div id="knn-curve-error" class="knn-curve-error" role="alert" hidden></div>
        <div id="knn-curve-results" hidden>
          <section class="knn-curve-panel" aria-label="Neighbor-count comparison">
            <div id="knn-curve-plot" class="knn-curve-plot" role="img" aria-label="Held-out balanced accuracy versus the number of nearest neighbors"></div>
            <p class="knn-curve-caption">Higher values mean better average recall across the weather categories present in the test set. Click a point to inspect its k.</p>
          </section>
          <p id="knn-curve-best" class="knn-curve-best"></p>
          <div class="knn-inspect-controls"><label for="knn-curve-inspect">Inspect k<input id="knn-curve-inspect" type="number" min="1" step="1" value="15" disabled></label><button id="knn-curve-use" class="button secondary" type="button" disabled>Use this k in the model</button><p id="knn-curve-selected" aria-live="polite"></p></div>
          <p id="knn-curve-current" class="knn-curve-current"></p>
          <p class="knn-curve-interpretation"><strong>Use this curve for exploration.</strong> Comparing k values on these test hours uses the test set for model selection. Formal tuning needs validation data and a separate final test set.</p>
          <details class="knn-curve-method"><summary>How the comparison is calculated</summary><p>Every k uses the same chronological split as the KNN model above: the earlier 80% of complete UTC days train the model and the latest 20% form the test set. Any standardization is fitted on training hours only. Changing predictors, scaling, or the active data recalculates the curve.</p><p>Each of the k nearest training hours casts one vote. Equal distances use the earlier training row; equal vote counts use the lowest class ID. Balanced accuracy is the mean of the per-category recalls across categories present in the test set. A category present in test but absent from training has recall zero.</p><p>The dashed baseline always predicts the most common training category. The highest score shown is the highest held-out balanced accuracy among the displayed k values; it does not establish an optimal k for new data.</p></details>
        </div>
      </section>`;
    el('knn-curve-compare').addEventListener('click', compareRange);
    el('knn-curve-max').addEventListener('keydown', event => { if (event.key === 'Enter') compareRange(); });
    el('knn-curve-inspect').addEventListener('change', inspectInput);
    el('knn-curve-inspect').addEventListener('keydown', event => { if (event.key === 'Enter') inspectInput(); });
    el('knn-curve-use').addEventListener('click', () => {
      if (!state.result || !selectedResult() || state.busy) return;
      document.dispatchEvent(new CustomEvent('knn-use-k', { detail: { k: state.inspectedK } }));
    });
    if (!state.listening) { window.addEventListener('resize', resize); state.listening = true; }
    return true;
  }

  function stopWorker() {
    if (state.worker) state.worker.terminate();
    state.worker = null;
    if (state.timer !== null) clearTimeout(state.timer);
    state.timer = null;
  }

  function contextText() {
    if (!state.context) return 'Waiting for the KNN model…';
    const prepared = state.context.prepared;
    return `${prepared.features.length}D: ${prepared.features.map(key => names[key] || key).join(' + ')} · ${prepared.scaler.standardize ? 'Standardized using training hours' : 'Raw variables (original units)'} · ${prepared.train.X.length.toLocaleString()} training / ${prepared.test.X.length.toLocaleString()} test hours · ${state.context.sourceMode === 'snapshot' ? 'Saved snapshot' : 'Active weather data'}`;
  }

  function clearError() {
    state.error = null;
    el('knn-curve-error').hidden = true;
    el('knn-curve-max').removeAttribute('aria-invalid');
    el('knn-curve-inspect').removeAttribute('aria-invalid');
  }

  function validationError(message, input) {
    el('knn-curve-error').textContent = message;
    el('knn-curve-error').hidden = false;
    if (input) input.setAttribute('aria-invalid', 'true');
  }

  function showError(message, requestId) {
    if (requestId !== state.requestId || !state.mount) return;
    stopWorker(); state.busy = false; state.error = message; state.result = null;
    state.mount.setAttribute('aria-busy', 'false');
    el('knn-curve-results').hidden = true;
    el('knn-curve-status').textContent = 'The comparison could not be completed. Choose Compare values to try again.';
    validationError(message);
    el('knn-curve-compare').disabled = false;
  }

  function compareRange() {
    if (!state.context) return;
    const input = el('knn-curve-max');
    const text = input.value.trim(), value = Number(text);
    const limit = state.context.prepared.train.X.length;
    if (!text || !Number.isInteger(value) || value < 1 || value > limit) {
      validationError(`Enter a whole-number maximum k from 1 to ${limit.toLocaleString()}, the number of training hours.`, input); return;
    }
    clearError();
    state.requestedMax = value;
    if (state.result && state.result.maxK === value) { updateControls(); render(); return; }
    startComparison();
  }

  function acceptResult(result, requestId) {
    if (requestId !== state.requestId || !state.mount) return;
    stopWorker(); state.busy = false;
    if (!result || !Array.isArray(result.results) || !result.results.length) {
      showError('No neighbor counts could be evaluated for this split.', requestId); return;
    }
    clearError(); state.result = result;
    state.mount.setAttribute('aria-busy', 'false');
    el('knn-curve-compare').disabled = false;
    el('knn-curve-results').hidden = false;
    el('knn-curve-inspect').max = String(result.maxK);
    el('knn-curve-inspect').disabled = false;
    if (!selectedResult()) state.inspectedK = state.mainK <= result.maxK ? state.mainK : 1;
    const represented = result.representedClasses.length;
    const totalClasses = window.WeatherSupervised.CLASS_NAMES.length;
    const missing = represented < totalClasses ? ` Only ${represented} of the ${totalClasses} weather categories occur in test; the score averages those ${represented} recalls.` : '';
    el('knn-curve-status').textContent = `Compared every k from 1 to ${result.maxK} on the same ${result.testCount.toLocaleString()} held-out hours.${missing}`;
    updateControls(); render();
  }

  function startComparison() {
    if (!state.context || !ensureMount()) return;
    stopWorker();
    const requestId = ++state.requestId;
    state.renderVersion++; state.busy = true; state.result = null; clearError();
    const prepared = state.context.prepared;
    const maxK = Math.min(state.requestedMax, prepared.train.X.length);
    el('knn-curve-max').value = String(maxK);
    state.mount.setAttribute('aria-busy', 'true');
    el('knn-curve-results').hidden = true;
    el('knn-curve-inspect').disabled = true;
    el('knn-curve-use').disabled = true;
    el('knn-curve-compare').disabled = true;
    el('knn-curve-status').textContent = `Comparing k = 1–${maxK} on the held-out hours…`;
    const payload = { requestId, trainX: prepared.train.X, trainY: prepared.train.y,
      testX: prepared.test.X, testY: prepared.test.y, options: { maxK } };
    let fallbackStarted = false;
    function progress(value) {
      if (requestId !== state.requestId || !state.mount) return;
      if (value.completed === value.total || value.completed % 24 === 0) {
        el('knn-curve-status').textContent = `Comparing k = 1–${maxK}: ${value.completed} of ${value.total} held-out hours evaluated…`;
      }
    }
    function fallback() {
      if (fallbackStarted || requestId !== state.requestId) return;
      fallbackStarted = true;
      if (state.worker) state.worker.terminate();
      state.worker = null;
      state.timer = setTimeout(() => {
        state.timer = null;
        if (requestId !== state.requestId) return;
        try {
          if (!window.KNNSelection) throw new Error('The comparison code did not load. Reload this page and try again.');
          acceptResult(window.KNNSelection.analyze(payload.trainX, payload.trainY, payload.testX, payload.testY,
            { maxK, onProgress: progress }), requestId);
        } catch (error) { showError(error.message, requestId); }
      }, 30);
    }
    try {
      state.worker = new Worker(workerURL);
      state.worker.onmessage = event => {
        const message = event.data || {};
        if (message.requestId !== requestId || requestId !== state.requestId) return;
        if (message.type === 'progress') progress(message);
        else if (message.type === 'result') acceptResult(message.result, requestId);
        else if (message.type === 'error') showError(message.message || 'The neighbor-count comparison failed.', requestId);
      };
      state.worker.onerror = event => { if (event.preventDefault) event.preventDefault(); fallback(); };
      state.worker.postMessage(payload);
    } catch (_) { fallback(); }
  }

  function update(context) {
    if (!context || !context.prepared || !ensureMount()) return;
    const prepared = context.prepared;
    const signature = JSON.stringify([prepared.features, prepared.scaler.standardize,
      prepared.train.X, prepared.train.y, prepared.test.X, prepared.test.y,
      prepared.train.rows.map(row => row.time), prepared.test.rows.map(row => row.time)]);
    const changed = signature !== state.signature;
    const mainK = Number(context.selectedK);
    const mainChanged = mainK !== state.mainK;
    state.context = context;
    state.mainK = mainK;
    if (changed || mainChanged) state.inspectedK = mainK;
    el('knn-curve-context').textContent = contextText();
    el('knn-curve-max').max = String(prepared.train.X.length);
    el('knn-curve-max').disabled = false;
    el('knn-curve-range-hint').textContent = `Every integer k is evaluated. Maximum allowed: ${prepared.train.X.length.toLocaleString()} training hours.`;
    if (changed) {
      state.signature = signature;
      startComparison();
    } else if (state.result) {
      if (!selectedResult()) state.inspectedK = 1;
      updateControls(); render();
    }
  }

  function selectedResult() {
    return state.result && state.result.results.find(item => item.k === state.inspectedK);
  }

  function inspectInput() {
    if (!state.result) return;
    const input = el('knn-curve-inspect');
    const text = input.value.trim(), k = Number(text);
    if (!text || !Number.isInteger(k) || k < 1 || k > state.result.maxK) {
      validationError(`Inspect a whole-number k from 1 to ${state.result.maxK}. Increase the comparison range to inspect larger values.`, input);
      el('knn-curve-use').disabled = true; return;
    }
    chooseK(k);
  }

  function chooseK(k) {
    if (!state.result || !state.result.results.some(item => item.k === k)) return;
    clearError(); state.inspectedK = k; updateControls(); render();
  }

  function updateControls() {
    if (!state.result) return;
    const selected = selectedResult();
    el('knn-curve-inspect').value = String(state.inspectedK);
    el('knn-curve-use').disabled = !selected || state.mainK === state.inspectedK || state.busy;
    el('knn-curve-use').textContent = state.mainK === state.inspectedK ? `Model uses k = ${state.mainK}` : `Use k = ${state.inspectedK} in the model`;
    el('knn-curve-selected').textContent = selected ? `k = ${selected.k} · Held-out balanced accuracy ${percent(selected.balancedAccuracy)}` : '';
    const current = state.result.results.find(item => item.k === state.mainK);
    el('knn-curve-current').textContent = current
      ? `Current model: k = ${state.mainK} · Held-out balanced accuracy ${percent(current.balancedAccuracy)}. The curve and the model use the same evaluation split.`
      : `The current model uses k = ${state.mainK}, outside the displayed range 1–${state.result.maxK}. Increase the maximum k to include it.`;
    const highest = Math.max(...state.result.results.map(item => item.balancedAccuracy));
    const best = state.result.results.filter(item => Math.abs(item.balancedAccuracy - highest) < 1e-12).map(item => item.k);
    const list = best.slice(0, 12).join(', ') + (best.length > 12 ? `, and ${best.length - 12} other values` : '');
    el('knn-curve-best').textContent = `Highest held-out balanced accuracy among k = 1–${state.result.maxK}: ${percent(highest)} at k = ${list}.${best.length > 1 ? ` ${best.length} k values tie for the highest score.` : ''}`;
  }

  function render() {
    if (!state.active || !state.result || state.busy || !state.mount || typeof Plotly === 'undefined') return;
    const requestId = state.requestId, version = ++state.renderVersion;
    state.renderQueue = state.renderQueue.catch(() => {}).then(async () => {
      if (requestId !== state.requestId || version !== state.renderVersion || !state.active || !state.result) return;
      const result = state.result;
      const traces = [{ type: 'scatter', mode: 'lines+markers', name: 'Held-out balanced accuracy',
        x: result.results.map(item => item.k), y: result.results.map(item => item.balancedAccuracy),
        line: { color: '#232D4B', width: 2 }, marker: { size: result.maxK > 100 ? 3 : 5 },
        hovertemplate: 'k = %{x}<br>Balanced accuracy: %{y:.2%}<extra></extra>' }];
      const current = result.results.find(item => item.k === state.mainK);
      if (current) traces.push({ type: 'scatter', mode: 'markers', name: 'Current model', x: [current.k], y: [current.balancedAccuracy],
        marker: { size: 14, color: '#D96A00', symbol: 'circle-open', line: { width: 2 } },
        hovertemplate: 'Current model: k = %{x}<br>Balanced accuracy: %{y:.2%}<extra></extra>' });
      const inspected = selectedResult();
      if (inspected) traces.push({ type: 'scatter', mode: 'markers', name: 'Inspected k', x: [inspected.k], y: [inspected.balancedAccuracy],
        marker: { size: 8, color: '#D96A00' }, hovertemplate: 'Inspected k = %{x}<br>Balanced accuracy: %{y:.2%}<extra></extra>' });
      if (Number.isFinite(result.baselineBalancedAccuracy)) traces.push({ type: 'scatter', mode: 'lines', name: 'Majority-category baseline',
        x: [.5, Math.max(1.5, result.maxK + .5)], y: [result.baselineBalancedAccuracy, result.baselineBalancedAccuracy],
        line: { color: '#7a8798', width: 1.4, dash: 'dash' },
        hovertemplate: 'Majority-category baseline<br>Balanced accuracy: %{y:.2%}<extra></extra>' });
      const layout = { paper_bgcolor: '#fff', plot_bgcolor: '#fff', margin: { l: 68, r: 25, t: 65, b: 58 },
        font: { family: '-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif', size: 11, color: '#5d687b' },
        hovermode: 'closest', transition: { duration: 0 }, showlegend: true,
        legend: { orientation: 'h', x: 0, y: 1.15, xanchor: 'left', yanchor: 'bottom', font: { size: 10 } },
        xaxis: { title: { text: 'Number of neighbors, k', standoff: 12 }, range: [.5, Math.max(1.5, result.maxK + .5)],
          dtick: result.maxK <= 15 ? 1 : result.maxK <= 60 ? 5 : result.maxK <= 150 ? 10 : undefined,
          gridcolor: '#e9edf2', fixedrange: true },
        yaxis: { title: { text: 'Held-out balanced accuracy', standoff: 10 }, range: [0, 1.02], tickformat: '.0%', dtick: .2,
          gridcolor: '#e9edf2', zerolinecolor: '#c2cbd7', fixedrange: true, automargin: true } };
      const plot = el('knn-curve-plot');
      await Plotly.react(plot, traces, layout, { responsive: true, displaylogo: false, displayModeBar: false });
      if (requestId !== state.requestId || version !== state.renderVersion || !state.active) return;
      if (!plot._knnCurveBound && typeof plot.on === 'function') {
        plot.on('plotly_click', event => {
          const point = event && event.points && event.points[0];
          if (point && point.data && point.data.name !== 'Majority-category baseline' && Number.isInteger(Number(point.x))) chooseK(Number(point.x));
        });
        plot._knnCurveBound = true;
      }
    }).catch(error => { if (requestId === state.requestId) showError(`The comparison plot could not render: ${error.message}`, requestId); });
  }

  function resize() {
    const plot = el('knn-curve-plot');
    if (state.active && plot && plot._fullLayout && plot.getBoundingClientRect().width > 0 && typeof Plotly !== 'undefined') Plotly.Plots.resize(plot);
  }

  function setActive(active) {
    state.active = !!active;
    if (!ensureMount()) return;
    if (state.active) requestAnimationFrame(() => { render(); resize(); });
  }

  function invalidate() {
    stopWorker(); state.requestId++; state.renderVersion++;
    state.context = null; state.signature = null; state.result = null; state.busy = false; state.error = null;
    if (state.mount) {
      state.mount.setAttribute('aria-busy', 'false');
      el('knn-curve-results').hidden = true;
      el('knn-curve-error').hidden = true;
      el('knn-curve-context').textContent = 'Waiting for the updated KNN model…';
      el('knn-curve-max').disabled = true;
      el('knn-curve-compare').disabled = true;
      el('knn-curve-status').textContent = 'Waiting for the updated KNN model…';
    }
  }

  function destroy() {
    invalidate();
    const plot = el('knn-curve-plot');
    if (plot && plot._fullLayout && typeof Plotly !== 'undefined') Plotly.purge(plot);
    if (state.mount) state.mount.innerHTML = '';
    state.mount = null; state.active = false;
    if (state.listening) window.removeEventListener('resize', resize);
    state.listening = false;
  }

  window.KNNDiagnostics = { update, setActive, invalidate, destroy, getState: () => ({
    active: state.active, busy: state.busy, error: state.error, currentK: state.mainK, inspectedK: state.inspectedK,
    maxK: state.result ? state.result.maxK : null, features: state.context ? state.context.prepared.features.slice() : [],
    standardize: state.context ? state.context.prepared.scaler.standardize : null,
    trainCount: state.result ? state.result.trainCount : null, testCount: state.result ? state.result.testCount : null,
    results: state.result ? state.result.results.map(item => ({ k: item.k, balancedAccuracy: item.balancedAccuracy })) : []
  }) };
})();
