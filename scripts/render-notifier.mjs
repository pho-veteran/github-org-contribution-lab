import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateConfig } from '../templates/controller/scripts/bridge-config.mjs';

export function renderNotifier(template, registry, id) {
  validateConfig(registry);
  const pair = registry.pairs.find(p => p.id === id);
  if (!pair) throw new Error('Unknown notifier pair');
  if ((pair.sourceBranch ?? 'main') !== (pair.targetBranch ?? 'main')) {
    throw new Error('Shared notifier requires matching source/target contribution branches');
  }
  const [aOwner, aRepo] = pair.source.split('/'), [bOwner, bRepo] = pair.target.split('/');
  if (!registry.controllerRepo.startsWith(bOwner + '/')) throw new Error('Controller must be owned by B');
  const replacements = {
    A_OWNER: aOwner, A_REPO: aRepo, B_OWNER: bOwner, B_REPO: bRepo,
    CONTROLLER_REPO: registry.controllerRepo.split('/')[1], CONTRIBUTION_BRANCH: pair.sourceBranch ?? 'main',
  };
  return template.replace(/\r\n/g, '\n').replace(/\b(A_OWNER|A_REPO|B_OWNER|B_REPO|CONTROLLER_REPO|CONTRIBUTION_BRANCH)\b/g, key => replacements[key]);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [, , configPath, id] = process.argv;
  const template = readFileSync(new URL('../templates/notifier/.github/workflows/notify-controller.yml', import.meta.url), 'utf8');
  process.stdout.write(renderNotifier(template, JSON.parse(readFileSync(configPath, 'utf8')), id));
}
