import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { renderNotifier } from '../scripts/render-notifier.mjs';

const template = readFileSync(new URL('../templates/notifier/.github/workflows/notify-controller.yml', import.meta.url), 'utf8');
const registry = { controllerRepo: 'B/controller', bot: 'transport[bot]', sourceBot: 'sync[bot]', pairs: [
  { id: 'example', source: 'A/repo', target: 'B/repo', sourceBranch: 'dev', targetBranch: 'dev' },
] };
const workflow = renderNotifier(template, registry, 'example');
const scripts = [...workflow.matchAll(/node --input-type=module <<'NODE'\n([\s\S]*?)          NODE/g)]
  .map(m => m[1].replace(/^          /gm, ''));
test('renderer resolves all repo/base placeholders and preserves full PR/SHA run-name', () => {
  assert.ok(!workflow.includes('CONTRIBUTION_BRANCH'));
  assert.match(workflow, /branches: \[dev\]/);
  assert.match(workflow, /default_branch/);
  // A plain YAML scalar would truncate the expression at the space + #.
  assert.match(workflow, /run-name: >-\n  \$\{\{.*Submit A PR #.*inputs.head_sha/);
  assert.match(workflow, /github.run_attempt == 1/);
  assert.match(workflow, /permission-actions: write/);
  assert.equal(scripts.length, 2);
});
test('notifier validates exact head/open/ready/base/repository without executing PR code', () => {
  const head = 'a'.repeat(40);
  for (const change of [null, { state: 'closed' }, { draft: true }, { base: { ref: 'main' } }, { head: { sha: 'b'.repeat(40), repo: { full_name: 'A/repo' } } }]) {
    const p = { state: 'open', draft: false, base: { ref: 'dev' }, head: { sha: head, repo: { full_name: 'A/repo' } }, ...change };
    const code = `globalThis.fetch = async () => ({ok:true,json:async()=>(${JSON.stringify(p)})});\n${scripts[0]}`;
    const result = spawnSync(process.execPath, ['--input-type=module'], { input: code, encoding: 'utf8',
      env: { ...process.env, SOURCE_REPO: 'A/repo', SOURCE_PR: '3', SOURCE_SHA: head, GH_TOKEN: 'fixture' } });
    assert.equal(result.status === 0, change === null, result.stderr);
  }
});
test('notifier sends immutable PR/SHA payload and rejects automatic A events', () => {
  const directory = mkdtempSync(join(tmpdir(), 'manual-notifier-'));
  try {
    for (const event of ['workflow_dispatch', 'pull_request_target']) {
      const code = `globalThis.fetch=async (url, options)=>{console.log(options.body);return {ok:true,status:204}};\n${scripts[1]}`;
      const result = spawnSync(process.execPath, ['--input-type=module'], { input: code, encoding: 'utf8',
        env: { ...process.env, SOURCE_REPO: 'A/repo', SOURCE_PR: '3', SOURCE_SHA: 'a'.repeat(40), SOURCE_RUN_ID: '11', SOURCE_EVENT: event, DISPATCH_TOKEN: 'fixture', GITHUB_STEP_SUMMARY: join(directory, 'summary') } });
      if (event === 'workflow_dispatch') {
        assert.equal(result.status, 0, result.stderr);
        const payload = JSON.parse(result.stdout);
        assert.equal(payload.ref, 'main');
        assert.equal(payload.inputs.source_sha, 'a'.repeat(40));
        assert.equal(payload.inputs.source_pr, '3');
      } else {
        assert.notEqual(result.status, 0);
        assert.equal(result.stdout, '');
      }
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
