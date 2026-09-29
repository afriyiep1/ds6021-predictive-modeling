import pandas as pd
import numpy as np
import plotly.express as px
from sklearn.linear_model import LinearRegression
from sklearn.compose import ColumnTransformer
from sklearn.preprocessing import OneHotEncoder
from sklearn.pipeline import make_pipeline

# Upload insurance.csv. Begin with the numerical-predictor model.
insurance = pd.read_csv("insurance.csv")
X = insurance[["age", "bmi", "children"]]
y = insurance["charges"]
model = LinearRegression().fit(X, y)
print(pd.Series(model.coef_, index=X.columns))

rng = np.random.default_rng(123)
coefficients = []
for i in range(500):
    rows = rng.choice(len(insurance), size=len(insurance), replace=True)
    bootstrap_model = LinearRegression().fit(X.iloc[rows], y.iloc[rows])
    coefficients.append(bootstrap_model.coef_)

bootstrap = pd.DataFrame(coefficients, columns=X.columns)
print("Bootstrap standard errors:")
print(bootstrap.std())
print("Percentile 95% confidence intervals:")
print(bootstrap.quantile([0.025, 0.975]))
px.histogram(bootstrap, x="bmi", nbins=30,
             title="Bootstrap BMI coefficients").show()

# Extend to categorical predictors; retain all observations for this lesson.
numeric = ["age", "bmi", "children"]
categorical = ["sex", "smoker", "region"]
X_full = insurance[numeric + categorical]
preprocessor = ColumnTransformer([
    ("numeric", "passthrough", numeric),
    ("category", OneHotEncoder(drop="first", handle_unknown="ignore"), categorical)
])
full_model = make_pipeline(preprocessor, LinearRegression()).fit(X_full, y)
y_hat = full_model.predict(X_full)
r2 = full_model.score(X_full, y)
p = full_model.named_steps["columntransformer"].transform(X_full).shape[1]
adjusted_r2 = 1 - (1 - r2) * (len(y) - 1) / (len(y) - p - 1)
print("Training R²:", r2, "Adjusted R²:", adjusted_r2)
fig = px.scatter(x=y_hat, y=y - y_hat,
                 labels={"x": "Fitted charges", "y": "Residual"})
fig.add_hline(y=0, line_dash="dash")
fig.show()
# These fit statistics do not measure prediction performance on new patients.
