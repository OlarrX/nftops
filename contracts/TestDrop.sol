// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * TestDrop
 * ---------------------------------------------------------------------------
 * A deliberately realistic PUBLIC mint, built to exercise the NFTOps snipe bot
 * end-to-end on a testnet. Unlike MyERC721 (owner-only, per-token URI), this
 * behaves like an actual FCFS drop:
 *
 *   - ANYONE can mint (no onlyOwner on the mint) — like a real public sale.
 *   - `mint(uint256 quantity)` — exactly the shape the bot auto-fills: it maps
 *     the single uint slot to your chosen quantity, no arguments to type.
 *   - Payable: costs `mintPrice` per NFT (set 0 at deploy for a free mint).
 *   - A sale toggle (`saleIsActive`) the owner flips on — so you can also test
 *     the bot's "📡 Watch until live": arm the watch while it's OFF, flip it ON
 *     from your wallet, and watch the bot detect the flip and fire/alert.
 *
 * It exposes the exact getter NAMES the bot's recon probes for, so every field
 * lights up in Telegram: totalSupply, maxSupply, mintPrice, saleIsActive,
 * maxPerWallet.
 *
 * TESTNET ONLY. This is a practice target, not a production drop contract.
 */
contract TestDrop is ERC721, Ownable {
    uint256 public totalSupply;      // minted so far (recon: TOTAL_SUPPLY_SIG)
    uint256 public maxSupply;        // hard cap    (recon: MAX_SUPPLY_NAMES)
    uint256 public mintPrice;        // wei per NFT (recon: PRICE_NAMES)
    bool public saleIsActive;        // sale gate   (recon: SALE_BOOL_NAMES)
    uint256 public maxPerWallet;     // per-wallet cap (recon: MAX_WALLET_NAMES)

    mapping(address => uint256) public mintedBy;

    string private _base;
    uint256 private _nextId;

    /**
     * @param name_        collection name (e.g. "Test Drop")
     * @param symbol_      collection symbol (e.g. "TEST")
     * @param mintPrice_   price PER NFT in wei (0 = free mint)
     * @param maxSupply_   hard cap on total mints
     * @param maxPerWallet_ per-wallet cap (0 = no limit)
     * @param initialOwner owner (can toggle the sale, set price, withdraw)
     */
    constructor(
        string memory name_,
        string memory symbol_,
        uint256 mintPrice_,
        uint256 maxSupply_,
        uint256 maxPerWallet_,
        address initialOwner
    ) ERC721(name_, symbol_) Ownable(initialOwner) {
        mintPrice = mintPrice_;
        maxSupply = maxSupply_;
        maxPerWallet = maxPerWallet_;
        // Sale starts OFF on purpose, so you can test "watch until live" by
        // flipping it on later. Call setSaleActive(true) to open immediately.
        saleIsActive = false;
    }

    /**
     * Public mint. Anyone may call while the sale is active. Sends the caller
     * `quantity` freshly numbered tokens, charging mintPrice each.
     * This is the function the bot fires: signature `mint(uint256)`.
     */
    function mint(uint256 quantity) external payable {
        require(saleIsActive, "Sale not active");
        require(quantity > 0, "Quantity must be > 0");
        require(totalSupply + quantity <= maxSupply, "Exceeds max supply");
        require(msg.value >= mintPrice * quantity, "Insufficient payment");
        if (maxPerWallet > 0) {
            require(mintedBy[msg.sender] + quantity <= maxPerWallet, "Exceeds per-wallet limit");
        }

        mintedBy[msg.sender] += quantity;
        for (uint256 i = 0; i < quantity; i++) {
            _safeMint(msg.sender, _nextId);
            _nextId++;
            totalSupply++;
        }
    }

    // --- Owner controls (for driving the test) --------------------------------

    /// Flip the sale on/off. Turning it ON is what "watch until live" waits for.
    function setSaleActive(bool active) external onlyOwner {
        saleIsActive = active;
    }

    /// Change the per-NFT price (wei). Handy for testing the max-spend ceiling.
    function setMintPrice(uint256 newPrice) external onlyOwner {
        mintPrice = newPrice;
    }

    /// Set the metadata base URI (optional; fine to leave empty on a testnet).
    function setBaseURI(string memory base) external onlyOwner {
        _base = base;
    }

    /// Withdraw any ETH the mint collected to the owner.
    function withdraw() external onlyOwner {
        (bool ok, ) = payable(owner()).call{value: address(this).balance}("");
        require(ok, "Withdraw failed");
    }

    function _baseURI() internal view override returns (string memory) {
        return _base;
    }
}
