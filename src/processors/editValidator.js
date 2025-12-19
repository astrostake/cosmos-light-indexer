export const processEditValidator = (db, txs, chainConfig) => {
  const editTxs = txs
    .map(t => ({ 
      tx: t, 
      msg: (t.tx?.body?.messages || t.body?.messages || []).find(m => m['@type'].includes('MsgEditValidator')) 
    }))
    .filter(item => item.msg);

  if (editTxs.length === 0) return 0;

  const stmtInsertHistory = db.prepare(`
    INSERT OR REPLACE INTO history_edits 
    (tx_hash, operator_address, field_changed, block_height, timestamp) 
    VALUES (?, ?, ?, ?, ?)
  `);

  const stmtFindLastFieldChange = db.prepare(`
    SELECT field_changed 
    FROM history_edits 
    WHERE operator_address = ? 
      AND block_height < ? 
      AND json_extract(field_changed, '$.' || ?) IS NOT NULL
    ORDER BY block_height DESC 
    LIMIT 1
  `);

  const stmtUpsertValidator = db.prepare(`
    INSERT OR REPLACE INTO validators (operator_address, moniker, details, commission_rate, last_updated)
    VALUES (?, ?, ?, ?, ?)
  `);

  const DO_NOT_MODIFY = "[do-not-modify]";
  let insertedCount = 0;

  const runTransaction = db.transaction(() => {
    for (const { tx, msg } of editTxs) {
      const validatorAddr = msg.validator_address;
      const height = parseInt(tx.height || 0);

      const getPrevValue = (fieldName) => {
        const prevRow = stmtFindLastFieldChange.get(validatorAddr, height, fieldName);
        if (!prevRow) return 'N/A';
        try {
          const json = JSON.parse(prevRow.field_changed);
          return json[fieldName]?.to || 'N/A';
        } catch (e) { return 'N/A'; }
      };

      const changesDiff = {};

      const processField = (fieldName, txValue) => {
        const prevVal = getPrevValue(fieldName);
        if (txValue && txValue !== DO_NOT_MODIFY && txValue !== prevVal) {
          changesDiff[fieldName] = { from: prevVal, to: txValue };
          return txValue;
        }
        return prevVal;
      };

      // 1. Commission Logic
      let prevComm = getPrevValue('commission_rate');
      if (prevComm === 'N/A') prevComm = '0';
      
      const txComm = msg.commission_rate;
      let finalCommission = prevComm;

      if (txComm && txComm !== DO_NOT_MODIFY && txComm !== prevComm) {
        changesDiff['commission_rate'] = { from: prevComm, to: txComm };
        finalCommission = txComm;
      }

      // 2. Min Self Delegation Logic
      const prevMinSelf = getPrevValue('min_self_delegation');
      if (msg.min_self_delegation && msg.min_self_delegation !== DO_NOT_MODIFY && msg.min_self_delegation !== prevMinSelf) {
        changesDiff['min_self_delegation'] = { 
          from: prevMinSelf, 
          to: msg.min_self_delegation 
        };
      }

      // 3. Description/Details Logic
      const msgDesc = msg.description || {};
      const finalMoniker = processField('moniker', msgDesc.moniker);
      const finalWebsite = processField('website', msgDesc.website);
      const finalIdentity = processField('identity', msgDesc.identity);
      const finalDetails = processField('details', msgDesc.details);
      const finalSecurity = processField('security_contact', msgDesc.security_contact);

      // 4. Insert History
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

      // 5. Update Snapshot
      const safeVal = (v) => v === 'N/A' ? '' : v;
      
      stmtUpsertValidator.run(
        validatorAddr,
        safeVal(finalMoniker),
        JSON.stringify({
          website: safeVal(finalWebsite),
          identity: safeVal(finalIdentity),
          details: safeVal(finalDetails),
          security_contact: safeVal(finalSecurity)
        }),
        finalCommission,
        tx.timestamp
      );
    }
  });

  runTransaction();
  return insertedCount;
};