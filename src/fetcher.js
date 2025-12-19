import axios from 'axios';
import { sleep } from './utils.js';

export async function fetchAndProcess(db, chainConfig, actionType, processCallback) {
  let running = true;
  let consecutiveErrors = 0;

  // 1. Initialization & Checkpoint Loading
  const row = db.prepare('SELECT last_height FROM sync_status WHERE action_type = ?').get(actionType);
  let lastMaxHeight = row ? row.last_height : 0;
  
  const stmtSaveCheckpoint = db.prepare('INSERT OR REPLACE INTO sync_status (action_type, last_height) VALUES (?, ?)');

  const baseUrl = chainConfig.api_url.replace(/\/$/, '') + '/cosmos/tx/v1beta1/txs';
  const queryParamKey = chainConfig.query_param || 'query';

  console.log(`\n[${chainConfig.name}] 🧗 Resume Scan for ${actionType.split('.').pop()} from Block ${lastMaxHeight}...`);

  while (running) {
    try {
      let fullUrl = '';

      // 2. URL Construction (Preserving Custom Logic)
      if (queryParamKey === 'query') {
        const params = new URLSearchParams();
        const queryAction = `message.action='${actionType}'`;
        const queryHeight = `tx.height>=${lastMaxHeight}`;
        
        params.append('query', `${queryAction} AND ${queryHeight}`);
        params.append('pagination.limit', '100');
        params.append('orderBy', 'ORDER_BY_ASC');
        
        fullUrl = `${baseUrl}?${params.toString()}`;
      } else {
        // Event Mode (Specific Optimization)
        const pAction = `events=message.action='${actionType}'`;
        const pLimit = `pagination.limit=50`;
        
        fullUrl = `${baseUrl}?${pAction}&${pLimit}`;

        if (lastMaxHeight > 0) {
          fullUrl += `&events=tx.height>=${lastMaxHeight}`;
        }
      }

      // 3. Fetch Data
      const res = await axios.get(fullUrl, { 
        timeout: 30000,
        headers: { 'Accept': 'application/json', 'User-Agent': 'CosmosIndexer/1.0' }
      });

      const txs = res.data.tx_responses || [];
      consecutiveErrors = 0;

      if (txs.length === 0) {
        console.log(`   -> Reached tip of chain (No new txs). Finished.`);
        running = false;
        break;
      }

      // 4. Process Data & Update Height
      const newItemsCount = await processCallback(txs);
      
      const lastTx = txs[txs.length - 1];
      const lastTxHeight = parseInt(lastTx.height);

      process.stdout.write(`   [H: ${lastMaxHeight} -> ${lastTxHeight}] Found: ${txs.length} | New: ${newItemsCount}\n`);

      stmtSaveCheckpoint.run(actionType, lastTxHeight);

      // 5. Pagination & Stuck Logic
      if (txs.length < 100) {
        console.log(`   -> Received partial page (${txs.length}). Caught up.`);
        running = false;
      } else {
        if (lastTxHeight > lastMaxHeight) {
          lastMaxHeight = lastTxHeight;
        } else {
          // Force jump if stuck in same block
          console.log(`   -> Stuck in huge block ${lastTxHeight}. Forcing +1 jump.`);
          lastMaxHeight = lastTxHeight + 1;
          stmtSaveCheckpoint.run(actionType, lastMaxHeight);
        }
      }

      await sleep(200); 

    } catch (error) {
      consecutiveErrors++;
      
      if (error.response && error.response.status === 429) {
        console.warn(`   Rate Limit. Retry in 5s...`);
        await sleep(5000);
        consecutiveErrors--; 
        continue; 
      }
      
      if (consecutiveErrors >= 5) {
        console.error(`   Too many errors (${error.message}). Skipping.`);
        running = false;
      } else {
        await sleep(2000);
      }
    }
  }
}