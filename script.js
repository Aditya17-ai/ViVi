const socket = io();

// DOM Elements
const localVideo = document.getElementById('local-video');
const remoteVideo = document.getElementById('remote-video');
const joinBtn = document.getElementById('join-btn');
const roomIdInput = document.getElementById('room-id');
const waitingMsg = document.getElementById('waiting-msg');
const cameraBtn = document.getElementById('camera-btn');
const micBtn = document.getElementById('mic-btn');
const leaveBtn = document.getElementById('leave-btn');

// WebRTC Configuration
const rtcConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' }, // Public Google STUN server
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

let localStream;
let peerConnection;
let roomId;
let isCaller = false;

// Media Constraints
const constraints = {
    video: true,
    audio: true
};

// Initialize Media
async function initMedia() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia(constraints);
        localVideo.srcObject = localStream;
    } catch (error) {
        console.error('Error accessing media devices:', error);
        alert('Could not access camera/microphone. Please allow permissions.');
    }
}

// Join Room
joinBtn.addEventListener('click', () => {
    roomId = roomIdInput.value;
    if (roomId) {
        socket.emit('join_room', { room_id: roomId });
        joinBtn.disabled = true;
        roomIdInput.disabled = true;

        // Initialize peer connection explicitly after joining
        createPeerConnection();

        // The first person to join doesn't create an offer immediately.
        // The offer is created when we know another user is there to receive it?
        // Actually, for simplicity:
        // When 'user-joined' is received -> You are the existing user, so YOU create an offer.
        // The new user waits for the offer.
    }
});

function createPeerConnection() {
    peerConnection = new RTCPeerConnection(rtcConfig);

    // Add local tracks to peer connection
    localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
    });

    // Handle remote stream
    peerConnection.ontrack = (event) => {
        console.log('Received remote stream');
        remoteVideo.srcObject = event.streams[0];
        waitingMsg.style.display = 'none';
    };

    // Handle ICE candidates
    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('ice_candidate', {
                room_id: roomId,
                candidate: event.candidate
            });
        }
    };
}

async function createOffer() {
    try {
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        socket.emit('offer', {
            room_id: roomId,
            sdp: offer
        });
        console.log('Offer sent');
    } catch (error) {
        console.error('Error creating offer:', error);
    }
}

// Socket Events

socket.on('connection-success', (data) => {
    console.log('Connected to signaling server with ID: ' + data.sid);
    initMedia();
});

socket.on('user-joined', (data) => {
    console.log('User joined: ' + data.sid);
    // Since a new user joined, I (the existing user) will initiate the call
    isCaller = true;
    createOffer();
});

socket.on('offer', async (data) => {
    if (!peerConnection) createPeerConnection(); // Should be created already but safety check

    console.log('Received offer');
    try {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        socket.emit('answer', {
            room_id: roomId,
            sdp: answer
        });
    } catch (error) {
        console.error('Error handling offer:', error);
    }
});

socket.on('answer', async (data) => {
    console.log('Received answer');
    try {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp));
    } catch (error) {
        console.error('Error handling answer:', error);
    }
});

socket.on('ice-candidate', async (data) => {
    console.log('Received ICE candidate');
    try {
        if (peerConnection) {
            await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
        }
    } catch (error) {
        console.error('Error adding ICE candidate:', error);
    }
});

// UI Controls
cameraBtn.addEventListener('click', () => {
    const videoTrack = localStream.getVideoTracks()[0];
    videoTrack.enabled = !videoTrack.enabled;
    cameraBtn.classList.toggle('active');
    cameraBtn.innerText = videoTrack.enabled ? '📷' : '📷🚫';
});

micBtn.addEventListener('click', () => {
    const audioTrack = localStream.getAudioTracks()[0];
    audioTrack.enabled = !audioTrack.enabled;
    micBtn.classList.toggle('active');
    micBtn.innerText = audioTrack.enabled ? '🎤' : '🎤🚫';
});

leaveBtn.addEventListener('click', () => {
    location.reload();
});
