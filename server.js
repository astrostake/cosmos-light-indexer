import express from 'express';
import cors from 'cors';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const app = express();
const PORT = 3002;

app.use(cors());
app.use(express.json());

// --- Helper Functions ---

const getDB = (chainName) => {
  const cleanName = chainName.replace(/[^a-zA-Z0-9_-]/g, '');
  const dbPath = path.resolve(`./data/${cleanName}.db`);

  if (!fs.existsSync(dbPath)) {
    return null;
  }

  return new Database(dbPath, { readonly: true });
};

// --- API Endpoints ---

app.get('/:chain/validators', (req, res) => {
  const db = getDB(req.params.chain);
  if (!db) return res.status(404).json({ error: "Chain database not found" });

  try {
    const stmt = db.prepare(`
      SELECT operator_address, moniker, details, commission_rate, last_updated 
      FROM validators 
      ORDER BY moniker ASC
    `);
    const validators = stmt.all();

    const parsed = validators.map(v => {
      try {
        return { ...v, details: JSON.parse(v.details || '{}') };
      } catch (e) {
        return { ...v, details: {} };
      }
    });

    res.json(parsed);
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    db.close();
  }
});

app.get('/:chain/validators/:address', (req, res) => {
  const db = getDB(req.params.chain);
  if (!db) return res.status(404).json({ error: "Chain database not found" });

  const addr = req.params.address;

  try {
    const val = db.prepare('SELECT * FROM validators WHERE operator_address = ?').get(addr);
    if (!val) return res.status(404).json({ error: "Validator not found" });

    const unjails = db.prepare(`
      SELECT tx_hash, block_height, timestamp 
      FROM history_unjail 
      WHERE operator_address = ? 
      ORDER BY block_height DESC
    `).all(addr);

    const editsRaw = db.prepare(`
      SELECT tx_hash, field_changed, block_height, timestamp 
      FROM history_edits 
      WHERE operator_address = ? 
      ORDER BY block_height DESC
    `).all(addr);
    
    const edits = editsRaw.map(e => {
      try { return { ...e, field_changed: JSON.parse(e.field_changed) }; } 
      catch { return e; }
    });

    const votes = db.prepare(`
      SELECT proposal_id, vote_option, tx_hash, timestamp 
      FROM history_votes 
      WHERE operator_address = ? 
      ORDER BY timestamp DESC 
      LIMIT 50
    `).all(addr);

    res.json({
      profile: {
        ...val,
        details: JSON.parse(val.details || '{}')
      },
      stats: {
        count_unjails: unjails.length,
        count_edits: edits.length,
        count_votes: votes.length
      },
      history: {
        unjails,
        edits,
        votes
      }
    });

  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    db.close();
  }
});

app.get('/:chain/validators/:addr/delegations-history', (req, res) => {
  const db = getDB(req.params.chain);
  if (!db) return res.status(404).json({ error: "Chain database not found" });

  try {
    const { addr } = req.params;
    const { range } = req.query;

    let sql = `
      SELECT snapshot_date, delegator_count, total_staked 
      FROM history_delegator_stats 
      WHERE operator_address = ?
    `;
    const params = [addr];

    // Handle Date Filtering
    if (range && range !== 'all') {
      const days = parseInt(range);
      if (!isNaN(days) && days > 0) {
        const d = new Date();
        d.setDate(d.getDate() - days);
        const cutoffDate = d.toISOString().split('T')[0]; // Format YYYY-MM-DD

        sql += ` AND snapshot_date >= ?`;
        params.push(cutoffDate);
      }
    }

    // Sort by Date ASC (for Charts)
    sql += ` ORDER BY snapshot_date ASC`;

    const history = db.prepare(sql).all(...params);
    res.json(history);
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    db.close();
  }
});

app.get('/:chain/proposals/:id/votes', (req, res) => {
  const db = getDB(req.params.chain);
  if (!db) return res.status(404).json({ error: "Chain database not found" });

  try {
    const proposalId = req.params.id;

    const stmt = db.prepare(`
      SELECT 
        h.operator_address,
        v.moniker,
        h.vote_option,
        h.tx_hash,
        h.timestamp
      FROM history_votes h
      LEFT JOIN validators v ON h.operator_address = v.operator_address
      WHERE h.proposal_id = ?
      ORDER BY h.timestamp DESC
    `);

    const votes = stmt.all(proposalId);
    const tally = { YES: 0, NO: 0, NO_WITH_VETO: 0, ABSTAIN: 0, UNKNOWN: 0, TOTAL: 0 };

    votes.forEach(v => {
      const opt = v.vote_option || 'UNKNOWN';
      if (tally[opt] !== undefined) {
        tally[opt]++;
      } else {
        tally.UNKNOWN++;
      }
      tally.TOTAL++;
    });

    res.json({
      chain: req.params.chain,
      proposal_id: proposalId,
      summary: tally,
      votes: votes
    });

  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    db.close();
  }
});

app.get('/:chain/stats', (req, res) => {
  const db = getDB(req.params.chain);
  if (!db) return res.status(404).json({ error: "Chain database not found" });

  try {
    const valCount = db.prepare('SELECT count(*) as c FROM validators').get().c;
    const unjailCount = db.prepare('SELECT count(*) as c FROM history_unjail').get().c;
    const voteCount = db.prepare('SELECT count(*) as c FROM history_votes').get().c;

    res.json({
      total_validators: valCount,
      total_unjail_events: unjailCount,
      total_votes_recorded: voteCount
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    db.close();
  }
});

app.get('/:chain/upgrade', (req, res) => {
  const db = getDB(req.params.chain);
  if (!db) return res.status(404).json({ error: "DB not found" });

  try {
    const upgrade = db.prepare('SELECT * FROM active_upgrade ORDER BY target_height DESC LIMIT 1').get();
    const syncStatus = db.prepare('SELECT MAX(last_height) as h FROM sync_status').get();
    const currentHeight = syncStatus ? syncStatus.h : 0;

    if (!upgrade) {
      return res.json({ active: false });
    }

    res.json({
      active: true,
      plan_name: upgrade.plan_name,
      target_height: upgrade.target_height,
      current_height: currentHeight,
      start_time: upgrade.start_time,
      estimated_time: upgrade.estimated_time,
      info: upgrade.info
    });

  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    db.close();
  }
});

app.listen(PORT, () => {
  console.log(`\n🚀 API Server running at http://localhost:${PORT}`);
});