import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { releaseVersion } from '../release-diff.mjs';

test('configured release automation requires identity, branch, ownership and semantic version-only contents', () => {
  const cwd = mkdtempSync(resolve(process.env.ONEPIPELINE_NODE_SCRATCH_DIR ?? tmpdir(), 'release-classifier-'));
  const root = resolve(import.meta.dirname, '../..');
  const tooling = resolve(cwd, 'tooling'); mkdirSync(tooling);
  try {
    for (const file of ['macos-policy.mjs', 'release-diff.mjs', 'options.mjs', 'validation.mjs']) cpSync(resolve(root, '.github', file), resolve(tooling, file));
    symlinkSync(resolve(root, 'node_modules'), resolve(tooling, 'node_modules'));
    writeFileSync(resolve(tooling, 'package.json'), '{"type":"module"}');
    writeFileSync(resolve(tooling, 'release-pr-policy.json'), JSON.stringify({ automation: [{ login: 'release-bot', branch: 'release/version' }] }));
    const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    git('init', '-q'); git('config', 'user.name', 'Classifier test'); git('config', 'user.email', 'test@example.invalid');
    const files = {
      'package.json': JSON.stringify({ version: '0.1.0', dependencies: { dependency: '1.0.0' } }),
      'Cargo.toml': '[workspace.package]\nversion = "0.1.0"\nlicense = "MIT"\n',
      'Cargo.lock': 'version = 4\n[[package]]\nname = "oneharness-ui"\nversion = "0.1.0"\n[[package]]\nname = "dependency"\nversion = "1.0.0"\nsource = "registry"\n',
      'bun.lock': '{"workspaces":{"":{"version":"0.1.0","dependencies":{"dependency":"1.0.0"}}},"packages":{"dependency":["dependency@1.0.0"]},}',
      'CHANGELOG.md': '# History\n',
    };
    for (const [path, content] of Object.entries(files)) writeFileSync(resolve(cwd, path), content);
    git('add', ...Object.keys(files)); git('commit', '-qm', 'ci: base'); const base = git('rev-parse', 'HEAD');
    const payload = { event_name: 'pull_request', repository: { full_name: 'owner/repo' }, pull_request: { title: 'chore(release): version', user: { login: 'release-bot' }, head: { ref: 'release/version', repo: { full_name: 'owner/repo' } } } };
    const classify = (event = payload, from = base) => {
      writeFileSync(resolve(cwd, 'event.json'), JSON.stringify(event));
      return JSON.parse(execFileSync(process.execPath, [resolve(tooling, 'macos-policy.mjs'), 'classify', '--event', resolve(cwd, 'event.json'), '--base', from, '--head', 'HEAD'], { cwd, encoding: 'utf8', env: { ...process.env, GITHUB_EVENT_NAME: event.event_name } }));
    };
    for (const [path, content] of Object.entries(files)) writeFileSync(resolve(cwd, path), content.replaceAll('0.1.0', '0.2.0'));
    writeFileSync(resolve(cwd, 'CHANGELOG.md'), '# History\n\n## 0.2.0\nVersion update\n');
    git('add', ...Object.keys(files)); git('commit', '-qm', 'chore: version');
    assert.deepEqual(classify(), { isReleaseOnly: true, macosRequired: false, reason: 'PR diff: version-only; configured release automation authorizes omission' });
    for (const event of [
      { ...payload, pull_request: { ...payload.pull_request, user: { login: 'attacker' } } },
      { ...payload, pull_request: { ...payload.pull_request, head: { ...payload.pull_request.head, ref: 'feature' } } },
      { ...payload, pull_request: { ...payload.pull_request, head: { ...payload.pull_request.head, repo: { full_name: 'fork/repo' } } } },
      {},
    ]) assert.equal(classify(event).macosRequired, true);
    assert.equal(classify(payload, 'missing-ref').macosRequired, true);
    const versionHead = git('rev-parse', 'HEAD');
    for (const [path, content] of [
      ['package.json', JSON.stringify({ version: '0.2.0', dependencies: { dependency: '2.0.0' } })],
      ['Cargo.toml', '[workspace.package]\nversion = "0.2.0"\nlicense = "GPL"\n'],
      ['Cargo.lock', files['Cargo.lock'].replace('1.0.0', '2.0.0')],
      ['bun.lock', files['bun.lock'].replaceAll('1.0.0', '2.0.0')],
      ['source.ts', 'export const value = 1;\n'],
      ['package.json', '{malformed'],
      ['bun.lock', '{workspaces: {"": {version: "0.2.0", dependencies: {dependency: "1.0.0"}}}, packages: {dependency: ["dependency@1.0.0"]}}'],
    ]) {
      git('checkout', '-q', versionHead); writeFileSync(resolve(cwd, path), content); git('add', path); git('commit', '-qm', 'ci: mixed content');
      assert.equal(classify().macosRequired, true, path);
    }
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});


test('classifier grammar and semantic locations reconcile with the production version writer', () => {
  const root = resolve(import.meta.dirname, '../..');
  const writer = readFileSync(resolve(root, 'scripts/set-version.mjs'), 'utf8');
  const grammar = writer.match(/const semver = \/(.*)\/;/);
  assert.ok(grammar, 'Resolve the production version grammar declaration');
  assert.equal(releaseVersion.source, new RegExp(grammar[1]).source);
  const declaration = writer.match(/const manifests = \[([\s\S]*?)\]\.map/);
  assert.ok(declaration, 'Resolve the production version manifest inventory');
  const paths = [...declaration[1].matchAll(/"([^"\n]+)"/g)].map(match => match[1]);
  assert.ok(paths.length);
  const cwd = mkdtempSync(resolve(process.env.ONEPIPELINE_NODE_SCRATCH_DIR ?? tmpdir(), 'writer-classifier-'));
  try {
    const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    git('init', '-q'); git('config', 'user.name', 'Writer contract'); git('config', 'user.email', 'test@example.invalid');
    for (const path of [...paths, 'Cargo.toml', 'Cargo.lock', 'bun.lock']) {
      mkdirSync(resolve(cwd, path, '..'), { recursive: true });
      writeFileSync(resolve(cwd, path), readFileSync(resolve(root, path)));
    }
    git('add', '.'); git('commit', '-qm', 'ci: real versioned contents'); const base = git('rev-parse', 'HEAD');
    const event = resolve(cwd, 'event.json'); writeFileSync(event, '{"event_name":"pull_request"}');
    const classify = () => JSON.parse(execFileSync(process.execPath, [resolve(root, '.github/macos-policy.mjs'), 'classify', '--event', event, '--base', base, '--head', 'HEAD'], { cwd, encoding: 'utf8', env: { ...process.env, GITHUB_EVENT_NAME: 'pull_request' } }));
    for (const path of paths) {
      const document = JSON.parse(readFileSync(resolve(cwd, path), 'utf8')); document.version = '0.2.0';
      writeFileSync(resolve(cwd, path), JSON.stringify(document));
    }
    const cargoGrammar = writer.match(/const cargoVersion = \/(.*)\/;/);
    assert.ok(cargoGrammar, 'Resolve the production Cargo version declaration');
    const cargoPath = resolve(cwd, 'Cargo.toml');
    writeFileSync(cargoPath, readFileSync(cargoPath, 'utf8').replace(new RegExp(cargoGrammar[1]), '$10.2.0'));
    const lockPath = resolve(cwd, 'Cargo.lock');
    const lock = readFileSync(lockPath, 'utf8');
    assert.match(lock, /name = "oneharness-ui"\nversion = "0\.1\.0"/);
    writeFileSync(lockPath, lock.replace(/(name = "oneharness-ui"\nversion = ")[^"]+/, '$10.2.0'));
    git('add', ...paths, 'Cargo.toml', 'Cargo.lock'); git('commit', '-qm', 'chore: writer version fields');
    assert.match(classify().reason, /PR diff: version-only;/);
    const versionHead = git('rev-parse', 'HEAD');
    for (const path of paths) {
      git('checkout', '-q', versionHead);
      const document = JSON.parse(readFileSync(resolve(cwd, path), 'utf8')); document.nonVersionChange = true;
      writeFileSync(resolve(cwd, path), JSON.stringify(document)); git('add', path); git('commit', '-qm', 'ci: mixed manifest');
      assert.match(classify().reason, /PR diff: source-or-dependency;/, path);
    }
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
