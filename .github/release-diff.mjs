import { execFileSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import { object } from './validation.mjs';

export const releaseVersion = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
/** @param {Record<string, unknown>} document */
function removeVersion(document) {
  if (typeof document.version !== 'string' || !releaseVersion.test(document.version)) throw new Error('Invalid version');
  delete document.version;
}
/** @param {string} content */
function toml(content) {
  return object(JSON.parse(execFileSync('bun', ['-e', 'console.log(JSON.stringify(Bun.TOML.parse(await Bun.stdin.text())))'], { input: content, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })), 'TOML');
}
/** @param {string} path @param {string} content */
function nonVersionFields(path, content) {
  if (path.endsWith('/package.json') || path === 'package.json' || path === 'apps/desktop-shell/tauri.conf.json') {
    const document = object(JSON.parse(content), path); removeVersion(document); return document;
  }
  if (path === 'Cargo.toml') {
    const document = toml(content); removeVersion(object(object(document.workspace, 'workspace').package, 'workspace.package')); return document;
  }
  if (path === 'Cargo.lock') {
    const document = toml(content);
    if (!Array.isArray(document.package)) throw new Error('Invalid Cargo packages');
    for (const entry of document.package) {
      const pkg = object(entry, 'Cargo package');
      // Only the repository's local package has a release-controlled version.
      if (pkg.name === 'oneharness-ui' && pkg.source === undefined) removeVersion(pkg);
    }
    return document;
  }
  if (path === 'bun.lock') {
    // Bun emits JSON with trailing commas. Preserve quoted text while removing
    // only commas immediately preceding a closing object/array delimiter.
    const json = content.replace(/"(?:\\.|[^"\\])*"|,\s*(?=[}\]])/g, token => token.startsWith('"') ? token : '');
    const document = object(JSON.parse(json), path);
    for (const entry of Object.values(object(document.workspaces, 'workspaces'))) {
      const workspace = object(entry, 'workspace');
      if (workspace.version !== undefined) removeVersion(workspace);
    }
    return document;
  }
  throw new Error('Source content');
}
/** @param {string} base @param {string} head */
export function diffClass(base, head) {
  try {
    /** @param {string[]} args */
    const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    // Resolve refs before using them in commands; a hostile ref cannot become an option.
    /** @param {string} ref */
    const resolve = ref => git('rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`).trim();
    const from = resolve(base); const to = resolve(head);
    const mergeBase = git('merge-base', from, to).trim();
    const paths = git('diff', '--name-only', '-z', mergeBase, to).split('\0').filter(Boolean);
    if (!paths.length) return 'empty';
    for (const path of paths) {
      const before = git('show', `${mergeBase}:${path}`); const after = git('show', `${to}:${path}`);
      if (path === 'CHANGELOG.md') continue;
      if (!isDeepStrictEqual(nonVersionFields(path, before), nonVersionFields(path, after))) return 'source-or-dependency';
    }
    return 'version-only';
  } catch {
    return 'unknown-or-source';
  }
}
