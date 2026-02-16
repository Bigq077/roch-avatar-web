// avatar/frontend/src/avatar.js
// LiveAvatar CUSTOM Mode Integration

import { Room, RoomEvent } from 'livekit-client';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

/**
 * LiveAvatar Manager for CUSTOM Mode
 * Manages LiveKit room connection and avatar interactions
 */
export class AvatarManager {
  constructor(mode = 'clinic') {
    this.mode = mode;
    this.sessionId = null;
    this.sessionToken = null;
    this.room = null;
    this.conversationHistory = [];
    this.isConnected = false;
    this.isSpeaking = false;
    this.avatarTrack = null;
  }

  /**
   * Initialize LiveAvatar session
   */
  async initialize(avatarId, videoElement) {
    try {
      console.log('🎬 Initializing LiveAvatar session...');
      
      // Get session from backend
      const response = await fetch(`${API_BASE_URL}/api/heygen/session/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          avatar_id: avatarId,
          mode: this.mode
        })
      });

      if (!response.ok) {
        throw new Error(`Failed to start session: ${response.statusText}`);
      }

      const sessionData = await response.json();
      this.sessionId = sessionData.session_id;
      this.sessionToken = sessionData.session_token;

      console.log('✅ Session created:', this.sessionId);

      // Connect to LiveKit room
      await this.connectToRoom(sessionData.room_url, sessionData.room_token, videoElement);

      return true;

    } catch (error) {
      console.error('❌ Initialization failed:', error);
      throw error;
    }
  }

  /**
   * Connect to LiveKit room and attach avatar video
   */
  async connectToRoom(roomUrl, roomToken, videoElement) {
    try {
      console.log('📡 Connecting to LiveKit room...');

      // Create LiveKit room
      this.room = new Room();

      // Set up event listeners
      this.room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
        console.log('🎥 Track subscribed:', track.kind);
        
        if (track.kind === 'video') {
          this.avatarTrack = track;
          track.attach(videoElement);
          console.log('✅ Avatar video attached');
          this.onStreamReady?.();
        }
      });

      this.room.on(RoomEvent.TrackUnsubscribed, (track) => {
        console.log('🎥 Track unsubscribed');
        if (track.kind === 'video') {
          track.detach();
        }
      });

      this.room.on(RoomEvent.Disconnected, () => {
        console.log('📴 Disconnected from room');
        this.isConnected = false;
        this.onDisconnect?.();
      });

      this.room.on(RoomEvent.Connected, () => {
        console.log('✅ Connected to room');
        this.isConnected = true;
      });

      // Connect to room
      await this.room.connect(roomUrl, roomToken);

      console.log('✅ LiveKit room connected');

    } catch (error) {
      console.error('❌ Room connection failed:', error);
      throw error;
    }
  }

  /**
   * Send message to avatar (user speaks)
   */
  async sendMessage(userMessage) {
    try {
      console.log('💬 User:', userMessage);

      // Add to history
      this.conversationHistory.push({
        role: 'user',
        content: userMessage
      });

      // Get response from brain via backend
      const response = await fetch(`${API_BASE_URL}/api/heygen/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: this.mode,
          message: userMessage,
          history: this.conversationHistory,
          session_id: this.sessionId
        })
      });

      if (!response.ok) {
        throw new Error(`Chat failed: ${response.statusText}`);
      }

      const data = await response.json();

      console.log('🤖 Assistant:', data.response);

      // Add to history
      this.conversationHistory.push({
        role: 'assistant',
        content: data.response
      });

      // Check for emergency
      if (data.safety.is_emergency) {
        console.warn('⚠️ Emergency detected');
        this.onEmergency?.(data.response);
      }

      // Send to LiveAvatar to speak
      await this.speak(data.response);

      return data;

    } catch (error) {
      console.error('❌ Send message failed:', error);
      this.onError?.(error);
      throw error;
    }
  }

  /**
   * Make avatar speak text
   * In CUSTOM mode, we send text via LiveKit data channel
   */
  async speak(text) {
    if (!this.room || !this.isConnected) {
      console.error('❌ Room not connected');
      return;
    }

    try {
      console.log('🎙️ Sending text to avatar:', text);

      this.isSpeaking = true;
      this.onSpeakingStart?.();

      // Send text to avatar via LiveKit data channel
      // LiveAvatar will handle TTS and lip sync
      const encoder = new TextEncoder();
      const data = encoder.encode(JSON.stringify({
        type: 'speak',
        text: text
      }));

      await this.room.localParticipant.publishData(data, 'reliable');

      console.log('✅ Text sent to avatar');

      // Simulate speaking end (in reality, listen to avatar events)
      // For now, estimate based on text length (150 words per minute)
      const words = text.split(' ').length;
      const speakingTimeMs = (words / 150) * 60 * 1000;

      setTimeout(() => {
        this.isSpeaking = false;
        this.onSpeakingEnd?.();
      }, speakingTimeMs);

    } catch (error) {
      console.error('❌ Speak failed:', error);
      this.isSpeaking = false;
    }
  }

  /**
   * Close session
   */
  async close() {
    try {
      console.log('👋 Closing session...');

      // Disconnect from room
      if (this.room) {
        await this.room.disconnect();
        this.room = null;
      }

      // Notify backend to clean up
      if (this.sessionId) {
        await fetch(`${API_BASE_URL}/api/heygen/session/stop`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_id: this.sessionId })
        });
      }

      this.sessionId = null;
      this.sessionToken = null;
      this.conversationHistory = [];
      this.isConnected = false;

      console.log('✅ Session closed');

    } catch (error) {
      console.error('❌ Close failed:', error);
    }
  }

  /**
   * Reset conversation
   */
  resetConversation() {
    this.conversationHistory = [];
    console.log('🔄 Conversation reset');
  }

  /**
   * Get conversation history
   */
  getHistory() {
    return [...this.conversationHistory];
  }

  // ========================================================================
  // EVENT HANDLERS
  // ========================================================================

  onSpeakingStart = null;
  onSpeakingEnd = null;
  onStreamReady = null;
  onDisconnect = null;
  onEmergency = null;
  onError = null;
}

/**
 * Helper: Create and initialize avatar
 */
export async function createAvatar(mode, avatarId, videoElement) {
  const avatar = new AvatarManager(mode);
  await avatar.initialize(avatarId, videoElement);
  return avatar;
}

/**
 * Helper: Check if LiveAvatar is supported
 */
export function isAvatarSupported() {
  // Check if LiveKit is loaded
  return typeof Room !== 'undefined';
}
