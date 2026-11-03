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
  for (const command of commands) {
    assert.match(guide, new RegExp(`^### \`${command}[ \`]`, 'm'), `the guide documents ${command}`);
    assert.match(guide, new RegExp(`^\\| \`${command}[ \`]`, 'm'), `the overview table has a row for ${command}`);
  }
});

test('the Participant guide stands alone inside a Kit: it links to no other file', () => {
  const guide = read('docs/participant-guide.md');
  for (const [, target] of guide.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
    assert.match(target, /^(https?:\/\/|#)/, `the guide links to ${target}, which does not exist inside a Kit`);
  }
});

// Codex skips a plugin hook until the person trusts it, and says nothing in the chat
// (observed with the real Codex 0.162.1), so every place a person looks must say so.
test('the documents that a person with a silent Codex reads explain the hook review', () => {
  const guide = read('docs/participant-guide.md');
  assert.match(guide, /^## The first time you start Codex$/m);
  for (const phrase of ['Trust and continue', 'Hooks need review', 'Trust all and continue', '`/hooks`']) {
    assert.ok(guide.includes(phrase), `the Participant guide names ${phrase}`);
  }
  const troubleshooting = read('docs/troubleshooting.md');
  assert.match(troubleshooting, /Hooks need review/, 'troubleshooting names the question');
  assert.match(troubleshooting, /`\/hooks`/, 'troubleshooting names the way to trust later');
  assert.match(read('docs/known-gaps.md'), /Hooks need review/, 'the known gaps record the limit');
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
      assert.doesNotMatch(text, /\bmem9_admin_[A-Za-z0-9]{20,}/, `${file} holds an Admin API key`);
      assert.doesNotMatch(text, /\bwhsec_[A-Za-z0-9_-]{20,}/, `${file} holds a signing secret`);
      assert.doesNotMatch(text, /\b[0-9a-f]{32}\b/, `${file} holds a key-shaped value`);
    }
  }
});

// The hosted service's public addresses may be named, as examples. Nothing else under mem9.ai
// may, and a plain-HTTP address is only ever this computer or a made-up example.
const PUBLIC_HOSTS = new Set(['api.mem9.ai', 'mem9.ai', 'console-api.mem9.ai']);
const THIS_COMPUTER = new Set(['127.0.0.1', 'localhost', '[::1]', 'fake.local']);
const MADE_UP = (hostname) => hostname === 'example.com' || hostname.endsWith('.example.com') || hostname.endsWith('.invalid');

test('addresses in the repository: plain HTTP only for this computer or a made-up host, and only the three public mem9.ai hosts', () => {
  for (const file of repositoryFiles().filter((name) => name !== 'LICENSE')) {
    for (const [address] of read(file).matchAll(/\bhttps?:\/\/(?=[A-Za-z0-9[])[A-Za-z0-9.[\]:@-]+/g)) {
      const { protocol, hostname } = new URL(address);
      if (protocol === 'http:') {
        assert.ok(THIS_COMPUTER.has(hostname) || MADE_UP(hostname), `${file} names the plain-HTTP address ${address}`);
      }
      if (hostname === 'mem9.ai' || hostname.endsWith('.mem9.ai')) {
        assert.ok(PUBLIC_HOSTS.has(hostname), `${file} names the host ${hostname}, which is not one of the three public ones`);
      }
    }
  }
});

test('the committed example environment file sets only a placeholder address; the hosted service and the create secret appear in comments', () => {
  const text = read('.env.example');
  assert.match(text, /^SHAREDMEM_API_URL=https:\/\/mem9\.example\.com\s*$/m);
  const live = text.split('\n').filter((line) => line.trim() !== '' && !line.startsWith('#'));
  assert.deepEqual(live, ['SHAREDMEM_API_URL=https://mem9.example.com'], 'no other setting is live');
  for (const name of ['SHAREDMEM_ADMIN_API_URL', 'SHAREDMEM_ADMIN_API_KEY', 'SHAREDMEM_PROJECT_ID', 'SHAREDMEM_CREATE_SECRET']) {
    assert.match(text, new RegExp(`^# ${name}=`, 'm'), `${name} is shown as a comment`);
  }
});
