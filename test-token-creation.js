// test-token-creation-fixed.js
require('dotenv').config();

const web3 = require('@solana/web3.js');
const splToken = require('@solana/spl-token');
const bs58 = require('bs58');
// const fs = require('fs'); // Not used
// const path = require('path'); // Not used
// const BN = require('bn.js'); // Not used directly, spl-token handles amounts
const { Metaplex, keypairIdentity, bundlrStorage } = require('@metaplex-foundation/js');
// For TokenStandard, if needed and not on Metaplex object directly
// const { TokenStandard } = require('@metaplex-foundation/mpl-token-metadata');


// Configuration from environment
const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const OPERATOR_ADMIN_PRIVATE_KEY_STRING = process.env.OPERATOR_ADMIN_PRIVATE_KEY;
const TOKEN_DECIMALS = parseInt(process.env.TOKEN_DECIMALS || "9");
const TOKEN_TOTAL_SUPPLY = parseInt("1000000"); // 1M

// Test configuration
const TEST_TOKEN_NAME = "TEST_PERP_TOKEN_V2"; // Changed slightly to avoid collision if old one exists
const TEST_TOKEN_SYMBOL = "TESTV2";

// Initialize connection and wallet
if (!OPERATOR_ADMIN_PRIVATE_KEY_STRING) {
    console.error("OPERATOR_ADMIN_PRIVATE_KEY missing in .env. Exiting.");
    process.exit(1);
}

let decodedSecretKeyBytes;
try {
    if (typeof bs58.decode === 'function') {
        decodedSecretKeyBytes = bs58.decode(OPERATOR_ADMIN_PRIVATE_KEY_STRING);
    } else if (bs58.default?.decode) {
        decodedSecretKeyBytes = bs58.default.decode(OPERATOR_ADMIN_PRIVATE_KEY_STRING);
    } else {
        throw new Error("bs58.decode function not found. Ensure 'bs58' library is correctly installed.");
    }

    if (decodedSecretKeyBytes.length !== 64) {
        throw new Error(`Decoded key is ${decodedSecretKeyBytes.length} bytes, expected 64. Check your private key format.`);
    }
} catch (error) {
    console.error("Error decoding private key:", error.message);
    console.error("Ensure your private key is a valid BS58 encoded string.");
    process.exit(1);
}

const operatorKeypair = web3.Keypair.fromSecretKey(decodedSecretKeyBytes);
const connection = new web3.Connection(RPC_URL, { commitment: 'confirmed' });

console.log(`Test Wallet: ${operatorKeypair.publicKey.toBase58()}`);
console.log(`Connected to: ${connection.rpcEndpoint}`);

// Test functions
async function testTokenCreation() {
    console.log("\n=== Testing Token Creation ===");

    try {
        const balance = await connection.getBalance(operatorKeypair.publicKey);
        console.log(`Wallet balance: ${balance / web3.LAMPORTS_PER_SOL} SOL`);

        if (balance < 0.03 * web3.LAMPORTS_PER_SOL) { // Slightly increased minimum for safety
            throw new Error(`Insufficient balance. Need at least 0.03 SOL. Current: ${balance / web3.LAMPORTS_PER_SOL} SOL`);
        }

        const mintKeypair = web3.Keypair.generate(); // Fresh keypair for the mint
        console.log(`Creating new mint: ${mintKeypair.publicKey.toBase58()}`);

        const mint = await splToken.createMint(
            connection,
            operatorKeypair, // Payer
            operatorKeypair.publicKey, // Mint authority
            operatorKeypair.publicKey, // Freeze authority
            TOKEN_DECIMALS,
            mintKeypair, // Mint keypair
            { commitment: 'confirmed' },
            splToken.TOKEN_PROGRAM_ID
        );

        console.log(`✅ Token mint created: ${mint.toBase58()}`);

        const tokenAccount = await splToken.getOrCreateAssociatedTokenAccount(
            connection,
            operatorKeypair, // Payer
            mint,
            operatorKeypair.publicKey // Owner of the new ATA
        );

        console.log(`✅ Token account created: ${tokenAccount.address.toBase58()}`);

        const amountToMint = BigInt(TOKEN_TOTAL_SUPPLY) * (BigInt(10) ** BigInt(TOKEN_DECIMALS));
        await splToken.mintTo(
            connection,
            operatorKeypair, // Payer
            mint,
            tokenAccount.address,
            operatorKeypair.publicKey, // Mint authority
            amountToMint
        );

        console.log(`✅ Minted ${TOKEN_TOTAL_SUPPLY} tokens to ${tokenAccount.address.toBase58()}`);

        return { mint, tokenAccount };
    } catch (error) {
        console.error(`❌ Token creation failed: ${error.message}`);
        if (error.stack) console.error("Stack:", error.stack);
        throw error;
    }
}

