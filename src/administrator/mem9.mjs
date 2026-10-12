// The mem9 server operations the Administrator program needs, one function each, so
// commands read as intentions and the request shapes live in one place.
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
    createChain(name, description) {
      return api.request('POST', `${ROOT}/space-chains`, { body: { name, description } });
    },
    chainByKey(chainKey) {
      return api.request('GET', `${ROOT}/space-chains/by-key`, { key: chainKey });
    },
    async setNodes(chain, nodes) {
      return (await api.request('PUT', chainPath(chain, '/nodes'), { key: chain.key, body: { nodes } })).nodes;
    },
    setRoutingPolicy(chain, nodeId, { enabled, prompt, webhookOnly }) {
      return api.request('PUT', chainPath(chain, `/nodes/${nodeId}/routing-policy`), {
        key: chain.key,
        body: { enabled, prompt, webhook_only: webhookOnly },
      });
    },
    deleteChain(chain) {
      return api.request('DELETE', chainPath(chain), { key: chain.key });
    },
    // One Memory written word for word; through a Space key it lands in that Space.
    writePinned(spaceKey, { text, agentId, tags }) {
      return api.request('POST', `${ROOT}/mem9s/memories`, { key: spaceKey, body: { content: text, memory_type: 'pinned', agent_id: agentId, tags } });
    },
    // One user message per call, written through a Chain key the way a plugin would.
    // The synchronous option returns after extraction and routing have finished.
    writeMessages(chainKey, { messages, agentId, sessionId }) {
      return api.request('POST', `${ROOT}/mem9s/memories`, {
        key: chainKey,
        body: { messages, agent_id: agentId, session_id: sessionId, sync: true },
        timeoutMs: 600000,
      });
    },
    // Webhook endpoints belong to a Chain and are managed with its key. The signing
    // secret comes back only from creation (and rotation).
    createWebhook(chain, { name, url, events }) {
      return api.request('POST', chainPath(chain, '/webhooks'), { key: chain.key, body: { name, url, events } });
    },
    updateWebhook(chain, webhookId, changes) {
      return api.request('PATCH', chainPath(chain, `/webhooks/${webhookId}`), { key: chain.key, body: changes });
    },
    async testWebhook(chain, webhookId) {
      return (await api.request('POST', chainPath(chain, `/webhooks/${webhookId}/test`), { key: chain.key })).delivery;
    },
    async webhookDeliveries(chain, limit) {
      return (await api.request('GET', chainPath(chain, '/webhook-deliveries'), { key: chain.key, query: { limit } })).deliveries ?? [];
    },
    deleteMemories(key, ids) {
      return api.request('POST', `${ROOT}/mem9s/memories/batch-delete`, { key, body: { ids } });
    },
    // A page of Memories and the total the server counts for the same filter.
    listPage,
    async listMemories(key, query = {}) {
      return (await listPage(key, query)).memories;
    },
  };
}
