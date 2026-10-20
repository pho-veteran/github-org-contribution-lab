#!/usr/bin/env node
// Node.js built-ins only. Run from a trusted checkout of the documentation repository.
import { spawnSync } from 'node:child_process';
import { createHash, createSign, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, rmSync, unlinkSync } from 'node:fs';
import { resolve, dirname, basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateConfig as validateRegistry } from '../templates/controller/scripts/bridge-config.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const templates = resolve(here, '..', 'templates');
const loginPattern = /^[A-Za-z0-9][A-Za-z0-9-]*$/;
const repoPattern = /^[A-Za-z0-9_.-]+$/;
const branch = 'setup/contribution-bridge';
const workflowPath = '.github/workflows/notify-controller.yml';
const appPermissions = {
  source: { contents: 'write', pull_requests: 'write', workflows: 'write' },
  target: { contents: 'write', pull_requests: 'write' },
  dispatch: { actions: 'write' },
};
const same = (a, b) => a?.toLowerCase() === b?.toLowerCase();
const ensure = (condition, message) => { if (!condition) throw new Error(message); };
const json = value => JSON.stringify(value, null, 2) + '\n';
const normalize = value => value.replace(/\r\n/g, '\n');

export function parseRepos(text) {
  const repos = text.split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith('#')).map(s => {
    const match = /^https:\/\/github\.com\/([A-Za-z0-9][A-Za-z0-9-]*)\/([A-Za-z0-9_.-]+)\/?$/.exec(s);
    ensure(match, `Expected a GitHub repository URL without query/fragment: ${s}`);
    const name = match[2].replace(/\.git$/, '');
    ensure(name && name !== '.' && name !== '..', 'Invalid repository name');
    return `${match[1]}/${name}`;
  });
  ensure(repos.length > 0 && repos.length <= 256, 'Supply 1..256 repository URLs');
  ensure(new Set(repos.map(s => s.toLowerCase())).size === repos.length, 'Duplicate B repository');
  ensure(new Set(repos.map(s => s.split('/')[0].toLowerCase())).size === 1, 'All B repositories must belong to one organization');
  return repos;
}

export function makeConfig(repos, orgA, accountA, accountB, controller = 'contribution-controller', sshA = 'github.com', sshB = 'github.com') {
  const orgB = repos[0].split('/')[0];
  ensure(loginPattern.test(orgA) && loginPattern.test(accountA) && loginPattern.test(accountB), 'Invalid org/account');
  ensure(repoPattern.test(controller) && !['.', '..'].includes(controller), 'Invalid controller name');
  ensure(!same(orgA, orgB), 'A and B must be different organizations');
  const config = {
    version: 1, orgA, orgB, accountA, accountB, controller: `${orgB}/${controller}`,
    sshHosts: { source: sshA, target: sshB },
    pairs: repos.map(target => ({
      id: `repo-${target.split('/')[1].toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 40)}-${createHash('sha256').update(target.toLowerCase()).digest('hex').slice(0, 8)}`,
      source: `${orgA}/${target.split('/')[1]}`, target,
    })),
    apps: {
      source: { clientId: '', privateKeyPath: '' },
      target: { clientId: '', privateKeyPath: '' },
      dispatch: { clientId: '', privateKeyPath: '' },
    },
    manual: { workflowsReviewed: false, protectionsReviewed: false },
  };
  validateSetup(config);
  return config;
}

export function validateSetup(c) {
  ensure(c?.version === 1, 'Unsupported setup config version');
  for (const k of ['orgA', 'orgB', 'accountA', 'accountB']) ensure(loginPattern.test(c[k] ?? ''), `Invalid ${k}`);
  ensure(!same(c.orgA, c.orgB), 'A and B must be different organizations');
  for (const side of ['source', 'target']) ensure(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(c.sshHosts?.[side] ?? ''),
    `Invalid SSH Host alias for ${side}`);
  validateRegistry({ controllerRepo: c.controller, sourceBot: 'source[bot]', bot: 'target[bot]', pairs: c.pairs });
  for (const name of [c.controller, ...c.pairs.flatMap(p => [p.source, p.target])]) {
    ensure(!['.', '..'].includes(name.split('/')[1]), 'Invalid repository path');
  }
  ensure(same(c.controller.split('/')[0], c.orgB), 'Controller must belong to B');
  for (const p of c.pairs) {
    ensure(same(p.source.split('/')[0], c.orgA) && same(p.target.split('/')[0], c.orgB), 'Pair owner differs from configured organizations');
    ensure(p.source.split('/')[1] === p.target.split('/')[1], 'Existing A/B repository names must match');
  }
  return c;
}

