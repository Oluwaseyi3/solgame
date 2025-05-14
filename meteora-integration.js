// meteora-integration.js - JavaScript version

import AmmImpl, { PROGRAM_ID } from '@meteora-ag/dynamic-amm-sdk';
import { derivePoolAddressWithConfig } from '@meteora-ag/dynamic-amm-sdk/dist/cjs/src/amm/utils.js';
import {
    Connection,
    PublicKey,
    Keypair,
    VersionedTransaction,
    Transaction,
    SystemProgram
} from '@solana/web3.js';
import { Wallet as AnchorWallet, AnchorProvider } from '@coral-xyz/anchor';
import BN from 'bn.js';
import * as splToken from '@solana/spl-token';

const WSOL_MINT_ADDRESS = new PublicKey("So11111111111111111111111111111111111111112");

async function initializeMeteora(connection, operatorKeypair) {
    try {
        console.log("[Meteora Integration] Initializing Meteora context...");
        const anchorWallet = new AnchorWallet(operatorKeypair);
        const provider = new AnchorProvider(
            connection,
            anchorWallet,
            { commitment: 'confirmed', preflightCommitment: 'confirmed' }
        );
        const programId = new PublicKey(PROGRAM_ID);
        console.log("[Meteora Integration] Meteora context initialized successfully.");
        return {
            connection,
            provider,
            wallet: anchorWallet,
            operatorKeypair,
            programId
        };
    } catch (error) {
        console.error("[Meteora Integration] Error initializing Meteora context:", error.message);
        throw error;
    }
}

// async function createMeteoraPool(
//     meteoraContext,
//     tokenAMint_PublicKey,
//     tokenA_Amount_BN,
//     initialSolAmount_BN,
//     poolConfigKey_StringOrPublicKey
// ) {
//     const { connection, provider, operatorKeypair, programId } = meteoraContext; // wallet from context is AnchorWallet

//     console.log(`[Meteora Integration] Attempting to create Meteora Constant Product Pool for token A: ${tokenAMint_PublicKey.toBase58()}`);
//     console.log(`[Meteora Integration] Initial liquidity: Token A: ${tokenA_Amount_BN.toString()}, Native SOL (to be WSOL): ${initialSolAmount_BN.toString()}`);

//     const tokenBMint_PublicKey = WSOL_MINT_ADDRESS;
//     let wsolAta = null;

//     try {
//         const poolFeeConfig_PublicKey = typeof poolConfigKey_StringOrPublicKey === 'string'
//             ? new PublicKey(poolConfigKey_StringOrPublicKey)
//             : poolConfigKey_StringOrPublicKey;
//         console.log(`[Meteora Integration] Using fee configuration key: ${poolFeeConfig_PublicKey.toBase58()}`);

//         console.log("[Meteora Integration] Preparing WSOL for liquidity...");
//         const wsolAtaAccount = await splToken.getOrCreateAssociatedTokenAccount(
//             connection, operatorKeypair, WSOL_MINT_ADDRESS, operatorKeypair.publicKey
//         );
//         wsolAta = wsolAtaAccount.address;
//         console.log(`[Meteora Integration] Using WSOL ATA: ${wsolAta.toBase58()}`);

//         const solTransferAmount = initialSolAmount_BN;
//         const currentWsolBalance = await connection.getTokenAccountBalance(wsolAta).then(b => new BN(b.value.amount)).catch(() => new BN(0));

//         if (currentWsolBalance.lt(solTransferAmount)) {
//             const amountToWrap = solTransferAmount.sub(currentWsolBalance);
//             console.log(`[Meteora Integration] Current WSOL balance ${currentWsolBalance}, need ${solTransferAmount}. Wrapping an additional ${amountToWrap} SOL...`);
//             const wrapSolInstructions = [
//                 SystemProgram.transfer({
//                     fromPubkey: operatorKeypair.publicKey, toPubkey: wsolAta, lamports: amountToWrap.toNumber(),
//                 }),
//                 splToken.createSyncNativeInstruction(wsolAta)
//             ];
//             const wrapTx = new Transaction().add(...wrapSolInstructions);
//             const wrapTxId = await provider.sendAndConfirm(wrapTx, [operatorKeypair], { commitment: 'confirmed' });
//             console.log(`[Meteora Integration] Additional SOL wrapped successfully. TX: ${wrapTxId}`);
//         } else {
//             console.log(`[Meteora Integration] Sufficient WSOL already in ATA: ${currentWsolBalance.toString()}`);
//         }


