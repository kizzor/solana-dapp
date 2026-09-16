# 🔴 DEV MODE REMOVAL CHECKLIST & AUTOMATION

**Purpose:** Complete removal of dev mode code before production deployment.  
**Status:** Ready to execute  
**Created:** 2026-09-01  

---

## ⚠️ CRITICAL: DO NOT RUN UNTIL TESTING IS COMPLETE

This script will **permanently remove all dev mode code** from the codebase. Once removed:
- ❌ Cannot skip the timer anymore (production requirement)
- ❌ Cannot mint with test amounts (production requirement)  
- ❌ Dev mode indicators will disappear
- ✅ Code will be production-ready and lean

---

## Phase 1: Pre-Removal Validation Checklist

Before running removal, confirm:

### Testing Complete ✅
- [ ] Dev mode timer skip tested and working
- [ ] Test SUI minting tested end-to-end
- [ ] Claims verified with test devices
- [ ] Multiple rounds played successfully
- [ ] All game mechanics verified

### Code Review ✅
- [ ] No hardcoded dev addresses remain in production paths
- [ ] All DEV_MODE guards are correctly nested
- [ ] Test wallets removed from constants
- [ ] Fallback values reviewed

### Environment Variables ✅
- [ ] `NEXT_PUBLIC_DEV_MODE=false` confirmed in Vercel Production
- [ ] Dev-only env vars not in production secrets
- [ ] All sensitive values redacted

### Final Backup ✅
- [ ] Git branch created: `git checkout -b pre-devmode-removal`
- [ ] Full commit: `git add . && git commit -m "backup: before dev mode removal"`
- [ ] Tag created: `git tag pre-devmode-removal-$(date +%s)`

---

## Phase 2: Files to Modify

### 1. **app/page.tsx** — Main game component
   - Remove DEV_MODE constant check from `useLobbyCountdown()`
   - Remove DEV MODE mint path from `mintDevices()`
   - Remove DEV MODE UI banner from `MintPanel()`
   - Remove DEV MODE indicators from lobby header
   - Remove `devJump()` function calls
   - Remove dev-only button in topbar (+30M, +59M, NOW buttons)
   - Keep: production mint flow and timer logic

### 2. **.env.example** (if it exists)
   - Remove `NEXT_PUBLIC_DEV_MODE` line
   - Add note: "Dev mode removed for production"

### 3. **next.config.js**
   - No changes needed (dev env vars not used there)

### 4. **vercel.json**
   - No changes needed

### 5. **.github/workflows/** (if using GitHub cron)
   - No changes needed (production workflows only)

### 6. **DEPLOYMENT_CHECKLIST.md** / deployment docs
   - Update: "Dev mode removed - production ready"
   - Remove any dev mode instructions

---

## Phase 3: Automated Removal Script

```bash
#!/bin/bash
# DEV MODE REMOVAL SCRIPT
# Run this after confirming Phase 1 checklist

echo "🔴 DEV MODE REMOVAL — Starting automated cleanup..."
echo ""

# Check git status
if [[ -n $(git status -s) ]]; then
    echo "❌ ERROR: Working directory has uncommitted changes"
    echo "   Run: git status"
    echo "   Then commit or stash before proceeding"
    exit 1
fi

# Backup branch
echo "📦 Creating backup branch..."
git checkout -b pre-devmode-removal-backup
git checkout -
echo "✅ Backup branch created: pre-devmode-removal-backup"
echo ""

# Main cleanup
echo "🔨 Removing dev mode code from app/page.tsx..."

# This would be done via a find-replace tool
# Since we're doing manual cleanup, document the exact changes:

cat > /tmp/devmode_changes.txt << 'EOF'
CHANGES TO MAKE IN app/page.tsx:

1. Line ~172 (useLobbyCountdown function):
   REMOVE:
   if (DEV_MODE && devOffset === 0) return 0 // Skip countdown in dev mode
   
   KEEP: Rest of the function as-is

2. Line ~2490 (devJump function):
   DELETE ENTIRE FUNCTION if it only exists for DEV_MODE

3. Line ~2765 (topbar dev buttons):
   REMOVE:
   {DEV_MODE && <div style={{...}}>
     <button onClick={() => devJump(0)}...>
     <button onClick={() => devJump(30)}...>
     <button onClick={() => devJump(59)}...>
   </div>}

4. Line ~2755 (dev mode indicator):
   REMOVE:
   {DEV_MODE && <span style={{...}}>⚠ DEV MODE</span>}

5. Line ~2533-2630 (mintDevices function - DEV MODE SUI section):
   DELETE ENTIRE SECTION:
   if (DEV_MODE && chain === 'sui' && suiConnected && suiAddress) { ... }
   
   Keep the fallback local mint only for production error cases

6. Line ~2880 (MintPanel DEV MODE banner):
   REMOVE:
   {DEV_MODE && (
     <div style={{...}}>
       ⚠️ DEV MODE ACTIVE...
     </div>
   )}

7. Line ~49 (DEV_MODE constant):
   DELETE OR COMMENT:
   const DEV_MODE = process.env.NEXT_PUBLIC_DEV_MODE === 'true'

8. All other DEV_MODE checks:
   SEARCH: DEV_MODE
   REVIEW: Each occurrence
   - If it's a guard for dev-only code: REMOVE the guard and dev-only block
   - If it's a production-path condition: Keep but mark with comment

EOF

echo "✅ Change list generated: /tmp/devmode_changes.txt"
echo ""
echo "📋 NEXT STEPS (MANUAL):"
echo ""
echo "1. Open: app/page.tsx"
echo "2. Use Find & Replace (Ctrl+H) to remove all DEV_MODE references:"
echo "   - Search: 'const DEV_MODE.*'"
echo "   - Replace: '' (empty)"
echo "3. Search for each DEV_MODE location and remove dev-only code blocks"
echo "4. Run: npm run build && npm run lint"
echo "5. Verify: npm run test (if available)"
echo "6. Commit: git add . && git commit -m 'remove: dev mode code for production'"
echo "7. Push: git push origin main"
echo ""
```

