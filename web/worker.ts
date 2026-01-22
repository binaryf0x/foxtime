const kNumSamples = 5;
const kShortDelay = 1000;
const kLongDelay = 60000;
const kSocketTimeout = 10000;
const timeUrl = '/.well-known/time';
let timeoutId: number | undefined;
let delays: number[] = [];
let timeOrigins: number[] = [];
let lastRequest = performance.now();
let hidden = false;

function average(array: number[]) {
  return array.reduce((a, b) => a + b, 0) / array.length;
}

async function detectOffset() {
  timeoutId = undefined;

  try {
    if (performance.now() - lastRequest > kSocketTimeout) {
      // The socket has probably timed out. Establish a new connection
      // before taking a measurement.
      await fetch(timeUrl, {method: 'HEAD'});
    }

    const requestSent = performance.now();
    const response = await fetch(timeUrl, {method: 'HEAD'});
    const responseReceived = performance.now();

    if (hidden) {
      return;
    }

    if (!response.ok) {
      console.error(`Server returned error: ${response.status}`);
      timeoutId = self.setTimeout(detectOffset, kShortDelay);
      return;
    }

    lastRequest = responseReceived;
    const serverTime = Number(response.headers.get('x-httpstime')) * 1_000;

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
  } catch (e) {
    console.error('Failed to request time from server.', e);
    timeoutId = self.setTimeout(detectOffset, kShortDelay);
    return;
  }

  timeoutId = self.setTimeout(
      detectOffset, timeOrigins.length < kNumSamples ? kShortDelay : kLongDelay);
}

self.onmessage = (event) => {
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
