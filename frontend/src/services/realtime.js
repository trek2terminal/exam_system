import { io } from "socket.io-client";

export function createRealtimeSocket() {
  return io("/", {
    path: "/socket.io",
    // Werkzeug's development WSGI server can throw "write() before start_response"
    // on websocket upgrade/cancel paths. Polling keeps realtime stable in dev.
    transports: ["polling"],
    withCredentials: true,
    autoConnect: false,
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 800
  });
}
