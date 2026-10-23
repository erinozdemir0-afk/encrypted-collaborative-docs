from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from typing import List

app = FastAPI(title="E2EE Collaborative Workspace API")

class ConnectionManager:
    """Manages active WebSocket client connections and relays messages."""
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        self.active_connections.remove(websocket)

    async def broadcast(self, message: str, sender: WebSocket):
        # Relay encrypted messages to all connected clients except the sender
        for connection in self.active_connections:
            if connection != sender:
                await connection.send_text(message)

manager = ConnectionManager()

@app.get("/")
def read_root():
    return {"status": "Backend operational", "security": "E2EE Enabled"}

@app.websocket("/ws/doc/{doc_id}")
async def websocket_endpoint(websocket: WebSocket, doc_id: str):
    await manager.connect(websocket)
    try:
        while True:
            # Wait for incoming encrypted payload from a client
            data = await websocket.receive_text()
            # Broadcast payload to all other active editors
            await manager.broadcast(data, sender=websocket)
    except WebSocketDisconnect:
        manager.disconnect(websocket)