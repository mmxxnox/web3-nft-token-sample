import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

// Deploys the utility token, then the NFT collection wired to it.
// Override any parameter with --parameters <file.json>; see README.
export default buildModule("ShowcaseModule", (m) => {
  const admin = m.getAccount(0);

  const token = m.contract("ShowcaseToken", [
    admin,
    m.getParameter("tokenCap", 10_000_000n * 10n ** 18n),
    m.getParameter("initialSupply", 1_000_000n * 10n ** 18n),
  ]);

  const nft = m.contract("ShowcaseNFT", [
    admin,
    m.getParameter("treasury", admin),
    token,
    m.getParameter("maxSupply", 1_000n),
    m.getParameter("maxPerWallet", 5n),
    m.getParameter("ethPrice", 10n ** 16n), // 0.01 ETH
    m.getParameter("tokenPrice", 100n * 10n ** 18n),
    m.getParameter("royaltyBps", 500n),
    m.getParameter("hiddenURI", "ipfs://REPLACE_ME/hidden.json"),
  ]);

  return { token, nft };
});
