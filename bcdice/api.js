const DEFAULT_API_URL =
    process.env.BCDICE_API_URL ||
    'https://bcdice.kazagakure.net';

async function bcdiceRequest(systemId, command) {

    const baseUrl =
        DEFAULT_API_URL.replace(/\/+$/, '');

    const url =
        `${baseUrl}/v2/game_system/${encodeURIComponent(systemId)}/roll`;

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            command
        })
    });

    if (!response.ok) {
        throw new Error(
            `BCDice API error: ${response.status} ${response.statusText}`
        );
    }

    return await response.json();
}

async function getGameSystems() {
    const baseUrl =
        DEFAULT_API_URL.replace(/\/+$/, '');

    const response = await fetch(
        `${baseUrl}/v2/game_system`
    );

    if (!response.ok) {
        throw new Error(
            `BCDice API error: ${response.status} ${response.statusText}`
        );
    }

    const data = await response.json();

    return data.game_systems;
}

module.exports = {
    bcdiceRequest,
    getGameSystems
};