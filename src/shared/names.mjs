// Names that more than one module has to agree on. Changing one here changes it everywhere.

// The one event this demo listens to.
export const ROUTED_EVENT = 'space_chain.fact_routed';

// Agent IDs: Seed memories are written as `seed`; verify writes as `verify-<run>-<case>`.
export const SEED_AGENT_ID = 'seed';
export const VERIFY_PREFIX = 'verify-';

// A webhook address under this top-level domain can never deliver (RFC 2606); it only
// registers a Chain, which is enough to switch the Approval Example on.
const PLACEHOLDER_DOMAIN = '.invalid';
export const PLACEHOLDER_URL = 'https://receiver.invalid/';

export function isPlaceholderUrl(url) {
  try {
    return new URL(url).hostname.endsWith(PLACEHOLDER_DOMAIN);
  } catch {
    return false;
  }
}
