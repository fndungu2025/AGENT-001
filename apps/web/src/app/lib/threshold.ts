// Client-side threshold maths for the "what if I contact more or fewer people" slider.
export interface Scored {
  p: number;
  y: 0 | 1;
}
export interface ThresholdStats {
  threshold: number;
  tp: number;
  fp: number;
  tn: number;
  fn: number;
  precision: number;
  recall: number;
  f1: number;
  accuracy: number;
  flagged: number;
}

export function statsAtThreshold(scores: Scored[], threshold: number): ThresholdStats {
  let tp = 0;
  let fp = 0;
  let tn = 0;
  let fn = 0;
  for (const s of scores) {
    const pos = s.p >= threshold;
    if (pos && s.y === 1) tp++;
    else if (pos) fp++;
    else if (s.y === 1) fn++;
    else tn++;
  }
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  const n = scores.length;
  return {
    threshold,
    tp,
    fp,
    tn,
    fn,
    precision,
    recall,
    f1,
    accuracy: n > 0 ? (tp + tn) / n : 0,
    flagged: tp + fp,
  };
}
