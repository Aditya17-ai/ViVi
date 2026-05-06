/* ==========================================
   ViVi — script.js  |  Multi-party + Chat
   ========================================== */

const socket = io();

// ---------- DOM ----------
const lobby             = document.getElementById('lobby');
const callRoom          = document.getElementById('call-room');
const joinBtn           = document.getElementById('join-btn');
const roomIdInput       = document.getElementById('room-id');
const displayNameInput  = document.getElementById('display-name');
const generateBtn       = document.getElementById('generate-btn');
const roomLabel         = document.getElementById('room-label');
const statusText        = document.getElementById('status-text');
const statusDot         = document.getElementById('status-dot');
const callTimerEl       = document.getElementById('call-timer');
const participantCount  = document.getElementById('participant-count');
const videoGrid         = document.getElementById('video-grid');
const inviteOverlay     = document.getElementById('invite-overlay');
const inviteCodeDisp    = document.getElementById('invite-code-display');
const copyInviteBtn     = document.getElementById('copy-invite-btn');
const inviteBtn         = document.getElementById('invite-btn');
const invitePopup       = document.getElementById('invite-popup');
const popupCodeDisp     = document.getElementById('popup-code-display');
const copyPopupBtn      = document.getElementById('copy-popup-btn');
const closePopupBtn     = document.getElementById('close-popup-btn');
const copyRoomBtn       = document.getElementById('copy-room-btn');
const micBtn            = document.getElementById('mic-btn');
const cameraBtn         = document.getElementById('camera-btn');
const leaveBtn          = document.getElementById('leave-btn');
const fullscreenBtn     = document.getElementById('fullscreen-btn');
const chatBtn           = document.getElementById('chat-btn');
const chatPanel         = document.getElementById('chat-panel');
const closeChatBtn      = document.getElementById('close-chat-btn');
const chatMessages      = document.getElementById('chat-messages');
const chatInput         = document.getElementById('chat-input');
const sendBtn           = document.getElementById('send-btn');
const unreadBadge       = document.getElementById('unread-badge');
const toastEl           = document.getElementById('toast');

// ---------- State ----------
const rtcConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

const peers       = new Map();   // socketId → { pc }
const peerNames   = new Map();   // socketId → display name
let localStream   = null;
let roomId        = null;
let myName        = 'You';
let mySocketId    = null;
let camEnabled    = true;
let micEnabled    = true;
let callStartTime = null;
let timerInterval = null;
let unreadCount   = 0;
let chatOpen      = false;

// ---------- Utilities ----------
function showToast(msg, ms = 3000) {
    toastEl.textContent = msg;
    toastEl.classList.remove('hidden');
    toastEl.classList.add('show');
    clearTimeout(toastEl._t);
    toastEl._t = setTimeout(() => {
        toastEl.classList.remove('show');
        setTimeout(() => toastEl.classList.add('hidden'), 300);
    }, ms);
}

function setStatus(state, text) {
    statusText.textContent = text;
    statusDot.className    = 'status-dot ' + state;
}

function startTimer() {
    if (callStartTime) return;
    callStartTime = Date.now();
    callTimerEl.classList.remove('hidden');
    timerInterval = setInterval(() => {
        const s = Math.floor((Date.now() - callStartTime) / 1000);
        callTimerEl.textContent =
            String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
    }, 1000);
}

function stopTimer() { clearInterval(timerInterval); callTimerEl.classList.add('hidden'); callStartTime = null; }

function randomCode(n = 6) {
    const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    return Array.from({ length: n }, () => c[Math.floor(Math.random() * c.length)]).join('');
}

function copyToClipboard(text) {
    navigator.clipboard.writeText(text)
        .then(() => showToast('✅ Room code copied!'))
        .catch(() => showToast('⚠️ Could not copy'));
}

function escapeHtml(str) {
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
              .replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}

// ---------- Video Grid ----------
function updateGrid() {
    const count = videoGrid.children.length;
    videoGrid.dataset.count = Math.min(count, 8);
    participantCount.textContent = count;
    inviteOverlay.classList.toggle('hidden', count > 1);
    if (count === 2) startTimer();
}

function addVideoTile(peerId, stream, isLocal = false) {
    if (document.getElementById('tile-' + (isLocal ? 'local' : peerId))) return;

    const tile    = document.createElement('div');
    tile.className = 'video-tile' + (isLocal ? ' local-tile' : '');
    tile.id        = 'tile-' + (isLocal ? 'local' : peerId);

    const video   = document.createElement('video');
    video.autoplay = true; video.playsInline = true;
    if (isLocal) video.muted = true;
    video.srcObject = stream;

    const label   = document.createElement('div');
    label.className   = 'tile-label';
    label.textContent = isLocal ? myName : (peerNames.get(peerId) || 'Peer');

    tile.appendChild(video);
    tile.appendChild(label);
    videoGrid.appendChild(tile);
    updateGrid();
}

function removeVideoTile(peerId) {
    const tile = document.getElementById('tile-' + peerId);
    if (tile) tile.remove();
    updateGrid();
}

