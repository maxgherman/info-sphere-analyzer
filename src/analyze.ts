// src/analyze.ts
import * as fs from "fs";
import * as path from "path";
import { Project, SyntaxKind, Node } from "ts-morph";
import { minimatch } from "minimatch";

type Weights = {
  privateMethod: number;
  internalCall: number;
  internalType: number;
  exportedSymbol: number;
  publicMethod: number;
  externalImport: number;
  outgoingCall: number;
};

type Config = {
  include: string[];
  exclude?: string[];
  weights?: Partial<Weights>;
  alpha?: number;
  thresholds?: { good: number; warning: number };
};

const DEFAULT_WEIGHTS: Weights = {
  privateMethod: 1,
  internalCall: 1,
  internalType: 2,
  exportedSymbol: 3,
  publicMethod: 2,
  externalImport: 2,
  outgoingCall: 2
};

function loadConfig(): Config {
  const p = path.resolve(process.cwd(), "sphere.config.json");
  if (!fs.existsSync(p))
    return {
      include: ["src/**/*.ts"],
      weights: DEFAULT_WEIGHTS,
      alpha: 1.8,
      thresholds: { good: 10, warning: 3 }
    };
  const raw = JSON.parse(fs.readFileSync(p, "utf8"));
  return raw;
}

export type ModuleMetrics = {
  id: string;
  file: string;
  V: number;
  A: number;
  extras: Record<string, number | string>;
  s?: number;
  cohesion?: number; // new
};

function isNodeModuleFile(fp: string) {
  return fp.includes("node_modules") || fp.includes("/@types/") || fp.includes("\\node_modules\\");
}

/**
 * Resolve the declaration file path for a CallExpression's expression if possible.
 * Returns:
 *   - relative project file path (string) if resolved to a source file in the project
 *   - 'external' if resolved to node_modules or lib
 *   - undefined if resolution failed
 */
function resolveCallTargetFile(callNode: import("ts-morph").CallExpression) {
  const expr = callNode.getExpression();

  // Try to get symbol from expression or from left side of property access
  let sym = expr.getSymbol ? expr.getSymbol() : undefined;

  if (!sym) {
    // if property access like a.b.c(), try walking left-most expression
    if (Node.isPropertyAccessExpression(expr)) {
      try {
        sym = expr.getExpression().getSymbol?.();
      } catch {
        sym = undefined;
      }
    } else if (Node.isIdentifier(expr)) {
      sym = expr.getSymbol?.();
    } else {
      // last attempt: for element access etc, try the expression's symbol
      sym = expr.getSymbol?.();
    }
  }

  if (!sym) return undefined;

  const decls = sym.getDeclarations();
  if (!decls || decls.length === 0) return undefined;

  // pick the first declaration that has a source file
  for (const d of decls) {
    const declSf = d.getSourceFile();
    if (!declSf) continue;
    const declPath = declSf.getFilePath();
    if (isNodeModuleFile(declPath)) return "external";
    // Return relative path so we can use it as key
    return path.relative(process.cwd(), declPath);
  }

  return undefined;
}

