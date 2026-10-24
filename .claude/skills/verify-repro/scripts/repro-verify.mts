// One disposable Repro instance for verification: a dedicated Postgres container, the
// local service (`src/serve.ts`), and the levers to drive and observe it.
//
// Every command prints one JSON object on stdout and exits non-zero when `ok` is false.
// Run through the `repro-verify` shim beside this file, which supplies tsx.

import { spawn, spawnSync } from 'node:child_process';
import { createHash, createHmac, generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { closeSync, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const REPO = resolve(import.meta.dirname, '../../../..');
const KEY = createHash('sha256').update(REPO).digest('hex').slice(0, 8);
const STATE_DIR = join(tmpdir(), `repro-verify-${KEY}`);
const STATE_FILE = join(STATE_DIR, 'state.json');
const LOG_FILE = join(STATE_DIR, 'serve.log');
/** Written by `up` into a directory it created; `teardown` deletes nothing without it. */
const MARKER = join(STATE_DIR, '.repro-verify');
const CONTAINER = `repro-verify-pg-${KEY}`;
const LABEL = 'repro-verify.state';
const TSX = pathToFileURL(join(REPO, 'node_modules/tsx/dist/loader.mjs')).href;
const SERVE = join(REPO, 'src/serve.ts');
const BUNDLE_INDEX = join(REPO, 'web/out/index.html');
const BUNDLE_SOURCES = ['web/app', 'web/components', 'web/lib', 'web/next.config.mjs', 'web/package.json', 'web/package-lock.json', 'web/tsconfig.json'];
const DEBUG_PORT = 9222;
const CHROMIUM_CANDIDATES = [
  process.env.ENGINE_CHROMIUM_BIN,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
  '/usr/bin/google-chrome',
];

type State = {
  runId: string;
  pid: number;
  container: string;
  ports: { postgres: number; webhook: number; events: number };
  dashboard: string;
  webhook: string;
  evidence: string;
  env: Record<string, string>;
};

class Refusal extends Error {}

const EVIDENCE_ROOT = join(REPO, '.verify-evidence');

/**
 * On Linux the state dir lives in the shared /tmp, so another local user could plant state.json
 * first and choose the environment (NODE_OPTIONS) that `cli` and `up` spawn node with. Behind a
 * 0700 directory you own, nobody but you can write state.json, so its contents are trusted.
 */
const assertPrivateStateDir = (): void => {
  const stat = lstatSync(STATE_DIR);
  if (!stat.isDirectory()) throw new Refusal(`${STATE_DIR} is not a real directory (a symlink?); refusing to use it`);
  if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) throw new Refusal(`${STATE_DIR} is owned by uid ${stat.uid}, not you; refusing to use it`);
  if (stat.mode & 0o077) throw new Refusal(`${STATE_DIR} is readable or writable by other users (mode ${(stat.mode & 0o777).toString(8)}); refusing to use it`);
};

const emit = (body: Record<string, unknown>): never => {
  process.stdout.write(`${JSON.stringify(body, null, 2)}\n`);
  process.exit(body.ok === false ? 1 : 0);
};

/** lstat, not exists: a dangling symlink at the state path is present, and refused. */
const stateDirPresent = (): boolean => {
  try {
    lstatSync(STATE_DIR);
    return true;
  } catch {
    return false;
  }
};

/** A missing binary leaves stdout and stderr null; this makes it an ordinary failure. */
const run = (command: string, args: string[], options: { env?: NodeJS.ProcessEnv; cwd?: string } = {}) => {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...options });
  return {
    status: result.error ? null : result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? (result.error ? `${command}: ${result.error.message}` : ''),
  };
};

const readState = (): State => {
  if (!existsSync(STATE_FILE)) throw new Refusal(`no instance is up for ${REPO} (no ${STATE_FILE}); run \`repro-verify up\``);
  assertPrivateStateDir();
  return JSON.parse(readFileSync(STATE_FILE, 'utf8')) as State;
};

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const commandOf = (pid: number): string => run('ps', ['-ww', '-o', 'command=', '-p', String(pid)]).stdout.trim();

