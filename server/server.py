#!/usr/bin/env python3
import asyncio
import json
import logging
import os
import time
import uuid
from typing import Dict, Set

import websockets
from websockets.server import WebSocketServerProtocol

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

PORT = int(os.environ.get('PORT', 5082))
HEARTBEAT_INTERVAL = 30
HEARTBEAT_TIMEOUT = 60

rooms: Dict[str, Set[str]] = {}
clients: Dict[str, dict] = {}


async def cleanup_user(user_id: str):
    """Clean up user data when disconnecting"""
    client = clients.get(user_id)
    if not client:
        return
    
    room_id = client.get('room_id')
    if room_id and room_id in rooms:
        rooms[room_id].discard(user_id)
        
        # Notify other users
        await broadcast(room_id, {
            'type': 'user-left',
            'userId': user_id
        }, exclude_user=user_id)
        
        # Remove empty rooms
        if not rooms[room_id]:
            del rooms[room_id]
    
    # Close websocket if still open
    ws = client.get('ws')
    if ws and not ws.closed:
        await ws.close()
    
    # Remove client
    if user_id in clients:
        del clients[user_id]


async def broadcast(room_id: str, message: dict, exclude_user: str = None):
    """Broadcast message to all users in a room"""
    if room_id not in rooms:
        return
    
    message_str = json.dumps(message)
    
    for user_id in rooms[room_id]:
        if user_id != exclude_user:
            client = clients.get(user_id)
            if client and client['ws'] and not client['ws'].closed:
                try:
                    await client['ws'].send(message_str)
                except Exception as e:
                    logger.error(f"Error sending to {user_id}: {e}")


async def handle_message(ws: WebSocketServerProtocol, user_id: str, message: dict):
    """Handle incoming WebSocket messages"""
    msg_type = message.get('type')
    
    if msg_type == 'join':
        # Leave current room if any
        if clients[user_id]['room_id']:
            await cleanup_user(user_id)
            clients[user_id] = {'ws': ws, 'room_id': None, 'last_heartbeat': time.time()}
        
        room_id = message.get('room')
        clients[user_id]['room_id'] = room_id
        
        # Create room if doesn't exist
        if room_id not in rooms:
            rooms[room_id] = set()
        
        rooms[room_id].add(user_id)
        
        # Send join confirmation
        await ws.send(json.dumps({
            'type': 'joined',
            'userId': user_id,
            'users': list(rooms[room_id])
        }))
        
        # Notify others
        await broadcast(room_id, {
            'type': 'user-joined',
            'userId': user_id
        }, exclude_user=user_id)
    
    elif msg_type in ['offer', 'answer', 'ice-candidate']:
        target = message.get('target')
        if target and target in clients:
            target_ws = clients[target]['ws']
            if target_ws and not target_ws.closed:
                await target_ws.send(json.dumps({
                    'type': msg_type,
                    'from': user_id,
                    'data': message.get('data')
                }))
    
    elif msg_type == 'heartbeat':
        await ws.send(json.dumps({'type': 'heartbeat-ack'}))


async def handle_connection(ws: WebSocketServerProtocol, path: str):
    """Handle new WebSocket connection"""
    user_id = str(uuid.uuid4())[:9]
    clients[user_id] = {
        'ws': ws,
        'room_id': None,
        'last_heartbeat': time.time()
    }
    
    try:
        async for message in ws:
            try:
                data = json.loads(message)
                clients[user_id]['last_heartbeat'] = time.time()
                await handle_message(ws, user_id, data)
            except json.JSONDecodeError:
                logger.error(f"Invalid JSON from {user_id}")
            except Exception as e:
                logger.error(f"Error handling message from {user_id}: {e}")
    
    except websockets.exceptions.ConnectionClosed:
        pass
    except Exception as e:
        logger.error(f"Connection error for {user_id}: {e}")
    finally:
        await cleanup_user(user_id)


async def cleanup_inactive_users():
    """Periodically clean up inactive users"""
    while True:
        await asyncio.sleep(HEARTBEAT_INTERVAL)
        current_time = time.time()
        
        users_to_cleanup = []
        for user_id, client in clients.items():
            if current_time - client['last_heartbeat'] > HEARTBEAT_TIMEOUT:
                users_to_cleanup.append(user_id)
        
        for user_id in users_to_cleanup:
            logger.info(f"Cleaning up inactive user: {user_id}")
            await cleanup_user(user_id)


async def main():
    """Start the WebSocket server"""
    logger.info(f"Starting signaling server on port {PORT}")
    
    # Start cleanup task
    asyncio.create_task(cleanup_inactive_users())
    
    # Start WebSocket server
    async with websockets.serve(handle_connection, "0.0.0.0", PORT):
        await asyncio.Future()  # Run forever


if __name__ == "__main__":
    asyncio.run(main())