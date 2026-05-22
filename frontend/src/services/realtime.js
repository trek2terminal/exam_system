import { io } from "socket.io-client";

export function createRealtimeSocket() {
  return io("/", {
    path: "/socket.io",
    transports: ["websocket", "polling"],
    withCredentials: true,
    autoConnect: false,
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 800
  });
}
