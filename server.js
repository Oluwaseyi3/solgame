// server.js - Express server to expose PerpRug game data and APIs
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const BN = require('bn.js');
const web3 = require('@solana/web3.js');
const bs58 = require('bs58');

// Import PerpRug functions
const {
    initializeMeteora,
    executeMeteoraRugpull,
    addLiquidityToPool,
    executeSwap
} = require('./meteora-integration');

// Import from main game if needed
const {
    loadCurrentGame,
    createPerpToken
} = require('./index'); // Make sure these functions are exported in index.js

// Constants
const PORT = process.env.PORT || 3000;
const GAME_DATA_DIR = path.join(__dirname, 'game_data');
const CURRENT_GAME_FILE = path.join(GAME_DATA_DIR, 'current_game.json');
const GAME_HISTORY_FILE = path.join(GAME_DATA_DIR, 'game_history.json');
const SLIPPAGE = parseFloat(process.env.SLIPPAGE || "0.1");  // 0.1% slippage by default

// Initialize Express
const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Initialize Solana connection and wallet
let connection;
let operatorKeypair;
let meteora;

async function initializeWallet() {
    // Set up connection
    const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
    connection = new web3.Connection(RPC_URL, {
        commitment: 'confirmed',
        confirmTransactionInitialTimeout: 60000 // 60 seconds
    });

    // Set up wallet
    const OPERATOR_ADMIN_PRIVATE_KEY_STRING = process.env.OPERATOR_ADMIN_PRIVATE_KEY;
    if (!OPERATOR_ADMIN_PRIVATE_KEY_STRING) {
        throw new Error("OPERATOR_ADMIN_PRIVATE_KEY missing in .env");
    }

    let decodedSecretKeyBytes;
    try {
        decodedSecretKeyBytes = bs58.decode(OPERATOR_ADMIN_PRIVATE_KEY_STRING);
        operatorKeypair = web3.Keypair.fromSecretKey(decodedSecretKeyBytes);
        console.log(`Server using wallet: ${operatorKeypair.publicKey.toBase58()}`);
    } catch (error) {
        throw new Error(`Error decoding private key: ${error.message}`);
    }

    // Initialize Meteora
    console.log("Initializing Meteora SDK...");
    meteora = await initializeMeteora(connection, operatorKeypair);
    console.log("Meteora SDK initialized successfully.");
}

// Utility functions
function loadGameHistory() {
    try {
        if (fs.existsSync(GAME_HISTORY_FILE)) {
            return JSON.parse(fs.readFileSync(GAME_HISTORY_FILE, 'utf8'));
        }
        return [];
    } catch (error) {
        console.error("Error loading game history:", error.message);
        return [];
    }
}

function loadGameStatus() {
    try {
        if (fs.existsSync(CURRENT_GAME_FILE)) {
            return JSON.parse(fs.readFileSync(CURRENT_GAME_FILE, 'utf8'));
        }
        return null;
    } catch (error) {
        console.error("Error loading current game:", error.message);
        return null;
    }
}

// API Routes

// Get current game status
app.get('/api/status', (req, res) => {
    const currentGame = loadGameStatus();

    if (!currentGame) {
        return res.json({
            status: 'No active game',
            game: null
        });
    }

    const now = Math.floor(Date.now() / 1000);
    let status = 'unknown';
    let timeLeft = 0;

    if (currentGame.isRugged) {
        status = 'rugged';
    } else if (now >= currentGame.scheduledRugTime) {
        status = 'pending_rug';
        timeLeft = 0;
    } else {
        status = 'active';
        timeLeft = currentGame.scheduledRugTime - now;
    }

    res.json({
        status,
        timeLeft,
        game: currentGame
    });
});

// Get game history
app.get('/api/history', (req, res) => {
    const history = loadGameHistory();
    res.json(history);
});

