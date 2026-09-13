/**
 * Multi-page executive-brief PDF (SPEC §6) using pdfkit with a bundled Unicode
 * font (Noto Sans) so the ₹ glyph (U+20B9) renders correctly — Helvetica's
 * standard encoding cannot represent it.
 */
import fs from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import type { ExecutiveBrief } from './brief';

/**
 * Font lookup works both for `tsx server/index.ts` (fonts next to the source)
 * and for the compiled `dist/server/index.js` (tsc does not copy .ttf files),
 * with the distro Noto Sans as a last resort.
 */
const FONT_DIR_CANDIDATES = [
  path.resolve(__dirname, '../assets/fonts'),
  path.resolve(__dirname, '../../server/assets/fonts'),
  path.resolve(process.cwd(), 'server/assets/fonts'),
  '/usr/share/fonts/truetype/noto',
];

const FONT_DIR =
  FONT_DIR_CANDIDATES.find(
    (d) => fs.existsSync(path.join(d, 'NotoSans-Regular.ttf')) && fs.existsSync(path.join(d, 'NotoSans-Bold.ttf')),
  ) ?? FONT_DIR_CANDIDATES[0];

export const FONT_REGULAR = path.join(FONT_DIR, 'NotoSans-Regular.ttf');
export const FONT_BOLD = path.join(FONT_DIR, 'NotoSans-Bold.ttf');

const NAVY = '#0B2545';
const TEAL = '#137A7F';
const SAFFRON = '#E07A1F';
const GREY = '#5A6472';

export function fontsAvailable(): boolean {
  return fs.existsSync(FONT_REGULAR) && fs.existsSync(FONT_BOLD);
}

