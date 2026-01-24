# 🃏 Manual Upgrade Injection

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

## How It Works

1. **Injection:** Writes upgrade data to `history_upgrades` and `active_upgrade` tables
2. **Auto-detection:** The main indexer (`upgrade.js`) automatically detects manual upgrades in the next sync cycle (max 60 seconds)
3. **ETA tracking:** ETA is recalculated every sync cycle based on current block height and average block time
4. **Status update:** When the chain reaches target height, status automatically changes to "completed" with actual upgrade timestamp

## Multiple Upgrades Example

```json
{
  "lava": [
    {
      "plan_name": "v0.21.0",
      "target_height": 890000
    }
  ],
  "cosmoshub": [
    {
      "plan_name": "v15-emergency",
      "target_height": 1500000,
      "proposal_id": "EMERGENCY-001",
      "proposal_title": "Emergency Security Patch"
    }
  ]
}
```