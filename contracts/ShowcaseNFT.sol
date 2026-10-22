// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC2981} from "@openzeppelin/contracts/token/common/ERC2981.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";

/// @title ShowcaseNFT
/// @notice ERC-721 collection with a capped supply, per-wallet limit, two payment routes
///         (ETH, or by burning the utility token), EIP-2981 royalties and a reveal switch.
/// @dev Demonstration contract for a portfolio sample. Not audited; do not use with real funds.
contract ShowcaseNFT is ERC721, ERC2981, AccessControl, Pausable, ReentrancyGuard {
    using Strings for uint256;

    bytes32 public constant MANAGER_ROLE = keccak256("MANAGER_ROLE");

    uint256 public immutable maxSupply;
    uint256 public immutable maxPerWallet;
    ERC20Burnable public immutable paymentToken;

    uint256 public ethPrice;
    uint256 public tokenPrice;
    uint256 public totalSupply;
    address payable public treasury;

    string public hiddenURI;
    string private _baseTokenURI;
    bool public revealed;

    mapping(address minter => uint256 count) public mintedBy;

    event Minted(address indexed minter, uint256 firstTokenId, uint256 quantity, bool paidInToken);
    event PricesUpdated(uint256 ethPrice, uint256 tokenPrice);
    event TreasuryUpdated(address indexed treasury);
    event Revealed(string baseURI);
    event Withdrawn(address indexed treasury, uint256 amount);

    error InvalidQuantity();
    error SoldOut();
    error WalletLimitExceeded();
    error IncorrectPayment(uint256 expected, uint256 sent);
    error ZeroAddress();
    error WithdrawFailed();
    error NothingToWithdraw();
    error AlreadyRevealed();
    error RoyaltyTooHigh();

    uint96 private constant MAX_ROYALTY_BPS = 1_000; // 10%

    constructor(
        address admin,
        address payable treasury_,
        ERC20Burnable paymentToken_,
        uint256 maxSupply_,
        uint256 maxPerWallet_,
        uint256 ethPrice_,
        uint256 tokenPrice_,
        uint96 royaltyBps,
        string memory hiddenURI_
    ) ERC721("Showcase NFT", "SHOWNFT") {
        if (admin == address(0) || treasury_ == address(0) || address(paymentToken_) == address(0)) {
            revert ZeroAddress();
        }
        if (royaltyBps > MAX_ROYALTY_BPS) revert RoyaltyTooHigh();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MANAGER_ROLE, admin);

        treasury = treasury_;
        paymentToken = paymentToken_;
        maxSupply = maxSupply_;
        maxPerWallet = maxPerWallet_;
        ethPrice = ethPrice_;
        tokenPrice = tokenPrice_;
        hiddenURI = hiddenURI_;

        _setDefaultRoyalty(treasury_, royaltyBps);
    }

    // ---------------------------------------------------------------- minting

    /// @notice Mint `quantity` tokens, paying the exact ETH price.
    function mint(uint256 quantity) external payable nonReentrant whenNotPaused {
        uint256 expected = ethPrice * quantity;
        if (msg.value != expected) revert IncorrectPayment(expected, msg.value);
        _mintBatch(msg.sender, quantity, false);
    }

    /// @notice Mint `quantity` tokens by burning utility tokens. Requires prior approval
    ///         (or a permit) for `tokenPrice * quantity`.
    function mintWithToken(uint256 quantity) external nonReentrant whenNotPaused {
        // Non-payable, so attached ETH reverts. Burn first: if the allowance or balance is short the whole call reverts.
        paymentToken.burnFrom(msg.sender, tokenPrice * quantity);
        _mintBatch(msg.sender, quantity, true);
    }

    function _mintBatch(address to, uint256 quantity, bool paidInToken) private {
        if (quantity == 0) revert InvalidQuantity();
        if (totalSupply + quantity > maxSupply) revert SoldOut();
        if (mintedBy[to] + quantity > maxPerWallet) revert WalletLimitExceeded();

        // Effects before the external onERC721Received call.
        uint256 firstId = totalSupply + 1;
        totalSupply += quantity;
        mintedBy[to] += quantity;

        for (uint256 i; i < quantity; ++i) {
            _safeMint(to, firstId + i);
        }
        emit Minted(to, firstId, quantity, paidInToken);
    }

    // ------------------------------------------------------------------ admin

    function pause() external onlyRole(MANAGER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(MANAGER_ROLE) {
        _unpause();
    }

    function setPrices(uint256 ethPrice_, uint256 tokenPrice_) external onlyRole(MANAGER_ROLE) {
        ethPrice = ethPrice_;
        tokenPrice = tokenPrice_;
        emit PricesUpdated(ethPrice_, tokenPrice_);
    }

    function setTreasury(address payable treasury_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (treasury_ == address(0)) revert ZeroAddress();
        treasury = treasury_;
        emit TreasuryUpdated(treasury_);
    }

    function setDefaultRoyalty(address receiver, uint96 feeBps) external onlyRole(MANAGER_ROLE) {
        if (feeBps > MAX_ROYALTY_BPS) revert RoyaltyTooHigh();
        _setDefaultRoyalty(receiver, feeBps);
    }

    /// @notice One-way reveal: after this the base URI is used for every token.
    function reveal(string calldata baseURI_) external onlyRole(MANAGER_ROLE) {
        if (revealed) revert AlreadyRevealed();
        revealed = true;
        _baseTokenURI = baseURI_;
        emit Revealed(baseURI_);
    }

    /// @notice Send the full ETH balance to the treasury. Callable by anyone: funds can only go there.
    function withdraw() external nonReentrant {
        uint256 amount = address(this).balance;
        if (amount == 0) revert NothingToWithdraw();
        (bool ok,) = treasury.call{value: amount}("");
        if (!ok) revert WithdrawFailed();
        emit Withdrawn(treasury, amount);
    }

    // ------------------------------------------------------------------ views

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        if (!revealed) return hiddenURI;
        return string.concat(_baseTokenURI, tokenId.toString(), ".json");
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721, ERC2981, AccessControl)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