export function registryFor(c, apps) {
  return validateRegistry({
    controllerRepo: c.controller, bot: `${apps.target.slug}[bot]`,
    sourceBot: `${apps.source.slug}[bot]`, pairs: c.pairs,
  });
}

export function notifierFor(c, pair, template = readFileSync(join(templates, 'notifier', workflowPath), 'utf8')) {
  const values = {
    A_OWNER: pair.source.split('/')[0], A_REPO: pair.source.split('/')[1],
    B_OWNER: c.orgB, B_REPO: pair.target.split('/')[1], CONTROLLER_REPO: c.controller.split('/')[1],
  };
  return normalize(template).replace(/\b(A_OWNER|A_REPO|B_OWNER|B_REPO|CONTROLLER_REPO)\b/g, key => values[key]);
}

function controllerFiles(c, apps) {
  const files = {};
  function walk(dir, prefix = '') {
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      const name = `${prefix}${item.name}`;
      if (item.isDirectory()) walk(join(dir, item.name), `${name}/`);
      else if (item.isFile()) files[name] = normalize(readFileSync(join(dir, item.name), 'utf8'));
      else throw new Error(`Unsupported template entry: ${name}`);
    }
  }
  walk(join(templates, 'controller'));
  files['bridge.config.json'] = json(registryFor(c, apps));
  files['.github/workflows/controller.yml'] = files['.github/workflows/controller.yml'].replaceAll('B_OWNER/CONTROLLER_REPO', c.controller);
  return files;
}

function command(exe, args, { input, cwd, env = {} } = {}) {
  const clean = { ...process.env };
  for (const key of Object.keys(clean)) {
    if (/^(GH_TOKEN|GITHUB_TOKEN|GH_ENTERPRISE_TOKEN|GITHUB_ENTERPRISE_TOKEN|GIT_.*|GH_DEBUG)$/.test(key)) delete clean[key];
  }
  const result = spawnSync(exe, args, {
    cwd, input, encoding: 'utf8', timeout: 180000,
    env: { ...clean, GH_HOST: 'github.com', GH_PROMPT_DISABLED: '1', ...env },
    maxBuffer: 16 * 1024 * 1024, windowsHide: true, shell: false,
  });
  // Do not print spawn errors/stdout/stderr: a child may include credentials or secret input.
  ensure(!result.error && result.status === 0, `${exe} ${args[0]} failed (exit ${result.status ?? 'unknown'}); check permissions/network/tool installation`);
  return result.stdout.trim();
}