/** The process's working directory, from lsof; null when lsof is missing or says nothing. */
const cwdOf = (pid: number): string | null => {
  const lsof = run('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn']);
  const line = lsof.stdout.split('\n').find((one) => one.startsWith('n'));
  return lsof.status === 0 && line ? line.slice(1) : null;
};

const realStateDir = (): string | null => {
  try {
    return realpathSync(STATE_DIR);
  } catch {
    return null;
  }
};

/**
 * Ours means the serve entrypoint of THIS checkout, running in THIS state dir (`up` starts it
 * there). The command line alone is not enough: any process can carry the path in its argv. The
 * cwd is compared resolved, because macOS's tmpdir is `/var/...` and lsof reports `/private/var/...`.
 */
const isOurServe = (pid: number): boolean => {
  if (!pid || !alive(pid) || !commandOf(pid).includes(SERVE)) return false;
  const cwd = cwdOf(pid);
  return cwd !== null && cwd === realStateDir();
};

/** Who listens on a TCP port (optionally on one address), by pid; null when lsof is missing. */
const listeners = (port: number, host = ''): string[] | null => {
  const lsof = run('lsof', ['-nP', `-iTCP${host ? `@${host}` : ''}:${port}`, '-sTCP:LISTEN', '-t']);
  return lsof.status === null ? null : lsof.stdout.trim().split('\n').filter(Boolean);
};

/**
 * The live process's environment, not state.json's record of it. Linux exposes it in /proc;
 * macOS's `ps -E` prints it after the argv, so the last DATABASE_URL= on the line is the env's.
 */
const liveDatabaseUrl = (pid: number): string | null => {
  if (process.platform === 'linux') {
    try {
      const entry = readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0').find((one) => one.startsWith('DATABASE_URL='));
      return entry ? entry.slice('DATABASE_URL='.length) : null;
    } catch {
      return null;
    }
  }
  const ps = run('ps', ['-E', '-ww', '-o', 'command=', '-p', String(pid)]);
  const found = [...ps.stdout.matchAll(/(?:^|\s)DATABASE_URL=(\S+)/g)].at(-1);
  return ps.status === 0 && found ? found[1]! : null;
};

/** Chrome started by a `browse` that was killed before it could close it; matched by our profile path. */
const strayChrome = (): number[] =>
  run('pgrep', ['-f', '--', `--user-data-dir=${join(STATE_DIR, 'chrome-')}`]).stdout.split('\n').filter(Boolean).map(Number)
    .filter((pid) => commandOf(pid).includes(`--user-data-dir=${join(STATE_DIR, 'chrome-')}`));

const freePort = (): Promise<number> =>
  new Promise((done, fail) => {
    const probe = createServer();
    probe.on('error', fail);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => done(port));
    });
  });

const portFree = (port: number): Promise<boolean> =>
  new Promise((done) => {
    const probe = createServer();
    probe.on('error', () => done(false));
    probe.listen(port, '127.0.0.1', () => probe.close(() => done(true)));
  });

const newestMtime = (path: string): number => {
  const stat = statSync(path);
  if (!stat.isDirectory()) return stat.mtimeMs;
  return Math.max(stat.mtimeMs, ...readdirSync(path).map((entry) => newestMtime(join(path, entry))));
};

const bundleStale = (): string | null => {
  if (!existsSync(BUNDLE_INDEX)) return 'web/out/index.html does not exist';
  const built = statSync(BUNDLE_INDEX).mtimeMs;
  const changed = BUNDLE_SOURCES.filter((source) => existsSync(join(REPO, source)) && newestMtime(join(REPO, source)) > built);
  return changed.length ? `web/out is older than ${changed.join(', ')}` : null;
};

const sha = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');

/** The service's whole environment. Nothing is inherited, so a developer's shell or `.env` cannot reach it. */
const serviceEnv = (state: Pick<State, 'env'>): NodeJS.ProcessEnv => ({
  PATH: process.env.PATH ?? '/usr/bin:/bin',
  HOME: process.env.HOME ?? STATE_DIR,
  TMPDIR: tmpdir(),
  ...state.env,
});

