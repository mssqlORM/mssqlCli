// app.js - Frontend Logic for Workspace Manager

let currentRepo = null;
let reposData = [];

// DOM Elements
const repoList = document.getElementById('repo-list');
const dashboardGrid = document.getElementById('dashboard-grid');
const welcomeView = document.getElementById('welcome-view');
const currentRepoName = document.getElementById('current-repo-name');
const currentRepoPath = document.getElementById('current-repo-path');
const statusBadge = document.getElementById('status-badge');
const modifiedCount = document.getElementById('modified-count');
const filesList = document.getElementById('files-list');
const diffContent = document.getElementById('diff-content');

// Quality Checks elements
const btnRunChecks = document.getElementById('btn-run-checks');
const checksStatusBox = document.getElementById('checks-status-box');
const checksSpinner = document.getElementById('checks-spinner');
const checksResultText = document.getElementById('checks-result-text');
const checksConsole = document.getElementById('checks-console');
const checkNoVerify = document.getElementById('check-no-verify');

// LLM Review elements
const btnRunReview = document.getElementById('btn-run-review');
const reviewStatusBox = document.getElementById('review-status-box');
const reviewSpinner = document.getElementById('review-spinner');
const reviewResultText = document.getElementById('review-result-text');
const reviewOutput = document.getElementById('review-output');

// Release elements
const commitMessage = document.getElementById('commit-message');
const btnGenerateMsg = document.getElementById('btn-generate-msg');
const checkPushRemote = document.getElementById('check-push-remote');
const btnRelease = document.getElementById('btn-release');
const releaseStatusBox = document.getElementById('release-status-box');
const releaseSpinner = document.getElementById('release-spinner');
const releaseResultText = document.getElementById('release-result-text');
const releaseConsole = document.getElementById('release-console');

// Settings Elements & Pull
const btnPull = document.getElementById('btn-pull');
const btnSettings = document.getElementById('btn-settings');
const settingsModal = document.getElementById('settings-modal');
const btnCloseSettings = document.getElementById('btn-close-settings');
const settingsForm = document.getElementById('settings-form');
const settingsProvider = document.getElementById('settings-provider');
const settingsKey = document.getElementById('settings-key');
const settingsModel = document.getElementById('settings-model');
const settingsEndpoint = document.getElementById('settings-endpoint');

// Other buttons
const btnRefreshAll = document.getElementById('btn-refresh-all');
const btnCopyDiff = document.getElementById('btn-copy-diff');

// Event Listeners
btnRefreshAll.addEventListener('click', loadStatus);
btnRunChecks.addEventListener('click', runQualityChecks);
btnRunReview.addEventListener('click', runLlmReview);
btnGenerateMsg.addEventListener('click', generateCommitMessage);
btnRelease.addEventListener('click', publishRelease);
btnCopyDiff.addEventListener('click', copyDiffToClipboard);

btnPull.addEventListener('click', runGitPull);
btnSettings.addEventListener('click', openSettings);
btnCloseSettings.addEventListener('click', closeSettings);
settingsForm.addEventListener('submit', saveSettings);

// Init
loadStatus();

// Fetch status from API
async function loadStatus() {
  setLoadingState(true);
  try {
    const response = await fetch('/api/status');
    const data = await response.json();
    reposData = data.repos || [];
    renderRepoList();
    if (currentRepo) {
      const updated = reposData.find(r => r.name === currentRepo.name);
      if (updated) {
        selectRepo(updated);
      }
    }
  } catch (error) {
    console.error('Failed to load status:', error);
    repoList.innerHTML = `<li class="loading-placeholder error">Failed to load workspace status. Is server running?</li>`;
  } finally {
    setLoadingState(false);
  }
}

function setLoadingState(loading) {
  if (loading) {
    btnRefreshAll.classList.add('loading');
    btnRefreshAll.disabled = true;
  } else {
    btnRefreshAll.classList.remove('loading');
    btnRefreshAll.disabled = false;
  }
}

// Render repos in sidebar
function renderRepoList() {
  if (reposData.length === 0) {
    repoList.innerHTML = `<li class="loading-placeholder">No repositories found</li>`;
    return;
  }

  repoList.innerHTML = '';
  reposData.forEach(repo => {
    const li = document.createElement('li');
    li.className = `repo-item ${currentRepo && currentRepo.name === repo.name ? 'active' : ''}`;
    
    const isDirty = repo.modifiedFiles && repo.modifiedFiles.length > 0;
    const statusText = isDirty ? `${repo.modifiedFiles.length} changes` : 'clean';
    const statusClass = isDirty ? 'dirty' : 'clean';

    li.innerHTML = `
      <div class="repo-item-meta">
        <span class="repo-item-name">${repo.name}</span>
        <span class="badge ${statusClass}">${statusText}</span>
      </div>
      <span class="repo-item-desc">${repo.description || 'No description'}</span>
    `;

    li.addEventListener('click', () => selectRepo(repo));
    repoList.appendChild(li);
  });
}

