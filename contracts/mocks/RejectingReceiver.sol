// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev Test helper: a treasury that refuses ETH, to exercise the failed-withdrawal path.
contract RejectingReceiver {
    receive() external payable {
        revert("no ETH");
    }
}
