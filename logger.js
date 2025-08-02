const fs = require('fs');
const path = require('path');

class Logger {
  constructor(name, logDir = 'logs') {
    this.name = name;
    this.logDir = logDir;
    this.logFile = path.join(logDir, `${name}.log`);
    
    // Ensure log directory exists
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    
    // Clear log file on start
    this.clearLog();
    
    // Store original console methods
    this.originalConsole = {
      log: console.log,
      error: console.error,
      warn: console.warn,
      info: console.info
    };
    
    this.setupLogging();
  }
  
  clearLog() {
    try {
      fs.writeFileSync(this.logFile, '');
      this.writeToFile(`=== ${this.name.toUpperCase()} LOG STARTED: ${new Date().toISOString()} ===\n`);
    } catch (err) {
      console.error('Failed to clear log file:', err);
    }
  }
  
  writeToFile(message) {
    const timestamp = new Date().toISOString();
    const logLine = `[${timestamp}] ${message}\n`;
    try {
      fs.appendFileSync(this.logFile, logLine);
    } catch (err) {
      this.originalConsole.error('Failed to write to log file:', err);
    }
  }
  
  setupLogging() {
    const self = this;
    
    // Override console.log
    console.log = function(...args) {
      const message = args.join(' ');
      self.originalConsole.log(`[${self.name}]`, ...args);
      self.writeToFile(`LOG: ${message}`);
    };
    
    // Override console.error
    console.error = function(...args) {
      const message = args.join(' ');
      self.originalConsole.error(`[${self.name}]`, ...args);
      self.writeToFile(`ERROR: ${message}`);
    };
    
    // Override console.warn
    console.warn = function(...args) {
      const message = args.join(' ');
      self.originalConsole.warn(`[${self.name}]`, ...args);
      self.writeToFile(`WARN: ${message}`);
    };
    
    // Override console.info
    console.info = function(...args) {
      const message = args.join(' ');
      self.originalConsole.info(`[${self.name}]`, ...args);
      self.writeToFile(`INFO: ${message}`);
    };
  }
  
  log(message) {
    console.log(message);
  }
  
  error(message) {
    console.error(message);
  }
  
  warn(message) {
    console.warn(message);
  }
  
  info(message) {
    console.info(message);
  }
  
  // Method to read log file
  readLog() {
    try {
      return fs.readFileSync(this.logFile, 'utf8');
    } catch (err) {
      return `Error reading log file: ${err.message}`;
    }
  }
  
  // Method to get last N lines from log
  getLastLines(n = 50) {
    try {
      const content = fs.readFileSync(this.logFile, 'utf8');
      const lines = content.split('\n').filter(line => line.trim());
      return lines.slice(-n).join('\n');
    } catch (err) {
      return `Error reading log file: ${err.message}`;
    }
  }
  
  // Restore original console methods
  restore() {
    console.log = this.originalConsole.log;
    console.error = this.originalConsole.error;
    console.warn = this.originalConsole.warn;
    console.info = this.originalConsole.info;
  }
}

module.exports = Logger; 