// ---------- Media ----------
async function initMedia() {
    const attempts = [
        { video: true,  audio: true,  label: null },
        { video: false, audio: true,  label: '🎤 No camera — audio only' },
        { video: true,  audio: false, label: '📷 No mic — video only' },
    ];
    for (const a of attempts) {
        try {
            localStream = await navigator.mediaDevices.getUserMedia({ video: a.video, audio: a.audio });
            if (a.label) showToast(a.label, 5000);
            return;
        } catch (err) {
            const isDevice = ['NotFoundError','DevicesNotFoundError','NotReadableError','OverconstrainedError'].includes(err.name);
            if (!isDevice) { showToast('🚫 Camera/mic access denied.', 6000); _fallbackStream(); return; }
        }
    }
    showToast('⚠️ No camera or mic — using placeholder.', 6000);
    _fallbackStream();
}

function _fallbackStream() {
    const canvas = document.createElement('canvas');
    canvas.width = 640; canvas.height = 480;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#111'; ctx.fillRect(0, 0, 640, 480);
    ctx.fillStyle = 'rgba(255,255,255,0.2)'; ctx.font = '28px Inter,sans-serif';
    ctx.textAlign = 'center'; ctx.fillText('No Camera', 320, 240);
    const vt = canvas.captureStream(1).getVideoTracks()[0];
    const at = new AudioContext().createMediaStreamDestination().stream.getAudioTracks()[0];
    localStream = new MediaStream([vt, at]);
}

// ---------- WebRTC ----------
function createPC(peerId) {
    if (peers.has(peerId)) { peers.get(peerId).pc.close(); peers.delete(peerId); }

    const pc = new RTCPeerConnection(rtcConfig);
    peers.set(peerId, { pc });

    if (localStream) localStream.getTracks().forEach(t => pc.addTrack(t, localStream));

    pc.ontrack = (e) => {
        addVideoTile(peerId, e.streams[0]);
        setStatus('connected', 'Connected');
        showToast(`🎉 ${peerNames.get(peerId) || 'A peer'} joined!`);
    };

    pc.onicecandidate = (e) => {
        if (e.candidate) socket.emit('ice_candidate', { target: peerId, candidate: e.candidate });
    };

    pc.onconnectionstatechange = () => {
        if (['disconnected','failed','closed'].includes(pc.connectionState)) {
            removeVideoTile(peerId);
            peers.delete(peerId);
            if (peers.size === 0) { setStatus('disconnected', 'Alone in room'); stopTimer(); }
        }
    };

    return pc;
}

async function createOffer(peerId) {
    const pc    = createPC(peerId);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('offer', { target: peerId, sdp: offer });
}