export class GitHub {
  constructor(c) { this.c = c; this.tokens = {}; this.keys = {}; }
  async login() {
    command('git', ['--version']); command('gh', ['--version']);
    for (const [side, account] of [['A', this.c.accountA], ['B', this.c.accountB]]) {
      const token = command('gh', ['auth', 'token', '--hostname', 'github.com', '--user', account]);
      const user = await this.api(token, '/user');
      ensure(same(user.data.login, account), `Wrong GitHub account for ${side}`);
      this.tokens[side] = token;
      const org = await this.api(token, `/orgs/${side === 'A' ? this.c.orgA : this.c.orgB}`);
      ensure(org.data.type === 'Organization', `${side} must be an organization`);
      ensure(org.data.login === (side === 'A' ? this.c.orgA : this.c.orgB), `Use canonical organization spelling: ${org.data.login}`);
    }
  }
  async api(token, path, method = 'GET', body, allow = []) {
    const response = await fetch(`https://api.github.com${path}`, {
      method, headers: {
        Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2022-11-28',
      }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000),
    });
    const text = await response.text(), data = text ? JSON.parse(text) : null;
    ensure(response.ok || allow.includes(response.status), `${method} ${path}: HTTP ${response.status}`);
    return { status: response.status, data };
  }
  side(repo) { return same(repo.split('/')[0], this.c.orgA) ? 'A' : 'B'; }
  request(repo, path = '', method = 'GET', body, allow = []) {
    return this.api(this.tokens[this.side(repo)], `/repos/${repo}${path}`, method, body, allow);
  }
  async repo(repo, optional = false) {
    const r = await this.request(repo, '', 'GET', undefined, optional ? [404] : []);
    return r.status === 404 ? null : r.data;
  }
  async main(repo) {
    const r = await this.request(repo, '/git/ref/heads/main', 'GET', undefined, [404, 409]);
    return r.status === 200 ? r.data.object.sha : null;
  }
  async empty(repo) {
    const r = await this.request(repo, '/branches?per_page=1', 'GET', undefined, [409]);
    return r.status === 409 || r.data.length === 0;
  }
  async create(repo) {
    const side = this.side(repo), [org, name] = repo.split('/');
    return (await this.api(this.tokens[side], `/orgs/${org}/repos`, 'POST', {
      name, private: true, auto_init: false, description: 'Contribution bridge repository',
    })).data;
  }
  async file(repo, path, ref = 'main') {
    const r = await this.request(repo, `/contents/${path}?ref=${encodeURIComponent(ref)}`, 'GET', undefined, [404]);
    if (r.status === 404) return null;
    ensure(r.data.type === 'file' && r.data.encoding === 'base64', `Expected a small text file: ${repo}/${path}`);
    return normalize(Buffer.from(r.data.content, 'base64').toString('utf8'));
  }
  async actions(repo) {
    const { data } = await this.request(repo, '/actions/permissions');
    ensure(data.enabled, `Actions disabled: ${repo}. Enable it in repository/org settings`);
  }
  async variable(repo, name) {
    const r = await this.request(repo, `/actions/variables/${name}`, 'GET', undefined, [404]);
    return r.status === 404 ? null : r.data.value;
  }
  async setVariable(repo, name, value) {
    const old = await this.variable(repo, name);
    if (old === value) return;
    await this.request(repo, `/actions/variables${old === null ? '' : `/${name}`}`, old === null ? 'POST' : 'PATCH', { name, value });
  }
  secret(repo, name, value) {
    // gh seals the value locally. PEM goes through stdin, never arguments or disk copies.
    command('gh', ['secret', 'set', name, '--repo', repo, '--app', 'actions'], {
      input: value, env: { GH_TOKEN: this.tokens[this.side(repo)] },
    });
  }
  async secretExists(repo, name) {
    return (await this.request(repo, `/actions/secrets/${name}`, 'GET', undefined, [404])).status === 200;
  }
  async policyReady(repo, sha) {
    const { data } = await this.request(repo, `/actions/workflows/controller.yml/runs?event=push&head_sha=${sha}&per_page=100`);
    const run = data.workflow_runs.find(r => r.head_sha === sha && r.head_branch === 'main');
    ensure(run?.conclusion === 'success', `Controller policy not successful yet: ${repo} @ ${sha}. Wait for Actions, then rerun activate`);
  }
  async dispatch() {
    await this.request(this.c.controller, '/actions/workflows/controller.yml/dispatches', 'POST', { ref: 'main' });
  }
  async reconcileStatus(c, since) {
    const sha = await this.main(c.controller);
    const { data } = await this.request(c.controller, `/actions/workflows/controller.yml/runs?event=workflow_dispatch&head_sha=${sha}&per_page=100`);
    for (const run of data.workflow_runs) {
      if (run.head_branch !== 'main' || run.head_sha !== sha || Date.parse(run.created_at) + 1000 < Date.parse(since)) continue;
      // At most 256 pairs + plan: enumerate jobs instead of relying on the first page.
      const jobs = [];
      for (let page = 1; ; page++) {
        const { data: result } = await this.request(c.controller, `/actions/runs/${run.id}/jobs?per_page=100&page=${page}`);
        jobs.push(...result.jobs);
        if (result.jobs.length < 100) break;
      }
      if (c.pairs.every(p => jobs.some(j => j.name === `Reconcile ${p.id}`))) {
        return { url: run.html_url, conclusion: run.conclusion, status: run.status,
          allPairsSucceeded: c.pairs.every(p => jobs.some(j => j.name === `Reconcile ${p.id}` && j.conclusion === 'success')) };
      }
    }
    return { status: 'waiting-for-all-pairs-run', allPairsSucceeded: false };
  }
  async app(kind, configDir) {
    const spec = this.c.apps?.[kind];
    ensure(spec?.clientId && spec?.privateKeyPath, `Fill apps.${kind}.clientId and privateKeyPath in setup.json`);
    const key = readFileSync(resolve(configDir, spec.privateKeyPath), 'utf8');
    const now = Math.floor(Date.now() / 1000);
    const enc = value => Buffer.from(JSON.stringify(value)).toString('base64url');
    const unsigned = `${enc({ alg: 'RS256', typ: 'JWT' })}.${enc({ iat: now - 60, exp: now + 540, iss: spec.clientId })}`;
    const jwt = `${unsigned}.${createSign('RSA-SHA256').update(unsigned).sign(key).toString('base64url')}`;
    const { data } = await this.api(jwt, '/app');
    ensure(data.client_id === spec.clientId, `Client ID/key mismatch: ${kind}`);
    checkPermissions(data.permissions, appPermissions[kind], `${kind} App`);
    this.keys[kind] = key;
    return { ...data, jwt };
  }
  async checkInstallation(app, kind, repo) {
    const { data: installation } = await this.api(app.jwt, `/repos/${repo}/installation`);
    ensure(same(installation.account.login, repo.split('/')[0]) && installation.repository_selection === 'selected'
      && !installation.suspended_at, `Select repositories explicitly and unsuspend installation for ${repo}`);
    checkPermissions(installation.permissions, appPermissions[kind], `${kind} installation`);
    // Metadata-only token verifies Dispatch has no extra repositories installed.
    const permissions = kind === 'dispatch' ? { metadata: 'read' } : appPermissions[kind];
    const { data } = await this.api(app.jwt, `/app/installations/${installation.id}/access_tokens`, 'POST', {
      ...(kind === 'dispatch' ? {} : { repositories: [repo.split('/')[1]] }), permissions,
    });
    try {
      const { data: visible } = await this.api(data.token, '/installation/repositories?per_page=100');
      ensure(visible.total_count === 1 && visible.repositories.length === 1 && same(visible.repositories[0].full_name, repo),
        `Installation/token scope is not exactly ${repo}`);
    } finally {
      await this.api(data.token, '/installation/token', 'DELETE');
    }
  }
}

