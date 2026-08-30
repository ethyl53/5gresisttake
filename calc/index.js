const { calcShinobigami } = require('./shinobigami');
const { calcSwordWorld } = require('./sw25');

function calculateExpectedValue(systemId, command) {
    const normalizedCommand = command.trim().toUpperCase();

    switch (systemId) {
        case 'ShinobiGami':
            return calcShinobigami(normalizedCommand);
        case 'SwordWorld2.5':
            return calcSwordWorld(normalizedCommand);
        default:
            throw new Error('未対応のシステムです。');
    }
}

module.exports = { calculateExpectedValue };