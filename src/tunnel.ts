// tunnel.ts - Standalone tunnel management using Vercel CLI

import { spawn, execSync } from 'child_process';
import path from 'path';

let vercelProcess: any = null;
let tunnelUrl: string | null = null;
let currentPort: number = 0;

interface TunnelOptions {
  port: number;
  subdomain?: string;
}

function getUiDir(): string {
  return path.resolve(__dirname, '..', 'ui');
}

function checkVercelCli(): boolean {
  try {
    execSync('npx vercel --version', { stdio: 'pipe', timeout: 30000 });
    return true;
  } catch {
    return false;
  }
}

async function startTunnel(options: TunnelOptions) {
  if (vercelProcess) {
    console.log(`\n⚠️  Tunnel already running on ${tunnelUrl}`);
    console.log(`   Stop it first: mssql-cli tunnel stop\n`);
    return;
  }

  if (!checkVercelCli()) {
    console.log(`\n❌ Vercel CLI not found. Install it:`);
    console.log(`   npm i -g vercel`);
    console.log(`   Or run: npx vercel dev\n`);
    return;
  }

  const uiDir = getUiDir();
  const port = options.port || 5071;
  currentPort = port;

  console.log(`\n🌐 Starting Vercel tunnel on port ${port}...\n`);

  const args = ['vercel', 'dev', '--yes', '--listen', String(port)];
  if (options.subdomain) {
    args.push('--subdomain', options.subdomain);
  }

  vercelProcess = spawn('npx', args, {
    cwd: uiDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true,
  });

  vercelProcess.stdout.on('data', (data: Buffer) => {
    const output = data.toString();
    process.stdout.write(output);

    const urlMatch = output.match(/https:\/\/[^\s]+\.vercel\.app/);
    if (urlMatch && !tunnelUrl) {
      tunnelUrl = urlMatch[0];
      console.log(`\n✅ Tunnel active at: ${tunnelUrl}\n`);
    }
  });

  vercelProcess.stderr.on('data', (data: Buffer) => {
    process.stderr.write(data);
  });

  vercelProcess.on('close', (code: number) => {
    console.log(`\n🔒 Vercel tunnel closed (exit code: ${code})\n`);
    vercelProcess = null;
    tunnelUrl = null;
  });

  // Wait a bit for URL to appear
  await new Promise(r => setTimeout(r, 5000));

  if (!tunnelUrl) {
    console.log(`\n⏳ Tunnel starting... check status with: mssql-cli tunnel status\n`);
  }
}

async function stopTunnel() {
  if (!vercelProcess) {
    console.log('\n⚠️  No tunnel is currently running.\n');
    return;
  }

  console.log(`\n🔒 Stopping Vercel tunnel...`);
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /PID ${vercelProcess.pid} /T /F`, { stdio: 'ignore' });
    } else {
      execSync(`kill -9 ${vercelProcess.pid}`, { stdio: 'ignore' });
    }
  } catch { /* process may already be dead */ }
  vercelProcess = null;
  tunnelUrl = null;
  console.log(`✅ Tunnel stopped.\n`);
}

async function getTunnelStatus() {
  if (!vercelProcess || !tunnelUrl) {
    console.log('\n📡 Tunnel status: INACTIVE\n');
    return;
  }

  console.log(`\n📡 Tunnel status: ACTIVE`);
  console.log(`   URL:       ${tunnelUrl}`);
  console.log(`   Port:      ${currentPort}`);
  console.log(`   API:       http://localhost:5070 (for VITE_API_URL)`);
  console.log(`   Stop:      mssql-cli tunnel stop\n`);
}

export { startTunnel, stopTunnel, getTunnelStatus };
