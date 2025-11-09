# 🔵 Spherical Analyzer

A static analysis tool for TypeScript codebases that measures **module shape** — not formatting, not style, not performance, but **design pressure**:  
how much logic lives *inside* a module vs how much it *exposes* to the outside world.

The analyzer computes:

- **V — Volume** → internal logic and structure  
- **A — Area** → public surface and external dependencies  
- **S = V / Aᵅ — Sphericity** → balance between internal complexity and outward exposure  
- **Cohesion** → % of calls that stay *within* the module (local vs leaking outside)

It surfaces design hotspots — modules that are likely:

- doing too much internally
- exposing too much publicly
- leaking dependencies outward
- serving as weakly-bounded glue code

This tool doesn’t judge — it **maps the geometry of software** so you can improve it intentionally.

---

## 🧭 Philosophy

Well-designed modules behave like **information spheres**:

- high internal cohesion
- minimal exposed surface
- clear boundaries
- low leakage of complexity

This tool brings quantitative feedback to that principle.

[Spherical design](https://www.max-gherman.dev/design/spherical-design/)

---

## ⚡ Features

✅ Symbol-resolved call graph (not regex)  
✅ Internal vs external call cohesion metric  
✅ Sphericity (S = V / Aᵅ) scoring  
✅ Ranked hotspot report (console, JSON, Markdown)  
✅ Exclusion and weighting rules via config  
✅ Ready for CI integration  
✅ Designed for incremental refactoring loops  

---

## 🚀 Quick start

```bash
npm install
npm run build
npm start
```

Generates:

- `sphere-report.json`
- `sphere-report.md`

---

## ⚙ Configuration (`sphere.config.json`)

```json
{
  "include": ["../your-project/src/**/*.ts"],
  "exclude": ["../your-project/test/**/*.ts", "../your-project/**/*.d.ts"],
  "weights": {
    "privateMethod": 1,
    "internalCall": 1,
    "internalType": 2,
    "exportedSymbol": 3,
    "publicMethod": 2,
    "externalImport": 2,
    "outgoingCall": 2
  },
  "alpha": 1.8,
  "thresholds": {
    "good": 10,
    "warning": 3
  },
  "report": {
    "markdown": "sphere-report.md",
    "json": "sphere-report.json"
  }
}
```

---

## 📊 How to read results

| Metric | Meaning |
|---|---|
| **V (Volume)** | internal logic density |
| **A (Area)** | surface exposure to other modules |
| **S (Sphericity)** | higher = better balanced, lower = architectural tension |
| **Cohesion** | % of calls staying inside the module |

### Interpretation guide

| S | Cohesion | Likely condition |
|---|---|---|
| Low | Low | module leaks responsibility → consider splitting or introducing a facade |
| Low | High | dense but self-contained → may need internal decomposition |
| High | Any | balanced surface boundary, generally healthy |

---

## 🔁 Recommended workflow

1. Run analyzer
2. Inspect lowest-S modules (`COLLAPSE` or `WARNING`)
3. Make *small* structural improvements:
   - hide internal helpers
   - create facades for external calls
   - regroup related functions
   - extract adapters
4. Re-run analyzer, verify improvement
5. Commit and repeat on next hotspot

---

## 🤖 CI Integration (example)

Run analyzer in GitHub Actions and upload report:

```yaml
steps:
  - uses: actions/checkout@v4
  - run: npm ci
  - run: npm run build
  - run: npm start
  - uses: actions/upload-artifact@v3
    with:
      name: sphere-report
      path: sphere-report.json
```

---

## ⚠ Limitations

- Dynamic or reflective calls can’t always be resolved statically
- Monorepos require correct `include/exclude` patterns and path mapping
- Scores are *guidance*, not verdicts

---

## 🟦 A note on intent

Spherical Analyzer is not about achieving perfection —  
it's about **seeing architectural stress early** and **shaping systems gradually** toward clarity and cohesion.

---

## License

MIT