const psql = (sql: string, readOnly = true) =>
  run('docker', [
    'exec',
    ...(readOnly ? ['-e', 'PGOPTIONS=-c default_transaction_read_only=on'] : []),
    CONTAINER,
    'psql', '-U', 'postgres', '-d', 'events', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql,
  ]);

const wait = async (what: string, ms: number, probe: () => Promise<boolean> | boolean): Promise<void> => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await probe()) return;
    await new Promise((done) => setTimeout(done, 300));
  }
  throw new Refusal(`${what} was not ready after ${ms / 1000}s`);
};

const getJson = async (url: string): Promise<{ status: number; body: unknown }> => {
  const response = await fetch(url, { signal: AbortSignal.timeout(3_000) });
  const text = await response.text();
  try {
    return { status: response.status, body: JSON.parse(text) };
  } catch {
    return { status: response.status, body: text };
  }
};

const tail = (path: string, lines: number): string =>
  existsSync(path) ? readFileSync(path, 'utf8').split('\n').slice(-lines - 1).join('\n') : '';

/**
 * Stops what this instance owns. `left` names whatever survived; while it is non-empty the state
 * dir is kept, because it is the only record of what still needs stopping.
 */
async function teardown(state: Partial<State> | null): Promise<{ did: string[]; left: string[] }> {
  const did: string[] = [];
  const left: string[] = [];
  if (state?.pid && isOurServe(state.pid)) {
    const pid = state.pid;
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // Exited between the check and the signal.
    }
    await wait('serve shutdown', 10_000, () => !alive(pid)).catch(async () => {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // Exited between the deadline and the kill.
      }
      await wait('serve kill', 3_000, () => !alive(pid)).catch(() => undefined);
    });
    if (isOurServe(pid)) left.push(`serve pid ${pid} is still running after SIGTERM and SIGKILL`);
    else did.push(`stopped serve pid ${pid}`);
  }
  for (const pid of strayChrome()) {
    try {
      process.kill(pid, 'SIGKILL');
      did.push(`killed stray Chrome pid ${pid}`);
    } catch {
      // Already gone.
    }
  }
  const label = run('docker', ['inspect', '-f', `{{index .Config.Labels "${LABEL}"}}`, CONTAINER]);
  if (label.status === 0 && label.stdout.trim() === STATE_DIR) {
    const removed = run('docker', ['rm', '-f', '-v', CONTAINER]);
    if (removed.status === 0) did.push(`removed container ${CONTAINER}`);
    else left.push(`container ${CONTAINER}: docker rm failed: ${removed.stderr.trim().split('\n')[0]}`);
  } else if (label.status === 0) {
    did.push(`left container ${CONTAINER} alone: its ${LABEL} label is not ${STATE_DIR}`);
  } else if (!/no such (object|container)/i.test(label.stderr)) {
    left.push(`cannot tell whether container ${CONTAINER} still exists: ${label.stderr.trim().split('\n')[0] || `docker exited ${label.status}`}`);
  }
  if (state?.evidence && existsSync(LOG_FILE)) {
    mkdirSync(state.evidence, { recursive: true });
    writeFileSync(join(state.evidence, 'serve.log'), readFileSync(LOG_FILE));
  }
  if (left.length) {
    if (stateDirPresent()) did.push(`kept ${STATE_DIR}: it records what is still running`);
  } else if (existsSync(MARKER) && lstatSync(STATE_DIR).isDirectory()) {
    rmSync(STATE_DIR, { recursive: true, force: true });
    did.push(`removed ${STATE_DIR}`);
  } else if (stateDirPresent()) {
    did.push(`left ${STATE_DIR} alone: it has no ${MARKER}, so this helper did not create it`);
  }
  return { did, left };
}

