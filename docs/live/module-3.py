import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
from sklearn.linear_model import LinearRegression

planets = pd.read_csv("PlanetsData.csv")
X = planets[["distance"]]
y = planets["revolution"]
model = LinearRegression().fit(X, y)
predicted = model.predict(X)
x_new = 2200  # Change this distance, in the dataset's units.
new_prediction = model.predict(pd.DataFrame({"distance": [x_new]}))[0]
print(f"Intercept: {model.intercept_:.3f}")
print(f"Slope: {model.coef_[0]:.3f}")
print(f"Predicted period at distance {x_new}: {new_prediction:.3f}")
print(f"Training SSE: {np.sum((y - predicted)**2):.3f}")
fig, axes = plt.subplots(1, 2, figsize=(10, 4))
axes[0].scatter(X["distance"], y, color="#276582")
axes[0].plot(X["distance"], predicted, color="#cf591d")
axes[0].set(xlabel="Distance", ylabel="Period", title="OLS fitted line")
axes[1].scatter(predicted, y - predicted, color="#276582")
axes[1].axhline(0, color="#cf591d")
axes[1].set(xlabel="Fitted period", ylabel="Observed - fitted", title="Look for curvature")
plt.tight_layout()
plt.show()
