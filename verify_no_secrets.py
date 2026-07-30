#!/usr/bin/env python3
"""
Phase 1.7: Verify No Secrets Remain in Code
Searches for potential secrets in the codebase
"""

import os
import re

PROJECT_DIR = r"C:\Users\admin\Desktop\markdowns\solana-dapp"

# Patterns to search for (potential secrets)
SECRET_PATTERNS = [
    # Solana private keys (array format)
    (r'\[\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*\d{1,3}){30,62}\s*\]', "PRIVATE_KEY_ARRAY"),
    
    # Vercel tokens
    (r'\bvcp_[A-Za-z0-9_-]{20,}\b', "VERCEL_TOKEN"),
    
    # Generic API keys
    (r'(?:api[_-]?key|API[_-]?KEY)\s*[=:]\s*["\']?[A-Za-z0-9_-]{16,}["\']?', "API_KEY"),
    
    # Private keys
    (r'(?:private|secret|priv|sk)[_-]?(?:key|KEY)?\s*[=:]\s*["\']?[0-9a-fA-F]{32,}["\']?', "PRIVATE_KEY_HEX"),
    
    # JWT tokens
    (r'\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b', "JWT_TOKEN"),
    
    # SSH private keys
    (r'-----BEGIN (?:RSA |EC )?PRIVATE KEY-----', "SSH_PRIVATE_KEY"),
    
    # Environment variable assignments with sensitive values
    (r'(?:SECRET|TOKEN|KEY|PASSWORD|CREDENTIAL)\s*=\s*["\']?[^\s"\']+["\']?', "ENV_SECRET"),
]

# Files to exclude
EXCLUDE_FILES = [
    "package-lock.json",
    ".gitignore",
    "node_modules",
    ".git",
]

def scan_file(filepath):
    """Scan a file for potential secrets"""
    findings = []
    
    try:
        with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
            content = f.read()
        
        for pattern, secret_type in SECRET_PATTERNS:
            matches = re.finditer(pattern, content, re.IGNORECASE)
            for match in matches:
                # Get line number
                line_num = content[:match.start()].count('\n') + 1
                findings.append({
                    "file": filepath,
                    "line": line_num,
                    "type": secret_type,
                    "match": match.group()[:50] + "..." if len(match.group()) > 50 else match.group()
                })
    except Exception as e:
        pass
    
    return findings

def main():
    print("=" * 60)
    print("RANSOME DAPP - Secret Scanner")
    print("=" * 60)
    print()
    print(f"Scanning: {PROJECT_DIR}")
    print()
    
    all_findings = []
    
    # Walk through project directory
    for root, dirs, files in os.walk(PROJECT_DIR):
        # Skip excluded directories
        dirs[:] = [d for d in dirs if d not in EXCLUDE_FILES]
        
        for file in files:
            if file in EXCLUDE_FILES:
                continue
            
            filepath = os.path.join(root, file)
            findings = scan_file(filepath)
            all_findings.extend(findings)
    
    # Report findings
    if all_findings:
        print(f"[WARNING] Found {len(all_findings)} potential secrets:")
        print()
        
        for finding in all_findings:
            rel_path = os.path.relpath(finding['file'], PROJECT_DIR)
            print(f"  [{finding['type']}] {rel_path}:{finding['line']}")
            print(f"    Preview: {finding['match']}")
            print()
    else:
        print("[OK] No potential secrets found in codebase!")
    
    print()
    print("=" * 60)
    print("SCAN COMPLETE")
    print("=" * 60)
    
    return len(all_findings)

if __name__ == "__main__":
    exit_code = main()
    exit(1 if exit_code > 0 else 0)
