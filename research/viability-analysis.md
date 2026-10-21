# CustomerIQ — Viability Analysis

**Project:** CustomerIQ — Customer Behavior Analytics and Retention Intelligence
**Working title:** *Predicting Customer Purchasing Behavior and Developing Data-Driven Retention Strategies in E-Commerce*
**Date:** 2026-10-21

---

## TL;DR — The verdict

| Framing | Verdict |
|---|---|
| **As an academic / capstone / portfolio project** (analytics study + dashboard on public data) | **GO.** Technically low-risk, well-scoped, finishable in 6–10 weeks. |
| **As a commercial product competing with Klaviyo, Shopify, Bloomreach** | **NO-GO as currently written.** No differentiation. The core features (RFM segments, repeat-purchase / churn prediction, segment dashboards) already ship free or bundled in tools merchants already pay for. |

**The fatal flaw:** the concept describes a *method* (RFM + K-means + logistic regression / random forest + Power BI), not a *product*. Those methods have been standard since the early 2000s, and the incumbents already automate them inside the merchant's existing workflow. They can also *act* on the predictions (send the email, launch the campaign). CustomerIQ as described only produces a dashboard, so a merchant would need a reason to export data out of Shopify or Klaviyo to look at a worse version of a chart they already have.

That flaw does **not** hurt an academic project, where the value is in rigor, interpretation, and clear communication. Decide which of the two you are building **before** writing code, because the decision changes the architecture (Power BI vs. a web app), the data source (UCI vs. live store connectors), and how success is measured.

---

## 1. Technical viability

### Can it be built with current technology?
**Yes, easily.** Every component is mature, free or cheap, and well documented:

| Layer | Tool | Maturity / risk |
|---|---|---|
| Storage | PostgreSQL | Very mature. About 1M rows is tiny for Postgres. |
| Analysis | Python, pandas, NumPy | Very mature. The whole dataset fits in memory (a few hundred MB). |
| ML | scikit-learn (`KMeans`, `LogisticRegression`, `RandomForestClassifier`, `metrics`) | Very mature. Training takes seconds on a laptop. |
| Viz | Matplotlib (EDA), Power BI (dashboards), Streamlit (optional app) | Mature. See the licensing notes below. |

No GPU, cloud infrastructure, or paid API is needed for the core project.

### Dataset check: UCI Online Retail II (ID 502)
I checked this against the UCI API (`/api/dataset?id=502`):

- **1,067,371 transaction lines**, 8 columns: Invoice, StockCode, Description, Quantity, InvoiceDate, Price, Customer ID, Country.
- **Period:** 2009-12-01 to 2011-12-09 (about 2 years). This is enough history to build a 60-day repurchase label across several time windows.
- **Source:** a UK online gift-ware retailer. UCI's own summary says **"many customers of the company are wholesalers."**
- **License:** CC BY 4.0, DOI 10.24432/C5CG6D. Commercial and academic use is allowed with attribution.

**Data problems you must plan for (none are fatal):**

1. **The `ucimlrepo` package will probably not load this dataset.** The API reports `"data_url": null`, and `fetch_ucirepo()` depends on that field, so it is expected to raise a "not available for import" error. Plan to download the `.zip` directly and read the `.xlsx` with `pandas.read_excel(..., sheet_name=None)`. The file has two sheets, one per year, and needs `openpyxl`. Loading is slow (about 1–2 minutes), so convert to Parquet or CSV once.
2. **The UCI metadata is wrong about missing values.** It says "no missing values," but in practice about 20–25% of rows have no Customer ID. Those rows cannot be used for customer-level RFM or prediction, so you must drop them and document why.
3. **Cancellations and returns:** invoices starting with `C`, plus negative quantities. Decide whether to net them out or exclude them, and treat the choice consistently in both SQL and Python.
4. **Noise rows:** zero or negative prices, non-product StockCodes (`POST`, `M`, `D`, `BANK CHARGES`, `AMAZONFEE`, etc.), and duplicate lines.
5. **Wholesaler skew:** monetary value follows a power law, and a small number of B2B accounts dominate revenue. This breaks naive K-means (point 2 under "Technical risks" below) and limits how well results generalize to typical B2C e-commerce. **State this limitation explicitly in the write-up.**
6. **Mostly UK data** (about 90% of rows), with currency in GBP.
7. **Age:** the data is from 2009–2011, before mobile commerce took over. That is fine for showing the method, but weak evidence for "modern e-commerce" claims.

