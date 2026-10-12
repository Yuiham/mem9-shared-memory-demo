// A small JSON client for the mem9 server, built on the fetch that ships with Node.
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

export function createApiClient(baseUrl, { toolName = 'sharedmem' } = {}) {
  async function request(method, path, { key, body, query, timeoutMs = 30000 } = {}) {
    const url = new URL(baseUrl + path);
    for (const [name, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(name, String(value));
    }
    // The header names the writing tool. People are identified by the agent_id in
    // request bodies, never by this header.
    const headers = { 'X-Mnemo-Agent-Id': toolName };
    if (key) headers['X-API-Key'] = key;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const reason = error?.name === 'TimeoutError' ? 'it did not answer in time' : (error?.cause?.code ?? 'connection failed');
      throw new CliError(`Cannot reach the mem9 server (${reason}).`, {
        next: 'Check SHAREDMEM_API_URL and your network connection, then run the command again.',
      });
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
      const message = (json && typeof json.error === 'string' ? json.error : text.slice(0, 200)) || `HTTP ${response.status}`;
      throw new ApiError(response.status, message, `${method} ${path.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, '<id>')}`);
    }
    return json;
  }
  return { request };
}
