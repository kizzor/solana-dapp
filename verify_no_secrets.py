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
    
    # Environment-file style assignment: UPPER_SNAKE name ending in a sensitive
    # word, at the start of a line. Deliberately narrow: the old loose pattern
    # matched JSX props (`key={id}`) and produced ~250 unreadable false positives.
    (
        r'(?m)^\s*(?:export\s+)?[A-Z][A-Z0-9_]*(?:SECRET|TOKEN|KEY|PASSWORD|CREDENTIAL)[A-Z0-9_]*\s*=\s*["\']?[A-Za-z0-9_\-./:+=]{8,}',
        "ENV_SECRET",
    ),
]

# Files/dirs to exclude. `.env*` and the local harness are excluded on purpose:
# this script is run inside LLM sessions, and printing anything from those files
# (even a "preview") is exactly the leak this project forbids.
EXCLUDE_FILES = [
    "package-lock.json",
    ".gitignore",
    "node_modules",
    ".git",
    ".tmp-explore",
    ".next",
    "artifacts",
    "cache",
    "out",
    "dist",
    "build",
    "__pycache__",
]

# Generated files: never secrets, and they produce false positives that bury
# the real findings (a .tsbuildinfo is one long line of numbers).
SKIP_SUFFIXES = (".tsbuildinfo", ".map", ".log", ".min.js", ".csv", ".png", ".jpg", ".pdf")

# A value that is code, not a literal: `KEY=process.env.X`, `TOKEN=${x}`,
# `SECRET=<redacted>`, documentation placeholders, env lookups, etc.
NOT_A_LITERAL = (
    "process.env", "import.meta.env", "os.environ", "getenv", "${{", "${", "%s",
    "<", ">", "...", "\u2026", "redacted", "placeholder", "xxx", "your_", "example",
)


def is_excluded(file):
    return (
        file in EXCLUDE_FILES
        or file == ".env"
        or file.startswith(".env.")
        or file.endswith(SKIP_SUFFIXES)
    )

def scan_file(filepath):
    """Scan a file for potential secrets"""
    findings = []
    
    try:
        with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
            content = f.read()
        
        for pattern, secret_type in SECRET_PATTERNS:
            # ENV_SECRET is case-sensitive on purpose: IGNORECASE made camelCase
            # fields (`virtualTokenReserve = ...`) look like env assignments.
            flags = 0 if secret_type == "ENV_SECRET" else re.IGNORECASE
            matches = re.finditer(pattern, content, flags)
            for match in matches:
                if secret_type == "ENV_SECRET":
                    if any(tok in match.group().lower() for tok in NOT_A_LITERAL):
                        continue
                    # ALL_CAPS_WITH_UNDERSCORES is a placeholder name, not a
                    # literal: real tokens carry digits / mixed case.
                    value = re.split(r"\s*=\s*", match.group(), 1)[1].strip().strip("'\"")
                    if value.isupper() and value.replace("_", "").isalpha():
                        continue
                # Get line number. NEVER store the matched text: a finding must be
                # reportable to a human (and to a model) without carrying the value.
                line_num = content[:match.start()].count('\n') + 1
                findings.append({
                    "file": filepath,
                    "line": line_num,
                    "type": secret_type,
                    "length": len(match.group()),
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
            if is_excluded(file):
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
            # No preview, no value, not even masked characters: file:line + type
            # + match length is enough to fix it and safe to paste anywhere.
            print(f"  [{finding['type']}] {rel_path}:{finding['line']} ({finding['length']} chars)")
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
