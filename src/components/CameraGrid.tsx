/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from "react";
import { Mic, MicOff, Video, VideoOff, Disc } from "lucide-react";
import { RoomState, User } from "../types";

interface CameraGridProps {
  room: RoomState;
  myUserId: string;
  localStream: MediaStream | null;
  remoteStreams: Record<string, MediaStream>;
  cameraActive: boolean;
  micActive: boolean;
  isMovieFocus: boolean;
}

export function CameraGrid({
  room,
  myUserId,
  localStream,
  remoteStreams,
  cameraActive,
  micActive,
  isMovieFocus,
}: CameraGridProps) {
  const localVideoRef = useRef<HTMLVideoElement>(null);

  // Bind local stream
  useEffect(() => {
    if (localVideoRef.current && localStream && cameraActive) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream, cameraActive]);

  // Video feed element for remote peers
  const RemoteVideo = ({ stream, active }: { stream: MediaStream; active: boolean }) => {
    const videoRef = useRef<HTMLVideoElement>(null);

    useEffect(() => {
      if (videoRef.current && stream && active) {
        videoRef.current.srcObject = stream;
      }
    }, [stream, active]);

    if (!active) return null;

    return (
      <video
        ref={videoRef}
        autoPlay
        playsInline
        className="h-full w-full object-cover rounded-xl bg-zinc-950"
      ></video>
    );
  };

  // Movie Focus Draggable/Floating Bubbles Layout
  if (isMovieFocus) {
    return (
      <div className="absolute top-4 right-4 z-50 flex flex-col gap-3 pointer-events-none">
        {/* Local Stream Bubble */}
        <div className="relative h-16 w-16 rounded-full border-2 border-indigo-500 bg-zinc-950 overflow-hidden shadow-xl pointer-events-auto flex items-center justify-center">
          {cameraActive && localStream ? (
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              className="h-full w-full object-cover rounded-full"
            ></video>
          ) : (
            <div className="text-xs font-semibold text-zinc-400">Me</div>
          )}
          <div className="absolute bottom-1 right-1 h-4 w-4 rounded-full bg-zinc-900/80 backdrop-blur-xs flex items-center justify-center border border-zinc-700">
            {micActive ? <Mic className="h-2 w-2 text-indigo-400" /> : <MicOff className="h-2 w-2 text-red-400" />}
          </div>
        </div>

        {/* Remote Stream Bubbles */}
        {Object.entries(room.users).map(([userId, user]) => {
          if (userId === myUserId) return null;
          const remoteStream = remoteStreams[userId];
          const hasVideo = user.cameraActive && remoteStream;

          return (
            <div
              key={userId}
              className="relative h-16 w-16 rounded-full border-2 border-zinc-700 bg-zinc-950 overflow-hidden shadow-xl pointer-events-auto flex items-center justify-center"
            >
              {hasVideo ? (
                <RemoteVideo stream={remoteStream} active={user.cameraActive} />
              ) : (
                <div className={`h-full w-full flex items-center justify-center text-xs font-bold rounded-full ${user.color}`}>
                  {user.name.slice(0, 2).toUpperCase()}
                </div>
              )}
              <div className="absolute bottom-1 right-1 h-4 w-4 rounded-full bg-zinc-900/80 backdrop-blur-xs flex items-center justify-center border border-zinc-700">
                {user.micActive ? <Mic className="h-2 w-2 text-indigo-400" /> : <MicOff className="h-2 w-2 text-red-400" />}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  // Split screen / Regular Side-by-Side camera grid Layout
  return (
    <div className="flex flex-col h-full bg-[#0f0f12] p-4 overflow-y-auto">
      <div className="mb-4 flex items-center justify-between border-b border-white/5 pb-3 shrink-0">
        <div className="flex items-center gap-2">
          <Disc className="h-3.5 w-3.5 text-indigo-500 animate-pulse" />
          <h2 className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
            Room Watchers
          </h2>
        </div>
        <span className="text-[10px] font-mono text-zinc-500">
          {Object.keys(room.users).length} active
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-1">
        {/* Local Stream Card */}
        <div className="relative aspect-video rounded-lg bg-[#16161a] overflow-hidden border border-white/5 group">
          {cameraActive && localStream ? (
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              className="h-full w-full object-cover"
            ></video>
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-zinc-500">
              {room.users[myUserId]?.photoURL ? (
                <img 
                  src={room.users[myUserId].photoURL} 
                  alt="You" 
                  className="h-10 w-10 rounded-full object-cover mb-1.5 border border-white/10 shadow-md" 
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="h-8 w-8 rounded-full bg-white/5 flex items-center justify-center mb-1.5 text-zinc-400">
                  <VideoOff className="h-4 w-4" />
                </div>
              )}
              <span className="text-[10px] font-medium uppercase tracking-wide">Camera Off</span>
            </div>
          )}

          {/* User Name Tag overlay */}
          <div className="absolute bottom-2 left-2 flex items-center gap-1.5 rounded-md bg-zinc-950/80 backdrop-blur-md px-2 py-0.5 text-[10px] font-semibold text-zinc-200 border border-white/5">
            <span>You</span>
            {micActive ? <Mic className="h-3 w-3 text-emerald-400" /> : <MicOff className="h-3 w-3 text-rose-400" />}
          </div>
        </div>

        {/* Remote Stream Cards */}
        {Object.entries(room.users).map(([userId, user]) => {
          if (userId === myUserId) return null;
          const remoteStream = remoteStreams[userId];
          const hasVideo = user.cameraActive && remoteStream;

          return (
            <div
              key={userId}
              className="relative aspect-video rounded-lg bg-[#16161a] overflow-hidden border border-white/5 group"
            >
              {hasVideo ? (
                <RemoteVideo stream={remoteStream} active={user.cameraActive} />
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-zinc-500">
                  {user.photoURL ? (
                    <img 
                      src={user.photoURL} 
                      alt={user.name} 
                      className="h-10 w-10 rounded-full object-cover mb-1.5 border border-white/10 shadow-md" 
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div className={`h-10 w-10 rounded-full flex items-center justify-center mb-1.5 text-xs font-bold shadow-md ${user.color}`}>
                      {user.name.slice(0, 2).toUpperCase()}
                    </div>
                  )}
                  <span className="text-[10px] font-semibold text-zinc-400">{user.name}</span>
                </div>
              )}

              {/* User Name Tag overlay */}
              <div className="absolute bottom-2 left-2 flex items-center gap-1.5 rounded-md bg-zinc-950/80 backdrop-blur-md px-2 py-0.5 text-[10px] font-semibold text-zinc-200 border border-white/5">
                <span>{user.name}</span>
                {user.micActive ? <Mic className="h-3 w-3 text-emerald-400" /> : <MicOff className="h-3 w-3 text-rose-400" />}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
