/* Supervised weather views. The numerical models live in supervised-core.js.
   This file mounts into a supplied panel and never changes the shared dataset. */
(function () {
  'use strict';

  const COLORS = ['#D09A24', '#477AA8', '#8565A3', '#258779'];
  const SHORT_NAMES = ['Clear / mainly clear', 'Partly cloudy', 'Overcast', 'Fog / precip.'];
  const FEATURE_NAMES = { cloud_cover: 'Cloud cover', relative_humidity_2m: 'Humidity', precipitation: 'Precipitation' };
  const FEATURE_UNITS = { cloud_cover: '%', relative_humidity_2m: '%', precipitation: 'mm' };
  const instances = new Map();
  const escapeHTML = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const number = (value, digits = 2) => Number.isFinite(value) ? value.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits }) : '—';
  const percent = value => Number.isFinite(value) ? number(100 * value, 1) + '%' : '—';
  const dateUTC = seconds => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(seconds * 1000));
  const dateLocal = seconds => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York', timeZoneName: 'short' }).format(new Date(seconds * 1000));
  const nextPaint = () => new Promise(resolve => setTimeout(resolve, 25));
  const rgba = (hex, alpha) => {
    const code = hex.replace('#', '');
    return `rgba(${parseInt(code.slice(0, 2), 16)},${parseInt(code.slice(2, 4), 16)},${parseInt(code.slice(4, 6), 16)},${alpha})`;
  };

  function template(mode) {
    const knn = mode === 'knn';
    return `
      <section class="sl-intro" aria-labelledby="${mode}-heading">
        <div class="eyebrow">SUPERVISED LEARNING · SAME WEATHER HOURS</div>
        <h2 id="${mode}-heading">${knn ? 'Classify an hour from its neighbors' : 'Classify an hour with multinomial logistic regression'}</h2>
        <p>Learn the provider’s weather category from cloud cover and humidity${knn ? ', using nearby training hours' : ', using one score for each category'}. Add precipitation to fit in three dimensions. The target comes from the same hour’s weather code; this is classification of current conditions, not a forecast of future weather.</p>
        <div class="sl-targets" aria-label="Four target categories">${SHORT_NAMES.map((name, i) => `<span><i style="background:${COLORS[i]}"></i>${name}</span>`).join('')}</div>
      </section>

      <section class="sl-setup" aria-label="${knn ? 'KNN' : 'Multinomial logit'} settings">
        <div class="sl-settings">
          <label class="sl-setting sl-wide">Predictors<select data-role="dimensions"><option value="2">2D · cloud cover + humidity</option><option value="3">3D · add precipitation</option></select></label>
          ${knn ? '<label class="sl-setting">Neighbors, k<input data-role="k" type="number" min="1" max="1152" step="1" value="15"><small>Every neighbor has one vote</small></label>' : '<label class="sl-setting">L2 regularization<select data-role="lambda"><option value="0.0001">Very weak · λ = 0.0001</option><option value="0.001">Weak · λ = 0.001</option><option value="0.01" selected>Moderate · λ = 0.01</option><option value="0.1">Strong · λ = 0.1</option><option value="1">Very strong · λ = 1</option></select><small>Larger λ shrinks slopes more</small></label>'}
          <label class="sl-check"><input data-role="standardize" type="checkbox" checked><span>Standardize features<small>Using training hours only</small></span></label>
          <button data-role="fit" class="button primary">Fit &amp; evaluate</button>
        </div>
        <p class="sl-status" data-role="status" role="status">Choose this tab to fit the model.</p>
        <div data-role="warning" class="sl-warning" role="status" hidden></div>
      </section>

      <section data-role="results" class="sl-results" hidden>
        <div class="sl-split" data-role="split"></div>
        <div class="sl-workspace">
          <div class="sl-main-column">
            <section class="sl-plot-panel" aria-labelledby="${mode}-plot-heading">
              <div class="sl-plot-heading"><h3 id="${mode}-plot-heading">Held-out weather hours</h3><span data-role="plot-units"></span></div>
              <div class="sl-view-controls">
                <label>Color points by<select data-role="color-by"><option value="actual">Actual provider category</option><option value="predicted">Predicted category</option></select></label>
                <label class="sl-inline-check"><input data-role="training" type="checkbox">Show training hours</label>
                ${knn ? '<label class="sl-inline-check"><input data-role="neighbors" type="checkbox" checked>Selected hour’s neighbors</label>' : ''}
              </div>
              <div class="sl-rotation" data-role="rotation" hidden>
                <p><strong>3D projection</strong> · All three features are fitted. Rotate the view to inspect overlap.</p>
                <label>Azimuth <output data-role="azimuth-label">40°</output><input data-role="azimuth" type="range" min="0" max="360" step="1" value="40" aria-label="3D view azimuth"></label>
                <label>Elevation <output data-role="elevation-label">24°</output><input data-role="elevation" type="range" min="-75" max="75" step="1" value="24" aria-label="3D view elevation"></label>
              </div>
              <div data-role="scatter" class="sl-scatter" role="img" aria-label="Test weather hours, classifier predictions, and incorrect classifications"></div>
              <div class="sl-plot-key"><span><i class="sl-ring"></i>Incorrect test prediction</span><span><i class="sl-diamond"></i>Selected test hour</span>${knn ? '<span><i class="sl-triangle"></i>Its training neighbors</span>' : ''}</div>
              <p data-role="plot-note" class="sl-plot-note"></p>
            </section>

            <section class="sl-inspect" aria-labelledby="${mode}-inspect-heading">
              <div class="sl-inspect-heading"><h3 id="${mode}-inspect-heading">Why this prediction?</h3><span>Click a test point to inspect it</span></div>
              <div data-role="selection"></div>
            </section>
          </div>

          <aside class="sl-metrics" aria-label="Held-out test performance">
            <div class="sl-error-card"><div class="eyebrow">TEST HOURS ONLY</div><h3>Classification error</h3><strong data-role="error">—</strong><p data-role="error-count"></p></div>
            <div class="sl-metric-grid">
              <div title="Fraction of held-out hours assigned the correct provider category."><span>Accuracy</span><strong data-role="accuracy">—</strong></div>
              <div title="Mean recall across the actual categories present in the test set. Each represented category receives equal weight."><span>Balanced accuracy</span><strong data-role="balanced">—</strong></div>
              <div title="Mean F1 across all four categories, with equal category weights; undefined class F1 is zero."><span>Macro F1</span><strong data-role="f1">—</strong></div>
              <div title="Average negative log probability assigned to the actual category. Lower is better; confident wrong predictions cost more."><span>Log loss ↓</span><strong data-role="logloss">—</strong></div>
            </div>
            <section class="sl-compare"><h3>Training versus test</h3><div data-role="comparison"></div><p data-role="training-note"></p></section>
            <section class="sl-baseline"><h3>A majority-category baseline</h3><p data-role="baseline"></p></section>
            <section class="sl-confusion"><h3>Test confusion matrix</h3><p>Actual categories in columns · predictions in rows</p><div class="sl-table-scroll" data-role="confusion"></div></section>
          </aside>
        </div>

        <section class="sl-understand">
          <div><h3>${knn ? 'What changes when k changes?' : 'What does the fitted model learn?'}</h3><p>${knn ? 'A small neighborhood can follow very local patterns. A larger neighborhood averages over more training hours and can smooth away small categories. Compare error rates and the shape of the decision regions, then inspect the minority categories.' : 'Each category gets a linear score. Softmax turns the four scores into probabilities that sum to one; the largest probability determines the prediction. L2 regularization discourages large slopes. The decision regions compare these class scores.'}</p></div>
          <div><h3>What do the labels mean?</h3><p>The four targets combine the provider’s WMO codes: 0–1 clear/mainly clear, 2 partly cloudy, 3 overcast, and supported fog or precipitation codes. They are supplied labels, not KMeans cluster numbers. They are model-based weather categories, not independent station observations.</p></div>
        </section>
        <details class="sl-methods"><summary>Evaluation, ${knn ? 'neighbor rules' : 'coefficients'}, and interpretation details</summary><div data-role="method-detail"></div><p>Both classifier tabs use the same complete UTC days: the earlier 80% train the model and the most recent 20% form the test set. Scaling is fitted on training hours only. Adjacent hours can be related, so this is a temporal holdout rather than a random split of individual hours.</p><p>These variables and the weather-code target describe the same hour and may share definitions. High classification accuracy does not establish future forecasting skill.</p><p>Changing settings after examining these test metrics is exploratory. Formal model tuning needs validation data and a separate final test set.</p><p>Balanced accuracy averages recall over categories present in the evaluated split. Macro F1 averages all four categories, using zero for undefined class F1. Log loss uses natural logarithms and clips probabilities at 10<sup>−15</sup> for numerical evaluation.</p><p>Weather definitions: <a href="https://open-meteo.com/en/docs" target="_blank" rel="noopener">Open-Meteo documentation ↗</a>.</p></details>
      </section>`;
  }

  function mount({ mode, container }) {
    if (!['knn', 'logit'].includes(mode) || !(container instanceof HTMLElement)) throw new Error('Mount a KNN or logit view into an HTML container.');
    if (instances.has(mode)) return instances.get(mode).api;
    const state = { mode, container, active: !container.hidden && !container.closest('[hidden]'), data: null, sourceMode: 'snapshot', dirty: true, result: null, token: 0, selected: 0, renderQueue: Promise.resolve(), boundPlot: false };
    container.classList.add('supervised-lab');
    container.innerHTML = template(mode);
    state.el = role => container.querySelector(`[data-role="${role}"]`);

    ['dimensions', 'standardize', mode === 'knn' ? 'k' : 'lambda'].forEach(role => state.el(role).addEventListener('change', () => {
      state.dirty = true;
      if (state.active) fit(state);
    }));
    state.el('fit').addEventListener('click', () => fit(state));
    ['color-by', 'training', ...(mode === 'knn' ? ['neighbors'] : [])].forEach(role => state.el(role).addEventListener('change', () => renderScatter(state)));
    ['azimuth', 'elevation'].forEach(role => state.el(role).addEventListener('input', () => {
      state.el(role + '-label').textContent = state.el(role).value + '°';
      renderScatter(state);
    }));

    const onData = event => {
      state.data = event.detail && event.detail.dataset ? event.detail.dataset : getDataset();
      state.sourceMode = event.detail && event.detail.sourceMode ? event.detail.sourceMode : 'snapshot';
      state.dirty = true;
      state.token++;
      if (state.active) fit(state);
    };
    const onTab = event => {
      state.active = Boolean(event.detail && event.detail.mode === mode);
      if (!state.active) return;
      const latest = getDataset();
      // getDataset() deliberately returns a defensive clone. Reopening a tab
      // should preserve its fit and selected hour; every data-change event
      // above still invalidates unconditionally, including provider revisions.
      if (latest && datasetKey(latest) !== datasetKey(state.data)) { state.data = latest; state.dirty = true; }
      if (state.dirty || !state.result) fit(state);
      else { renderScatter(state); setTimeout(() => window.Plotly && Plotly.Plots.resize(state.el('scatter')), 30); }
    };
    document.addEventListener('weather-data-changed', onData);
    document.addEventListener('learning-tab-changed', onTab);
    const onResize = () => { if (state.active && state.result && window.Plotly) Plotly.Plots.resize(state.el('scatter')); };
    window.addEventListener('resize', onResize);

    state.api = {
      refresh: () => { state.dirty = true; return fit(state); },
      getState: () => ({ mode, active: state.active, dimensions: Number(state.el('dimensions').value), standardize: state.el('standardize').checked,
        selected: state.selected, fitted: Boolean(state.result), settings: state.result ? { k: state.result.model.k, lambda: state.result.model.lambda } : null,
        test: state.result ? state.result.testMetrics : null, train: state.result ? state.result.trainMetrics : null,
        split: state.result ? state.result.prepared.metadata : null }),
      destroy: () => { state.token++; document.removeEventListener('weather-data-changed', onData); document.removeEventListener('learning-tab-changed', onTab); window.removeEventListener('resize', onResize); if (state.boundPlot && window.Plotly) Plotly.purge(state.el('scatter')); instances.delete(mode); container.innerHTML = ''; }
    };
    instances.set(mode, state);
    if (state.active) fit(state);
    return state.api;
  }

  function getDataset() {
    return window.KMeansLab && typeof window.KMeansLab.getDataset === 'function' ? window.KMeansLab.getDataset() : null;
  }

  function datasetKey(data) {
    if (!data || !Array.isArray(data.rows)) return '';
    const metadata = data.metadata || {};
    return [metadata.retrieved_at || '', metadata.kind || '', metadata.source || '', data.rows.length,
      data.rows.length ? data.rows[0].time : '', data.rows.length ? data.rows[data.rows.length - 1].time : ''].join('|');
  }

  async function fit(state) {
    const token = ++state.token;
    const core = window.WeatherSupervised;
    const data = getDataset() || state.data;
    state.data = data;
    state.el('warning').hidden = true;
    state.el('results').hidden = true;
    state.el('fit').disabled = true;
    state.el('status').textContent = data ? 'Fitting on training hours and evaluating the held-out hours…' : 'Waiting for the weather dataset to load…';
    await nextPaint();
    if (token !== state.token) return;
    try {
      if (!core) throw new Error('The classification module did not load. Reload the page to try again.');
      if (!window.Plotly) throw new Error('The plotting library did not load. Reload the page to try again.');
      if (!data || !Array.isArray(data.rows)) { state.el('fit').disabled = false; return; }
      const dimensions = Number(state.el('dimensions').value);
      const standardize = state.el('standardize').checked;
      const prepared = core.prepareData(data.rows, { dimensions, standardize, testFraction: 0.2 });
      if (state.mode === 'knn') state.el('k').max = String(prepared.train.rows.length);
      const model = state.mode === 'knn'
        ? core.fitKNN(prepared.train.X, prepared.train.y, { k: Number(state.el('k').value) })
        : core.fitSoftmax(prepared.train.X, prepared.train.y, { lambda: Number(state.el('lambda').value), maxIterations: 120, tolerance: 1e-8 });
      const testProba = await predictBatches(model, prepared.test.X, core, state, token);
      const trainProba = await predictBatches(model, prepared.train.X, core, state, token);
      const testMetrics = core.evaluate(prepared.test.y, testProba);
      const trainMetrics = core.evaluate(prepared.train.y, trainProba);
      const bounds = featureBounds(prepared.train.X.concat(prepared.test.X), dimensions);
      const regions = dimensions === 2 ? await decisionRegions(model, bounds, core, state, token) : null;
      if (token !== state.token) return;
      state.result = { prepared, model, testProba, trainProba, testMetrics, trainMetrics, bounds, regions, dimensions, standardize };
      state.selected = Math.max(0, testMetrics.predictions.findIndex((value, i) => value !== prepared.test.y[i]));
      state.dirty = false;
      state.el('results').hidden = false;
      const warnings = prepared.warnings.slice();
      if (state.mode === 'logit' && !model.converged) warnings.push(`The optimizer stopped before convergence (${model.reason}). These metrics describe the current fit; try a stronger L2 setting or inspect the data.`);
      if (warnings.length) { state.el('warning').innerHTML = warnings.map(message => `<p>${escapeHTML(message)}</p>`).join(''); state.el('warning').hidden = false; }
      state.el('status').textContent = state.mode === 'knn'
        ? `Fitted with ${model.k} neighbors · ${prepared.train.rows.length.toLocaleString()} training hours · ${prepared.test.rows.length.toLocaleString()} test hours`
        : `${model.converged ? 'Fit converged' : 'Fit stopped early'} · ${model.iterations} optimization steps · ${prepared.train.rows.length.toLocaleString()} training hours · ${prepared.test.rows.length.toLocaleString()} test hours`;
      renderSummary(state);
      renderSelection(state);
      renderMethods(state);
      await renderScatter(state);
    } catch (error) {
      if (token !== state.token) return;
      state.result = null;
      state.dirty = true;
      state.el('results').hidden = true;
      state.el('status').textContent = 'The model could not be fitted with these settings.';
      state.el('warning').textContent = error.message || String(error);
      state.el('warning').hidden = false;
    } finally {
      if (token === state.token) state.el('fit').disabled = false;
    }
  }

  function featureBounds(X, dimensions) {
    return Array.from({ length: dimensions }, (_, j) => {
      let min = Infinity, max = -Infinity;
      X.forEach(row => { min = Math.min(min, row[j]); max = Math.max(max, row[j]); });
      if (min === max) { min -= 0.5; max += 0.5; }
      return { min, max, span: max - min };
    });
  }

  async function predictBatches(model, X, core, state, token) {
    if (model.kind !== 'knn') return core.predictProba(model, X);
    const probabilities = [];
    const batchSize = 256;
    for (let offset = 0; offset < X.length; offset += batchSize) {
      if (token !== state.token) throw new Error('This fit was replaced by a newer request.');
      probabilities.push(...core.predictProba(model, X.slice(offset, offset + batchSize)));
      // A large k can make a full decision grid expensive. Yield between
      // batches so the controls, tab changes, and refreshed data stay usable.
      if (offset + batchSize < X.length) await new Promise(resolve => setTimeout(resolve, 0));
    }
    return probabilities;
  }

  async function decisionRegions(model, bounds, core, state, token) {
    const nx = 61, ny = 51;
    const x = Array.from({ length: nx }, (_, i) => bounds[0].min + i / (nx - 1) * bounds[0].span);
    const y = Array.from({ length: ny }, (_, i) => bounds[1].min + i / (ny - 1) * bounds[1].span);
    const points = y.flatMap(yv => x.map(xv => [xv, yv]));
    const predicted = (await predictBatches(model, points, core, state, token)).map(core.argmax);
    const z = y.map((_, i) => predicted.slice(i * nx, (i + 1) * nx));
    return { x, y, z };
  }

  function renderSummary(state) {
    const { prepared, testMetrics: test, trainMetrics: train, model } = state.result;
    const m = prepared.metadata;
    state.el('split').innerHTML = `<div><b>Train</b><span>${dateUTC(m.trainStart)}–${dateUTC(m.trainEnd)} · ${m.trainDays} UTC days · ${m.trainCount.toLocaleString()} hours</span></div><div><b>Test</b><span>${dateUTC(m.testStart)}–${dateUTC(m.testEnd)} · ${m.testDays} UTC days · ${m.testCount.toLocaleString()} hours</span></div><p>The most recent 20% of complete UTC days are held out. Both classifier tabs use this same split.</p>`;
    state.el('error').textContent = percent(test.error);
    state.el('error-count').textContent = `${test.errors} of ${test.n} test hours assigned the wrong provider category`;
    state.el('accuracy').textContent = percent(test.accuracy);
    state.el('balanced').textContent = percent(test.balancedAccuracy);
    state.el('f1').textContent = number(test.macroF1, 3);
    state.el('logloss').textContent = number(test.logLoss, 3);
    state.el('comparison').innerHTML = [['Training error', train.error], ['Test error', test.error]].map(([label, value]) => `<div class="sl-comparison-row"><span>${label}</span><div class="sl-bar"><i style="width:${Math.max(0, Math.min(100, value * 100))}%"></i></div><b>${percent(value)}</b></div>`).join('') + `<p class="sl-small">Log loss: train ${number(train.logLoss, 3)} · test ${number(test.logLoss, 3)}</p>`;
    state.el('training-note').textContent = state.mode === 'knn' ? 'Training predictions include each training hour among its possible neighbors; this is not leave-one-out error.' : `L2 strength λ = ${model.lambda}. Performance measures use unpenalized log loss.`;
    const majority = window.WeatherSupervised.argmax(prepared.train.support);
    const baselineAccuracy = prepared.test.support[majority] / prepared.test.y.length;
    state.el('baseline').innerHTML = `Always predict <strong>${escapeHTML(prepared.classNames[majority])}</strong>, the most common training category.<br><b>${percent(1 - baselineAccuracy)} test error</b> · ${percent(baselineAccuracy)} accuracy`;
    const maxCount = Math.max(1, ...test.confusion.flat());
    const header = `<thead><tr><th scope="col">Predicted ↓<br>Actual →</th>${SHORT_NAMES.map(name => `<th scope="col">${name}</th>`).join('')}</tr></thead>`;
    const body = test.confusion.map((row, predicted) => `<tr><th scope="row"><i class="sl-class-dot" style="background:${COLORS[predicted]}"></i>${SHORT_NAMES[predicted]}</th>${row.map((count, actual) => `<td class="${predicted === actual ? 'sl-diagonal' : ''}" style="background:${rgba('#232D4B', 0.025 + 0.20 * count / maxCount)}" title="Predicted ${escapeHTML(prepared.classNames[predicted])}; actual ${escapeHTML(prepared.classNames[actual])}: ${count} hour${count === 1 ? '' : 's'}">${count}</td>`).join('')}</tr>`).join('');
    const foot = `<tfoot><tr><th scope="row">Actual hours</th>${prepared.test.support.map(n => `<td>${n}</td>`).join('')}</tr><tr><th scope="row">Recall</th>${test.perClass.map(item => `<td>${percent(item.recall)}</td>`).join('')}</tr></tfoot>`;
    state.el('confusion').innerHTML = `<table class="sl-matrix"><caption class="sl-sr-only">Test confusion matrix: predicted categories in rows, actual provider categories in columns.</caption>${header}<tbody>${body}</tbody>${foot}</table>`;
  }

  function renderSelection(state) {
    const { prepared, model, testProba, testMetrics } = state.result;
    const i = state.selected, row = prepared.test.rows[i], actual = prepared.test.y[i], predicted = testMetrics.predictions[i];
    const probabilities = testProba[i];
    const knn = state.mode === 'knn';
    const score = c => model.coefficients && model.coefficients[c] && model.coefficients[c].every(Number.isFinite)
      ? model.intercepts[c] + model.coefficients[c].reduce((sum, beta, j) => sum + beta * prepared.test.X[i][j], 0) : null;
    state.el('selection').innerHTML = `
      <p class="sl-selected-time">${dateLocal(row.time)} <span>Held-out test hour</span></p>
      <div class="sl-hour-values"><span>Cloud <b>${number(row.cloud_cover, 0)}%</b></span><span>Humidity <b>${number(row.relative_humidity_2m, 0)}%</b></span><span>Precipitation <b>${number(row.precipitation, 2)} mm</b>${state.result.dimensions === 2 ? ' <small>(context only)</small>' : ''}</span></div>
      <div class="sl-actual-predicted"><p><span>Actual provider category</span><strong>${escapeHTML(prepared.classNames[actual])}</strong></p><p><span>Model prediction</span><strong>${escapeHTML(prepared.classNames[predicted])}</strong><em class="${actual === predicted ? 'sl-correct' : 'sl-wrong'}">${actual === predicted ? 'Correct' : 'Incorrect'}</em></p></div>
      <div class="sl-table-scroll"><table class="sl-probabilities"><thead><tr><th scope="col">Category</th><th scope="col">${knn ? 'Neighbor votes' : 'Class score'}</th><th scope="col">Probability</th></tr></thead><tbody>${prepared.classNames.map((name, c) => `<tr><th scope="row"><i class="sl-class-dot" style="background:${COLORS[c]}"></i>${escapeHTML(name)}${c === actual ? '<small>Actual</small>' : ''}</th><td>${knn ? `${Math.round(probabilities[c] * model.k)} / ${model.k}` : number(score(c), 3)}</td><td><div class="sl-probability-value"><span class="sl-probability-track"><i style="width:${100 * probabilities[c]}%;background:${COLORS[c]}"></i></span><b>${percent(probabilities[c])}</b></div></td></tr>`).join('')}</tbody></table></div>
      <p class="sl-inspect-note">${knn ? `The ${model.k} closest training hours vote. The largest vote share wins; exact vote ties use the first category in the fixed category order.` : 'Softmax converts all class scores together into probabilities. The largest probability wins; there is no separate 0.5 cutoff for each category.'}</p>`;
  }

  function renderMethods(state) {
    const { prepared, model, testMetrics } = state.result;
    if (state.mode === 'knn') {
      state.el('method-detail').innerHTML = `<p>KNN uses Euclidean distance in the selected ${state.result.dimensions} features, with uniform neighbor votes. Exact distance ties use the earlier training row; equal vote totals use the first category in the fixed category order. An odd k does not rule out a tie with four categories.</p><p>Here ${testMetrics.clippedTrueProbabilities} test hour${testMetrics.clippedTrueProbabilities === 1 ? ' has' : 's have'} an actual category with zero or numerically tiny predicted probability. Such errors can make KNN log loss much larger than its classification-error percentage.</p>`;
      return;
    }
    const headers = ['Category', 'Intercept', ...prepared.features.map(key => FEATURE_NAMES[key])];
    state.el('method-detail').innerHTML = `<p>Training minimizes mean multinomial log loss plus (λ / 2) times the sum of squared slopes. Intercepts are not penalized. This λ is the penalty strength in that objective, not scikit-learn’s C.</p><p>The table uses ${state.result.standardize ? 'training-standardized' : 'original-unit'} predictors. For two categories, subtract their coefficient rows to obtain the change in their log probability ratio for a one-unit predictor increase, holding other features fixed.</p><div class="sl-table-scroll"><table class="sl-coefficients"><thead><tr>${headers.map(label => `<th scope="col">${label}</th>`).join('')}</tr></thead><tbody>${prepared.classNames.map((name, c) => `<tr><th scope="row">${escapeHTML(name)}</th><td>${number(model.intercepts[c], 3)}</td>${model.coefficients[c].map(value => `<td>${number(value, 3)}</td>`).join('')}</tr>`).join('')}</tbody></table></div><p>Optimizer: ${model.converged ? 'converged' : 'stopped before convergence'} after ${model.iterations} steps; ${escapeHTML(model.reason)}. The coefficients and scores describe the fitted classifier, not causal effects of weather variables.</p>`;
  }

  function projectedView(result, azimuth, elevation, visibleBounds) {
    const az = azimuth * Math.PI / 180, el = elevation * Math.PI / 180;
    const middle = visibleBounds.map(b => (b.min + b.max) / 2);
    const project = point => {
      const [x, y, z] = point.map((value, j) => value - middle[j]);
      const depth = x * Math.sin(az) + y * Math.cos(az);
      return [x * Math.cos(az) - y * Math.sin(az), z * Math.cos(el) - depth * Math.sin(el), z * Math.sin(el) + depth * Math.cos(el)];
    };
    const corners = [];
    for (const a of [0, 1]) for (const b of [0, 1]) for (const c of [0, 1]) corners.push([a, b, c].map((side, j) => side ? visibleBounds[j].max : visibleBounds[j].min));
    const positions = corners.map(project);
    const edges = [];
    for (let i = 0; i < 8; i++) for (const bit of [1, 2, 4]) if (i < (i ^ bit)) edges.push([positions[i], positions[i ^ bit]]);
    const origin = visibleBounds.map(b => b.min);
    const axisEnds = visibleBounds.map((b, j) => origin.map((value, k) => j === k ? b.max : value));
    const originXY = project(origin);
    const annotations = axisEnds.flatMap((point, j) => {
      const p = project(point);
      const right = p[0] >= originXY[0], above = p[1] >= originXY[1];
      return [
        { x: p[0], y: p[1], ax: originXY[0], ay: originXY[1], xref: 'x', yref: 'y', axref: 'x', ayref: 'y',
          text: '', showarrow: true, arrowhead: 2, arrowsize: 0.7, arrowwidth: 1.25, arrowcolor: '#728097' },
        { x: p[0], y: p[1], xref: 'x', yref: 'y', showarrow: false,
          text: `${FEATURE_NAMES[result.prepared.features[j]]}${result.standardize ? ' (z)' : ' (' + FEATURE_UNITS[result.prepared.features[j]] + ')'}`,
          xshift: right ? 8 : -8, yshift: above ? 8 : -8, xanchor: right ? 'left' : 'right', yanchor: above ? 'bottom' : 'top',
          font: { size: 10, color: '#40516b' }, bgcolor: 'rgba(255,255,255,.9)', borderpad: 3 }
      ];
    });
    const ranges = [0, 1].map(j => { const values = positions.map(p => p[j]); const min = Math.min(...values), max = Math.max(...values), pad = Math.max(0.5, 0.12 * (max - min)); return [min - pad, max + pad]; });
    return { project, edges, annotations, ranges };
  }

  function scatterData(state) {
    const r = state.result;
    const { prepared, model, testMetrics, testProba, bounds, dimensions, standardize } = r;
    const showPredicted = state.el('color-by').value === 'predicted';
    const showTraining = state.el('training').checked;
    const neighbors = state.mode === 'knn' && state.el('neighbors').checked
      ? window.WeatherSupervised.nearestNeighbors(model, prepared.test.X[state.selected]) : [];
    // Frame the projection around what is shown, without changing the fitted
    // coordinates or applying a separate scale to any of the three features.
    const displayedPoints = dimensions === 3 ? prepared.test.X.concat(showTraining ? prepared.train.X : [], neighbors.map(item => prepared.train.X[item.index])) : null;
    const view = dimensions === 3 ? projectedView(r, Number(state.el('azimuth').value), Number(state.el('elevation').value), featureBounds(displayedPoints, 3)) : null;
    const toXY = point => view ? view.project(point) : point;
    const traces = [];
    if (dimensions === 2) {
      const scale = COLORS.flatMap((color, c) => [[c / 4, rgba(color, 0.14)], [(c + 1) / 4, rgba(color, 0.14)]]);
      traces.push({ type: 'heatmap', x: r.regions.x, y: r.regions.y, z: r.regions.z, zmin: -0.5, zmax: 3.5,
        colorscale: scale, showscale: false, hoverinfo: 'skip', zsmooth: false, showlegend: false, name: 'Predicted category' });
    } else {
      traces.push({ type: 'scatter', mode: 'lines', x: view.edges.flatMap(edge => [edge[0][0], edge[1][0], null]), y: view.edges.flatMap(edge => [edge[0][1], edge[1][1], null]),
        line: { color: '#d8dee7', width: 1 }, hoverinfo: 'skip', showlegend: false });
    }

    if (showTraining) {
      const points = prepared.train.X.map(toXY);
      traces.push({ type: 'scatter', mode: 'markers', x: points.map(p => p[0]), y: points.map(p => p[1]), name: 'Training hours', showlegend: false,
        marker: { color: '#8e9aad', size: 3.5, opacity: 0.23 }, hoverinfo: 'skip' });
    }

    const labels = showPredicted ? testMetrics.predictions : prepared.test.y;
    for (let c = 0; c < 4; c++) {
      const indices = labels.flatMap((label, i) => label === c ? [i] : []);
      const points = indices.map(i => toXY(prepared.test.X[i]));
      const customdata = indices.map(i => {
        const row = prepared.test.rows[i];
        return [i, 'test', dateLocal(row.time), prepared.classNames[prepared.test.y[i]], prepared.classNames[testMetrics.predictions[i]], row.cloud_cover, row.relative_humidity_2m, row.precipitation, percent(Math.max(...testProba[i]))];
      });
      traces.push({ type: 'scatter', mode: 'markers', x: points.map(p => p[0]), y: points.map(p => p[1]), customdata,
        name: SHORT_NAMES[c], legendgroup: String(c), marker: { color: COLORS[c], size: 7, opacity: 0.85, line: { color: '#fff', width: 0.5 } },
        hovertemplate: '<b>%{customdata[2]}</b><br>Actual: %{customdata[3]}<br>Predicted: %{customdata[4]}<br>Cloud: %{customdata[5]:.0f}% · humidity: %{customdata[6]:.0f}%<br>Precipitation: %{customdata[7]:.2f} mm<br>Largest probability: %{customdata[8]}<extra></extra>' });
    }

    const errors = testMetrics.predictions.flatMap((predicted, i) => predicted !== prepared.test.y[i] ? [i] : []);
    const errorPoints = errors.map(i => toXY(prepared.test.X[i]));
    traces.push({ type: 'scatter', mode: 'markers', x: errorPoints.map(p => p[0]), y: errorPoints.map(p => p[1]),
      customdata: errors.map(i => [i, 'test']), marker: { color: '#172239', size: 11, symbol: 'circle-open', line: { width: 1.4 } },
      showlegend: false, name: 'Incorrect prediction', hovertemplate: 'Incorrect test prediction<br>Click to inspect<extra></extra>' });

    if (neighbors.length) {
      const nearPoints = neighbors.map(item => toXY(prepared.train.X[item.index]));
      traces.push({ type: 'scatter', mode: 'markers', x: nearPoints.map(p => p[0]), y: nearPoints.map(p => p[1]),
        customdata: neighbors.map(item => [item.index, 'train', prepared.classNames[item.label], dateLocal(prepared.train.rows[item.index].time), Math.sqrt(item.distance2)]),
        marker: { color: neighbors.map(item => COLORS[item.label]), size: 11, symbol: 'triangle-up', line: { color: '#172239', width: 1 } },
        showlegend: false, name: 'Selected hour’s training neighbors', hovertemplate: 'Training neighbor: %{customdata[2]}<br>%{customdata[3]}<br>Fitted-space distance: %{customdata[4]:.3f}<extra></extra>' });
    }
    const selectedXY = toXY(prepared.test.X[state.selected]);
    traces.push({ type: 'scatter', mode: 'markers', x: [selectedXY[0]], y: [selectedXY[1]], customdata: [[state.selected, 'test']],
      marker: { color: '#172239', size: 16, symbol: 'diamond-open', line: { width: 2 } }, showlegend: false, name: 'Selected test hour', hoverinfo: 'skip' });

    const axis = key => `${FEATURE_NAMES[key]} (${standardize ? 'training z score' : FEATURE_UNITS[key]})`;
    const layout = { margin: { l: dimensions === 3 ? 35 : 64, r: 25, t: dimensions === 3 ? 30 : 20, b: 88 },
      paper_bgcolor: '#fff', plot_bgcolor: '#fff', font: { family: '-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif', color: '#34415a', size: 11 },
      showlegend: true, legend: { orientation: 'h', x: 0, y: -0.17, xanchor: 'left', yanchor: 'top', font: { size: 10 }, traceorder: 'normal' },
      hovermode: 'closest', dragmode: 'zoom', uirevision: `${state.mode}-${state.token}-${dimensions}${view ? '-' + [state.el('azimuth').value, state.el('elevation').value, showTraining, neighbors.length, state.selected].join('-') : ''}`,
      xaxis: view ? { range: view.ranges[0], showgrid: false, zeroline: false, visible: false, fixedrange: false } : { title: { text: axis(prepared.features[0]), standoff: 12 }, range: [bounds[0].min - bounds[0].span * 0.04, bounds[0].max + bounds[0].span * 0.04], gridcolor: '#e9edf2', zeroline: false },
      yaxis: view ? { range: view.ranges[1], showgrid: false, zeroline: false, visible: false, scaleanchor: 'x', scaleratio: 1, fixedrange: false } : { title: { text: axis(prepared.features[1]), standoff: 12 }, range: [bounds[1].min - bounds[1].span * 0.04, bounds[1].max + bounds[1].span * 0.04], gridcolor: '#e9edf2', zeroline: false, scaleanchor: 'x', scaleratio: 1, constrain: 'domain' },
      annotations: view ? view.annotations : [] };
    return { traces, layout };
  }

  function renderScatter(state) {
    if (!state.active || !state.result) return Promise.resolve();
    const dimensions = state.result.dimensions;
    state.el('rotation').hidden = dimensions !== 3;
    state.el('plot-units').textContent = `${dimensions} fitted features · ${state.result.standardize ? 'training-standardized' : 'original units'}`;
    state.el('plot-note').textContent = dimensions === 2
      ? `Background colors show the model’s predicted category across this feature space. Dots show ${state.el('color-by').value === 'actual' ? 'actual provider categories' : 'predicted categories'} for test hours; black rings always mark mistakes.`
      : `This projection is framed around the displayed hours, with one common coordinate scale. Rotate to separate overlaps; classification still uses all three fitted coordinates. Black rings mark test mistakes.`;
    const drawing = scatterData(state);
    const token = state.token;
    state.renderQueue = state.renderQueue.catch(() => {}).then(async () => {
      if (token !== state.token || !state.active || !state.result) return;
      await Plotly.react(state.el('scatter'), drawing.traces, drawing.layout, { responsive: true, displaylogo: false, scrollZoom: false, modeBarButtonsToRemove: ['select2d', 'lasso2d'], toImageButtonOptions: { filename: `${state.mode}-weather-test` } });
      if (!state.boundPlot) {
        state.el('scatter').on('plotly_click', event => {
          const point = event.points && event.points[0];
          const custom = point && point.customdata;
          if (!Array.isArray(custom) || custom[1] !== 'test' || !state.result) return;
          const i = Number(custom[0]);
          if (!Number.isInteger(i) || i < 0 || i >= state.result.prepared.test.rows.length) return;
          state.selected = i;
          renderSelection(state);
          renderScatter(state);
        });
        state.boundPlot = true;
      }
    });
    return state.renderQueue;
  }

  window.SupervisedLab = { mount, getState: mode => instances.has(mode) ? instances.get(mode).api.getState() : null, colors: COLORS.slice() };
})();
