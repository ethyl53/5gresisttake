'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');

const {
    REST,
    Routes
} = require('discord.js');

if (!process.env.TOKEN) {
    throw new Error(
        'TOKEN is not configured'
    );
}

if (!process.env.CLIENT_ID) {
    throw new Error(
        'CLIENT_ID is not configured'
    );
}

const commandsPath =
    path.join(
        __dirname,
        'commands'
    );

const commandFiles =
    fs.readdirSync(commandsPath)
        .filter(
            (file) =>
                file.endsWith('.js')
        )
        .sort();

const commands = [];
const names = new Set();

for (const file of commandFiles) {
    const command = require(
        path.join(commandsPath, file)
    );

    if (!command?.data?.name) {
        throw new Error(
            `Invalid command file: ${file}`
        );
    }

    if (names.has(command.data.name)) {
        throw new Error(
            `Duplicate command name: ${command.data.name}`
        );
    }

    names.add(command.data.name);
    commands.push(
        command.data.toJSON()
    );
}

const rest = new REST({
    version: '10'
}).setToken(
    process.env.TOKEN
);

(async () => {
    try {
        await rest.put(
            Routes.applicationCommands(
                process.env.CLIENT_ID
            ),
            {
                body: commands
            }
        );

        console.log(
            `コマンド登録完了: ${commands.length}件`
        );
    } catch (error) {
        console.error(
            '[Command Deployment Error]',
            error
        );

        process.exitCode = 1;
    }
})();
