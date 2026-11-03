// A fake of the mem9 Admin API for offline tests. It answers the one operation the demo
// uses, creating a Chain in a Project, and creates the Chain on a fake mem9 the way the
// real service does. Everything lives in memory.
import crypto from 'node:crypto';
import http from 'node:http';

const ALPHANUMERIC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

// Same shape as a real Admin API key: a fixed prefix and 43 letters and digits.
function newAdminKey() {
  let tail = '';
  for (let index = 0; index < 43; index += 1) tail += ALPHANUMERIC[crypto.randomInt(ALPHANUMERIC.length)];
  return `mem9_admin_${tail}`;
}

// The Admin API's errors carry a code, a generic message and details, never the
// mem9 error text.
const ERRORS = {
  400: { code: 'invalid_request', message: 'The request is invalid.' },
  401: { code: 'unauthorized', message: 'The Admin API key is missing or invalid.' },
  403: { code: 'forbidden', message: 'This key may not create Space Chains in this project.' },
  404: { code: 'not_found', message: 'The resource was not found.' },
  409: { code: 'conflict', message: 'A Space Chain with this name already exists in the project.' },
  502: { code: 'mem9_unavailable', message: 'The upstream service failed.' },
  503: { code: 'service_unavailable', message: 'The service is temporarily unavailable.' },
};

export class FakeConsole {
  // `ownerRole` is the role the Admin API key's owner has in the Project's organization;
  // only an owner or an admin may create Chains.
  constructor({ mem9, ownerRole = 'owner' }) {
    this.mem9 = mem9;
    this.ownerRole = ownerRole;
    this.adminKey = newAdminKey();
    this.projectId = crypto.randomUUID();
    this.requests = [];
    this.registrations = [];
    this.nextFailure = null;
    this.server = null;
  }

  async start() {
    this.server = http.createServer((request, response) => {
      this.#handle(request, response).catch((error) => {
        if (!response.headersSent) this.#send(response, 500, { code: 'internal_error', message: `fake console failure: ${error.message}`, details: {} });
      });
    });
    await new Promise((resolve) => this.server.listen(0, '127.0.0.1', resolve));
    return this;
  }

  get url() {
    return `http://127.0.0.1:${this.server.address().port}`;
  }

  async stop() {
    if (!this.server) return;
    this.server.closeAllConnections?.();
    await new Promise((resolve) => this.server.close(resolve));
    this.server = null;
  }

  // The next create answers this status (one of 400, 502, 503) and registers nothing.
  failNext(status) {
    this.nextFailure = status;
  }

  // What deleting a Chain in the Console does: the registration goes, and so does the
  // Chain on mem9, so the name is free again.
  deleteRegistration(name) {
    const index = this.registrations.findIndex((entry) => entry.name === name);
    if (index === -1) throw new Error(`no registration named ${name}`);
    const [removed] = this.registrations.splice(index, 1);
    this.mem9.chains.get(removed.id).deleted = true;
  }

  async #handle(request, response) {
    const url = new URL(request.url, 'http://fake.local');
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString('utf8');
    let body = null;
    try {
      body = raw ? JSON.parse(raw) : null;
    } catch {
      body = null;
    }
    const authorization = request.headers.authorization;
    this.requests.push({ method: request.method, path: url.pathname, authorization, body });
    if (request.method !== 'POST' || url.pathname !== '/v1/space-chains') return this.#fail(response, 404);
    return this.#create(response, authorization, body);
  }

  #create(response, authorization, body) {
    if (authorization !== `Bearer ${this.adminKey}`) return this.#fail(response, 401);
    if (this.nextFailure) {
      const status = this.nextFailure;
      this.nextFailure = null;
      return this.#fail(response, status);
    }
    if (!body || typeof body.project_id !== 'string' || typeof body.name !== 'string' || body.name === '') return this.#fail(response, 400);
    if (body.project_id !== this.projectId) return this.#fail(response, 404);
    if (!['owner', 'admin'].includes(this.ownerRole)) return this.#fail(response, 403);
    if (this.registrations.some((entry) => entry.projectId === body.project_id && entry.name === body.name)) return this.#fail(response, 409);
    const created = this.mem9.createChainForConsole(body.name, body.description ?? '');
    const stamp = new Date().toISOString();
    this.registrations.push({ id: created.chain.id, projectId: body.project_id, name: body.name });
    return this.#send(response, 201, {
      space_chain: {
        id: created.chain.id,
        project_id: body.project_id,
        name: body.name,
        description: body.description ?? '',
        created_by_user_id: 'fake-user',
        node_count: 0,
        chain_key_count: 2,
        created_at: stamp,
        updated_at: stamp,
      },
      management_binding: created.management_binding,
      memory_binding: created.memory_binding,
    });
  }

  #fail(response, status) {
    this.#send(response, status, { ...ERRORS[status], details: {} });
  }

  #send(response, status, body) {
    response.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
  }
}
