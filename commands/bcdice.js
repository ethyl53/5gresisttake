const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const {
    getGuildSystem, getChannelSystem, setGuildSystem,
    setChannelSystem, resetChannelSystem
} = require('../bcdice/manager');
const { getGameSystems } = require('../bcdice/api');

const data = new SlashCommandBuilder()
    .setName('bcdice')
    .setDescription('BCDiceの設定・確認を行います')
    .addStringOption(option =>
        option.setName('action')
            .setDescription('実行する操作を選択してください')
            .setRequired(true)
            .addChoices(
                { name: '現在の設定を確認', value: 'system' },
                { name: 'サーバー全体の設定', value: 'set-server' },
                { name: 'このチャンネルの設定', value: 'set-channel' },
                { name: 'このチャンネルの設定をリセット', value: 'reset-channel' },
                { name: 'システム一覧を表示', value: 'list' }
            )
    )
    .addStringOption(option =>
        option.setName('system')
            .setDescription('設定するBCDiceのシステムID（サーバー/チャンネル設定時のみ必要）')
            .setRequired(false)
    );

async function execute(interaction) {
    const action = interaction.options.getString('action', true);
    const systemId = interaction.options.getString('system');

    // 1. 現在の設定確認
    if (action === 'system') {
        const guildSystem = await getGuildSystem(interaction.guildId);
        const channelSystem = await getChannelSystem(interaction.guildId, interaction.channelId);
        await interaction.reply(`サーバーのデフォルト: \`${guildSystem}\`\nこのチャンネル: \`${channelSystem}\``);
        return;
    }

    // 2. サーバー/チャンネルの設定
    if (action === 'set-server' || action === 'set-channel') {
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
            await interaction.reply({ content: 'この設定を変更する権限がありません。', ephemeral: true });
            return;
        }

        if (!systemId) {
            await interaction.reply({
                content: 'システムIDが指定されていません。`system` 引数に設定したいシステムID（例: `Cthulhu7th`）を入力してください。',
                ephemeral: true
            });
            return;
        }

        await interaction.deferReply();

        try {
            const systems = await getGameSystems();
            const exists = systems.some(system => system.id === systemId);

            if (!exists) {
                await interaction.editReply({
                    content: `システムID \`${systemId}\` は見つかりませんでした。\n\`action: システム一覧を表示\` でIDを確認してください。`
                });
                return;
            }

            if (action === 'set-server') {
                await setGuildSystem(interaction.guildId, systemId);
                await interaction.editReply(`サーバー全体のBCDiceシステムを \`${systemId}\` に設定しました。`);
            } else {
                await setChannelSystem(interaction.guildId, interaction.channelId, systemId);
                await interaction.editReply(`このチャンネルのBCDiceシステムを \`${systemId}\` に設定しました。`);
            }
        } catch (error) {
            console.error('[BCDice] system validation error:', error);
            await interaction.editReply({
                content: `BCDiceシステム確認中にエラーが発生しました。\n\`${error.message}\``
            });
        }
        return;
    }

    // 3. チャンネル設定のリセット
    if (action === 'reset-channel') {
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
            await interaction.reply({ content: 'この設定を変更する権限がありません。', ephemeral: true });
            return;
        }
        await resetChannelSystem(interaction.guildId, interaction.channelId);
        const guildSystem = await getGuildSystem(interaction.guildId);
        await interaction.reply(`このチャンネルの個別設定を削除しました。\n現在はサーバー設定の \`${guildSystem}\` を使用します。`);
        return;
    }

    // 4. システム一覧表示
    if (action === 'list') {
        await interaction.deferReply({ ephemeral: true });

        try {
            const systems = await getGameSystems();
            const text = systems.map(system => `\`${system.id}\` : ${system.name}`).join('\n');
            const chunks = [];

            for (let i = 0; i < text.length; i += 1900) {
                chunks.push(text.slice(i, i + 1900));
            }

            await interaction.editReply({
                content: `利用可能なBCDiceシステム:\n\n${chunks[0] || 'なし'}`
            });

            for (let i = 1; i < chunks.length; i++) {
                await interaction.followUp({ content: chunks[i], ephemeral: true });
            }
        } catch (error) {
            console.error('[BCDice] list error:', error);
            await interaction.editReply({ content: 'BCDice APIからシステム一覧を取得できませんでした。' });
        }
    }
}

module.exports = { data, execute };