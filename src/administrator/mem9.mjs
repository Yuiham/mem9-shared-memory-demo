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
    // A page of Memories and the total the server counts for the same filter.
    listPage,
    async listMemories(key, query = {}) {
      return (await listPage(key, query)).memories;
    },
  };
}
