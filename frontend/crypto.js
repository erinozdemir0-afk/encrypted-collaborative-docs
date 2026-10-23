/**
 * Web Crypto API Utility for Client-Side AES-GCM Encryption
 */

// Generate a new 256-bit AES-GCM key
export async function generateSymmetricKey() {
  return await window.crypto.subtle.generateKey(
    {
      name: "AES-GCM",
      length: 256,
    },
    true, // extractable
    ["encrypt", "decrypt"]
  );
}

// Export a CryptoKey object into a raw Base64 string (to share via URL hash/invite)
export async function exportKeyToBase64(key) {
  const exported = await window.crypto.subtle.exportKey("raw", key);
  const exportedBuffer = new Uint8Array(exported);
  return btoa(String.fromCharCode(...exportedBuffer));
}

// Import a CryptoKey from a Base64 string
export async function importKeyFromBase64(base64Key) {
  const rawString = atob(base64Key);
  const keyBuffer = new Uint8Array(rawString.length);
  for (let i = 0; i < rawString.length; i++) {
    keyBuffer[i] = rawString.charCodeAt(i);
  }
  return await window.crypto.subtle.importKey(
    "raw",
    keyBuffer,
    { name: "AES-GCM" },
    true,
    ["encrypt", "decrypt"]
  );
}

/**
 * Encrypts a plaintext string.
 * Returns a JSON payload containing Base64 encoded IV and Ciphertext.
 */
export async function encryptMessage(plaintext, key) {
  const encoder = new TextEncoder();
  const encodedData = encoder.encode(plaintext);

  // AES-GCM requires a unique Initialization Vector (IV) per message (12 bytes)
  const iv = window.crypto.getRandomValues(new Uint8Array(12));

  const ciphertext = await window.crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: iv,
    },
    key,
    encodedData
  );

  // Convert binary IV and Ciphertext to Base64 for transport over WebSocket JSON
  const ivBase64 = btoa(String.fromCharCode(...iv));
  const ciphertextBase64 = btoa(
    String.fromCharCode(...new Uint8Array(ciphertext))
  );

  return JSON.stringify({
    iv: ivBase64,
    data: ciphertextBase64,
  });
}

/**
 * Decrypts a JSON payload containing Base64 IV and Ciphertext back into plaintext.
 */
export async function decryptMessage(encryptedPayloadJson, key) {
  const { iv, data } = JSON.parse(encryptedPayloadJson);

  // Convert Base64 back to Uint8Arrays
  const ivArray = new Uint8Array(
    atob(iv).split("").map((char) => char.charCodeAt(0))
  );
  const ciphertextArray = new Uint8Array(
    atob(data).split("").map((char) => char.charCodeAt(0))
  );

  const decryptedBuffer = await window.crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: ivArray,
    },
    key,
    ciphertextArray
  );

  const decoder = new TextDecoder();
  return decoder.decode(decryptedBuffer);
}