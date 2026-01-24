import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import yaml from 'js-yaml';

const MANUAL_UPGRADES_FILE = './manual-upgrades.json';
const CONFIG_FILE = './config.yaml';

console.log('🔧 Manual Upgrade Injector\n');

// 1. Load Config
if (!fs.existsSync(CONFIG_FILE)) {
  console.error('❌ config.yaml not found!');
  process.exit(1);
}

const config = yaml.load(fs.readFileSync(CONFIG_FILE, 'utf8'));

// 2. Check if manual-upgrades.json exists
if (!fs.existsSync(MANUAL_UPGRADES_FILE)) {
  console.log('ℹ️  No manual-upgrades.json found. Nothing to inject.');
  console.log('\n📝 Create manual-upgrades.json with this format:');
  console.log(JSON.stringify({
    "chain-name": [
      {
        "plan_name": "v1.0.0",
        "target_height": 1234567,
        "proposal_voting_start_time": "2025-01-20T10:00:00Z",
        "proposal_id": "MANUAL",
        "proposal_title": "Manual Coordinated Upgrade",
        "status": "scheduled"
      }
    ]
  }, null, 2));
  process.exit(0);
}

// 3. Load manual upgrades
let manualUpgrades;
try {
  manualUpgrades = JSON.parse(fs.readFileSync(MANUAL_UPGRADES_FILE, 'utf8'));
} catch (e) {
  console.error('❌ Failed to parse manual-upgrades.json:', e.message);
  process.exit(1);
}

// 4. Inject to databases
let totalInjected = 0;

for (const chain of config.chains) {
  const chainName = chain.name;
  const dbPath = path.resolve(chain.db_file);
  
  if (!fs.existsSync(dbPath)) {
    console.log(`⚠️  Database not found for ${chainName}: ${dbPath}`);
    continue;
  }
  
  const upgrades = manualUpgrades[chainName];
  if (!upgrades || upgrades.length === 0) {
    console.log(`ℹ️  No manual upgrades for ${chainName}`);
    continue;
  }
  
  const db = new Database(dbPath);
  
  const stmtInsert = db.prepare(`
    INSERT OR REPLACE INTO history_upgrades
    (plan_name, target_height, actual_upgrade_time, proposal_voting_start_time, proposal_id, proposal_title, status)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  
  const stmtActiveUpgrade = db.prepare(`
    INSERT OR REPLACE INTO active_upgrade 
    (plan_name, target_height, start_time, estimated_time, info, last_checked)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `);
  
  // Get current chain height
  const syncStatus = db.prepare('SELECT MAX(last_height) as h FROM sync_status').get();
  const currentHeight = syncStatus ? syncStatus.h : 0;
  
  console.log(`\n🔄 Processing ${chainName}... (Current Height: ${currentHeight})`);
  
  for (const upgrade of upgrades) {
    try {
      const votingStartTime = upgrade.proposal_voting_start_time 
        ? new Date(upgrade.proposal_voting_start_time).getTime() 
        : Date.now();
      
      stmtInsert.run(
        upgrade.plan_name,
        upgrade.target_height,
        null, // actual_upgrade_time (belum terjadi)
        votingStartTime,
        upgrade.proposal_id || 'MANUAL',
        upgrade.proposal_title || upgrade.plan_name,
        upgrade.status || 'scheduled'
      );
      
      console.log(`   ✅ Injected to history: ${upgrade.plan_name} @ height ${upgrade.target_height}`);
      
      // Also update active_upgrade if upgrade hasn't passed yet
      if (upgrade.target_height > currentHeight) {
        // Calculate ETA (assume 6 second block time as default)
        const blocksRemaining = upgrade.target_height - currentHeight;
        const avgBlockTime = upgrade.avg_block_time || 6; // seconds
        const estimatedTime = Date.now() + (blocksRemaining * avgBlockTime * 1000);
        
        stmtActiveUpgrade.run(
          upgrade.plan_name,
          upgrade.target_height,
          votingStartTime,
          estimatedTime,
          `${upgrade.proposal_id}: ${upgrade.proposal_title}`
        );
        
        console.log(`   🎯 Set as active upgrade (ETA: ${new Date(estimatedTime).toISOString()})`);
      } else {
        console.log(`   ⏭️  Upgrade already passed (height ${currentHeight} > ${upgrade.target_height})`);
      }
      
      totalInjected++;
      
    } catch (e) {
      console.error(`   ❌ Failed to inject ${upgrade.plan_name}:`, e.message);
    }
  }
  
  db.close();
}

// 5. Archive and delete the JSON file
if (totalInjected > 0) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const archivePath = `./manual-upgrades.${timestamp}.json.bak`;
  
  fs.copyFileSync(MANUAL_UPGRADES_FILE, archivePath);
  fs.unlinkSync(MANUAL_UPGRADES_FILE);
  
  console.log(`\n✅ Total injected: ${totalInjected} upgrade(s)`);
  console.log(`📦 Archived to: ${archivePath}`);
  console.log(`🗑️  Deleted: ${MANUAL_UPGRADES_FILE}`);
  console.log('\n💡 You can create a new manual-upgrades.json for future injections.');
} else {
  console.log('\n⚠️  No upgrades were injected. File kept.');
}