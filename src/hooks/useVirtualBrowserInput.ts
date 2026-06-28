/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useRef } from "react";
import { Socket } from "socket.io-client";

interface BrowserInputConfig {
  socket: Socket | null;
  roomId: string;
  isInteractive: boolean;
}

export function useVirtualBrowserInput({ socket, roomId, isInteractive }: BrowserInputConfig) {
  const containerRef = useRef<HTMLDivElement>(null);

  const getNormalizedCoordinates = useCallback((clientX: number, clientY: number) => {
    if (!containerRef.current) return null;
    const rect = containerRef.current.getBoundingClientRect();
    const x = (clientX - rect.left) / rect.width;
    const y = (clientY - rect.top) / rect.height;
    return {
      x: Math.max(0, Math.min(1, x)),
      y: Math.max(0, Math.min(1, y)),
    };
  }, []);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!socket) return;
      const coords = getNormalizedCoordinates(e.clientX, e.clientY);
      if (coords) {
        socket.emit("cursor-move", coords);
      }
    },
    [socket, getNormalizedCoordinates]
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent<HTMLDivElement>) => {
      if (!socket || e.touches.length === 0) return;
      const touch = e.touches[0];
      const coords = getNormalizedCoordinates(touch.clientX, touch.clientY);
      if (coords) {
        socket.emit("cursor-move", coords);
      }
    },
    [socket, getNormalizedCoordinates]
  );

  const handleInputClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!isInteractive || !socket) return;
      const coords = getNormalizedCoordinates(e.clientX, e.clientY);
      if (coords) {
        // Emit interaction event for virtual browser (Docker Neko container or simulated)
        socket.emit("browser-input-click", {
          x: coords.x,
          y: coords.y,
          button: e.button === 2 ? "right" : "left",
        });
      }
    },
    [isInteractive, socket, getNormalizedCoordinates]
  );

  const handleKeyPress = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (!isInteractive || !socket) return;
      // Prevent standard browser shortcuts from interfering with watch party room input
      e.preventDefault();
      socket.emit("browser-input-key", {
        key: e.key,
        code: e.code,
        ctrlKey: e.ctrlKey,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
      });
    },
    [isInteractive, socket]
  );

  return {
    containerRef,
    handleMouseMove,
    handleTouchMove,
    handleInputClick,
    handleKeyPress,
  };
}