//         const expectedPoolPubkey = derivePoolAddressWithConfig(
//             tokenAMint_PublicKey, tokenBMint_PublicKey, poolFeeConfig_PublicKey, programId
//         );
//         console.log(`[Meteora Integration] Expected pool address: ${expectedPoolPubkey.toBase58()}`);

//         // const operatorTokenA_Ata = await splToken.getAssociatedTokenAddress(tokenAMint_PublicKey, operatorKeypair.publicKey);
//         // console.log(`[Meteora Integration] Operator's Token A ATA: ${operatorTokenA_Ata.toBase58()}`);

//         console.log("[Meteora Integration] Building create pool transaction(s)...");
//         // Assumes SDK does NOT take ATAs based on your snippet. If it does, add them.
//         const createPoolTransactionPayload = await AmmImpl.createPermissionlessConstantProductPoolWithConfig(
//             connection, operatorKeypair.publicKey, tokenAMint_PublicKey, tokenBMint_PublicKey,
//             tokenA_Amount_BN, solTransferAmount, poolFeeConfig_PublicKey
//         );

//         const transactionsToProcess = Array.isArray(createPoolTransactionPayload) ? createPoolTransactionPayload : [createPoolTransactionPayload];
//         console.log(`[Meteora Integration] Received ${transactionsToProcess.length} transaction(s) for pool creation.`);
//         const txids = [];
//         for (let i = 0; i < transactionsToProcess.length; i++) {
//             const transaction = transactionsToProcess[i];
//             console.log(`[Meteora Integration] Sending transaction ${i + 1}/${transactionsToProcess.length} for pool creation...`);
//             const txHash = await provider.sendAndConfirm(transaction, [operatorKeypair], { commitment: 'confirmed', skipPreflight: true });
//             console.log(`[Meteora Integration] Pool creation transaction ${i + 1} successful: ${txHash}`);
//             txids.push(txHash);
//         }
//         console.log(`[Meteora Integration] All pool creation transactions processed.`);
//         const actualPoolAddress = expectedPoolPubkey;

//         // No need to close WSOL ATA if it's the main one from getOrCreate, only if truly temporary and want to reclaim rent.
//         // For simplicity, we'll leave it. If it was a one-time temp account, you'd close it.
//         // if (wsolAta && some_condition_for_temporary) { /* close account */ }


//         console.log(`[Meteora Integration] Loading created pool at ${actualPoolAddress.toBase58()} to get LP Mint...`);
//         const pool = await AmmImpl.create(connection, actualPoolAddress);
//         const lpMintPublicKey = pool.lpMint;
//         console.log(`[Meteora Integration] Pool loaded. LP Mint: ${lpMintPublicKey.toBase58()}`);

//         return {
//             poolId: actualPoolAddress, lpMint: lpMintPublicKey, feeConfig: poolFeeConfig_PublicKey, txids: txids,
//         };
//     } catch (error) {
//         console.error("[Meteora Integration] Failed to create Meteora Pool:", error.message);
//         if (error.stack) console.error("[Meteora Integration] Stack:", error.stack);
//         if (error.logs) console.error("[Meteora Integration] Solana Logs:", error.logs);
//         // No WSOL ATA closing here on error as `getOrCreate` might return an existing one.
//         // Manual cleanup might be needed if a truly one-off temporary account was used and failed.
//         throw error;
//     }
// }

