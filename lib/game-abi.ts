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
    type: 'function',
    name: 'locks',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'address' }],
    outputs: [
      { name: 'amount', type: 'uint256' },
      { name: 'unlockTimestamp', type: 'uint256' },
      { name: 'isUnbonding', type: 'bool' },
    ],
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
    type: 'function',
    name: 'mintWithStablecoin',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'stablecoin', type: 'address' },
      { name: 'count', type: 'uint8' },
      { name: 'gridHashes', type: 'bytes32[]' },
      { name: 'minXOut', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'mintWithETH',
    stateMutability: 'payable',
    inputs: [
      { name: 'count', type: 'uint8' },
      { name: 'gridHashes', type: 'bytes32[]' },
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
      { name: 'gridHashes', type: 'bytes32[]' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'drawNumber',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'number', type: 'uint8' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'claimWin',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'sessionId', type: 'uint256' },
      { name: 'deviceId', type: 'uint256' },
      { name: 'winner', type: 'address' },
      { name: 'winType', type: 'uint8' },
      { name: 'xPrizeAmount', type: 'uint256' },
    ],
    outputs: [],
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
