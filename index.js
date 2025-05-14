// PerpRug-Meteora.js - JavaScript version with updated Meteora integration
// Author: Claude (Converted by AI)
// Version: 2.3.0 (100% Supply to LP)

import dotenv from 'dotenv';
dotenv.config();
import { fileURLToPath } from 'url';
import * as anchor from "@coral-xyz/anchor";
import * as web3 from '@solana/web3.js';
import * as splToken from '@solana/spl-token';
import bs58 from 'bs58';
import cron from 'node-cron';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { BN } from 'bn.js';
import { Metaplex, keypairIdentity } from '@metaplex-foundation/js';
import express from 'express';
import readline from 'readline';

// --- Import Updated Meteora Integration ---
import {
    initializeMeteora,
    createMeteoraPool,
    performWithdrawal,
} from './meteora-integration.js'; // Ensure this path is correct

// --- Import Metaplex Integration ---
// Assuming metaplex-integration.js is in the same directory and exports createTokenMetadata
// You'll need to convert metaplex-integration.js to ES Module format if it's not already.
// Example: export async function createTokenMetadata(...) { ... }
import { createTokenMetadata } from './metaplex-integration.js';


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Express Server Setup ---
const PORT = process.env.PORT || 3000;
const app = express();
app.use(express.json());

app.get('/', (req, res) => {
    res.json({
        status: 'running',
        service: 'PerpRug Meteora',
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    });
});

