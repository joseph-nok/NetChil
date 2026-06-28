/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface User {
  id: string;
  name: string;
  cursor?: { x: number; y: number };
  cameraActive: boolean;
  micActive: boolean;
  color: string;
  photoURL?: string;
}

export interface ChatMessage {
  id: string;
  userId: string;
  userName: string;
  userColor: string;
  text: string;
  timestamp: string;
}

export interface RoomState {
  id: string;
  name: string;
  type: 'docker' | 'simulated';
  nekoPort?: number;
  nekoHost?: string;
  currentUrl: string;
  isPlaying: boolean;
  currentTime: number;
  createdAt: number;
  lastActiveAt: number;
  users: Record<string, User>;
  clientUserAgent?: string;
  clientCookies?: string;
  clientResolution?: { width: number; height: number };
  proxyServer?: string;
  proxyUsername?: string;
  proxyPassword?: string;
}

export interface WebRTCSignal {
  type: 'offer' | 'answer' | 'candidate';
  from: string;
  to: string;
  data: any;
}
