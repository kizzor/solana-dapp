// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title HookDeployer
 * @notice Deterministic CREATE2 deployer. Uniswap v4 reads hook permissions
 *         from the low 14 bits of the hook's address, so the deployer mines a
 *         salt off-chain and deploys here; the hook constructor then verifies
 *         the flags and reverts on a bad address.
 */
contract HookDeployer {
    event Deployed(address indexed addr, bytes32 indexed salt);

    function deploy(bytes memory creationCode, bytes32 salt) external returns (address addr) {
        require(creationCode.length > 0, "HookDeployer: empty code");
        assembly ("memory-safe") {
            addr := create2(0, add(creationCode, 0x20), mload(creationCode), salt)
        }
        require(addr != address(0), "HookDeployer: deploy failed");
        emit Deployed(addr, salt);
    }
}
