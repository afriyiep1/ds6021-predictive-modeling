# Weather learning lab: KMeans, KNN, and multinomial logit

An interactive companion to DS 6021's clustering and classification lessons, using hourly weather near Charlottesville, Virginia. The KMeans tab illustrates unlabeled grouping; KNN and multinomial logit predict a provider-defined weather category from the same weather measurements.

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

## Place starting centroids

The KMeans tab retains random distinct observations and KMeans++ and adds two choices:

- **Place centers myself:** choose K, select this initialization, then click positions in the 2D plot or enter coordinates in original weather units. Choose a numbered center to move it. In 3D, select an observed weather point or enter its three coordinates. The run begins only after all K distinct, valid centers are supplied and **Start from these centers** is pressed.
- **Randomize centers:** choose a new visible seed and sample positions across the feature ranges. This intentionally allows starting centers between observations. The new run begins with gray, unassigned points. The named initialization is **Random positions in feature space**.

Cloud cover and humidity coordinates must be between 0 and 100; precipitation must be nonnegative. Manual coordinates are transformed using the active KMeans scaling. Axes include valid user centers that fall outside the observed data range. Changing K, dimensions, scaling, or the dataset starts a new setup. Switching tabs preserves each model's settings and pauses KMeans playback.

## Supervised target and evaluation

Both supervised tabs use the provider's existing `weather_code` as the outcome, grouped for teaching:

| Class | Open-Meteo weather codes | Saved hours |
| --- | --- | ---: |
| Clear / mainly clear | 0, 1 | 962 |
| Partly cloudy | 2 | 58 |
| Overcast | 3 | 364 |
| Fog or precipitation | 45, 48, documented drizzle/rain/snow/shower/thunderstorm codes | 56 |

The mapping follows the [provider's WMO interpretation table](https://open-meteo.com/en/docs). Unknown or missing codes are omitted with a visible count. The final broad category combines fog and precipitation to avoid tiny individual outcome groups; it does not imply that fog always brings precipitation. The code is excluded from the predictors. The target is fixed independently of KMeans and does not change when the number of clusters or their starting centers changes. KMeans cluster IDs have no fixed correspondence to supervised class IDs.

**Question:** classify the provider's weather category for an hour from that hour's cloud cover and humidity (plus precipitation in 3D). This is a demonstration of same-hour classification, not future weather forecasting. Predictor values and outcome codes come from the same provider's weather model and are related by construction; this is not independent validation against station observations. Adding precipitation makes part of the weather-code definition directly available to the classifier.

The split is chronological by complete UTC days, with the latest 20% held out. On the saved snapshot:

- Training: September 11–October 28, 2026 UTC; 48 days and 1,152 hours; class counts `[738, 45, 320, 49]`.
- Test: October 29–November 9, 2026 UTC; 12 days and 288 hours; class counts `[224, 13, 44, 7]`.

Both classifiers use this exact split. Standardization is fitted only on training hours and then applied to test hours and plot queries. No outcome labels from the test period enter fitting. Hours within a day stay together, although weather remains serially correlated across day boundaries. If a class is absent from a refreshed split, support and metric limitations are reported rather than silently manufacturing examples.

The side panel reports test error rate, accuracy, balanced accuracy, macro F1, and multiclass log loss, plus training comparisons and a baseline that always predicts the training period's most frequent class. Confusion matrices have **predicted classes in rows and actual classes in columns**. Per-class counts help interpret the imbalanced categories. KMeans SSE and classification error measure different things and should not be compared numerically.

In 2D, shaded regions show predicted classes and points can be colored by actual or predicted class. Errors are marked independently of the color choice. In 3D, all three predictors enter fitting; a rotatable orthographic projection displays the three-dimensional points without requiring WebGL. Clicking a test hour shows its predicted probabilities. KNN additionally identifies the selected hour's training neighbors.

KNN uses uniform votes among k nearest training observations in the chosen Euclidean feature space. Equal-distance neighbor ties select the earlier chronological training row; tied class votes select the lowest class ID. Training scores use ordinary resubstitution, with the queried training row among the candidate neighbors. Zero class probabilities are clipped at 1e-15 and renormalized only for evaluating log loss; the displayed votes remain unchanged.

Multinomial logistic regression fits class probabilities jointly with softmax and an adjustable L2 penalty. Its objective is mean multinomial log loss + lambda/2 × sum of squared class slopes, with unpenalized intercepts. A damped Newton method with a backtracking line search reports convergence using maximum absolute gradient ≤1e-8 or a limit/status message. This is equivalent to scikit-learn multinomial logistic regression with `C = 1 / (lambda * n_train)`. The default lambda=.01 is a demonstration setting, not a value selected using test performance.

Numerical fitting and scoring are implemented in `supervised-core.js`. The default saved-snapshot results are:

| Model | Predictors | Test error | Test accuracy | Balanced accuracy | Macro F1 | Log loss |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| KNN, k=15 | 2D | 3.82% | 96.18% | 67.31% | .6839 | .3248 |
| Multinomial logit, lambda=.01 | 2D | 6.94% | 93.06% | 50.00% | .4673 | .2157 |
| KNN, k=15 | 3D | 3.13% | 96.88% | 74.45% | .8000 | .6397 |
| Multinomial logit, lambda=.01 | 3D | 6.60% | 93.40% | 53.57% | .5321 | .2061 |

All four fits standardize using training data only. The majority-class baseline achieves 77.78% test accuracy. Accuracy and log loss need not rank models alike: a few confident wrong probabilities can substantially increase log loss. The default 2D logistic model predicts neither small category as its most likely class; balanced accuracy reveals this despite high overall accuracy. These are descriptive classroom results on a single held-out period.

These interactive test results support classroom exploration. Repeatedly choosing settings based on these results uses the held-out period for model selection; a formal analysis should use validation data and retain a separate final test period.

## Compare the learning tasks in class

1. In KMeans, place several centers close together and ask where they will move. Repeat with spread-out centers. Compare final SSE while keeping the dataset, K, dimensions, and scaling fixed.
2. Interpret the final raw-unit centroids. Ask why two clear-sky clusters can differ in humidity even though they share one supervised weather category.
3. Open KNN. Inspect the actual class colors and decision regions. Click a test hour to connect its prediction to the neighbors' votes. Vary k and compare training and test error.
4. Open multinomial logit with the same features. Inspect its decision regions and probability estimates. Ask how these differ from local neighbor votes.
5. Add precipitation to both classifiers. Explain why same-hour precipitation can help identify a weather-code category, and why this does not demonstrate an ability to forecast tomorrow's weather.
6. Inspect the confusion matrices and balanced accuracy: the numerous clear hours can make overall accuracy look strong while rare conditions are poorly recognized.

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
node tests/supervised-core.test.cjs
```

They verify the hand-calculated example, non-increasing SSE, deterministic ties, empty clusters, constant features, duplicate profiles, stopping behavior, and real-data runs in both dimensions. The implementation has also been compared with scikit-learn using identical initial centers.

## Lecture notes

The `.tex` source embeds its plot data, so it compiles without separate image assets:

```bash
pdflatex KMeans_Weather_Notes.tex
pdflatex KMeans_Weather_Notes.tex
```

The lecture preserves the earlier deck's plain Beamer structure, adds the weather motivation and KNN/OLS connections, and separates optional gap-statistic and hierarchical-clustering material from the core narrative. Speaker notes are included in the source. Code belongs in the companion notebook.