export function checkPermissions(actual, required, label) {
  ensure(actual && Object.entries(required).every(([k, v]) => actual[k] === v), `${label}: missing required permissions`);
  ensure(Object.keys(actual).every(k => k === 'metadata' || k in required), `${label}: remove unrelated permissions`);
}

// Bare Git plumbing: no checkout of B files, hooks, filters or application code.
export class Transport {
  constructor(api, configDir, run = command) { this.api = api; this.run = run; this.root = resolve(configDir, 'work'); mkdirSync(this.root, { recursive: true }); }
  async use(fn) {
    const dir = join(this.root, `git-${randomUUID()}`);
    mkdirSync(dir); mkdirSync(join(dir, 'no-hooks'));
    const git = (args, input) => {
      const env = { GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never', GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
        GIT_SSH_COMMAND: 'ssh -o BatchMode=yes -o StrictHostKeyChecking=yes',
        GIT_AUTHOR_NAME: 'Contribution bridge setup', GIT_AUTHOR_EMAIL: 'bridge-setup@users.noreply.github.com',
        GIT_COMMITTER_NAME: 'Contribution bridge setup', GIT_COMMITTER_EMAIL: 'bridge-setup@users.noreply.github.com' };
      return this.run('git', ['-c', `core.hooksPath=${join(dir, 'no-hooks')}`, '-c', 'credential.helper=',
        '-c', 'protocol.file.allow=never', ...args], { cwd: dir, env, input });
    };
    try {
      git(['init', '--bare', '--template=', '.']);
      return await fn(git);
    } finally {
      // Only remove the fresh child generated above; never a repository/user-supplied path.
      ensure(dirname(resolve(dir)) === this.root && basename(dir).startsWith('git-'), 'Unsafe temporary directory');
      rmSync(dir, { recursive: true, force: true });
    }
  }
  remote(repo) {
    const host = same(repo.split('/')[0], this.api.c.orgA) ? this.api.c.sshHosts.source : this.api.c.sshHosts.target;
    return `git@${host}:${repo}.git`;
  }
  async checkSsh(c) {
    await this.use(async git => {
      for (const repo of [c.controller, ...c.pairs.flatMap(p => [p.source, p.target])]) {
        git(['ls-remote', this.remote(repo)]);
      }
    });
  }
  async auditSource(pair) {
    if (!await this.api.main(pair.source)) return;
    await this.use(async git => {
      git(['fetch', '--no-tags', this.remote(pair.source), 'refs/heads/main:refs/heads/source']);
      git(['fetch', '--no-tags', this.remote(pair.target), 'refs/heads/main:refs/heads/target']);
      try { git(['merge-base', '--is-ancestor', 'source', 'target']); }
      catch { throw new Error(`Existing A/main is not an ancestor of B/main: ${pair.source}. Resolve/backup it manually; setup will not overwrite it`); }
    });
  }
  async bootstrap(pair) {
    if (await this.api.main(pair.source)) return; // Existing history is never reset by setup.
    ensure(await this.api.empty(pair.source), `A has other branches but no main: ${pair.source}; bootstrap manually`);
    await this.use(async git => {
      git(['fetch', '--no-tags', this.remote(pair.target), 'refs/heads/main:refs/heads/base']);
      const sha = git(['rev-parse', 'base']);
      git(['push', '--force-with-lease=refs/heads/main:', this.remote(pair.source), 'refs/heads/base:refs/heads/main']);
      ensure(await this.api.main(pair.source) === sha, `Bootstrap verification failed: ${pair.source}`);
    });
    await this.api.request(pair.source, '', 'PATCH', { default_branch: 'main' });
  }
  async controller(c, apps) {
    const files = controllerFiles(c, apps);
    return this.use(async git => {
      const existing = await this.api.main(c.controller);
      if (existing) git(['fetch', '--no-tags', this.remote(c.controller), 'refs/heads/main:refs/heads/base']);
      else ensure(await this.api.empty(c.controller), 'Controller has branches but no main');
      git(['read-tree', '--empty']);
      for (const [path, text] of Object.entries(files)) {
        const blob = git(['hash-object', '-w', '--stdin'], text);
        git(['update-index', '--add', '--cacheinfo', `100644,${blob},${path}`]);
      }
      const tree = git(['write-tree']);
      if (existing) {
        ensure(git(['rev-parse', 'base^{tree}']) === tree,
          'Existing controller differs from generated files. No overwrite: review/deploy controller changes manually, then rerun');
        return git(['rev-parse', 'base']);
      }
      const sha = git(['commit-tree', tree, '-m', 'Configure multi-repository contribution bridge']);
      git(['push', '--force-with-lease=refs/heads/main:', this.remote(c.controller), `${sha}:refs/heads/main`]);
      await this.api.request(c.controller, '', 'PATCH', { default_branch: 'main' });
      return sha;
    });
  }
  async notifier(c, pair) {
    const expected = notifierFor(c, pair);
    const current = await this.api.file(pair.target, workflowPath);
    if (current === expected) return { repo: pair.target, status: 'installed' };
    ensure(current === null, `Existing notifier differs at ${pair.target}. Review/update it manually; setup will not replace it`);
    return this.use(async git => {
      git(['fetch', '--no-tags', this.remote(pair.target), 'refs/heads/main:refs/heads/base']);
      if (git(['ls-tree', '-r', '--name-only', 'base', '--', workflowPath])) {
        ensure(normalize(git(['show', `base:${workflowPath}`])) === expected.trim(),
          `Notifier appeared/changed during setup: ${pair.target}; review it before retrying`);
        return { repo: pair.target, status: 'installed' };
      }
      const remote = await this.api.request(pair.target, `/git/ref/heads/${branch}`, 'GET', undefined, [404]);
      if (remote.status === 200) {
        git(['fetch', '--no-tags', this.remote(pair.target), `refs/heads/${branch}:refs/heads/notifier`]);
        ensure(normalize(git(['show', `notifier:${workflowPath}`])) === expected.trim(), `Existing ${branch} has different notifier`);
        const base = git(['merge-base', 'base', 'notifier']);
        ensure(git(['diff', '--name-only', base, 'notifier']) === workflowPath, `Existing ${branch} contains unrelated changes`);
      } else {
        git(['read-tree', 'base']);
        const blob = git(['hash-object', '-w', '--stdin'], expected);
        git(['update-index', '--add', '--cacheinfo', `100644,${blob},${workflowPath}`]);
        const tree = git(['write-tree']);
        const sha = git(['commit-tree', tree, '-p', 'base', '-m', 'Configure contribution bridge notifier']);
        git(['push', `--force-with-lease=refs/heads/${branch}:`, this.remote(pair.target), `${sha}:refs/heads/${branch}`]);
      }
      const { data: pulls } = await this.api.request(pair.target, `/pulls?state=all&head=${encodeURIComponent(`${c.orgB}:${branch}`)}&base=main&per_page=100`);
      const open = pulls.find(p => p.state === 'open');
      if (open) return { repo: pair.target, status: 'review-required', url: open.html_url };
      ensure(!pulls.length, `Setup PR was closed at ${pair.target}; maintainer must reopen/reconcile it explicitly`);
      const { data: pr } = await this.api.request(pair.target, '/pulls', 'POST', {
        title: '[Setup] Configure contribution bridge notifier', head: branch, base: 'main',
        body: `Configure the shared controller for \`${pair.source}\` → \`${pair.target}\`.\n\nOnly \`${workflowPath}\` changes. Review workflow permissions and repository guards, then merge as maintainer B. The controller will copy B/main to A/main. Setup never merges this PR automatically.\n\nController: \`${c.controller}\`. No credentials are committed.`,
      });
      return { repo: pair.target, status: 'review-required', url: pr.html_url };
    });
  }
}

