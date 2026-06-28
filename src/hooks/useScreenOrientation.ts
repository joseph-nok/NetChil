/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useCallback } from "react";

export function useScreenOrientation() {
  const [orientation, setOrientation] = useState<"portrait" | "landscape">("landscape");
  const [isFullscreen, setIsFullscreen] = useState(false);

  const checkOrientation = useCallback(() => {
    if (typeof window === "undefined") return;
    
    // Fallback if Screen Orientation API is not supported
    if (window.screen && window.screen.orientation) {
      const type = window.screen.orientation.type;
      if (type.startsWith("portrait")) {
        setOrientation("portrait");
      } else {
        setOrientation("landscape");
      }
    } else {
      // Use window dimensions ratio
      const isPortrait = window.innerHeight > window.innerWidth;
      setOrientation(isPortrait ? "portrait" : "landscape");
    }
  }, []);

  useEffect(() => {
    checkOrientation();
    window.addEventListener("resize", checkOrientation);
    if (window.screen && window.screen.orientation) {
      window.screen.orientation.addEventListener("change", checkOrientation);
    }

    // Keep track of fullscreen changes
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);

    return () => {
      window.removeEventListener("resize", checkOrientation);
      if (window.screen && window.screen.orientation) {
        window.screen.orientation.removeEventListener("change", checkOrientation);
      }
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, [checkOrientation]);

  const toggleFullscreen = useCallback(async (element: HTMLElement | null) => {
    if (!element) return;

    try {
      if (!document.fullscreenElement) {
        await element.requestFullscreen();
        
        // Attempt to lock screen orientation to landscape on mobile devices
        if (window.screen && window.screen.orientation && "lock" in window.screen.orientation) {
          try {
            await (window.screen.orientation as any).lock("landscape");
          } catch (lockError) {
            console.warn("Screen orientation lock failed or not supported in this context.", lockError);
          }
        }
      } else {
        await document.exitFullscreen();
        if (window.screen && window.screen.orientation && "unlock" in window.screen.orientation) {
          try {
            window.screen.orientation.unlock();
          } catch (unlockError) {
            console.warn("Screen orientation unlock failed.", unlockError);
          }
        }
      }
    } catch (error) {
      console.error("Fullscreen toggle operation failed:", error);
    }
  }, []);

  return {
    orientation,
    isFullscreen,
    toggleFullscreen,
  };
}
