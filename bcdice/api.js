const DEFAULT_API_URL =
    process.env.BCDICE_API_URL ||
    'https://bcdice.kazagakure.net';

async function bcdiceRequest(systemId, command) {
    const baseUrl = DEFAULT_API_URL.replace(/\/+$/, '');
    const url = `${baseUrl}/v2/game_system/${encodeURIComponent(systemId)}/roll?command=${encodeURIComponent(command)}`;

    try {
        const response = await fetch(url);
        if (!response.ok) {
            // コマンド構文エラー（日常会話など）の場合は400エラーが返るため、例外を出さずに無視する
            if (response.status === 400) return null;
            throw new Error(`BCDice API error: ${response.status} ${response.statusText}`);
        }
        // text, secret, success, failure, critical, fumble の状態値を直接使用する
        return await response.json();
    } catch (error) {
        console.error(`[BCDice API Error]`, error);
        return null;
    }
}

async function getGameSystems() {
    const baseUrl = DEFAULT_API_URL.replace(/\/+$/, '');
    const response = await fetch(`${baseUrl}/v2/game_system`);

    if (!response.ok) {
        throw new Error(`BCDice API error: ${response.status} ${response.statusText}`);
    }
    const data = await response.json();
    return data.game_system;
}

module.exports = {
    bcdiceRequest,
    getGameSystems
};