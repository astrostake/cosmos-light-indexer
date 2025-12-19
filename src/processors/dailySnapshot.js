import axios from 'axios';

const getTodayUTC = () => {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const processDailySnapshot = async (db, chainConfig) => {
  const now = new Date();
  const utcHour = now.getUTCHours();
  const utcMin = now.getUTCMinutes();

  // Time Gate: Only run between 23:55 UTC and 23:59 UTC
  if (utcHour < 23 || utcMin < 55) {
    return; 
  }

  const today = getTodayUTC();
  const baseUrl = chainConfig.api_url.replace(/\/$/, '');

  // Prepare DB Statements
  const validators = db.prepare('SELECT operator_address FROM validators').all();
  
  const stmtCheck = db.prepare(
    'SELECT 1 FROM history_delegator_stats WHERE operator_address = ? AND snapshot_date = ?'
  );

  const stmtInsert = db.prepare(`
    INSERT OR REPLACE INTO history_delegator_stats 
    (operator_address, snapshot_date, delegator_count, total_staked)
    VALUES (?, ?, ?, ?)
  `);

  console.log(`[Snapshot] Processing End-of-Day stats for ${today} (${utcHour}:${utcMin} UTC)...`);

  for (const val of validators) {
    // Check if data for today already exists to avoid duplicate calls in the 10-min window
    if (stmtCheck.get(val.operator_address, today)) continue;

    try {
      // 1. Fetch Validator Details (Total Tokens)
      const resVal = await axios.get(`${baseUrl}/cosmos/staking/v1beta1/validators/${val.operator_address}`, { timeout: 5000 });
      const totalStaked = resVal.data.validator?.tokens || '0';

      // 2. Fetch Delegator Count (Optimized: limit=1 & count_total=true)
      const resDel = await axios.get(
        `${baseUrl}/cosmos/staking/v1beta1/validators/${val.operator_address}/delegations?pagination.limit=1&pagination.count_total=true`,
        { timeout: 5000 }
      );
      const delegatorCount = parseInt(resDel.data.pagination?.total || 0);

      // 3. Save to DB
      stmtInsert.run(val.operator_address, today, delegatorCount, totalStaked);
      
      console.log(`[Snapshot] Saved ${val.operator_address}: ${delegatorCount} delegators`);
      
      // Prevent rate limiting
      await new Promise(r => setTimeout(r, 200));

    } catch (e) {
      console.error(`[Snapshot] Failed ${val.operator_address}:`, e.message);
    }
  }
};