// Select a repo and display details
function selectRepo(repo) {
  currentRepo = repo;
  
  const items = repoList.querySelectorAll('.repo-item');
  items.forEach((item, index) => {
    if (reposData[index].name === repo.name) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });

  welcomeView.classList.add('hidden');
  dashboardGrid.classList.remove('hidden');

  currentRepoName.textContent = repo.name;
  currentRepoPath.textContent = repo.path;
  
  const isDirty = repo.modifiedFiles && repo.modifiedFiles.length > 0;
  statusBadge.textContent = isDirty ? 'Modified' : 'Clean';
  statusBadge.className = `badge ${isDirty ? 'dirty' : 'clean'}`;
  
  // Show pull button
  btnPull.classList.remove('hidden');

  // Modified Count & List
  modifiedCount.textContent = repo.modifiedFiles ? repo.modifiedFiles.length : 0;
  
  filesList.innerHTML = '';
  if (repo.modifiedFiles && repo.modifiedFiles.length > 0) {
    // Add "All Changes" tag
    const allLi = document.createElement('li');
    allLi.className = 'file-tag active';
    allLi.innerHTML = `<span>All Changes</span>`;
    allLi.addEventListener('click', () => {
      filesList.querySelectorAll('.file-tag').forEach(t => t.classList.remove('active'));
      allLi.classList.add('active');
      fetchDiff(repo.name);
    });
    filesList.appendChild(allLi);

    repo.modifiedFiles.forEach(file => {
      const li = document.createElement('li');
      li.className = 'file-tag';
      
      let statusClass = 'modified';
      if (file.startsWith('A ')) statusClass = 'added';
      if (file.startsWith('D ')) statusClass = 'deleted';
      
      const fileName = file.replace(/^[MADRU?\s]{1,2}\s+/, '');

      li.innerHTML = `
        <span class="file-status ${statusClass}"></span>
        <span>${fileName}</span>
      `;

      li.addEventListener('click', () => {
        filesList.querySelectorAll('.file-tag').forEach(t => t.classList.remove('active'));
        li.classList.add('active');
        fetchDiff(repo.name, fileName);
      });

      filesList.appendChild(li);
    });
    
    fetchDiff(repo.name);
    btnRunChecks.disabled = false;
    btnRunReview.disabled = false;
    btnGenerateMsg.disabled = false;
    btnRelease.disabled = false;
  } else {
    filesList.innerHTML = `<li class="loading-placeholder">No modified files.</li>`;
    diffContent.textContent = 'Clean workspace. No changes detected.';
    diffContent.className = '';
    btnRunChecks.disabled = true;
    btnRunReview.disabled = true;
    btnGenerateMsg.disabled = true;
    btnRelease.disabled = true;
  }

  checksStatusBox.classList.add('hidden');
  checksConsole.textContent = '';
  reviewStatusBox.classList.add('hidden');
  reviewOutput.innerHTML = '';
  releaseStatusBox.classList.add('hidden');
  releaseConsole.textContent = '';
  commitMessage.value = '';
}

// Fetch Git Diff from server with file support
async function fetchDiff(repoName, file = null) {
  diffContent.textContent = 'Loading git diff...';
  try {
    const url = `/api/diff?repo=${encodeURIComponent(repoName)}` + (file ? `&file=${encodeURIComponent(file)}` : '');
    const response = await fetch(url);
    const data = await response.json();
    if (data.diff) {
      renderDiff(data.diff);
    } else {
      diffContent.textContent = 'No diff output or clean workspace.';
    }
  } catch (error) {
    diffContent.textContent = 'Error loading git diff.';
  }
}

// Diff renderer
function renderDiff(diffText) {
  const lines = diffText.split('\n');
  diffContent.innerHTML = '';
  
  lines.forEach(line => {
    const span = document.createElement('span');
    span.textContent = line + '\n';
    
    if (line.startsWith('+') && !line.startsWith('+++')) {
      span.className = 'diff-add';
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      span.className = 'diff-remove';
    } else if (line.startsWith('@@') || line.startsWith('diff --git')) {
      span.className = 'diff-header-line';
    }
    
    diffContent.appendChild(span);
  });
}