// Get token info
app.get('/api/token/:mintAddress', async (req, res) => {
    try {
        const mintAddress = req.params.mintAddress;
        const mintPubkey = new web3.PublicKey(mintAddress);

        // Find token in game history
        const history = loadGameHistory();
        const token = history.find(game => game.tokenMint === mintAddress);

        if (token) {
            return res.json(token);
        }

        // Get supply info from chain if token not found in history
        const supply = await connection.getTokenSupply(mintPubkey);

        res.json({
            mint: mintAddress,
            supply: supply.value
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Swap tokens
app.post('/api/swap', async (req, res) => {
    try {
        if (!meteora) {
            await initializeWallet();
        }

        const { poolId, amount, fromSOL = true, slippage = SLIPPAGE } = req.body;

        if (!poolId) {
            return res.status(400).json({ error: 'Pool ID is required' });
        }

        if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
            return res.status(400).json({ error: 'Valid amount is required' });
        }

        console.log(`Executing swap on pool ${poolId}...`);
        console.log(`Amount: ${amount} ${fromSOL ? 'SOL' : 'tokens'}`);
        console.log(`Direction: ${fromSOL ? 'SOL -> token' : 'token -> SOL'}`);

        const result = await executeSwap(
            meteora,
            poolId,
            parseFloat(amount),
            fromSOL,
            parseFloat(slippage)
        );

        res.json({
            success: result.success,
            txid: result.txid,
            input: result.inputAmount,
            output: result.minimumOutputAmount,
            error: result.error
        });
    } catch (error) {
        console.error("Error executing swap:", error.message);
        res.status(500).json({ error: error.message });
    }
});

// Add liquidity
app.post('/api/addLiquidity', async (req, res) => {
    try {
        if (!meteora) {
            await initializeWallet();
        }

        const { poolId, solAmount } = req.body;

        if (!poolId) {
            return res.status(400).json({ error: 'Pool ID is required' });
        }

        if (!solAmount || isNaN(parseFloat(solAmount)) || parseFloat(solAmount) <= 0) {
            return res.status(400).json({ error: 'Valid SOL amount is required' });
        }

        // Get current game to calculate token ratio
        const currentGame = loadGameStatus();
        if (!currentGame || currentGame.poolId !== poolId) {
            return res.status(400).json({ error: 'Pool not found in current game' });
        }

        // Calculate token amount based on pool ratio
        const tokenAmount = BigInt(Math.floor(parseFloat(solAmount) * web3.LAMPORTS_PER_SOL *
            (currentGame.initialTokenAmount / currentGame.initialSolAmount)));

        console.log(`Adding liquidity to pool ${poolId}...`);
        console.log(`Adding ${solAmount} SOL and ${tokenAmount.toString()} tokens`);

        const result = await addLiquidityToPool(
            meteora,
            poolId,
            new BN(tokenAmount.toString()),
            new BN(Math.floor(parseFloat(solAmount) * web3.LAMPORTS_PER_SOL))
        );

        res.json({
            success: result.success,
            txid: result.txid,
            lpAmount: result.lpAmount
        });
    } catch (error) {
        console.error("Error adding liquidity:", error.message);
        res.status(500).json({ error: error.message });
    }
});

// Execute rugpull - protected by API key for security
app.post('/api/rugpull', async (req, res) => {
    try {
        // Check for API key authorization
        const apiKey = req.headers['x-api-key'];
        if (!apiKey || apiKey !== process.env.API_KEY) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        if (!meteora) {
            await initializeWallet();
        }

        const { poolId } = req.body;

        if (!poolId) {
            return res.status(400).json({ error: 'Pool ID is required' });
        }

        console.log(`Executing rugpull for pool ${poolId}...`);

        const result = await executeMeteoraRugpull(meteora, poolId, SLIPPAGE);

        res.json({
            success: result.success,
            txid: result.txid,
            amountA: result.amountA,
            amountB: result.amountB,
            error: result.error
        });
    } catch (error) {
        console.error("Error executing rugpull:", error.message);
        res.status(500).json({ error: error.message });
    }
});



// Start the server
app.listen(PORT, async () => {
    try {
        await initializeWallet();
        console.log(`PerpRug API server running on port ${PORT}`);
    } catch (error) {
        console.error("Failed to initialize server:", error.message);
        process.exit(1);
    }
});