### Primary technical risks (ranked)

1. **Label leakage in the 60-day repurchase model (HIGH, the most common way projects like this fail).** If RFM features are computed over the whole dataset and the label is "purchased in a 60-day window" inside that same period, the model will report impressive metrics that mean nothing. **Required design:** pick cutoff date(s) *T*, compute features only from transactions before *T*, and set the label = any purchase in (*T*, *T* + 60 days]. Validate on a **later** cutoff (out-of-time split), not a random split. Rolling cutoffs (for example, monthly snapshots) multiply the training rows and are more realistic.
2. **K-means on raw RFM (MEDIUM).** RFM values are heavily skewed, so K-means produces one giant cluster plus a few outlier "clusters" made of wholesalers. Mitigations: log1p-transform plus standardize, choose *k* with elbow and silhouette scores, and possibly treat outliers separately. Also note that **rule-based RFM scoring (quintiles) often produces more interpretable segments than K-means.** Present both, and say why you would use one over the other.
3. **Class imbalance and metric choice (MEDIUM).** The repeat-in-60-days rate will be well below 50%. Accuracy alone will mislead. Report ROC-AUC, PR-AUC, precision/recall/F1 at a chosen threshold, a confusion matrix, and **calibration** (a reliability curve or Brier score), because the dashboard shows probabilities.
4. **Weak baseline comparison (MEDIUM).** Logistic regression vs. random forest alone is a thin comparison. Add (a) a naive baseline, such as "predict repeat if the customer bought in the last 60 days," and (b) ideally a probabilistic BTYD model (BG/NBD via the `lifetimes` or `pymc-marketing` packages). That is the standard academic benchmark for "will this customer buy again." Reviewers will ask about it.
5. **Pipeline complexity (LOW–MEDIUM).** SQL, Python, and Power BI create three places where business logic can drift (for example, cancellation handling done differently in each). Keep one source of truth: do the cleaning in SQL views or Python, and have Power BI read only finished tables.

### Rate limits, pricing, and API restrictions

| Item | Blocking? | Notes |
|---|---|---|
| UCI dataset | No | Static file, CC BY 4.0, no API key or rate limit. Download once and keep it locally. |
| `ucimlrepo` | Minor | Probably won't work for ID 502 (see above). Use the direct zip. |
| PostgreSQL, Python libraries | No | Free and open source. |
| **Power BI Desktop** | **Watch** | Free, but **Windows-only**. Mac or Linux team members need a VM, Parallels, or a Windows lab machine. |
| **Power BI sharing** | **Watch** | Publishing to the Power BI Service and sharing dashboards needs a **Pro license (US$14/user/month as of the 2025 price change)** for both author and viewers, or a Premium/Fabric capacity. Many universities include Pro through Microsoft 365 A5, so check your institution. "Publish to web" is free but makes the report **public**. That is acceptable for UCI data and never acceptable for real customer data. |
| Live e-commerce data (Shopify / Klaviyo APIs) | Only if you go commercial | Shopify Admin API uses rate-limited GraphQL (cost-based throttling) and requires an app, OAuth, and protected-customer-data approval to read PII. That is a significant compliance burden (GDPR/CCPA) and is **out of scope for an MVP**. |
| Streamlit | No | Free. Community Cloud hosting is free for public apps. |

**Nothing blocks the academic version.** The only real constraints are the Power BI platform and licensing.

---

## 2. Competitive landscape

### Existing solutions

