// The Approval Example in a test: a demo initialized for Approval with the placeholder
// webhook registered and, by default, a receiver running on any free port. The fake
// server hands its queued deliveries to that receiver, signed like the real server signs
// them. This file also builds deliveries by hand, with its own copy of the signing
// scheme, so tests do not depend on the code they check.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { SHIPPED_ROUTING, withHarness } from './harness.support.mjs';

export const PLACEHOLDER = 'https://receiver.invalid/';
export const ANNOUNCEMENT = 'Starting Monday, all production deploys require two reviewers.';

const READY = /Receiver listening on (http:\/\/127\.0\.0\.1:\d+)/;

export async function waitFor(check, { timeoutMs = 8000, what = 'the condition' } = {}) {
  const started = Date.now();
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() - started > timeoutMs) assert.fail(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

export async function approvalDemo(t, { webhook = PLACEHOLDER, receiver = true } = {}) {
  const h = await withHarness(t);
  h.fake.setRouting(SHIPPED_ROUTING);
  const init = await h.admin(['init', '--yes', '--example', 'approval']);
  assert.equal(init.code, 0, init.output);
  if (webhook) {
    const set = await h.admin(['webhook', 'set', '--url', webhook]);
    assert.equal(set.code, 0, set.output);
  }
  const demo = {
    h,
    process: null,
    url: null,
    runtimeFile: path.join(h.workdir, 'state', 'receiver.json'),
    candidatesFile: path.join(h.workdir, 'state', 'candidates.json'),
    async startReceiver(args = []) {
      demo.process = h.startAdmin(['receiver', 'serve', '--port', '0', ...args], { readyPattern: READY });
      await demo.process.ready;
      demo.url = READY.exec(demo.process.stdout())[1];
      h.fake.setReceiver(demo.url);
      return demo;
    },
    async stopReceiver() {
      await demo.process?.stop();
      demo.process = null;
    },
    candidates() {
      return fs.existsSync(demo.candidatesFile) ? JSON.parse(fs.readFileSync(demo.candidatesFile, 'utf8')) : { candidates: [], handledEvents: [] };
    },
    async waitForCandidates(count) {
      return waitFor(() => (demo.candidates().candidates.length >= count ? demo.candidates().candidates : null), { what: `${count} Candidate(s)` });
    },
  };
  if (receiver) await demo.startReceiver();
  return demo;
}

// A delivery as the server sends it, built from the state. Every part can be overridden.
export function buildDelivery(h, leader, {
  text = ANNOUNCEMENT,
  agentId = leader,
  type = 'space_chain.fact_routed',
  webhookOnly = true,
  eventId = `evt_${crypto.randomBytes(8).toString('hex')}`,
  bodyEventId,
  timestamp = Math.floor(Date.now() / 1000),
  secret,
  chainId,
  headers = {},
  data,
} = {}) {
  const state = h.readState();
  const envelope = {
    id: bodyEventId ?? eventId,
    type,
    api_version: 'v1',
    created_at: new Date().toISOString(),
    scope: { type: 'chain', chain_id: chainId ?? state.chains[leader].id },
    data: data ?? (type === 'webhook.test'
      ? { message: 'mem9 webhook test event' }
      : { route_id: 'route_test', chain_id: chainId ?? state.chains[leader].id, webhook_only: webhookOnly, source_facts: [{ text }], agent_id: agentId, session_id: 'session-test' }),
  };
  const rawBody = JSON.stringify(envelope);
  const key = secret ?? state.webhooks[leader].secret;
  const signature = `v1=${crypto.createHmac('sha256', key).update(`${timestamp}.${eventId}.${rawBody}`).digest('hex')}`;
  return {
    eventId,
    rawBody,
    headers: {
      'Content-Type': 'application/json',
      'X-Mem9-Event-Id': eventId,
      'X-Mem9-Event-Type': type,
      'X-Mem9-Timestamp': String(timestamp),
      'X-Mem9-Signature': signature,
      ...headers,
    },
  };
}

export async function post(url, delivery, { path: urlPath = '/' } = {}) {
  const response = await fetch(`${url}${urlPath}`, { method: 'POST', headers: delivery.headers, body: delivery.rawBody });
  return { status: response.status, json: await response.json().catch(() => null) };
}
