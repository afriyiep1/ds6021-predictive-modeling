(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const Core = window.KMeansCore;
  const palette = ['#232D4B', '#D96A00', '#147D80', '#8252A0', '#7B8526', '#B04446'];
  const featureInfo = {
    cloud_cover: { short: 'Cloud cover', unit: '%', digits: 1 },
    relative_humidity_2m: { short: 'Relative humidity', unit: '%', digits: 1 },
    precipitation: { short: 'Precipitation', unit: 'mm', digits: 2 }
  };
  const endpoint = 'https://api.open-meteo.com/v1/forecast?latitude=38.0293&longitude=-78.4767&hourly=temperature_2m,relative_humidity_2m,precipitation,cloud_cover,weather_code&timezone=UTC&timeformat=unixtime&past_days=60&forecast_days=0';
  const timeZone = 'America/New_York';
  const hourFormat = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
  const dateFormat = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'short', day: 'numeric' });
  const numberFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
  let saved = null;
  let dataset = null;
  let prepared = null;
  let features = [];
  let frames = [];
  let cursor = 0;
  let timer = null;
  let runNumber = 0;
  let fittedSeed = null;
  let pendingFetch = false;
  let latestRender = Promise.resolve();
  let renderRevision = 0;
  let sourceMode = 'snapshot';
  let webGLAvailable = false;
  const settings = ['dimensions', 'clusters', 'initialization', 'seed', 'standardize'];

  function supportsWebGL() {
    try {
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('webgl2') || canvas.getContext('webgl');
      return !!context;
    } catch (_) { return false; }
  }

  // Correct roundoff only in displayed numbers, never in fitting or the SSE.
  function formatFixed(value, digits) {
    return (Math.abs(value) < .5 * 10 ** -digits ? 0 : value).toFixed(digits);
  }

  function projected3D() { return features.length === 3 && !webGLAvailable; }

  function showMessage(text, error = false) {
    $('message').textContent = text;
    $('message').className = 'message' + (error ? ' error' : '');
    $('message').hidden = !text;
  }

  function validateData(value) {
    if (!value || !Array.isArray(value.rows)) throw new Error('The weather data have an unexpected format.');
    const rows = value.rows.filter(row => Number.isFinite(row.time) && row.time > 0
      && Number.isFinite(row.cloud_cover) && row.cloud_cover >= 0 && row.cloud_cover <= 100
      && Number.isFinite(row.relative_humidity_2m) && row.relative_humidity_2m >= 0 && row.relative_humidity_2m <= 100
      && Number.isFinite(row.precipitation) && row.precipitation >= 0);
    if (rows.length < 6) throw new Error('The response does not contain enough complete hourly weather profiles.');
    rows.sort((a, b) => a.time - b.time);
    const seen = new Set();
    const uniqueHours = rows.filter(row => !seen.has(row.time) && seen.add(row.time));
    return { metadata: value.metadata || {}, rows: uniqueHours, omitted: value.rows.length - uniqueHours.length };
  }

  async function fetchJSON(url) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(url, { signal: controller.signal, cache: 'no-store' });
      if (!response.ok) throw new Error(`The data service returned HTTP ${response.status}.`);
      return await response.json();
    } finally { clearTimeout(timeout); }
  }

  function parseAPI(result) {
    if (result.error) throw new Error(result.reason || 'The weather service could not provide data.');
    const hourly = result.hourly;
    if (!hourly || !Array.isArray(hourly.time)) throw new Error('The weather response is missing hourly values.');
    const keys = ['cloud_cover', 'relative_humidity_2m', 'precipitation', 'temperature_2m', 'weather_code'];
    const rows = hourly.time.map((time, i) => {
      const row = { time };
      keys.forEach(key => { row[key] = hourly[key] ? hourly[key][i] : null; });
      return row;
    });
    return validateData({ metadata: {
      source: 'Open-Meteo Forecast API', title: 'Charlottesville recent weather',
      latitude: 38.0293, longitude: -78.4767, retrieved_at: new Date().toISOString(),
      timezone: timeZone, timestamp_timezone: 'UTC', endpoint, past_days: 60,
      kind: 'recent-model-estimates', license: 'CC BY 4.0', license_url: 'https://creativecommons.org/licenses/by/4.0/'
    }, rows });
  }

  function describeData() {
    if (!dataset) return;
    const rows = dataset.rows;
    const first = new Date(rows[0].time * 1000);
    const last = new Date(rows[rows.length - 1].time * 1000);
    $('data-badge').textContent = sourceMode === 'snapshot' ? 'SAVED SNAPSHOT' : 'REFRESHED DATA';
    $('data-badge').className = 'badge' + (sourceMode === 'snapshot' ? '' : ' refreshed');
    $('data-description').textContent = `${rows.length.toLocaleString()} hourly profiles · ${dateFormat.format(first)}–${dateFormat.format(last)} (local dates)`;
    const retrieved = dataset.metadata.retrieved_at ? new Date(dataset.metadata.retrieved_at) : null;
    const stamp = retrieved && !Number.isNaN(retrieved.valueOf()) ? ` Retrieved ${hourFormat.format(retrieved)}.` : '';
    $('data-detail').textContent = `Open-Meteo model estimates, not station observations. Latest hour: ${hourFormat.format(last)}.${stamp} Display: America/New_York; API days and CSV timestamps: UTC.`;
  }

  function pause() {
    if (timer !== null) clearInterval(timer);
    timer = null;
    $('play').textContent = cursor >= frames.length - 1 && frames.length ? '▶ Replay' : '▶ Play';
  }

  function setupRun() {
    if (!dataset) return false;
    pause();
    try {
      const seedText = $('seed').value.trim();
      const seed = Number(seedText);
      if (!seedText || !Number.isInteger(seed) || seed < 0 || seed > 4294967295) throw new Error('Enter an integer random seed from 0 to 4,294,967,295.');
      const nextFeatures = ['cloud_cover', 'relative_humidity_2m'];
      if ($('dimensions').value === '3') nextFeatures.push('precipitation');
      const nextPrepared = Core.prepare(dataset.rows, nextFeatures, $('standardize').checked);
      const k = Number($('clusters').value);
      const centers = Core.initialize(nextPrepared.points, nextPrepared.unique, k, seed, $('initialization').value);
      const nextFrames = Core.history(nextPrepared.points, centers);
      features = nextFeatures;
      prepared = nextPrepared;
      frames = nextFrames;
      fittedSeed = seed;
      cursor = 0;
      runNumber++;
      $('timeline').max = frames.length - 1;
      $('timeline').disabled = false;
      $('geometry-note').textContent = `${features.length}D fitting uses ${features.map(key => featureInfo[key].short.toLowerCase()).join(' + ')}. Changing dimensions refits the model; it does not just change the view. ${$('standardize').checked ? 'Distances and axes use standardized values.' : 'Distances and axes use original units; feature scales now determine their influence.'}`;
      const warnings = [];
      if (prepared.constantFeatures.length) warnings.push(`Constant features contribute zero distance: ${prepared.constantFeatures.map(key => featureInfo[key].short).join(', ')}.`);
      if (dataset.omitted) warnings.push(`${dataset.omitted} incomplete or duplicate hours were omitted.`);
      showMessage(warnings.join(' '));
      render();
      return true;
    } catch (error) {
      showMessage(error.message, true);
      ['step', 'play', 'finish', 'back', 'reset', 'timeline'].forEach(id => { $(id).disabled = true; });
      return false;
    }
  }

  function ensureCurrentSeed() {
    const seedText = $('seed').value.trim();
    if (!seedText || Number(seedText) !== fittedSeed) return setupRun();
    return frames.length > 0;
  }

  function stageName(frame) {
    if (frame.phase === 'initialize') return 'Initialization';
    if (frame.converged) return 'Stable assignment';
    return `${frame.phase === 'assign' ? 'Assign' : 'Update'} ${frame.iteration}`;
  }

  function renderText() {
    const frame = frames[cursor];
    $('run-settings-summary').textContent = `One initialization · fitted seed ${fittedSeed}`;
    const final = cursor === frames.length - 1;
    $('step').disabled = final;
    $('finish').disabled = final;
    $('back').disabled = cursor === 0;
    $('reset').disabled = cursor === 0;
    $('play').disabled = false;
    $('step').textContent = frame.phase === 'assign' && !frame.converged ? 'Update means →' : 'Assign points →';
    if (final) $('step').textContent = frame.converged ? 'Converged' : 'Iteration limit';
    if (!timer) $('play').textContent = final ? '▶ Replay' : '▶ Play';
    $('timeline').value = cursor;
    $('timeline-label').textContent = stageName(frame);
    $('stage-tag').textContent = frame.converged ? `CONVERGED · ${frame.iteration - 1} MEAN UPDATES` : frame.phase === 'initialize' ? 'START HERE' : `ITERATION ${frame.iteration} · ${frame.phase === 'assign' ? 'ASSIGN' : 'UPDATE'}`;
    $('stage-title').textContent = frame.converged ? 'The memberships are stable' : frame.phase === 'initialize' ? 'Choose starting centers' : frame.phase === 'assign' ? 'Assign to the nearest center' : 'Move to the group means';
    $('stage-explanation').textContent = frame.converged ? 'A fresh assignment changes no memberships. Each nonempty center is already its group’s mean, so another update would leave it unchanged.' : frame.phase === 'initialize' ? 'The data have no class labels. The colored crosses are starting centers; gray points have not yet been assigned.' : frame.phase === 'assign' ? 'Centers stay fixed. Each hour takes the color of its nearest center in the fitted feature space. A point can change groups.' : 'Memberships stay fixed. Each center moves to the coordinate-wise mean of the hours currently assigned to it.';
    const notes = [];
    if (frame.empty.length) notes.push(`Empty ${frame.empty.length === 1 ? 'cluster' : 'clusters'}: ${frame.empty.map(k => k + 1).join(', ')}. Its previous center is retained; interpret the result as fewer than K occupied groups.`);
    if (frame.limited) notes.push('Stopped at the 100-update limit. Convergence has not been established.');
    $('stage-note').textContent = notes.join(' ');
    $('stage-note').hidden = !notes.length;
    $('sse').textContent = frame.sse === null ? '—' : numberFormat.format(frame.sse);
    const previousSSE = cursor ? frames[cursor - 1].sse : null;
    $('sse-change').textContent = frame.sse === null ? 'Defined after the first assignment' : previousSSE === null ? 'First assignment establishes the baseline' : `Change this step: ${numberFormat.format(frame.sse - previousSSE)}`;
    $('secondary-label').textContent = frame.phase === 'update' ? 'Total centroid movement' : frame.phase === 'initialize' ? 'Assigned hours' : frame.iteration === 1 ? 'First assignments' : 'Changed memberships';
    $('secondary-value').textContent = frame.phase === 'update' ? numberFormat.format(frame.shift) : frame.phase === 'initialize' ? '0' : frame.changed.toLocaleString();
    $('secondary-detail').textContent = frame.phase === 'update' ? 'Euclidean norm of all center shifts' : frame.phase === 'initialize' ? 'No assignments yet' : `Out of ${prepared.rows.length.toLocaleString()} hours`;
    $('plot-units').textContent = $('standardize').checked ? 'Standardized coordinates (z-scores)' : 'Original weather units';
    $('projection-controls').hidden = !projected3D();
    $('azimuth-value').textContent = `${$('azimuth').value}°`;
    $('elevation-value').textContent = `${$('elevation').value}°`;
    $('plot-interaction').textContent = projected3D() ? 'Hover to inspect an hour · use azimuth and elevation to rotate the 3D projection' : features.length === 3 ? 'Hover to inspect an hour · drag to rotate' : 'Hover to inspect an hour · drag to zoom';
    $('rain-heading').hidden = features.length !== 3;
    $('profile-explanation').textContent = frame.phase === 'initialize' ? 'These are the sampled starting profiles, not yet group means. Membership counts appear after assignment.' : frame.converged || frame.phase === 'update' ? 'These centers are the coordinate-wise means of their nonempty groups, converted back to original weather units.' : 'These are the current centers. After reassignment, they may differ from the means of their new groups; the next update corrects that.';
    $('profiles-body').replaceChildren();
    frame.centers.forEach((center, k) => {
      const row = document.createElement('tr');
      const label = document.createElement('td');
      const dot = document.createElement('span');
      dot.className = 'cluster-dot'; dot.style.backgroundColor = palette[k];
      label.append(dot, document.createTextNode(`Cluster ${k + 1}`));
      if (frame.labels && frame.counts[k] === 0) { const empty = document.createElement('span'); empty.className = 'cluster-empty'; empty.textContent = 'empty'; label.append(empty); }
      row.append(label);
      const count = document.createElement('td'); count.textContent = frame.labels ? frame.counts[k].toLocaleString() : '—'; row.append(count);
      prepared.inverse(center).forEach((value, j) => { const cell = document.createElement('td'); cell.textContent = formatFixed(value, featureInfo[features[j]].digits); row.append(cell); });
      $('profiles-body').append(row);
    });
  }

  function plotRange(j) {
    const values = prepared.points.map(point => point[j]);
    const min = Math.min(...values), max = Math.max(...values);
    const padding = (max - min || 1) * .09;
    return [min - padding, max + padding];
  }

  function axisTitle(key) { return `${featureInfo[key].short} (${$('standardize').checked ? 'z-score' : featureInfo[key].unit})`; }

  function projectionGeometry() {
    const bounds = [0, 1, 2].map(j => plotRange(j));
    const midpoint = bounds.map(range => (range[0] + range[1]) / 2);
    const radius = Math.sqrt(bounds.reduce((sum, range) => sum + ((range[1] - range[0]) / 2) ** 2, 0)) * 1.18;
    const azimuth = Number($('azimuth').value) * Math.PI / 180;
    const elevation = Number($('elevation').value) * Math.PI / 180;
    const ca = Math.cos(azimuth), sa = Math.sin(azimuth), ce = Math.cos(elevation), se = Math.sin(elevation);
    const project = point => {
      const [x, y, z] = point.map((value, j) => value - midpoint[j]);
      // Orthogonal camera basis: both projected coordinates use the same scale.
      return [ca * x - sa * y, -se * sa * x - se * ca * y + ce * z];
    };
    return { bounds, midpoint, radius, project };
  }

  function projectTraces(traces) {
    const geometry = projectionGeometry();
    traces.forEach(trace => {
      const screen = trace.x.map((x, i) => geometry.project([x, trace.y[i], trace.z[i]]));
      trace.type = 'scatter';
      trace.x = screen.map(point => point[0]);
      trace.y = screen.map(point => point[1]);
      delete trace.z;
    });
    const origin = geometry.bounds.map(range => range[0]);
    const axes = features.map((key, j) => {
      const end = origin.slice(); end[j] = geometry.bounds[j][1];
      const screen = [geometry.project(origin), geometry.project(end)];
      return { type: 'scatter', mode: 'lines+text', showlegend: false,
        x: screen.map(point => point[0]), y: screen.map(point => point[1]),
        line: { color: '#738196', width: 1.4 },
        text: ['', `${['x', 'y', 'z'][j]}: ${axisTitle(key)}`],
        textposition: ['bottom right', 'bottom left', 'top center'][j],
        textfont: { color: '#43546c', size: 10 },
        hovertemplate: `${axisTitle(key)}<br>Axis range: ${formatFixed(geometry.bounds[j][0], 2)} to ${formatFixed(geometry.bounds[j][1], 2)}<extra></extra>` };
    });
    return axes.concat(traces);
  }

  function scatterTraces() {
    const frame = frames[cursor];
    const three = features.length === 3;
    const nativeThree = three && webGLAvailable;
    const type = nativeThree ? 'scatter3d' : 'scatter';
    const traces = [];
    const groups = frame.labels ? frame.centers.map((_, k) => k) : [-1];
    groups.forEach(k => {
      const indices = prepared.rows.map((_, i) => i).filter(i => k < 0 || frame.labels[i] === k);
      const trace = {
        type, mode: 'markers', name: k < 0 ? 'Unassigned hours' : `Cluster ${k + 1}`, showlegend: false,
        x: indices.map(i => prepared.points[i][0]), y: indices.map(i => prepared.points[i][1]),
        marker: { color: k < 0 ? '#9AA5B4' : palette[k], size: nativeThree ? 3.3 : 5.6, opacity: nativeThree ? .68 : .58 },
        customdata: indices.map(i => { const row = prepared.rows[i]; return [hourFormat.format(new Date(row.time * 1000)), row.cloud_cover, row.relative_humidity_2m, row.precipitation]; }),
        hovertemplate: '<b>%{customdata[0]}</b><br>Cloud cover: %{customdata[1]:.1f}%<br>Relative humidity: %{customdata[2]:.1f}%<br>Precipitation: %{customdata[3]:.2f} mm<extra>' + (k < 0 ? 'Unassigned' : `Cluster ${k + 1}`) + '</extra>'
      };
      if (three) trace.z = indices.map(i => prepared.points[i][2]);
      traces.push(trace);
    });
    frame.centers.forEach((center, k) => {
      const trail = frames.slice(0, cursor + 1).filter(item => item.phase !== 'assign').map(item => item.centers[k]);
      if (trail.length > 1) {
        const trace = { type, mode: 'lines+markers', x: trail.map(point => point[0]), y: trail.map(point => point[1]),
          line: { color: palette[k], width: nativeThree ? 5 : 2.5 }, marker: { color: palette[k], size: nativeThree ? 2 : 3.5 },
          hoverinfo: 'skip', showlegend: false };
        if (three) trace.z = trail.map(point => point[2]);
        traces.push(trace);
      }
      const original = prepared.inverse(center);
      const trace = { type, mode: 'markers', x: [center[0]], y: [center[1]], name: `Center ${k + 1}`, showlegend: false,
        marker: { color: palette[k], size: nativeThree ? 10 : 17, symbol: 'x', line: { color: '#fff', width: 1.2 } },
        hovertemplate: `<b>Center ${k + 1}</b><br>Cloud cover: ${formatFixed(original[0], 1)}%<br>Relative humidity: ${formatFixed(original[1], 1)}%${three ? `<br>Precipitation: ${formatFixed(original[2], 2)} mm` : ''}<extra></extra>` };
      if (three) trace.z = [center[2]];
      traces.push(trace);
    });
    return projected3D() ? projectTraces(traces) : traces;
  }

  function scatterLayout() {
    const base = { paper_bgcolor: '#fff', plot_bgcolor: '#fff', margin: { l: 66, r: 18, t: 17, b: 58 },
      font: { family: '-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif', size: 11, color: '#5d687b' },
      showlegend: false, hovermode: 'closest', uirevision: `run-${runNumber}`, dragmode: features.length === 3 && webGLAvailable ? 'orbit' : 'zoom',
      transition: { duration: 0 } };
    const axis = j => ({ title: { text: axisTitle(features[j]), standoff: 12 }, range: plotRange(j), zeroline: true,
      zerolinecolor: '#c2cbd7', gridcolor: '#e9edf2', tickfont: { size: 10 }, automargin: true });
    if (projected3D()) {
      const geometry = projectionGeometry();
      base.margin = { l: 32, r: 32, t: 28, b: 28 };
      const viewAxis = { range: [-geometry.radius, geometry.radius], showgrid: false, zeroline: false, showticklabels: false, fixedrange: true };
      base.xaxis = { ...viewAxis };
      base.yaxis = { ...viewAxis, scaleanchor: 'x', scaleratio: 1, constrain: 'domain' };
      base.dragmode = false;
      base.uirevision = `run-${runNumber}-projected`;
    } else if (features.length === 3) {
      base.margin = { l: 0, r: 0, t: 0, b: 0 };
      base.scene = { xaxis: axis(0), yaxis: axis(1), zaxis: axis(2), aspectmode: 'data',
        camera: { eye: { x: 1.55, y: 1.65, z: 1.05 } }, bgcolor: '#fff', uirevision: `run-${runNumber}` };
    } else {
      base.xaxis = axis(0); base.yaxis = { ...axis(1), scaleanchor: 'x', scaleratio: 1, constrain: 'domain' };
    }
    return base;
  }

  function lossTraces() {
    const visible = frames.slice(1, cursor + 1);
    const traces = [{ type: 'scatter', mode: 'lines+markers', x: visible.map((_, i) => i + 1), y: visible.map(frame => frame.sse),
      line: { color: '#232D4B', width: 2 }, marker: { size: 5, color: visible.map(frame => frame.phase === 'assign' ? '#232D4B' : '#D96A00') },
      text: visible.map(frame => stageName(frame)), hovertemplate: '%{text}<br>SSE: %{y:.3f}<extra></extra>' }];
    if (cursor) traces.push({ type: 'scatter', mode: 'markers', x: [cursor], y: [frames[cursor].sse], marker: { size: 9, color: '#147D80' }, hoverinfo: 'skip' });
    return traces;
  }

  function render() {
    if (!frames.length) return;
    renderText();
    const maxSSE = frames[1].sse;
    const currentRun = runNumber;
    const currentRevision = ++renderRevision;
    // Serialize Plotly updates so rapid slider changes cannot leave a stale chart.
    latestRender = latestRender.catch(() => {}).then(async () => {
      if (currentRun !== runNumber || currentRevision !== renderRevision) return;
      await Promise.all([
        Plotly.react('scatter', scatterTraces(), scatterLayout(), { responsive: true, displaylogo: false,
          modeBarButtonsToRemove: ['select2d', 'lasso2d', 'autoScale2d'], toImageButtonOptions: { format: 'png', filename: 'ds6021-kmeans-weather', scale: 2 } }),
        Plotly.react('loss', lossTraces(), { margin: { l: 49, r: 12, t: 12, b: 34 }, paper_bgcolor: '#fff', plot_bgcolor: '#fff',
          font: { family: '-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif', size: 10, color: '#5d687b' }, showlegend: false,
          xaxis: { title: { text: 'Assignment / update step', standoff: 5 }, range: [.6, Math.max(4.4, cursor + .5)], dtick: cursor < 10 ? 1 : undefined, gridcolor: '#eef0f4', fixedrange: true },
          yaxis: { range: [0, maxSSE * 1.08 || 1], gridcolor: '#eef0f4', fixedrange: true, zeroline: false },
          annotations: cursor === 0 ? [{ text: 'SSE appears after assignment', x: .5, y: .5, xref: 'paper', yref: 'paper', showarrow: false, font: { size: 10, color: '#7d8797' } }] : [],
          transition: { duration: 0 } }, { responsive: true, displayModeBar: false })
      ]);
    }).catch(error => {
      if (features.length === 3 && webGLAvailable) {
        webGLAvailable = false;
        Plotly.purge('scatter');
        render();
      } else showMessage(`The chart could not render: ${error.message}`, true);
    });
  }

  function moveTo(value) {
    cursor = Math.max(0, Math.min(frames.length - 1, value));
    if (cursor >= frames.length - 1) pause();
    render();
  }

  function play() {
    if (!ensureCurrentSeed()) return;
    if (timer !== null) { pause(); return; }
    if (cursor === frames.length - 1) moveTo(0);
    $('play').textContent = 'Ⅱ Pause';
    timer = setInterval(() => moveTo(cursor + 1), Number($('speed').value));
  }

  async function refresh() {
    if (pendingFetch) return;
    pause(); pendingFetch = true;
    $('refresh').disabled = true; $('refresh').textContent = 'Fetching recent weather…';
    $('snapshot').disabled = true;
    showMessage('Fetching 60 completed UTC days of model-based weather estimates. The current dataset stays available until the response is ready.');
    try {
      const refreshed = parseAPI(await fetchJSON(endpoint));
      dataset = refreshed; sourceMode = 'refreshed';
      describeData(); setupRun();
      showMessage(`Loaded ${dataset.rows.length.toLocaleString()} complete weather hours. Model fitting has restarted with the current settings.`);
    } catch (error) {
      const reason = error.name === 'AbortError' ? 'The request timed out.' : error.message;
      showMessage(`Refresh did not complete. ${reason} The ${sourceMode === 'snapshot' ? 'saved snapshot' : 'previously loaded data'} remains active. You can continue the lesson or try again.`, true);
    } finally {
      pendingFetch = false; $('refresh').disabled = false; $('refresh').textContent = 'Refresh past 60 days'; $('snapshot').disabled = !saved;
    }
  }

  function download() {
    if (!dataset) return;
    const keys = ['cloud_cover', 'relative_humidity_2m', 'precipitation', 'temperature_2m', 'weather_code'];
    const lines = ['time_utc,' + keys.join(',')].concat(dataset.rows.map(row => new Date(row.time * 1000).toISOString() + ',' + keys.map(key => row[key] == null ? '' : row[key]).join(',')));
    const blob = new Blob([lines.join('\n') + '\n'], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = `charlottesville-weather-${sourceMode}.csv`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  settings.forEach(id => $(id).addEventListener('change', setupRun));
  $('seed').addEventListener('input', setupRun);
  $('step').addEventListener('click', () => { if (!ensureCurrentSeed()) return; pause(); moveTo(cursor + 1); });
  $('back').addEventListener('click', () => { pause(); moveTo(cursor - 1); });
  $('reset').addEventListener('click', () => { pause(); moveTo(0); });
  $('finish').addEventListener('click', () => { if (!ensureCurrentSeed()) return; pause(); moveTo(frames.length - 1); });
  $('timeline').addEventListener('input', () => { pause(); moveTo(Number($('timeline').value)); });
  $('play').addEventListener('click', play);
  $('speed').addEventListener('change', () => { if (timer !== null) { pause(); play(); } });
  $('refresh').addEventListener('click', refresh);
  $('download').addEventListener('click', download);
  ['azimuth', 'elevation'].forEach(id => $(id).addEventListener('input', render));
  $('snapshot').addEventListener('click', () => { if (saved && !pendingFetch) { pause(); dataset = saved; sourceMode = 'snapshot'; describeData(); setupRun(); } });
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });

  // Read-only state inspection supports reproducing and checking the teaching run.
  window.KMeansLab = { getState: () => ({ sourceMode, cursor, features: features.slice(), standardize: $('standardize').checked,
    k: Number($('clusters').value), seed: fittedSeed, requestedSeed: $('seed').value, rowCount: prepared ? prepared.rows.length : 0,
    view: projected3D() ? 'orthographic-3d' : features.length === 3 ? 'native-3d' : '2d',
    azimuth: Number($('azimuth').value), elevation: Number($('elevation').value),
    frame: frames[cursor] ? JSON.parse(JSON.stringify(frames[cursor])) : null,
    history: frames.map(frame => ({ phase: frame.phase, iteration: frame.iteration, sse: frame.sse, converged: frame.converged, limited: frame.limited })) }) };

  (async function start() {
    try {
      if (typeof Plotly === 'undefined') throw new Error('The local Plotly library did not load. Reload this page from the course website.');
      webGLAvailable = supportsWebGL();
      saved = validateData(await fetchJSON('weather-snapshot.json'));
      dataset = saved; sourceMode = 'snapshot';
      settings.forEach(id => { $(id).disabled = false; });
      ['refresh', 'snapshot', 'download'].forEach(id => { $(id).disabled = false; });
      describeData(); setupRun();
    } catch (error) {
      $('data-badge').textContent = 'DATA UNAVAILABLE';
      $('data-description').textContent = 'The saved dataset could not be loaded.';
      showMessage(`${error.message} Open this dashboard through its GitHub Pages link (or a local web server), then reload.`, true);
    }
  })();
})();
