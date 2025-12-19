import axios from 'axios';

export const syncValidatorState = async (db, chainConfig) => {
  console.log(`[${chainConfig.name}] Syncing Validator Snapshot (Initial State)...`);

  const stmtUpsert = db.prepare(`
    INSERT OR REPLACE INTO validators 
    (operator_address, moniker, details, commission_rate, last_updated)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
  `);

  const baseUrl = chainConfig.api_url.replace(/\/$/, '') + '/cosmos/staking/v1beta1/validators';
  
  const statuses = [
    'BOND_STATUS_BONDED',
    'BOND_STATUS_UNBONDING',
    'BOND_STATUS_UNBONDED'
  ];

  const runTransaction = db.transaction((validators) => {
    for (const val of validators) {
      try {
        const moniker = val.description?.moniker || 'Unknown';
        const details = JSON.stringify({
          website: val.description?.website || '',
          identity: val.description?.identity || '',
          details: val.description?.details || '',
          security_contact: val.description?.security_contact || ''
        });
        
        const commissionRate = val.commission?.commission_rates?.rate || '0';

        stmtUpsert.run(
          val.operator_address,
          moniker,
          details,
          commissionRate
        );
      } catch (err) {
        console.error(`Error saving validator ${val.operator_address}:`, err.message);
      }
    }
  });

  for (const status of statuses) {
    let nextKey = null;
    let running = true;
    
    while (running) {
      try {
        let url = `${baseUrl}?status=${status}&pagination.limit=200`;
        if (nextKey) url += `&pagination.key=${encodeURIComponent(nextKey)}`;

        process.stdout.write(`Fetching ${status}... `);
        
        const res = await axios.get(url, { timeout: 30000 });
        const vals = res.data.validators || [];
        
        if (vals.length > 0) {
          runTransaction(vals);
          process.stdout.write(`${vals.length} saved.\n`);
        } else {
          process.stdout.write(`Done.\n`);
        }

        if (res.data.pagination && res.data.pagination.next_key) {
          nextKey = res.data.pagination.next_key;
        } else {
          running = false;
        }
      } catch (e) {
        console.error(`\nFailed to fetch validators ${status}: ${e.message}`);
        running = false;
      }
    }
  }
  console.log(`[${chainConfig.name}] Validator Snapshot Complete.\n`);
};