// Run quality checks
async function runQualityChecks() {
  if (!currentRepo) return;
  
  checksStatusBox.classList.remove('hidden');
  checksSpinner.classList.remove('hidden');
  checksResultText.textContent = 'Running build & test suite...';
  checksConsole.textContent = 'Initializing checks...';
  checksConsole.className = 'console-output';

  try {
    const response = await fetch('/api/checks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        repo: currentRepo.name,
        noVerify: checkNoVerify.checked
      })
    });
    
    const data = await response.json();
    checksSpinner.classList.add('hidden');
    checksConsole.textContent = data.logs || 'No output log.';
    
    if (data.success) {
      checksResultText.textContent = 'Quality checks passed!';
      checksResultText.style.color = '#34d399';
    } else {
      checksResultText.textContent = 'Quality checks failed!';
      checksResultText.style.color = '#ef4444';
      checksConsole.className = 'console-output error';
    }
  } catch (error) {
    checksSpinner.classList.add('hidden');
    checksResultText.textContent = 'Request failed.';
    checksConsole.textContent = 'Error connecting to check server.';
    checksConsole.className = 'console-output error';
  }
}

// Run Git Pull
async function runGitPull() {
  if (!currentRepo) return;
  
  checksStatusBox.classList.remove('hidden');
  checksSpinner.classList.remove('hidden');
  checksResultText.textContent = 'Pulling latest code...';
  checksConsole.textContent = 'Running git pull origin...';
  checksConsole.className = 'console-output';

  try {
    const response = await fetch('/api/pull', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo: currentRepo.name })
    });
    const data = await response.json();
    checksSpinner.classList.add('hidden');
    checksConsole.textContent = data.logs || 'No output.';
    if (data.success) {
      checksResultText.textContent = 'Git pull completed!';
      checksResultText.style.color = '#34d399';
      setTimeout(loadStatus, 1500);
    } else {
      checksResultText.textContent = 'Git pull failed!';
      checksResultText.style.color = '#ef4444';
      checksConsole.className = 'console-output error';
    }
  } catch (error) {
    checksSpinner.classList.add('hidden');
    checksResultText.textContent = 'Request failed.';
    checksConsole.textContent = 'Error connecting to server.';
    checksConsole.className = 'console-output error';
  }
}

// Open settings modal
async function openSettings() {
  settingsModal.classList.remove('hidden');
  try {
    const response = await fetch('/api/config');
    const data = await response.json();
    settingsProvider.value = data.provider || 'openai';
    settingsKey.value = '';
    settingsKey.placeholder = data.apiKey ? data.apiKey : 'Enter API Key';
    settingsModel.value = data.model || '';
    settingsEndpoint.value = data.endpoint || '';
  } catch (error) {
    console.error('Failed to load LLM config:', error);
  }
}

// Close settings
function closeSettings() {
  settingsModal.classList.add('hidden');
}

// Save settings
async function saveSettings(e) {
  e.preventDefault();
  const provider = settingsProvider.value;
  const apiKey = settingsKey.value.trim();
  const model = settingsModel.value.trim();
  const endpoint = settingsEndpoint.value.trim();

  try {
    const response = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, apiKey, model, endpoint })
    });
    const data = await response.json();
    if (data.success) {
      alert('LLM configuration saved successfully!');
      closeSettings();
    } else {
      alert('Failed to save settings: ' + (data.error || 'Unknown error'));
    }
  } catch (error) {
    alert('Error communicating with settings server.');
  }
}

// Run LLM Code Review
async function runLlmReview() {
  if (!currentRepo) return;
  
  reviewStatusBox.classList.remove('hidden');
  reviewSpinner.classList.remove('hidden');
  reviewResultText.textContent = 'Analyzing changes with LLM...';
  reviewOutput.innerHTML = '';

  try {
    const response = await fetch('/api/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo: currentRepo.name })
    });
    
    const data = await response.json();
    reviewSpinner.classList.add('hidden');
    
    if (data.success && data.review) {
      reviewResultText.textContent = 'Analysis complete!';
      reviewOutput.innerHTML = formatMarkdown(data.review);
    } else {
      reviewResultText.textContent = 'Review generation failed.';
      reviewOutput.textContent = data.error || 'Failed to communicate with LLM provider. Check your API Keys.';
    }
  } catch (error) {
    reviewSpinner.classList.add('hidden');
    reviewResultText.textContent = 'Request failed.';
    reviewOutput.textContent = 'Error calling review endpoint.';
  }
}

