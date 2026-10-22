// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ShowcaseNFT} from "../ShowcaseNFT.sol";

/// @dev Test helper: tries to re-enter `mint` from the ERC-721 receiver hook.
contract ReentrantMinter {
    ShowcaseNFT public immutable nft;
    bool public reentryAttempted;
    bool public reentrySucceeded;

    constructor(ShowcaseNFT nft_) {
        nft = nft_;
    }

    function attack() external payable {
        nft.mint{value: msg.value}(1);
    }

    function onERC721Received(address, address, uint256, bytes calldata) external returns (bytes4) {
        if (!reentryAttempted) {
            reentryAttempted = true;
            try nft.mint{value: nft.ethPrice()}(1) {
                reentrySucceeded = true;
            } catch {}
        }
        return this.onERC721Received.selector;
    }

    receive() external payable {}
}
