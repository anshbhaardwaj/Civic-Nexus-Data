/**
 * AI-6 — MCDA policy cards (SPEC §5).
 *
 * Impact Score (0-100) = 100 * sum_i ( w_i * c_i )  where every c_i is
 * normalised to [0,1] and the six weights sum to 1:
 *
 *   need severity     0.28   how far the measured indicator sits from its target
 *   population reach  0.22   beneficiaries relative to the largest candidate
 *   fiscal headroom   0.16   measured idle capital in the owning department vs cost
 *   urgency           0.14   trend deterioration + open anomalies on the entity
 *   feasibility       0.12   inverse of delivery difficulty (cost + lead time)
 *   SDG weight        0.08   alignment with SDG 3 / 9 / 11 / 16
 *
 * Each card returns the per-criterion contribution (w_i * c_i * 100) which sums
 * exactly to the reported Impact Score, plus the evidence row ids it was built from.
 */
import { db, safeIdent } from '../db';
import { appendAudit } from '../lib/audit';
import { DatasetRow, findDataset } from '../lib/datasets';
import { clamp, mean, round } from '../lib/stats';

export interface Criterion {
  key: string;
  label: string;
  weight: number;
  raw: number;
  normalised: number;
  contribution: number;
  formula: string;
  inputs: Record<string, number | string>;
}

export interface PolicyCard {
  code: string;
  title: string;
  department: string;
  district: string;
  sector: string;
  impactScore: number;
  costCr: number;
  beneficiaries: number;
  action: string;
  rationale: string;
  criteria: Criterion[];
  evidence: { datasetSlug: string; rowIds: number[]; metric: string; measured: number; target: number };
  sdgs: number[];
}

export const CRITERION_WEIGHTS = {
  needSeverity: 0.28,
  populationReach: 0.22,
  fiscalHeadroom: 0.16,
  urgency: 0.14,
  feasibility: 0.12,
  sdgWeight: 0.08,
} as const;

interface Candidate {
  key: string;
  title: string;
  department: string;
  district: string;
  sector: string;
  measured: number;
  target: number;
  /** higher = worse */
  severityRaw: number;
  beneficiaries: number;
  costCr: number;
  leadTimeMonths: number;
  action: string;
  datasetSlug: string;
  rowIds: number[];
  metric: string;
  sdgs: number[];
  trendDelta: number;
}

/** Measured idle capital (released but unspent) per department, in ₹ crore. */
export function idleCapitalByDepartment(): Record<string, number> {
  const ds = findDataset('scheme_expenditure');
  if (!ds) return {};
  const rows = db
    .prepare(
      `SELECT department, SUM(released_cr) AS rel, SUM(spent_cr) AS spent FROM ${safeIdent(ds.table_name)} GROUP BY department`,
    )
    .all() as { department: string; rel: number; spent: number }[];
  const out: Record<string, number> = {};
  for (const r of rows) out[r.department] = round(Math.max(0, r.rel - r.spent), 2);
  return out;
}

export function totalIdleCapitalCr(): number {
  const byDept = idleCapitalByDepartment();
  return round(Object.values(byDept).reduce((a, b) => a + b, 0), 2);
}

function openAnomalyCount(entity: string): number {
  const r = db
    .prepare("SELECT COUNT(*) AS n FROM anomalies WHERE status = 'open' AND entity LIKE ?")
    .get(`%${entity}%`) as { n: number };
  return r.n;
}

/* ------------------------------------------------------- candidate mining */

function q<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T[] {
  return db.prepare(sql).all(...params) as T[];
}

