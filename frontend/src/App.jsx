import React, { useEffect, useState, useRef } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Lock, Unlock, ShieldCheck, Copy, RefreshCw } from "lucide-react";
import {
  generateSymmetricKey,
  exportKeyToBase64,
  importKeyFromBase64,
  encryptMessage,
  decryptMessage,
} from "./utils/crypto";

export default function App() {
  const [docId] = useState("doc-demo-123");
  const [cryptoKey, setCryptoKey] = useState(null);
  const [keyBase64, setKeyBase64] = useState("");
  const [isConnected, setIsConnected] = useState(false);
  const [lastRawPayload, setLastRawPayload] = useState("");
  const [copied, setCopied] = useState(false);

  const wsRef = useRef(null);
  const isLocalUpdateRef = useRef(false);

  // Initialize or load key on startup
  useEffect(() => {
    async function initKey() {
      const hash = window.location.hash.replace("#", "");
      let key;
      if (hash) {
        key = await importKeyFromBase64(hash);
      } else {
        key = await generateSymmetricKey();
        const base64 = await exportKeyToBase64(key);
        window.location.hash = base64;
      }
      setCryptoKey(key);
      const b64 = await exportKeyToBase64(key);
      setKeyBase64(b64);
    }
    initKey();
  }, []);

  // Initialize TipTap Editor
  const editor = useEditor({
    extensions: [StarterKit],
    content: "<p>Start typing confidential document contents...</p>",
    onUpdate: async ({ editor }) => {
      // Prevent echoing remote changes back to server
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

  // Connect to WebSocket Relay Server
  useEffect(() => {
    if (!cryptoKey) return;

    const ws = new WebSocket(`ws://127.0.0.1:8000/ws/doc/${docId}`);
    wsRef.current = ws;

    ws.onopen = () => setIsConnected(true);
    ws.onclose = () => setIsConnected(false);

    ws.onmessage = async (event) => {
      setLastRawPayload(event.data);
      try {
        const decryptedHtml = await decryptMessage(event.data, cryptoKey);
        if (editor) {
          isLocalUpdateRef.current = true;
          editor.commands.setContent(decryptedHtml, false);
        }
      } catch (err) {
        console.error("Decryption failed (Key mismatch or corrupted payload)", err);
      }
    };

    return () => ws.close();
  }, [cryptoKey, editor, docId]);

  const copyInviteLink = () => {
    navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      {/* Header & Status Banner */}
      <header className="flex items-center justify-between bg-slate-800 p-4 rounded-xl border border-slate-700 shadow-md">
        <div className="flex items-center space-x-3">
          <ShieldCheck className="w-8 h-8 text-emerald-400" />
          <div>
            <h1 className="text-xl font-bold tracking-wide text-white">
              Zero-Trust Encrypted Workspace
            </h1>
            <p className="text-xs text-slate-400">
              Doc ID: <span className="font-mono text-slate-300">{docId}</span>
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
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium px-3 py-2 rounded-lg transition"
          >
            <Copy className="w-4 h-4" />
            {copied ? "Link Copied!" : "Share Encrypted Link"}
          </button>
        </div>
      </header>

      {/* Editor Main Canvas */}
      <main className="bg-slate-800 rounded-xl border border-slate-700 p-6 shadow-xl min-h-[300px]">
        <div className="flex items-center justify-between mb-4 border-b border-slate-700 pb-3 text-xs text-slate-400">
          <span className="flex items-center gap-1.5 text-emerald-400 font-medium">
            <Lock className="w-4 h-4" /> Client-Side AES-256-GCM Active
          </span>
          <span>Cleartext is never transmitted to backend</span>
        </div>

        <EditorContent
          editor={editor}
          className="prose prose-invert max-w-none focus:outline-none min-h-[220px] text-slate-200"
        />
      </main>

      {/* Security Telemetry & Inspection Box */}
      <footer className="bg-slate-950 rounded-xl border border-slate-800 p-4 space-y-3 font-mono text-xs">
        <div className="text-slate-400 font-sans font-semibold flex items-center justify-between">
          <span>Live Security Inspection (What the Server/Hacker Sees)</span>
          <span className="text-indigo-400">WebSocket Transit Payload</span>
        </div>
        <div className="bg-slate-900 p-3 rounded-lg border border-slate-800 text-amber-300/90 break-all max-h-24 overflow-y-auto">
          {lastRawPayload || "// Waiting for text updates to capture payload..."}
        </div>
      </footer>
    </div>
  );
}