async function up(): Promise<never> {
  if (existsSync(STATE_FILE)) {
    const state = readState();
    if (isOurServe(state.pid)) throw new Refusal(`already up at ${state.dashboard} (pid ${state.pid}); run \`repro-verify doctor\` or \`repro-verify down\``);
    throw new Refusal(`a stale instance is recorded in ${STATE_FILE}; run \`repro-verify down\` first`);
  }
  if (stateDirPresent()) {
    assertPrivateStateDir();
    throw new Refusal(`${STATE_DIR} already exists: another \`up\` is starting, or one was interrupted; run \`repro-verify down\` once no \`up\` is running`);
  }
  // serve.ts boots only when import.meta.url equals `file://${argv[1]}`, which an escaped path never does.
  if (pathToFileURL(SERVE).href !== `file://${SERVE}`) {
    throw new Refusal(`src/serve.ts cannot start from ${REPO}: its entrypoint check fails on paths with spaces or URL-escaped characters; use a checkout path without them`);
  }
  if (run('docker', ['inspect', CONTAINER]).status === 0) {
    throw new Refusal(`container ${CONTAINER} already exists; run \`repro-verify down\` first`);
  }
  const docker = run('docker', ['info', '--format', '{{.ServerVersion}}']);
  if (docker.status !== 0) throw new Refusal(`Docker is not reachable: ${docker.stderr.trim().split('\n')[0]}`);

  // The state dir is the lock: created before the build, so a second `up` stops here instead of
  // building beside this one. Not recursive, so a directory someone created since the check above
  // is EEXIST, not adopted.
  mkdirSync(dirname(STATE_DIR), { recursive: true });
  try {
    mkdirSync(STATE_DIR, { mode: 0o700 });
  } catch (error) {
    throw new Refusal(`cannot create ${STATE_DIR}: ${(error as Error).message}`);
  }

  let state: State | null = null;
  try {
    assertPrivateStateDir();
    writeFileSync(MARKER, `${REPO}\n`);

    const stale = bundleStale();
    if (stale) {
      process.stderr.write(`repro-verify: ${stale}; running npm run web:build\n`);
      const built = spawnSync('npm', ['run', 'web:build'], { cwd: REPO, stdio: ['ignore', 2, 2] });
      if (built.status !== 0) throw new Refusal('npm run web:build failed; its output is above on stderr');
    }

    const runId = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
    const evidence = join(EVIDENCE_ROOT, runId);
    const ports = { postgres: await freePort(), webhook: await freePort(), events: await freePort() };
    mkdirSync(join(STATE_DIR, 'blobs'));
    mkdirSync(evidence, { recursive: true });

    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pem = join(STATE_DIR, 'throwaway-app.pem');
    writeFileSync(pem, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });

    state = {
      runId,
      pid: 0,
      container: CONTAINER,
      ports,
      dashboard: `http://127.0.0.1:${ports.events}`,
      webhook: `http://127.0.0.1:${ports.webhook}/`,
      evidence,
      env: {
        DATABASE_URL: `postgres://postgres:verify@127.0.0.1:${ports.postgres}/events`,
        PLANE_SECRETS_KEY: randomBytes(32).toString('base64'),
        // A GitHub App that does not exist: every call it makes to api.github.com is a 401.
        GITHUB_APP_ID: 'repro-verify-no-app',
        GITHUB_PRIVATE_KEY_PATH: pem,
        GITHUB_WEBHOOK_SECRET: randomBytes(32).toString('hex'),
        // Satisfies readConfig; every path that would spend it fails at GitHub first.
        ENGINE_PROVIDER: 'openrouter',
        OPENROUTER_API_KEY: 'repro-verify-placeholder-not-a-key',
        ENGINE_BLOB_ROOT: join(STATE_DIR, 'blobs'),
        WEBHOOK_PORT: String(ports.webhook),
        EVENTS_PORT: String(ports.events),
      },
    };
    const current = state;
    writeFileSync(STATE_FILE, JSON.stringify(current, null, 2));

    const started = run('docker', [
      'run', '-d', '--name', CONTAINER, '--label', `${LABEL}=${STATE_DIR}`,
      '-e', 'POSTGRES_PASSWORD=verify', '-e', 'POSTGRES_DB=events',
      '-p', `127.0.0.1:${ports.postgres}:5432`, 'postgres:17',
    ]);
    if (started.status !== 0) throw new Refusal(`docker run failed: ${started.stderr.trim()}`);
    // Over TCP: the image's init-time server listens on the socket only, so this cannot pass mid-init.
    await wait('Postgres', 90_000, () =>
      run('docker', ['exec', CONTAINER, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres', '-d', 'events']).status === 0,
    );

    const schema = run(process.execPath, ['--import', TSX, join(REPO, 'src/cli.ts'), 'schema', '--yes'], {
      cwd: STATE_DIR,
      env: serviceEnv(current),
    });
    if (schema.status !== 0) throw new Refusal(`schema apply failed: ${schema.stderr.trim() || schema.stdout.trim()}`);

    const log = openSync(LOG_FILE, 'a');
    // cwd is the state dir on purpose, twice over: serve.ts loads `./.env`, which fills every
    // variable left unset, and `isOurServe` recognises this process by that cwd.
    const child = spawn(process.execPath, ['--import', TSX, SERVE], {
      cwd: STATE_DIR,
      env: serviceEnv(current),
      detached: true,
      stdio: ['ignore', log, log],
    });
    closeSync(log);
    child.unref();
    current.pid = child.pid!;
    writeFileSync(STATE_FILE, JSON.stringify(current, null, 2));

    await wait('serve', 60_000, async () => {
      if (!alive(current.pid)) throw new Refusal(`serve exited during startup:\n${tail(LOG_FILE, 30)}`);
      try {
        const me = await getJson(`${current.dashboard}/api/me`);
        return me.status === 200 && (me.body as { mode?: string }).mode === 'local';
      } catch {
        return false;
      }
    });
  } catch (error) {
    const { did, left } = await teardown(state);
    throw new Refusal(`${(error as Error).message}\ncleaned up: ${did.join('; ') || 'nothing'}${left.length ? `\nLEFT RUNNING: ${left.join('; ')}` : ''}`);
  }

  return emit({
    ok: true,
    dashboard: state.dashboard,
    webhook: state.webhook,
    evidence: state.evidence,
    pid: state.pid,
    container: CONTAINER,
    ports: state.ports,
    schema: 'applied',
    log: LOG_FILE,
  });
}

async function doctor(): Promise<never> {
  const state = readState();
  const checks: { check: string; ok: boolean; detail: string }[] = [];
  const check = (name: string, ok: boolean, detail: string) => checks.push({ check: name, ok, detail });

  check('process', isOurServe(state.pid), `pid ${state.pid}: ${commandOf(state.pid) || 'not running'}`);

  for (const [name, port] of [['events', state.ports.events], ['webhook', state.ports.webhook]] as const) {
    const lsof = run('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t']);
    const owners = lsof.stdout.trim().split('\n').filter(Boolean);
    check(
      `${name} port`,
      owners.includes(String(state.pid)),
      lsof.status === null ? `cannot tell: ${lsof.stderr} (install lsof)` : `127.0.0.1:${port} held by ${owners.join(',') || 'nobody'}`,
    );
  }

  // What the running process was given, not what state.json says it was given.
  const live = liveDatabaseUrl(state.pid);
  let target: URL | null = null;
  try {
    target = live ? new URL(live) : null;
  } catch {
    target = null;
  }
  check(
    'database target',
    target !== null && target.hostname === '127.0.0.1' && Number(target.port) === state.ports.postgres,
    live === null
      ? `pid ${state.pid}: cannot read the process environment`
      : target === null
        ? `pid ${state.pid}: DATABASE_URL does not parse`
        : `pid ${state.pid} runs with DATABASE_URL at ${target.hostname}:${target.port}${target.pathname}; ours is 127.0.0.1:${state.ports.postgres}`,
  );
  const label = run('docker', ['inspect', '-f', `{{.State.Running}} {{index .Config.Labels "${LABEL}"}}`, CONTAINER]).stdout.trim();
  check('container', label === `true ${STATE_DIR}`, `${CONTAINER}: ${label || 'absent'}`);
  const tables = psql("select count(*) from information_schema.tables where table_name in ('events','installations','recipes','recipe_drafts','run_projection','jobs')");
  check('schema', tables.stdout.trim() === '6', tables.status === 0 ? `${tables.stdout.trim()}/6 core tables` : tables.stderr.trim());

  try {
    const me = await getJson(`${state.dashboard}/api/me`);
    const body = me.body as { mode?: string; accounts?: boolean };
    check('api', me.status === 200 && body.mode === 'local' && body.accounts === false, `GET /api/me ${me.status} ${JSON.stringify(body)}`);
  } catch (error) {
    check('api', false, `GET /api/me failed: ${(error as Error).message}`);
  }

  const stale = bundleStale();
  check('bundle built', stale === null, stale ?? 'web/out is newer than every web source');
  try {
    const served = Buffer.from(await (await fetch(`${state.dashboard}/`, { signal: AbortSignal.timeout(3_000) })).arrayBuffer());
    const same = existsSync(BUNDLE_INDEX) && sha(served) === sha(readFileSync(BUNDLE_INDEX));
    check('bundle served', same, same ? 'GET / is byte-identical to web/out/index.html' : 'GET / differs from web/out/index.html: serve loaded an older build; restart with down + up');
  } catch (error) {
    check('bundle served', false, (error as Error).message);
  }

  check('browser port', await portFree(DEBUG_PORT), `127.0.0.1:${DEBUG_PORT} must be free for \`browse\` (src/browser.ts hardcodes it)`);

  return emit({ ok: checks.every((one) => one.ok), dashboard: state.dashboard, webhook: state.webhook, evidence: state.evidence, checks });
}

