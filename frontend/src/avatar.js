// frontend/src/avatar.js
// HeyGen Interactive Avatar Integration

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

/**
 * Avatar Manager Class
 * Handles HeyGen Interactive Avatar initialization, conversation, and lifecycle
 */
export class AvatarManager {
  constructor(mode = 'clinic') {
    this.mode = mode; // 'clinic' or 'rehab'
    this.sessionId = null;
    this.heygenSession = null;
    this.conversationHistory = [];
    this.isListening = false;
    this.isSpeaking = false;
    
    // HeyGen SDK reference (loaded from CDN in HTML)
    this.StreamingAvatar = window.StreamingAvatar;
  }

  /**
   * Initialize HeyGen avatar session
   */
  async initialize(avatarId, containerElement) {
    try {
      console.log('🎬 Initializing avatar session...');
      
      // Start HeyGen session via backend
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

      console.log('✅ Session created:', this.sessionId);

      // Initialize HeyGen SDK
      this.heygenSession = new this.StreamingAvatar({
        token: sessionData.session_id,
        iceServers: sessionData.ice_servers
      });

      // Attach to container
      await this.heygenSession.createPeerConnection(
        sessionData.sdp,
        containerElement
      );

      console.log('✅ Avatar connected');

      // Set up event listeners
      this.setupEventListeners();

      return true;

    } catch (error) {
      console.error('❌ Avatar initialization failed:', error);
      throw error;
    }
  }

  /**
   * Set up HeyGen event listeners
   */
  setupEventListeners() {
    if (!this.heygenSession) return;

    // Avatar started speaking
    this.heygenSession.on('avatar_start_talking', () => {
      console.log('🗣️ Avatar started speaking');
      this.isSpeaking = true;
      this.onSpeakingStart?.();
    });

    // Avatar stopped speaking
    this.heygenSession.on('avatar_stop_talking', () => {
      console.log('🤐 Avatar stopped speaking');
      this.isSpeaking = false;
      this.onSpeakingEnd?.();
    });

    // Stream ready
    this.heygenSession.on('stream_ready', () => {
      console.log('📹 Stream ready');
      this.onStreamReady?.();
    });

    // Connection closed
    this.heygenSession.on('stream_disconnected', () => {
      console.log('📴 Stream disconnected');
      this.onDisconnect?.();
    });
  }

  /**
   * Send message to avatar (user speaks)
   */
  async sendMessage(userMessage) {
    try {
      console.log('💬 User:', userMessage);

      // Add to conversation history
      this.conversationHistory.push({
        role: 'user',
        content: userMessage
      });

      // Call backend to get response from brain
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
      console.log('📦 Chunks:', data.chunks.length);

      // Add to conversation history
      this.conversationHistory.push({
        role: 'assistant',
        content: data.response
      });

      // Check for emergency
      if (data.safety.is_emergency) {
        console.warn('⚠️ Emergency detected');
        this.onEmergency?.(data.response);
      }

      // Send response to avatar in chunks for smooth delivery
      await this.speakChunks(data.chunks);

      return data;

    } catch (error) {
      console.error('❌ Message send failed:', error);
      this.onError?.(error);
      throw error;
    }
  }

  /**
   * Make avatar speak text in chunks (for smooth delivery)
   */
  async speakChunks(chunks) {
    if (!this.heygenSession || !chunks || chunks.length === 0) return;

    console.log(`🎙️ Speaking ${chunks.length} chunks...`);

    for (const chunk of chunks) {
      try {
        // Send chunk to HeyGen
        await this.heygenSession.speak({
          text: chunk,
          task_type: 'repeat' // or 'talk' depending on HeyGen API version
        });

        // Small delay between chunks for natural pacing
        await new Promise(resolve => setTimeout(resolve, 100));

      } catch (error) {
        console.error('❌ Chunk speak failed:', error);
        // Continue with next chunk even if one fails
      }
    }

    console.log('✅ Finished speaking');
  }

  /**
   * Interrupt avatar (stop speaking)
   */
  async interrupt() {
    if (!this.heygenSession) return;

    try {
      await this.heygenSession.interrupt();
      console.log('✋ Avatar interrupted');
    } catch (error) {
      console.error('❌ Interrupt failed:', error);
    }
  }

  /**
   * Start listening for user input (microphone)
   */
  async startListening() {
    if (!this.heygenSession) return;

    try {
      await this.heygenSession.startListening();
      this.isListening = true;
      console.log('🎤 Started listening');
      this.onListeningStart?.();
    } catch (error) {
      console.error('❌ Start listening failed:', error);
    }
  }

  /**
   * Stop listening
   */
  async stopListening() {
    if (!this.heygenSession) return;

    try {
      await this.heygenSession.stopListening();
      this.isListening = false;
      console.log('🔇 Stopped listening');
      this.onListeningEnd?.();
    } catch (error) {
      console.error('❌ Stop listening failed:', error);
    }
  }

  /**
   * Close avatar session
   */
  async close() {
    try {
      console.log('👋 Closing avatar session...');

      // Stop HeyGen session
      if (this.heygenSession) {
        await this.heygenSession.close();
        this.heygenSession = null;
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
      this.conversationHistory = [];

      console.log('✅ Session closed');

    } catch (error) {
      console.error('❌ Close failed:', error);
    }
  }

  /**
   * Reset conversation (keep session alive)
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
  // EVENT HANDLERS (set these from outside)
  // ========================================================================

  onSpeakingStart = null;
  onSpeakingEnd = null;
  onListeningStart = null;
  onListeningEnd = null;
  onStreamReady = null;
  onDisconnect = null;
  onEmergency = null;
  onError = null;
}

/**
 * Helper: Create and initialize avatar
 */
export async function createAvatar(mode, avatarId, containerElement) {
  const avatar = new AvatarManager(mode);
  await avatar.initialize(avatarId, containerElement);
  return avatar;
}

/**
 * Helper: Check if avatar features are available
 */
export function isAvatarSupported() {
  return typeof window.StreamingAvatar !== 'undefined';
}
