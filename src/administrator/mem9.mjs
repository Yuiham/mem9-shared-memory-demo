// The mem9 server operations the Administrator program needs, one function each, so
// commands read as intentions and the request shapes live in one place.
//
// A Chain has two keys. Everything that manages it (reading it, nodes, routing policy,
// webhooks, deleting it) uses its management key; writing and reading Memories the way a
// Participant's plugin does uses its memory key. The functions take the Chain's state
// entry and pick the key themselves, so a command cannot use the wrong one by accident.
const ROOT = '/v1alpha2';

export function createMem9(api) {
  const chainPath = (chain, rest = '') => `${ROOT}/space-chains/${chain.id}${rest}`;
  async function listPage(key, query = {}) {
    const body = await api.request('GET', `${ROOT}/mem9s/memories`, { key, query: { limit: 200, ...query } });
    return { memories: body?.memories ?? [], total: body?.total ?? 0 };
  }
  return {
    async provisionSpace() {
      return (await api.request('POST', '/v1alpha1/mem9s')).id;
    },
    // Creates a Chain directly on the server. A server with its create gate on wants the
    // create secret as a Bearer credential; one without ignores it. The answer carries
    // both keys, once.
    createChain(name, description, { secret } = {}) {
      return api.request('POST', `${ROOT}/space-chains`, { bearer: secret, body: { name, description } });
    },
    chainByKey(managementKey) {
      return api.request('GET', `${ROOT}/space-chains/by-key`, { key: managementKey });
    },
    async setNodes(chain, nodes) {
      return (await api.request('PUT', chainPath(chain, '/nodes'), { key: chain.managementKey, body: { nodes } })).nodes;
    },
    setRoutingPolicy(chain, nodeId, { enabled, prompt, webhookOnly }) {
      return api.request('PUT', chainPath(chain, `/nodes/${nodeId}/routing-policy`), {
        key: chain.managementKey,
        body: { enabled, prompt, webhook_only: webhookOnly },
      });
    },
    deleteChain(chain) {
      return api.request('DELETE', chainPath(chain), { key: chain.managementKey });
    },
    // One Memory written word for word; through a Space key it lands in that Space.
    writePinned(spaceKey, { text, agentId, tags }) {
      return api.request('POST', `${ROOT}/mem9s/memories`, { key: spaceKey, body: { content: text, memory_type: 'pinned', agent_id: agentId, tags } });
    },
    // One user message per call, written through a Chain's memory key the way a plugin
    // would. The synchronous option returns after extraction and routing have finished.
    writeMessages(chain, { messages, agentId, sessionId }) {
      return api.request('POST', `${ROOT}/mem9s/memories`, {
        key: chain.memoryKey,
        body: { messages, agent_id: agentId, session_id: sessionId, sync: true },
        timeoutMs: 600000,
      });
    },
    // Webhook endpoints belong to a Chain and are managed with its management key. The
    // signing secret comes back only from creation (and rotation).
    createWebhook(chain, { name, url, events }) {
      return api.request('POST', chainPath(chain, '/webhooks'), { key: chain.managementKey, body: { name, url, events } });
    },
    updateWebhook(chain, webhookId, changes) {
      return api.request('PATCH', chainPath(chain, `/webhooks/${webhookId}`), { key: chain.managementKey, body: changes });
    },
    async testWebhook(chain, webhookId) {
      return (await api.request('POST', chainPath(chain, `/webhooks/${webhookId}/test`), { key: chain.managementKey })).delivery;
    },
    async webhookDeliveries(chain, limit) {
      return (await api.request('GET', chainPath(chain, '/webhook-deliveries'), { key: chain.managementKey, query: { limit } })).deliveries ?? [];
    },
    deleteMemories(key, ids) {
      // Deleting the same ids again changes nothing, so a cut connection may be retried.
      return api.request('POST', `${ROOT}/mem9s/memories/batch-delete`, { key, body: { ids }, retry: true });
    },
    // A page of Memories and the total the server counts for the same filter. `key` is a
    // Space key, or a Chain's memory key to see what that Chain's Participant sees.
    listPage,
    async listMemories(key, query = {}) {
      return (await listPage(key, query)).memories;
    },
  };
}
