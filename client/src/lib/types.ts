/** Response types mirrored from docs/API.md and the live payloads. */

export type Role = 'minister' | 'analyst' | 'director' | 'auditor';

export interface User {
  id?: number;
  email: string;
  name?: string;
  role: Role | string;
  active?: boolean;
  created_at?: string;
  permissions: string[];
}

export interface LoginResponse {
  token: string;
  expiresAt: string;
  user: User;
}

export interface DemoUser {
  email: string;
  password: string;
  role: string;
  name?: string;
}

export interface DatasetRoles {
  metrics: string[];
  dimensions: string[];
  time: string[];
  identifiers: string[];
  pii: string[];
}

export interface DatasetSummary {
  id: number;
  slug: string;
  name: string;
  domain: string;
  description: string;
  sourceFile: string;
  rows: number;
  columns: number;
  rejects: number;
  piiColumns: number;
  qualityScore: number;
  ingestedAt: string;
  ingestedBy: string;
  ingestDurationMs: number;
  roles: DatasetRoles;
}

export interface ColumnMeta {
  id: number;
  dataset_id: number;
  ordinal: number;
  raw_name: string;
  name: string;
  inferred_type: string;
  type_confidence: number;
  semantic_role: string;
  is_pii: number;
  pii_kind: string | null;
  null_count: number;
  imputed_count: number;
  impute_method: string | null;
  distinct_count: number;
  min_value: string | null;
  max_value: string | null;
  mean_value: number | null;
  stddev_value: number | null;
}

export type Row = Record<string, string | number | null>;

export interface DashboardResponse {
  user: User;
  kpis: {
    datasets: number;
    rows: number;
    anomalies: number;
    policyCards: number;
    idleCapitalCr: number;
    utilisationPct: number;
    distressedBridges: number;
    meanAmbulanceResponseMin: number;
    functionalTapPct: number;
    grievanceDaysToClose: number;
  };
  datasets: DatasetSummary[];
  anomaliesBySeverity: { severity: string; n: number }[];
  topPolicyCards: { code: string; title: string; impactScore: number; costCr: number; sector: string }[];
  portfolio: { budgetCr: number; totalCostCr: number; totalImpact: number; items: number; utilisationPct: number };
  auditChain: { valid: boolean; entries: number; headHash: string };
  recentAudit: { id: number; ts: string; actor: string; action: string; entity: string }[];
  roles: string[];
}

export interface Anomaly {
  id: number;
  dataset_id: number;
  dataset_slug: string;
  source_row_id: number;
  column_name: string;
  entity: string | null;
  period: string | null;
  value: number;
  expected_low: number;
  expected_high: number;
  deviation: number;
  sigma: number;
  method: string;
  methods_agree: number;
  severity: 'critical' | 'high' | 'medium' | 'low' | string;
  score: number;
  explanation: string;
  status: 'open' | 'acknowledged' | 'dismissed' | string;
  detected_at: string;
}

export interface AnomalySummary {
  total: number;
  bySeverity: { severity: string; n: number }[];
  byDataset: { dataset_slug: string; n: number; max_sigma: number }[];
  byStatus: { status: string; n: number }[];
  method: string;
}

export interface LineageStep {
  stepNo: number;
  step: string;
  status: string;
  rowsIn: number;
  rowsOut: number;
  durationMs: number;
  detail: Record<string, unknown>;
  createdAt: string;
}

export interface EngineInfo {
  id: string;
  name: string;
  route: string;
  method: string;
  output: string;
  permission: string;
}

export interface ForecastResponse {
  engine: string;
  dataset: { id: number; slug: string; name: string };
  metric: string;
  timeColumn: string;
  aggregation: string;
  filter: { column: string; value: string } | null;
  history: { period: string; actual: number; fitted: number | null }[];
  horizon: number;
  seasonalPeriod: number;
  chosenModel: string;
  chosenParams: Record<string, number>;
  selection: { model: string; walkForwardMape: number; inSampleMape: number; folds: number }[];
  forecast: { step: number; period: string; value: number; lo80: number; hi80: number; lo95: number; hi95: number }[];
  formulas: Record<string, string>;
  validation: { scheme: string; folds: number; minTrain: number };
}

export interface IForestResponse {
  engine: string;
  dataset: { id: number; slug: string; name: string };
  features: string[];
  params: { trees: number; psi: number; depthLimit: number; cPsi: number; seed: string };
  formula: string;
  rowsScored: number;
  scoreStats: { mean: number; stddev: number; min: number; max: number };
  thresholdUsed: number;
  thresholdFormula: string;
  flagged: number;
  outliers: {
    rowId: number;
    label: string;
    score: number;
    pathLength: number;
    values: Record<string, number>;
    contributions: { feature: string; contribution: number; value: number; trainingMedian: number; sharePct: number }[];
  }[];
  histogram: { bucket: string; count: number }[];
}

export interface ClusterResponse {
  engine: string;
  dataset: { id: number; slug: string; name: string };
  unit: string;
  features: string[];
  kEvaluated: { k: number; silhouette: number; inertia: number }[];
  kChosen: number;
  silhouette: number;
  formulas: Record<string, string>;
  clusters: {
    cluster: number;
    label: string;
    size: number;
    members: string[];
    centroidZ: Record<string, number>;
    centroidOriginal: Record<string, number>;
    profile: { feature: string; value: number; globalMean: number; zOffset: number; direction: string }[];
    meanSilhouette: number;
  }[];
  points: { key: string; cluster: number; silhouette: number; distanceToCentroid: number }[];
}

