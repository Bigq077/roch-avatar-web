// avatar/frontend/src/queue.js
// Message queue management for handling concurrent messages

/**
 * Simple message queue to handle multiple user messages
 * and ensure they're processed in order
 */
export class MessageQueue {
  constructor() {
    this.queue = [];
    this.processing = false;
  }

  /**
   * Add message to queue and process if not already processing
   */
  async add(message, handler) {
    return new Promise((resolve, reject) => {
      this.queue.push({
        message,
        handler,
        resolve,
        reject
      });
      
      this.process();
    });
  }

  /**
   * Process queue items one by one
   */
  async process() {
    if (this.processing || this.queue.length === 0) {
      return;
    }

    this.processing = true;

    while (this.queue.length > 0) {
      const item = this.queue.shift();

      try {
        const result = await item.handler(item.message);
        item.resolve(result);
      } catch (error) {
        item.reject(error);
      }
    }

    this.processing = false;
  }

  /**
   * Clear all pending messages
   */
  clear() {
    this.queue = [];
    this.processing = false;
  }

  /**
   * Get queue length
   */
  get length() {
    return this.queue.length;
  }
}

/**
 * Debounce function for user input
 * Prevents sending too many requests while user is typing
 */
export function debounce(func, wait) {
  let timeout;
  
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

/**
 * Throttle function for rate limiting
 */
export function throttle(func, limit) {
  let inThrottle;
  
  return function(...args) {
    if (!inThrottle) {
      func.apply(this, args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  };
}