function candidatesFromExpenditure(ds: DatasetRow): Candidate[] {
  const t = safeIdent(ds.table_name);
  const rows = q<{ district: string; state: string; department: string; scheme: string; alloc: number; rel: number; spent: number; ben: number; ids: string }>(
    `SELECT district, state, department, scheme, SUM(allocation_cr) alloc, SUM(released_cr) rel, SUM(spent_cr) spent,
            SUM(beneficiaries) ben, GROUP_CONCAT(row_id) ids
     FROM ${t} GROUP BY district, scheme HAVING SUM(released_cr) > 0
     ORDER BY (SUM(released_cr) - SUM(spent_cr)) DESC LIMIT 6`,
  );
  return rows.map((r) => {
    const util = r.alloc > 0 ? (r.spent / r.alloc) * 100 : 0;
    const idle = Math.max(0.5, r.rel - r.spent);
    return {
      key: `EXP-${r.district}-${r.scheme}`.replace(/[^A-Za-z0-9]+/g, '-').toUpperCase().slice(0, 40),
      title: `Unblock idle capital in ${r.scheme}, ${r.district}`,
      department: r.department,
      district: `${r.district}, ${r.state}`,
      sector: 'Public Finance',
      measured: round(util, 1),
      target: 90,
      severityRaw: clamp((90 - util) / 90, 0, 1),
      beneficiaries: Math.round(r.ben * 0.25),
      costCr: round(idle * 0.06, 2),
      leadTimeMonths: 6,
      action: `Issue revised sanction and district-level spending plan to convert ₹${round(idle, 2)} cr of released-but-unspent funds within two quarters; escalate pending utilisation certificates.`,
      datasetSlug: ds.slug,
      rowIds: String(r.ids).split(',').slice(0, 8).map(Number),
      metric: 'utilisation_pct',
      sdgs: [16, 11],
      trendDelta: round((90 - util) / 100, 3),
    };
  });
}

function candidatesFromHospitals(ds: DatasetRow): Candidate[] {
  const t = safeIdent(ds.table_name);
  const rows = q<{ district: string; occ: number; beds: number; icu_occ: number; ids: string }>(
    `SELECT district, AVG(1.0*beds_occupied/beds_total) occ, AVG(beds_total) beds,
            AVG(1.0*icu_occupied/icu_total) icu_occ, GROUP_CONCAT(row_id) ids
     FROM ${t} GROUP BY district ORDER BY occ DESC LIMIT 4`,
  );
  return rows.map((r) => {
    const occPct = r.occ * 100;
    const bedsNeeded = Math.max(20, Math.round(r.beds * Math.max(0, r.occ - 0.75)));
    return {
      key: `HSP-${r.district}`.replace(/[^A-Za-z0-9]+/g, '-').toUpperCase().slice(0, 40),
      title: `Add ${bedsNeeded} beds and ICU capacity in ${r.district}`,
      department: 'Health & Family Welfare',
      district: r.district,
      sector: 'Health',
      measured: round(occPct, 1),
      target: 75,
      severityRaw: clamp((occPct - 75) / 25, 0, 1),
      beneficiaries: Math.round(bedsNeeded * 320),
      costCr: round(bedsNeeded * 0.11, 2),
      leadTimeMonths: 14,
      action: `Sanction ${bedsNeeded} additional beds (of which ${Math.max(4, Math.round(bedsNeeded * 0.12))} ICU) and matching nursing posts in ${r.district}; occupancy has averaged ${round(occPct, 1)}% against the 75% safe-operating norm.`,
      datasetSlug: ds.slug,
      rowIds: String(r.ids).split(',').slice(0, 8).map(Number),
      metric: 'beds_occupied/beds_total',
      sdgs: [3, 11],
      trendDelta: round(clamp((r.icu_occ - 0.75) / 0.25, 0, 1), 3),
    };
  });
}

function candidatesFromAmbulance(ds: DatasetRow): Candidate[] {
  const t = safeIdent(ds.table_name);
  const rows = q<{ district: string; avg: number; p90: number; calls: number; veh: number; ids: string }>(
    `SELECT district, AVG(avg_response_min) avg, AVG(p90_response_min) p90, AVG(calls) calls, AVG(vehicles) veh,
            GROUP_CONCAT(row_id) ids FROM ${t} GROUP BY district ORDER BY avg DESC LIMIT 4`,
  );
  return rows.map((r) => {
    const add = Math.max(4, Math.round(r.veh * 0.18));
    return {
      key: `AMB-${r.district}`.replace(/[^A-Za-z0-9]+/g, '-').toUpperCase().slice(0, 40),
      title: `Predictive ambulance deployment in ${r.district} (+${add} vehicles)`,
      department: 'Health & Family Welfare',
      district: r.district,
      sector: 'Emergency Response',
      measured: round(r.avg, 1),
      target: 10,
      severityRaw: clamp((r.avg - 10) / 10, 0, 1),
      beneficiaries: Math.round(r.calls * 12),
      costCr: round(add * 0.42, 2),
      leadTimeMonths: 8,
      action: `Add ${add} ambulances and shift to hotspot-based standby positioning in ${r.district}; mean response is ${round(r.avg, 1)} min (p90 ${round(r.p90, 1)} min) against the 10-min urban norm.`,
      datasetSlug: ds.slug,
      rowIds: String(r.ids).split(',').slice(0, 8).map(Number),
      metric: 'avg_response_min',
      sdgs: [3, 11],
      trendDelta: round(clamp((r.p90 - 18) / 18, 0, 1), 3),
    };
  });
}

