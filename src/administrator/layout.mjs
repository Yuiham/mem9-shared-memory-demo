// The memory layout: which nodes each Chain has and how each node routes.
export const TEAM = 'team-shared';
export const LEADERSHIP = 'leadership-shared';
export const EXAMPLES = ['basic', 'approval'];

export const SHARED_SPACES = [TEAM, LEADERSHIP];
const DISPLAY = { [TEAM]: 'Team Shared', [LEADERSHIP]: 'Leadership Shared' };

export const chainNameFor = (person) => `sharedmem-demo-${person}`;
export const displayName = (space) => DISPLAY[space] ?? space;

const OFF = { enabled: false, prompt: '', webhookOnly: false };
const auto = (prompt) => ({ enabled: true, prompt, webhookOnly: false });

// The nodes of one Participant's Chain, owner first. A shared node is named by its
// fixed external space identifier; the owner node needs none.
export function nodeLayout(participant, example, prompts) {
  const personal = { space: participant.name, externalSpaceId: '', displayName: 'Personal', policy: null };
  const team = (policy) => ({ space: TEAM, externalSpaceId: TEAM, displayName: displayName(TEAM), policy });
  if (participant.role === 'developer') return [personal, team(auto(prompts.teamAuto))];
  const leadership = { space: LEADERSHIP, externalSpaceId: LEADERSHIP, displayName: displayName(LEADERSHIP), policy: auto(prompts.leadershipAuto) };
  const teamPolicy = example === 'approval' ? { enabled: true, prompt: prompts.teamApproval, webhookOnly: true } : OFF;
  return [personal, leadership, team(teamPolicy)];
}

export function policyMatches(node, wanted) {
  return node.routing_policy_enabled === wanted.enabled
    && (node.routing_policy_prompt ?? '') === wanted.prompt
    && Boolean(node.routing_policy_webhook_only) === wanted.webhookOnly;
}
