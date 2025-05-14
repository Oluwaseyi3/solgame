// fix-metadata-direct.js - Direct approach using standard Solana methods
require('dotenv').config();

const web3 = require('@solana/web3.js');
const bs58 = require('bs58');
const { Metaplex, keypairIdentity } = require('@metaplex-foundation/js');

// Your token details
const TOKEN_MINT = "21TZuwbphcQRPEGbrL4vKmGUcYo24kEvNkdPehfhGUAD";
const ARWEAVE_URI = "https://arweave.net/hZJ4inlsOEmPWZC11ikluR6P9Fg1n6rCqRZII4uL0F8";

// Configuration
const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const OPERATOR_ADMIN_PRIVATE_KEY_STRING = process.env.OPERATOR_ADMIN_PRIVATE_KEY;

// Initialize
const operatorKeypair = web3.Keypair.fromSecretKey(bs58.decode(OPERATOR_ADMIN_PRIVATE_KEY_STRING));
const connection = new web3.Connection(RPC_URL, { commitment: 'confirmed' });
const metaplex = new Metaplex(connection).use(keypairIdentity(operatorKeypair));

async function createMetadataSimple() {
    console.log("=== Creating Metadata - Simple Approach ===\n");

    try {
        const mint = new web3.PublicKey(TOKEN_MINT);

        // 1. Check if metadata already exists
        console.log("Checking existing metadata...");
        try {
            const existing = await metaplex.nfts().findByMint({ mintAddress: mint });
            console.log("✅ Metadata already exists!");
            console.log(`Name: ${existing.name}`);
            console.log(`Symbol: ${existing.symbol}`);
            return existing;
        } catch (e) {
            console.log("No existing metadata found");
        }

        // 2. Create metadata using Metaplex v0.20+ syntax
        console.log("Creating new metadata...");

        const { nft } = await metaplex.nfts().create({
            uri: ARWEAVE_URI,
            name: "TEST_PERP_TOKEN",
            symbol: "TEST",
            sellerFeeBasisPoints: 0,
            useExistingMint: mint,
        });

        console.log("✅ Metadata created successfully!");
        console.log(`Transaction: ${nft.response.signature}`);
        console.log(`Name: ${nft.name}`);
        console.log(`Symbol: ${nft.symbol}`);
        console.log(`URI: ${nft.uri}`);

        return nft;

    } catch (error) {
        console.error("❌ Metaplex creation failed:", error.message);
        console.log("Trying manual approach...");
        return await createMetadataManual();
    }
}

async function createMetadataManual() {
    console.log("\n=== Manual Metadata Creation ===\n");

    try {
        const mint = new web3.PublicKey(TOKEN_MINT);

        // Define the metadata program ID
        const METADATA_PROGRAM_ID = new web3.PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");

        // 1. Calculate metadata account (PDA)
        const seeds = [
            Buffer.from("metadata"),
            METADATA_PROGRAM_ID.toBuffer(),
            mint.toBuffer(),
        ];

        const [metadataAccount, bump] = await web3.PublicKey.findProgramAddress(
            seeds,
            METADATA_PROGRAM_ID
        );

        console.log(`Metadata account: ${metadataAccount.toBase58()}`);

        // 2. Check if account already exists
        const existingAccount = await connection.getAccountInfo(metadataAccount);
        if (existingAccount) {
            console.log("✅ Metadata account already exists");
            return metadataAccount.toBase58();
        }

        // 3. Create metadata using raw instruction
        console.log("Creating metadata account...");

        // Create the metadata instruction manually
        const metadataData = {
            name: "TEST_PERP_TOKEN",
            symbol: "TEST",
            uri: ARWEAVE_URI,
            sellerFeeBasisPoints: 0,
            creators: [
                {
                    address: operatorKeypair.publicKey.toBase58(),
                    verified: true,
                    share: 100
                }
            ]
        };

        // Build transaction
        const transaction = new web3.Transaction();

        // Add create metadata instruction (simplified)
        const keys = [
            { pubkey: metadataAccount, isSigner: false, isWritable: true },
            { pubkey: mint, isSigner: false, isWritable: false },
            { pubkey: operatorKeypair.publicKey, isSigner: true, isWritable: false },
            { pubkey: operatorKeypair.publicKey, isSigner: true, isWritable: true },
            { pubkey: operatorKeypair.publicKey, isSigner: true, isWritable: false },
            { pubkey: web3.SystemProgram.programId, isSigner: false, isWritable: false },
            { pubkey: new web3.PublicKey("11111111111111111111111111111111"), isSigner: false, isWritable: false },
        ];

        // This is a simplified approach - for production, you'd want to use the proper MPL library
        console.log("⚠️ Manual instruction creation requires MPL library");
        console.log("Falling back to high-level Metaplex API...");

        return await createMetadataFallback();

    } catch (error) {
        console.error("❌ Manual creation failed:", error.message);
        throw error;
    }
}

