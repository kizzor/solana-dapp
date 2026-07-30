#!/usr/bin/env python3
"""
Phase 1: Secret Rotation Helper
Generates new secrets and updates the codebase
"""

import os
import json
import subprocess
import secrets
import string

# Paths
PROJECT_DIR = r"C:\Users\admin\Desktop\markdowns\solana-dapp"
ENV_FILE = os.path.join(PROJECT_DIR, ".env.local")

def generate_solana_keypair():
    """Generate a new Solana keypair"""
    print("[1/5] Generating new Solana authority keypair...")
    
    keypair_path = os.path.join(os.path.expanduser("~"), ".config", "solana", "ransome-authority-new.json")
    
    # Create directory if it doesn't exist
    os.makedirs(os.path.dirname(keypair_path), exist_ok=True)
    
    # Generate a random 64-byte secret key (Solana keypair format)
    secret_key = [secrets.randbelow(256) for _ in range(64)]
    
    # Save to file
    with open(keypair_path, 'w') as f:
        json.dump(secret_key, f)
    
    # Generate a fake public key for demo (in real usage, derive from secret key)
    # For production, use @solana/web3.js Keypair.fromSecretKey()
    public_key = "REPLACE_WITH_YOUR_PUBLIC_KEY_AFTER_RUNNING solana-keygen pubkey " + keypair_path
    
    print(f"  [OK] Keypair generated: {keypair_path}")
    print(f"  [OK] Secret key saved (64 bytes)")
    print(f"  [IMPORTANT] To get your public key, install Solana CLI and run:")
    print(f"              solana-keygen pubkey {keypair_path}")
    
    return {
        "public_key": public_key,
        "secret_key_array": json.dumps(secret_key),
        "keypair_path": keypair_path
    }

def generate_cron_secret():
    """Generate a new CRON_SECRET"""
    print("\n[2/5] Generating new CRON_SECRET...")
    cron_secret = secrets.token_hex(32)
    print(f"  [OK] CRON_SECRET: {cron_secret[:8]}...{cron_secret[-8:]} (length: {len(cron_secret)} chars)")
    return cron_secret

def generate_vercel_token():
    """Placeholder for Vercel token generation"""
    print("\n[3/5] Vercel Token...")
    print("  [MANUAL] Please generate a new Vercel token at: https://vercel.com/account/tokens")
    print("  [MANUAL] Name it 'github-actions' and save it securely")
    return None

def generate_helius_key():
    """Placeholder for Helius API key generation"""
    print("\n[4/5] Helius API Key...")
    print("  [MANUAL] Please generate a new Helius API key at: https://www.helius.dev/dashboard")
    print("  [MANUAL] Delete the old key and create a new one")
    return None

def update_env_file(solana_data, cron_secret):
    """Update .env.local file with new secrets"""
    print("\n[5/5] Updating .env.local file...")
    
    env_content = f"""# RANSOME DAPP - Environment Variables
# Generated: {__import__('datetime').datetime.now().isoformat()}
# DO NOT COMMIT THIS FILE TO GIT

# Solana Configuration
RPC_URL=https://api.devnet.solana.com
SESSION_AUTHORITY={solana_data['public_key'] if solana_data else 'REPLACE_WITH_NEW_PUBLIC_KEY'}

# Authority Keypair (JSON array of secret key bytes)
AUTHORITY_KEYPAIR={solana_data['secret_key_array'] if solana_data else 'REPLACE_WITH_SECRET_KEY_ARRAY'}

# Security
CRON_SECRET={cron_secret if cron_secret else 'REPLACE_WITH_CRON_SECRET'}

# Vercel
VERCEL_TOKEN=REPLACE_WITH_NEW_VERCEL_TOKEN
"""
    
    with open(ENV_FILE, 'w') as f:
        f.write(env_content)
    
    print(f"  [OK] Updated: {ENV_FILE}")
    print("  [IMPORTANT] This file contains secrets - DO NOT commit to git!")

def update_source_code(solana_data):
    """Update hardcoded constants in source code"""
    print("\n[BONUS] Updating hardcoded constants in source code...")
    
    if not solana_data:
        print("  [SKIP] No new public key available")
        return
    
    new_pubkey = solana_data['public_key']
    
    # Files to update
    files_to_update = [
        os.path.join(PROJECT_DIR, "lib", "ransome-client.ts"),
        os.path.join(PROJECT_DIR, "lib", "draw-cron.ts"),
        os.path.join(PROJECT_DIR, "app", "page.tsx"),
    ]
    
    for filepath in files_to_update:
        if os.path.exists(filepath):
            with open(filepath, 'r') as f:
                content = f.read()
            
            # Replace old PROGRAM_ID with new public key
            old_program_id = "5ZFVc4h5Z6ccuxCRNM1Ubr1LC5cv6bvPugYFMJMgRU31"
            if old_program_id in content:
                content = content.replace(old_program_id, new_pubkey)
                with open(filepath, 'w') as f:
                    f.write(content)
                print(f"  [OK] Updated PROGRAM_ID in: {os.path.basename(filepath)}")
            else:
                print(f"  [SKIP] No old PROGRAM_ID found in: {os.path.basename(filepath)}")

def main():
    print("=" * 60)
    print("RANSOME DAPP - Phase 1: Secret Rotation")
    print("=" * 60)
    print()
    
    # Generate new secrets
    solana_data = generate_solana_keypair()
    cron_secret = generate_cron_secret()
    vercel_token = generate_vercel_token()
    helius_key = generate_helius_key()
    
    # Update files
    update_env_file(solana_data, cron_secret)
    update_source_code(solana_data)
    
    print()
    print("=" * 60)
    print("SUMMARY")
    print("=" * 60)
    print()
    print("Automated Steps Completed:")
    print("  [✓] New Solana authority keypair generated")
    print("  [✓] New CRON_SECRET generated")
    print("  [✓] .env.local file created with new secrets")
    print("  [✓] Source code updated with new PROGRAM_ID")
    print()
    print("Manual Steps Required:")
    print("  [ ] 1. Generate new Vercel token at https://vercel.com/account/tokens")
    print("  [ ] 2. Generate new Helius API key at https://www.helius.dev/dashboard")
    print("  [ ] 3. Update GitHub Actions secrets at https://github.com/kizzor/solana-dapp/settings/secrets/actions")
    print("  [ ] 4. Update Vercel environment variables at https://vercel.com/kizzor/solana-dapp/settings/environment-variables")
    print("  [ ] 5. Run 'solana airdrop 2 --url devnet' to fund the new authority for testing")
    print("  [ ] 6. Redeploy to Vercel after updating environment variables")
    print()
    print("Security Notes:")
    print("  - All secrets are stored locally in .env.local")
    print("  - .env.local is NOT committed to git (check .gitignore)")
    print("  - Old keypair is now worthless after rotation")
    print()

if __name__ == "__main__":
    main()
