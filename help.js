// discoverMeteoraConfigs.js
import { Connection, PublicKey } from '@solana/web3.js';
import AmmImpl, { PROGRAM_ID } from '@meteora-ag/dynamic-amm-sdk'; // Assuming ES Module setup
import dotenv from 'dotenv';
dotenv.config();

async function main() {
    const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com'; // Use your RPC
    const connection = new Connection(rpcUrl, 'confirmed');
    const meteoraProgramId = new PublicKey(PROGRAM_ID);

    console.log(`Connecting to RPC: ${rpcUrl}`);
    console.log(`Querying Meteora Program ID: ${meteoraProgramId.toBase58()} for fee configurations...`);

    try {
        // The getFeeConfigurations function takes the connection and an options object.
        // The options object can specify the programId if it's different from the default
        // or other filters if the SDK supports them.
        const feeConfigurations = await AmmImpl.getFeeConfigurations(connection, {
            programId: meteoraProgramId // Explicitly pass programId
        });

        if (feeConfigurations && feeConfigurations.length > 0) {
            console.log(`Found ${feeConfigurations.length} fee configurations:`);
            feeConfigurations.forEach(config => {
                console.log("--------------------------------------------------");
                console.log(`Config Name: ${config.name || 'N/A'}`); // Some configs might have a name
                console.log(`Config Public Key: ${config.publicKey.toBase58()}`);
                console.log(`Base Fee Rate (BPS): ${config.baseFeeRateBps.toString()}`); // Basis points (e.g., 5 for 0.05%)
                // Log other relevant details from the config object
                // console.log(JSON.stringify(config, (key, value) =>
                //     typeof value === 'bigint' ? value.toString() :
                //     value instanceof PublicKey ? value.toBase58() :
                //     value instanceof BN ? value.toString() : value, 2));
                // The above JSON.stringify can be verbose but shows all details.
                // Simpler:
                if (config.pythConfiguration) {
                    console.log(`  Pyth Config: Oracle: ${config.pythConfiguration.oraclePrice?.toBase58()}, Exponent: ${config.pythConfiguration.oracleExponent}`);
                }
                if (config.curveConfiguration) {
                    console.log(`  Curve Type: ${config.curveConfiguration.curveType}`);
                }

            });
            console.log("--------------------------------------------------");
            console.log("\nChoose a 'Config Public Key' and set it as METEORA_POOL_CONFIG_KEY in your .env file.");
        } else {
            console.log("No fee configurations found for the specified program ID.");
        }
    } catch (error) {
        console.error("Error fetching fee configurations:", error.message);
        if (error.stack) console.error(error.stack);
    }
}

main().catch(err => console.error("Script failed:", err));