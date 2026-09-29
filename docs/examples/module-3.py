import pandas as pd
import numpy as np
import plotly.express as px
import plotly.graph_objects as go
from sklearn.linear_model import LinearRegression

# Upload PlanetsData.csv first. Use all observations for this fitting example.
planets = pd.read_csv("PlanetsData.csv")
X = planets[["distance"]]
y = planets["revolution"]
model = LinearRegression().fit(X, y)
planets["y_hat"] = model.predict(X)
planets["residual"] = y - planets["y_hat"]
print("Intercept:", model.intercept_, "Slope:", model.coef_[0])
print("SSE:", np.sum(planets["residual"] ** 2))

ordered = planets.sort_values("distance")
fig = px.scatter(planets, x="distance", y="revolution", hover_name="planet")
fig.add_trace(go.Scatter(x=ordered["distance"], y=ordered["y_hat"],
                         mode="lines", name="OLS"))
fig.show()
fig = px.scatter(planets, x="y_hat", y="residual", hover_name="planet")
fig.add_hline(y=0, line_dash="dash")
fig.show()

# Gradient descent on a standardized predictor.
x = (X["distance"].to_numpy() - X["distance"].mean()) / X["distance"].std(ddof=0)
y_values = y.to_numpy()
b0, b1 = 0.0, 0.0
learning_rate = 0.05
for i in range(1000):
    error = b0 + b1 * x - y_values
    gradient_0 = 2 * error.mean()
    gradient_1 = 2 * np.mean(error * x)
    b0 = b0 - learning_rate * gradient_0
    b1 = b1 - learning_rate * gradient_1

# Convert back to the original distance units before comparing coefficients.
slope_original = b1 / X["distance"].std(ddof=0)
intercept_original = b0 - slope_original * X["distance"].mean()
print("GD coefficients on original scale:", intercept_original, slope_original)
