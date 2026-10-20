import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseRepos, makeConfig, validateSetup, notifierFor, registryFor, checkPermissions,
  preflight, prepare, apply, activate, verify, Transport, GitHub } from './setup.mjs';

const j = x => JSON.stringify(x, null, 2) + '\n';
const config = (n = 7) => makeConfig(Array.from({ length: n }, (_, i) => `OrgB/project-${i + 1}`), 'OrgA', 'admin-a', 'admin-b');
function fixture(n = 7) {
  const c = config(n);
  c.manual = { workflowsReviewed: true, protectionsReviewed: true };
  for (const key of ['source', 'target', 'dispatch']) c.apps[key] = { clientId: `client-${key}`, privateKeyPath: `${key}.pem` };
  const apps = { source: { id: 1, slug: 'sync' }, target: { id: 2, slug: 'transport' }, dispatch: { id: 3, slug: 'dispatch' } };
  const repos = new Map(), mains = new Map(), files = new Map(), variables = new Map(), secrets = new Set(), calls = [];
  const record = name => ({ full_name: name, private: true, fork: false, archived: false, permissions: { admin: true }, default_branch: 'main' });
  for (const p of c.pairs) {
    repos.set(p.target, record(p.target)); mains.set(p.target, 'a'.repeat(40));
    repos.set(p.source, record(p.source)); // A already exists and is empty.
  }
  const api = {
    c,
    keys: { source: 'pem-source', target: 'pem-target', dispatch: 'pem-dispatch' },
    repo: async (name, optional) => { if (!repos.has(name) && !optional) throw new Error('Missing repo'); return repos.get(name); },
    main: async name => mains.get(name) || null,
    empty: async name => !mains.has(name),
    actions: async () => {},
    create: async name => { calls.push(['create', name]); const r = record(name); repos.set(name, r); return r; },
    file: async (name, path) => files.get(`${name}/${path}`) ?? null,
    variable: async (name, key) => variables.get(`${name}/${key}`) ?? null,
    setVariable: async (name, key, value) => { calls.push(['variable', name, key]); variables.set(`${name}/${key}`, value); },
    secret: (name, key) => { calls.push(['secret', name, key]); secrets.add(`${name}/${key}`); },
    secretExists: async (name, key) => secrets.has(`${name}/${key}`),
    app: async kind => apps[kind],
    checkInstallation: async (app, kind, name) => { calls.push(['scope', kind, name]); },
    policyReady: async () => {},
    dispatch: async () => { calls.push(['dispatch']); },
    reconcileStatus: async () => ({ conclusion: 'success', allPairsSucceeded: true, status: 'completed' }),
  };
  const transport = {
    checkSsh: async () => {},
    auditSource: async p => { calls.push(['audit', p.source]); },
    controller: async () => {
      calls.push(['controller']);
      files.set(`${c.controller}/bridge.config.json`, j(registryFor(c, apps)));
      mains.set(c.controller, 'c'.repeat(40)); return mains.get(c.controller);
    },
    bootstrap: async p => { calls.push(['bootstrap', p.source]); if (!mains.has(p.source)) mains.set(p.source, mains.get(p.target)); },
    notifier: async (cfg, p) => { calls.push(['notifier', p.target]); return { status: 'review-required', repo: p.target }; },
  };
  const merge = () => { for (const p of c.pairs) files.set(`${p.target}/.github/workflows/notify-controller.yml`, notifierFor(c, p)); };
  const sync = () => { for (const p of c.pairs) files.set(`${p.source}/.github/workflows/notify-controller.yml`, notifierFor(c, p)); };
  return { c, api, apps, transport, calls, repos, mains, files, variables, secrets, merge, sync };
}

test('seven URLs produce stable, unique mappings and preserve names', () => {
  const repos = parseRepos('# B repositories\nhttps://github.com/OrgB/Api.git\nhttps://github.com/OrgB/.config/\n');
  assert.deepEqual(repos, ['OrgB/Api', 'OrgB/.config']);
  const c = makeConfig(repos, 'OrgA', 'a', 'b');
  assert.equal(c.pairs[0].source, 'OrgA/Api');
  validateSetup(c);
  const seven = config(); assert.equal(seven.pairs.length, 7);
  assert.equal(new Set(seven.pairs.map(p => p.id)).size, 7);
  assert.deepEqual(seven, config());
});

