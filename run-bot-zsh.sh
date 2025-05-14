#!/bin/zsh

# Set all environment variables
export PRODUCTION=0
export PINATA_API_KEY=ad6aaf44677481c174ec
export PINATA_API_SECRET_KEY=5ad9be3596a9db94fa7dade0897b2bfafaf6ddc4969c96c696a6c84a237cc3af
export PINATA_DOMAIN=brown-charming-stingray-742.mypinata.cloud
export KEYPAIR=./devnet-keypair.json
export JITO_AUTH_KEYPAIR=2vn9jG4Vac5z6hTtMHRGWm2CXzVMGzQAzo3B34HNr1j3oL51TyHsMVKTqjij7LQtJW98UM3hH5TRNwDujLUSCAgi
export JITO_BLOCK_ENGINE_URL=https://jito-mainnet.core.chainstack.com
export RPC_URL=https://api.devnet.solana.com
export NODE_PATH=./dist

# Add Node 18 to PATH temporarily
export PATH="$(brew --prefix node@18)/bin:$PATH"

# Run the command
node ./dist/index.js createtoken --name "TestToken" --symbol "TEST" --decimals 5 --initial-minting 1000000 --url devnet
