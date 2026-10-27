import { COPY, DOCS_URL } from "../copy";

export function HowItWorks() {
  return (
    <div className="container prose">
      <div className="page-title">
        <h1>{COPY.how.title}</h1>
        <p className="muted" style={{ marginTop: 6 }}>
          {COPY.how.lead}
        </p>
      </div>

      <h2>RFM groups: who is who</h2>
      <p>
        Every customer gets three scores from 1 (weakest) to 5 (strongest): <strong>Recency</strong>{" "}
        (how recently they bought), <strong>Frequency</strong> (how many orders) and{" "}
        <strong>Monetary</strong> value (how much they spent). Combining the three puts each
        customer in one of eight named groups, such as Champions or At risk. The rules are fixed and
        written down, so you can always explain why someone is in a group.
      </p>

      <h2>K-means: groups found by the data</h2>
      <p>
        K-means looks for customers who behave alike without being told any rules. We compare it
        with the RFM groups: when both methods broadly agree you can be more confident, and when
        they disagree it is worth a closer look.
      </p>

      <h2>The chance of buying again</h2>
      <p>
        For each customer we estimate the chance they will place another order in the next 30, 60 or
        90 days (60 by default). The estimate comes from a model that learned from how customers
        behaved in earlier periods. We always compare it with a simple rule, “people who ordered
        most recently are most likely to come back”. If the model is not clearly better than that
        rule, we say so.
      </p>

      <h2>How we avoid fooling ourselves</h2>
      <ul>
        <li>
          <strong>No random splits.</strong> Randomly mixing customers lets the model peek at the
          future. Instead it learns from earlier months and is tested on a later period it has never
          seen.
        </li>
        <li>
          <strong>No leakage.</strong> Customer profiles for each cut-off date use only orders
          before that date.
        </li>
        <li>
          <strong>Choose on validation, report on test.</strong> The model is picked on a validation
          period and the final numbers come from a separate, later test period.
        </li>
        <li>
          <strong>Honest scores.</strong> Probabilities are calibrated, and we show a calibration
          chart so you can check them.
        </li>
      </ul>

      <h2>Honest limits</h2>
      <ul>
        <li>Correlation is not causation: a score says who tends to return, not why.</li>
        <li>
          Bulk (wholesale) buyers can dominate revenue. Use the wholesale filter and option to see
          the effect.
        </li>
        <li>
          The benefit of a campaign is assumed, not measured. Keep a holdout group to measure it.
        </li>
        <li>Sample data is synthetic. Results from a file describe that file and period only.</li>
        <li>
          Everything runs in your browser. Your file is not uploaded, stored or sent to anyone.
        </li>
      </ul>

      <p>
        Want the full method, definitions and project background?{" "}
        <a href={DOCS_URL}>Open Research &amp; docs</a>.
      </p>
    </div>
  );
}