async function testMetadataCreation(mintPublicKey) {
    console.log("\n=== Testing Metadata Upload (Arweave) ===");

    try {
        const metadata = {
            name: TEST_TOKEN_NAME,
            symbol: TEST_TOKEN_SYMBOL,
            description: "Test PerpRug token (V2) for metadata testing.",
            // Ensure this image URL is publicly accessible and will remain so.
            image: "https://res.cloudinary.com/seyi-codes/image/upload/v1747102661/APbP7hYraQeMQ4y8apApy3zeeHCkNcd6_v1qvcj.png",
            external_url: "https://perprug.fun/", // Ensure this URL is valid
            attributes: [{ trait_type: "Community", value: "Test V2" }],
            properties: {
                files: [{
                    uri: "https://res.cloudinary.com/seyi-codes/image/upload/v1747102661/APbP7hYraQeMQ4y8apApy3zeeHCkNcd6_v1qvcj.png",
                    type: "image/png"
                }],
                category: "image",
                creators: [{ address: operatorKeypair.publicKey.toBase58(), share: 100 }]
            }
        };
        console.log("Metadata object prepared:", JSON.stringify(metadata, null, 2));

        const metaplex = Metaplex.make(connection)
            .use(keypairIdentity(operatorKeypair))
            .use(bundlrStorage({ // Configure Bundlr, e.g. for mainnet
                address: 'https://node1.bundlr.network',
                providerUrl: RPC_URL,
                timeout: 60000,
            }));
        console.log("Metaplex initialized with Bundlr for Arweave upload.");

        console.log("Uploading metadata to Arweave via Metaplex/Bundlr...");
        const { uri } = await metaplex.nfts().uploadMetadata(metadata); // Preferred method

        if (!uri || typeof uri !== 'string' || !uri.startsWith('http')) {
            console.error(`❌ Metadata upload returned an invalid URI: ${uri}`);
            throw new Error(`Invalid URI from metadata upload: ${uri}`);
        }

        console.log(`✅ Metadata uploaded successfully. URI: ${uri}`);
        return uri;

    } catch (error) {
        console.error(`❌ Metadata Arweave upload failed: ${error.message}`);
        if (error.stack) console.error("Stack:", error.stack);
        console.log("⚠️ If this is a Bundlr balance issue, fund your Bundlr account for this keypair or use a different storage provider.");
        throw error; // Re-throw to stop the process if critical
    }
}

