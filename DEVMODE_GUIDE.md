# 🔴 DEV MODE GUIDE — RANSOME DAPP

**Version:** 1.0  
**Created:** 2026-09-01  
**Purpose:** Enable fast iteration and end-to-end testing without real SUI payments  

---

## ⚡ Quick Start

### Enable Dev Mode

Set environment variable in `.env.local`:

```bash
NEXT_PUBLIC_DEV_MODE=true
```

Then restart the dev server:

```bash
npm run dev
```

### What You Get

✅ **Timer Skip** — Enter matrix anytime (ignores 59-min lobby countdown)  
✅ **Test SUI Minting** — Mint devices with minimal test amounts (no payment validation)  
✅ **Visual Indicators** — "⚠️ DEV MODE" badge shows in UI  
✅ **Full End-to-End Testing** — Games work with real grid registration & claims  

---

## 🎮 Typical Dev Testing Flow

### 1. Connect SUI Wallet
```
Click: CONNECT SUI → Select your test wallet (Suiet/Slush/Sui Wallet)
```

### 2. Mint Test Devices
```
Lobby → MINT tab → Select 1-10 devices → Click MINT →
(Uses minimal test SUI, no real payment)
```

### 3. Skip Timer & Enter Game
```
Lobby → "ENTER MATRIX" button is ALWAYS available in dev mode
Click button → 60-second pre-game countdown starts
```

### 4. Play & Test Claims
```
Wait for draw → Click matching numbers → Hit win pattern →
Click RANSOM → Claim should succeed (real on-chain claim)
```

### 5. Verify End-to-End
```
Check /api/session-state for live draw count
Verify grids register in browser console
Confirm HEIST payouts in wallet
```

---

## 🔑 Key Features by Mode

### No Wallet Connected (Local UI Testing)
- Devices created locally only (no blockchain)
- Timer fully skipped (enter game immediately)
- Perfect for UI/UX iteration
- **No real transactions**

### Wallet Connected (End-to-End Testing)
- Real SUI transactions with test amounts
- Grid registration server-side
- Claims verify against on-chain state
- Real HEIST payouts to wallet
- **Still uses test/minimal SUI** (not production amounts)
- **Requires active SUI mainnet session** (set in .env.local)

---

## ⚙️ Configuration

### Environment Variables Required

```bash
# Enable dev mode
NEXT_PUBLIC_DEV_MODE=true

# SUI Configuration (mainnet)
NEXT_PUBLIC_SUI_PROGRAM_ID=0x688845...
NEXT_PUBLIC_SESSION_OBJECT_ID=0x7ecd560b...
NEXT_PUBLIC_HEIST_ADMIN_ID=0xd2737b9f...

# Optionally override RPC
SUI_RPC_URL=https://fullnode.mainnet.sui.io
```

### Test Wallet Setup

