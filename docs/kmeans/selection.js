/* Compare K using the active KMeans geometry, independently of the teaching run. */
(function () {
  'use strict';
  const mount = document.getElementById('k-selection');
  if (!mount) return;
  const scriptURL = document.currentScript && document.currentScript.src || location.href;
  const workerURL = new URL('selection-worker.js?v=20261115c', scriptURL).href;
  const palette = ['#232D4B', '#D96A00', '#147D80', '#8252A0', '#7B8526', '#B04446', '#3878A6', '#A65D7D', '#6C7460', '#A57725'];
  const names = { cloud_cover: 'cloud cover', relative_humidity_2m: 'humidity', precipitation: 'precipitation' };
  const number = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
  const time = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', timeZoneName: 'short' });
  const state = { active: !mount.closest('[hidden]'), context: null, signature: null, result: null,
    requestId: 0, worker: null, timer: null, busy: false, error: null, selectedK: 3, animationK: 3,
    renderQueue: Promise.resolve(), renderVersion: 0, galleryVersion: -1, rowLabels: [] };

  mount.innerHTML = `
    <section class="k-selection" aria-labelledby="k-selection-heading">
      <div class="section-row"><h2 id="k-selection-heading" class="section-label">4. Compare the number of clusters</h2><span class="run-label">Elbow method + silhouette profiles</span></div>
      <p class="k-selection-intro">Look for diminishing returns in within-cluster SSE, then inspect how clearly each hour fits its cluster.</p>
      <div class="k-selection-context" id="k-selection-context">Waiting for the weather data…</div>
      <div class="k-selection-status" id="k-selection-status" role="status" aria-live="polite">The plots use the same variables and scaling selected above.</div>
      <div id="k-selection-error" class="k-selection-error" role="alert" hidden></div>
      <button id="k-selection-retry" class="button secondary" type="button" hidden>Retry comparison</button>
      <div id="k-selection-results" hidden>
        <div class="k-selection-charts">
          <section class="plot-panel" aria-labelledby="k-elbow-heading"><div class="plot-title"><h3 id="k-elbow-heading">Elbow plot</h3><span>Lower WCSSE · diminishing gains</span></div><div id="k-elbow-plot" class="k-summary-plot" role="img" aria-label="Within-cluster sum of squared errors versus number of clusters"></div><p class="k-plot-hint">WCSSE is the sum of squared distances to assigned centroids. Compare its bend within this variable scale.</p></section>
          <section class="plot-panel" aria-labelledby="k-silhouette-heading"><div class="plot-title"><h3 id="k-silhouette-heading">Mean silhouette versus K</h3><span>Higher · clearer separation</span></div><div id="k-silhouette-plot" class="k-summary-plot" role="img" aria-label="Mean silhouette score versus number of clusters"></div><p class="k-plot-hint">K = 1 has no alternative cluster, so its silhouette is undefined. Click a point in either chart to inspect that K.</p></section>
        </div>
        <p id="k-selection-best" class="k-selection-best"></p>
        <section class="k-profile-section" aria-labelledby="k-profile-heading">
          <div class="section-row"><h3 id="k-profile-heading">Inspect the silhouette profile</h3><div class="k-profile-controls"><label for="k-profile-select">Profile for K<select id="k-profile-select" disabled></select></label><button id="k-use-animation" type="button" class="button secondary" disabled>Use this K in animation</button></div></div>
          <p id="k-profile-summary" class="k-profile-summary" aria-live="polite"></p>
          <div id="k-profile-plot" class="k-profile-plot" role="img" aria-label="Silhouette scores grouped by cluster for the selected number of clusters"></div>
          <p class="k-plot-hint">One horizontal strip per hour, sorted within its cluster. Long positive strips show strong membership; negative strips favor another cluster. The dashed line marks the overall mean.</p>
        </section>
        <details id="k-profile-comparison" class="k-profile-comparison"><summary>Compare silhouette profiles across K</summary><p>Use the same −1 to +1 scale to compare the candidate partitions. Cluster numbers are arbitrary within each fit.</p><div id="k-profile-gallery" class="k-profile-gallery"></div></details>
        <details class="k-selection-method"><summary>How these comparisons are calculated</summary><p>For each K, the app fits ten reproducible KMeans++ starts and, for K &gt; 1, also tries splitting the previous K solution. It keeps the fit with the lowest WCSSE. A limit or an empty cluster is reported when relevant. These comparison fits are separate from the single initialization in the animation above.</p><p>Silhouette scores use ordinary Euclidean distances between all active observations in the selected feature space. A singleton cluster member receives 0. Standardized variables use mean 0 and population standard deviation 1; raw variables retain their original units. Changing dimensions, scaling, data, or the random seed recalculates the comparison.</p><p>The highest mean silhouette is a useful candidate among the tested K values. Use the profile shapes, cluster sizes, elbow, and weather interpretation together; the score does not establish a unique optimal K.</p></details>
      </div>
    </section>`;

  const el = id => document.getElementById(id);
  const plots = ['k-elbow-plot', 'k-silhouette-plot', 'k-profile-plot'];

  function contextText() {
    if (!state.context) return 'Waiting for the weather data…';
    const context = state.context;
    return `${context.points.length.toLocaleString()} hours · ${context.features.length}D: ${context.features.map(key => names[key] || key).join(' + ')} · ${context.standardize ? 'Standardized variables (z-scores)' : 'Raw variables (original units)'} · ${context.sourceMode === 'snapshot' ? 'Saved snapshot' : 'Active weather data'}`;
  }

  function stopWorker() {
    if (state.worker) state.worker.terminate();
    state.worker = null;
    if (state.timer !== null) clearTimeout(state.timer);
    state.timer = null;
  }

  function showError(message, requestId) {
    if (requestId !== state.requestId) return;
    stopWorker(); state.busy = false; state.error = message;
    mount.setAttribute('aria-busy', 'false');
    el('k-selection-status').textContent = 'The comparison could not be completed.';
    el('k-selection-error').textContent = message;
    el('k-selection-error').hidden = false;
    el('k-selection-retry').hidden = false;
  }

  function acceptResult(result, requestId) {
    if (requestId !== state.requestId) return;
    stopWorker(); state.busy = false; state.error = null;
    state.result = result; state.galleryVersion = -1;
    mount.setAttribute('aria-busy', 'false');
    if (!result || !Array.isArray(result.results) || !result.results.length) {
      showError('No valid candidate partitions were available for these data.', requestId); return;
    }
    const ks = result.results.map(item => item.k);
    if (!ks.includes(state.selectedK)) state.selectedK = ks.includes(state.animationK) ? state.animationK : ks[0];
    const select = el('k-profile-select');
    select.replaceChildren(...ks.map(k => { const option = document.createElement('option'); option.value = k; option.textContent = String(k); return option; }));
    select.disabled = false;
    const limited = result.results.filter(item => !item.converged || item.limited).map(item => item.k);
    const empty = result.results.filter(item => item.actualK !== undefined && item.actualK < item.k).map(item => item.k);
    const warnings = [];
    if (limited.length) warnings.push(`Iteration limit reached for K = ${limited.join(', ')}; interpret those fits cautiously.`);
    if (empty.length) warnings.push(`Fewer nonempty groups than requested for K = ${empty.join(', ')}.`);
    el('k-selection-status').textContent = `Compared K = 1–${Math.max(...ks)} with multiple starts. Silhouette uses all ${number.format(result.n)} hours. ${warnings.join(' ')}`.trim();
    el('k-selection-results').hidden = false;
    updateProfileControls();
    render();
  }

  function startComparison() {
    if (!state.context) return;
    stopWorker();
    const requestId = ++state.requestId;
    state.busy = true; state.error = null; state.result = null; state.renderVersion++;
    mount.setAttribute('aria-busy', 'true');
    el('k-selection-error').hidden = true;
    el('k-selection-retry').hidden = true;
    el('k-selection-results').hidden = true;
    el('k-profile-select').disabled = true;
    el('k-use-animation').disabled = true;
    el('k-selection-context').textContent = contextText();
    el('k-selection-status').textContent = 'Computing K = 1–10 and exact silhouette scores…';
    const context = state.context;
    const options = { maxK: 10, seed: context.seed, nInit: 10, maxIterations: 300 };
    let fallbackStarted = false;
    function progress(value) {
      if (requestId !== state.requestId) return;
      el('k-selection-status').textContent = `Compared K = ${value.k} of ${value.maxK}. Computing fits and silhouette scores…`;
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
          if (!window.KMeansSelection) throw new Error('The comparison code did not load. Reload this page and try again.');
          const result = window.KMeansSelection.analyze(context.points, { ...options, onProgress: progress });
          acceptResult(result, requestId);
        } catch (error) { showError(error.message, requestId); }
      }, 30);
    }
    try {
      const worker = new Worker(workerURL);
      state.worker = worker;
      worker.onmessage = event => {
        const message = event.data || {};
        if (message.requestId !== requestId || requestId !== state.requestId) return;
        if (message.type === 'progress') progress(message);
        else if (message.type === 'result') acceptResult(message.result, requestId);
        else if (message.type === 'error') showError(message.message || 'The diagnostic calculation failed.', requestId);
      };
      worker.onerror = event => { if (event.preventDefault) event.preventDefault(); fallback(); };
      worker.postMessage({ requestId, points: context.points, options });
    } catch (_) { fallback(); }
  }

  function update(context) {
    if (!context || !Array.isArray(context.points) || !context.points.length) return;
    const seed = Number.isInteger(Number(context.seed)) && Number(context.seed) >= 0 ? Number(context.seed) >>> 0 : 6021;
    const next = { ...context, seed, features: context.features.slice(), rows: context.rows || [] };
    const signature = JSON.stringify([next.features, !!next.standardize, seed, next.points, next.rows.map(row => row.time)]);
    const geometryChanged = signature !== state.signature;
    const animationChanged = Number(context.selectedK) !== state.animationK;
    state.context = next;
    state.animationK = Number(context.selectedK) || 3;
    if (geometryChanged || animationChanged) state.selectedK = state.animationK;
    el('k-selection-context').textContent = contextText();
    if (geometryChanged) {
      state.signature = signature;
      state.rowLabels = next.points.map((_, i) => Number.isFinite(next.rows[i] && next.rows[i].time)
        ? time.format(new Date(next.rows[i].time * 1000)) : `Observation ${i + 1}`);
      startComparison();
    } else if (state.result) {
      if (!state.result.results.some(item => item.k === state.selectedK)) state.selectedK = state.result.results[0].k;
      updateProfileControls(); render();
    }
  }

  function selectedResult() {
    return state.result && state.result.results.find(item => item.k === state.selectedK);
  }

  function updateProfileControls() {
    const item = selectedResult();
    el('k-profile-select').value = String(state.selectedK);
    el('k-use-animation').disabled = !item || state.animationK === state.selectedK;
    el('k-use-animation').textContent = state.animationK === state.selectedK
      ? `Animation uses K = ${state.selectedK}` : `Use K = ${state.selectedK} in animation`;
    if (!item) return;
    const actualK = item.actualK === undefined ? item.counts.filter(Boolean).length : item.actualK;
    const extras = actualK < item.k ? ` · ${actualK} nonempty groups` : '';
    el('k-profile-summary').textContent = item.silhouette
      ? `K = ${item.k} · Mean silhouette ${item.silhouette.mean.toFixed(3)} · ${item.silhouette.negativeCount.toLocaleString()} hours with negative scores · WCSSE ${number.format(item.sse)}${extras}`
      : `K = ${item.k} · WCSSE ${number.format(item.sse)}${extras}. Silhouette is undefined: it requires between 2 and n − 1 nonempty clusters.`;
  }

  function baseLayout() {
    return { paper_bgcolor: '#fff', plot_bgcolor: '#fff', margin: { l: 68, r: 22, t: 18, b: 52 },
      font: { family: '-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif', size: 11, color: '#5d687b' },
      showlegend: false, hovermode: 'closest', transition: { duration: 0 },
      xaxis: { title: { text: 'Number of clusters, K', standoff: 10 }, dtick: 1, range: [.7, state.result.maxK + .3], gridcolor: '#e9edf2', fixedrange: true },
      yaxis: { gridcolor: '#e9edf2', fixedrange: true, zerolinecolor: '#c2cbd7', automargin: true } };
  }

  function chartConfig(filename, compact = false) {
    return { responsive: true, displaylogo: false, displayModeBar: compact ? false : 'hover',
      modeBarButtonsToRemove: ['select2d', 'lasso2d', 'autoScale2d', 'zoom2d', 'pan2d', 'zoomIn2d', 'zoomOut2d', 'resetScale2d'],
      toImageButtonOptions: { format: 'png', filename, scale: 2 } };
  }

  function summaryPlot(kind) {
    const candidates = state.result.results;
    const silhouette = kind === 'silhouette';
    const values = candidates.map(item => silhouette ? item.silhouette && item.silhouette.mean : item.sse);
    const trace = { type: 'scatter', mode: 'lines+markers', x: candidates.map(item => item.k), y: values,
      line: { color: silhouette ? '#147D80' : '#232D4B', width: 2 }, marker: { size: 7 }, connectgaps: false,
      hovertemplate: silhouette ? 'K = %{x}<br>Mean silhouette: %{y:.4f}<extra></extra>' : 'K = %{x}<br>WCSSE: %{y:,.3f}<extra></extra>' };
    const selected = candidates.findIndex(item => item.k === state.selectedK);
    const traces = [trace];
    if (selected >= 0 && Number.isFinite(values[selected])) traces.push({ type: 'scatter', mode: 'markers', x: [state.selectedK], y: [values[selected]],
      marker: { size: 11, color: '#D96A00', line: { color: '#fff', width: 1.2 } }, hoverinfo: 'skip' });
    const layout = baseLayout();
    layout.yaxis = { ...layout.yaxis, title: { text: silhouette ? 'Mean silhouette score' : 'Within-cluster SSE (WCSSE)', standoff: 10 },
      ...(silhouette ? { range: [-1.02, 1.02], dtick: .5 } : { rangemode: 'tozero' }) };
    return { traces, layout };
  }

  function profilePlot(item, compact) {
    const height = compact ? 265 : 460;
    const layout = { ...baseLayout(), height, margin: { l: compact ? 55 : 112, r: 23, t: 30, b: 51 },
      xaxis: { title: { text: 'Silhouette score', standoff: 10 }, range: [-1.03, 1.03], dtick: .5, gridcolor: '#e9edf2', zeroline: true, zerolinecolor: '#9ba9ba', fixedrange: true },
      yaxis: { showgrid: false, zeroline: false, fixedrange: true, tickfont: { size: compact ? 9 : 10 }, automargin: true }, shapes: [], annotations: [] };
    if (!item.silhouette) {
      layout.yaxis.visible = false;
      layout.annotations = [{ text: item.k === 1 ? 'K = 1 has no alternative cluster.<br>Silhouette is undefined.' : 'Silhouette is undefined for this partition.',
        x: .5, y: .5, xref: 'paper', yref: 'paper', showarrow: false, font: { size: 12, color: '#5d687b' } }];
      return { traces: [], layout };
    }
    const traces = [], ticks = [], tickText = [];
    const gap = Math.max(4, Math.round(item.labels.length * .018));
    let offset = 0;
    item.counts.forEach((count, cluster) => {
      if (!count) return;
      const indices = item.labels.map((label, i) => label === cluster ? i : -1).filter(i => i >= 0)
        .sort((a, b) => item.silhouette.values[a] - item.silhouette.values[b]);
      const x = [0], y = [offset];
      indices.forEach((index, position) => { const score = item.silhouette.values[index]; x.push(score, score); y.push(offset + position, offset + position + 1); });
      x.push(0); y.push(offset + count);
      const color = palette[cluster % palette.length];
      traces.push({ type: 'scatter', mode: 'lines', x, y, fill: 'toself', fillcolor: color, line: { color, width: .2 }, hoverinfo: 'skip' });
      if (!compact) traces.push({ type: 'scatter', mode: 'markers', x: indices.map(index => item.silhouette.values[index]), y: indices.map((_, position) => offset + position + .5),
        marker: { color, size: 2.5, opacity: .7 },
        customdata: indices.map(index => [state.rowLabels[index], cluster + 1]),
        hovertemplate: '%{customdata[0]}<br>Cluster %{customdata[1]}<br>Silhouette: %{x:.4f}<extra></extra>' });
      ticks.push(offset + count / 2);
      tickText.push(compact ? `C${cluster + 1}` : `Cluster ${cluster + 1} · ${count}`);
      offset += count + gap;
    });
    layout.yaxis = { ...layout.yaxis, tickmode: 'array', tickvals: ticks, ticktext: tickText, range: [offset - gap, 0] };
    layout.shapes.push({ type: 'line', x0: item.silhouette.mean, x1: item.silhouette.mean, y0: 0, y1: 1, xref: 'x', yref: 'paper',
      line: { color: '#B04446', width: 1.5, dash: 'dash' } });
    layout.annotations.push({ text: `Mean ${item.silhouette.mean.toFixed(3)}`, x: item.silhouette.mean, y: 1.03, xref: 'x', yref: 'paper', showarrow: false,
      xanchor: item.silhouette.mean > .6 ? 'right' : item.silhouette.mean < -.6 ? 'left' : 'center', yanchor: 'bottom', font: { size: compact ? 10 : 11, color: '#8e3d40' } });
    return { traces, layout };
  }

  function chooseProfile(k) {
    if (!state.result || !state.result.results.some(item => item.k === k)) return;
    state.selectedK = k;
    updateProfileControls(); render();
  }

  function bindChart(id) {
    const node = el(id);
    if (node._kSelectionBound || typeof node.on !== 'function') return;
    node.on('plotly_click', event => {
      const k = event && event.points && event.points[0] && Number(event.points[0].x);
      if (Number.isInteger(k)) chooseProfile(k);
    });
    node._kSelectionBound = true;
  }

  async function renderGallery(requestId) {
    if (!state.result || !el('k-profile-comparison').open || state.galleryVersion === requestId || !state.active) return;
    const gallery = el('k-profile-gallery');
    gallery.querySelectorAll('.k-mini-profile').forEach(node => { if (node._fullLayout) Plotly.purge(node); });
    gallery.replaceChildren();
    const results = state.result.results.filter(item => item.k >= 2);
    if (!results.length) { gallery.textContent = 'There are too few distinct profiles to compare multiple clusters.'; return; }
    for (const item of results) {
      if (requestId !== state.requestId || !state.active) return;
      const panel = document.createElement('section'); panel.className = 'k-mini-panel';
      const button = document.createElement('button'); button.type = 'button'; button.className = 'k-mini-heading';
      button.textContent = `K = ${item.k}`; button.setAttribute('aria-label', `Inspect the full silhouette profile for K = ${item.k}`);
      button.addEventListener('click', () => chooseProfile(item.k));
      const plot = document.createElement('div'); plot.className = 'k-mini-profile';
      plot.setAttribute('role', 'img'); plot.setAttribute('aria-label', `Silhouette profile for K = ${item.k}`);
      panel.append(button, plot); gallery.append(panel);
      const figure = profilePlot(item, true);
      await Plotly.react(plot, figure.traces, figure.layout, chartConfig(`ds6021-silhouette-k${item.k}`, true));
    }
    state.galleryVersion = requestId;
  }

  function render() {
    if (!state.active || !state.result || state.busy || typeof Plotly === 'undefined') return;
    const requestId = state.requestId;
    const version = ++state.renderVersion;
    state.renderQueue = state.renderQueue.catch(() => {}).then(async () => {
      if (requestId !== state.requestId || version !== state.renderVersion || !state.active || !state.result) return;
      const elbow = summaryPlot('elbow'), means = summaryPlot('silhouette');
      const selected = selectedResult();
      const profile = profilePlot(selected, false);
      const valid = state.result.results.filter(item => item.silhouette && Number.isFinite(item.silhouette.mean));
      const best = valid.reduce((winner, item) => !winner || item.silhouette.mean > winner.silhouette.mean ? item : winner, null);
      el('k-selection-best').textContent = best
        ? `Highest mean silhouette among tested values: K = ${best.k} (${best.silhouette.mean.toFixed(3)}). Inspect the profiles and the elbow before choosing K.`
        : 'Silhouette is undefined for the candidate partitions. Use cluster counts and the WCSSE plot to inspect the available groups.';
      await Promise.all([
        Plotly.react('k-elbow-plot', elbow.traces, elbow.layout, chartConfig('ds6021-kmeans-elbow')),
        Plotly.react('k-silhouette-plot', means.traces, means.layout, chartConfig('ds6021-mean-silhouette')),
        Plotly.react('k-profile-plot', profile.traces, profile.layout, chartConfig(`ds6021-silhouette-k${selected.k}`))
      ]);
      if (requestId !== state.requestId || version !== state.renderVersion || !state.active) return;
      bindChart('k-elbow-plot'); bindChart('k-silhouette-plot');
      await renderGallery(requestId);
    }).catch(error => { if (requestId === state.requestId) showError(`The diagnostic plot could not render: ${error.message}`, requestId); });
  }

  function setSelectedK(k) {
    state.animationK = Number(k);
    if (state.result && state.result.results.some(item => item.k === state.animationK)) state.selectedK = state.animationK;
    updateProfileControls(); render();
  }

  function setActive(active) {
    state.active = !!active;
    if (state.active) requestAnimationFrame(() => { render(); resize(); });
  }

  function resize() {
    if (!state.active || !state.result || typeof Plotly === 'undefined') return;
    [...plots.map(el), ...mount.querySelectorAll('.k-mini-profile')].forEach(node => {
      if (node && node._fullLayout && node.getBoundingClientRect().width > 0) Plotly.Plots.resize(node);
    });
  }

  el('k-profile-select').addEventListener('change', event => chooseProfile(Number(event.target.value)));
  el('k-use-animation').addEventListener('click', () => {
    if (state.result && selectedResult()) document.dispatchEvent(new CustomEvent('kmeans-use-k', { detail: { k: state.selectedK } }));
  });
  el('k-selection-retry').addEventListener('click', startComparison);
  el('k-profile-comparison').addEventListener('toggle', () => { if (el('k-profile-comparison').open) render(); });
  let resizeTimer = null;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(resize, 100); });

  window.KMeansDiagnostics = { update, setSelectedK, setActive, getState: () => ({
    busy: state.busy, error: state.error, active: state.active, selectedK: state.selectedK, animationK: state.animationK,
    standardize: state.context && state.context.standardize, features: state.context ? state.context.features.slice() : [],
    seed: state.context && state.context.seed, n: state.context ? state.context.points.length : 0,
    results: state.result ? state.result.results.map(item => ({ k: item.k, sse: item.sse, actualK: item.actualK,
      converged: item.converged, limited: item.limited, meanSilhouette: item.silhouette && item.silhouette.mean,
      negativeCount: item.silhouette && item.silhouette.negativeCount, counts: item.counts.slice() })) : [],
    profile: selectedResult() ? { k: selectedResult().k, values: selectedResult().silhouette ? selectedResult().silhouette.values.slice() : null } : null
  }) };
})();