export interface CorrelationResponse {
  engine: string;
  dataset: { id: number; slug: string; name: string };
  metrics: string[];
  n: number;
  matrix: { pearson: number[][]; spearman: number[][]; pValue: number[][] };
  pairs: {
    a: string;
    b: string;
    pearson: number;
    spearman: number;
    pValue: number;
    n: number;
    significant: boolean;
    strength: string;
    spurious: boolean;
    note: string;
  }[];
  leadingIndicators: { driver: string; target: string; bestLag: number; r: number; note?: string }[];
  formulas: Record<string, string>;
  caveats: string[];
}

export interface PolicyCriterion {
  key: string;
  label: string;
  weight: number;
  raw: number;
  normalised: number;
  contribution: number;
  formula: string;
  inputs: Record<string, unknown>;
}

export interface PolicyCard {
  id: number;
  code: string;
  title: string;
  department: string;
  district: string | null;
  sector: string;
  impactScore: number;
  costCr: number;
  beneficiaries: number;
  action: string;
  rationale: string;
  criteria: PolicyCriterion[];
  evidence: { datasetSlug: string; rowIds: number[]; metric: string; measured: number; target: number };
  sdgs: number[];
  createdAt: string;
}

export interface PolicyCardsResponse {
  engine: string;
  weights: Record<string, number>;
  formula: string;
  count: number;
  cards: PolicyCard[];
  sectors: string[];
}

export interface OptimiseResponse {
  engine: string;
  budgetCr: number;
  budgetSource: string;
  idleCapitalCr: number;
  granularityCr: number;
  candidates: number;
  chosen: {
    code: string;
    title: string;
    department: string;
    district: string | null;
    impactScore: number;
    costCr: number;
    beneficiaries: number;
    impactPerCr: number;
  }[];
  rejected: { code: string; title: string; impactScore: number; costCr: number; reason: string }[];
  totalImpact: number;
  totalCostCr: number;
  utilisationPct: number;
  beneficiaries: number;
  impactPerCr: number;
  paretoFrontier: { budgetCr: number; totalImpact: number; totalCostCr: number; items: number; utilisationPct: number }[];
  formulas: Record<string, string>;
}

export interface AskResponse {
  engine: string;
  question: string;
  answer: string;
  interpretation: {
    intent: string;
    intentScores: Record<string, number>;
    matchedKeywords: string[];
    tokens: string[];
    dataset: { id: number; slug: string; name: string } | null;
    metric: string | null;
    secondMetric: string | null;
    dimension: string | null;
    entities: string[];
    topN: number;
    direction: string;
    unresolved: string[];
  };
  data: { rows?: { key: string; value: number; n?: number }[]; aggregation?: string; groups?: number } & Record<string, unknown>;
  engineUsed: string;
  formula: string;
  confidence: number;
}

export type Levers = {
  budgetReallocationPct: number;
  hospitalBedsAdded: number;
  ambulancesAdded: number;
  staffHired: number;
  waterCapexPct: number;
  roadRepairCapexCr: number;
  enforcementIntensity: number;
};

export interface SimAssumption {
  key: string;
  label: string;
  value: number;
  unit: string;
  source: string;
  formula: string;
}

export interface SimOutput {
  key: string;
  label: string;
  unit: string;
  baseline?: number;
  years?: { year: number; value: number }[];
  formula: string;
  interpretation?: string;
}

export interface SimulateResponse {
  levers: Levers;
  baseline: Record<string, number>;
  assumptions: SimAssumption[];
  outputs: SimOutput[];
  headline: string;
  horizonYears: number;
  generatedAt: string;
}

export interface AssumptionsResponse {
  defaultLevers: Levers;
  baseline: Record<string, number>;
  assumptions: SimAssumption[];
  outputs: SimOutput[];
  horizonYears: number;
}

export interface BriefResponse {
  title: string;
  subtitle: string;
  generatedAt: string;
  generatedBy: string;
  scope: { datasets: number; rows: number; anomalies: number; policyCards: number };
  kpis: { label: string; value: string; detail: string }[];
  topAnomalies: {
    datasetSlug: string;
    column: string;
    entity: string | null;
    period: string | null;
    value: number;
    expected: string;
    sigma: number;
    severity: string;
  }[];
  topPolicyCards: { code: string; title: string; department: string; impactScore: number; costCr: number; action: string }[];
  portfolio: {
    budgetCr: number;
    budgetSource: string;
    totalImpact: number;
    totalCostCr: number;
    utilisationPct: number;
    items: { code: string; title: string; costCr: number; impactScore: number }[];
  };
  forecastHeadline: { metric: string; dataset: string; model: string; mape: number; text: string };
  correlationHeadline: { dataset: string; text: string };
  sections: { heading: string; bullets: string[] }[];
  auditAttestation: { valid: boolean; entries: number; headHash: string; algorithm: string };
  evidenceNotes: string[];
}

export interface AuditEntry {
  id: number;
  seq: number;
  ts: string;
  actor: string;
  actor_role: string;
  action: string;
  entity: string;
  payload_json: string;
  payload_hash: string;
  prev_hash: string;
  hash: string;
}

export interface AuditVerify {
  valid: boolean;
  entries: number;
  brokenAt: number | null;
  reason: string | null;
  headHash: string;
  algorithm: string;
  method?: string;
}

export interface LiveTickResponse {
  dataset?: string;
  datasets?: string[];
  rowsBefore?: number;
  rowsAfter?: number;
  rowsAppended?: number;
  anomaliesBefore?: number;
  anomaliesAfter?: number;
  [k: string]: unknown;
}
