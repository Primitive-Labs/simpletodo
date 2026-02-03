// Browser stub for Node.js 'ws' module
// The js-bao-wss-client should use native WebSocket in browsers
// This stub prevents import errors when the library tries to conditionally import 'ws'

export default class WebSocketStub {
  constructor() {
    throw new Error(
      "ws module not available in browser - use native WebSocket instead"
    );
  }
}

// Export named exports that might be expected
export const WebSocket = WebSocketStub;
export const WebSocketServer = WebSocketStub;
