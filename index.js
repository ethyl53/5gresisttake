
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

const {
    getCocCharacterRarityPercent,
    getCocCharacterOverallScore
} = require('./bcdice/cocRarity');

const db = require('./database/db');
const { initMonitor } = require('./utils/monitor');
const { detectDiceCommand } = require('./bcdice/detector');

const {
    rollTable,
    COC_CHARACTER_TABLE_NAME,
    BUILT_IN_TABLES,
    parseCocCharacterStatsCommand,
    rollCocCharacterStats
} = require('./bcdice/tableRoller');

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
// CSコマンドのパース
// 対応形式：
//   CS 9 9 16 15 17 16 17 17
//   CS 9,9,16,15,17,16,17,17
//   CS 桐崎玲 9,9,16,15,17,16,17,17
//   CS 9,9,16,15,17,16,17,17 桐崎 玲
// ==========================================
const CS_SEPARATOR = '(?:\\s*[,，、]\\s*|\\s+)';
const CS_NUMBERS_PATTERN = new RegExp(
    `\\d+(?:${CS_SEPARATOR}\\d+){7}`
);

// 名前側に「単独の数字」が残っている場合（数値が9個以上など）を検出
function hasStandaloneNumber(text) {
    return /(?:^|[\s,，、])\d+(?:$|[\s,，、])/.test(text);
}

function parseCsCommand(content) {
    // 全角数字・全角スペースを半角に統一
    const normalized = content
        .replace(/[０-９]/g, c =>
            String.fromCharCode(c.charCodeAt(0) - 0xFEE0)
        )
        .replace(/\u3000/g, ' ');

    const rest = normalized.replace(/^CS/i, '').trim();

    const match = CS_NUMBERS_PATTERN.exec(rest);
    if (!match) return null;

    const before = rest.slice(0, match.index);
    const after = rest.slice(match.index + match[0].length);

    // 数値が9個以上入力されている場合などは不正扱い
    if (hasStandaloneNumber(before) || hasStandaloneNumber(after)) {
        return null;
    }

    const values = match[0]
        .split(/[\s,，、]+/)
        .map(Number);

    const name = [before, after]
        .map(text => text.trim())
        .filter(Boolean)
        .join(' ')
        .replace(/\s+/g, ' ');

    return {
        name: name || null,
        values
    };
}

