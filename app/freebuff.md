# RANSOME DAPP — FREEBUFF SESSION RESUME
**Last Updated:** 2026-10-07
**Phase:** MAINNET LIVE — frontend UI/UX polish work only
**Live site:** https://ransomematrix.xyz
**Package (public):** `0x9170648b231ae9f1d129c5448af8fdd201f8f6ef4207c7aa5907679e446ca3be`
**Session object (public):** `0x8112d79f50c9e4dd9743c154999ec5005e1671ba86dac55a5aa912334155c1f2`

## Security rules (carry across sessions)
- Never read `.env.local`, keypair/keystore/wallet JSON files, or any file containing secrets
- Never expose private keys, recovery phrases, tokens, API keys to any LLM
- Public IDs (Package ID, Session ID, wallet addresses) are safe to use
- Do not remove the security banner from `solanamark.md`

## Work protocol
- Frontend-only for now: `app/page.tsx`, `app/globals.css`, `app/chat/*`, `app/governance/*`, `app/turbolucent/*`, `app/components/*`
- API routes off-limits unless user explicitly asks
- `DEV_MODE` is intentional for local dev — do not silently flip

## Session log
### 2026-10-07
- Session resumed from solanamark.md; dev server target: port 3002
- freebuff.md created as Next.js app-router metadata probe fix

### 2026-10-21
- Session resumed (Freebuff/GLM client) with codebase-memory skill loaded
- Both resume files read; no confidential material ingested (solanamark.md secrets previously redacted; l will not read .env.local, keypairs, or API route internals)
- Frontend-only scope re-confirmed; awaiting direction on which UI/UX area to work on
