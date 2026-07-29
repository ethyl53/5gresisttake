'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const excluded = new Set([
    '.git',
    '.git_restore',
    'node_modules'
]);

function collectJavaScript(directory) {
    const entries = fs.readdirSync(directory, { withFileTypes: true });
    return entries.flatMap((entry) => {
        if (excluded.has(entry.name)) {
            return [];
        }
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            return collectJavaScript(absolute);
        }
        return entry.isFile() && entry.name.endsWith('.js')
            ? [absolute]
            : [];
    });
}

const files = collectJavaScript(root);
const failures = [];

for (const file of files) {
    const result = spawnSync(process.execPath, ['--check', file], {
        encoding: 'utf8'
    });
    if (result.status !== 0) {
        failures.push({ file, output: result.stderr || result.stdout });
    }
}

if (failures.length > 0) {
    for (const failure of failures) {
        console.error(`[Syntax Error] ${path.relative(root, failure.file)}`);
        console.error(failure.output);
    }
    process.exitCode = 1;
} else {
    console.log(`[Syntax Check] ${files.length} JavaScript files passed.`);
}
