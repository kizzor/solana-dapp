export const TEST_X_TOKEN_ABI = [
  {
    type: 'function',
    name: 'faucet',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
  {
    type: 'function',
    name: 'mintWithTestEth',
    stateMutability: 'payable',
    inputs: [],
    outputs: [],
  },
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'value', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;

export const ERC20_ABI = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'allowance',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'value', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'decimals',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
  },
] as const;

export const XLOCK_VAULT_ABI = [
  {
    type: 'function',
    name: 'lock',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'initiateUnlock',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
  {
    type: 'function',
    name: 'cancelUnlock',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
  {
    type: 'function',
    name: 'withdraw',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
  {
    type: 'function',
    name: 'isDiscountEligible',
    stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    // Tokens the discount needs RIGHT NOW. USD-denominated when the vault has a
    // price source, so the UI must read it instead of hardcoding a number.
    type: 'function',
    name: 'lockRequirement',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'locks',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'address' }],
    outputs: [
      { name: 'amount', type: 'uint256' },
      { name: 'deposited', type: 'uint256' },
      { name: 'unlockTimestamp', type: 'uint256' },
      { name: 'isUnbonding', type: 'bool' },
    ],
  },
  {
    type: 'function',
    name: 'lockInfo',
    stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [
      { name: 'amount', type: 'uint256' },
      { name: 'deposited', type: 'uint256' },
      { name: 'unlockTimestamp', type: 'uint256' },
      { name: 'isUnbonding', type: 'bool' },
    ],
  },
  {
    type: 'function',
    name: 'lockFuelBps',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'fuelFor',
    stateMutability: 'view',
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: [
      { name: 'fuel', type: 'uint256' },
      { name: 'retained', type: 'uint256' },
    ],
  },
  {
    type: 'function',
    name: 'totalFuelInjected',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'totalStaked',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'rewardPerTokenStored',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'earned',
    stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'claimReward',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
  {
    type: 'function',
    name: 'ransomeVault',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
] as const;

export const RANSOME_VAULT_ABI = [
  {
    type: 'function',
    name: 'getVaultBalance',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'prizePoolReserve',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'treasuryReserve',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'distributePrize',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'winner', type: 'address' },
      { name: 'sessionId', type: 'uint256' },
      { name: 'xAmount', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'claimTreasuryReserve',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'recipient', type: 'address' }],
    outputs: [],
  },
] as const;

export const RANSOME_GAME_ABI = [
  {
    type: 'function',
    name: 'currentSessionId',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    // Devices are numbered 0..n-1 per session in mint order, so a player's ids
    // are `sessionDeviceCount - count .. sessionDeviceCount - 1` right after
    // their own mint transaction. This is how the cabinet learns its on-chain id.
    type: 'function',
    name: 'sessionDeviceCount',
    stateMutability: 'view',
    inputs: [{ name: 'sessionId', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    // Public mapping read: (owner, gridHash, registered). Used to confirm which
    // on-chain ids a mint actually produced — the ids decide who can claim.
    type: 'function',
    name: 'devices',
    stateMutability: 'view',
    inputs: [
      { name: 'sessionId', type: 'uint256' },
      { name: 'deviceId', type: 'uint256' },
    ],
    outputs: [
      { name: 'owner', type: 'address' },
      { name: 'gridHash', type: 'bytes32' },
      { name: 'registered', type: 'bool' },
      { name: 'mintedAt', type: 'uint8' },
    ],
  },
  {
    type: 'function',
    name: 'getSession',
    stateMutability: 'view',
    inputs: [{ name: 'sessionId', type: 'uint256' }],
    outputs: [
      { name: 'id', type: 'uint256' },
      { name: 'drawCount', type: 'uint8' },
      { name: 'active', type: 'bool' },
      { name: 'startedAt', type: 'uint256' },
      { name: 'drawnNumbersList', type: 'uint8[]' },
    ],
  },
  {
    // The entropy behind one draw. r = seed % remaining, then the r-th number
    // that is still undrawn — anyone can replay a draw from this and the
    // session's number list.
    type: 'function',
    name: 'drawSeeds',
    stateMutability: 'view',
    inputs: [
      { name: 'sessionId', type: 'uint256' },
      { name: 'drawIndex', type: 'uint8' },
    ],
    outputs: [{ name: '', type: 'bytes32' }],
  },
  {
    // The board travels IN THE CLEAR — cells, not a hash — so the contract can
    // refuse a bad card before it becomes a ticket:
    //   · GridLib.validate — 15 distinct numbers in 1-90, five per row
    //   · cold board       — no number already on the wall
    //   · gridUsed         — one board, one ticket, per round (no clones)
    // `boards` is one flattened 3×9 array per ticket, row-major, 0 = empty.
    // There is NO ETH rail: `mintWithETH` was removed on purpose (it reverted
    // anyway, and it was the only price set by an authority-side FX rate).
    type: 'function',
    name: 'mintWithStablecoin',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'stablecoin', type: 'address' },
      { name: 'count', type: 'uint8' },
      { name: 'boards', type: 'uint8[27][]' },
      { name: 'minXOut', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'mintWithXToken',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'count', type: 'uint8' },
      { name: 'boards', type: 'uint8[27][]' },
    ],
    outputs: [],
  },
  {
    // Has this exact board already been minted in the round? The cabinet can
    // preflight a generated card with it; the mint enforces it either way.
    type: 'function',
    name: 'gridUsed',
    stateMutability: 'view',
    inputs: [
      { name: 'sessionId', type: 'uint256' },
      { name: '', type: 'bytes32' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'tokenPriceInUsd',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'ticketTokens',
    stateMutability: 'view',
    inputs: [{ name: 'discounted', type: 'bool' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'setTokenPriceInUsd',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'newPrice', type: 'uint256' }],
    outputs: [],
  },
  {
    // The draw also reserves every tier it completes. `winType` 0-3 are the
    // board tiers; 4 means "this grid completed a full house" and the contract
    // derives FH1/FH2/FH3 from the wallet's lifetime ladder.
    //
    // There is deliberately NO number argument: the ball is derived on-chain
    // from block.prevrandao inside the transaction, so neither the keeper nor
    // the authority can pick which number comes out.
    type: 'function',
    name: 'drawNumber',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'completions',
        type: 'tuple[]',
        components: [
          { name: 'deviceId', type: 'uint256' },
          { name: 'winType', type: 'uint8' },
        ],
      },
    ],
    outputs: [],
  },
  {
    // Player-callable and amount-free: the contract decides who is paid and how
    // much. Signature is what the cabinet signs when the player presses claim.
    //
    // `grid` is the 27-cell board (row-major, 0 = empty) the ticket committed
    // to at mint. The contract re-derives the tier from it, so a claim cannot
    // be paid for a win that never happened.
    type: 'function',
    name: 'claimWin',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'sessionId', type: 'uint256' },
      { name: 'deviceId', type: 'uint256' },
      { name: 'winType', type: 'uint8' },
      { name: 'grid', type: 'uint8[27]' },
    ],
    outputs: [],
  },
  {
    // Same checks as claimWin, no money: for preflighting a RANSOM.
    type: 'function',
    name: 'verifyReveal',
    stateMutability: 'view',
    inputs: [
      { name: 'sessionId', type: 'uint256' },
      { name: 'deviceId', type: 'uint256' },
      { name: 'winType', type: 'uint8' },
      { name: 'grid', type: 'uint8[27]' },
    ],
    outputs: [
      { name: 'boardMatches', type: 'bool' },
      { name: 'boardValid', type: 'bool' },
      { name: 'completedAt', type: 'uint8' },
      { name: 'afterMint', type: 'bool' },
      { name: 'timely', type: 'bool' },
    ],
  },
  {
    type: 'function',
    name: 'claimableOf',
    stateMutability: 'view',
    inputs: [
      { name: 'sessionId', type: 'uint256' },
      { name: 'deviceId', type: 'uint256' },
      { name: 'winType', type: 'uint8' },
    ],
    outputs: [
      { name: 'amount', type: 'uint256' },
      { name: 'claimed', type: 'bool' },
      { name: 'expired', type: 'bool' },
    ],
  },
  {
    type: 'function',
    name: 'availablePot',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'fullHouses',
    stateMutability: 'view',
    inputs: [{ name: 'wallet', type: 'address' }],
    outputs: [{ name: '', type: 'uint32' }],
  },
  {
    type: 'function',
    name: 'gridClosed',
    stateMutability: 'view',
    inputs: [
      { name: 'sessionId', type: 'uint256' },
      { name: 'deviceId', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'isRoundSettled',
    stateMutability: 'view',
    inputs: [{ name: 'sessionId', type: 'uint256' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'isWinClaimed',
    stateMutability: 'view',
    inputs: [
      { name: 'sessionId', type: 'uint256' },
      { name: 'deviceId', type: 'uint256' },
      { name: 'winType', type: 'uint8' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'isNumberDrawn',
    stateMutability: 'view',
    inputs: [
      { name: 'sessionId', type: 'uint256' },
      { name: 'number', type: 'uint8' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;
