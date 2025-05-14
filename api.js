const express = require('express');
const fs = require('fs').promises; // Use promises for async file reading
const app = express();
const port = 3000;

// Enable CORS if your frontend is on a different domain/port
const cors = require('cors');
app.use(cors());

// Endpoint to serve the JSON file
app.get('/api/token', async (req, res) => {
    try {
        // Read the JSON file
        const data = await fs.readFile('./game_data/current_game.json', 'utf8');
        // Parse the JSON content
        const tokenData = JSON.parse(data);
        // Send the JSON data as the response
        res.json(tokenData);
    } catch (error) {
        console.error('Error reading tokenData.json:', error);
        res.status(500).json({ error: 'Failed to read token data' });
    }
});

// Start the server
app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});