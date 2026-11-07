const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

const COLORS = {
  error: '\u001b[31m',
  warn: '\u001b[33m',
  info: '\u001b[36m',
  debug: '\u001b[90m',
  reset: '\u001b[0m',
  dim: '\u001b[2m',
};

let threshold = LEVELS[process.env.LOG_LEVEL || 'info'] ?? LEVELS.info;

const stamp = () => new Date().toLocaleTimeString('en-GB', { hour12: false });

function write(level, scope, args) {
  if (LEVELS[level] > threshold) return;
  const prefix = `${COLORS.dim}${stamp()}${COLORS.reset} ${COLORS[level]}${level.toUpperCase().padEnd(5)}${COLORS.reset} ${COLORS.dim}[${scope}]${COLORS.reset}`;
  const stream = level === 'error' || level === 'warn' ? console.error : console.log;
  stream(prefix, ...args);
}

export function createLogger(scope = 'bot') {
  return {
    error: (...args) => write('error', scope, args),
    warn: (...args) => write('warn', scope, args),
    info: (...args) => write('info', scope, args),
    debug: (...args) => write('debug', scope, args),
    child: (childScope) => createLogger(`${scope}:${childScope}`),
  };
}

export function setLogLevel(level) {
  threshold = LEVELS[level] ?? LEVELS.info;
}

export const logger = createLogger('bot');
