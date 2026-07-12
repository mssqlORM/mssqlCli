import https from 'https';
import http from 'http';
import fs from 'fs';
import path from 'path';

export type LLMProvider = 'openai' | 'gemini' | 'custom';

export interface LLMConfig {
  provider: LLMProvider;
  apiKey: string;
  model?: string;
  endpoint?: string;
}

function loadEnv() {
  let dir = __dirname;
  while (dir) {
    const envPath = path.join(dir, '.env');
    if (fs.existsSync(envPath)) {
      try {
        const content = fs.readFileSync(envPath, 'utf8');
        for (const line of content.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;
          const match = trimmed.match(/^([^=]+)=(.*)$/);
          if (match) {
            const key = match[1].trim();
            let val = match[2].trim();
            if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
              val = val.slice(1, -1);
            }
            if (!process.env[key]) {
              process.env[key] = val;
            }
          }
        }
      } catch {}
      break;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
}

function getConfig(): LLMConfig | null {
  loadEnv();
  const provider = (process.env.LLM_PROVIDER || 'openai') as LLMProvider;
  const apiKey = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY || '';
  if (!apiKey) return null;
  return {
    provider,
    apiKey,
    model: process.env.LLM_MODEL,
    endpoint: process.env.LLM_ENDPOINT,
  };
}

function buildPrompt(diff: string, repoName: string): string {
  return `You are a git commit message generator for the "${repoName}" repository.

Analyze the following git diff and generate a concise, conventional commit message.

Rules:
- Use conventional commit format: type(scope): description
- Types: feat, fix, chore, refactor, docs, test, style, perf
- Keep the subject line under 72 characters
- Add a blank line followed by bullet points for details if needed
- Focus on WHAT and WHY, not HOW
- Be specific about the changes

Git diff:
\`\`\`
${diff.slice(0, 6000)}
\`\`\`

Respond with ONLY the commit message, nothing else.`;
}

function fetchWithTimeout(url: string, options: any, timeoutMs = 90000): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = (/^https:/.test(url) ? https : http).request(url, options, (res) => {
      let data = '';
      res.on('data', (chunk: string) => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error('LLM request timed out')); });
    req.write(options.body || '');
    req.end();
  });
}

async function callOpenAI(config: LLMConfig, prompt: string, maxTokens = 4000): Promise<string> {
  let endpoint = config.endpoint || 'https://api.openai.com/v1/chat/completions';
  if (config.endpoint && !config.endpoint.endsWith('/chat/completions') && !config.endpoint.endsWith('/chat/completions/')) {
    endpoint = config.endpoint.replace(/\/$/, '') + '/chat/completions';
  }
  const body = JSON.stringify({
    model: config.model || 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    max_tokens: maxTokens,
    temperature: 0.3,
    stream: false,
  });
  const response = await fetchWithTimeout(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
    },
    body,
  });
  const parsed = JSON.parse(response);
  if (parsed.error) {
    const errorMsg = typeof parsed.error === 'object' ? (parsed.error.message || JSON.stringify(parsed.error)) : parsed.error;
    throw new Error(`OpenAI API Error: ${errorMsg}`);
  }
  const content = parsed.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error(`OpenAI response empty. Response: ${response}`);
  }
  return content;
}

async function callGemini(config: LLMConfig, prompt: string, maxTokens = 4000): Promise<string> {
  const model = config.model || 'gemini-2.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.apiKey}`;
  const body = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { maxOutputTokens: maxTokens, temperature: 0.3 },
  });
  const response = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
  const parsed = JSON.parse(response);
  if (parsed.error) {
    const errorMsg = parsed.error.message || JSON.stringify(parsed.error);
    throw new Error(`Gemini API Error: ${errorMsg}`);
  }
  const content = parsed.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (!content) {
    throw new Error(`Gemini response empty. Response: ${response}`);
  }
  return content;
}

async function callCustom(config: LLMConfig, prompt: string): Promise<string> {
  const endpoint = config.endpoint || 'http://localhost:11434/api/chat';
  const body = JSON.stringify({
    model: config.model || 'llama3',
    messages: [{ role: 'user', content: prompt }],
    stream: false,
  });
  const response = await fetchWithTimeout(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(config.apiKey ? { 'Authorization': `Bearer ${config.apiKey}` } : {}) },
    body,
  });
  const parsed = JSON.parse(response);
  if (parsed.error) {
    throw new Error(`Custom API Error: ${JSON.stringify(parsed.error)}`);
  }
  const content = parsed.message?.content?.trim() || parsed.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error(`Custom API response empty. Response: ${response}`);
  }
  return content;
}

