// A small JSON client for the mem9 server and the mem9 Admin API, built on the fetch that
// ships with Node.
import { CliError } from './cli.mjs';

export class ApiError extends Error {
  constructor(status, message, where) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.where = where;
  }
}

// Turns a server answer that no command expected into an error with a next step.
export function toCliError(error) {
  const what = `${error.where} (${error.status}): ${error.message}`;
  if (error.status >= 500) {
    return new CliError(`The mem9 server failed during ${what}`, {
      next: 'Run the command again. Commands that create things pick up where they stopped.',
    });
  }
  if (error.status === 401 || error.status === 403 || /api key/i.test(error.message)) {
    return new CliError(`The mem9 server did not accept a key during ${what}`, {
      next: 'The state in this working directory may belong to another server or may be out of date. See the troubleshooting guide.',
    });
  }
  return new CliError(`The mem9 server rejected ${what}`, {
    next: 'Check the command and its options, or see the troubleshooting guide.',
  });
}

// A connection that the network or a load balancer cut (rather than a server that is
// down or slow) is worth a short retry, but only for a request that is safe to repeat.
const CUT_CONNECTION = new Set(['UND_ERR_SOCKET', 'ECONNRESET', 'EPIPE']);
const RETRIES = 2;
const RETRY_DELAY_MS = 300;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// `identify: false` leaves out the tool header, which only the mem9 server reads. `label` and
// `addressVariable` say which service this client talks to, for the message when it cannot
// be reached.
export function createApiClient(baseUrl, { toolName = 'sharedmem', identify = true, label = 'mem9 server', addressVariable = 'SHAREDMEM_API_URL' } = {}) {
  // `retry` marks a request that can be repeated without a second effect; reads always can.
  // `key` goes in the X-API-Key header (mem9 keys); `bearer` in an Authorization header
  // (the create secret, an Admin API key).
  async function request(method, path, { key, bearer, body, query, timeoutMs = 30000, retry = method === 'GET' } = {}) {
    const url = new URL(baseUrl + path);
    for (const [name, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(name, String(value));
    }
    // The header names the writing tool. People are identified by the agent_id in
    // request bodies, never by this header.
    const headers = identify ? { 'X-Mnemo-Agent-Id': toolName } : {};
    if (key) headers['X-API-Key'] = key;
    if (bearer) headers.Authorization = `Bearer ${bearer}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let response;
    for (let attempt = 0; ; attempt += 1) {
      try {
        response = await fetch(url, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        });
        break;
      } catch (error) {
        if (retry && attempt < RETRIES && CUT_CONNECTION.has(error?.cause?.code)) {
          await sleep(RETRY_DELAY_MS);
          continue;
        }
        const reason = error?.name === 'TimeoutError' ? 'it did not answer in time' : (error?.cause?.code ?? 'connection failed');
        throw new CliError(`Cannot reach the ${label} (${reason}).`, {
          next: `Check ${addressVariable} and your network connection, then run the command again.`,
        });
      }
    }
    const text = await response.text();
    let json = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }
    if (!response.ok) {
      // The mem9 server answers `{ error }`, the Admin API `{ code, message, details }`.
      const stated = [json?.error, json?.message].find((value) => typeof value === 'string' && value !== '');
      const message = (stated ?? text.slice(0, 200)) || `HTTP ${response.status}`;
      throw new ApiError(response.status, message, `${method} ${path.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, '<id>')}`);
    }
    return json;
  }
  return { request };
}