async function webhook(args: string[]): Promise<never> {
  const state = readState();
  const unsigned = args.includes('--unsigned');
  const [event, file] = args.filter((arg) => arg !== '--unsigned');
  if (!event || !file) throw new Refusal('usage: repro-verify webhook <x-github-event> <payload.json|-> [--unsigned]');
  const body = file === '-' ? readFileSync(0) : readFileSync(file);
  const delivery = randomUUID();
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-github-event': event,
    'x-github-delivery': delivery,
  };
  if (!unsigned) headers['x-hub-signature-256'] = `sha256=${createHmac('sha256', state.env.GITHUB_WEBHOOK_SECRET!).update(body).digest('hex')}`;
  let status: number;
  let text: string;
  try {
    const response = await fetch(state.webhook, { method: 'POST', headers, body, signal: AbortSignal.timeout(10_000) });
    status = response.status;
    text = (await response.text()).trim();
  } catch (error) {
    const cause = (error as { cause?: { message?: string } }).cause?.message;
    throw new Refusal(`POST ${state.webhook} failed: ${(error as Error).message}${cause ? ` (${cause})` : ''}; is the instance up? run \`repro-verify doctor\``);
  }
  return emit({ ok: true, event, delivery, signed: !unsigned, status, body: text });
}

function cli(args: string[]): never {
  const state = readState();
  const result = spawnSync(process.execPath, ['--import', TSX, join(REPO, 'src/cli.ts'), ...args], {
    cwd: STATE_DIR,
    env: serviceEnv(state),
    stdio: 'inherit',
  });
  process.exit(result.status ?? 1);
}

