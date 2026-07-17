const kNumSamples = 5;
const kShortDelay = 1000;
const kLongDelay = 60000;
const kConnectionTimeout = 5000;
const kSocketTimeout = 10000;
const timeUrl = '/.well-known/time';
const wsUrl = (self.location.protocol === 'https:' ? 'wss://' : 'ws://') + self.location.host + '/.well-known/time-ws';

type TransportMode = 'Auto' | 'WebTransport' | 'WebSocket' | 'Fetch';

let webTransportPort: number | undefined;
let webTransportCert: string | undefined;
let mode: TransportMode | undefined;

let timeoutId: number | undefined;
let isSyncing = false;
let delays: number[] = [];
let timeOrigins: number[] = [];
let lastFetchRequest: number | undefined;

// WebTransport state
let wt: WebTransport | undefined;
let wtWriter: WritableStreamDefaultWriter<BufferSource> | undefined;

// WebSocket state
let ws: WebSocket | undefined;

const connectedPorts = new Set<MessagePort>();
const isSharedWorker = 'onconnect' in (self as object);
let lastState: object | null = null;

function broadcast(message: object) {
  lastState = message;
  if (isSharedWorker) {
    for (const port of connectedPorts) {
      port.postMessage(message);
    }
  } else {
    postMessage(message);
  }
}

function average(array: number[]) {
  return array.reduce((a, b) => a + b, 0) / array.length;
}

async function connectWt() {
  const url = `https://${new URL(self.location.href).hostname}:${webTransportPort}/.well-known/time-wt`;

  const options: WebTransportOptions = {
    requireUnreliable: true,
  };

  if (webTransportCert) {
    const certHash = Uint8Array.from(atob(webTransportCert), c => c.charCodeAt(0));
    options.serverCertificateHashes = [{
      algorithm: 'sha-256',
      value: certHash
    }];
  }

  wt = new WebTransport(url, options);
  let timerId;
  const timeoutPromise = new Promise((_, reject) =>
    timerId = setTimeout(() => {
      reject("WebTransport connection timed out.");
      try {
        wt!.close();
      } catch (e) {
        // Ignore the exception thrown by calling close() during connection
        // establishment.
      }
    }, kConnectionTimeout));
  try {
    await Promise.race([wt.ready, timeoutPromise]);
    console.log(`Connected to ${url}.`);
  } catch (e) {
    console.error(`Failed to connect to ${url}.`, e);
    wt = undefined;
    throw e;
  } finally {
    clearTimeout(timerId);
  }

  wtWriter = wt.datagrams.writable.getWriter();
  handleWtResponses(wt.datagrams.readable.getReader());
}

async function handleWtResponses(reader: ReadableStreamDefaultReader<Uint8Array>) {
  try {
    while (true) {
      const { value, done } = await reader.read();
      const responseReceived = performance.now();

      if (done) break;
      if (value.byteLength < 16) continue;

      const view = new DataView(value.buffer, value.byteOffset, value.byteLength);
      const requestSent = view.getFloat64(0, true);
      const serverTime = view.getFloat64(8, true) * 1_000;

      updateMeasurements(requestSent, responseReceived, serverTime, 'WebTransport');
    }
  } catch (e) {
    console.error('WebTransport reader error:', e);
    broadcast({mode: 'Disconnected'});
  } finally {
    try { wt?.close(); } catch {}
    wt = undefined;
    wtWriter = undefined;
  }
}

async function sendWtRequest() {
  if (!wt) {
    await connectWt();
  }

  if (!wtWriter) {
    throw new Error('WebTransport writer not initialized');
  }

  const dataView = new DataView(new ArrayBuffer(8));
  const requestSent = performance.now();
  dataView.setFloat64(0, requestSent, true);

  let timerId;
  try {
    console.log("Sending WebTransport request...");
    const timeoutPromise = new Promise((_, reject) =>
      timerId = setTimeout(() => {
        reject("WebTransport write timed out.");
        try { wt!.close(); } catch (e) {}
      }, kConnectionTimeout));
    await Promise.race([wtWriter.write(dataView.buffer), timeoutPromise]);
    console.log("Done.");
  } catch (e) {
    wt = undefined;
    wtWriter = undefined;
    throw e;
  } finally {
    clearTimeout(timerId);
  }
}

async function connectWs(): Promise<void> {
  ws = new WebSocket(wsUrl);
  ws.binaryType = 'arraybuffer';

  let { promise, resolve, reject } = Promise.withResolvers();
  let timerId = setTimeout(() => {
    ws!.close(1000, "Connection timeout.");
    ws = undefined;
    reject("WebSocket connection timeout.");
  }, kConnectionTimeout);
  ws.onopen = () => {
    console.log(`Connected to ${wsUrl}.`);
    resolve(undefined);
  };
  ws.onerror = (e) => {
    ws = undefined;
    reject(e);
  };
  await promise.finally(() => clearTimeout(timerId));
}

