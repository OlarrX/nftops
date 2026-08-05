// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * MyERC1155
 * A minimal, owner-controlled ERC-1155 multi-token.
 *
 * - Constructor args: (string baseUri, address initialOwner)
 *   `baseUri` should contain the `{id}` template per the ERC-1155 metadata spec,
 *   e.g. "ipfs://CID/{id}.json". Clients substitute the hex token id.
 * - Minting: only the owner can mint. You choose a token `id` and an `amount`
 *   (supply). This is the simplest 1155 model: metadata comes from baseUri + id,
 *   so you do NOT pass a per-mint URI here.
 *
 * The CLI's `mintEvm` ERC-1155 flow calls `mint(to, id, amount)`.
 */
contract MyERC1155 is ERC1155, Ownable {
    constructor(
        string memory baseUri,
        address initialOwner
    ) ERC1155(baseUri) Ownable(initialOwner) {}

    /// @notice Mint `amount` of token `id` to `to`.
    function mint(address to, uint256 id, uint256 amount) public onlyOwner {
        _mint(to, id, amount, "");
    }

    /// @notice Update the base metadata URI (owner only).
    function setURI(string memory newuri) public onlyOwner {
        _setURI(newuri);
    }
}
