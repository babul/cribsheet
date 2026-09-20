#!/usr/bin/env node
import { parseArgs } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { EXIT, CribError } from '../src/errors.js';
import { resolveConfig, findProjectRoot, DEFAULTS } from '../src/config.js';
import { plan, compile, check, STATUS } from '../src/compile.js';
import { unifiedDiff } from '../src/diff.js';
import { init } from '../src/init.js';
import { readOrNull } from '../src/write.js';

const USAGE = `cribsheet — compile AGENTS.md from markdown fragments, without clobbering hand edits.

Usage:
  cribsheet [compile] [options]   Compose and write
  cribsheet check    [options]    Exit non-zero if output is stale or hand-edited
  cribsheet init     [options]    Create .ai/guidelines/

Options:
  --dir <path>      Override guidelinesDir (default: ${DEFAULTS.guidelinesDir})
  --output <path>   Override output (default: ${DEFAULTS.output})
  --force           Overwrite despite a hash mismatch (compile)
  --allow-empty     Clear the managed block when no fragments are found
  --dry-run         Print the resulting file to stdout, write nothing
  --diff            Print a unified diff to stdout, write nothing
  --quiet           Suppress the status line (warnings and errors still print)
  --help, --version

Exit codes:
  0 success   1 stale   2 refused   3 error   4 usage`;


function main() {
  let opts;
  let command;
  try {
    ({ opts, command } = parseCli(process.argv.slice(2)));
  } catch (e) {
    return die(e);
  }

  if (opts.help) return finish(USAGE, EXIT.OK);
  if (opts.version) return finish(readVersion(), EXIT.OK);

  try {
    const cwd = process.cwd();
    if (command === 'init') return runInit(cwd, opts);

    const config = resolveConfig({
      cwd,
      overrides: { guidelinesDir: opts.dir, output: opts.output },
    });

    warnOrphan(config, opts);

    const run = command === 'check' ? check : compile;
    const result = run(config, {
      force: opts.force,
      allowEmpty: opts['allow-empty'],
      dryRun: opts['dry-run'],
      diff: opts.diff,
    });

    for (const w of result.warnings) warn(w);

    if (opts['dry-run'] && result.text !== null) process.stdout.write(result.text);
    if (opts.diff) {
      const d = unifiedDiff(result.existing ?? '', result.text ?? '', `${result.label} (current)`, `${result.label} (composed)`);
      if (d) process.stdout.write(`${d}\n`);
    }

    status(result, opts, command);
    process.exit(result.exit);
  } catch (e) {
    return die(e);
  }
}

function parseCli(argv) {
  const commands = new Set(['compile', 'check', 'init']);
  let command = 'compile';
  const rest = [...argv];
  if (rest.length && !rest[0].startsWith('-')) {
    const first = rest.shift();
    if (!commands.has(first)) {
      throw new CribError(EXIT.USAGE, `unknown command "${first}"\n\n${USAGE}`);
    }
    command = first;
  }

  let parsed;
  try {
    parsed = parseArgs({
      args: rest,
      options: {
        dir: { type: 'string' },
        output: { type: 'string' },
        force: { type: 'boolean', default: false },
        'allow-empty': { type: 'boolean', default: false },
        'dry-run': { type: 'boolean', default: false },
        diff: { type: 'boolean', default: false },
        quiet: { type: 'boolean', default: false },
        help: { type: 'boolean', default: false },
        version: { type: 'boolean', default: false },
      },
      allowPositionals: false,
      strict: true,
    });
  } catch (e) {
    throw new CribError(EXIT.USAGE, `${e.message}\n\n${USAGE}`);
  }

  const opts = parsed.values;
  if (opts['dry-run'] && opts.diff) {
    throw new CribError(EXIT.USAGE, '--dry-run and --diff both write to stdout; pick one.');
  }
  return { opts, command };
}

function runInit(cwd, opts) {
  const root = findProjectRoot(cwd);
  const { created, existed, keys } = init(root);
  for (const c of created) warn(`created ${c}/`);
  for (const e of existed) warn(`${e}/ already exists, left alone`);
  if (!opts.quiet) {
    warn('');
    warn('Optional .ai/config.json keys (all have working defaults):');
    for (const [k, v] of Object.entries(keys)) warn(`  ${k} = ${JSON.stringify(v)}`);
  }
  process.exit(EXIT.OK);
}

function warnOrphan(config, opts) {
  const defaultOutput = path.join(config.root, DEFAULTS.output);
  if (config.output === defaultOutput) return;
  const text = readOrNull(defaultOutput);
  if (text && /<!--\s*agents:begin\s*-->/.test(text)) {
    warn(`${DEFAULTS.output} still contains a managed block but output is "${path.relative(config.root, config.output)}". Agents will keep reading the stale one.`);
  }
}

function status(result, opts, command) {
  if (opts.quiet || opts['dry-run'] || opts.diff) return;
  const n = result.fragmentCount;
  const size = result.text === null ? (result.existing?.length ?? 0) : result.text.length;
  const verb = command === 'check' && result.exit === EXIT.STALE ? 'STALE' : result.status;
  warn(`${result.label}  ${verb}  (${n} fragment${n === 1 ? '' : 's'}, ${fmtBytes(size)})`);
}

function readVersion() {
  const pkg = new URL('../package.json', import.meta.url);
  return JSON.parse(fs.readFileSync(pkg, 'utf8')).version;
}

const fmtBytes = (n) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`);
const warn = (msg) => process.stderr.write(`${msg}\n`);

function finish(text, code) {
  process.stdout.write(`${text}\n`);
  process.exit(code);
}

function die(e) {
  if (e instanceof CribError) {
    warn(`cribsheet: ${e.message}`);
    if (e.diff) warn(`\n${e.diff}`);
    process.exit(e.code);
  }
  warn(`cribsheet: ${e.stack ?? e.message}`);
  process.exit(EXIT.ERROR);
}

// Called last: `warn` and `fmtBytes` are const arrows and would be in TDZ above.
main();