test('reject ambiguous/hostile URLs, duplicate repos, cross-org lists and collisions', () => {
  for (const text of ['', 'https://evil.com/B/x', 'https://github.com/B/x?token=secret',
    'https://github.com/B/x/pull/1', 'https://github.com/B/..', 'https://user@github.com/B/x',
    'https://github.com/B/x\nhttps://github.com/b/X', 'https://github.com/B/x\nhttps://github.com/C/y']) {
    assert.throws(() => parseRepos(text));
  }
  assert.throws(() => makeConfig(['OrgB/x'], 'OrgB', 'a', 'b'));
  assert.throws(() => makeConfig(['OrgB/contribution-controller'], 'OrgA', 'a', 'b'));
  const c = config(); c.pairs[1].source = c.pairs[0].source; assert.throws(() => validateSetup(c));
});

test('notifier replaces every placeholder and routes only this pair to the shared controller', () => {
  const c = config();
  for (const p of c.pairs) {
    const text = notifierFor(c, p);
    assert.doesNotMatch(text, /A_OWNER|A_REPO|B_OWNER|B_REPO|CONTROLLER_REPO/);
    assert.ok(text.includes(p.source) && text.includes(p.target) && text.includes(c.controller));
    assert.ok(text.includes('CONTROLLER_DISPATCH_APP_PRIVATE_KEY'));
    for (const other of c.pairs.filter(x => x !== p)) assert.ok(!text.includes(`${other.source}'`));
  }
});

test('permission validation requires exact capabilities and rejects extra privileges', () => {
  checkPermissions({ contents: 'write', metadata: 'read' }, { contents: 'write' }, 'test');
  assert.throws(() => checkPermissions({ contents: 'read' }, { contents: 'write' }, 'test'));
  assert.throws(() => checkPermissions({ contents: 'write', actions: 'write' }, { contents: 'write' }, 'test'));
});

test('prepare validates existing A/B and creates only one controller across reruns', async () => {
  const f = fixture(); f.repos.get(f.c.pairs[6].target).private = false;
  await assert.rejects(prepare(f.c, f.api)); assert.equal(f.calls.length, 0);
  f.repos.get(f.c.pairs[6].target).private = true;
  await prepare(f.c, f.api); await prepare(f.c, f.api);
  assert.deepEqual(f.calls.filter(x => x[0] === 'create'), [['create', f.c.controller]]);
});

test('prepare refuses missing A rather than creating it, and validates SSH aliases', async () => {
  const f = fixture(); f.repos.delete(f.c.pairs[6].source);
  await assert.rejects(prepare(f.c, f.api));
  assert.equal(f.calls.length, 0);
  for (const host of ['-oProxyCommand=x', 'github.com;echo', 'user@github.com', 'host/path']) {
    const c = config(); c.sshHosts.source = host;
    assert.throws(() => validateSetup(c));
  }
});
test('preflight rejects forks, missing admin, archived repos and non-main defaults', async () => {
  for (const [key, value] of [['fork', true], ['archived', true], ['permissions', { admin: false }], ['default_branch', 'master']]) {
    const f = fixture(); f.repos.get(f.c.pairs[0].target)[key] = value;
    await assert.rejects(preflight(f.c, f.api));
  }
});

test('apply blocks on review or any installation failure before remote mutation', async () => {
  const f = fixture(); await prepare(f.c, f.api); f.calls.length = 0;
  f.c.manual.workflowsReviewed = false;
  await assert.rejects(apply(f.c, f.api, f.transport, '.'), /Review B workflows/);
  assert.equal(f.calls.length, 0);
  f.c.manual.workflowsReviewed = true;
  f.api.checkInstallation = async (_a, _k, repo) => { if (repo === f.c.pairs[6].target) throw new Error('Not installed'); };
  await assert.rejects(apply(f.c, f.api, f.transport, '.'), /Not installed/);
  assert.equal(f.calls.length, 0);
});

