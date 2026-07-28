// client/js/dashboard.js
let currentUser = null;
let currentPage = 'overview';
let selectedSubject = null;
let isProcessing = false;
let currentConversationId = null;

document.addEventListener('DOMContentLoaded', function() {
  const userData = localStorage.getItem('leago_user');
  if (!userData) { window.location.href = '/'; return; }
  try { currentUser = JSON.parse(userData); initDashboard(currentUser); } catch(e) { window.location.href = '/'; }
  if (typeof lucide !== 'undefined') lucide.createIcons();
  document.getElementById('fileUploadInput')?.addEventListener('change', handleFileUpload);
  document.getElementById('fileInput')?.addEventListener('change', handleHomeworkUpload);
});

function initDashboard(user) {
  currentUser = user;
  const fullName = user.name || 'Student';
  document.getElementById('userNameSidebar').textContent = fullName;
  document.getElementById('userAvatar').textContent = fullName.charAt(0).toUpperCase();
  document.getElementById('topAvatar').textContent = fullName.charAt(0).toUpperCase();
  document.getElementById('greetingName').textContent = fullName.split(' ')[0] || 'Student';
  document.getElementById('welcomeMessage').textContent = `Welcome back, ${fullName} 👋`;
  updateSubscriptionBadge(user.plan || 'free');
  renderOverviewSubjects(user.subjects || []);
  renderSubjectsList(user.subjects || []);
  loadRecentSubjects(user.subjects || []);
  loadChatHistory();
  navigateTo('overview');
}

function updateSubscriptionBadge(plan) {
  const badge = document.getElementById('userBadgeSidebar');
  const premiumCard = document.getElementById('premiumCard');
  if (plan === 'premium') { badge.textContent = 'Premium'; badge.style.color = '#9D5CFF'; premiumCard.style.display = 'none'; }
  else if (plan === 'trial') { badge.textContent = 'Trial'; badge.style.color = '#FCD34D'; premiumCard.style.display = 'block'; }
  else { badge.textContent = 'Free'; badge.style.color = '#9CA3AF'; premiumCard.style.display = 'block'; }
}

async function handleUpgrade() {
  if (!currentUser) { alert('Please log in first.'); return; }
  try {
    const response = await fetch('/api/payments/create', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: currentUser.id, email: currentUser.email })
    });
    const data = await response.json();
    if (data.authorization_url) window.location.href = data.authorization_url;
    else alert('Payment initialization failed. Please try again.');
  } catch(err) { alert('Payment service unavailable. Please try again later.'); }
}

function handleLogout() {
  if (confirm('Are you sure you want to logout?')) {
    localStorage.removeItem('leago_user'); localStorage.removeItem('token');
    window.location.href = '/';
  }
}

function navigateTo(page) {
  document.querySelectorAll('.page').forEach(el => el.classList.remove('active'));
  const target = document.getElementById('page-' + page);
  if (target) target.classList.add('active');
  document.querySelectorAll('.sidebar-nav a').forEach(el => el.classList.remove('active'));
  const sidebarLink = document.querySelector(`.sidebar-nav a[data-page="${page}"]`);
  if (sidebarLink) sidebarLink.classList.add('active');
  document.querySelectorAll('.bottom-nav a').forEach(el => el.classList.remove('active'));
  const bottomLink = document.querySelector(`.bottom-nav a[data-page="${page}"]`);
  if (bottomLink) bottomLink.classList.add('active');
  const inputArea = document.getElementById('inputArea');
  if (page === 'chat') inputArea.classList.add('active'); else inputArea.classList.remove('active');
  currentPage = page;
  if (page === 'subjects') renderAllSubjects();
  if (page === 'pastpapers') loadPastPapers();
  document.getElementById('pageContainer').scrollTop = 0;
  closeSidebar();
}

function toggleSidebar() { document.getElementById('sidebar').classList.toggle('open'); document.getElementById('sidebarOverlay').classList.toggle('active'); }
function closeSidebar() { document.getElementById('sidebar').classList.remove('open'); document.getElementById('sidebarOverlay').classList.remove('active'); }

function globalSearch(query) {
  const q = query.toLowerCase().trim();
  if (currentPage === 'subjects') {
    document.querySelectorAll('.subject-card').forEach(card => {
      const name = card.querySelector('.name').textContent.toLowerCase();
      card.style.display = name.includes(q) ? '' : 'none';
    });
  }
}

function renderOverviewSubjects(subjects) {
  const container = document.getElementById('overviewSubjects');
  if (!subjects || subjects.length === 0) { container.innerHTML = '<p style="color:var(--text-secondary);">No subjects selected. Update your profile.</p>'; return; }
  container.innerHTML = subjects.map(sub => `<div class="subject-card" onclick="openSubject('${sub}')"><span class="icon">📘</span><span class="name">${sub}</span></div>`).join('');
}