export async function preflight(c, api, destinationsRequired = false) {
  const records = {};
  for (const p of c.pairs) {
    const b = await api.repo(p.target);
    assertRepo(b, p.target);
    ensure(b.default_branch === 'main' && await api.main(p.target), `B must have existing default main: ${p.target}`);
    await api.actions(p.target);
    records[p.target] = b;
  }
  for (const name of [c.controller, ...c.pairs.map(p => p.source)]) {
    const r = await api.repo(name, !destinationsRequired && name === c.controller);
    if (r) {
      assertRepo(r, name);
      const main = await api.main(name);
      ensure(main ? r.default_branch === 'main' : await api.empty(name), `Existing destination must be empty or use main: ${name}`);
      await api.actions(name);
    } else ensure(!destinationsRequired && name === c.controller, `Missing existing A repository: ${name}`);
    records[name] = r;
  }
  return records;
}

function assertRepo(repo, name) {
  ensure(repo && repo.full_name === name && repo.private && !repo.fork && !repo.archived
    && repo.permissions?.admin, `Need an accessible, private, standalone, unarchived repo and admin permission: ${name}`);
}

async function checkApps(c, api, dir) {
  const apps = {};
  for (const kind of ['source', 'target', 'dispatch']) apps[kind] = await api.app(kind, dir);
  ensure(new Set(Object.values(apps).map(a => a.id)).size === 3, 'Use three distinct Apps');
  for (const p of c.pairs) {
    await api.checkInstallation(apps.source, 'source', p.source);
    await api.checkInstallation(apps.target, 'target', p.target);
  }
  await api.checkInstallation(apps.dispatch, 'dispatch', c.controller);
  return apps;
}