test('apply scopes all pairs, audits existing A, shares controller, and puts only dispatch keys in code repos', async () => {
  const f = fixture(); await prepare(f.c, f.api); f.calls.length = 0;
  const report = await apply(f.c, f.api, f.transport, '.');
  assert.equal(report.notifiers.length, 7);
  assert.equal(f.calls.filter(x => x[0] === 'scope').length, 15);
  assert.equal(f.calls.filter(x => x[0] === 'controller').length, 1);
  assert.equal(f.calls.filter(x => x[0] === 'bootstrap').length, 7);
  const writes = f.calls.filter(x => x[0] === 'secret');
  assert.equal(writes.length, 16);
  for (const [, repo, name] of writes) {
    assert.equal(repo === f.c.controller, name !== 'CONTROLLER_DISPATCH_APP_PRIVATE_KEY');
  }
  assert.equal(f.variables.get(`${f.c.controller}/BRIDGE_ENABLED`), 'false');
  assert.ok(f.calls.findIndex(x => x[0] === 'controller') > f.calls.findLastIndex(x => x[0] === 'audit'));
});

test('diverged A and a different existing controller stop before replacing secrets', async () => {
  const f = fixture(); await prepare(f.c, f.api); f.calls.length = 0;
  f.transport.auditSource = async () => { throw new Error('diverged'); };
  await assert.rejects(apply(f.c, f.api, f.transport, '.'), /diverged/);
  assert.ok(!f.calls.some(x => x[0] === 'secret'));
  f.transport.auditSource = async () => {};
  f.mains.set(f.c.controller, 'c'.repeat(40)); f.files.set(`${f.c.controller}/bridge.config.json`, '{}');
  await assert.rejects(apply(f.c, f.api, f.transport, '.'), /registry differs/);
  assert.ok(!f.calls.some(x => x[0] === 'secret'));
});

test('activate waits for manual protection, merged notifier, credentials and policy', async () => {
  const f = fixture(2); await prepare(f.c, f.api); await apply(f.c, f.api, f.transport, '.');
  f.c.manual.protectionsReviewed = false;
  await assert.rejects(activate(f.c, f.api, '.'), /manual/);
  f.c.manual.protectionsReviewed = true;
  await assert.rejects(activate(f.c, f.api, '.'), /Merge the setup PR/);
  f.merge();
  f.api.policyReady = async () => { throw new Error('policy pending'); };
  await assert.rejects(activate(f.c, f.api, '.'), /policy pending/);
  assert.equal(f.variables.get(`${f.c.controller}/BRIDGE_ENABLED`), 'false');
  f.api.policyReady = async () => {};
  const r = await activate(f.c, f.api, '.');
  assert.equal(r.status, 'dispatched-not-yet-verified');
  assert.ok(r.dispatchedAt);
  assert.equal(f.calls.filter(x => x[0] === 'dispatch').length, 1);
});

test('verify requires both mains/notifiers AND a successful all-pairs run; never confuses dispatch with completion', async () => {
  const f = fixture(2); await prepare(f.c, f.api); await apply(f.c, f.api, f.transport, '.'); f.merge();
  const activation = await activate(f.c, f.api, '.');
  assert.equal((await verify(f.c, f.api, activation)).status, 'not-ready');
  f.sync();
  assert.equal((await verify(f.c, f.api)).status, 'not-ready');
  f.api.reconcileStatus = async () => ({ status: 'in_progress', allPairsSucceeded: false });
  assert.equal((await verify(f.c, f.api, activation)).status, 'not-ready');
  f.api.reconcileStatus = async () => ({ status: 'completed', conclusion: 'success', allPairsSucceeded: true });
  assert.equal((await verify(f.c, f.api, activation)).status, 'configuration-and-main-sync-verified');
  f.mains.set(f.c.pairs[1].source, 'b'.repeat(40));
  assert.equal((await verify(f.c, f.api, activation)).status, 'not-ready');
});

test('installation check revokes its token even when repository scope is wrong', async () => {
  const c = config(1), api = new GitHub(c), calls = [];
  api.api = async (_token, path, method, body) => {
    calls.push({ path, method, body });
    if (path.endsWith('/installation')) return { data: {
      id: 1, account: { login: 'OrgA' }, repository_selection: 'selected',
      permissions: { contents: 'write', pull_requests: 'write', workflows: 'write' },
    } };
    if (path.endsWith('/access_tokens')) return { data: { token: 'test-only-token' } };
    if (path.startsWith('/installation/repositories')) return { data: { total_count: 2, repositories: [] } };
    if (path === '/installation/token') return { status: 204 };
    throw new Error('Unexpected call');
  };
  await assert.rejects(api.checkInstallation({ jwt: 'fake-jwt' }, 'source', c.pairs[0].source), /scope/);
  assert.equal(calls.at(-1).method, 'DELETE');
  assert.deepEqual(calls.find(x => x.path.endsWith('/access_tokens')).body.repositories, ['project-1']);
});