export function renderBriefPdf(brief: ExecutiveBrief): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      if (!fontsAvailable()) {
        reject(new Error(`Bundled Unicode fonts missing in ${FONT_DIR}; ₹ cannot be rendered`));
        return;
      }
      const doc = new PDFDocument({ size: 'A4', margin: 48, bufferPages: true, info: {
        Title: brief.title,
        Author: 'Team CivicNexus',
        Subject: 'CivicData Nexus executive decision brief',
        Keywords: 'SIH2026, SIH1682, GovTech, telemetry, decision intelligence',
      } });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      doc.registerFont('body', FONT_REGULAR);
      doc.registerFont('bold', FONT_BOLD);

      const W = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      const X = doc.page.margins.left;

      const h1 = (t: string) => {
        doc.font('bold').fontSize(20).fillColor(NAVY).text(t, { width: W });
        doc.moveDown(0.3);
      };
      const h2 = (t: string) => {
        if (doc.y > doc.page.height - 140) doc.addPage();
        doc.moveDown(0.6);
        doc.font('bold').fontSize(13).fillColor(TEAL).text(t.toUpperCase(), { width: W, characterSpacing: 0.6 });
        doc.moveTo(X, doc.y + 3).lineTo(X + W, doc.y + 3).strokeColor(TEAL).lineWidth(0.8).stroke();
        doc.moveDown(0.5);
      };
      const p = (t: string, opts: { size?: number; color?: string; indent?: number } = {}) => {
        if (doc.y > doc.page.height - 90) doc.addPage();
        doc.font('body').fontSize(opts.size ?? 10).fillColor(opts.color ?? '#12161C')
          .text(t, X + (opts.indent ?? 0), doc.y, { width: W - (opts.indent ?? 0), align: 'left' });
        doc.moveDown(0.25);
      };
      const bullet = (t: string) => {
        if (doc.y > doc.page.height - 90) doc.addPage();
        const y = doc.y + 4;
        doc.circle(X + 3, y, 1.8).fillColor(SAFFRON).fill();
        doc.font('body').fontSize(10).fillColor('#12161C').text(t, X + 12, doc.y, { width: W - 12 });
        doc.moveDown(0.3);
      };
      const table = (headers: string[], rows: string[][], widths: number[]) => {
        const total = widths.reduce((a, b) => a + b, 0);
        const scaled = widths.map((w) => (w / total) * W);
        const drawRow = (cells: string[], bold: boolean, bg?: string) => {
          const heights = cells.map((c, i) =>
            doc.font(bold ? 'bold' : 'body').fontSize(8.5).heightOfString(c, { width: scaled[i] - 8 }),
          );
          const h = Math.max(...heights) + 8;
          if (doc.y + h > doc.page.height - 70) doc.addPage();
          const y0 = doc.y;
          if (bg) doc.rect(X, y0, W, h).fillColor(bg).fill();
          let x = X;
          cells.forEach((c, i) => {
            doc.font(bold ? 'bold' : 'body').fontSize(8.5).fillColor(bold ? '#FFFFFF' : '#12161C')
              .text(c, x + 4, y0 + 4, { width: scaled[i] - 8 });
            x += scaled[i];
          });
          doc.y = y0 + h;
          doc.moveTo(X, doc.y).lineTo(X + W, doc.y).strokeColor('#DDE3EA').lineWidth(0.5).stroke();
        };
        drawRow(headers, true, NAVY);
        rows.forEach((r, i) => drawRow(r, false, i % 2 ? '#F5F7FA' : undefined));
        doc.moveDown(0.4);
      };

      /* ---------------------------------------------------------- page 1 */
      doc.rect(0, 0, doc.page.width, 96).fillColor(NAVY).fill();
      doc.font('bold').fontSize(22).fillColor('#FFFFFF').text('CivicData Nexus', X, 26, { width: W });
      doc.font('body').fontSize(10).fillColor('#C7D3E0').text(brief.subtitle, X, 58, { width: W });
      doc.y = 116;
      h1('Executive Decision Brief');
      p(`Generated ${new Date(brief.generatedAt).toUTCString()} · requested by ${brief.generatedBy}`, { color: GREY, size: 9 });
      p(
        `Scope: ${brief.scope.datasets} datasets · ${brief.scope.rows.toLocaleString('en-IN')} ingested rows · ` +
          `${brief.scope.anomalies} anomalies · ${brief.scope.policyCards} policy cards.`,
        { color: GREY, size: 9 },
      );

      h2('Key indicators');
      table(
        ['Indicator', 'Value', 'How it is computed'],
        brief.kpis.map((k) => [k.label, k.value, k.detail]),
        [30, 20, 50],
      );

      for (const s of brief.sections) {
        h2(s.heading);
        for (const b of s.bullets) bullet(b);
      }

      /* ---------------------------------------------------------- page 2 */
      doc.addPage();
      h1('Statistical anomalies (AI-1)');
      p('Robust MAD detector, 3.5σ threshold, corroborated by z-score and IQR rules. Expected band is median ± 3.5 × scaled MAD.', { color: GREY, size: 9 });
      table(
        ['Dataset', 'Metric', 'Entity / period', 'Value', 'Expected band', 'σ', 'Severity'],
        brief.topAnomalies.map((a) => [
          a.datasetSlug,
          a.column,
          `${a.entity}${a.period ? ` (${a.period})` : ''}`,
          String(a.value),
          a.expected,
          String(a.sigma),
          a.severity,
        ]),
        [16, 16, 24, 10, 16, 6, 10],
      );

      h2('Priority policy cards (AI-6)');
      table(
        ['Code', 'Recommendation', 'Department', 'Impact', 'Cost'],
        brief.topPolicyCards.map((c) => [c.code, c.title, c.department, String(c.impactScore), `₹${c.costCr} cr`]),
        [16, 38, 22, 10, 12],
      );

      /* ---------------------------------------------------------- page 3 */
      doc.addPage();
      h1('Recommended funding portfolio (AI-7)');
      p(`Budget ₹${brief.portfolio.budgetCr.toLocaleString('en-IN')} cr — ${brief.portfolio.budgetSource}.`, { size: 9, color: GREY });
      p(
        `Selected total ₹${brief.portfolio.totalCostCr.toLocaleString('en-IN')} cr (${brief.portfolio.utilisationPct}% of budget) ` +
          `for a combined impact score of ${brief.portfolio.totalImpact} via 0/1 knapsack dynamic programming.`,
      );
      table(
        ['Code', 'Intervention', 'Cost (₹ cr)', 'Impact'],
        brief.portfolio.items.map((i) => [i.code, i.title, String(i.costCr), String(i.impactScore)]),
        [18, 52, 15, 12],
      );

      if (brief.forecastHeadline) {
        h2('Forecast headline (AI-3)');
        bullet(brief.forecastHeadline.text);
      }
      if (brief.correlationHeadline) {
        h2('Correlation headline (AI-5)');
        bullet(`${brief.correlationHeadline.dataset}: ${brief.correlationHeadline.text}`);
      }

      h2('Audit attestation');
      bullet(
        `Chain ${brief.auditAttestation.valid ? 'VALID' : 'BROKEN'} over ${brief.auditAttestation.entries} entries. ` +
          `Algorithm ${brief.auditAttestation.algorithm}. Head hash ${brief.auditAttestation.headHash ?? 'n/a'}.`,
      );

      h2('Evidence base');
      for (const e of brief.evidenceNotes) bullet(e);

      /* ------------------------------------------------------- footers */
      const range = doc.bufferedPageRange();
      for (let i = range.start; i < range.start + range.count; i++) {
        doc.switchToPage(i);
        doc.font('body').fontSize(8).fillColor(GREY).text(
          `CivicData Nexus · Team CivicNexus · offline decision intelligence · page ${i - range.start + 1} of ${range.count}`,
          X,
          doc.page.height - 34,
          { width: W, align: 'center' },
        );
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