export async function prepare(c, api) {
  const records = await preflight(c, api);
  for (const name of [c.controller]) {
    if (!records[name]) { assertRepo(await api.create(name), name); console.log(`Created private repository: ${name}`); }
  }
  return { status: 'manual-app-installation-required', controller: c.controller, pairs: c.pairs };
}

export async function apply(c, api, transport, dir) {
  ensure(c.manual?.workflowsReviewed === true, 'Review B workflows before bootstrap, then set manual.workflowsReviewed=true');
  console.log('Checking all repositories, SSH connections and App installations...');
  await preflight(c, api, true);
  await transport.checkSsh(c);
  const apps = await checkApps(c, api, dir); // Validate every pair before mutations.
  for (const pair of c.pairs) await transport.auditSource(pair);
  // Validate existing controllers before copying code or replacing secrets.
  const current = await api.main(c.controller);
  if (current) {
    const expected = json(registryFor(c, apps));
    ensure(await api.file(c.controller, 'bridge.config.json') === expected,
      'Existing controller registry differs; review/deploy the generated mapping manually before apply');
  }
  const sha = await transport.controller(c, apps);
  console.log(`Controller revision: ${sha}. Configuring credentials and repository pairs...`);
  if (await api.variable(c.controller, 'BRIDGE_ENABLED') === null) await api.setVariable(c.controller, 'BRIDGE_ENABLED', 'false');
  for (const [kind, prefix] of [['source', 'SOURCE'], ['target', 'BRIDGE']]) {
    await api.setVariable(c.controller, `${prefix}_APP_CLIENT_ID`, c.apps[kind].clientId);
    api.secret(c.controller, `${prefix}_APP_PRIVATE_KEY`, api.keys[kind]);
  }
  const notifiers = [];
  for (const p of c.pairs) {
    console.log(`Configuring ${p.source} -> ${p.target}`);
    for (const repo of [p.source, p.target]) {
      await api.setVariable(repo, 'CONTROLLER_DISPATCH_APP_CLIENT_ID', c.apps.dispatch.clientId);
      api.secret(repo, 'CONTROLLER_DISPATCH_APP_PRIVATE_KEY', api.keys.dispatch);
    }
    await transport.bootstrap(p);
    notifiers.push(await transport.notifier(c, p));
  }
  return { status: 'merge-setup-prs-and-review-protection', controllerSha: sha, notifiers };
}

