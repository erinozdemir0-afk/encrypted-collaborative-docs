from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from typing import List, Optional
from pydantic import BaseModel
import database

app = FastAPI(title="E2EE Collaborative Workspace API")

# Enable CORS for React frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def get_db():
    db = database.SessionLocal()
    try:
        yield db
    finally:
        db.close()

# Pydantic Schemas
class DocCreate(BaseModel):
    id: str
    title: str

class DocResponse(BaseModel):
    id: str
    title: str
    encrypted_content: Optional[str] = ""

class ConnectionManager:
    def __init__(self):
        self.active_connections: dict = {}

    async def connect(self, websocket: WebSocket, doc_id: str):
        await websocket.accept()
        if doc_id not in self.active_connections:
            self.active_connections[doc_id] = []
        self.active_connections[doc_id].append(websocket)

    def disconnect(self, websocket: WebSocket, doc_id: str):
        if doc_id in self.active_connections:
            if websocket in self.active_connections[doc_id]:
                self.active_connections[doc_id].remove(websocket)
            if not self.active_connections[doc_id]:
                del self.active_connections[doc_id]

    async def broadcast(self, message: str, doc_id: str, sender: WebSocket):
        if doc_id in self.active_connections:
            for connection in self.active_connections[doc_id]:
                if connection != sender:
                    await connection.send_text(message)

manager = ConnectionManager()

# --- REST Endpoints for Document Management ---

@app.get("/api/documents", response_model=List[DocResponse])
def list_documents(db: Session = Depends(get_db)):
    return db.query(database.Document).all()

@app.post("/api/documents", response_model=DocResponse)
def create_document(doc: DocCreate, db: Session = Depends(get_db)):
    db_doc = database.Document(id=doc.id, title=doc.title, encrypted_content="")
    db.add(db_doc)
    db.commit()
    db.refresh(db_doc)
    return db_doc

@app.get("/api/documents/{doc_id}", response_model=DocResponse)
def get_document(doc_id: str, db: Session = Depends(get_db)):
    doc = db.query(database.Document).filter(database.Document.id == doc_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    return doc

@app.delete("/api/documents/{doc_id}")
def delete_document(doc_id: str, db: Session = Depends(get_db)):
    doc = db.query(database.Document).filter(database.Document.id == doc_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    db.delete(doc)
    db.commit()
    return {"status": "success", "message": f"Document {doc_id} deleted"}

# --- WebSocket Relay + Persistence ---

@app.websocket("/ws/doc/{doc_id}")
async def websocket_endpoint(websocket: WebSocket, doc_id: str, db: Session = Depends(get_db)):
    await manager.connect(websocket, doc_id)
    try:
        while True:
            data = await websocket.receive_text()
            # Broadcast ciphertext to all other active connections for this document
            await manager.broadcast(data, doc_id, sender=websocket)
            
            # Persist latest encrypted payload to database
            doc = db.query(database.Document).filter(database.Document.id == doc_id).first()
            if doc:
                doc.encrypted_content = data
                db.commit()
    except WebSocketDisconnect:
        manager.disconnect(websocket, doc_id)