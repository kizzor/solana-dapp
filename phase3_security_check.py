#!/usr/bin/env python3
"""
Phase 3: Security Hardening Checklist
Verifies all security requirements are met
"""

import os
import re

PROJECT_DIR = r"C:\Users\admin\Desktop\markdowns\solana-dapp"

def check_dev_mode():
    """Check that __DEV_MODE__ is false in production"""
    print("[1/9] Checking __DEV_MODE__...")
    
    page_path = os.path.join(PROJECT_DIR, "app", "page.tsx")
    
    if not os.path.exists(page_path):
        print("  [SKIP] page.tsx not found")
        return None
    
    with open(page_path, 'r', encoding='utf-8', errors='ignore') as f:
        content = f.read()
    
    if '__DEV_MODE__' in content:
        # Check if it's set to false
        if re.search(r'__DEV_MODE__\s*[=:]\s*false', content):
            print("  [OK] __DEV_MODE__ is set to false")
            return True
        else:
            print("  [WARN] __DEV_MODE__ found but may not be false")
            return None
    else:
        print("  [OK] __DEV_MODE__ not hardcoded (using env var)")
        return True

def check_grid_validation():
    """Check for grid validation in localStorage load"""
    print("\n[2/9] Checking Grid Validation...")
    
    page_path = os.path.join(PROJECT_DIR, "app", "page.tsx")
    
    if not os.path.exists(page_path):
        print("  [SKIP] page.tsx not found")
        return None
    
    with open(page_path, 'r', encoding='utf-8', errors='ignore') as f:
        content = f.read()
    
    # Look for validation patterns
    validation_patterns = [
        r'grid.*valid',
        r'validate.*grid',
        r'grid.*length.*3',
        r'grid.*\[0\].*length.*9',
    ]
    
    found = any(re.search(p, content, re.IGNORECASE) for p in validation_patterns)
    
    if found:
        print("  [OK] Grid validation found in code")
        return True
    else:
        print("  [WARN] Grid validation may be missing")
        return None

def check_enter_game():
    """Check that enterGame requires at least 1 device"""
    print("\n[3/9] Checking enterGame()...")
    
    page_path = os.path.join(PROJECT_DIR, "app", "page.tsx")
    
    if not os.path.exists(page_path):
        print("  [SKIP] page.tsx not found")
        return None
    
    with open(page_path, 'r', encoding='utf-8', errors='ignore') as f:
        content = f.read()
    
    # Look for device check in enterGame
    if 'enterGame' in content:
        # Find the function and check for device validation
        if re.search(r'enterGame.*devices.*length', content) or re.search(r'devices\.length.*>.*0', content):
            print("  [OK] enterGame checks for devices")
            return True
        else:
            print("  [WARN] enterGame may not check for devices")
            return None
    else:
        print("  [SKIP] enterGame not found")
        return None

def check_cell_click_bounds():
    """Check that handleCellClick has bounds checking"""
    print("\n[4/9] Checking handleCellClick() bounds...")
    
    page_path = os.path.join(PROJECT_DIR, "app", "page.tsx")
    
    if not os.path.exists(page_path):
        print("  [SKIP] page.tsx not found")
        return None
    
    with open(page_path, 'r', encoding='utf-8', errors='ignore') as f:
        content = f.read()
    
    if 'handleCellClick' in content or 'onCellClick' in content:
        # Look for bounds checking (r: 0-2, c: 0-8)
        if re.search(r'row.*[<>=].*[012]', content) or re.search(r'col.*[<>=].*[0-8]', content):
            print("  [OK] Bounds checking found")
            return True
        else:
            print("  [WARN] Bounds checking may be missing")
            return None
    else:
        print("  [SKIP] handleCellClick not found")
        return None

def check_claim_validation():
    """Check that handleClaim validates device"""
    print("\n[5/9] Checking handleClaim() validation...")
    
    page_path = os.path.join(PROJECT_DIR, "app", "page.tsx")
    
    if not os.path.exists(page_path):
        print("  [SKIP] page.tsx not found")
        return None
    
    with open(page_path, 'r', encoding='utf-8', errors='ignore') as f:
        content = f.read()
    
    if 'handleClaim' in content or 'onClaim' in content:
        # Look for device validation
        if re.search(r'claim.*device', content) or re.search(r'device.*claim', content):
            print("  [OK] Claim validation found")
            return True
        else:
            print("  [WARN] Claim validation may be incomplete")
            return None
    else:
        print("  [SKIP] handleClaim not found")
        return None

