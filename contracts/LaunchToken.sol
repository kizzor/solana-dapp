// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./interfaces/IERC20.sol";

/**
 * @title LaunchToken
 * @notice The ERC20 a launched coin actually is: fixed 1,000,000,000 supply,
 *         18 decimals, no mint, no tax, no owner.
 * @dev The full supply is minted to the deployer (the factory), which forwards
 *      it to the curve in the same transaction. There is deliberately no mint
 *      function — the supply in `LaunchFactory` is the supply forever, so the
 *      curve's constant-product math cannot be diluted.
 */
contract LaunchToken is IERC20 {
    string public name;
    string public symbol;
    uint8 public constant decimals = 18;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    constructor(string memory _name, string memory _symbol) {
        require(bytes(_name).length > 0, "LaunchToken: empty name");
        require(bytes(_symbol).length > 0, "LaunchToken: empty symbol");
        name = _name;
        symbol = _symbol;
        totalSupply = 1_000_000_000 * 1e18;
        balanceOf[msg.sender] = totalSupply;
        emit Transfer(address(0), msg.sender, totalSupply);
    }

    function transfer(address to, uint256 value) external returns (bool) {
        _transfer(msg.sender, to, value);
        return true;
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            require(allowed >= value, "LaunchToken: insufficient allowance");
            allowance[from][msg.sender] = allowed - value;
        }
        _transfer(from, to, value);
        return true;
    }

    function _transfer(address from, address to, uint256 value) internal {
        require(to != address(0), "LaunchToken: transfer to zero");
        uint256 balance = balanceOf[from];
        require(balance >= value, "LaunchToken: insufficient balance");
        unchecked {
            balanceOf[from] = balance - value;
            balanceOf[to] += value;
        }
        emit Transfer(from, to, value);
    }
}
