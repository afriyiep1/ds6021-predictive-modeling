import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
from sklearn.linear_model import LinearRegression
from sklearn.model_selection import train_test_split
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler, PolynomialFeatures, SplineTransformer
from sklearn.metrics import mean_squared_error, r2_score

startups = pd.read_csv("Startups.csv")
X = startups[["RD"]]
y = startups["Profit"]
seed = 6021  # Try another seed to see sensitivity to one split.
X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.30, random_state=seed)
models = {
    "Linear": make_pipeline(StandardScaler(), LinearRegression()),
    "Poly 3": make_pipeline(StandardScaler(), PolynomialFeatures(3, include_bias=False), StandardScaler(), LinearRegression()),
    "Poly 8": make_pipeline(StandardScaler(), PolynomialFeatures(8, include_bias=False), StandardScaler(), LinearRegression()),
    "Spline": make_pipeline(StandardScaler(), SplineTransformer(n_knots=8, degree=3), LinearRegression())
}
rows = []
fig, axes = plt.subplots(2, 2, figsize=(9, 7))
for ax, (name, model) in zip(axes.flat, models.items()):
    model.fit(X_train, y_train)
    predicted = model.predict(X_test)
    rows.append({"Model": name, "Test RMSE": np.sqrt(mean_squared_error(y_test, predicted)), "Test R2": r2_score(y_test, predicted)})
    ax.scatter(y_test, predicted, color="#276582")
    low, high = min(y_test.min(), predicted.min()), max(y_test.max(), predicted.max())
    ax.plot([low, high], [low, high], "--", color="#cf591d")
    ax.set(title=name, xlabel="Observed profit", ylabel="Predicted profit")
print(pd.DataFrame(rows).round(3).to_string(index=False))
print("These scores assess one held-out split, not cross-validation.")
plt.tight_layout()
plt.show()