// Generate LLM Commit Message
async function generateCommitMessage() {
  if (!currentRepo) return;
  
  commitMessage.value = 'Generating message...';
  try {
    const response = await fetch('/api/commit-msg', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo: currentRepo.name })
    });
    
    const data = await response.json();
    if (data.success && data.message) {
      commitMessage.value = data.message;
    } else {
      commitMessage.value = '';
      alert('Failed to generate commit message: ' + (data.error || 'Unknown error'));
    }
  } catch (error) {
    commitMessage.value = '';
    alert('Error calling message generation endpoint.');
  }
}

// Publish release (Commit and push)
async function publishRelease() {
  if (!currentRepo) return;
  
  const msg = commitMessage.value.trim();
  if (!msg) {
    alert('Please enter or generate a commit message.');
    return;
  }

  if (!confirm(`Are you sure you want to commit these changes to ${currentRepo.name}?`)) {
    return;
  }

  releaseStatusBox.classList.remove('hidden');
  releaseSpinner.classList.remove('hidden');
  releaseResultText.textContent = 'Publishing release...';
  releaseConsole.textContent = 'Starting commit workflow...';
  releaseConsole.className = 'console-output';

  try {
    const response = await fetch('/api/release', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        repo: currentRepo.name,
        message: msg,
        push: checkPushRemote.checked,
        noVerify: checkNoVerify.checked
      })
    });
    
    const data = await response.json();
    releaseSpinner.classList.add('hidden');
    releaseConsole.textContent = data.logs || 'No output.';
    
    if (data.success) {
      releaseResultText.textContent = 'Release published successfully!';
      releaseResultText.style.color = '#34d399';
      setTimeout(() => {
        loadStatus();
      }, 2000);
    } else {
      releaseResultText.textContent = 'Release failed!';
      releaseResultText.style.color = '#ef4444';
      releaseConsole.className = 'console-output error';
    }
  } catch (error) {
    releaseSpinner.classList.add('hidden');
    releaseResultText.textContent = 'Request failed.';
    releaseConsole.textContent = 'Error connecting to release server.';
    releaseConsole.className = 'console-output error';
  }
}

// Copy diff to clipboard
function copyDiffToClipboard() {
  const text = diffContent.textContent;
  navigator.clipboard.writeText(text).then(() => {
    alert('Git Diff copied to clipboard!');
  }).catch(err => {
    console.error('Failed to copy text: ', err);
  });
}

// Custom Markdown formatter
function formatMarkdown(mdText) {
  if (!mdText) return '';
  
  let html = mdText
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');

  html = html.replace(/`([^`]+)`/g, '<code style="background: rgba(255,255,255,0.07); padding: 2px 6px; border-radius: 4px; font-family: monospace; font-size: 12px; color: #a5f3fc;">$1</code>');

  const lines = html.split('\n');
  let result = [];
  let inList = false;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();

    if (!line) {
      if (inList) {
        result.push('</ul>');
        inList = false;
      }
      result.push('<br>');
      continue;
    }

    line = line.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

    if (line.startsWith('### ')) {
      if (inList) { result.push('</ul>'); inList = false; }
      result.push(`<h4 style="margin: 14px 0 6px 0; color: white;">${line.slice(4)}</h4>`);
    } else if (line.startsWith('## ')) {
      if (inList) { result.push('</ul>'); inList = false; }
      result.push(`<h3 style="margin: 18px 0 8px 0; color: white;">${line.slice(3)}</h3>`);
    } else if (line.startsWith('# ')) {
      if (inList) { result.push('</ul>'); inList = false; }
      result.push(`<h2 style="margin: 22px 0 10px 0; color: white;">${line.slice(2)}</h2>`);
    } else if (line.startsWith('&gt; ') || line.startsWith('> ')) {
      if (inList) { result.push('</ul>'); inList = false; }
      const content = line.startsWith('&gt; ') ? line.slice(5) : line.slice(2);
      result.push(`<blockquote style="border-left: 3px solid var(--color-primary); padding-left: 12px; color: var(--color-text-muted); margin: 10px 0;">${content}</blockquote>`);
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      if (!inList) {
        result.push('<ul style="margin-left: 20px; margin-bottom: 8px;">');
        inList = true;
      }
      result.push(`<li>${line.slice(2)}</li>`);
    } else {
      if (inList) {
        result.push('</ul>');
        inList = false;
      }
      result.push(`<p style="margin-bottom: 6px;">${line}</p>`);
    }
  }

  if (inList) {
    result.push('</ul>');
  }

  return result.join('\n');
}
