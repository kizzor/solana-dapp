// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./interfaces/IERC20.sol";

/**
 * @title TestXToken
 * @notice Test "X" token for testing Ransome DApp on Robinhood Chain testnet / dev mode.
 * Includes a public faucet and mintWithEth function for easy testing.
 */
contract TestXToken is IERC20 {
    string public name = "Test X Token";
    string public symbol = "X_TEST";
    uint8 public constant decimals = 18;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor() {
        // Initial supply: 1 Billion X tokens to deployer (matching Pons supply)
        _mint(msg.sender, 1_000_000_000 * 1e18);
    }

    /**
     * @notice Free faucet function for testing (mints 5,000 X tokens).
     */
    function faucet() external {
        _mint(msg.sender, 5_000 * 1e18);
    }

    /**
     * @notice Mint test X tokens using Test ETH (1 ETH = 1,000,000 X).
     */
    function mintWithTestEth() external payable {
        require(msg.value > 0, "Send Test ETH to mint");
        uint256 xAmount = msg.value * 1_000_000;
        _mint(msg.sender, xAmount);
    }

    function transfer(address to, uint256 value) external returns (bool) {
        require(to != address(0), "Transfer to zero address");
        require(balanceOf[msg.sender] >= value, "Insufficient balance");

        balanceOf[msg.sender] -= value;
        balanceOf[to] += value;
        emit Transfer(msg.sender, to, value);
        return true;
    }

    function approve(address spender, uint256 value) external returns (bool) {
        require(spender != address(0), "Approve to zero address");
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        require(to != address(0), "Transfer to zero address");
        require(balanceOf[from] >= value, "Insufficient balance");
        require(allowance[from][msg.sender] >= value, "Allowance exceeded");

        allowance[from][msg.sender] -= value;
        balanceOf[from] -= value;
        balanceOf[to] += value;
        emit Transfer(from, to, value);
        return true;
    }

    function _mint(address to, uint256 amount) internal {
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }
}
