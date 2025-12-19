export const processCreateValidator = (db, txs) => {
  const stmtInsertHistory = db.prepare(`
    INSERT OR IGNORE INTO history_edits 
    (tx_hash, operator_address, field_changed, block_height, timestamp) 
    VALUES (?, ?, ?, ?, ?)
  `);

  const stmtUpsertValidator = db.prepare(`
    INSERT OR REPLACE INTO validators (operator_address, moniker, details, commission_rate, last_updated)
    VALUES (?, ?, ?, ?, ?)
  `);

  let insertedCount = 0;

  const runTransaction = db.transaction(() => {
    for (const tx of txs) {
      const body = tx.tx?.body || tx.body;
      if (!body || !body.messages) continue;

      const msg = body.messages.find(m => m['@type'].includes('MsgCreateValidator'));
      if (!msg) continue;

      const validatorAddr = msg.validator_address;
      const height = parseInt(tx.height || 0);
      const changesDiff = {};

      // 1. Build Changes Diff (Initial State)
      if (msg.commission && msg.commission.rate) {
        changesDiff['commission_rate'] = { from: '0', to: msg.commission.rate };
      }

      if (msg.min_self_delegation) {
        changesDiff['min_self_delegation'] = { from: '0', to: msg.min_self_delegation };
      }

      const desc = msg.description || {};
      
      if (desc.moniker) changesDiff['moniker'] = { from: 'N/A', to: desc.moniker };
      if (desc.website) changesDiff['website'] = { from: 'N/A', to: desc.website };
      if (desc.identity) changesDiff['identity'] = { from: 'N/A', to: desc.identity };
      if (desc.details) changesDiff['details'] = { from: 'N/A', to: desc.details };
      if (desc.security_contact) changesDiff['security_contact'] = { from: 'N/A', to: desc.security_contact };

      // 2. Insert into History
      if (Object.keys(changesDiff).length > 0) {
        const result = stmtInsertHistory.run(
          tx.txhash,
          validatorAddr,
          JSON.stringify(changesDiff),
          height,
          tx.timestamp
        );
        insertedCount += result.changes;
      }

      // 3. Upsert Validator State
      const detailsJson = JSON.stringify({
        website: desc.website || '',
        identity: desc.identity || '',
        details: desc.details || '',
        security_contact: desc.security_contact || ''
      });

      stmtUpsertValidator.run(
        validatorAddr,
        desc.moniker || 'Unknown',
        detailsJson,
        msg.commission?.rate || '0',
        tx.timestamp
      );
    }
  });

  runTransaction();
  return insertedCount;
};