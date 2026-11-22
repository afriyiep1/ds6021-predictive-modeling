"""Build the DS 6021 NBA Plotly dashboard for GitHub Pages.

Course example: simple pandas + scikit-learn with Plotly visualizations.

Run: python build_dashboard.py

Pandas prepares the data, scikit-learn fits the logistic pipelines on training
team-games, and this script writes a static HTML page. In the published page,
Plotly and small JavaScript functions update interactive visualizations.
"""
from pathlib import Path
import json
import warnings

import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import log_loss, roc_auc_score
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

ROOT = Path(__file__).resolve().parent
NUMERIC = ["MIN", "PTS", "FGP", "TPP", "FTP", "REB", "AST", "STL", "BLK", "TOV", "PF"]
FEATURES = NUMERIC + ["home_away"]
C_VALUES = [0.03, 0.1, 1.0, 10.0, 100.0]


def load_data():
    df = pd.read_csv(ROOT / "nba.csv")
    df = df.rename(columns={"FG%": "FGP", "3P%": "TPP", "FT%": "FTP"})
    df["DATE"] = pd.to_datetime(df["DATE"])
    df["home_away"] = np.where(df["MATCHUP"].str.contains("vs.", regex=False), "Home", "Away")
    df["win"] = (df["W/L"] == "W").astype(int)
    df["OPP"] = df["MATCHUP"].str.extract(r"(?:vs\.\s+|@\s+)([A-Z]{3})")[0]
    df["GAME_ID"] = df.apply(
        lambda r: r["DATE"].strftime("%Y%m%d") + "_" + "_".join(sorted((r["TEAM"], r["OPP"]))), axis=1
    )
    df = df.sort_values(["DATE", "GAME_ID", "TEAM"]).reset_index(drop=True)
    assert df[FEATURES].notna().all().all()
    assert df.groupby("GAME_ID").size().eq(2).all(), "Each game must have two team rows"
    assert df.groupby("GAME_ID")["win"].sum().eq(1).all(), "Each game must have one winner"
    return df


def explore_data(df):
    cols = ["TEAM", "DATE", "MATCHUP", "home_away", "win"] + NUMERIC
    rows = df[cols].copy()
    rows["DATE"] = rows["DATE"].dt.strftime("%b %d, %Y")
    return {
        "fields": cols,
        "rows": rows.values.tolist(),
        "stats": NUMERIC,
        "teams": sorted(df["TEAM"].unique().tolist()),
        "correlation": df[NUMERIC].corr().round(3).values.tolist(),
        "games": df["GAME_ID"].nunique(),
    }


def split_games(df):
    # Split unique games chronologically, never individual team rows.
    games = df[["GAME_ID", "DATE"]].drop_duplicates().sort_values(["DATE", "GAME_ID"])
    n = len(games)
    first, second = int(n * .60), int(n * .80)
    ids = games["GAME_ID"].tolist()
    return {"train": ids[:first], "validation": ids[first:second], "test": ids[second:]}


def make_pipeline(penalty, c):
    preprocessing = ColumnTransformer([
        ("numeric", StandardScaler(), NUMERIC),
        ("venue", OneHotEncoder(drop="first", handle_unknown="ignore", sparse_output=False), ["home_away"]),
    ])
    # Recent scikit-learn represents the unpenalized fit with C=np.inf.
    if penalty == "none":
        logit = LogisticRegression(C=np.inf, solver="lbfgs", max_iter=8000)
    elif penalty == "l1":
        logit = LogisticRegression(C=c, l1_ratio=1.0, solver="liblinear", max_iter=8000, random_state=123)
    else:
        logit = LogisticRegression(C=c, l1_ratio=0.0, solver="lbfgs", max_iter=8000, random_state=123)
    return Pipeline([("preprocess", preprocessing), ("logistic", logit)])


def logistic_data(df):
    groups = split_games(df)
    train = df[df["GAME_ID"].isin(groups["train"])]
    subsets = {name: df[df["GAME_ID"].isin(groups[name])] for name in ("validation", "test")}
    models = {}
    options = [("none", None)] + [(p, c) for p in ("l2", "l1") for c in C_VALUES]
    for penalty, c in options:
        model = make_pipeline(penalty, c)
        with warnings.catch_warnings():
            warnings.filterwarnings("ignore", message="Setting penalty=None will ignore")
            model.fit(train[FEATURES], train["win"])
        label = "none" if penalty == "none" else f"{penalty}_{c:g}"
        fitted = model.named_steps["logistic"]
        output = {}
        for name, subset in subsets.items():
            p = model.predict_proba(subset[FEATURES])[:, 1]
            y = subset["win"].to_numpy()
            output[name] = {
                "p": np.round(p, 7).tolist(),
                "auc": round(float(roc_auc_score(y, p)), 5),
                "logloss": round(float(log_loss(y, p)), 5),
            }
        coef = fitted.coef_[0]
        models[label] = {
            "penalty": penalty, "C": c,
            "coef": np.round(coef, 5).tolist(),
            "intercept": round(float(fitted.intercept_[0]), 5),
            "nonzero": int((np.abs(coef) > 1e-5).sum()),
            "prediction": output,
        }
    return {
        "features": NUMERIC + ["Home vs Away"],
        "models": models,
        "partitions": {name: {
            "y": subset["win"].astype(int).tolist(),
            "rows": len(subset),
            "games": len(groups[name]),
            "start": subset["DATE"].min().strftime("%b %d, %Y"),
            "end": subset["DATE"].max().strftime("%b %d, %Y"),
        } for name, subset in subsets.items()},
        "counts": {name: 2 * len(ids) for name, ids in groups.items()},
        "game_counts": {name: len(ids) for name, ids in groups.items()},
        "C": C_VALUES,
    }


def cluster_data(df):
    # Browser-side Ward and K-means use the SAME reproducible, team-balanced
    # subset so students can freely select any 2–6 numeric predictors.
    sample = df.groupby("TEAM", group_keys=False).sample(n=8, random_state=123)
    sample = sample.sort_values(["DATE", "TEAM"]).reset_index(drop=True)
    cols = ["TEAM", "DATE", "MATCHUP"] + NUMERIC
    sample = sample[cols].copy()
    sample["DATE"] = sample["DATE"].dt.strftime("%b %d, %Y")
    return {"fields": cols, "rows": sample.values.tolist(), "features": NUMERIC,
            "total_rows": len(df), "sample_rows": len(sample)}


def main():
    df = load_data()
    payload = {"explore": explore_data(df), "logit": logistic_data(df), "cluster": cluster_data(df)}
    js_data = json.dumps(payload, separators=(",", ":"), allow_nan=False).replace("</", "<\\/")
    template = (ROOT / "template.html").read_text(encoding="utf-8")
    html = template.replace("/*__NBA_DATA__*/", f"const NBA = {js_data};")
    (ROOT / "index.html").write_text(html, encoding="utf-8")
    print(f"Built {len(df):,} team rows, {df.GAME_ID.nunique():,} games")
    print("Game split:", payload["logit"]["game_counts"])
    print("Validation L2 C=1:", payload["logit"]["models"]["l2_1"]["prediction"]["validation"] | {"p": "(saved probabilities)"})
    print("Output:", ROOT / "index.html")


if __name__ == "__main__":
    main()