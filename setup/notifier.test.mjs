import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const template = readFileSync(new URL('../templates/notifier/.github/workflows/notify-controller.yml', import.meta.url), 'utf8');
const condition = template.match(/    if: >-\r?\n([\s\S]*?)    runs-on:/)[1].trim();
const group = template.match(/  group: (.+)/)[1];
function context(repo, eventName, ref = 'refs/heads/main', type = 'User') {
  return {
    repository: repo, event_name: eventName, ref,
    event: {
      sender: { type },
      issue: {},
      pull_request: { number: 12, base: { ref: 'main' }, head: { repo: { full_name: repo } } },
    },
  };
}
function allowed(github) {
  return Boolean(runInNewContext(condition, {
    github, startsWith: (value, prefix) => value.startsWith(prefix),
  }));
}
function concurrency(github) {
  return group.replace(/\$\{\{ (.*?) \}\}/g, (_, expression) => runInNewContext(expression, {github}));
}

for (const branch of ['main', 'dev', 'release/team/v1', 'incoming/a-pr-12']) {
  test(`B push dispatches from ${branch}, including App pushes`, () => {
    for (const sender of ['User', 'Bot']) assert.equal(allowed(context('B_OWNER/B_REPO', 'push', `refs/heads/${branch}`, sender)), true);
  });
}
test('A pushes never dispatch, including sync App writes', () => {
  for (const sender of ['User','Bot']) assert.equal(allowed(context('A_OWNER/A_REPO','push','refs/heads/dev',sender)), false);
});
test('tags and repositories outside the pair cannot dispatch', () => {
  assert.equal(allowed(context('B_OWNER/B_REPO','push','refs/tags/v1')), false);
  assert.equal(allowed(context('stranger/repo','push')), false);
});
test('contribution PR guard still accepts same-repo human PRs only', () => {
  for (const repo of ['A_OWNER/A_REPO','B_OWNER/B_REPO']) {
    const github = context(repo, 'pull_request_target');
    assert.equal(allowed(github), true);
    github.event.pull_request.head.repo.full_name = 'fork/repo';
    assert.equal(allowed(github), false);
    github.event.pull_request.head.repo.full_name = repo;
    github.event.sender.type = 'Bot';
    assert.equal(allowed(github), false);
  }
});
test('human PR comments dispatch; issue-only and bot comments do not', () => {
  const github = context('A_OWNER/A_REPO','issue_comment');
  assert.equal(allowed(github), false);
  github.event.issue.pull_request = {url:'https://api.github.com/repos/A_OWNER/A_REPO/pulls/12'};
  assert.equal(allowed(github), true);
  github.event.sender.type = 'Bot';
  assert.equal(allowed(github), false);
});
test('unrelated branch pushes have different concurrency groups; PR revisions share a group', () => {
  const first = context('B_OWNER/B_REPO','push','refs/heads/dev');
  const second = context('B_OWNER/B_REPO','push','refs/heads/release/v1');
  first.event.pull_request = {}; second.event.pull_request = {};
  assert.notEqual(concurrency(first), concurrency(second));
  assert.equal(concurrency(context('A_OWNER/A_REPO','pull_request_target','refs/heads/one')),
    concurrency(context('A_OWNER/A_REPO','pull_request_target','refs/heads/two')));
});