| Product | What it already does relevant to CustomerIQ | Who it's for / price posture |
|---|---|---|
| **Klaviyo** (Analytics / Predictive Analytics) | Per-profile **predicted CLV, churn risk, predicted next order date**, expected number of orders, and RFM-style segments. Predictions plug straight into segments and email/SMS flows. Needs a minimum data volume (on the order of hundreds of purchasers and months of order history). | SMB to mid-market e-commerce. Predictive features come with the paid plans merchants already use for email. |
| **Shopify** (Customer Segmentation) | Built-in segment editor (ShopifyQL-style filters on order count, amount spent, last order date, etc.), prebuilt segments, and RFM-based customer analytics in Shopify Analytics. | Every Shopify merchant, included in the subscription. |
| **Bloomreach** (Data Engine / Engagement, formerly Exponea) | Full CDP: identity resolution, real-time segmentation, predictive models (churn, purchase propensity), and AI-driven personalization across channels. | Enterprise, with sales-led contracts. |
| Others worth naming in your review | Omnisend, Mailchimp (predicted CLV/demographics), HubSpot, Segment/Twilio Engage, Amplitude, Mixpanel, Optimove, Peel Insights, Lifetimely, Daasity, plus free open-source notebooks (`lifetimes`, `pymc-marketing` CLV) | From free to enterprise |

### What would differentiate CustomerIQ?
For a **commercial** product, nothing in the current concept. Every listed feature is table stakes. Possible angles, none of which the concept currently commits to:

- **Transparency / explainability:** incumbents' predictions are black boxes. Showing *why* (feature importance, SHAP, calibration, "here's the RFM rule that put this customer in this segment") is a real gap. **This is also the strongest academic angle.**
- **Platform-agnostic, low-volume merchants:** stores that don't use Klaviyo, sell across several channels (Etsy + Shopify + wholesale), or fall under Klaviyo's minimum data thresholds.
- **B2B / wholesale retention:** the UCI data is wholesaler-heavy, and B2B reorder prediction is less well served by B2C email tools.
- **Prescriptive output:** go beyond "who will churn" to "which segment to target, at what expected ROI," using uplift or a cost-benefit threshold. Most dashboards stop at the prediction.

### Evidence of market demand
- **For the problem: strong.** Retention analytics is a large, established category. Klaviyo (public since 2023), Bloomreach, and dozens of CLV/retention tools exist *because* merchants pay for this. That proves demand for the *problem* and also proves it is **already served.**
- **For a standalone dashboard product: weak.** Merchants want predictions inside the tool that executes campaigns. A separate Power BI dashboard adds a manual export step and no action loop.
- **For the skill set: strong.** The SQL + Python + ML + Power BI combination maps directly onto business/marketing/data analyst job requirements. As a portfolio or capstone piece, it is well aligned with the job market.

---

## 3. Complexity estimation

**Academic version: MVP-sized, about 6–10 weeks for one person working part-time** (about 4–6 weeks full-time).

| Phase | Effort | Notes |
|---|---|---|
| 1. Data acquisition, cleaning, Postgres schema (fact/dim tables), load | 1–1.5 wk | Mostly the cleaning rules listed in section 1. |
| 2. EDA + RFM scoring (SQL and/or pandas) | 1 wk | |
| 3. K-means segmentation + segment profiling and naming | 1 wk | Includes the log transform, *k* selection, and comparison with rule-based RFM. |
| 4. Repeat-purchase prediction (label design, out-of-time validation, LR / RF / baseline / optional BG-NBD, evaluation, calibration) | 1.5–2 wk | **The hardest and most important part.** |
| 5. Power BI dashboard (data model, DAX measures, 3–5 pages) | 1–1.5 wk | Add time if you are new to DAX or don't have Windows. |
| 6. Retention strategy recommendations + write-up | 1–1.5 wk | Turning model output into business actions per segment. |
| *(Optional)* Streamlit app for live scoring | +1 wk | Useful for Mac users or anyone without a Power BI license. |

**Commercial version: a major undertaking (6–12+ months, a team).** It would need multi-tenant SaaS, Shopify/WooCommerce connectors and app review, OAuth, PII security and compliance (GDPR/CCPA, SOC 2 expectations), scheduled retraining per tenant, billing, and actions/integrations with email tools. None of that is in the current concept.

