/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from "react";
import { Send, Users, MessageSquare } from "lucide-react";
import { ChatMessage, RoomState } from "../types";

interface ChatProps {
  room: RoomState;
  chatHistory: ChatMessage[];
  myUserId: string;
  onSendMessage: (text: string) => void;
}

export function Chat({ room, chatHistory, myUserId, onSendMessage }: ChatProps) {
  const [inputText, setInputText] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;
    onSendMessage(inputText.trim());
    setInputText("");
  };

  return (
    <div className="flex h-full flex-col bg-[#0f0f12] border-l border-white/5">
      {/* Tab Selectors */}
      <div className="flex h-12 items-center justify-between border-b border-white/5 px-4 bg-[#111114]">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-gray-400">
          <MessageSquare className="h-3.5 w-3.5 text-indigo-400" />
          <span>Room Chat</span>
        </div>
        <div className="text-[10px] font-mono text-gray-500">
          {chatHistory.length} messages
        </div>
      </div>

      {/* Message Log */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {chatHistory.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center p-6">
            <div className="mb-3 rounded-full bg-white/5 p-3">
              <MessageSquare className="h-5 w-5 text-gray-500" />
            </div>
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">No messages yet</p>
            <p className="text-[11px] text-gray-500 mt-1">Send a message to sync with the party!</p>
          </div>
        ) : (
          chatHistory.map((msg) => {
            const isMe = msg.userId === myUserId;
            return (
              <div key={msg.id} className={`flex flex-col ${isMe ? "items-end" : "items-start"}`}>
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="text-[11px] font-semibold text-gray-400">
                    {msg.userName}
                  </span>
                  <span className="text-[9px] text-gray-600">{msg.timestamp}</span>
                </div>
                <div
                  className={`max-w-[85%] rounded-lg px-3 py-2 text-xs leading-relaxed ${
                    isMe
                      ? "bg-indigo-600/20 text-indigo-200 border border-indigo-500/30 rounded-tr-none"
                      : "bg-[#16161a] text-zinc-300 border border-white/5 rounded-tl-none"
                  }`}
                >
                  {msg.text}
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Message Input form */}
      <form onSubmit={handleSubmit} className="border-t border-white/5 p-4 bg-[#111114]">
        <div className="relative flex items-center">
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="Type a message..."
            className="w-full rounded-md border border-white/10 bg-[#1e1e22] py-2.5 pl-4 pr-12 text-xs text-white placeholder-gray-500 focus:border-indigo-500/50 focus:outline-hidden"
            id="chat-input-field"
          />
          <button
            type="submit"
            className="absolute right-2 flex h-7 w-7 items-center justify-center rounded-md bg-indigo-600 text-white shadow-xs hover:bg-indigo-500 transition-colors"
            id="btn-chat-send"
          >
            <Send className="h-3.5 w-3.5" />
          </button>
        </div>
      </form>
    </div>
  );
}
