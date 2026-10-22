import { expect } from "chai";
import { network } from "hardhat";

const { ethers } = await network.create();

const CAP = ethers.parseEther("10000000");
const INITIAL = ethers.parseEther("1000000");

describe("ShowcaseToken", function () {
  async function deploy() {
    const [admin, alice, bob] = await ethers.getSigners();
    const token = await ethers.deployContract("ShowcaseToken", [admin.address, CAP, INITIAL]);
    return { token, admin, alice, bob };
  }

  it("mints the initial supply to the admin and sets the cap", async function () {
    const { token, admin } = await deploy();
    expect(await token.balanceOf(admin.address)).to.equal(INITIAL);
    expect(await token.cap()).to.equal(CAP);
  });

  it("lets only a minter mint", async function () {
    const { token, alice } = await deploy();
    await expect(token.connect(alice).mint(alice.address, 1n))
      .to.be.revertedWithCustomError(token, "AccessControlUnauthorizedAccount")
      .withArgs(alice.address, await token.MINTER_ROLE());
  });

  it("enforces the hard cap", async function () {
    const { token, admin, alice } = await deploy();
    const room = CAP - INITIAL;
    await token.mint(alice.address, room);
    await expect(token.connect(admin).mint(alice.address, 1n))
      .to.be.revertedWithCustomError(token, "ERC20ExceededCap")
      .withArgs(CAP + 1n, CAP);
  });

  it("burns reduce supply and free cap headroom", async function () {
    const { token, alice } = await deploy();
    await token.burn(100n);
    expect(await token.totalSupply()).to.equal(INITIAL - 100n);
    // The burned amount can be minted again, but nothing beyond the cap.
    await token.mint(alice.address, CAP - INITIAL + 100n);
    expect(await token.totalSupply()).to.equal(CAP);
  });

  it("supports gasless approval through EIP-2612 permit", async function () {
    const { token, admin, alice, bob } = await deploy();
    await token.transfer(alice.address, 1_000n);

    const value = 500n;
    const deadline = BigInt((await ethers.provider.getBlock("latest"))!.timestamp + 3600);
    const { chainId } = await ethers.provider.getNetwork();
    const signature = await alice.signTypedData(
      {
        name: "Showcase Token",
        version: "1",
        chainId,
        verifyingContract: await token.getAddress(),
      },
      {
        Permit: [
          { name: "owner", type: "address" },
          { name: "spender", type: "address" },
          { name: "value", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      },
      { owner: alice.address, spender: bob.address, value, nonce: 0n, deadline },
    );
    const { v, r, s } = ethers.Signature.from(signature);

    await token.connect(bob).permit(alice.address, bob.address, value, deadline, v, r, s);
    expect(await token.allowance(alice.address, bob.address)).to.equal(value);

    // The same signature cannot be replayed.
    await expect(
      token.connect(bob).permit(alice.address, bob.address, value, deadline, v, r, s),
    ).to.be.revertedWithCustomError(token, "ERC2612InvalidSigner");
  });
});
