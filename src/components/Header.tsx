/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from "react";
import { Monitor, Users, ExternalLink, ArrowLeft, Tv, Shield } from "lucide-react";
import { RoomState } from "../types";

interface HeaderProps {
  room: RoomState;
  onLeave: () => void;
  myUserId: string;
}

export function Header({ room, onLeave, myUserId }: HeaderProps) {
  const userCount = Object.keys(room.users).length;
  const [copied, setCopied] = React.useState(false);

  const copyInviteLink = () => {
    const baseUrl = window.location.origin + window.location.pathname;
    const inviteUrl = `${baseUrl}?room=${room.id}`;
    navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <header className="flex h-14 items-center justify-between border-b border-white/5 bg-[#111114] px-6 shrink-0">
      <div className="flex items-center gap-4">
        <button
          onClick={onLeave}
          className="flex h-8 items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-2.5 text-xs font-medium text-gray-300 transition hover:bg-white/10 hover:text-white"
          id="btn-leave-room"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>Leave</span>
        </button>

        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 font-bold text-white text-sm">
            WN
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-tight text-white">
              Watch<span className="text-indigo-400">Nexus</span>
            </h1>
          </div>
        </div>

        <div className="h-5 w-px bg-white/10 mx-1"></div>

        {/* Room State Name Badge */}
        <div className="flex items-center gap-2 bg-[#1a1a1e] px-3 py-1 rounded-full border border-white/5">
          <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse"></div>
          <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
            Room: {room.name || room.id}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-4">
        {/* Connection Type Indicator */}
        <div className="hidden sm:flex items-center gap-1.5 rounded-md border border-white/5 bg-[#1a1a1e] px-2.5 py-1">
          <span className="text-[10px] font-mono font-medium tracking-wide text-gray-500">
            {room.type === "docker" ? "CLOUD CHROMIUM" : "CO-WATCH SYNC"}
          </span>
        </div>

        {/* User Presence indicator */}
        <div className="flex items-center gap-1.5 text-xs text-gray-400">
          <Users className="h-3.5 w-3.5 text-gray-500" />
          <span>{userCount} Watcher{userCount === 1 ? "" : "s"}</span>
        </div>

        {/* Share Button */}
        <button
          onClick={copyInviteLink}
          className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all border shadow-xs ${
            copied 
              ? "bg-emerald-600 border-emerald-500/30 text-white" 
              : "bg-indigo-600 hover:bg-indigo-500 border-indigo-400/20 text-white"
          }`}
          id="btn-share-room"
        >
          <span className="flex items-center gap-1.5">
            <span>{copied ? "Copied!" : "Invite"}</span>
            <ExternalLink className="h-3.5 w-3.5" />
          </span>
        </button>
      </div>
    </header>
  );
}