async function measureWs(): Promise<void> {
  if (!ws) {
    await connectWs();
  }

  if (!ws || ws.readyState !== WebSocket.OPEN) {
    ws = undefined;
    throw new Error('WebSocket not open');
  }

  let requestSent = performance.now();
  ws.send(new Uint8Array(0));

  let { promise, resolve, reject } = Promise.withResolvers();
  let timerId = setTimeout(() => {
    ws!.close(1000, "Request timeout.");
    reject("WebSocket request timeout.");
  }, kConnectionTimeout);
  ws.onmessage = (event) => {
    const responseReceived = performance.now();
    const view = new DataView(event.data);
    const serverTime = view.getFloat64(0, true) * 1_000;
    updateMeasurements(requestSent, responseReceived, serverTime, 'WebSocket');
    resolve(undefined);
  };
  ws.onclose = () => {
    reject(new Error('WebSocket closed'));
  };
  ws.onerror = (e) => {
    reject(e);
  }
  try {
    await promise;
  } catch (e) {
    ws = undefined;
    throw e;
  } finally {
    clearTimeout(timerId);
  }
}

async function measureHttp() {
  if (lastFetchRequest === undefined ||
      performance.now() - lastFetchRequest > kSocketTimeout) {
    try {
      await fetch(timeUrl, {
        method: 'HEAD',
        signal: AbortSignal.timeout(kConnectionTimeout),
      });
    } catch {}
  }

  const requestSent = performance.now();
  const response = await fetch(timeUrl, {
    method: 'HEAD',
    signal: AbortSignal.timeout(kConnectionTimeout),
  });
  const responseReceived = performance.now();
  lastFetchRequest = responseReceived;

  if (!response.ok) {
    throw new Error(`Server returned error: ${response.status}`);
  }

  const serverTime = Number(response.headers.get('x-httpstime')) * 1_000;
  updateMeasurements(requestSent, responseReceived, serverTime, 'Fetch');
}

function updateMeasurements(requestSent: number, responseReceived: number, serverTime: number, mode: string) {
  const newDelay = responseReceived - requestSent;
  console.log(`Measured round-trip time of ${newDelay.toFixed(2)}ms.`);
  const newTimeOrigin = ((serverTime - requestSent) + (serverTime - responseReceived)) / 2;
  console.log(`Measured time origin of ${newTimeOrigin}.`);

  if (timeOrigins.length > 0) {
    const oldTimeOrigin = average(timeOrigins);
    if (Math.abs(oldTimeOrigin - newTimeOrigin) > newDelay) {
      console.log('Large clock drift detected, clearing measurement history.');
      delays = [];
      timeOrigins = [];
    }
  }

  if (timeOrigins.length >= kNumSamples) {
    delays.shift();
    timeOrigins.shift();
  }

  delays.push(newDelay);
  timeOrigins.push(newTimeOrigin);

  const delay = average(delays);
  const timeOrigin = average(timeOrigins);
  const timeOriginOffset = performance.timeOrigin - timeOrigin;
  const offset: number = Date.now() - new Date(performance.now() + timeOrigin).getTime();

  broadcast({delay, timeOriginOffset, offset, mode});
}

function setMode(newMode: TransportMode) {
  if (mode === newMode) {
    return;
  }

  console.log(`Setting mode to ${newMode}.`);
  mode = newMode;

  if (mode !== 'Auto') {
    if (mode !== 'WebTransport' && wt) {
      try { wt.close(); } catch {}
      wt = undefined;
    }
    if (mode !== 'WebSocket' && ws) {
      try { ws.close(); } catch {}
      ws = undefined;
    }
    if (mode !== 'Fetch') {
      lastFetchRequest = undefined;
    }
  }

  if (isSyncing) {
    console.log("Will change mode after current sync.");
  } else {
    if (timeoutId !== undefined) {
      self.clearTimeout(timeoutId);
      timeoutId = undefined;
    }
    timeoutId = self.setTimeout(detectOffset, kShortDelay);
  }
}

async function detectOffset() {
  timeoutId = undefined;
  isSyncing = true;

  try {
    if (mode === 'WebTransport' || wt) {
      await sendWtRequest();
    } else if (mode === 'WebSocket' || ws) {
      await measureWs();
    } else if (mode === 'Fetch' || lastFetchRequest) {
      await measureHttp();
    } else if (webTransportPort && typeof WebTransport !== 'undefined') {
      try {
        await sendWtRequest();
      } catch (e) {
        try {
          await measureWs();
        } catch (e) {
          await measureHttp();
        }
      }
    } else {
      try {
        await measureWs();
      } catch (e) {
        await measureHttp();
      }
    }

    timeoutId = self.setTimeout(
        detectOffset, timeOrigins.length < kNumSamples ? kShortDelay : kLongDelay);
  } catch (e) {
    console.error('Failed to request time from server.', e);
    broadcast({mode: 'Disconnected'});
    timeoutId = self.setTimeout(detectOffset, kShortDelay);
  }

  isSyncing = false;
}

function handleMessage(event: MessageEvent) {
  if (event.data.webTransportPort) {
    webTransportPort = event.data.webTransportPort;
  }
  if (event.data.webTransportCert) {
    webTransportCert = event.data.webTransportCert;
  }
  if ('mode' in event.data) {
    setMode(event.data.mode);
  }
  if (event.data.sync) {
    if (isSyncing) {
      console.log("Client requested sync, but already syncing.");
    } else {
      console.log("Client requested sync.");
      if (timeoutId !== undefined) {
        self.clearTimeout(timeoutId);
        timeoutId = undefined;
      }
      detectOffset();
    }
  }
}

if (isSharedWorker) {
  (self as unknown as SharedWorkerGlobalScope).onconnect = (event) => {
    const port = event.ports[0];
    port.start();
    connectedPorts.add(port);
    port.onmessage = handleMessage;
    if (lastState) {
      port.postMessage(lastState);
    }
  };
} else {
  self.onmessage = handleMessage;
}