function sql(args: string[]): never {
  readState();
  const write = args[0] === '--write';
  const statement = (write ? args.slice(1) : args).join(' ');
  if (!statement) throw new Refusal('usage: repro-verify sql [--write] "<sql>"');
  const result = psql(statement, !write);
  if (result.status !== 0) throw new Refusal(result.stderr.trim());
  process.stdout.write(result.stdout);
  process.exit(0);
}

type Step = { op: string; args: string[] };

const ARITY: Record<string, number> = { go: 1, wait: 1, absent: 1, click: 1, fill: 2, shot: 1, text: 1, console: 1 };

/**
 * Not `Browser.type`, which has a product bug (observed, not fixed here; it also backs the
 * engine agent's `browser_type` tool): it assigns `el.value`, which React's value tracker
 * absorbs, so a controlled input's onChange never fires. The prototype's setter is what React observes.
 */
const FILL = (selector: string, text: string) => `(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return 'missing';
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(text)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return 'filled';
})()`;

function parseSteps(argv: string[]): Step[] {
  const steps: Step[] = [];
  for (let i = 0; i < argv.length; ) {
    const op = argv[i]!;
    const arity = ARITY[op];
    if (arity === undefined) throw new Refusal(`unknown browse step "${op}"; steps are ${Object.keys(ARITY).join(', ')}`);
    const args = argv.slice(i + 1, i + 1 + arity);
    if (args.length !== arity) throw new Refusal(`browse step "${op}" takes ${arity} argument(s)`);
    steps.push({ op, args });
    i += 1 + arity;
  }
  if (steps.length === 0) throw new Refusal('usage: repro-verify browse go /repos wait "repositories" shot repos …');
  return steps;
}