async function createMeteoraPool(
    meteoraContext,
    tokenAMint_PublicKey,
    tokenA_Amount_BN,
    initialSolAmount_BN,
    poolConfigKey_StringOrPublicKey
) {
    const { connection, provider, operatorKeypair, programId } = meteoraContext;

    console.log(`[Meteora Integration] Attempting to create Meteora CP Pool for token A: ${tokenAMint_PublicKey.toBase58()}`);
    console.log(`[Meteora Integration] Initial liquidity: Token A: ${tokenA_Amount_BN.toString()}, Native SOL (for WSOL): ${initialSolAmount_BN.toString()}`);

    const tokenBMint_PublicKey = WSOL_MINT_ADDRESS;
    let wsolAtaAddress = null; // Keep track of WSOL ATA for potential cleanup if needed, though SDK might manage.

    try {
        const poolFeeConfig_PublicKey = typeof poolConfigKey_StringOrPublicKey === 'string'
            ? new PublicKey(poolConfigKey_StringOrPublicKey)
            : poolConfigKey_StringOrPublicKey;
        console.log(`[Meteora Integration] Using fee config key: ${poolFeeConfig_PublicKey.toBase58()}`);

        // --- WSOL Handling ---
        // The SDK's `createPermissionlessConstantProductPoolWithConfig` (based on the source)
        // includes `wrapSOLInstruction` if tokenBMint is NATIVE_MINT (WSOL).
        // It also has `getOrCreateATAInstruction`.
        // This means we might not need to manually create/fund the WSOL ATA beforehand if `skipBAta` is false.
        // However, having the funds ready in the operator's main SOL account is still necessary.
        // The SDK will create the ATA and wrap SOL using the `payer` (operatorKeypair.publicKey).

        // Let's verify the operator has enough SOL for the WSOL amount + gas
        const requiredSolForWsol = initialSolAmount_BN; // SOL that will be wrapped
        // Gas is harder to estimate precisely, but ensure operator has a buffer

        console.log(`[Meteora Integration] Operator ${operatorKeypair.publicKey.toBase58()} will pay for transactions and provide ${initialSolAmount_BN.toString()} lamports for WSOL.`);

        const expectedPoolPubkey = deriveConstantProductPoolAddressWithConfig( // from your utils import
            tokenAMint_PublicKey,
            tokenBMint_PublicKey, // WSOL
            poolFeeConfig_PublicKey,
            programId // Meteora Program ID from context
        );
        console.log(`[Meteora Integration] Expected pool address (derived): ${expectedPoolPubkey.toBase58()}`);


        console.log("[Meteora Integration] Calling AmmImpl.createPermissionlessConstantProductPoolWithConfig...");
        // We pass operatorKeypair.publicKey as payer. The returned transactions will need to be signed by operatorKeypair.
        // The SDK's function will internally handle ATA creation for tokenA and tokenB (WSOL) for the payer,
        // and also wrap the SOL if tokenBMint is NATIVE_MINT, assuming skipAAta and skipBAta are false (default).
        const returnedTransactions = await AmmImpl.createPermissionlessConstantProductPoolWithConfig(
            connection,
            operatorKeypair.publicKey,  // payer: PublicKey
            tokenAMint_PublicKey,
            tokenBMint_PublicKey,       // WSOL Mint
            tokenA_Amount_BN,           // Amount of Token A (from operator's Token A ATA, which SDK will create/use)
            initialSolAmount_BN,        // Amount of Token B (SOL to be wrapped into WSOL by SDK)
            poolFeeConfig_PublicKey,
            {
                // programId: programId.toBase58(), // opt: programId from context if different from SDK default
                // cluster: 'mainnet-beta', // opt
                // skipAAta: false, // Default: SDK handles Token A ATA creation for payer
                // skipBAta: false  // Default: SDK handles Token B (WSOL) ATA creation and SOL wrap for payer
            }
        );

        // The source code indicates `createPermissionlessConstantProductPoolWithConfig` returns `Promise<Transaction[]>`
        // And `createTransactions` is used internally if multiple logical steps form separate physical transactions.
        // So, `returnedTransactions` should be an array of web3.js Transaction objects.

        console.log(`[Meteora Integration] Received ${returnedTransactions.length} transaction(s) for pool creation.`);
        const txids = [];
        for (let i = 0; i < returnedTransactions.length; i++) {
            const transaction = returnedTransactions[i]; // This is a web3.Transaction
            console.log(`[Meteora Integration] Sending transaction ${i + 1}/${returnedTransactions.length} for pool creation...`);

            // The provider.sendAndConfirm method takes a Transaction and an array of signers.
            // The operatorKeypair is the signer.
            const txHash = await provider.sendAndConfirm(transaction, [operatorKeypair], {
                commitment: 'confirmed',
                skipPreflight: true // Often useful for AMM interactions
            });
            console.log(`[Meteora Integration] Pool creation transaction ${i + 1} successful: ${txHash}`);
            txids.push(txHash);
        }

        console.log(`[Meteora Integration] All pool creation transactions processed.`);
        const actualPoolAddress = expectedPoolPubkey; // The derived address should be the actual one

        console.log(`[Meteora Integration] Loading created pool at ${actualPoolAddress.toBase58()} to get LP Mint...`);
        // AmmImpl.create loads an *instance* of an existing pool
        const poolInstance = await AmmImpl.create(connection, actualPoolAddress, { programId: programId.toBase58() });
        const lpMintPublicKey = poolInstance.lpMint; // Access lpMint from the instance
        console.log(`[Meteora Integration] Pool loaded. LP Mint: ${lpMintPublicKey.toBase58()}`);

        return {
            poolId: actualPoolAddress,
            lpMint: lpMintPublicKey,
            feeConfig: poolFeeConfig_PublicKey,
            txids: txids,
        };

    } catch (error) {
        console.error("[Meteora Integration] Failed to create Meteora Pool:", error.message);
        if (error.stack) console.error("[Meteora Integration] Stack:", error.stack);
        if (error.logs) console.error("[Meteora Integration] Solana Logs:", error.logs);
        // Complex WSOL cleanup might be needed if SDK partial-ran, but often SDKs are atomic or don't leave dangling ATAs
        throw error;
    }
}

