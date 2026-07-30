#!/usr/bin/env python3
"""
Phase 4: Mainnet Deployment Script
Provides deployment commands and verification steps
"""

import os

PROJECT_DIR = r"C:\Users\admin\Desktop\markdowns\solana-dapp"

def print_header(title):
    print()
    print("=" * 60)
    print(title)
    print("=" * 60)
    print()

def main():
    print_header("RANSOME DAPP - Phase 4: Mainnet Deployment Guide")
    
    print("PRE-DEPLOY CHECKLIST:")
    print("-" * 40)
    print("[ ] All Phase 3 security checks passed")
    print("[ ] Devnet testing complete")
    print("[ ] New authority has SOL on mainnet (~0.3 SOL)")
    print("[ ] Helius mainnet RPC key created")
    print("[ ] Domain DNS pointing to Vercel")
    print()
    
    print_header("DEPLOYMENT STEPS")
    
    print("Step 1: Deploy Solana Program to Mainnet")
    print("-" * 40)
    print("  cd solana-dapp")
    print("  anchor deploy --provider.cluster mainnet")
    print()
    print("  Note: Update PROGRAM_ID in source files after deploy")
    print()
    
    print("Step 2: Initialize Mainnet Session")
    print("-" * 40)
    print("  # Set environment variables first")
    print("  export SESSION_AUTHORITY=<new-public-key>")
    print("  export AUTHORITY_KEYPAIR=<secret-key-array>")
    print()
    print("  # Run session initialization")
    print("  node init-session.mjs")
    print()
    
    print("Step 3: Update Source Code")
    print("-" * 40)
    print("  # Update PROGRAM_ID in:")
    print("  #   - lib/ransome-client.ts")
    print("  #   - lib/draw-cron.ts")
    print("  #   - public/ransome-lib.rs")
    print()
    
    print("Step 4: Push to GitHub")
    print("-" * 40)
    print("  git add -A")
    print("  git commit -m 'mainnet deploy'")
    print("  git push")
    print()
    
    print("Step 5: Deploy to Vercel")
    print("-" * 40)
    print("  npx vercel --token <NEW_VERCEL_TOKEN> --yes --prod")
    print()
    
    print_header("POST-DEPLOY VERIFICATION")
    
    print("Step 6: Verify Session is Live")
    print("-" * 40)
    print("  curl -s https://ransomematrix.xyz/api/session-state | jq .")
    print()
    
    print("Step 7: Verify Draw Works")
    print("-" * 40)
    print("  curl -s -H 'Authorization: Bearer <NEW_CRON_SECRET>' \\")
    print("    https://ransomematrix.xyz/api/draw | jq .")
    print()
    
    print_header("ENVIRONMENT VARIABLES TO SET")
    
    print("  VERCEL:")
    print("    - RPC_URL = https://mainnet.helius-rpc.com/?api-key=<NEW_KEY>")
    print("    - SESSION_AUTHORITY = <new-public-key>")
    print("    - CRON_SECRET = <new-random-hex>")
    print("    - AUTHORITY_KEYPAIR = <new-keypair-array>")
    print()
    print("  GITHUB ACTIONS:")
    print("    - CRON_SECRET = <new-random-hex>")
    print("    - VERCEL_TOKEN = <new-vercel-token>")
    print()
    
    print_header("IMPORTANT NOTES")
    
    print("  1. NEVER commit secrets to git")
    print("  2. NEVER expose secrets to LLMs")
    print("  3. ALWAYS use environment variables for secrets")
    print("  4. ALWAYS verify after deployment")
    print("  5. OLD KEYPAIR IS WORTHLESS after rotation")
    print()

if __name__ == "__main__":
    main()
