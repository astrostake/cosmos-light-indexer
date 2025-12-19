import { convertToValoper, normalizeVoteOption } from '../utils.js';

export const processVote = (db, txs, chainConfig) => {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO history_votes 
    (tx_hash, proposal_id, operator_address, vote_option, timestamp) 
    VALUES (?, ?, ?, ?, ?)
  `);

  const stmtCheckValidator = db.prepare('SELECT 1 FROM validators WHERE operator_address = ?');

  let insertedCount = 0; 

  const runTransaction = db.transaction(() => {
    for (const tx of txs) {
      const body = tx.tx?.body || tx.body; 
      if (!body || !body.messages) continue;

      const msg = body.messages.find(m => 
        m['@type'].includes('MsgVote') || m['@type'].includes('MsgVoteWeighted')
      );
      
      if (!msg) continue;

      const voterAddr = msg.voter; 
      const valoperAddr = convertToValoper(voterAddr, chainConfig.prefix_val);
      
      if (!valoperAddr) continue;

      // Verify validator existence
      const isValidValidator = stmtCheckValidator.get(valoperAddr);
      if (!isValidValidator) continue;

      const option = normalizeVoteOption(msg.option);
      const proposalId = msg.proposal_id;

      const result = stmt.run(
        tx.txhash,
        proposalId,
        valoperAddr,
        option,
        tx.timestamp
      );

      insertedCount += result.changes;
    }
  });

  runTransaction();
  return insertedCount;
};