const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const distIndex = path.join(root, 'dist', 'index.js');

// Package checks
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
assert.ok(packageJson.bin && packageJson.bin['mssql-cli'], 'Expected CLI bin entry');
assert.ok(fs.existsSync(path.join(root, 'src', 'index.ts')), 'Expected CLI source entrypoint');
assert.ok(fs.existsSync(path.join(root, 'src', 'llm.ts')), 'Expected LLM module');
assert.ok(fs.existsSync(path.join(root, 'dist', 'llm.js')), 'Expected LLM compiled output');
console.log('✅ Package structure verified');

// CLI help output
const helpOutput = execSync(`node ${distIndex} --help`, { encoding: 'utf8' });
assert.ok(helpOutput.includes('mssql-cli'), 'Help should mention mssql-cli');
assert.ok(helpOutput.includes('release') || helpOutput.includes('ws'), 'Help should list commands');
console.log('✅ CLI help works');

// CLI dry-run on itself (mssqlCli repo)
const selfDryRun = execSync(`node ${distIndex} release ${root} --dry-run --no-verify --skip-llm`, { encoding: 'utf8', timeout: 10000 });
console.log('✅ CLI dry-run executed on self:', selfDryRun.trim().split('\n')[0] || '(no changes)');

// Check LLM module exports
const llm = require(path.join(root, 'dist', 'llm'));
assert.ok(typeof llm.generateCommitMessage === 'function', 'generateCommitMessage should be a function');
assert.ok(typeof llm.getGitDiff === 'function', 'getGitDiff should be a function');
assert.ok(typeof llm.getGitLog === 'function', 'getGitLog should be a function');
console.log('✅ LLM module exports verified');

// Check ws command mentions in help
assert.ok(helpOutput.includes('ws'), 'Help should mention ws command');
console.log('✅ WS command documented in help');

// Check config loading
assert.ok(fs.existsSync(path.join(root, '.mssqlcli.json')), 'Config file should exist');
console.log('✅ Config file exists');

console.log('\n🎉 All mssqlCli smoke tests passed!');
