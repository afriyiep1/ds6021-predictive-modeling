import pandas as pd
import numpy as np
import plotly.express as px
import plotly.graph_objects as go
from sklearn.model_selection import train_test_split
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler, PolynomialFeatures, SplineTransformer
from sklearn.linear_model import LinearRegression
from sklearn.metrics import mean_squared_error, r2_score

# Upload Startups.csv. This illustration uses RD as its only predictor.
startups = pd.read_csv("Startups.csv")
X = startups[["RD"]]
y = startups["Profit"]
X_train, X_test, y_train, y_test = train_test_split(
    X, y, test_size=0.3, random_state=6021
)
models = {
    "Linear": make_pipeline(StandardScaler(), LinearRegression()),
    "Poly 3": make_pipeline(StandardScaler(),
                           PolynomialFeatures(3, include_bias=False),
                           LinearRegression()),
    "Poly 8": make_pipeline(StandardScaler(),
                           PolynomialFeatures(8, include_bias=False),
                           StandardScaler(), LinearRegression()),
    "Spline": make_pipeline(SplineTransformer(n_knots=8, degree=3,
                                             include_bias=False),
                           StandardScaler(), LinearRegression())
}
# The first scaler helps numerical stability before polynomial expansion.
# The second standardizes the expanded features; it is not essential for OLS.
rows = []
grid = pd.DataFrame({"RD": np.linspace(X_train["RD"].min(), X_train["RD"].max(), 200)})
for name, model in models.items():
    model.fit(X_train, y_train)
    y_hat = model.predict(X_test)
    rows.append({"Model": name,
                 "Test RMSE": np.sqrt(mean_squared_error(y_test, y_hat)),
                 "Test R²": r2_score(y_test, y_hat)})
    fig = go.Figure()
    fig.add_trace(go.Scatter(x=X_train["RD"], y=y_train,
                             mode="markers", name="Train"))
    fig.add_trace(go.Scatter(x=X_test["RD"], y=y_test,
                             mode="markers", name="Test"))
    fig.add_trace(go.Scatter(x=grid["RD"], y=model.predict(grid),
                             mode="lines", name=name))
    fig.update_layout(title=name, xaxis_title="RD", yaxis_title="Profit")
    fig.show()
    fig = px.scatter(x=y_test, y=y_hat,
                     labels={"x": "Observed profit", "y": "Predicted profit"},
                     title=f"{name}: test observations")
    limits = [min(y_test.min(), y_hat.min()), max(y_test.max(), y_hat.max())]
    fig.add_trace(go.Scatter(x=limits, y=limits, mode="lines",
                             name="Perfect prediction", line={"dash": "dash"}))
    fig.show()

results = pd.DataFrame(rows)
print(results.round(2))
# No true f(x) is known here, so these results do not identify bias² separately.
