// test-rugpull.js - Test Script for Meteora Rugpull Function
require('dotenv').config();
const web3 = require('@solana/web3.js');
const bs58 = require('bs58');
const BN = require('bn.js');

// Import the Meteora integration
const {
    initializeMeteora,
    executeMeteoraRugpull
} = require('./meteora-integration');

// Get pool ID from command line args or use default
const poolId = "DVSFnXX1D2JjmBa2WZTrT68MdMSZjepgKJSh5Br9XLVq"; // Default pool ID
const slippage = 0.1; // 0.1% slippage

async function testRugpull() {
    console.log(`\n--- Testing Rugpull Function with Pool ID: ${poolId} ---\n`);

    // Setup connection and wallet
    const RPC_URL = process.env.SOLANA_RPC_URL || 'https://mainnet.helius-rpc.com/?api-key=d4079cbf-5910-429e-b9d0-d77d6c3bfe97';
    const OPERATOR_ADMIN_PRIVATE_KEY_STRING = process.env.OPERATOR_ADMIN_PRIVATE_KEY;

    // Decode private key
    if (!OPERATOR_ADMIN_PRIVATE_KEY_STRING) {
        console.error("OPERATOR_ADMIN_PRIVATE_KEY missing in .env. Exiting.");
        process.exit(1);
    }

    let decodedSecretKeyBytes;
    try {
        decodedSecretKeyBytes = bs58.decode(OPERATOR_ADMIN_PRIVATE_KEY_STRING);
    } catch (error) {
        console.error("Error decoding private key:", error.message);
        process.exit(1);
    }

    const operatorKeypair = web3.Keypair.fromSecretKey(decodedSecretKeyBytes);
    console.log(`Using wallet: ${operatorKeypair.publicKey.toBase58()}`);

    // Initialize connection
    const connection = new web3.Connection(RPC_URL, {
        commitment: 'confirmed',
        confirmTransactionInitialTimeout: 60000
    });
    console.log(`Connected to: ${RPC_URL}`);

    // Initialize Meteora SDK
    console.log("Initializing Meteora SDK...");
    const meteora = await initializeMeteora(connection, operatorKeypair);
    console.log("Meteora SDK initialized successfully.");

    // Execute rugpull
    console.log(`\nExecuting rugpull for pool: ${poolId}`);
    console.log(`Using slippage: ${slippage}%`);
    try {
        const result = await executeMeteoraRugpull(meteora, poolId, slippage);

        console.log("\n--- Rugpull Result ---");
        console.log(JSON.stringify(result, null, 2));
        console.log("------------------------\n");

        if (result.success) {
            console.log("✅ Rugpull was successful!");
            console.log(`Transaction: ${result.txid}`);
            console.log(`Tokens withdrawn: ${result.amountA}`);
            console.log(`SOL withdrawn: ${result.amountB}`);
        } else {
            console.log("❌ Rugpull failed.");
            console.log(`Error: ${result.error}`);
        }
    } catch (error) {
        console.error("Error executing rugpull test:", error.message);
        if (error.stack) console.error(error.stack);
    }
}

// Run the test
testRugpull().catch(console.error);