function candidatesFromBridges(ds: DatasetRow): Candidate[] {
  const t = safeIdent(ds.table_name);
  const rows = q<{ state: string; n: number; rating: number; cost: number; pcu: number; ids: string }>(
    `SELECT state, COUNT(*) n, AVG(ibms_rating) rating, SUM(repair_cost_cr) cost, AVG(traffic_pcu) pcu,
            GROUP_CONCAT(row_id) ids FROM ${t} WHERE ibms_rating < 75 GROUP BY state ORDER BY (75 - AVG(ibms_rating)) * COUNT(*) DESC LIMIT 4`,
  );
  return rows.map((r) => ({
    key: `BRG-${r.state}`.replace(/[^A-Za-z0-9]+/g, '-').toUpperCase().slice(0, 40),
    title: `Priority rehabilitation of ${r.n} distressed NH bridges in ${r.state}`,
    department: 'Road Transport & Highways',
    district: r.state,
    sector: 'Infrastructure',
    measured: round(r.rating, 1),
    target: 75,
    severityRaw: clamp((75 - r.rating) / 75, 0, 1),
    beneficiaries: Math.round(r.pcu * r.n * 3),
    costCr: round(r.cost, 2),
    leadTimeMonths: 18,
    action: `Tender rehabilitation for ${r.n} bridges in ${r.state} with mean IBMS rating ${round(r.rating, 1)} (below the 75 structural-distress threshold); estimated repair outlay ₹${round(r.cost, 2)} cr.`,
    datasetSlug: ds.slug,
    rowIds: String(r.ids).split(',').slice(0, 8).map(Number),
    metric: 'ibms_rating',
    sdgs: [9, 11],
    trendDelta: round(clamp((75 - r.rating) / 75, 0, 1), 3),
  }));
}

function candidatesFromWater(ds: DatasetRow): Candidate[] {
  const t = safeIdent(ds.table_name);
  const rows = q<{ district: string; tap: number; gap: number; rel: number; spent: number; ids: string }>(
    `SELECT district, AVG(functional_tap_pct) tap, AVG(target_households - households_covered) gap,
            MAX(capex_released_cr) rel, MAX(capex_spent_cr) spent, GROUP_CONCAT(row_id) ids
     FROM ${t} GROUP BY district ORDER BY tap ASC LIMIT 4`,
  );
  return rows.map((r) => ({
    key: `WTR-${r.district}`.replace(/[^A-Za-z0-9]+/g, '-').toUpperCase().slice(0, 40),
    title: `Close the tap-water gap in ${r.district} (${Math.round(r.gap).toLocaleString('en-IN')} households)`,
    department: 'Jal Shakti',
    district: r.district,
    sector: 'Water',
    measured: round(r.tap, 1),
    target: 95,
    severityRaw: clamp((95 - r.tap) / 95, 0, 1),
    beneficiaries: Math.round(r.gap * 4.4),
    costCr: round(Math.max(1, (r.rel - r.spent) * 0.5 + r.gap * 0.00012), 2),
    leadTimeMonths: 12,
    action: `Re-phase Jal Jeevan works in ${r.district}: functional tap coverage is ${round(r.tap, 1)}% and ₹${round(Math.max(0, r.rel - r.spent), 2)} cr of released capex is unspent. Convert to works orders and third-party functionality audit.`,
    datasetSlug: ds.slug,
    rowIds: String(r.ids).split(',').slice(0, 8).map(Number),
    metric: 'functional_tap_pct',
    sdgs: [3, 11],
    trendDelta: round(clamp((95 - r.tap) / 95, 0, 1), 3),
  }));
}

