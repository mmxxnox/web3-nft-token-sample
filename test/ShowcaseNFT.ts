import { expect } from "chai";
import { network } from "hardhat";

const { ethers } = await network.create();

const MAX_SUPPLY = 10n;
const MAX_PER_WALLET = 3n;
const ETH_PRICE = ethers.parseEther("0.05");
const TOKEN_PRICE = ethers.parseEther("100");
const ROYALTY_BPS = 500n; // 5%
const HIDDEN_URI = "ipfs://hidden/metadata.json";

describe("ShowcaseNFT", function () {
  async function deploy() {
    const [admin, treasury, alice, bob, stranger] = await ethers.getSigners();
    const token = await ethers.deployContract("ShowcaseToken", [
      admin.address,
      ethers.parseEther("10000000"),
      ethers.parseEther("1000000"),
    ]);
    const nft = await ethers.deployContract("ShowcaseNFT", [
      admin.address,
      treasury.address,
      await token.getAddress(),
      MAX_SUPPLY,
      MAX_PER_WALLET,
      ETH_PRICE,
      TOKEN_PRICE,
      ROYALTY_BPS,
      HIDDEN_URI,
    ]);
    return { nft, token, admin, treasury, alice, bob, stranger };
  }

  describe("deployment", function () {
    it("rejects zero addresses and excessive royalties", async function () {
      const { token, admin, treasury } = await deploy();
      const args = (over: Record<number, unknown>) => {
        const base: unknown[] = [
          admin.address,
          treasury.address,
          token.target,
          MAX_SUPPLY,
          MAX_PER_WALLET,
          ETH_PRICE,
          TOKEN_PRICE,
          ROYALTY_BPS,
          HIDDEN_URI,
        ];
        for (const [i, v] of Object.entries(over)) base[Number(i)] = v;
        return base;
      };
      const factory = await ethers.getContractFactory("ShowcaseNFT");
      await expect(factory.deploy(...args({ 1: ethers.ZeroAddress }))).to.be.revertedWithCustomError(
        factory,
        "ZeroAddress",
      );
      await expect(factory.deploy(...args({ 7: 1_001n }))).to.be.revertedWithCustomError(
        factory,
        "RoyaltyTooHigh",
      );
    });
  });

  describe("minting with ETH", function () {
    it("mints sequential ids from 1 and records the buyer", async function () {
      const { nft, alice } = await deploy();
      await expect(nft.connect(alice).mint(2n, { value: ETH_PRICE * 2n }))
        .to.emit(nft, "Minted")
        .withArgs(alice.address, 1n, 2n, false);
      expect(await nft.ownerOf(1n)).to.equal(alice.address);
      expect(await nft.ownerOf(2n)).to.equal(alice.address);
      expect(await nft.totalSupply()).to.equal(2n);
      expect(await nft.mintedBy(alice.address)).to.equal(2n);
    });

    it("requires the exact payment", async function () {
      const { nft, alice } = await deploy();
      await expect(nft.connect(alice).mint(1n, { value: ETH_PRICE - 1n }))
        .to.be.revertedWithCustomError(nft, "IncorrectPayment")
        .withArgs(ETH_PRICE, ETH_PRICE - 1n);
      await expect(nft.connect(alice).mint(1n, { value: ETH_PRICE + 1n }))
        .to.be.revertedWithCustomError(nft, "IncorrectPayment")
        .withArgs(ETH_PRICE, ETH_PRICE + 1n);
    });

    it("rejects a zero quantity", async function () {
      const { nft, alice } = await deploy();
      await expect(nft.connect(alice).mint(0n)).to.be.revertedWithCustomError(nft, "InvalidQuantity");
    });

    it("enforces the per-wallet limit across several transactions", async function () {
      const { nft, alice } = await deploy();
      await nft.connect(alice).mint(2n, { value: ETH_PRICE * 2n });
      await nft.connect(alice).mint(1n, { value: ETH_PRICE });
      await expect(nft.connect(alice).mint(1n, { value: ETH_PRICE })).to.be.revertedWithCustomError(
        nft,
        "WalletLimitExceeded",
      );
    });

    it("stops at the maximum supply", async function () {
      const { nft, alice, bob, stranger, admin } = await deploy();
      // 10 supply, 3 per wallet: four wallets are needed.
      for (const s of [alice, bob, stranger]) await nft.connect(s).mint(3n, { value: ETH_PRICE * 3n });
      await nft.connect(admin).mint(1n, { value: ETH_PRICE });
      expect(await nft.totalSupply()).to.equal(MAX_SUPPLY);
      const [, , , , , extra] = await ethers.getSigners();
      await expect(nft.connect(extra).mint(1n, { value: ETH_PRICE })).to.be.revertedWithCustomError(
        nft,
        "SoldOut",
      );
    });
  });

  describe("minting with the utility token", function () {
    it("burns the token price and mints", async function () {
      const { nft, token, admin, alice } = await deploy();
      await token.connect(admin).transfer(alice.address, TOKEN_PRICE * 2n);
      await token.connect(alice).approve(await nft.getAddress(), TOKEN_PRICE * 2n);
      const supplyBefore = await token.totalSupply();

      await expect(nft.connect(alice).mintWithToken(2n))
        .to.emit(nft, "Minted")
        .withArgs(alice.address, 1n, 2n, true);

      expect(await token.totalSupply()).to.equal(supplyBefore - TOKEN_PRICE * 2n);
      expect(await token.balanceOf(alice.address)).to.equal(0n);
      expect(await nft.ownerOf(2n)).to.equal(alice.address);
    });

    it("reverts without allowance and leaves no state behind", async function () {
      const { nft, token, admin, alice } = await deploy();
      await token.connect(admin).transfer(alice.address, TOKEN_PRICE);
      await expect(nft.connect(alice).mintWithToken(1n)).to.be.revertedWithCustomError(
        token,
        "ERC20InsufficientAllowance",
      );
      expect(await nft.totalSupply()).to.equal(0n);
    });

    it("refuses attached ETH", async function () {
      const { nft, token, admin, alice } = await deploy();
      await token.connect(admin).transfer(alice.address, TOKEN_PRICE);
      await token.connect(alice).approve(await nft.getAddress(), TOKEN_PRICE);
      // Send raw calldata so ethers' client-side non-payable check cannot mask the on-chain result.
      const data = nft.interface.encodeFunctionData("mintWithToken", [1n]);
      await expect(
        alice.sendTransaction({ to: await nft.getAddress(), data, value: 1n, gasLimit: 500_000n }),
      ).to.be.revert(ethers);
      expect(await nft.totalSupply()).to.equal(0n);
    });
  });

  describe("pausing and access control", function () {
    it("blocks minting while paused and restores it on unpause", async function () {
      const { nft, admin, alice } = await deploy();
      await nft.connect(admin).pause();
      await expect(nft.connect(alice).mint(1n, { value: ETH_PRICE })).to.be.revertedWithCustomError(
        nft,
        "EnforcedPause",
      );
      await nft.connect(admin).unpause();
      await nft.connect(alice).mint(1n, { value: ETH_PRICE });
    });

    it("keeps admin functions behind roles", async function () {
      const { nft, stranger } = await deploy();
      const manager = await nft.MANAGER_ROLE();
      const admin = await nft.DEFAULT_ADMIN_ROLE();
      await expect(nft.connect(stranger).pause())
        .to.be.revertedWithCustomError(nft, "AccessControlUnauthorizedAccount")
        .withArgs(stranger.address, manager);
      await expect(nft.connect(stranger).setPrices(1n, 1n)).to.be.revertedWithCustomError(
        nft,
        "AccessControlUnauthorizedAccount",
      );
      await expect(nft.connect(stranger).reveal("ipfs://x/")).to.be.revertedWithCustomError(
        nft,
        "AccessControlUnauthorizedAccount",
      );
      await expect(nft.connect(stranger).setTreasury(stranger.address))
        .to.be.revertedWithCustomError(nft, "AccessControlUnauthorizedAccount")
        .withArgs(stranger.address, admin);
    });

    it("updates prices", async function () {
      const { nft, admin, alice } = await deploy();
      await expect(nft.connect(admin).setPrices(1n, 2n)).to.emit(nft, "PricesUpdated").withArgs(1n, 2n);
      await nft.connect(alice).mint(1n, { value: 1n });
    });
  });

  describe("metadata and royalties", function () {
    it("serves the hidden URI until revealed, then the base URI", async function () {
      const { nft, admin, alice } = await deploy();
      await nft.connect(alice).mint(1n, { value: ETH_PRICE });
      expect(await nft.tokenURI(1n)).to.equal(HIDDEN_URI);

      await nft.connect(admin).reveal("ipfs://collection/");
      expect(await nft.tokenURI(1n)).to.equal("ipfs://collection/1.json");
      await expect(nft.connect(admin).reveal("ipfs://other/")).to.be.revertedWithCustomError(
        nft,
        "AlreadyRevealed",
      );
    });

    it("reverts tokenURI for unminted ids", async function () {
      const { nft } = await deploy();
      await expect(nft.tokenURI(1n)).to.be.revertedWithCustomError(nft, "ERC721NonexistentToken");
    });

    it("reports EIP-2981 royalties to the treasury", async function () {
      const { nft, treasury } = await deploy();
      const [receiver, amount] = await nft.royaltyInfo(1n, ethers.parseEther("1"));
      expect(receiver).to.equal(treasury.address);
      expect(amount).to.equal(ethers.parseEther("0.05"));
    });

    it("caps royalty changes at 10%", async function () {
      const { nft, admin, treasury } = await deploy();
      await expect(nft.connect(admin).setDefaultRoyalty(treasury.address, 1_001n)).to.be.revertedWithCustomError(
        nft,
        "RoyaltyTooHigh",
      );
    });

    it("advertises ERC-721, ERC-2981 and AccessControl", async function () {
      const { nft } = await deploy();
      expect(await nft.supportsInterface("0x80ac58cd")).to.equal(true); // ERC-721
      expect(await nft.supportsInterface("0x2a55205a")).to.equal(true); // ERC-2981
      expect(await nft.supportsInterface("0x7965db0b")).to.equal(true); // AccessControl
      expect(await nft.supportsInterface("0xffffffff")).to.equal(false);
    });
  });

  describe("withdrawals", function () {
    it("sends the whole balance to the treasury, whoever calls", async function () {
      const { nft, treasury, alice, stranger } = await deploy();
      await nft.connect(alice).mint(2n, { value: ETH_PRICE * 2n });
      await expect(nft.connect(stranger).withdraw()).to.changeEtherBalance(ethers, treasury, ETH_PRICE * 2n);
      await expect(nft.withdraw()).to.be.revertedWithCustomError(nft, "NothingToWithdraw");
    });

    it("reverts cleanly when the treasury refuses ETH", async function () {
      const { nft, admin, alice } = await deploy();
      const bad = await ethers.deployContract("RejectingReceiver");
      await nft.connect(admin).setTreasury(await bad.getAddress());
      await nft.connect(alice).mint(1n, { value: ETH_PRICE });
      await expect(nft.withdraw()).to.be.revertedWithCustomError(nft, "WithdrawFailed");
      expect(await ethers.provider.getBalance(await nft.getAddress())).to.equal(ETH_PRICE);
    });
  });

  describe("reentrancy", function () {
    it("blocks re-entry from the ERC-721 receiver hook", async function () {
      const { nft } = await deploy();
      const [funder] = await ethers.getSigners();
      const attacker = await ethers.deployContract("ReentrantMinter", [await nft.getAddress()]);
      // Pre-fund the attacker so the nested mint fails only because of the guard, not for lack of ETH.
      await funder.sendTransaction({ to: await attacker.getAddress(), value: ETH_PRICE });
      await attacker.attack({ value: ETH_PRICE });

      expect(await attacker.reentryAttempted()).to.equal(true);
      expect(await attacker.reentrySucceeded()).to.equal(false);
      expect(await nft.totalSupply()).to.equal(1n);
    });
  });
});
