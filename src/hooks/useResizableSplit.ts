/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback } from "react";

interface SplitConfig {
  initialRatio?: number;
  minRatio?: number;
  maxRatio?: number;
  direction?: "horizontal" | "vertical";
  storageKey?: string;
}

export function useResizableSplit({
  initialRatio = 0.65,
  minRatio = 0.20,
  maxRatio = 0.80,
  direction = "horizontal",
  storageKey = "watchnexus-split-ratio",
}: SplitConfig = {}) {
  // Read initial value from localStorage if available
  const [ratio, setRatio] = useState<number>(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = parseFloat(saved);
        if (!isNaN(parsed) && parsed >= minRatio && parsed <= maxRatio) {
          return parsed;
        }
      }
    } catch (e) {
      console.error("Failed to read split ratio from localStorage", e);
    }
    return initialRatio;
  });

  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Persist ratio changes
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, ratio.toString());
    } catch (e) {
      console.error("Failed to save split ratio to localStorage", e);
    }
  }, [ratio, storageKey]);

  const handleDrag = useCallback(
    (clientX: number, clientY: number) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      let newRatio: number;

      if (direction === "horizontal") {
        const offsetX = clientX - rect.left;
        newRatio = offsetX / rect.width;
      } else {
        const offsetY = clientY - rect.top;
        newRatio = offsetY / rect.height;
      }

      // Constrain ratio within bounds
      newRatio = Math.max(minRatio, Math.min(maxRatio, newRatio));
      setRatio(newRatio);
    },
    [direction, minRatio, maxRatio]
  );

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      handleDrag(e.clientX, e.clientY);
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length > 0) {
        handleDrag(e.touches[0].clientX, e.touches[0].clientY);
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    window.addEventListener("touchmove", handleTouchMove, { passive: false });
    window.addEventListener("touchend", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handleMouseUp);
    };
  }, [isDragging, handleDrag]);

  const startDragging = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  return {
    ratio,
    isDragging,
    containerRef,
    startDragging,
  };
}