function renderSubjectsList(subjects) {
  const container = document.getElementById('subjectsGrid');
  if (!subjects || subjects.length === 0) { container.innerHTML = '<p style="color:var(--text-secondary);">No subjects selected.</p>'; return; }
  container.innerHTML = subjects.map(sub => `<div class="subject-card" onclick="openSubject('${sub}')"><span class="icon">📘</span><span class="name">${sub}</span></div>`).join('');
  document.getElementById('subjectDetail').style.display = 'none';
}

async function openSubject(subjectName) {
  selectedSubject = subjectName;
  document.getElementById('subjectsGrid').style.display = 'none';
  const detail = document.getElementById('subjectDetail');
  detail.style.display = 'block';
  document.getElementById('subjectTitle').textContent = subjectName;
  try {
    const token = localStorage.getItem('token');
    const res = await fetch(`/api/subjects/topics?subject=${encodeURIComponent(subjectName)}&grade=${encodeURIComponent(currentUser.grade || '')}&curriculum=${encodeURIComponent(currentUser.curriculum || '')}`, {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    const topics = await res.json();
    const grid = document.getElementById('topicsGrid');
    if (topics.length === 0) { grid.innerHTML = '<p style="color:var(--text-secondary);">No topics available.</p>'; return; }
    grid.innerHTML = topics.map(t => `<div class="topic-card" onclick="openTopic('${subjectName}', '${t.name}')"><div class="title">${t.name}</div><div class="desc">Click to explore</div></div>`).join('');
  } catch(err) {
    const fallback = ['Introduction', 'Basics', 'Intermediate', 'Advanced'];
    document.getElementById('topicsGrid').innerHTML = fallback.map(t => `<div class="topic-card" onclick="openTopic('${subjectName}', '${t}')"><div class="title">${t}</div><div class="desc">Click to explore</div></div>`).join('');
  }
}

function closeSubjectDetail() {
  document.getElementById('subjectDetail').style.display = 'none';
  document.getElementById('subjectsGrid').style.display = 'grid';
  selectedSubject = null;
}

function openTopic(subject, topic) {
  document.getElementById('chatInput').value = `Explain "${topic}" in ${subject} step by step.`;
  navigateTo('chat');
  setTimeout(sendChatMessage, 300);
}

function loadRecentSubjects(subjects) {
  const container = document.getElementById('subjectTags');
  container.innerHTML = '';
  if (!subjects || subjects.length === 0) { container.innerHTML = '<span class="subject-tag">No subjects yet</span>'; return; }
  subjects.slice(0,5).forEach(s => {
    const tag = document.createElement('span');
    tag.className = 'subject-tag';
    tag.textContent = s;
    tag.onclick = () => openSubject(s);
    tag.style.cursor = 'pointer';
    container.appendChild(tag);
  });
}

function renderAllSubjects() { renderSubjectsList(currentUser.subjects || []); }

function sendSuggestion(text) {
  document.getElementById('chatInput').value = text;
  navigateTo('chat');
  setTimeout(sendChatMessage, 300);
}

async function sendChatMessage() {
  const input = document.getElementById('chatInput');
  const message = input.value.trim();
  if (!message || isProcessing) return;
  input.value = '';
  addMessage('user', message);
  showTyping(true);
  isProcessing = true;
  const fileInput = document.getElementById('fileUploadInput');
  let fileData = fileInput && fileInput.files.length > 0 ? fileInput.files[0] : null;
  try {
    const token = localStorage.getItem('token');
    let reply;
    if (fileData) {
      const formData = new FormData();
      formData.append('file', fileData);
      formData.append('message', message);
      formData.append('subject', selectedSubject || 'General');
      formData.append('topic', '');
      formData.append('conversationId', currentConversationId || '');
      const uploadRes = await fetch('/api/chat/upload', { method: 'POST', headers: { 'Authorization': 'Bearer ' + token }, body: formData });
      const uploadData = await uploadRes.json();
      reply = uploadData.reply || 'File received. What would you like to know?';
      fileInput.value = '';
    } else {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({
          message, subject: selectedSubject || 'General', topic: '', conversationId: currentConversationId || '',
          grade: currentUser.grade, curriculum: currentUser.curriculum
        })
      });
      const data = await res.json();
      if (data.error === 'limit_reached') reply = '📚 **You\'ve reached your daily limit.** Upgrade to Premium.';
      else if (data.reply) { reply = data.reply; if (data.conversationId) currentConversationId = data.conversationId; }
      else reply = '❌ ' + (data.error || 'No response');
    }
    showTyping(false);
    addMessage('bot', reply);
  } catch(err) {
    showTyping(false);
    addMessage('bot', '❌ Server error. Please try again.');
  }
  isProcessing = false;
}

