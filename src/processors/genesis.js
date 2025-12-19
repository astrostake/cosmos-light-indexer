import fs from 'fs';

export const processGenesisFile = (db, chainConfig) => {
  if (!chainConfig.genesis_file) return;
  
  if (!fs.existsSync(chainConfig.genesis_file)) {
    console.warn(`[${chainConfig.name}] ⚠️  Genesis file not found: ${chainConfig.genesis_file}`);
    return;
  }

  // Check redundancy
  const checkRow = db.prepare('SELECT 1 FROM history_edits WHERE block_height = 0 LIMIT 1').get();
  if (checkRow) {
    console.log(`[${chainConfig.name}] ✅ Genesis data already imported. Skipping.`);
    return;
  }

  console.log(`[${chainConfig.name}] ⏳ Importing Genesis Data...`);

  try {
    const rawData = fs.readFileSync(chainConfig.genesis_file, 'utf8');
    let genesis = JSON.parse(rawData);

    // Normalize RPC format
    if (genesis.result && genesis.result.genesis) {
      genesis = genesis.result.genesis;
    }

    const genesisTime = genesis.genesis_time || new Date(0).toISOString();
    const genTxs = genesis.app_state?.genutil?.gen_txs || [];
    const stateValidators = genesis.app_state?.staking?.validators || [];

    const stmtInsertHistory = db.prepare(`
      INSERT OR REPLACE INTO history_edits 
      (tx_hash, operator_address, field_changed, block_height, timestamp) 
      VALUES (?, ?, ?, ?, ?)
    `);

    const stmtUpsertValidator = db.prepare(`
      INSERT OR IGNORE INTO validators (operator_address, moniker, details, commission_rate, last_updated)
      VALUES (?, ?, ?, ?, ?)
    `);

    let count = 0;
    const processedAddr = new Set(); 

    const runTransaction = db.transaction(() => {
      const saveValidator = (valAddr, moniker, detailsObj, commissionRate) => {
        if (processedAddr.has(valAddr)) return; 

        // 1. History (Block 0)
        const changesDiff = {};
        if (commissionRate) changesDiff['commission_rate'] = { from: '0', to: commissionRate };
        
        if (moniker) changesDiff['moniker'] = { from: 'N/A', to: moniker };
        if (detailsObj.website) changesDiff['website'] = { from: 'N/A', to: detailsObj.website };
        if (detailsObj.identity) changesDiff['identity'] = { from: 'N/A', to: detailsObj.identity };
        if (detailsObj.details) changesDiff['details'] = { from: 'N/A', to: detailsObj.details };
        if (detailsObj.security_contact) changesDiff['security_contact'] = { from: 'N/A', to: detailsObj.security_contact };

        const dummyHash = `GENESIS_${valAddr.slice(-8)}`;
        
        stmtInsertHistory.run(
          dummyHash, 
          valAddr, 
          JSON.stringify(changesDiff), 
          0, 
          genesisTime
        );

        // 2. Snapshot
        stmtUpsertValidator.run(
          valAddr,
          moniker || 'Unknown',
          JSON.stringify(detailsObj),
          commissionRate || '0',
          genesisTime
        );

        processedAddr.add(valAddr);
        count++;
      };

      // Process GenTXs
      for (const tx of genTxs) {
        const body = tx.body || tx.tx?.body; 
        const msgs = body?.messages || [];
        const msg = msgs.find(m => m['@type'].includes('MsgCreateValidator'));
        
        if (!msg) continue;

        saveValidator(
          msg.validator_address,
          msg.description?.moniker,
          {
            website: msg.description?.website || '',
            identity: msg.description?.identity || '',
            details: msg.description?.details || '',
            security_contact: msg.description?.security_contact || ''
          },
          msg.commission?.rate
        );
      }

      // Process State Validators
      for (const val of stateValidators) {
        saveValidator(
          val.operator_address,
          val.description?.moniker,
          {
            website: val.description?.website || '',
            identity: val.description?.identity || '',
            details: val.description?.details || '',
            security_contact: val.description?.security_contact || ''
          },
          val.commission?.commission_rates?.rate 
        );
      }
    });

    runTransaction();
    console.log(`[${chainConfig.name}] 🎉 Imported ${count} genesis validators.`);

  } catch (e) {
    console.error(`[${chainConfig.name}] ❌ Error importing genesis: ${e.message}`);
  }
};