// ---------- Chat ----------
function openChat() {
    chatOpen = true;
    chatPanel.classList.remove('hidden');
    chatBtn.classList.add('chat-active');
    unreadCount = 0;
    unreadBadge.classList.add('hidden');
    chatInput.focus();
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function closeChat() {
    chatOpen = false;
    chatPanel.classList.add('hidden');
    chatBtn.classList.remove('chat-active');
}

function toggleChat() { chatOpen ? closeChat() : openChat(); }

function appendMessage({ sid, name, text, ts }, isOwn = false) {
    const time = new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const div = document.createElement('div');
    div.className = 'chat-msg ' + (isOwn ? 'own' : 'other');

    const meta   = document.createElement('div');
    meta.className = 'msg-meta';
    meta.innerHTML = `<span class="msg-name">${escapeHtml(isOwn ? myName : name)}</span><span class="msg-time">${time}</span>`;

    const bubble = document.createElement('div');
    bubble.className   = 'msg-bubble';
    bubble.textContent = text;

    div.appendChild(meta);
    div.appendChild(bubble);
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;

    // Bump unread if panel is closed and message is from others
    if (!isOwn && !chatOpen) {
        unreadCount++;
        unreadBadge.textContent = unreadCount > 9 ? '9+' : unreadCount;
        unreadBadge.classList.remove('hidden');
    }
}

function appendSystemMsg(text) {
    const div    = document.createElement('div');
    div.className = 'chat-msg system';
    const bubble = document.createElement('div');
    bubble.className   = 'msg-bubble';
    bubble.textContent = text;
    div.appendChild(bubble);
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function sendMessage() {
    const text = chatInput.value.trim();
    if (!text || !roomId) return;
    socket.emit('chat_message', { room_id: roomId, text });
    // Show immediately for sender
    appendMessage({ sid: mySocketId, name: myName, text, ts: Date.now() }, true);
    chatInput.value = '';
}

// ---------- Lobby Controls ----------
generateBtn.addEventListener('click', () => { roomIdInput.value = randomCode(); });

joinBtn.addEventListener('click', async () => {
    const code = roomIdInput.value.trim().toUpperCase();
    if (!code) { showToast('Please enter a room code.'); return; }

    myName = displayNameInput.value.trim() || `Guest-${Math.random().toString(36).slice(2,6).toUpperCase()}`;

    joinBtn.disabled     = true;
    roomIdInput.disabled = true;

    await initMedia();
    roomId = code;

    lobby.classList.add('hidden');
    callRoom.classList.remove('hidden');

    roomLabel.textContent       = roomId;
    inviteCodeDisp.textContent  = roomId;
    popupCodeDisp.textContent   = roomId;

    addVideoTile('local', localStream, true);
    setStatus('', 'Joining room…');

    socket.emit('join_room', { room_id: roomId, name: myName });
});

roomIdInput.addEventListener('keydown', e => { if (e.key === 'Enter') joinBtn.click(); });

// ---------- Copy / Invite ----------
copyRoomBtn.addEventListener('click',   () => copyToClipboard(roomId));
copyInviteBtn.addEventListener('click', () => copyToClipboard(roomId));
copyPopupBtn.addEventListener('click',  () => copyToClipboard(roomId));
inviteBtn.addEventListener('click',     () => invitePopup.classList.toggle('hidden'));
closePopupBtn.addEventListener('click', () => invitePopup.classList.add('hidden'));
document.addEventListener('click', (e) => {
    if (!invitePopup.contains(e.target) && e.target !== inviteBtn) invitePopup.classList.add('hidden');
});

// ---------- Media Controls ----------
micBtn.addEventListener('click', () => {
    if (!localStream) return;
    micEnabled = !micEnabled;
    localStream.getAudioTracks().forEach(t => t.enabled = micEnabled);
    micBtn.classList.toggle('active', micEnabled);
    micBtn.querySelector('.ctrl-icon').textContent = micEnabled ? '🎤' : '🔇';
    showToast(micEnabled ? 'Mic on' : 'Mic muted');
});

cameraBtn.addEventListener('click', () => {
    if (!localStream) return;
    camEnabled = !camEnabled;
    localStream.getVideoTracks().forEach(t => t.enabled = camEnabled);
    cameraBtn.classList.toggle('active', camEnabled);
    cameraBtn.querySelector('.ctrl-icon').textContent = camEnabled ? '📷' : '🚫';
    showToast(camEnabled ? 'Camera on' : 'Camera off');
});

leaveBtn.addEventListener('click', () => {
    peers.forEach(({ pc }) => pc.close());
    localStream?.getTracks().forEach(t => t.stop());
    stopTimer();
    location.reload();
});

fullscreenBtn.addEventListener('click', () => {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
        fullscreenBtn.querySelector('.ctrl-icon').textContent = '✕';
    } else {
        document.exitFullscreen();
        fullscreenBtn.querySelector('.ctrl-icon').textContent = '⛶';
    }
});

// ---------- Chat Controls ----------
chatBtn.addEventListener('click', toggleChat);
closeChatBtn.addEventListener('click', closeChat);
sendBtn.addEventListener('click', sendMessage);
chatInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});

// ---------- Socket Events ----------
socket.on('connection-success', ({ sid }) => {
    mySocketId = sid;
    console.log('Socket connected:', sid);
});

socket.on('existing-peers', async ({ peers: existingPeers }) => {
    for (const { sid, name } of existingPeers) {
        peerNames.set(sid, name);
        await createOffer(sid);
    }
    setStatus(existingPeers.length ? '' : 'connected', existingPeers.length ? 'Connecting…' : 'Waiting for others…');
});

socket.on('user-joined', ({ sid, name }) => {
    peerNames.set(sid, name);
    appendSystemMsg(`👋 ${name} joined the room`);
    showToast(`👋 ${name} joined!`);
});

socket.on('room-count', ({ count }) => {
    participantCount.textContent = count;
});

socket.on('offer', async ({ sender, sdp }) => {
    const pc = createPC(sender);
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('answer', { target: sender, sdp: answer });
});

socket.on('answer', async ({ sender, sdp }) => {
    const peer = peers.get(sender);
    if (peer) await peer.pc.setRemoteDescription(new RTCSessionDescription(sdp));
});

socket.on('ice-candidate', async ({ sender, candidate }) => {
    const peer = peers.get(sender);
    if (peer) {
        try { await peer.pc.addIceCandidate(new RTCIceCandidate(candidate)); }
        catch (e) { console.warn('ICE error:', e); }
    }
});

socket.on('peer-disconnected', ({ sid }) => {
    const name = peerNames.get(sid) || 'A peer';
    const peer = peers.get(sid);
    if (peer) { peer.pc.close(); peers.delete(sid); }
    peerNames.delete(sid);
    removeVideoTile(sid);
    appendSystemMsg(`📵 ${name} left the room`);
    showToast(`📵 ${name} left the call`);
    if (peers.size === 0) { setStatus('disconnected', 'Alone in room'); stopTimer(); }
});

// Chat messages from server
socket.on('chat_message', ({ sid, name, text, ts }) => {
    // Skip own messages — we already appended them locally
    if (sid === mySocketId) return;
    appendMessage({ sid, name, text, ts }, false);
});

socket.on('room-full', () => {
    showToast('❌ Room is full (max 8 users).', 5000);
    lobby.classList.remove('hidden');
    callRoom.classList.add('hidden');
    joinBtn.disabled     = false;
    roomIdInput.disabled = false;
});
