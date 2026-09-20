import fs from 'node:fs';
import path from 'node:path';
import { error } from './errors.js';

/**
 * Find fragments under `guidelinesDir`.
 *
 * The walk is hand-rolled rather than `readdirSync({recursive:true})` because
 * that descends into symlinked directories, which makes a symlink loop a hang.
 * Symlinks are skipped outright and reported.
 */
export function discover({ root, guidelinesDir, exclude = [] }) {
  const warnings = [];

  if (!existsAsDirectory(guidelinesDir)) {
    warnings.push(`guidelines directory not found: ${rel(root, guidelinesDir)}`);
    return { fragments: [], warnings };
  }

  const found = [];
  walk(guidelinesDir, guidelinesDir, found, warnings, root);

  // Exclude by anchored glob against the path relative to guidelinesDir.
  const used = new Set();
  const kept = found.filter((f) => {
    const pattern = exclude.find((g) => path.matchesGlob(f.relFromDir, g));
    if (pattern !== undefined) used.add(pattern);
    return pattern === undefined;
  });
  for (const g of exclude) {
    if (!used.has(g)) warnings.push(`exclude pattern matched no fragment: "${g}"`);
  }

  // Byte comparison, not UTF-16 code-unit order (spec §3.2).
  kept.sort((a, b) =>
    Buffer.compare(Buffer.from(a.relFromDir, 'utf8'), Buffer.from(b.relFromDir, 'utf8')),
  );

  return { fragments: kept, warnings };
}

function walk(dir, base, out, warnings, root) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    throw error(`cannot read ${rel(root, dir)}: ${e.message}`);
  }

  for (const entry of entries) {
    const full = path.join(dir, entry.name);

    if (entry.name.startsWith('.')) continue; // hidden files and directories
    if (entry.isSymbolicLink()) {
      warnings.push(`skipped symlink: ${rel(root, full)}`);
      continue;
    }
    if (entry.isDirectory()) {
      walk(full, base, out, warnings, root);
      continue;
    }
    if (!entry.isFile()) continue;

    const ext = path.extname(entry.name);
    if (ext !== '.md') {
      // A case-variant extension is a near-miss worth naming; anything else is
      // silently ignored per spec §3.1.
      if (ext.toLowerCase() === '.md') {
        warnings.push(`skipped "${rel(root, full)}": only lowercase .md is recognised`);
      }
      continue;
    }

    const raw = readFragment(full, root);
    if (raw.trim() === '') continue; // §3.1: empty fragments contribute nothing

    out.push({
      absPath: full,
      relFromDir: toPosix(path.relative(base, full)),
      relFromRoot: toPosix(path.relative(root, full)),
      raw,
    });
  }
}

function readFragment(file, root) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (e) {
    throw error(`cannot read ${rel(root, file)}: ${e.message}`);
  }
}

const toPosix = (p) => p.split(path.sep).join('/');
const rel = (root, p) => toPosix(path.relative(root, p)) || p;

function existsAsDirectory(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}
