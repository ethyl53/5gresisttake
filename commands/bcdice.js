const {
    SlashCommandBuilder,
    PermissionFlagsBits
} = require('discord.js');

const {
    getGuildSystem,
    getChannelSystem,
    setGuildSystem,
    setChannelSystem,
    resetChannelSystem
} = require('../bcdice/manager');

const { getGameSystems } = require('../bcdice/api');

const data = new SlashCommandBuilder()
    .setName('bcdice')
    .setDescription('BCDiceの設定を行います')

    .addSubcommand(sub =>
        sub
            .setName('system')
            .setDescription('現在のBCDiceシステムを確認します')
    )

    .addSubcommand(sub =>
        sub
            .setName('set-server')
            .setDescription('サーバー全体のデフォルトシステムを設定します')
            .addStringOption(option =>
                option
                    .setName('system')
                    .setDescription('BCDiceのシステムID')
                    .setRequired(true)
            )
    )

    .addSubcommand(sub =>
        sub
            .setName('set-channel')
            .setDescription('このチャンネルのシステムを設定します')
            .addStringOption(option =>
                option
                    .setName('system')
                    .setDescription('BCDiceのシステムID')
                    .setRequired(true)
            )
    )

    .addSubcommand(sub =>
        sub
            .setName('reset-channel')
            .setDescription('このチャンネルをサーバー設定に戻します')
    )

    .addSubcommand(sub =>
        sub
            .setName('list')
            .setDescription('利用可能なBCDiceシステムを一覧表示します')
    );

async function execute(interaction) {
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'system') {
        const guildSystem = await getGuildSystem(interaction.guildId);

        const channelSystem =
            await getChannelSystem(
                interaction.guildId,
                interaction.channelId
            );

        await interaction.reply(
            `サーバーのデフォルト: \`${guildSystem}\`\n` +
            `このチャンネル: \`${channelSystem}\``
        );

        return;
    }

    if (
        subcommand === 'set-server' ||
        subcommand === 'set-channel'
    ) {
        if (!interaction.memberPermissions?.has(
            PermissionFlagsBits.ManageGuild
        )) {
            await interaction.reply({
                content: 'この設定を変更する権限がありません。',
                ephemeral: true
            });
            return;
        }

        const systemId =
            interaction.options.getString('system', true);

        try {
            const systems = await getGameSystems();

            const exists =
                systems.some(system =>
                    system.id === systemId
                );

            if (!exists) {
                await interaction.reply({
                    content:
                        `システムID \`${systemId}\` は見つかりませんでした。\n` +
                        '`/bcdice list` で確認してください。',
                    ephemeral: true
                });
                return;
            }
        } catch (error) {
            console.error(
                '[BCDice] system validation error:',
                error
            );

            console.error(
                '[BCDice] interaction state:',
                {
                    id: interaction.id,
                    replied: interaction.replied,
                    deferred: interaction.deferred,
                    subcommand: subcommand
                }
            );

            if (interaction.replied || interaction.deferred) {
                await interaction.editReply({
                    content:
                        `BCDiceシステム確認中にエラーが発生しました。\n` +
                        `\`${error.message}\``
                }).catch(err => {
                    console.error(
                        '[BCDice] failed to edit error reply:',
                        err
                    );
                });
            } else {
                await interaction.reply({
                    content:
                        `BCDiceシステム確認中にエラーが発生しました。\n` +
                        `\`${error.message}\``,
                    ephemeral: true
                }).catch(err => {
                    console.error(
                        '[BCDice] failed to reply error:',
                        err
                    );
                });
            }

            return;
        }

        if (subcommand === 'set-server') {
            await setGuildSystem(
                interaction.guildId,
                systemId
            );

            await interaction.reply(
                `サーバー全体のBCDiceシステムを \`${systemId}\` に設定しました。`
            );
        } else {
            await setChannelSystem(
                interaction.guildId,
                interaction.channelId,
                systemId
            );

            await interaction.reply(
                `このチャンネルのBCDiceシステムを \`${systemId}\` に設定しました。`
            );
        }

        return;
    }

    if (subcommand === 'reset-channel') {
        if (!interaction.memberPermissions?.has(
            PermissionFlagsBits.ManageGuild
        )) {
            await interaction.reply({
                content: 'この設定を変更する権限がありません。',
                ephemeral: true
            });
            return;
        }

        await resetChannelSystem(
            interaction.guildId,
            interaction.channelId
        );

        const guildSystem =
            await getGuildSystem(interaction.guildId);

        await interaction.reply(
            `このチャンネルの個別設定を削除しました。\n` +
            `現在はサーバー設定の \`${guildSystem}\` を使用します。`
        );

        return;
    }

    if (subcommand === 'list') {
        try {
            const systems = await getGameSystems();

            const text = systems
                .map(system =>
                    `\`${system.id}\` : ${system.name}`
                )
                .join('\n');

            const chunks = [];

            for (let i = 0; i < text.length; i += 1900) {
                chunks.push(text.slice(i, i + 1900));
            }

            await interaction.reply({
                content:
                    `利用可能なBCDiceシステム:\n\n${chunks[0] || 'なし'}`,
                ephemeral: true
            });

            for (let i = 1; i < chunks.length; i++) {
                await interaction.followUp({
                    content: chunks[i],
                    ephemeral: true
                });
            }
        } catch (error) {
            console.error('[BCDice] list error:', error);

            await interaction.reply({
                content:
                    'BCDice APIからシステム一覧を取得できませんでした。',
                ephemeral: true
            });
        }
    }
}

module.exports = {
    data,
    execute
};