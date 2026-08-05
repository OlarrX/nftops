// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * MyERC721
 * A minimal, owner-controlled ERC-721 collection.
 *
 * - Constructor args: (string name, string symbol, address initialOwner)
 * - Minting: only the owner can mint. Each token stores its own metadata URI
 *   (per-token tokenURI), which is the simplest model for non-dev users:
 *   you pass a full metadata URI per mint (e.g. ipfs://.../1.json).
 *
 * The CLI's `mintEvm` ERC-721 flow calls `safeMint(to, tokenURI)`.
 */
contract MyERC721 is ERC721URIStorage, Ownable {
    uint256 private _nextTokenId;

    constructor(
        string memory name_,
        string memory symbol_,
        address initialOwner
    ) ERC721(name_, symbol_) Ownable(initialOwner) {}

    /// @notice Mint one token to `to` with a full metadata `uri`. Returns the new tokenId.
    function safeMint(address to, string memory uri) public onlyOwner returns (uint256) {
        uint256 tokenId = _nextTokenId++;
        _safeMint(to, tokenId);
        _setTokenURI(tokenId, uri);
        return tokenId;
    }
}
