/**
 * AI-7 — Fund optimiser (SPEC §5): 0/1 knapsack by dynamic programming over
 * the AI-6 policy cards.
 *
 *   value_i  = impactScore_i        (0-100, from AI-6)
 *   weight_i = round(costCr_i)      (₹ crore, integerised at 1 cr granularity)
 *   DP[i][b] = max(DP[i-1][b], DP[i-1][b - w_i] + v_i)
 *
 * Default budget is derived live from measured idle capital
 * (released-but-unspent) across all schemes: budget = 35% of idle capital.
 * A Pareto frontier is produced by sweeping the budget from 10%..200% of the
 * default and re-solving.
 */
import { round } from '../lib/stats';
import { StoredPolicyCard, listPolicyCards, totalIdleCapitalCr } from './mcda';

export interface OptimiseResult {
  engine: 'AI-7';
  budgetCr: number;
  budgetSource: string;
  idleCapitalCr: number;
  granularityCr: number;
  candidates: number;
  chosen: {
    code: string;
    title: string;
    department: string;
    district: string;
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

function solveKnapsack(cards: StoredPolicyCard[], budget: number): { chosen: StoredPolicyCard[]; value: number } {
  const B = Math.max(0, Math.floor(budget));
  const n = cards.length;
  if (!n || B === 0) return { chosen: [], value: 0 };
  const w = cards.map((c) => Math.max(1, Math.round(c.costCr)));
  const v = cards.map((c) => c.impactScore);
  // DP table with reconstruction
  const dp: Float64Array[] = Array.from({ length: n + 1 }, () => new Float64Array(B + 1));
  for (let i = 1; i <= n; i++) {
    const row = dp[i];
    const prev = dp[i - 1];
    for (let b = 0; b <= B; b++) {
      row[b] = prev[b];
      if (w[i - 1] <= b) {
        const cand = prev[b - w[i - 1]] + v[i - 1];
        if (cand > row[b]) row[b] = cand;
      }
    }
  }
  const chosen: StoredPolicyCard[] = [];
  let b = B;
  for (let i = n; i >= 1; i--) {
    if (dp[i][b] !== dp[i - 1][b]) {
      chosen.push(cards[i - 1]);
      b -= w[i - 1];
    }
  }
  chosen.reverse();
  return { chosen, value: dp[n][B] };
}

export function runOptimiser(opts: { budgetCr?: number; cards?: StoredPolicyCard[] } = {}): OptimiseResult {
  const cards = opts.cards ?? listPolicyCards();
  const idle = totalIdleCapitalCr();
  /**
   * Default envelope: 35% of measured idle capital, but never more than 60% of
   * what every candidate together would cost — otherwise the budget is not a
   * constraint at all and the knapsack degenerates into "fund everything".
   */
  const askCr = round(cards.reduce((a, c) => a + c.costCr, 0), 2);
  const derived = round(Math.max(50, Math.min(idle * 0.35, askCr * 0.6)), 2);
  const budget = opts.budgetCr != null ? round(opts.budgetCr, 2) : derived;
  const budgetSource =
    opts.budgetCr != null
      ? 'explicit budgetCr supplied by the caller'
      : `derived live: min(35% of measured idle capital ₹${idle} cr, 60% of the ₹${askCr} cr total ask), floor ₹50 cr`;

  const { chosen, value } = solveKnapsack(cards, budget);
  const chosenCodes = new Set(chosen.map((c) => c.code));
  const totalCost = round(chosen.reduce((a, c) => a + c.costCr, 0), 2);
  const beneficiaries = chosen.reduce((a, c) => a + c.beneficiaries, 0);

  const frontier: OptimiseResult['paretoFrontier'] = [];
  for (const f of [0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2]) {
    const b = round(budget * f, 2);
    const sol = solveKnapsack(cards, b);
    const cost = round(sol.chosen.reduce((a, c) => a + c.costCr, 0), 2);
    frontier.push({
      budgetCr: b,
      totalImpact: round(sol.value, 2),
      totalCostCr: cost,
      items: sol.chosen.length,
      utilisationPct: b > 0 ? round((cost / b) * 100, 1) : 0,
    });
  }

  return {
    engine: 'AI-7',
    budgetCr: budget,
    budgetSource,
    idleCapitalCr: idle,
    granularityCr: 1,
    candidates: cards.length,
    chosen: chosen.map((c) => ({
      code: c.code,
      title: c.title,
      department: c.department,
      district: c.district,
      impactScore: c.impactScore,
      costCr: c.costCr,
      beneficiaries: c.beneficiaries,
      impactPerCr: round(c.impactScore / Math.max(1, c.costCr), 3),
    })),
    rejected: cards
      .filter((c) => !chosenCodes.has(c.code))
      .map((c) => ({
        code: c.code,
        title: c.title,
        impactScore: c.impactScore,
        costCr: c.costCr,
        reason:
          c.costCr > budget
            ? `cost ₹${c.costCr} cr exceeds the whole budget of ₹${budget} cr`
            : 'excluded by the DP optimum — displacing a selected item would lower total impact',
      })),
    totalImpact: round(value, 2),
    totalCostCr: totalCost,
    utilisationPct: budget > 0 ? round((totalCost / budget) * 100, 1) : 0,
    beneficiaries,
    impactPerCr: totalCost > 0 ? round(value / totalCost, 3) : 0,
    paretoFrontier: frontier,
    formulas: {
      knapsack: 'DP[i][b] = max(DP[i-1][b], DP[i-1][b - w_i] + v_i); v_i = impactScore, w_i = round(costCr)',
      defaultBudget: 'budget = max(50, 0.35 x sum over schemes of (released_cr - spent_cr))',
      utilisation: 'utilisation% = 100 x selectedCost / budget',
      impactPerCr: 'impactPerCr = totalImpact / totalCostCr',
    },
  };
}
