# 🏃 Manual Upgrade Injection

For coordinated upgrades that don't go through governance proposals (emergency upgrades, testnet upgrades, or coordinated off-chain upgrades), you can manually inject upgrade data.

## Quick Start

1. **Create the injection file:**
   ```bash
   cp manual-upgrades.example.json manual-upgrades.json
   nano manual-upgrades.json
   ```

2. **Minimal format (only required fields):**
   ```json
   {
     "lava": [
       {
         "plan_name": "v0.21.0",
         "target_height": 890000
       }
     ]
   }
   ```

3. **Full format (with optional fields):**
   ```json
   {
     "lava": [
       {
         "plan_name": "v0.21.0",
         "target_height": 890000,
         "proposal_id": "MANUAL-001",
         "proposal_title": "Coordinated Upgrade v0.21.0",
         "avg_block_time": 30
       }
     ]
   }
   ```

4. **Run the injector:**
   ```bash
   node inject-manual-upgrades.js
   ```

## Features

* ✅ **Auto-timestamps:** If `proposal_voting_start_time` is not provided, uses current time automatically
* ✅ **Multi-chain support:** Inject upgrades for multiple chains in one file
* ✅ **Real-time ETA calculation:** Automatically calculates upgrade ETA based on current block height
* ✅ **Hot injection:** Can inject while the indexer is running (no restart needed)
* ✅ **Auto-cleanup:** File is automatically archived and deleted after injection
* ✅ **Persistent tracking:** Manual upgrades get the same ETA recalculation as proposal-based upgrades
* ✅ **Historical upgrades:** Support for injecting completed upgrades with actual timestamps

## Field Reference

| Field | Required? | Default | Description |
|-------|-----------|---------|-------------|
| `plan_name` | ✅ Yes | - | Name of the upgrade (e.g., v1.0.0) |
| `target_height` | ✅ Yes | - | Block height when upgrade occurs |
| `proposal_voting_start_time` | ❌ No | Current time | ISO 8601 timestamp (e.g., "2025-01-20T10:00:00Z") |
| `proposal_id` | ❌ No | "MANUAL" | Identifier for tracking |
| `proposal_title` | ❌ No | Same as plan_name | Human-readable description |
| `status` | ❌ No | "scheduled" | "scheduled" or "completed" |
| `avg_block_time` | ❌ No | 6 | Average block time in seconds for ETA calculation |
| `actual_upgrade_time` | ❌ No | Auto-estimated | ISO 8601 timestamp when upgrade actually occurred (for completed upgrades) |

## How It Works

1. **Injection:** Writes upgrade data to `history_upgrades` and `active_upgrade` tables
2. **Auto-detection:** The main indexer (`upgrade.js`) automatically detects manual upgrades in the next sync cycle (max 60 seconds)
3. **ETA tracking:** ETA is recalculated every sync cycle based on current block height and average block time
4. **Status update:** When the chain reaches target height, status automatically changes to "completed" with actual upgrade timestamp

## Usage Examples

### Scheduled Upgrades (Future)

**Minimal:**
```json
{
  "lumen": [
    {
      "plan_name": "v1.5.0",
      "target_height": 950000
    }
  ]
}
```

**With Details:**
```json
{
  "lumen": [
    {
      "plan_name": "v1.5.0",
      "target_height": 950000,
      "proposal_id": "MANUAL-2025-02",
      "proposal_title": "Coordinated Upgrade v1.5.0 - Performance Improvements",
      "status": "scheduled",
      "avg_block_time": 30
    }
  ]
}
```

### Completed Upgrades (Past)

**Without Actual Timestamp (Auto-Estimate):**
```json
{
  "lumen": [
    {
      "plan_name": "v1.4.0",
      "target_height": 875000,
      "proposal_id": "MANUAL-001",
      "proposal_title": "Coordinated Off-Chain Upgrade — v1.4.0",
      "status": "completed"
    }
  ]
}
```

> **Note:** When `actual_upgrade_time` is not provided, the system will:
> 1. Try to fetch the exact block timestamp from the API
> 2. If that fails, estimate based on average block time

**With Actual Timestamp (Precise):**
```json
{
  "lumen": [
    {
      "plan_name": "v1.4.0",
      "target_height": 875000,
      "proposal_id": "MANUAL-001",
      "proposal_title": "Coordinated Off-Chain Upgrade — v1.4.0",
      "status": "completed",
      "actual_upgrade_time": "2025-01-20T15:30:00Z"
    }
  ]
}
```

