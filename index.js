require('dotenv').config();

const fs = require('fs');
const path = require('path');

const {
    Client,
    Collection,
    GatewayIntentBits
} = require('discord.js');

const db = require('./database/db');
const http = require('http');

const { initMonitor } =
    require('./utils/monitor');

const {
    detectDiceCommand
} = require('./bcdice/detector');

const {
    bcdiceRequest
} = require('./bcdice/api');

const {
    getChannelSystem
} = require('./bcdice/manager');


// ==========================================
// ヘルスチェック用HTTPサーバー
// ==========================================

http.createServer((req, res) => {
    res.writeHead(200);
    res.end('OK');
}).listen(process.env.PORT || 8080);


// ==========================================
// Discord Client
// ==========================================

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

client.commands = new Collection();


// ==========================================
// コマンド読み込み
// ==========================================

const commandsPath =
    path.join(__dirname, 'commands');

const commandFiles =
    fs.readdirSync(commandsPath)
        .filter(file => file.endsWith('.js'));

for (const file of commandFiles) {

    const command =
        require(`./commands/${file}`);

    client.commands.set(
        command.data.name,
        command
    );
}


// ==========================================
// Bot起動
// ==========================================

client.once('ready', () => {

    console.log(`${client.user.tag} 起動`);

    const persistentManager =
        require('./scheduler/persistentRanking')(client);

    persistentManager.update();

    client.ranking =
        persistentManager;

    client.persistentRanking =
        persistentManager;

    client.rankingSystem =
        persistentManager;

    require('./scheduler/ranking')(
        client,
        persistentManager
    );

    initMonitor(client);
});


// ==========================================
// 自動BCDice
// ==========================================

client.on('messageCreate', async message => {

    // Bot自身・他Botのメッセージには反応しない
    if (message.author.bot) {
        return;
    }

    // DMでは使用しない
    if (!message.guild) {
        return;
    }

    const detected =
        detectDiceCommand(message.content);

    if (!detected) {
        return;
    }

    try {

        // システム固有コマンドの場合
        // detector側でシステムを決定済み
        let systemId =
            detected.systemId;

        // 一般コマンドの場合は
        // チャンネル設定を使用
        if (!systemId) {

            systemId =
                await getChannelSystem(
                    message.guild.id,
                    message.channel.id
                );
        }

        console.log(
            `[BCDice] ${message.author.tag}: ` +
            `${detected.command} -> ${systemId}`
        );

        const result =
            await bcdiceRequest(
                systemId,
                detected.command
            );

        // BCDice APIの基本的な結果
        const resultText =
            result?.text ||
            result?.result ||
            result?.message;

        if (!resultText) {

            console.error(
                '[BCDice] Unexpected API response:',
                result
            );

            return;
        }

        await message.reply({
            content: resultText,
            allowedMentions: {
                repliedUser: false
            }
        });

    } catch (error) {

        console.error(
            '[BCDice] automatic roll error:',
            error
        );

        // APIエラー時は何も返さない。
        // 通常会話を邪魔しないため。
    }
});

client.on('interactionCreate', async interaction => {

    console.log(
        '[Interaction]',
        interaction.id,
        interaction.type,
        interaction.isChatInputCommand()
            ? interaction.commandName
            : 'non-command'
    );
});


// ==========================================
// Discord Interaction
// ==========================================

client.on('interactionCreate', async interaction => {

    // ======================================
    // ボタン
    // ======================================

    if (interaction.isButton()) {

        if (
            interaction.customId
                .startsWith('keep_working_')
        ) {

            const userId =
                interaction.customId
                    .split('_')[2];

            if (interaction.user.id !== userId) {

                return interaction.reply({
                    content:
                        'これはあなたの確認ボタンではありません。',
                    ephemeral: true
                });
            }

            try {

                const now = Date.now();

                const result =
                    await db.query(`
                        UPDATE work_sessions
                        SET
                            last_check = $1,
                            warned_at = NULL
                        WHERE
                            user_id = $2
                            AND end_time IS NULL
                        RETURNING task_name
                    `, [
                        now,
                        userId
                    ]);

                if (result.rowCount === 0) {

                    return interaction.update({
                        content:
                            '対象の作業セッションが見つからないか、既に終了しています。',
                        components: []
                    });
                }

                await interaction.update({
                    content:
                        '**作業の継続を確認しました。**\n' +
                        '引き続き作業頑張ってください！',
                    components: []
                });

            } catch (err) {

                console.error(
                    '[Keep Working Button Error]',
                    err
                );

                await interaction.reply({
                    content:
                        '処理中にエラーが発生しました。',
                    ephemeral: true
                });
            }
        }

        return;
    }


    // ======================================
    // スラッシュコマンド
    // ======================================

    if (!interaction.isChatInputCommand()) {
        return;
    }

    const command =
        client.commands.get(
            interaction.commandName
        );

    if (!command) {
        return;
    }

    try {

        await command.execute(interaction);

    } catch (error) {

        console.error(error);

        if (
            interaction.replied ||
            interaction.deferred
        ) {

            await interaction
                .editReply({
                    content:
                        'コマンドの実行中にエラーが発生しました。'
                })
                .catch(() => null);

        } else {

            await interaction
                .reply({
                    content:
                        'エラーが発生しました',
                    ephemeral: true
                })
                .catch(() => null);
        }
    }
});


// ==========================================
// DB初期化 → Discord Login
// ==========================================

(async () => {

    try {

        await db.ready;

        console.log(
            '[DB] initialization complete'
        );

        await client.login(
            process.env.TOKEN
        );

    } catch (err) {

        console.error(
            '[DB] failed to initialize:',
            err
        );

        process.exit(1);
    }

})();