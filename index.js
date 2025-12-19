import fs from 'fs';
import yaml from 'js-yaml';
import axios from 'axios';

// Local Imports
import { initDB } from './src/database.js';
import { fetchAndProcess } from './src/fetcher.js';
import { sleep } from './src/utils.js';

// Processors
import { processUnjail } from './src/processors/unjail.js';
import { processEditValidator } from './src/processors/editValidator.js';
import { processVote } from './src/processors/vote.js';
import { syncValidatorState } from './src/processors/validatorState.js';
import { processCreateValidator } from './src/processors/createValidator.js';
import { processGenesisFile } from './src/processors/genesis.js';
import { syncUpgradePlan } from './src/processors/upgrade.js';

// Configuration
if (!fs.existsSync('./config.yaml')) throw new Error("Config missing!");
const config = yaml.load(fs.readFileSync('./config.yaml', 'utf8'));

// Constants
const VOTE_MSG_TYPES = [
  '/cosmos.gov.v1beta1.MsgVote',
  '/cosmos.gov.v1.MsgVote',
  '/cosmos.gov.v1beta1.MsgVoteWeighted',
  '/cosmos.gov.v1.MsgVoteWeighted'
];

const syncLatestHeight = async (db, chainConfig) => {
  const baseUrl = chainConfig.api_url.replace(/\/$/, '');
  const HEIGHT_TRACKER_KEY = 'chain.height.tracker';

  try {
    const url = `${baseUrl}/cosmos/base/tendermint/v1beta1/blocks/latest`;
    const res = await axios.get(url, { timeout: 5000 });
    const latestHeight = parseInt(res.data.block.header.height);

    const stmt = db.prepare('INSERT OR REPLACE INTO sync_status (action_type, last_height) VALUES (?, ?)');
    stmt.run(HEIGHT_TRACKER_KEY, latestHeight);

    return latestHeight;
  } catch (e) {
    console.error(`  [Height Tracker] Failed to fetch latest block: ${e.message}`);
    return null;
  }
};

async function main() {
  if (!fs.existsSync('./data')) fs.mkdirSync('./data');

  // --- Initialization Phase ---
  console.log(`\n>>> INITIALIZING GENESIS DATA <<<`);
  for (const chain of config.chains) {
    const db = initDB(chain.db_file);
    processGenesisFile(db, chain);
  }
  console.log(`>>> INITIALIZATION COMPLETE <<<\n`);

  // --- Sync Cycle ---
  while (true) {
    console.log(`\n[${new Date().toISOString()}] Starting Sync Cycle...`);

    for (const chain of config.chains) {
      console.log(`\n>>> CHECKING CHAIN: ${chain.name.toUpperCase()} <<<`);
      
      const db = initDB(chain.db_file);

      try {
        // Core System Sync
        await syncLatestHeight(db, chain);
        await syncValidatorState(db, chain);
        await syncUpgradePlan(db, chain);

        // Historical Data Processing (Order matters: Create -> Edit -> Unjail -> Vote)
        
        // 1. Create Validator
        await fetchAndProcess(db, chain, '/cosmos.staking.v1beta1.MsgCreateValidator', async (txs) => {
          return processCreateValidator(db, txs);
        });

        // 2. Edit Validator
        await fetchAndProcess(db, chain, '/cosmos.staking.v1beta1.MsgEditValidator', async (txs) => {
          return processEditValidator(db, txs, chain);
        });

        // 3. Unjail
        await fetchAndProcess(db, chain, '/cosmos.slashing.v1beta1.MsgUnjail', async (txs) => {
          return processUnjail(db, txs);
        });

        // 4. Governance Votes
        for (const action of VOTE_MSG_TYPES) {
          await fetchAndProcess(db, chain, action, async (txs) => {
            return processVote(db, txs, chain);
          });
        }

      } catch (err) {
        console.error(`Error syncing ${chain.name}:`, err.message);
      }
    }

    console.log(`\nCycle finished. Sleeping for 60 seconds...`);
    console.log(`---------------------------------------------`);
    
    await sleep(60000);
  }
}

main().catch(console.error);