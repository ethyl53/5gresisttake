'use strict';

const {
    MessageFlags,
    SlashCommandBuilder
} = require('discord.js');

const db = require('../database/db');

const {
    unlinkByDiscordUser
} = require('../database/webAccountService');

const {
    getFirebaseServices
} = require('../firebase/admin');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('web-unlink')
        .setDescription(
            'GoogleアカウントとのWeb連携を解除します'
        ),

    async execute(interaction) {
        await interaction.deferReply({
            flags: MessageFlags.Ephemeral
        });

        try {
            const removed =
                await unlinkByDiscordUser(
                    db,
                    interaction.user.id
                );

            if (!removed) {
                await interaction.editReply({
                    content:
                        '現在、Webコンソールとの連携はありません。'
                });
                return;
            }

            try {
                const {
                    database
                } = getFirebaseServices();

                await database
                    .ref(
                        `userData/${removed.firebase_uid}`
                    )
                    .set({
                        account: {
                            linked: false
                        },
                        updatedAt: Date.now()
                    });
            } catch (firebaseError) {
                console.error(
                    '[Web Unlink Firebase Cleanup Error]',
                    firebaseError
                );
            }

            await interaction.editReply({
                content:
                    'Webコンソールとの連携を解除しました。'
            });
        } catch (error) {
            console.error(
                '[Web Unlink Command Error]',
                error
            );

            await interaction.editReply({
                content:
                    '連携解除に失敗しました。'
            });
        }
    }
};