function candidatesFromAir(ds: DatasetRow): Candidate[] {
  const t = safeIdent(ds.table_name);
  const rows = q<{ city: string; aqi: number; pm: number; veh: number; ids: string }>(
    `SELECT city, AVG(aqi) aqi, AVG(pm25) pm, MAX(vehicles_registered) veh, GROUP_CONCAT(row_id) ids
     FROM ${t} GROUP BY city ORDER BY aqi DESC LIMIT 3`,
  );
  return rows.map((r) => ({
    key: `AIR-${r.city}`.replace(/[^A-Za-z0-9]+/g, '-').toUpperCase().slice(0, 40),
    title: `NCAP acceleration package for ${r.city}`,
    department: 'Environment & Climate',
    district: r.city,
    sector: 'Environment',
    measured: round(r.aqi, 1),
    target: 100,
    severityRaw: clamp((r.aqi - 100) / 200, 0, 1),
    beneficiaries: Math.round(r.veh * 1.6),
    costCr: round(38 + r.aqi * 0.22, 2),
    leadTimeMonths: 10,
    action: `Deploy dust-suppression fleet, construction-site monitoring and bus-fleet electrification in ${r.city}; mean AQI ${round(r.aqi, 1)} with PM2.5 at ${round(r.pm, 1)} µg/m³ against the 40 µg/m³ NAAQS annual norm.`,
    datasetSlug: ds.slug,
    rowIds: String(r.ids).split(',').slice(0, 8).map(Number),
    metric: 'aqi',
    sdgs: [3, 11],
    trendDelta: round(clamp((r.pm - 40) / 80, 0, 1), 3),
  }));
}

function candidatesFromTraffic(ds: DatasetRow): Candidate[] {
  const t = safeIdent(ds.table_name);
  const rows = q<{ city: string; corridor: string; idx: number; spd: number; inc: number; ids: string }>(
    `SELECT city, corridor, AVG(congestion_index) idx, AVG(avg_speed_kmph) spd, AVG(incidents) inc,
            GROUP_CONCAT(row_id) ids FROM ${t} GROUP BY city, corridor ORDER BY idx DESC LIMIT 3`,
  );
  return rows.map((r) => ({
    key: `TRF-${r.city}-${r.corridor}`.replace(/[^A-Za-z0-9]+/g, '-').toUpperCase().slice(0, 40),
    title: `Adaptive signal + bus priority on ${r.corridor}, ${r.city}`,
    department: 'Urban Affairs',
    district: r.city,
    sector: 'Mobility',
    measured: round(r.idx, 1),
    target: 45,
    severityRaw: clamp((r.idx - 45) / 55, 0, 1),
    beneficiaries: Math.round(r.inc * 5200),
    costCr: round(22 + r.idx * 0.35, 2),
    leadTimeMonths: 9,
    action: `Install adaptive signalling and bus-priority lanes on ${r.corridor} in ${r.city}; congestion index averages ${round(r.idx, 1)} with corridor speed down to ${round(r.spd, 1)} km/h.`,
    datasetSlug: ds.slug,
    rowIds: String(r.ids).split(',').slice(0, 8).map(Number),
    metric: 'congestion_index',
    sdgs: [11, 9],
    trendDelta: round(clamp((45 - r.spd) / 45, 0, 1), 3),
  }));
}

function candidatesFromGrievances(ds: DatasetRow): Candidate[] {
  const t = safeIdent(ds.table_name);
  const rows = q<{ department: string; days: number; n: number; open: number; ids: string }>(
    `SELECT department, AVG(days_to_close) days, COUNT(*) n,
            SUM(CASE WHEN status <> 'Closed' THEN 1 ELSE 0 END) open, GROUP_CONCAT(row_id) ids
     FROM ${t} GROUP BY department ORDER BY days DESC LIMIT 3`,
  );
  return rows.map((r) => ({
    key: `GRV-${r.department}`.replace(/[^A-Za-z0-9]+/g, '-').toUpperCase().slice(0, 40),
    title: `Grievance SLA automation for ${r.department}`,
    department: r.department,
    district: 'All districts',
    sector: 'Governance',
    measured: round(r.days, 1),
    target: 21,
    severityRaw: clamp((r.days - 21) / 40, 0, 1),
    beneficiaries: Math.round(r.n * 45),
    costCr: round(6 + r.n * 0.004, 2),
    leadTimeMonths: 5,
    action: `Introduce auto-routing, 21-day SLA clocks and escalation to the district nodal officer for ${r.department}; mean closure time is ${round(r.days, 1)} days with ${r.open} tickets still open.`,
    datasetSlug: ds.slug,
    rowIds: String(r.ids).split(',').slice(0, 8).map(Number),
    metric: 'days_to_close',
    sdgs: [16],
    trendDelta: round(clamp(r.open / Math.max(1, r.n), 0, 1), 3),
  }));
}

