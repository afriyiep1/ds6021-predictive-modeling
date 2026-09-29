import numpy as np
import matplotlib.pyplot as plt

# Synthetic independent groups, not the class experiment's results.
rng = np.random.default_rng(6021)
a = rng.normal(20, 5, size=80)
b = rng.normal(22, 5, size=80)
B = 2000  # Try 200 or 5000; this does not change sample size.
effects = []
for _ in range(B):
    a_star = rng.choice(a, size=len(a), replace=True)
    b_star = rng.choice(b, size=len(b), replace=True)
    effects.append(b_star.mean() - a_star.mean())
lo, hi = np.quantile(effects, [0.025, 0.975])
print(f"Estimated difference B - A: {b.mean() - a.mean():.3f}")
print(f"Bootstrap standard error: {np.std(effects, ddof=1):.3f}")
print(f"Percentile 95% interval: [{lo:.3f}, {hi:.3f}]")
plt.figure(figsize=(8, 4))
plt.hist(effects, bins=35, color="#276582", alpha=0.8)
plt.axvline(0, color="black", linestyle=":", label="No difference")
plt.axvline(lo, color="#cf591d", linestyle="--", label="95% endpoints")
plt.axvline(hi, color="#cf591d", linestyle="--")
plt.xlabel("Difference in mean outcome (B - A)")
plt.ylabel("Bootstrap repetitions")
plt.legend()
plt.tight_layout()
plt.show()