1. **Create test wallet** (if you don't have one):
   ```bash
   sui client new
   ```

2. **Fund with test SUI**:
   - Use Sui Faucet: https://faucet.sui.io (mainnet disabled)
   - Or ask team for testnet SUI
   - Minimum needed: **1-2 SUI** (covers ~1000 test mints at 0.001 SUI each)

3. **Connect in browser**:
   - Install wallet extension (Suiet/Slush)
   - Click "CONNECT SUI" in lobby
   - Approve wallet connection

---

## 🧪 Test Scenarios

### Scenario 1: UI Testing (No Wallet)

```javascript
// Steps:
1. npm run dev
2. Set NEXT_PUBLIC_DEV_MODE=true
3. Do NOT connect wallet
4. Mint devices (creates local-only)
5. Click "ENTER MATRIX" (always available)
6. Test clicking, winning, claiming
7. All happens in-memory (no blockchain)
```

**Use for:** Layout, styling, game logic, animations

### Scenario 2: End-to-End Testing (With Wallet)

```javascript
// Steps:
1. npm run dev
2. Set NEXT_PUBLIC_DEV_MODE=true
3. Connect SUI wallet
4. Mint devices (real tx, test amounts)
5. Play full game
6. Claim wins (real on-chain claim)
7. Verify HEIST in wallet
```

**Use for:** Full flow validation, grid registration, claims, payments

### Scenario 3: Production Rehearsal

```javascript
// Steps:
1. npm run build
2. npm run start (local production server)
3. Set NEXT_PUBLIC_DEV_MODE=false
4. Connect wallet
5. Mint devices (real production flow)
6. Complete full game
```

**Use for:** Pre-launch verification with production settings

---

## 🚀 Dev Mode UI Elements

### Lobby Header
```
┌─────────────────────────────────────────────────────────────┐
│ RANSOME DEV ⚠  |  00:23  |  ☀️  |  🚀 NOW +30M +59M | ... │
│ ─────────────── Dev mode indicator ──────────────────────── │
└─────────────────────────────────────────────────────────────┘
```

**Buttons that appear in dev mode:**
- 🚀 **NOW** — Jump lobby timer to 0 (enter game immediately)
- **+30M** — Jump timer forward 30 minutes
- **+59M** — Jump timer forward 59 minutes (round boundary)

### Mint Panel
```
┌──────────────────────────────────────────────────────────────┐
│ ⚠️ DEV MODE ACTIVE                                           │
│ • Lobby timer SKIPPED — enter matrix anytime                 │
│ • Mint uses TEST SUI (minimal amounts)                       │
│ • NO REAL PAYMENT VALIDATION                                 │
│ 🔓 For testing ONLY — remove before production              │
└──────────────────────────────────────────────────────────────┘
```

### Console Logs
```javascript
// Dev mode mints will show:
[DEV MODE] Test mint result: { ... }
[DEV MODE] Grids registered: { ... }

// Look for these in browser console (F12)
```

---

## 🐛 Troubleshooting

### "HEIST admin not set"
```
Cause: NEXT_PUBLIC_HEIST_ADMIN_ID not set
Fix: Add to .env.local and restart dev server
```

### "INSUFFICIENT TEST SUI"
```
Cause: Wallet has <1 SUI
Fix: Fund wallet with more SUI via faucet or team
Amount needed: 1-2 SUI for ~500-1000 test mints
```

### "Grids NOT registered"
```
Cause: Server registration failed
Fix: Check /api/mint-nft response in browser Network tab
     Verify SESSION_OBJECT_ID and HEIST_ADMIN_ID are correct
```

### "Timer won't skip"
```
Cause: DEV_MODE env var not set or set to false
Fix: Confirm NEXT_PUBLIC_DEV_MODE=true in .env.local
    Restart dev server (env vars are read at build time)
```

### "DEV MODE badge not showing"
```
Cause: Build cached old version
Fix: npm run build (for production) or restart dev server
     Clear browser cache (Ctrl+Shift+Del)
```

---

## 📊 Test Amounts

### Dev Mode Minting
| Item | Amount | Cost |
|------|--------|------|
| Test SUI per mint | 0.001 SUI | Very low |
| 1 device | 0.001 SUI | ~$0.0007 |
| 10 devices | 0.01 SUI | ~$0.007 |
| 100 devices | 0.1 SUI | ~$0.07 |
| 1000 devices | 1 SUI | ~$0.70 |

**Total test budget: 1-2 SUI** (easily refunded/recycled)

---

## 🔐 Security Notes

### Dev Mode is LOCAL ONLY
- ❌ Does NOT expose real production keys
- ✅ Test amounts are hardcoded (0.001 SUI)
- ✅ All transactions are on mainnet but harmless
- ✅ Grids register for testing but don't affect game state

### Before Production
- ❌ Must set `NEXT_PUBLIC_DEV_MODE=false` in Vercel env
- ❌ Must remove `NEXT_PUBLIC_DEV_MODE` from .env.local
- ✅ Use `DEVMODE_REMOVAL.md` checklist to remove all code

---

## 🧹 Cleanup (When Testing Complete)

### Option 1: Keep for Future Testing
```bash
# Keep dev mode code in repo but DISABLED
NEXT_PUBLIC_DEV_MODE=false  # in production .env

# Can re-enable anytime for testing by setting to true
```

### Option 2: Permanent Removal (Recommended)
```bash
# When testing is DONE and you're ready to ship:
node remove-devmode.mjs --check      # Review what will be removed
node remove-devmode.mjs --dry-run    # Simulate removal
node remove-devmode.mjs --execute    # Actually remove

# Then:
git add . && git commit -m "remove: dev mode code"
git push origin main
```

See `DEVMODE_REMOVAL.md` for full removal checklist.

---

## 📝 Workflow Summary

### For Developers

1. **Setup** — Add `NEXT_PUBLIC_DEV_MODE=true` to `.env.local`
2. **Test** — Mint, play, claim with test amounts
3. **Iterate** — Fix bugs, adjust UI, repeat
4. **Verify** — Build and test production settings
5. **Ship** — Remove dev mode and deploy

### For QA/Testing

1. **Connect wallet** with SUI
2. **Mint devices** (test SUI provided)
3. **Play multiple rounds** (timer always available)
4. **Verify claims** work and payouts are correct
5. **Report bugs** via standard process

### For DevOps/Deployment

1. **Verify** `NEXT_PUBLIC_DEV_MODE=false` in Vercel secrets
2. **Verify** `remove-devmode.mjs --check` shows no matches
3. **Verify** `npm run build` passes with DEV_MODE=false
4. **Verify** production UI has no "DEV MODE" badges
5. **Deploy** to production

---

## 🎯 Success Criteria

Dev mode testing is complete when:

- ✅ Can mint devices without real payment
- ✅ Timer can be skipped (enter game anytime)
- ✅ Full game round completes (draw → claim)
- ✅ Claims register on-chain
- ✅ HEIST payouts received in wallet
- ✅ No console errors
- ✅ Removal script verified to work

---

## 📚 Related Files

- `app/page.tsx` — Main implementation
- `DEVMODE_REMOVAL.md` — Removal checklist & guide
- `remove-devmode.mjs` — Automated removal tool
- `.env.example` — Environment setup
- `freebuff.md` — Project state document

---

## 💬 Questions?

See `freebuff.md` **CONFIDENTIAL ACTION ITEMS** section or ask the team.

**Remember:** Dev mode is DISABLED by default in production.  
It's only for testing. Remove it before final deployment.

---

**Last Updated:** 2026-09-01  
**Status:** Ready for testing  
**Maintenance:** Update this guide as dev mode evolves
