import numpy as np
import plotly.express as px

# Synthetic independent observations, not the Lab 1 dataset.
rng = np.random.default_rng(123)
a = rng.normal(50, 10, 80)
b = rng.normal(54, 10, 80)

bootstrap_differences = []
for i in range(2000):
    b_sample = rng.choice(b, size=len(b), replace=True)
    a_sample = rng.choice(a, size=len(a), replace=True)
    bootstrap_differences.append(b_sample.mean() - a_sample.mean())

ci = np.percentile(bootstrap_differences, [2.5, 97.5])
print("Observed mean(B) - mean(A):", b.mean() - a.mean())
print("95% percentile bootstrap CI:", ci)

fig = px.histogram(x=bootstrap_differences, nbins=30,
                   labels={"x": "Bootstrap mean(B) - mean(A)"})
fig.add_vline(x=ci[0], line_dash="dash")
fig.add_vline(x=ci[1], line_dash="dash")
fig.show()
# The interval targets a difference in population means, not an individual outcome.