async function browse(argv: string[]): Promise<never> {
  const state = readState();
  const steps = parseSteps(argv);
  const binary = CHROMIUM_CANDIDATES.find((path): path is string => !!path && existsSync(path));
  if (!binary) throw new Refusal(`no Chromium found; set ENGINE_CHROMIUM_BIN (tried ${CHROMIUM_CANDIDATES.filter(Boolean).join(', ')})`);
  if (!(await portFree(DEBUG_PORT))) {
    const ours = strayChrome();
    if (ours.length) {
      throw new Refusal(`127.0.0.1:${DEBUG_PORT} is taken by a Chrome this instance started (pid ${ours.join(', ')}): another \`browse\` is running, or an interrupted one left it behind; if none is running, run \`repro-verify down\``);
    }
    throw new Refusal(`127.0.0.1:${DEBUG_PORT} is taken; src/browser.ts hardcodes it, so another browser (a browser test?) is running`);
  }

  const profile = mkdtempSync(join(STATE_DIR, 'chrome-'));
  process.env.ENGINE_CHROMIUM = join(import.meta.dirname, 'chromium-window.sh');
  process.env.ENGINE_CHROMIUM_BIN = binary;
  process.env.ENGINE_CHROMIUM_PROFILE = profile;
  const { Browser } = await import(join(REPO, 'src/browser.ts'));
  const browser = new Browser();
  // Chrome is spawned detached, so a killed helper would otherwise leave it holding 9222.
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void browser.close().finally(() => {
        rmSync(profile, { recursive: true, force: true });
        process.exit(1);
      });
    });
  }

  // innerText applies the stylesheet's text-transform (headings render uppercase), so every match ignores case.
  // A failed read is null, never '': an empty string would satisfy every `absent` and be saved as a page.
  let readError = '';
  const read = async (): Promise<string | null> => {
    try {
      return await browser.text();
    } catch (error) {
      readError = (error as Error).message;
      return null;
    }
  };
  const poll = async (pattern: RegExp, want: boolean): Promise<string> => {
    const deadline = Date.now() + 15_000;
    let last: string | null = null;
    while (Date.now() < deadline) {
      last = await read();
      if (last !== null && pattern.test(last) === want) return last;
      await new Promise((done) => setTimeout(done, 100));
    }
    if (last === null) throw new Refusal(`could not read the page to check /${pattern.source}/i: ${readError}`);
    throw new Refusal(`page ${want ? 'never showed' : 'still shows'} /${pattern.source}/i; it reads: ${last.replace(/\s+/g, ' ').slice(0, 600)}`);
  };

  /**
   * src/browser.ts attaches to whatever answers on 127.0.0.1:9222. Two `browse` runs that both found
   * it free would otherwise both drive the first one's Chrome, and the second would record the
   * first's page. Only 127.0.0.1 is checked: a Chrome that loses that address falls back to
   * [::1]:9222, which browser.ts never connects to.
   */
  const assertOwnBrowser = (): void => {
    const pids = listeners(DEBUG_PORT, '127.0.0.1');
    if (pids === null) throw new Refusal(`cannot tell who holds 127.0.0.1:${DEBUG_PORT} (install lsof); refusing to drive a browser that may not be this one`);
    const flag = `--user-data-dir=${profile}`;
    const foreign = pids.filter((pid) => !commandOf(Number(pid)).includes(flag));
    if (pids.length === 0 || foreign.length) {
      throw new Refusal(`127.0.0.1:${DEBUG_PORT} is held by pid ${pids.join(', ') || 'nobody'}, not (only) by the Chrome this browse started (${flag}); another browse or browser test got there first; run this again when it has finished`);
    }
  };

  const results: Record<string, unknown>[] = [];
  let failure: string | null = null;
  try {
    // Started and checked before the first step, so a browse attached to someone else's Chrome
    // never navigates that browser's tab out from under its owner.
    await browser.start();
    assertOwnBrowser();
    for (const { op, args } of steps) {
      const [a, b] = args as [string, string];
      if (op === 'go') results.push({ op, result: await browser.navigate(new URL(a, state.dashboard).href) });
      else if (op === 'wait') {
        await poll(new RegExp(a, 'i'), true);
        results.push({ op, pattern: a, seen: true });
      } else if (op === 'absent') {
        await poll(new RegExp(a, 'i'), false);
        results.push({ op, pattern: a, seen: false });
      } else if (op === 'click') results.push({ op, result: await browser.click(a) });
      else if (op === 'fill') {
        // `evaluate` is private to Browser; this is the one place the helper reaches past its API.
        const filled = await browser.evaluate(FILL(a, b));
        if (filled === 'missing') throw new Refusal(`nothing matches ${a}`);
        results.push({ op, result: `filled ${a}` });
      }
      else if (op === 'shot') {
        const path = join(state.evidence, `${a}.png`);
        writeFileSync(path, await browser.screenshot());
        results.push({ op, path });
      } else if (op === 'text') {
        const path = join(state.evidence, `${a}.txt`);
        const text = await read();
        if (text === null) throw new Refusal(`could not read the page for text ${a}: ${readError}`);
        writeFileSync(path, text);
        results.push({ op, path });
      } else if (op === 'console') {
        const path = join(state.evidence, `${a}.console.txt`);
        writeFileSync(path, `${browser.console()}\n`);
        results.push({ op, path });
      }
    }
  } catch (error) {
    failure = (error as Error).message;
  }
  const console = browser.console().split('\n');
  await browser.close();
  rmSync(profile, { recursive: true, force: true });
  return emit({ ok: failure === null, ...(failure ? { error: failure } : {}), steps: results, console });
}

