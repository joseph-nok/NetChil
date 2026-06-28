/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useState, useEffect } from "react";
import { Play, Pause, RotateCcw, RotateCw, Volume2, Globe, ArrowRight, Video, Navigation, Home, Search } from "lucide-react";
import { RoomState, User } from "../types";
import { Socket } from "socket.io-client";

interface SimulatedBrowserProps {
  room: RoomState;
  socket: Socket | null;
  myUserId: string;
  isFitScreen: boolean;
}

export function SimulatedBrowser({ room, socket, myUserId, isFitScreen }: SimulatedBrowserProps) {
  const [addressInput, setAddressInput] = useState(room.currentUrl);
  const [browserError, setBrowserError] = useState<string | null>(null);
  const [frameSrc, setFrameSrc] = useState<string>("");
  const [isCaptchaRequired, setIsCaptchaRequired] = useState(false);
  const [isCanvasFocused, setIsCanvasFocused] = useState(false);
  const [isLoadingFrame, setIsLoadingFrame] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Sync addressInput if room URL changes remotely
  useEffect(() => {
    setAddressInput(room.currentUrl);
    setBrowserError(null); // Clear error on successful navigation sync
    setIsLoadingFrame(true);
  }, [room.currentUrl]);

  // Listen for browser-error and canvas frame streaming from socket
  useEffect(() => {
    if (!socket) return;

    const handleBrowserError = ({ message }: { message: string }) => {
      setBrowserError(message);
      setIsLoadingFrame(false);
    };

    const handleBrowserFrame = (frameData: string) => {
      setFrameSrc(frameData);
      setIsCaptchaRequired(false);
      setIsLoadingFrame(false);
    };

    const handleCaptchaRequired = () => {
      setIsCaptchaRequired(true);
      setIsLoadingFrame(false);
    };

    socket.on("browser-error", handleBrowserError);
    socket.on("browser-frame", handleBrowserFrame);
    socket.on("captcha-required", handleCaptchaRequired);

    return () => {
      socket.off("browser-error", handleBrowserError);
      socket.off("browser-frame", handleBrowserFrame);
      socket.off("captcha-required", handleCaptchaRequired);
    };
  }, [socket]);

  // Redraw the canvas whenever frameSrc changes
  useEffect(() => {
    if (!frameSrc || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const img = new Image();
    img.onload = () => {
      canvas.width = img.naturalWidth || 1280;
      canvas.height = img.naturalHeight || 720;
      ctx.drawImage(img, 0, 0);
    };
    img.src = frameSrc;
  }, [frameSrc]);

  // Handle canvas click event and emit to Puppeteer backend
  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!socket || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    socket.emit("browser-click", { x, y });
    canvasRef.current.focus();
  };

  // Handle canvas scroll/wheel event and emit to Puppeteer backend
  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    if (!socket) return;
    socket.emit("browser-scroll", { deltaY: e.deltaY });
  };

  // Handle keyboard event when focused on the canvas and emit to Puppeteer backend
  const handleKeyDown = (e: React.KeyboardEvent<HTMLCanvasElement>) => {
    if (!socket) return;
    const keysToBlock = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space", "Tab", "Backspace", "Enter"];
    if (keysToBlock.includes(e.key)) {
      e.preventDefault();
    }
    socket.emit("browser-key", { key: e.key });
  };

  // Trigger manual page refresh
  const handleRefresh = () => {
    if (!socket) return;
    setIsLoadingFrame(true);
    socket.emit("browser-reload");
  };

  // Handle URL change submission
  const handleUrlSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!addressInput.trim() || !socket) return;
    
    let targetUrl = addressInput.trim();
    // Convert watch links to embed links if YouTube to bypass frame blocks
    if (targetUrl.includes("youtube.com/watch?v=")) {
      const videoId = targetUrl.split("v=")[1]?.split("&")[0];
      if (videoId) {
        targetUrl = `https://www.youtube.com/embed/${videoId}`;
      }
    } else if (targetUrl.includes("youtu.be/")) {
      const videoId = targetUrl.split("youtu.be/")[1]?.split("?")[0];
      if (videoId) {
        targetUrl = `https://www.youtube.com/embed/${videoId}`;
      }
    }

    setIsLoadingFrame(true);
    socket.emit("navigate-browser", targetUrl);
  };

  // Custom Play/Pause toggler
  const togglePlay = () => {
    if (!socket) return;
    const nextPlayingState = !room.isPlaying;
    const currentElapsedTime = videoRef.current?.currentTime || room.currentTime;
    
    socket.emit("browser-video-state", {
      isPlaying: nextPlayingState,
      currentTime: currentElapsedTime,
    });
  };

  // Track cursor movement coordinates and emit
  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!socket || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    socket.emit("cursor-move", { x, y });
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (!socket || !containerRef.current || e.touches.length === 0) return;
    const rect = containerRef.current.getBoundingClientRect();
    const touch = e.touches[0];
    const x = (touch.clientX - rect.left) / rect.width;
    const y = (touch.clientY - rect.top) / rect.height;
    socket.emit("cursor-move", { x, y });
  };

  // Check if current URL is a embeddable video format or YouTube
  const isYoutube = room.currentUrl.includes("youtube.com") || room.currentUrl.includes("youtu.be");
  const isDirectVideo = room.currentUrl.endsWith(".mp4") || room.currentUrl.endsWith(".webm") || room.currentUrl.endsWith(".m3u8");

  // Sync actual HTML5 video element state with RoomState
  useEffect(() => {
    if (!videoRef.current || !isDirectVideo) return;
    
    if (room.isPlaying) {
      videoRef.current.play().catch(() => {});
    } else {
      videoRef.current.pause();
    }

    if (Math.abs(videoRef.current.currentTime - room.currentTime) > 1.5) {
      videoRef.current.currentTime = room.currentTime;
    }
  }, [room.isPlaying, room.currentTime, isDirectVideo]);

  // Handle local video playback events and emit to server to sync others
  const handleVideoPlay = () => {
    if (socket && !room.isPlaying && videoRef.current) {
      socket.emit("browser-video-state", {
        isPlaying: true,
        currentTime: videoRef.current.currentTime,
      });
    }
  };

  const handleVideoPause = () => {
    if (socket && room.isPlaying && videoRef.current) {
      socket.emit("browser-video-state", {
        isPlaying: false,
        currentTime: videoRef.current.currentTime,
      });
    }
  };

  const handleVideoTimeUpdate = () => {
    if (socket && room.isPlaying && videoRef.current) {
      // Throttle sync triggers to prevent infinite feedback loops
      if (Math.floor(videoRef.current.currentTime) % 5 === 0) {
        socket.emit("browser-video-state", {
          isPlaying: true,
          currentTime: videoRef.current.currentTime,
        });
      }
    }
  };

  return (
    <div className="flex h-full flex-col bg-zinc-900 dark:bg-[#09090b] rounded-xl overflow-hidden border border-white/5 shadow-2xl relative">
      {/* Top Browser Bar */}
      <div className="flex h-12 items-center bg-[#111114] px-4 border-b border-white/5 gap-3 shrink-0">
        <div className="flex items-center gap-1.5 shrink-0">
          <div className="h-2.5 w-2.5 rounded-full bg-rose-500/80"></div>
          <div className="h-2.5 w-2.5 rounded-full bg-amber-500/80"></div>
          <div className="h-2.5 w-2.5 rounded-full bg-emerald-500/80"></div>
        </div>

        {/* Navigation Buttons & Address Bar */}
        <button
          type="button"
          onClick={() => socket?.emit("navigate-browser", "https://net11.cc/home?utm_source=home_page")}
          className="text-zinc-400 hover:text-white transition p-1.5 rounded-lg hover:bg-white/5 cursor-pointer shrink-0"
          title="Go to Default Mirror Home (net11.cc)"
          id="btn-browser-home"
        >
          <Home className="h-4.5 w-4.5" />
        </button>

        <button
          type="button"
          onClick={handleRefresh}
          className="text-zinc-400 hover:text-white transition p-1.5 rounded-lg hover:bg-white/5 cursor-pointer shrink-0"
          title="Refresh Browser"
          id="btn-browser-refresh"
        >
          <RotateCw className="h-4.5 w-4.5" />
        </button>
 
        {/* Address Bar */}
        <form onSubmit={handleUrlSubmit} className="flex-1 flex items-center relative">
          <Globe className="absolute left-3 h-3.5 w-3.5 text-zinc-500" />
          <input
            type="text"
            value={addressInput}
            onChange={(e) => setAddressInput(e.target.value)}
            placeholder="Search web or enter video URL (e.g. net11.cc mirror)"
            className="w-full bg-[#1e1e22] border border-white/10 text-xs text-zinc-300 rounded-md pl-9 pr-10 py-1.5 focus:outline-hidden focus:border-indigo-500/50"
            id="browser-address-bar"
          />
          <button type="submit" className="absolute right-2 text-zinc-500 hover:text-zinc-300 transition-colors">
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </form>
      </div>

      {/* Friendly load warning overlay */}
      {browserError && (
        <div className="bg-rose-500/90 backdrop-blur-md text-white text-xs px-4 py-2.5 flex items-center justify-between border-b border-rose-600/40 z-50 animate-in duration-200">
          <div className="flex items-center gap-2">
            <span className="font-semibold">⚠️ Alert:</span>
            <span>{browserError}</span>
          </div>
          <button
            onClick={() => setBrowserError(null)}
            className="text-white/80 hover:text-white font-bold ml-2 cursor-pointer text-sm focus:outline-hidden"
          >
            ✕
          </button>
        </div>
      )}
 
      {/* Browser Screen Content Area */}
      <div
        ref={containerRef}
        onMouseMove={handleMouseMove}
        onTouchMove={handleTouchMove}
        className="flex-1 w-full bg-[#050505] relative overflow-hidden select-none"
      >
        {isYoutube ? (
          <iframe
            src={`${room.currentUrl}?autoplay=1&mute=1&enablejsapi=1`}
            className={`w-full h-full border-0 pointer-events-auto ${
              isFitScreen ? "object-contain" : "object-cover scale-105"
            }`}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
            referrerPolicy="no-referrer"
          ></iframe>
        ) : isDirectVideo ? (
          <video
            ref={videoRef}
            src={room.currentUrl}
            onPlay={handleVideoPlay}
            onPause={handleVideoPause}
            onTimeUpdate={handleVideoTimeUpdate}
            controls
            className={`w-full h-full ${isFitScreen ? "object-contain" : "object-cover"}`}
          ></video>
        ) : (
          /* Native Interactive Canvas Browser Stream */
          <div className="w-full h-full flex flex-col items-center justify-center relative bg-[#0d0d11]">
            {isCaptchaRequired && (
              <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-amber-500/95 text-white font-medium text-xs px-4 py-2 rounded-lg shadow-lg flex items-center gap-2 z-40 max-w-[90%] text-center">
                <span>⚠️ CAPTCHA Verification or Cloudflare Shield detected. Click on the viewport to complete if challenged!</span>
              </div>
            )}
            
            {!frameSrc ? (
              <div className="flex flex-col items-center gap-3 text-zinc-400 select-none">
                <div className="h-6 w-6 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin"></div>
                <p className="text-xs font-medium">Spawning isolated backend browser session...</p>
              </div>
            ) : (
              <div className="relative w-full h-full flex items-center justify-center">
                {isLoadingFrame && (
                  <div className="absolute inset-0 bg-[#0d0d11]/70 backdrop-blur-xs flex flex-col items-center justify-center gap-3 z-30 select-none animate-in fade-in duration-250">
                    <div className="relative flex items-center justify-center h-10 w-10">
                      <div className="absolute h-10 w-10 rounded-full border-4 border-indigo-500/20"></div>
                      <div className="absolute h-10 w-10 rounded-full border-4 border-t-indigo-500 border-r-transparent border-b-transparent border-l-transparent animate-spin"></div>
                    </div>
                    <p className="text-xs font-medium text-zinc-300 font-mono tracking-wide animate-pulse">Loading webpage...</p>
                  </div>
                )}
                
                <canvas
                  ref={canvasRef}
                  onClick={handleCanvasClick}
                  onWheel={handleWheel}
                  onKeyDown={handleKeyDown}
                  onFocus={() => setIsCanvasFocused(true)}
                  onBlur={() => setIsCanvasFocused(false)}
                  tabIndex={0}
                  className={`max-w-full max-h-full aspect-video shadow-2xl cursor-pointer rounded-sm outline-none border border-white/5 transition-all ${
                    isCanvasFocused ? "ring-2 ring-indigo-500/50" : "hover:border-indigo-500/20"
                  }`}
                  id="virtual-canvas-viewport"
                />
                
                {!isCanvasFocused && (
                  <div className="absolute bottom-3 right-3 bg-black/60 backdrop-blur-md px-2.5 py-1 rounded-md text-[10px] text-zinc-400 pointer-events-none border border-white/5 z-20">
                    Click to capture keyboard input
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Real-time Watcher Cursor Overlay */}
        {Object.entries(room.users).map(([userId, user]) => {
          if (userId === myUserId || !user.cursor) return null;
          return (
            <div
              key={userId}
              style={{
                left: `${user.cursor.x * 100}%`,
                top: `${user.cursor.y * 100}%`,
                transform: "translate(-2px, -2px)",
              }}
              className="absolute pointer-events-none transition-all duration-75 z-50 flex items-center gap-1"
            >
              <Navigation className="h-3.5 w-3.5 text-white fill-current -rotate-90 drop-shadow-md" style={{ color: "rgb(99, 102, 241)" }} />
              <span className="bg-indigo-600/90 backdrop-blur-xs text-[9px] font-semibold text-white px-1.5 py-0.5 rounded-sm shadow-xs whitespace-nowrap">
                {user.name}
              </span>
            </div>
          );
        })}
      </div>

      {/* Synchronized Player Bar for co-watch syncing */}
      {!isYoutube && isDirectVideo && (
        <div className="h-12 bg-[#111114] px-4 flex items-center justify-between border-t border-white/5 text-zinc-400 shrink-0">
          <div className="flex items-center gap-3">
            <button onClick={togglePlay} className="text-zinc-200 hover:text-white transition">
              {room.isPlaying ? <Pause className="h-4 w-4 fill-current" /> : <Play className="h-4 w-4 fill-current" />}
            </button>
            <span className="text-[10px] font-mono">
              {Math.floor(room.currentTime / 60)}:
              {String(Math.floor(room.currentTime % 60)).padStart(2, "0")}
            </span>
          </div>

          <div className="flex-1 max-w-md mx-4">
            <input
              type="range"
              min="0"
              max="600"
              value={room.currentTime}
              onChange={(e) => {
                socket?.emit("browser-video-state", {
                  isPlaying: room.isPlaying,
                  currentTime: parseFloat(e.target.value),
                });
              }}
              className="w-full accent-indigo-500 bg-[#1e1e22] rounded-lg h-1 cursor-pointer appearance-none"
            />
          </div>

          <div className="flex items-center gap-2 text-[10px] font-mono">
            <Volume2 className="h-3.5 w-3.5 text-indigo-400" />
            <span className="text-zinc-500">SYNCED</span>
          </div>
        </div>
      )}
    </div>
  );
}