> **Tip:** Get the exact timestamp from:
> - Block explorer: `https://explorer.network/blocks/875000`
> - API: `curl https://lcd.network/cosmos/base/tendermint/v1beta1/blocks/875000 | jq '.block.header.time'`

### Multiple Upgrades (Mixed States)

```json
{
  "lumen": [
    {
      "plan_name": "v1.3.0",
      "target_height": 800000,
      "proposal_id": "MANUAL-OLD",
      "proposal_title": "Old Upgrade v1.3.0",
      "status": "completed",
      "actual_upgrade_time": "2025-01-10T10:00:00Z"
    },
    {
      "plan_name": "v1.4.0",
      "target_height": 875000,
      "proposal_id": "MANUAL-001",
      "proposal_title": "Recent Upgrade v1.4.0",
      "status": "completed",
      "actual_upgrade_time": "2025-01-20T15:30:00Z"
    },
    {
      "plan_name": "v1.5.0",
      "target_height": 950000,
      "proposal_id": "MANUAL-002",
      "proposal_title": "Upcoming Upgrade v1.5.0",
      "status": "scheduled",
      "avg_block_time": 30
    }
  ]
}
```

### Multiple Chains

```json
{
  "lava": [
    {
      "plan_name": "v0.21.0",
      "target_height": 890000,
      "status": "scheduled"
    }
  ],
  "cosmoshub": [
    {
      "plan_name": "v15-emergency",
      "target_height": 1500000,
      "proposal_id": "EMERGENCY-001",
      "proposal_title": "Emergency Security Patch",
      "status": "completed",
      "actual_upgrade_time": "2025-01-15T12:00:00Z"
    }
  ]
}
```

## Verification

After injection, verify the upgrade was recorded correctly:

### Check Scheduled Upgrades
```bash
# Get active upgrade with ETA
curl http://localhost:3002/lumen/upgrade

# Expected response for scheduled upgrade:
{
  "active": true,
  "plan_name": "v1.5.0",
  "target_height": 950000,
  "current_height": 900000,
  "estimated_time": 1738450800000,
  "info": "MANUAL-002: Upcoming Upgrade v1.5.0"
}
```

### Check Completed Upgrades
```bash
# Get upgrade history
curl http://localhost:3002/lumen/upgrade/history?status=completed

# Expected response:
[
  {
    "plan_name": "v1.4.0",
    "target_height": 875000,
    "actual_upgrade_time": 1737385800000,
    "actual_upgrade_date": "2025-01-20T15:30:00.000Z",
    "proposal_id": "MANUAL-001",
    "proposal_title": "Coordinated Off-Chain Upgrade — v1.4.0",
    "status": "completed"
  }
]
```

### Check All Upgrades
```bash
# Get all upgrade history
curl http://localhost:3002/lumen/upgrade/history?status=all
```

## Status Behavior

| Status | Block Height Condition | `actual_upgrade_time` | Appears in `/upgrade` | Appears in `/upgrade/history` |
|--------|------------------------|----------------------|----------------------|------------------------------|
| `scheduled` | `target_height > current` | `null` | ✅ Yes (with ETA) | ✅ Yes |
| `completed` | `target_height < current` | ✅ Set (auto or manual) | ❌ No | ✅ Yes |

## Tips

1. **For accurate timestamps:** Check block explorer or query the API for exact block time
2. **For old upgrades:** If you don't know the exact time, omit `actual_upgrade_time` and let the system estimate
3. **For testing:** Use completed upgrades to populate historical data
4. **For production:** Always use `status: "completed"` for upgrades that already occurred
5. **Multi-chain injection:** You can inject upgrades for multiple chains in a single run

## Troubleshooting

**Q: I injected a completed upgrade but it shows in active upgrades**  
A: Make sure you set `"status": "completed"` and the `target_height` is less than the current chain height.

**Q: The `actual_upgrade_date` is wrong**  
A: Provide the exact timestamp in `actual_upgrade_time` field using ISO 8601 format.

**Q: Can I inject while the indexer is running?**  
A: Yes! The indexer will detect the new upgrade in the next sync cycle (within 60 seconds).

**Q: How do I get the exact timestamp for a completed upgrade?**  
A: Use the block API: `curl https://lcd.yourchain/cosmos/base/tendermint/v1beta1/blocks/{height} | jq '.block.header.time'`