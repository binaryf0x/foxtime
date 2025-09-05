const kNumSamples = 5;
const kShortDelay = 1000;
const kLongDelay = 60000;
const kSocketTimeout = 10000;
const timeUrl = '/.well-known/time';
let timeoutId = 0;
let delays = [];
let timeOrigins = [];
let lastRequest = performance.now();
let hidden = false;

function average(array) {
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
      timeoutId = setTimeout(detectOffset, kShortDelay);
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
    const offset = new Date() - new Date(performance.now() + timeOrigin);

    postMessage({delay, timeOriginOffset, offset});
  } catch (e) {
    console.error('Failed to request time from server.', e);
    timeoutId = setTimeout(detectOffset, kShortDelay);
    return;
  }

  timeoutId = setTimeout(
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
    timeoutId = setTimeout(detectOffset, kShortDelay);
  }
};

timeoutId = setTimeout(detectOffset, kShortDelay);