app.get('/status', (req, res) => {
    try {
        const currentGame = loadCurrentGame();
        res.json({
            currentGame,
            operatorWallet: operatorKeypair ? operatorKeypair.publicKey.toBase58() : null,
            treasuryWallet: treasuryWalletPublicKey ? treasuryWalletPublicKey.toBase58() : null,
            rpcEndpoint: connection ? connection.rpcEndpoint : null,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/current-game', (req, res) => {
    try {
        const currentGame = loadCurrentGame();
        res.json(currentGame || { message: 'No active game' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/history', (req, res) => {
    try {
        const history = fs.existsSync(GAME_HISTORY_FILE)
            ? JSON.parse(fs.readFileSync(GAME_HISTORY_FILE, 'utf8'))
            : [];
        res.json(history);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});


// --- Utility Functions ---
async function retryWithBackoff(
    operation,
    retries = 5,
    initialDelay = 500,
    maxDelay = 10000
) {
    let delay = initialDelay;
    for (let i = 0; i <= retries; i++) {
        try {
            return await operation();
        } catch (error) {
            if (i === retries) {
                console.error(`Operation failed after ${retries} retries:`, error.message, error.stack);
                throw error;
            }
            const isRateLimit = error.message?.includes('429') || error.message?.includes('Too Many Requests') || error.message?.includes('rate limit');
            if (isRateLimit) {
                console.log(`Rate limit hit. Retrying after ${delay}ms delay... (Attempt ${i + 1}/${retries})`);
            } else {
                console.log(`Operation failed. Retrying after ${delay}ms delay... (Attempt ${i + 1}/${retries})`);
                console.log(`Error was: ${error.message}`);
            }
            await new Promise(resolve => setTimeout(resolve, delay));
            delay = Math.min(delay * 1.5 + Math.random() * 100, maxDelay);
        }
    }
    throw new Error('This should never be reached');
}

const WSOL_MINT_ADDRESS_FOR_BALANCE = new web3.PublicKey("So11111111111111111111111111111111111111112"); // For getWalletBalance

async function getWalletBalance(walletKeypair, retries = 3) {
    let nativeBalance = 0;
    let wsolBalance = 0;
    for (let i = 0; i < retries; i++) {
        try {
            const commitments = ['confirmed', 'finalized', 'processed'];
            const commitment = commitments[i % commitments.length];
            logWithTimestamp(`Checking native SOL balance (attempt ${i + 1}/${retries}, commitment: ${commitment})...`);
            nativeBalance = await connection.getBalance(walletKeypair.publicKey, commitment);
            logWithTimestamp(`Native SOL balance: ${nativeBalance / web3.LAMPORTS_PER_SOL} SOL`);
            break;
        } catch (error) {
            logWithTimestamp(`Error checking native balance (attempt ${i + 1}/${retries}): ${error.message}`);
            if (i < retries - 1) {
                const nextUrl = getNextRpcUrl();
                logWithTimestamp(`Switching to RPC: ${nextUrl}`);
                connection = new web3.Connection(nextUrl, connectionConfig); // Re-assign global connection
                if (meteora) { // Re-initialize meteora context if it exists
                    try {
                        logWithTimestamp("Re-initializing Meteora context with new connection...");
                        meteora = await initializeMeteora(connection, operatorKeypair);
                    } catch (initError) {
                        console.error("Failed to re-initialize Meteora after RPC switch:", initError);
                    }
                }
                await new Promise(resolve => setTimeout(resolve, 1000));
            } else if (i === retries - 1) {
                console.error("Final attempt to get native balance failed.");
            }
        }
    }
    try {
        logWithTimestamp("Checking Wrapped SOL (WSOL) balance...");
        const tokenAccounts = await connection.getTokenAccountsByOwner(walletKeypair.publicKey, { programId: splToken.TOKEN_PROGRAM_ID });
        for (const { account } of tokenAccounts.value) { // Removed pubkey as it wasn't used
            const accountData = splToken.AccountLayout.decode(account.data);
            const mint = new web3.PublicKey(accountData.mint);
            if (mint.equals(WSOL_MINT_ADDRESS_FOR_BALANCE)) {
                const amount = Number(accountData.amount); // amount is bigint, convert to Number
                wsolBalance += amount;
                // logWithTimestamp(`Found WSOL account: ${pubkey.toBase58()} with ${amount / 10 ** 9} WSOL`); // pubkey removed
            }
        }
        logWithTimestamp(`Total WSOL balance (lamports): ${wsolBalance}, (WSOL: ${wsolBalance / (10 ** 9)})`);
    } catch (error) {
        logWithTimestamp(`Error checking WSOL balance: ${error.message}`);
    }
    const totalBalance = nativeBalance + wsolBalance; // Both are in lamports
    logWithTimestamp(`Total balance (SOL + WSOL): ${totalBalance / web3.LAMPORTS_PER_SOL} SOL`);

    // If balance is still too low, use a minimum for testing (e.g. during local dev if wallet is empty)
    // This might be undesirable in production.
    if (process.env.USE_MIN_BALANCE_FOR_TESTING === 'true' && totalBalance < 10000) {
        logWithTimestamp("Balance appears too low. Using minimum balance for testing as per env config.");
        return 50000000; // 0.05 SOL for testing
    }
    return totalBalance;
}

const FALLBACK_RPC_URLS = (process.env.FALLBACK_RPC_URLS || 'https://api.mainnet-beta.solana.com,https://rpc.ankr.com/solana,https://solana-api.projectserum.com').split(',');
let currentRpcIndex = 0;
function getNextRpcUrl() {
    currentRpcIndex = (currentRpcIndex + 1) % FALLBACK_RPC_URLS.length;
    logWithTimestamp(`Switching to fallback RPC: ${FALLBACK_RPC_URLS[currentRpcIndex]}`);
    return FALLBACK_RPC_URLS[currentRpcIndex].trim();
}

// --- Configuration ---
const RPC_URL = process.env.SOLANA_RPC_URL
const OPERATOR_ADMIN_PRIVATE_KEY_STRING = process.env.OPERATOR_ADMIN_PRIVATE_KEY;
const TREASURY_WALLET_ADDRESS = process.env.TREASURY_WALLET_ADDRESS;
const NETWORK_ENV = process.env.NETWORK_ENV || 'mainnet-beta';
const TOKEN_DECIMALS = parseInt(process.env.TOKEN_DECIMALS || "9");
const TOKEN_TOTAL_SUPPLY = parseInt(process.env.TOKEN_TOTAL_SUPPLY || "1000000000"); // Whole tokens
const MIN_RUGPULL_SECONDS = parseInt(process.env.MIN_RUGPULL_SECONDS || "900");
const MAX_RUGPULL_SECONDS = parseInt(process.env.MAX_RUGPULL_SECONDS || "3600");
const METEORA_POOL_CONFIG = process.env.METEORA_POOL_CONFIG_KEY; // Must be set, e.g., "AGMMfsf2P82tnk1XjFnU1LTS5as7KgALMW5ips3c2Csa"
const MAX_SOL_PER_POOL = parseFloat(process.env.MAX_SOL_FOR_LP || "0.01"); // SOL to pair with 100% of tokens

if (!METEORA_POOL_CONFIG) {
    console.error("METEORA_POOL_CONFIG_KEY environment variable is not set. This is required.");
    process.exit(1);
}

const GAME_DATA_DIR = path.join(__dirname, 'game_data');
const CURRENT_GAME_FILE = path.join(GAME_DATA_DIR, 'current_game.json');
const GAME_HISTORY_FILE = path.join(GAME_DATA_DIR, 'game_history.json');
const TOKEN_COUNTER_FILE = path.join(GAME_DATA_DIR, 'token_counter.txt');

if (!OPERATOR_ADMIN_PRIVATE_KEY_STRING) {
    console.error("OPERATOR_ADMIN_PRIVATE_KEY missing in .env. Exiting.");
    process.exit(1);
}

let decodedSecretKeyBytes;
try {
    if (typeof bs58.decode === 'function') decodedSecretKeyBytes = bs58.decode(OPERATOR_ADMIN_PRIVATE_KEY_STRING);
    else if (bs58.default && typeof bs58.default.decode === 'function') decodedSecretKeyBytes = bs58.default.decode(OPERATOR_ADMIN_PRIVATE_KEY_STRING);
    else throw new Error("bs58.decode function not found.");
    if (!decodedSecretKeyBytes || decodedSecretKeyBytes.length !== 64) throw new Error(`Decoded key is invalid or ${decodedSecretKeyBytes ? decodedSecretKeyBytes.length : 'undefined'} bytes, expected 64.`);
} catch (error) {
    console.error("Error decoding private key:", error.message);
    process.exit(1);
}
const operatorKeypair = web3.Keypair.fromSecretKey(decodedSecretKeyBytes);

let treasuryWalletPublicKey = null;
if (TREASURY_WALLET_ADDRESS) {
    try {
        treasuryWalletPublicKey = new web3.PublicKey(TREASURY_WALLET_ADDRESS);
        console.log(`Treasury Wallet for withdrawals: ${treasuryWalletPublicKey.toBase58()}`);
    } catch (error) {
        console.error(`Invalid treasury wallet address: ${error.message}`);
        console.warn("Withdrawals will go to the operator wallet.");
        treasuryWalletPublicKey = null;
    }
}

const connectionConfig = {
    commitment: 'confirmed',
    confirmTransactionInitialTimeout: 90000, // Increased timeout
    disableRetryOnRateLimit: false, // Let our retry logic handle it
    httpHeaders: { 'Content-Type': 'application/json' }
};
let connection = new web3.Connection(RPC_URL, connectionConfig);
let meteora = null; // Will be initialized Meteora context

console.log(`PerpRug Operator Wallet: ${operatorKeypair.publicKey.toBase58()}`);
console.log(`🔗 Connected to ${connection.rpcEndpoint} on ${NETWORK_ENV}`);

if (!fs.existsSync(GAME_DATA_DIR)) {
    fs.mkdirSync(GAME_DATA_DIR, { recursive: true });
    console.log(`Created game data directory at ${GAME_DATA_DIR}`);
}

let tokenCounter = 0;
function loadTokenCounter() {
    try {
        if (fs.existsSync(TOKEN_COUNTER_FILE)) {
            const counterData = fs.readFileSync(TOKEN_COUNTER_FILE, 'utf8');
            const parsedCounter = parseInt(counterData.trim(), 10);
            tokenCounter = isNaN(parsedCounter) ? 0 : parsedCounter;
        } else {
            fs.writeFileSync(TOKEN_COUNTER_FILE, '0', 'utf8');
        }
        console.log(`Loaded token counter: ${tokenCounter}`);
    } catch (e) {
        console.error("Error loading/saving counter:", e.message); tokenCounter = 0;
    }
}
function saveTokenCounter() {
    try {
        fs.writeFileSync(TOKEN_COUNTER_FILE, tokenCounter.toString(), 'utf8');
        console.log(`Saved token counter: ${tokenCounter}`);
    } catch (e) { console.error("Error saving counter:", e.message); }
}
function saveCurrentGame(gameData) {
    try {
        fs.writeFileSync(CURRENT_GAME_FILE, JSON.stringify(gameData, null, 2), 'utf8');
        console.log(`Saved current game data for ${gameData.tokenName}`);
    } catch (error) { console.error("Error saving current game:", error.message); }
}
function loadCurrentGame() {
    try {
        if (fs.existsSync(CURRENT_GAME_FILE)) {
            const gameData = JSON.parse(fs.readFileSync(CURRENT_GAME_FILE, 'utf8'));
            console.log(`Loaded current game: ${gameData.tokenName}`);
            return gameData;
        }
    } catch (error) { console.error("Error loading current game:", error.message); }
    return null;
}
function appendToGameHistory(gameData) {
    try {
        let history = [];
        if (fs.existsSync(GAME_HISTORY_FILE)) {
            history = JSON.parse(fs.readFileSync(GAME_HISTORY_FILE, 'utf8'));
        }
        history.push(gameData);
        fs.writeFileSync(GAME_HISTORY_FILE, JSON.stringify(history, null, 2), 'utf8');
        console.log(`Added ${gameData.tokenName} to game history (total: ${history.length} games)`);
    } catch (error) { console.error("Error updating game history:", error.message); }
}
function logWithTimestamp(message) { const timestamp = new Date().toISOString(); console.log(`[${timestamp}] ${message}`); }

async function createPerpToken(tokenNumber) {
    const tokenName = `PERP100${tokenNumber}`;
    const tokenSymbol = `P${tokenNumber}`;
    logWithTimestamp(`Creating token: ${tokenName} (${tokenSymbol}) with ${TOKEN_DECIMALS} decimals.`);
    let mintKeypair, mintPublicKey;
    let attemptCount = 0;
    const maxAttempts = 3;
    while (attemptCount < maxAttempts) {
        try {
            mintKeypair = web3.Keypair.generate();
            logWithTimestamp(`New Mint Keypair (Attempt ${attemptCount + 1}): ${mintKeypair.publicKey.toBase58()}`);
            mintPublicKey = await splToken.createMint(
                connection,
                operatorKeypair, // Payer
                operatorKeypair.publicKey, // Mint authority
                operatorKeypair.publicKey, // Freeze authority
                TOKEN_DECIMALS,
                mintKeypair, // Mint keypair
                { commitment: 'confirmed' },
                splToken.TOKEN_PROGRAM_ID
            );
            logWithTimestamp(`Token Mint Account Created: ${mintPublicKey.toBase58()}`);
            break;
        } catch (error) {
            attemptCount++;
            if (error.message?.includes("already in use")) {
                logWithTimestamp(`Mint address already in use. Retrying...`);
                if (attemptCount >= maxAttempts) throw new Error(`Failed to create mint after ${maxAttempts} attempts due to address conflicts.`);
            } else {
                console.error("Error creating mint:", error);
                throw error;
            }
        }
    }
    if (!mintPublicKey) throw new Error("Failed to create mint for token.");

    const operatorTokenAta = await retryWithBackoff(async () =>
        splToken.getOrCreateAssociatedTokenAccount(connection, operatorKeypair, mintPublicKey, operatorKeypair.publicKey, false, 'confirmed')
    );
    logWithTimestamp(`Operator's ATA for ${tokenSymbol}: ${operatorTokenAta.address.toBase58()}`);

    const amountToMintLamports = BigInt(TOKEN_TOTAL_SUPPLY) * (BigInt(10) ** BigInt(TOKEN_DECIMALS));
    await retryWithBackoff(async () =>
        splToken.mintTo(connection, operatorKeypair, mintPublicKey, operatorTokenAta.address, operatorKeypair.publicKey, amountToMintLamports, [], { commitment: 'confirmed' })
    );
    logWithTimestamp(`Minted ${TOKEN_TOTAL_SUPPLY} ${tokenSymbol} (Raw: ${amountToMintLamports}) to operator's ATA.`);

    try {
        logWithTimestamp("Creating token metadata...");
        const metadataJson = {
            name: tokenName, symbol: tokenSymbol, description: "PerpRug is a decentralized meme token.",
            image: "https://res.cloudinary.com/seyi-codes/image/upload/v1747102661/APbP7hYraQeMQ4y8apApy3zeeHCkNcd6_v1qvcj.png",
            external_url: "https://perprug.fun/", attributes: [{ trait_type: "Community", value: "Telegram" }],
            properties: { files: [{ uri: "https://res.cloudinary.com/seyi-codes/image/upload/v1747102661/APbP7hYraQeMQ4y8apApy3zeeHCkNcd6_v1qvcj.png", type: "image/png" }], category: "image", creators: [{ address: operatorKeypair.publicKey.toBase58(), share: 100 }] },
            extensions: { telegram: "https://t.me/PerpRug" }
        };
        // const metadataPath = path.join(GAME_DATA_DIR, `metadata_${tokenName}.json`); // Not strictly needed if directly uploading
        // await fs.promises.writeFile(metadataPath, JSON.stringify(metadataJson, null, 2), 'utf8');
        const metaplex = new Metaplex(connection).use(keypairIdentity(operatorKeypair));
        const { uri: metadataUri } = await metaplex.nfts().uploadMetadata(metadataJson);
        logWithTimestamp(`Metadata uploaded to Arweave: ${metadataUri}`);
        // await fs.promises.unlink(metadataPath);

        // Use the imported createTokenMetadata from metaplex-integration.js
        const metadataTx = await createTokenMetadata(connection, operatorKeypair, mintPublicKey, tokenName, tokenSymbol, metadataUri);
        logWithTimestamp(`On-chain token metadata created. Transaction: ${metadataTx}`);
    } catch (error) {
        logWithTimestamp(`⚠️ Error creating/uploading metadata: ${error.message}. Manual creation might be needed.`);
    }

    logWithTimestamp("Revoking mint and freeze authorities...");
    try {
        await splToken.setAuthority(connection, operatorKeypair, mintPublicKey, operatorKeypair.publicKey, splToken.AuthorityType.MintTokens, null, [], { commitment: 'confirmed' });
        logWithTimestamp("✅ Mint authority revoked.");
        await splToken.setAuthority(connection, operatorKeypair, mintPublicKey, operatorKeypair.publicKey, splToken.AuthorityType.FreezeAccount, null, [], { commitment: 'confirmed' });
        logWithTimestamp("✅ Freeze authority revoked.");
    } catch (error) {
        console.error("Error revoking authorities:", error.message);
        logWithTimestamp("⚠️ Failed to revoke authorities.");
    }
    return { mint: mintPublicKey, name: tokenName, symbol: tokenSymbol, decimals: TOKEN_DECIMALS, operatorTokenAccount: operatorTokenAta.address };
}

function generateRandomRugpullTime() {
    let rugpullTime = MIN_RUGPULL_SECONDS;
    const rand = Math.random();
    if (rand < 0.7) rugpullTime += Math.floor(Math.random() * (MIN_RUGPULL_SECONDS / 2)); // 15-22.5 min
    else if (rand < 0.9) rugpullTime += Math.floor(MIN_RUGPULL_SECONDS / 2 + Math.random() * (MIN_RUGPULL_SECONDS / 2)); // 22.5-30 min
    else rugpullTime += Math.floor(MIN_RUGPULL_SECONDS + Math.random() * (MAX_RUGPULL_SECONDS - MIN_RUGPULL_SECONDS - MIN_RUGPULL_SECONDS)); // 30-60 min
    return Math.min(rugpullTime, MAX_RUGPULL_SECONDS);
}

async function executeActualRugpull(gameData) {
    if (!meteora) {
        logWithTimestamp("Meteora context not initialized. Cannot perform withdrawal.");
        return { success: false, error: "Meteora context not initialized", txid: null, transferredToTreasury: false };
    }
    if (!gameData || !gameData.poolId) {
        logWithTimestamp("Invalid game data or missing pool ID for withdrawal.");
        return { success: false, error: "Invalid game data for withdrawal", txid: null, transferredToTreasury: false };
    }

    logWithTimestamp(`Attempting to perform withdrawal (full rugpull) for pool: ${gameData.poolId}`);
    try {
        // performWithdrawal in meteora-integration now handles full withdrawal of operator's LPs
        const withdrawalResult = await performWithdrawal(
            meteora, // The initialized Meteora context
            new web3.PublicKey(gameData.poolId)
            // operatorKeypair and treasuryWalletPublicKey are now derived from meteoraContext or globally
        );

        logWithTimestamp(`Withdrawal attempt finished. Success: ${withdrawalResult.success}, Tx: ${withdrawalResult.txid || 'N/A'}, Error: ${withdrawalResult.error || 'None'}`);

        let transferredToTreasuryStatus = false;
        if (withdrawalResult.success && treasuryWalletPublicKey) {
            // If withdrawal was WSOL, it's in operator's WSOL ATA.
            // Need to unwrap and transfer to treasury. This is a complex step omitted for now.
            // For now, we'll assume "transferredToTreasury" means the funds are out of the LP and
            // controlled by the operator, who could then manually transfer to treasury.
            // A true automated transfer would require more logic here.
            logWithTimestamp("Funds withdrawn from LP. Manual transfer to treasury may be required if WSOL was received.");
            transferredToTreasuryStatus = true; // Simplified: operator has control to transfer.
        }


        return {
            success: withdrawalResult.success,
            txid: withdrawalResult.txid,
            error: withdrawalResult.error,
            transferredToTreasury: transferredToTreasuryStatus
        };
    } catch (error) {
        logWithTimestamp(`Critical error during performWithdrawal call: ${error.message}`);
        return { success: false, error: error.message, txid: null, transferredToTreasury: false };
    }
}

async function gameLaunchCycleTask() {
    logWithTimestamp(`\n--- Starting PerpRug Game Cycle: ${new Date().toISOString()} ---`);
    loadTokenCounter(); // Loads global tokenCounter

    if (!meteora) { // Ensure meteora context is initialized
        try {
            logWithTimestamp("Meteora context not found, initializing...");
            meteora = await initializeMeteora(connection, operatorKeypair);
            logWithTimestamp("Meteora context initialized for game cycle.");
        } catch (error) {
            console.error("Failed to initialize Meteora context for game cycle:", error.message);
            return; // Cannot proceed without Meteora context
        }
    }

    let currentGame = loadCurrentGame();
    if (currentGame && !currentGame.isRugged) {
        logWithTimestamp(`Found active game: ${currentGame.tokenName}. Checking rugpull time...`);
        const now = Math.floor(Date.now() / 1000);
        if (now >= currentGame.scheduledRugTime) {
            logWithTimestamp(`Rugpull time overdue for ${currentGame.tokenName}! Executing rugpull...`);
            const rugResult = await executeActualRugpull(currentGame);

            currentGame.isRugged = true;
            currentGame.actualRugTime = Math.floor(Date.now() / 1000);
            currentGame.rugSuccessful = rugResult.success;
            currentGame.rugError = rugResult.error;
            currentGame.treasuryTransferred = rugResult.transferredToTreasury;

            saveCurrentGame(currentGame); // Save updated state
            appendToGameHistory(currentGame);
            logWithTimestamp(`${currentGame.tokenName} rugpull processed. Success: ${rugResult.success}.`);
            // After rugpull, allow new game creation in the next cycle
        } else {
            const timeLeft = currentGame.scheduledRugTime - now;
            logWithTimestamp(`${currentGame.tokenName} is still active. Rugpull in ${Math.floor(timeLeft / 60)}m ${timeLeft % 60}s. New game creation deferred.`);
            return; // Don't start a new game yet
        }
    }

    // If no active game, or if previous game was just rugged, proceed to create a new one.
    logWithTimestamp("Proceeding to create a new PerpRug game...");
    try {
        const nextTokenNumber = tokenCounter + 1;
        const operatorSolBalance = await getWalletBalance(operatorKeypair); // Pass keypair
        logWithTimestamp(`Operator wallet balance: ${operatorSolBalance / web3.LAMPORTS_PER_SOL} SOL`);

        const minSolForPoolAndGas = (MAX_SOL_PER_POOL + 0.05) * web3.LAMPORTS_PER_SOL; // Increased buffer for gas
        if (operatorSolBalance < minSolForPoolAndGas) {
            console.error(`Wallet SOL balance too low (${operatorSolBalance / web3.LAMPORTS_PER_SOL} SOL). Minimum ${minSolForPoolAndGas / web3.LAMPORTS_PER_SOL} SOL required for new game. Waiting for refill.`);
            return;
        }

        const tokenInfo = await createPerpToken(nextTokenNumber);

        // Use 100% of the total supply for liquidity
        const initialTokenAmountLamports = BigInt(TOKEN_TOTAL_SUPPLY) * (BigInt(10) ** BigInt(TOKEN_DECIMALS));
        const initialTokenAmountBN = new BN(initialTokenAmountLamports.toString());

        const initialSolAmountLamports = BigInt(Math.floor(MAX_SOL_PER_POOL * web3.LAMPORTS_PER_SOL));
        const initialSolAmountBN = new BN(initialSolAmountLamports.toString());

        logWithTimestamp(`Preparing LP: ${TOKEN_TOTAL_SUPPLY} [${tokenInfo.symbol}] (raw: ${initialTokenAmountBN}) and ${MAX_SOL_PER_POOL} SOL (raw: ${initialSolAmountBN})`);

        logWithTimestamp("Creating Meteora pool with 100% token supply...");
        const poolInfo = await createMeteoraPool(
            meteora,
            tokenInfo.mint,
            initialTokenAmountBN,
            initialSolAmountBN,
            METEORA_POOL_CONFIG
        );

        const rugpullOffsetSeconds = generateRandomRugpullTime();
        const startTime = Math.floor(Date.now() / 1000);
        const scheduledRugTime = startTime + rugpullOffsetSeconds;
        logWithTimestamp(`Token will be rugged in ${Math.floor(rugpullOffsetSeconds / 60)}m ${rugpullOffsetSeconds % 60}s (at ${new Date(scheduledRugTime * 1000).toLocaleString()})`);

        const gameData = {
            tokenName: tokenInfo.name, tokenSymbol: tokenInfo.symbol, tokenMint: tokenInfo.mint.toBase58(),
            tokenDecimals: tokenInfo.decimals, totalSupply: TOKEN_TOTAL_SUPPLY, startTime, rugpullOffsetSeconds,
            scheduledRugTime, operatorTokenAccount: tokenInfo.operatorTokenAccount.toBase58(), // ATA holding minted tokens
            poolId: poolInfo.poolId.toBase58(), poolConfigKey: poolInfo.feeConfig.toBase58(),
            poolCreationTxids: poolInfo.txids, lpMint: poolInfo.lpMint ? poolInfo.lpMint.toBase58() : "N/A",
            treasuryWallet: treasuryWalletPublicKey ? treasuryWalletPublicKey.toBase58() : "N/A",
            initialSolAmount: MAX_SOL_PER_POOL, // SOL units
            initialTokenAmount: TOKEN_TOTAL_SUPPLY, // Whole token units
            isRugged: false, actualRugTime: undefined, rugSuccessful: undefined, treasuryTransferred: false, rugError: undefined
        };
        saveCurrentGame(gameData);
        tokenCounter = nextTokenNumber; // Update global counter
        saveTokenCounter();
        logWithTimestamp(`🚀 ${tokenInfo.name} created! 100% supply added to Meteora LP. Pool ID: ${poolInfo.poolId.toBase58()}. Game is LIVE!`);
    } catch (error) {
        console.error(`Error launching new PerpRug game:`, error.message);
        if (error.stack) console.error("Stack trace for game launch error:", error.stack);
        if (error.logs) console.error("Solana logs for game launch error:", error.logs);
    }
}

async function launchNewPerpRoundAndScheduleRugpull() {
    try {
        await gameLaunchCycleTask();
    } catch (error) {
        console.error("Unhandled error in launchNewPerpRoundAndScheduleRugpull:", error.message, error.stack);
        if (error.message?.includes('429') || error.message?.includes('Too Many Requests') || error.message?.includes('rate limit') || error.message?.includes('timeout')) {
            try {
                logWithTimestamp("Attempting to switch RPC endpoint due to critical errors...");
                const nextUrl = getNextRpcUrl();
                connection = new web3.Connection(nextUrl, connectionConfig);
                logWithTimestamp("Reinitializing Meteora context with new connection after critical error...");
                meteora = await initializeMeteora(connection, operatorKeypair);
                logWithTimestamp("RPC connection switched & Meteora re-initialized. Next cycle will retry.");
            } catch (fallbackError) {
                console.error("Fallback RPC switch and Meteora re-init also failed:", fallbackError.message);
            }
        }
    }
}

function logSystemInfo() {
    try {
        const uptime = os.uptime();
        const uptimeHours = Math.floor(uptime / 3600);
        const uptimeMinutes = Math.floor((uptime % 3600) / 60);
        const uptimeSeconds = Math.floor(uptime % 60);
        const freeMemGB = os.freemem() / (1024 ** 3);
        const totalMemGB = os.totalmem() / (1024 ** 3);
        console.log(`\n--- System Info ---
Server Uptime: ${uptimeHours}h ${uptimeMinutes}m ${uptimeSeconds}s
Memory: ${freeMemGB.toFixed(2)}GB free / ${totalMemGB.toFixed(2)}GB total
CPU Load (1m, 5m, 15m): ${os.loadavg().map(l => l.toFixed(2)).join(', ')}
Hostname: ${os.hostname()}, Platform: ${os.type()} ${os.release()}
RPC: ${connection.rpcEndpoint}, Meteora Initialized: ${!!meteora}
---------------------\n`);
    } catch (error) { console.error("Error logging system info:", error.message); }
}

async function initializeAndScheduleGame() {
    logWithTimestamp(`PerpRug Game Initializing on ${NETWORK_ENV}...`);
    logSystemInfo(); // Initial system info
    try {
        logWithTimestamp("Initializing Meteora context for the application...");
        meteora = await initializeMeteora(connection, operatorKeypair); // Initialize global meteora context
        logWithTimestamp("Global Meteora context initialized successfully.");

        // Run on start if configured, useful for testing or immediate first game
        if (process.env.RUN_ON_START === 'true') {
            logWithTimestamp(`RUN_ON_START is true. Launching first game cycle immediately...`);
            await launchNewPerpRoundAndScheduleRugpull();
        }

        // Schedule game launches (e.g., hourly, or specific minutes past the hour)
        const cronGameSchedule = process.env.CRON_GAME_SCHEDULE || '0 0,49 * * * *'; // Default: xx:00:00 and xx:30:00
        logWithTimestamp(`Scheduling new game launches with cron: "${cronGameSchedule}"`);
        cron.schedule(cronGameSchedule, async () => {
            logWithTimestamp(`\n${new Date().toISOString()} Cron job (Game Launch) triggered...`);
            await launchNewPerpRoundAndScheduleRugpull();
        });

        // Schedule rugpull checks (more frequent, e.g., every minute)
        const cronRugSchedule = process.env.CRON_RUG_SCHEDULE || '* * * * *'; // Default: every minute
        logWithTimestamp(`Scheduling rugpull checks with cron: "${cronRugSchedule}"`);
        cron.schedule(cronRugSchedule, async () => {
            const currentGame = loadCurrentGame();
            if (currentGame && !currentGame.isRugged) {
                const now = Math.floor(Date.now() / 1000);
                if (now >= currentGame.scheduledRugTime) {
                    logWithTimestamp(`\n${new Date().toISOString()} Cron job (Rug Check) - Time for ${currentGame.tokenName}! Executing rugpull...`);
                    const rugResult = await executeActualRugpull(currentGame);
                    currentGame.isRugged = true;
                    currentGame.actualRugTime = Math.floor(Date.now() / 1000);
                    currentGame.rugSuccessful = rugResult.success;
                    currentGame.rugError = rugResult.error;
                    currentGame.treasuryTransferred = rugResult.transferredToTreasury;
                    saveCurrentGame(currentGame);
                    appendToGameHistory(currentGame);
                    logWithTimestamp(`${currentGame.tokenName} rugpull processed via cron rug check. Success: ${rugResult.success}.`);
                }
            }
        });

        cron.schedule('0 * * * *', logSystemInfo); // Log system info every hour

        logWithTimestamp("PerpRug game scheduler running. Press Ctrl+C to exit.");
        process.on('SIGINT', () => { logWithTimestamp("\nSIGINT received. Shutting down scheduler..."); cron.getTasks().forEach(task => task.stop()); logWithTimestamp(`PerpRug game exited.`); process.exit(0); });

        app.listen(PORT, '0.0.0.0', () => {
            console.log(`PerpRug API server running at http://0.0.0.0:${PORT}`);
            console.log(`Health check: / | Status: /status | Current Game: /current-game | History: /history`);
        });

    } catch (error) {
        console.error("Critical error during application initialization:", error.message);
        if (error.stack) console.error("Stack:", error.stack);
        process.exit(1);
    }
}

function setupCommandInterface() {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    logWithTimestamp("Command interface ready. Type 'help' for available commands.");
    rl.on('line', async (input) => {
        const args = input.trim().split(' ');
        const command = args[0].toLowerCase();
        switch (command) {
            case 'help':
                console.log(`\n--- PerpRug CLI Commands ---
help                  - Show this help message
status                - Show current game & system status
rugpull               - Manually trigger rugpull for the current game
create                - Manually create a new game (if no active one)
balance               - Check operator wallet SOL & WSOL balance
exit                  - Exit the program
--------------------------\n`);
                break;
            case 'status':
                logSystemInfo();
                const game = loadCurrentGame();
                if (game) {
                    console.log("\n--- Current Game Status ---");
                    console.log(JSON.stringify(game, null, 2));
                    if (!game.isRugged) {
                        const timeLeft = game.scheduledRugTime - Math.floor(Date.now() / 1000);
                        console.log(`Time until scheduled rug: ${Math.floor(timeLeft / 60)}m ${timeLeft % 60}s`);
                    }
                } else console.log("No active game found.");
                console.log("-------------------------\n");
                break;
            case 'rugpull':
                const currentGameToRug = loadCurrentGame();
                if (currentGameToRug && !currentGameToRug.isRugged) {
                    logWithTimestamp(`Manually triggering rugpull for ${currentGameToRug.tokenName}...`);
                    const rugResult = await executeActualRugpull(currentGameToRug);
                    currentGameToRug.isRugged = true;
                    currentGameToRug.actualRugTime = Math.floor(Date.now() / 1000);
                    currentGameToRug.rugSuccessful = rugResult.success;
                    currentGameToRug.rugError = rugResult.error;
                    currentGameToRug.treasuryTransferred = rugResult.transferredToTreasury;
                    saveCurrentGame(currentGameToRug);
                    appendToGameHistory(currentGameToRug);
                    logWithTimestamp(`Manual rugpull for ${currentGameToRug.tokenName} processed. Success: ${rugResult.success}.`);
                } else console.log("No active game to rugpull or game already rugged.");
                break;
            case 'create':
                logWithTimestamp("Manually attempting to create a new game via CLI...");
                await launchNewPerpRoundAndScheduleRugpull();
                break;
            case 'balance':
                try {
                    const bal = await getWalletBalance(operatorKeypair);
                    logWithTimestamp(`Operator wallet total balance: ${bal / web3.LAMPORTS_PER_SOL} SOL`);
                } catch (err) { console.error(`Error checking balance:`, err.message); }
                break;
            case 'exit': logWithTimestamp("Exiting PerpRug via CLI..."); process.exit(0); break;
            default: console.log(`Unknown command: ${command}. Type 'help'.`);
        }
    });
    rl.on('close', () => { logWithTimestamp("Command interface closed."); process.exit(0); });
}

// --- Main Execution ---
initializeAndScheduleGame()
    .then(() => {
        if (process.env.ENABLE_CLI !== 'false') { // Enable CLI by default
            setupCommandInterface();
        } else {
            logWithTimestamp("CLI disabled via ENABLE_CLI environment variable.");
        }
    })
    .catch(err => {
        console.error("Fatal error during application startup:", err.message);
        if (err.stack) console.error("Startup Stack Trace:", err.stack);
        process.exit(1);
    });