function cleanLlmResponse(text: string): string {
  let cleaned = text.trim();
  
  if (cleaned.includes('```')) {
    cleaned = cleaned.replace(/```[a-zA-Z]*\n?/g, '').replace(/```/g, '');
  }
  
  cleaned = cleaned.replace(/^['"`]+|['"`]+$/g, '');
  cleaned = cleaned.replace(/^(commit message|proposed commit message|message|subject):\s*/i, '');
  
  return cleaned.trim();
}

export async function generateCommitMessage(diff: string, repoName: string): Promise<string | null> {
  const config = getConfig();
  if (!config) return null;

  const prompt = buildPrompt(diff, repoName);
  try {
    let rawMsg: string | null = null;
    switch (config.provider) {
      case 'openai': rawMsg = await callOpenAI(config, prompt, 4000); break;
      case 'gemini': rawMsg = await callGemini(config, prompt, 4000); break;
      case 'custom': rawMsg = await callCustom(config, prompt); break;
      default: return null;
    }
    return rawMsg ? cleanLlmResponse(rawMsg) : null;
  } catch (err: any) {
    console.error(`LLM commit message generation failed: ${err.message}`);
    return null;
  }
}

export function getGitDiff(cwd: string, staged = true): string {
  const { execSync } = require('child_process');
  try {
    const diff = execSync(`git -C "${cwd}" diff${staged ? ' --cached' : ''}`, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
    return diff.trim();
  } catch {
    return '';
  }
}

export function getGitLog(cwd: string, count = 5): string {
  const { execSync } = require('child_process');
  try {
    return execSync(`git -C "${cwd}" log --oneline -${count}`, { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

function buildChangelogPrompt(diff: string, repoName: string, files: string[]): string {
  return `You are a changelog generator for the "${repoName}" repository.

Analyze the following git diff and changed files list, then generate a concise, human-readable changelog entry.

Rules:
- Group changes by type: Added, Changed, Fixed, Removed, Deprecated, Security
- Use bullet points with brief descriptions
- Focus on WHAT changed and WHY, not HOW
- Be specific about features, fixes, and improvements
- Use imperative mood ("Add", not "Added")
- Keep each bullet under 80 characters
- Output ONLY the markdown list, nothing else

Changed files:
${files.join('\n')}

Git diff:
\`\`\`
${diff.slice(0, 8000)}
\`\`\``;
}

export async function generateChangelogContent(diff: string, repoName: string, files: string[]): Promise<string | null> {
  const config = getConfig();
  if (!config) return null;

  const prompt = buildChangelogPrompt(diff, repoName, files);
  try {
    switch (config.provider) {
      case 'openai': return await callOpenAI(config, prompt, 4000);
      case 'gemini': return await callGemini(config, prompt, 4000);
      case 'custom': return await callCustom(config, prompt);
      default: return null;
    }
  } catch (err: any) {
    console.error(`LLM changelog generation failed: ${err.message}`);
    return null;
  }
}

function buildReviewPrompt(diff: string, repoName: string): string {
  return `You are an expert code reviewer reviewing changes in the "${repoName}" repository.

Analyze the following git diff and provide a concise code review.

Rules:
- Highlight key changes.
- Identify potential bugs, code smells, type safety issues, or performance concerns.
- List any leftover debug code (e.g., console.log, debugger, todo comments).
- Provide a brief summary of code quality.
- Keep the response short, clear, and actionable (maximum 15 lines).
- Be polite but direct and strict.

Git diff:
\`\`\`
${diff.slice(0, 8000)}
\`\`\`

Respond with the markdown formatted review only.`;
}

export async function generateCodeReview(diff: string, repoName: string): Promise<string | null> {
  const config = getConfig();
  if (!config) return null;

  const prompt = buildReviewPrompt(diff, repoName);
  try {
    switch (config.provider) {
      case 'openai': return await callOpenAI(config, prompt, 4000);
      case 'gemini': return await callGemini(config, prompt, 4000);
      case 'custom': return await callCustom(config, prompt);
      default: return null;
    }
  } catch (err: any) {
    console.error(`LLM code review failed: ${err.message}`);
    return null;
  }
}

export async function generateDocumentation(sourceCode: string, fileName: string): Promise<string | null> {
  const config = getConfig();
  if (!config) return null;

  const prompt = `You are a technical writer. Generate a comprehensive, beautiful markdown documentation file (.md) for the following source file: "${fileName}".
Include:
- Overview of the file's purpose and functionality.
- Key classes, functions, types, and their parameters/returns.
- Practical usage examples based on the code.
- Formatting must be professional, using proper Markdown headings, tables, and code blocks.

Source code:
\`\`\`
${sourceCode.slice(0, 15000)}
\`\`\`

Respond with ONLY the markdown content, nothing else.`;

  try {
    switch (config.provider) {
      case 'openai': return await callOpenAI(config, prompt, 4000);
      case 'gemini': return await callGemini(config, prompt, 4000);
      case 'custom': return await callCustom(config, prompt);
      default: return null;
    }
  } catch (err: any) {
    console.error(`LLM documentation generation failed: ${err.message}`);
    return null;
  }
}

export async function improveDocumentation(docContent: string, fileName: string): Promise<string | null> {
  const config = getConfig();
  if (!config) return null;

  const prompt = `You are an expert technical editor. Improve the following markdown documentation file "${fileName}".
Fix:
- Grammatical issues and formatting inconsistencies.
- Make it look extremely premium, professional, and clear.
- Ensure all headers are organized logically.
- Keep the structure and code examples intact but polish the text and layout.

Documentation Content:
\`\`\`
${docContent.slice(0, 15000)}
\`\`\`

Respond with ONLY the updated markdown content, nothing else.`;

  try {
    switch (config.provider) {
      case 'openai': return await callOpenAI(config, prompt, 4000);
      case 'gemini': return await callGemini(config, prompt, 4000);
      case 'custom': return await callCustom(config, prompt);
      default: return null;
    }
  } catch (err: any) {
    console.error(`LLM documentation improvement failed: ${err.message}`);
    return null;
  }
}