async function testOnChainMetadata(mintPublicKey, metadataUri) {
    console.log("\n=== Testing On-Chain Metadata Creation ===");

    try {
        const metaplex = Metaplex.make(connection).use(keypairIdentity(operatorKeypair));
        console.log(`Creating on-chain metadata for mint ${mintPublicKey.toBase58()} with URI: ${metadataUri}`);

        // Method 1: High-level nfts().create() - Preferred for existing mints
        try {
            console.log("Attempting with metaplex.nfts().create()...");
            const { nft, response } = await metaplex
                .nfts()
                .create({
                    uri: metadataUri,
                    name: TEST_TOKEN_NAME,
                    symbol: TEST_TOKEN_SYMBOL,
                    sellerFeeBasisPoints: 0,
                    useExistingMint: mintPublicKey,
                    mintAuthority: operatorKeypair, // operatorKeypair is current mint authority of the SPL token
                    updateAuthority: operatorKeypair, // operatorKeypair will be metadata update authority
                    creators: [
                        {
                            address: operatorKeypair.publicKey,
                            share: 100,
                            // authority: operatorKeypair, // Not strictly needed if creator is the signer (keypairIdentity)
                            // SDK usually handles marking it as verified.
                        },
                    ],
                    isMutable: true, // Can be set to false later if needed
                    // tokenStandard: TokenStandard.Fungible, // Optional: For SPL Fungible. Requires import.
                    // Might affect compatibility or display in some wallets.
                    // Metaplex might infer correctly for existing SPL token mints.
                });

            console.log(`✅ On-chain metadata (Method 1) created! Signature: ${response.signature}`);
            console.log(`   Associated token metadata account: ${nft.address.toBase58()}`);
            return response.signature;

        } catch (highLevelError) {
            console.error(`❌ On-chain metadata (Method 1) failed: ${highLevelError.message}`);
            if (highLevelError.stack) console.error("Stack:", highLevelError.stack);
            console.log("Attempting fallback: On-chain metadata with nfts().builders().create()...");

            // Method 2: Fallback using nfts().builders().create() with useExistingMint
            try {
                const metadataPda = metaplex.nfts().pdas().metadata({ mint: mintPublicKey });
                const masterEditionPda = metaplex.nfts().pdas().masterEdition({ mint: mintPublicKey });

                console.log(`   Calculated Metadata PDA: ${metadataPda.toBase58()}`);
                // Check if metadata already exists (e.g. from a partial previous run)
                const existingMetadata = await metaplex.rpc().getAccount(metadataPda);
                if (existingMetadata.exists) {
                    console.log("✅ Metadata account already exists at:", metadataPda.toBase58(), "- Skipping creation.");
                    // Attempt to fetch and return some identifier if possible, or just a success marker
                    const existingNft = await metaplex.nfts().findByMint({ mintAddress: mintPublicKey });
                    console.log("   Existing NFT Name: ", existingNft.name);
                    return "existing"; // Or a dummy signature string
                }


                const transactionBuilder = metaplex
                    .nfts()
                    .builders()
                    .create({
                        uri: metadataUri,
                        name: TEST_TOKEN_NAME,
                        symbol: TEST_TOKEN_SYMBOL,
                        sellerFeeBasisPoints: 0,
                        useExistingMint: mintPublicKey, // Crucial for existing SPL tokens
                        // mintAuthority: operatorKeypair, // Handled by useExistingMint if payer is mint authority
                        updateAuthority: operatorKeypair,
                        creators: [
                            {
                                address: operatorKeypair.publicKey,
                                share: 100,
                                verified: true, // Explicitly verified as operatorKeypair is signing
                            },
                        ],
                        isMutable: true,
                        // tokenStandard: TokenStandard.Fungible, // As above
                    });

                // Set fee payer explicitly if not automatically picked up by keypairIdentity in all builder contexts
                // transactionBuilder.setFeePayer(operatorKeypair); 

                const { signature, confirmResponse } = await metaplex.rpc().sendAndConfirmTransaction(
                    transactionBuilder,
                    { commitment: 'confirmed' }
                    // If you need to pass signers explicitly with some builders:
                    // { signers: [operatorKeypair] }
                );

                if (confirmResponse.value.err) {
                    throw new Error(`Transaction failed confirmation: ${JSON.stringify(confirmResponse.value.err)}`);
                }

                console.log(`✅ On-chain metadata (Method 2 - Builder) created! Signature: ${signature}`);
                return signature;

            } catch (lowLevelError) {
                console.error(`❌ On-chain metadata (Method 2 - Builder) also failed: ${lowLevelError.message}`);
                if (lowLevelError.stack) console.error("Stack:", lowLevelError.stack);
                console.log("⚠️ Skipping on-chain metadata creation for this test run due to errors.");
                return null;
            }
        }
    } catch (error) {
        console.error(`❌ Unexpected error in on-chain metadata creation: ${error.message}`);
        if (error.stack) console.error("Stack:", error.stack);
        return null;
    }
}


