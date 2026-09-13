/**
 * Deterministic seed-CSV generators (SPEC §3).
 *
 * Every file is produced from a fixed PRNG seed, so re-running the generator
 * byte-for-byte reproduces the same CSVs. All money is in ₹ crore.
 * Time series span FY2019-20 .. FY2025-26 / 2019-01 .. 2025-12.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../db';
import { Rng } from './rng';
import {
  CITIES,
  DEPARTMENTS,
  DISTRICTS,
  FIRST_NAMES,
  GRIEVANCE_CATEGORIES,
  LAST_NAMES,
  NH_NUMBERS,
  SCHEMES,
} from './geo';

export const SEED_DIR = path.resolve(ROOT, 'seed');

export interface SeedFileSpec {
  file: string;
  slug: string;
  title: string;
  domain: string;
  minRows: number;
  containsPii: boolean;
  description: string;
}

/** Registry of the 8 seeded datasets. */
export const SEED_FILES: SeedFileSpec[] = [
  {
    file: 'scheme_expenditure.csv',
    slug: 'scheme_expenditure',
    title: 'Centrally Sponsored Scheme Expenditure',
    domain: 'Public Finance',
    minRows: 900,
    containsPii: false,
    description:
      'Allocation / release / spend and beneficiary counts per scheme, department, district and financial year.',
  },
  {
    file: 'hospital_capacity.csv',
    slug: 'hospital_capacity',
    title: 'District Hospital Capacity',
    domain: 'Health',
    minRows: 800,
    containsPii: false,
    description: 'Monthly bed and ICU occupancy with nursing / doctor staffing per district.',
  },
  {
    file: 'ambulance_response.csv',
    slug: 'ambulance_response',
    title: 'Emergency Ambulance Response',
    domain: 'Health',
    minRows: 800,
    containsPii: false,
    description: 'Monthly 108-service call volume, mean and p90 response minutes, fleet and hotspot index.',
  },
  {
    file: 'bridge_health.csv',
    slug: 'bridge_health',
    title: 'National Highway Bridge Health (IBMS)',
    domain: 'Infrastructure',
    minRows: 500,
    containsPii: false,
    description: 'Structural rating, span, traffic load and repair cost estimate per national-highway bridge.',
  },
  {
    file: 'water_supply.csv',
    slug: 'water_supply',
    title: 'Jal Jeevan Mission Water Supply',
    domain: 'Water',
    minRows: 700,
    containsPii: false,
    description: 'Monthly household coverage, functional tap percentage and capex release vs spend per district.',
  },
  {
    file: 'air_quality.csv',
    slug: 'air_quality',
    title: 'Urban Ambient Air Quality',
    domain: 'Environment',
    minRows: 700,
    containsPii: false,
    description: 'Monthly PM2.5 / PM10 / NO2 / AQI with registered vehicle stock per city.',
  },
  {
    file: 'traffic_congestion.csv',
    slug: 'traffic_congestion',
    title: 'Urban Corridor Traffic Congestion',
    domain: 'Mobility',
    minRows: 700,
    containsPii: false,
    description: 'Monthly congestion index, average corridor speed and incident count per city corridor.',
  },
  {
    file: 'citizen_grievances.csv',
    slug: 'citizen_grievances',
    title: 'Citizen Grievance Redressal (raw, contains PII)',
    domain: 'Governance',
    minRows: 900,
    containsPii: true,
    description:
      'Raw grievance tickets including citizen name, phone, email and Aadhaar reference — used to demonstrate the masking pipeline.',
  },
];

/* ------------------------------------------------------------------ utils */

