import axios from 'axios';

async function fetchSmart(baseUrl, endpoints, timeout = 5000) {
  for (const path of endpoints) {
    try {
      return await axios.get(`${baseUrl}${path}`, { timeout });
    } catch (e) {
      if (e.response && (e.response.status === 404 || e.response.status === 501)) continue;
      if (path === endpoints[endpoints.length - 1]) throw e;
    }
  }
}

export const syncUpgradePlan = async (db, chainConfig) => {
  const baseUrl = chainConfig.api_url.replace(/\/$/, '');

  const PATHS = {
    blocks: [
      '/cosmos/base/tendermint/v1beta1/blocks/latest',
      '/cosmos/base/tendermint/v1/blocks/latest'
    ],
    plans: [
      '/cosmos/upgrade/v1beta1/current_plan',
      '/cosmos/upgrade/v1/current_plan'
    ],
    proposals: [
      '/cosmos/gov/v1/proposals?pagination.limit=50&pagination.reverse=true',
      '/cosmos/gov/v1beta1/proposals?pagination.limit=50&pagination.reverse=true'
    ]
  };

  const stmtUpsert = db.prepare(`
    INSERT OR REPLACE INTO active_upgrade 
    (plan_name, target_height, start_time, estimated_time, info, last_checked)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `);

  const stmtClear = db.prepare('DELETE FROM active_upgrade');

  try {
    // 1. Get Latest Block & Time
    const resLatest = await fetchSmart(baseUrl, PATHS.blocks, 10000);
    const latestBlock = resLatest.data.block;
    const currentHeight = parseInt(latestBlock.header.height);
    const currentTime = new Date(latestBlock.header.time).getTime();

    // 2. Calculate Average Block Time (Sampling -2000 blocks)
    let avgBlockTime = null;
    try {
      const sampleHeight = Math.max(1, currentHeight - 2000);
      const replacePath = resLatest.config.url
        .replace(baseUrl, '')
        .replace('latest', sampleHeight);

      const resSample = await axios.get(`${baseUrl}${replacePath}`, { timeout: 5000 });
      const sampleTime = new Date(resSample.data.block.header.time).getTime();

      const blockDiff = currentHeight - sampleHeight;
      const timeDiff = currentTime - sampleTime;

      if (blockDiff > 0) {
        avgBlockTime = (timeDiff / blockDiff) / 1000;
      }
    } catch {
      // Keep avgBlockTime null if sampling fails
    }

    // 3. Find Active Upgrade (Strategy A: Governance Proposals)
    let found = null;
    try {
      const resProps = await fetchSmart(baseUrl, PATHS.proposals, 10000);
      const proposals = resProps.data.proposals || [];

      const upgradeProposals = proposals
        .map(p => {
          let plan = null;

          if (p.messages) {
            const msg = p.messages.find(m => {
              const t = m['@type'] || m.typeUrl || '';
              return t.includes('MsgSoftwareUpgrade') || t.includes('SoftwareUpgradeProposal');
            });
            if (msg) plan = msg.plan || (msg.content ? msg.content.plan : null);
          } 
          else if (p.content && p.content.plan) {
            plan = p.content.plan;
          }

          if (!plan) return null;

          return {
            id: p.id || p.proposal_id,
            title: p.title || (p.content ? p.content.title : plan.name),
            votingStart: p.voting_start_time ? new Date(p.voting_start_time).getTime() : 0,
            plan
          };
        })
        .filter(Boolean)
        .sort((a, b) => b.votingStart - a.votingStart);

      if (upgradeProposals.length > 0) {
        const latest = upgradeProposals[0];
        found = {
          name: latest.plan.name,
          height: parseInt(latest.plan.height),
          startTime: latest.votingStart,
          info: `${latest.id}. ${latest.title}`
        };
      }
    } catch {}

    // 4. Find Active Upgrade (Strategy B: Current Plan Endpoint)
    if (!found) {
      try {
        const resPlan = await fetchSmart(baseUrl, PATHS.plans, 5000);
        if (resPlan.data.plan) {
          const plan = resPlan.data.plan;
          found = {
            name: plan.name,
            height: parseInt(plan.height),
            startTime: currentTime, 
            info: `Scheduled Upgrade: ${plan.name}`
          };
        }
      } catch {}
    }

    if (!found) {
      stmtClear.run();
      return;
    }

    // 5. Calculate ETA & Save
    const blocksRemaining = found.height - currentHeight;
    let estimatedTime;

    if (avgBlockTime !== null) {
      estimatedTime = currentTime + (Math.max(0, blocksRemaining) * avgBlockTime * 1000);
    } else {
      // Fallback: assume 1s/block to prevent null
      estimatedTime = currentTime + (Math.max(0, blocksRemaining) * 1000);
    }

    stmtUpsert.run(
      found.name,
      found.height,
      found.startTime,
      estimatedTime,
      found.info
    );

  } catch {}
};