---

## Phase 4: Manual Removal Steps (Using VS Code)

1. **Open Find & Replace**: `Ctrl+Shift+H` in VS Code
2. **Search pattern**: `DEV_MODE`
3. **Review each match** (currently ~20+ matches):
   - `const DEV_MODE = ...` → **DELETE**
   - `if (DEV_MODE && ...)` with dev-only logic → **DELETE the block**
   - `DEV_MODE || lobbyCountdown <= 60` → Change to **`lobbyCountdown <= 60`**
   - `{DEV_MODE && <...>}` UI elements → **DELETE**

4. **Search for devJump**: ~5 matches
   - Function definition → **DELETE**
   - Function calls → **DELETE**

5. **Search for dev-only strings**:
   - "DEV TEST"
   - "DEV MODE"
   - "DEV MINT"
   - "(DEV)"
   - All → **DELETE** (find-replace with empty)

---

## Phase 5: Verification Commands

```bash
# 1. Build check
npm run build

# 2. No remaining dev mode references
grep -r "DEV_MODE" app/ --exclude-dir=node_modules
grep -r "devJump" app/ --exclude-dir=node_modules
grep -r "DEV TEST" app/ --exclude-dir=node_modules

# Expected output: (empty — no matches)

# 3. TypeScript check
npx tsc --noEmit

# 4. Final commit
git add .
git commit -m "remove: dev mode code — production ready"
git push origin main

# 5. Vercel auto-deploys
# → Monitor deployment at https://vercel.com/dashboard
```

---

## Phase 6: Post-Removal Validation

After removal, verify:

- [ ] Site loads at https://ransomematrix.xyz
- [ ] Lobby timer shows and counts down (NOT skippable)
- [ ] Real SUI mint path only (no test amounts)
- [ ] No "DEV MODE" or "⚠️" badges in UI
- [ ] `/api/session-state` returns real prices
- [ ] Devices cannot be minted before timer reaches 60s
- [ ] No console errors related to dev mode

---

## 🚨 EMERGENCY ROLLBACK

If something breaks after removal:

```bash
# Rollback to backup
git revert HEAD

# Or restore from tag
git checkout pre-devmode-removal-backup

# Push to staging for testing
git push origin staging
```

---

## Timeline

| Phase | Duration | Trigger |
|-------|----------|---------|
| Testing | 1-2 days | User completes dev testing |
| Validation | 30 min | Run Phase 1 checklist |
| Removal | 15 min | Execute Phase 3-4 |
| Verification | 30 min | Run Phase 5 checks |
| Production | Immediate | Push to main → Vercel deploys |

---

## Notes

- **No secrets to worry about** — dev mode code doesn't touch private keys
- **Safe to remove** — all dev mode paths are isolated guards
- **Production will be leaner** — ~50 lines of code removed
- **Cannot be re-enabled** — dev mode is one-way removal (by design)

---

**Questions?** See `freebuff.md` CONFIDENTIAL ACTION ITEMS section.
