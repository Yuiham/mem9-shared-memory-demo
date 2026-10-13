import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { REPO_ROOT, withHarness } from './testing/harness.support.mjs';

const read = (relative) => fs.readFileSync(path.join(REPO_ROOT, relative), 'utf8');
const GUIDES = ['administrator-guide', 'participant-guide', 'routing-prompts', 'concepts', 'known-gaps', 'troubleshooting'];

test('every guide in the documentation set exists and says something', () => {
  for (const guide of GUIDES) {
    const file = path.join(REPO_ROOT, 'docs', `${guide}.md`);
    assert.ok(fs.existsSync(file), `docs/${guide}.md exists`);
    assert.ok(fs.readFileSync(file, 'utf8').length > 500, `docs/${guide}.md is not a stub`);
  }
});

test('the README links to every guide', () => {
  const readme = read('README.md');
  for (const guide of GUIDES) assert.ok(readme.includes(`](docs/${guide}.md`), `README links to docs/${guide}.md`);
});

// GitHub's rule for the anchor of a heading.
const slug = (heading) => heading.toLowerCase().replace(/[`*_]/g, '').replace(/[^\p{L}\p{N} -]/gu, '').trim().replace(/ /g, '-');

test('links between the documents point at files and headings that exist', () => {
  const documents = ['README.md', ...GUIDES.map((guide) => `docs/${guide}.md`)];
  for (const document of documents) {
    const text = read(document);
    for (const [, target] of text.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
      if (/^[a-z]+:/i.test(target)) continue;
      const [file, anchor] = target.split('#');
      const resolved = file === '' ? document : path.posix.normalize(path.posix.join(path.posix.dirname(document), file));
      assert.ok(fs.existsSync(path.join(REPO_ROOT, resolved)), `${document} links to ${target}, which does not exist`);
      if (anchor) {
        const headings = [...read(resolved).matchAll(/^#{1,6}\s+(.+)$/gm)].map((match) => slug(match[1]));
        assert.ok(headings.includes(anchor), `${document} links to #${anchor}, which is not a heading in ${resolved}`);
      }
    }
  }
});

test('the Administrator guide has a section for every command', async (t) => {
  const h = await withHarness(t, { fake: false });
  const overview = await h.admin([]);
  const commands = [...overview.stdout.matchAll(/^ {2}(\S+)\s{2,}/gm)].map((match) => match[1]);
  assert.ok(commands.length >= 9, 'the overview lists the commands');
  const guide = read('docs/administrator-guide.md');
  for (const command of commands) assert.match(guide, new RegExp(`^### \`${command}[ \`]`, 'm'), `the guide documents ${command}`);
});

test('the documentation is written for people: no unfinished markers', () => {
  for (const document of ['README.md', ...GUIDES.map((guide) => `docs/${guide}.md`)]) {
    assert.doesNotMatch(read(document), /\b(TODO|FIXME|TBD|XXX)\b/, document);
  }
});

// ---- Hygiene ------------------------------------------------------------------------

const SKIPPED = new Set(['.git', '.tmp', '.env', 'state', 'out', 'node_modules', '.DS_Store']);

function repositoryFiles(dir = REPO_ROOT, prefix = '') {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (SKIPPED.has(entry.name)) return [];
    const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    return entry.isDirectory() ? repositoryFiles(path.join(dir, entry.name), relative) : [relative];
  });
}

test('no file in the repository holds a real address, a home-directory path or a key', () => {
  const files = repositoryFiles();
  assert.ok(files.length > 40, 'the scan found the repository');
  for (const file of files) {
    const text = read(file);
    assert.doesNotMatch(text, /amazonaws\.com|\.elb\./, `${file} names a real host`);
    assert.doesNotMatch(text, /\/(?:Users|home)\/[A-Za-z0-9._-]+\//, `${file} holds an absolute home-directory path`);
    if (!file.endsWith('.test.mjs') && !file.includes('.support.')) {
      assert.doesNotMatch(text, /\bchain_[0-9a-f]{20,}/, `${file} holds a chain key`);
      assert.doesNotMatch(text, /\bwhsec_[A-Za-z0-9_-]{20,}/, `${file} holds a signing secret`);
      assert.doesNotMatch(text, /\b[0-9a-f]{32}\b/, `${file} holds a key-shaped value`);
    }
  }
});

test('the committed example environment file holds a placeholder, not an address', () => {
  assert.match(read('.env.example'), /SHAREDMEM_API_URL=https:\/\/mem9\.example\.com\s*$/m);
});
