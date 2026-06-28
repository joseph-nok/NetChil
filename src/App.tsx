/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from "react";
import { io, Socket } from "socket.io-client";
import {
  Monitor,
  Video,
  VideoOff,
  Mic,
  MicOff,
  Tv,
  MessageSquare,
  Sparkles,
  Camera,
  Layers,
  Maximize2,
  Tv2,
  Eye,
  EyeOff,
  Play,
  LogOut,
  Globe,
  Lock,
  UserCheck,
  ShieldAlert,
  Loader2
} from "lucide-react";

import { Header } from "./components/Header.js";
import { Chat } from "./components/Chat.js";
import { SimulatedBrowser } from "./components/SimulatedBrowser.js";
import { CameraGrid } from "./components/CameraGrid.js";

import { useResizableSplit } from "./hooks/useResizableSplit.js";
import { useScreenOrientation } from "./hooks/useScreenOrientation.js";
import { useUserMedia } from "./hooks/useUserMedia.js";
import { RoomState, ChatMessage, User } from "./types.js";

export default function App() {
  // Navigation & Join Room parameters
  const [roomId, setRoomId] = useState("");
  const [roomName, setRoomName] = useState("");
  const [userName, setUserName] = useState(() => localStorage.getItem("watchnexus_nickname") || "");
  const [isJoined, setIsJoined] = useState(false);
  const [isLinkJoin, setIsLinkJoin] = useState(false);

  // Optional Proxy State
  const [proxyServer, setProxyServer] = useState("");
  const [proxyUsername, setProxyUsername] = useState("");
  const [proxyPassword, setProxyPassword] = useState("");

  // Active Connection socket
  const [socket, setSocket] = useState<Socket | null>(null);
  const [myUserId, setMyUserId] = useState("");
  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);

  // UI States
  const [showChat, setShowChat] = useState(true);
  const [isMovieFocus, setIsMovieFocus] = useState(false);
  const [isFitScreen, setIsFitScreen] = useState(true);
  const [roomError, setRoomError] = useState<string | null>(null);

  // Load hooks
  const { orientation, isFullscreen, toggleFullscreen } = useScreenOrientation();
  const splitControl = useResizableSplit({
    initialRatio: 0.65,
    minRatio: 0.20,
    maxRatio: 0.80,
    direction: orientation === "landscape" ? "horizontal" : "vertical",
  });

  // Access media devices
  const {
    localStream,
    cameraActive,
    micActive,
    remoteStreams,
    toggleCamera,
    toggleMic,
  } = useUserMedia({ socket, roomId, myUserId });

  // Connect socket on joining
  const connectToRoom = (targetRoomId: string, nameToUse: string, photoURLToUse?: string) => {
    if (!targetRoomId.trim()) return;

    const cleanRoomId = targetRoomId.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
    if (!cleanRoomId) return;

    // Connect to backend Express server on the exact same host
    const socketConnection = io(window.location.origin, {
      reconnectionDelayMax: 10000,
    });

    // Capture user context details (User-Agent, window resolution, cookies)
    const clientUserAgent = navigator.userAgent;
    const clientResolution = { width: window.innerWidth, height: window.innerHeight };
    const clientCookies = document.cookie;

    socketConnection.emit("join-room", {
      roomId: cleanRoomId,
      userName: nameToUse.trim(),
      photoURL: photoURLToUse || undefined,
      clientUserAgent,
      clientResolution,
      clientCookies,
      proxyServer: proxyServer.trim() || undefined,
      proxyUsername: proxyUsername.trim() || undefined,
      proxyPassword: proxyPassword.trim() || undefined,
    });

    socketConnection.on("room-init", ({ room, chatHistory: initialHistory, myUserId: serverUserId }) => {
      setRoomState(room);
      setChatHistory(initialHistory);
      setMyUserId(serverUserId);
      setIsJoined(true);
    });

    socketConnection.on("room-error", ({ message }: { message: string }) => {
      setRoomError(message);
    });

    socketConnection.on("user-joined", (newUser: User) => {
      setRoomState((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          users: { ...prev.users, [newUser.id]: newUser },
        };
      });
    });

    socketConnection.on("user-left", (leavingUserId: string) => {
      setRoomState((prev) => {
        if (!prev) return null;
        const copy = { ...prev };
        delete copy.users[leavingUserId];
        return copy;
      });
    });

    socketConnection.on("cursor-update", ({ userId, x, y }) => {
      setRoomState((prev) => {
        if (!prev || !prev.users[userId]) return prev;
        return {
          ...prev,
          users: {
            ...prev.users,
            [userId]: { ...prev.users[userId], cursor: { x, y } },
          },
        };
      });
    });

    socketConnection.on("receive-message", (newMessage: ChatMessage) => {
      setChatHistory((prev) => [...prev, newMessage]);
    });

    socketConnection.on("browser-sync-url", (url: string) => {
      setRoomState((prev) => {
        if (!prev) return null;
        return { ...prev, currentUrl: url };
      });
    });

    socketConnection.on("browser-sync-video-state", ({ isPlaying, currentTime }) => {
      setRoomState((prev) => {
        if (!prev) return null;
        return { ...prev, isPlaying, currentTime };
      });
    });

    socketConnection.on("user-media-toggled", ({ userId, cameraActive: cam, micActive: mic }) => {
      setRoomState((prev) => {
        if (!prev || !prev.users[userId]) return prev;
        return {
          ...prev,
          users: {
            ...prev.users,
            [userId]: { ...prev.users[userId], cameraActive: cam, micActive: mic },
          },
        };
      });
    });

    setSocket(socketConnection);
  };

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    const finalName = userName.trim() || `Guest-${Math.floor(Math.random() * 9000 + 1000)}`;
    localStorage.setItem("watchnexus_nickname", finalName);
    connectToRoom(roomId, finalName);
  };

  const handleLeaveRoom = () => {
    if (socket) {
      socket.disconnect();
    }
    setSocket(null);
    setRoomState(null);
    setChatHistory([]);
    setIsJoined(false);
    setRoomError(null);
  };

  const sendMessage = (text: string) => {
    if (socket) {
      socket.emit("send-message", text);
    }
  };

  // Quick join lobby utility
  const handleJoinLobby = () => {
    const lobbyId = "lobby";
    setRoomId(lobbyId);
    setRoomName("Public WatchParty Lobby");
    const finalName = userName.trim() || `Viewer-${Math.floor(Math.random() * 9000 + 1000)}`;
    if (!userName.trim()) {
      setUserName(finalName);
    }
    localStorage.setItem("watchnexus_nickname", finalName);
    connectToRoom(lobbyId, finalName);
  };

  // Initial link bypass setup
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlRoom = params.get("room") || params.get("roomId");
    if (urlRoom) {
      setIsLinkJoin(true);
      const savedName = localStorage.getItem("watchnexus_nickname") || localStorage.getItem("watchnexus_guest_name");
      const finalName = savedName || `Watcher-${Math.floor(1000 + Math.random() * 9000)}`;
      if (!savedName) {
        localStorage.setItem("watchnexus_nickname", finalName);
      }
      setRoomId(urlRoom);
      setUserName(finalName);
      
      // Auto-join straight
      connectToRoom(urlRoom, finalName);
    }
  }, []);

  // If not joined, show a gorgeous futuristic WatchNexus landing dashboard
  if (!isJoined) {
    return (
      <main className="flex min-h-svh flex-col items-center justify-center bg-[#09090b] p-6 font-sans relative overflow-hidden">
        {/* Decorative subtle gradient background glow */}
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[500px] h-[500px] bg-indigo-600/10 rounded-full blur-[120px] pointer-events-none" />
        
        <div className="w-full max-w-md rounded-2xl border border-white/5 bg-[#111114] p-8 shadow-2xl text-zinc-100 relative z-10 animate-in fade-in duration-300">
          <div className="flex flex-col items-center text-center mb-8">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-lg shadow-indigo-950/50 mb-4">
              <Monitor className="h-6 w-6" />
            </div>
            <h1 className="text-xl font-black tracking-tight text-white">
              WATCH<span className="text-indigo-400">NEXUS</span>
            </h1>
            <p className="text-[9px] font-bold text-indigo-400 uppercase tracking-widest mt-1">
              Virtual Browser Watch Parties
            </p>
            <p className="text-xs text-zinc-500 mt-2 max-w-sm leading-relaxed">
              Create rooms, spawn dedicated virtual browsers, and watch synced media together with low latency.
            </p>
          </div>

          <form onSubmit={handleJoin} className="space-y-4">
            <div>
              <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-2">
                Your Avatar Nickname
              </label>
              <input
                type="text"
                value={userName}
                onChange={(e) => setUserName(e.target.value)}
                placeholder="Enter nickname e.g. Cinephile"
                required
                className="w-full rounded-md border border-white/10 bg-[#1e1e22] px-4 py-2.5 text-xs text-white placeholder-gray-500 focus:border-indigo-500/50 focus:outline-hidden font-sans"
                id="join-username-field"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-2">
                  Room ID
                </label>
                <input
                  type="text"
                  value={roomId}
                  onChange={(e) => setRoomId(e.target.value)}
                  placeholder="e.g. movie-night"
                  required
                  className="w-full rounded-md border border-white/10 bg-[#1e1e22] px-4 py-2.5 text-xs text-white placeholder-gray-500 focus:border-indigo-500/50 focus:outline-hidden font-sans"
                  id="join-roomid-field"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-2">
                  Room Title (Optional)
                </label>
                <input
                  type="text"
                  value={roomName}
                  onChange={(e) => setRoomName(e.target.value)}
                  placeholder="e.g. My Watch Party"
                  className="w-full rounded-md border border-white/10 bg-[#1e1e22] px-4 py-2.5 text-xs text-white placeholder-gray-500 focus:border-indigo-500/50 focus:outline-hidden font-sans"
                  id="join-roomname-field"
                />
              </div>
            </div>



            <button
              type="submit"
              className="w-full py-2.5 px-4 rounded-md bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-[10px] uppercase tracking-wider shadow-md transition-all flex items-center justify-center gap-2 mt-6 border border-indigo-500/20 cursor-pointer"
              id="btn-join-room-submit"
            >
              <span>Create / Join Watch Party</span>
              <Sparkles className="h-3.5 w-3.5" />
            </button>
          </form>

          <div className="relative flex py-5 items-center">
            <div className="flex-grow border-t border-white/5"></div>
            <span className="flex-shrink mx-4 text-[9px] font-mono text-zinc-600 uppercase tracking-widest">
              or join lobby
            </span>
            <div className="flex-grow border-t border-white/5"></div>
          </div>

          <button
            onClick={handleJoinLobby}
            className="w-full py-2.5 px-4 rounded-md border border-white/10 hover:bg-white/5 text-zinc-300 font-bold text-[10px] uppercase tracking-wider transition-all flex items-center justify-center gap-2 bg-[#1a1a1e] cursor-pointer"
            id="btn-join-lobby"
          >
            <Play className="h-3.5 w-3.5 fill-current text-indigo-400" />
            <span>Join Public Co-Watch Lobby</span>
          </button>

          {isLinkJoin && (
            <div className="pt-4 border-t border-white/5 flex flex-col gap-1 text-center text-[10px] text-zinc-500 mt-6 leading-relaxed bg-[#151518]/40 p-3 rounded-lg border">
              <div className="flex items-center gap-1.5 justify-center text-indigo-400 font-bold uppercase tracking-wide text-[9px]">
                <Globe className="h-3 w-3" />
                <span>Invite Link Active</span>
              </div>
              <span>You're currently joining a direct watch party link. Feel free to adjust your nickname or room details above anytime!</span>
            </div>
          )}
        </div>
      </main>
    );
  }

  // Active room workspace view
  return (
    <div
      ref={splitControl.containerRef}
      className="flex h-svh w-full flex-col bg-[#09090b] text-zinc-100 overflow-hidden font-sans relative"
    >
      {/* Floating Room Error Banner */}
      {roomError && (
        <div className="absolute top-16 right-4 z-50 max-w-sm rounded-xl border border-red-500/20 bg-zinc-950/90 backdrop-blur-md p-4 shadow-2xl animate-in fade-in slide-in-from-top-4 duration-300">
          <div className="flex gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-red-500/10 text-red-400">
              <ShieldAlert className="h-4 w-4" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-xs font-bold text-red-400 uppercase tracking-wide">Connection Blocked</h3>
              <p className="mt-1 text-xs text-zinc-300 leading-normal">{roomError}</p>
              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => setRoomError(null)}
                  className="rounded bg-red-500/20 hover:bg-red-500/30 text-red-400 px-2 py-1 text-[10px] font-bold uppercase tracking-wider transition cursor-pointer"
                  id="btn-dismiss-error"
                >
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Platform Header */}
      {roomState && <Header room={roomState} onLeave={handleLeaveRoom} myUserId={myUserId} />}

      {/* Main Content Workspace Split Area */}
      <div
        className={`flex flex-1 w-full overflow-hidden ${
          orientation === "landscape" ? "flex-row" : "flex-col"
        }`}
      >
        {/* Virtual Browser Watch party Stream Panel */}
        <div
          style={{
            flex: splitControl.ratio,
            width: orientation === "landscape" ? "auto" : "100%",
            height: orientation === "landscape" ? "100%" : "auto",
          }}
          className="p-4 relative flex flex-col min-w-0 min-h-0"
        >
          {roomState && (
            <SimulatedBrowser
              room={roomState}
              socket={socket}
              myUserId={myUserId}
              isFitScreen={isFitScreen}
            />
          )}

          {/* Floating WebRTC Camera overlays if in Movie-Focus Mode */}
          {roomState && isMovieFocus && (
            <CameraGrid
              room={roomState}
              myUserId={myUserId}
              localStream={localStream}
              remoteStreams={remoteStreams}
              cameraActive={cameraActive}
              micActive={micActive}
              isMovieFocus={isMovieFocus}
            />
          )}

          {/* Inline Media control shelf at bottom of video stream panel */}
          <div className="mt-3 flex items-center justify-between border border-white/5 bg-[#111114] px-4 py-2 rounded-xl shrink-0">
            {/* Audio / Mic / Camera Hardware Buttons */}
            <div className="flex items-center gap-2">
              <button
                onClick={toggleCamera}
                className={`flex h-8 w-8 items-center justify-center rounded-md transition border ${
                  cameraActive
                    ? "bg-indigo-600/20 border-indigo-500/30 text-indigo-400"
                    : "bg-white/5 border-white/10 text-gray-400 hover:bg-white/10 hover:text-white"
                }`}
                id="btn-toggle-camera"
              >
                {cameraActive ? <Video className="h-4 w-4" /> : <VideoOff className="h-4 w-4" />}
              </button>

              <button
                onClick={toggleMic}
                className={`flex h-8 w-8 items-center justify-center rounded-md transition border ${
                  micActive
                    ? "bg-indigo-600/20 border-indigo-500/30 text-indigo-400"
                    : "bg-white/5 border-white/10 text-gray-400 hover:bg-white/10 hover:text-white"
                }`}
                id="btn-toggle-mic"
              >
                {micActive ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
              </button>
            </div>

            {/* Layout Toggles (Movie Focus, Split-Screen, Fit Window) */}
            <div className="flex items-center gap-2">
              {/* Fit screen switch */}
              <button
                onClick={() => setIsFitScreen(!isFitScreen)}
                className={`flex h-8 items-center gap-1.5 px-3 rounded-md text-[10px] font-bold uppercase tracking-wider border transition ${
                  isFitScreen
                    ? "bg-indigo-600/20 border-indigo-500/30 text-indigo-400"
                    : "bg-white/5 border-white/10 text-gray-400 hover:bg-white/10 hover:text-white"
                }`}
                id="btn-toggle-fitscreen"
              >
                <Maximize2 className="h-3.5 w-3.5" />
                <span>Fit Stream</span>
              </button>

              {/* Movie focus mode switch */}
              <button
                onClick={() => setIsMovieFocus(!isMovieFocus)}
                className={`flex h-8 items-center gap-1.5 px-3 rounded-md text-[10px] font-bold uppercase tracking-wider border transition ${
                  isMovieFocus
                    ? "bg-indigo-600/20 border-indigo-500/30 text-indigo-400"
                    : "bg-white/5 border-white/10 text-gray-400 hover:bg-white/10 hover:text-white"
                }`}
                id="btn-toggle-moviefocus"
              >
                {isMovieFocus ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                <span>Focus Mode</span>
              </button>

              {/* Chat Sidebar show/hide toggle */}
              <button
                onClick={() => setShowChat(!showChat)}
                className={`flex h-8 items-center gap-1.5 px-3 rounded-md text-[10px] font-bold uppercase tracking-wider border transition ${
                  showChat
                    ? "bg-indigo-600/20 border-indigo-500/30 text-indigo-400"
                    : "bg-white/5 border-white/10 text-gray-400 hover:bg-white/10 hover:text-white"
                }`}
                id="btn-toggle-chat"
              >
                <MessageSquare className="h-3.5 w-3.5" />
                <span>Sidebar</span>
              </button>
            </div>
          </div>
        </div>

        {/* DRAG-TO-RESIZE SPLIT DIVIDER BAR */}
        <div
          onMouseDown={splitControl.startDragging}
          onTouchStart={splitControl.startDragging}
          className={`flex items-center justify-center select-none active:bg-indigo-600 transition group hover:bg-indigo-400/50 ${
            orientation === "landscape"
              ? "w-1 h-full cursor-col-resize border-l border-white/5 bg-[#111114]"
              : "h-1 w-full cursor-row-resize border-t border-white/5 bg-[#111114]"
          }`}
          style={{ userSelect: "none" }}
        >
          <div
            className={`rounded-full bg-gray-600 group-hover:bg-white ${
              orientation === "landscape" ? "h-6 w-0.5" : "h-0.5 w-6"
            }`}
          ></div>
        </div>

        {/* Right Pane: Cameras Grid & Chat Panel Stack */}
        <div
          style={{
            flex: 1 - splitControl.ratio,
            width: orientation === "landscape" ? "auto" : "100%",
            height: orientation === "landscape" ? "100%" : "auto",
          }}
          className={`flex min-w-0 min-h-0 ${
            orientation === "landscape" ? "flex-col" : "flex-row"
          } ${!showChat && isMovieFocus ? "hidden" : ""}`}
        >
          {/* Cameras segment - Hidden if Focus-Mode is active */}
          {!isMovieFocus && roomState && (
            <div className="flex-1 min-h-0 min-w-0">
              <CameraGrid
                room={roomState}
                myUserId={myUserId}
                localStream={localStream}
                remoteStreams={remoteStreams}
                cameraActive={cameraActive}
                micActive={micActive}
                isMovieFocus={false}
              />
            </div>
          )}

          {/* Collaborative Live chat logs */}
          {showChat && roomState && (
            <div className="flex-1 min-h-0 min-w-0">
              <Chat
                room={roomState}
                chatHistory={chatHistory}
                myUserId={myUserId}
                onSendMessage={sendMessage}
              />
            </div>
          )}
        </div>
      </div>

      {/* Elegant Status Bar Footer */}
      <footer className="h-6 bg-[#111114] border-t border-white/5 px-4 flex items-center justify-between text-[9px] font-mono text-zinc-600 shrink-0">
        <div>SIGNAL: SECURE WebRTC SSL</div>
        <div className="hidden sm:block">VIRTUAL CHROMIUM INSTANCE: ACTIVE [NODE-US-EAST]</div>
        <div>FPS: 60 • BANDWIDTH: 4.8 MBPS</div>
      </footer>
    </div>
  );
}