function csvEscape(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Three deterministic defect lines appended to selected seed files so the
 * ingestion pipeline's reject path (RAGGED_ROW / SCHEMA_VIOLATION) is
 * exercised with real data instead of being an untested branch.
 */
function defectLines(header: string[], sample: (string | number)[]): string[] {
  const cells = sample.map((c) => csvEscape(c));
  const short = cells.slice(0, Math.max(1, Math.floor(header.length / 2)));
  const long = [...cells, 'EXTRA_UNMAPPED_CELL'];
  const numericIdx = sample.findIndex(
    (c, i) => i > 0 && typeof c !== 'string' && Number.isFinite(Number(c)),
  );
  const bad = [...cells];
  if (numericIdx >= 0) bad[numericIdx] = 'NOT_A_NUMBER';
  return [short.join(','), long.join(','), bad.join(',')];
}

function writeCsv(
  file: string,
  header: string[],
  rows: (string | number)[][],
  withDefects = false,
): number {
  const lines = [header.join(',')];
  for (const r of rows) lines.push(r.map(csvEscape).join(','));
  if (withDefects && rows.length) lines.push(...defectLines(header, rows[rows.length - 1]));
  fs.mkdirSync(SEED_DIR, { recursive: true });
  fs.writeFileSync(path.join(SEED_DIR, file), lines.join('\n') + '\n', 'utf8');
  return rows.length;
}

/** 2019-01 .. 2025-12 monthly keys */
function months(): string[] {
  const out: string[] = [];
  for (let y = 2019; y <= 2025; y++) {
    for (let m = 1; m <= 12; m++) out.push(`${y}-${String(m).padStart(2, '0')}`);
  }
  return out;
}

const FYS = ['2019-20', '2020-21', '2021-22', '2022-23', '2023-24', '2024-25', '2025-26'];

/* ------------------------------------------------------- 1. expenditure */

function genSchemeExpenditure(): number {
  const rng = new Rng('scheme_expenditure/v1');
  const header = [
    'scheme', 'department', 'state', 'district', 'fy',
    'allocation_cr', 'released_cr', 'spent_cr', 'beneficiaries', 'utilisation_pct',
  ];
  const rows: (string | number)[][] = [];
  for (const s of SCHEMES) {
    const districts = new Rng(`dist/${s.scheme}`).shuffle([...DISTRICTS]).slice(0, 12);
    for (const d of districts) {
      let base = rng.float(40, 900, 2);
      for (let i = 0; i < FYS.length; i++) {
        const fy = FYS[i];
        const growth = 1 + 0.06 * i + rng.normal(0, 0.05);
        const allocation = Math.max(5, Math.round(base * growth * 100) / 100);
        // release ratio dips in COVID years, some districts chronically under-release
        const relRatio = Math.min(1, Math.max(0.42, rng.normal(fy === '2020-21' ? 0.66 : 0.86, 0.09)));
        const released = Math.round(allocation * relRatio * 100) / 100;
        let spendRatio = Math.min(1, Math.max(0.3, rng.normal(0.82, 0.12)));
        // deliberate idle-capital pockets: Jal Jeevan style 36% utilisation
        if (s.scheme === 'Jal Jeevan Mission' && rng.bool(0.35)) spendRatio = rng.float(0.28, 0.45, 3);
        const spent = Math.round(released * spendRatio * 100) / 100;
        const perCrore = rng.int(120, 900);
        const beneficiaries = Math.max(0, Math.round(spent * perCrore));
        const utilisation = allocation > 0 ? Math.round((spent / allocation) * 1000) / 10 : 0;
        rows.push([
          s.scheme, s.department, d.state, d.district, fy,
          allocation, released, spent, beneficiaries, utilisation,
        ]);
        base = allocation;
      }
    }
  }
  return writeCsv('scheme_expenditure.csv', header, rows);
}

/* ---------------------------------------------------- 2. hospital beds */

const HOSP_DISTRICTS = DISTRICTS.slice(0, 10);

function genHospitalCapacity(): number {
  const rng = new Rng('hospital_capacity/v1');
  const header = [
    'district', 'month', 'beds_total', 'beds_occupied', 'icu_total', 'icu_occupied',
    'staff_nurses', 'staff_doctors',
  ];
  const rows: (string | number)[][] = [];
  const ms = months();
  for (const d of HOSP_DISTRICTS) {
    const bedsBase = rng.int(420, 2400);
    const icuBase = Math.round(bedsBase * rng.float(0.05, 0.11, 3));
    for (let i = 0; i < ms.length; i++) {
      const month = ms[i];
      const year = Number(month.slice(0, 4));
      const mm = Number(month.slice(5));
      const bedsTotal = Math.round(bedsBase * (1 + 0.012 * (i / 12)));
      const icuTotal = Math.max(6, Math.round(icuBase * (1 + 0.02 * (i / 12))));
      // seasonal: monsoon + winter respiratory load; COVID waves in 2020-21
      const season = 1 + 0.12 * Math.sin(((mm - 4) / 12) * 2 * Math.PI);
      const covid = year === 2020 || (year === 2021 && mm <= 8) ? rng.float(1.12, 1.34, 3) : 1;
      let occ = Math.min(0.99, rng.normal(0.68, 0.07) * season * covid);
      if (rng.bool(0.012)) occ = Math.min(1.0, occ * rng.float(1.25, 1.4, 3)); // injected surge anomaly
      const bedsOccupied = Math.round(bedsTotal * Math.max(0.2, occ));
      const icuOccupied = Math.min(icuTotal, Math.round(icuTotal * Math.min(1, occ * rng.float(1.0, 1.18, 3))));
      const nurses = Math.round(bedsTotal * rng.float(0.32, 0.55, 3));
      const doctors = Math.round(bedsTotal * rng.float(0.07, 0.14, 3));
      rows.push([d.district, month, bedsTotal, bedsOccupied, icuTotal, icuOccupied, nurses, doctors]);
    }
  }
  return writeCsv('hospital_capacity.csv', header, rows, true);
}

/* --------------------------------------------------- 3. ambulance data */

function genAmbulanceResponse(): number {
  const rng = new Rng('ambulance_response/v1');
  const header = ['district', 'month', 'calls', 'avg_response_min', 'p90_response_min', 'vehicles', 'hotspot_index'];
  const rows: (string | number)[][] = [];
  const ms = months();
  for (const d of HOSP_DISTRICTS) {
    const callBase = rng.int(900, 6200);
    const vehicles = rng.int(12, 74);
    for (let i = 0; i < ms.length; i++) {
      const month = ms[i];
      const mm = Number(month.slice(5));
      const calls = Math.round(callBase * (1 + 0.02 * (i / 12)) * (1 + 0.09 * Math.sin(((mm - 6) / 12) * 2 * Math.PI)) * rng.float(0.94, 1.06, 3));
      const load = calls / (vehicles * 90);
      let avg = 8.5 + 6.5 * load + rng.normal(0, 1.1);
      if (rng.bool(0.015)) avg *= rng.float(1.4, 1.85, 3); // injected delay anomaly
      avg = Math.max(4.2, Math.round(avg * 10) / 10);
      const p90 = Math.round(avg * rng.float(1.55, 1.95, 3) * 10) / 10;
      const hotspot = Math.round(Math.min(100, load * 55 + rng.float(0, 22, 2)) * 10) / 10;
      rows.push([d.district, month, calls, avg, p90, vehicles + Math.floor(i / 30), hotspot]);
    }
  }
  return writeCsv('ambulance_response.csv', header, rows);
}

/* ------------------------------------------------------- 4. bridges */

function genBridgeHealth(): number {
  const rng = new Rng('bridge_health/v1');
  const header = [
    'bridge_id', 'nh_number', 'state', 'span_m', 'year_built', 'last_inspection',
    'ibms_rating', 'traffic_pcu', 'repair_cost_cr',
  ];
  const total = 520;
  const distressed = 471; // MoRTH/IBMS: 471 NH bridges rated below 75
  const rows: (string | number)[][] = [];
  for (let i = 0; i < total; i++) {
    const d = DISTRICTS[i % DISTRICTS.length];
    const isDistressed = i < distressed;
    const rating = isDistressed
      ? Math.round(rng.float(18, 74.5, 1) * 10) / 10
      : Math.round(rng.float(75.1, 97, 1) * 10) / 10;
    const yearBuilt = isDistressed ? rng.int(1958, 2004) : rng.int(1996, 2021);
    const span = rng.float(18, 1240, 1);
    const insMonth = rng.int(1, 12);
    const insYear = rng.int(2022, 2025);
    const traffic = rng.int(2400, 98000);
    const repair = Math.round(((100 - rating) / 100) * (span / 100) * rng.float(0.9, 3.4, 3) * 10 * 100) / 100;
    rows.push([
      `IBMS-${String(10000 + i)}`,
      rng.pick(NH_NUMBERS),
      d.state,
      span,
      yearBuilt,
      `${insYear}-${String(insMonth).padStart(2, '0')}-${String(rng.int(1, 28)).padStart(2, '0')}`,
      rating,
      traffic,
      Math.max(0.12, repair),
    ]);
  }
  return writeCsv('bridge_health.csv', header, new Rng('bridge_shuffle').shuffle(rows));
}

/* --------------------------------------------------------- 5. water */

function genWaterSupply(): number {
  const rng = new Rng('water_supply/v1');
  const header = [
    'district', 'month', 'households_covered', 'target_households',
    'functional_tap_pct', 'capex_released_cr', 'capex_spent_cr',
  ];
  const rows: (string | number)[][] = [];
  const ms = months();
  const ds = DISTRICTS.slice(10, 19);
  for (const d of ds) {
    const target = rng.int(48000, 520000);
    let covered = Math.round(target * rng.float(0.12, 0.35, 3));
    let released = 0;
    let spent = 0;
    for (let i = 0; i < ms.length; i++) {
      const month = ms[i];
      covered = Math.min(target, covered + Math.round(target * rng.float(0.002, 0.012, 4)));
      const tap = Math.round(Math.min(99.5, (covered / target) * 100 * rng.float(0.82, 0.99, 3)) * 10) / 10;
      released = Math.round((released + rng.float(0.4, 7.5, 2)) * 100) / 100;
      // deliberate idle capital: ~64% of Jal Jeevan heads remained unspent (CAG)
      const spendStep = rng.float(0.1, 3.1, 2) * (rng.bool(0.3) ? 0.35 : 1);
      spent = Math.round(Math.min(released, spent + spendStep) * 100) / 100;
      rows.push([d.district, month, covered, target, tap, released, spent]);
    }
  }
  return writeCsv('water_supply.csv', header, rows, true);
}

/* ----------------------------------------------------- 6. air quality */

function genAirQuality(): number {
  const rng = new Rng('air_quality/v1');
  const header = ['city', 'date', 'pm25', 'pm10', 'no2', 'aqi', 'vehicles_registered'];
  const rows: (string | number)[][] = [];
  const ms = months();
  const cities = CITIES.slice(0, 9);
  for (const city of cities) {
    const level = rng.float(0.7, 1.9, 3);
    let vehicles = rng.int(420000, 8200000);
    for (let i = 0; i < ms.length; i++) {
      const month = ms[i];
      const mm = Number(month.slice(5));
      const winter = 1 + 0.55 * Math.cos(((mm - 1) / 12) * 2 * Math.PI);
      let pm25 = Math.max(9, 46 * level * winter * rng.float(0.85, 1.18, 3));
      if (rng.bool(0.012)) pm25 *= rng.float(1.5, 2.0, 3); // stubble-burning / inversion spike
      const pm10 = pm25 * rng.float(1.6, 2.4, 3);
      const no2 = Math.max(6, 24 * level * rng.float(0.7, 1.4, 3));
      const aqi = Math.min(500, Math.round(pm25 * 2.05 + pm10 * 0.28 + no2 * 0.5));
      vehicles = Math.round(vehicles * (1 + rng.float(0.001, 0.006, 4)));
      rows.push([
        city, `${month}-01`,
        Math.round(pm25 * 10) / 10, Math.round(pm10 * 10) / 10, Math.round(no2 * 10) / 10,
        aqi, vehicles,
      ]);
    }
  }
  return writeCsv('air_quality.csv', header, rows);
}

/* -------------------------------------------------------- 7. traffic */

function genTrafficCongestion(): number {
  const rng = new Rng('traffic_congestion/v1');
  const header = ['city', 'corridor', 'month', 'congestion_index', 'avg_speed_kmph', 'incidents'];
  const rows: (string | number)[][] = [];
  const ms = months();
  const cities = CITIES.slice(0, 3);
  const corridors = ['Ring Road', 'Airport Expressway', 'Old City Arterial'];
  for (const city of cities) {
    for (const corridor of corridors) {
      const base = rng.float(38, 78, 2);
      for (let i = 0; i < ms.length; i++) {
        const mm = Number(ms[i].slice(5));
        const season = 1 + 0.08 * Math.sin(((mm - 9) / 12) * 2 * Math.PI);
        let idx = Math.min(99, base * season * (1 + 0.015 * (i / 12)) * rng.float(0.93, 1.08, 3));
        if (rng.bool(0.012)) idx = Math.min(99.5, idx * rng.float(1.2, 1.35, 3));
        const speed = Math.max(6, Math.round((62 - 0.48 * idx + rng.normal(0, 2.2)) * 10) / 10);
        const incidents = Math.max(0, Math.round(idx * rng.float(0.15, 0.5, 3)));
        rows.push([city, corridor, ms[i], Math.round(idx * 10) / 10, speed, incidents]);
      }
    }
  }
  return writeCsv('traffic_congestion.csv', header, rows);
}

/* ---------------------------------------------- 8. grievances (PII!) */

function genCitizenGrievances(): number {
  const rng = new Rng('citizen_grievances/v1');
  const header = [
    'ticket_id', 'department', 'district', 'opened_on', 'closed_on', 'days_to_close',
    'category', 'citizen_name', 'citizen_phone', 'citizen_email', 'aadhaar_ref', 'status',
  ];
  const rows: (string | number)[][] = [];
  const n = 960;
  for (let i = 0; i < n; i++) {
    const d = rng.pick(DISTRICTS);
    const dept = rng.pick(DEPARTMENTS);
    const y = rng.int(2023, 2025);
    const m = rng.int(1, 12);
    const day = rng.int(1, 28);
    const opened = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const open = rng.bool(0.17);
    const days = open ? '' : rng.int(1, 96);
    let closed = '';
    if (!open) {
      const dt = new Date(Date.UTC(y, m - 1, day) + Number(days) * 86400000);
      closed = dt.toISOString().slice(0, 10);
    }
    const first = rng.pick(FIRST_NAMES);
    const last = rng.pick(LAST_NAMES);
    const name = `${first} ${last}`;
    const phone = `+91${rng.int(6, 9)}${String(rng.int(100000000, 999999999))}`;
    const email = `${first.toLowerCase()}.${last.toLowerCase()}${rng.int(11, 99)}@${rng.pick(['gmail.com', 'yahoo.in', 'rediffmail.com', 'outlook.com'])}`;
    const aadhaar = `${rng.int(2000, 9999)}${rng.int(1000, 9999)}${rng.int(1000, 9999)}`;
    rows.push([
      `GRV-${y}-${String(100000 + i)}`,
      dept, d.district, opened, closed, days,
      rng.pick(GRIEVANCE_CATEGORIES),
      name, phone, email, aadhaar,
      open ? 'Open' : rng.bool(0.12) ? 'Escalated' : 'Closed',
    ]);
  }
  return writeCsv('citizen_grievances.csv', header, rows, true);
}

/* ------------------------------------------------------------- driver */

export function generateSeedFiles(force = false): Record<string, number> {
  const result: Record<string, number> = {};
  const gens: Record<string, () => number> = {
    'scheme_expenditure.csv': genSchemeExpenditure,
    'hospital_capacity.csv': genHospitalCapacity,
    'ambulance_response.csv': genAmbulanceResponse,
    'bridge_health.csv': genBridgeHealth,
    'water_supply.csv': genWaterSupply,
    'air_quality.csv': genAirQuality,
    'traffic_congestion.csv': genTrafficCongestion,
    'citizen_grievances.csv': genCitizenGrievances,
  };
  for (const spec of SEED_FILES) {
    const target = path.join(SEED_DIR, spec.file);
    if (!force && fs.existsSync(target)) {
      const rows = fs.readFileSync(target, 'utf8').trim().split('\n').length - 1;
      result[spec.file] = rows;
      continue;
    }
    result[spec.file] = gens[spec.file]();
  }
  return result;
}

if (require.main === module) {
  const counts = generateSeedFiles(true);
  for (const [f, n] of Object.entries(counts)) {
    const spec = SEED_FILES.find((s) => s.file === f)!;
    const ok = n >= spec.minRows ? 'OK ' : 'LOW';
    console.log(`${ok} ${f.padEnd(28)} ${String(n).padStart(5)} rows (min ${spec.minRows})`);
  }
}