### Hardest technical challenges
1. **Getting the prediction setup right:** time-based feature/label windows, no leakage, out-of-time validation, and a meaningful baseline. This is where the project's credibility is decided.
2. **Turning segments into something people can act on:** clusters that are statistically valid but not interpretable are useless to a marketer. You need named segments with clear RFM profiles and a specific retention action for each.
3. **Handling skew and wholesalers** without the results being driven by a handful of accounts.
4. **Keeping SQL, Python, and Power BI consistent:** one definition of "revenue," "active customer," and "cancellation."
5. **Communicating probabilities** in a dashboard: calibrated scores, thresholds tied to campaign cost, and avoiding "92% accuracy" claims that come from imbalance.

---

## 4. Go / No-Go recommendation

### Decision: **GO, as an academic/portfolio analytics project.** **NO-GO as a commercial SaaS** unless the concept changes substantially.

### If GO (academic), validate these first, in order (about week 1)
1. **Load the data and measure it.** Download the zip directly (don't rely on `ucimlrepo`). Record how many rows have a Customer ID, how many unique customers there are, the share of cancellations, and the revenue concentration of the top 1% of customers. This takes about half a day and confirms the dataset supports the plan.
2. **Check the label base rate.** At a few cutoff dates, what share of active customers buy again within 60 days? If it is very low or very high, consider 90 days or adjust the cohort definition. Do this **before** any modeling.
3. **Confirm Power BI access.** Do you have Windows and a Pro license (often available through the university's Microsoft 365)? If not, decide now between Power BI Desktop only (screenshots or .pbix delivery), "Publish to web" (public), or Streamlit as the primary dashboard.
4. **Write a leakage-proof experiment design** (cutoffs, windows, train/validation/test periods, baseline, metrics) and have your advisor sign off on it.
5. **Tighten the research questions** so the project is a study rather than a list of features. For example:
   - RQ1: What distinct behavioral segments exist, and how much revenue does each contribute?
   - RQ2: How accurately can 60-day repurchase be predicted from RFM-derived features, compared with a naive recency baseline and BG/NBD?
   - RQ3: What retention actions are justified per segment, given predicted probabilities and an assumed campaign cost?

### Suggested scope adjustments (low effort, high value)
- Add a **naive baseline** and, ideally, **BG/NBD** next to LR and RF.
- Add **calibration** and **feature importance (permutation or SHAP)** to support the explainability angle.
- Report results **with and without wholesalers or top outliers.**
- Use "e-commerce" claims cautiously: frame the work as a case study on one UK B2B-heavy retailer from 2009–2011.

### If you want a commercial path, what would have to change
- Pick a **narrow, underserved user group** (for example, B2B/wholesale reorder prediction, or multi-channel small merchants below Klaviyo's data thresholds) and **interview 10–15 of them** before writing product code.
- Ship **inside the merchant's workflow** (a Shopify app, or pushing segments into Klaviyo/Mailchimp) rather than a standalone Power BI dashboard.
- Make the core value **explainable, prescriptive recommendations** ("contact these 40 accounts this week; expected recovered revenue £X"), not descriptive charts.
- Use the academic project as the prototype and evidence base. Do not start with SaaS infrastructure.

---

## Sources
- UCI ML Repository, Online Retail II (ID 502): https://archive.ics.uci.edu/dataset/502/online+retail+ii (metadata checked through `https://archive.ics.uci.edu/api/dataset?id=502` on 2026-10-21: 1,067,371 instances, 2009-12-01 to 2011-12-09, `data_url: null`, DOI 10.24432/C5CG6D)
- `ucimlrepo`: https://github.com/uci-ml-repo/ucimlrepo
- Klaviyo Analytics: https://www.klaviyo.com/solutions/analytics
- Shopify Customer Segmentation: https://help.shopify.com/en/manual/customers/customer-segmentation
- Bloomreach Data Engine: https://www.bloomreach.com/en/products/data-engine
- Power BI documentation and licensing: https://learn.microsoft.com/en-us/power-bi/
- scikit-learn User Guide: https://scikit-learn.org/stable/user_guide.html

*Not checked hands-on in this analysis (the dataset download was skipped at the user's request): the exact missing Customer ID rate, cancellation share, and 60-day repurchase base rate. These are week-1 tasks 1–2 above. Competitor feature details and Power BI pricing are from published product information and should be rechecked on current pricing pages before any commercial decision.*