const MINERS: Record<string, (ds: DatasetRow) => Candidate[]> = {
  scheme_expenditure: candidatesFromExpenditure,
  hospital_capacity: candidatesFromHospitals,
  ambulance_response: candidatesFromAmbulance,
  bridge_health: candidatesFromBridges,
  water_supply: candidatesFromWater,
  air_quality: candidatesFromAir,
  traffic_congestion: candidatesFromTraffic,
  citizen_grievances: candidatesFromGrievances,
};

const SDG_WEIGHTS: Record<number, number> = { 3: 1.0, 9: 0.85, 11: 0.9, 16: 0.8 };

/* --------------------------------------------------------------- scoring */

export function generatePolicyCards(): PolicyCard[] {
  const candidates: Candidate[] = [];
  for (const [slug, miner] of Object.entries(MINERS)) {
    const ds = findDataset(slug);
    if (!ds || ds.row_count === 0) continue;
    try {
      candidates.push(...miner(ds));
    } catch {
      // A dataset with a different shape simply contributes no candidates.
    }
  }
  if (!candidates.length) return [];

  const maxBen = Math.max(...candidates.map((c) => c.beneficiaries), 1);
  const maxCost = Math.max(...candidates.map((c) => c.costCr), 1);
  const idle = idleCapitalByDepartment();
  const totalIdle = totalIdleCapitalCr() || 1;

  const cards = candidates.map((c, i) => {
    const deptIdle = idle[c.department] ?? totalIdle / Math.max(1, Object.keys(idle).length);
    const anomalies = openAnomalyCount(c.district.split(',')[0]);
    const criteriaSpec: Criterion[] = [
      {
        key: 'needSeverity',
        label: 'Need severity',
        weight: CRITERION_WEIGHTS.needSeverity,
        raw: round(c.measured, 2),
        normalised: round(clamp(c.severityRaw, 0, 1), 4),
        contribution: 0,
        formula: 'clamp(|measured - target| / target, 0, 1)',
        inputs: { measured: round(c.measured, 2), target: c.target, metric: c.metric },
      },
      {
        key: 'populationReach',
        label: 'Population reach',
        weight: CRITERION_WEIGHTS.populationReach,
        raw: c.beneficiaries,
        normalised: round(clamp(Math.log10(1 + c.beneficiaries) / Math.log10(1 + maxBen), 0, 1), 4),
        contribution: 0,
        formula: 'log10(1 + beneficiaries) / log10(1 + max beneficiaries across candidates)',
        inputs: { beneficiaries: c.beneficiaries, maxBeneficiaries: maxBen },
      },
      {
        key: 'fiscalHeadroom',
        label: 'Fiscal headroom',
        weight: CRITERION_WEIGHTS.fiscalHeadroom,
        raw: round(deptIdle, 2),
        normalised: round(clamp(deptIdle / Math.max(1, c.costCr * 4), 0, 1), 4),
        contribution: 0,
        formula: 'clamp(departmentIdleCapitalCr / (4 x costCr), 0, 1)',
        inputs: { departmentIdleCapitalCr: round(deptIdle, 2), costCr: c.costCr, department: c.department },
      },
      {
        key: 'urgency',
        label: 'Urgency',
        weight: CRITERION_WEIGHTS.urgency,
        raw: round(c.trendDelta, 3),
        normalised: round(clamp(0.6 * c.trendDelta + 0.4 * Math.min(1, anomalies / 6), 0, 1), 4),
        contribution: 0,
        formula: 'clamp(0.6 x trendDeterioration + 0.4 x min(1, openAnomalies/6), 0, 1)',
        inputs: { trendDeterioration: round(c.trendDelta, 3), openAnomalies: anomalies },
      },
      {
        key: 'feasibility',
        label: 'Feasibility',
        weight: CRITERION_WEIGHTS.feasibility,
        raw: c.leadTimeMonths,
        normalised: round(clamp(1 - (0.6 * (c.costCr / maxCost) + 0.4 * (c.leadTimeMonths / 24)), 0, 1), 4),
        contribution: 0,
        formula: '1 - (0.6 x costCr/maxCostCr + 0.4 x leadTimeMonths/24)',
        inputs: { costCr: c.costCr, maxCostCr: round(maxCost, 2), leadTimeMonths: c.leadTimeMonths },
      },
      {
        key: 'sdgWeight',
        label: 'SDG alignment',
        weight: CRITERION_WEIGHTS.sdgWeight,
        raw: c.sdgs.length,
        normalised: round(clamp(mean(c.sdgs.map((s) => SDG_WEIGHTS[s] ?? 0.6)), 0, 1), 4),
        contribution: 0,
        formula: 'mean(weight of each mapped SDG); SDG3=1.0, SDG11=0.9, SDG9=0.85, SDG16=0.8',
        inputs: { sdgs: c.sdgs.join('/') },
      },
    ];
    let total = 0;
    for (const cr of criteriaSpec) {
      cr.contribution = round(cr.weight * cr.normalised * 100, 3);
      total += cr.contribution;
    }
    const impact = round(total, 2);
    return {
      code: `PC-${String(i + 1).padStart(3, '0')}-${c.key}`.slice(0, 48),
      title: c.title,
      department: c.department,
      district: c.district,
      sector: c.sector,
      impactScore: impact,
      costCr: c.costCr,
      beneficiaries: c.beneficiaries,
      action: c.action,
      rationale:
        `Impact ${impact}/100 = ` +
        criteriaSpec.map((cr) => `${cr.label} ${cr.contribution}`).join(' + ') +
        `. Measured ${c.metric} = ${round(c.measured, 2)} against target ${c.target} on dataset '${c.datasetSlug}' (${c.rowIds.length} evidence rows).`,
      criteria: criteriaSpec,
      evidence: {
        datasetSlug: c.datasetSlug,
        rowIds: c.rowIds,
        metric: c.metric,
        measured: round(c.measured, 2),
        target: c.target,
      },
      sdgs: c.sdgs,
    };
  });
  cards.sort((a, b) => b.impactScore - a.impactScore);
  return cards;
}

