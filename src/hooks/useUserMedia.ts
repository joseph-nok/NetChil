/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { Socket } from "socket.io-client";

interface UserMediaConfig {
  socket: Socket | null;
  roomId: string;
  myUserId: string;
}

export function useUserMedia({ socket, roomId, myUserId }: UserMediaConfig) {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [micActive, setMicActive] = useState(false);
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});

  const peerConnections = useRef<Record<string, RTCPeerConnection>>({});
  const localStreamRef = useRef<MediaStream | null>(null);

  // STUN Servers for WebRTC NAT Traversal
  const rtcConfig: RTCConfiguration = {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
      { urls: "stun:stun2.l.google.com:19302" },
    ],
  };

  // Start or Stop media device permissions safely
  const toggleCamera = useCallback(async () => {
    try {
      if (cameraActive) {
        // Stop current video tracks
        if (localStreamRef.current) {
          localStreamRef.current.getVideoTracks().forEach((track) => {
            track.stop();
            if (localStreamRef.current) {
              localStreamRef.current.removeTrack(track);
            }
          });
        }
        setCameraActive(false);
        socket?.emit("toggle-media", { cameraActive: false, micActive });
      } else {
        // Request camera
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        const videoTrack = stream.getVideoTracks()[0];

        let activeStream = localStreamRef.current;
        if (!activeStream) {
          activeStream = new MediaStream();
          localStreamRef.current = activeStream;
          setLocalStream(activeStream);
        }

        activeStream.addTrack(videoTrack);
        setCameraActive(true);

        // Update all peer connections with the new track
        Object.entries(peerConnections.current).forEach(([peerId, pc]) => {
          const connection = pc as any;
          const sender = connection.getSenders().find((s: any) => s.track?.kind === "video");
          if (sender) {
            sender.replaceTrack(videoTrack);
          } else {
            connection.addTrack(videoTrack, activeStream!);
          }
        });

        socket?.emit("toggle-media", { cameraActive: true, micActive });
      }
    } catch (err) {
      console.error("Failed to toggle camera:", err);
    }
  }, [cameraActive, micActive, socket]);

  const toggleMic = useCallback(async () => {
    try {
      if (micActive) {
        // Stop audio tracks
        if (localStreamRef.current) {
          localStreamRef.current.getAudioTracks().forEach((track) => {
            track.stop();
            if (localStreamRef.current) {
              localStreamRef.current.removeTrack(track);
            }
          });
        }
        setMicActive(false);
        socket?.emit("toggle-media", { cameraActive, micActive: false });
      } else {
        // Request mic
        const stream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
        const audioTrack = stream.getAudioTracks()[0];

        let activeStream = localStreamRef.current;
        if (!activeStream) {
          activeStream = new MediaStream();
          localStreamRef.current = activeStream;
          setLocalStream(activeStream);
        }

        activeStream.addTrack(audioTrack);
        setMicActive(true);

        // Update all peer connections
        Object.entries(peerConnections.current).forEach(([peerId, pc]) => {
          const connection = pc as any;
          const sender = connection.getSenders().find((s: any) => s.track?.kind === "audio");
          if (sender) {
            sender.replaceTrack(audioTrack);
          } else {
            connection.addTrack(audioTrack, activeStream!);
          }
        });

        socket?.emit("toggle-media", { cameraActive, micActive: true });
      }
    } catch (err) {
      console.error("Failed to toggle microphone:", err);
    }
  }, [cameraActive, micActive, socket]);

  // Helper to initialize a native RTCPeerConnection
  const createPeerConnection = useCallback(
    (targetUserId: string, isInitiator: boolean) => {
      if (peerConnections.current[targetUserId]) {
        return peerConnections.current[targetUserId];
      }

      console.log(`Creating RTCPeerConnection for user: ${targetUserId}, initiator: ${isInitiator}`);
      const pc = new RTCPeerConnection(rtcConfig);

      // Add local media tracks if they exist
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => {
          pc.addTrack(track, localStreamRef.current!);
        });
      }

      // Handle ICE Candidate gathering
      pc.onicecandidate = (event) => {
        if (event.candidate && socket) {
          socket.emit("signal", {
            to: targetUserId,
            signal: {
              type: "candidate",
              candidate: event.candidate,
            },
          });
        }
      };

      // Handle incoming remote media tracks
      pc.ontrack = (event) => {
        console.log(`Received remote track from: ${targetUserId}`, event.streams);
        if (event.streams && event.streams[0]) {
          setRemoteStreams((prev) => ({
            ...prev,
            [targetUserId]: event.streams[0],
          }));
        }
      };

      pc.onconnectionstatechange = () => {
        console.log(`Connection state with ${targetUserId} changed to: ${pc.connectionState}`);
        if (pc.connectionState === "disconnected" || pc.connectionState === "failed" || pc.connectionState === "closed") {
          cleanupPeer(targetUserId);
        }
      };

      peerConnections.current[targetUserId] = pc;
      return pc;
    },
    [socket]
  );

  const cleanupPeer = useCallback((userId: string) => {
    const pc = peerConnections.current[userId];
    if (pc) {
      pc.close();
      delete peerConnections.current[userId];
    }
    setRemoteStreams((prev) => {
      const copy = { ...prev };
      delete copy[userId];
      return copy;
    });
  }, []);

  // Set up signaling websocket hooks
  useEffect(() => {
    if (!socket) return;

    // 1. A new user joins, we are the initiator to connect to them
    const handleUserJoined = async (user: any) => {
      const pc = createPeerConnection(user.id, true);
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit("signal", {
          to: user.id,
          signal: {
            type: "offer",
            sdp: pc.localDescription,
          },
        });
      } catch (err) {
        console.error("Error creating WebRTC offer:", err);
      }
    };

    // 2. Handle incoming signal messages (Offers, Answers, and Candidates)
    const handleSignal = async ({ from, signal }: { from: string; signal: any }) => {
      try {
        if (signal.type === "offer") {
          const pc = createPeerConnection(from, false);
          await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          socket.emit("signal", {
            to: from,
            signal: {
              type: "answer",
              sdp: pc.localDescription,
            },
          });
        } else if (signal.type === "answer") {
          const pc = peerConnections.current[from];
          if (pc) {
            await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
          }
        } else if (signal.type === "candidate") {
          const pc = peerConnections.current[from];
          if (pc) {
            await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
          }
        }
      } catch (err) {
        console.error("Error processing WebRTC signaling message:", err);
      }
    };

    // 3. Clean up disconnected user peer connections
    const handleUserLeft = (userId: string) => {
      cleanupPeer(userId);
    };

    socket.on("user-joined", handleUserJoined);
    socket.on("signal", handleSignal);
    socket.on("user-left", handleUserLeft);

    return () => {
      socket.off("user-joined", handleUserJoined);
      socket.off("signal", handleSignal);
      socket.off("user-left", handleUserLeft);
    };
  }, [socket, createPeerConnection, cleanupPeer]);

  // Clean up media streams and RTCPeerConnections on unmount
  useEffect(() => {
    return () => {
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => track.stop());
      }
      Object.values(peerConnections.current).forEach((pc) => (pc as any).close());
    };
  }, []);

  return {
    localStream,
    cameraActive,
    micActive,
    remoteStreams,
    toggleCamera,
    toggleMic,
  };
}
