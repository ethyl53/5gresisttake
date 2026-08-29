const DEFAULT_API_URL =
    process.env.BCDICE_API_URL ||
    'https://bcdice.kazagakure.net';

async function bcdiceRequest(systemId, command) {

    const baseUrl =
        DEFAULT_API_URL.replace(/\/+$/, '');

    const url =
        `${baseUrl}/v2/game_system/` +
        `${encodeURIComponent(systemId)}/roll?` +
        `command=${encodeURIComponent(command)}`;

    const response = await fetch(url);

    if (!response.ok) {
        throw new Error(
            `BCDice API error: ${response.status} ${response.statusText}`
        );
    }

    /*
     * BCDice API のロール結果には、
     * text / secret / success / failure /
     * critical / fumble などが含まれる。
     *
     * 今後のEmbed表示では、この状態値を直接使用する。
     * 表示テキストの解析は行わない。
     */
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

    return data.game_system;
}

module.exports = {
    bcdiceRequest,
    getGameSystems
};