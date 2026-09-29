import pandas as pd
import matplotlib.pyplot as plt

planets = pd.read_csv("PlanetsData.csv")
variable = "revolution"  # Try "distance" or "diameter".
print(planets[["planet", variable]].to_string(index=False))
print("\nNumerical summary:")
print(planets[variable].describe().round(2).to_string())
plt.figure(figsize=(8, 4))
plt.bar(planets["planet"], planets[variable], color="#276582")
plt.ylabel(variable + " (dataset units)")
plt.xticks(rotation=40)
plt.title("Inspect the distribution before modeling")
plt.tight_layout()
plt.show()