test('reconcile verification tolerates GitHub second precision but requires every matrix job', async () => {
  const c = config(2), api = new GitHub(c);
  api.main = async () => 'a'.repeat(40);
  let jobs = [{ name: `Reconcile ${c.pairs[0].id}`, conclusion: 'success' }];
  api.request = async (_repo, path) => path.includes('/jobs?')
    ? { data: { jobs } }
    : { data: { workflow_runs: [{
      id: 1, head_sha: 'a'.repeat(40), head_branch: 'main', created_at: '2026-01-01T00:00:00Z',
      conclusion: 'success', status: 'completed', html_url: 'https://github.com/OrgB/controller/actions/runs/1',
    }] } };
  assert.equal((await api.reconcileStatus(c, '2026-01-01T00:00:00.500Z')).allPairsSucceeded, false);
  jobs.push({ name: `Reconcile ${c.pairs[1].id}`, conclusion: 'skipped' });
  assert.equal((await api.reconcileStatus(c, '2026-01-01T00:00:00.500Z')).allPairsSucceeded, false);
  jobs[1].conclusion = 'success';
  assert.equal((await api.reconcileStatus(c, '2026-01-01T00:00:00.500Z')).allPairsSucceeded, true);
  assert.equal((await api.reconcileStatus(c, '2026-01-01T00:01:00Z')).allPairsSucceeded, false);
});

function realGit(t) {
  const root = mkdtempSync(join(tmpdir(), 'bridge-setup-test-'));
  t.after(() => {
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    assert.ok(basename(root).startsWith('bridge-setup-test-'));
    rmSync(root, { recursive: true, force: true });
  });
  function run(args, cwd = root, input, extra = {}) {
    const r = spawnSync('git', args, { cwd, input, encoding: 'utf8', windowsHide: true,
      env: { ...process.env, GIT_AUTHOR_NAME: 'Developer A', GIT_AUTHOR_EMAIL: 'dev@example.invalid',
        GIT_COMMITTER_NAME: 'Developer A', GIT_COMMITTER_EMAIL: 'dev@example.invalid', ...extra } });
    if (r.status !== 0) throw new Error(`Git test failed: ${r.stderr}`);
    return r.stdout.trim();
  }
  const urls = new Map();
  for (const name of ['OrgA/project-1', 'OrgB/project-1', 'OrgB/contribution-controller']) {
    const dir = join(root, name.replace('/', '-')); mkdirSync(dir); run(['init', '--bare', '--template=', '.'], dir);
    urls.set(`https://github.com/${name}.git`, dir);
    urls.set(`git@github.com:${name}.git`, dir);
  }
  const c = config(1), a = urls.get(`https://github.com/${c.pairs[0].source}.git`), b = urls.get(`https://github.com/${c.pairs[0].target}.git`);
  const tree = run(['mktree'], b, '');
  const initial = run(['commit-tree', tree, '-m', 'Existing B history'], b);
  run(['update-ref', 'refs/heads/main', initial], b);
  const pulls = [];
  const api = {
    c,
    tokens: { A: 'dummy-a', B: 'dummy-b' }, side: name => name.startsWith('OrgA/') ? 'A' : 'B',
    main: async name => {
      const repo = urls.get(`https://github.com/${name}.git`);
      const refs = run(['for-each-ref', '--format=%(objectname)', 'refs/heads/main'], repo);
      return refs || null;
    },
    empty: async name => !run(['for-each-ref', '--format=%(refname)', 'refs/heads'], urls.get(`https://github.com/${name}.git`)),
    file: async (name, path) => {
      const dir = urls.get(`https://github.com/${name}.git`);
      const entries = run(['ls-tree', '-r', '--name-only', 'main'], dir);
      return entries.split('\n').includes(path) ? run(['show', `main:${path}`], dir) + '\n' : null;
    },
    request: async (name, path, method, body) => {
      const dir = urls.get(`https://github.com/${name}.git`);
      if (method === 'PATCH') return {};
      if (path.startsWith('/git/ref/heads/')) {
        const sha = run(['for-each-ref', '--format=%(objectname)', `refs/heads/${path.slice('/git/ref/heads/'.length)}`], dir);
        return sha ? { status: 200, data: { object: { sha } } } : { status: 404 };
      }
      if (method === 'POST' && path === '/pulls') {
        const pr = { ...body, state: 'open', html_url: 'https://github.com/OrgB/project-1/pull/1' }; pulls.push(pr);
        return { data: pr };
      }
      if (path.startsWith('/pulls?')) return { data: pulls };
      throw new Error(`Unexpected test API: ${path}`);
    },
  };
  const runner = (_exe, args, opts) => {
    const translated = args.map(s => urls.get(s) || (s === 'protocol.file.allow=never' ? 'protocol.file.allow=always' : s));
    return run(translated, opts.cwd, opts.input, opts.env);
  };
  return { root, run, api, c, a, b, initial, pulls, transport: new Transport(api, root, runner) };
}

