const kNumSamples = 5;
const kShortDelay = 1000;
const kLongDelay = 60000;
const kSocketTimeout = 10000;
const timeUrl = '/.well-known/time';

let webTransportPort: number | undefined;
let webTransportCert: string | undefined;

let timeoutId: number | undefined;
let delays: number[] = [];
let timeOrigins: number[] = [];
let lastRequest = performance.now();
let hidden = false;

// WebTransport state
let wt: WebTransport | undefined;
let wtWriter: WritableStreamDefaultWriter<BufferSource> | undefined;

function average(array: number[]) {
  return array.reduce((a, b) => a + b, 0) / array.length;
}


async function connectWt() {
  const url = `https://${new URL(self.location.href).hostname}:${webTransportPort}/.well-known/time`;

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
  try {
    await wt.ready;
    console.log(`Connected to ${url}.`);
  } catch (e) {
    console.error(`Failed to connect to ${url}.`, e);
    wt = undefined;
    throw e;
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

      updateMeasurements(requestSent, responseReceived, serverTime);
    }
  } catch (e) {
    console.error('WebTransport reader error:', e);
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

  try {
    await wtWriter.write(dataView.buffer);
  } catch (e) {
    wt = undefined;
    wtWriter = undefined;
    throw e;
  }
}

async function measureHttp() {
  if (performance.now() - lastRequest > kSocketTimeout) {
    try {
      await fetch(timeUrl, {method: 'HEAD'});
    } catch {}
  }

  const requestSent = performance.now();
  const response = await fetch(timeUrl, {method: 'HEAD'});
  const responseReceived = performance.now();

  if (!response.ok) {
    throw new Error(`Server returned error: ${response.status}`);
  }

  const serverTime = Number(response.headers.get('x-httpstime')) * 1_000;
  updateMeasurements(requestSent, responseReceived, serverTime);
}

function updateMeasurements(requestSent: number, responseReceived: number, serverTime: number) {
  if (hidden) {
    lastRequest = responseReceived;
    return;
  }

  lastRequest = responseReceived;
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

  postMessage({delay, timeOriginOffset, offset});
}

async function detectOffset() {
  timeoutId = undefined;

  try {
    if (webTransportPort && typeof WebTransport !== 'undefined') {
      try {
        await sendWtRequest();
      } catch (e) {
        await measureHttp();
      }
    } else {
      await measureHttp();
    }
  } catch (e) {
    console.error('Failed to request time from server.', e);
    timeoutId = self.setTimeout(detectOffset, kShortDelay);
    return;
  }

  timeoutId = self.setTimeout(
      detectOffset, timeOrigins.length < kNumSamples ? kShortDelay : kLongDelay);
}

self.onmessage = (event) => {
  if (event.data.webTransportPort) {
    webTransportPort = event.data.webTransportPort;
  }
  if (event.data.webTransportCert) {
    webTransportCert = event.data.webTransportCert;
  }
  hidden = event.data.hidden;

  if (hidden) {
    if (timeoutId) {
      console.log('Pausing measurements.');
      clearTimeout(timeoutId);
      timeoutId = undefined;
    }
  } else if (!timeoutId) {
    console.log('Resuming measurements.');
    timeoutId = self.setTimeout(detectOffset, kShortDelay);
  }
};

timeoutId = self.setTimeout(detectOffset, kShortDelay);
