import pandas as pd
import plotly.express as px

# Upload PlanetsData.csv to Colab first.
planets = pd.read_csv("PlanetsData.csv")
print(planets.head())
print(planets.dtypes)
print(planets.isna().sum())
print(planets.describe())

px.bar(planets, x="planet", y="distance",
       title="Inspect the range before fitting a model").show()
px.scatter(planets, x="distance", y="revolution", text="planet",
           title="Distance and revolution period").show()
# What does one row represent? What shape do you see?