function addMessage(role, text) {
  const container = document.getElementById('chatMessages');
  const div = document.createElement('div');
  div.className = `message ${role}`;
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  if (role === 'bot') {
    const meta = document.createElement('div');
    meta.className = 'bot-meta';
    meta.innerHTML = `<span class="bot-avatar">🧠</span> Leago AI Tutor`;
    bubble.appendChild(meta);
    let content = text;
    if (typeof marked !== 'undefined') { marked.setOptions({ breaks: true, gfm: true }); content = marked.parse(content); }
    const contentDiv = document.createElement('div');
    contentDiv.innerHTML = content;
    bubble.appendChild(contentDiv);
    const actions = document.createElement('div');
    actions.className = 'message-actions';
    actions.innerHTML = `<button onclick="copyMessage(this, '${text.replace(/"/g, '&quot;')}')">📋 Copy</button><button onclick="regenerateMessage()">🔄 Regenerate</button>`;
    bubble.appendChild(actions);
    setTimeout(() => {
      if (typeof renderMathInElement === 'function') {
        try { renderMathInElement(contentDiv, { delimiters: [{left: '$$', right: '$$', display: true}, {left: '$', right: '$', display: false}] }); } catch(e) {}
      }
    }, 200);
  } else {
    bubble.textContent = text;
  }
  div.appendChild(bubble);
  container.appendChild(div);
  scrollChatToBottom();
}

function copyMessage(btn, text) {
  navigator.clipboard.writeText(text).then(() => { btn.textContent = '✅ Copied'; setTimeout(() => { btn.textContent = '📋 Copy'; }, 2000); });
}

function regenerateMessage() {
  const messages = document.querySelectorAll('.message');
  if (messages.length >= 2) {
    const lastBot = messages[messages.length - 1];
    const lastUser = messages[messages.length - 2];
    if (lastUser.classList.contains('user') && lastBot.classList.contains('bot')) {
      lastBot.remove();
      const userText = lastUser.querySelector('.bubble').textContent;
      document.getElementById('chatInput').value = userText;
      sendChatMessage();
    }
  }
}

function showTyping(active) {
  const el = document.getElementById('typingIndicator');
  if (active) { el.classList.add('active'); scrollChatToBottom(); }
  else { el.classList.remove('active'); }
}

function scrollChatToBottom() {
  const container = document.getElementById('pageContainer');
  setTimeout(() => { container.scrollTop = container.scrollHeight; }, 50);
}

async function loadChatHistory() {
  try {
    const token = localStorage.getItem('token');
    const res = await fetch('/api/chat/history', { headers: { 'Authorization': 'Bearer ' + token } });
    if (res.ok) { const history = await res.json(); /* store if needed */ }
  } catch(e) {}
}

function handleFileUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  document.getElementById('chatInput').value = `I've uploaded "${file.name}". Please help me with this.`;
}

function handleHomeworkUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  const result = document.getElementById('homeworkResult');
  result.innerHTML = `<div style="background:rgba(124,58,237,0.08); border:1px solid rgba(124,58,237,0.15); border-radius:14px; padding:16px;"><p style="font-weight:600;">📄 ${file.name} uploaded</p><p style="color:var(--text-secondary); font-size:13px; margin-top:4px;">Processing your homework...</p><div style="margin-top:10px; display:flex; gap:6px;"><span style="background:rgba(124,58,237,0.12); padding:3px 10px; border-radius:16px; font-size:11px;">📝 AI analysing</span></div></div>`;
}

function loadPastPapers() {
  const grade = document.getElementById('ppGrade').value;
  const subject = document.getElementById('ppSubject').value;
  const year = document.getElementById('ppYear').value;
  const list = document.getElementById('paperList');
  list.innerHTML = '<p style="color:var(--text-secondary);">Loading...</p>';
  fetch(`/api/past-papers?grade=${encodeURIComponent(grade)}&subject=${encodeURIComponent(subject)}&year=${encodeURIComponent(year)}`, {
    headers: { 'Authorization': 'Bearer ' + localStorage.getItem('token') }
  })
  .then(res => res.json())
  .then(papers => {
    if (!papers || papers.length === 0) { list.innerHTML = '<p style="color:var(--text-secondary);">No past papers found.</p>'; return; }
    list.innerHTML = papers.map(p => `
      <div class="paper-item">
        <div class="info">
          <div class="title">${p.subject || 'Subject'} – ${p.paper_number || 'Paper'}</div>
          <div class="meta">${p.grade || ''} • ${p.year || ''}</div>
        </div>
        <div class="actions">
          ${p.question_pdf_url ? `<a href="${p.question_pdf_url}" target="_blank">📄 Question</a>` : ''}
          ${p.memo_pdf_url ? `<a href="${p.memo_pdf_url}" target="_blank">📝 Memo</a>` : ''}
        </div>
      </div>
    `).join('');
  })
  .catch(() => { list.innerHTML = '<p style="color:var(--text-secondary);">Failed to load past papers.</p>'; });
}

function updateProgressRing(percent) {
  const ring = document.getElementById('progressRing');
  const label = document.getElementById('progressLabel');
  if (!ring) return;
  const total = 166.5;
  const target = percent || 68;
  const offset = total - (target / 100) * total;
  ring.style.strokeDashoffset = offset;
  if (label) label.textContent = target + '%';
}