import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
from sklearn.linear_model import LinearRegression

planets = pd.read_csv("PlanetsData.csv")
X = np.log(planets[["distance"]])
y = np.log(planets["revolution"])
model = LinearRegression().fit(X, y)
percent_increase = 10  # Try 1 or 100.
slope = model.coef_[0]
change = 100 * ((1 + percent_increase / 100)**slope - 1)
print(f"Fitted log-log slope: {slope:.6f}")
print("Kepler's predicted slope: 1.500000")
print(f"{percent_increase}% greater distance: {change:.3f}% greater fitted period")
earth = planets.loc[planets["planet"] == "Earth"].iloc[0]
x = np.log(planets["distance"] / earth["distance"])
y_ratio = np.log(planets["revolution"] / earth["revolution"])
plt.figure(figsize=(8, 4))
plt.scatter(x, y_ratio, color="#276582", label="Nine supplied bodies")
plt.plot(x, 1.5 * x, color="#cf591d", label="Kepler: slope 1.5")
plt.xlabel("log(distance / Earth distance)")
plt.ylabel("log(period / Earth period)")
plt.legend()
plt.tight_layout()
plt.show()