test('real Git bootstrap preserves commit SHA/identity and leaves existing A/main alone', async t => {
  const f = realGit(t), p = f.c.pairs[0];
  await f.transport.auditSource(p); await f.transport.bootstrap(p);
  assert.equal(await f.api.main(p.source), f.initial);
  assert.equal(f.run(['cat-file', '-p', f.initial], f.a), f.run(['cat-file', '-p', f.initial], f.b));
  await f.transport.bootstrap(p); await f.transport.auditSource(p);
  const tree = f.run(['rev-parse', 'main^{tree}'], f.a);
  const other = f.run(['commit-tree', tree, '-p', 'main', '-m', 'A-only work'], f.a);
  f.run(['update-ref', 'refs/heads/main', other], f.a);
  await assert.rejects(f.transport.auditSource(p), /not an ancestor/);
  await f.transport.bootstrap(p);
  assert.equal(await f.api.main(p.source), other);
  assert.deepEqual(readdirSync(join(f.root, 'work')), []);
});

test('first bootstrap cannot replace a main created concurrently', async t => {
  const f = realGit(t), p = f.c.pairs[0];
  let concurrent;
  f.api.empty = async () => {
    f.run(['fetch', f.b, 'refs/heads/main:refs/heads/main'], f.a);
    const tree = f.run(['rev-parse', 'main^{tree}'], f.a);
    concurrent = f.run(['commit-tree', tree, '-p', 'main', '-m', 'Concurrent A work'], f.a);
    f.run(['update-ref', 'refs/heads/main', concurrent], f.a);
    return true; // Repo was empty at the API snapshot; another actor then created main.
  };
  await assert.rejects(f.transport.bootstrap(p));
  assert.equal(await f.api.main(p.source), concurrent);
});

test('real Git notifier changes one file on a setup branch, reuses its PR, and never changes B/main', async t => {
  const f = realGit(t), p = f.c.pairs[0];
  await f.transport.notifier(f.c, p); await f.transport.notifier(f.c, p);
  assert.equal(f.pulls.length, 1);
  assert.equal(await f.api.main(p.target), f.initial);
  assert.equal(f.run(['diff', '--name-only', 'main', 'setup/contribution-bridge'], f.b), '.github/workflows/notify-controller.yml');
  assert.equal(f.run(['show', 'setup/contribution-bridge:.github/workflows/notify-controller.yml'], f.b), notifierFor(f.c, p).trim());
});

test('real Git controller deployment is repeatable but refuses unrelated existing content', async t => {
  const f = realGit(t);
  const apps = { source: { slug: 'sync' }, target: { slug: 'transport' } };
  const sha = await f.transport.controller(f.c, apps);
  assert.equal(await f.transport.controller(f.c, apps), sha);
  assert.equal(await f.api.main(f.c.controller), sha);
  const changed = structuredClone(f.c); changed.pairs[0].id = 'changed';
  await assert.rejects(f.transport.controller(changed, apps), /differs/);
  assert.equal(await f.api.main(f.c.controller), sha);
});