async function testRevokeAuthorities(mintPublicKey) {
    console.log("\n=== Testing Authority Revocation ===");

    try {
        const mintInfo = await splToken.getMint(connection, mintPublicKey);
        console.log(`Current mint authority: ${mintInfo.mintAuthority?.toBase58() || 'None'}`);
        console.log(`Current freeze authority: ${mintInfo.freezeAuthority?.toBase58() || 'None'}`);

        if (mintInfo.mintAuthority && mintInfo.mintAuthority.equals(operatorKeypair.publicKey)) {
            console.log("Revoking mint authority...");
            await splToken.setAuthority(
                connection,
                operatorKeypair, // Payer and current authority
                mintPublicKey,
                operatorKeypair.publicKey, // Current authority
                splToken.AuthorityType.MintTokens,
                null // New authority (none)
            );
            console.log("✅ Mint authority revoked.");
        } else {
            console.log("ℹ️ Mint authority is already None or not controlled by operator.");
        }

        if (mintInfo.freezeAuthority && mintInfo.freezeAuthority.equals(operatorKeypair.publicKey)) {
            console.log("Revoking freeze authority...");
            await splToken.setAuthority(
                connection,
                operatorKeypair, // Payer and current authority
                mintPublicKey,
                operatorKeypair.publicKey, // Current authority
                splToken.AuthorityType.FreezeAccount,
                null // New authority (none)
            );
            console.log("✅ Freeze authority revoked.");
        } else {
            console.log("ℹ️ Freeze authority is already None or not controlled by operator.");
        }
        return true;
    } catch (error) {
        console.error(`❌ Authority revocation failed: ${error.message}`);
        if (error.stack) console.error("Stack:", error.stack);
        throw error;
    }
}

async function verifyTokenCreation(mintPublicKey, metadataUriUsed, onChainTxSignature) {
    console.log("\n=== Verifying Token Creation & Metadata ===");

    try {
        const mintInfo = await splToken.getMint(connection, mintPublicKey);
        console.log(`✅ Mint info retrieved for ${mintPublicKey.toBase58()}:`);
        console.log(`   Supply: ${mintInfo.supply.toString()}`); // Use toString() for BigInt
        console.log(`   Decimals: ${mintInfo.decimals}`);
        console.log(`   Mint Authority: ${mintInfo.mintAuthority?.toBase58() || 'None'}`);
        console.log(`   Freeze Authority: ${mintInfo.freezeAuthority?.toBase58() || 'None'}`);

        if (onChainTxSignature && onChainTxSignature !== "existing") {
            console.log(`   On-chain metadata transaction: https://explorer.solana.com/tx/${onChainTxSignature}`);
        } else if (onChainTxSignature === "existing") {
            console.log(`   On-chain metadata was pre-existing.`);
        }


        const metaplex = Metaplex.make(connection).use(keypairIdentity(operatorKeypair)); // No storage needed for find
        try {
            console.log(`Fetching NFT data using Metaplex for mint: ${mintPublicKey.toBase58()}`);
            const nft = await metaplex.nfts().findByMint({ mintAddress: mintPublicKey });
            console.log(`✅ On-chain metadata successfully found:`);
            console.log(`   Name: ${nft.name}`);
            console.log(`   Symbol: ${nft.symbol}`);
            console.log(`   URI: ${nft.uri}`);
            console.log(`   Loaded Metadata from URI:`, nft.json); // Metaplex loads JSON from URI by default

            if (nft.uri !== metadataUriUsed && metadataUriUsed) { // Compare with URI we intended to use
                console.warn(`⚠️ URI Mismatch: Expected ${metadataUriUsed}, Found ${nft.uri}`);
            }
        } catch (metadataError) {
            console.error(`❌ Failed to retrieve on-chain metadata via Metaplex: ${metadataError.message}`);
            if (metadataError.stack) console.error("Stack:", metadataError.stack);
            console.log("   This might happen if on-chain metadata creation step failed or URI was invalid.");
        }

        return true;
    } catch (error) {
        console.error(`❌ Verification failed: ${error.message}`);
        if (error.stack) console.error("Stack:", error.stack);
        throw error;
    }
}

