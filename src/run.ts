import { analyze } from "./analyze.js";
import * as fs from "fs";
import * as path from "path";

function rating(s: number | undefined, thresholds: any) {
  if (!thresholds) return "UNKNOWN";
  if (s === undefined || s === null || !isFinite(s)) return "UNKNOWN";
  if (s > (thresholds.good ?? 10)) return "GOOD";
  if (s > (thresholds.warning ?? 3)) return "WARNING";
  return "COLLAPSE";
}

function toMarkdown(results: any[], cfg: any) {
  const lines: string[] = [];
  lines.push(`# Information Sphere Report`);
  lines.push(`Alpha: ${cfg.alpha ?? 1.8}`);
  lines.push(`Thresholds: good > ${cfg.thresholds?.good ?? 10}, warning > ${cfg.thresholds?.warning ?? 3}`);
  lines.push("");
  lines.push("## Hotspots (lowest sphericity first)");
  for (const r of results) {
    lines.push(`- **module** \`${r.file}\` — S=${(r.s ?? 0).toFixed(3)} — **${rating(r.s, cfg.thresholds)}**`);
    lines.push(`  - V: ${r.V}, A: ${r.A}`);
  }
  lines.push("");
  lines.push("## Summary");
  const counts: any = results.reduce((acc: any, c: any) => { acc[c.rating] = (acc[c.rating]||0)+1; return acc; }, {});
  lines.push(`- Good: ${counts.GOOD || 0}`);
  lines.push(`- Warning: ${counts.WARNING || 0}`);
  lines.push(`- Collapse: ${counts.COLLAPSE || 0}`);
  return lines.join("\n");
}

function loadConfig(): any {
  const p = path.resolve(process.cwd(), "sphere.config.json");
  if (!fs.existsSync(p)) return { include: ["src/**/*.ts"], alpha: 1.8, thresholds: { good: 10, warning: 3 }, report: { markdown: "sphere-report.md", json: "sphere-report.json" } };
  const raw = JSON.parse(fs.readFileSync(p, "utf8"));
  return raw;
}

export async function run() {
  try {
    const cfg = loadConfig();
    const { results, alpha, thresholds } = await analyze();
    const annotated = results.map((r:any)=>{ const sVal = r.s ?? 0; return {...r, s: sVal, rating: rating(sVal, cfg.thresholds ?? thresholds)}; });
    console.log("");
    console.log("Information Sphere — Ranked hotspots (lowest S first)");
    console.log(`alpha = ${alpha}`);
    console.log("");
    if (annotated.length === 0) {
      console.log("No source files found by the analyzer. Check sphere.config.json include patterns.");
      return;
    }

    for (const r of annotated) {
      console.log(`Module: ${r.file}`);
      console.log(`  Internal cohesion (V): ${r.V}`);
      console.log(`  Public surface (A): ${r.A}`);
      console.log(`  Cohesion (calls internal / calls total): ${(r.cohesion ?? 0).toFixed(3)}`);
      console.log(`  Sphericity (S): ${r.s.toFixed(3)}  ${r.rating}`);
      console.log("");
    }



    console.log(`Analyzed ${annotated.length} modules.`);
    const reportCfg = cfg.report || { markdown: "sphere-report.md", json: "sphere-report.json" };
    if (reportCfg.json) {
      fs.writeFileSync(path.resolve(process.cwd(), reportCfg.json), JSON.stringify({ meta: { alpha }, results: annotated }, null, 2), "utf8");
      console.log(`Wrote JSON report: ${reportCfg.json}`);
    }
    if (reportCfg.markdown) {
      const md = toMarkdown(annotated, cfg);
      fs.writeFileSync(path.resolve(process.cwd(), reportCfg.markdown), md, "utf8");
      console.log(`Wrote Markdown report: ${reportCfg.markdown}`);
    }
  } catch (err) {
    console.error("Analyzer error:", err);
    process.exit(1);
  }
}