export async function analyze(): Promise<{ results: ModuleMetrics[]; alpha: number; thresholds: any }> {
  const cfg = loadConfig();
  const weights: Weights = { ...DEFAULT_WEIGHTS, ...(cfg.weights || {}) } as Weights;
  const alpha = cfg.alpha ?? 1.8;

  const project = new Project({ skipAddingFilesFromTsConfig: true });

  // Add files from include globs
  const filesToAdd = cfg.include ?? ["src/**/*.ts"];
  project.addSourceFilesAtPaths(filesToAdd);

  // Apply manual excludes
  if (cfg.exclude && cfg.exclude.length > 0) {
    const toRemove = project.getSourceFiles().filter(sf => {
      const rel = path.relative(process.cwd(), sf.getFilePath());
      return cfg.exclude!.some(pattern => minimatch(rel, pattern, { dot: true }));
    });
    toRemove.forEach(sf => project.removeSourceFile(sf));
  }

  // Build mapping of file path -> metrics being accumulated
  const modulesMap: Record<string, {
    exportedCount: number;
    externalImports: number;
    privateMethodCount: number;
    publicMethodCount: number;
    internalTypeCount: number;
    outgoingCallHeuristic: number;
    callsOut_total: number;
    callsOut_internal: number;
    callsOut_external: number;
    incomingInternal: number;
    incomingExternal: number;
  }> = {};

  // Initialize module entries
  for (const sf of project.getSourceFiles()) {
    const rel = path.relative(process.cwd(), sf.getFilePath());
    modulesMap[rel] = {
      exportedCount: 0,
      externalImports: 0,
      privateMethodCount: 0,
      publicMethodCount: 0,
      internalTypeCount: 0,
      outgoingCallHeuristic: 0,
      callsOut_total: 0,
      callsOut_internal: 0,
      callsOut_external: 0,
      incomingInternal: 0,
      incomingExternal: 0
    };
  }

  // First pass: collect export & import & class/function metadata (like before)
  for (const sf of project.getSourceFiles()) {
    const rel = path.relative(process.cwd(), sf.getFilePath());
    const m = modulesMap[rel];

    m.exportedCount = Array.from(sf.getExportedDeclarations().keys()).length;

    const imports = sf.getImportDeclarations();
    m.externalImports = imports.filter(imp => {
      const spec = imp.getModuleSpecifierValue();
      return !(spec.startsWith(".") || spec.startsWith("/"));
    }).length;

    // class-level counts
    sf.getClasses().forEach(cls => {
      const methods = cls.getMethods();
      methods.forEach(mth => {
        const isPublic = mth.hasModifier(SyntaxKind.PublicKeyword) || (!mth.hasModifier(SyntaxKind.PrivateKeyword) && !mth.hasModifier(SyntaxKind.ProtectedKeyword));
        if (isPublic) m.publicMethodCount++;
        else m.privateMethodCount++;
        const body = mth.getBodyText() || "";
        // heuristic outgoing calls we still capture
        if (/fetch\(|axios\.|http\.request|XMLHttpRequest/.test(body)) m.outgoingCallHeuristic += 1;
      });
      m.internalTypeCount += cls.getProperties().length + cls.getConstructors().length;
    });

    // top-level functions
    sf.getFunctions().forEach(fn => {
      const body = fn.getBodyText() || "";
      if (fn.isExported()) m.publicMethodCount++;
      else m.privateMethodCount++;
      if (/fetch\(|axios\.|http\.request|XMLHttpRequest/.test(body)) m.outgoingCallHeuristic += 1;
    });

    // file-level heuristic outgoing calls
    const fullText = sf.getFullText();
    m.outgoingCallHeuristic += (fullText.match(/fetch\(|axios\.|http\.request|XMLHttpRequest/g) || []).length;
  }

  // Second pass: symbol-resolved call graph
  // For each CallExpression, try to resolve the callee symbol and map caller->callee file path or external
  for (const sf of project.getSourceFiles()) {
    const callerFile = path.relative(process.cwd(), sf.getFilePath());
    const callerEntry = modulesMap[callerFile];

    // find all call expressions in source file
    const calls = sf.getDescendantsOfKind(SyntaxKind.CallExpression);
    for (const call of calls) {
      callerEntry.callsOut_total++;

      // try to resolve target
      const target = resolveCallTargetFile(call);

      if (target === "external") {
        callerEntry.callsOut_external++;
        continue;
      }
      if (!target) {
        // unresolved -> consider external (conservative)
        callerEntry.callsOut_external++;
        continue;
      }

      // target is a relative project file path
      if (target === callerFile) {
        // internal call (self)
        callerEntry.callsOut_internal++;
        callerEntry.incomingInternal += 0; // incoming will be accounted in callee entry below if needed
      } else {
        // inter-file call
        callerEntry.callsOut_external++; // for the purposes of cohesion, non-self calls are 'external'
        // increment incoming for callee if it's tracked
        if (modulesMap[target]) {
          modulesMap[target].incomingInternal += 1;
        } else {
          // target exists in project but maybe filtered; treat as incomingExternal
          // attempt to increment incomingExternal if possible (safe no-op)
          // no-op
          ;
        }
      }
    }
  }

  // Compose ModuleMetrics objects
  const modules: ModuleMetrics[] = [];
  for (const [file, data] of Object.entries(modulesMap)) {
    // V and A computed using weights (same approach as before)
    const rawV = (data.privateMethodCount * weights.privateMethod)
      + ((data.callsOut_internal + data.incomingInternal) * weights.internalCall)
      + (data.internalTypeCount * weights.internalType);

    const rawA = (data.exportedCount * weights.exportedSymbol)
      + (data.publicMethodCount * weights.publicMethod)
      + (data.externalImports * weights.externalImport)
      + (data.outgoingCallHeuristic * weights.outgoingCall)
      + (data.callsOut_external * weights.outgoingCall); // include resolved external calls

    // cohesion: fraction of outgoing calls that stay internal to this module
    const cohesion = data.callsOut_total === 0 ? 1 : (data.callsOut_internal / data.callsOut_total);

    // sphericity
    const AforS = rawA === 0 ? Number.EPSILON : rawA;
    const s = rawV / Math.pow(AforS, alpha);

    modules.push({
      id: file,
      file,
      V: rawV,
      A: rawA,
      s,
      cohesion,
      extras: {
        ...data,
        callsOut_total: data.callsOut_total,
        callsOut_internal: data.callsOut_internal,
        callsOut_external: data.callsOut_external,
        incomingInternal: data.incomingInternal,
        incomingExternal: data.incomingExternal
      }
    });
  }

  // sort ascending (lowest s first)
  modules.sort((a, b) => (a.s ?? 0) - (b.s ?? 0));

  return { results: modules, alpha, thresholds: cfg.thresholds };
}