function parseTableMessageCommand(content) {
    let text = content.trim();
    let secret = false;
    let count = 1;
    let countSpecified = false;
    let changed = true;

    while (changed) {
        changed = false;

        // 先頭の x10 / rep10
        const prefixCount = text.match(
            /^(?:x|rep)\s*(\d+)\s+/i
        );

        if (prefixCount) {
            if (countSpecified) {
                return {
                    content: text,
                    secret,
                    count: NaN
                };
            }

            count = Number(prefixCount[1]);
            countSpecified = true;
            text = text.slice(prefixCount[0].length).trim();
            changed = true;
            continue;
        }

        // 末尾の x10 / rep10
        const suffixCount = text.match(
            /\s+(?:x|rep)\s*(\d+)$/i
        );

        if (suffixCount) {
            if (countSpecified) {
                return {
                    content: text,
                    secret,
                    count: NaN
                };
            }

            count = Number(suffixCount[1]);
            countSpecified = true;
            text = text.slice(0, suffixCount.index).trim();
            changed = true;
            continue;
        }

    // 先頭のシークレット指定
    // s + 表名（登録済みの表、またはCSTの別名）
    const cstAliases = [
        'CST',
        'CoCキャラシ制作',
        'CoCキャラシ制作（CST）'
    ];

    const hasAttachedSecretPrefix =
        cstAliases.some(alias =>
            text.toLocaleLowerCase() ===
            (`s${alias}`).toLocaleLowerCase()
        ) ||
        Object.keys(BUILT_IN_TABLES).some(name =>
            text.toLocaleLowerCase() ===
            (`s${name}`).toLocaleLowerCase()
        );

    if (/^s\s+/i.test(text) || hasAttachedSecretPrefix) {
        secret = true;
        text = text.replace(/^s\s*/i, '');
        changed = true;
        continue;
    }

        // 末尾の単独シークレット指定 s
        if (/\s+s$/i.test(text)) {
            secret = true;
            text = text.replace(/\s+s$/i, '').trim();
            changed = true;
        }
    }

    return {
        content: text,
        secret,
        count
    };
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
// メッセージ受信・自動ダイス処理
// ==========================================
client.on('messageCreate', async message => {
    if (message.author.bot) return;
    if (!message.guild) return;


    // ==========================================
    // CoCキャラクター能力値の評価（CS）
    // 形式：CS 9 9 16 15 17 16 17 17
    // ==========================================

       if (/^CS(?:\s|$)/i.test(message.content)) {
        const parsed = parseCsCommand(message.content);

        if (!parsed) {
            await message.reply({
                content:
                    '入力形式が正しくありません。\n' +
                    '形式：`CS STR CON POW DEX APP SIZ INT EDU`\n' +
                    '例：`CS 10 17 13 10 17 9 14 15`\n' +
                    '例：`CS 16,10,12,14,14,14,16,17`\n' +
                    '例：`CS 桐崎 玲 9,9,16,15,17,16,17,17`',
                allowedMentions: { repliedUser: false }
            });
            return;
        }

        const values = parsed.values;
        const characterName = parsed.name;

        const statDefinitions = [
            { name: 'STR', formula: '3d6', min: 3, max: 18 },
            { name: 'CON', formula: '3d6', min: 3, max: 18 },
            { name: 'POW', formula: '3d6', min: 3, max: 18 },
            { name: 'DEX', formula: '3d6', min: 3, max: 18 },
            { name: 'APP', formula: '3d6', min: 3, max: 18 },
            { name: 'SIZ', formula: '2d6+6', min: 8, max: 18 },
            { name: 'INT', formula: '2d6+6', min: 8, max: 18 },
            { name: 'EDU', formula: '3d6+3', min: 6, max: 21 }
        ];

        const invalidIndex = values.findIndex((value, index) =>
            value < statDefinitions[index].min ||
            value > statDefinitions[index].max
        );

        if (invalidIndex !== -1) {
            const definition = statDefinitions[invalidIndex];

            await message.reply({
                content:
                    `${definition.name}の値が範囲外です。` +
                    `有効範囲は${definition.min}～${definition.max}です。`,
                allowedMentions: { repliedUser: false }
            });
            return;
        }

        const stats = values.map((value, index) => ({
            ...statDefinitions[index],
            value
        }));

        try {
            const rarityPercent =
                getCocCharacterRarityPercent(stats);

            const overallScore =
                getCocCharacterOverallScore(stats);

            const description = [
                ...(characterName ? [`**${characterName}**`] : []),
                ...stats.map(stat =>
                    `${stat.name}(${stat.formula}) : ${stat.value}`
                ),
                `珍しさ：上位${rarityPercent}%　総合偏差値：${overallScore}`
            ].join('\n');

            const embed = new EmbedBuilder()
                .setColor('#47B2BE')
                .setTitle('◇ CoC能力値評価')
                .setDescription(description);

            await message.reply({
                embeds: [embed],
                allowedMentions: { repliedUser: false }
            });
        } catch (error) {
            console.error('[CS Evaluation Error]', error);

            await message.reply({
                content: '能力値の評価中にエラーが発生しました。',
                allowedMentions: { repliedUser: false }
            }).catch(() => null);
        }

        return;
    }

// ==========================================
// CoCキャラシ制作（CST）
// ==========================================

const tableCommand = parseTableMessageCommand(message.content);
const cstCommand = parseCocCharacterStatsCommand(
    tableCommand.content
);

if (cstCommand) {
    const count = tableCommand.count;
    const secret = tableCommand.secret;

    if (
        !Number.isSafeInteger(count) ||
        count < 1 ||
        count > 10
    ) {
        await message.reply({
            content: '実行回数は1～10回で指定してください。',
            allowedMentions: { repliedUser: false }
        });
        return;
    }

    if (cstCommand.error) {
        await message.reply({
            content: cstCommand.error,
            allowedMentions: { repliedUser: false }
        });
        return;
    }

    try {
        for (let i = 0; i < count; i++) {
            const result = rollCocCharacterStats();

            const embed = new EmbedBuilder()
                .setColor('#47B2BE')
                .setTitle(`◇ ${COC_CHARACTER_TABLE_NAME}`)
                .setDescription(result.description)
                .setFooter({
                    text: `生成 ${i + 1}/${count}`
                });

            if (secret) {
                await message.author.send({
                    embeds: [embed]
                });
            } else {
                await message.channel.send({
                    embeds: [embed]
                });
            }
        }
    } catch (error) {
        console.error('[CST Error]', error);

        await message.reply({
            content: secret
                ? 'DMを送信できませんでした。DMの受信設定を確認してください。'
                : 'CoCキャラシ制作の実行中にエラーが発生しました。',
            allowedMentions: { repliedUser: false }
        }).catch(() => null);
    }

    return;
}

    // ==========================================
    // ロールテーブルの貼り付け実行
    // ==========================================
    try {
        const tableCommand = parseTableMessageCommand(
            message.content
        );

        const count = tableCommand.count;
        const secret = tableCommand.secret;

        // 表コマンドとして扱うのは、何らかの指定がある場合も含む
        const hasModifier =
            secret ||
            count !== 1 ||
            tableCommand.content !== message.content.trim();

        if (
            hasModifier &&
            (!Number.isSafeInteger(count) || count < 1 || count > 10)
        ) {
            await message.reply({
                content: '実行回数は1～10回で指定してください。',
                allowedMentions: { repliedUser: false }
            });
            return;
        }

        for (let i = 0; i < count; i++) {
            const tableResult = rollTable(tableCommand.content);

            if (!tableResult) {
                if (i === 0) {
                    // 通常のダイスコマンド等の処理に進める
                    break;
                }

                await message.reply({
                    content: '表の抽選中にエラーが発生しました。',
                    allowedMentions: { repliedUser: false }
                });
                return;
            }

            const resultText = tableResult.result === null
                ? 'この出目に対応する結果がありません。'
                : tableResult.result;

            const embed = new EmbedBuilder()
                .setColor('#955BBC')
                .setDescription(
                    `**${tableResult.title}**\n` +
                    `出目：${tableResult.roll}（1d${tableResult.max}）\n` +
                    `${resultText}`
                )
                .setFooter({
                    text: `実行 ${i + 1}/${count}`
                });

            if (secret) {
                await message.author.send({
                    embeds: [embed]
                });
            } else {
                await message.reply({
                    embeds: [embed],
                    allowedMentions: { repliedUser: false }
                });
            }
        }

        // 表コマンドの指定がある場合は、後続のBCDice処理に流さない
        if (hasModifier) return;

    } catch (error) {
        console.error('[Roll Table Error]', error);

        await message.reply({
            content: '表の抽選または結果の送信中にエラーが発生しました。',
            allowedMentions: { repliedUser: false }
        }).catch(() => null);

        return;
    }

    // ==========================================
    // 既存の自動BCDice処理
    // ==========================================
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

        // systemIdが取得できなかった場合のフォールバック
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
            const authorName =
                message.author.displayName || message.author.username;

            await message.reply({
                content: `Secret Dice | ${authorName}`,
                allowedMentions: { repliedUser: false }
            });

            try {
                await message.author.send({ embeds: [embed] });
            } catch (dmError) {
                console.error(
                    '[BCDice] failed to send secret result DM:',
                    dmError
                );
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

    // Autocomplete（自動補完）
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
                    await interaction.followUp({
                        content: '処理中にエラーが発生しました。',
                        ephemeral: true
                    }).catch(() => null);
                } else {
                    await interaction.reply({
                        content: '処理中にエラーが発生しました。',
                        ephemeral: true
                    }).catch(() => null);
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