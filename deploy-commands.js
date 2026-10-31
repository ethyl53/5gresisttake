const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, REST, Routes, Events } = require('discord.js');
require('dotenv').config();

// ==========================================
// コマンド登録設定
// ==========================================

const DICE_ONLY_GUILD_ID = '1121788298864640032';
const DICE_COMMANDS = ['bcdice', 'roll', 'table'];
const BLACKLISTED_COMMANDS = [
    'admin-stop',
    'force-update',
    'schedule',
    'status',
    'today',
    'website'
];

// ==========================================
// 環境変数の確認
// ==========================================

if (!process.env.TOKEN || !process.env.CLIENT_ID) {
    console.error('[Deploy Error] TOKEN または CLIENT_ID が設定されていません。');
    process.exit(1);
}

// ==========================================
// コマンドファイルの読み込み
// ==========================================

const commandsDir = path.join(__dirname, 'commands');
const commands = [];
const commandFiles = fs.readdirSync(commandsDir)
    .filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
    const filePath = path.join(commandsDir, file);
    const command = require(filePath);

    if (
        command &&
        command.data &&
        command.data.name &&
        !BLACKLISTED_COMMANDS.includes(command.data.name)
    ) {
        commands.push(command.data.toJSON());
        console.log('[Deploy] 読み込み: ' + command.data.name);
    } else {
        console.log('[Deploy] 登録スキップ: ' + file);
    }
}

const diceCommands = commands.filter(command =>
    DICE_COMMANDS.includes(command.name)
);

const otherCommands = commands.filter(command =>
    !DICE_COMMANDS.includes(command.name)
);

const loadedDiceNames = new Set(diceCommands.map(command => command.name));

for (const name of DICE_COMMANDS) {
    if (!loadedDiceNames.has(name)) {
        console.error('[Deploy Error] ダイスコマンド「' + name + '」が見つかりません。');
        process.exit(1);
    }
}

// ==========================================
// Discordへの登録
// ==========================================

const client = new Client({
    intents: [GatewayIntentBits.Guilds]
});

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

client.once(Events.ClientReady, async readyClient => {
    try {
        console.log('');
        console.log('==========================================');
        console.log('コマンド登録を開始します');
        console.log('==========================================');

        // 1. 全サーバー共通のコマンドをダイス関連のみにする
        await rest.put(
            Routes.applicationCommands(process.env.CLIENT_ID),
            { body: diceCommands }
        );

        console.log(
            '[Deploy] グローバルコマンド登録完了: ' + diceCommands.map(c => c.name).join(', ')
        );

        for (const [guildId, guild] of readyClient.guilds.cache) {
            try {
                if (guildId === DICE_ONLY_GUILD_ID) {
                    await rest.put(
                        Routes.applicationGuildCommands(
                            process.env.CLIENT_ID,
                            guildId
                        ),
                        { body: [] }
                    );

                    console.log(
                        '[Deploy] ' + guild.name + ': ダイス専用（/roll、/bcdice のみ）'
                    );
                } else {
                    await rest.put(
                        Routes.applicationGuildCommands(
                            process.env.CLIENT_ID,
                            guildId
                        ),
                        { body: otherCommands }
                    );

                    console.log(
                        '[Deploy] ' + guild.name + ': その他のコマンド ' + otherCommands.length + '件を登録'
                    );
                }
            } catch (error) {
                console.error(
                    '[Deploy Error] サーバー「' + guild.name + '」の登録に失敗しました:',
                    error
                );
            }
        }

        console.log('');
        console.log('[Deploy] コマンド登録処理が完了しました。');
        console.log('ダイスコマンド: ' + diceCommands.length + '件');
        console.log('その他のコマンド: ' + otherCommands.length + '件');
    } catch (error) {
        console.error('[Deploy Error] コマンド登録に失敗しました:', error);
    } finally {
        client.destroy();
    }
});

client.login(process.env.TOKEN).catch(error => {
    console.error('[Deploy Error] Discordへのログインに失敗しました:', error);
    process.exitCode = 1;
});