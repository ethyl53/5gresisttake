'use strict';

const {
    MessageFlags,
    SlashCommandBuilder
} = require('discord.js');

const db = require('../database/db');
const {
    createLinkCode,
    getScopeStatus,
    joinLinkCode,
    leaveScope
} = require('../database/recordScopeService');

async function memberLabels(client, members) {
    return Promise.all(members.map(async (member) => {
        const guild = client.guilds.cache.get(member.guild_id);
        if (!guild) return '利用できないサーバー';
        return guild.name;
    }));
}

function requestRankingUpdates(client, members) {
    const manager = client.persistentRanking || client.rankingSystem || client.ranking;
    for (const guildId of new Set(members.map((member) => member.guild_id))) {
        const request = manager?.update?.(guildId);
        request?.catch?.((error) => {
            console.error('[Record Link Ranking Update Error]', { guildId, error });
        });
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('record-link')
        .setDMPermission(false)
        .setDescription('このアカウントのサーバー間記録共有を管理します')
        .addSubcommand((subcommand) => subcommand
            .setName('create')
            .setDescription('別サーバー用の連携コードを発行します'))
        .addSubcommand((subcommand) => subcommand
            .setName('join')
            .setDescription('連携コードでこのサーバーを共有対象にします')
            .addStringOption((option) => option
                .setName('code')
                .setDescription('作成した連携コード')
                .setRequired(true)))
        .addSubcommand((subcommand) => subcommand
            .setName('status')
            .setDescription('現在の記録共有状態を表示します'))
        .addSubcommand((subcommand) => subcommand
            .setName('leave')
            .setDescription('このサーバーを記録共有グループから外します')
            .addBooleanOption((option) => option
                .setName('confirm')
                .setDescription('解除を確定します')
                .setRequired(true))),

    async execute(interaction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        if (!interaction.guildId) {
            await interaction.editReply('このコマンドはサーバー内でのみ利用できます。');
            return;
        }

        const action = interaction.options.getSubcommand(true);
        const input = {
            guildId: interaction.guildId,
            userId: interaction.user.id
        };

        try {
            if (action === 'create') {
                const link = await createLinkCode(db, input);
                await interaction.editReply(
                    `連携コードを発行しました: \`${link.code}\`\n有効期限は10分です。同じDiscordアカウントで、共有したい別サーバーの \`/record-link join code:${link.code}\` を実行してください。`
                );
                return;
            }

            if (action === 'join') {
                const code = interaction.options.getString('code');
                const linked = await joinLinkCode(db, { ...input, code });
                requestRankingUpdates(interaction.client, linked.members);
                const names = await memberLabels(interaction.client, linked.members);
                await interaction.editReply(
                    `記録を共有しました。共有対象: ${names.join('、') || '現在のサーバー'}`
                );
                return;
            }

            if (action === 'leave') {
                if (interaction.options.getBoolean('confirm') !== true) {
                    await interaction.editReply(
                        '解除すると、このサーバー以後の表示・操作は独立します。実行するには `confirm:true` を指定してください。'
                    );
                    return;
                }
                const result = await leaveScope(db, input);
                requestRankingUpdates(interaction.client, [
                    { guild_id: interaction.guildId },
                    ...(result.remainingMembers || [])
                ]);
                await interaction.editReply(
                    result.kind === 'already_independent'
                        ? 'このサーバーはすでに独立した記録グループです。'
                        : 'このサーバーを記録共有グループから解除しました。既存の履歴は削除されません。'
                );
                return;
            }

            const status = await getScopeStatus(db, input);
            const names = await memberLabels(interaction.client, status.members);
            await interaction.editReply(
                names.length <= 1
                    ? 'このサーバーの記録は独立しています。'
                    : `共有中のサーバー: ${names.join('、')}`
            );
        } catch (error) {
            console.error('[Record Link Command Error]', error);
            const known = [
                'INVALID_LINK_CODE',
                'USED_LINK_CODE',
                'EXPIRED_LINK_CODE',
                'LINK_CODE_OWNER_MISMATCH',
                'ALREADY_LINKED',
                'SCOPE_CONFLICT'
            ];
            await interaction.editReply(
                known.includes(error.code)
                    ? error.message
                    : '記録共有の処理に失敗しました。'
            );
        }
    }
};
