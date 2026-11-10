# KMeans weather lab

An interactive companion to DS 6021's unsupervised-learning notes, using hourly weather near Charlottesville, Virginia.

## Open the materials

- Dashboard: <https://afriyiep1.github.io/ds6021-predictive-modeling/kmeans/>
- Lecture: `downloads/KMeans_Weather_Notes.pdf`
- Standalone Beamer source: `downloads/KMeans_Weather_Notes.tex`
- Colab notebook: `downloads/KMeans_Weather_Colab.ipynb`
- Exact saved data: `weather-snapshot.csv` and `weather-snapshot.json`
- Provider response: `open-meteo-source.json`
- Provenance and units: `weather-metadata.json`

The dashboard is plain HTML, CSS, and JavaScript, served from the repository's existing `main` → `/docs` GitHub Pages configuration. It uses the course's local Plotly distribution. It needs no build system, secret, Python server, or scheduled job. Serve `/docs` with any static HTTP server for local development; opening the HTML directly as a `file:` URL may block the snapshot fetch.

## Dataset and scope

The saved dataset contains 1,440 hourly **model-based estimates** from the Open-Meteo Forecast API, covering September 11, 2026, 00:00 UTC through November 9, 2026, 23:00 UTC. The requested location is Charlottesville (38.0293, −78.4767); the returned model grid point is recorded in the metadata. Data were retrieved November 10, 2026, 14:44:57 UTC. These are not direct station observations.

One row is one hour. Two-dimensional fitting uses cloud cover (%) and relative humidity at 2 m (%). Three-dimensional fitting also uses preceding-hour total precipitation (mm). Temperature, weather code, and time are context, not clustering inputs. Precipitation includes rain, showers, and snow water equivalent.

“Refresh past 60 days” calls the provider on demand and retrieves 60 completed UTC days. It changes the active data in that browser session; it does not overwrite the saved repository snapshot. A failed refresh leaves the active dataset usable and reports the failure. “Use saved snapshot” restores the exact classroom example. The active-data download contains the data used for the current run.

Unix timestamps are kept in UTC. Display labels use America/New_York so the repeated hour at the November daylight-saving transition is handled correctly. This is why the first displayed local date is September 10 while the first UTC date is September 11.

Attribution: Weather data by [Open-Meteo.com](https://open-meteo.com/), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Data were reformatted and clustered for teaching. [API documentation](https://open-meteo.com/en/docs).

## Suggested classroom sequence

1. Begin with 2D, K=3, standardization on, and random seed 6021. Ask students what one point represents and what information the algorithm does not receive.
2. Click **Assign points**. Centers stay fixed; labels/colors change. Ask which center each point chooses.
3. Click **Update means**. Labels stay fixed; centers move to coordinatewise means. Explain why this cannot increase total squared error.
4. Use playback, the back button, or the history slider to inspect the same recorded states. Axes stay fixed during a run, and the loss chart uses the current assignments and centers.
5. Finish the default 2D run, then switch initialization to KMeans++ while keeping the same seed. The fixed snapshot gives SSE about 1008.34 and 559.35, respectively. Convergence alone does not establish a global optimum.
6. Switch to 3D. This refits using precipitation; it is not a projection of the 2D fit. Rotate the view and compare the new profiles. With the saved snapshot, KMeans++ and seed 42 reproduce the notebook's three-feature partition up to cluster-ID names (SSE about 1556.32). If WebGL is unavailable, the software 3D projection still fits all three coordinates and provides rotation controls.
7. Change K, scaling, or the seed, one at a time. Interpret centers in raw units, and ask whether the groups are useful for the question.
8. Use the notebook's multiple-start fits, elbow plot, and silhouette plot to evaluate the decisions more systematically.

The notebook uses `KMeans(init="k-means++", n_init=20, random_state=6021, algorithm="lloyd", tol=0, max_iter=300)`. Its 3D fit yields groups of 954, 474, and 12 hours, with arbitrary numerical IDs. Their mean cloud cover/humidity/precipitation are approximately (6.24%, 62.12%, 0 mm), (91.79%, 85.82%, 0.044 mm), and (100%, 94.42%, 4.042 mm). There are 32 nonzero-precipitation hours in the larger cloudy group, plus 12 in the wetter group. Do not rename these three clusters as guaranteed sunny/cloudy/rainy classes.

The dashboard illustrates **one initialization**. Its final result need not equal the notebook's best of 20 starts. Its random generator differs from NumPy/scikit-learn, and its KMeans++ implements standard D-squared sampling rather than scikit-learn's greedy variant. Equal seed numbers across implementations do not imply equal starting centers.

## Algorithm details

`kmeans.js` contains the numerical core. Each history frame is an actual initialization, assignment, or mean-update state; movement is not invented between algorithm steps. The objective is total squared Euclidean distance to the currently assigned center. Before the first assignment it is undefined.

- Standardization uses population standard deviations (`ddof=0`), as in `StandardScaler`.
- A constant standardized feature becomes zero.
- Exact distance ties go to the lowest-index center.
- An empty cluster retains its previous center and is flagged in the interface.
- A run stops when a fresh assignment changes no memberships, or after 100 mean updates with an explicit limit message.
- Random initialization samples distinct profiles to avoid duplicate initial center coordinates.
- Cluster IDs remain fixed through a run. Switching settings starts a fresh run.
- Inertia values from different datasets, dimensions, or scaling choices should not be compared directly.

The included numerical checks run with:

```bash
node tests/kmeans-core.test.cjs
```

They verify the hand-calculated example, non-increasing SSE, deterministic ties, empty clusters, constant features, duplicate profiles, stopping behavior, and real-data runs in both dimensions. The implementation has also been compared with scikit-learn using identical initial centers.

## Lecture notes

The `.tex` source embeds its plot data, so it compiles without separate image assets:

```bash
pdflatex KMeans_Weather_Notes.tex
pdflatex KMeans_Weather_Notes.tex
```

The lecture preserves the earlier deck's plain Beamer structure, adds the weather motivation and KNN/OLS connections, and separates optional gap-statistic and hierarchical-clustering material from the core narrative. Speaker notes are included in the source. Code belongs in the companion notebook.