// Main test runner
async function runAllTests() {
    console.log("🚀 Starting Token Creation and Metadata Tests 🚀\n");
    console.log(`Target: Keep costs reasonable (mainnet fees apply).`);
    console.log(`Using reduced supply: ${TOKEN_TOTAL_SUPPLY} tokens with ${TOKEN_DECIMALS} decimals.\n`);

    let startBalanceLamports;
    try {
        startBalanceLamports = await connection.getBalance(operatorKeypair.publicKey);
        console.log(`Starting balance: ${startBalanceLamports / web3.LAMPORTS_PER_SOL} SOL\n`);
    } catch (e) {
        console.error("Failed to get initial balance. Is RPC working?", e.message);
        process.exit(1);
    }


    let mintResult, metadataUri, onChainMetadataSignature;

    try {
        // Test 1: Create token (mint and token account)
        mintResult = await testTokenCreation();
        const mintPublicKey = mintResult.mint;

        // Test 2: Create and upload metadata to Arweave
        // This step can be costly and sometimes unreliable depending on Bundlr network status/fees
        metadataUri = await testMetadataCreation(mintPublicKey);

        // Test 3: Create on-chain metadata linking the mint to the Arweave URI
        onChainMetadataSignature = await testOnChainMetadata(mintPublicKey, metadataUri);

        // Test 4: Revoke mint/freeze authorities for the SPL Token
        await testRevokeAuthorities(mintPublicKey);

        // Test 5: Verify everything
        await verifyTokenCreation(mintPublicKey, metadataUri, onChainMetadataSignature);

        const endBalanceLamports = await connection.getBalance(operatorKeypair.publicKey);
        const totalCostLamports = startBalanceLamports - endBalanceLamports;
        const totalCostSOL = totalCostLamports / web3.LAMPORTS_PER_SOL;

        console.log("\n🎉🎉 All tests completed! 🎉🎉");
        console.log(`\n📊 Cost Summary:`);
        console.log(`- Starting balance: ${(startBalanceLamports / web3.LAMPORTS_PER_SOL).toFixed(9)} SOL`);
        console.log(`- Ending balance:   ${(endBalanceLamports / web3.LAMPORTS_PER_SOL).toFixed(9)} SOL`);
        console.log(`- Total cost:       ${totalCostSOL.toFixed(9)} SOL`);

        console.log(`\n🔗 Important Addresses & Links:`);
        console.log(`- Token Mint Address: ${mintPublicKey.toBase58()}`);
        console.log(`- Associated Token Account: ${mintResult.tokenAccount.address.toBase58()}`);
        console.log(`- Metadata URI (Arweave): ${metadataUri}`);
        if (onChainMetadataSignature && onChainMetadataSignature !== "existing") {
            console.log(`- On-Chain Metadata Tx: https://explorer.solana.com/tx/${onChainMetadataSignature}${connection.rpcEndpoint.includes('devnet') ? '?cluster=devnet' : ''}`);
        }
        console.log(`\n🔍 View your token on Solana Explorer:`);
        console.log(`   https://explorer.solana.com/address/${mintPublicKey.toBase58()}${connection.rpcEndpoint.includes('devnet') ? '?cluster=devnet' : ''}`);

    } catch (error) {
        console.error("\n💥 Test run failed:", error.message);
        // No need to log stack here if individual functions already do it.
        // if (error.stack) console.error("Full Stack Trace:", error.stack);

        const currentBalanceLamports = await connection.getBalance(operatorKeypair.publicKey);
        const costSoFarLamports = startBalanceLamports - currentBalanceLamports;
        console.log(`\n📊 Cost Incurred Before Failure:`);
        console.log(`- Starting balance: ${(startBalanceLamports / web3.LAMPORTS_PER_SOL).toFixed(9)} SOL`);
        console.log(`- Current balance:  ${(currentBalanceLamports / web3.LAMPORTS_PER_SOL).toFixed(9)} SOL`);
        console.log(`- Cost so far:      ${(costSoFarLamports / web3.LAMPORTS_PER_SOL).toFixed(9)} SOL`);

        process.exit(1);
    }
}

// Run tests if this file is executed directly
if (require.main === module) {
    runAllTests().catch(err => {
        // This catch is mostly for unhandled promise rejections from runAllTests itself,
        // though errors within should be caught and lead to process.exit(1)
        console.error("\n🆘 Unhandled error in test execution:", err);
        process.exit(1);
    });
}

module.exports = {
    testTokenCreation,
    testMetadataCreation,
    testOnChainMetadata,
    testRevokeAuthorities,
    verifyTokenCreation,
    runAllTests,
    operatorKeypair, // Exporting for potential external use/debug
    connection
};