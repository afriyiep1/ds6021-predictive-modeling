import pandas as pd
import numpy as np
import plotly.express as px
import plotly.graph_objects as go
from sklearn.linear_model import LinearRegression

# Upload insurance.csv and PlanetsData.csv.
insurance = pd.read_csv("insurance.csv")
insurance["S"] = (insurance["smoker"] == "yes").astype(int)
insurance["bmi_smoker"] = insurance["bmi"] * insurance["S"]
y = insurance["charges"]

for name, columns in {
    "Additive": ["bmi", "S"],
    "Interaction": ["bmi", "S", "bmi_smoker"]
}.items():
    model = LinearRegression().fit(insurance[columns], y)
    print(name, "Intercept:", model.intercept_)
    print(pd.Series(model.coef_, index=columns))
    fig = px.scatter(insurance, x="bmi", y="charges", color="smoker",
                     opacity=0.4, title=name)
    for s, label in [(0, "no"), (1, "yes")]:
        group = insurance[insurance["S"] == s].sort_values("bmi")
        fig.add_trace(go.Scatter(x=group["bmi"],
                                 y=model.predict(group[columns]),
                                 mode="lines", name=f"Fitted: {label}"))
    fig.show()

planets = pd.read_csv("PlanetsData.csv")
# All distance and revolution values in this file are positive.
planets["log_distance"] = np.log(planets["distance"])
planets["log_revolution"] = np.log(planets["revolution"])
log_model = LinearRegression().fit(planets[["log_distance"]],
                                    planets["log_revolution"])
planets["fitted_log"] = log_model.predict(planets[["log_distance"]])
print("Log–log slope:", log_model.coef_[0])
print("Exact % curve change for 10% more distance:",
      100 * (1.10 ** log_model.coef_[0] - 1))
fig = px.scatter(planets, x="log_distance", y="log_revolution", hover_name="planet")
fig.add_trace(go.Scatter(x=planets["log_distance"], y=planets["fitted_log"],
                         mode="lines", name="Log–log fit"))
fig.show()
fig = px.scatter(x=planets["fitted_log"],
                 y=planets["log_revolution"] - planets["fitted_log"],
                 labels={"x": "Fitted log(revolution)", "y": "Log residual"})
fig.add_hline(y=0, line_dash="dash")
fig.show()
# exp(fitted_log) is not automatically the conditional arithmetic mean.
