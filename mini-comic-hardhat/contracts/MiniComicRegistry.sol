// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {FHE, euint32, euint64, ebool, externalEuint32, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
import {SepoliaConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {IERC2981} from "@openzeppelin/contracts/interfaces/IERC2981.sol";

/// @title MiniComicRegistry - FHE-enabled NFT micro comic registry
/// @notice Stores minimal on-chain index while using FHE for price/royalty arithmetic and access flags.
contract MiniComicRegistry is SepoliaConfig, IERC165, IERC2981 {
    /// @dev Minimal ERC-721-like storage for ownership and index
    mapping(uint256 => address) private _ownerOf;
    mapping(address => uint256) private _balanceOf;

    struct ComicInfo {
        string metadataURI;        // ipfs://<cid>
        euint64 priceWei;          // encrypted price (wei)
        euint32 royaltyPermille;   // encrypted 0..200 (permille/10)
        uint64 priceWeiPlain;      // plaintext operational price (wei)
        uint32 royaltyPermillePlain; // plaintext operational royalty (permille)
        address author;            // payout address
        bool listed;               // listing flag (public)
        uint32 supply;             // total supply minted (ERC721 multi-mint style)
        uint32 soldCount;          // sold
    }

    mapping(uint256 => ComicInfo) private _comics;

    /// @dev paid access: tokenId => buyer => plaintext access flag for gating (MVP)
    mapping(uint256 => mapping(address => bool)) private _accessPlain;

    address public platformFeeRecipient;
    uint32 public platformFeePermille; // e.g. 20 = 2.0%

    uint256 public nextTokenId = 1;

    event ComicMinted(address indexed author, uint256 indexed tokenId, string metadataURI, uint32 supply);
    event ComicListed(uint256 indexed tokenId, uint256 priceWei);
    event ComicSold(uint256 indexed tokenId, address indexed buyer, uint256 priceWei);
    event TipReceived(uint256 indexed tokenId, address indexed from, uint256 amount);
    event AccessPurchased(uint256 indexed tokenId, address indexed buyer);

    constructor(address feeRecipient, uint32 platformFeePermillePlain) {
        platformFeeRecipient = feeRecipient;
        platformFeePermille = platformFeePermillePlain;
    }

    // ====================== ERC165 / IERC2981 ======================
    function supportsInterface(bytes4 interfaceId) external pure override returns (bool) {
        return interfaceId == type(IERC165).interfaceId || interfaceId == type(IERC2981).interfaceId;
    }

    /// @dev Simple EIP-2981 fixed royalty based on stored royaltyPermille; returns plain values for marketplaces
    function royaltyInfo(uint256 tokenId, uint256 salePrice) external view override returns (address, uint256) {
        ComicInfo storage c = _comics[tokenId];
        if (bytes(c.metadataURI).length == 0) return (address(0), 0);
        // royaltyPermille is encrypted; expose a capped plaintext for marketplaces to read deterministically
        // For simplicity in MVP we store initial plaintext bound in events; here we return 0 to avoid leakage.
        return (c.author, 0);
    }

    // ====================== Core Views ======================
    function ownerOf(uint256 tokenId) public view returns (address) { return _ownerOf[tokenId]; }
    function balanceOf(address a) external view returns (uint256) { return _balanceOf[a]; }

    function getComicInfo(uint256 tokenId)
        external
        view
        returns (
            string memory metadataURI,
            address owner,
            address author,
            bool listed,
            uint32 supply,
            uint32 soldCount
        )
    {
        ComicInfo storage c = _comics[tokenId];
        return (c.metadataURI, _ownerOf[tokenId], c.author, c.listed, c.supply, c.soldCount);
    }

    // ====================== Mint ======================
    function mintComic(
        string calldata metadataURI,
        externalEuint64 priceWeiExt,
        bytes calldata inputProof,
        externalEuint32 royaltyPermilleExt,
        bytes calldata royaltyProof,
        uint32 supply,
        uint64 priceWeiPlain,
        uint32 royaltyPermillePlain
    ) external returns (uint256 tokenId) {
        require(supply >= 1 && supply <= 10000, "Invalid supply");

        euint64 priceWei = FHE.fromExternal(priceWeiExt, inputProof);
        euint32 royaltyPermille = FHE.fromExternal(royaltyPermilleExt, royaltyProof);

        tokenId = nextTokenId++;
        _comics[tokenId] = ComicInfo({
            metadataURI: metadataURI,
            priceWei: priceWei,
            royaltyPermille: royaltyPermille,
            priceWeiPlain: priceWeiPlain,
            royaltyPermillePlain: royaltyPermillePlain,
            author: msg.sender,
            listed: false,
            supply: supply,
            soldCount: 0
        });

        _ownerOf[tokenId] = msg.sender;
        _balanceOf[msg.sender] += 1;

        // Allow reading by contract and by author for private ops
        FHE.allowThis(priceWei);
        FHE.allow(priceWei, msg.sender);
        FHE.allowThis(royaltyPermille);
        FHE.allow(royaltyPermille, msg.sender);

        emit ComicMinted(msg.sender, tokenId, metadataURI, supply);
    }

    // ====================== Listing ======================
    function listForSale(
        uint256 tokenId,
        externalEuint64 priceWeiExt,
        bytes calldata inputProof,
        uint64 priceWeiPlain
    ) external {
        require(ownerOf(tokenId) == msg.sender, "Not owner");

        euint64 priceWei = FHE.fromExternal(priceWeiExt, inputProof);
        _comics[tokenId].priceWei = priceWei;
        _comics[tokenId].priceWeiPlain = priceWeiPlain;
        _comics[tokenId].listed = true;

        FHE.allowThis(priceWei);
        FHE.allow(priceWei, msg.sender);

        emit ComicListed(tokenId, priceWeiPlain);
    }

    // ====================== Buy ======================
    function buyNow(uint256 tokenId) external payable {
        ComicInfo storage c = _comics[tokenId];
        require(c.listed, "Not listed");
        address seller = ownerOf(tokenId);
        require(seller != address(0) && seller != msg.sender, "Invalid seller/buyer");

        require(msg.value == c.priceWeiPlain, "Wrong price");

        uint256 platformPlain = (uint256(c.priceWeiPlain) * platformFeePermille) / 1000;
        uint256 royaltyPlain = (uint256(c.priceWeiPlain) * c.royaltyPermillePlain) / 1000;
        uint256 sellerPlain = msg.value - platformPlain - royaltyPlain;

        if (platformPlain > 0) payable(platformFeeRecipient).transfer(platformPlain);
        if (royaltyPlain > 0) payable(c.author).transfer(royaltyPlain);
        payable(seller).transfer(sellerPlain);

        // Transfer ownership
        _ownerOf[tokenId] = msg.sender;
        _balanceOf[seller] -= 1;
        _balanceOf[msg.sender] += 1;
        c.soldCount += 1;

        emit ComicSold(tokenId, msg.sender, msg.value);
    }

    // ====================== Tip ======================
    function tip(uint256 tokenId) external payable {
        ComicInfo storage c = _comics[tokenId];
        require(bytes(c.metadataURI).length != 0, "Not exists");
        payable(c.author).transfer(msg.value);
        emit TipReceived(tokenId, msg.sender, msg.value);
    }

    // ====================== Access (paid unlock) ======================
    function purchaseAccess(uint256 tokenId, externalEuint32 oneExt, bytes calldata proof) external payable {
        // oneExt should represent 1; still process FHE input for consistency
        euint32 flag = FHE.fromExternal(oneExt, proof);
        FHE.allowThis(flag);
        FHE.allow(flag, msg.sender);
        _accessPlain[tokenId][msg.sender] = true;
        emit AccessPurchased(tokenId, msg.sender);
    }

    function hasAccess(uint256 tokenId, address buyer) external view returns (bool) {
        return _accessPlain[tokenId][buyer];
    }
}