async function createMetadataFallback() {
    console.log("\n=== Fallback: Using Metaplex Builder ===\n");

    try {
        const mint = new web3.PublicKey(TOKEN_MINT);

        // Use the builder pattern with explicit options
        const builder = metaplex.nfts().builders().create({
            uri: ARWEAVE_URI,
            name: "TEST_PERP_TOKEN",
            symbol: "TEST",
            sellerFeeBasisPoints: 0,
            useExistingMint: mint,
            mintAuthority: operatorKeypair,
            updateAuthority: operatorKeypair,
            primarySaleHappened: false,
            isMutable: false,
            tokenStandard: 0, // NonFungible
        });

        // Build the transaction
        const buildOutput = await builder.build();
        console.log("Transaction built successfully");

        // Send transaction
        const { signature } = await metaplex.rpc().sendAndConfirmTransaction(buildOutput, {
            commitment: 'confirmed'
        });

        console.log(`✅ Metadata created! Transaction: ${signature}`);

        // Verify
        const nft = await metaplex.nfts().findByMint({ mintAddress: mint });
        console.log(`Name: ${nft.name}`);
        console.log(`Symbol: ${nft.symbol}`);
        console.log(`URI: ${nft.uri}`);

        return nft;

    } catch (error) {
        console.error("❌ Fallback creation failed:", error.message);
        console.log("\n🔍 Debugging info:");
        console.log("This might be a token standard issue.");
        console.log("Your SPL token might need specific token standard settings.");

        throw error;
    }
}

async function main() {
    console.log(`Creating metadata for token: ${TOKEN_MINT}\n`);

    try {
        // Check initial balance
        const balance = await connection.getBalance(operatorKeypair.publicKey);
        console.log(`Wallet balance: ${balance / web3.LAMPORTS_PER_SOL} SOL\n`);

        if (balance < 0.01 * web3.LAMPORTS_PER_SOL) {
            throw new Error("Insufficient balance for transaction fees");
        }

        // Try creating metadata
        await createMetadataSimple();

        // Final verification
        console.log("\n=== Final Check ===");
        console.log(`Check your token here: https://explorer.solana.com/address/${TOKEN_MINT}`);
        console.log("If it still shows 'unknown', wait a few minutes for indexing.");

    } catch (error) {
        console.error("\n💥 Process failed:", error.message);
        console.log("\n📝 What we know:");
        console.log("✅ Your token exists");
        console.log("✅ Metadata JSON is on Arweave");
        console.log("❌ On-chain metadata link is missing");
        console.log("\n🛠️ Solutions:");
        console.log("1. Wait for Solana network congestion to clear");
        console.log("2. Try again with a different RPC endpoint");
        console.log("3. Use Solana Explorer manual metadata creation");
        console.log(`4. Visit: https://explorer.solana.com/address/${TOKEN_MINT}`);
        console.log(`5. Click 'Initialize Metadata' if available`);
    }
}

main().catch(console.error);