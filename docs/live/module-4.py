import pandas as pd
import matplotlib.pyplot as plt
from sklearn.linear_model import LinearRegression

insurance = pd.read_csv("insurance.csv")
predictors = ["age", "bmi", "children"]  # Try removing one predictor.
X = insurance[predictors]
y = insurance["charges"]
model = LinearRegression().fit(X, y)
predicted = model.predict(X)
print(f"Intercept: {model.intercept_:.3f}")
print(pd.Series(model.coef_, index=predictors, name="Coefficient").round(3).to_string())
r2 = model.score(X, y)
n, p = X.shape
adjusted = 1 - (1 - r2) * (n - 1) / (n - p - 1)
print(f"Training R-squared: {r2:.4f}; adjusted: {adjusted:.4f}")
plt.figure(figsize=(8, 4))
plt.scatter(predicted, y - predicted, alpha=0.4, color="#276582")
plt.axhline(0, color="#cf591d")
plt.xlabel("Predicted charges")
plt.ylabel("Observed - predicted charges")
plt.title("Residual structure remains despite multiple predictors")
plt.tight_layout()
plt.show()
