const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('force-update')
        .setDescription('【管理者用】ランキンググラフを強制的に最新状態へ更新します')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator), // 管理者権限のみ実行可能

    async execute(interaction) {
        // ephemeral: true を指定し、実行した管理者にしか見えない状態で処理を開始（部屋を汚さない）
        await interaction.deferReply({ ephemeral: true });

        try {
            // メインファイルで紐付けた rankingSystem から更新関数を呼び出す
            if (interaction.client.rankingSystem && typeof interaction.client.rankingSystem.update === 'function') {
                // グラフの更新処理を実行
                await interaction.client.rankingSystem.update();
                
                // 💡 成功コメントを残さないため、保留していた応答を「削除」します。
                // これにより部屋のチャットログには一切メッセージを残さず、静かに処理を完了できます。
                await interaction.deleteReply().catch(() => null);
            } else {
                // 万が一設定が漏れていた場合の警告（実行者にしか見えません）
                await interaction.editReply({ 
                    content: '❌ システムエラー: メインファイル側で `client.rankingSystem` の紐付けが確認できません。' 
                }).catch(() => null);
            }

        } catch (err) {
            console.error('[Force Update Command Error]', err);
            // エラーが発生した場合のみ、実行した管理者にだけ通知します（部屋には見えません）
            await interaction.editReply({ 
                content: '❌ ランキンググラフの強制更新中にエラーが発生しました。' 
            }).catch(() => null);
        }
    }
};