async function checkCredentials(c, api) {
  for (const [prefix, kind] of [['SOURCE', 'source'], ['BRIDGE', 'target']]) {
    ensure(await api.variable(c.controller, `${prefix}_APP_CLIENT_ID`) === c.apps[kind].clientId
      && await api.secretExists(c.controller, `${prefix}_APP_PRIVATE_KEY`), `Controller ${kind} credentials missing/mismatched`);
  }
  for (const p of c.pairs) for (const repo of [p.source, p.target]) {
    ensure(await api.variable(repo, 'CONTROLLER_DISPATCH_APP_CLIENT_ID') === c.apps.dispatch.clientId
      && await api.secretExists(repo, 'CONTROLLER_DISPATCH_APP_PRIVATE_KEY'), `Dispatch credentials missing/mismatched: ${repo}`);
  }
}

export async function activate(c, api, dir) {
  ensure(c.manual?.workflowsReviewed && c.manual?.protectionsReviewed,
    'Complete manual workflow/protection review, then set both manual flags true');
  await preflight(c, api, true);
  const apps = await checkApps(c, api, dir);
  ensure(await api.file(c.controller, 'bridge.config.json') === json(registryFor(c, apps)), 'Controller registry differs');
  await checkCredentials(c, api);
  for (const p of c.pairs) ensure(await api.file(p.target, workflowPath) === notifierFor(c, p), `Merge the setup PR first: ${p.target}`);
  const sha = await api.main(c.controller);
  await api.policyReady(c.controller, sha);
  const dispatchedAt = new Date().toISOString();
  await api.setVariable(c.controller, 'BRIDGE_ENABLED', 'true');
  await api.dispatch();
  return { status: 'dispatched-not-yet-verified', controllerSha: sha, dispatchedAt,
    actions: `https://github.com/${c.controller}/actions/workflows/controller.yml` };
}

export async function verify(c, api, activation) {
  await preflight(c, api, true);
  await checkCredentials(c, api);
  ensure(await api.variable(c.controller, 'BRIDGE_ENABLED') === 'true', 'Bridge is not enabled');
  const deployed = JSON.parse(await api.file(c.controller, 'bridge.config.json') || 'null');
  ensure(deployed && JSON.stringify(deployed.pairs) === JSON.stringify(c.pairs) && deployed.controllerRepo === c.controller, 'Controller registry differs');
  const pairs = [];
  for (const p of c.pairs) {
    const a = await api.main(p.source), b = await api.main(p.target);
    const notifierA = await api.file(p.source, workflowPath) === notifierFor(c, p);
    const notifierB = await api.file(p.target, workflowPath) === notifierFor(c, p);
    pairs.push({ id: p.id, source: p.source, target: p.target, sourceMain: a, targetMain: b, notifierA, notifierB, synced: Boolean(a && a === b) });
  }
  const run = activation?.dispatchedAt
    ? await api.reconcileStatus(c, activation.dispatchedAt)
    : { status: 'no-local-activation-report', allPairsSucceeded: false };
  const ready = pairs.every(p => p.synced && p.notifierA && p.notifierB) && run.allPairsSucceeded
    && run.conclusion === 'success' && c.manual?.workflowsReviewed && c.manual?.protectionsReviewed;
  return { status: ready ? 'configuration-and-main-sync-verified' : 'not-ready', pairs, run,
    manualProtectionAttestation: c.manual?.protectionsReviewed === true,
    limits: 'Secret values and effective branch protection are not proven by this check. Run a contribution PR lifecycle and denied-write checks before handover.' };
}