async function down(): Promise<never> {
  if (stateDirPresent()) assertPrivateStateDir();
  const state = existsSync(STATE_FILE) ? readState() : null;
  const { did, left } = await teardown(state);
  const evidence = state?.evidence ?? null;
  return emit({
    ok: left.length === 0,
    ...(left.length ? { error: 'down could not stop everything this instance owns; the state dir is kept so a later down can finish', left } : {}),
    did: did.length ? did : ['nothing was running'],
    evidence,
    kept: evidence && existsSync(evidence) ? readdirSync(evidence).sort() : [],
  });
}

const USAGE = `usage: repro-verify <command>
  up                         start Postgres + src/serve.ts on free ports; prints URLs and the evidence dir
  doctor                     read-only: is this instance ours, healthy, and serving the current bundle
  evidence                   print the evidence directory (for tee)
  webhook <event> <file|->   sign a GitHub delivery with the instance's secret and POST it [--unsigned]
  browse <steps…>            drive the dashboard: go PATH | wait RE | absent RE | click CSS | fill CSS TEXT | shot NAME | text NAME | console NAME
  cli <args…>                npx tsx src/cli.ts <args…> against the instance's database
  sql [--write] "<sql>"      psql in the instance's container; read-only unless --write
  logs [n]                   last n lines of the service log (default 40)
  down                       stop everything this instance started; keeps the evidence dir`;

const [command, ...rest] = process.argv.slice(2);
try {
  if (command === 'up') await up();
  else if (command === 'doctor') await doctor();
  else if (command === 'evidence') {
    process.stdout.write(`${readState().evidence}\n`);
    process.exit(0);
  } else if (command === 'webhook') await webhook(rest);
  else if (command === 'browse') await browse(rest);
  else if (command === 'cli') cli(rest);
  else if (command === 'sql') sql(rest);
  else if (command === 'logs') {
    readState();
    process.stdout.write(`${tail(LOG_FILE, Number(rest[0] ?? 40))}\n`);
    process.exit(0);
  } else if (command === 'down') await down();
  else {
    process.stderr.write(`${USAGE}\n`);
    process.exit(command ? 1 : 0);
  }
} catch (error) {
  if (!(error instanceof Refusal)) throw error;
  emit({ ok: false, error: error.message });
}
