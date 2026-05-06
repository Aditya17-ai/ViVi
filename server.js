const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const path    = require('path');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server);

app.use(express.static(path.join(__dirname)));

const rooms     = {};    // roomId -> Set<socketId>
const roomUsers = {};    // roomId -> Map<socketId, { name }>
const MAX_ROOM  = 8;

io.on('connection', (socket) => {
    console.log(`[+] ${socket.id}`);
    socket.emit('connection-success', { sid: socket.id });

    socket.on('join_room', ({ room_id, name }) => {
        if (!rooms[room_id])     rooms[room_id]     = new Set();
        if (!roomUsers[room_id]) roomUsers[room_id] = new Map();

        if (rooms[room_id].size >= MAX_ROOM) {
            socket.emit('room-full');
            return;
        }

        const displayName = (name || '').trim() || `Guest-${socket.id.slice(0,4).toUpperCase()}`;

        // Tell new user who is already here
        const existingPeers = [...rooms[room_id]].map(sid => ({
            sid,
            name: roomUsers[room_id].get(sid)?.name || 'Guest'
        }));
        socket.emit('existing-peers', { peers: existingPeers });

        socket.join(room_id);
        rooms[room_id].add(socket.id);
        roomUsers[room_id].set(socket.id, { name: displayName });
        socket.data.room = room_id;
        socket.data.name = displayName;

        socket.to(room_id).emit('user-joined', { sid: socket.id, name: displayName });
        io.to(room_id).emit('room-count', { count: rooms[room_id].size });

        console.log(`[~] "${displayName}" joined ${room_id} (${rooms[room_id].size}/${MAX_ROOM})`);
    });

    // WebRTC signaling — route to specific peer
    socket.on('offer',         ({ target, sdp })       => io.to(target).emit('offer',         { sender: socket.id, sdp }));
    socket.on('answer',        ({ target, sdp })       => io.to(target).emit('answer',        { sender: socket.id, sdp }));
    socket.on('ice_candidate', ({ target, candidate }) => io.to(target).emit('ice-candidate', { sender: socket.id, candidate }));

    // Chat — broadcast to entire room
    socket.on('chat_message', ({ room_id, text }) => {
        if (!text || !text.trim()) return;
        const name = roomUsers[room_id]?.get(socket.id)?.name || 'Guest';
        io.to(room_id).emit('chat_message', {
            sid:  socket.id,
            name,
            text: text.slice(0, 500),   // cap length
            ts:   Date.now()
        });
    });

    socket.on('disconnect', () => {
        console.log(`[-] ${socket.id}`);
        const rid = socket.data.room;
        if (rid) {
            if (rooms[rid])     { rooms[rid].delete(socket.id);     if (rooms[rid].size === 0)     delete rooms[rid];     }
            if (roomUsers[rid]) { roomUsers[rid].delete(socket.id); if (roomUsers[rid].size === 0) delete roomUsers[rid]; }
            io.to(rid).emit('peer-disconnected', { sid: socket.id });
            if (rooms[rid]) io.to(rid).emit('room-count', { count: rooms[rid].size });
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`\n🚀 ViVi running at http://localhost:${PORT}\n`));
