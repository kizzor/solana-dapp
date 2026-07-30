#!/usr/bin/env python3
"""
Phase 5: Monitoring Setup
Creates monitoring scripts and checklists
"""

import os
from datetime import datetime

PROJECT_DIR = r"C:\Users\admin\Desktop\markdowns\solana-dapp"

def print_header(title):
    print()
    print("=" * 60)
    print(title)
    print("=" * 60)
    print()

def main():
    print_header("RANSOME DAPP - Phase 5: Monitoring Setup")
    
    print("DAILY CHECKS:")
    print("-" * 40)
    print("[ ] Vercel function logs show no errors")
    print("[ ] GitHub Actions cron is firing successfully")
    print("[ ] Session account shows correct vault balance")
    print("[ ] No unexpected transactions on authority wallet")
    print()
    
    print("AFTER EACH BATCH (58-minute cycle):")
    print("-" * 40)
    print("[ ] Session resets properly (58-min timeout or 90 draws)")
    print("[ ] Unclaimed funds sweep to treasury")
    print("[ ] New session initializes for next batch")
    print()
    
    print_header("MONITORING COMMANDS")
    
    print("Check Vercel Logs:")
    print("-" * 40)
    print("  vercel logs --token <VERCEL_TOKEN>")
    print()
    
    print("Check Session State:")
    print("-" * 40)
    print("  curl -s https://ransomematrix.xyz/api/session-state | jq .")
    print()
    
    print("Check Authority Balance:")
    print("-" * 40)
    print("  solana balance <AUTHORITY_PUBKEY> --url mainnet-beta")
    print()
    
    print("Check Vault Balance:")
    print("-" * 40)
    print("  solana balance <VAULT_PDA> --url mainnet-beta")
    print()
    
    print_header("ALERT THRESHOLDS")
    
    print("  WARNING:")
    print("    - Vault balance drops below 0.5 SOL")
    print("    - More than 3 failed draws in an hour")
    print("    - Session age exceeds 59 minutes without reset")
    print()
    print("  CRITICAL:")
    print("    - Vault balance reaches 0 SOL")
    print("    - Authority wallet has unexpected transactions")
    print("    - API endpoints return errors")
    print()
    
    print_header("LOG FILE")
    
    log_path = os.path.join(PROJECT_DIR, "monitoring_log.md")
    
    with open(log_path, 'w', encoding='utf-8') as f:
        f.write(f"""# RANSOME DAPP - Monitoring Log

## Started: {datetime.now().isoformat()}

---

## Daily Checks

### {datetime.now().strftime('%Y-%m-%d')}

- [ ] Vercel function logs checked
- [ ] GitHub Actions cron verified
- [ ] Session balance verified
- [ ] Authority wallet checked

---

## Batch Cycles

| Time | Session Reset | Vault Sweep | Status |
|------|---------------|-------------|--------|
|      |               |             |        |

---

## Incidents

| Date | Issue | Resolution |
|------|-------|------------|
|      |       |            |

---

## Notes

- Monitor vault balance regularly
- Check for failed draw transactions
- Verify session resets every 58 minutes
- Watch for unauthorized transactions on authority wallet

""")
    
    print(f"  Created: {log_path}")
    print()
    
    print_header("SUMMARY")
    
    print("  All 5 phases completed:")
    print("    [✓] Phase 1: Rotate All Exposed Secrets")
    print("    [✓] Phase 2: Rebuild & Test on Devnet")
    print("    [✓] Phase 3: Security Hardening Checklist")
    print("    [✓] Phase 4: Mainnet Deployment")
    print("    [✓] Phase 5: Monitoring Setup")
    print()
    print("  Files Created:")
    print("    - phase1_rotate_secrets.py")
    print("    - phase2_test.py")
    print("    - phase3_security_check.py")
    print("    - phase4_deploy.py")
    print("    - phase5_monitor.py")
    print("    - init-session.mjs")
    print("    - verify_no_secrets.py")
    print("    - monitoring_log.md")
    print()

if __name__ == "__main__":
    main()
