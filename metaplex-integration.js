// metaplex-integration.js - Metaplex integration for token metadata (ES Module Version)

// ES Module Imports
// Note: Metaplex JS SDK might have specific ways to import for ESM, check their docs if issues arise.
// For now, assuming named imports work.
import { Metaplex } from '@metaplex-foundation/js'; // Usually a default export or specific class
// In metaplex-integration.js
import mplTokenMetadata from '@metaplex-foundation/mpl-token-metadata';

const {
    createCreateMetadataAccountV3Instruction, // Still a named export on the module object
    PROGRAM_ID: TOKEN_METADATA_PROGRAM_ID      // Access PROGRAM_ID from the imported module object
} = mplTokenMetadata;
import { PublicKey, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
// PROGRAM_ID already imported and aliased from mpl-token-metadata


/**
 * Create metadata for a token
 * @param {Connection} connection - Solana connection
 * @param {Keypair} payer - The wallet paying for the transaction
 * @param {PublicKey} mint - The token mint address
 * @param {string} name - Token name
 * @param {string} symbol - Token symbol
 * @param {string} uri - Optional metadata URI
 * @returns {Promise<string>} - Transaction signature
 */
// Export the function directly using the 'export' keyword
export async function createTokenMetadata(connection, payer, mint, name, symbol, uri = '') {
    console.log(`[Metaplex Integration] Creating metadata for token: ${name} (${symbol}) at mint: ${mint.toBase58()}`);

    // Initialize Metaplex - this might not be needed if you're just using mpl-token-metadata instructions
    // const metaplex = Metaplex.make(connection); // Updated way to init Metaplex if using its full features
    // If you only need the instruction, Metaplex instance isn't strictly required here.

    // Derive the metadata PDA
    // findProgramAddressSync is fine.
    const [metadataPDA] = PublicKey.findProgramAddressSync(
        [
            Buffer.from('metadata'),
            TOKEN_METADATA_PROGRAM_ID.toBuffer(),
            mint.toBuffer(),
        ],
        TOKEN_METADATA_PROGRAM_ID
    );

    console.log(`[Metaplex Integration] Metadata PDA: ${metadataPDA.toBase58()}`);

    // Prepare data for metadata account
    const tokenMetadata = {
        name,
        symbol,
        uri,
        sellerFeeBasisPoints: 0, // Or your desired fee
        creators: null,          // Or [{ address: payer.publicKey, verified: true, share: 100 }]
        collection: null,
        uses: null
    };

    console.log("[Metaplex Integration] Preparing metadata creation instruction...");

    // Create the instruction
    const instruction = createCreateMetadataAccountV3Instruction(
        {
            metadata: metadataPDA,
            mint: mint, // Ensure this is a PublicKey instance
            mintAuthority: payer.publicKey,
            payer: payer.publicKey,
            updateAuthority: payer.publicKey,
        },
        {
            createMetadataAccountArgsV3: {
                data: tokenMetadata,
                isMutable: true,      // Or false if you want immutable metadata after creation
                collectionDetails: null // Set if part of a Metaplex Certified Collection
            }
        }
    );

    // Create and send transaction
    console.log("[Metaplex Integration] Creating and sending metadata transaction...");
    const transaction = new Transaction().add(instruction);

    // The payer (operatorKeypair) needs to sign this transaction
    const signature = await sendAndConfirmTransaction(
        connection,
        transaction,
        [payer], // payer is your operatorKeypair
        { commitment: 'confirmed' }
    );

    console.log(`[Metaplex Integration] Metadata created successfully! Transaction: ${signature}`);
    return signature;
}

// No module.exports needed when using `export async function ...`