// A fake mem9 server for offline tests. It follows the request and response contracts
// in the server contract notes. Everything lives in memory; routing is scripted so a
// test decides which Spaces a sentence reaches. It never contacts a registered
// webhook address: tests flush queued deliveries to a receiver address they supply.
import crypto from 'node:crypto';
import http from 'node:http';
import net from 'node:net';

const REGISTRABLE_EVENTS = ['memory.added', 'memory.deleted', 'space_chain.fact_routed'];
const MEMORY_TYPES = ['pinned', 'insight', 'session'];
const LONG_TERM = ['pinned', 'insight'];

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const hex = (bytes = 16) => crypto.randomBytes(bytes).toString('hex');

function isPrivateAddress(host) {
  const bare = host.replace(/^\[|\]$/g, '');
  const kind = net.isIP(bare);
  if (kind === 4) {
    const [a, b] = bare.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  if (kind === 6) {
    const lower = bare.toLowerCase();
    return lower === '::1' || lower === '::' || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80');
  }
  return false;
}

export class FakeMem9 {
  constructor({ allowHttpLocalhost = false, asyncDelayMs = 20 } = {}) {
    this.options = { allowHttpLocalhost, asyncDelayMs };
    this.spaces = new Map();
    this.chains = new Map();
    this.keys = new Map();
    this.requests = [];
    this.deliveries = [];
    this.routing = { extract: () => true, route: () => [] };
    this.failTargets = new Set();
    this.receiverUrl = null;
    this.forceDeliveryFailure = false;
    this.injected = null;
    this.faults = [];
    this.creatingCalls = 0;
    this.sequence = 0;
    this.timers = new Set();
    this.server = null;
  }

  // ---- lifecycle ---------------------------------------------------------------
  async start() {
    this.server = http.createServer((request, response) => {
      this.#handle(request, response).catch((error) => {
        if (!response.headersSent) this.#send(response, 500, { error: `fake server failure: ${error.message}` });
      });
    });
    await new Promise((resolve) => this.server.listen(0, '127.0.0.1', resolve));
    return this;
  }

  get url() {
    return `http://127.0.0.1:${this.server.address().port}`;
  }

  async stop() {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    if (!this.server) return;
    this.server.closeAllConnections?.();
    await new Promise((resolve) => this.server.close(resolve));
    this.server = null;
  }

  // ---- test controls -----------------------------------------------------------
  // rules: [{ match: RegExp | string, targets: [external space identifiers] }]; drop: RegExp
  // for sentences the server would treat as transient and not store.
  setRouting({ rules = [], drop = null } = {}) {
    const matches = (rule, text) => (rule.match instanceof RegExp ? rule.match.test(text) : text.toLowerCase().includes(String(rule.match).toLowerCase()));
    this.routing = {
      extract: (text) => !(drop && drop.test(text)),
      route: (text) => rules.filter((rule) => matches(rule, text)).flatMap((rule) => rule.targets),
    };
  }

  failRoutingTo(externalSpaceId) {
    this.failTargets.add(externalSpaceId);
  }

  injectFailure({ after }) {
    this.injected = { after };
  }

  clearFailure() {
    this.injected = null;
  }

  // Cuts the connection of the next `count` requests that match a method and a path
  // pattern, without an answer, like a load balancer or a flaky network does.
  // `when: 'before'` cuts before the request is processed; `when: 'after'` processes it
  // and loses the answer (the caller cannot tell whether it took effect).
  dropConnections({ method, path, count = 1, when = 'before' }) {
    this.faults.push({ method, path, count, when });
  }

  failNextDelivery() {
    this.forceDeliveryFailure = true;
  }

  setReceiver(url) {
    this.receiverUrl = url;
  }

  spaceIds() {
    return [...this.spaces.keys()];
  }

  chainByName(name) {
    return [...this.chains.values()].find((chain) => chain.name === name);
  }

  memoriesIn(spaceId, { type, includeDeleted = false } = {}) {
    const space = this.spaces.get(spaceId);
    if (!space) return [];
    return space.memories
      .filter((memory) => (includeDeleted || memory.state !== 'deleted') && (!type || memory.memory_type === type))
      .map((memory) => this.#publicMemory(memory));
  }

  requestsTo(method, pathPrefix) {
    return this.requests.filter((request) => request.method === method && request.path.startsWith(pathPrefix));
  }

  // Delivers every pending queued delivery to the receiver, signed like the real server.
  async flushDeliveries(receiverUrl = this.receiverUrl) {
    if (!receiverUrl) throw new Error('flushDeliveries needs a receiver address');
    for (const delivery of this.deliveries) {
      if (delivery.record.status === 'pending') await this.#attempt(delivery, receiverUrl);
    }
  }

  // ---- request handling --------------------------------------------------------
  async #handle(request, response) {
    const url = new URL(request.url, 'http://fake.local');
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString('utf8');
    let body = null;
    if (raw) {
      try {
        body = JSON.parse(raw);
      } catch {
        return this.#send(response, 400, { error: 'body: invalid JSON' });
      }
    }
    const key = request.headers['x-api-key'];
    const header = request.headers['x-mnemo-agent-id'] ?? '';
    this.requests.push({ method: request.method, path: url.pathname, query: Object.fromEntries(url.searchParams), body, key, header });
    const fault = this.faults.find((entry) => entry.count > 0 && entry.method === request.method && (entry.path instanceof RegExp ? entry.path.test(url.pathname) : entry.path === url.pathname));
    if (fault) fault.count -= 1;
    if (fault?.when === 'before') return request.socket.destroy();
    try {
      const result = await this.#route(request.method, url, body, key, header);
      if (fault) return request.socket.destroy();
      this.#send(response, result.status, result.body);
    } catch (error) {
      if (error instanceof HttpError) this.#send(response, error.status, { error: error.message });
      else throw error;
    }
  }

  #send(response, status, body) {
    if (status === 204) {
      response.writeHead(204).end();
      return;
    }
    response.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
  }

  async #route(method, url, body, key, header) {
    const path = url.pathname;
    let match;
    if (method === 'POST' && path === '/__test__/flush') {
      await this.flushDeliveries(body?.receiver_url);
      return { status: 200, body: { flushed: true } };
    }
    if (method === 'POST' && path === '/v1alpha1/mem9s') return this.#provision();
    if (method === 'GET' && path === '/v1alpha2/status') return this.#status(key);
    if (method === 'POST' && path === '/v1alpha2/space-chains') return this.#createChain(body);
    if (method === 'GET' && path === '/v1alpha2/space-chains/by-key') {
      const chain = this.#chainFromKey(key);
      return { status: 200, body: this.#publicChain(chain) };
    }
    if ((match = path.match(/^\/v1alpha2\/space-chains\/([^/]+)(\/.*)?$/))) {
      return this.#chainRoute(method, match[1], match[2] ?? '', body, key, url);
    }
    if (path === '/v1alpha2/mem9s/memories' || path.startsWith('/v1alpha2/mem9s/memories/')) {
      return this.#memoryRoute(method, path, url, body, key, header);
    }
    throw new HttpError(404, 'not found');
  }

  #countCreating() {
    this.creatingCalls += 1;
    if (this.injected && this.creatingCalls > this.injected.after) throw new HttpError(500, 'injected failure');
  }

  #provision() {
    this.#countCreating();
    const id = hex(16);
    this.spaces.set(id, { id, memories: [] });
    return { status: 201, body: { id } };
  }

  #status(key) {
    if (!key) throw new HttpError(401, 'missing or malformed X-API-Key');
    if (key.startsWith('chain_')) {
      const chainId = this.keys.get(key);
      if (!chainId) throw new HttpError(404, 'key not found');
      return { status: 200, body: { status: this.chains.get(chainId).deleted ? 'inactive' : 'active' } };
    }
    if (!this.spaces.has(key)) throw new HttpError(404, 'key not found');
    return { status: 200, body: { status: 'active' } };
  }

  #createChain(body) {
    this.#countCreating();
    if (!body || typeof body.name !== 'string' || body.name === '') throw new HttpError(400, 'name: required');
    const id = crypto.randomUUID();
    const apiKey = `chain_${hex(20)}`;
    const chain = { id, name: body.name, description: body.description ?? '', apiKey, deleted: false, nodes: [], webhooks: new Map(), createdAt: this.#timestamp() };
    this.chains.set(id, chain);
    this.keys.set(apiKey, id);
    return {
      status: 201,
      body: { chain: this.#publicChain(chain), chain_api_key: apiKey, binding_id: crypto.randomUUID(), key_prefix: apiKey.slice(0, 12), key_preview: `${apiKey.slice(0, 12)}...${apiKey.slice(-4)}` },
    };
  }

  #chainFromKey(key) {
    if (!key || !key.startsWith('chain_')) throw new HttpError(401, 'missing or malformed X-API-Key');
    const chainId = this.keys.get(key);
    const chain = chainId && this.chains.get(chainId);
    if (!chain || chain.deleted) throw new HttpError(404, 'space chain not found');
    return chain;
  }

  #chainAuth(chainId, key) {
    const chain = this.#chainFromKey(key);
    if (chain.id !== chainId) throw new HttpError(404, 'space chain not found');
    return chain;
  }

  #publicChain(chain) {
    return { id: chain.id, name: chain.name, description: chain.description, status: 'active', created_at: chain.createdAt, nodes: chain.nodes.map((node) => this.#nodeView(node)) };
  }

  // What the server shows of a node. The stored node keeps tenant_id, because routing
  // needs it, but a read never returns the Space key. Optional strings the node has no
  // value for are absent, as the real fields are omitempty.
  #nodeView(node) {
    const view = { ...node };
    delete view.tenant_id;
    for (const field of ['external_space_id', 'display_name', 'routing_policy_prompt']) {
      if (view[field] === '') delete view[field];
    }
    return view;
  }

  async #chainRoute(method, chainId, rest, body, key, url) {
    const chain = this.#chainAuth(chainId, key);
    let match;
    if (method === 'GET' && rest === '') return { status: 200, body: this.#publicChain(chain) };
    if (method === 'DELETE' && rest === '') {
      chain.deleted = true;
      return { status: 204, body: null };
    }
    if (rest === '/nodes') {
      if (method === 'GET') return { status: 200, body: { nodes: chain.nodes.map((node) => this.#nodeView(node)) } };
      if (method === 'PUT') return this.#setNodes(chain, body);
    }
    if ((match = rest.match(/^\/nodes\/([^/]+)\/routing-policy$/)) && method === 'PUT') return this.#setPolicy(chain, match[1], body);
    if (rest === '/webhooks') {
      if (method === 'POST') return this.#createWebhook(chain, body);
      if (method === 'GET') return { status: 200, body: { webhooks: [...chain.webhooks.values()].map((endpoint) => this.#publicEndpoint(endpoint)) } };
    }
    if ((match = rest.match(/^\/webhooks\/([^/]+)(\/test|\/rotate-secret)?$/))) {
      const endpoint = chain.webhooks.get(match[1]);
      if (!endpoint) throw new HttpError(404, 'webhook not found');
      if (method === 'PATCH' && !match[2]) return this.#patchWebhook(endpoint, body);
      if (method === 'POST' && match[2] === '/test') return this.#testWebhook(chain, endpoint);
      if (method === 'POST' && match[2] === '/rotate-secret') {
        endpoint.signingSecret = this.#newSecret();
        return { status: 200, body: { ...this.#publicEndpoint(endpoint), signing_secret: endpoint.signingSecret } };
      }
    }
    if (method === 'GET' && rest === '/webhook-deliveries') {
      let limit = Number(url.searchParams.get('limit'));
      if (!Number.isInteger(limit) || limit < 1 || limit > 200) limit = 50;
      const records = this.deliveries.filter((delivery) => delivery.chainId === chain.id).map((delivery) => ({ ...delivery.record })).reverse().slice(0, limit);
      return { status: 200, body: { deliveries: records } };
    }
    throw new HttpError(404, 'not found');
  }

  #setNodes(chain, body) {
    const nodes = body?.nodes;
    if (!Array.isArray(nodes) || nodes.length === 0) throw new HttpError(400, 'nodes: required');
    const tenants = new Set();
    const externals = new Set();
    for (const node of nodes) {
      if (!node?.tenant_id) throw new HttpError(400, 'nodes: tenant_id is required');
      if (!this.spaces.has(node.tenant_id)) throw new HttpError(400, 'nodes: tenant_id must be a Space');
      if (tenants.has(node.tenant_id)) throw new HttpError(400, 'nodes: duplicate tenant_id');
      tenants.add(node.tenant_id);
      if (node.external_space_id) {
        if (externals.has(node.external_space_id)) throw new HttpError(400, 'nodes: duplicate external_space_id');
        externals.add(node.external_space_id);
      }
    }
    const previous = chain.nodes;
    chain.nodes = nodes.map((node, position) => {
      const kept = previous.find((old) => (node.external_space_id ? old.external_space_id === node.external_space_id : old.tenant_id === node.tenant_id));
      return {
        id: `node_${hex(8)}`,
        chain_id: chain.id,
        tenant_id: node.tenant_id,
        external_space_id: node.external_space_id ?? '',
        display_name: node.display_name ?? '',
        position,
        routing_policy_enabled: position === 0 ? false : (kept?.routing_policy_enabled ?? false),
        routing_policy_prompt: position === 0 ? '' : (kept?.routing_policy_prompt ?? ''),
        routing_policy_webhook_only: position === 0 ? false : (kept?.routing_policy_webhook_only ?? false),
      };
    });
    return { status: 200, body: { nodes: chain.nodes.map((node) => this.#nodeView(node)) } };
  }

  #setPolicy(chain, nodeId, body) {
    const node = chain.nodes.find((candidate) => candidate.id === nodeId);
    if (!node) throw new HttpError(404, 'node not found');
    if (node.position === 0) throw new HttpError(400, 'node: the owner node cannot have a routing policy');
    const enabled = Boolean(body?.enabled);
    const prompt = typeof body?.prompt === 'string' ? body.prompt : '';
    if (enabled && prompt.trim() === '') throw new HttpError(400, 'prompt: required when enabled');
    if (prompt.length > 1200) throw new HttpError(400, 'prompt: must be at most 1200 characters');
    node.routing_policy_enabled = enabled;
    node.routing_policy_prompt = prompt;
    node.routing_policy_webhook_only = Boolean(body?.webhook_only);
    return { status: 200, body: this.#nodeView(node) };
  }

  // ---- memories ----------------------------------------------------------------
  #resolveKey(key) {
    if (!key) throw new HttpError(400, 'missing API key');
    if (key.startsWith('chain_')) {
      const chainId = this.keys.get(key);
      const chain = chainId && this.chains.get(chainId);
      if (!chain || chain.deleted) throw new HttpError(400, 'invalid API key');
      if (chain.nodes.length === 0) throw new HttpError(400, 'Space Chain has no nodes.');
      return { chain, spaces: chain.nodes.map((node) => this.spaces.get(node.tenant_id)), owner: this.spaces.get(chain.nodes[0].tenant_id) };
    }
    const space = this.spaces.get(key);
    if (!space) throw new HttpError(400, 'invalid API key');
    return { chain: null, spaces: [space], owner: space };
  }

  #newMemory(space, fields) {
    const stamp = this.#timestamp();
    const memory = {
      id: crypto.randomUUID(),
      content: fields.content,
      memory_type: fields.type,
      source: fields.source ?? '',
      tags: fields.tags ?? [],
      metadata: null,
      agent_id: fields.agentId ?? '',
      session_id: fields.sessionId ?? '',
      appId: '',
      state: 'active',
      version: 1,
      updated_by: fields.updatedBy ?? '',
      superseded_by: null,
      created_at: stamp,
      updated_at: stamp,
      seq: this.sequence++,
    };
    space.memories.push(memory);
    return memory;
  }

  #publicMemory(memory) {
    const { seq, ...rest } = memory;
    return rest;
  }

  #memoryRoute(method, path, url, body, key, header) {
    const context = this.#resolveKey(key);
    if (method === 'POST' && path === '/v1alpha2/mem9s/memories') return this.#write(context, body, header);
    if (method === 'GET' && path === '/v1alpha2/mem9s/memories') return this.#list(context, url);
    if (method === 'POST' && path === '/v1alpha2/mem9s/memories/batch-delete') {
      const ids = Array.isArray(body?.ids) ? body.ids : [];
      return { status: 200, body: { deleted: ids.filter((id) => this.#deleteMemory(context, id)).length } };
    }
    const match = path.match(/^\/v1alpha2\/mem9s\/memories\/([^/]+)$/);
    if (match && method === 'DELETE') {
      if (!this.#deleteMemory(context, match[1])) throw new HttpError(404, 'memory not found');
      return { status: 204, body: null };
    }
    throw new HttpError(404, 'not found');
  }

  #deleteMemory(context, id) {
    for (const space of context.spaces) {
      const memory = space.memories.find((candidate) => candidate.id === id && candidate.state !== 'deleted');
      if (memory) {
        memory.state = 'deleted';
        return true;
      }
    }
    return false;
  }

  #write(context, body, header) {
    if (!body || typeof body !== 'object') throw new HttpError(400, 'body: required');
    const hasMessages = Array.isArray(body.messages) && body.messages.length > 0;
    const hasContent = typeof body.content === 'string' && body.content.trim() !== '';
    if (hasMessages && hasContent) throw new HttpError(400, 'body: provide either content or messages, not both');
    if (hasMessages && body.memory_type) throw new HttpError(400, 'memory_type: memory_type is only allowed with content, not messages');
    if (!hasMessages && !hasContent) throw new HttpError(400, 'body: provide content or messages');
    const agentId = body.agent_id || header;
    if (hasContent) {
      if (body.memory_type !== 'pinned') throw new HttpError(400, 'memory_type: only pinned is supported by this fake');
      // Pinned writes have no separate actor: the resolved Agent ID is stored in source,
      // agent_id and updated_by, and the write lands in the owner node only.
      const memory = this.#newMemory(context.owner, { content: body.content, type: 'pinned', source: agentId, agentId, updatedBy: agentId, tags: body.tags });
      return { status: 201, body: this.#publicMemory(memory) };
    }
    const job = () => this.#ingest(context, { messages: body.messages, agentId, sessionId: body.session_id ?? '', actor: header });
    if (body.sync) {
      job();
      return { status: 200, body: { status: 'ok' } };
    }
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      job();
    }, this.options.asyncDelayMs);
    this.timers.add(timer);
    return { status: 202, body: { status: 'accepted' } };
  }

  // Message writes: a raw session row per message, an extracted insight per durable
  // sentence in the owner space, and routed copies according to the scripted rules.
  // Extracted memories carry the request header (the writing tool) as source and updated_by.
  #ingest(context, { messages, agentId, sessionId, actor }) {
    for (const message of messages) {
      if (!message || typeof message.content !== 'string') continue;
      this.#newMemory(context.owner, { content: message.content, type: 'session', source: actor, agentId, sessionId, updatedBy: actor });
      if (message.role !== 'user' || !this.routing.extract(message.content)) continue;
      this.#newMemory(context.owner, { content: message.content, type: 'insight', source: actor, agentId, sessionId, updatedBy: actor });
      if (!context.chain) continue;
      const wanted = this.routing.route(message.content);
      for (const node of context.chain.nodes) {
        const eligible = node.position > 0 && node.routing_policy_enabled && node.routing_policy_prompt !== '' && node.external_space_id !== '';
        if (!eligible || !wanted.includes(node.external_space_id) || this.failTargets.has(node.external_space_id)) continue;
        let copy = null;
        if (!node.routing_policy_webhook_only) {
          copy = this.#newMemory(this.spaces.get(node.tenant_id), { content: message.content, type: 'insight', source: actor, agentId, sessionId, updatedBy: actor });
        }
        this.#queueDelivery(context.chain, 'space_chain.fact_routed', {
          route_id: `route_${hex(6)}`,
          chain_id: context.chain.id,
          source_node_id: context.chain.nodes[0].id,
          source_external_space_id: context.chain.nodes[0].external_space_id,
          target_external_space_id: node.external_space_id,
          routing_policy_node_id: node.id,
          webhook_only: node.routing_policy_webhook_only,
          source_facts: [{ text: message.content }],
          target_memory: copy ? this.#publicMemory(copy) : null,
          agent_id: agentId,
          appId: '',
          session_id: sessionId,
        });
      }
    }
  }

  #list(context, url) {
    const query = url.searchParams;
    let limit = Number(query.get('limit'));
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) limit = 10;
    const offset = Math.max(0, Number(query.get('offset')) || 0);
    const type = query.get('memory_type');
    if (type && !MEMORY_TYPES.includes(type)) throw new HttpError(400, 'memory_type: must be one of pinned, insight, session');
    const text = query.get('q');
    const state = query.get('state') ?? 'active';
    const keep = (memory) => {
      if (state !== 'all' && memory.state !== state) return false;
      if (type && memory.memory_type !== type) return false;
      if (!type && context.chain && !text && !LONG_TERM.includes(memory.memory_type)) return false;
      if (query.get('agent_id') && memory.agent_id !== query.get('agent_id')) return false;
      if (query.get('session_id') && memory.session_id !== query.get('session_id')) return false;
      if (text && !memory.content.toLowerCase().includes(text.toLowerCase())) return false;
      return true;
    };
    const merged = [];
    context.spaces.forEach((space, index) => {
      const node = context.chain?.nodes[index];
      const rows = space.memories.filter(keep).sort((a, b) => b.seq - a.seq);
      for (const memory of rows) {
        const row = this.#publicMemory(memory);
        if (node) row.chain_source = { chain_id: context.chain.id, node_position: node.position, ...(node.external_space_id ? { external_space_id: node.external_space_id } : {}) };
        merged.push(row);
      }
    });
    return { status: 200, body: { memories: merged.slice(offset, offset + limit), total: merged.length, limit, offset } };
  }

  // ---- webhooks and deliveries -------------------------------------------------
  #newSecret() {
    return `whsec_${crypto.randomBytes(24).toString('base64url')}`;
  }

  #validateWebhookUrl(raw) {
    let parsed;
    try {
      parsed = new URL(raw);
    } catch {
      throw new HttpError(400, 'url: must be a valid URL');
    }
    const localhost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
    if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && localhost && this.options.allowHttpLocalhost)) {
      throw new HttpError(400, 'url: https is required');
    }
    if (parsed.username || parsed.password) throw new HttpError(400, 'url: userinfo is not allowed');
    if (isPrivateAddress(parsed.hostname)) throw new HttpError(400, 'url: private IP destinations are not allowed');
  }

  #validateEvents(events) {
    if (!Array.isArray(events) || events.length === 0) throw new HttpError(400, 'events: required');
    for (const event of events) {
      if (!REGISTRABLE_EVENTS.includes(event)) throw new HttpError(400, `events: unsupported event: ${event}`);
    }
    return [...new Set(events)];
  }

  #publicEndpoint(endpoint) {
    const { signingSecret, ...rest } = endpoint;
    return rest;
  }

  #createWebhook(chain, body) {
    if (!body || typeof body.name !== 'string' || body.name === '') throw new HttpError(400, 'name: required');
    if (body.name.length > 255) throw new HttpError(400, 'name: must be at most 255 characters');
    if (typeof body.url !== 'string') throw new HttpError(400, 'url: required');
    this.#validateWebhookUrl(body.url);
    const events = this.#validateEvents(body.events);
    const stamp = this.#timestamp();
    const endpoint = {
      id: `wh_${hex(8)}`, scope_type: 'chain', scope_id: chain.id, name: body.name, url: body.url,
      enabled: body.enabled ?? true, events, created_at: stamp, updated_at: stamp, signingSecret: this.#newSecret(),
    };
    chain.webhooks.set(endpoint.id, endpoint);
    return { status: 201, body: { ...this.#publicEndpoint(endpoint), signing_secret: endpoint.signingSecret } };
  }

  #patchWebhook(endpoint, body) {
    if (body?.url !== undefined) {
      this.#validateWebhookUrl(body.url);
      endpoint.url = body.url;
    }
    if (body?.events !== undefined) endpoint.events = this.#validateEvents(body.events);
    if (body?.name !== undefined) endpoint.name = body.name;
    if (body?.enabled !== undefined) endpoint.enabled = Boolean(body.enabled);
    endpoint.updated_at = this.#timestamp();
    return { status: 200, body: this.#publicEndpoint(endpoint) };
  }

  #testWebhook(chain, endpoint) {
    const delivery = this.#enqueue(chain, endpoint, 'webhook.test', { message: 'mem9 webhook test event' });
    if (this.receiverUrl) setImmediate(() => this.flushDeliveries().catch(() => {}));
    return { status: 202, body: { delivery: { ...delivery.record } } };
  }

  #queueDelivery(chain, type, data) {
    for (const endpoint of chain.webhooks.values()) {
      if (endpoint.enabled && endpoint.events.includes(type)) this.#enqueue(chain, endpoint, type, data);
    }
    if (this.receiverUrl) setImmediate(() => this.flushDeliveries().catch(() => {}));
  }

  #enqueue(chain, endpoint, type, data) {
    const stamp = this.#timestamp();
    const eventId = `evt_${hex(10)}`;
    const delivery = {
      chainId: chain.id,
      endpoint,
      envelope: { id: eventId, type, api_version: 'v1', created_at: stamp, scope: { type: 'chain', chain_id: chain.id }, data },
      record: {
        id: `dlv_${hex(8)}`, event_id: eventId, endpoint_id: endpoint.id, event_type: type, scope_type: 'chain', scope_id: chain.id,
        status: 'pending', attempt_count: 0, next_attempt_at: stamp, last_http_status: null, last_error: '', delivered_at: null, created_at: stamp, updated_at: stamp,
      },
    };
    this.deliveries.push(delivery);
    return delivery;
  }

  async #attempt(delivery, receiverUrl) {
    const { record, envelope, endpoint } = delivery;
    record.attempt_count += 1;
    record.updated_at = this.#timestamp();
    if (this.forceDeliveryFailure) {
      this.forceDeliveryFailure = false;
      record.last_error = 'forced failure';
      if (record.attempt_count >= 8) record.status = 'failed';
      return;
    }
    const rawBody = JSON.stringify(envelope);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = `v1=${crypto.createHmac('sha256', endpoint.signingSecret).update(`${timestamp}.${envelope.id}.${rawBody}`).digest('hex')}`;
    try {
      const response = await fetch(receiverUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Mem9-Event-Id': envelope.id, 'X-Mem9-Event-Type': envelope.type, 'X-Mem9-Timestamp': timestamp, 'X-Mem9-Signature': signature },
        body: rawBody,
        signal: AbortSignal.timeout(10000),
      });
      record.last_http_status = response.status;
      if (response.status >= 200 && response.status < 300) {
        record.status = 'delivered';
        record.last_error = '';
        record.delivered_at = this.#timestamp();
      } else {
        record.last_error = `unexpected status ${response.status}`;
        if (record.attempt_count >= 8) record.status = 'failed';
      }
    } catch (error) {
      record.last_error = `delivery failed: ${error.message}`;
      if (record.attempt_count >= 8) record.status = 'failed';
    }
  }

  #timestamp() {
    return new Date().toISOString();
  }
}