async function performWithdrawal(meteoraContext, poolId_PublicKey) {
    const { connection, provider, operatorKeypair } = meteoraContext;
    const slippage = 0.005; // 0.5%

    console.log(`[Meteora Integration] Attempting to withdraw ALL operator liquidity from pool: ${poolId_PublicKey.toBase58()}`);
    try {
        console.log("[Meteora Integration] Loading pool instance...");
        const constantProductPool = await AmmImpl.create(connection, poolId_PublicKey);
        if (!constantProductPool) throw new Error(`Pool not found: ${poolId_PublicKey.toBase58()}`);
        console.log("[Meteora Integration] Pool loaded.");

        const lpMintPublicKey = constantProductPool.lpMint;
        console.log(`[Meteora Integration] LP Mint: ${lpMintPublicKey.toBase58()}`);

        const operatorLpTokenAta = await splToken.getAssociatedTokenAddress(lpMintPublicKey, operatorKeypair.publicKey);
        let lpTokenBalance;
        try {
            const balanceResponse = await connection.getTokenAccountBalance(operatorLpTokenAta);
            lpTokenBalance = new BN(balanceResponse.value.amount);
        } catch (e) {
            console.warn(`[Meteora Integration] No LP tokens found for operator at ${operatorLpTokenAta.toBase58()} or ATA error. Error: ${e.message}`);
            lpTokenBalance = new BN(0);
        }

        if (lpTokenBalance.isZero()) {
            console.log("[Meteora Integration] Operator has 0 LP tokens. Nothing to withdraw.");
            return { success: true, error: "Zero LP tokens to withdraw.", txid: null, lpTokensBurned: "0" };
        }
        console.log(`[Meteora Integration] Operator LP balance: ${lpTokenBalance.toString()}. Withdrawing all.`);
        const lpAmountToWithdraw_BN = lpTokenBalance;

        console.log(`[Meteora Integration] Getting withdrawal quote for ${lpAmountToWithdraw_BN} LP tokens, slippage ${slippage * 100}%...`);
        const { poolTokenAmountIn, tokenAOutAmount, tokenBOutAmount } = constantProductPool.getWithdrawQuote(
            lpAmountToWithdraw_BN, slippage
        );
        console.log(`[Meteora Integration] Quote: Input LP: ${poolTokenAmountIn}, Min Out A: ${tokenAOutAmount}, Min Out B (WSOL): ${tokenBOutAmount}`);

        if (poolTokenAmountIn.isZero() || (tokenAOutAmount.isZero() && tokenBOutAmount.isZero() && !lpAmountToWithdraw_BN.isZero())) {
            console.warn("[Meteora Integration] Quote resulted in zero output for non-zero LP. Pool might be illiquid.");
        }

        console.log("[Meteora Integration] Building withdrawal transaction...");
        const withdrawTx = await constantProductPool.withdraw(
            operatorKeypair.publicKey, poolTokenAmountIn, tokenAOutAmount, tokenBOutAmount
        );
        console.log("[Meteora Integration] Sending withdrawal transaction...");
        const txHash = await provider.sendAndConfirm(withdrawTx, [operatorKeypair], { commitment: 'confirmed', skipPreflight: true });
        console.log(`[Meteora Integration] Withdrawal successful: ${txHash}`);

        return {
            success: true, txid: txHash,
            amountTokenA_MinExpected: tokenAOutAmount.toString(),
            amountTokenB_MinExpected_WSOL: tokenBOutAmount.toString(),
            lpTokensBurned: poolTokenAmountIn.toString()
        };
    } catch (error) {
        console.error("[Meteora Integration] Failed to perform withdrawal:", error.message);
        if (error.stack) console.error("[Meteora Integration] Stack:", error.stack);
        if (error.logs) console.error("[Meteora Integration] Solana Logs:", error.logs);
        return { success: false, error: error.message, txid: null };
    }
}

export {
    initializeMeteora,
    createMeteoraPool,
    performWithdrawal,
};