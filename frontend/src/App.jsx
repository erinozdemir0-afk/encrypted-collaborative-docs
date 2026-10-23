import React, { useEffect, useState, useRef } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Lock, ShieldCheck, Copy, Plus, FileText, Folder, Trash2 } from "lucide-react";
import {
  generateSymmetricKey,
  exportKeyToBase64,
  importKeyFromBase64,
  encryptMessage,
  decryptMessage,
} from "./utils/crypto";

export default function App() {
  const [documents, setDocuments] = useState([]);
  const [activeDocId, setActiveDocId] = useState(null);
  const [cryptoKey, setCryptoKey] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [lastRawPayload, setLastRawPayload] = useState("");
  const [copied, setCopied] = useState(false);
  const [newDocTitle, setNewDocTitle] = useState("");

  const wsRef = useRef(null);
  const isLocalUpdateRef = useRef(false);

  // Fetch all documents from REST API on mount
  const fetchDocuments = async () => {
    try {
      const res = await fetch("http://127.0.0.1:8000/api/documents");
      const data = await res.json();
      setDocuments(data);
      if (data.length > 0 && !activeDocId) {
        setActiveDocId(data[0].id);
      }
    } catch (err) {
      console.error("Failed to load documents:", err);
    }
  };

  useEffect(() => {
    fetchDocuments();
  }, []);

  // Handle document key generation/loading isolated per activeDocId
  useEffect(() => {
    if (!activeDocId) return;

    async function setupDocumentKey() {
      const hash = window.location.hash.replace("#", "");
      const storedKeyBase64 = localStorage.getItem(`doc_key_${activeDocId}`);
      let key;

      if (hash) {
        try {
          key = await importKeyFromBase64(hash);
          const base64 = await exportKeyToBase64(key);
          localStorage.setItem(`doc_key_${activeDocId}`, base64);
        } catch {
          key = await generateSymmetricKey();
          const base64 = await exportKeyToBase64(key);
          localStorage.setItem(`doc_key_${activeDocId}`, base64);
          window.location.hash = base64;
        }
      } else if (storedKeyBase64) {
        key = await importKeyFromBase64(storedKeyBase64);
        window.location.hash = storedKeyBase64;
      } else {
        key = await generateSymmetricKey();
        const base64 = await exportKeyToBase64(key);
        localStorage.setItem(`doc_key_${activeDocId}`, base64);
        window.location.hash = base64;
      }

      setCryptoKey(key);
    }

    setupDocumentKey();
  }, [activeDocId]);

  // TipTap Editor instance
  const editor = useEditor({
    extensions: [StarterKit],
    content: "<p>Select or create a document to begin editing...</p>",
    onUpdate: async ({ editor }) => {
      if (isLocalUpdateRef.current) {
        isLocalUpdateRef.current = false;
        return;
      }

      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && cryptoKey) {
        const html = editor.getHTML();
        const encryptedPayload = await encryptMessage(html, cryptoKey);
        setLastRawPayload(encryptedPayload);
        wsRef.current.send(encryptedPayload);
      }
    },
  });

  // Load document content & establish WebSocket connection
  useEffect(() => {
    if (!activeDocId || !cryptoKey || !editor) return;

    isLocalUpdateRef.current = true;
    editor.commands.setContent("<p>Loading encrypted content...</p>", false);
    setLastRawPayload("");

    async function loadInitialContent() {
      try {
        const res = await fetch(`http://127.0.0.1:8000/api/documents/${activeDocId}`);
        if (res.ok) {
          const docData = await res.json();
          if (docData.encrypted_content) {
            setLastRawPayload(docData.encrypted_content);
            const decryptedHtml = await decryptMessage(docData.encrypted_content, cryptoKey);
            isLocalUpdateRef.current = true;
            editor.commands.setContent(decryptedHtml, false);
          } else {
            isLocalUpdateRef.current = true;
            editor.commands.setContent("<p>Empty document. Start typing...</p>", false);
          }
        }
      } catch (err) {
        console.error("Failed to load document content:", err);
      }
    }

    loadInitialContent();

    if (wsRef.current) {
      wsRef.current.close();
    }

    const ws = new WebSocket(`ws://127.0.0.1:8000/ws/doc/${activeDocId}`);
    wsRef.current = ws;

    ws.onopen = () => setIsConnected(true);
    ws.onclose = () => setIsConnected(false);

    ws.onmessage = async (event) => {
      setLastRawPayload(event.data);
      try {
        const decryptedHtml = await decryptMessage(event.data, cryptoKey);
        isLocalUpdateRef.current = true;
        editor.commands.setContent(decryptedHtml, false);
      } catch (err) {
        console.error("Decryption failed:", err);
      }
    };

    return () => {
      ws.close();
    };
  }, [activeDocId, cryptoKey, editor]);

  // Create new document
  const handleCreateDocument = async (e) => {
    e.preventDefault();
    if (!newDocTitle.trim()) return;

    const id = `doc-${Date.now()}`;
    try {
      const res = await fetch("http://127.0.0.1:8000/api/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, title: newDocTitle }),
      });
      if (res.ok) {
        setNewDocTitle("");
        window.location.hash = "";
        await fetchDocuments();
        setActiveDocId(id);
      }
    } catch (err) {
      console.error("Failed to create document:", err);
    }
  };

  // Delete document
  const handleDeleteDocument = async (docId, e) => {
    e.stopPropagation(); // Prevent switching active document on delete click
    if (!confirm("Are you sure you want to permanently delete this document?")) return;

    try {
      const res = await fetch(`http://127.0.0.1:8000/api/documents/${docId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        localStorage.removeItem(`doc_key_${docId}`);
        const updatedDocs = documents.filter((d) => d.id !== docId);
        setDocuments(updatedDocs);

        if (activeDocId === docId) {
          if (updatedDocs.length > 0) {
            window.location.hash = "";
            setActiveDocId(updatedDocs[0].id);
          } else {
            setActiveDocId(null);
            setCryptoKey(null);
            setLastRawPayload("");
            if (editor) {
              isLocalUpdateRef.current = true;
              editor.commands.setContent("<p>No active document selected.</p>", false);
            }
          }
        }
      }
    } catch (err) {
      console.error("Failed to delete document:", err);
    }
  };

  const copyInviteLink = () => {
    navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex h-screen bg-slate-900 text-slate-100 overflow-hidden">
      {/* Sidebar - Document List */}
      <aside className="w-64 bg-slate-950 border-r border-slate-800 flex flex-col p-4 space-y-4">
        <div className="flex items-center space-x-2 text-indigo-400 font-bold text-lg border-b border-slate-800 pb-3">
          <Folder className="w-5 h-5" />
          <span>Workspaces</span>
        </div>

        {/* Create New Document Form */}
        <form onSubmit={handleCreateDocument} className="flex gap-2">
          <input
            type="text"
            placeholder="New Doc Title..."
            value={newDocTitle}
            onChange={(e) => setNewDocTitle(e.target.value)}
            className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
          />
          <button
            type="submit"
            className="bg-indigo-600 hover:bg-indigo-500 text-white p-2 rounded-lg transition"
          >
            <Plus className="w-4 h-4" />
          </button>
        </form>

        {/* List of Documents */}
        <div className="flex-1 overflow-y-auto space-y-1">
          {documents.map((doc) => (
            <div
              key={doc.id}
              onClick={() => {
                if (activeDocId === doc.id) return;
                window.location.hash = "";
                setActiveDocId(doc.id);
              }}
              className={`group w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs cursor-pointer transition ${
                activeDocId === doc.id
                  ? "bg-indigo-600/20 text-indigo-400 border border-indigo-500/30 font-medium"
                  : "text-slate-400 hover:bg-slate-900 hover:text-slate-200"
              }`}
            >
              <div className="flex items-center space-x-2 truncate">
                <FileText className="w-4 h-4 shrink-0" />
                <span className="truncate">{doc.title}</span>
              </div>
              <button
                onClick={(e) => handleDeleteDocument(doc.id, e)}
                className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-rose-400 p-1 rounded transition"
                title="Delete document"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      </aside>

      {/* Main Workspace Area */}
      <div className="flex-1 flex flex-col p-6 space-y-4 overflow-y-auto">
        {/* Header */}
        <header className="flex items-center justify-between bg-slate-800 p-4 rounded-xl border border-slate-700 shadow-md">
          <div className="flex items-center space-x-3">
            <ShieldCheck className="w-8 h-8 text-emerald-400" />
            <div>
              <h1 className="text-xl font-bold tracking-wide text-white">
                Zero-Trust Encrypted Workspace
              </h1>
              <p className="text-xs text-slate-400 font-mono">
                Active ID: <span className="text-slate-300">{activeDocId || "None"}</span>
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-3">
            <span
              className={`px-3 py-1 rounded-full text-xs font-semibold flex items-center gap-1.5 ${
                isConnected
                  ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                  : "bg-amber-500/10 text-amber-400 border border-amber-500/20"
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  isConnected ? "bg-emerald-400 animate-pulse" : "bg-amber-400"
                }`}
              />
              {isConnected ? "Live Relay Active" : "Connecting..."}
            </span>

            <button
              onClick={copyInviteLink}
              disabled={!activeDocId}
              className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-medium px-3 py-2 rounded-lg transition"
            >
              <Copy className="w-4 h-4" />
              {copied ? "Link Copied!" : "Share Encrypted Link"}
            </button>
          </div>
        </header>

        {/* Editor Canvas */}
        <main className="bg-slate-800 rounded-xl border border-slate-700 p-6 shadow-xl flex-1 flex flex-col">
          <div className="flex items-center justify-between mb-4 border-b border-slate-700 pb-3 text-xs text-slate-400">
            <span className="flex items-center gap-1.5 text-emerald-400 font-medium">
              <Lock className="w-4 h-4" /> Client-Side AES-256-GCM Active
            </span>
            <span>Cleartext is never transmitted to backend</span>
          </div>

          <EditorContent
            editor={editor}
            className="prose prose-invert max-w-none focus:outline-none flex-1 text-slate-200"
          />
        </main>

        {/* Security Telemetry */}
        <footer className="bg-slate-950 rounded-xl border border-slate-800 p-4 space-y-2 font-mono text-xs">
          <div className="text-slate-400 font-sans font-semibold flex items-center justify-between">
            <span>Live Security Inspection (What the DB/Server Sees)</span>
            <span className="text-indigo-400">WebSocket Transit Payload</span>
          </div>
          <div className="bg-slate-900 p-3 rounded-lg border border-slate-800 text-amber-300/90 break-all max-h-20 overflow-y-auto">
            {lastRawPayload || "// Waiting for text updates to capture payload..."}
          </div>
        </footer>
      </div>
    </div>
  );
}