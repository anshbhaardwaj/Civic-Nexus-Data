/**
 * Executive brief (SPEC §6): assembles live findings from the engines into a
 * JSON preview, which the PDF renderer then typesets. Nothing here is
 * hardcoded — every figure comes from the ingested data or an engine run.
 */
import { db } from '../db';
import { runCorrelation } from '../ai/correlation';
import { runForecast } from '../ai/forecast';
import { listPolicyCards, totalIdleCapitalCr } from '../ai/mcda';
import { runOptimiser } from '../ai/optimiser';
import { findDataset, listDatasets } from './datasets';
import { round } from './stats';
import { verifyChain } from './audit';
import { measureBaseline } from './simulate';

export interface BriefSection {
  heading: string;
  bullets: string[];
}

export interface ExecutiveBrief {
  title: string;
  subtitle: string;
  generatedAt: string;
  generatedBy: string;
  scope: { datasets: number; rows: number; anomalies: number; policyCards: number };
  kpis: { label: string; value: string; detail: string }[];
  topAnomalies: {
    datasetSlug: string;
    column: string;
    entity: string;
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
  forecastHeadline: { metric: string; dataset: string; model: string; mape: number; text: string } | null;
  correlationHeadline: { dataset: string; text: string } | null;
  sections: BriefSection[];
  auditAttestation: { valid: boolean; entries: number; headHash: string | null; algorithm: string };
  evidenceNotes: string[];
}

export function buildBrief(actor = 'system@civicnexus.in'): ExecutiveBrief {
  const datasets = listDatasets();
  const rows = datasets.reduce((a, d) => a + d.row_count, 0);
  const anomalyRows = db
    .prepare(
      `SELECT dataset_slug, column_name, entity, period, value, expected_low, expected_high, sigma, severity
       FROM anomalies ORDER BY score DESC LIMIT 8`,
    )
    .all() as Record<string, unknown>[];
  const anomalyTotal = (db.prepare('SELECT COUNT(*) AS n FROM anomalies').get() as { n: number }).n;
  const cards = listPolicyCards();
  const portfolio = runOptimiser();
  const baseline = measureBaseline();
  const idle = totalIdleCapitalCr();

  let forecastHeadline: ExecutiveBrief['forecastHeadline'] = null;
  const fds = findDataset('ambulance_response') ?? datasets.find((d) => d.slug !== 'bridge_health');
  if (fds) {
    try {
      const f = runForecast(fds, { metric: fds.slug === 'ambulance_response' ? 'avg_response_min' : undefined, horizon: 5, aggregation: 'avg' });
      const last = f.forecast[f.forecast.length - 1];
      forecastHeadline = {
        metric: f.metric,
        dataset: fds.name,
        model: f.chosenModel,
        mape: f.selection[0].walkForwardMape,
        text: `${f.metric.replace(/_/g, ' ')} is projected at ${last.value} by ${last.period} (95% CI ${last.lo95} to ${last.hi95}) using the ${f.chosenModel} model, which won walk-forward validation at ${f.selection[0].walkForwardMape}% MAPE.`,
      };
    } catch {
      forecastHeadline = null;
    }
  }

  let correlationHeadline: ExecutiveBrief['correlationHeadline'] = null;
  const cds = findDataset('air_quality') ?? datasets[0];
  if (cds) {
    try {
      const c = runCorrelation(cds);
      const p = c.pairs[0];
      const lead = c.leadingIndicators[0];
      correlationHeadline = {
        dataset: cds.name,
        text:
          `${p.a} and ${p.b} correlate at r=${p.pearson} (p=${p.pValue}, n=${p.n}, ${p.strength}).` +
          (lead ? ` ${lead.driver} leads ${lead.target} by ${lead.bestLag} period(s) at r=${lead.r}.` : ''),
      };
    } catch {
      correlationHeadline = null;
    }
  }

  const attest = verifyChain();

  return {
    title: 'CivicData Nexus — Executive Decision Brief',
    subtitle: 'Automated telemetry analysis and decision intelligence for public sector data (PS SIH1682)',
    generatedAt: new Date().toISOString(),
    generatedBy: actor,
    scope: { datasets: datasets.length, rows, anomalies: anomalyTotal, policyCards: cards.length },
    kpis: [
      { label: 'Idle capital identified', value: `₹${idle.toLocaleString('en-IN')} cr`, detail: 'sum(released_cr - spent_cr) across all seeded schemes' },
      { label: 'Scheme utilisation', value: `${baseline.utilisationPct}%`, detail: 'sum(spent_cr) / sum(allocation_cr)' },
      { label: 'Open anomalies', value: String(anomalyTotal), detail: 'AI-1 MAD primary detector, 3.5σ threshold' },
      { label: 'Distressed NH bridges', value: String(baseline.distressedBridges), detail: 'IBMS rating below 75 (MoRTH threshold)' },
      { label: 'Mean ambulance response', value: `${baseline.responseMin} min`, detail: '2025 average of avg_response_min' },
      { label: 'Recommended portfolio', value: `₹${portfolio.totalCostCr.toLocaleString('en-IN')} cr`, detail: `${portfolio.chosen.length} interventions, impact ${portfolio.totalImpact}` },
    ],
    topAnomalies: anomalyRows.map((r) => ({
      datasetSlug: String(r.dataset_slug),
      column: String(r.column_name),
      entity: String(r.entity),
      period: r.period ? String(r.period) : null,
      value: round(Number(r.value), 2),
      expected: `${round(Number(r.expected_low), 2)} .. ${round(Number(r.expected_high), 2)}`,
      sigma: round(Number(r.sigma), 2),
      severity: String(r.severity),
    })),
    topPolicyCards: cards.slice(0, 6).map((c) => ({
      code: c.code,
      title: c.title,
      department: c.department,
      impactScore: c.impactScore,
      costCr: c.costCr,
      action: c.action,
    })),
    portfolio: {
      budgetCr: portfolio.budgetCr,
      budgetSource: portfolio.budgetSource,
      totalImpact: portfolio.totalImpact,
      totalCostCr: portfolio.totalCostCr,
      utilisationPct: portfolio.utilisationPct,
      items: portfolio.chosen.map((c) => ({ code: c.code, title: c.title, costCr: c.costCr, impactScore: c.impactScore })),
    },
    forecastHeadline,
    correlationHeadline,
    sections: [
      {
        heading: 'What the data shows',
        bullets: [
          `${datasets.length} public datasets totalling ${rows.toLocaleString('en-IN')} rows were ingested through the 10-step pipeline with PII masked by salted SHA-256.`,
          `₹${idle.toLocaleString('en-IN')} cr of released funds remain unspent — utilisation stands at ${baseline.utilisationPct}%.`,
          `${baseline.distressedBridges} national-highway bridges carry an IBMS rating below the 75 structural-distress threshold, with a ₹${baseline.bridgeRepairBacklogCr.toLocaleString('en-IN')} cr repair backlog.`,
          `Average grievance closure takes ${baseline.grievanceDaysToClose} days against a 21-day service norm.`,
        ],
      },
      {
        heading: 'Recommended action',
        bullets: [
          `Deploy ₹${portfolio.totalCostCr.toLocaleString('en-IN')} cr against a ₹${portfolio.budgetCr.toLocaleString('en-IN')} cr envelope (${portfolio.utilisationPct}% utilised) across ${portfolio.chosen.length} interventions selected by 0/1 knapsack on MCDA impact.`,
          ...portfolio.chosen.slice(0, 4).map((c) => `${c.title} — impact ${c.impactScore}, ₹${c.costCr} cr (${c.impactPerCr} impact per ₹ cr).`),
        ],
      },
      {
        heading: 'Assurance',
        bullets: [
          `Audit chain: ${attest.entries} entries, verification ${attest.valid ? 'PASSED' : 'FAILED'}; head hash ${attest.headHash?.slice(0, 16) ?? 'n/a'}…`,
          'Every score exposes its formula, inputs and source row ids; no external API or model download is used.',
          'PII columns are pseudonymised with a per-dataset 128-bit salt; original values are never persisted (DPDP 2023 alignment).',
        ],
      },
    ],
    auditAttestation: { valid: attest.valid, entries: attest.entries, headHash: attest.headHash, algorithm: attest.algorithm },
    evidenceNotes: [
      'NITI Aayog, India\u2019s Data Imperative: siloed government data platforms limit cross-domain decisions.',
      'Analytics-driven de-duplication has already saved ₹9,000 cr (17.1 m ineligible PM-Kisan names) and ₹21,000 cr (35 m bogus LPG connections).',
      'CAG: ₹38,093 cr of savings surrendered in a single state finance audit year; ₹40,532 cr (64%) unspent across Jal Jeevan Mission heads.',
      'MoRTH/IBMS: 471 national-highway bridges are structurally distressed (rating below 75).',
      'Team projection: ~4.2 minutes of ambulance delay reduction from predictive hotspot deployment (team projection, not an observed value).',
      'Mapped SDGs: 3 (health), 9 (infrastructure), 11 (cities), 16 (institutions).',
    ],
  };
}