function argsOf(argv) {
  const [mode, ...rest] = argv, opts = {};
  for (let i = 0; i < rest.length; i += 2) {
    ensure(/^--[a-z-]+$/.test(rest[i]) && rest[i + 1] && !rest[i + 1].startsWith('--'), 'Options require values');
    ensure(!(rest[i] in opts), `Duplicate option ${rest[i]}`);
    opts[rest[i]] = rest[i + 1];
  }
  const allowed = mode === 'init' ? ['--repos', '--org-a', '--account-a', '--account-b', '--dir', '--controller', '--ssh-a', '--ssh-b'] : ['--dir'];
  ensure(Object.keys(opts).every(k => allowed.includes(k)), 'Unknown option');
  return { mode, opts };
}

export async function main(argv = process.argv.slice(2)) {
  if (!argv.length || argv[0] === '--help') {
    console.log(`Usage:
  node setup/setup.mjs init --repos repos-b.txt --org-a ORG_A --account-a ADMIN_A --account-b ADMIN_B --ssh-a SSH_HOST_A --ssh-b SSH_HOST_B --dir .bridge-setup [--controller contribution-controller]
  node setup/setup.mjs prepare|apply|activate|verify --dir .bridge-setup
Edit .bridge-setup/setup.json after prepare: App Client IDs, PEM paths and manual review flags.
Existing private A repositories must have the same names as B. Git uses your SSH Host aliases; gh accounts authenticate API/secret operations.
init is local only; prepare validates A/B and creates only the controller if missing; apply bootstraps/configures and opens setup PRs; activate dispatches; verify is read-only.`);
    return;
  }
  const { mode, opts } = argsOf(argv);
  ensure(['init', 'prepare', 'apply', 'activate', 'verify'].includes(mode), 'Unknown command');
  ensure(opts['--dir'], '--dir is required');
  const dir = resolve(opts['--dir']), configPath = join(dir, 'setup.json');
  if (mode === 'init') {
    for (const key of ['--repos', '--org-a', '--account-a', '--account-b', '--ssh-a', '--ssh-b']) ensure(opts[key], `${key} is required`);
    ensure(!existsSync(configPath), 'setup.json already exists; edit it or choose a new directory');
    ensure(!existsSync(dir) || readdirSync(dir).length === 0, '--dir must be a new or empty directory');
    const c = makeConfig(parseRepos(readFileSync(resolve(opts['--repos']), 'utf8')), opts['--org-a'], opts['--account-a'], opts['--account-b'], opts['--controller'], opts['--ssh-a'], opts['--ssh-b']);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, '.gitignore'), '*\n');
    writeFileSync(configPath, json(c), { flag: 'wx', mode: 0o600 });
    console.log(`Created ${configPath}; ${c.pairs.length} pairs. Run prepare.`);
    return;
  }
  const c = validateSetup(JSON.parse(readFileSync(configPath, 'utf8')));
  const api = new GitHub(c);
  await api.login();
  const lock = join(dir, 'setup.lock');
  writeFileSync(lock, json({ pid: process.pid, command: mode, startedAt: new Date().toISOString() }), { flag: 'wx' });
  try {
    let report;
    if (mode === 'prepare') report = await prepare(c, api);
    if (mode === 'apply') {
      command(process.execPath, ['--test', ...readdirSync(join(templates, 'controller/tests'))
        .filter(p => p.endsWith('.test.mjs')).map(p => join(templates, 'controller/tests', p))]);
      report = await apply(c, api, new Transport(api, dir), dir);
    }
    if (mode === 'activate') report = await activate(c, api, dir);
    if (mode === 'verify') report = await verify(c, api, existsSync(join(dir, 'activate-report.json'))
      ? JSON.parse(readFileSync(join(dir, 'activate-report.json'), 'utf8')) : undefined);
    writeFileSync(join(dir, `${mode}-report.json`), json(report));
    console.log(json(report));
    if (report.status === 'not-ready') process.exitCode = 2;
  } finally { unlinkSync(lock); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    // Never serialize full errors/causes; spawn/fetch errors may retain credentials.
    console.error(`Setup stopped: ${error.message}`);
    process.exitCode = 1;
  });
}
