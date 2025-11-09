// src/reporters/markdown.ts
export function toMarkdownSimple(results: any[], cfg: any) {
  const lines: string[] = [];
  lines.push('# Information Sphere Report');
  lines.push('');
  lines.push(`Alpha: ${cfg.alpha ?? 1.8}`);
  lines.push('');
  for (const r of results) {
    lines.push(`- ${r.file} — S=${(r.s ?? 0).toFixed(3)} — ${r.rating}`);
  }
  return lines.join('\n');
}
