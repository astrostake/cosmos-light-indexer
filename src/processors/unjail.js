export const processUnjail = (db, txs) => {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO history_unjail 
    (tx_hash, operator_address, block_height, timestamp) 
    VALUES (?, ?, ?, ?)
  `);

  let insertedCount = 0;

  const runTransaction = db.transaction(() => {
    for (const tx of txs) {
      const body = tx.tx?.body || tx.body;
      if (!body || !body.messages) continue;

      const msg = body.messages.find(m => m['@type'].includes('MsgUnjail'));
      if (!msg) continue;

      const result = stmt.run(
        tx.txhash,
        msg.validator_addr, 
        parseInt(tx.height || 0),
        tx.timestamp
      );
      insertedCount += result.changes;
    }
  });
  
  runTransaction();
  return insertedCount;
};