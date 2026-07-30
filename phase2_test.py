#!/usr/bin/env python3
"""
Phase 2: Test Script for RANSOME DAPP
Tests API endpoints and verifies configuration
"""

import os
import json
import subprocess

PROJECT_DIR = r"C:\Users\admin\Desktop\markdowns\solana-dapp"

def test_env_variables():
    """Test that required environment variables are set"""
    print("[1/4] Testing Environment Variables...")
    
    env_file = os.path.join(PROJECT_DIR, ".env.local")
    
    if not os.path.exists(env_file):
        print("  [FAIL] .env.local not found")
        print("  [FIX] Run phase1_rotate_secrets.py first")
        return False
    
    with open(env_file, 'r') as f:
        content = f.read()
    
    required_vars = ['RPC_URL', 'SESSION_AUTHORITY', 'AUTHORITY_KEYPAIR', 'CRON_SECRET']
    missing = []
    
    for var in required_vars:
        if var not in content:
            missing.append(var)
        elif 'REPLACE_WITH' in content:
            missing.append(f"{var} (not updated)")
    
    if missing:
        print(f"  [FAIL] Missing or unconfigured variables: {', '.join(missing)}")
        return False
    
    print("  [OK] All environment variables configured")
    return True

def test_gitignore():
    """Test that .env.local is in .gitignore"""
    print("\n[2/4] Testing .gitignore...")
    
    gitignore_path = os.path.join(PROJECT_DIR, ".gitignore")
    
    if not os.path.exists(gitignore_path):
        print("  [FAIL] .gitignore not found")
        return False
    
    with open(gitignore_path, 'r') as f:
        content = f.read()
    
    if '.env' in content or '.env.local' in content:
        print("  [OK] .env files are in .gitignore")
        return True
    else:
        print("  [FAIL] .env files are NOT in .gitignore")
        print("  [FIX] Add '.env*' to .gitignore")
        return False

def test_vercel_cron():
    """Test that vercel.json has correct cron schedule"""
    print("\n[3/4] Testing Vercel Cron Configuration...")
    
    vercel_path = os.path.join(PROJECT_DIR, "vercel.json")
    
    if not os.path.exists(vercel_path):
        print("  [FAIL] vercel.json not found")
        return False
    
    with open(vercel_path, 'r') as f:
        content = f.read()
    
    if '* * * * *' in content:
        print("  [OK] Cron set to run every minute")
        return True
    else:
        print("  [FAIL] Cron not set to run every minute")
        return False

def test_api_routes():
    """Test that API routes exist"""
    print("\n[4/4] Testing API Routes...")
    
    routes = [
        os.path.join(PROJECT_DIR, "app", "api", "draw", "route.ts"),
        os.path.join(PROJECT_DIR, "app", "api", "session-state", "route.ts"),
    ]
    
    all_exist = True
    for route in routes:
        if os.path.exists(route):
            print(f"  [OK] {os.path.relpath(route, PROJECT_DIR)}")
        else:
            print(f"  [FAIL] {os.path.relpath(route, PROJECT_DIR)} not found")
            all_exist = False
    
    return all_exist

def main():
    print("=" * 60)
    print("RANSOME DAPP - Phase 2: Pre-Test Verification")
    print("=" * 60)
    print()
    
    results = []
    results.append(("Environment Variables", test_env_variables()))
    results.append(("Gitignore", test_gitignore()))
    results.append(("Vercel Cron", test_vercel_cron()))
    results.append(("API Routes", test_api_routes()))
    
    print()
    print("=" * 60)
    print("RESULTS SUMMARY")
    print("=" * 60)
    print()
    
    all_pass = True
    for name, passed in results:
        status = "[PASS]" if passed else "[FAIL]"
        print(f"  {status} {name}")
        if not passed:
            all_pass = False
    
    print()
    if all_pass:
        print("[SUCCESS] All pre-test checks passed!")
        print()
        print("Next Steps:")
        print("  1. Install dependencies: npm install")
        print("  2. Start dev server: npm run dev")
        print("  3. Open http://localhost:3000")
        print("  4. Connect Phantom wallet (devnet)")
        print("  5. Test full game flow")
    else:
        print("[WARNING] Some checks failed - fix issues before testing")
    
    print()
    return 0 if all_pass else 1

if __name__ == "__main__":
    exit(main())
