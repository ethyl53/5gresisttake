require('dotenv').config();

const fs = require('fs');
const path = require('path');
const http = require('http');

const {
    Client,
    Collection,
    GatewayIntentBits,
    EmbedBuilder
} = require('discord.js');

const db = require('./database/db');
const { initMonitor } = require('./utils/monitor');
const { detectDiceCommand } = require('./bcdice/detector');
const { bcdiceRequest } = require('./bcdice/api');
const { getChannelSystem } = require('./bcdice/manager');

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
// BCDice Embed設定
// ==========================================
const BCDICE_EMBED_COLORS = {
    FAILURE: '#DC004E',
    SUCCESS: '#2196F3',
    NORMAL: '#6F6F6F'
};

function getDiceResultType(result, systemId) {
    if (systemId === 'SwordWorld2.5') return 'normal';
    if (result?.fumble === true) return 'fumble';
    if (result?.failure === true) return 'failure';
    if (result?.critical === true) return 'critical';
    if (result?.special === true) return 'special';
    if (result?.success === true) return 'success';
    return 'normal';
}

function getDiceEmbedColor(resultType) {
    switch (resultType) {
        case 'fumble':
        case 'failure':
            return BCDICE_EMBED_COLORS.FAILURE;
        case 'critical':
        case 'special':
        case 'success':
            return BCDICE_EMBED_COLORS.SUCCESS;
        default:
            return BCDICE_EMBED_COLORS.NORMAL;
    }
}

// ==========================================
// コマンド読み込み
// ==========================================
const commandsPath = path.join(__dirname, 'commands');

if (fs.existsSync(commandsPath)) {
    const commandFiles = fs
        .readdirSync(commandsPath)
        .filter(file => file.endsWith('.js'));

    for (const file of commandFiles) {
        const filePath = path.join(commandsPath, file);
        const command = require(filePath);

        if (command && command.data && command.data.name) {
            client.commands.set(command.data.name, command);
        }
    }
}

// ==========================================
// Bot起動
// ==========================================
client.once('ready', () => {
    console.log(`${client.user.tag} 起動`);

    const persistentManager = require('./scheduler/persistentRanking')(client);
    persistentManager.update();

    client.ranking = persistentManager;
    client.persistentRanking = persistentManager;
    client.rankingSystem = persistentManager;

    require('./scheduler/ranking')(client, persistentManager);
    initMonitor(client);
});

// ==========================================
// 自動BCDice
// ==========================================
client.on('messageCreate', async message => {
    if (message.author.bot) return;
    if (!message.guild) return;

    const detected = detectDiceCommand(message.content);
    if (!detected) return;

    try {
        let systemId = detected.systemId;

        if (!systemId) {
            systemId = await getChannelSystem(
                message.guild.id,
                message.channel.id
            );
        }
        
        // systemIdが取得できなかった場合のフォールバック（APIエラー防止）
        if (!systemId) systemId = 'DiceBot'; 

        console.log(
            `[BCDice] ${message.author.tag}: ` +
            `${detected.command} -> ${systemId}` +
            `${detected.secret ? ' [SECRET]' : ''}`
        );

        const result = await bcdiceRequest(systemId, detected.command);

        const resultText = result?.text || result?.result || result?.message;
        if (!resultText) {
            console.error('[BCDice] Unexpected API response:', result);
            return;
        }

        const resultType = getDiceResultType(result, systemId);
        const embedColor = getDiceEmbedColor(resultType);

        const embed = new EmbedBuilder()
            .setColor(embedColor)
            .setDescription(resultText);

        if (detected.secret) {
            const authorName = message.author.displayName || message.author.username;
            await message.reply({
                content: `Secret Dice | ${authorName}`,
                allowedMentions: { repliedUser: false }
            });

            try {
                await message.author.send({ embeds: [embed] });
            } catch (dmError) {
                console.error('[BCDice] failed to send secret result DM:', dmError);
            }
            return;
        }

        await message.reply({
            embeds: [embed],
            allowedMentions: { repliedUser: false }
        });

    } catch (error) {
        console.error('[BCDice] automatic roll error:', error);
    }
});

// ==========================================
// Discord Interaction
// ==========================================
client.on('interactionCreate', async interaction => {
    
    // Autocomplete（自動補完）の処理を追加：これが無いとシステム設定系コマンド等でクラッシュ・無応答になる
    if (interaction.isAutocomplete()) {
        const command = client.commands.get(interaction.commandName);
        if (!command || !command.autocomplete) return;

        try {
            await command.autocomplete(interaction);
        } catch (error) {
            console.error('[Autocomplete Error]', error);
        }
        return;
    }

    console.log(
        '[Interaction]',
        interaction.id,
        interaction.type,
        interaction.isChatInputCommand()
            ? interaction.commandName
            : 'non-command'
    );

    // ======================================
    // ボタン処理
    // ======================================
    if (interaction.isButton()) {
        if (interaction.customId.startsWith('keep_working_')) {
            const userId = interaction.customId.split('_')[2];

            if (interaction.user.id !== userId) {
                return interaction.reply({
                    content: 'これはあなたの確認ボタンではありません。',
                    ephemeral: true
                });
            }

            try {
                const now = new Date();
                const result = await db.query(`
                    UPDATE work_sessions
                    SET
                        last_check = $1,
                        warned_at = NULL
                    WHERE
                        user_id = $2
                        AND end_time IS NULL
                    RETURNING task_name
                `, [now, userId]);

                if (result.rowCount === 0) {
                    return interaction.update({
                        content: '対象の作業セッションが見つからないか、既に終了しています。',
                        components: []
                    });
                }

                await interaction.update({
                    content: '**作業の継続を確認しました。**\n引き続き作業頑張ってください！',
                    components: []
                });

            } catch (err) {
                console.error('[Keep Working Button Error]', err);

                if (interaction.replied || interaction.deferred) {
                    await interaction.followUp({ content: '処理中にエラーが発生しました。', ephemeral: true }).catch(() => null);
                } else {
                    await interaction.reply({ content: '処理中にエラーが発生しました。', ephemeral: true }).catch(() => null);
                }
            }
        }
        return;
    }

    // ======================================
    // スラッシュコマンド処理
    // ======================================
    if (!interaction.isChatInputCommand()) return;

    const command = client.commands.get(interaction.commandName);

    if (!command) {
        return interaction.reply({
            content: 'このコマンドは登録されていないか使用できません。',
            ephemeral: true
        });
    }

    try {
        await command.execute(interaction);
    } catch (error) {
        console.error(error);

        if (interaction.replied || interaction.deferred) {
            await interaction.editReply({
                content: 'コマンドの実行中にエラーが発生しました。'
            }).catch(() => null);
        } else {
            await interaction.reply({
                content: 'エラーが発生しました',
                ephemeral: true
            }).catch(() => null);
        }
    }
});

// ==========================================
// DB初期化 → Discord Login
// ==========================================
(async () => {
    try {
        await db.ready;
        console.log('[DB] initialization complete');

        await client.login(process.env.TOKEN);
    } catch (err) {
        console.error('[DB] failed to initialize:', err);
        process.exit(1);
    }
})();