export interface StoredPolicyCard extends PolicyCard {
  id: number;
  createdAt: string;
}

function rowToCard(r: Record<string, unknown>): StoredPolicyCard {
  return {
    id: Number(r.id),
    code: String(r.code),
    title: String(r.title),
    department: String(r.department),
    district: String(r.district),
    sector: String(r.sector),
    impactScore: Number(r.impact_score),
    costCr: Number(r.cost_cr),
    beneficiaries: Number(r.beneficiaries),
    action: String(r.action),
    rationale: String(r.rationale),
    criteria: JSON.parse(String(r.criteria_json)) as Criterion[],
    evidence: JSON.parse(String(r.evidence_json)) as PolicyCard['evidence'],
    sdgs: JSON.parse(String(r.sdg_json)) as number[],
    createdAt: String(r.created_at),
  };
}

export function listPolicyCards(): StoredPolicyCard[] {
  const rows = db.prepare('SELECT * FROM policy_cards ORDER BY impact_score DESC').all() as Record<string, unknown>[];
  return rows.map(rowToCard);
}

export function policyCardCount(): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM policy_cards').get() as { n: number }).n;
}

/** Recomputes and stores the policy cards. Called on boot when the table is empty. */
export function refreshPolicyCards(actor = 'system@civicnexus.in', actorRole = 'system'): StoredPolicyCard[] {
  const cards = generatePolicyCards();
  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM policy_cards').run();
    const ins = db.prepare(
      `INSERT INTO policy_cards(code, title, department, district, sector, impact_score, cost_cr, beneficiaries,
        action, rationale, criteria_json, evidence_json, sdg_json, created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    );
    for (const c of cards) {
      ins.run(
        c.code, c.title, c.department, c.district, c.sector, c.impactScore, c.costCr, c.beneficiaries,
        c.action, c.rationale, JSON.stringify(c.criteria), JSON.stringify(c.evidence), JSON.stringify(c.sdgs), now,
      );
    }
  });
  tx();
  appendAudit({
    actor,
    actorRole,
    action: 'ai.policy_cards_refresh',
    entity: 'policy_cards',
    payload: { cards: cards.length, weights: CRITERION_WEIGHTS, topImpact: cards[0]?.impactScore ?? 0 },
  });
  return listPolicyCards();
}
