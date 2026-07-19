'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const http = require('http');

const {
    Client,
    Collection,
    Events,
    GatewayIntentBits,
    MessageFlags
} = require('discord.js');

const db = require('./database/db');

const {
    initMonitor,
    handleMonitorButton
} = require('./utils/monitor');

const {
    startWebConsoleBridge
} = require('./firebase/webConsoleBridge');

const healthServer = http.createServer(
    (request, response) => {
        response.writeHead(
            200,
            {
                'Content-Type':
                    'text/plain; charset=utf-8'
            }
        );

        response.end('OK');
    }
);

healthServer.on(
    'error',
    (error) => {
        console.error(
            '[Health Server Error]',
            error
        );
    }
);

healthServer.listen(
    Number(process.env.PORT || 8080)
);

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers
    ]
});

client.commands = new Collection();

const commandsPath = path.join(
    __dirname,
    'commands'
);

const commandFiles = fs
    .readdirSync(commandsPath)
    .filter(
        (file) =>
            file.endsWith('.js')
    )
    .sort();

for (const file of commandFiles) {
    const command = require(
        path.join(commandsPath, file)
    );

    if (
        !command?.data?.name ||
        typeof command.execute !==
            'function'
    ) {
        throw new Error(
            `Invalid command file: ${file}`
        );
    }

    if (
        client.commands.has(
            command.data.name
        )
    ) {
        throw new Error(
            `Duplicate command name "${command.data.name}" in ${file}`
        );
    }

    client.commands.set(
        command.data.name,
        command
    );
}

client.once(
    Events.ClientReady,
    async (readyClient) => {
        console.log(
            `${readyClient.user.tag} 起動`
        );

        const persistentManager =
            require(
                './scheduler/persistentRanking'
            )(readyClient);

        readyClient.persistentRanking =
            persistentManager;

        readyClient.rankingSystem =
            persistentManager;

        readyClient.ranking =
            persistentManager;

        await persistentManager
            .update()
            .catch((error) => {
                console.error(
                    '[Initial Ranking Update Error]',
                    error
                );
            });

        require(
            './scheduler/ranking'
        )(
            readyClient,
            persistentManager
        );

        initMonitor(readyClient);

        try {
            readyClient.webConsoleBridge =
                startWebConsoleBridge(
                    readyClient
                );
        } catch (error) {
            console.error(
                '[Web Console Startup Error]',
                error
            );
        }
    }
);

client.on(
    Events.InteractionCreate,
    async (interaction) => {
        try {
            if (interaction.isButton()) {
                const handled =
                    await handleMonitorButton(
                        interaction
                    );

                if (handled) {
                    return;
                }

                if (
                    interaction.customId
                        .startsWith(
                            'keep_working_'
                        )
                ) {
                    await interaction.update({
                        content:
                            'この旧形式の確認ボタンは無効です。現在の作業状態は `/status` で確認してください。',
                        components: []
                    });

                    return;
                }

                return;
            }

            if (
                !interaction
                    .isChatInputCommand()
            ) {
                return;
            }

            const command =
                client.commands.get(
                    interaction.commandName
                );

            if (!command) {
                return;
            }

            await command.execute(
                interaction
            );
        } catch (error) {
            console.error(
                '[Interaction Error]',
                error
            );

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
                            '処理中にエラーが発生しました。',
                        flags:
                            MessageFlags.Ephemeral
                    })
                    .catch(() => null);
            }
        }
    }
);

(async () => {
    try {
        await db.ready;

        console.log(
            '[DB] initialization complete'
        );

        if (!process.env.TOKEN) {
            throw new Error(
                'TOKEN is not configured'
            );
        }

        await client.login(
            process.env.TOKEN
        );
    } catch (error) {
        console.error(
            '[Startup Error]',
            error
        );

        process.exit(1);
    }
})();
