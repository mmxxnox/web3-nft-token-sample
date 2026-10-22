// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {ERC20Capped} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Capped.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title ShowcaseToken
/// @notice Capped, burnable ERC-20 utility token with EIP-2612 permit and role-based minting.
/// @dev Demonstration contract for a portfolio sample. Not audited; do not use with real funds.
contract ShowcaseToken is ERC20, ERC20Burnable, ERC20Capped, ERC20Permit, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    /// @param admin Receives DEFAULT_ADMIN_ROLE and MINTER_ROLE.
    /// @param cap_ Hard supply cap in base units. Must be at least `initialSupply`.
    /// @param initialSupply Minted to `admin` at deployment.
    constructor(address admin, uint256 cap_, uint256 initialSupply)
        ERC20("Showcase Token", "SHOW")
        ERC20Capped(cap_)
        ERC20Permit("Showcase Token")
    {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MINTER_ROLE, admin);
        _mint(admin, initialSupply);
    }

    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
        _mint(to, amount);
    }

    // The cap is enforced inside ERC20Capped._update, so the override only resolves the diamond.
    function _update(address from, address to, uint256 value) internal override(ERC20, ERC20Capped) {
        super._update(from, to, value);
    }
}
