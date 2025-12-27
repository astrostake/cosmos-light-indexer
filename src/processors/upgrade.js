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

  const stmtUpsertActive = db.prepare(`
    INSERT OR REPLACE INTO active_upgrade 
    (plan_name, target_height, start_time, estimated_time, info, last_checked)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `);

  const stmtClearActive = db.prepare('DELETE FROM active_upgrade');
  
  const stmtInsertHistory = db.prepare(`
    INSERT OR REPLACE INTO history_upgrades
    (plan_name, target_height, actual_upgrade_time, proposal_voting_start_time, proposal_id, proposal_title, status)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

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

    // 3. Find All Upgrade Proposals (for historical tracking)
    let allUpgradeProposals = [];
    try {
      const resProps = await fetchSmart(baseUrl, PATHS.proposals, 10000);
      const proposals = resProps.data.proposals || [];

      allUpgradeProposals = proposals
        .map(p => {
          let plan = null;

          if (p.messages) {
            // Format 1: Direct upgrade message
            let msg = p.messages.find(m => {
              const t = m['@type'] || m.typeUrl || '';
              return t.includes('MsgSoftwareUpgrade') || t.includes('SoftwareUpgradeProposal');
            });
            
            // Format 2: Legacy content wrapper (LAVA & other chains)
            if (!msg) {
              const legacyMsg = p.messages.find(m => {
                const t = m['@type'] || m.typeUrl || '';
                return t.includes('MsgExecLegacyContent');
              });
              
              if (legacyMsg && legacyMsg.content) {
                const contentType = legacyMsg.content['@type'] || legacyMsg.content.typeUrl || '';
                if (contentType.includes('SoftwareUpgradeProposal')) {
                  msg = legacyMsg.content;
                }
              }
            }
            
            if (msg) plan = msg.plan || (msg.content ? msg.content.plan : null);
          } 
          else if (p.content && p.content.plan) {
            plan = p.content.plan;
          }

          if (!plan) return null;

          return {
            id: p.id || p.proposal_id,
            title: p.title || (p.content ? p.content.title : (p.messages?.[0]?.content?.title || plan.name)),
            status: p.status,
            votingStart: p.voting_start_time ? new Date(p.voting_start_time).getTime() : 0,
            plan
          };
        })
        .filter(Boolean)
        .sort((a, b) => b.votingStart - a.votingStart);

      // 4. Save Historical Upgrades
      for (const proposal of allUpgradeProposals) {
        const targetHeight = parseInt(proposal.plan.height);
        const isPassed = currentHeight >= targetHeight;
        
        let actualUpgradeTime = null;
        let status = 'scheduled';

        if (isPassed) {
          // Coba fetch block pada target height untuk mendapatkan waktu sebenarnya
          try {
            const blockPath = resLatest.config.url
              .replace(baseUrl, '')
              .replace('latest', targetHeight);
            
            const resTargetBlock = await axios.get(`${baseUrl}${blockPath}`, { timeout: 5000 });
            actualUpgradeTime = new Date(resTargetBlock.data.block.header.time).getTime();
            status = 'completed';
          } catch {
            // Jika gagal fetch block, estimasi waktu berdasarkan rata-rata block time
            if (avgBlockTime) {
              const blocksPassed = targetHeight - currentHeight;
              actualUpgradeTime = currentTime - (Math.abs(blocksPassed) * avgBlockTime * 1000);
            }
            status = 'completed';
          }
        } else {
          status = 'scheduled';
        }

        stmtInsertHistory.run(
          proposal.plan.name,
          targetHeight,
          actualUpgradeTime,
          proposal.votingStart, // Waktu voting proposal dimulai
          proposal.id,
          proposal.title,
          status
        );
      }

    } catch (e) {
      console.error(`Error fetching upgrade proposals: ${e.message}`);
    }

    // 5. Find Active Upgrade (untuk active_upgrade table)
    let found = null;
    
    // Cari upgrade yang belum berlalu
    const futureUpgrades = allUpgradeProposals.filter(p => {
      return parseInt(p.plan.height) > currentHeight;
    });

    if (futureUpgrades.length > 0) {
      const latest = futureUpgrades[0];
      found = {
        name: latest.plan.name,
        height: parseInt(latest.plan.height),
        startTime: latest.votingStart,
        info: `${latest.id}. ${latest.title}`
      };
    }

    // 6. Fallback: Check Current Plan Endpoint
    if (!found) {
      try {
        const resPlan = await fetchSmart(baseUrl, PATHS.plans, 5000);
        if (resPlan.data.plan) {
          const plan = resPlan.data.plan;
          const targetHeight = parseInt(plan.height);
          
          if (targetHeight > currentHeight) {
            found = {
              name: plan.name,
              height: targetHeight,
              startTime: currentTime, 
              info: `Scheduled Upgrade: ${plan.name}`
            };
          }
        }
      } catch {}
    }

    if (!found) {
      stmtClearActive.run();
      return;
    }

    // 7. Calculate ETA & Save Active Upgrade
    const blocksRemaining = found.height - currentHeight;
    let estimatedTime;

    if (avgBlockTime !== null) {
      estimatedTime = currentTime + (Math.max(0, blocksRemaining) * avgBlockTime * 1000);
    } else {
      estimatedTime = currentTime + (Math.max(0, blocksRemaining) * 1000);
    }

    stmtUpsertActive.run(
      found.name,
      found.height,
      found.startTime, // Ini waktu voting dimulai
      estimatedTime,
      found.info
    );

  } catch (e) {
    console.error(`Error in syncUpgradePlan: ${e.message}`);
  }
};