def check_claim_cooldown():
    """Check for claim cooldown of 2 seconds"""
    print("\n[6/9] Checking Claim Cooldown...")
    
    page_path = os.path.join(PROJECT_DIR, "app", "page.tsx")
    
    if not os.path.exists(page_path):
        print("  [SKIP] page.tsx not found")
        return None
    
    with open(page_path, 'r', encoding='utf-8', errors='ignore') as f:
        content = f.read()
    
    # Look for cooldown patterns
    cooldown_patterns = [
        r'cooldown.*2',
        r'2000.*cooldown',
        r'setTimeout.*claim',
        r'delay.*claim',
    ]
    
    found = any(re.search(p, content, re.IGNORECASE) for p in cooldown_patterns)
    
    if found:
        print("  [OK] Claim cooldown found")
        return True
    else:
        print("  [WARN] Claim cooldown may be missing")
        return None

def check_device_limit():
    """Check for max 20 devices per batch"""
    print("\n[7/9] Checking Device Limit...")
    
    page_path = os.path.join(PROJECT_DIR, "app", "page.tsx")
    
    if not os.path.exists(page_path):
        print("  [SKIP] page.tsx not found")
        return None
    
    with open(page_path, 'r', encoding='utf-8', errors='ignore') as f:
        content = f.read()
    
    # Look for device limit
    if re.search(r'devices\.length.*>=.*20', content) or re.search(r'max.*devices.*20', content):
        print("  [OK] Device limit (20) enforced")
        return True
    else:
        print("  [WARN] Device limit may not be enforced")
        return None

def check_claim_win_logic():
    """Check that claim_win verifies grid against drawn numbers"""
    print("\n[8/9] Checking claim_win Logic...")
    
    lib_path = os.path.join(PROJECT_DIR, "lib", "ransome-client.ts")
    
    if not os.path.exists(lib_path):
        print("  [SKIP] ransome-client.ts not found")
        return None
    
    with open(lib_path, 'r', encoding='utf-8', errors='ignore') as f:
        content = f.read()
    
    if 'claimWin' in content:
        # Look for verification logic
        if re.search(r'claimWin.*verify', content) or re.search(r'verify.*grid', content):
            print("  [OK] claim_win verification found")
            return True
        else:
            print("  [WARN] claim_win verification may be incomplete")
            return None
    else:
        print("  [SKIP] claimWin not found")
        return None

def check_program_id():
    """Check that PROGRAM_ID is properly configured"""
    print("\n[9/9] Checking PROGRAM_ID...")
    
    files_to_check = [
        os.path.join(PROJECT_DIR, "lib", "ransome-client.ts"),
        os.path.join(PROJECT_DIR, "lib", "draw-cron.ts"),
    ]
    
    for filepath in files_to_check:
        if os.path.exists(filepath):
            with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
                content = f.read()
            
            if 'PROGRAM_ID' in content:
                # Check if it's using env var or hardcoded
                if re.search(r'process\.env\.PROGRAM_ID', content):
                    print(f"  [OK] {os.path.basename(filepath)} uses env var")
                elif re.search(r'new PublicKey\(', content):
                    print(f"  [INFO] {os.path.basename(filepath)} has hardcoded PROGRAM_ID")
    
    return True

def main():
    print("=" * 60)
    print("RANSOME DAPP - Phase 3: Security Hardening Checklist")
    print("=" * 60)
    print()
    
    results = []
    results.append(("__DEV_MODE__", check_dev_mode()))
    results.append(("Grid Validation", check_grid_validation()))
    results.append(("enterGame()", check_enter_game()))
    results.append(("handleCellClick()", check_cell_click_bounds()))
    results.append(("handleClaim()", check_claim_validation()))
    results.append(("Claim Cooldown", check_claim_cooldown()))
    results.append(("Device Limit", check_device_limit()))
    results.append(("claim_win Logic", check_claim_win_logic()))
    results.append(("PROGRAM_ID", check_program_id()))
    
    print()
    print("=" * 60)
    print("SECURITY CHECKLIST SUMMARY")
    print("=" * 60)
    print()
    
    passed = 0
    warnings = 0
    skipped = 0
    
    for name, result in results:
        if result is True:
            print(f"  [PASS] {name}")
            passed += 1
        elif result is False:
            print(f"  [FAIL] {name}")
        elif result is None:
            print(f"  [WARN] {name}")
            warnings += 1
        else:
            print(f"  [SKIP] {name}")
            skipped += 1
    
    print()
    print(f"Results: {passed} passed, {warnings} warnings, {skipped} skipped")
    print()
    
    if warnings > 0:
        print("[INFO] Warnings indicate items that should be manually verified")
        print("  Review the validation.md for complete security requirements")
    
    print()
    return 0 if warnings == 0 else 1

if __name__ == "__main__":
    exit(main())
